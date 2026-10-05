// ---------------------------------------------------------------------------
// 🧩 Part editor: one part of the song open in ✎ Edit song, on its own. Loop it (alone, or with the rest of a section,
// over that section's chords) and hear every change as you make it; shape its sound with its effects; change its
// notes on a staff (melodies: scale degrees or note names) or a grid (drums, chord tones, sample hits, rhythms) or
// level bars (velocity). It edits ✎ Edit song's draft, so ✓ apply there (or here) puts it into the song.
// ---------------------------------------------------------------------------
import { $, engine, evaluateCode, isPlaying, mirror, pauseSong, ws } from '../app.js';
import { render, nothing } from '../html.js';
import { T } from '../templates/index.js';
import { currentDraft, setDraftDef, applyDraft, revertDraft } from './song-editor.js';
import { normalizeSheet } from './bands.js';
import { vizColor } from './visualizer.js';
import { joinLibrary } from '../lib/library.js';
import { tempoLine } from '../lib/music.js';
import { sectionCode } from '../lib/arrange.js';
import { EFFECTS, readEffects, setEffect, addEffect, removeEffect, readSources, setSource } from '../lib/partcode.js';
import { parseMini, serializeMini, withGrid, eventAt, placeNote, removeNote, resizeNote, toggleAt, gridSteps } from '../lib/mini-edit.js';
import { parseScale, degreeToMidi, midiToDegree, noteToMidi, midiToNote, clefFor, staffPos, stepToMidi } from '../lib/staff.js';
import { VOICES, voiceLine, addVoice, removeVoice, readLayers, canLayer, addLayer, removeLayer } from '../lib/poly.js';

// the scale table (/scale-intervals.json); a few common ones until it has loaded
let SCALES = { major: '1P 2M 3M 4P 5P 6M 7M', minor: '1P 2M 3m 4P 5P 6m 7m', dorian: '1P 2M 3m 4P 5P 6M 7m', mixolydian: '1P 2M 3M 4P 5P 6M 7m' };
const STEP_OPTIONS = [2, 3, 4, 6, 8, 12, 16, 24, 32];
/** What's open: the part, its variant, the section whose chords it loops over, the note pattern, the selection. */
const pe = { part: null, variant: 'main', section: 0, solo: true, playing: false, src: 0, steps: null, sel: null, rows: [], msg: '', bad: false, chord: false };
/** Each voice's colour on the staff (the first: the part's own). */
const VOICE_COLORS = ['var(--c)', '#f0a040', '#40b8e0', '#c070e0'];
const isVoice = (s) => s.kind === 'degree' || s.kind === 'pitch';

/** Open a part of the song in ✎ Edit song. */
export function openPartEditor(part, variant = 'main') {
  const d = currentDraft();
  if (!d) return;
  Object.assign(pe, { part, variant, src: 0, steps: null, sel: null, rows: [], msg: '', bad: false });
  pe.section = firstSectionOf(d, part, variant);
  ws.open('part');
  renderPartEditor();
}

const playOf = (str) => { const [name, how] = String(str).split('@'); const [part, variant = 'main'] = name.split(/[.:]/); return { part, variant, how }; };
function firstSectionOf(d, part, variant) {
  const k = d.raw.sections.findIndex((s) => s.play.some((x) => { const p = playOf(x); return p.part === part && p.variant === variant; }));
  return k >= 0 ? k : Math.max(0, d.raw.sections.findIndex((s) => s.play.some((x) => playOf(x).part === part)));
}
const defId = () => `${pe.part}_${pe.variant}`;
const curDef = () => currentDraft()?.defs.find((x) => x.id === defId()) || null;

// --- the note pattern being edited ---------------------------------------------------------------------------
function sources() { const def = curDef(); return def ? readSources(def.code) : []; }
function curSource() { const s = sources(); return s[Math.min(pe.src, s.length - 1)] || null; }
/** The scale of a degree pattern (its .scale(…), else the song's). */
function scaleOf(src) {
  const d = currentDraft();
  return parseScale(src?.scale || d?.raw.scale || 'C:major', SCALES) || parseScale('C:major', SCALES);
}
/** The bars of the current pattern on the editor's grid, or { error }. */
function model(src) {
  const m = parseMini(src.value);
  if (m.error) return m;
  const steps = pe.steps || Math.max(...m.bars.map((b) => gridSteps(b, src.kind === 'drums' || src.kind === 'rhythm' ? 8 : 4)));
  return { ...m, steps, bars: m.bars.map((b) => withGrid(b, steps)) };
}
/** Write bars back into the part's code (and hear it). */
function commit(src, m, msg = '') {
  const def = curDef();
  if (!def) return;
  setDraftDef(def.id, setSource(def.code, src, serializeMini(m)), msg);
  live();
}

/** A pattern value → MIDI (staff kinds). */
function midiOf(src, val) {
  if (src.kind === 'degree') { const sc = scaleOf(src); return sc ? degreeToMidi(val, sc) : null; }
  return noteToMidi(val);
}
/** MIDI → a pattern value in the pattern's own terms (degree, note name, or MIDI number). */
function valOf(src, midi, like) {
  if (src.kind === 'degree') return String(midiToDegree(midi, scaleOf(src)));
  if (/^-?\d+$/.test(String(like ?? ''))) return String(midi);
  return midiToNote(midi, scaleOf(src)?.flats);
}
/** Move a value: by scale steps (degrees) or semitones (notes); octave = a whole octave. */
function shiftVal(src, val, n, octave) {
  if (src.kind === 'degree') { const len = scaleOf(src)?.steps.length || 7; const d = Number(val); return Number.isInteger(d) ? String(d + (octave ? n * len : n)) : val; }
  const m = noteToMidi(val);
  return m == null ? val : valOf(src, m + (octave ? 12 * n : n), val);
}

// --- playing it -------------------------------------------------------------------------------------------------
function auditionCode() {
  const d = currentDraft();
  let sheet;
  try { sheet = normalizeSheet(JSON.parse(JSON.stringify(d.raw)), 'auto', { enforceForm: false }); } catch { sheet = d.sg.sheet; }
  const sec = sheet.sections[pe.section] || sheet.sections[0];
  const others = sec.play.filter((x) => x.part !== pe.part).map((x) => ({ part: x.part, variant: x.variant }));
  const play = [...(pe.solo ? [] : others), { part: pe.part, variant: pe.variant }];
  const library = joinLibrary({ head: tempoLine(sec.bpm || sheet.bpm, sheet.meter), defs: d.defs });
  return sectionCode({ title: d.title, sheet, library }, { ...sec, play });
}
async function play() {
  // the song pauses where it is (section and bar), so it can carry on afterwards with your changes
  if (engine.running && !engine.paused && isPlaying()) pauseSong();
  if (engine.running && !engine.paused) $('stop').onclick?.(); // (a song that couldn't pause would take over again)
  const err = await evaluateCode(auditionCode(), { label: `🧩 ${pe.part}`, undo: false });
  pe.playing = !err;
  pe.msg = err ? `⚠ it doesn't play: ${err.message}` : `▶ looping ${pe.part} (${pe.variant}) over ${currentDraft()?.raw.sections[pe.section]?.name || 'the section'} — changes play as you make them${engine.paused ? ' · the song is paused: ■ stop, ✓ apply, then ▶ in 🎶 Now playing carries on' : ''}`;
  pe.bad = !!err;
  renderPartEditor();
}
let liveTimer = null;
/** After a change: play the new version (if looping). */
function live() {
  if (!pe.playing) return;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(async () => {
    const err = await evaluateCode(auditionCode(), { label: `🧩 ${pe.part}`, undo: false });
    pe.msg = err ? `⚠ this change doesn't play: ${err.message}` : '';
    pe.bad = !!err;
    renderPartEditor();
  }, 150);
}
function stop() {
  mirror()?.stop();
  pe.playing = false;
  pe.msg = engine.paused ? `■ stopped — the song is paused at ${engine.paused.step.prompt || 'its section'}: ✓ apply, then ▶ in 🎶 Now playing carries on with your changes` : '';
  renderPartEditor();
}

// --- what the template calls --------------------------------------------------------------------------------------
const act = {
  variant(v) { pe.variant = v; pe.src = 0; pe.steps = null; pe.sel = null; pe.section = firstSectionOf(currentDraft(), pe.part, v); renderPartEditor(); live(); },
  section(i) { pe.section = i; renderPartEditor(); live(); },
  play, stop,
  solo(on) { pe.solo = on; renderPartEditor(); live(); },
  effect(i, value) {
    const def = curDef(), e = def && readEffects(def.code)[i];
    if (!e) return;
    // numbers on the effect's own step (a log slider gives 894.4272 → 894)
    const st = EFFECTS[e.key]?.step;
    if (st && (e.kind === 'slider' || e.kind === 'number')) value = Math.round(Math.round(Number(value) / st) * st * 1e6) / 1e6;
    setDraftDef(def.id, setEffect(def.code, e, value));
    live();
  },
  effectText(i, text) { act.effect(i, text); },
  addEffect(key) { const def = curDef(); if (def) { setDraftDef(def.id, addEffect(def.code, key)); live(); } },
  removeEffect(i) { const def = curDef(), e = def && readEffects(def.code)[i]; if (e) { setDraftDef(def.id, removeEffect(def.code, e)); live(); } },
  source(i) { pe.src = i; pe.steps = null; pe.sel = null; pe.rows = []; renderPartEditor(); },
  steps(n) { pe.steps = n; renderPartEditor(); },
  /**
   * A click on the staff: put a note at that step and pitch (or move the one there); with chord on (or Shift) add it to
   * the chord there. Right-click removes the note at that pitch (or the whole note).
   */
  staff(b, col, step, remove, add) {
    const src = curSource(), m = model(src);
    if (m.error) return;
    const bar = m.bars[b], t = (col * bar.res) / m.steps;
    const at = eventAt(bar, t);
    const clef = staffClef(src, m);
    const val = valOf(src, stepToMidi(step, clef), at?.vals[0] ?? m.bars.flatMap((x) => x.events)[0]?.vals[0]);
    if (remove) {
      if (!at) return;
      if (at.vals.length > 1) {
        // the chord note nearest the click
        const near = at.vals.map((v) => ({ v, d: Math.abs((staffPos(midiOf(src, v) ?? 0, clef).step) - step) })).sort((x, y) => x.d - y.d)[0].v;
        m.bars[b] = { res: bar.res, events: bar.events.map((e) => (e === at ? { ...e, vals: e.vals.filter((v) => v !== near) } : e)) };
      } else { m.bars[b] = removeNote(bar, at); pe.sel = null; }
      commit(src, m);
      return;
    }
    if (at && at.t === t && (add || pe.chord)) {
      if (!at.vals.includes(val)) m.bars[b] = { res: bar.res, events: bar.events.map((e) => (e === at ? { ...e, vals: sortVals(src, [...e.vals, val]) } : e)) };
    } else if (at && at.t === t) m.bars[b] = { res: bar.res, events: bar.events.map((e) => (e === at ? { ...e, vals: [val] } : e)) };
    else m.bars[b] = placeNote(bar, t, bar.res / m.steps, [val]);
    pe.sel = { b, pos: t / bar.res };
    commit(src, m);
  },
  /** Keys on the staff: arrows move the note (Shift: an octave) or the selection, Delete rests, + / − length. */
  key(e) {
    const k = e.key;
    if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); return e.shiftKey ? act.octave(k === 'ArrowUp' ? 1 : -1) : act.up(k === 'ArrowUp' ? 1 : -1); }
    if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); return moveSel(k === 'ArrowRight' ? 1 : -1); }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); return act.rest(); }
    if (k === '+' || k === '=') { e.preventDefault(); return act.length(2); }
    if (k === '-' || k === '_') { e.preventDefault(); return act.length(0.5); }
  },
  up(n) { editSel((src, ev) => ({ ...ev, vals: ev.vals.map((v) => shiftVal(src, v, n, false)) })); },
  octave(n) { editSel((src, ev) => ({ ...ev, vals: ev.vals.map((v) => shiftVal(src, v, n, true)) })); },
  length(f) {
    const src = curSource(), m = model(src), s = selected(m);
    if (!s) return;
    let bar = m.bars[s.b];
    const want = (s.ev.len / bar.res) * f;
    if (want < 1 / 64) return;
    if ((want * bar.res) % 1) { bar = withGrid(bar, Math.round(1 / want)); }
    const ev = eventAt(bar, s.pos * bar.res);
    m.bars[s.b] = resizeNote(bar, ev, Math.round(want * bar.res));
    commit(src, m);
  },
  rest() {
    const src = curSource(), m = model(src), s = selected(m);
    if (!s) return;
    m.bars[s.b] = removeNote(m.bars[s.b], s.ev);
    commit(src, m);
  },
  /** A grid cell: add or remove that hit (b = -1: a new row). */
  grid(b, col, val) {
    if (b < 0) { if (!pe.rows.includes(val)) pe.rows.push(val); renderPartEditor(); return; }
    const src = curSource(), m = model(src);
    if (m.error) return;
    const bar = m.bars[b];
    m.bars[b] = toggleAt(bar, (col * bar.res) / m.steps, bar.res / m.steps, String(val));
    commit(src, m);
  },
  /** A level column: set the value at that step (null: take it out). */
  level(b, col, value) {
    const src = curSource(), m = model(src);
    if (m.error) return;
    const bar = m.bars[b], t = (col * bar.res) / m.steps;
    const at = bar.events.find((e) => e.t === t);
    if (value == null) { if (at) m.bars[b] = removeNote(bar, at); }
    else if (at) m.bars[b] = { res: bar.res, events: bar.events.map((e) => (e === at ? { ...e, vals: [String(value)] } : e)) };
    else m.bars[b] = placeNote(bar, t, bar.res / m.steps, [String(value)]);
    commit(src, m);
  },
  chord(on) { pe.chord = on; renderPartEditor(); },
  /** ＋ voice: a new line next to this one (a harmony of it, or a counter-line to shape). */
  addVoice(key) {
    const def = curDef(), src = curSource();
    if (!def || !src || !VOICES[key]) return;
    const sc = scaleOf(src);
    // note names move along the song's scale too
    const map = src.kind === 'pitch' ? (v, n) => { const m = noteToMidi(v); return m == null ? v : valOf(src, degreeToMidi(midiToDegree(m, sc) + n, sc), v); } : null;
    const line = src.kind === 'pitch' && VOICES[key].shift == null ? '~' : voiceLine(src.value, key, map);
    if (!line) { pe.msg = '⚠ this line uses notation the note editor can’t copy — add the voice in its code'; pe.bad = true; renderPartEditor(); return; }
    const code = addVoice(def.code, src, line);
    // (the new voice is the last line: edit it)
    const all = readSources(code), last = all.filter(isVoice).pop();
    pe.src = all.indexOf(last);
    pe.sel = null;
    setDraftDef(def.id, code, `＋ ${VOICES[key].label}`);
    live();
  },
  removeVoice() {
    const def = curDef(), src = curSource();
    if (!def || !src) return;
    const code = removeVoice(def.code, src);
    if (code === def.code) return;
    pe.src = 0; pe.sel = null;
    setDraftDef(def.id, code, '− a voice');
    live();
  },
  addLayer(sound) { const def = curDef(); if (def && sound.trim()) { setDraftDef(def.id, addLayer(def.code, sound.trim()), `＋ layer ${sound.trim()}`); live(); } },
  removeLayer(k) { const def = curDef(); if (def) { setDraftDef(def.id, removeLayer(def.code, k)); live(); } },
  bar(what) {
    const src = curSource(), m = model(src);
    if (m.error) return;
    if (what === 'add') { const last = m.bars[m.bars.length - 1]; m.bars.push({ res: last.res, events: last.events.map((e) => ({ ...e, vals: [...e.vals] })) }); m.alt = true; }
    else if (m.bars.length > 1) { m.bars.splice(pe.sel?.b ?? m.bars.length - 1, 1); pe.sel = null; }
    commit(src, m, what === 'add' ? '＋ a bar (a copy of the last one)' : '');
  },
  text(str) { const src = curSource(), def = curDef(); if (src && def) { setDraftDef(def.id, setSource(def.code, src, str.replace(/"/g, ''))); live(); } },
  code(str) { const def = curDef(); if (def) { setDraftDef(def.id, str.trim()); live(); } },
  apply() { applyDraft(); },
  revert() { revertDraft(); },
  close() { if (pe.playing) stop(); ws.close('part'); pe.part = null; renderPartEditor(); },
};
/** Chord notes low to high. */
const sortVals = (src, vals) => vals.slice().sort((a, b) => (midiOf(src, a) ?? 0) - (midiOf(src, b) ?? 0));
/** The other voices of a part (its degree / note lines besides this one). */
function otherVoices(src) {
  const all = sources().filter(isVoice);
  return all.length > 1 ? all.map((s, k) => ({ s, k })).filter((x) => x.s.start !== src.start) : [];
}
/** The clef that fits every voice. */
function staffClef(src, m) {
  const mid = m.bars.flatMap((x) => x.events.flatMap((e) => e.vals.map((v) => midiOf(src, v))));
  for (const { s } of otherVoices(src)) {
    const o = parseMini(s.value);
    if (!o.error) mid.push(...o.bars.flatMap((x) => x.events.flatMap((e) => e.vals.map((v) => midiOf(s, v)))));
  }
  return clefFor(mid);
}
function selected(m) {
  if (!pe.sel || m.error) return null;
  const bar = m.bars[pe.sel.b];
  const ev = bar && bar.events.find((e) => e.t === pe.sel.pos * bar.res);
  return ev ? { b: pe.sel.b, pos: pe.sel.pos, ev } : null;
}
function editSel(fn) {
  const src = curSource(), m = model(src), s = selected(m);
  if (!s) return;
  m.bars[s.b] = { res: m.bars[s.b].res, events: m.bars[s.b].events.map((e) => (e === s.ev ? fn(src, e) : e)) };
  commit(src, m);
}
function moveSel(dir) {
  const src = curSource(), m = model(src);
  if (m.error) return;
  const all = m.bars.flatMap((bar, b) => bar.events.map((e) => ({ b, pos: e.t / bar.res })));
  if (!all.length) return;
  const k = pe.sel ? all.findIndex((x) => x.b === pe.sel.b && x.pos === pe.sel.pos) : -1;
  pe.sel = all[Math.max(0, Math.min(all.length - 1, k < 0 ? 0 : k + dir))];
  renderPartEditor();
}

// --- what the template shows ----------------------------------------------------------------------------------------
function view() {
  const d = currentDraft(), def = curDef();
  const p = d.raw.parts.find((x) => x.name === pe.part);
  const used = (v) => d.raw.sections.filter((s) => s.play.some((x) => { const q = playOf(x); return q.part === pe.part && q.variant === v; })).map((s) => s.name);
  const effects = def ? readEffects(def.code) : [];
  const groups = [];
  effects.forEach((e, i) => {
    const meta = EFFECTS[e.key];
    let g = groups.find((x) => x.group === meta.group);
    if (!g) groups.push((g = { group: meta.group, items: [] }));
    g.items.push({ i, key: e.key, label: meta.label, kind: e.kind, value: e.value, min: e.min ?? meta.min, max: e.max ?? meta.max, step: meta.step, log: !!meta.log && e.kind !== 'pattern', unit: meta.unit || '' });
  });
  const have = new Set(effects.map((e) => e.key));
  const srcs = def ? readSources(def.code) : [];
  pe.src = Math.min(pe.src, Math.max(0, srcs.length - 1));
  return {
    part: pe.part, variant: pe.variant, color: vizColor(pe.part), role: p?.role || '', sound: p?.sound || '',
    variants: (p?.variants || ['main']).map((v) => ({ name: v, on: v === pe.variant, used: used(v).join(', '), fill: /^fill\d*$/.test(v) })),
    sections: d.raw.sections.map((s, i) => ({ i, name: s.name, chords: (d.raw.chords[s.chords] || '').replace(/^<|>$/g, ''), on: i === pe.section,
      uses: s.play.some((x) => { const q = playOf(x); return q.part === pe.part && q.variant === pe.variant; }) })),
    solo: pe.solo, playing: pe.playing, dirty: d.dirty, msg: def ? pe.msg || d.msg : `⚠ ${defId()} has no code yet — give it some in ✎ Edit song`, bad: pe.bad || !def,
    effects: groups, addable: Object.entries(EFFECTS).filter(([k]) => !have.has(k)).map(([key, m]) => ({ key, label: m.label, group: m.group })),
    sources: sourceChips(srcs),
    voices: srcs[pe.src] && isVoice(srcs[pe.src]) ? { options: Object.entries(VOICES).map(([key, x]) => ({ key, label: x.label })), canRemove: srcs.filter(isVoice).length > 1 } : null,
    layers: def ? { list: readLayers(def.code).map((l, k) => ({ k, sound: l.sound || '?', text: l.text })), can: canLayer(def.code) } : null,
    src: srcs.length ? srcView(srcs[pe.src]) : null,
    code: def?.code || '',
  };
}
/** The source chips: voices get "voice 1 (the line) / voice 2 …" and their colours. */
function sourceChips(srcs) {
  const voices = srcs.filter(isVoice);
  return srcs.map((s, i) => {
    const k = voices.length > 1 ? voices.indexOf(s) : -1;
    return { i, on: i === pe.src, label: k < 0 ? s.label : k === 0 ? 'voice 1 · the line' : `voice ${k + 1}`, color: k < 0 ? null : VOICE_COLORS[k % VOICE_COLORS.length] };
  });
}
function srcView(src) {
  const base = { kind: src.kind, label: src.label, text: src.value, stepOptions: STEP_OPTIONS, view: src.kind === 'degree' || src.kind === 'pitch' ? 'staff' : src.kind === 'level' ? 'level' : 'grid' };
  const m = model(src);
  if (m.error) return { ...base, error: `This pattern ${m.error}.`, bars: [], rows: [], stepsPer: 0, info: '', sel: false };
  const stepOptions = [...new Set([...STEP_OPTIONS, m.steps])].sort((a, b) => a - b);
  const sel = selected(m);
  if (base.view === 'staff') {
    const sc = scaleOf(src), flats = sc?.flats;
    const clef = staffClef(src, m);
    // the other voices, faded in their colours under this one (positions as parts of the bar)
    const ghosts = otherVoices(src).map(({ s, k }) => ({ s, color: VOICE_COLORS[k % VOICE_COLORS.length], m: parseMini(s.value) })).filter((g) => !g.m.error);
    const bars = m.bars.map((bar, b) => {
      const events = bar.events.map((e, k) => {
        const notes = e.vals.map((v) => midiOf(src, v)).filter((x) => x != null).map((midi) => staffPos(midi, clef, flats));
        return { k, t: e.t, len: e.len, vals: e.vals, notes: notes.length ? notes : [{ step: 4, acc: '' }], sel: !!sel && sel.b === b && sel.ev === e };
      });
      // a rest mark at the start of each gap
      const rests = [];
      const tick = bar.res / m.steps;
      for (let t = 0; t < bar.res; t += tick) if (!eventAt(bar, t) && (t === 0 || eventAt(bar, t - tick))) rests.push({ t, len: tick });
      const others = ghosts.flatMap((g) => {
        const gb = g.m.bars[b % g.m.bars.length];
        return gb.events.map((e) => ({ color: g.color, pos: e.t / gb.res, len: e.len / gb.res,
          notes: e.vals.map((v) => midiOf(g.s, v)).filter((x) => x != null).map((midi) => staffPos(midi, clef, flats)) }));
      });
      return { b, res: bar.res, steps: m.steps, events, rests, others };
    });
    const info = sel ? sel.ev.vals.map((v) => { const midi = midiOf(src, v); return src.kind === 'degree' ? `degree ${v} · ${midi != null ? midiToNote(midi, flats) : '?'}` : v; }).join(' + ') + ` · ${fracName(sel.ev.len / m.bars[sel.b].res)}` : 'click a note to select it';
    const vk = sources().filter(isVoice).findIndex((x) => x.start === src.start);
    return { ...base, stepOptions, stepsPer: m.steps, clef, bars, sel: !!sel, info, rows: [], chord: pe.chord, voiceColor: vk >= 0 && ghosts.length ? VOICE_COLORS[vk % VOICE_COLORS.length] : null };
  }
  const bars = m.bars.map((bar, b) => ({ b, res: bar.res, steps: m.steps, events: bar.events, rests: [] }));
  let rows = [];
  if (base.view === 'grid') {
    const vals = [...new Set([...m.bars.flatMap((x) => x.events.flatMap((e) => e.vals)), ...pe.rows])];
    if (src.kind === 'tone') {
      const top = Math.max(3, ...vals.map(Number).filter(Number.isFinite));
      rows = [...Array(top + 1)].map((_, k) => top - k).map((n) => ({ val: String(n), label: `tone ${n}` }));
    } else if (src.kind === 'index') {
      rows = vals.sort((a, b) => Number(b) - Number(a)).map((v) => ({ val: v, label: `#${v}` }));
    } else if (src.kind === 'rhythm') {
      rows = (vals.length ? vals : ['x']).map((v) => ({ val: v, label: v === 'x' ? 'hit' : v }));
    } else rows = vals.map((v) => ({ val: v, label: v }));
  }
  return { ...base, stepOptions, stepsPer: m.steps, bars, rows, sel: false, info: '' };
}
const fracName = (f) => ({ 1: 'whole bar', 0.5: 'half', 0.25: 'quarter', 0.125: 'eighth', 0.0625: 'sixteenth', 0.75: 'dotted half', 0.375: 'dotted quarter' })[f] || `${Math.round(f * 1000) / 1000} bar`;

/** Draw the part editor (also after every change to ✎ Edit song's draft). */
export function renderPartEditor() {
  const el = $('partForm');
  if (!el) return;
  const d = currentDraft();
  const open = !!(pe.part && d && d.raw.parts.some((x) => x.name === pe.part));
  $('partEmpty').hidden = open;
  // something else stopped it, or the song took over again (▶ resume, ⏭ go)
  if (pe.playing && (!mirror()?.repl?.scheduler?.started || (engine.running && !engine.paused))) pe.playing = false;
  render(open ? T.partEditor(view(), act) : nothing, el);
}

export function setup() {
  fetch('/scale-intervals.json').then((r) => r.json()).then((j) => { SCALES = { ...SCALES, ...j }; renderPartEditor(); }).catch(() => {});
  ws.on?.('part', { onOpen: (o) => { if (!o && pe.playing) stop(); } });
}
