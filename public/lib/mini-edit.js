// Editing a mini-notation string ("0 ~ 2 4", "<[0 2] [4@3 5]>", "bd ~ [bd,hh] sd") as bars of notes, so the
// 🎛 part editor can show it on a staff or a grid and write it back. A subset of mini-notation is editable:
//   steps separated by spaces, ~ (rest), [subdivisions], [a,b] (several at once), a@n (longer), a*n and a! (repeats),
//   and <bar bar …> (one entry per bar) at the top. Anything else (euclid, ?, {…}, ., nested <…>) is shown read-only.
// A bar: { res, events: [{ t, len, vals: [string] }] } — times in ticks, res ticks per bar.

const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
const lcm = (a, b) => (a / gcd(a, b)) * b;
const MAX_RES = 384;

/** Split a string into tokens: brackets, operators and words. Returns null for syntax this editor doesn't handle. */
function tokenize(str) {
  const out = [];
  const re = /\s*(?:([[\]<>,])|([@*!])|(~|-(?![\d.]))|([A-Za-z0-9#.:\-]+)|(\S))/gy;
  let m;
  while (re.lastIndex < str.length && (m = re.exec(str))) {
    if (m[0].trim() === '') break;
    if (m[5]) return null; // ( ) { } ? | … — not editable here
    if (m[4] === '.' || m[4]?.startsWith('.')) return null; // . groups steps — not editable here
    out.push(m[1] ? { b: m[1] } : m[2] ? { op: m[2] } : m[3] ? { rest: true } : { w: m[4] });
  }
  return out;
}

/** Parse tokens into a tree: { seq: [terms] }, terms: { atom } | { rest } | { sub: seq } | { stack: [seq] } | { alt: seq } with weight / repeat. */
function parseSeq(toks, i, close) {
  const terms = [];
  const stacks = [];
  while (i < toks.length) {
    const t = toks[i];
    if (close && t.b === close) break;
    if (t.b === ',') { stacks.push(terms.splice(0)); i++; continue; }
    let term;
    if (t.b === '[') { const r = parseSeq(toks, i + 1, ']'); if (!r) return null; term = r.stack ? { stack: r.stack } : { sub: r.seq }; i = r.i + 1; }
    else if (t.b === '<') { const r = parseSeq(toks, i + 1, '>'); if (!r || r.stack) return null; term = { alt: r.seq }; i = r.i + 1; }
    else if (t.rest) { term = { rest: true }; i++; }
    else if (t.w != null) { term = { atom: t.w }; i++; }
    else return null;
    term.w = 1;
    term.rep = 1;
    // modifiers
    while (i < toks.length && toks[i].op) {
      const op = toks[i].op, num = toks[i + 1]?.w;
      if (op === '!') { terms.push({ ...term }); i++; continue; } // a! — one more of the same
      if (num == null || !/^\d+(\.\d+)?$/.test(num)) return null;
      if (op === '@') term.w = Number(num);
      else if (op === '*') { if (!/^\d+$/.test(num)) return null; term.rep = Number(num); }
      else return null;
      i += 2;
    }
    if (!Number.isInteger(term.w)) return null;
    terms.push(term);
  }
  if (stacks.length) { stacks.push(terms); return { stack: stacks, i }; }
  return { seq: terms, i };
}

/** Lay a sequence out over [t, t+len) (fractions as [num, den]); push events. Returns false when it can't. */
function layout(seq, t, len, out) {
  const total = seq.reduce((a, x) => a + x.w, 0);
  if (!total) return true;
  let pos = 0;
  for (const term of seq) {
    const start = addF(t, mulF(len, [pos, total]));
    const tlen = mulF(len, [term.w, total]);
    pos += term.w;
    const reps = term.rep;
    for (let r = 0; r < reps; r++) {
      const rs = addF(start, mulF(tlen, [r, reps])), rl = mulF(tlen, [1, reps]);
      if (term.rest) continue;
      if (term.atom != null) out.push({ t: rs, len: rl, vals: [term.atom] });
      else if (term.sub) { if (!layout(term.sub, rs, rl, out)) return false; }
      else if (term.stack) {
        // [a,b,c] — single atoms at once become one event with several values; anything else isn't editable
        if (!term.stack.every((s) => s.length === 1 && s[0].atom != null && s[0].w === 1 && s[0].rep === 1)) return false;
        out.push({ t: rs, len: rl, vals: term.stack.map((s) => s[0].atom) });
      } else return false; // nested <…>
    }
  }
  return true;
}
const normF = ([n, d]) => { const g = gcd(n, d) || 1; return [n / g, d / g]; };
const addF = (a, b) => normF([a[0] * b[1] + b[0] * a[1], a[1] * b[1]]);
const mulF = (a, b) => normF([a[0] * b[0], a[1] * b[1]]);

/** Fractions → ticks: { res, events } (null when the grid gets too fine). */
function toBar(events) {
  let res = 1;
  for (const e of events) res = lcm(lcm(res, e.t[1]), e.len[1]);
  if (res > MAX_RES) return null;
  return { res, events: events.map((e) => ({ t: (e.t[0] * res) / e.t[1], len: (e.len[0] * res) / e.len[1], vals: e.vals })) };
}

/**
 * Parse a mini-notation string into bars. Returns { alt, bars } — alt: one entry per bar (<…>), else the whole
 * string is one bar that repeats — or { error } when it uses notation this editor can't change.
 */
export function parseMini(str) {
  const toks = tokenize(String(str ?? ''));
  if (!toks) return { error: 'uses notation the note editor can’t change (edit it as text)' };
  const r = parseSeq(toks, 0, undefined);
  if (!r || r.i < toks.length) return { error: 'uses notation the note editor can’t change (edit it as text)' };
  const top = r.stack ? null : r.seq;
  // <bar bar …> — the whole string is one alternation: each entry is a bar
  if (top && top.length === 1 && top[0].alt && top[0].w === 1 && top[0].rep === 1) {
    const bars = [];
    for (const item of top[0].alt) {
      if (item.w !== 1 || item.alt) return { error: 'uses notation the note editor can’t change (edit it as text)' };
      const ev = [];
      if (!layout([item], [0, 1], [1, 1], ev)) return { error: 'uses notation the note editor can’t change (edit it as text)' };
      const bar = toBar(ev);
      if (!bar) return { error: 'its rhythm is too fine for the note editor' };
      bars.push(bar);
    }
    return { alt: true, bars: bars.length ? bars : [{ res: 1, events: [] }] };
  }
  const ev = [];
  if (r.stack) {
    if (!layout([{ stack: r.stack, w: 1, rep: 1 }], [0, 1], [1, 1], ev)) return { error: 'uses notation the note editor can’t change (edit it as text)' };
  } else if (!layout(top, [0, 1], [1, 1], ev)) return { error: 'uses notation the note editor can’t change (edit it as text)' };
  const bar = toBar(ev);
  if (!bar) return { error: 'its rhythm is too fine for the note editor' };
  return { alt: false, bars: [bar] };
}

/** One bar as mini-notation steps (on the coarsest grid that fits it). */
export function barSteps(bar) {
  const evs = [...bar.events].sort((a, b) => a.t - b.t);
  let g = bar.res;
  for (const e of evs) g = gcd(gcd(g, e.t), e.len);
  g = g || bar.res;
  const n = bar.res / g;
  const out = [];
  let t = 0;
  for (const e of evs) {
    const s = e.t / g, l = e.len / g;
    while (t < s) { out.push('~'); t++; }
    const v = e.vals.length > 1 ? `[${e.vals.join(',')}]` : e.vals[0];
    out.push(l > 1 ? `${v}@${l}` : v);
    t = s + l;
  }
  while (t < n) { out.push('~'); t++; }
  return out;
}

/** Bars back to a mini-notation string. */
export function serializeMini({ alt, bars }) {
  if (!alt && bars.length === 1) return barSteps(bars[0]).join(' ');
  return `<${bars.map((b) => { const s = barSteps(b); return s.length === 1 ? s[0] : `[${s.join(' ')}]`; }).join(' ')}>`;
}

/** Make a bar's grid fine enough for `steps` steps per bar (scales its ticks). */
export function withGrid(bar, steps) {
  const res = lcm(bar.res, steps);
  if (res > MAX_RES) return bar;
  const k = res / bar.res;
  return { res, events: bar.events.map((e) => ({ t: e.t * k, len: e.len * k, vals: [...e.vals] })) };
}

/** The event sounding at tick t, if any. */
export const eventAt = (bar, t) => bar.events.find((e) => t >= e.t && t < e.t + e.len) || null;

/**
 * Put a note at [t, t+len): notes it overlaps are shortened (one that started before) or removed (ones inside).
 * Returns the new bar.
 */
export function placeNote(bar, t, len, vals) {
  len = Math.max(1, Math.min(len, bar.res - t));
  const events = [];
  for (const e of bar.events) {
    if (e.t + e.len <= t || e.t >= t + len) events.push(e); // not in the way
    else if (e.t < t) events.push({ ...e, len: t - e.t }); // started before: it stops where the new note starts
    // (a note that starts inside the new one is replaced by it)
  }
  events.push({ t, len, vals: [...vals] });
  return { res: bar.res, events: events.sort((a, b) => a.t - b.t) };
}

/** Take a note out (it becomes a rest). */
export const removeNote = (bar, ev) => ({ res: bar.res, events: bar.events.filter((e) => e !== ev) });

/** Change a note's length (to at most the next note / the bar's end). */
export function resizeNote(bar, ev, len) {
  const next = bar.events.filter((e) => e !== ev && e.t > ev.t).reduce((a, e) => Math.min(a, e.t), bar.res);
  const l = Math.max(1, Math.min(len, next - ev.t));
  return { res: bar.res, events: bar.events.map((e) => (e === ev ? { ...e, len: l } : e)) };
}

/** Toggle one value at a grid step (drum / lane grids): add it to the step, or take it out. */
export function toggleAt(bar, t, len, val) {
  const at = bar.events.find((e) => e.t === t);
  if (at && at.vals.includes(val)) {
    const vals = at.vals.filter((v) => v !== val);
    return vals.length ? { res: bar.res, events: bar.events.map((e) => (e === at ? { ...e, vals } : e)) } : removeNote(bar, at);
  }
  if (at) return { res: bar.res, events: bar.events.map((e) => (e === at ? { ...e, vals: [...e.vals, val] } : e)) };
  return placeNote(bar, t, len, [val]);
}

/** The steps per bar the editor shows: the bar's own grid, at least `min`. */
export function gridSteps(bar, min = 1) {
  let g = bar.res;
  for (const e of bar.events) g = gcd(gcd(g, e.t), e.len);
  const own = bar.res / (g || bar.res);
  return Math.max(own, min) % own === 0 ? Math.max(own, min) : lcm(own, min) <= 64 ? lcm(own, min) : own;
}
