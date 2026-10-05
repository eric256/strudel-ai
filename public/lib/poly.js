// Polyphonic parts: a part that plays more than one line at once, still ONE part (one mixer channel, one 🔀 chain).
//   voices — written lines played together: the tune plus a harmony a third or sixth below (or above, or an octave
//            away), or a counter-line: stack(n("melody"), n("harmony")).scale(…).s(…)
//   layers — the same notes on two (or three) sounds, each with its own effects:
//            .layer(x => x.s("sawtooth"), x => x.s("gm_string_ensemble_1").velocity(0.6))
// The sheet names them (part.voices, part.layers); the AI writes the code, and these helpers add what it left out and
// let the 🧩 part editor add / remove a voice or a layer.
import { scanCalls, callArgs, bodyStart, readSources } from './partcode.js';
import { parseMini, serializeMini } from './mini-edit.js';

/** The voices a part may add to its line, and how far each sits from it (scale steps; null: its own line). */
export const VOICES = {
  third_below: { label: 'a third below', shift: -2 },
  sixth_below: { label: 'a sixth below', shift: -5 },
  third_above: { label: 'a third above', shift: 2 },
  octave_below: { label: 'an octave below', shift: -7 },
  octave_above: { label: 'an octave above', shift: 7 },
  counter: { label: 'a counter-line', shift: null },
};
/** A voice as the sheet writes it ("harmony a third below", "6th", "counter") → a VOICES key, or null. */
export function voiceKey(s) {
  const t = String(s || '').toLowerCase().replace(/[_-]/g, ' ');
  if (VOICES[t.replace(/ /g, '_')]) return t.replace(/ /g, '_');
  const up = /above|up|over|high/.test(t);
  if (/counter|answer|own line|independent/.test(t)) return 'counter';
  if (/oct|8va|8vb/.test(t)) return up ? 'octave_above' : 'octave_below';
  if (/six|6th/.test(t)) return 'sixth_below';
  if (/third|3rd|harm/.test(t)) return up ? 'third_above' : 'third_below';
  return null;
}
/** The sheet's part.voices, checked: up to 2 known voices, no repeats. */
export const normVoices = (v) => [...new Set((Array.isArray(v) ? v : v ? [v] : []).map(voiceKey).filter(Boolean))].slice(0, 2);
/** The sheet's part.layers, checked: up to 2 sound names (plain words), not the part's own sound. */
export const normLayers = (v, own = '') => [...new Set((Array.isArray(v) ? v : v ? [v] : [])
  .map((x) => String(typeof x === 'object' && x ? x.sound || '' : x).trim())
  .filter((x) => /^[\w:.-]+$/.test(x) && x.toLowerCase() !== String(own).toLowerCase()))].slice(0, 2);
/** Roles that can carry voices: single lines (chords and pads are already chords; drums have no pitch). */
export const VOICE_ROLE = /melody|lead|counter|hook|theme|riff|solo|arp|fx/i;

/** A degree line moved by `n` scale steps ("0 2 <4 5>" → "-2 0 <2 3>"); null when it can't be read. */
export function shiftLine(mini, n, map = null) {
  const m = parseMini(mini);
  if (m.error) return null;
  const f = map || ((v) => (/^-?\d+$/.test(v) ? String(Number(v) + n) : v));
  return serializeMini({ alt: m.alt, bars: m.bars.map((b) => ({ res: b.res, events: b.events.map((e) => ({ ...e, vals: e.vals.map(f) })) })) });
}
/** A counter-line under a tune: one held note per bar, the tune's first note a third below (the user / AI shapes it). */
export function counterLine(mini) {
  const m = parseMini(mini);
  if (m.error) return '~';
  const first = (b) => b.events.flatMap((e) => e.vals).find((v) => /^-?\d+$/.test(v));
  const bars = m.bars.map((b) => { const v = first(b); return v == null ? '~' : String(Number(v) - 4); });
  return bars.length > 1 ? `<${bars.join(' ')}>` : bars[0];
}

/** The note sources that are voices: degree / note lines (2+ of them is a part with voices). */
export const voiceSources = (code) => readSources(code).filter((s) => s.kind === 'degree' || s.kind === 'pitch');
/** Whether a part's code already plays more than one line at once. */
export const hasVoices = (code) => voiceSources(code).length > 1 || /\.(superimpose|off)\s*\(/.test(code);

/** The call (n / note) whose string is the source, and the stack(...) it's an argument of (if any). */
function sourceCall(code, src) {
  const calls = scanCalls(code);
  const c = calls.find((x) => (x.name === 'n' || x.name === 'note') && x.open < src.start && src.end <= x.close);
  if (!c) return {};
  const st = calls.filter((x) => x.name === 'stack' && !x.dot && x.open < c.start && c.close < x.close && x.depth === c.depth - 1).pop();
  return { c, st };
}
/**
 * Add a voice to a part: a new line next to the source (another argument of its stack(...), or the source wrapped in
 * one). line: the new line's mini-notation; quieter (velocity 0.7) so the tune stays on top.
 */
export function addVoice(code, src, line) {
  const { c, st } = sourceCall(code, src);
  if (!c) return code;
  const voice = `${c.name}("${line}").velocity(0.7)`;
  if (st) {
    const args = callArgs(code, st);
    const last = args[args.length - 1];
    const at = last.at + last.text.trimEnd().length;
    return code.slice(0, at) + `, ${voice}` + code.slice(at);
  }
  // n("…").scale(…).s(…) — the whole chain plays both: stack(n("…"), n("…")).scale(…).s(…)
  const end = c.close + 1;
  return code.slice(0, c.start) + `stack(${code.slice(c.start, end)}, ${voice})` + code.slice(end);
}
/** Take a voice out of its stack(...) (a stack left with one line becomes that line again). */
export function removeVoice(code, src) {
  const { c, st } = sourceCall(code, src);
  if (!c || !st) return code;
  const args = callArgs(code, st);
  const k = args.findIndex((a) => a.at <= c.start && c.close < a.at + a.text.length);
  if (k < 0 || args.length < 2) return code;
  const rest = args.filter((_, i) => i !== k).map((a) => a.text.trim());
  const inner = rest.length === 1 ? rest[0] : null;
  if (inner) return code.slice(0, st.start) + inner + code.slice(st.close + 1);
  return code.slice(0, st.open + 1) + rest.join(', ') + code.slice(st.close);
}
/** The degree a voice adds to a line: the new voice's mini-notation (a counter-line: held notes to shape). */
export function voiceLine(mini, key, map = null) {
  const v = VOICES[key];
  if (!v) return null;
  if (v.shift == null) return counterLine(mini);
  return shiftLine(mini, v.shift, map ? (x) => map(x, v.shift) : null);
}

/** The part's layers: [{ sound, arg }] — the .layer(...) on the whole part, each x => x.s("…")…. */
export function readLayers(code) {
  const from = bodyStart(code);
  const call = scanCalls(code).find((x) => x.name === 'layer' && x.dot && x.depth === 0 && x.start >= from);
  if (!call) return [];
  return callArgs(code, call).map((a) => ({ sound: /\.s(?:ound)?\(\s*["'`]([^"'`]+)["'`]/.exec(a.text)?.[1] || '', text: a.text.trim() }));
}
/** The part's own sound: its outer .s("…") (null when it has none, like drums with their sounds in the pattern). */
function outerSound(code) {
  const from = bodyStart(code);
  return scanCalls(code).find((x) => (x.name === 's' || x.name === 'sound') && x.dot && x.depth === 0 && x.start >= from) || null;
}
/** Whether a layer can be added: the part has one sound of its own, or layers already. */
export const canLayer = (code) => !!(outerSound(code) || readLayers(code).length);
/**
 * Layer another sound on the part: its .s("own") becomes .layer(x => x.s("own"), x => x.s("new").velocity(0.6)), or the
 * new sound joins the layers it has.
 */
export function addLayer(code, sound) {
  const snd = String(sound || '').replace(/["'`\\]/g, '').trim();
  if (!snd) return code;
  const from = bodyStart(code);
  const lay = scanCalls(code).find((x) => x.name === 'layer' && x.dot && x.depth === 0 && x.start >= from);
  const add = `x => x.s("${snd}").velocity(0.6)`;
  if (lay) return code.slice(0, lay.close) + `, ${add}` + code.slice(lay.close);
  const s = outerSound(code);
  if (!s) return code;
  const own = code.slice(s.start, s.close + 1).replace(/^\s*\./, '');
  return code.slice(0, s.start) + `.layer(x => x.${own}, ${add})` + code.slice(s.close + 1);
}
/** Take layer k off (one left: back to a plain .s(…) and whatever it did). */
export function removeLayer(code, k) {
  const from = bodyStart(code);
  const lay = scanCalls(code).find((x) => x.name === 'layer' && x.dot && x.depth === 0 && x.start >= from);
  if (!lay) return code;
  const args = callArgs(code, lay).map((a) => a.text.trim());
  if (k < 0 || k >= args.length || args.length < 2) return code;
  const rest = args.filter((_, i) => i !== k);
  if (rest.length === 1) {
    const m = /^\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*\1\s*\.(.+)$/s.exec(rest[0]);
    if (m) return code.slice(0, lay.start) + '.' + m[2] + code.slice(lay.close + 1);
  }
  return code.slice(0, lay.open + 1) + rest.join(', ') + code.slice(lay.close);
}

/**
 * Make a part's code play what the sheet asks for: the voices it names (when the code plays one line) and the
 * layers (when it has none). The AI usually writes them; this adds what it left out.
 */
export function ensurePoly(code, { voices = [], layers = [] } = {}) {
  let out = code;
  if (voices.length && !hasVoices(out)) {
    const src = voiceSources(out).find((s) => s.kind === 'degree');
    if (src) {
      for (const key of voices) {
        const s = voiceSources(out).find((x) => x.kind === 'degree' && x.value === src.value) || voiceSources(out)[0];
        const line = voiceLine(src.value, key);
        if (line) out = addVoice(out, s, line);
      }
    }
  }
  const have = readLayers(out).map((l) => l.sound.toLowerCase());
  for (const snd of layers) {
    if (have.includes(snd.toLowerCase()) || new RegExp(`["'\`]${snd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'\`]`).test(out)) continue;
    if (canLayer(out)) out = addLayer(out, snd);
  }
  return out;
}
