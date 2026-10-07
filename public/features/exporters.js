// ---------------------------------------------------------------------------
// ⬇ Exporters: what a song can be saved as. The app has its own song JSON; 🧩 plugins add more with
// api.addExporter (a Strudel REPL program, MIDI, a lead sheet …). A song's ⬇ Export menu lists them all: each one can
// download its file, and (if it says so) copy its text or open a link.
// ---------------------------------------------------------------------------
import { slug, songToJSON } from './song-library.js';
import { songProgram, songProgramCode, songProgramJS } from '../lib/song-program.js';
import { miniStrings } from '../lib/sheet.js';
import { meterBeats, normMeter, transposeProgression } from '../lib/music.js';
import { noteToMidi } from '../lib/staff.js';
import { GM_SOUNDS, GM_DRUMS } from './importers.js';

/** A Strudel soundfont → its General MIDI program (1–128), or null. */
export function gmProgram(sound) {
  const k = GM_SOUNDS.indexOf(String(sound || '').toLowerCase());
  return k < 0 ? null : k === 0 ? 1 : k + 4;
}
/** A drum sample name (bd, sd, hh …) → its General MIDI drum note. */
const DRUM_NOTES = { bd: 36, sd: 38, rim: 37, cp: 39, hh: 42, oh: 46, lt: 45, mt: 47, ht: 50, cr: 49, rd: 51, cb: 56, perc: 54, sh: 70, tb: 54 };
export const drumNote = (s) => DRUM_NOTES[String(s || '').toLowerCase().replace(/\d+$/, '')] ?? null;

/** strudel.cc's link for code (its share format: the code in the URL, base64). */
export function strudelLink(code) {
  const bytes = new TextEncoder().encode(code);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `https://strudel.cc/#${encodeURIComponent(btoa(bin))}`;
}

/** The whole song as live Strudel patterns: { prog, patterns: { part: Pattern } } (Strudel must be loaded). */
export function songPatterns(song) {
  const prog = songProgram(song);
  const js = songProgramJS(prog, miniStrings);
  let patterns;
  try { patterns = new Function('__slider', '"use strict";\n' + js)((v) => v); }
  catch (e) { throw new Error(`the song's program doesn't run: ${e.message}`); }
  return { prog, patterns };
}

/**
 * Every note the song plays, part by part: { bpm, meter, bars, quarterBpm, quartersPerBar, parts: [{ id, role, sound,
 * notes: [{ begin, end (in bars), midi, drum (a sample name, for drums), velocity (0–1) }] }] }.
 */
export function songNotes(song) {
  const { prog, patterns } = songPatterns(song);
  const [n, d] = prog.meter.split('/').map(Number);
  const quartersPerBar = (n * 4) / d;
  const parts = prog.parts.map((p) => {
    const pat = patterns[p.id];
    const notes = [];
    for (const h of pat?.queryArc(0, prog.bars) || []) {
      if (h.hasOnset && !h.hasOnset()) continue;
      const v = h.value && typeof h.value === 'object' ? h.value : { note: h.value };
      let midi = typeof v.note === 'number' ? v.note : typeof v.note === 'string' ? noteToMidi(v.note) : typeof v.freq === 'number' ? 69 + 12 * Math.log2(v.freq / 440) : null;
      const drum = midi == null && typeof v.s === 'string' && drumNote(v.s) != null ? v.s : null;
      if (midi == null && !drum) continue;
      if (midi != null) midi = Math.round(midi);
      const velocity = Math.max(0, Math.min(1, (v.velocity ?? 1) * Math.min(1.2, v.gain ?? 1)));
      const begin = Number(h.whole?.begin ?? h.part.begin), end = Number(h.whole?.end ?? h.part.end);
      notes.push({ begin, end, midi, drum, velocity });
    }
    return { id: p.id, role: p.role, sound: p.sound, notes: notes.sort((a, b) => a.begin - b.begin) };
  });
  const quarterBpm = (prog.bpm / meterBeats(normMeter(prog.meter))) * quartersPerBar;
  return { bpm: prog.bpm, meter: prog.meter, bars: prog.bars, quarterBpm, quartersPerBar, parts };
}

/** The helpers an exporter gets (so a plugin doesn't need the app's modules). */
export const EXPORT_TOOLS = {
  songToJSON, songProgram, songProgramCode, songPatterns, songNotes, strudelLink, gmProgram, drumNote, GM_SOUNDS, GM_DRUMS,
  meterBeats, normMeter, transposeProgression, slug,
};

/** The built-in exporter: the app's own song file. */
const JSON_EXPORTER = { id: 'json', label: 'Song (JSON)', icon: '📄', ext: 'strudel-song.json', mime: 'application/json', builtin: true,
  title: 'The whole song (sheet, parts, sections, pads) — ⬆ import loads it on any Strudel AI server',
  export: (song) => JSON.stringify(songToJSON(song), null, 1) };
/** Every exporter: { id, label, icon, ext, mime, title, copy, open, export(song, tools), plugin }. */
const exporters = [JSON_EXPORTER];
export function addExporter(def) {
  const exp = { ...def };
  exporters.push(exp);
  onChange();
  return () => { const i = exporters.indexOf(exp); if (i >= 0) exporters.splice(i, 1); onChange(); };
}
export const exporterList = () => exporters.slice();
let listeners = [];
/** Call fn when exporters come or go (the ⬇ Export menus follow). */
export function onExportersChange(fn) { listeners.push(fn); return () => { listeners = listeners.filter((f) => f !== fn); }; }
function onChange() { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } }

/** What an exporter made, as { text?, blob, name, url? }. */
async function made(exp, song) {
  const out = await exp.export(song, EXPORT_TOOLS);
  const o = out && typeof out === 'object' && !(out instanceof Blob) && !(out instanceof Uint8Array) ? out : { data: out };
  const data = o.text ?? o.blob ?? o.bytes ?? o.data;
  if (data == null) throw new Error(`${exp.label} made nothing`);
  const mime = o.mime || exp.mime || (typeof data === 'string' ? 'text/plain' : 'application/octet-stream');
  return { text: typeof data === 'string' ? data : null, blob: data instanceof Blob ? data : new Blob([data], { type: mime }), mime,
    name: o.name || `${slug(song.title)}.${exp.ext || 'txt'}`, url: o.url || null };
}

/** Export a song: how = 'download' (its file), 'copy' (its text) or 'open' (its link). Returns a short message. */
export async function exportSong(id, how, song) {
  const exp = exporters.find((x) => x.id === id);
  if (!exp) throw new Error(`no exporter “${id}”`);
  const r = await made(exp, song);
  if (how === 'copy') {
    if (r.text == null) throw new Error(`${exp.label} isn't text`);
    await navigator.clipboard.writeText(r.text);
    return `📋 copied “${song.title}” as ${exp.label}`;
  }
  if (how === 'open') {
    if (!r.url) throw new Error(`${exp.label} has no link`);
    window.open(r.url, '_blank', 'noopener');
    return `↗ opened “${song.title}” (${exp.label})`;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(r.blob);
  a.download = r.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return `⬇ ${r.name}`;
}
