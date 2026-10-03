// Arranging a sheet song: every section's code from the song's part library, and the engine steps.
import { wrapCode } from '../format.js';
import { signed, sliderless } from './util.js';
import { tempoLine, transposeProgression, enterMask } from './music.js';
import { LABEL_LINE, parseLabel, makeLabel, patternLines } from './labels.js';
import { fillPart, fillVariants, isFnPart, partExpr } from './sheet.js';

export const LIB_START = '// ── parts (shared by every section of this song) ──';

export const SEC_START = '// ── this section ──';

/**
 * A part's human feel (sheet.feel, 0–1): each note a little softer or louder and a little behind the beat, as players
 * play — different for every part (its own random stream), drums and bass steadier than the rest. '' when tight.
 * (The timing nudge moves sampled sounds; soundfont and synth notes get the dynamics only.)
 */
export function feelCode(feel, role = '', i = 0) {
  if (!(feel > 0)) return '';
  const steady = /drum|beat/i.test(role) ? 0.4 : /bass/i.test(role) ? 0.6 : 1;
  const r = (x) => Math.round(x * 1000) / 1000;
  const seed = (k) => r(0.1 + 0.137 * i + k);
  const soft = r(1 - 0.3 * feel), late = r(0.022 * feel * steady);
  return `.mul(velocity(rand.late(${seed(0)}).range(${soft}, 1)))${late ? `.nudge(rand.late(${seed(0.5)}).range(0, ${late}))` : ''}`;
}

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
    lines.push(`${x.part}: ${partExpr(lib, id)}${lift}${mask ? `.mask("${mask}")` : ''}${feelCode(song.sheet.feel, part?.role, song.sheet.parts.indexOf(part))}.postgain(slider(1, 0, 1.5)).late(sectionStart)`);
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
  const nth = (j) => sh.sections.slice(0, j).filter((x) => x.name === sh.sections[j].name).length; // which repeat of its name
  sh.sections.forEach((sec, j) => {
    const next = sh.sections[j + 1];
    const wantFill = fp && next && sec.bars >= 4 && FILL_INTO.includes(next.type) && next.type !== sec.type &&
      sec.play.some((x) => x.part === fp.id);
    const prevFill = steps[steps.length - 1]?.fillStep;
    steps.push({
      bars: wantFill ? sec.bars - 1 : sec.bars, prompt: sec.name, section: sec, secIndex: j, secNth: nth(j), code: sectionCode(song, sec),
      status: 'ready', error: null,
      // land a drop, and the downbeat after a fill, hard; everything else uses the fade setting
      fade: prevFill || sec.type === 'drop' ? 0 : undefined,
    });
    if (wantFill) {
      const fill = fills[nFill++ % fills.length];
      steps.push({ bars: 1, prompt: `${sec.name} · ${fill}`, section: sec, secIndex: j, secNth: nth(j), fillStep: fill, code: sectionCode(song, sec, { fill }), status: 'ready', error: null, fade: 0 });
    }
  });
  if (sh.ending === 'cut') {
    const last = sh.sections[sh.sections.length - 1];
    steps.push({ bars: GAP_BARS, prompt: '· silence', section: last, secIndex: sh.sections.length - 1, secNth: nth(sh.sections.length - 1), gap: true, status: 'ready', error: null, fade: 0,
      code: `${tempoLine(sh.bpm, sh.meter)}\n// ── a moment of silence before the next song ──\nsilence\n` });
  }
  return steps;
}

/**
 * Where a playing section is in an edited song. Songs repeat names (A, B, A), so the first match would send the song
 * back: the same repeat of its name (the 2nd A is still the 2nd A), else the one with its name nearest to where it was,
 * else the same position. -1 when there are no sections.
 * @param {{name: string}[]} sections  the edited song's sections
 * @param {string} name  the playing section's name
 * @param {number} [at]  its index in the song before the edit
 * @param {number} [nth]  which repeat of its name it was (0 = the first)
 */
export function sectionAfterEdit(sections, name, at = -1, nth = -1) {
  const same = sections.map((x, k) => (x.name === name ? k : -1)).filter((k) => k >= 0);
  if (nth >= 0 && same[nth] != null) return same[nth];
  if (same.length) return at < 0 ? same[0] : same.reduce((a, k) => (Math.abs(k - at) < Math.abs(a - at) ? k : a));
  return sections.length ? Math.max(0, Math.min(sections.length - 1, at)) : -1;
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
