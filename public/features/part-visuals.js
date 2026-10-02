// Feature module split out of app.js (see the section comments below).
import { SEC_START } from '../lib/arrange.js';
import { LABEL_LINE, parseLabel } from '../lib/labels.js';
import { vizColor } from './visualizer.js';
import { $ } from '../app.js';
// 🎨 Part visuals: each part of a song section gets one of Strudel's inline visuals under its line, in the part's
// colour, picked by what the part does — drums a punchcard, bass a scrolling piano roll, chords and pads a spiral,
// melodies a pitch wheel, arps a dense piano roll, fx a scope. (⚙ Settings → General → 🎨 part visuals)
const PART_VIS_ANY = /\s*\.color\('#[0-9a-f]{6}'\)\s*\._(pianoroll|punchcard|spiral|pitchwheel|scope)\(\{[^}]*\}\)/g;
function hslHex(css) {
  const m = /hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/.exec(css);
  if (!m) return '#7c5cff';
  const [h, sat, l] = [Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100];
  const f = (n) => { const k = (n + h / 30) % 12; const c = l - sat * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function partVisual(name, line) {
  const t = `${name} ${line}`.toLowerCase();
  if (/drum|perc|beat|kick|hats?\b|clap|snare|bank\(/.test(t)) return '_punchcard({ cycles: 2, labels: 0, vertical: 0, fold: 0 })';
  if (/\bfx\b|noise|riser|white|pink|brown|crackle/.test(t)) return '_scope({ thickness: 2, scale: 0.4, pos: 0.5 })';
  if (/arp/.test(t)) return '_pianoroll({ cycles: 2, fold: 1, labels: 0, smear: 1 })';
  if (/bass|sub\b/.test(t)) return '_pianoroll({ cycles: 4, fold: 1, labels: 0, autorange: 1 })';
  if (/chord|pad|keys|piano|organ|string|voicing/.test(t)) return '_spiral({ steady: 0.96, stretch: 0.6, thickness: 4 })';
  if (/hook|lead|melod|counter|riff|harm|vox|flute|bell/.test(t)) return '_pitchwheel({ edo: 12, thickness: 3 })';
  return '_pianoroll({ cycles: 2, fold: 1, labels: 0 })';
}
/** Add (or remove) the part visuals on the part lines of a section's code. */
export function partVisuals(code) {
  const at = code.indexOf(SEC_START);
  if (at < 0) return code;
  const on = $('partVisuals').checked;
  // take the visuals off first (they may sit on a wrapped continuation line), then add them at the end of each part
  const lines = code.slice(at).replace(PART_VIS_ANY, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LABEL_LINE);
    if (!m || /^\s*pad\d+:/.test(lines[i])) continue;
    let end = i; // a wrapped part continues on the indented lines below its label
    while (end + 1 < lines.length && /^\s+\S/.test(lines[end + 1]) && !LABEL_LINE.test(lines[end + 1].trim())) end++;
    lines[end] = lines[end].trimEnd();
    if (on) {
      const base = parseLabel(m[1]).base, whole = lines.slice(i, end + 1).join(' ');
      lines[end] += `.color('${hslHex(vizColor(base))}').${partVisual(base, whole)}`;
    }
    i = end;
  }
  return code.slice(0, at) + lines.join('\n');
}
