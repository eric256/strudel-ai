// ---------------------------------------------------------------------------
// 🧩 Plugins: small JavaScript modules that add to the app through one `api` object — panels, header buttons,
// settings pages, themes, bands, song forms, stations, sounds, instructions for the AI, and the player's events.
// Where they come from:
//   • examples that come with the app (public/plugins/, off until you turn them on)
//   • the server's plugins folder (PLUGINS_DIR, served at /user-plugins/, on by default)
//   • installed in this browser from a file or a URL (the code is kept in localStorage)
// ⚙ Settings → 🧩 Plugins turns them on and off. A plugin that fails is turned off and its error is logged, so a
// broken plugin never stops the app. How to write one: PLUGINS.md.
//
//   export default {
//     id: 'bar-counter', name: 'Bar counter', version: '1.0.0', description: 'A big bar · beat display',
//     setup(api) { const panel = api.addPanel({ id: 'bars', title: 'Bars', icon: '⏱' }); … return () => {} },
//   };
// ---------------------------------------------------------------------------
import { html, svg, render, nothing, repeat, classMap, styleMap, live } from '../html.js';
import { themeColor, themeAlpha, onThemeChange, registerTheme, unregisterTheme } from '../theme.js';
import { $, addMsg, applyQuantized, cps, engine, evaluateCode, getCode, isPlaying, load, mirror, nowCycle, player, queue, save, showPanel, ws } from '../app.js';
import { APP_VERSION } from './share.js';
import { mergeBands } from './bands.js';
import { mergeForms } from './forms.js';
import { mergeStations } from './stations.js';
import { openSettings, settingsPages } from './settings.js';
import { resetSoundCatalog } from './sound-check.js';
import { addToPlaylist } from './playlist.js';
import { playSong, songFromJSON } from './song-library.js';
import { meterBeats, songMeter } from '../lib/music.js';
import { T, overrideTemplate, templateNames } from '../templates/index.js';
import { addImporter } from './importers.js';
import { addExporter } from './exporters.js';
import { songsChanged } from './song-lists.js';

const INSTALLED_KEY = 'strudel-ai:plugins';
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const PROMPT_MODES = ['code', 'sheet', 'library', 'songs'];

/** Every plugin we know of: src → { src, kind, url, name, file, def, on, error, cleanup }. */
const plugins = new Map();
/** Instructions plugins add to the AI's prompts: [{ plugin, modes, text }]. */
const hints = [];

const installed = () => { try { return JSON.parse(localStorage.getItem(INSTALLED_KEY)) || []; } catch { return []; } };
const saveInstalled = (list) => { try { localStorage.setItem(INSTALLED_KEY, JSON.stringify(list)); } catch (e) { addMsg('error', `Couldn't save the plugin: ${e.message}`); } };
/** On / off as you set it; otherwise examples start off and the others on. */
const wantOn = (p) => load().plugins?.[p.src] ?? p.kind !== 'example';
const setWanted = (src, on) => save({ plugins: { ...(load().plugins || {}), [src]: on } });

/** The extra instructions for one kind of AI request (sent with it; the server adds them to the system prompt). */
export function promptHints(mode) {
  return hints.filter((h) => h.modes.includes(mode)).map((h) => h.text).join('\n\n');
}

// --- the api a plugin gets ---------------------------------------------------
function makeApi(p, id) {
  const cleanups = [];
  const later = (fn) => cleanups.push(fn);
  const tag = `[🧩 ${id}]`;
  /** Run a plugin's callback: its errors are logged, never thrown into the app. */
  const guard = (fn, what) => (...a) => { try { return fn(...a); } catch (e) { console.error(`${tag} ${what}:`, e); } };
  const storeKey = `strudel-ai:plugin:${id}`;
  const readStore = () => { try { return JSON.parse(localStorage.getItem(storeKey)) || {}; } catch { return {}; } };
  let settingsN = 0;

  const api = {
    id,
    appVersion: APP_VERSION,
    // templates (lit-html) and theme colours
    html, svg, render, nothing, repeat, classMap, styleMap, live,
    themeColor, themeAlpha,
    onThemeChange(fn) { later(onThemeChange(guard(fn, 'theme listener'))); },

    /** The player's events: 'section', 'song', 'transport', 'songs' (or '*' for all). */
    on(event, fn) { later(player.on(event, guard(fn, `${event} listener`))); },
    /** The app, read mostly: the playlist, the section engine, the code, the clock. */
    app: {
      get queue() { return queue; },
      get engine() { return engine; },
      get song() { return queue.songs[queue.current] || null; },
      /** The section playing now (its name), or ''. */
      get section() { return engine.steps.find((x) => x.status === 'playing')?.prompt || ''; },
      /** Beats in a bar of the song playing (4 unless its sheet says otherwise). */
      beatsPerBar: () => meterBeats(songMeter(queue.songs[queue.current])),
      getCode, isPlaying, nowCycle, cps,
      /** Play code now (or on the bar line the user chose): it goes through the same checks as the AI's code. */
      play: (code, label = id) => applyQuantized(code, label),
      evaluateCode,
      addToPlaylist, playSong, songFromJSON,
      showPanel,
    },
    /** A line in the chat. */
    message(text, kind = 'info') { addMsg(kind, `🧩 ${text}`); },
    log: (...a) => console.info(tag, ...a),
    warn: (...a) => console.warn(tag, ...a),

    /**
     * A panel in the layout: { id, title, icon, area: 'right' | 'bottom' | 'left', render(el), onVisible(shown) }.
     * Returns { el, open(), close() }. It's listed in ▦ Panels and keeps its place in the layout.
     */
    addPanel(def) {
      if (!ID_RE.test(def?.id || '')) throw new Error('addPanel needs an id (letters, digits, - and _)');
      const pid = `${id}.${def.id}`;
      const el = ws.addPanel({ id: pid, title: def.title || def.id, icon: def.icon || '🧩', area: def.area || 'bottom',
        onVisible: def.onVisible ? guard(def.onVisible, 'onVisible') : null });
      later(() => ws.removePanel(pid));
      if (def.render) guard(def.render, 'panel render')(el);
      return { el, open: () => ws.open(pid), close: () => ws.close(pid) };
    },
    /** A button in the header: { icon, label, title, onClick }. Returns the button. */
    addButton({ icon = '🧩', label = '', title = '', onClick } = {}) {
      const b = document.createElement('button');
      b.title = title || label || id;
      b.textContent = icon;
      if (label) { const s = document.createElement('span'); s.className = 'lbl'; s.textContent = ` ${label}`; b.append(s); }
      b.dataset.plugin = id;
      if (onClick) b.onclick = guard(onClick, 'button');
      $('pluginButtons').append(b);
      later(() => b.remove());
      return b;
    },
    /** A page in ⚙ Settings: { title, icon, render(el) } — render runs each time the page opens. */
    addSettings({ title, icon = '🧩', render: draw } = {}) {
      const sec = `setPlugin-${id}-${settingsN++}`;
      const tab = document.createElement('button');
      tab.dataset.sec = sec;
      tab.textContent = `${icon} ${title || id}`;
      tab.onclick = () => openSettings(sec);
      const el = document.createElement('section');
      el.id = sec;
      el.className = 'settings-sec plugin-settings';
      el.hidden = true;
      document.querySelector('.settings-tabs [data-sec="setBackup"]').before(tab);
      $('setPlugins').after(el);
      if (draw) settingsPages.set(sec, guard(() => draw(el), 'settings render'));
      later(() => { tab.remove(); el.remove(); settingsPages.delete(sec); });
      return el;
    },
    /** A theme in ⚙ Settings → 🎨 Theme: { name, editor, scheme, colors } (see public/theme.js for the tokens). */
    addTheme(themeId, theme) {
      const tid = `${id}.${themeId}`;
      registerTheme(tid, { name: theme.name || themeId, editor: theme.editor || 'strudelTheme', scheme: theme.scheme === 'light' ? 'light' : 'dark', colors: theme.colors || {} });
      later(() => unregisterTheme(tid));
    },
    /** Bands, song forms and stations join your own lists once; then they're yours to edit or delete. */
    addBands(list) { mergeBands([].concat(list), `plugin:${id}:bands`); },
    addForms(list) { mergeForms([].concat(list), `plugin:${id}:forms`); },
    addStations(list) { mergeStations([].concat(list), `plugin:${id}:stations`); },
    /**
     * Replace one of the app's HTML templates (public/templates/): make(original) returns the new template, which
     * can call original(...) to wrap it. Removed again when the plugin is turned off. Names: api.templateNames().
     */
    overrideTemplate(name, make) { later(overrideTemplate(name, make, `🧩 ${id}`)); },
    templateNames,
    /** Extra instructions for the AI: mode 'code' (chat edits), 'sheet', 'library', 'songs', or '*' for all. */
    addPromptHint(mode, text) {
      const h = { plugin: id, modes: mode === '*' ? PROMPT_MODES : [].concat(mode), text: String(text) };
      hints.push(h);
      later(() => { const i = hints.indexOf(h); if (i >= 0) hints.splice(i, 1); });
    },
    /**
     * An importer: files ⬆ import in 🎵 Songs can now read. { id, label, icon, accept: ['.musicxml', …], title,
     * async import(file, tools) → song JSON (or a list) }. tools: helpers (unzip, serializeMini, gmSound …).
     */
    addImporter(def) {
      if (!def || typeof def.import !== 'function' || !def.accept) throw new Error('addImporter needs accept and import(file, tools)');
      later(addImporter({ ...def, id: def.id || id, plugin: id, import: def.import }));
    },
    /**
     * An exporter: a format a song's ⬇ Export menu offers. { id, label, icon, ext, mime, title, copy (offer 📋),
     * open (offer ↗, for a result with a url), async export(song, tools) → text, a Blob / bytes, or { text | blob | bytes,
     * name, mime, url } }. tools: helpers (songProgram, songNotes, strudelLink, gmProgram …).
     */
    addExporter(def) {
      if (!def || typeof def.export !== 'function' || !def.label) throw new Error('addExporter needs a label and export(song, tools)');
      const off = addExporter({ ...def, id: def.id ? `${id}.${def.id}` : id, plugin: id, builtin: false });
      songsChanged();
      later(() => { off(); songsChanged(); });
    },
    /** Load samples, like Strudel's samples(): a map ({ name: [urls] }) or a strudel.json URL, and a base URL. */
    async addSounds(map, base) {
      try { await mirror()?.prebaked; } catch {}
      if (typeof globalThis.samples !== 'function') throw new Error('Strudel is not ready to load samples');
      await globalThis.samples(map, base);
      resetSoundCatalog();
    },
    /** This plugin's own saved settings (in this browser). */
    storage: {
      get: (k, d) => (k in readStore() ? readStore()[k] : d),
      set: (k, v) => { try { localStorage.setItem(storeKey, JSON.stringify({ ...readStore(), [k]: v })); } catch {} },
      remove: (k) => { const s = readStore(); delete s[k]; try { localStorage.setItem(storeKey, JSON.stringify(s)); } catch {} },
    },
  };
  return { api, cleanup: () => { for (const fn of cleanups.reverse()) { try { fn(); } catch (e) { console.error(`${tag} cleanup:`, e); } } cleanups.length = 0; } };
}

// --- loading -------------------------------------------------------------------
async function importPlugin(p) {
  if (p.kind !== 'installed') return import(p.url);
  const code = installed().find((x) => x.src === p.src)?.code;
  if (!code) throw new Error('the plugin\'s code is missing');
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try { return await import(url); } finally { URL.revokeObjectURL(url); }
}
function checkDef(mod) {
  const def = mod?.default;
  if (!def || typeof def !== 'object') throw new Error('it has no `export default { id, name, setup(api) }`');
  if (!ID_RE.test(def.id || '')) throw new Error('its id must be letters, digits, - and _ (up to 40)');
  if (typeof def.setup !== 'function') throw new Error('it has no setup(api) function');
  return def;
}

/** Turn a plugin on: load it and run its setup. Errors turn it off again (and are logged). */
async function start(p) {
  if (p.on) return true;
  p.error = '';
  let cleanup = null;
  try {
    p.def = checkDef(await importPlugin(p));
    const clash = [...plugins.values()].find((q) => q !== p && q.on && q.def?.id === p.def.id);
    if (clash) throw new Error(`another plugin (${clash.name}) already uses the id "${p.def.id}"`);
    p.name = p.def.name || p.def.id;
    const made = makeApi(p, p.def.id);
    cleanup = made.cleanup;
    const own = await p.def.setup(made.api);
    p.cleanup = () => { if (typeof own === 'function') { try { own(); } catch (e) { console.error(`[🧩 ${p.def.id}] teardown:`, e); } } made.cleanup(); };
    p.on = true;
    console.info(`[🧩 plugins] ${p.name} ${p.def.version || ''} is on`);
    return true;
  } catch (e) {
    cleanup?.();
    p.error = e?.message || String(e);
    console.error(`[🧩 plugins] ${p.name || p.src} failed and was turned off: ${p.error}`, e);
    return false;
  }
}
/** Read a plugin's name, version and description without starting it. */
async function describe(p) {
  try { p.def = checkDef(await importPlugin(p)); p.name = p.def.name || p.def.id; } catch (e) { p.error = e?.message || String(e); }
}
function stop(p) {
  if (!p.on) return;
  p.on = false;
  p.cleanup?.();
  p.cleanup = null;
  console.info(`[🧩 plugins] ${p.name} is off`);
}
async function toggle(p, on) {
  setWanted(p.src, on);
  if (on) { if (!(await start(p))) setWanted(p.src, false); } else stop(p);
  renderPluginSettings();
}

const fileName = (url) => decodeURIComponent(url.split('/').pop().replace(/\.m?js$/, ''));
function addSource(src, kind, url, name) {
  if (!plugins.has(src)) plugins.set(src, { src, kind, url, name: name || fileName(url || src), def: null, on: false, error: '', cleanup: null });
  return plugins.get(src);
}

/** Install a plugin from its code (a file, or text fetched from a URL): kept in this browser, and turned on. */
async function install(code, from) {
  const src = `installed:${from}`;
  const list = installed().filter((x) => x.src !== src);
  list.push({ src, from, code, at: new Date().toISOString() });
  saveInstalled(list);
  const old = plugins.get(src);
  if (old) { stop(old); plugins.delete(src); }
  const p = addSource(src, 'installed', null, fileName(from));
  await toggle(p, true);
  addMsg(p.on ? 'info' : 'error', p.on ? `🧩 installed the plugin “${p.name}”` : `🧩 the plugin from ${from} didn't start: ${p.error}`);
}
function uninstall(p) {
  if (!confirm(`Remove the plugin “${p.name}” from this browser?`)) return;
  stop(p);
  plugins.delete(p.src);
  saveInstalled(installed().filter((x) => x.src !== p.src));
  const wanted = { ...(load().plugins || {}) };
  delete wanted[p.src];
  save({ plugins: wanted });
  renderPluginSettings();
}

// --- ⚙ Settings → 🧩 Plugins -----------------------------------------------------
const KIND_LABEL = { example: 'example', server: 'server folder', installed: 'this browser' };
let urlDraft = '';
export function renderPluginSettings() {
  const el = $('pluginList');
  if (!el) return;
  render(T.pluginList({
    plugins: [...plugins.values()].map((p) => ({
      src: p.src, name: p.name, version: p.def?.version || '', kind: KIND_LABEL[p.kind], description: p.def?.description || '',
      on: p.on, error: p.error, removable: p.kind === 'installed',
    })),
    url: urlDraft,
  }, {
    toggle: (src, on) => toggle(plugins.get(src), on),
    remove: (src) => uninstall(plugins.get(src)),
    installFile: async (f) => install(await f.text(), f.name),
    setUrl: (t) => { urlDraft = t; },
    installUrl: installFromUrl,
  }), el);
}
async function installFromUrl() {
  const url = urlDraft.trim();
  if (!url) return;
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await install(await r.text(), url);
    urlDraft = '';
    renderPluginSettings();
  } catch (e) { addMsg('error', `🧩 Couldn't fetch the plugin from ${url}: ${e.message}`); }
}

/** Start-up (last, once the app is ready): find the plugins and start the ones that are on. */
export async function setup() {
  let found = { builtin: [], server: [] };
  try { found = await fetch('/api/plugins', { cache: 'no-cache' }).then((r) => r.json()); } catch (e) { console.warn('[🧩 plugins] the list could not be loaded:', e.message); }
  for (const url of found.builtin || []) addSource(url, 'example', url);
  for (const url of found.server || []) addSource(url, 'server', url);
  for (const x of installed()) addSource(x.src, 'installed', null, fileName(x.from));
  for (const p of plugins.values()) {
    if (!wantOn(p)) continue;
    if (!(await start(p))) setWanted(p.src, false);
  }
  ws.dropWaiting(); // saved panels of plugins that are off or gone
  // the ones that are off: read their name and description for the list (their setup doesn't run)
  for (const p of plugins.values()) if (!p.on && !p.def && !p.error) await describe(p);
  if ($('settingsDlg').open && !$('setPlugins').hidden) renderPluginSettings();
}

/** For tests and the debug log. */
export const pluginsState = () => [...plugins.values()].map((p) => ({ src: p.src, kind: p.kind, id: p.def?.id || null, name: p.name, on: p.on, error: p.error }));
