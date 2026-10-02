// ---------------------------------------------------------------------------
// Wrap long Strudel lines (about 150 characters) the way a person would:
//  1. method chains break before a method at the chain's own level, continuation lines indented two spaces:
//       bass: chord(prog).rootNotes(2).struct("x ~ x x")
//         .lpf(slider(900, 200, 4000)).gain(slider(0.8, 0, 1.2))
//  2. a call whose arguments are still too long gets one argument per line:
//       drums: stack(
//         s("bd*4"),
//         s("~ cp ~ cp"),
//       ).bank("RolandTR909")
// Strings (mini-notation) and comments are never broken; short lines are left alone, so wrapping twice changes
// nothing.
// ---------------------------------------------------------------------------

export const WRAP_WIDTH = 150;
/** A line's width as you see it: every slider(…) also draws a fader about 8 characters wide in the editor. */
const SLIDER_WIDTH = 8;
const vis = (text) => text.length + SLIDER_WIDTH * (text.match(/\bslider\(/g) || []).length;

/**
 * Scan a line: for every character its bracket depth (outside strings), whether it's inside a string,
 * and where a // comment starts (or -1).
 */
function scan(line) {
  const depth = new Array(line.length).fill(0);
  const inStr = new Array(line.length).fill(false);
  let d = 0, q = null, comment = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      inStr[i] = true;
      depth[i] = d;
      if (c === '\\') { if (i + 1 < line.length) { inStr[i + 1] = true; depth[i + 1] = d; } i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '/' && line[i + 1] === '/') { comment = i; for (let j = i; j < line.length; j++) depth[j] = d; break; }
    if (c === '"' || c === "'" || c === '`') { q = c; inStr[i] = true; depth[i] = d; continue; }
    if (c === '(' || c === '[' || c === '{') { depth[i] = d; d++; continue; }
    if (c === ')' || c === ']' || c === '}') { d = Math.max(0, d - 1); depth[i] = d; continue; }
    depth[i] = d;
  }
  return { depth, inStr, comment };
}

/** Positions of ".method(" at bracket depth `level` (the dots a chain can break before). */
function chainDots(code, s, level) {
  const out = [];
  for (let i = 1; i < code.length; i++) {
    if (code[i] !== '.' || s.inStr[i] || s.depth[i] !== level) continue;
    if (/[\d]/.test(code[i - 1]) && /\d/.test(code[i + 1] || '')) continue; // 0.5
    const m = /^\.([A-Za-z_$][\w$]*)\s*\(/.exec(code.slice(i));
    if (m) out.push(i);
  }
  return out;
}

/** Split `code` (one line, no indent) at chain dots and pack the pieces into lines of at most `width`. */
function wrapChain(code, indent, width) {
  const s = scan(code);
  const dots = chainDots(code, s, Math.min(...[...code].map((_, i) => (s.inStr[i] ? Infinity : s.depth[i]))));
  if (!dots.length) return null;
  const pieces = [];
  let from = 0;
  for (const at of dots) { pieces.push(code.slice(from, at)); from = at; }
  pieces.push(code.slice(from));
  const lines = [];
  let cur = pieces.shift();
  const cont = indent + '  ';
  for (const p of pieces) {
    const room = width - (lines.length ? cont.length : indent.length);
    if (vis(cur + p) <= room) cur += p;
    else { lines.push(cur); cur = p; }
  }
  lines.push(cur);
  if (lines.length < 2) return null;
  return lines.map((l, i) => (i ? cont : indent) + l.trimEnd());
}

/** The outermost call with several arguments, as { open, close, args: [string] } — to put one argument per line. */
function argsOfOuterCall(code) {
  const s = scan(code);
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== '(' || s.inStr[i]) continue;
    const d = s.depth[i];
    let close = -1;
    for (let j = i + 1; j < code.length; j++) if (!s.inStr[j] && code[j] === ')' && s.depth[j] === d) { close = j; break; }
    if (close < 0) continue;
    const commas = [];
    for (let j = i + 1; j < close; j++) if (!s.inStr[j] && code[j] === ',' && s.depth[j] === d + 1) commas.push(j);
    if (!commas.length || close - i < 60) continue; // nothing to gain
    const args = [];
    let from = i + 1;
    for (const c of commas) { args.push(code.slice(from, c).trim()); from = c + 1; }
    const last = code.slice(from, close).trim();
    if (last) args.push(last);
    return { open: i, close, args };
  }
  return null;
}

/** Wrap one statement line (indent + code [+ comment]). Returns an array of lines. */
function wrapLine(line, width, guard = 0) {
  if (vis(line) <= width || guard > 6) return [line];
  const indent = line.match(/^\s*/)[0];
  let code = line.slice(indent.length);
  const s = scan(code);
  let comment = '';
  if (s.comment >= 0) { comment = ' ' + code.slice(s.comment).trim(); code = code.slice(0, s.comment).trimEnd(); }
  // 1) the method chain — unless its head is itself a long call (stack(…), arrange(…)): then its arguments go one per
  //    line first and the chain carries on from the closing bracket: ").bank(…).gain(…)"
  const call = argsOfOuterCall(code);
  const chain = wrapChain(code, indent, width - comment.length);
  const headTooLong = chain && call && call.close < code.length && vis(chain[0]) > width && indent.length + call.open < chain[0].length;
  if (chain && !headTooLong) {
    chain[chain.length - 1] += comment;
    return chain.flatMap((l) => (vis(l) > width ? wrapLine(l, width, guard + 1) : [l]));
  }
  // 2) one argument per line for the outermost long call
  if (call) {
    const inner = indent + '  ';
    const out = [indent + code.slice(0, call.open + 1)];
    for (const a of call.args) out.push(...wrapLine(`${inner}${a},`, width, guard + 1));
    out.push(indent + code.slice(call.close) + comment);
    return out.flatMap((l, i) => (i === out.length - 1 && vis(l) > width ? wrapLine(l, width, guard + 1) : [l]));
  }
  return [line]; // a single long string or token: leave it
}

/** Wrap every line of a program that is longer than `width` characters. */
export function wrapCode(code, width = WRAP_WIDTH) {
  if (!code || !code.split('\n').some((l) => vis(l) > width)) return code;
  return code.split('\n').flatMap((l) => wrapLine(l, width)).join('\n');
}
