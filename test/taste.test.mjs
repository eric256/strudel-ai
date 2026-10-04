// 🎧 Your taste: avoided sounds swapped in code, harsh synths softened, what the AI is told.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normTaste, applyAvoid, swapSound, softerFor, isHarsh, softenCode, tasteForPrompt, isEmpty } from '../public/lib/taste.js';
import { sectionCode, setArrangeTaste } from '../public/lib/arrange.js';

const T = normTaste({ avoid: [{ sound: 'square', instead: 'triangle' }, { sound: 'RolandTR909', instead: 'RolandTR808' }, { sound: 'supersaw', instead: '' }], soften: true, cutoff: 2500, likes: 'warm, round', liked: ['gm_epiano1', 'square'] });

test('taste: cleaned up (duplicates, a sound that is its own stand-in, a liked sound you avoid, the cutoff range)', () => {
  const t = normTaste({ avoid: [{ sound: 'square', instead: 'triangle' }, { sound: 'SQUARE', instead: 'sine' }, { sound: 'sine', instead: 'sine' }, { sound: '' }], cutoff: 99999, liked: ['square', 'piano', 'piano'] });
  assert.deepEqual(t.avoid, [{ sound: 'square', instead: 'triangle' }, { sound: 'sine', instead: '' }], 'a sound can\'t stand in for itself: it is just avoided');
  assert.equal(t.cutoff, 8000);
  assert.deepEqual(t.liked, ['piano']);
  assert.deepEqual(T.liked, ['gm_epiano1']);
  assert.ok(isEmpty(normTaste(null)) && !isEmpty(T));
});

test('taste: avoided sounds are swapped in s / sound / bank strings — whole words only, not in comments or other names', () => {
  const code = 'const a = n("0 2").s("square").lpf(800)\nconst b = s("<square sawtooth> ~ square:2").bank("RolandTR909")\nconst c = s("gm_lead_1_square") // a square comment\nconst d = note("c4").sound("SQUARE")\nconst e = s("supersaw")';
  const { code: out, swapped } = applyAvoid(code, T);
  assert.match(out, /s\("triangle"\)\.lpf\(800\)/);
  assert.match(out, /s\("<triangle sawtooth> ~ triangle:2"\)\.bank\("RolandTR808"\)/);
  assert.match(out, /s\("gm_lead_1_square"\) \/\/ a square comment/);
  assert.match(out, /sound\("triangle"\)/);
  assert.match(out, /s\("supersaw"\)/, 'no stand-in: the AI avoids it, the code is left alone');
  assert.deepEqual(swapped, [['square', 'triangle', 4], ['RolandTR909', 'RolandTR808', 1]]);
  assert.equal(applyAvoid(code, normTaste({})).code, code);
  assert.equal(swapSound('Square', T), 'triangle');
  assert.equal(swapSound('piano', T), 'piano');
  assert.deepEqual([softerFor('square'), softerFor('gm_lead_2_sawtooth'), softerFor('RolandTR909'), softerFor('triangle'), softerFor('gm_piano')], ['triangle', 'gm_lead_4_chiff', '', 'sine', 'triangle']);
});

test('taste: harsh synths without a filter of their own are softened as songs are arranged', () => {
  assert.equal(isHarsh('const x = n("0").s("sawtooth").gain(1)'), true);
  assert.equal(isHarsh('const x = s("sawtooth").lpf(300)'), false, 'it has its own filter');
  assert.equal(isHarsh('const x = s("triangle")'), false);
  const lib = 'setcpm(30)\nconst lead_main = n("0 2").scale("A:minor").s("square")\nconst pad_main = (prog) => chord(prog).voicing().s("sawtooth").lpf(900)';
  assert.equal(softenCode(lib, 'lead_main', T), '.lpf(2500)');
  assert.equal(softenCode(lib, 'pad_main', T), '');
  assert.equal(softenCode(lib, 'lead_main', { ...T, soften: false }), '');
  const song = { title: 'T', library: lib, sheet: { parts: [{ id: 'lead', role: 'melody' }, { id: 'pad', role: 'pad' }], chords: { v: '<Am>' }, meter: '4/4', feel: 0 } };
  const sec = { name: 'v', bars: 4, chords: 'v', play: [{ part: 'lead', variant: 'main' }, { part: 'pad', variant: 'main' }] };
  setArrangeTaste(T);
  const code = sectionCode(song, sec);
  setArrangeTaste(null);
  assert.match(code, /^lead: lead_main\.lpf\(2500\)\.postgain/m);
  assert.match(code, /^pad: pad_main\(sectionChords\)\.postgain/m);
  assert.doesNotMatch(sectionCode(song, sec), /lpf\(2500\)/, 'no taste: nothing added');
});

test('taste: what the AI is told', () => {
  const p = tasteForPrompt(T);
  assert.match(p, /NEVER use these sounds: square \(use triangle instead\), RolandTR909 \(use RolandTR808 instead\), supersaw\./);
  assert.match(p, /Sounds they like: gm_epiano1/);
  assert.match(p, /In their words: warm, round/);
  assert.match(p, /Harsh, buzzy timbres/);
  assert.equal(tasteForPrompt(normTaste({})), '');
});
