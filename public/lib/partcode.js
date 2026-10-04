// Reading and changing one part's code (`const lead_main = n("…").scale("A:minor").s("sawtooth").lpf(800).gain(0.6)`)
// for the 🎛 part editor: its effects (the methods on the whole part, like .lpf(…) and .room(slider(…))) and its
// note patterns (the mini-notation strings given to n / note / s / struct / velocity …).

/** The effects the editor knows: name → { label, group, min, max, step, def, log? }. */
export const EFFECTS = {
  gain: { label: 'Gain', group: 'Level', min: 0, max: 1.5, step: 0.01, def: 0.7 },
  velocity: { label: 'Velocity', group: 'Level', min: 0, max: 1, step: 0.01, def: 0.8 },
  pan: { label: 'Pan', group: 'Level', min: 0, max: 1, step: 0.01, def: 0.5 },
  lpf: { label: 'Low-pass', group: 'Tone', min: 50, max: 16000, step: 1, def: 2000, log: true, unit: 'Hz' },
  lpq: { label: 'Resonance', group: 'Tone', min: 0, max: 30, step: 0.1, def: 1 },
  hpf: { label: 'High-pass', group: 'Tone', min: 20, max: 8000, step: 1, def: 200, log: true, unit: 'Hz' },
  vowel: { label: 'Vowel', group: 'Tone', text: true, def: 'a' },
  attack: { label: 'Attack', group: 'Envelope', min: 0, max: 2, step: 0.01, def: 0.01, unit: 's' },
  decay: { label: 'Decay', group: 'Envelope', min: 0, max: 2, step: 0.01, def: 0.2, unit: 's' },
  sustain: { label: 'Sustain', group: 'Envelope', min: 0, max: 1, step: 0.01, def: 0.8 },
  release: { label: 'Release', group: 'Envelope', min: 0, max: 4, step: 0.01, def: 0.3, unit: 's' },
  clip: { label: 'Note length', group: 'Envelope', min: 0.05, max: 2, step: 0.01, def: 1 },
  room: { label: 'Reverb', group: 'Space', min: 0, max: 1, step: 0.01, def: 0.3 },
  size: { label: 'Reverb size', group: 'Space', min: 0, max: 10, step: 0.1, def: 2 },
  delay: { label: 'Delay', group: 'Space', min: 0, max: 1, step: 0.01, def: 0.25 },
  delaytime: { label: 'Delay time', group: 'Space', min: 0.01, max: 1, step: 0.01, def: 0.25, unit: 'cyc' },
  delayfeedback: { label: 'Delay feedback', group: 'Space', min: 0, max: 0.95, step: 0.01, def: 0.4 },
  shape: { label: 'Shape', group: 'Colour', min: 0, max: 1, step: 0.01, def: 0.3 },
  distort: { label: 'Distort', group: 'Colour', min: 0, max: 5, step: 0.01, def: 0.5 },
  crush: { label: 'Bit crush', group: 'Colour', min: 1, max: 16, step: 1, def: 8 },
  coarse: { label: 'Coarse', group: 'Colour', min: 1, max: 32, step: 1, def: 4 },
  phaser: { label: 'Phaser', group: 'Colour', min: 0, max: 10, step: 0.1, def: 2 },
  speed: { label: 'Speed', group: 'Pitch', min: -2, max: 4, step: 0.01, def: 1 },
  vib: { label: 'Vibrato', group: 'Pitch', min: 0, max: 12, step: 0.1, def: 4, unit: 'Hz' },
  vibmod: { label: 'Vibrato depth', group: 'Pitch', min: 0, max: 2, step: 0.01, def: 0.3 },
};
/** Other spellings Strudel takes for the same effect. */
const ALIASES = { cutoff: 'lpf', lp: 'lpf', resonance: 'lpq', hcutoff: 'hpf', hp: 'hpf', roomsize: 'size', rsize: 'size', sz: 'size', dt: 'delaytime', dfb: 'delayfeedback', delayfb: 'delayfeedback', ph: 'phaser' };
export const effectKey = (name) => (EFFECTS[name] ? name : ALIASES[name] || null);
export const EFFECT_GROUPS = [...new Set(Object.values(EFFECTS).map((e) => e.group))];

/**
 * Every call in the code: { name, dot, start (of the name, or the dot), open, close (the parens), depth, expr } —
 * expr numbers the expression it's part of (calls chained on each other share it; the arguments of a call and each
 * item of a list are their own). Strings and comments are skipped.
 */
export function scanCalls(code) {
  const calls = [];
  const open = []; // stack of { call, ch }
  const exprs = [0];
  let nextExpr = 1;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(code, i); continue; }
    if (c === '/' && code[i + 1] === '/') { while (i < code.length && code[i] !== '\n') i++; continue; }
    if (c === '/' && code[i + 1] === '*') { const e = code.indexOf('*/', i + 2); i = e < 0 ? code.length : e + 1; continue; }
    if (/[A-Za-z_$]/.test(c) && !/[\w$]/.test(code[i - 1] || '')) {
      let j = i;
      while (j < code.length && /[\w$]/.test(code[j])) j++;
      let k = j;
      while (/\s/.test(code[k] || '')) k++;
      if (code[k] === '(') {
        let d = i - 1;
        while (d >= 0 && /\s/.test(code[d])) d--;
        const dot = code[d] === '.';
        const call = { name: code.slice(i, j), dot, start: dot ? d : i, open: k, close: -1, depth: open.length, expr: exprs[exprs.length - 1] };
        calls.push(call);
        open.push({ call });
        exprs.push(nextExpr++);
        i = k;
        continue;
      }
      i = j - 1;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') { open.push({ call: null }); exprs.push(nextExpr++); continue; }
    if (c === ')' || c === ']' || c === '}') {
      const o = open.pop();
      exprs.pop();
      if (o?.call) o.call.close = i;
      continue;
    }
    if (c === ',' && exprs.length > 1) exprs[exprs.length - 1] = nextExpr++;
  }
  return calls.filter((x) => x.close > 0);
}
function skipString(code, i) {
  const q = code[i];
  for (let j = i + 1; j < code.length; j++) {
    if (code[j] === '\\') { j++; continue; }
    if (code[j] === q) return j;
  }
  return code.length;
}
/** The arguments of a call as source text (split on top-level commas). */
export function callArgs(code, call) {
  const inner = code.slice(call.open + 1, call.close);
  const out = [];
  let depth = 0, from = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(inner, i); continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && !depth) { out.push({ text: inner.slice(from, i), at: call.open + 1 + from }); from = i + 1; }
  }
  out.push({ text: inner.slice(from), at: call.open + 1 + from });
  return out.filter((a) => a.text.trim() || out.length === 1);
}
/** A plain string literal's value and the span of its contents, or null. */
function literal(arg) {
  const t = arg.text, lead = t.length - t.trimStart().length, s = t.trim();
  if (s.length < 2 || !['"', "'", '`'].includes(s[0]) || s[s.length - 1] !== s[0] || (s[0] === '`' && s.includes('${'))) return null;
  const body = s.slice(1, -1);
  if (body.includes(s[0])) return null;
  return { value: body, start: arg.at + lead + 1, end: arg.at + lead + s.length - 1 };
}

/** Where the part's expression starts: after `const x =`, and after `(prog) =>` for a part that follows the chords. */
export function bodyStart(code) {
  const m = /^\s*(?:const|let|var)\s+[\w$]+\s*=\s*(?:\(?\s*[\w$]*\s*\)?\s*=>\s*)?/.exec(code);
  return m ? m[0].length : 0;
}

const num = (t) => (/^\s*-?\d*\.?\d+(?:e-?\d+)?\s*$/i.test(t) ? Number(t) : null);
/**
 * The part's effects: the methods on the whole part (not inside it) the editor knows. Each:
 * { key, name, call, kind: 'slider' | 'number' | 'text' | 'pattern', value, min, max, span: [start, end] (what to replace) }.
 */
export function readEffects(code) {
  const from = bodyStart(code);
  const calls = scanCalls(code);
  const outer = calls.filter((c) => c.depth === 0 && c.start >= from);
  const out = [];
  for (const c of outer) {
    if (!c.dot) continue;
    const key = effectKey(c.name);
    if (!key) continue;
    const args = callArgs(code, c);
    const a = args[0];
    if (!a) continue;
    const meta = EFFECTS[key];
    const lit = literal(a);
    const sl = /^\s*slider\(\s*([^,()]+)\s*,\s*([^,()]+)\s*,\s*([^,()]+)\s*(?:,\s*[^()]*)?\)\s*$/.exec(a.text);
    if (sl && num(sl[1]) != null) {
      const vStart = a.at + a.text.indexOf(sl[1]);
      out.push({ key, name: c.name, call: c, kind: 'slider', value: num(sl[1]), min: num(sl[2]) ?? meta.min, max: num(sl[3]) ?? meta.max, span: [vStart, vStart + sl[1].length] });
    } else if (num(a.text) != null) {
      const lead = a.text.length - a.text.trimStart().length;
      out.push({ key, name: c.name, call: c, kind: 'number', value: num(a.text), min: meta.min, max: meta.max, span: [a.at + lead, a.at + lead + a.text.trim().length] });
    } else if (lit) {
      out.push({ key, name: c.name, call: c, kind: meta.text ? 'text' : 'pattern', value: lit.value, span: [lit.start, lit.end] });
    } else {
      out.push({ key, name: c.name, call: c, kind: 'code', value: a.text.trim(), span: [a.at, a.at + a.text.length] });
    }
  }
  return out;
}

const fmtNum = (v) => String(Math.round(v * 10000) / 10000);
/** Set an effect's value (a number keeps its slider and range; text stays text). */
export function setEffect(code, eff, value) {
  const text = eff.kind === 'slider' || eff.kind === 'number' ? fmtNum(Number(value)) : String(value).replace(/["\\]/g, '');
  return code.slice(0, eff.span[0]) + text + code.slice(eff.span[1]);
}
/** Take an effect off the part. */
export function removeEffect(code, eff) {
  return code.slice(0, eff.call.start) + code.slice(eff.call.close + 1);
}
/**
 * Add an effect to the whole part: before its final .gain(…) / .postgain(…) when it has one (so the level stays last),
 * else at the end. Numbers are added as live sliders.
 */
export function addEffect(code, key) {
  const meta = EFFECTS[key];
  if (!meta) return code;
  const arg = meta.text ? JSON.stringify(meta.def) : `slider(${meta.def}, ${meta.min}, ${meta.max})`;
  const ins = `.${key}(${arg})`;
  const from = bodyStart(code);
  const outer = scanCalls(code).filter((c) => c.depth === 0 && c.start >= from && c.dot);
  const last = outer[outer.length - 1];
  if (last && /^(gain|postgain)$/.test(last.name) && key !== 'gain') return code.slice(0, last.start) + ins + code.slice(last.start);
  // the end of the expression (before a trailing semicolon or comment)
  const m = /\s*;?\s*(\/\/[^\n]*)?\s*$/.exec(code);
  const end = last ? last.close + 1 : m.index;
  return code.slice(0, end) + ins + code.slice(end);
}

/** The functions whose mini-notation the note editor can change, and what their strings hold. */
const SOURCE_FNS = ['n', 'note', 's', 'sound', 'struct', 'velocity', 'arp', 'gain'];
/**
 * The part's note patterns: [{ fn, kind, value, start, end, label, scale, chord }]. kind:
 *   'degree' — scale degrees (n(…).scale(…)): a staff;  'pitch' — note names / MIDI numbers (note(…)): a staff;
 *   'tone' — chord tones (n(…) or .arp(…) on chords): a grid;  'index' — which sample (.n(…) on drums): a grid;
 *   'drums' — sounds (s(…)): a grid;  'rhythm' — x / ~ (struct): a grid;  'level' — 0–1 (velocity / gain): bars.
 */
export function readSources(code) {
  const calls = scanCalls(code);
  const out = [];
  for (const c of calls) {
    if (!SOURCE_FNS.includes(c.name)) continue;
    const args = callArgs(code, c);
    if (args.length !== 1) continue;
    const lit = literal(args[0]);
    if (!lit) continue;
    const chain = calls.filter((x) => x.expr === c.expr && x.dot && x.start > c.close);
    const has = (n) => chain.some((x) => x.name === n);
    const scaleCall = chain.find((x) => x.name === 'scale');
    const scale = scaleCall ? literal(callArgs(code, scaleCall)[0] || { text: '' })?.value || null : null;
    const onChords = has('chord') || has('voicing') || calls.some((x) => x.expr === c.expr && !x.dot && x.name === 'chord');
    let kind;
    if (c.name === 'note') kind = 'pitch';
    else if (c.name === 'n') kind = scale ? 'degree' : onChords ? 'tone' : c.dot ? 'index' : 'degree';
    else if (c.name === 's' || c.name === 'sound') kind = /[a-z]/i.test(lit.value) && !/^[\s~x.\-]*$/i.test(lit.value) ? 'drums' : null;
    else if (c.name === 'struct') kind = 'rhythm';
    else if (c.name === 'arp') kind = 'tone';
    else if (c.name === 'velocity' || c.name === 'gain') kind = /^[\d.\s~<>\[\]@*!,]+$/.test(lit.value) ? 'level' : null;
    if (!kind) continue;
    // a single sample name for a synth (s("sawtooth")) is a sound, not a pattern
    if (kind === 'drums' && !/[\s<\[~*,]/.test(lit.value.trim())) continue;
    const label = { degree: 'notes', pitch: 'notes', tone: 'chord tones', index: 'hits', drums: 'drums', rhythm: 'rhythm', level: c.name }[kind];
    out.push({ fn: c.name, kind, value: lit.value, start: lit.start, end: lit.end, label, scale, chord: onChords });
  }
  // number the ones with the same label (drums 1, drums 2 …)
  const count = {};
  for (const s of out) count[s.label] = (count[s.label] || 0) + 1;
  const seen = {};
  for (const s of out) if (count[s.label] > 1) s.label = `${s.label} ${(seen[s.label] = (seen[s.label] || 0) + 1)}`;
  return out;
}
/** Replace a note pattern's string. */
export const setSource = (code, src, value) => code.slice(0, src.start) + value + code.slice(src.end);
