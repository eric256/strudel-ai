// Arranging a sheet song: every section's code from the song's part library, and the engine steps.
import { wrapCode } from '../format.js';
import { signed, sliderless } from './util.js';
import { tempoLine, transposeProgression, enterMask } from './music.js';
import { LABEL_LINE, parseLabel, makeLabel, patternLines } from './labels.js';
import { fillPart, fillVariants, isFnPart, partExpr } from './sheet.js';

export const LIB_START = '// ── parts (shared by every section of this song) ──';

export const SEC_START = '// ── this section ──';

/** Full program for one section: the library, then one labelled group per part. fill: a fill bar (true, or which fill). */
export function sectionCode(song, sec, { fill = false } = {}) {
  const lib = song.library;
  const fp = fill ? fillPart(song.sheet) : null;
  const fillVar = typeof fill === 'string' ? fill : 'fill';
  const shift = sec.shift || 0;
  const moves = [shift ? `key ${signed(shift)}` : '', sec.bpm ? `${sec.bpm} bpm` : ''].filter(Boolean).join(' · ');
  const lines = [
    `// ${song.title} — ${sec.name}${fill ? ' (fill)' : ''} · ${fill ? 1 : sec.bars} bars · chords: ${sec.chords}${moves ? ` · ${moves}` : ''}`,
    LIB_START,
    // a section with its own tempo replaces the song's tempo line
    (sec.bpm ? lib.replace(/setcp[ms]\([^)]*\)/, tempoLine(sec.bpm, song.sheet.meter)) : lib).trim(),
    '',
    SEC_START,
    `const sectionChords = ${JSON.stringify(transposeProgression(song.sheet.chords[sec.chords], shift))}`,
    'const sectionStart = 0 // set when the section switches in',
  ];
  for (const x of sec.play) {
    const id = `${x.part}_${fp && x.part === fp.id ? fillVar : x.variant}`;
    const part = song.sheet.parts.find((p) => p.id === x.part);
    // harmonic parts follow the (moved) chords; melodic plain parts (the hook) are moved with them; drums never
    const lift = shift && !isFnPart(lib, id) && !/drum|perc|beat|fx|noise/i.test(`${part?.role} ${x.part}`) ? `.transpose(${shift})` : '';
    const mask = fill ? null : enterMask(x.enter, sec.bars);
    lines.push(`${x.part}: ${partExpr(lib, id)}${lift}${mask ? `.mask("${mask}")` : ''}.postgain(slider(1, 0, 1.5)).late(sectionStart)`);
  }
  return lines.join('\n') + '\n';
}

/** Bars of silence after a song that stops hard (ending "cut"), before the next song. */
export const GAP_BARS = 1;
/** The sections a drum fill leads into (other changes are smoothed by the parts coming and going, and the volume). */
export const FILL_INTO = ['chorus', 'drop', 'solo'];
/**
 * Engine steps for a sheet song: one per section, plus a one-bar fill leading into a chorus, a drop or a solo (the
 * song's fills take turns, so they vary), and a bar of silence after a hard ending.
 */
export function arrangeSong(song) {
  const sh = song.sheet;
  const fp = fillPart(sh), fills = fillVariants(sh);
  const steps = [];
  let nFill = 0;
  sh.sections.forEach((sec, j) => {
    const next = sh.sections[j + 1];
    const wantFill = fp && next && sec.bars >= 4 && FILL_INTO.includes(next.type) && next.type !== sec.type &&
      sec.play.some((x) => x.part === fp.id);
    const prevFill = steps[steps.length - 1]?.fillStep;
    steps.push({
      bars: wantFill ? sec.bars - 1 : sec.bars, prompt: sec.name, section: sec, code: sectionCode(song, sec),
      status: 'ready', error: null,
      // land a drop, and the downbeat after a fill, hard; everything else uses the fade setting
      fade: prevFill || sec.type === 'drop' ? 0 : undefined,
    });
    if (wantFill) {
      const fill = fills[nFill++ % fills.length];
      steps.push({ bars: 1, prompt: `${sec.name} · ${fill}`, section: sec, fillStep: fill, code: sectionCode(song, sec, { fill }), status: 'ready', error: null, fade: 0 });
    }
  });
  if (sh.ending === 'cut') {
    const last = sh.sections[sh.sections.length - 1];
    steps.push({ bars: GAP_BARS, prompt: '· silence', section: last, gap: true, status: 'ready', error: null, fade: 0,
      code: `${tempoLine(sh.bpm, sh.meter)}\n// ── a moment of silence before the next song ──\nsilence\n` });
  }
  return steps;
}

/**
 * When the next section of the same song switches in, keep what the performer changed:
 * fader positions in the parts, group faders, and mute / solo.
 */
export function carryLiveState(prev, next) {
  const span = (c) => { const a = c.indexOf(LIB_START), b = c.indexOf(SEC_START); return a >= 0 && b > a ? [a, b] : null; };
  const ps = span(prev), ns = span(next);
  let out = next;
  // same parts code (compared as wrapped, without fader values): keep the playing one, with its fader positions
  const same = (a, b) => sliderless(wrapCode(a)) === sliderless(wrapCode(b));
  if (ps && ns && same(prev.slice(...ps), next.slice(...ns))) out = next.slice(0, ns[0]) + prev.slice(...ps) + next.slice(ns[1]);
  if (!ps || !ns) return out;
  const prevLines = prev.split('\n');
  const groups = new Map(patternLines(prev).map((r) => [r.base, { ...r, text: prevLines[r.line] }]));
  return out.split('\n').map((line) => {
    const m = line.match(LABEL_LINE);
    const g = m && groups.get(parseLabel(m[1]).base);
    if (!g) return line;
    let l = line.replace(LABEL_LINE, makeLabel({ base: g.base, muted: g.muted, solo: g.solo }) + ':');
    const v = g.text.match(/\.postgain\(slider\(\s*([\d.]+)/);
    if (v) l = l.replace(/\.postgain\(slider\(\s*[\d.]+/, `.postgain(slider(${v[1]}`);
    return l;
  }).join('\n');
}
