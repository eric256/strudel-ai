// The console's pure logic: the fader taper and peak warnings (lib/taper), the 🎚 Equalizer's bands and presets
// (lib/eq), and the master chain's nodes switched off (master.js effectiveParams).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gainToPos, posToGain, toDb, fromDb, faderMarks, peakState } from '../public/lib/taper.js';
import { EQ_BANDS, EQ_PRESETS, normEq, isFlat, presetOf } from '../public/lib/eq.js';
import { MASTER_NODES, MASTER_PARAMS, MASTER_DEFAULTS, effectiveParams, styleParams } from '../public/master.js';

test('fader taper: like a console — 0 dB about 80 % up, the quiet end squeezed, −∞ at the bottom', () => {
  assert.equal(gainToPos(0), 0);
  assert.equal(gainToPos(fromDb(6)), 1);
  assert.ok(Math.abs(gainToPos(1) - 0.826) < 0.01, `0 dB at ${gainToPos(1)}`);
  assert.ok(gainToPos(fromDb(-20)) > 0.3 && gainToPos(fromDb(-20)) < 0.45);
  for (const g of [0.01, 0.1, 0.5, 1, 1.5, 1.99]) assert.ok(Math.abs(posToGain(gainToPos(g)) - g) < 1e-6, `round trip ${g}`);
  assert.equal(posToGain(0), 0);
  assert.ok(gainToPos(1, 3.5) > gainToPos(1, 6), 'a lower top puts 0 dB higher');
  assert.deepEqual(faderMarks(3.5), [3, 0, -5, -10, -20, -30, -40]);
  assert.equal(toDb(0), -Infinity);
  assert.equal(Math.round(toDb(fromDb(-12)) * 100) / 100, -12);
});

test('peak warnings: hot near the top, clip at it', () => {
  assert.equal(peakState(0.5), '');
  assert.equal(peakState(0.75), 'hot');
  assert.equal(peakState(0.97), 'clip');
  assert.equal(peakState(1.4), 'clip');
});

test('equalizer: 7 bands, gains kept in range on half-dB steps, presets recognised', () => {
  assert.equal(EQ_BANDS.length, 7);
  assert.equal(EQ_BANDS[0].type, 'lowshelf');
  assert.equal(EQ_BANDS[6].type, 'highshelf');
  assert.deepEqual(normEq([3.3, 99, -50, 'x']), [3.5, 12, -12, 0, 0, 0, 0]);
  assert.ok(isFlat(null) && !isFlat([0, 0, 0, 0, 0, 0, 1]));
  for (const [key, p] of Object.entries(EQ_PRESETS)) {
    assert.equal(p.gains.length, 7, key);
    assert.equal(presetOf(p.gains), key === 'flat' ? 'flat' : key);
  }
  assert.ok(EQ_PRESETS.soft.gains.slice(4).every((g) => g < 0), 'Soft top turns the highs down');
  assert.equal(presetOf([1, 2, 3, 4, 5, 6, 7]), '');
});

test('master chain: every control belongs to a node; a node switched off passes the sound through', () => {
  const groups = MASTER_NODES.map((n) => n.group);
  assert.ok(MASTER_PARAMS.every((d) => groups.includes(d.group)), 'each control is on a node');
  const p = styleParams('lo-fi');
  assert.deepEqual(effectiveParams(p, []), p, 'all on: as set');
  const off = effectiveParams(p, ['Color', 'Space', 'EQ', 'Dynamics']);
  assert.equal(off.drive, 0);
  assert.equal(off.crush, 0);
  assert.equal(off.vinyl, 0);
  assert.equal(off.space, 0);
  assert.equal(off.low, 0);
  assert.equal(off.high, 0);
  assert.equal(off.glue, 0);
  assert.equal(off.width, MASTER_DEFAULTS.width);
  assert.equal(off.size, p.size, 'a switched-off node keeps its other settings for when it comes back');
  assert.equal(off.filter, p.filter, 'nodes still on are untouched');
  assert.equal(effectiveParams(p, ['Output']).loud, 0);
});
