// Song pads: 16 pads built from the song itself (its parts, key and chords), no AI needed.
// (split out of app.js)
import { meterSteps, normMeter } from '../lib/music.js';
import { isFnPart } from '../lib/sheet.js';
// --- song pads: 16 pads built from the song itself (its parts, key and chords) — no AI needed
/** The expression a library const is defined as (so a pad can play the part without the library loaded). */
function libExpr(lib, id) {
  const m = new RegExp(`^\\s*(?:const|let|var)\\s+${id}\\s*=\\s*`, 'm').exec(lib);
  if (!m) return null;
  const rest = lib.slice(m.index + m[0].length);
  const end = rest.search(/^\s*(?:const|let|var)\s+[\w$]+\s*=|^\s*setcp[ms]\(/m);
  return (end < 0 ? rest : rest.slice(0, end)).trim().replace(/;\s*$/, '');
}
export const JAM_ARP = (prog) => `n("0 1 2 3 2 1").chord(${prog}).voicing().fast(2).s("triangle").gain(0.4)`;
export const JAM_LEAD = (prog) => `n("<[0 ~ 2] [3 2] [4 ~ 3] [2 1]>").chord(${prog}).voicing().add(note(12)).s("sawtooth").lpf(2000).decay(0.2).sustain(0.3).gain(0.3)`;
/** Chords for a pad: the section's chords when one of the song's sections plays, else the song's first progression. */
export const padProg = (sh) => `(typeof sectionChords === 'undefined' ? ${JSON.stringify(Object.values(sh.chords)[0])} : sectionChords)`;
export function songPads(sg) {
  const sh = sg.sheet, lib = sg.library;
  if (!sh || !lib) return null;
  const pads = [];
  const add = (label, code, mode = 'toggle', color = '#7c5cff', extra = {}) => { if (pads.length < 16) pads.push({ label, code, mode, color, ...extra }); };
  // pads must work whatever is playing (see padProg)
  const prog = padProg(sh);
  const drums = sh.parts.find((p) => /drum|perc|beat/i.test(p.role + p.id));
  const bank = drums && /^[A-Z]/.test(drums.sound) ? `.bank("${drums.sound}")` : '';
  // rhythms in the song's meter: a 16th-note roll is 16 steps in 4/4, 12 in 3/4, 12 in 6/8
  const steps = meterSteps(sh.meter), roll = /\/8$/.test(normMeter(sh.meter)) ? steps * 2 : steps * 4;
  // the song's own parts, one pad each: lit while the section plays the part, pressing mutes / unmutes it
  // (or plays it on top when the section doesn't have it); then their extra variants (half-time drums, fills …)
  const partPad = (p, v) => {
    const id = `${p.id}_${v}`, expr = libExpr(lib, id);
    if (!expr) return;
    // the part's own code, inlined (the library consts only exist while one of this song's sections plays)
    const code = isFnPart(lib, id) ? `(${expr})(${prog})` : `(${expr})`;
    add(v === 'main' ? p.id : `${p.id} ${v}`, code, v === 'fill' ? 'once' : 'toggle', v === 'fill' ? '#ffd166' : '#4cc9f0', { part: p.id, variant: v });
  };
  for (const p of sh.parts) partPad(p, 'main');
  for (const p of sh.parts) for (const v of p.variants) if (v !== 'main' && pads.length < 10) partPad(p, v);
  // jam pads, most useful first (the song's parts may leave room for only some of them)
  add('tempo −¼', 'all(x => x.slow(4/3))', 'hold', '#ff8fa3'); // everything at ¾ speed while held
  add('tempo +¼', 'all(x => x.fast(5/4))', 'hold', '#ff8fa3'); // everything at 1¼ speed while held
  add('filter all', 'all(x => x.lpf(500))', 'hold', '#7c5cff');
  add('snare roll', `s("sd*${roll}")${bank}.gain(saw.range(0.2, 0.9))`, 'once', '#ffd166');
  add('crash', `s("cr")${bank}.gain(0.6)`, 'once', '#ffd166');
  add('riser', 's("white").lpf(saw.range(200, 8000)).gain(0.25)', 'hold', '#7c5cff');
  add('echo all', 'all(x => x.delay(0.5).delaytime(0.1875).delayfeedback(0.6))', 'hold', '#7c5cff');
  add('half time', 'all(x => x.slow(2))', 'hold', '#7c5cff');
  // jam parts in the song's key, following the section's chords
  // the arp and lead play the tones of the chord sounding now (the section's chords, moved with any key change)
  add('arp', JAM_ARP(prog), 'toggle', '#20d3a6');
  add('jam lead', JAM_LEAD(prog), 'toggle', '#20d3a6');
  add('stabs', `chord(${prog}).voicing().struct("~ x ~ x").s("square").decay(0.1).sustain(0).gain(0.3)`, 'toggle', '#20d3a6');
  add('jam pad', `chord(${prog}).voicing().s("supersaw").attack(0.4).release(1).lpf(1800).gain(0.25)`, 'toggle', '#7c5cff');
  return pads;
}
