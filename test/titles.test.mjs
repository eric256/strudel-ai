// Song titles: the random title pattern, the examples, the request, and the check against titles already used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TITLE_SHAPES, GENRE_TITLES, titleWords, cleanTitle, checkTitle, titlePattern, titleExamples, bandTitles, titleRequest, fallbackTitle } from '../public/lib/titles.js';
import { GENRES } from '../public/lib/genres.js';

const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

test('key words: lower case, no little words, no plural s, no accents', () => {
  assert.deepEqual(titleWords('The Lanterns of Rua das Flores'), ['lantern', 'rua', 'das', 'flore']);
  assert.deepEqual(titleWords("Marisol's Bicycle"), ['marisol', 'bicycle']);
  assert.deepEqual(titleWords('Café da Manhã'), ['cafe', 'manha']);
  assert.deepEqual(titleWords('Gate B12'), ['gate', 'b12']);
});

test('a title from a reply: first line, no quotes, labels or markdown', () => {
  assert.equal(cleanTitle('"Borrowed Umbrella"'), 'Borrowed Umbrella');
  assert.equal(cleanTitle('Title: **Gate B12**\n\nIt fits because…'), 'Gate B12');
  assert.equal(cleanTitle('<think>hmm</think>\n“Hail on Tuesday.”'), 'Hail on Tuesday');
  assert.equal(cleanTitle('```\nMarisol\n```'), 'Marisol');
});

test('the check: worn words, repeats, shared key words, length', () => {
  const recent = ['Glass Harbor', 'Route 9 Diner'];
  assert.equal(checkTitle('Borrowed Umbrella', recent), null);
  assert.match(checkTitle('Neon Alley', recent), /neon/);
  assert.match(checkTitle('Midnight', recent), /worn-out/);
  assert.match(checkTitle('glass harbor', recent), /already used/);
  assert.match(checkTitle('Harbor Lights', recent), /"harbor" is already in "Glass Harbor"/);
  assert.match(checkTitle('Harbors at Dawn', recent), /harbor/, 'plurals count as the same word');
  assert.match(checkTitle('The Diner on Route 66', recent), /route|diner/);
  assert.equal(checkTitle('Late Train', recent), null, 'little words and numbers don\'t clash');
  assert.match(checkTitle('', recent), /empty/);
  assert.match(checkTitle('One Two Three Four Five Six Seven', recent), /too long/);
  // older titles: only never the same title again
  assert.equal(checkTitle('Harbor Lights', [], ['Glass Harbor']), null);
  assert.match(checkTitle('Glass Harbor', [], ['Glass Harbor']), /already used/);
});

test('the pattern: a shape not used lately, sometimes a world and a letter', () => {
  const p = titlePattern({ recent: TITLE_SHAPES.slice(0, -1).map((s) => s.id), rnd: seq(0) });
  assert.equal(p.shape.id, TITLE_SHAPES[TITLE_SHAPES.length - 1].id, 'the only fresh shape');
  const shapes = new Set([...Array(200)].map(() => titlePattern().shape.id));
  assert.ok(shapes.size >= 12, `shapes vary: ${shapes.size}`);
  const q = titlePattern({ rnd: seq(0.05, 0.9, 0.3, 0.9, 0.6) });
  assert.ok(q.world && q.letter, JSON.stringify(q));
  const f = titlePattern({ recent: TITLE_SHAPES.filter((s) => s.id !== 'foreign').map((s) => s.id), rnd: seq(0.1) });
  assert.equal(f.letter, null, 'a foreign word gets no letter');
});

test('examples: the band\'s own titles, else the genre\'s', () => {
  assert.ok(Object.keys(GENRES).every((g) => GENRE_TITLES[g]?.length >= 5), 'every genre has examples');
  const band = { titles: 'Porch Light, Cider Orchard, "Woodstove"' };
  assert.deepEqual(bandTitles(band), ['Porch Light', 'Cider Orchard', 'Woodstove']);
  assert.deepEqual(titleExamples({ band, genre: 'techno', rnd: seq(0) }).sort(), ['Cider Orchard', 'Porch Light', 'Woodstove']);
  const ex = titleExamples({ genre: 'latin', rnd: seq(0.5) });
  assert.equal(ex.length, 3);
  assert.ok(ex.every((t) => GENRE_TITLES.latin.includes(t)));
  assert.equal(titleExamples({}).length, 3, 'no genre: a mixed few');
  // a band with one title (made from a song) mixes it with its genre's
  assert.ok(titleExamples({ band: { titles: 'Gate B12' }, genre: 'house', rnd: seq(0) }).includes('Gate B12'));
});

test('the request: short, with the shape, the world, the letter, the examples, what to avoid and what was refused', () => {
  const r = titleRequest({ desc: 'lo-fi beat, 80 bpm', genre: 'lo-fi', pattern: { shape: TITLE_SHAPES[0], world: 'a bakery', letter: 'M' },
    examples: ['Cold Coffee', 'Library Card'], avoid: ['Gate B12'], refused: [{ title: 'Neon Bakery', why: '"neon" is a worn-out title word' }] });
  for (const want of ['SONG: lo-fi beat', 'GENRE: lo-fi', 'TITLE SHAPE: a specific named place', 'like "Route 9 Diner"', 'TAKE THE IMAGE FROM: a bakery',
    'START WITH THE LETTER: M', 'Cold Coffee · Library Card', 'ALREADY USED — none of these, and none of their words: Gate B12', '"Neon Bakery" ("neon"', 'title only'])
    assert.ok(r.includes(want), `missing ${want}:\n${r}`);
  assert.ok(r.length < 900);
  const bare = titleRequest({ desc: 'x', pattern: { shape: TITLE_SHAPES[6], world: null, letter: null } });
  assert.ok(!/IMAGE|LETTER|ALREADY|NOT THESE|STYLE/.test(bare));
});

test('a fallback title is never one already used', () => {
  assert.equal(fallbackTitle('Marisol', ['Marisol']), 'Marisol 2');
  assert.equal(fallbackTitle('Marisol', ['marisol 2']), 'Marisol 3');
});
