// A whole song as ONE Strudel program: the part library, then one line per part that plays its sections in order with
// arrange([bars, pattern], …) — silence where it rests, each section's chords, fills, key lifts, parts coming in and
// out, section levels. What the app's player does on top (the master, 🔀 routing, crossfades, tempo changes) can't be
// written into the code, so it's listed in the program's header. Exporters (🧩 plugins) build on this.
import { arrangeSong, partCall } from './arrange.js';
import { transposeProgression, tempoLine, normMeter } from './music.js';
import { splitLibrary } from './library.js';
import { ident } from './util.js';

/**
 * The song laid out for one program: { title, bpm, meter, bars, header (comment lines), library (definitions, no tempo
 * line), chords: [{ name, prog }] (a const per progression a section uses), parts: [{ id, role, sound, segments:
 * [[bars, expr]] }], sections: [{ name, start, bars }], notes: [what isn't carried over] }.
 */
export function songProgram(song) {
  const sh = song.sheet;
  if (!sh?.sections?.length || !song.library) throw new Error('only a song written from a sheet can be exported as one program');
  const steps = arrangeSong(song);
  const { defs } = splitLibrary(song.library);
  // the chords each section plays (moved with its key): one const each
  const chords = [];
  const chordsName = (sec) => {
    const prog = transposeProgression(sh.chords[sec.chords], sec.shift || 0);
    let c = chords.find((x) => x.prog === prog);
    if (!c) chords.push((c = { name: `chords_${ident(sec.chords)}${sec.shift ? `_${sec.shift > 0 ? 'up' : 'down'}${Math.abs(sec.shift)}` : ''}`, prog }));
    return c.name;
  };
  const parts = sh.parts.map((p) => ({ id: p.id, role: p.role, sound: p.sound, segments: [] }));
  const sections = [];
  let bar = 0;
  for (const st of steps) {
    const sec = st.section;
    if (!st.fillStep && !st.gap) sections.push({ name: sec.name, start: bar, bars: st.bars });
    else if (st.fillStep && sections.length) sections[sections.length - 1].bars += st.bars;
    const level = !st.gap && sec.level && sec.level !== 1 ? `.postgain(${sec.level})` : '';
    for (const p of parts) {
      const x = st.gap ? null : sec.play.find((y) => y.part === p.id);
      const expr = x ? `${partCall(song, sec, x, { fill: st.fillStep || false, chords: chordsName(sec) })}${level}` : 'silence';
      const last = p.segments[p.segments.length - 1];
      // rests run together (a part that plays restarts with each section, as it does in the app)
      if (expr === 'silence' && last?.[1] === 'silence') last[0] += st.bars;
      else p.segments.push([st.bars, expr]);
    }
    bar += st.bars;
  }
  const notes = [];
  const style = sh.master || 'clean';
  notes.push(`the master (style "${style}"${sh.masterParams ? ', with the song\'s own tweaks' : ''}), 🔀 routing and the mixer's faders: Strudel plays the parts as they are`);
  const tempos = [...new Set(sh.sections.map((s) => s.bpm).filter(Boolean))];
  if (tempos.length) notes.push(`tempo changes (${tempos.join(', ')} bpm in some sections): the whole program plays at ${sh.bpm} bpm`);
  if (sh.sections.some((s) => s.solo)) notes.push('solos bringing their part forward');
  notes.push('crossfades between sections: sections switch on the bar');
  const header = [
    `"${song.title}"${song.desc ? ` — ${song.desc.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`,
    `${sh.key} · ${sh.bpm} bpm · ${normMeter(sh.meter)} · ${bar} bars${sh.form ? ` · form ${sh.form}` : ''}${sh.band ? ` · band ${sh.band}` : ''}`,
    `sections: ${sections.map((s) => `${s.name} (${s.bars})`).join(' · ')}`,
  ];
  return { title: song.title, bpm: sh.bpm, meter: normMeter(sh.meter), bars: bar, header, library: defs.map((d) => d.code).join('\n'), chords, parts: parts.filter((p) => p.segments.some(([, e]) => e !== 'silence')), sections, notes };
}

/** The program as Strudel REPL code (paste into strudel.cc). */
export function songProgramCode(prog) {
  const c = (t) => `// ${t}`;
  const seg = ([bars, expr]) => `  [${bars}, ${expr}]`;
  return [
    ...prog.header.map(c),
    c('Made with Strudel AI. Not carried over:'),
    ...prog.notes.map((n) => c(`  · ${n}`)),
    '',
    tempoLine(prog.bpm, prog.meter),
    '',
    c('── the parts (each section picks one of these) ──'),
    prog.library,
    '',
    c('── the chords of each section ──'),
    ...prog.chords.map((x) => `const ${x.name} = ${JSON.stringify(x.prog)}`),
    '',
    c(`── the song: ${prog.sections.map((s) => s.name).join(' · ')} ──`),
    ...prog.parts.map((p) => `${p.id}: arrange(\n${p.segments.map(seg).join(',\n')}\n)`),
    '',
  ].join('\n');
}

/**
 * The program as plain JavaScript that returns { part: Pattern } (for exporters that query the notes): Strudel's
 * functions must be global, and mini-notation strings are turned into mini(…) calls by `miniStrings`.
 */
export function songProgramJS(prog, miniStrings) {
  const body = [
    prog.library,
    ...prog.chords.map((x) => `const ${x.name} = ${JSON.stringify(x.prog)}`),
    `return {\n${prog.parts.map((p) => `  ${p.id}: arrange(${p.segments.map(([b, e]) => `[${b}, ${e}]`).join(', ')})`).join(',\n')}\n};`,
  ].join('\n');
  return miniStrings(body).replace(/\bslider\(/g, '__slider(');
}
