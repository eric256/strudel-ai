// The 🧩 part editor's pure logic: mini-notation as bars (lib/mini-edit), a part's effects and note patterns
// (lib/partcode), and pitches on a staff (lib/staff).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMini, serializeMini, withGrid, eventAt, placeNote, removeNote, resizeNote, toggleAt, gridSteps } from '../public/lib/mini-edit.js';
import { readEffects, setEffect, addEffect, removeEffect, readSources, setSource, scanCalls } from '../public/lib/partcode.js';
import { parseScale, degreeToMidi, midiToDegree, noteToMidi, midiToNote, staffPos, stepToMidi, clefFor, intervalSemis } from '../public/lib/staff.js';

const SCALES = JSON.parse(readFileSync(new URL('../public/scale-intervals.json', import.meta.url), 'utf8'));
const round = (s) => serializeMini(parseMini(s));

test('mini-notation round-trips: the editable subset comes back the same (or simpler, meaning the same)', () => {
  for (const s of ['0 ~ 2 4', '<[0 ~ 2 ~ 1 ~ 2 ~] [0 ~ 1 ~ 2 ~ 3 ~]>', '<[0@3 2] [4 2 0 ~] [0@3 -1] [~ 2 4 7]>', 'bd ~ [bd,hh] sd', 'x ~ x x ~ x ~ x', '<3 4 3 5>', 'c4 eb4 g4', '1 0.6'])
    assert.equal(round(s), s, s);
  assert.equal(round('hh*8'), 'hh hh hh hh hh hh hh hh');
  assert.equal(round('[0 1] 2'), '0 1 2@2');
  assert.equal(round('0! 2'), '0 0 2');
  assert.equal(round('<[2@4 4@4] [0@8]>'), '<[2 4] 0>');
  // not editable: shown as text
  for (const s of ['bd(3,8)', '0 <2 3>', '{0 1, 2 3 4}', '0?', 'bd:3 . hh']) assert.ok(parseMini(s).error, s);
});

test('mini-notation editing: place, remove, resize, toggle, grids', () => {
  let bar = parseMini('0 ~ 2 4').bars[0];
  assert.equal(bar.res, 4);
  bar = withGrid(bar, 8);
  assert.equal(bar.res, 8);
  assert.equal(eventAt(bar, 1).vals[0], '0', 'a note covers its length');
  bar = placeNote(bar, 2, 2, ['5']); // into the rest
  assert.equal(serializeMini({ alt: false, bars: [bar] }), '0 5 2 4');
  bar = placeNote(bar, 1, 1, ['7']); // cuts the first note short
  assert.equal(serializeMini({ alt: false, bars: [bar] }), '0 7 5@2 2@2 4@2');
  bar = removeNote(bar, eventAt(bar, 1));
  bar = resizeNote(bar, eventAt(bar, 0), 8); // as long as it can: up to the next note
  assert.equal(serializeMini({ alt: false, bars: [bar] }), '0 5 2 4');
  let d = withGrid(parseMini('bd ~ sd ~').bars[0], 4);
  d = toggleAt(d, 2, 1, 'hh'); // add to a step that has a hit: both at once
  assert.equal(serializeMini({ alt: false, bars: [d] }), 'bd ~ [sd,hh] ~');
  d = toggleAt(d, 2, 1, 'sd');
  d = toggleAt(d, 0, 1, 'bd'); // the last one out: a rest
  assert.equal(serializeMini({ alt: false, bars: [d] }), '~ ~ hh ~');
  assert.equal(gridSteps(parseMini('0 ~ 2 4').bars[0], 8), 8);
  assert.equal(gridSteps(parseMini('0 1 2').bars[0], 4), 12, 'a finer grid that still has the threes');
  assert.equal(serializeMini({ alt: true, bars: [parseMini('0 2').bars[0], parseMini('4').bars[0]] }), '<[0 2] 4>');
});

const HARP = `const harp_alt1 = (prog) => n("<[0 ~ 2 ~] [0 ~ 1 ~]>").chord(prog).voicing().s("folkharp").clip(1).release(0.8)
  .velocity("<0.8 0.6>").room(slider(0.4, 0, 1)).gain(slider(0.6, 0, 1.2))`;
const DRUMS = 'const drums_main = stack(s("bd*4"), s("~ cp ~ cp").n("<1 2>"), s("hh*8").velocity("0.5 1")).bank("RolandTR909").gain(slider(0.9, 0, 1.2))';
const LEAD = 'const lead_main = n("0 2 4 2").scale("A:minor").s("sawtooth").lpf(800).lastOf(4, x => x.add(note(12))).gain(0.5) // the hook';

test('part code: the effects on the whole part — read, set (sliders stay sliders), add before the gain, remove', () => {
  const fx = readEffects(HARP);
  assert.deepEqual(fx.map((e) => `${e.key}:${e.kind}`), ['clip:number', 'release:number', 'velocity:pattern', 'room:slider', 'gain:slider']);
  const room = fx.find((e) => e.key === 'room');
  assert.deepEqual([room.value, room.min, room.max], [0.4, 0, 1]);
  let c = setEffect(HARP, room, 0.75);
  assert.match(c, /\.room\(slider\(0\.75, 0, 1\)\)/);
  c = addEffect(c, 'lpf');
  assert.match(c, /\.room\(slider\(0\.75, 0, 1\)\)\.lpf\(slider\(2000, 50, 16000\)\)\.gain\(/, 'added before the gain');
  c = removeEffect(c, readEffects(c).find((e) => e.key === 'release'));
  assert.doesNotMatch(c, /release/);
  // effects inside the part (on one drum of a stack) aren't the part's; methods that take functions are skipped
  assert.deepEqual(readEffects(DRUMS).map((e) => e.key), ['gain']);
  assert.deepEqual(readEffects(LEAD).map((e) => e.key), ['lpf', 'gain']);
  assert.match(addEffect(LEAD, 'room'), /\.room\(slider\(0\.3, 0, 1\)\)\.gain\(0\.5\) \/\/ the hook$/);
  // calls in strings and comments are not calls
  assert.ok(!scanCalls('const x = s("lpf(3)") // .room(1)').some((c) => c.name === 'lpf' || c.name === 'room'));
});

test('part code: the note patterns and what they hold', () => {
  const kinds = (code) => readSources(code).map((s) => `${s.label}/${s.kind}`);
  assert.deepEqual(kinds(HARP), ['chord tones/tone', 'velocity/level']);
  assert.deepEqual(kinds(DRUMS), ['drums 1/drums', 'drums 2/drums', 'hits/index', 'drums 3/drums', 'velocity/level']);
  assert.deepEqual(kinds(LEAD), ['notes/degree'], 'note(12) inside lastOf is not a pattern string');
  assert.equal(readSources(LEAD)[0].scale, 'A:minor');
  assert.deepEqual(kinds('const b = (prog) => chord(prog).rootNotes(2).struct("x ~ x ~").s("gm_cello")'), ['rhythm/rhythm']);
  assert.deepEqual(kinds('const m = note("<c4 e4> g4").s("piano")'), ['notes/pitch']);
  assert.deepEqual(kinds('const p = chord("<Am F>").voicing().s("sawtooth")'), [], 'a single synth name is a sound, not a pattern');
  const src = readSources(LEAD)[0];
  assert.match(setSource(LEAD, src, '0 1 2 3'), /^const lead_main = n\("0 1 2 3"\)\.scale/);
});

test('staff: degrees and note names to MIDI and back, and where they sit on the staff', () => {
  const am = parseScale('A:minor', SCALES), b = parseScale('B:minor', SCALES);
  assert.equal(am.tonic, 57, 'A3, as Strudel puts the root in octave 3');
  assert.deepEqual([0, 2, 4, 7, -1].map((d) => midiToNote(degreeToMidi(d, b))), ['b3', 'd4', 'f#4', 'b4', 'a3']);
  for (const d of [-3, 0, 5, 9]) assert.equal(midiToDegree(degreeToMidi(d, am), am), d);
  assert.equal(midiToDegree(61, am), 2, 'C#4: as near C4 as D4 — the lower one');
  assert.equal(midiToDegree(63, am), 3, 'D#4: nearest is D4 (E4 is a step further)');
  assert.equal(parseScale('C4:major:pentatonic', SCALES).steps.length, 5);
  assert.equal(parseScale('nonsense', SCALES), null);
  assert.deepEqual([noteToMidi('c4'), noteToMidi('eb3'), noteToMidi('a'), noteToMidi(60), noteToMidi('bd')], [60, 51, 57, 60, null]);
  assert.equal(midiToNote(63, true), 'eb4');
  assert.deepEqual([intervalSemis('3m'), intervalSemis('5d'), intervalSemis('4A'), intervalSemis('7M')], [3, 6, 6, 11]);
  assert.deepEqual(staffPos(64), { step: 0, acc: '' }, 'E4 on the treble bottom line');
  assert.deepEqual(staffPos(66), { step: 1, acc: '♯' });
  assert.deepEqual(staffPos(70, 'treble', true), { step: 4, acc: '♭' });
  assert.equal(staffPos(43, 'bass').step, 0, 'G2 on the bass bottom line');
  assert.equal(stepToMidi(staffPos(77).step), 77);
  assert.equal(clefFor([40, 45, 52]), 'bass');
  assert.equal(clefFor([60, 67, 72]), 'treble');
});
