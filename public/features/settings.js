// About: version, recent changes (from CHANGELOG.md) and project links.
// (split out of app.js: start-up code runs in setup(), called from app.js)
import { renderAccount } from './account.js';
import { esc } from '../lib/util.js';
import { APP_BUILD, APP_VERSION, saveSession } from './share.js';
import { MY_SONGS_KEY, mySongs, songToJSON } from './song-library.js';
import { $, STORE_KEY, forgetStore, load, save, setupDock, state } from '../app.js';
import { renderBandsEditor } from './bands.js';
import { renderFormsEditor } from './forms.js';
import { renderStations } from './stations.js';
import { renderThemeSettings } from './themes.js';
import { renderPluginSettings } from './plugins.js';
/** Tiny renderer for the changelog: "## x.y.z" headings, "- " bullets, **bold**, `code`. */
function renderChangelog(md, versions = 3) {
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const parts = md.split(/^## /m).slice(1, versions + 1);
  if (!parts.length) return '<p class="muted">No changelog available.</p>';
  return parts.map((p) => {
    const [head, ...lines] = p.split('\n');
    let html = `<h4>${head.trim() === APP_VERSION ? `v${esc(head.trim())} <span class="tag">this version</span>` : 'v' + esc(head.trim())}</h4><ul>`;
    let item = null;
    const flush = () => { if (item !== null) html += `<li>${inline(item)}</li>`; item = null; };
    for (const l of lines) {
      const m = l.match(/^\s*- (.*)$/);
      if (m && !/^\s{2,}-/.test(l)) { flush(); item = m[1]; }
      else if (m) { flush(); html += `<li class="sub">${inline(m[1])}</li>`; }
      else if (l.trim() && item !== null) item += ' ' + l.trim();
    }
    flush();
    return html + '</ul>';
  }).join('');
}

async function openAbout() {
  const dlg = $('aboutDlg');
  $('aboutVersion').textContent = 'v' + APP_VERSION;
  $('aboutBuild').textContent = `build ${APP_BUILD}`;
  if (!dlg.open) dlg.showModal();
  try {
    const a = await fetch('/api/about', { cache: 'no-cache' }).then((r) => r.json());
    const repo = a.repo || 'https://github.com/eric256/strudel-ai';
    $('aboutRepo').href = repo;
    $('aboutIssues').href = repo + '/issues';
    $('aboutReleases').href = repo + '/releases';
    $('aboutChangelog').href = repo + '/blob/main/CHANGELOG.md';
    if (a.version && a.version !== APP_VERSION) $('aboutBuild').textContent += ` · v${a.version} is deployed — it loads when you stop`;
    $('aboutChanges').innerHTML = renderChangelog(a.changelog || '');
  } catch (e) {
    $('aboutChanges').textContent = `Couldn't load the changelog: ${e.message}`;
  }
} // click outside

// ---------------------------------------------------------------------------
// ⚙ Settings: live edit, fade, autocomplete, song forms, stations, backup.
// Everything is kept in localStorage (STORE_KEY), so it survives reloads and updates.
// ---------------------------------------------------------------------------
/** Settings pages added by 🧩 plugins: section id → render(). */
export const settingsPages = new Map();
export function openSettings(sec = 'setGeneral') {
  for (const b of document.querySelectorAll('.settings-tabs button')) b.classList.toggle('active', b.dataset.sec === sec);
  for (const el of document.querySelectorAll('.settings-sec')) el.hidden = el.id !== sec;
  if (sec === 'setForms') renderFormsEditor();
  if (sec === 'setBands') renderBandsEditor();
  if (sec === 'setTheme') renderThemeSettings();
  if (sec === 'setStations') renderStations();
  if (sec === 'setPrompts') renderPromptEditor();
  if (sec === 'setPlugins') renderPluginSettings();
  if (sec === 'setAI') renderAccount({ showing: true });
  settingsPages.get(sec)?.();
  $('settingsMsg').textContent = '';
  if (!$('settingsDlg').open) $('settingsDlg').showModal();
}

// --- 📝 Prompts: the built-in system prompts, and the user's own versions (sent with each request)
let builtinPrompts = null;
const loadBuiltinPrompts = async () => (builtinPrompts ||= await fetch('/api/prompts').then((r) => r.json()).catch(() => ({})));
/** The user's version of the system prompt for this kind of request, or null for the built-in one. */
export function promptOverride(mode) {
  const own = load().prompts?.[mode];
  return typeof own === 'string' && own.trim() ? own : null;
}
async function renderPromptEditor() {
  const mode = $('promptSelect').value;
  const builtin = (await loadBuiltinPrompts())[mode] ?? '';
  const own = promptOverride(mode);
  $('promptText').value = own ?? builtin;
  $('promptState').textContent = own ? '✎ your version (used instead of the built-in one)' : 'built-in';
  $('promptReset').hidden = !own;
}

// --- the AI settings summary under the chat
function renderAISummary() {
  const model = $('model').selectedOptions[0]?.textContent || 'default model';
  const own = Object.keys(load().prompts || {}).length;
  const claude = state.config?.providers?.[$('provider').value]?.kind === 'anthropic';
  $('aiSummary').textContent = `🤖 ${model} · ${claude ? `effort ${$('claudeEffort').value}` : `temp ${$('temp').value}`}${$('autoApply').checked ? '' : ' · manual apply'}${own ? ` · ${own} custom prompt${own > 1 ? 's' : ''}` : ''}`;
}

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  $('aboutBtn').onclick = openAbout;
  $('appVersion').onclick = openAbout;
  $('aboutClose').onclick = () => $('aboutDlg').close();
  $('aboutDlg').addEventListener('click', (e) => { if (e.target === $('aboutDlg')) $('aboutDlg').close(); });
  $('settingsBtn').onclick = () => openSettings();
  // the settings window remembers the size you drag it to
  {
    const dlg = $('settingsDlg');
    const size = load().settingsSize;
    if (size?.w && size?.h) Object.assign(dlg.style, { width: `${size.w}px`, height: `${size.h}px` });
    let t = null;
    dlg.addEventListener('close', () => { dlg.__base = null; });
    new ResizeObserver(() => {
      if (!dlg.open) return;
      const now = `${dlg.offsetWidth}x${dlg.offsetHeight}`;
      if (!dlg.__base) { dlg.__base = now; return; } // opening it isn't resizing it
      if (now === dlg.__base) return;
      clearTimeout(t);
      t = setTimeout(() => save({ settingsSize: { w: Math.round(dlg.offsetWidth), h: Math.round(dlg.offsetHeight) } }), 400);
    }).observe(dlg);
  }
  $('settingsClose').onclick = () => $('settingsDlg').close();
  $('settingsDlg').addEventListener('click', (e) => { if (e.target === $('settingsDlg')) $('settingsDlg').close(); });
  for (const b of document.querySelectorAll('.settings-tabs button')) b.onclick = () => openSettings(b.dataset.sec);
  for (const b of document.querySelectorAll('.stations-edit')) b.onclick = () => openSettings('setStations');
  $('settingsExport').onclick = () => {
    const blob = new Blob([JSON.stringify({ app: 'strudel-ai', version: APP_VERSION, exported: new Date().toISOString(), settings: load(), mySongs: mySongs.map(songToJSON) }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `strudel-ai-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('settingsMsg').textContent = '✓ exported';
  };
  $('settingsImport').onchange = async () => {
    const f = $('settingsImport').files[0];
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const st = j.settings || j;
      if (!st || typeof st !== 'object' || Array.isArray(st)) throw new Error('not a settings file');
      if (!confirm('Replace this browser\'s settings, forms, stations and pads with the ones in this file?')) return;
      localStorage.setItem(STORE_KEY, JSON.stringify(st));
      forgetStore();
      if (Array.isArray(j.mySongs)) localStorage.setItem(MY_SONGS_KEY, JSON.stringify(j.mySongs));
      saveSession();
      location.reload();
    } catch (e) {
      $('settingsMsg').textContent = `⚠ couldn't import: ${e.message}`;
    }
  };
  $('settingsReset').onclick = () => {
    if (!confirm('Reset everything this browser has saved (settings, forms, stations, pads, layout and your code)?')) return;
    try { localStorage.removeItem(STORE_KEY); } catch {}
    forgetStore();
    location.reload();
  };
  $('promptSelect').onchange = renderPromptEditor;
  $('promptText').oninput = async () => {
    const mode = $('promptSelect').value;
    const builtin = (await loadBuiltinPrompts())[mode] ?? '';
    const prompts = { ...(load().prompts || {}) };
    const v = $('promptText').value;
    if (!v.trim() || v === builtin) delete prompts[mode]; else prompts[mode] = v;
    save({ prompts });
    $('promptState').textContent = prompts[mode] ? '✎ your version (used instead of the built-in one)' : 'built-in';
    $('promptReset').hidden = !prompts[mode];
  };
  $('promptReset').onclick = () => {
    const prompts = { ...(load().prompts || {}) };
    delete prompts[$('promptSelect').value];
    save({ prompts });
    renderPromptEditor();
  };
  for (const id of ['model', 'provider', 'temp', 'autoApply', 'claudeEffort']) $(id).addEventListener('change', renderAISummary);
  $('claudeEffort').addEventListener('change', () => save({ claudeEffort: $('claudeEffort').value }));
  $('temp').addEventListener('input', renderAISummary);
  $('aiSummary').onclick = () => openSettings('setAI');
  setInterval(renderAISummary, 2000);
  renderAISummary();

  setupDock('console');
}
