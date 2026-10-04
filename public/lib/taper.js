// A console fader's taper: where a gain sits on the fader. dB from −60 to the top (+6 dB by default) spread like a
// mixing desk — most of the travel around 0 dB, the quiet end squeezed — and the very bottom is silence (−∞).

/** Gain (linear) → dB (−Infinity for silence). */
export const toDb = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity);
/** dB → gain. */
export const fromDb = (db) => (db === -Infinity ? 0 : Math.pow(10, db / 20));
const FLOOR = -60, CURVE = 2; // 0 dB sits about 80 % up, −20 dB about a third
/** Gain → position on the fader, 0 (bottom, −∞) … 1 (top, maxDb). */
export function gainToPos(g, maxDb = 6) {
  const db = toDb(g);
  if (db <= FLOOR) return 0;
  return Math.min(1, Math.pow((db - FLOOR) / (maxDb - FLOOR), CURVE));
}
/** Position on the fader → gain. */
export function posToGain(p, maxDb = 6) {
  if (p <= 0.002) return 0;
  const db = FLOOR + Math.pow(Math.min(1, p), 1 / CURVE) * (maxDb - FLOOR);
  return fromDb(db);
}
/** The scale marks beside a fader (dB, top to bottom), the ones that fit under maxDb. */
export const faderMarks = (maxDb = 6) => [10, 6, 3, 0, -5, -10, -20, -30, -40].filter((d) => d <= maxDb + 0.01);
/** Peak level → a warning: 'clip' at the top (≥ −0.3 dBFS), 'hot' near it (≥ −3 dBFS), else ''. */
export const peakState = (peak) => (peak >= 0.966 ? 'clip' : peak >= 0.708 ? 'hot' : '');
