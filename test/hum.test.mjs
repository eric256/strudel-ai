// Unit tests for the hum → melody pipeline (pure functions, no browser needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yin, rms, transcribe, intervalsToSemitones, tonicPc, snapToSet, barToMini } from '../public/hum.js';

const SR = 48000;

function synth(melody, { cps = 0.5, lead = 0.25, seconds = 4.6 } = {}) {
  // melody: [midi, startBeat, beats] with 4 beats per cycle
  const audio = new Float32Array(Math.ceil(seconds * SR));
  let phase = 0;
  for (let i = 0; i < audio.length; i++) {
    const t = i / SR - lead, beat = t * cps * 4;
    const n = melody.find(([, s, d]) => beat >= s && beat < s + d * 0.9);
    if (!n) continue;
    const k = (beat - n[1]) / (n[2] * 0.9);
    const f = 440 * 2 ** ((n[0] - 69 + 0.2 * Math.sin(2 * Math.PI * 5.5 * t)) / 12); // vibrato
    phase += (2 * Math.PI * f) / SR;
    audio[i] = Math.min(1, k * 20, (1 - k) * 20) * 0.3 * (Math.sin(phase) + 0.3 * Math.sin(2 * phase));
  }
  return audio;
}

function frames(audio, cycleAtStart = null, cps = 0.5) {
  const out = [];
  for (let pos = 0; pos + 2048 < audio.length; pos += Math.round(0.012 * SR)) {
    const buf = audio.subarray(pos, pos + 2048);
    const level = rms(buf);
    const { freq, confidence } = level > 0.004 ? yin(buf, SR) : { freq: null, confidence: 0 };
    const t = (pos + 1024) / SR;
    out.push({ t, c: cycleAtStart == null ? null : cycleAtStart + t * cps, freq, confidence, rms: level });
  }
  return out;
}

test('yin detects A4 within a few cents', () => {
  const buf = new Float32Array(2048).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / SR));
  const { freq } = yin(buf, SR);
  assert.ok(Math.abs(1200 * Math.log2(freq / 440)) < 5, `got ${freq}`);
});

test('transcribes pitches and rhythm of a hummed melody (no music playing)', () => {
  const mel = [[60, 0, 1], [64, 1, 1], [67, 2, 1], [64, 3, 0.5], [62, 3.5, 0.5], [62, 4, 2], [65, 6, 1], [69, 7, 0.75]];
  const r = transcribe(frames(synth(mel)), { cps: 0.5, grid: 16 });
  assert.deepEqual(r.notes.map((n) => n.name), ['c4', 'e4', 'g4', 'e4', 'd4', 'd4', 'f4', 'a4']);
  assert.equal(r.bars, 2);
  assert.equal(r.notes[0].start, 0, 'phrase starts on the downbeat');
  assert.match(r.mini, /^<\[c4@\d+ e4@\d+ g4@\d+ e4 d4\] \[d4@\d+ ~ f4@\d+ a4@\d+ ~\]>$/);
});

test('aligns to the music grid when cycle positions are known', () => {
  const r = transcribe(frames(synth([[60, 0, 1], [67, 2, 1]], { lead: 0 }), 4), { cps: 0.5, grid: 16 });
  assert.equal(r.startBar, 4);
  assert.deepEqual(r.notes.map((n) => [n.name, n.start]), [['c4', 4], ['g4', 4.5]]);
});

test('scale helpers and snapping', () => {
  const aMinor = intervalsToSemitones('1P 2M 3m 4P 5P 6m 7m').map((x) => (x + tonicPc('A')) % 12);
  assert.deepEqual([...aMinor].sort((a, b) => a - b), [0, 2, 4, 5, 7, 9, 11]);
  assert.equal(snapToSet(60.8, [0, 2, 4, 5, 7, 9, 11]), 60); // sharp C → C in A minor
  assert.equal(snapToSet(61.2, [0, 2, 4, 5, 7, 9, 11]), 62); // flat D → D
  assert.equal(tonicPc('Eb4'), 3);
});

test('mini-notation weights are reduced and rests merged', () => {
  assert.equal(barToMini([{ s: 0, e: 4, midi: 60 }, { s: 8, e: 12, midi: 64 }], 16), 'c4 ~ e4 ~');
  assert.equal(barToMini([], 16), '~');
});
