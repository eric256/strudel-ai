import { dlog, debugReport, debugState } from './debuglog.js'; // first: it catches errors from everything after it
import './theme.js'; // next: the saved theme applies before anything is drawn
import { loadDockview, createWorkspace } from './workspace.js';
import { wrapCode } from './format.js';
import { MASTER_PARAMS, STYLE_NAMES } from './master.js';
import { esc, parseJSONLoose, oneLine, sliderless } from './lib/util.js';
import { getScales, colonScale, scaleHelp } from './lib/scales.js';
import { transposeProgression, meterBeats, songMeter } from './lib/music.js';
import { libraryIds } from './lib/sheet.js';
import { SEC_START, sectionCode, carryLiveState } from './lib/arrange.js';
import { createEmitter, onceAFrame } from './lib/events.js';
import { transcribe } from './hum.js';
import { barBeat, resetLineControls, setup as setup_mute_solo } from './features/mute-solo.js';
import { hum, audioCtx, setup as setup_hum_ui } from './features/hum-ui.js';
import { upd, reloadForUpdate, setup as setup_share } from './features/share.js';
import { viz, setup as setup_visualizer } from './features/visualizer.js';
import { setup as setup_hydra } from './features/hydra.js';
import { setup as setup_settings } from './features/settings.js';
import { mixer, mixerChannels, setup as setup_mixer } from './features/mixer.js';
import { master, masterChain, setup as setup_master_panel } from './features/master-panel.js';
import { keysState, noteOn, noteOff, setup as setup_keys } from './features/keys.js';
import { padsState, loadPads, pads, padIsOn, savePads, padOnce, setPad, renderPads, setup as setup_pads } from './features/pads.js';
import { playSong, mySongs, favorites, download, songToJSON, songFromJSON, loadFavorites, setup as setup_song_library } from './features/song-library.js';
import { rawSheet, songEdit, setup as setup_song_editor } from './features/song-editor.js';
import { songPads } from './features/song-pads.js';
import { mp3TakeEnd, mp3, songMp3, setup as setup_mp3 } from './features/mp3.js';
import { downloadDebugLog, debugContext } from './features/debug.js';
import { syntaxError, requestLLM, extractCode, session, money, setup as setup_llm } from './features/llm.js';
import { pretty, preloadSoundfonts, prepareCode, soundRegistry, checkScales, checkSounds, ensureSliders, setup as setup_sound_check } from './features/sound-check.js';
import { setup as setup_chat } from './features/chat.js';
import { songForms, setup as setup_forms } from './features/forms.js';
import { bands, normalizeSheet, setup as setup_bands } from './features/bands.js';
import { stripPartVisuals } from './features/part-visuals.js';
import { stopSet, repairSong, startPlaylist, jumpToSong } from './features/song-writer.js';
import { songsChanged, nowSong, viewedSong, setup as setup_song_lists } from './features/song-lists.js';
import { setup as setup_stations } from './features/stations.js';
import { addToPlaylist, sessionSongs, setup as setup_playlist } from './features/playlist.js';
import { setup as setup_themes } from './features/themes.js';
import { pluginsState, setup as setup_plugins } from './features/plugins.js';
import { MODES, currentMode, setMode, setup as setup_modes } from './features/modes.js';
import { html, nothing, render, renderOptions } from './html.js';
import { T } from './templates/index.js';
// Strudel AI — browser app
/**
 * Element by id. Remembered once found, so panels keep working when the layout engine takes them out of the
 * page (a hidden tab) or into another window (a popped-out panel), where document.getElementById can't see them.
 */
const $els = new Map();
export const $ = (id) => {
  const known = $els.get(id);
  if (known?.isConnected && known.id === id) return known;
  const el = document.getElementById(id);
  if (el) { $els.set(id, el); return el; }
  return known || null;
};
for (const el of document.querySelectorAll('[id]')) $els.set(el.id, el); // every element the page starts with

const INITIAL_CODE = `setcpm(120/4)

drums: stack(
  s("bd*4").bank("RolandTR909").gain(slider(1, 0, 1.2)),
  s("~ cp").bank("RolandTR909").room(slider(0.2, 0, 1)).gain(slider(0.8, 0, 1.2)),
  s("hh*8").bank("RolandTR909").velocity("0.5 1").gain(slider(0.6, 0, 1.2))
).postgain(slider(1, 0, 1.5))

bass: note("<c2 c2 eb2 g1>*8").s("sawtooth")
  .lpf(slider(1200, 200, 4000)).lpq(slider(6, 0, 20))
  .decay(0.15).sustain(0)
  .gain(slider(0.6, 0, 1.2))
`;

export const MAX_FIX_ATTEMPTS = 2;
const HISTORY_LIMIT = 8; // messages kept for context (current code is re-sent every turn anyway)
const OMITTED = '// [older version omitted — always edit the CURRENT CODE]';
/**
 * History as sent to the model: earlier replies keep their wording and a code block (so the
 * model keeps answering in that format) but NOT their old code — otherwise models copy their
 * previous program and ignore manual edits made since.
 */
export function historyForModel() {
  return state.history.slice(-HISTORY_LIMIT).map((m) =>
    m.role === 'assistant'
      ? { ...m, content: m.content.replace(/```[a-zA-Z]*\n[\s\S]*?(```|$)/g, '```javascript\n' + OMITTED + '\n```') }
      : m,
  );
}
export const normCode = (c) => (c || '').replace(/\s+/g, ' ').trim();
export const STORE_KEY = 'strudel-ai:v1';

/**
 * The player's events — the panels listen instead of checking on timers:
 *   'section'   a section (engine step) starts playing       { step }
 *   'song'      another song starts playing                  { song }
 *   'transport' playback started, paused, resumed or stopped { state: 'playing' | 'paused' | 'stopped' }
 *   'songs'     the song lists changed (written, saved, edited, selected …)
 */
export const player = createEmitter();

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
// the settings are read from localStorage once and kept in memory; another tab saving them (or a backup being
// restored) makes this tab read them again
let store = null;
export const load = () => {
  if (!store) { try { store = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { store = {}; } }
  return { ...store };
};
export const save = (patch) => {
  load();
  Object.assign(store, patch);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {}
};
export const forgetStore = () => { store = null; };
window.addEventListener('storage', (e) => { if (e.key === STORE_KEY || e.key === null) forgetStore(); });
export const saved = load();

export const state = {
  history: [],   // chat history sent to the LLM
  versions: [],  // undo stack of code
  busy: false,
  abort: null,
  config: null,
  pending: null, // { at, label, old, oldCode, recEv } — a switch armed for a future cycle
};

// Recorder: every code switch that actually plays, with the cycle it takes effect on.
// A "take" starts when playback starts and ends when it stops. Shared links can carry
// the take so the whole song (AI-generated blocks, edits, mutes, fader moves) replays exactly.
export const rec = { take: null, last: null };
// Live mode: hand edits in the editor are evaluated as you type
export const live = { seen: null, changedAt: 0, applied: null, failed: false };
// True while the visualizer queries the playing pattern (must not trigger switch side effects)
export let vizQuerying = false;

// ---------------------------------------------------------------------------
// Strudel editor
// ---------------------------------------------------------------------------
export const replEl = document.createElement('strudel-editor');
replEl.setAttribute('code', saved.code || INITIAL_CODE);
$('editor-wrap').appendChild(replEl);
export const mirror = () => replEl.editor; // StrudelMirror
export const scheduler = () => mirror()?.repl?.scheduler;

export let lastReplState = {};
replEl.addEventListener('update', (e) => {
  lastReplState = e.detail;
  const err = e.detail.error;
  const bar = $('error-bar');
  if (err) { bar.hidden = false; bar.textContent = '⚠ ' + (err.message || String(err)); }
  else bar.hidden = true;
  if (e.detail.code !== undefined) save({ code: e.detail.code });
});

export const getCode = () => mirror()?.code ?? replEl.getAttribute('code') ?? '';
export const isPlaying = () => !!scheduler()?.started;
export const nowCycle = () => scheduler()?.now() ?? 0;
export const cps = () => scheduler()?.cps ?? 0.5;

// ---------------------------------------------------------------------------
// Autocomplete: Strudel's own completions (every function with its docs and
// examples, chord symbols). Its sound / bank / scale lists are empty in this
// build, so we add a source for those, fed by the sounds actually loaded and
// scales.json. The extra source is slipped into the autocompletion config when
// Strudel enables it (the CodeMirror classes aren't exposed to us directly).
// ---------------------------------------------------------------------------
function moreCompletions(context) {
  const reg = globalThis.soundMap?.get?.() || {};
  const keys = Object.keys(reg);
  const words = (re) => context.matchBefore(re);
  const tail = (m) => (m.text.match(/[\w:#-]*$/) || [''])[0];
  let m = words(/(?:^|[^\w$.])(?:s|sound)\(\s*["'`][^"'`]*$/) || words(/\.(?:s|sound)\(\s*["'`][^"'`]*$/);
  if (m) {
    const frag = tail(m);
    const names = keys.filter((k) => !/_(?!.*_)/.test(k) || k.startsWith('gm_') || reg[k].data?.type !== 'sample');
    const drums = new Set();
    for (const k of keys) { const i = k.lastIndexOf('_'); if (i > 0 && !k.startsWith('gm_') && reg[k].data?.type === 'sample') drums.add(k.slice(i + 1)); }
    const type = (k) => ({ synth: 'synth', soundfont: 'soundfont', sample: 'sample' })[reg[k]?.data?.type] || 'sound';
    return {
      from: m.to - frag.length,
      options: [...names.map((k) => ({ label: k, type: 'text', detail: type(k) })), ...[...drums].filter((d) => !reg[d]).map((d) => ({ label: d, type: 'text', detail: 'drum (use with .bank)' }))],
      validFor: /^[\w-]*$/,
    };
  }
  m = words(/\.bank\(\s*["'`][^"'`]*$/);
  if (m) {
    const frag = tail(m);
    const count = {};
    for (const k of keys) { const i = k.lastIndexOf('_'); if (i > 0 && !k.startsWith('gm_') && reg[k].data?.type === 'sample') count[k.slice(0, i)] = (count[k.slice(0, i)] || 0) + 1; }
    return { from: m.to - frag.length, options: Object.keys(count).filter((b) => count[b] >= 3).map((b) => ({ label: pretty(b), type: 'text', detail: 'drum machine' })), validFor: /^[\w-]*$/ };
  }
  m = words(/\.scale\(\s*["'`][^"'`]*$/);
  if (m && getScales()) {
    const t = (m.text.match(/[A-Ga-g][#b]?\d?:[\w:]*$/) || [''])[0];
    if (!t) return null;
    const colon = t.indexOf(':');
    return {
      from: m.to - (t.length - colon - 1),
      options: getScales().map(([name]) => ({ label: colonScale(name), type: 'text', detail: 'scale' })),
      validFor: /^[\w:]*$/,
    };
  }
  return null;
}

/** Add moreCompletions to every autocompletion config found in a transaction's effects. */
function injectCompletionSource(effects) {
  const seen = new Set();
  const walk = (x, depth) => {
    if (!x || typeof x !== 'object' || seen.has(x) || depth > 8) return;
    seen.add(x);
    if (Array.isArray(x.override) && x.override.some((f) => typeof f === 'function') && !x.override.includes(moreCompletions)) {
      x.override.push(moreCompletions);
    }
    for (const v of Array.isArray(x) ? x : Object.values(x)) walk(v, depth + 1);
  };
  walk(effects, 0);
}

function setAutocomplete(on) {
  const m = mirror();
  const view = m?.editor;
  if (!m?.setAutocompletionEnabled || !view) return false;
  const own = Object.prototype.hasOwnProperty.call(view, 'dispatch');
  const dispatch = view.dispatch;
  view.dispatch = function (...args) {
    try { for (const a of args) injectCompletionSource(a?.effects); } catch {}
    return dispatch.apply(view, args);
  };
  try { m.setAutocompletionEnabled(on); } finally { if (own) view.dispatch = dispatch; else delete view.dispatch; }
  return true;
}
if (saved.autoComplete !== undefined) $('autoComplete').checked = saved.autoComplete;
$('autoComplete').onchange = () => { save({ autoComplete: $('autoComplete').checked }); setAutocomplete($('autoComplete').checked); };
(function waitForEditor(n = 0) {
  if (setAutocomplete($('autoComplete').checked) || n > 100) return;
  setTimeout(() => waitForEditor(n + 1), 200);
})();

// ---------------------------------------------------------------------------
// Quantized switching
//
// The new code is evaluated right away (so errors show immediately), but the
// scheduler gets a *spliced* pattern: haps that start before cycle `at` come
// from the old pattern, haps from `at` onwards from the new one. Tempo changes
// (setcpm/setcps) in the new code are deferred until the switch too.
// The result is a sample-accurate switch exactly on the bar line.
// ---------------------------------------------------------------------------
//
// Crossfade: with fade > 0 both patterns play during [at - fade, at). The old one's
// notes fade out and the new one's fade in (equal power, by note velocity), so the
// new section arrives on the downbeat at full level. Notes both patterns play at the
// same moment (same sound, same pitch) are played once, at full level, so a groove
// shared by both sections doesn't dip.
function splice(oldPat, newPat, at, onCross, fade = 0) {
  const Pattern = newPat.constructor;
  const start = (h) => (h.whole || h.part).begin.valueOf();
  const from = at - fade;
  const inFade = (h) => fade > 0 && start(h) >= from && start(h) < at;
  const pos = (h) => Math.min(1, Math.max(0, (start(h) - from) / fade));
  const key = (h) => {
    const v = h.value;
    return v && typeof v === 'object' ? `${start(h)}|${v.s}|${v.bank}|${v.note}|${v.n}|${v.freq}` : `${start(h)}|${v}`;
  };
  const scale = (h, k) => h.withValue((v) => (v && typeof v === 'object' ? { ...v, velocity: (v.velocity ?? 1) * k } : v));
  let crossed = false;
  return new Pattern((st) => {
    const b = st.span.begin.valueOf();
    const e = st.span.end.valueOf();
    if (e > at && !crossed && !vizQuerying) { crossed = true; onCross?.(); }
    if (e <= from) return oldPat.query(st);
    if (b >= at) return newPat.query(st);
    const olds = oldPat.query(st).filter((h) => start(h) < at);
    const news = newPat.query(st).filter((h) => start(h) >= from);
    const newKeys = new Set(news.filter(inFade).map(key));
    const shared = new Set();
    const out = [];
    for (const h of olds) {
      if (!inFade(h)) { out.push(h); continue; }
      const k = key(h);
      if (newKeys.has(k)) { shared.add(k); out.push(h); continue; }
      out.push(scale(h, Math.cos((pos(h) * Math.PI) / 2)));
    }
    for (const h of news) {
      if (!inFade(h)) { if (start(h) >= at) out.push(h); continue; }
      if (shared.has(key(h))) continue;
      out.push(scale(h, Math.sin((pos(h) * Math.PI) / 2)));
    }
    return out;
  });
}

/**
 * Notes carrying a non-finite number (NaN / Infinity gain, frequency, cutoff …) make the audio engine throw
 * "Failed to set the 'value' property on 'AudioParam'" for every one of them. Drop such notes before they're
 * played, and say once in the console which control and sound produced them.
 */
const nonFiniteSeen = new Set();
const CUTOFF_KEYS = ['cutoff', 'hcutoff', 'bandf'];
function finiteGuard(pat) {
  if (!pat || pat.__finite || typeof pat.query !== 'function') return pat;
  const guarded = new pat.constructor((st) => pat.query(st).map((h) => {
    // a cutoff of 0 or below (e.g. lpf(sine.range(0, 2000))) turns into a non-finite filter value
    const v = h.value;
    if (!v || typeof v !== 'object' || !CUTOFF_KEYS.some((k) => typeof v[k] === 'number' && v[k] < 10)) return h;
    return h.withValue((x) => { const o = { ...x }; for (const k of CUTOFF_KEYS) if (typeof o[k] === 'number' && o[k] < 10) o[k] = 10; return o; });
  }).filter((h) => {
    const v = h.value;
    if (!v || typeof v !== 'object') return true;
    for (const k in v) {
      const x = v[k];
      if (typeof x === 'number' && !Number.isFinite(x)) {
        const id = `${k}|${v.s ?? ''}`;
        if (!nonFiniteSeen.has(id) && !vizQuerying && !inDryRun) {
          nonFiniteSeen.add(id);
          clog('warn', `Skipped notes with an invalid ${k} (${x}) on sound “${v.s ?? '?'}”${v.note != null ? `, note ${v.note}` : ''} — check that part's ${k} value`);
        }
        return false;
      }
    }
    return true;
  }));
  guarded.__finite = true;
  return guarded;
}

/** Next cycle that is a multiple of `every`, leaving enough time to evaluate. */
export function nextBoundary(every) {
  const s = scheduler();
  const leadCycles = 0.06 * cps(); // ~60 ms: time to evaluate + one scheduler tick
  const ahead = Math.max(s.lastEnd ?? 0, nowCycle()) + leadCycles;
  return Math.ceil(ahead / every - 1e-9) * every;
}

/**
 * Query the new pattern a few cycles ahead *without playing it*. Many Strudel
 * errors (bad scale names, bad chord symbols, "can only use X after Y", …)
 * only happen when notes are generated, not when the code is evaluated.
 */
export let inDryRun = false;
/** The visualizer queries the playing pattern: errors meanwhile are the playing code's, already reported. */
export function setPatternQuery(on, prevDry = false) { vizQuerying = on; inDryRun = on ? true : prevDry; }
// Strudel errors while new code is test-played are expected (that's what the test is for): the debug log marks them
Object.defineProperty(debugState, 'testPlaying', { get: () => inDryRun });
export const recentDryRunErrors = new Map(); // message → time, to avoid reporting the same error twice
export function dryRun(pat) {
  const c = Math.floor(nowCycle());
  const logged = [];
  const onLog = (e) => {
    const msg = String(e.detail?.message || '');
    if (e.detail?.type === 'error' || /\berror\b/i.test(msg)) logged.push(msg.replace(/^\[\w+\] error: /, ''));
  };
  // Strudel's logger drops a message identical to the previous one within 1 s — log a marker so real errors get through
  try { globalThis.logger?.('[strudel-ai] test-playing new code…'); } catch {}
  document.addEventListener('strudel.log', onLog);
  inDryRun = true;
  const reg = globalThis.soundMap?.get?.();
  const missing = new Map(); // what isn't loaded → hint
  try {
    for (const [a, b] of [[c, c + 8], [0, 2]]) {
      for (const h of pat.queryArc(a, b)) {
        const v = h.value;
        if (v && typeof v === 'object') {
          if (typeof v.note === 'number' && !Number.isFinite(v.note)) throw new Error(`invalid note value (NaN) in "${v.s ?? ''}" part`);
          if (typeof v.note === 'string' && /undefined|NaN/.test(v.note)) throw new Error(`invalid note "${v.note}"`);
          // the exact sound the engine will look up — a drum name must exist in the chosen drum machine
          if (reg && typeof v.s === 'string' && v.s) {
            const key = (v.bank ? `${v.bank}_${v.s}` : v.s).toLowerCase();
            if (!reg[key] && !missing.has(key)) missing.set(key, soundHint(reg, v.s, v.bank));
          }
        }
      }
    }
    if (missing.size) logged.push(`these sounds don't exist: ${[...missing.values()].join('; ')}`);
    if (logged.length) for (const m of logged) recentDryRunErrors.set(m, performance.now());
    return logged.length ? new Error([...new Set(logged)].join('; ')) : null;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  } finally {
    inDryRun = false;
    document.removeEventListener('strudel.log', onLog);
  }
}

/** Explain a missing sound: for a drum machine, list the drums it does have. */
function soundHint(reg, s, bank) {
  if (bank) {
    const pre = String(bank).toLowerCase() + '_';
    const drums = Object.keys(reg).filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length));
    return drums.length
      ? `"${s}" is not in the drum machine "${bank}" (it has: ${drums.slice(0, 24).join(' ')})`
      : `the drum machine "${bank}" doesn't exist`;
  }
  return `"${s}"`;
}

/**
 * Evaluate `code`. at === null → immediately. Otherwise switch exactly at cycle `at`.
 * The new pattern is test-queried first; if that fails, the old music keeps playing.
 * Returns the error (or null).
 */
export async function evaluateCode(code, { at = null, label = '', undo = true, fade = 0 } = {}) {
  const m = mirror();
  if (!m) return new Error('editor not ready');
  const sch = m.repl.scheduler;
  const prevCode = getCode();
  if (undo && prevCode.trim() !== code.trim()) {
    state.versions.push(prevCode);
    $('undo').disabled = false;
  }
  m.setCode(code);
  live.applied = code;

  const immediate = at === null || !sch.started || !sch.pattern;
  const old = sch.pattern;
  const proto = Object.getPrototypeOf(sch);
  const wasStarted = sch.started;
  const hadOwnSet = Object.prototype.hasOwnProperty.call(sch, 'setPattern');
  const ownSet = sch.setPattern; // the recorder's hook (restored afterwards)
  let captured = null, autostart = true, deferredCps = null;
  sch.setCps = (c) => { deferredCps = c; };
  sch.setPattern = async (pat, auto) => {
    captured = finiteGuard(pat);
    autostart = auto;
    // the editor's highlighter queries scheduler.pattern after evaluating – give it something harmless
    if (!sch.pattern) sch.pattern = new pat.constructor(() => []);
  };
  window.__mixerTrap?.(); // mixer EQ: route parts to their own orbit
  window.__masterInstall?.(); // 🎛 master style on the whole mix
  try {
    await m.evaluate();
  } finally {
    delete sch.setCps;
    if (hadOwnSet) sch.setPattern = ownSet; else delete sch.setPattern;
  }
  const evalErr = m.repl.state.evalError;
  if (evalErr) return evalErr;
  if (!captured) return null;

  const runErr = dryRun(captured);
  if (runErr) {
    const bar = $('error-bar');
    bar.hidden = false;
    bar.textContent = '⚠ not applied (old code keeps playing): ' + runErr.message;
    return runErr;
  }

  if (immediate) {
    cancelPending(false);
    const c = wasStarted ? switchCycle(sch) : 0;
    if (deferredCps != null) proto.setCps.call(sch, deferredCps);
    await proto.setPattern.call(sch, captured, autostart);
    recordSwitch(code, c, label);
    return null;
  }
  // only fade over what hasn't been scheduled yet
  const f = Math.max(0, Math.min(fade, at - switchCycle(sch) - 0.03));
  await proto.setPattern.call(
    sch,
    splice(old, captured, at, () => {
      if (deferredCps != null) setTimeout(() => proto.setCps.call(sch, deferredCps));
      if (state.pending?.at === at) setTimeout(() => { state.pending = null; });
    }, f),
    autostart,
  );
  state.pending = { at, label, old, oldCode: prevCode, recEv: recordSwitch(code, at, label, f) };
  return null;
}

/** Undo an armed switch that has not happened yet. */
export function cancelPending(restore = true) {
  const p = state.pending;
  state.pending = null;
  if (!p) return;
  const sch = scheduler();
  const notYet = sch && Math.max(sch.lastEnd ?? 0, nowCycle()) < p.at;
  // the armed code never plays → it isn't part of the recording
  if (notYet && p.recEv && rec.take) rec.take.events = rec.take.events.filter((ev) => ev !== p.recEv);
  if (!restore) return;
  if (sch && nowCycle() < p.at) {
    Object.getPrototypeOf(sch).setPattern.call(sch, p.old);
    mirror().setCode(p.oldCode);
    state.versions.pop();
    $('undo').disabled = state.versions.length === 0;
  }
}

const quantize = () => Number($('quantize').value);
/** Crossfade length in cycles for bar-line switches (0 = hard cut). */
/**
 * The crossfade in bars (cycles). The beat options (1 or 2 beats) follow the meter of the song that is
 * switching in: a beat is ¼ bar in 4/4, ⅓ bar in 3/4, ½ bar in 6/8.
 */
export const fadeCycles = (song = queue.songs[queue.current]) => {
  const v = Number($('fade').value);
  return v > 0 && v < 1 ? (v * 4) / meterBeats(songMeter(song)) : v;
};
/** One beat of the playing song, in bars. */
export const beatCycles = () => 1 / meterBeats(songMeter(queue.songs[queue.current]));

/** Apply code using the current quantize setting. */
export function applyQuantized(code, label) {
  const q = quantize();
  const at = q > 0 && isPlaying() ? nextBoundary(q) : null;
  return evaluateCode(code, { at, label, fade: fadeCycles() });
}

$('play').onclick = async () => {
  if (engine.paused) return resumeSong();
  cancelPending(false);
  const err = await evaluateCode(getCode());
  if (err) addMsg('error', `Not applied: ${err.message}`);
};
$('stop').onclick = () => { stopReplay(); mp3TakeEnd(false); cancelPending(false); stopSet?.(); stopSetlist(); mirror()?.stop(); if (upd.available) setTimeout(reloadForUpdate, 300); };
$('undo').onclick = async () => {
  cancelPending(false);
  const prev = state.versions.pop();
  if (prev === undefined) return;
  mirror().setCode(prev);
  $('undo').disabled = state.versions.length === 0;
  await mirror().evaluate();
  addMsg('info', '↶ reverted to previous version');
};
$('quantize').value = saved.quantize ?? '4';
$('quantize').onchange = () => save({ quantize: $('quantize').value });
$('fade').value = saved.fade ?? '0.5';
$('fade').onchange = () => save({ fade: $('fade').value });

// Header clock: cycle / bar counter + countdown to armed switch
let transportWas = false; // for the 'transport' event: was it playing at the last tick?
setInterval(() => {
  const st = $('status');
  const err = lastReplState.error;
  if (!isPlaying()) {
    st.textContent = err ? 'error' : 'stopped';
    st.className = 'status ' + (err ? 'error' : '');
  } else {
    const c = nowCycle();
    const bar = Math.floor(c) + 1;
    // beats follow the playing song's meter (4/4 for your own code)
    const meter = queue.running ? songMeter(queue.songs[queue.current]) : '4/4', beats = meterBeats(meter);
    const beat = Math.floor((c % 1) * beats) + 1;
    st.textContent = `bar ${bar}.${beat}  ${Math.round(cps() * 60 * beats)}bpm${meter === '4/4' ? '' : ` ${meter}`}`;
    st.className = 'status ' + (err ? 'error' : 'playing');
  }
  const p = state.pending;
  const pb = $('pending');
  if (p && isPlaying() && nowCycle() < p.at) {
    const secs = Math.max(0, (p.at - nowCycle()) / cps());
    pb.hidden = false;
    pb.textContent = `⏱ ${p.label || 'next change'} at ${barBeat(p.at)} (${secs.toFixed(1)}s)`;
  } else pb.hidden = true;
  try { updateStepStates(); } catch {} // the page is still loading (the engine isn't defined yet)
  // playback started or stopped (by any means: ▶, ■, the editor, the end of a song)
  const playingNow = isPlaying();
  if (playingNow !== transportWas) {
    transportWas = playingNow;
    try { player.emit('transport', { state: playingNow ? 'playing' : engine.paused ? 'paused' : 'stopped' }); } catch {}
  }
}, 100);
$('pending').onclick = () => { cancelPending(true); addMsg('info', 'pending change cancelled'); };

// ---------------------------------------------------------------------------
// Recorder: each take is the list of code switches with the cycle each one took
// effect on. Replaying a take (e.g. from a share link) re-applies every switch on
// exactly the same cycle, starting from cycle 0 like the original, so Strudel's
// cycle-based randomness comes out the same too.
// ---------------------------------------------------------------------------
/** Cycle from which a pattern set right now is heard (haps up to lastEnd are already scheduled). */
export function switchCycle(sch = scheduler()) {
  return Math.max(sch?.lastEnd ?? 0, nowCycle());
}

const MAX_TAKE_EVENTS = 3000;
function recordSwitch(code, cycle, label = '', fade = 0) {
  if (!isPlaying() || !code?.trim()) return null;
  if (!rec.take) rec.take = { events: [], started: Date.now(), end: 0 };
  const evs = rec.take.events;
  if (evs.length >= MAX_TAKE_EVENTS) return null;
  const ev = { c: Math.round(cycle * 1e6) / 1e6, code, label: String(label || '').slice(0, 80), fade: fade || 0 };
  // keep time order: an armed switch can be recorded before an earlier immediate one
  let k = evs.length;
  while (k > 0 && evs[k - 1].c > ev.c) k--;
  if (k > 0 && evs[k - 1].code === code) return null; // re-evaluating the same code changes nothing
  evs.splice(k, 0, ev);
  return ev;
}

/** Ctrl+Enter, ↶ Undo and Strudel's own buttons set the pattern directly — record those too. */
function installRecorderHook() {
  const sch = scheduler();
  if (!sch || sch.__recHook) return;
  sch.__recHook = true;
  const proto = Object.getPrototypeOf(sch);
  sch.setPattern = async function (pat, auto) {
    const c = this.started ? switchCycle(this) : 0;
    const r = await proto.setPattern.call(this, finiteGuard(pat), auto);
    live.applied = getCode();
    recordSwitch(getCode(), c, 'edit');
    return r;
  };
}

function pollEditor() {
  installRecorderHook();
  const code = getCode();
  const t = performance.now();
  if (code !== live.seen) { live.seen = code; live.changedAt = t; }
  if (!isPlaying()) {
    if (rec.take) { if (rec.take.events.length) rec.last = rec.take; rec.take = null; }
    return;
  }
  if (rec.take) rec.take.end = Math.max(rec.take.end, nowCycle());

  // dragging a fader rewrites its number in the code without re-evaluating → record as a tweak
  const lastEv = rec.take?.events[rec.take.events.length - 1];
  if (lastEv && !state.pending && code !== lastEv.code && sliderless(code) === sliderless(lastEv.code)) {
    const c = nowCycle();
    if (lastEv.label === 'fader' && c - lastEv.c < 0.25) lastEv.code = code; // coalesce a drag
    else recordSwitch(code, c, 'fader');
    live.applied = code;
  }

  // live mode: evaluate hand edits shortly after you stop typing
  if (!$('liveMode').checked || state.pending || t - live.changedAt < 400) return;
  if (live.applied === null) { live.applied = code; return; }
  if (code === live.applied) return;
  if (sliderless(code) === sliderless(live.applied)) { live.applied = code; return; } // faders are live already
  live.applied = code;
  const bad = syntaxError(code);
  if (bad) { setLiveState(`syntax error — keeps playing the last good version: ${bad}`); return; }
  live.evalAt = t;
  evaluateCode(code, { label: 'live edit', undo: false }).then((err) => setLiveState(err ? err.message : null));
}
setInterval(pollEditor, 150);

function setLiveState(err) {
  const l = $('liveLabel');
  l.classList.toggle('bad', !!err);
  l.title = err ? `Live update: ${err}` : 'Live update: edits in the code window take effect as soon as you stop typing';
}
if (saved.liveMode !== undefined) $('liveMode').checked = saved.liveMode;
$('liveMode').onchange = () => {
  save({ liveMode: $('liveMode').checked });
  live.applied = getCode(); // only edits made from now on
  setLiveState(null);
};

/** The current (or last) take in the compact share format: unique codes + timed events. */
export function recordingForShare() {
  const take = rec.take?.events.length ? rec.take : rec.last;
  if (!take?.events.length) return null;
  const c0 = take.events[0].c;
  const codes = [], index = new Map();
  const events = take.events.map((ev) => {
    let i = index.get(ev.code);
    if (i === undefined) { i = codes.push(ev.code) - 1; index.set(ev.code, i); }
    return { c: Math.round((ev.c - c0) * 1e6) / 1e6, i, label: ev.label, ...(ev.fade ? { f: ev.fade } : {}) };
  });
  return { v: 1, codes, events, end: Math.max(0, Math.round((take.end - c0) * 1e3) / 1e3) };
}
/** Expand a shared recording back into { events: [{c, code, label}], end }, or null if malformed. */
export function decodeRecording(r) {
  if (!r || !Array.isArray(r.codes) || !Array.isArray(r.events) || !r.events.length) return null;
  const events = r.events
    .filter((ev) => Number.isFinite(ev.c) && typeof r.codes[ev.i] === 'string')
    .map((ev) => ({ c: ev.c, code: r.codes[ev.i], label: String(ev.label || ''), fade: Number(ev.f) || 0 }))
    .sort((a, b) => a.c - b.c);
  return events.length ? { events, end: Number(r.end) || events[events.length - 1].c } : null;
}
export const fmtTime = (secs) => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`;
/** Rough length of a take in seconds (uses each switch's tempo). */
export function takeSeconds(take) {
  let secs = 0;
  const evs = take.events;
  for (let k = 0; k < evs.length; k++) {
    const from = evs[k].c, to = k + 1 < evs.length ? evs[k + 1].c : Math.max(take.end, from);
    secs += (to - from) / codeCps(evs[k].code);
  }
  return secs;
}
function codeCps(code) {
  const m = code.match(/setcp([ms])\(\s*([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)/);
  if (!m) return cps() || 0.5;
  const v = Number(m[2]) / (m[3] ? Number(m[3]) : 1);
  return (m[1] === 'm' ? v / 60 : v) || 0.5;
}

// --- replay
const replay = { running: false, events: [], i: 0, end: 0, timer: null, title: '' };

export async function startReplay(take, title = '') {
  if (!take?.events.length) return;
  stopReplay();
  stopSet?.();
  stopSetlist();
  cancelPending(false);
  // start from cycle 0 like the original take, so every switch lands on the same cycle
  if (isPlaying()) { mirror()?.stop(); await new Promise((r) => setTimeout(r, 200)); }
  addMsg('info', `⏺ replaying ${title ? `“${title}” ` : ''}— ${take.events.length} change${take.events.length > 1 ? 's' : ''}, ${fmtTime(takeSeconds(take))}`);
  await preloadSoundfonts(take.events.map((ev) => ev.code).join('\n')).catch(() => {});
  Object.assign(replay, { running: true, events: take.events, i: 1, end: take.end, title });
  const err = await evaluateCode(take.events[0].code, { label: 'replay' });
  if (err) { addMsg('error', `Replay failed: ${err.message}`); replay.running = false; return; }
  replay.timer = setInterval(tickReplay, 50);
  $('replayBtn').hidden = false;
}

function tickReplay() {
  if (!replay.running || replay.busy) return;
  if (!isPlaying()) { stopReplay(); addMsg('info', '■ replay stopped'); return; }
  const now = nowCycle();
  const ev = replay.events[replay.i];
  if (!ev) {
    if (now >= replay.end) {
      stopReplay();
      mirror()?.stop();
      addMsg('info', `■ replay finished${replay.title ? ` — “${replay.title}”` : ''}`);
    }
    return;
  }
  if ((ev.c - (ev.fade || 0) - now) / cps() > 1) return; // arm about a second before the change (or its crossfade)
  replay.busy = true;
  const at = Math.max(ev.c, switchCycle() + 0.06 * cps());
  evaluateCode(ev.code, { at, label: `replay ${replay.i + 1}/${replay.events.length}`, undo: false, fade: ev.fade || 0 })
    .then((err) => { if (err) addMsg('error', `Replay: change ${replay.i + 1} failed: ${err.message}`); })
    .finally(() => { replay.i++; replay.busy = false; });
}

function stopReplay() {
  if (!replay.running) return;
  replay.running = false;
  clearInterval(replay.timer);
  $('replayBtn').hidden = true;
}
$('replayBtn').onclick = () => { stopReplay(); addMsg('info', '■ replay stopped — the music keeps playing'); };

// ---------------------------------------------------------------------------
// Provider / model selection
// ---------------------------------------------------------------------------
async function loadConfig() {
  state.config = await fetch('/api/config').then((r) => r.json());
  const sel = $('provider');
  renderOptions(sel, Object.entries(state.config.providers).map(([key, p]) => ({ value: key, label: p.label })),
    saved.provider && state.config.providers[saved.provider] ? saved.provider : state.config.defaultProvider);
  await loadModels();
}

function renderProviderControls() {
  const claude = state.config?.providers?.[$('provider').value]?.kind === 'anthropic';
  $('effortRow').hidden = !claude;
  $('tempRow').hidden = claude;
}

async function loadModels() {
  const provider = $('provider').value;
  const pcfg = state.config.providers[provider];
  renderProviderControls();
  if (pcfg.kind === 'anthropic') $('claudeEffort').value = load().claudeEffort || pcfg.defaultEffort || 'low';
  const sel = $('model');
  renderOptions(sel, [{ value: '', label: 'loading…' }]);
  try {
    const r = await fetch(`/api/models?provider=${provider}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    const want = load().models?.[provider] || pcfg.defaultModel;
    renderOptions(sel, j.models.length ? j.models.map((m) => ({ value: m.id, label: m.name })) : [{ value: '', label: '(default)' }],
      want && j.models.some((m) => m.id === want) ? want : j.models[0]?.id ?? '');
  } catch (e) {
    renderOptions(sel, [{ value: pcfg.defaultModel || '', label: pcfg.defaultModel || '(default)' }], pcfg.defaultModel || '');
    warnUser(`Model list unavailable (⚙ Settings → AI): ${e.message}`);
  }
}

$('provider').onchange = () => { save({ provider: $('provider').value }); loadModels(); };
$('model').onchange = () => save({ models: { ...(load().models || {}), [$('provider').value]: $('model').value } });
$('refresh').onclick = loadModels;

for (const id of ['autoApply', 'autoFix']) {
  if (saved[id] !== undefined) $(id).checked = saved[id];
  $(id).onchange = () => save({ [id]: $(id).checked });
}
if (saved.temp !== undefined) $('temp').value = saved.temp;
$('tempVal').textContent = $('temp').value;
$('temp').oninput = () => { $('tempVal').textContent = $('temp').value; save({ temp: $('temp').value }); };

// ---------------------------------------------------------------------------
// Workspace: the code editor, chat, songs, station, now playing and the tool docks are dockview panels that tab
// together, split anywhere, float or pop out into their own window (see workspace.js).
// ---------------------------------------------------------------------------
const PANELS = [
  { id: 'chat', title: 'Chat', icon: '💬', el: $('chatTab'), area: 'right' },
  { id: 'songs', title: 'Songs', icon: '🎵', el: $('setTab'), area: 'right' },
  { id: 'station', title: 'Station', icon: '📻', el: $('stationTab'), area: 'right' },
  { id: 'playlist', title: 'Playlist', icon: '📃', el: $('playlistPanel'), area: 'right' },
  { id: 'song', title: 'Now playing', icon: '🎶', el: $('songPanel'), area: 'right' },
  { id: 'edit', title: 'Edit song', icon: '✎', el: $('editPanel'), area: 'right' },
  { id: 'viz', title: 'Visualizer', icon: '📊', el: $('viz-dock'), area: 'bottom' },
  { id: 'hydra', title: 'Hydra', icon: '🌀', el: $('hydra-dock'), area: 'bottom' },
  { id: 'keys', title: 'Keys', icon: '🎹', el: $('keys-dock'), area: 'bottom' },
  { id: 'pads', title: 'Pads', icon: '🔲', el: $('pads-dock'), area: 'bottom' },
  { id: 'mixer', title: 'Mixer', icon: '🎚', el: $('mixer-dock'), area: 'bottom' },
  { id: 'master', title: 'Master', icon: '🎛', el: $('master-dock'), area: 'bottom' },
  { id: 'console', title: 'Console', icon: '🖥', el: $('console-dock'), area: 'bottom' },
];
export let ws;
try {
  // each mode (📻 Radio · 🎼 Studio · ⌨ Jam) has its own layout (features/modes.js); layouts saved before modes are Radio's
  const mode = currentMode();
  document.body.dataset.mode = mode;
  ws = createWorkspace({
    dv: await loadDockview(), root: $('workspace'), center: document.querySelector('#workspace .ws-center'), panels: PANELS,
    saved: saved.panelLayouts?.[mode] || (mode === 'radio' ? saved.panelLayout : null) || null, preset: MODES[mode].preset,
    onSave: (layout) => save({ panelLayouts: { ...(load().panelLayouts || {}), [currentMode()]: layout } }),
  });
} catch (e) {
  const msg = document.createElement('div');
  msg.className = 'fatal';
  msg.textContent = `The panel layout could not be loaded (${e.message || e}). Reload the page; if it keeps failing, check that the server serves /vendor/dockview/.`;
  document.body.prepend(msg);
  throw e;
}
// The page is a fixed app frame: nothing outside the panels may scroll. Focusing an input or the editor bringing its
// cursor into view can still scroll the window (or the workspace) programmatically, pushing everything off the top:
// put them straight back.
{
  const frames = () => [document.scrollingElement, document.documentElement, document.body, $('workspace'), $('workspace').querySelector('.dv-host')];
  const unscroll = (e) => {
    const t = e.target === document ? document.scrollingElement : e.target;
    if (!frames().includes(t)) return;
    if (t.scrollTop || t.scrollLeft) { t.scrollTop = 0; t.scrollLeft = 0; }
  };
  document.addEventListener('scroll', unscroll, true);
  window.addEventListener('scroll', () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); });
}
// layouts saved before the 📃 Playlist existed: add it once, as a tab beside Chat / Songs / Station
if (currentMode() === 'radio' && !ws.isOpen('playlist') && !saved.playlistAdded) ws.open('playlist', { activate: false });
save({ playlistAdded: true });
/** Bring a panel to the front (opening it if it's closed). */
export const showPanel = (id) => ws.open(id);
// the ▦ Panels menu: open / close any panel, reset the layout
function renderLayoutMenu() {
  render(T.layoutMenu(ws.panels()), $('layoutMenu'));
}
$('layoutBtn').onclick = (e) => {
  e.stopPropagation();
  renderLayoutMenu();
  const m = $('layoutMenu');
  m.hidden = !m.hidden;
  // open towards the side with room
  const r = $('layoutBtn').getBoundingClientRect();
  Object.assign(m.style, r.left + 260 > innerWidth ? { left: 'auto', right: '0' } : { left: '0', right: 'auto' });
};
$('layoutMenu').addEventListener('change', (e) => { const id = e.target.dataset.panel; if (id) e.target.checked ? ws.open(id) : ws.close(id); });
$('layoutMenu').addEventListener('click', (e) => { if (e.target.id === 'layoutReset') { ws.reset(); renderLayoutMenu(); } e.stopPropagation(); });
document.addEventListener('click', () => { $('layoutMenu').hidden = true; });

// ---------------------------------------------------------------------------
// Chat rendering
// ---------------------------------------------------------------------------

export function renderMarkdownLite(text) {
  return text
    .split(/```[a-zA-Z]*\n?/)
    .map((p, i) => (i % 2 ? `<pre>${esc(p.replace(/\n$/, ''))}</pre>` : esc(p).replace(/\n/g, '<br>')))
    .join('');
}

export function addMsg(role, html, { raw = false } = {}) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  if (raw) div.innerHTML = html; else div.textContent = html;
  $('messages').appendChild(div);
  scrollChat();
  return div;
}
/**
 * Tail a scrolling log: it follows new content (stays at the bottom) unless you scroll up to read;
 * scrolling back to the bottom resumes following.
 */
function tail(el) {
  el.__follow = true;
  const toBottom = () => { if (el.__follow) el.scrollTop = el.scrollHeight; };
  el.addEventListener('scroll', () => { el.__follow = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }, { passive: true });
  new MutationObserver(toBottom).observe(el, { childList: true, subtree: true, characterData: true });
  new ResizeObserver(toBottom).observe(el);
}
tail($('messages'));
tail($('consoleLog'));
export const scrollChat = () => { const m = $('messages'); m.__follow = true; m.scrollTop = m.scrollHeight; };

// ---------------------------------------------------------------------------
// 🖥 Console: a running log of what happens behind the scenes — every AI request
// (with its text streaming in), the checks and automatic fixes, retries and errors.
// Intermediate problems go here; the chat only gets the final outcome.
// ---------------------------------------------------------------------------
const CONSOLE_MAX = 400;
/**
 * A problem the app couldn't resolve (AI errors after retries, budget, …): it goes to the console,
 * and the status bar shows ⚠ with the message as its tooltip — never into the chat or the page.
 */
export function warnUser(msg) {
  clog('error', msg);
  const w = $('sbWarn');
  w.hidden = false;
  w.title = `${msg}\n(click to open the 🖥 Console)`;
  w.dataset.count = String(Number(w.dataset.count || 0) + 1);
  w.textContent = `⚠ ${w.dataset.count}`;
}
/** Add a console line. kind: ai | ok | fix | warn | error | info. Returns { set(text), done(text, kind) }. */
export function clog(kind, text) {
  const log = $('consoleLog');
  const row = document.createElement('div');
  row.className = `con-row ${kind}`;
  const time = document.createElement('span');
  time.className = 'con-time';
  time.textContent = new Date().toTimeString().slice(0, 8);
  const body = document.createElement('span');
  body.className = 'con-text';
  body.textContent = text;
  row.append(time, body);
  log.appendChild(row); // (the log is tailed: it stays at the bottom unless you scroll up)
  while (log.childElementCount > CONSOLE_MAX) log.firstElementChild.remove();
  const entry = dlog(kind, text, 'console'); // 🐞 the debug log keeps everything (the panel only the last 400)
  let stream = null;
  return {
    stream(t) {
      if (!$('consoleStream').checked) return;
      if (!stream) { stream = document.createElement('pre'); stream.className = 'con-stream'; row.appendChild(stream); tail(stream); }
      stream.textContent = t.length > 4000 ? '…' + t.slice(-4000) : t;
    },
    done(t, k) {
      if (t) { body.textContent = t; entry.text = t; }
      if (k) { row.className = `con-row ${k}`; entry.kind = k; }
    },
  };
}
$('consoleClear').onclick = () => { $('consoleLog').innerHTML = ''; };
$('consoleDownload').onclick = () => downloadDebugLog();
if (load().consoleStream !== undefined) $('consoleStream').checked = load().consoleStream;
$('consoleStream').onchange = () => save({ consoleStream: $('consoleStream').checked });

$('clearChat').onclick = () => {
  state.history = [];
  $('messages').querySelectorAll('.msg:not(.system)').forEach((n) => n.remove());
};

setup_llm(); // features/llm.js
setup_sound_check(); // features/sound-check.js
setup_chat(); // features/chat.js
// ---------------------------------------------------------------------------
// Setlist: a list of timed changes. Code for each step is generated ahead of
// time (each step builds on the previous step's code) and each step is
// switched in exactly on its bar.
// ---------------------------------------------------------------------------

export const engine = {
  running: false,
  steps: [],     // { bars, prompt, code, status, error }
  genIndex: 0,   // next step to generate
  playIndex: 0,  // next step to switch in
  nextAt: null,  // cycle at which playIndex should start
  abort: null,
  timer: null,
  generating: false,
  jumpTarget: null, // step index the user picked manually (switches on next boundary)
  feeder: null,     // Set list / Station driving the blocks: { active(), onStepStart(step), onStop(), label }
  pumpToken: 0,     // bumped to restart generation from another block
};

// Added to every block after a song's first one, so sections don't only pile up layers
const SECTION_GUIDE =
  'Follow the section instruction literally. When it says to drop, remove, strip back or take out something, DELETE that ' +
  'group or line from the code (do not just turn it down). A section may remove parts as well as add them: keep about ' +
  '5 groups or fewer, and when you add a part consider taking another one out. When the section calls for a change of ' +
  'energy or feel, switch up the beat: rewrite the drum patterns (kick placement, hat rhythm, swing, half-time, broken ' +
  'beat, fills) instead of only stacking new layers on the same groove.';
const autoAdvance = () => !engine.hold;

async function generateStep(i) {
  const step = engine.steps[i];
  if (step.song?.library && step.section) {
    // a section of a sheet song: fix the shared parts, then it is re-arranged
    step.status = 'generating';
    await repairSong(step.song, step.fixHint || step.error || 'it failed when played');
    delete step.fixHint;
    if (!step.code) throw new Error('could not fix the parts');
    step.status = 'ready';
    return;
  }
  const base = (i > 0 && engine.steps[i - 1].code) || getCode();
  step.status = 'generating';
  let prompt;
  if (step.song) {
    const sg = step.song;
    prompt = step.songStart
      ? `NEW SONG "${sg.title}": ${sg.desc}\n` +
        'This block STARTS a new song. Write a fresh arrangement for it — its own tempo (setcpm), key, groups and sounds. ' +
        'Do not keep the previous song\'s parts (a smooth transition is fine). Use named groups and slider() faders as usual.\n' +
        `First section (${step.bars} bars): ${step.prompt}`
      : `Song "${sg.title}" (${sg.desc})\nNext section, ${step.bars} bars (section ${step.songPos + 1} of ${step.songLen}): ${step.prompt}\n\n${SECTION_GUIDE}`;
  } else {
    prompt = `${step.prompt}\n(This section lasts ${step.bars} bars. It is step ${i + 1} of ${engine.steps.length} in a planned set.)` +
      (i > 0 ? `\n\n${SECTION_GUIDE}` : '');
  }
  if (step.fixHint) {
    prompt += `\n\nIMPORTANT: a previous version failed when played: ${step.fixHint}` +
      (/scale/i.test(step.fixHint) ? `\n${scaleHelp()}` : '');
    delete step.fixHint;
  }
  // a section that failed when it was about to play is fixed from its own failed code
  let fixCode = step.failedCode || null;
  delete step.failedCode;
  for (let attempt = 0; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
    const text = await requestLLM({
      messages: [{ role: 'user', content: prompt }],
      code: fixCode ?? base,
      fixing: fixCode != null,
      signal: step.abort.signal,
      label: `block ${i + 1}${fixCode ? ' fix' : ''}`,
    });
    let code = extractCode(text);
    let err = code ? syntaxError(code) : 'no code block in reply';
    if (!err) {
      const prep = await prepareCode(code, { quiet: true });
      code = prep.code;
      err = prep.error;
    }
    if (!err) {
      step.code = code;
      step.status = 'ready';
      return;
    }
    if (code) fixCode = code; // fix the attempt itself next time
    prompt = `${step.prompt}\n\nIMPORTANT: a previous attempt failed (${err}). Return the COMPLETE, syntactically valid program in one \`\`\`javascript block.`;
  }
  step.status = 'failed';
  step.error = 'could not get valid code';
}

/** Generate step i once (shared promise), falling back to the previous code on failure. */
function ensureGenerated(i) {
  const step = engine.steps[i];
  if (!step) return Promise.resolve();
  if (step.code) return Promise.resolve();
  if (!step.genPromise) {
    // own abort controller, so skipping past this block can cancel just this request
    step.abort = new AbortController();
    const all = engine.abort?.signal;
    if (all?.aborted) step.abort.abort();
    else all?.addEventListener('abort', () => step.abort.abort(), { once: true });
    step.genPromise = generateStep(i)
      .catch((e) => {
        if (e.name === 'AbortError') throw e;
        step.status = 'failed';
        step.error = e.message;
      })
      .then(() => {
        if (step.status === 'failed' && !step.code) {
          // reuse previous code so the set keeps going
          step.code = (i > 0 && engine.steps[i - 1].code) || getCode();
        }
      })
      .finally(() => { delete step.genPromise; });
  }
  return step.genPromise;
}

async function pumpGeneration() {
  if (engine.generating) return;
  engine.generating = true;
  const token = engine.pumpToken;
  try {
    while (engine.running && token === engine.pumpToken && engine.genIndex < engine.steps.length) {
      try {
        await ensureGenerated(engine.genIndex);
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
      if (token !== engine.pumpToken) return; // restarted from another block meanwhile
      engine.genIndex++;
    }
  } finally {
    if (token === engine.pumpToken) engine.generating = false;
  }
}

/** Generate blocks in order starting at block `from` (a running loop elsewhere stops). */
function restartGeneration(from) {
  engine.pumpToken++;
  engine.generating = false;
  engine.genIndex = Math.max(0, from);
  pumpGeneration();
}

/** Skipping ahead to block i: blocks above it that have no code yet are not written any more. */
function skipBlocksBefore(i) {
  let n = 0;
  engine.steps.forEach((s, j) => {
    if (j >= i || s.code || !['waiting', 'generating'].includes(s.status)) return;
    s.abort?.abort();
    s.status = 'skipped';
    n++;
  });
  return n;
}

/** Manually switch to step i (on the next "switch on" boundary). */
export function jumpTo(i) {
  if (!engine.running || !engine.steps[i]) return;
  // cancel a step that is armed but hasn't started yet
  for (const s of engine.steps) {
    if (s.status === 'armed' && s.startedAt !== undefined && nowCycle() < s.startedAt) {
      cancelPending(true);
      s.status = s.code ? 'ready' : 'waiting';
      delete s.startedAt;
    }
  }
  const target = engine.steps[i];
  if (target.status === 'done' || target.status === 'playing') target.status = 'ready';
  if (target.status === 'skipped') target.status = 'waiting';
  delete target.startedAt;
  engine.jumpTarget = i;
  engine.playIndex = i;
  engine.nextAt = null; // → next quantize boundary
  // stop writing the blocks above this one and generate from here on
  const skipped = skipBlocksBefore(i);
  restartGeneration(i);
  if (!target.code) {
    addMsg('info', `⏭ section ${i + 1} is being generated${skipped ? ` (skipping ${skipped} unwritten block${skipped > 1 ? 's' : ''} before it)` : ''} — it will switch in as soon as it's ready`);
  }
  songsChanged();
}

async function tickSetlist() {
  if (!engine.running || engine.paused) return;
  // manual mode: only move when the user picked a section
  if (!autoAdvance() && engine.jumpTarget === null) return;
  const i = engine.playIndex;
  if (i >= engine.steps.length && engine.feeder?.active()) return; // more blocks are on their way
  if (i >= engine.steps.length) {
    if (!autoAdvance()) {
      engine.jumpTarget = null; // manual mode: keep holding the last section
      return;
    } else {
      // let the last step play out its bars before declaring the set finished
      if (engine.nextAt != null && isPlaying() && nowCycle() < engine.nextAt) return;
      addMsg('info', `■ ${engine.feeder?.label || 'song blocks'} finished`);
      stopSetlist();
      // the last section has played out: stop (sounds already scheduled still ring out)
      mirror()?.stop();
      setTimeout(mp3TakeEnd, 1500); // let the tail ring out into the recording
      return;
    }
  }
  const step = engine.steps[engine.playIndex];
  if (!step?.code || step.status === 'armed') return;
  if (!isPlaying()) {
    // nothing playing yet → start with the first ready step immediately
    step.status = 'armed';
    await evaluateCode(atSectionStart(step.code, 0), { label: `block ${engine.playIndex + 1}` });
    step.startedAt = 0;
    switchAt(0);
    engine.nextAt = step.bars;
    engine.playIndex++;
    engine.jumpTarget = null;
    return;
  }
  if (engine.nextAt === null && quantize() === 0) {
    // "switch on: immediately" → no waiting for a bar line
    step.status = 'armed';
    const err = await evaluateCode(atSectionStart(step.code, Math.floor(nowCycle())), { label: `block ${engine.playIndex + 1}` });
    if (err) { step.status = 'failed'; step.error = err.message; }
    step.startedAt = nowCycle();
    switchAt(step.startedAt);
    engine.nextAt = Math.ceil(nowCycle()) + step.bars;
    engine.playIndex++;
    engine.jumpTarget = null;
    return;
  }
  const q = Math.max(1, quantize() || 1);
  // first step waits for the next quantize boundary; late steps too
  let at = engine.nextAt ?? nextBoundary(q);
  if (at < nextBoundary(1)) at = nextBoundary(q);
  // arm ~2s before the switch (or before its crossfade starts) so the editor shows what's next
  const fade = step.fade ?? fadeCycles(step.song);
  const secsUntil = (at - fade - nowCycle()) / cps();
  if (secsUntil > 2) return;
  step.status = 'armed';
  const playing = engine.steps.find((s) => s.status === 'playing');
  const code = atSectionStart(step.section && playing?.song === step.song ? carryLiveState(getCode(), step.code) : step.code, at);
  const err = await evaluateCode(code, {
    at,
    fade,
    label: step.song ? `“${step.song.title}” ${step.section ? step.prompt : `${step.songPos + 1}/${step.songLen}`}` : `block ${engine.playIndex + 1}`,
  });
  if (err) {
    // keep the old music playing, regenerate this section with the error and try again
    const idx = engine.playIndex;
    step.fixAttempts = (step.fixAttempts || 0) + 1;
    if (step.fixAttempts <= MAX_FIX_ATTEMPTS) {
      clog('warn', `Block ${idx + 1} failed when test-played (${err.message}) — regenerating; the music keeps playing meanwhile`);
      step.status = 'waiting';
      step.failedCode = step.code;
      step.code = null;
      step.fixHint = err.message;
      delete step.startedAt;
      engine.nextAt = null;
      engine.jumpTarget = idx;
      ensureGenerated(idx).catch(() => {});
      return;
    }
    step.status = 'failed';
    step.error = err.message;
    clog('error', `Block ${idx + 1} still fails (${err.message}) — skipped`);
  } else {
    step.startedAt = at; // stays 'armed' until the switch happens
    switchAt(at);
  }
  engine.nextAt = at + step.bars;
  engine.playIndex++;
  engine.jumpTarget = null;
}

export function startSetlist({ at = 0, steps = null, feeder = null } = {}) {
  steps = steps || [];
  if (!steps.length && !feeder) return;
  stopSetlist();
  stopReplay();
  Object.assign(engine, {
    running: true, paused: null, steps, genIndex: at, playIndex: at, nextAt: null, jumpTarget: at,
    abort: new AbortController(), feeder, hold: false,
  });
  steps.forEach((s, j) => { if (j < at && !s.code) s.status = 'skipped'; }); // started further down: don't write the blocks above
  engine.timer = setInterval(() => tickSetlist().catch((e) => warnUser(`song blocks: ${e.message}`)), 100);
  if (!feeder) addMsg('info', `▶ song blocks started (${steps.length} blocks) — generating ahead…`);
  restartGeneration(at);
}

/** Add blocks to a running engine (used by Set list / Station). Old finished blocks are trimmed. */
export function appendSteps(steps) {
  engine.steps.push(...steps);
  const keepFrom = Math.min(engine.playIndex - 3, engine.genIndex);
  if (keepFrom > 40) {
    const cut = keepFrom - 20;
    engine.steps.splice(0, cut);
    engine.playIndex -= cut;
    engine.genIndex -= cut;
    if (engine.jumpTarget !== null) engine.jumpTarget = Math.max(0, engine.jumpTarget - cut);
  }
  songsChanged();
  pumpGeneration();
}

/**
 * The playlist changed after the song playing now: take back the sections of later songs that were already queued in
 * the engine (not the playing song's own, and not one that is about to switch in). Returns the song the engine's
 * last kept section belongs to, so the feed loop carries on after it.
 */
export function dropQueuedSongs(current) {
  let cut = engine.steps.length;
  for (let i = engine.steps.length - 1; i >= 0; i--) {
    const st = engine.steps[i];
    if (['playing', 'armed', 'done'].includes(st.status) || !st.song || st.song === current) break;
    cut = i;
  }
  if (cut < engine.steps.length) {
    engine.steps.splice(cut);
    engine.playIndex = Math.min(engine.playIndex, cut);
    engine.genIndex = Math.min(engine.genIndex, cut);
    songsChanged();
  }
  return engine.steps[engine.steps.length - 1]?.song || null;
}

/** Remove blocks that haven't started yet (after the playing/armed one). */
export function dropUpcomingSteps() {
  let keep = engine.steps.length;
  for (let i = 0; i < engine.steps.length; i++) {
    const st = engine.steps[i].status;
    if (st === 'playing' || st === 'armed' || st === 'done') keep = i + 1;
  }
  keep = Math.max(keep, Math.min(engine.playIndex, engine.steps.length));
  if (engine.steps[keep - 1]?.status === 'armed' && nowCycle() < (engine.steps[keep - 1].startedAt ?? 0)) {
    cancelPending(true);
    keep--;
  }
  engine.steps.splice(keep);
  engine.playIndex = Math.min(engine.playIndex, keep);
  engine.genIndex = Math.min(engine.genIndex, keep);
  songsChanged();
}

export function stopSetlist() {
  engine.paused = null;
  mp3.paused = false;
  if (!engine.running) return;
  engine.running = false;
  engine.jumpTarget = null;
  const feeder = engine.feeder;
  engine.feeder = null;
  feeder?.onStop?.();
  engine.abort?.abort();
  clearInterval(engine.timer);
  engine.steps.forEach((s) => { if (s.status === 'generating' || s.status === 'armed') s.status = 'waiting'; });
}

export const STATUS_ICON = { waiting: '·', generating: '…', ready: '✓', armed: '⏱', playing: '▶', failed: '✗', done: '✔', skipped: '↷' };
/** Armed blocks become "playing" once their bar arrives (the song views render from these states). */
/** Mark the section that starts at cycle `at` as playing right when it starts (the 100 ms check is the fallback). */
function switchAt(at) {
  const ms = Math.max(0, ((at - nowCycle()) / Math.max(0.01, cps())) * 1000);
  setTimeout(updateStepStates, ms + 5);
}
function updateStepStates() {
  const cur = nowCycle();
  engine.steps.forEach((s, i) => {
    if (s.status === 'armed' && s.startedAt !== undefined && cur >= s.startedAt) {
      engine.steps.forEach((o, j) => { if (j !== i && o.status === 'playing') o.status = 'done'; });
      s.status = 'playing';
      engine.feeder?.onStepStart?.(s);
      player.emit('section', { step: s });
    }
  });
}

// ---------------------------------------------------------------------------
// ⏸ Pause / ▶ Resume (🎶 Now playing): stop the sound where the song is — section and bar — and pick up
// there later. The resumed section is anchored so its bar `bar` plays first (sectionStart = −bar).
// ---------------------------------------------------------------------------
function pauseSong() {
  if (!engine.running || engine.paused || !isPlaying()) return;
  const st = engine.steps.find((x) => x.status === 'playing');
  if (!st) return;
  const len = Math.max(1, st.bars);
  const bar = Math.max(0, Math.floor(nowCycle() - (st.startedAt ?? 0))) % len;
  // a next section armed for the bar line: take it back, it plays after the resume
  cancelPending(true);
  engine.steps.forEach((x) => { if (x.status === 'armed') { x.status = 'ready'; delete x.startedAt; } });
  engine.playIndex = engine.steps.indexOf(st) + 1;
  engine.jumpTarget = null;
  engine.paused = { step: st, bar, code: getCode() };
  mp3.paused = true;
  mirror()?.stop();
  player.emit('transport', { state: 'paused' });
  addMsg('info', `⏸ paused “${st.song?.title || 'song'}” at ${st.prompt || 'this section'}, bar ${bar + 1}/${len}`);
  songsChanged();
}
async function resumeSong() {
  const p = engine.paused;
  if (!p) return;
  engine.paused = null;
  const err = await evaluateCode(atSectionStart(p.code, -p.bar), { label: `resume ${p.step.prompt || ''}`, undo: false });
  if (err) { addMsg('error', `Couldn't resume: ${err.message}`); engine.paused = p; return; }
  p.step.startedAt = -p.bar;
  engine.nextAt = p.step.startedAt + p.step.bars;
  player.emit('transport', { state: 'playing' });
  mp3.paused = false;
  addMsg('info', `▶ resumed at bar ${p.bar + 1}`);
  songsChanged();
}
// ⏮ ▶ ⏸ ■ ⏭ in 🎶 Now playing
$('nowPause').onclick = () => {
  if (engine.paused) return resumeSong();
  if (engine.running) return pauseSong();
  if (isPlaying()) mirror()?.stop(); // your own code: pausing stops it (▶ plays it again)
};
/**
 * ✨ New song (🎯 in the chat): the message describes it ("Title | description", or just a description — then its
 * first words become the title). It's written and plays next: after the song playing now, or right away.
 */
export function createSongFromChat(text) {
  const [song] = parseSongs(text.replace(/\n+/g, ' '));
  if (!song) return;
  if (!/[|–—:]\s/.test(text)) { song.title = 'New song'; song.autoTitle = true; } // the AI names it with the song sheet
  song.from = 'chat';
  const playingNow = queue.running && queue.songs[queue.current];
  addToPlaylist(song, { at: 'next' });
  addMsg('info', playingNow
    ? `✨ “${song.title}” — writing it now; it plays after “${playingNow.title}” (⏭ to skip there)`
    : `✨ “${song.title}” — writing it now; it starts as soon as its first section is ready`);
  // back to working on the (new) song
  $('chatTarget').value = 'auto';
  save({ chatTarget: 'auto' });
  renderChatTarget();
  songsChanged();
  showPanel('song');
}

/** ⏭ the next song of the set list or station. */
function nextSong() {
  if (engine.paused) engine.paused = null;
  const k = queue.current + 1;
  if (!queue.running) {
    if (queue.songs[k]) startPlaylist({ at: k });
    else addMsg('info', '⏭ nothing to skip to — add songs to the 📃 Playlist, or start a 📻 Station');
    return;
  }
  if (queue.songs[k]) { addMsg('info', `⏭ next: “${queue.songs[k].title}”`); jumpToSong(k); }
  else if (queue.station) addMsg('info', '⏭ the station is still planning the next song — it plays as soon as it is written');
  else if ($('setLoop').checked && queue.songs[0]) jumpToSong(0);
  else addMsg('info', '⏭ this is the last song of the playlist');
}
/** ⏮ restart the song — or, within its first bars, go back to the previous song (like a music player). */
function prevSong() {
  if (!queue.running) { if (nowSong) playSong(nowSong); return; }
  if (engine.paused) engine.paused = null;
  const cur = queue.songs[queue.current];
  const first = cur?.firstStep;
  const intoSong = first?.startedAt != null ? nowCycle() - first.startedAt : Infinity;
  if ((intoSong < 4 || !cur) && queue.current > 0) { addMsg('info', `⏮ back to “${queue.songs[queue.current - 1].title}”`); jumpToSong(queue.current - 1); }
  else if (cur) { addMsg('info', `⏮ “${cur.title}” from the start`); jumpToSong(queue.current); }
}
$('nextSong').onclick = nextSong;
$('prevSong').onclick = prevSong;
/** The transport: which buttons apply now, and a one-line "what's playing". */
function renderTransport() {
  const playing = isPlaying(), paused = !!engine.paused, running = queue.running;
  const cur = running ? queue.songs[queue.current] : null;
  $('play').disabled = playing && !paused;
  $('play').classList.toggle('on', paused);
  $('nowPause').disabled = !playing && !paused;
  $('nowPause').classList.toggle('on', paused);
  $('stop').disabled = !playing && !running && !paused;
  $('nextSong').disabled = !running;
  $('prevSong').disabled = !running && !nowSong;
  const st = engine.steps.find((x) => x.status === 'playing');
  const line = paused ? `⏸ paused · ${cur?.title || ''} · ${engine.paused.step.prompt || ''} bar ${engine.paused.bar + 1}`
    : cur && playing ? `▶ ${cur.title}${st?.prompt ? ` · ${st.prompt}` : ''}`
    : running ? `✎ ${queue.songs.find((x) => x.status === 'writing')?.title || 'getting the first song ready'}…`
    : playing ? '▶ the code in the editor' : nowSong ? `■ stopped · ${nowSong.title}` : '■ stopped';
  if ($('nowLine').textContent !== line) $('nowLine').textContent = line;
  // the same transport at the top left of the code
  for (const b of $('codeBar').querySelectorAll('[data-tp]')) {
    const twin = $(b.dataset.tp);
    b.disabled = twin.disabled;
    b.classList.toggle('on', twin.classList.contains('on'));
  }
  if ($('codeLine').textContent !== line) $('codeLine').textContent = line;
}
$('codeBar').addEventListener('click', (e) => { const b = e.target.closest('[data-tp]'); if (b && !b.disabled) $(b.dataset.tp).click(); });
// the transport follows the player's events (the timer is only a safety net)
{
  const soon = onceAFrame(renderTransport);
  for (const e of ['section', 'song', 'transport', 'songs']) player.on(e, soon);
  setInterval(renderTransport, 1000);
}

/** Hold: stay on the current section until another one is picked (or hold is released). */
export function setHold(on) {
  engine.hold = on;
  // releasing: continue with the section after the current one on the next boundary
  if (!on && engine.running && engine.nextAt === null) engine.nextAt = nextBoundary(Math.max(1, quantize() || 1));
  songsChanged();
}

// Alt+1 … Alt+9 jump to the sections of the song that is playing
document.addEventListener('keydown', (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  const n = Number(e.key);
  const song = queue.songs[queue.current];
  const step = song?.blocks?.[n - 1];
  if (n >= 1 && n <= 9 && step && engine.steps.includes(step)) {
    e.preventDefault();
    jumpTo(engine.steps.indexOf(step));
  }
});

// ---------------------------------------------------------------------------
if (!window.isSecureContext) {
  addMsg('error', 'This page is not a secure context, so browser audio (AudioWorklet) will fail. ' +
    'Open it via http://localhost or the HTTPS port instead.');
}
loadConfig().catch((e) => addMsg('error', `Config load failed: ${e.message}`));
soundRegistry(); // install soundfont guard as soon as Strudel has loaded

setup_mute_solo(); // features/mute-solo.js
setup_hum_ui(); // features/hum-ui.js
setup_share(); // features/share.js
// ---------------------------------------------------------------------------
// Master volume: scales Strudel's final output (and is what "duck music" lowers).
// ---------------------------------------------------------------------------
function masterGainNode() {
  try { return globalThis.getSuperdoughAudioController?.().output.destinationGain.gain || null; } catch { return null; }
}
export function applyMasterGain(ramp = 0.03) {
  const g = masterGainNode();
  if (!g) return;
  const v = Number($('masterGain').value) * (hum.ducked ? 0.3 : 1);
  try { g.setTargetAtTime(v, audioCtx().currentTime, ramp); } catch { g.value = v; }
}
$('masterGain').value = saved.masterGain ?? 1;
const showMaster = () => { $('masterVal').textContent = Math.round($('masterGain').value * 100) + '%'; };
showMaster();
$('masterGain').oninput = () => { showMaster(); applyMasterGain(); save({ masterGain: Number($('masterGain').value) }); };
$('masterGain').ondblclick = () => { $('masterGain').value = 1; $('masterGain').oninput(); };
// the audio graph is created lazily by Strudel – (re)apply on play and on first interaction
document.addEventListener('pointerdown', () => setTimeout(applyMasterGain, 50), { once: true });
replEl.addEventListener('update', () => { if (isPlaying() && !applyMasterGain.done) { applyMasterGain.done = true; applyMasterGain(); } });
setTimeout(applyMasterGain, 500);

// ---------------------------------------------------------------------------
// Set list & Station: a list of songs (prompts). Each song's blocks are written by
// the AI while the previous song plays, then fed into the song-blocks engine.
// A station is an agent that keeps inventing new songs for a theme.
// ---------------------------------------------------------------------------
/**
 * The 📃 Playlist: the songs that played (before `current`), the one playing, and the ones coming up. Songs get here
 * from 💬 Chat (✨ new song), from 🎵 Songs (＋ Playlist / ⤴ Play next / ▶ Play) and from a 📻 Station on air, which keeps
 * adding songs to the end while the ones already written play.
 */
export const queue = {
  running: false,
  songs: [],           // { title, desc, status, blocks, firstStep, error, from: 'chat' | 'station' | 'you', station }
  nextSong: 0,         // next song to append to the engine
  current: -1,         // index of the song playing now
  forceJump: null,     // song index the user picked
  abort: null,
  station: null,       // the station on air: { name, theme } — it adds songs to the playlist; null = none
  planning: false,     // the station is asking the AI for its next songs
};

/** This session's songs as "title | description" lines (shared with a link). */
export const setListText = () => queue.songs.map((sg) => `${sg.title} | ${sg.desc}`).join('\n');
export function parseSongs(text) {
  return text
    .split('\n')
    .map((l) => l.trim().replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ''))
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const m = l.match(/^(.{1,80}?)\s*[|–—:]\s+(.+)$/);
      const title = (m ? m[1] : l.split(/\s+/).slice(0, 4).join(' ')).replace(/^["“]|["”]$/g, '').trim();
      return { title, desc: (m ? m[2] : l).trim(), status: 'waiting' };
    });
}

setup_forms(); // features/forms.js
setup_bands(); // features/bands.js
// ---------------------------------------------------------------------------
// Song sheets: for the Songs tab and the Station, the AI first plans the whole song
// as data (tempo, key, chord progressions, hook, parts, form), then writes every
// part once as a library of named patterns. The app arranges each section from the
// library itself, so a chorus is the same code every time, the key and sounds never
// drift, and parts that continue from one section to the next are identical (the
// crossfade keeps them steady).
// ---------------------------------------------------------------------------

/** Every part of a section is anchored to the bar the section starts on (set when it's armed), so phrases and chord progressions start on their first bar. */
const SECTION_START_RE = /^const sectionStart = -?[\d.]+.*$/m;
// (the finished section is wrapped to about 150 characters a line: see format.js)
export const atSectionStart = (code, bar) => wrapCode(stripPartVisuals(SECTION_START_RE.test(code) ? code.replace(SECTION_START_RE, `const sectionStart = ${Math.round(bar)} // the bar this section started on`) : code));

// (features/part-visuals.js)
// (features/song-writer.js)
setup_song_lists(); // features/song-lists.js
setup_playlist(); // features/playlist.js
setup_stations(); // features/stations.js
setup_visualizer(); // features/visualizer.js
// ---------------------------------------------------------------------------
// Docks: the visualizer, keyboard, pads and console are workspace panels; their
// header buttons open / close them.
// ---------------------------------------------------------------------------
export const docks = {};
export function setupDock(name, { onShow, onHide } = {}) {
  const btn = $(`${name}Btn`);
  const d = { name, el: $(`${name}-dock`), on: ws.isOpen(name) };
  d.show = (on) => (on ? ws.open(name) : ws.close(name));
  btn.onclick = () => ws.toggle(name);
  ws.on(name, {
    onOpen: (o) => { d.on = o; btn.classList.toggle('on', o); resetLineControls(); },
    onVisible: (v) => (v ? onShow : onHide)?.(),
  });
  docks[name] = d;
  return d;
}

if (load().vizMode) $('vizMode').value = load().vizMode;
$('vizMode').onchange = () => save({ vizMode: $('vizMode').value });
setup_hydra(); // features/hydra.js
setup_settings(); // features/settings.js
setup_themes(); // features/themes.js
setup_mixer(); // features/mixer.js
setup_master_panel(); // features/master-panel.js
// ---------------------------------------------------------------------------
// Status bar (bottom): bar.beat + tempo, the song / section playing, the pending
// change, the recording, replay and update notices.
// ---------------------------------------------------------------------------
setInterval(() => {
  const step = engine.running ? engine.steps.find((s) => s.status === 'playing') : null;
  const sg = $('sbSong');
  if (step) {
    const pos = step.song?.blocks ? ` (${step.song.blocks.indexOf(step) + 1}/${step.song.blocks.length})` : '';
    sg.hidden = false;
    sg.textContent = `${step.song ? `🎵 ${step.song.title} · ` : '▶ '}${step.prompt}${pos}${engine.hold ? ' · ⏸ held' : ''}`;
  } else sg.hidden = true;
  $('sbCost').textContent = session.cost > 0 ? `💲${money(session.cost).slice(1)}${Number(load().aiBudget ?? 2) > 0 ? ` / ${money(Number(load().aiBudget ?? 2)).slice(1)}` : ''}` : '';
  $('sbCost').title = `AI this session: ${session.requests} request${session.requests === 1 ? '' : 's'}, ${session.tokensIn} tokens in / ${session.tokensOut} out (Claude only — local models are free)`;
  const take = rec.take?.events.length ? rec.take : null;
  $('sbRec').textContent = take ? `⏺ ${take.events.length} change${take.events.length > 1 ? 's' : ''} · ${fmtTime(takeSeconds(take))}` : '';
}, 250);

$('sbWarn').onclick = () => { if (!docks.console.on) docks.console.show(true); $('sbWarn').hidden = true; $('sbWarn').dataset.count = '0'; };
// budget setting
$('aiBudget').value = load().aiBudget ?? 2;
$('aiBudget').oninput = () => save({ aiBudget: Math.max(0, Number($('aiBudget').value) || 0) });
setInterval(() => { $('aiSpent').textContent = `${money(session.cost)} in ${session.requests} request${session.requests === 1 ? '' : 's'}`; }, 1000);

setup_keys(); // features/keys.js
setup_pads(); // features/pads.js
setup_song_library(); // features/song-library.js
setup_song_editor(); // features/song-editor.js
// (features/song-pads.js)
// --- 🧾 every song played this session (kept in the tab; download as a text file)
const LOG_KEY = 'strudel-ai:playlog';
export const LOG_JSON_MARK = '--- SONGS AS JSON';
const playLog = (() => { try { return JSON.parse(sessionStorage.getItem(LOG_KEY)) || []; } catch { return []; } })();
export function logPlayed(sg, mode) {
  if (!sg?.blocks?.length || playLog[playLog.length - 1]?.title === sg.title) return;
  playLog.push({ at: new Date().toISOString(), mode, title: sg.title, json: songToJSON(sg) });
  try { sessionStorage.setItem(LOG_KEY, JSON.stringify(playLog.slice(-200))); } catch {}
}
function playLogText() {
  const out = [`Strudel AI — songs played this session (${new Date().toLocaleString()})`, ''];
  playLog.forEach((e, i) => {
    const j = e.json, sh = j.sheet;
    out.push(`${i + 1}. ${new Date(e.at).toLocaleTimeString()}  “${j.title}”  (${e.mode})`);
    if (j.desc) out.push(`   ${j.desc}`);
    if (sh) {
      out.push(`   ${sh.bpm} bpm · ${sh.key} · form ${sh.form || '?'} · ${sh.sections.length} sections · ${sh.sections.reduce((a, x) => a + x.bars, 0)} bars`);
      out.push(`   chords: ${Object.entries(sh.chords).map(([k, v]) => `${k} ${v}`).join(' · ')}   hook: ${sh.hook}`);
      out.push(`   sections: ${sh.sections.map((x) => `${x.name} ${x.bars}`).join(', ')}`);
      out.push('   parts code:', ...String(j.library || '').split('\n').map((l) => '     ' + l));
    } else {
      out.push(`   ${(j.steps || []).length} sections:`, ...(j.steps || []).map((st) => `     ${st.bars} bars — ${st.prompt}`));
    }
    out.push('');
  });
  out.push(`${LOG_JSON_MARK} (import this file in 🎵 Songs → 📁 My songs → ⬆ import) ---`, JSON.stringify(playLog.map((e) => e.json), null, 1));
  return out.join('\n');
}
for (const b of [$('logDownload'), ...document.querySelectorAll('.log-dl')]) {
  b.onclick = () => {
    if (!playLog.length) { clog('info', 'no songs played yet this session'); b.title = 'No songs played yet this session'; return; }
    download(`strudel-ai-session-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`, playLogText(), 'text/plain');
  };
}

// --- chat ↔ song / pads: the context the chat needs, and applying its replies
/** The song chat should work on: the one playing (if written from a sheet), else the one open in the Songs tab. */
export function activeSong() {
  const playing = queue.running ? queue.songs[queue.current] : null;
  if (playing?.sheet && playing.library) return playing;
  if (songEdit.sg?.sheet && songEdit.sg.library) return songEdit.sg;
  const viewed = viewedSong('set');
  return viewed?.sheet && viewed.library ? viewed : null;
}
const SONG_WORDS = /\b(song|section|sections|verse|chorus|bridge|intro|outro|drop|build|breakdown|break|structure|form|arrange|arrangement|chords?|progression|parts?|bars?|hook|tempo|bpm|key|master|mastering|mix|style|band|lo-?fi)\b/i;
/** Extra context for a chat request — only when the message is about the song / pads (keeps requests small). */
export function chatContext(text) {
  const out = [];
  const target = chatTarget();
  const sg = activeSong();
  if (sg && (target === 'song' || (target === 'auto' && SONG_WORDS.test(text)))) {
    out.push(`ACTIVE SONG "${sg.title}" — sheet JSON ("master" is the song's mastering style, one of: ${STYLE_NAMES.join(', ')}; "masterParams" optional tweaks of it: ${MASTER_PARAMS.map((d) => `${d.key} ${d.min}…${d.max}`).join(', ')}):\n${JSON.stringify(rawSheet(sg.sheet))}\nPARTS CODE:\n\`\`\`javascript\n${sg.library}\n\`\`\``);
  }
  if (target === 'song' && sg) {
    out.push('TARGET: THE WHOLE SONG. Make the change across the song — its sections, form, chords, parts and their variants — ' +
      'by replying with a ```song block (the COMPLETE updated sheet) and, when parts are added or their code changes, a ```parts block ' +
      '(the COMPLETE parts code). Do NOT reply with a ```javascript block: the editor only shows the section playing now and is rebuilt from the song.');
  }
  if (target === 'pads' || (target === 'auto' && /\bpads?\b/i.test(text))) {
    out.push('PADS (number. label [mode]: code):\n' + pads.map((p, i) => `${i + 1}. ${p.label} [${p.mode}]${padIsOn(i) ? ' (on)' : ''}: ${oneLine(p.code)}`).join('\n'));
    if (target === 'pads') out.push('TARGET: THE PADS. Reply with a ```pads block; only include a ```javascript block if the code in the editor must change too.');
  }
  return out.join('\n\n');
}
/**
 * 🎯 What the chat works on: auto | code | song | pads. "song" falls back to auto when no song is open; auto means the
 * whole song while the editor shows a section of the song that's playing (an edit to just that section's code would
 * be replaced at the next section), otherwise the code.
 */
export function chatTarget() {
  const v = $('chatTarget').value;
  if (v === 'song') return activeSong() ? 'song' : 'auto';
  if (v === 'auto' && songSectionInEditor()) return 'song';
  return v;
}
const songSectionInEditor = () => {
  const sg = activeSong();
  return !!(sg && queue.running && queue.songs[queue.current] === sg && getCode().includes(SEC_START));
};
/** If editor code from the AI is really the song's part library, return it as library code (consts), else null. */
export function libraryFromReply(code, sg) {
  if (!sg?.sheet || !sg.library) return null;
  const ids = new Set(libraryIds(sg.sheet));
  const lines = code.split('\n');
  const named = lines.map((l) => l.match(/^(?:const\s+|let\s+|var\s+)?([A-Za-z_$][\w$]*)\s*(?:=|:(?!:))/)?.[1]).filter((n) => n && ids.has(n));
  if (new Set(named).size < 2) return null; // not the library — ordinary code
  if (code.includes(SEC_START) || /^\s*const sectionChords\b/m.test(code)) return null; // a whole section, not just parts
  return lines.map((l) => l.replace(/^([A-Za-z_$][\w$]*):(?!:)\s*/, (m, n) => (ids.has(n) || /_\w+$/.test(n) ? `const ${n} = ` : m))).join('\n');
}
if (saved.chatTarget) $('chatTarget').value = saved.chatTarget;
$('chatTarget').onchange = () => { save({ chatTarget: $('chatTarget').value }); renderChatTarget(); };
/** Keep the song option labelled with the song it works on. */
function renderChatTarget() {
  const sg = activeSong();
  const opt = $('chatTarget').querySelector('option[value="song"]');
  const label = sg ? `🎵 whole song: ${sg.title.slice(0, 28)}` : '🎵 whole song (none open)';
  if (opt.textContent !== label) opt.textContent = label;
  const auto = $('chatTarget').value === 'auto' && songSectionInEditor();
  $('chatTarget').querySelector('option[value="auto"]').textContent = auto ? 'auto → whole song' : 'auto';
  if ($('chatTarget').value === 'new') { $('input').placeholder = 'Describe a new song: style, tempo, key, mood, instruments… (or “Title | description”)'; return; }
  $('input').placeholder = { song: sg ? `Change the whole song “${sg.title}”… (sections, chords, parts)` : 'No song is open — open one in 🎵 Songs (Enter to send)', pads: 'Program or press the pads… (Enter to send)', code: 'Change the code in the editor… (Enter to send, Shift+Enter for newline)' }[auto ? 'song' : $('chatTarget').value]
    || 'Make it groovier… (Enter to send, Shift+Enter for newline)';
}
player.on('song', onceAFrame(renderChatTarget));
setInterval(renderChatTarget, 1000);
/** ```pads reply: program pads and/or switch them on / off. Returns a short summary. */
export function applyPadsReply(block) {
  const j = parseJSONLoose(block.startsWith('{') ? block : `{${block}}`);
  const done = [];
  for (const p of Array.isArray(j.program) ? j.program : []) {
    const i = Number(p.pad) - 1;
    if (!(i >= 0 && i < 16)) continue;
    if (p.code != null && String(p.code) !== pads[i].code) { delete pads[i].part; delete pads[i].variant; }
    pads[i] = { ...pads[i], ...(p.label != null ? { label: String(p.label).slice(0, 24) } : {}), ...(p.code != null ? { code: String(p.code) } : {}), ...(['toggle', 'hold', 'once'].includes(p.mode) ? { mode: p.mode } : {}), ...(p.color ? { color: String(p.color) } : {}) };
    done.push(`programmed pad ${i + 1} (${pads[i].label})`);
  }
  if (done.length) savePads();
  for (const n of Array.isArray(j.on) ? j.on : []) { const i = Number(n) - 1; if (pads[i]) { (pads[i].mode === 'once' ? padOnce(i) : setPad(i, true)); done.push(`pad ${i + 1} on`); } }
  for (const n of Array.isArray(j.off) ? j.off : []) { const i = Number(n) - 1; if (pads[i]) { setPad(i, false); done.push(`pad ${i + 1} off`); } }
  renderPads.key = '';
  if (done.length && !docks.pads.on) { docks.pads.show(true); save({ padsOn: true }); }
  return done.join(', ');
}

setup_mp3(); // features/mp3.js
// (features/debug.js)
window.strudelAI = { player, setMode, currentMode, plugins: pluginsState, sessionSongs, addToPlaylist, debugReport: () => debugReport(debugContext()), ws, mixer, mixerChannels, master, masterChain, getBands: () => bands, normalizeSheet, playSong, songMp3, loadPads, songPads, transposeProgression, sectionCode, getForms: () => songForms, getFavorites: () => favorites, loadFavorites, getPads: () => pads, mySongs, activeSong, songFromJSON, songToJSON, mp3, session, pads, padsState, keysState, noteOn, noteOff, setPad, docks, rec, replay, startReplay, recordingForShare, viz, checkScales, checkSounds, prepareCode, evaluateCode, dryRun, hum, transcribe, ensureSliders, engine, queue, setlist: engine, setl: queue };
setup_modes(); // features/modes.js
// 🧩 plugins last: everything they can add to is ready (features/plugins.js)
setup_plugins();
