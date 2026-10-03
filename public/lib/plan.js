// Song planning: before the AI writes a song, the app decides its form, band, meter and key — from the description,
// the form / band you picked (or the ones that fit the genre, one of the close matches at random, so songs vary), and the
// meters and keys the form and the band allow. The AI then writes the song inside that plan.
import { findIn } from './forms.js';
import { GENRES, detectGenre, genresOf } from './genres.js';

const STOP = new Set(['and', 'the', 'with', 'for', 'music', 'songs', 'song', 'long', 'short', 'like', 'style', 'about', 'minutes', 'some', 'its', 'slow', 'fast']);
const words = (t) => String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** How well a "use for" list (genres and moods) fits a description: a whole genre named counts most. */
export function genreScore(desc, use) {
  const d = String(desc || '').toLowerCase();
  let score = 0;
  for (const g of String(use || '').toLowerCase().split(/[,—;]+/).map((x) => x.trim()).filter(Boolean)) {
    if (g.length >= 3 && new RegExp(`(^|[^a-z])${escRe(g)}([^a-z]|$)`).test(d)) score += 3;
    else for (const w of words(g)) if (new RegExp(`\\b${escRe(w)}\\b`).test(d)) score += 1;
  }
  return score;
}

/** "4/4, 3/4" or "C major, A minor" → a list. */
export const listOf = (t) => String(t || '').split(',').map((x) => x.trim()).filter(Boolean);

/** A meter the description names ("in 6/8", "a waltz", "a 12/8 shuffle"), or null. */
export function describedMeter(desc) {
  const m = /\b(2\/4|3\/4|4\/4|5\/4|6\/8|7\/8|9\/8|12\/8)\b/.exec(String(desc || ''));
  if (m) return m[1];
  if (/\bwaltz\b/i.test(desc)) return '3/4';
  return null;
}
const KEY_RE = /\b([A-G](?:#|b|♯|♭)?)\s*(major|minor|dorian|phrygian|lydian|mixolydian|aeolian|locrian)\b/;
/** A key the description names ("A minor", "D dorian"), or null. */
export function describedKey(desc) {
  const m = KEY_RE.exec(String(desc || ''));
  return m ? `${m[1].replace('♯', '#').replace('♭', 'b')} ${m[2]}` : null;
}
/** "D dorian" → "D:dorian" (Strudel's scale name). */
export const keyScale = (key) => String(key).trim().replace(/\s+/, ':');

/** The best-fitting items for a description, and one of the close matches at random. */
function pickFitting(items, desc, rand) {
  const scored = items.map((x) => ({ x, s: genreScore(desc, x.use) + (genreScore(desc, x.name) ? 1 : 0) })).filter((y) => y.s > 0);
  if (!scored.length) return null;
  const best = Math.max(...scored.map((y) => y.s));
  const close = scored.filter((y) => y.s >= best * 0.6); // the close matches (a passing mention of the genre isn't one)
  return close[Math.floor(rand() * close.length)].x;
}
const pickOne = (list, rand) => (list.length ? list[Math.floor(rand() * list.length)] : null);

/**
 * The plan for a song: { genre, form, band, meter, key, scale, from: { meter, key } } (form / band are the items, or null
 * when nothing fits — then the AI chooses). Your picks win; then the description's genre (lib/genres.js): one of that
 * genre's forms and bands at random; then the closest "use for" match.
 */
export function planSong(desc, { forms = [], bands = [], form = 'auto', band = 'auto', rand = Math.random } = {}) {
  const genre = detectGenre(desc);
  const ofGenre = (items) => (genre ? items.filter((x) => genresOf(x).includes(genre)) : []);
  const pick = (items) => pickOne(ofGenre(items), rand) || pickFitting(items, desc, rand);
  const f = form && form !== 'auto' ? findIn(forms, form) : pick(forms);
  const b = band && band !== 'auto' ? findIn(bands, band) : pick(bands);
  // what the form and the band both allow (else either's list)
  const allowed = (k) => {
    const a = listOf(f?.[k]), c = listOf(b?.[k]);
    const both = a.filter((x) => c.includes(x));
    return both.length ? both : [...new Set([...a, ...c])];
  };
  const dm = describedMeter(desc), dk = describedKey(desc);
  const meters = allowed('meters');
  // the first meter is the usual one: mostly that, now and then another
  const meter = dm || (meters.length ? (rand() < 0.75 ? meters[0] : pickOne(meters, rand)) : null);
  const key = dk || pickOne(allowed('keys'), rand);
  return { genre, form: f || null, band: b || null, meter, key, scale: key ? keyScale(key) : null, from: { meter: !!dm, key: !!dk } };
}

/** The plan as lines for the song-sheet request. */
export function planForRequest(plan) {
  const lines = [];
  if (plan.genre) lines.push(`- genre: ${GENRES[plan.genre].name}`);
  if (plan.meter) lines.push(`- meter: ${plan.meter}${plan.from.meter ? ' (as the description says)' : ''}`);
  if (plan.key) lines.push(`- key: ${plan.key} (scale "${keyScale(plan.key)}")${plan.from.key ? ' (as the description says)' : ''} — the chords, hook and melody are in this key`);
  return lines.length ? `PLAN — decided for this song (use it):\n${lines.join('\n')}` : '';
}
