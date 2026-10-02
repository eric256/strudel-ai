// ---------------------------------------------------------------------------
// 🐞 Debug log: everything that goes wrong (or is worth knowing) while the app runs, kept in memory so it can be
// downloaded as a text file and sent back for fixes.
//  - uncaught errors and unhandled promise rejections
//  - console.error / console.warn (Strudel, dockview, the audio engine …)
//  - Strudel's own log messages that are errors or warnings
//  - every 🖥 Console entry (the app reports through dlog)
// This module is imported first, so it is listening before any other code runs.
// ---------------------------------------------------------------------------

const MAX = 5000;
const entries = [];
const started = new Date();
const short = (s, n = 4000) => (s.length > n ? s.slice(0, n) + ' …' : s);

/** Add an entry: kind is error | warn | info | ok | ai | fix (the 🖥 Console's kinds) or anything else. */
export function dlog(kind, text, source = 'app') {
  const e = { t: Date.now(), kind, source, text: short(String(text ?? '')) };
  entries.push(e);
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  return e;
}

const fmt = (a) => {
  if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`;
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a); } catch { return String(a); }
};
// a "test play" of new code is expected to fail sometimes: the app sets this while it runs one
export const debugState = { testPlaying: false };

if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    if (!e.message && e.target && e.target !== window) { dlog('warn', `failed to load ${e.target.src || e.target.href || e.target.tagName}`, 'resource'); return; }
    dlog('error', `uncaught: ${e.message}${e.filename ? ` (${e.filename.replace(location.origin, '')}:${e.lineno}:${e.colno})` : ''}${e.error?.stack ? '\n' + e.error.stack : ''}`, 'page');
  }, true);
  window.addEventListener('unhandledrejection', (e) => dlog('error', `unhandled promise rejection: ${fmt(e.reason)}`, 'page'));
  for (const level of ['error', 'warn']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      try { dlog(level, args.map(fmt).join(' '), 'console'); } catch {}
      orig(...args);
    };
  }
  document.addEventListener('strudel.log', (e) => {
    const msg = String(e.detail?.message || '');
    const type = e.detail?.type;
    if (type === 'error' || /\berror\b/i.test(msg)) dlog(debugState.testPlaying ? 'warn' : 'error', `${debugState.testPlaying ? '(test play) ' : ''}${msg}`, 'strudel');
    else if (type === 'warning' || /\bwarn/i.test(msg)) dlog('warn', msg, 'strudel');
  });
}

const stamp = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 19);
/** The same message with different numbers counts as one problem. */
const problemKey = (e) => `${e.kind}|${e.text.split('\n')[0].replace(/\d+(\.\d+)?/g, '#').slice(0, 200)}`;

/**
 * The report as text.
 * @param {object} info  sections of context: { title: text } (app, song, code …), added after the problems
 */
export function debugReport(info = {}) {
  const problems = entries.filter((e) => e.kind === 'error' || e.kind === 'warn');
  const groups = new Map();
  for (const e of problems) {
    const k = problemKey(e);
    const g = groups.get(k) || { e, n: 0, last: e.t };
    g.n++;
    g.last = e.t;
    groups.set(k, g);
  }
  const line = (e) => `[${stamp(e.t)}] ${e.kind.toUpperCase().padEnd(5)} ${e.source.padEnd(8)} ${e.text.replace(/\n/g, '\n' + ' '.repeat(38))}`;
  const out = [
    'STRUDEL AI — DEBUG LOG',
    `saved ${stamp(Date.now())} · page opened ${stamp(started)} · ${entries.length} entries`,
    '',
    `== SUMMARY: ${problems.filter((e) => e.kind === 'error').length} errors, ${problems.filter((e) => e.kind === 'warn').length} warnings, ${groups.size} distinct ==`,
    ...[...groups.values()].sort((a, b) => b.n - a.n).map((g) => `${String(g.n).padStart(4)}× ${g.e.kind.toUpperCase().padEnd(5)} ${g.e.source.padEnd(8)} ${g.e.text.split('\n')[0].slice(0, 300)}  (last ${stamp(g.last).slice(11)})`),
    '',
  ];
  for (const [title, text] of Object.entries(info)) if (text) out.push(`== ${title.toUpperCase()} ==`, String(text).trim(), '');
  out.push('== PROBLEMS (errors and warnings, oldest first) ==', ...(problems.length ? problems.map(line) : ['(none)']), '');
  out.push('== FULL LOG (oldest first) ==', ...entries.map(line), '');
  return out.join('\n');
}
export const debugCounts = () => ({ errors: entries.filter((e) => e.kind === 'error').length, warnings: entries.filter((e) => e.kind === 'warn').length });
