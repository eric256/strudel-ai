// The 🎚 Equalizer: a 7-band graphic EQ for the master or any mixer channel (±12 dB per band).

/** The bands: frequency, filter type, width. */
export const EQ_BANDS = [
  { f: 60, type: 'lowshelf', label: '60' },
  { f: 150, type: 'peaking', q: 1.1, label: '150' },
  { f: 400, type: 'peaking', q: 1.1, label: '400' },
  { f: 1000, type: 'peaking', q: 1.1, label: '1k' },
  { f: 2500, type: 'peaking', q: 1.1, label: '2.5k' },
  { f: 6000, type: 'peaking', q: 1.1, label: '6k' },
  { f: 12000, type: 'highshelf', label: '12k' },
];
export const EQ_FLAT = EQ_BANDS.map(() => 0);
export const EQ_RANGE = 12;
/** Ready-made curves (dB per band, low to high). */
export const EQ_PRESETS = {
  flat: { label: 'Flat', gains: EQ_FLAT },
  soft: { label: 'Soft top', title: 'tames harsh, fizzy highs (square waves, cymbals)', gains: [0, 0, 0, 0, -1.5, -4, -6] },
  warm: { label: 'Warm', title: 'a little more body, a little less edge', gains: [1.5, 2, 0.5, 0, -1, -2, -2.5] },
  bass: { label: 'Bass boost', title: 'more low end', gains: [5, 3, 0, 0, 0, 0, 0] },
  bright: { label: 'Bright', title: 'more air and sparkle', gains: [0, 0, 0, 0.5, 2, 3, 4] },
  presence: { label: 'Presence', title: 'lead and vocals forward', gains: [0, -1, -1, 1.5, 3, 1, 0] },
  demud: { label: 'De-mud', title: 'clears up a boomy, boxy mix', gains: [0, -1, -4, -1, 0, 0, 0] },
  smile: { label: 'Smile', title: 'the classic loudness curve: lows and highs up', gains: [4, 2, -1, -2, 0, 2.5, 4] },
};
/** A clean set of band gains (7 numbers within ±12 dB). */
export function normEq(g) {
  const a = Array.isArray(g) ? g : [];
  return EQ_BANDS.map((_, i) => Math.round(Math.max(-EQ_RANGE, Math.min(EQ_RANGE, Number(a[i]) || 0)) * 2) / 2);
}
export const isFlat = (g) => normEq(g).every((v) => v === 0);
/** Which preset these gains are (or ''). */
export const presetOf = (g) => Object.entries(EQ_PRESETS).find(([, p]) => p.gains.every((v, i) => v === normEq(g)[i]))?.[0] || '';
