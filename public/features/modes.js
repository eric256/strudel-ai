// ---------------------------------------------------------------------------
// Modes: three ways of working, picked in the header. Each has its own panel layout (saved separately), its own
// chat targets and its own code; switching stops all music.
//   📻 Radio  — stations and the playlist write songs for you; pads, mixer, master and visuals to play along
//   🎼 Studio — one song on the bench: chat works on that song while it loops
//   ⌨ Jam    — live-coding: you and the AI write one piece of code in the editor (no songs)
// ---------------------------------------------------------------------------
import { render } from '../html.js';
import { T } from '../templates/index.js';
import { $, addMsg, getCode, load, mirror, player, save, ws } from '../app.js';
import { setNowSong, songsChanged } from './song-lists.js';

export const MODES = {
  radio: {
    label: '📻 Radio', title: 'Radio: stations and the playlist write songs for you; play along on the pads, mixer and master',
    preset: { right: ['chat', 'songs', 'station', 'playlist'], bottom: [], now: true },
    targets: ['auto', 'song', 'routing', 'pads', 'new'], target: 'auto',
    code: '// 📻 Radio: start a 📻 station, or play a song from 🎵 Songs or the 📃 Playlist.\n// The code of the section playing shows here.\n',
  },
  studio: {
    label: '🎼 Studio', title: 'Studio: work on one song with the AI — chat changes that song while it plays',
    // the song editor gets the big space under the code
    preset: { right: ['chat', 'songs'], bottom: ['edit', 'mixer', 'master'], bottomHeight: 0.58, now: true }, layoutVersion: 2,
    targets: ['song', 'auto', 'routing', 'pads', 'new'], target: 'song',
    code: '// 🎼 Studio: open a song (🎵 Songs → ✎ Edit, or ✨ new song in the chat) and change it with the chat.\n// The code of the section playing shows here.\n',
  },
  jam: {
    label: '⌨ Jam', title: 'Jam: live-code — you and the AI write the code in the editor together (Ctrl+Enter plays it)',
    preset: { right: ['chat'], bottom: ['keys', 'pads', 'viz'], now: false },
    targets: ['code', 'routing', 'pads'], target: 'code',
    code: '// ⌨ Jam: write Strudel code here (Ctrl+Enter plays it), or ask the chat: “a dusty boom bap beat at 88 bpm”.\nsetcpm(90/4)\ndrums: s("bd ~ [~ bd] ~, ~ sd ~ sd, hh*8").bank("RolandTR808").gain(0.8)\n',
  },
};
/** A mode's saved layout — unless it was saved for an older version of its preset (then the new preset is used). */
export const savedLayout = (mode) => ((load().panelLayoutVersions?.[mode] || 1) === (MODES[mode].layoutVersion || 1) ? load().panelLayouts?.[mode] || null : null);
/** Save a mode's layout (with its preset's version). */
export const saveLayout = (mode, layout) => save({
  panelLayouts: { ...(load().panelLayouts || {}), [mode]: layout },
  panelLayoutVersions: { ...(load().panelLayoutVersions || {}), [mode]: MODES[mode].layoutVersion || 1 },
});
/** The mode in use (the page starts in the saved one). */
export const currentMode = () => document.body.dataset.mode || (MODES[load().mode] ? load().mode : 'radio');

/** Only the chat targets that make sense in this mode (each mode remembers its own pick). */
function applyChatTargets(mode) {
  const m = MODES[mode], sel = $('chatTarget');
  for (const o of sel.options) o.hidden = o.disabled = !m.targets.includes(o.value);
  const want = load().chatTargets?.[mode];
  sel.value = m.targets.includes(want) ? want : m.target;
  sel.dispatchEvent(new Event('change'));
}
function renderModeSwitch() {
  const cur = currentMode();
  render(T.modeSwitch(Object.entries(MODES).map(([id, m]) => ({ id, label: m.label, title: m.title, on: id === cur })), { pick: setMode }), $('modeSwitch'));
}
/** Stop everything that makes sound: the song, the station, a replay, the code. */
function stopAll() {
  try { $('stop').onclick?.(); } catch (e) { console.warn('[modes] stop:', e); }
}

/** Switch mode: all music stops, and the layout, the chat targets and the code change to the new mode's. */
export function setMode(mode) {
  const from = currentMode();
  if (!MODES[mode] || mode === from) return;
  stopAll();
  if (mode === 'jam') { setNowSong(null); songsChanged(); } // no song in a jam (the transport and Now playing forget it)
  saveLayout(from, ws.layout());
  if (from === 'jam') save({ jamCode: getCode() });
  document.body.dataset.mode = mode;
  save({ mode });
  ws.setLayout(savedLayout(mode), MODES[mode].preset);
  mirror()?.setCode(mode === 'jam' ? load().jamCode || MODES.jam.code : MODES[mode].code);
  applyChatTargets(mode);
  renderModeSwitch();
  player.emit('mode', { mode, from });
  addMsg('info', `${MODES[mode].label} — ${MODES[mode].title.split(': ')[1]}`);
}

export function setup() {
  document.body.dataset.mode = currentMode();
  renderModeSwitch();
  applyChatTargets(currentMode());
  // each mode remembers its chat target
  $('chatTarget').addEventListener('change', () => {
    const v = $('chatTarget').value;
    if (MODES[currentMode()].targets.includes(v)) save({ chatTargets: { ...(load().chatTargets || {}), [currentMode()]: v } });
  });
  // ⌨ Jam keeps its code: saved as you type (and the page starts with it)
  let last = null;
  setInterval(() => {
    if (currentMode() !== 'jam' || !mirror()) return;
    const c = getCode();
    if (c !== last) { last = c; save({ jamCode: c }); }
  }, 2000);
  if (currentMode() === 'jam') {
    const wait = setInterval(() => { if (mirror()) { clearInterval(wait); if (load().jamCode && getCode() !== load().jamCode) mirror().setCode(load().jamCode); } }, 300);
  }
}
