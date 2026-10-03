// Genres: the common language of song forms, bands and stations. Every form and band names the genres it belongs to;
// a song's description is matched to a genre first, then a form and a band of that genre are picked (lib/plan.js).

/** id → { name, words }: the words and phrases that name the genre in a description (a phrase counts more). */
export const GENRES = {
  house: { name: 'house', words: ['house', 'deep house', 'tech house', 'afro house', 'garage', 'uk garage', 'soulful house', 'four-on-the-floor'] },
  techno: { name: 'techno', words: ['techno', 'minimal', 'industrial', 'acid', 'warehouse', 'hypnotic', 'rave'] },
  trance: { name: 'trance', words: ['trance', 'uplifting', 'psytrance', 'psy', 'goa', 'supersaw', 'euphoric', 'progressive trance'] },
  edm: { name: 'EDM', words: ['edm', 'big room', 'festival', 'future bass', 'electro house', 'dubstep', 'brostep', 'mainstage'] },
  dnb: { name: 'drum & bass', words: ['drum & bass', 'drum and bass', 'drum n bass', 'dnb', 'd&b', 'jungle', 'liquid', 'neurofunk', 'breakbeat', 'amen'] },
  synthwave: { name: 'synthwave', words: ['synthwave', 'retrowave', 'outrun', 'darkwave', 'coldwave', 'vaporwave', '80s', 'eighties', 'night drive'] },
  lofi: { name: 'lo-fi', words: ['lo-fi', 'lofi', 'chillhop', 'jazz-hop', 'jazzhop', 'study beats', 'chill beats', 'dusty'] },
  hiphop: { name: 'hip hop', words: ['hip hop', 'hip-hop', 'boom bap', 'trap', 'rap', 'r&b', 'beat tape', 'instrumental hip hop'] },
  pop: { name: 'pop', words: ['pop', 'synth-pop', 'synthpop', 'dance-pop', 'chart', 'power pop', 'k-pop', 'j-pop', 'hits', 'sing-along'] },
  rock: { name: 'rock', words: ['rock', 'indie', 'punk', 'metal', 'grunge', 'post-rock', 'shoegaze', 'guitar band'] },
  jazz: { name: 'jazz', words: ['jazz', 'swing', 'bebop', 'hard bop', 'big band', 'modal', 'cool jazz', 'combo', 'jazz trio', 'blue note', 'walking bass'] },
  fusion: { name: 'fusion', words: ['fusion', 'jazz fusion', 'city pop', 'jazz-funk', 'jazz funk', 'smooth jazz', 'aor', 'japanese', 'slap bass'] },
  funk: { name: 'funk & disco', words: ['funk', 'funky', 'disco', 'nu-disco', 'boogie', 'soul', 'motown', 'space disco'] },
  ambient: { name: 'ambient', words: ['ambient', 'drone', 'new age', 'soundscape', 'meditation', 'atmospheric', 'focus', 'calm'] },
  cinematic: { name: 'cinematic', words: ['cinematic', 'orchestral', 'film', 'score', 'epic', 'soundtrack', 'trailer', 'orchestra'] },
  dub: { name: 'dub & reggae', words: ['dub', 'reggae', 'ska', 'dancehall', 'riddim', 'one-drop', 'dub techno'] },
  chiptune: { name: 'chiptune', words: ['chiptune', '8-bit', 'chip', 'video game', 'arcade', 'game boy', 'nes'] },
  downtempo: { name: 'downtempo', words: ['downtempo', 'trip hop', 'trip-hop', 'chillout', 'lounge', 'chill'] },
  acoustic: { name: 'acoustic & folk', words: ['acoustic', 'unplugged', 'folk', 'singer-songwriter', 'bluegrass', 'country', 'americana', 'celtic', 'irish', 'campfire', 'coffeehouse', 'fingerstyle', 'busking', 'string band'] },
  latin: { name: 'latin', words: ['latin', 'bossa', 'bossa nova', 'samba', 'salsa', 'afro-cuban', 'tango', 'cumbia'] },
};

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = new Map();
const re = (w) => wordRe.get(w) || wordRe.set(w, new RegExp(`(^|[^a-z0-9])${escRe(w)}([^a-z0-9]|$)`, 'i')).get(w);

/** How strongly a description names each genre: { id: score } (a phrase counts more than a single word). */
export function genreScores(text) {
  const t = String(text || '').toLowerCase();
  const out = {};
  for (const [id, g] of Object.entries(GENRES)) {
    let s = 0;
    for (const w of g.words) if (re(w).test(t)) s += w.includes(' ') || w.includes('-') || w.includes('&') ? 5 : 3;
    if (s) out[id] = s;
  }
  return out;
}
/** The genre a description is about (the strongest), or null. */
export function detectGenre(text) {
  const s = genreScores(text);
  const best = Object.entries(s).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}
/** "house, funk" → ['house', 'funk'] (ids, or genre names, or their words). */
export function genreList(text) {
  return String(text || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
    .map((x) => (GENRES[x] ? x : Object.entries(GENRES).find(([, g]) => g.name.toLowerCase() === x || g.words.includes(x))?.[0]))
    .filter(Boolean);
}
/** The genres of a form or band: its own list, else the ones its "use for" text names. */
export const genresOf = (item) => {
  const own = genreList(item?.genres);
  return own.length ? own : Object.keys(genreScores(item?.use));
};
