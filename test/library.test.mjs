import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitLibrary, joinLibrary, renameDef, stubDef } from '../public/lib/library.js';

const LIB = `setcpm(120/4)
// a helper
const drums_main = s("bd*4")
  .bank("RolandTR909")
const bass_main = (prog) => chord(prog).rootNotes(2)
  .s("sawtooth")
const bass_fill = (prog) => chord(prog).s("sawtooth").fast(2)
`;

test('splitLibrary: the head, then one definition per const (multi-line ones kept whole)', () => {
  const { head, defs } = splitLibrary(LIB);
  assert.equal(head, 'setcpm(120/4)\n// a helper');
  assert.deepEqual(defs.map((d) => d.id), ['drums_main', 'bass_main', 'bass_fill']);
  assert.equal(defs[0].code, 'const drums_main = s("bd*4")\n  .bank("RolandTR909")');
});

test('joinLibrary puts it back together', () => {
  assert.equal(joinLibrary(splitLibrary(LIB)), LIB);
});

test('renameDef renames the const', () => {
  const d = renameDef({ id: 'bass_main', code: 'const bass_main = (prog) => chord(prog)' }, 'sub_main');
  assert.deepEqual(d, { id: 'sub_main', code: 'const sub_main = (prog) => chord(prog)' });
});

test('stubDef: a starting point that fits the role', () => {
  assert.match(stubDef('drums_main', { role: 'drums', sound: 'RolandTR808' }), /^const drums_main = s\(.*\.bank\("RolandTR808"\)/);
  assert.match(stubDef('pad_main', { role: 'pad', sound: 'gm_pad_warm' }), /^const pad_main = \(prog\) => chord\(prog\)\.voicing\(\)/);
  assert.match(stubDef('bass_main', { role: 'bass', sound: 'sine' }), /rootNotes\(2\)/);
  assert.match(stubDef('hook_main', { role: 'melody', sound: 'square', scale: 'A:minor' }), /scale\("A:minor"\)/);
});
