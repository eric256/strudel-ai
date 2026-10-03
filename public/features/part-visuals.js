// Song sections used to get one of Strudel's inline visuals under each part (a punchcard, piano roll, spiral …).
// They're gone; sections saved or shared with them still carry them in their code, so they're taken off here.
import { SEC_START } from '../lib/arrange.js';

const PART_VIS_ANY = /\s*\.color\('#[0-9a-f]{6}'\)\s*\._(pianoroll|punchcard|spiral|pitchwheel|scope)\(\{[^}]*\}\)/g;
/** Take the old inline part visuals off a section's code. */
export function stripPartVisuals(code) {
  const at = code.indexOf(SEC_START);
  return at < 0 ? code : code.slice(0, at) + code.slice(at).replace(PART_VIS_ANY, '');
}
