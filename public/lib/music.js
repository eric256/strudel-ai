// Chords, keys, meters and tempo: the music theory the song engine needs.

// chord qualities Strudel's default voicings know (plus their m / M aliases)
export const CHORD_Q = new Set(['', 'm', '7', 'm7', '^7', 'M7', '9', 'm9', '^9', 'M9', '6', 'm6', '69', 'm69', 'add9', 'madd9',
  'sus', '7sus', '9sus', 'o', 'o7', 'h7', 'h9', '+', 'aug', '11', 'm11', '13', '7b9', '7#9', '7#11', '7b5', '7#5',
  'm^7', 'mM7', 'm7b5', '^7#11', '^13', '2', '5']);

/** "Fmaj7" → "F^7", "Bdim" → "Bo", "Gsus4" → "Gsus", unknown qualities → nearest triad / 7th. */
export function normChord(tok) {
  const m = tok.match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!m) return tok;
  let q = m[3].replace(/\/.*$/, ''); // no slash chords
  q = q.replace(/^(maj|Maj|M|Δ)7/, '^7').replace(/^(maj|Maj|M|Δ)9/, '^9').replace(/^(maj|Maj)$/, '')
    .replace(/^min/, 'm').replace(/^mi(?!n)/, 'm').replace(/^-/, 'm')
    .replace(/^dim7/, 'o7').replace(/^dim/, 'o').replace(/^ø7?/, 'h7').replace(/^m7b5$/, 'h7')
    .replace(/^sus[24]$/, 'sus').replace(/^7sus[24]$/, '7sus').replace(/^aug$/, '+');
  if (!CHORD_Q.has(q)) q = /^m(?!aj)/.test(q) ? (/7/.test(q) ? 'm7' : 'm') : /7/.test(q) ? '7' : '';
  return m[1].toUpperCase() + m[2] + q;
}

/** "Am F C G" / "<Am F C G>" / "Am | F | C | G" → "<Am F C G>" with valid chord symbols. */
export function normProgression(p) {
  let t = String(p || '').replace(/[|,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  t = t.replace(/[A-Ga-g][#b]?[^\s\[\]<>@*!~]*/g, normChord);
  return t.startsWith('<') ? t : `<${t}>`;
}

export function sectionType(name) {
  const n = String(name).toLowerCase();
  if (/pre-?chorus/.test(n)) return 'prechorus';
  if (/solo|improv|trading/.test(n)) return 'solo';
  if (/chorus|hook/.test(n)) return 'chorus';
  if (/drop/.test(n)) return 'drop';
  if (/break/.test(n)) return 'breakdown';
  if (/build|rise/.test(n)) return 'build';
  if (/bridge|^b\b/.test(n)) return 'bridge';
  if (/intro/.test(n)) return 'intro';
  if (/outro|end/.test(n)) return 'outro';
  return 'verse';
}

/** Validate + repair a song sheet from the model. Throws when it can't be used. */
export const ENTER_MODES = ['in', 'out', 'alt'];

/** Bars a part plays in a section that brings it in / out: a mask, one step per bar. */
export function enterMask(mode, bars) {
  if (!mode || bars < 2) return null;
  const half = Math.floor(bars / 2);
  const steps = Array.from({ length: bars }, (_, k) => (mode === 'in' ? k >= half : mode === 'out' ? k < half : k % 4 < 2) ? 1 : 0);
  return `<${steps.join(' ')}>`;
}

export const MAX_KEY_SHIFT = 3;      // semitones a section may move away from the song's key

export const MAX_TEMPO_DRIFT = 0.08; // a section's tempo stays within ±8% of the song's

export const MAX_CHORUS_BARS = 4;

export const HARMONIC_ROLE = /bass|chord|pad|key|arp|harmon|string|piano|organ|guitar/i;

// usual spellings: major-ish roots Db Eb F# Ab Bb, minor roots C# Eb F# G# Bb
export const ROOT_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export const ROOT_MINOR = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

export const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Move every chord root (and slash bass) of a progression by n semitones: "<Am F C G>" +2 → "<Bm G D A>". */
export function transposeProgression(prog, n) {
  if (!n) return prog;
  return prog.replace(/(^|[\s<\[/])([A-G])([#b]?)(m(?!aj)|o)?/g, (_, pre, l, acc, minor = '') => {
    const pc = (NOTE_PC[l] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + n + 120) % 12;
    return pre + (minor && pre !== '/' ? ROOT_MINOR : ROOT_MAJOR)[pc] + minor;
  });
}

// time signatures: one cycle is one bar; bpm counts the meter's beats (dotted quarters in 6/8, 9/8, 12/8)
export const METERS = ['4/4', '3/4', '6/8', '12/8', '5/4', '7/8', '7/4', '9/8', '2/4'];

export function normMeter(m) {
  const t = String(m || '').replace(/\s+/g, '').match(/^(\d+)\/(\d+)$/);
  const k = t ? `${Number(t[1])}/${Number(t[2])}` : '4/4';
  return METERS.includes(k) ? k : '4/4';
}

/** Beats per bar for the tempo line: 4/4 → 4, 3/4 → 3, 6/8 → 2 (dotted quarters), 7/8 → 3.5 (quarters). */
export function meterBeats(m) {
  const [n, d] = normMeter(m).split('/').map(Number);
  return d === 8 && n % 3 === 0 ? n / 3 : (n * 4) / d;
}

/** Steps per bar for rhythms: the meter's top number. */
export const meterSteps = (m) => Number(normMeter(m).split('/')[0]);

/** The app's tempo line for a bpm in a meter. */
export const tempoLine = (bpm, meter) => `setcpm(${bpm}/${meterBeats(meter)})`;

export const songMeter = (sg) => normMeter(sg?.sheet?.meter);
