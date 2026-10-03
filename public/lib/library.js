// A song's parts code ("library") as separate definitions, so the ✎ song editor can show and edit each part's
// code on its own: one `const name_variant = …` per part and variant, plus anything else (the tempo line, helpers).

const DEF_START = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;

/**
 * Split parts code into { head, defs: [{ id, code }] }. `head` is what comes before the first definition (the tempo
 * line, comments). A definition runs until the next top-level definition (a line that starts with const / let / var).
 */
export function splitLibrary(lib) {
  const lines = String(lib || '').split('\n');
  const head = [], defs = [];
  let cur = null;
  for (const line of lines) {
    const m = DEF_START.exec(line);
    if (m) { cur = { id: m[1], lines: [line] }; defs.push(cur); continue; }
    if (cur) cur.lines.push(line); else head.push(line);
  }
  return {
    head: head.join('\n').trim(),
    defs: defs.map((d) => ({ id: d.id, code: d.lines.join('\n').replace(/\s+$/, '') })),
  };
}

/** Put the definitions back together (the head first). */
export function joinLibrary({ head = '', defs = [] }) {
  return [head.trim(), ...defs.map((d) => d.code.trim())].filter(Boolean).join('\n') + '\n';
}

/** Rename a definition (its id and the `const` that declares it). */
export function renameDef(def, id) {
  return { id, code: def.code.replace(DEF_START, (m, old) => m.replace(old, id)) };
}

const HARMONIC = /chord|pad|keys|bass|arp|string|organ|piano/i;
/** Starter code for a new part or variant: harmonic parts follow the section's chords, drums play a beat. */
export function stubDef(id, { role = '', sound = '', scale = 'C:minor' } = {}) {
  const s = JSON.stringify(sound || 'triangle');
  if (/drum|perc/i.test(role)) return `const ${id} = s("bd*4, [~ sd]*2, hh*8")${sound && !/^(bd|sd|hh)\b/.test(sound) ? `.bank(${s})` : ''}.gain(0.6)`;
  if (/bass/i.test(role)) return `const ${id} = (prog) => chord(prog).rootNotes(2).s(${s}).gain(0.5)`;
  if (HARMONIC.test(role)) return `const ${id} = (prog) => chord(prog).voicing().s(${s}).gain(0.3)`;
  if (/fx/i.test(role)) return `const ${id} = s(${s}).slow(4).gain(0.2)`;
  return `const ${id} = n("0 2 4 2").scale(${JSON.stringify(scale)}).s(${s}).gain(0.4)`;
}
