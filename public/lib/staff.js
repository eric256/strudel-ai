// Pitches for the 🎛 part editor's staff: scale degrees (n("0 2 4").scale("A:minor")) and note names
// (note("c4 eb4")) to MIDI and back, and where a note sits on a treble or bass staff.

const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const SHARP_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const FLAT_NAMES = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];

/** "eb3", "C#4", "f" (octave 3, like Strudel) → MIDI; null if it isn't a note name. Numbers are MIDI already. */
export function noteToMidi(tok) {
  const t = String(tok).trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = /^([a-gA-G])([#sbf]*)(-?\d+)?$/.exec(t);
  if (!m) return null;
  const acc = [...m[2]].reduce((a, c) => a + (c === '#' || c === 's' ? 1 : -1), 0);
  return (Number(m[3] ?? 3) + 1) * 12 + PC[m[1].toLowerCase()] + acc;
}
/** MIDI → a note name ("eb4"), spelled with flats or sharps. */
export function midiToNote(midi, flats = false) {
  const m = Math.round(midi);
  return `${(flats ? FLAT_NAMES : SHARP_NAMES)[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/** "2M" / "3m" / "5P" / "4A" / "5d" (a scale's intervals) → semitones. */
export function intervalSemis(iv) {
  const m = /^(\d+)([PMmdA])$/.exec(iv);
  if (!m) return null;
  const n = Number(m[1]) - 1, base = [0, 2, 4, 5, 7, 9, 11][n % 7] + 12 * Math.floor(n / 7);
  const perfect = [0, 3, 4].includes(n % 7);
  return base + { P: 0, M: 0, m: -1, A: 1, d: perfect ? -1 : -2 }[m[2]];
}

/**
 * A scale string ("B:minor", "C4:major:pentatonic", "D dorian") → { tonic (MIDI of the root, octave 3 unless given),
 * steps (semitones of each degree), flats }, using the scale table { name: "1P 2M 3m …" }. null if unknown.
 */
export function parseScale(str, table) {
  const parts = String(str || '').trim().split(/[:\s]+/);
  const root = noteToMidi(parts[0]);
  if (root == null || !/^[a-g]/i.test(parts[0])) return null;
  const name = parts.slice(1).join(' ').toLowerCase() || 'major';
  const ivs = table?.[name];
  if (!ivs) return null;
  const steps = ivs.split(/\s+/).map(intervalSemis);
  if (steps.some((x) => x == null)) return null;
  const pc = parts[0].toLowerCase();
  const minorish = /minor|aeolian|dorian|phrygian|locrian/.test(name);
  const flats = /b/.test(pc.slice(1)) || pc === 'f' || (minorish && ['d', 'g', 'c', 'f'].includes(pc));
  return { tonic: root, steps, flats };
}
/** Scale degree (0 = the root, negative goes down) → MIDI. */
export function degreeToMidi(deg, sc) {
  const d = Number(deg);
  if (!Number.isInteger(d) || !sc) return null;
  const len = sc.steps.length, oct = Math.floor(d / len);
  return sc.tonic + sc.steps[((d % len) + len) % len] + 12 * oct;
}
/** MIDI → the nearest scale degree. */
export function midiToDegree(midi, sc) {
  const len = sc.steps.length;
  let best = 0, bestD = Infinity;
  const guess = Math.round(((midi - sc.tonic) / 12) * len);
  for (let d = guess - len - 1; d <= guess + len + 1; d++) {
    const diff = Math.abs(degreeToMidi(d, sc) - midi);
    if (diff < bestD) { bestD = diff; best = d; }
  }
  return best;
}

/** Treble or bass clef for a set of MIDI notes (bass when they sit mostly below middle C). */
export const clefFor = (midis) => {
  const xs = midis.filter((m) => m != null).sort((a, b) => a - b);
  return xs.length && xs[Math.floor(xs.length / 2)] < 59 ? 'bass' : 'treble';
};
/**
 * Where a note sits on the staff: { step (diatonic steps above the bottom line: 0 = bottom line, 1 = first space …),
 * acc ('♯' / '♭' / '') }.
 */
export function staffPos(midi, clef = 'treble', flats = false) {
  const name = midiToNote(midi, flats);
  const m = /^([a-g])([#b]?)(-?\d+)$/.exec(name);
  const dia = Number(m[3]) * 7 + LETTERS.indexOf(m[1]);
  const bottom = clef === 'bass' ? 2 * 7 + 4 /* G2 */ : 4 * 7 + 2; /* E4 */
  return { step: dia - bottom, acc: m[2] === '#' ? '♯' : m[2] === 'b' ? '♭' : '' };
}
/** The natural note at a staff step (the inverse of staffPos, without accidentals) → MIDI. */
export function stepToMidi(step, clef = 'treble') {
  const dia = step + (clef === 'bass' ? 2 * 7 + 4 : 4 * 7 + 2);
  const oct = Math.floor(dia / 7), letter = LETTERS[((dia % 7) + 7) % 7];
  return (oct + 1) * 12 + PC[letter];
}
