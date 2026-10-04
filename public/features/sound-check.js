// Feature module split out of app.js (see the section comments below).
import { applyAvoid } from '../lib/taste.js';
import { getTaste } from './taste.js';
import { closest } from '../lib/util.js';
import { fixScaleString, scaleHelp, setScales } from '../lib/scales.js';
import { patternLines } from '../lib/labels.js';
import { wrapCode } from '../format.js';
import { $, addMsg, clog, inDryRun, lastReplState, mirror, recentDryRunErrors } from '../app.js';
let transposeLog, scalesReady, seenLogs;
// ---------------------------------------------------------------------------
// Sound registry: validate / auto-correct instrument names against what is
// actually loaded, preload soundfonts, and tell the LLM the real names.
// ---------------------------------------------------------------------------
const SOUNDFONT_URL = 'https://felixroos.github.io/webaudiofontdata/sound';

export async function soundRegistry() {
  try { await mirror()?.prebaked; } catch {}
  await installSoundfontGuard();
  const m = globalThis.soundMap?.get?.();
  return m && Object.keys(m).length ? m : null;
}

// registry keys are lowercase; show well-known banks in their usual spelling
export const pretty = (b) => b.replace(/^roland/, 'Roland').replace(/tr(\d)/, 'TR$1').replace(/^linn/, 'Linn');

let catalogCache = null;
/** Sounds were added (a 🧩 plugin): list them again next time. */
export const resetSoundCatalog = () => { catalogCache = null; };
export async function soundCatalog() {
  if (catalogCache) return catalogCache;
  const reg = await soundRegistry();
  if (!reg) return '';
  const keys = Object.keys(reg);
  const synths = keys.filter((k) => reg[k].data?.type === 'synth' && !['user', 'bus', 'one'].includes(k));
  const fonts = keys.filter((k) => reg[k].data?.type === 'soundfont');
  const samples = keys.filter((k) => reg[k].data?.type === 'sample');
  const bankCount = {};
  const drumSuffixes = new Set();
  for (const k of samples) {
    const i = k.lastIndexOf('_');
    if (i > 0) {
      const b = k.slice(0, i);
      bankCount[b] = (bankCount[b] || 0) + 1;
    }
  }
  const banks = Object.keys(bankCount).filter((b) => bankCount[b] >= 3 && !b.startsWith('gm'));
  for (const k of samples) {
    const i = k.lastIndexOf('_');
    if (i > 0 && banks.includes(k.slice(0, i))) drumSuffixes.add(k.slice(i + 1));
  }
  const plain = samples.filter((k) => !k.includes('_'));
  catalogCache =
    `Synths: ${synths.join(' ')}\n` +
    `Soundfont instruments (play pitches with note() or n().scale()): ${fonts.join(' ')}\n` +
    `Samples: ${plain.join(' ')}${plain.includes('space') ? ' (use "space" rarely)' : ''}\n` +
    `Drum machine banks (use as s("bd sd hh").bank("name"), bank names are case-insensitive): ${banks.map(pretty).join(' ')}\n` +
    `Drum names available inside banks: ${[...drumSuffixes].join(' ')}`;
  return catalogCache;
}

function stringArgs(code, fnRegex) {
  const out = [];
  for (const m of code.matchAll(fnRegex)) out.push(m[2]);
  return out;
}
const MINI_WORD = /[A-Za-z][A-Za-z0-9_]*/g;

/**
 * Check every sound / bank name used in s(), sound(), .bank() against the registry.
 * Returns { code, corrections: [[from,to]], unknown: [{name, suggestions}] }.
 */
export async function checkSounds(code) {
  const reg = await soundRegistry();
  if (!reg) return { code, corrections: [], unknown: [] };
  const keys = Object.keys(reg);
  const has = (k) => Object.prototype.hasOwnProperty.call(reg, k.toLowerCase());
  const plainKeys = keys.filter((k) => !/_(?!.*_)/.test(k) || k.startsWith('gm_') || reg[k].data?.type !== 'sample');
  const bankSet = new Set();
  for (const k of keys) { const i = k.lastIndexOf('_'); if (i > 0 && !k.startsWith('gm_')) bankSet.add(k.slice(0, i)); }

  const soundStrs = stringArgs(code, /(?:^|[^\w$])(?:s|sound)\(\s*(["'`])([\s\S]*?)\1/g);
  const bankStrs = stringArgs(code, /\.bank\(\s*(["'`])([\s\S]*?)\1/g);
  const banks = [...new Set(bankStrs.flatMap((s) => s.match(MINI_WORD) || []))];
  const sounds = [...new Set(soundStrs.flatMap((s) => s.match(MINI_WORD) || []))];

  const corrections = [];
  const unknown = [];
  const validBanks = [];
  for (const b of banks) {
    if (bankSet.has(b.toLowerCase())) { validBanks.push(b); continue; }
    const { best, dist, top } = closest(b, [...bankSet]);
    if (best && dist <= Math.max(2, Math.floor(b.length / 4))) { corrections.push([b, pretty(best)]); validBanks.push(best); }
    else unknown.push({ name: b, kind: 'bank', suggestions: top });
  }
  for (const t of sounds) {
    if (has(t) || validBanks.some((b) => has(`${b}_${t}`))) continue;
    const { best, dist, top } = closest(t, plainKeys);
    if (best && dist <= Math.max(1, Math.floor(t.length / 4))) corrections.push([t, best]);
    else unknown.push({ name: t, kind: 'sound', suggestions: top });
  }
  let fixed = code;
  for (const [from, to] of corrections) {
    fixed = fixed.replace(new RegExp(`(?<![\\w])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'g'), to);
  }
  return { code: fixed, corrections, unknown };
}

// ---------------------------------------------------------------------------
// Soundfont range guard: every gm_* instrument only has recordings for a
// certain key range. Strudel throws "no soundfont zone found for preset" for
// notes outside it. We wrap each soundfont so out-of-range notes are moved by
// octaves into the instrument's range instead of failing.
// ---------------------------------------------------------------------------
const fontRangeCache = {};
function fontRange(font) {
  if (!fontRangeCache[font]) {
    fontRangeCache[font] = fetch(`${SOUNDFONT_URL}/${font}.js`, { cache: 'force-cache' })
      .then((r) => r.text())
      .then((txt) => {
        const lows = [...txt.matchAll(/keyRangeLow\s*:\s*(\d+)/g)].map((m) => +m[1]);
        const highs = [...txt.matchAll(/keyRangeHigh\s*:\s*(\d+)/g)].map((m) => +m[1]);
        return lows.length ? { lo: Math.min(...lows), hi: Math.max(...highs) + 1 } : null;
      })
      .catch(() => { delete fontRangeCache[font]; return null; });
  }
  return fontRangeCache[font];
}

const NOTE_BASE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
export function toMidi(value) {
  if (value.freq) return 12 * Math.log2(value.freq / 440) + 69;
  const note = value.note ?? 'c3';
  if (typeof note === 'number') return note;
  const m = String(note).trim().match(/^([a-gA-G])([#sbf]*)(-?\d+)?$/);
  if (!m) return NaN;
  const acc = [...m[2]].reduce((a, c) => a + (c === '#' || c === 's' ? 1 : -1), 0);
  return NOTE_BASE[m[1].toLowerCase()] + acc + (m[3] !== undefined ? +m[3] + 1 : 4) * 12;
}
async function installSoundfontGuard() {
  const map = globalThis.soundMap;
  const reg = map?.get?.();
  if (!reg || installSoundfontGuard.done) return;
  installSoundfontGuard.done = true;
  for (const [name, entry] of Object.entries(reg)) {
    if (entry.data?.type !== 'soundfont' || entry.guarded) continue;
    const fonts = entry.data.fonts || [];
    const orig = entry.onTrigger;
    const guarded = async (time, value, onended, ...rest) => {
      try {
        const n = Math.round(Number(value.n) || 0);
        const font = fonts[((n % fonts.length) + fonts.length) % fonts.length];
        const range = font && (await fontRange(font));
        const parsed = toMidi(value);
        let midi = Number.isFinite(parsed) ? parsed : 48; // unparseable note → c3
        if (range) {
          let shifted = midi;
          while (shifted < range.lo) shifted += 12;
          while (shifted > range.hi) shifted -= 12;
          if (shifted < range.lo) shifted = range.lo; // range narrower than an octave
          if (shifted !== midi || !Number.isFinite(parsed)) {
            const key = `${name}:${value.note ?? value.freq}`;
            if (!transposeLog.has(key)) {
              transposeLog.add(key);
              console.info(Number.isFinite(parsed)
                ? `[strudel-ai] ${name}: note ${Math.round(midi)} outside ${range.lo}-${range.hi}, playing ${Math.round(shifted)}`
                : `[strudel-ai] ${name}: can't read note "${value.note}", playing ${Math.round(shifted)}`);
            }
            value = { ...value, note: shifted };
            delete value.freq;
          }
        }
      } catch {}
      return orig(time, value, onended, ...rest);
    };
    map.setKey(name, { ...entry, onTrigger: guarded, guarded: true });
  }
}

/** Warm up soundfont downloads so the first notes after a switch aren't silent. */
export async function preloadSoundfonts(code) {
  const reg = await soundRegistry();
  if (!reg) return [];
  const names = [...new Set((code.match(/gm_[a-z0-9_]+/gi) || []).map((n) => n.toLowerCase()))];
  const failed = [];
  await Promise.all(
    names.map(async (n) => {
      const font = reg[n]?.data?.fonts?.[0];
      if (!font) return;
      try {
        const r = await fetch(`${SOUNDFONT_URL}/${font}.js`, { cache: 'force-cache', signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error(r.status);
        fontRange(font);
      } catch { failed.push(n); }
    }),
  );
  return failed;
}

const unknownMessage = (unknown) =>
  'These sound/bank names do not exist: ' +
  unknown.map((u) => `"${u.name}" (closest real ${u.kind}s: ${u.suggestions.join(', ')})`).join('; ') +
  '. Use ONLY names from the AVAILABLE SOUNDS list, spelled exactly.';

export async function checkScales(code) {
  await scalesReady;
  const corrections = [], unknown = [];
  const fixedCode = code.replace(/\.scale\(\s*(["'`])([\s\S]*?)\1/g, (whole, q, str) => {
    const r = fixScaleString(str);
    corrections.push(...r.corrections);
    unknown.push(...r.unknown);
    return `.scale(${q}${r.fixed}${q}`;
  });
  return { code: fixedCode, corrections, unknown };
}

// ---------------------------------------------------------------------------
// Sliders: every gain / group postgain gets a live fader; slider() arguments must be
// plain non-negative numbers (Strudel's transpiler ignores anything else).
// ---------------------------------------------------------------------------
export function ensureSliders(code) {
  let added = 0, fixed = 0;
  const num = String.raw`(\d+(?:\.\d+)?|\.\d+)`;
  let out = code.replace(new RegExp(String.raw`\.(gain|postgain)\(\s*` + num + String.raw`\s*\)`, 'g'), (m, fn, v) => {
    added++;
    const max = Math.max(fn === 'gain' ? 1.2 : 1.5, Number(v));
    return `.${fn}(slider(${v}, 0, ${max}))`;
  });
  out = out.replace(/slider\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*,\s*([^,()]+?)\s*(,\s*[^,()]+?\s*)?\)/g, (m, v, lo, hi, step) => {
    let [V, L, H] = [v, lo, hi].map(Number);
    if (![V, L, H].every(Number.isFinite)) return m;
    if (V < 0) return m; // negative values can't be sliders — leave for the model
    let changed = false;
    if (L < 0) { L = 0; changed = true; }
    if (V < L) { L = V; changed = true; }
    if (V > H) { H = V; changed = true; }
    if (!changed && /^[\d.]+$/.test(lo.trim()) && /^[\d.]+$/.test(hi.trim())) return m;
    fixed++;
    return `slider(${v.trim()}, ${L}, ${H}${step || ''})`;
  });
  return { code: out, added, fixed };
}

/** Validate + correct + preload. Reports to chat. Returns { code, error } */
/**
 * Mistakes in the program's shape that Strudel reports cryptically: a label holding a function
 * ("bass_main: (prog) => …" → ".p is not a function"), or only const definitions and nothing that plays
 * ("unexpected ast format without body expression").
 */
function codeShapeError(code) {
  const fnLabel = code.match(/^([A-Za-z_$][\w$]*):\s*\(?\s*[A-Za-z_$]*\s*\)?\s*=>/m);
  if (fnLabel) {
    return `"${fnLabel[1]}:" holds a function, but a label must hold a PATTERN. Define functions with const ` +
      `(const ${fnLabel[1]} = (prog) => …) and play them from a labelled line with the chords: ${fnLabel[1].replace(/_\w+$/, '')}: ${fnLabel[1]}("<Am F C G>").`;
  }
  const body = code.replace(/\/\/.*$/gm, '').split('\n').filter((l) => l.trim());
  if (body.length && !patternLines(code).length && body.every((l) => /^\s*(const|let|var|setcp[ms]|[)\].,]|\.)/.test(l) || /^\s+/.test(l))) {
    return 'the program only defines consts and plays nothing: add labelled lines that play them (name: pattern).';
  }
  return null;
}
export async function prepareCode(code, { quiet = false, library = false } = {}) {
  const shape = library ? null : codeShapeError(code); // a song's part library is only consts, by design
  if (shape) return { code, error: shape, corrections: [] };
  const sl = ensureSliders(code);
  if (sl.added || sl.fixed) {
    clog('fix', `🎚 ${[sl.added && `added ${sl.added} gain slider${sl.added > 1 ? 's' : ''}`, sl.fixed && `fixed ${sl.fixed} slider range${sl.fixed > 1 ? 's' : ''}`].filter(Boolean).join(', ')}`);
  }
  code = sl.code;
  const sc = await checkScales(code);
  if (sc.corrections.length) {
    clog('fix', '🔧 fixed scale names: ' + sc.corrections.map(([a, b]) => `${a} → ${b}`).join(', '));
  }
  if (sc.unknown.length) {
    return { code: sc.code, error: `Unknown scale name(s): ${sc.unknown.join(', ')}. ${scaleHelp()}`, corrections: sc.corrections };
  }
  code = sc.code;
  const chk = await checkSounds(code);
  if (chk.corrections.length) {
    clog('fix', '🔧 fixed sound names: ' + chk.corrections.map(([a, b]) => `${a} → ${b}`).join(', '));
  }
  const allCorrections = [...sc.corrections, ...chk.corrections];
  if (chk.unknown.length) return { code: chk.code, error: unknownMessage(chk.unknown), corrections: allCorrections };
  // 🎧 your taste: sounds you never want are swapped for their stand-ins
  const av = applyAvoid(chk.code, getTaste());
  if (av.swapped.length) clog('fix', `🎧 your taste: ${av.swapped.map(([a, b, n]) => `${a} → ${b}${n > 1 ? ` (×${n})` : ''}`).join(', ')}`);
  chk.code = av.code;
  const failed = await preloadSoundfonts(chk.code);
  if (failed.length && !quiet) {
    addMsg('error', `Couldn't download soundfont(s) ${failed.join(', ')} from felixroos.github.io — they will be silent. Check the browser's internet access.`);
  }
  return { code: wrapCode(chk.code), error: null, corrections: allCorrections };
}

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  transposeLog = new Set();

  // ---------------------------------------------------------------------------
  // Scale names: Strudel wants "Tonic:name" with spaces in the name replaced by
  // colons, e.g. .scale("C:minor:pentatonic"). Models often write
  // "C:minorpentatonic", "C minor pentatonic" or "C:pentatonic minor".
  // ---------------------------------------------------------------------------
  // (scale names are checked and repaired in lib/scales.js)
  scalesReady = fetch('/scales.json').then((r) => r.json()).then(setScales).catch(() => setScales([]));

  // Surface runtime sound errors (e.g. "sound xyz not found", soundfont load failures)
  seenLogs = new Map();
  document.addEventListener('strudel.log', (e) => {
    if (inDryRun) return; // reported by the caller instead
    const msg = String(e.detail?.message || '');
    if (msg.startsWith('[strudel-ai]')) return;
    for (const [m, t] of recentDryRunErrors) {
      if (performance.now() - t > 5000) recentDryRunErrors.delete(m);
      else if (msg.includes(m)) return; // already reported by the test run
    }
    if (!/not found|could not load|no soundfont|error/i.test(msg)) return;
    const t = performance.now();
    if (seenLogs.has(msg) && t - seenLogs.get(msg) < 15000) return;
    seenLogs.set(msg, t);
    const bar = $('error-bar');
    bar.hidden = false;
    bar.textContent = '⚠ ' + msg;
    clearTimeout(bar._t);
    bar._t = setTimeout(() => { if (!lastReplState.error) bar.hidden = true; }, 6000);
    // the chat only hears about problems with code the app has finished checking; details go to the console
    clog('error', `engine: ${msg}`);
  });
}
