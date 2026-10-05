// Polyphonic parts: voices (lines played together) and layers (the same notes on more sounds) in a part's code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normVoices, normLayers, voiceKey, shiftLine, counterLine, voiceLine, addVoice, removeVoice, voiceSources, hasVoices,
  readLayers, addLayer, removeLayer, canLayer, ensurePoly } from '../public/lib/poly.js';
import { readSources } from '../public/lib/partcode.js';
import { normalizeSheet } from '../public/lib/sheet.js';

const HOOK = 'const hook_main = n("<[0@3 2] [4 2 0 ~]>").scale("A:minor").s("sawtooth").lpf(slider(900, 200, 4000)).gain(slider(0.6, 0, 1.2))';

test('voices and layers as the sheet writes them', () => {
  assert.equal(voiceKey('harmony a third below'), 'third_below');
  assert.equal(voiceKey('3rd above'), 'third_above');
  assert.equal(voiceKey('sixth'), 'sixth_below');
  assert.equal(voiceKey('octave up'), 'octave_above');
  assert.equal(voiceKey('a counter-line'), 'counter');
  assert.equal(voiceKey('banjo'), null);
  assert.deepEqual(normVoices(['third below', 'third below', 'sixth', 'counter']), ['third_below', 'sixth_below']);
  assert.deepEqual(normVoices('octave below'), ['octave_below']);
  assert.deepEqual(normLayers(['sawtooth', { sound: 'gm_pad_warm' }, 'two words', 'gm_choir_aahs'], 'sawtooth'), ['gm_pad_warm', 'gm_choir_aahs']);
});

test('the sheet keeps voices on melodic parts and layers off drums', () => {
  const sh = normalizeSheet({
    chords: { a: 'Am F C G' }, hook: '0 2 4 2',
    parts: [
      { name: 'drums', role: 'drums', sound: 'RolandTR909', layers: ['bd'] },
      { name: 'pad', role: 'pad', sound: 'gm_pad_warm', voices: ['third below'], layers: ['gm_choir_aahs'] },
      { name: 'theme', role: 'melody', sound: 'gm_vibraphone', voices: ['third below', 'counter'] },
    ],
    sections: [{ name: 'verse', chords: 'a', play: ['drums', 'pad', 'theme'] }, { name: 'chorus', chords: 'a', play: ['drums', 'pad'] }],
  }, 'auto', { enforceForm: false });
  const p = (id) => sh.parts.find((x) => x.id === id);
  assert.equal(p('drums').layers, undefined);
  assert.equal(p('pad').voices, undefined, 'chords are already chords');
  assert.deepEqual(p('pad').layers, ['gm_choir_aahs']);
  assert.deepEqual(p('theme').voices, ['third_below', 'counter']);
});

test('harmony lines move along the scale', () => {
  assert.equal(shiftLine('0 2 4 ~', -2), '-2 0 2 ~');
  assert.equal(shiftLine('<[0@3 2] [4 2 0 ~]>', -5), '<[-5@3 -3] [-1 -3 -5 ~]>');
  assert.equal(shiftLine('[0,4] 2', 7), '[7,11] 9');
  assert.equal(shiftLine('0 2 {4 5}', 2), null, 'notation it cannot read');
  assert.equal(counterLine('<[0 2] [4 5]>'), '<-4 0>');
  assert.equal(voiceLine('0 2', 'third_above'), '2 4');
});

test('a voice goes into a stack under one scale and sound, and comes out again', () => {
  const src = readSources(HOOK)[0];
  const two = addVoice(HOOK, src, '<[-2@3 0] [2 0 -2 ~]>');
  assert.match(two, /stack\(n\("<\[0@3 2\] \[4 2 0 ~\]>"\), n\("<\[-2@3 0\] \[2 0 -2 ~\]>"\)\.velocity\(0\.7\)\)\.scale\("A:minor"\)\.s\("sawtooth"\)/);
  assert.equal(voiceSources(two).length, 2);
  assert.ok(voiceSources(two).every((s) => s.scale === 'A:minor'), 'each voice knows the stack\'s scale');
  assert.ok(hasVoices(two) && !hasVoices(HOOK));
  const three = addVoice(two, voiceSources(two)[0], '~');
  assert.equal(voiceSources(three).length, 3, 'a third voice joins the same stack');
  assert.equal((three.match(/stack\(/g) || []).length, 1);
  assert.equal(removeVoice(removeVoice(three, voiceSources(three)[2]), voiceSources(two)[1]), HOOK, 'back to one line');
});

test('layers: the part\'s sound becomes .layer(...), more join it, and the last one left is a plain sound again', () => {
  const one = addLayer(HOOK, 'gm_string_ensemble_1');
  assert.match(one, /\.layer\(x => x\.s\("sawtooth"\), x => x\.s\("gm_string_ensemble_1"\)\.velocity\(0\.6\)\)\.lpf/);
  assert.deepEqual(readLayers(one).map((l) => l.sound), ['sawtooth', 'gm_string_ensemble_1']);
  const two = addLayer(one, 'gm_choir_aahs');
  assert.equal(readLayers(two).length, 3);
  assert.equal(removeLayer(removeLayer(two, 2), 1), HOOK);
  assert.ok(!canLayer('const drums_main = stack(s("bd*4"), s("hh*8")).bank("RolandTR909").gain(0.8)'), 'no single sound to layer');
  assert.ok(canLayer(HOOK));
});

test('ensurePoly adds what the sheet asked for, and leaves code that already has it', () => {
  const out = ensurePoly(HOOK, { voices: ['third_below', 'counter'], layers: ['gm_string_ensemble_1'] });
  assert.equal(voiceSources(out).length, 3);
  assert.deepEqual(voiceSources(out).map((s) => s.value), ['<[0@3 2] [4 2 0 ~]>', '<[-2@3 0] [2 0 -2 ~]>', '<-4 0>']);
  assert.deepEqual(readLayers(out).map((l) => l.sound), ['sawtooth', 'gm_string_ensemble_1']);
  assert.equal(ensurePoly(out, { voices: ['third_below'], layers: ['gm_string_ensemble_1'] }), out);
  const written = 'const t = n("0 2").scale("A:minor").superimpose(x => x.add(-2)).s("sine")';
  assert.equal(ensurePoly(written, { voices: ['third_below'] }), written, 'the AI\'s own harmony stays');
  const pad = 'const pad_main = (prog) => chord(prog).voicing().s("gm_pad_warm").gain(0.5)';
  assert.equal(ensurePoly(pad, { voices: ['third_below'] }), pad, 'no degree line: no voice to add');
  assert.match(ensurePoly(pad, { layers: ['gm_choir_aahs'] }), /chord\(prog\)\.voicing\(\)\.layer\(x => x\.s\("gm_pad_warm"\), x => x\.s\("gm_choir_aahs"\)/);
});
