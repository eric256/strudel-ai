// ✎ Edit song: changing a song's sheet (sections, chords, parts) and parts code by hand. The app re-arranges it
// (no AI); a playing song switches to the new version from its next section.
// (split out of app.js: start-up code runs in setup(), called from app.js)
import { METERS, normMeter, tempoLine } from '../lib/music.js';
import { definesId, libraryIds } from '../lib/sheet.js';
import { patternLines } from '../lib/labels.js';
import { wrapCode } from '../format.js';
import { isMine, saveMySongs } from './song-library.js';
import { signed } from '../lib/util.js';
import { arrangeSong, carryLiveState, sectionCode } from '../lib/arrange.js';
import { loadPads, padsState } from './pads.js';
import { STYLE_NAMES } from '../master.js';
import { $, atSectionStart, clog, engine, evaluateCode, fadeCycles, getCode, isPlaying, nextBoundary, queue, state, ws } from '../app.js';
import { normalizeSheet } from './bands.js';
import { prepareCode } from './sound-check.js';
import { songsChanged, renderSongs } from './song-lists.js';
import { syntaxError } from './llm.js';
import { testLibrary } from './song-writer.js';
import { html } from '../html.js';
// --- editing a song: re-arranged by the app (no AI), live if it's playing
export function rawSheet(sh) {
  return {
    form: sh.form, ...(sh.band ? { band: sh.band } : {}), master: sh.master || 'clean', ...(sh.masterParams ? { masterParams: sh.masterParams } : {}),
    bpm: sh.bpm, meter: normMeter(sh.meter), key: sh.key, scale: sh.scale, hook: sh.hook,
    chords: Object.fromEntries(Object.entries(sh.chords).map(([k, v]) => [k, v.replace(/^<|>$/g, '')])),
    parts: sh.parts.map((p) => ({ name: p.id, role: p.role, sound: p.sound, variants: p.variants, desc: p.desc })),
    sections: sh.sections.map((x) => ({ name: x.name, bars: x.bars, chords: x.chords, play: x.play.map((y) => (y.variant === 'main' ? y.part : `${y.part}.${y.variant}`) + (y.enter ? `@${y.enter}` : '')), ...(x.shift ? { shift: x.shift } : {}), ...(x.bpm ? { bpm: x.bpm } : {}) })),
  };
}
/**
 * Apply a new sheet and/or parts code to a song. Checks the parts (names, sounds, a silent test
 * play) and re-arranges the sections; a playing song switches to the new arrangement from its
 * next section. Returns an error message, or null.
 */
export async function applySongEdit(sg, raw, partsCode = null) {
  let sheet;
  try { sheet = normalizeSheet(raw, 'auto', { enforceForm: false }); } catch (e) { return `the song sheet can't be used: ${e.message}`; }
  let lib = partsCode ? `${tempoLine(sheet.bpm, sheet.meter)}\n` + partsCode.replace(/^\s*setcp[ms]\([^)]*\)\s*;?\s*$/gm, '').trim() : sg.library.replace(/setcp[ms]\([^)]*\)/, tempoLine(sheet.bpm, sheet.meter));
  const missing = libraryIds(sheet).filter((id) => !definesId(lib, id));
  if (missing.length) return `the parts code is missing: ${missing.join(', ')} (every part.variant the sections play needs a const)`;
  if (patternLines(lib).length) return 'the parts code must only contain const definitions (no "name:" lines)';
  const syn = syntaxError(lib);
  if (syn) return `the parts code has a syntax error: ${syn}`;
  const prep = await prepareCode(lib, { quiet: true, library: true });
  if (prep.error) return prep.error;
  lib = prep.code;
  const testErr = testLibrary(lib, sheet);
  if (testErr) return `the parts fail when test-played: ${testErr.message}`;
  sg.sheet = sheet;
  sg.library = wrapCode(lib);
  rearrangeSong(sg);
  if (isMine(sg)) saveMySongs();
  songsChanged();
  const tempos = sheet.sections.map((x) => `${x.name} ${x.bpm || sheet.bpm}${x.shift ? ` key ${signed(x.shift)}` : ''}`).join(' · ');
  clog('ok', `🎵 “${sg.title}” updated: ${sheet.sections.length} sections, ${sheet.sections.reduce((a, x) => a + x.bars, 0)} bars — ${tempos} bpm`);
  return null;
}
/**
 * After a song edit: switch the section that's playing to its new version on the next bar (keeping faders,
 * mute / solo and its place in the phrase). Returns true when it did.
 */
export async function refreshPlayingSection(sg) {
  if (!queue.running || queue.songs[queue.current] !== sg || state.pending || engine.paused || !isPlaying()) return false;
  const st = engine.steps.find((x) => x.status === 'playing' && x.song === sg);
  const sec = st?.section && sg.sheet.sections.find((x) => x.name === st.section.name);
  if (!sec) return false;
  const code = atSectionStart(carryLiveState(getCode(), sectionCode(sg, sec, { fill: !!st.fillStep })), st.startedAt ?? 0);
  const err = await evaluateCode(code, { at: nextBoundary(1), fade: fadeCycles(sg), label: `“${sg.title}” ${st.prompt} (edited)` });
  if (err) { clog('warn', `the edited ${st.prompt} didn't play (${err.message}) — it changes from the next section`); return false; }
  st.code = code;
  st.section = sec;
  return true;
}

/** Rebuild a song's sections; if it's in the player, replace the ones that haven't started. */
function rearrangeSong(sg) {
  const fresh = arrangeSong(sg);
  fresh.forEach((st) => Object.assign(st, { song: sg }));
  const inEngine = sg.blocks?.some((b) => engine.steps.includes(b));
  if (!inEngine) {
    sg.blocks = fresh;
  } else {
    const started = sg.blocks.filter((b) => ['playing', 'done', 'armed'].includes(b.status) && engine.steps.includes(b));
    const lastStarted = started[started.length - 1];
    const fromSec = lastStarted ? sg.sheet.sections.findIndex((x) => x.name === lastStarted.section?.name) + 1 || started.filter((b) => !b.fillStep).length : 0;
    const tail = fresh.filter((st) => sg.sheet.sections.indexOf(st.section) >= fromSec);
    const pending = sg.blocks.filter((b) => !started.includes(b));
    const at = pending.length ? engine.steps.indexOf(pending[0]) : engine.steps.indexOf(lastStarted) + 1;
    engine.steps = engine.steps.filter((b) => !pending.includes(b));
    engine.steps.splice(at, 0, ...tail);
    if (engine.playIndex > at) engine.playIndex = at;
    engine.genIndex = Math.min(engine.genIndex, at);
    sg.blocks = [...started, ...tail];
  }
  sg.blocks.forEach((st, j) => Object.assign(st, { song: sg, songPos: j, songLen: sg.blocks.length, songStart: j === 0 }));
  sg.bars = sg.blocks.reduce((a, b) => a + b.bars, 0);
  sg.firstStep = sg.blocks[0];
  if (padsState.owner === sg) loadPads(sg.pads, sg);
}

// ✎ Edit song: a panel with the song's sections / chords / parts as text lines and its parts code
export const songEdit = { sg: null };
export function openSongEditor(sg) {
  songEdit.sg = sg;
  $('editForm').__sg = null; // render the editor for this song
  ws.open('edit');
  ws.api?.getPanel('edit')?.api.setTitle?.(`✎ ${sg.title}`);
  songsChanged();
  renderSongs();
}
/** The ✎ Edit song form for a song (its fields are filled in as .value, so re-rendering after ✓ apply updates them). */
export function songEditorTemplate(sg) {
  const r = rawSheet(sg.sheet);
  const sections = r.sections.map((x) => `${x.name} | ${x.bars} | ${x.chords} | ${x.play.join(', ')}${x.shift || x.bpm ? ` | ${[x.shift ? `key ${signed(x.shift)}` : '', x.bpm ? `${x.bpm} bpm` : ''].filter(Boolean).join(', ')}` : ''}`).join('\n');
  return html`<div class="sv-edit">
    <div class="sv-edit-row"><label>title <input data-f="title" .value=${sg.title} /></label><label>bpm <input data-f="bpm" type="number" min="50" max="200" .value=${String(r.bpm)} /></label><label>meter <select data-f="meter">${METERS.map((m) => html`<option ?selected=${m === r.meter}>${m}</option>`)}</select></label><label>scale <input data-f="scale" .value=${r.scale} /></label><label title="The master style: the mastering on the whole song (tweak it live in 🎛 Master)">master <select data-f="master">${STYLE_NAMES.map((n) => html`<option ?selected=${n === r.master}>${n}</option>`)}</select></label></div>
    <label>chords — <span class="muted">one per line: <code>name: Am F C G</code></span>
      <textarea data-f="chords" rows="3" .value=${Object.entries(r.chords).map(([k, v]) => `${k}: ${v}`).join('\n')}></textarea></label>
    <label>sections — <span class="muted">one per line: <code>name | bars | chords | parts (part or part.variant)</code>, optionally <code>| key +2, 106 bpm</code></span>
      <textarea data-f="sections" rows=${Math.min(14, r.sections.length + 1)} .value=${sections}></textarea></label>
    <label>parts — <span class="muted">one per line: <code>name | role | sound | variants</code></span>
      <textarea data-f="parts" rows=${Math.min(8, r.parts.length + 1)} .value=${r.parts.map((p) => `${p.name} | ${p.role} | ${p.sound} | ${p.variants.join(', ')}`).join('\n')}></textarea></label>
    <label>parts code — <span class="muted">a <code>const name_variant = …</code> for every part.variant the sections use (harmonic parts take <code>(prog)</code>)</span>
      <textarea data-f="library" rows="10" spellcheck="false" .value=${sg.library}></textarea></label>
    <div class="sl-buttons"><button data-act="edit-save">✓ apply</button><button data-act="edit-cancel" class="link">cancel</button><span class="sv-edit-msg muted small"></span></div>
    <div class="muted small">Or ask the chat: “make the chorus 16 bars”, “add a breakdown before the last chorus”, “give the bass a funkier line”.</div>
  </div>`;
}
export async function saveSongEditor(el, sg) {
  const v = (f) => el.querySelector(`[data-f="${f}"]`).value;
  const lines = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean);
  const raw = rawSheet(sg.sheet);
  raw.bpm = Number(v('bpm')) || raw.bpm;
  raw.meter = v('meter') || raw.meter;
  raw.scale = v('scale').trim() || raw.scale;
  raw.key = raw.scale.replace(':', ' ');
  if (v('master') !== raw.master) { raw.master = v('master'); delete raw.masterParams; } // a new style starts from its own settings
  raw.chords = Object.fromEntries(lines(v('chords')).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }).filter(([k, c]) => k && c));
  raw.parts = lines(v('parts')).map((l) => { const [name, role, sound, variants] = l.split('|').map((x) => (x || '').trim()); return { name, role, sound, variants: (variants || 'main').split(/[,\s]+/).filter(Boolean) }; });
  raw.sections = lines(v('sections')).map((l) => {
    const [name, bars, chords, play, moves = ''] = l.split('|').map((x) => (x || '').trim());
    return { name, bars: Number(bars) || 8, chords, play: (play || '').split(/[,\s]+/).filter(Boolean),
      shift: Number(moves.match(/key\s*([+-]?\d+)/i)?.[1]) || 0, bpm: Number(moves.match(/(\d+)\s*bpm/i)?.[1]) || 0 };
  });
  const msg = el.querySelector('.sv-edit-msg');
  msg.classList.remove('bad'); // (the form keeps its DOM between renders)
  msg.textContent = 'checking…';
  const title = v('title').trim();
  const err = await applySongEdit(sg, raw, v('library'));
  if (err) { msg.textContent = `⚠ ${err}`; msg.classList.add('bad'); return; }
  if (title) sg.title = title;
  if (isMine(sg)) saveMySongs();
  $('editForm').__sg = null; // re-render the editor with the song as it is now
  songsChanged();
  renderSongs();
  const done = $('editForm').querySelector('.sv-edit-msg');
  if (done) done.textContent = `✓ applied${queue.running && queue.songs[queue.current] === sg ? ' — from the next section' : ''}${isMine(sg) ? ' and saved' : ' (📁 Save to My songs to keep it)'}`;
}

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  // closing ✎ Edit song stops editing
  ws.on('edit', { onOpen: (o) => { if (!o && songEdit.sg) { songEdit.sg = null; songsChanged(); } } });
}
