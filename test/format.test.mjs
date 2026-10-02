import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapCode } from '../public/format.js';

const width = (code) => Math.max(...code.split('\n').map((l) => l.length));
const parses = (code) => new Function(code.replace(/^\s*[A-Za-z_$][\w$]*:(?!:)/gm, '')); // labels → plain expressions

test('short code is untouched', () => {
  const code = 'setcpm(120/4)\ndrums: s("bd*4").gain(0.8)';
  assert.equal(wrapCode(code), code);
});

test('long chains break before methods at the chain level, indented two spaces', () => {
  const line = 'bass: note("<c2 c2 eb2 g1>*8").s("sawtooth").lpf(slider(1200, 200, 4000)).lpq(slider(6, 0, 20)).decay(0.15).sustain(0).gain(slider(0.6, 0, 1.2)).postgain(slider(1, 0, 1.5))';
  const out = wrapCode(line, 80);
  assert.ok(width(out) <= 80, out);
  assert.match(out.split('\n')[1], /^ {2}\./);
  assert.equal(out.replace(/\n\s*/g, ''), line.replace(/\s+(?=\.)/g, ''));
  parses(out);
});

test('a long call gets one argument per line and the chain continues from the closing bracket', () => {
  const line = 'drums: stack(s("bd*4"), s("~ cp ~ cp"), s("hh*8").velocity("0.5 1"), s("~ ~ ~ oh").gain(0.4)).bank("RolandTR909").gain(slider(0.9, 0, 1.2)).postgain(slider(1, 0, 1.5))';
  const out = wrapCode(line, 80).split('\n');
  assert.equal(out[0], 'drums: stack(');
  assert.equal(out[1], '  s("bd*4"),');
  assert.match(out.find((l) => l.startsWith(')')), /^\)\.bank\("RolandTR909"\)/);
  parses(out.join('\n'));
});

test('strings, comments and numbers are never split', () => {
  const mini = `n("${'0 2 4 7 '.repeat(30).trim()}")`;
  const line = `lead: ${mini}.scale("A:minor").s("sawtooth").gain(0.5) // ${'x'.repeat(30)}`;
  const out = wrapCode(line, 100);
  assert.ok(out.includes(mini), 'the mini-notation string stays whole');
  assert.ok(out.trimEnd().endsWith(`// ${'x'.repeat(30)}`), 'the comment stays at the end');
  assert.ok(out.includes('gain(0.5)'));
});

test('wrapping is idempotent', () => {
  const code = 'const bass_main = (prog) => chord(prog).rootNotes(2).struct("x x x x x x x x").s("gm_synth_bass_2").decay(0.12).sustain(0.2).lpf(slider(900, 200, 4000)).gain(slider(0.8, 0, 1.2))';
  const once = wrapCode(code, 90);
  assert.equal(wrapCode(once, 90), once);
  parses(once);
});
