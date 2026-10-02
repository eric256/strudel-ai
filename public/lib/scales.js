// Scale names: Strudel wants "Tonic:name" with spaces in the name replaced by colons, e.g. .scale("C:minor:pentatonic").
// Models often write "C:minorpentatonic", "C minor pentatonic" or "C:pentatonic minor": fixScaleString repairs them
// against the real scale list (scales.json, set with setScales).
import { levenshtein } from './util.js';
let SCALES = null; // [[name, ...aliases], ...]
/** The scale list (from /scales.json). */
export function setScales(list) { SCALES = list; scaleIndex = null; }
export const getScales = () => SCALES;

export const normScale = (s) => s.toLowerCase().replace(/[\s:_-]+/g, '');

export let scaleIndex = null;

export function getScaleIndex() {
  if (scaleIndex || !SCALES) return scaleIndex;
  scaleIndex = new Map();
  for (const [name, ...aliases] of SCALES) {
    for (const n of [name, ...aliases]) scaleIndex.set(normScale(n), name);
    // word-order variants, e.g. "pentatonic minor" → "minor pentatonic"
    const words = name.split(' ');
    if (words.length === 2) scaleIndex.set(normScale(words[1] + words[0]), name);
  }
  return scaleIndex;
}

export const colonScale = (name) => name.replace(/ /g, ':');

export const TONIC = /^[a-gA-G](?:#|b|s|f)*-?\d*$/;

/** Returns canonical scale name for a (possibly wrong) name, or null. */
export function matchScale(raw) {
  const idx = getScaleIndex();
  if (!idx) return null;
  const n = normScale(raw);
  if (idx.has(n)) return idx.get(n);
  let best = null, bestD = 99;
  for (const [k, v] of idx) {
    const d = levenshtein(n, k);
    if (d < bestD) { bestD = d; best = v; }
  }
  return bestD <= Math.max(1, Math.floor(n.length / 5)) ? best : null;
}

/** Fix one .scale("…") mini-notation string. Returns { fixed, corrections, unknown }. */
export function fixScaleString(str) {
  const corrections = [], unknown = [];
  const toks = [...str.matchAll(/[A-Za-z0-9#'\-:]+/g)].map((m) => ({ t: m[0], i: m.index, end: m.index + m[0].length }));
  const edits = [];
  for (let k = 0; k < toks.length; k++) {
    const { t, i, end } = toks[k];
    const c = t.indexOf(':');
    if (c > 0 && TONIC.test(t.slice(0, c))) {
      const name = t.slice(c + 1).replace(/:/g, ' ');
      if (!name) continue; // e.g. "C:<major minor>" – names follow as separate tokens
      // "C:minor pentatonic" → the following space-separated words may belong to the name
      let last = k, canon = null;
      const idx = getScaleIndex();
      for (let j = Math.min(k + 3, toks.length - 1); j > k; j--) {
        const words = toks.slice(k, j + 1);
        if (words.some((w, wi) => wi > 0 && !/^ +$/.test(str.slice(words[wi - 1].end, w.i)))) continue;
        const joined = [name, ...words.slice(1).map((w) => w.t)].join(' ');
        if (idx?.has(normScale(joined))) { canon = idx.get(normScale(joined)); last = j; break; }
      }
      canon = canon || matchScale(name);
      if (!canon) { unknown.push(t); continue; }
      const good = `${t.slice(0, c)}:${colonScale(canon)}`;
      const orig = str.slice(i, toks[last].end);
      if (good !== orig) { corrections.push([orig, good]); edits.push([i, toks[last].end, good]); }
      k = last;
      continue;
    }
    if (TONIC.test(t) && toks[k + 1] && !toks[k + 1].t.includes(':') && /^\s+$/.test(str.slice(end, toks[k + 1].i))) {
      // "C minor pentatonic" (spaces) → greedily join following words into a scale name
      let found = null;
      for (let j = Math.min(k + 4, toks.length - 1); j > k; j--) {
        const words = toks.slice(k + 1, j + 1);
        if (words.some((w, wi) => wi > 0 && !/^\s+$/.test(str.slice(words[wi - 1].end, w.i)))) continue;
        const canon = matchScale(words.map((w) => w.t).join(' '));
        if (canon) { found = { j, canon }; break; }
      }
      if (found) {
        const good = `${t}:${colonScale(found.canon)}`;
        corrections.push([str.slice(i, toks[found.j].end), good]);
        edits.push([i, toks[found.j].end, good]);
        k = found.j;
      }
      continue;
    }
    // bare scale-name token after "Tonic:<" (e.g. "C:<major minor>")
    if (!TONIC.test(t) && /[a-z]/i.test(t) && /[a-g][#bsf]*-?\d*:\s*[<[{][^>\]}]*$/i.test(str.slice(0, i))) {
      const canon = matchScale(t.replace(/:/g, ' '));
      if (!canon) unknown.push(t);
      else if (colonScale(canon) !== t) { corrections.push([t, colonScale(canon)]); edits.push([i, end, colonScale(canon)]); }
    }
  }
  let fixed = str;
  for (const [a, b, g] of edits.sort((x, y) => y[0] - x[0])) fixed = fixed.slice(0, a) + g + fixed.slice(b);
  return { fixed, corrections, unknown };
}

export function scaleHelp() {
  const names = (SCALES || []).map(([n]) => colonScale(n));
  return 'Scale format: .scale("C:minor:pentatonic") — tonic, colon, then the scale name with spaces replaced by colons. ' +
    'Valid scale names: ' + names.join(', ') + '.';
}
