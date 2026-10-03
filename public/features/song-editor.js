// ✎ Edit song: changing a song's sheet (sections, chords, parts) and parts code by hand. The app re-arranges it
// (no AI); a playing song switches to the new version from its next section.
// (split out of app.js: start-up code runs in setup(), called from app.js)
import { METERS, normMeter, tempoLine } from '../lib/music.js';
import { definesId, libraryIds, normFeel, STYLE_FEEL } from '../lib/sheet.js';
import { patternLines } from '../lib/labels.js';
import { wrapCode } from '../format.js';
import { isMine, saveMySongs } from './song-library.js';
import { signed } from '../lib/util.js';
import { arrangeSong, carryLiveState, sectionCode } from '../lib/arrange.js';
import { loadPads, padsState } from './pads.js';
import { STYLE_NAMES } from '../master.js';
import { $, atSectionStart, clog, engine, evaluateCode, fadeCycles, getCode, isPlaying, jumpTo, nextBoundary, queue, setHold, state, ws } from '../app.js';
import { normalizeSheet } from './bands.js';
import { prepareCode } from './sound-check.js';
import { songsChanged, renderSongs } from './song-lists.js';
import { syntaxError } from './llm.js';
import { testLibrary } from './song-writer.js';
import { nothing, render } from '../html.js';
import { splitLibrary, joinLibrary, renameDef, stubDef } from '../lib/library.js';
import { BAND_ROLES } from '../lib/bands.js';
import { vizColor } from './visualizer.js';
import { playSong } from './song-library.js';
import { T } from '../templates/index.js';
// --- editing a song: re-arranged by the app (no AI), live if it's playing
export function rawSheet(sh) {
  return {
    form: sh.form, ...(sh.band ? { band: sh.band } : {}), master: sh.master || 'clean', ...(sh.masterParams ? { masterParams: sh.masterParams } : {}),
    bpm: sh.bpm, meter: normMeter(sh.meter), key: sh.key, scale: sh.scale, hook: sh.hook, ...(sh.melody ? { melody: sh.melody } : {}),
    chords: Object.fromEntries(Object.entries(sh.chords).map(([k, v]) => [k, v.replace(/^<|>$/g, '')])),
    parts: sh.parts.map((p) => ({ name: p.id, role: p.role, sound: p.sound, variants: p.variants, desc: p.desc, ...(p.tune ? { tune: p.tune } : {}) })),
    sections: sh.sections.map((x) => ({ name: x.name, bars: x.bars, chords: x.chords, play: x.play.map((y) => (y.variant === 'main' ? y.part : `${y.part}.${y.variant}`) + (y.enter ? `@${y.enter}` : '')), ...(x.shift ? { shift: x.shift } : {}), ...(x.bpm ? { bpm: x.bpm } : {}), ...(x.level ? { level: x.level } : {}), ...(x.solo ? { solo: x.solo } : {}) })),
    ending: sh.ending || 'fade', ...(sh.feel != null ? { feel: sh.feel } : {}),
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
  // the song and its copies (a song queued again plays a copy) all get the new version
  for (const x of [sg, ...linkedSongs(sg)]) {
    x.sheet = sheet;
    x.library = wrapCode(lib);
    rearrangeSong(x);
  }
  if ([sg, ...linkedSongs(sg)].some(isMine)) saveMySongs();
  songsChanged();
  const tempos = sheet.sections.map((x) => `${x.name} ${x.bpm || sheet.bpm}${x.shift ? ` key ${signed(x.shift)}` : ''}`).join(' · ');
  clog('ok', `🎵 “${sg.title}” updated: ${sheet.sections.length} sections, ${sheet.sections.reduce((a, x) => a + x.bars, 0)} bars — ${tempos} bpm`);
  return null;
}
/** The other copies of a song: its original, and the copies of it queued in the playlist. */
export function linkedSongs(sg) {
  const root = sg.copyOf || sg;
  return [root, ...queue.songs.filter((x) => x.copyOf === root)].filter((x, k, all) => x !== sg && all.indexOf(x) === k);
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
  const code = atSectionStart(carryLiveState(getCode(), sectionCode(sg, sec, { fill: st.fillStep || false })), st.startedAt ?? 0);
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
// --- the editor: a draft of the song (sheet + parts code split per part), edited by hand, applied with ✓ apply ---
let draft = null;
const parsePlay = (str) => { const m = /^([^.@]+)(?:\.([^@]+))?(?:@(\w+))?$/.exec(str) || []; return { part: m[1] || str, variant: m[2] || 'main', enter: m[3] || '' }; };
const playStr = ({ part, variant, enter }) => `${part}${variant && variant !== 'main' ? `.${variant}` : ''}${enter ? `@${enter}` : ''}`;
const ENTERS = ['', 'in', 'out', 'alt'];
const ENTER_TITLE = { in: 'comes in halfway through', out: 'drops out halfway through', alt: '2 bars on, 2 bars off' };

/** Start editing a song: a copy of its sheet and its parts code, one definition per part and variant. */
function openDraft(sg, keep = null) {
  const { defs } = splitLibrary(sg.library);
  draft = { sg, title: sg.title, raw: rawSheet(sg.sheet), defs, sel: keep?.sel ?? 0, open: keep?.open ?? new Set(), dirty: false, msg: keep?.msg || '', bad: false, drag: null };
  draft.sel = Math.min(draft.sel, draft.raw.sections.length - 1);
}
function changed(msg = '') { draft.dirty = true; draft.msg = msg; draft.bad = false; renderSongEditor(); }
const partOf = (name) => draft.raw.parts.find((p) => p.name === name);
const defsOf = (name) => draft.defs.filter((d) => d.id.startsWith(`${name}_`));
const ensureDef = (part, variant) => {
  const id = `${part.name}_${variant}`;
  if (!draft.defs.some((d) => d.id === id)) draft.defs.push({ id, code: stubDef(id, { role: part.role, sound: part.sound, scale: draft.raw.scale }) });
};
const uniqueName = (base, taken) => { let n = base, k = 2; while (taken.includes(n)) n = `${base} ${k++}`; return n; };

/** Every edit the editor makes (templates/song-editor.js calls these). */
const edit = {
  field(k, v) {
    if (k === 'title') draft.title = v.trim() || draft.title;
    else if (k === 'bpm') draft.raw.bpm = Number(v) || draft.raw.bpm;
    else if (k === 'scale') { draft.raw.scale = v.trim() || draft.raw.scale; draft.raw.key = draft.raw.scale.replace(':', ' '); }
    else if (k === 'feel') draft.raw.feel = normFeel(Number(v) / 100) ?? 0;
    else if (k === 'master') { draft.raw.master = v; delete draft.raw.masterParams; } // a new style starts from its own settings
    else if (k === 'hook' || k === 'melody') {
      // the part that plays the tune has it in its code: change it there too
      const old = draft.raw[k], now = v.trim();
      if (!now || now === old) return;
      draft.raw[k] = now;
      const p = draft.raw.parts.find((x) => x.tune === k);
      if (p && old) for (const d of defsOf(p.name)) d.code = d.code.split(`"${old}"`).join(`"${now}"`);
    }
    else draft.raw[k] = v;
    changed();
  },
  selectSection(i) { draft.sel = i; renderSongEditor(); },
  sectionField(i, k, v) {
    const sec = draft.raw.sections[i];
    if (k === 'name') sec.name = v.trim() || sec.name;
    else if (k === 'bars') sec.bars = Math.max(1, Math.min(64, Math.round(Number(v) || sec.bars)));
    else if (k === 'shift') { const n = Math.round(Number(v) || 0); if (n) sec.shift = n; else delete sec.shift; }
    else if (k === 'bpm') { const n = Math.round(Number(v) || 0); if (n) sec.bpm = n; else delete sec.bpm; }
    else if (k === 'level') { const n = Math.round(Number(v) || 100) / 100; if (Math.abs(n - 1) > 0.01) sec.level = Math.max(0.3, Math.min(1.3, n)); else delete sec.level; }
    else if (k === 'solo') { if (v) { sec.solo = v; if (!sec.play.some((str) => parsePlay(str).part === v)) sec.play.push(v); } else delete sec.solo; }
    else sec[k] = v;
    changed();
  },
  moveSection(i, d) {
    const secs = draft.raw.sections, j = i + d;
    if (j < 0 || j >= secs.length) return;
    [secs[i], secs[j]] = [secs[j], secs[i]];
    draft.sel = j;
    changed();
  },
  dupSection(i) {
    const secs = draft.raw.sections, copy = JSON.parse(JSON.stringify(secs[i]));
    copy.name = uniqueName(copy.name.replace(/ \d+$/, ''), secs.map((x) => x.name));
    secs.splice(i + 1, 0, copy);
    draft.sel = i + 1;
    changed();
  },
  delSection(i) {
    if (draft.raw.sections.length <= 1) { draft.msg = 'a song needs at least one section'; draft.bad = true; renderSongEditor(); return; }
    draft.raw.sections.splice(i, 1);
    draft.sel = Math.max(0, Math.min(draft.sel, draft.raw.sections.length - 1));
    changed();
  },
  addSection() {
    const secs = draft.raw.sections, last = secs[secs.length - 1];
    secs.push({ name: uniqueName('section', secs.map((x) => x.name)), bars: 8, chords: last?.chords || Object.keys(draft.raw.chords)[0], play: last ? [...last.play] : [] });
    draft.sel = secs.length - 1;
    changed();
  },
  dragSection(i) { draft.drag = i; },
  dropSection(i) {
    const from = draft.drag;
    draft.drag = null;
    if (from == null || from === i) return;
    const secs = draft.raw.sections, [sec] = secs.splice(from, 1);
    secs.splice(i, 0, sec);
    draft.sel = i;
    changed();
  },
  /** A grid cell: off → main → the part's other variants → off. */
  cell(name, i) {
    const sec = draft.raw.sections[i], part = partOf(name);
    const plays = sec.play.map(parsePlay), k = plays.findIndex((x) => x.part === name);
    const variants = part.variants.length ? part.variants : ['main'];
    if (k < 0) plays.push({ part: name, variant: variants[0], enter: '' });
    else {
      const next = variants.indexOf(plays[k].variant) + 1;
      if (next >= variants.length) plays.splice(k, 1); else plays[k].variant = variants[next];
    }
    sec.play = plays.map(playStr);
    changed();
  },
  /** Right-click a cell: how the part enters — all along, comes in halfway, drops out halfway, alternates. */
  cellEnter(name, i) {
    const sec = draft.raw.sections[i], plays = sec.play.map(parsePlay), x = plays.find((y) => y.part === name);
    if (!x) return;
    x.enter = ENTERS[(ENTERS.indexOf(x.enter) + 1) % ENTERS.length];
    sec.play = plays.map(playStr);
    changed();
  },
  chordName(old, name) {
    name = name.trim();
    if (!name || name === old || draft.raw.chords[name]) { renderSongEditor(); return; }
    draft.raw.chords = Object.fromEntries(Object.entries(draft.raw.chords).map(([k, v]) => [k === old ? name : k, v]));
    for (const sec of draft.raw.sections) if (sec.chords === old) sec.chords = name;
    changed();
  },
  chords(name, text) { draft.raw.chords[name] = text.trim(); changed(); },
  addChords() {
    const name = uniqueName('progression', Object.keys(draft.raw.chords));
    draft.raw.chords[name] = Object.values(draft.raw.chords)[0] || 'C G Am F';
    changed();
  },
  delChords(name) {
    const rest = Object.keys(draft.raw.chords).filter((k) => k !== name);
    if (!rest.length) { draft.msg = 'a song needs at least one chord progression'; draft.bad = true; renderSongEditor(); return; }
    delete draft.raw.chords[name];
    for (const sec of draft.raw.sections) if (sec.chords === name) sec.chords = rest[0];
    changed();
  },
  partField(i, k, v) {
    const part = draft.raw.parts[i];
    if (k === 'name') {
      const name = v.trim().replace(/[^\w]/g, '_');
      if (!name || name === part.name || partOf(name)) { renderSongEditor(); return; }
      for (const d of defsOf(part.name)) Object.assign(d, renameDef(d, `${name}_${d.id.slice(part.name.length + 1)}`));
      for (const sec of draft.raw.sections) sec.play = sec.play.map((str) => { const x = parsePlay(str); return x.part === part.name ? playStr({ ...x, part: name }) : str; });
      if (draft.open.delete(part.name)) draft.open.add(name);
      part.name = name;
    } else if (k === 'variants') {
      const vars = [...new Set(['main', ...v.split(/[,\s]+/).map((x) => x.trim().replace(/[^\w]/g, '_')).filter(Boolean)])];
      part.variants = vars;
      for (const x of vars) ensureDef(part, x);
      // sections that played a variant that's gone play main
      for (const sec of draft.raw.sections) sec.play = sec.play.map((str) => { const x = parsePlay(str); return x.part === part.name && !vars.includes(x.variant) ? playStr({ ...x, variant: 'main' }) : str; });
      draft.defs = draft.defs.filter((d) => !d.id.startsWith(`${part.name}_`) || vars.includes(d.id.slice(part.name.length + 1)) || /^fill\d*$/.test(d.id.slice(part.name.length + 1)));
    } else part[k] = v.trim();
    changed();
  },
  addPart() {
    const name = uniqueName('part', draft.raw.parts.map((p) => p.name)).replace(/\s/g, '');
    const part = { name, role: 'melody', sound: 'triangle', variants: ['main'], desc: '' };
    draft.raw.parts.push(part);
    ensureDef(part, 'main');
    draft.open.add(name);
    changed('a new part: pick its role and sound, switch it on in the sections (the grid), and edit its code');
  },
  delPart(i) {
    const part = draft.raw.parts[i];
    if (!confirm(`Delete the part “${part.name}” and its code?`)) return;
    draft.raw.parts.splice(i, 1);
    draft.defs = draft.defs.filter((d) => !d.id.startsWith(`${part.name}_`));
    for (const sec of draft.raw.sections) sec.play = sec.play.filter((str) => parsePlay(str).part !== part.name);
    changed();
  },
  togglePart(i) { const n = draft.raw.parts[i].name; if (!draft.open.delete(n)) draft.open.add(n); renderSongEditor(); },
  def(id, code) {
    const d = draft.defs.find((x) => x.id === id);
    if (d) d.code = code.trim();
    changed();
  },
  /** ✨ ask the AI about one part: a whole-song chat request about that part. */
  ask(name, text) {
    if (draft.dirty) { draft.msg = '✓ apply (or ↺ revert) your changes first — the AI works on the song as it is'; draft.bad = true; renderSongEditor(); return; }
    $('chatTarget').value = 'song';
    $('chatTarget').dispatchEvent(new Event('change'));
    $('input').value = `In the part "${name}" (${partOf(name)?.role}, ${partOf(name)?.sound}): ${text}`;
    ws.open('chat', { activate: false });
    $('chat-form').requestSubmit();
    draft.msg = `✨ asked the AI about ${name} — the song updates when it answers`;
    renderSongEditor();
  },
  async apply() {
    const sg = draft.sg;
    draft.msg = 'checking…';
    draft.bad = false;
    renderSongEditor();
    const err = await applySongEdit(sg, JSON.parse(JSON.stringify(draft.raw)), joinLibrary({ defs: draft.defs }));
    if (err) { draft.msg = `⚠ ${err}`; draft.bad = true; renderSongEditor(); return; }
    for (const x of [sg, ...linkedSongs(sg)]) x.title = draft.title;
    if ([sg, ...linkedSongs(sg)].some(isMine)) saveMySongs();
    const live = [sg, ...linkedSongs(sg)].find((x) => queue.running && queue.songs[queue.current] === x);
    const playing = !!live;
    const now = playing && await refreshPlayingSection(live); // the section playing switches over on the next bar
    openDraft(sg, { sel: draft.sel, open: draft.open, msg: `✓ applied${now ? ' — you hear it from the next bar' : playing ? ' — from the next section' : ''}${isMine(sg) ? ' and saved' : ' (📁 Save to My songs to keep it)'}` });
    songsChanged();
    renderSongs();
    renderSongEditor();
  },
  revert() { openDraft(draft.sg, { sel: draft.sel, open: draft.open, msg: '↺ back to the song as it is' }); renderSongEditor(); },
  close() { ws.close('edit'); songEdit.sg = null; draft = null; songsChanged(); renderSongs(); },
  play() { playSong(draft.sg); },
  jump(i) { const k = stepOf(i); if (k >= 0) jumpTo(k); },
  loop(i) { const k = stepOf(i); if (k >= 0) { jumpTo(k); setHold(true); } },
};
/** The engine step of section i of the song being edited (when it's playing and the draft matches it). */
function stepOf(i) {
  const songs = [draft.sg, ...linkedSongs(draft.sg)];
  return engine.steps.findIndex((st) => songs.includes(st.song) && st.section === st.song.sheet.sections[i] && !st.fillStep && st.status !== 'done');
}

/** The ✎ Edit song editor (templates/song-editor.js) for the song being edited. */
export function renderSongEditor() {
  const sg = songEdit.sg;
  if (!sg?.sheet || !sg.library) { draft = null; render(nothing, $('editForm')); return; }
  if (draft?.sg !== sg) openDraft(sg);
  const r = draft.raw;
  const playing = queue.running && [sg, ...linkedSongs(sg)].includes(queue.songs[queue.current]);
  const parts = r.parts.map((p) => p.name);
  render(T.songEditor({
    title: draft.title, bpm: r.bpm, meter: r.meter, meters: METERS, scale: r.scale, master: r.master, masters: STYLE_NAMES, melody: r.melody || '', hook: r.hook || '',
    dirty: draft.dirty, msg: draft.msg, bad: draft.bad, playing, canJump: playing && !draft.dirty,
    sections: r.sections.map((x, i) => ({ i, name: x.name, bars: x.bars, chords: x.chords, selected: i === draft.sel, solo: x.solo || '', level: x.level || 1 })),
    totalBars: r.sections.reduce((a, x) => a + x.bars, 0),
    sel: r.sections[draft.sel] ? { i: draft.sel, name: r.sections[draft.sel].name, bars: r.sections[draft.sel].bars, chords: r.sections[draft.sel].chords, shift: r.sections[draft.sel].shift || '', bpm: r.sections[draft.sel].bpm || '',
      level: Math.round((r.sections[draft.sel].level || 1) * 100), solo: r.sections[draft.sel].solo || '' } : null,
    ending: r.ending || 'fade', feel: Math.round((r.feel ?? STYLE_FEEL[r.master] ?? 0) * 100), partNames: parts,
    chordNames: Object.keys(r.chords),
    grid: {
      parts: parts.map((name) => ({ name, color: vizColor(name) })),
      rows: parts.map((name) => r.sections.map((sec) => {
        const x = sec.play.map(parsePlay).find((y) => y.part === name);
        if (!x) return { state: 'off', label: '', enter: '', title: `${name} doesn't play in ${sec.name} — click to add it` };
        return { state: x.variant === 'main' ? 'main' : 'variant', label: sec.solo === name ? `★ ${x.variant === 'main' ? '' : x.variant}`.trim() : x.variant === 'main' ? '●' : x.variant, enter: x.enter,
          title: `${name}${x.variant === 'main' ? '' : `.${x.variant}`} in ${sec.name}${x.enter ? ` (${ENTER_TITLE[x.enter]})` : ''} — click: next variant / off · right-click: how it enters` };
      })),
    },
    chords: Object.entries(r.chords).map(([name, chords]) => ({ name, chords, used: r.sections.some((x) => x.chords === name) })),
    parts: r.parts.map((p, i) => ({ i, name: p.name, role: p.role, sound: p.sound, variants: p.variants.join(', '), color: vizColor(p.name), open: draft.open.has(p.name), defs: defsOf(p.name) })),
    roles: BAND_ROLES,
  }, edit), $('editForm'));
}

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  // closing ✎ Edit song stops editing
  ws.on('edit', { onOpen: (o) => { if (!o && songEdit.sg) { songEdit.sg = null; songsChanged(); } } });
}
