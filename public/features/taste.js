// ---------------------------------------------------------------------------
// 🎧 My taste (⚙ Settings): sounds you never want (each with a stand-in), "soften harsh synths", the sounds you
// liked, and your taste in your own words. The AI is told with every request (features/llm.js); the app enforces
// it: avoided sounds are swapped in all code before it plays (sound-check.js prepareCode, the songs already
// written), harsh synth parts get a low-pass as they're arranged (lib/arrange.js). 👎 / 👍 on a 🎚 mixer channel
// add its sound to the list.
// ---------------------------------------------------------------------------
import { $, addMsg, clog, load, save, queue } from '../app.js';
import { render } from '../html.js';
import { T } from '../templates/index.js';
import { normTaste, applyAvoid, swapSound, softerFor } from '../lib/taste.js';
import { setArrangeTaste } from '../lib/arrange.js';
import { settingsPages } from './settings.js';
import { applySongEdit, rawSheet, refreshPlayingSection, linkedSongs } from './song-editor.js';
import { mySongs, saveMySongs } from './song-library.js';
import { sessionSongs } from './playlist.js';

// (read from settings on first use: app.js imports this module while it is still starting up)
let taste = null;
/** Your taste now: { avoid: [{ sound, instead }], soften, cutoff, likes, liked }. */
export function getTaste() {
  if (!taste) { taste = normTaste(load().taste); setArrangeTaste(taste); }
  return taste;
}

/** Change your taste: saved, used from now on, and put into the songs already written (the playing one too). */
export async function setTaste(next, { quiet = false } = {}) {
  const before = getTaste();
  taste = normTaste(next);
  setArrangeTaste(taste);
  save({ taste });
  renderTasteSettings();
  const avoidChanged = JSON.stringify(before.avoid) !== JSON.stringify(taste.avoid);
  const softChanged = before.soften !== taste.soften || (taste.soften && before.cutoff !== taste.cutoff);
  if (avoidChanged || softChanged) await reapplyToSongs({ quiet });
}

/** Put your taste into every written song: swap avoided sounds in its parts, re-arrange it (softened synths). */
async function reapplyToSongs({ quiet }) {
  const roots = [...new Set([...queue.songs, ...mySongs, ...sessionSongs].filter((sg) => sg?.sheet && sg.library).map((sg) => sg.copyOf || sg))];
  let changed = 0;
  for (const sg of roots) {
    const { code: lib, swapped } = applyAvoid(sg.library, taste);
    const raw = rawSheet(sg.sheet);
    for (const p of raw.parts) p.sound = swapSound(p.sound, taste);
    const err = await applySongEdit(sg, raw, swapped.length ? lib : null);
    if (err) { clog('warn', `🎧 “${sg.title}” kept as it was: ${err}`); continue; }
    if (swapped.length) changed++;
    for (const x of [sg, ...linkedSongs(sg)]) if (queue.running && queue.songs[queue.current] === x) await refreshPlayingSection(x);
  }
  if (mySongs.length) saveMySongs();
  if (changed && !quiet) addMsg('info', `🎧 your taste is in ${changed} song${changed > 1 ? 's' : ''} already written (the one playing changes from the next bar)`);
}

/** 👎 a sound: never again (with a softer stand-in), right away. */
export function avoidSound(sound, instead = softerFor(sound)) {
  if (!sound) return;
  const taste = getTaste();
  addMsg('info', `🎧 “${sound}” is out${instead ? ` — ${instead} plays instead` : ''} (⚙ Settings → 🎧 My taste)`);
  return setTaste({ ...taste, avoid: [...taste.avoid, { sound, instead }], liked: taste.liked.filter((x) => x !== sound) });
}
/** 👍 a sound: the AI uses it where it fits. */
export function likeSound(sound) {
  const taste = getTaste();
  if (!sound || taste.liked.includes(sound)) return;
  addMsg('info', `🎧 noted — you like “${sound}”`);
  return setTaste({ ...taste, liked: [...taste.liked, sound], avoid: taste.avoid.filter((a) => a.sound !== sound) });
}

// --- ⚙ Settings → 🎧 My taste ----------------------------------------------------------------------------------------
let draftRow = { sound: 'square', instead: 'triangle' };
const act = {
  add(sound, instead) {
    const taste = getTaste(); if (sound.trim()) { draftRow = { sound: '', instead: '' }; setTaste({ ...taste, avoid: [...taste.avoid, { sound: sound.trim(), instead: (instead || softerFor(sound.trim())).trim() }] }); } },
  draft(k, v) { draftRow = { ...draftRow, [k]: v, ...(k === 'sound' && !draftRow.instead ? { instead: softerFor(v.trim()) } : {}) }; renderTasteSettings(); },
  instead(i, v) { const taste = getTaste(); setTaste({ ...taste, avoid: taste.avoid.map((a, k) => (k === i ? { ...a, instead: v.trim() } : a)) }); },
  remove(i) { const taste = getTaste(); setTaste({ ...taste, avoid: taste.avoid.filter((_, k) => k !== i) }); },
  soften(on) { setTaste({ ...getTaste(), soften: on }); },
  cutoff(v) { setTaste({ ...getTaste(), cutoff: Number(v) }); },
  likes(text) { setTaste({ ...getTaste(), likes: text }); },
  unlike(sound) { const taste = getTaste(); setTaste({ ...taste, liked: taste.liked.filter((x) => x !== sound) }); },
};
export function renderTasteSettings() {
  const el = $('tasteForm');
  if (!el) return;
  // (the suggestion goes once it's on the list)
  if (draftRow.sound && getTaste().avoid.some((a) => a.sound.toLowerCase() === draftRow.sound.trim().toLowerCase())) draftRow = { sound: '', instead: '' };
  render(T.tasteSettings({ ...getTaste(), draft: draftRow }, act), el);
}

export function setup() {
  getTaste();
  settingsPages.set('setMyTaste', renderTasteSettings);
}
