// ---------------------------------------------------------------------------
// ⬆ Importers: what turns a file into songs. The app reads its own song JSON (and session logs); 🧩 plugins add
// more with api.addImporter (MusicXML, MIDI …). ⬆ import in 🎵 Songs offers every importer's files, and hands a
// file to the first importer that takes it.
// ---------------------------------------------------------------------------
import { unzip, zipText } from '../lib/zip.js';
import { ident } from '../lib/util.js';
import { normProgression, normMeter, meterBeats, tempoLine, METERS } from '../lib/music.js';
import { parseMini, serializeMini } from '../lib/mini-edit.js';
import { midiToNote } from '../lib/staff.js';

/** The General MIDI instruments as Strudel soundfonts, in program order (Strudel has one piano for programs 1–4). */
export const GM_SOUNDS = ['gm_piano', 'gm_epiano1', 'gm_epiano2', 'gm_harpsichord', 'gm_clavinet', 'gm_celesta', 'gm_glockenspiel', 'gm_music_box',
  'gm_vibraphone', 'gm_marimba', 'gm_xylophone', 'gm_tubular_bells', 'gm_dulcimer', 'gm_drawbar_organ', 'gm_percussive_organ', 'gm_rock_organ',
  'gm_church_organ', 'gm_reed_organ', 'gm_accordion', 'gm_harmonica', 'gm_bandoneon', 'gm_acoustic_guitar_nylon', 'gm_acoustic_guitar_steel',
  'gm_electric_guitar_jazz', 'gm_electric_guitar_clean', 'gm_electric_guitar_muted', 'gm_overdriven_guitar', 'gm_distortion_guitar',
  'gm_guitar_harmonics', 'gm_acoustic_bass', 'gm_electric_bass_finger', 'gm_electric_bass_pick', 'gm_fretless_bass', 'gm_slap_bass_1',
  'gm_slap_bass_2', 'gm_synth_bass_1', 'gm_synth_bass_2', 'gm_violin', 'gm_viola', 'gm_cello', 'gm_contrabass', 'gm_tremolo_strings',
  'gm_pizzicato_strings', 'gm_orchestral_harp', 'gm_timpani', 'gm_string_ensemble_1', 'gm_string_ensemble_2', 'gm_synth_strings_1',
  'gm_synth_strings_2', 'gm_choir_aahs', 'gm_voice_oohs', 'gm_synth_choir', 'gm_orchestra_hit', 'gm_trumpet', 'gm_trombone', 'gm_tuba',
  'gm_muted_trumpet', 'gm_french_horn', 'gm_brass_section', 'gm_synth_brass_1', 'gm_synth_brass_2', 'gm_soprano_sax', 'gm_alto_sax',
  'gm_tenor_sax', 'gm_baritone_sax', 'gm_oboe', 'gm_english_horn', 'gm_bassoon', 'gm_clarinet', 'gm_piccolo', 'gm_flute', 'gm_recorder',
  'gm_pan_flute', 'gm_blown_bottle', 'gm_shakuhachi', 'gm_whistle', 'gm_ocarina', 'gm_lead_1_square', 'gm_lead_2_sawtooth', 'gm_lead_3_calliope',
  'gm_lead_4_chiff', 'gm_lead_5_charang', 'gm_lead_6_voice', 'gm_lead_7_fifths', 'gm_lead_8_bass_lead', 'gm_pad_new_age', 'gm_pad_warm',
  'gm_pad_poly', 'gm_pad_choir', 'gm_pad_bowed', 'gm_pad_metallic', 'gm_pad_halo', 'gm_pad_sweep', 'gm_fx_rain', 'gm_fx_soundtrack',
  'gm_fx_crystal', 'gm_fx_atmosphere', 'gm_fx_brightness', 'gm_fx_goblins', 'gm_fx_echoes', 'gm_fx_sci_fi', 'gm_sitar', 'gm_banjo',
  'gm_shamisen', 'gm_koto', 'gm_kalimba', 'gm_bagpipe', 'gm_fiddle', 'gm_shanai', 'gm_tinkle_bell', 'gm_agogo', 'gm_steel_drums',
  'gm_woodblock', 'gm_taiko_drum', 'gm_melodic_tom', 'gm_synth_drum', 'gm_reverse_cymbal', 'gm_guitar_fret_noise', 'gm_breath_noise',
  'gm_seashore', 'gm_bird_tweet', 'gm_telephone', 'gm_helicopter', 'gm_applause', 'gm_gunshot'];
/** A General MIDI program (1–128) → its soundfont, or null. */
export const gmSound = (program) => {
  const p = Math.round(Number(program));
  return p >= 1 && p <= 4 ? 'gm_piano' : GM_SOUNDS[p - 4] || null;
};
/** General MIDI drum notes (channel 10) → Strudel's drum sample names. */
export const GM_DRUMS = { 35: 'bd', 36: 'bd', 37: 'rim', 38: 'sd', 39: 'cp', 40: 'sd', 41: 'lt', 42: 'hh', 43: 'lt', 44: 'hh', 45: 'mt', 46: 'oh',
  47: 'mt', 48: 'ht', 49: 'cr', 50: 'ht', 51: 'rd', 52: 'cr', 53: 'rd', 54: 'perc', 55: 'cr', 56: 'cb', 57: 'cr', 59: 'rd' };

/** The helpers an importer gets (so a plugin doesn't need the app's modules). */
export const IMPORT_TOOLS = {
  unzip, zipText, ident, normProgression, normMeter, meterBeats, tempoLine, METERS,
  parseMini, serializeMini, midiToNote, gmSound, GM_SOUNDS, GM_DRUMS,
};

/** Every importer: { id, label, icon, accept: ['.musicxml', …], title, import(file, tools), plugin }. */
const importers = [];
/** Add an importer; returns what removes it. */
export function addImporter(def) {
  const imp = { ...def, accept: [].concat(def.accept || []).map((x) => String(x).toLowerCase()) };
  importers.push(imp);
  onChange();
  return () => { const i = importers.indexOf(imp); if (i >= 0) importers.splice(i, 1); onChange(); };
}
export const importerList = () => importers.slice();
/** The importer for a file (by its extension), or null (the app's own JSON / log). */
export function importerFor(file) {
  const name = String(file?.name || '').toLowerCase();
  return importers.find((imp) => imp.accept.some((ext) => name.endsWith(ext))) || null;
}
/** The file types ⬆ import offers: the app's own, plus every importer's. */
export const acceptList = () => ['.json', '.txt', 'application/json', 'text/plain', ...importers.flatMap((imp) => imp.accept)].join(',');

let listeners = [];
/** Call fn when importers come or go (⬆ import's file types follow). */
export function onImportersChange(fn) { listeners.push(fn); return () => { listeners = listeners.filter((f) => f !== fn); }; }
function onChange() { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } }

/** Run an importer on a file: song JSON (one, or a list). */
export async function runImporter(imp, file) {
  const out = await imp.import(file, IMPORT_TOOLS);
  const list = [].concat(out || []);
  if (!list.length) throw new Error(`${imp.label || imp.id} found no song in ${file.name}`);
  return list;
}
