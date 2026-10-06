// Song titles: the app picks a random title SHAPE (a pattern the AI fills in, sometimes with a starting letter and a
// world to draw the image from), a few example titles in the style of the song's genre (or its band's own), and checks
// what comes back against the titles already used (no repeats, no shared key words, no worn-out words).

/** Words every model reaches for: never in a title. */
export const WORN_WORDS = ['neon', 'midnight', 'echo', 'echoes', 'dream', 'dreams', 'dreaming', 'drift', 'drifting', 'horizon', 'horizons', 'velvet',
  'pulse', 'glow', 'glowing', 'nocturne', 'eclipse', 'cascade', 'odyssey', 'journey', 'starlight', 'reverie', 'serenity', 'ethereal',
  'whisper', 'whispers', 'shadow', 'shadows', 'twilight', 'celestial', 'luminous', 'aurora', 'nebula', 'infinity', 'infinite', 'ascend',
  'ascension', 'chrome', 'synth', 'groove', 'vibes', 'lofi', 'beat', 'beats'];

/**
 * Title shapes: what the title is (a pattern to fill in), with one example of the shape. The AI gets ONE, picked by
 * the app, so titles don't all come out as "Adjective Noun".
 */
export const TITLE_SHAPES = [
  { id: 'place', shape: 'a specific named place — a street, station, shop, room or landmark ("[Name] [Place]")', eg: 'Route 9 Diner' },
  { id: 'person', shape: "a person's first name, alone or with what they have or do (\"[Name]\" or \"[Name]'s [Thing]\")", eg: "Marisol's Bicycle" },
  { id: 'time', shape: 'a time, a date, a day or a season ("[Time]")', eg: '4:12 AM' },
  { id: 'number', shape: 'a number and a plural thing ("[Number] [Things]")', eg: 'Seven Paper Lanterns' },
  { id: 'saying', shape: 'a short thing someone says, 2–4 words ("[Short sentence]")', eg: "Don't Wait Up" },
  { id: 'question', shape: 'a short question ("[Question]?")', eg: 'Who Took the Ferry?' },
  { id: 'single', shape: 'ONE uncommon, concrete word ("[Word]")', eg: 'Marmalade' },
  { id: 'verb', shape: 'an -ing verb and where or what ("[Verb]ing [Something]")', eg: 'Painting the Pier' },
  { id: 'the', shape: '"The" and one concrete noun ("The [Noun]")', eg: 'The Lighthouse Keeper' },
  { id: 'of', shape: 'a thing of a thing ("[Noun] of [Noun]")', eg: 'Map of Small Rivers' },
  { id: 'and', shape: 'two concrete things joined by "and" ("[Thing] and [Thing]")', eg: 'Salt and Copper' },
  { id: 'order', shape: 'an instruction, 2–3 words ("[Verb] [Something]")', eg: 'Mind the Gap' },
  { id: 'foreign', shape: 'one or two words in a language that fits the style (Japanese, Portuguese, Spanish, French, Italian, Swahili …)', eg: 'Saudade' },
  { id: 'object', shape: 'a worn, everyday object with one detail ("[Detail] [Object]")', eg: 'Borrowed Umbrella' },
  { id: 'weather', shape: 'a weather or sky event, precise, not poetic ("[Weather] [Where / When]")', eg: 'Hail on Tuesday' },
  { id: 'code', shape: 'a code, label or sign as it is written somewhere (a flight, a room, a form, a model number)', eg: 'Gate B12' },
];
/** Worlds to take the title's image from (so it isn't always night, cities and the sky). */
export const TITLE_WORLDS = ['a kitchen', 'a harbour', 'a railway', 'a garden', 'a market', 'a workshop', 'a library', 'the post office',
  'a swimming pool', 'a laundromat', 'a fairground', 'a desert road', 'a mountain hut', 'a fishing boat', 'an old cinema', 'a bakery',
  'a school', 'a hospital night shift', 'a ferry', 'a football pitch', 'a petrol station', 'a museum', 'a greenhouse', 'a hotel lobby',
  'a radio station', 'a bus depot', 'an orchard', 'a tailor', 'a chess club', 'a river bank', 'a rooftop', 'a lighthouse', 'a dance hall',
  'a train sleeper car', 'a corner shop', 'a typewriter', 'a postcard', 'a map', 'a lost-and-found', 'a recipe'];
/** Letters a title may be asked to start with (the common ones). */
const LETTERS = 'ABCDEFGHJKLMNOPRSTW';

/**
 * Example titles per genre (made up, in the way the genre names its tracks). The AI sees 3 of them (or the band's own),
 * as a style to follow — not words to reuse.
 */
export const GENRE_TITLES = {
  house: ['Back Room at Mario\'s', 'Keep Your Coat On', 'Saturday Bus Home', 'Fifth Floor Fire Exit', 'Juanita Says', 'Tiles', 'Six Til Six', 'Warm Up the Car'],
  techno: ['Unit 4', 'Concrete Stairwell', 'TX-81', 'Shift Change', 'Grid Reference', 'Cold Storage', 'Hall C', 'Relay'],
  trance: ['Above Lake Bled', 'First Ferry Out', 'Runway Lights', 'Cassiopeia Street', 'Open Water', 'Long Way North', 'Sunday Sky Over Ibiza'],
  edm: ['Hands Up Harry', 'Fireworks Permit', 'Jump the Barrier', 'Main Stage Fever', 'Ten Thousand Phones', 'Bass Cannon Repair'],
  dnb: ['Bristol Bus Station', 'Rollers Only', 'Late Train to Leeds', 'Amen Corner', 'Liquid Lunch', 'Tower Block Garden'],
  synthwave: ['Malibu Arcade 1986', 'VHS Rewind', 'Car Wash Closing Time', 'Miami Vice Principal', 'Laser Tag Champion', 'Cassette in the Glovebox'],
  lofi: ['Library Card', 'Rain on the Laundromat', 'Cold Coffee', 'Notes in the Margin', 'Grandma\'s Radio', 'Tuesday Homework', 'Bus Window'],
  hiphop: ['Corner Store Philosophy', 'Crate Dust', 'Uncle Ray\'s Cadillac', 'Block Party Flyer', 'Four Track Tape', 'Stoop Talk'],
  pop: ['Text Me When You\'re Home', 'Paper Crown', 'Roller Rink', 'Lemonade Stand', 'Kiss on the Ferris Wheel', 'Golden Retriever'],
  rock: ['Gasoline Sunday', 'Broken Amp Blues', 'Highway 61 Motel', 'Kick the Door In', 'Bad Neighbour', 'Garage Door Up'],
  jazz: ['Blue Note for Dolores', 'Monk\'s Umbrella', 'Two Bars Down', 'Waltz for Ida', 'Stairway at Birdland', 'Brush Strokes'],
  fusion: ['Coastline Express', 'Night Highway Tokyo', 'Mid-Summer Breeze', 'Sunshine Avenue', 'Port Island', 'Rainbow Bridge Cruise'],
  funk: ['Platform Shoes', 'Get Off the Phone', 'Mrs. Jackson\'s Party', 'Roller Disco Queen', 'Saturday Hustle', 'Hot Pants Factory'],
  ambient: ['Field Recording, Morning', 'Moss', 'Slow Tide at Kilve', 'Fog Over the Allotment', 'Glass Bells', 'Hours'],
  cinematic: ['The Siege of Arden', 'Letters from the Front', 'Main Titles', 'Crossing the Ice', 'The Last Lantern', 'Coronation'],
  dub: ['Kingston Rooftop', 'Version Two', 'Babylon Bus Stop', 'Sound Clash Saturday', 'Sound System Sunday', 'Dub Plate Special'],
  chiptune: ['Level 3-2', 'Continue?', 'Boss Rush', 'Save Point', 'Pixel Picnic', 'Insert Coin'],
  downtempo: ['Hotel Balcony', 'Slow Boat', 'Cigarette Break', 'Lounge Chair No. 7', 'Velour Sofa', 'Afternoon Nap'],
  acoustic: ['Porch Light', 'Cider Orchard', 'The Ferryman\'s Daughter', 'Woodstove', 'Old Hundred Road', 'Mending Nets'],
  latin: ['Café da Manhã', 'Rua das Flores', 'Domingo', 'La Playa de Elena', 'Samba de Sábado', 'Mercado'],
};
const ANY_TITLES = ['Borrowed Umbrella', 'Gate B12', 'Seven Paper Lanterns', 'Route 9 Diner', 'Salt and Copper', 'Marmalade'];

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'at', 'to', 'for', 'with', 'my', 'your', 'our', 'is', 'it', 'its', 'by',
  'from', 'up', 'down', 'no', 'not', 'me', 'you', 'i', 'we', 'de', 'la', 'le', 'el', 'da', 'do', 'des', 'du', 'ii', 'iii', 'part']);
/** A title's key words (lower case, no plural s, no little words): what counts as "the same word" between titles. */
export function titleWords(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)).map((w) => (w.length > 3 ? w.replace(/s$/, '') : w));
}
const WORN = new Set(WORN_WORDS.flatMap(titleWords));

/** A title cleaned from a reply: the first line, no quotes, labels or markdown, at most 60 characters. */
export function cleanTitle(text) {
  const line = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').split('\n').map((l) => l.trim()).find((l) => l && !/^```/.test(l)) || '';
  return line.replace(/^(?:\*\*)?(?:title|song|name)\s*[:\-–—]\s*/i, '').replace(/^[#*>\-\s]+/, '').replace(/^["'“”‘’«»`*_]+|["'“”‘’«»`*_.]+$/g, '').trim().slice(0, 60);
}

/**
 * Whether a title can be used: null, or why not — empty, too long, a worn-out word, already used, or sharing a key word
 * with a recent title (history: the recent titles to keep clear of; used: older ones, only never the same title again).
 */
export function checkTitle(t, history = [], used = []) {
  const title = String(t || '').trim();
  if (!title) return 'it is empty';
  if (title.length > 40 || title.split(/\s+/).length > 6) return 'it is too long (at most 5 words)';
  const words = titleWords(title);
  const worn = words.find((w) => WORN.has(w));
  if (worn) return `"${worn}" is a worn-out title word`;
  const low = title.toLowerCase();
  const same = used.find((h) => String(h).toLowerCase() === low);
  if (same) return `"${same}" was already used`;
  for (const h of history) {
    if (String(h).toLowerCase() === low) return `"${h}" was already used`;
    const shared = titleWords(h).find((w) => words.includes(w));
    if (shared) return `"${shared}" is already in "${h}"`;
  }
  return null;
}

/** A random pick from a list (rnd: a 0–1 random function). */
const pick = (list, rnd) => list[Math.floor(rnd() * list.length) % list.length];
function sample(list, n, rnd) {
  const pool = [...list], out = [];
  while (pool.length && out.length < n) out.push(pool.splice(Math.floor(rnd() * pool.length) % pool.length, 1)[0]);
  return out;
}

/**
 * The pattern for one title: { shape, world, letter } — a shape not among the recent ones, and (now and then) a world to
 * take the image from and a letter to start with. rnd: the random function (tests pass their own).
 */
export function titlePattern({ recent = [], rnd = Math.random } = {}) {
  const fresh = TITLE_SHAPES.filter((s) => !recent.includes(s.id));
  const shape = pick(fresh.length ? fresh : TITLE_SHAPES, rnd);
  const world = shape.id === 'foreign' || shape.id === 'code' || rnd() < 0.35 ? null : pick(TITLE_WORLDS, rnd);
  const letter = shape.id === 'foreign' || shape.id === 'time' || shape.id === 'number' || rnd() < 0.5 ? null : pick(LETTERS, rnd);
  return { shape, world, letter };
}

/** A band's own example titles ("titles" in the band: comma- or line-separated). */
export const bandTitles = (band) => String(band?.titles || '').split(/[,\n]/).map((x) => x.trim().replace(/^["“]|["”]$/g, '')).filter(Boolean);

/** 3 example titles for the style: the band's own if it has some, else the genre's (none known: a mixed few). */
export function titleExamples({ genre = null, band = null, rnd = Math.random, n = 3 } = {}) {
  const own = bandTitles(band);
  if (own.length >= 2) return sample(own, n, rnd);
  return sample([...own, ...(GENRE_TITLES[genre] || ANY_TITLES)], n, rnd);
}

/**
 * The (short) request for one title. desc: what the song is; avoid: titles to keep clear of (their words too);
 * refused: earlier tries this time and why they were refused.
 */
export function titleRequest({ desc = '', genre = '', pattern, examples = [], avoid = [], refused = [] }) {
  const { shape, world, letter } = pattern;
  return [
    `SONG: ${String(desc).slice(0, 400)}${genre ? `\nGENRE: ${genre}` : ''}`,
    `TITLE SHAPE: ${shape.shape} — like "${shape.eg}" (the shape, not those words)`,
    world ? `TAKE THE IMAGE FROM: ${world}` : '',
    letter ? `START WITH THE LETTER: ${letter}` : '',
    examples.length ? `TITLES IN THIS STYLE (for their flavour — don't reuse their words): ${examples.join(' · ')}` : '',
    avoid.length ? `ALREADY USED — none of these, and none of their words: ${avoid.join(' · ')}` : '',
    refused.length ? `NOT THESE (refused): ${refused.map((r) => `"${r.title}" (${r.why})`).join(' · ')}` : '',
    'Reply with the title only.',
  ].filter(Boolean).join('\n');
}

/** A title that can't be refused, when the AI keeps missing: the last try with a number after it. */
export function fallbackTitle(t, history = []) {
  const base = String(t || 'Untitled').trim() || 'Untitled';
  const used = new Set(history.map((h) => String(h).toLowerCase()));
  for (let k = 2; ; k++) if (!used.has(`${base} ${k}`.toLowerCase())) return `${base} ${k}`;
}
