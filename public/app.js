import { HumRecorder, transcribe, intervalsToSemitones, tonicPc, midiToName, freqToMidi, polyBarsToMini } from './hum.js';
// Strudel AI — browser app
const $ = (id) => document.getElementById(id);

const INITIAL_CODE = `setcpm(120/4)

drums: stack(
  s("bd*4").bank("RolandTR909").gain(slider(1, 0, 1.2)),
  s("~ cp").bank("RolandTR909").room(slider(0.2, 0, 1)).gain(slider(0.8, 0, 1.2)),
  s("hh*8").bank("RolandTR909").velocity("0.5 1").gain(slider(0.6, 0, 1.2))
).postgain(slider(1, 0, 1.5))

bass: note("<c2 c2 eb2 g1>*8").s("sawtooth")
  .lpf(slider(1200, 200, 4000)).lpq(slider(6, 0, 20))
  .decay(0.15).sustain(0)
  .gain(slider(0.6, 0, 1.2))
`;


const MAX_FIX_ATTEMPTS = 2;
const HISTORY_LIMIT = 8; // messages kept for context (current code is re-sent every turn anyway)
const OMITTED = '// [older version omitted — always edit the CURRENT CODE]';
/**
 * History as sent to the model: earlier replies keep their wording and a code block (so the
 * model keeps answering in that format) but NOT their old code — otherwise models copy their
 * previous program and ignore manual edits made since.
 */
function historyForModel() {
  return state.history.slice(-HISTORY_LIMIT).map((m) =>
    m.role === 'assistant'
      ? { ...m, content: m.content.replace(/```[a-zA-Z]*\n[\s\S]*?(```|$)/g, '```javascript\n' + OMITTED + '\n```') }
      : m,
  );
}
const normCode = (c) => (c || '').replace(/\s+/g, ' ').trim();
const STORE_KEY = 'strudel-ai:v1';

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
const load = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } };
const save = (patch) => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...load(), ...patch })); } catch {} };
const saved = load();

const state = {
  history: [],   // chat history sent to the LLM
  versions: [],  // undo stack of code
  busy: false,
  abort: null,
  config: null,
  pending: null, // { at, label, old, oldCode, recEv } — a switch armed for a future cycle
};

// Recorder: every code switch that actually plays, with the cycle it takes effect on.
// A "take" starts when playback starts and ends when it stops. Shared links can carry
// the take so the whole song (AI-generated blocks, edits, mutes, fader moves) replays exactly.
const rec = { take: null, last: null };
// Live mode: hand edits in the editor are evaluated as you type
const live = { seen: null, changedAt: 0, applied: null, failed: false };
// True while the visualizer queries the playing pattern (must not trigger switch side effects)
let vizQuerying = false;

// ---------------------------------------------------------------------------
// Strudel editor
// ---------------------------------------------------------------------------
const replEl = document.createElement('strudel-editor');
replEl.setAttribute('code', saved.code || INITIAL_CODE);
$('editor-wrap').appendChild(replEl);
const mirror = () => replEl.editor; // StrudelMirror
const scheduler = () => mirror()?.repl?.scheduler;

let lastReplState = {};
replEl.addEventListener('update', (e) => {
  lastReplState = e.detail;
  const err = e.detail.error;
  const bar = $('error-bar');
  if (err) { bar.hidden = false; bar.textContent = '⚠ ' + (err.message || String(err)); }
  else bar.hidden = true;
  if (e.detail.code !== undefined) save({ code: e.detail.code });
});

const getCode = () => mirror()?.code ?? replEl.getAttribute('code') ?? '';
const isPlaying = () => !!scheduler()?.started;
const nowCycle = () => scheduler()?.now() ?? 0;
const cps = () => scheduler()?.cps ?? 0.5;

// ---------------------------------------------------------------------------
// Autocomplete: Strudel's own completions (every function with its docs and
// examples, chord symbols). Its sound / bank / scale lists are empty in this
// build, so we add a source for those, fed by the sounds actually loaded and
// scales.json. The extra source is slipped into the autocompletion config when
// Strudel enables it (the CodeMirror classes aren't exposed to us directly).
// ---------------------------------------------------------------------------
function moreCompletions(context) {
  const reg = globalThis.soundMap?.get?.() || {};
  const keys = Object.keys(reg);
  const words = (re) => context.matchBefore(re);
  const tail = (m) => (m.text.match(/[\w:#-]*$/) || [''])[0];
  let m = words(/(?:^|[^\w$.])(?:s|sound)\(\s*["'`][^"'`]*$/) || words(/\.(?:s|sound)\(\s*["'`][^"'`]*$/);
  if (m) {
    const frag = tail(m);
    const names = keys.filter((k) => !/_(?!.*_)/.test(k) || k.startsWith('gm_') || reg[k].data?.type !== 'sample');
    const drums = new Set();
    for (const k of keys) { const i = k.lastIndexOf('_'); if (i > 0 && !k.startsWith('gm_') && reg[k].data?.type === 'sample') drums.add(k.slice(i + 1)); }
    const type = (k) => ({ synth: 'synth', soundfont: 'soundfont', sample: 'sample' })[reg[k]?.data?.type] || 'sound';
    return {
      from: m.to - frag.length,
      options: [...names.map((k) => ({ label: k, type: 'text', detail: type(k) })), ...[...drums].filter((d) => !reg[d]).map((d) => ({ label: d, type: 'text', detail: 'drum (use with .bank)' }))],
      validFor: /^[\w-]*$/,
    };
  }
  m = words(/\.bank\(\s*["'`][^"'`]*$/);
  if (m) {
    const frag = tail(m);
    const count = {};
    for (const k of keys) { const i = k.lastIndexOf('_'); if (i > 0 && !k.startsWith('gm_') && reg[k].data?.type === 'sample') count[k.slice(0, i)] = (count[k.slice(0, i)] || 0) + 1; }
    return { from: m.to - frag.length, options: Object.keys(count).filter((b) => count[b] >= 3).map((b) => ({ label: pretty(b), type: 'text', detail: 'drum machine' })), validFor: /^[\w-]*$/ };
  }
  m = words(/\.scale\(\s*["'`][^"'`]*$/);
  if (m && SCALES) {
    const t = (m.text.match(/[A-Ga-g][#b]?\d?:[\w:]*$/) || [''])[0];
    if (!t) return null;
    const colon = t.indexOf(':');
    return {
      from: m.to - (t.length - colon - 1),
      options: SCALES.map(([name]) => ({ label: colonScale(name), type: 'text', detail: 'scale' })),
      validFor: /^[\w:]*$/,
    };
  }
  return null;
}

/** Add moreCompletions to every autocompletion config found in a transaction's effects. */
function injectCompletionSource(effects) {
  const seen = new Set();
  const walk = (x, depth) => {
    if (!x || typeof x !== 'object' || seen.has(x) || depth > 8) return;
    seen.add(x);
    if (Array.isArray(x.override) && x.override.some((f) => typeof f === 'function') && !x.override.includes(moreCompletions)) {
      x.override.push(moreCompletions);
    }
    for (const v of Array.isArray(x) ? x : Object.values(x)) walk(v, depth + 1);
  };
  walk(effects, 0);
}

function setAutocomplete(on) {
  const m = mirror();
  const view = m?.editor;
  if (!m?.setAutocompletionEnabled || !view) return false;
  const own = Object.prototype.hasOwnProperty.call(view, 'dispatch');
  const dispatch = view.dispatch;
  view.dispatch = function (...args) {
    try { for (const a of args) injectCompletionSource(a?.effects); } catch {}
    return dispatch.apply(view, args);
  };
  try { m.setAutocompletionEnabled(on); } finally { if (own) view.dispatch = dispatch; else delete view.dispatch; }
  return true;
}
if (saved.autoComplete !== undefined) $('autoComplete').checked = saved.autoComplete;
$('autoComplete').onchange = () => { save({ autoComplete: $('autoComplete').checked }); setAutocomplete($('autoComplete').checked); };
(function waitForEditor(n = 0) {
  if (setAutocomplete($('autoComplete').checked) || n > 100) return;
  setTimeout(() => waitForEditor(n + 1), 200);
})();

// ---------------------------------------------------------------------------
// Quantized switching
//
// The new code is evaluated right away (so errors show immediately), but the
// scheduler gets a *spliced* pattern: haps that start before cycle `at` come
// from the old pattern, haps from `at` onwards from the new one. Tempo changes
// (setcpm/setcps) in the new code are deferred until the switch too.
// The result is a sample-accurate switch exactly on the bar line.
// ---------------------------------------------------------------------------
//
// Crossfade: with fade > 0 both patterns play during [at - fade, at). The old one's
// notes fade out and the new one's fade in (equal power, by note velocity), so the
// new section arrives on the downbeat at full level. Notes both patterns play at the
// same moment (same sound, same pitch) are played once, at full level, so a groove
// shared by both sections doesn't dip.
function splice(oldPat, newPat, at, onCross, fade = 0) {
  const Pattern = newPat.constructor;
  const start = (h) => (h.whole || h.part).begin.valueOf();
  const from = at - fade;
  const inFade = (h) => fade > 0 && start(h) >= from && start(h) < at;
  const pos = (h) => Math.min(1, Math.max(0, (start(h) - from) / fade));
  const key = (h) => {
    const v = h.value;
    return v && typeof v === 'object' ? `${start(h)}|${v.s}|${v.bank}|${v.note}|${v.n}|${v.freq}` : `${start(h)}|${v}`;
  };
  const scale = (h, k) => h.withValue((v) => (v && typeof v === 'object' ? { ...v, velocity: (v.velocity ?? 1) * k } : v));
  let crossed = false;
  return new Pattern((st) => {
    const b = st.span.begin.valueOf();
    const e = st.span.end.valueOf();
    if (e > at && !crossed && !vizQuerying) { crossed = true; onCross?.(); }
    if (e <= from) return oldPat.query(st);
    if (b >= at) return newPat.query(st);
    const olds = oldPat.query(st).filter((h) => start(h) < at);
    const news = newPat.query(st).filter((h) => start(h) >= from);
    const newKeys = new Set(news.filter(inFade).map(key));
    const shared = new Set();
    const out = [];
    for (const h of olds) {
      if (!inFade(h)) { out.push(h); continue; }
      const k = key(h);
      if (newKeys.has(k)) { shared.add(k); out.push(h); continue; }
      out.push(scale(h, Math.cos((pos(h) * Math.PI) / 2)));
    }
    for (const h of news) {
      if (!inFade(h)) { if (start(h) >= at) out.push(h); continue; }
      if (shared.has(key(h))) continue;
      out.push(scale(h, Math.sin((pos(h) * Math.PI) / 2)));
    }
    return out;
  });
}

/** Next cycle that is a multiple of `every`, leaving enough time to evaluate. */
function nextBoundary(every) {
  const s = scheduler();
  const leadCycles = 0.06 * cps(); // ~60 ms: time to evaluate + one scheduler tick
  const ahead = Math.max(s.lastEnd ?? 0, nowCycle()) + leadCycles;
  return Math.ceil(ahead / every - 1e-9) * every;
}

/**
 * Query the new pattern a few cycles ahead *without playing it*. Many Strudel
 * errors (bad scale names, bad chord symbols, "can only use X after Y", …)
 * only happen when notes are generated, not when the code is evaluated.
 */
let inDryRun = false;
const recentDryRunErrors = new Map(); // message → time, to avoid reporting the same error twice
function dryRun(pat) {
  const c = Math.floor(nowCycle());
  const logged = [];
  const onLog = (e) => {
    const msg = String(e.detail?.message || '');
    if (e.detail?.type === 'error' || /\berror\b/i.test(msg)) logged.push(msg.replace(/^\[\w+\] error: /, ''));
  };
  // Strudel's logger drops a message identical to the previous one within 1 s — log a marker so real errors get through
  try { globalThis.logger?.('[strudel-ai] test-playing new code…'); } catch {}
  document.addEventListener('strudel.log', onLog);
  inDryRun = true;
  try {
    for (const [a, b] of [[c, c + 8], [0, 2]]) {
      for (const h of pat.queryArc(a, b)) {
        const v = h.value;
        if (v && typeof v === 'object') {
          if (typeof v.note === 'number' && !Number.isFinite(v.note)) throw new Error(`invalid note value (NaN) in "${v.s ?? ''}" part`);
          if (typeof v.note === 'string' && /undefined|NaN/.test(v.note)) throw new Error(`invalid note "${v.note}"`);
        }
      }
    }
    if (logged.length) for (const m of logged) recentDryRunErrors.set(m, performance.now());
    return logged.length ? new Error([...new Set(logged)].join('; ')) : null;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  } finally {
    inDryRun = false;
    document.removeEventListener('strudel.log', onLog);
  }
}

/**
 * Evaluate `code`. at === null → immediately. Otherwise switch exactly at cycle `at`.
 * The new pattern is test-queried first; if that fails, the old music keeps playing.
 * Returns the error (or null).
 */
async function evaluateCode(code, { at = null, label = '', undo = true, fade = 0 } = {}) {
  const m = mirror();
  if (!m) return new Error('editor not ready');
  const sch = m.repl.scheduler;
  const prevCode = getCode();
  if (undo && prevCode.trim() !== code.trim()) {
    state.versions.push(prevCode);
    $('undo').disabled = false;
  }
  m.setCode(code);
  live.applied = code;

  const immediate = at === null || !sch.started || !sch.pattern;
  const old = sch.pattern;
  const proto = Object.getPrototypeOf(sch);
  const wasStarted = sch.started;
  const hadOwnSet = Object.prototype.hasOwnProperty.call(sch, 'setPattern');
  const ownSet = sch.setPattern; // the recorder's hook (restored afterwards)
  let captured = null, autostart = true, deferredCps = null;
  sch.setCps = (c) => { deferredCps = c; };
  sch.setPattern = async (pat, auto) => {
    captured = pat;
    autostart = auto;
    // the editor's highlighter queries scheduler.pattern after evaluating – give it something harmless
    if (!sch.pattern) sch.pattern = new pat.constructor(() => []);
  };
  try {
    await m.evaluate();
  } finally {
    delete sch.setCps;
    if (hadOwnSet) sch.setPattern = ownSet; else delete sch.setPattern;
  }
  const evalErr = m.repl.state.evalError;
  if (evalErr) return evalErr;
  if (!captured) return null;

  const runErr = dryRun(captured);
  if (runErr) {
    const bar = $('error-bar');
    bar.hidden = false;
    bar.textContent = '⚠ not applied (old code keeps playing): ' + runErr.message;
    return runErr;
  }

  if (immediate) {
    cancelPending(false);
    const c = wasStarted ? switchCycle(sch) : 0;
    if (deferredCps != null) proto.setCps.call(sch, deferredCps);
    await proto.setPattern.call(sch, captured, autostart);
    recordSwitch(code, c, label);
    return null;
  }
  // only fade over what hasn't been scheduled yet
  const f = Math.max(0, Math.min(fade, at - switchCycle(sch) - 0.03));
  await proto.setPattern.call(
    sch,
    splice(old, captured, at, () => {
      if (deferredCps != null) setTimeout(() => proto.setCps.call(sch, deferredCps));
      if (state.pending?.at === at) setTimeout(() => { state.pending = null; });
    }, f),
    autostart,
  );
  state.pending = { at, label, old, oldCode: prevCode, recEv: recordSwitch(code, at, label, f) };
  return null;
}

/** Undo an armed switch that has not happened yet. */
function cancelPending(restore = true) {
  const p = state.pending;
  state.pending = null;
  if (!p) return;
  const sch = scheduler();
  const notYet = sch && Math.max(sch.lastEnd ?? 0, nowCycle()) < p.at;
  // the armed code never plays → it isn't part of the recording
  if (notYet && p.recEv && rec.take) rec.take.events = rec.take.events.filter((ev) => ev !== p.recEv);
  if (!restore) return;
  if (sch && nowCycle() < p.at) {
    Object.getPrototypeOf(sch).setPattern.call(sch, p.old);
    mirror().setCode(p.oldCode);
    state.versions.pop();
    $('undo').disabled = state.versions.length === 0;
  }
}

const quantize = () => Number($('quantize').value);
/** Crossfade length in cycles for bar-line switches (0 = hard cut). */
const fadeCycles = () => Number($('fade').value);

/** Apply code using the current quantize setting. */
function applyQuantized(code, label) {
  const q = quantize();
  const at = q > 0 && isPlaying() ? nextBoundary(q) : null;
  return evaluateCode(code, { at, label, fade: fadeCycles() });
}

$('play').onclick = async () => {
  cancelPending(false);
  const err = await evaluateCode(getCode());
  if (err) addMsg('error', `Not applied: ${err.message}`);
};
$('stop').onclick = () => { stopReplay(); cancelPending(false); stopSet?.(); stopSetlist(); mirror()?.stop(); if (upd.available) setTimeout(reloadForUpdate, 300); };
$('undo').onclick = async () => {
  cancelPending(false);
  const prev = state.versions.pop();
  if (prev === undefined) return;
  mirror().setCode(prev);
  $('undo').disabled = state.versions.length === 0;
  await mirror().evaluate();
  addMsg('info', '↶ reverted to previous version');
};
$('quantize').value = saved.quantize ?? '4';
$('quantize').onchange = () => save({ quantize: $('quantize').value });
$('fade').value = saved.fade ?? '0.5';
$('fade').onchange = () => save({ fade: $('fade').value });

// Header clock: cycle / bar counter + countdown to armed switch
setInterval(() => {
  const st = $('status');
  const err = lastReplState.error;
  if (!isPlaying()) {
    st.textContent = err ? 'error' : 'stopped';
    st.className = 'status ' + (err ? 'error' : '');
  } else {
    const c = nowCycle();
    const bar = Math.floor(c) + 1;
    const beat = Math.floor((c % 1) * 4) + 1;
    st.textContent = `bar ${bar}.${beat}  ${Math.round(cps() * 240)}bpm`;
    st.className = 'status ' + (err ? 'error' : 'playing');
  }
  const p = state.pending;
  const pb = $('pending');
  if (p && isPlaying() && nowCycle() < p.at) {
    const secs = Math.max(0, (p.at - nowCycle()) / cps());
    pb.hidden = false;
    pb.textContent = `⏱ ${p.label || 'next change'} at ${barBeat(p.at)} (${secs.toFixed(1)}s)`;
  } else pb.hidden = true;
  updateStepStates();
}, 100);
$('pending').onclick = () => { cancelPending(true); addMsg('info', 'pending change cancelled'); };

// ---------------------------------------------------------------------------
// Recorder: each take is the list of code switches with the cycle each one took
// effect on. Replaying a take (e.g. from a share link) re-applies every switch on
// exactly the same cycle, starting from cycle 0 like the original, so Strudel's
// cycle-based randomness comes out the same too.
// ---------------------------------------------------------------------------
/** Cycle from which a pattern set right now is heard (haps up to lastEnd are already scheduled). */
function switchCycle(sch = scheduler()) {
  return Math.max(sch?.lastEnd ?? 0, nowCycle());
}

const MAX_TAKE_EVENTS = 3000;
function recordSwitch(code, cycle, label = '', fade = 0) {
  if (!isPlaying() || !code?.trim()) return null;
  if (!rec.take) rec.take = { events: [], started: Date.now(), end: 0 };
  const evs = rec.take.events;
  if (evs.length >= MAX_TAKE_EVENTS) return null;
  const ev = { c: Math.round(cycle * 1e6) / 1e6, code, label: String(label || '').slice(0, 80), fade: fade || 0 };
  // keep time order: an armed switch can be recorded before an earlier immediate one
  let k = evs.length;
  while (k > 0 && evs[k - 1].c > ev.c) k--;
  if (k > 0 && evs[k - 1].code === code) return null; // re-evaluating the same code changes nothing
  evs.splice(k, 0, ev);
  return ev;
}

/** Ctrl+Enter, ↶ Undo and Strudel's own buttons set the pattern directly — record those too. */
function installRecorderHook() {
  const sch = scheduler();
  if (!sch || sch.__recHook) return;
  sch.__recHook = true;
  const proto = Object.getPrototypeOf(sch);
  sch.setPattern = async function (pat, auto) {
    const c = this.started ? switchCycle(this) : 0;
    const r = await proto.setPattern.call(this, pat, auto);
    live.applied = getCode();
    recordSwitch(getCode(), c, 'edit');
    return r;
  };
}

/** Fader moves: compare code with the slider values blanked out. */
const sliderless = (c) => (c || '').replace(/slider\(\s*[\d.]+/g, 'slider(');

function pollEditor() {
  installRecorderHook();
  const code = getCode();
  const t = performance.now();
  if (code !== live.seen) { live.seen = code; live.changedAt = t; }
  if (!isPlaying()) {
    if (rec.take) { if (rec.take.events.length) rec.last = rec.take; rec.take = null; }
    return;
  }
  if (rec.take) rec.take.end = Math.max(rec.take.end, nowCycle());

  // dragging a fader rewrites its number in the code without re-evaluating → record as a tweak
  const lastEv = rec.take?.events[rec.take.events.length - 1];
  if (lastEv && !state.pending && code !== lastEv.code && sliderless(code) === sliderless(lastEv.code)) {
    const c = nowCycle();
    if (lastEv.label === 'fader' && c - lastEv.c < 0.25) lastEv.code = code; // coalesce a drag
    else recordSwitch(code, c, 'fader');
    live.applied = code;
  }

  // live mode: evaluate hand edits shortly after you stop typing
  if (!$('liveMode').checked || state.pending || t - live.changedAt < 400) return;
  if (live.applied === null) { live.applied = code; return; }
  if (code === live.applied) return;
  if (sliderless(code) === sliderless(live.applied)) { live.applied = code; return; } // faders are live already
  live.applied = code;
  const bad = syntaxError(code);
  if (bad) { setLiveState(`syntax error — keeps playing the last good version: ${bad}`); return; }
  live.evalAt = t;
  evaluateCode(code, { label: 'live edit', undo: false }).then((err) => setLiveState(err ? err.message : null));
}
setInterval(pollEditor, 150);

function setLiveState(err) {
  const l = $('liveLabel');
  l.classList.toggle('bad', !!err);
  l.title = err ? `Live update: ${err}` : 'Live update: edits in the code window take effect as soon as you stop typing';
}
if (saved.liveMode !== undefined) $('liveMode').checked = saved.liveMode;
$('liveMode').onchange = () => {
  save({ liveMode: $('liveMode').checked });
  live.applied = getCode(); // only edits made from now on
  setLiveState(null);
};

/** The current (or last) take in the compact share format: unique codes + timed events. */
function recordingForShare() {
  const take = rec.take?.events.length ? rec.take : rec.last;
  if (!take?.events.length) return null;
  const c0 = take.events[0].c;
  const codes = [], index = new Map();
  const events = take.events.map((ev) => {
    let i = index.get(ev.code);
    if (i === undefined) { i = codes.push(ev.code) - 1; index.set(ev.code, i); }
    return { c: Math.round((ev.c - c0) * 1e6) / 1e6, i, label: ev.label, ...(ev.fade ? { f: ev.fade } : {}) };
  });
  return { v: 1, codes, events, end: Math.max(0, Math.round((take.end - c0) * 1e3) / 1e3) };
}
/** Expand a shared recording back into { events: [{c, code, label}], end }, or null if malformed. */
function decodeRecording(r) {
  if (!r || !Array.isArray(r.codes) || !Array.isArray(r.events) || !r.events.length) return null;
  const events = r.events
    .filter((ev) => Number.isFinite(ev.c) && typeof r.codes[ev.i] === 'string')
    .map((ev) => ({ c: ev.c, code: r.codes[ev.i], label: String(ev.label || ''), fade: Number(ev.f) || 0 }))
    .sort((a, b) => a.c - b.c);
  return events.length ? { events, end: Number(r.end) || events[events.length - 1].c } : null;
}
const fmtTime = (secs) => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`;
/** Rough length of a take in seconds (uses each switch's tempo). */
function takeSeconds(take) {
  let secs = 0;
  const evs = take.events;
  for (let k = 0; k < evs.length; k++) {
    const from = evs[k].c, to = k + 1 < evs.length ? evs[k + 1].c : Math.max(take.end, from);
    secs += (to - from) / codeCps(evs[k].code);
  }
  return secs;
}
function codeCps(code) {
  const m = code.match(/setcp([ms])\(\s*([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)/);
  if (!m) return cps() || 0.5;
  const v = Number(m[2]) / (m[3] ? Number(m[3]) : 1);
  return (m[1] === 'm' ? v / 60 : v) || 0.5;
}

// --- replay
const replay = { running: false, events: [], i: 0, end: 0, timer: null, title: '' };

async function startReplay(take, title = '') {
  if (!take?.events.length) return;
  stopReplay();
  stopSet?.();
  stopSetlist();
  cancelPending(false);
  // start from cycle 0 like the original take, so every switch lands on the same cycle
  if (isPlaying()) { mirror()?.stop(); await new Promise((r) => setTimeout(r, 200)); }
  addMsg('info', `⏺ replaying ${title ? `“${title}” ` : ''}— ${take.events.length} change${take.events.length > 1 ? 's' : ''}, ${fmtTime(takeSeconds(take))}`);
  await preloadSoundfonts(take.events.map((ev) => ev.code).join('\n')).catch(() => {});
  Object.assign(replay, { running: true, events: take.events, i: 1, end: take.end, title });
  const err = await evaluateCode(take.events[0].code, { label: 'replay' });
  if (err) { addMsg('error', `Replay failed: ${err.message}`); replay.running = false; return; }
  replay.timer = setInterval(tickReplay, 50);
  $('replayBtn').hidden = false;
}

function tickReplay() {
  if (!replay.running || replay.busy) return;
  if (!isPlaying()) { stopReplay(); addMsg('info', '■ replay stopped'); return; }
  const now = nowCycle();
  const ev = replay.events[replay.i];
  if (!ev) {
    if (now >= replay.end) {
      stopReplay();
      mirror()?.stop();
      addMsg('info', `■ replay finished${replay.title ? ` — “${replay.title}”` : ''}`);
    }
    return;
  }
  if ((ev.c - (ev.fade || 0) - now) / cps() > 1) return; // arm about a second before the change (or its crossfade)
  replay.busy = true;
  const at = Math.max(ev.c, switchCycle() + 0.06 * cps());
  evaluateCode(ev.code, { at, label: `replay ${replay.i + 1}/${replay.events.length}`, undo: false, fade: ev.fade || 0 })
    .then((err) => { if (err) addMsg('error', `Replay: change ${replay.i + 1} failed: ${err.message}`); })
    .finally(() => { replay.i++; replay.busy = false; });
}

function stopReplay() {
  if (!replay.running) return;
  replay.running = false;
  clearInterval(replay.timer);
  $('replayBtn').hidden = true;
}
$('replayBtn').onclick = () => { stopReplay(); addMsg('info', '■ replay stopped — the music keeps playing'); };

// ---------------------------------------------------------------------------
// Provider / model selection
// ---------------------------------------------------------------------------
async function loadConfig() {
  state.config = await fetch('/api/config').then((r) => r.json());
  const sel = $('provider');
  sel.innerHTML = '';
  for (const [key, p] of Object.entries(state.config.providers)) sel.add(new Option(p.label, key));
  sel.value = saved.provider && state.config.providers[saved.provider] ? saved.provider : state.config.defaultProvider;
  await loadModels();
}

async function loadModels() {
  const provider = $('provider').value;
  const pcfg = state.config.providers[provider];
  const sel = $('model');
  sel.innerHTML = '<option>loading…</option>';
  try {
    const r = await fetch(`/api/models?provider=${provider}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    sel.innerHTML = '';
    if (!j.models.length) sel.add(new Option('(default)', ''));
    for (const m of j.models) sel.add(new Option(m.name, m.id));
    const want = load().models?.[provider] || pcfg.defaultModel;
    if (want && j.models.some((m) => m.id === want)) sel.value = want;
  } catch (e) {
    sel.innerHTML = '';
    sel.add(new Option(pcfg.defaultModel || '(default)', pcfg.defaultModel || ''));
    addMsg('error', `Model list unavailable: ${e.message}`);
  }
}

$('provider').onchange = () => { save({ provider: $('provider').value }); loadModels(); };
$('model').onchange = () => save({ models: { ...(load().models || {}), [$('provider').value]: $('model').value } });
$('refresh').onclick = loadModels;

for (const id of ['autoApply', 'autoFix']) {
  if (saved[id] !== undefined) $(id).checked = saved[id];
  $(id).onchange = () => save({ [id]: $(id).checked });
}
if (saved.temp !== undefined) $('temp').value = saved.temp;
$('tempVal').textContent = $('temp').value;
$('temp').oninput = () => { $('tempVal').textContent = $('temp').value; save({ temp: $('temp').value }); };

// Tabs
for (const btn of document.querySelectorAll('.tabs button')) {
  btn.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab').forEach((t) => (t.hidden = t.id !== btn.dataset.tab));
    save({ tab: btn.dataset.tab });
  };
}
if (saved.tab) document.querySelector(`.tabs button[data-tab="${saved.tab}"]`)?.click();

// ---------------------------------------------------------------------------
// Chat rendering
// ---------------------------------------------------------------------------
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function renderMarkdownLite(text) {
  return text
    .split(/```[a-zA-Z]*\n?/)
    .map((p, i) => (i % 2 ? `<pre>${esc(p.replace(/\n$/, ''))}</pre>` : esc(p).replace(/\n/g, '<br>')))
    .join('');
}

function addMsg(role, html, { raw = false } = {}) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  if (raw) div.innerHTML = html; else div.textContent = html;
  $('messages').appendChild(div);
  scrollChat();
  return div;
}
const scrollChat = () => { const m = $('messages'); m.scrollTop = m.scrollHeight; };

$('clearChat').onclick = () => {
  state.history = [];
  $('messages').querySelectorAll('.msg:not(.system)').forEach((n) => n.remove());
};

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------
const stripThinking = (t) => t.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim();

const CODE_LINE = /^\s*(\$:|_\$:|setcp[ms]\(|stack\(|s\(|sound\(|note\(|n\(|chord\(|samples\(|\.|\/\/|\)|let |const )/;

function extractCode(text) {
  // never treat the history placeholder as code
  const clean = stripThinking(text).replace(/```[a-zA-Z]*\n\s*\/\/ \[older version omitted[^\n]*\n```/g, '');
  const blocks = [...clean.matchAll(/```(?:javascript|js|strudel)?[^\n]*\n([\s\S]*?)```/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  if (blocks.length) return blocks[blocks.length - 1];
  const open = clean.match(/```(?:javascript|js|strudel)?[^\n]*\n([\s\S]+)$/);
  if (open && open[1].trim()) return open[1].trim();
  const lines = clean.split('\n').filter((l) => l.trim());
  const codeLines = lines.filter((l) => CODE_LINE.test(l));
  if (codeLines.length >= 1 && codeLines.length >= lines.length - 1) {
    return lines.filter((l) => CODE_LINE.test(l) || /^\s/.test(l)).join('\n').trim();
  }
  return null;
}

/** Cheap syntax check ("$:" lines are valid JS labels). Returns error message or null. */
function syntaxError(code) {
  try { new Function(code); return null; } catch (e) { return e.message; }
}

/**
 * Stream a completion. onUpdate({content, thinking}) is called as tokens arrive.
 * mode: 'code' (edit the given code) | 'setlist' (write a setlist)
 */
async function requestLLM({ messages, code = '', mode = 'code', onUpdate, signal, edited = false }) {
  const sounds = await soundCatalog().catch(() => '');
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: $('provider').value,
      model: $('model').value,
      messages,
      code,
      mode,
      edited,
      sounds,
      temperature: Number($('temp').value),
    }),
    signal,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `HTTP ${res.status}`);
  }
  let content = '', thinking = '';
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    const j = await res.json();
    content = j.choices?.[0]?.message?.content || '';
    onUpdate?.({ content, thinking });
    return content;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith('data:')) continue;
      const data = l.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let j;
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
      const d = j.choices?.[0]?.delta || j.choices?.[0]?.message || {};
      if (d.reasoning_content || d.reasoning) thinking += d.reasoning_content || d.reasoning;
      if (d.content) content += d.content;
    }
    onUpdate?.({ content, thinking });
  }
  return content;
}

/** Render a streaming reply into a chat bubble. */
function bubbleRenderer(bubble) {
  const contentEl = document.createElement('div');
  contentEl.className = 'typing';
  bubble.appendChild(contentEl);
  let thinkEl = null;
  return {
    update({ content, thinking }) {
      if (thinking) {
        if (!thinkEl) {
          thinkEl = document.createElement('details');
          thinkEl.innerHTML = '<summary>thinking…</summary><div></div>';
          bubble.insertBefore(thinkEl, contentEl);
        }
        thinkEl.querySelector('div').textContent = thinking;
      }
      contentEl.innerHTML = renderMarkdownLite(content);
      scrollChat();
    },
    done() {
      contentEl.classList.remove('typing');
      if (thinkEl) thinkEl.querySelector('summary').textContent = 'reasoning';
    },
  };
}

// ---------------------------------------------------------------------------
// Sound registry: validate / auto-correct instrument names against what is
// actually loaded, preload soundfonts, and tell the LLM the real names.
// ---------------------------------------------------------------------------
const SOUNDFONT_URL = 'https://felixroos.github.io/webaudiofontdata/sound';

async function soundRegistry() {
  try { await mirror()?.prebaked; } catch {}
  await installSoundfontGuard();
  const m = globalThis.soundMap?.get?.();
  return m && Object.keys(m).length ? m : null;
}

// registry keys are lowercase; show well-known banks in their usual spelling
const pretty = (b) => b.replace(/^roland/, 'Roland').replace(/tr(\d)/, 'TR$1').replace(/^linn/, 'Linn');

let catalogCache = null;
async function soundCatalog() {
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

function levenshtein(a, b) {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
const normName = (s) => s.toLowerCase().replace(/(^|\D)0+(\d)/g, '$1$2').replace(/[_\s-]/g, '');

function closest(name, candidates) {
  const n = normName(name);
  const exact = candidates.find((c) => normName(c) === n);
  if (exact) return { best: exact, dist: 0, top: [exact] };
  const scored = candidates
    .map((c) => ({ c, d: levenshtein(name.toLowerCase(), c) }))
    .sort((x, y) => x.d - y.d);
  return { best: scored[0]?.c, dist: scored[0]?.d ?? 99, top: scored.slice(0, 4).map((x) => x.c) };
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
async function checkSounds(code) {
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
function toMidi(value) {
  if (value.freq) return 12 * Math.log2(value.freq / 440) + 69;
  const note = value.note ?? 'c3';
  if (typeof note === 'number') return note;
  const m = String(note).trim().match(/^([a-gA-G])([#sbf]*)(-?\d+)?$/);
  if (!m) return NaN;
  const acc = [...m[2]].reduce((a, c) => a + (c === '#' || c === 's' ? 1 : -1), 0);
  return NOTE_BASE[m[1].toLowerCase()] + acc + (m[3] !== undefined ? +m[3] + 1 : 4) * 12;
}

const transposeLog = new Set();
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
async function preloadSoundfonts(code) {
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


// ---------------------------------------------------------------------------
// Scale names: Strudel wants "Tonic:name" with spaces in the name replaced by
// colons, e.g. .scale("C:minor:pentatonic"). Models often write
// "C:minorpentatonic", "C minor pentatonic" or "C:pentatonic minor".
// ---------------------------------------------------------------------------
let SCALES = null; // [[name, ...aliases], ...]
const scalesReady = fetch('/scales.json').then((r) => r.json()).then((j) => (SCALES = j)).catch(() => (SCALES = []));
const normScale = (s) => s.toLowerCase().replace(/[\s:_-]+/g, '');
let scaleIndex = null;
function getScaleIndex() {
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
const colonScale = (name) => name.replace(/ /g, ':');
const TONIC = /^[a-gA-G](?:#|b|s|f)*-?\d*$/;

/** Returns canonical scale name for a (possibly wrong) name, or null. */
function matchScale(raw) {
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
function fixScaleString(str) {
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

async function checkScales(code) {
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

function scaleHelp() {
  const names = (SCALES || []).map(([n]) => colonScale(n));
  return 'Scale format: .scale("C:minor:pentatonic") — tonic, colon, then the scale name with spaces replaced by colons. ' +
    'Valid scale names: ' + names.join(', ') + '.';
}


// ---------------------------------------------------------------------------
// Sliders: every gain / group postgain gets a live fader; slider() arguments must be
// plain non-negative numbers (Strudel's transpiler ignores anything else).
// ---------------------------------------------------------------------------
function ensureSliders(code) {
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
async function prepareCode(code, { quiet = false } = {}) {
  const sl = ensureSliders(code);
  if ((sl.added || sl.fixed) && !quiet) {
    addMsg('info', `🎚 ${[sl.added && `added ${sl.added} gain slider${sl.added > 1 ? 's' : ''}`, sl.fixed && `fixed ${sl.fixed} slider range${sl.fixed > 1 ? 's' : ''}`].filter(Boolean).join(', ')}`);
  }
  code = sl.code;
  const sc = await checkScales(code);
  if (sc.corrections.length && !quiet) {
    addMsg('info', '🔧 fixed scale names: ' + sc.corrections.map(([a, b]) => `${a} → ${b}`).join(', '));
  }
  if (sc.unknown.length) {
    return { code: sc.code, error: `Unknown scale name(s): ${sc.unknown.join(', ')}. ${scaleHelp()}`, corrections: sc.corrections };
  }
  code = sc.code;
  const chk = await checkSounds(code);
  if (chk.corrections.length && !quiet) {
    addMsg('info', '🔧 fixed sound names: ' + chk.corrections.map(([a, b]) => `${a} → ${b}`).join(', '));
  }
  const allCorrections = [...sc.corrections, ...chk.corrections];
  if (chk.unknown.length) return { code: chk.code, error: unknownMessage(chk.unknown), corrections: allCorrections };
  const failed = await preloadSoundfonts(chk.code);
  if (failed.length && !quiet) {
    addMsg('error', `Couldn't download soundfont(s) ${failed.join(', ')} from felixroos.github.io — they will be silent. Check the browser's internet access.`);
  }
  return { code: chk.code, error: null, corrections: allCorrections };
}

// Surface runtime sound errors (e.g. "sound xyz not found", soundfont load failures)
const seenLogs = new Map();
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
  if (live.evalAt && t - live.evalAt < 4000) return; // half-typed live edits: error bar only
  addMsg('error', msg);
});

// ---------------------------------------------------------------------------
// Chat turn
// ---------------------------------------------------------------------------
async function runTurn(userText, attempt = 0) {
  state.history.push({ role: 'user', content: userText });
  const bubble = addMsg('assistant', '', { raw: true });
  const r = bubbleRenderer(bubble);
  const text = await requestLLM({
    messages: historyForModel(),
    code: getCode(),
    edited: state.lastAICode != null && normCode(getCode()) !== normCode(state.lastAICode),
    onUpdate: r.update,
    signal: state.abort.signal,
  });
  r.done();
  let code = extractCode(text);

  if (!code) {
    state.history.pop(); // don't let the model imitate a code-less reply
    if (attempt < MAX_FIX_ATTEMPTS) {
      addMsg('info', 'no code in reply — asking the model again…');
      const base = userText.replace(/\n\nIMPORTANT: your previous reply[\s\S]*$/, '');
      return runTurn(
        base + '\n\nIMPORTANT: your previous reply had no code. Answer with ONE short sentence, then the COMPLETE ' +
          'updated program in a single ```javascript code block.',
        attempt + 1,
      );
    }
    addMsg('error', 'The model did not return any code. Try rephrasing, clearing the chat, or a different model.');
    return;
  }
  const prep = await prepareCode(code);
  code = prep.code;
  let reply = stripThinking(text);
  for (const [a, b] of prep.corrections) reply = reply.split(a).join(b); // don't let the model learn wrong names
  state.history.push({ role: 'assistant', content: reply });
  state.lastAICode = code;

  if (prep.error) {
    addMsg('error', prep.error);
    if (attempt < MAX_FIX_ATTEMPTS) {
      addMsg('info', `asking the model to fix the names (attempt ${attempt + 1}/${MAX_FIX_ATTEMPTS})…`);
      return runTurn(prep.error + ' Return the full corrected program.', attempt + 1);
    }
    return;
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  const now = document.createElement('button');
  now.textContent = '▶ Apply now';
  now.onclick = () => evaluateCode(code);
  const q = document.createElement('button');
  q.textContent = '⏱ Apply on bar';
  q.onclick = () => applyQuantized(code, 'chat change');
  actions.append(now, q);
  bubble.appendChild(actions);

  if (!$('autoApply').checked) return;

  const err = await applyQuantized(code, 'chat change');
  if (!err) {
    addMsg('info', state.pending ? `✓ armed — switching at bar ${state.pending.at + 1}` : '✓ applied & playing');
    return;
  }
  addMsg('error', `Eval error: ${err.message}`);
  if ($('autoFix').checked && attempt < MAX_FIX_ATTEMPTS) {
    addMsg('info', `auto-fixing (attempt ${attempt + 1}/${MAX_FIX_ATTEMPTS})…`);
    await runTurn(
      `The code you returned threw this error when it played:\n${err.message}\n` +
        (/scale/i.test(err.message) ? scaleHelp() + '\n' : '') +
        'Fix it and return the full corrected program. Only use functions from the reference.',
      attempt + 1,
    );
  }
}

function setBusy(b) {
  state.busy = b;
  $('send').textContent = b ? 'Stop' : 'Send';
  $('send').classList.toggle('stop', b);
}

$('chat-form').onsubmit = async (e) => {
  e.preventDefault();
  if (state.busy) { state.abort?.abort(); return; }
  const text = $('input').value.trim();
  if (!text) return;
  $('input').value = '';
  addMsg('user', text);
  setBusy(true);
  state.abort = new AbortController();
  try {
    await runTurn(text);
  } catch (err) {
    if (err.name === 'AbortError') addMsg('info', 'stopped');
    else addMsg('error', err.message);
  } finally {
    setBusy(false);
    $('input').focus();
  }
};

$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('chat-form').requestSubmit();
  }
});


// ---------------------------------------------------------------------------
// Setlist: a list of timed changes. Code for each step is generated ahead of
// time (each step builds on the previous step's code) and each step is
// switched in exactly on its bar.
// ---------------------------------------------------------------------------

const setlist = {
  running: false,
  steps: [],     // { bars, prompt, code, status, error }
  genIndex: 0,   // next step to generate
  playIndex: 0,  // next step to switch in
  nextAt: null,  // cycle at which playIndex should start
  abort: null,
  timer: null,
  generating: false,
  jumpTarget: null, // step index the user picked manually (switches on next boundary)
  feeder: null,     // Set list / Station driving the blocks: { active(), onStepStart(step), onStop(), label }
  pumpToken: 0,     // bumped to restart generation from another block
};

// Added to every block after a song's first one, so sections don't only pile up layers
const SECTION_GUIDE =
  'Follow the section instruction literally. When it says to drop, remove, strip back or take out something, DELETE that ' +
  'group or line from the code (do not just turn it down). A section may remove parts as well as add them: keep about ' +
  '5 groups or fewer, and when you add a part consider taking another one out. When the section calls for a change of ' +
  'energy or feel, switch up the beat: rewrite the drum patterns (kick placement, hat rhythm, swing, half-time, broken ' +
  'beat, fills) instead of only stacking new layers on the same groove.';
const autoAdvance = () => !setlist.hold;

function parseSetlist(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const m = l.match(/^(\d+(?:\.\d+)?)\s*(?:bars?)?\s*[|:,-]\s*(.+)$/i);
      return m ? { bars: Number(m[1]), prompt: m[2].trim() } : { bars: 8, prompt: l };
    })
    .map((s) => ({ ...s, code: null, status: 'waiting', error: null }));
}

async function generateStep(i) {
  const step = setlist.steps[i];
  if (step.song?.library && step.section) {
    // a section of a sheet song: fix the shared parts, then it is re-arranged
    step.status = 'generating';
    await repairSong(step.song, step.fixHint || step.error || 'it failed when played');
    delete step.fixHint;
    if (!step.code) throw new Error('could not fix the parts');
    step.status = 'ready';
    return;
  }
  const base = (i > 0 && setlist.steps[i - 1].code) || getCode();
  step.status = 'generating';
  let prompt;
  if (step.song) {
    const sg = step.song;
    prompt = step.songStart
      ? `NEW SONG "${sg.title}": ${sg.desc}\n` +
        'This block STARTS a new song. Write a fresh arrangement for it — its own tempo (setcpm), key, groups and sounds. ' +
        'Do not keep the previous song\'s parts (a smooth transition is fine). Use named groups and slider() faders as usual.\n' +
        `First section (${step.bars} bars): ${step.prompt}`
      : `Song "${sg.title}" (${sg.desc})\nNext section, ${step.bars} bars (section ${step.songPos + 1} of ${step.songLen}): ${step.prompt}\n\n${SECTION_GUIDE}`;
  } else {
    prompt = `${step.prompt}\n(This section lasts ${step.bars} bars. It is step ${i + 1} of ${setlist.steps.length} in a planned set.)` +
      (i > 0 ? `\n\n${SECTION_GUIDE}` : '');
  }
  if (step.fixHint) {
    prompt += `\n\nIMPORTANT: a previous version failed when played: ${step.fixHint}` +
      (/scale/i.test(step.fixHint) ? `\n${scaleHelp()}` : '');
    delete step.fixHint;
  }
  for (let attempt = 0; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
    const text = await requestLLM({
      messages: [{ role: 'user', content: prompt }],
      code: base,
      signal: step.abort.signal,
    });
    let code = extractCode(text);
    let err = code ? syntaxError(code) : 'no code block in reply';
    if (!err) {
      const prep = await prepareCode(code, { quiet: true });
      code = prep.code;
      err = prep.error;
    }
    if (!err) {
      step.code = code;
      step.status = 'ready';
      return;
    }
    prompt = `${step.prompt}\n\nIMPORTANT: a previous attempt failed (${err}). Return the COMPLETE, syntactically valid program in one \`\`\`javascript block.`;
  }
  step.status = 'failed';
  step.error = 'could not get valid code';
}

/** Generate step i once (shared promise), falling back to the previous code on failure. */
function ensureGenerated(i) {
  const step = setlist.steps[i];
  if (!step) return Promise.resolve();
  if (step.code) return Promise.resolve();
  if (!step.genPromise) {
    // own abort controller, so skipping past this block can cancel just this request
    step.abort = new AbortController();
    const all = setlist.abort?.signal;
    if (all?.aborted) step.abort.abort();
    else all?.addEventListener('abort', () => step.abort.abort(), { once: true });
    step.genPromise = generateStep(i)
      .catch((e) => {
        if (e.name === 'AbortError') throw e;
        step.status = 'failed';
        step.error = e.message;
      })
      .then(() => {
        if (step.status === 'failed' && !step.code) {
          // reuse previous code so the set keeps going
          step.code = (i > 0 && setlist.steps[i - 1].code) || getCode();
        }
      })
      .finally(() => { delete step.genPromise; });
  }
  return step.genPromise;
}

async function pumpGeneration() {
  if (setlist.generating) return;
  setlist.generating = true;
  const token = setlist.pumpToken;
  try {
    while (setlist.running && token === setlist.pumpToken && setlist.genIndex < setlist.steps.length) {
      try {
        await ensureGenerated(setlist.genIndex);
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
      if (token !== setlist.pumpToken) return; // restarted from another block meanwhile
      setlist.genIndex++;
    }
  } finally {
    if (token === setlist.pumpToken) setlist.generating = false;
  }
}

/** Generate blocks in order starting at block `from` (a running loop elsewhere stops). */
function restartGeneration(from) {
  setlist.pumpToken++;
  setlist.generating = false;
  setlist.genIndex = Math.max(0, from);
  pumpGeneration();
}

/** Skipping ahead to block i: blocks above it that have no code yet are not written any more. */
function skipBlocksBefore(i) {
  let n = 0;
  setlist.steps.forEach((s, j) => {
    if (j >= i || s.code || !['waiting', 'generating'].includes(s.status)) return;
    s.abort?.abort();
    s.status = 'skipped';
    n++;
  });
  return n;
}

/** Manually switch to step i (on the next "switch on" boundary). */
function jumpTo(i) {
  if (!setlist.running || !setlist.steps[i]) return;
  // cancel a step that is armed but hasn't started yet
  for (const s of setlist.steps) {
    if (s.status === 'armed' && s.startedAt !== undefined && nowCycle() < s.startedAt) {
      cancelPending(true);
      s.status = s.code ? 'ready' : 'waiting';
      delete s.startedAt;
    }
  }
  const target = setlist.steps[i];
  if (target.status === 'done' || target.status === 'playing') target.status = 'ready';
  if (target.status === 'skipped') target.status = 'waiting';
  delete target.startedAt;
  setlist.jumpTarget = i;
  setlist.playIndex = i;
  setlist.nextAt = null; // → next quantize boundary
  // stop writing the blocks above this one and generate from here on
  const skipped = skipBlocksBefore(i);
  restartGeneration(i);
  if (!target.code) {
    addMsg('info', `⏭ section ${i + 1} is being generated${skipped ? ` (skipping ${skipped} unwritten block${skipped > 1 ? 's' : ''} before it)` : ''} — it will switch in as soon as it's ready`);
  }
  lastSongsKey = '';
}

async function tickSetlist() {
  if (!setlist.running) return;
  // manual mode: only move when the user picked a section
  if (!autoAdvance() && setlist.jumpTarget === null) return;
  const i = setlist.playIndex;
  if (i >= setlist.steps.length && setlist.feeder?.active()) return; // more blocks are on their way
  if (i >= setlist.steps.length) {
    if (!autoAdvance()) {
      setlist.jumpTarget = null; // manual mode: keep holding the last section
      return;
    } else {
      // let the last step play out its bars before declaring the set finished
      if (setlist.nextAt != null && isPlaying() && nowCycle() < setlist.nextAt) return;
      addMsg('info', `■ ${setlist.feeder?.label || 'song blocks'} finished (last section keeps playing)`);
      stopSetlist();
      return;
    }
  }
  const step = setlist.steps[setlist.playIndex];
  if (!step?.code || step.status === 'armed') return;
  if (!isPlaying()) {
    // nothing playing yet → start with the first ready step immediately
    step.status = 'armed';
    await evaluateCode(step.code, { label: `block ${setlist.playIndex + 1}` });
    step.startedAt = 0;
    setlist.nextAt = step.bars;
    setlist.playIndex++;
    setlist.jumpTarget = null;
    return;
  }
  if (setlist.nextAt === null && quantize() === 0) {
    // "switch on: immediately" → no waiting for a bar line
    step.status = 'armed';
    const err = await evaluateCode(step.code, { label: `block ${setlist.playIndex + 1}` });
    if (err) { step.status = 'failed'; step.error = err.message; }
    step.startedAt = nowCycle();
    setlist.nextAt = Math.ceil(nowCycle()) + step.bars;
    setlist.playIndex++;
    setlist.jumpTarget = null;
    return;
  }
  const q = Math.max(1, quantize() || 1);
  // first step waits for the next quantize boundary; late steps too
  let at = setlist.nextAt ?? nextBoundary(q);
  if (at < nextBoundary(1)) at = nextBoundary(q);
  // arm ~2s before the switch (or before its crossfade starts) so the editor shows what's next
  const fade = step.fade ?? fadeCycles();
  const secsUntil = (at - fade - nowCycle()) / cps();
  if (secsUntil > 2) return;
  step.status = 'armed';
  const playing = setlist.steps.find((s) => s.status === 'playing');
  const code = step.section && playing?.song === step.song ? carryLiveState(getCode(), step.code) : step.code;
  const err = await evaluateCode(code, {
    at,
    fade,
    label: step.song ? `“${step.song.title}” ${step.section ? step.prompt : `${step.songPos + 1}/${step.songLen}`}` : `block ${setlist.playIndex + 1}`,
  });
  if (err) {
    // keep the old music playing, regenerate this section with the error and try again
    const idx = setlist.playIndex;
    step.fixAttempts = (step.fixAttempts || 0) + 1;
    if (step.fixAttempts <= MAX_FIX_ATTEMPTS) {
      addMsg('info', `Block ${idx + 1} failed (${err.message}) — regenerating, will switch in when fixed`);
      step.status = 'waiting';
      step.code = null;
      step.fixHint = err.message;
      delete step.startedAt;
      setlist.nextAt = null;
      setlist.jumpTarget = idx;
      ensureGenerated(idx).catch(() => {});
      return;
    }
    step.status = 'failed';
    step.error = err.message;
    addMsg('error', `Block ${idx + 1} failed: ${err.message} — skipped`);
  } else {
    step.startedAt = at; // stays 'armed' until the switch happens
  }
  setlist.nextAt = at + step.bars;
  setlist.playIndex++;
  setlist.jumpTarget = null;
}

function startSetlist({ at = 0, steps = null, feeder = null } = {}) {
  steps = steps || [];
  if (!steps.length && !feeder) return;
  stopSetlist();
  stopReplay();
  Object.assign(setlist, {
    running: true, steps, genIndex: at, playIndex: at, nextAt: null, jumpTarget: at,
    abort: new AbortController(), feeder, hold: false,
  });
  steps.forEach((s, j) => { if (j < at && !s.code) s.status = 'skipped'; }); // started further down: don't write the blocks above
  setlist.timer = setInterval(() => tickSetlist().catch((e) => addMsg('error', e.message)), 100);
  if (!feeder) addMsg('info', `▶ song blocks started (${steps.length} blocks) — generating ahead…`);
  restartGeneration(at);
}

/** Add blocks to a running engine (used by Set list / Station). Old finished blocks are trimmed. */
function appendSteps(steps) {
  setlist.steps.push(...steps);
  const keepFrom = Math.min(setlist.playIndex - 3, setlist.genIndex);
  if (keepFrom > 40) {
    const cut = keepFrom - 20;
    setlist.steps.splice(0, cut);
    setlist.playIndex -= cut;
    setlist.genIndex -= cut;
    if (setlist.jumpTarget !== null) setlist.jumpTarget = Math.max(0, setlist.jumpTarget - cut);
  }
  lastSongsKey = '';
  pumpGeneration();
}

/** Remove blocks that haven't started yet (after the playing/armed one). */
function dropUpcomingSteps() {
  let keep = setlist.steps.length;
  for (let i = 0; i < setlist.steps.length; i++) {
    const st = setlist.steps[i].status;
    if (st === 'playing' || st === 'armed' || st === 'done') keep = i + 1;
  }
  keep = Math.max(keep, Math.min(setlist.playIndex, setlist.steps.length));
  if (setlist.steps[keep - 1]?.status === 'armed' && nowCycle() < (setlist.steps[keep - 1].startedAt ?? 0)) {
    cancelPending(true);
    keep--;
  }
  setlist.steps.splice(keep);
  setlist.playIndex = Math.min(setlist.playIndex, keep);
  setlist.genIndex = Math.min(setlist.genIndex, keep);
  lastSongsKey = '';
}

function stopSetlist() {
  if (!setlist.running) return;
  setlist.running = false;
  setlist.jumpTarget = null;
  const feeder = setlist.feeder;
  setlist.feeder = null;
  feeder?.onStop?.();
  setlist.abort?.abort();
  clearInterval(setlist.timer);
  setlist.steps.forEach((s) => { if (s.status === 'generating' || s.status === 'armed') s.status = 'waiting'; });
}

/** Ask the LLM for song blocks ("bars | instruction" lines) from a description. */
async function writeBlocks(idea, code, signal) {
  const text = await requestLLM({ messages: [{ role: 'user', content: idea }], code, mode: 'setlist', signal });
  const lines = stripThinking(text)
    .replace(/```[a-z]*\n?|```/g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*[-*\d.)]*\s*(?=\d+\s*(bars?)?\s*\|)/i, '').trim())
    .filter((l) => /^\d+(\.\d+)?\s*(bars?)?\s*\|/.test(l));
  if (!lines.length) throw new Error('model did not return song blocks in "bars | instruction" format');
  return lines;
}

const STATUS_ICON = { waiting: '·', generating: '…', ready: '✓', armed: '⏱', playing: '▶', failed: '✗', done: '✔', skipped: '↷' };
/** Armed blocks become "playing" once their bar arrives (the song views render from these states). */
function updateStepStates() {
  const cur = nowCycle();
  setlist.steps.forEach((s, i) => {
    if (s.status === 'armed' && s.startedAt !== undefined && cur >= s.startedAt) {
      setlist.steps.forEach((o, j) => { if (j !== i && o.status === 'playing') o.status = 'done'; });
      s.status = 'playing';
      setlist.feeder?.onStepStart?.(s);
    }
  });
}

/** Hold: stay on the current section until another one is picked (or hold is released). */
function setHold(on) {
  setlist.hold = on;
  // releasing: continue with the section after the current one on the next boundary
  if (!on && setlist.running && setlist.nextAt === null) setlist.nextAt = nextBoundary(Math.max(1, quantize() || 1));
  lastSongsKey = '';
}

// Alt+1 … Alt+9 jump to the sections of the song that is playing
document.addEventListener('keydown', (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  const n = Number(e.key);
  const song = setl.songs[setl.current];
  const step = song?.blocks?.[n - 1];
  if (n >= 1 && n <= 9 && step && setlist.steps.includes(step)) {
    e.preventDefault();
    jumpTo(setlist.steps.indexOf(step));
  }
});

// ---------------------------------------------------------------------------
if (!window.isSecureContext) {
  addMsg('error', 'This page is not a secure context, so browser audio (AudioWorklet) will fail. ' +
    'Open it via http://localhost or the HTTPS port instead.');
}
loadConfig().catch((e) => addMsg('error', `Config load failed: ${e.message}`));
soundRegistry(); // install soundfont guard as soon as Strudel has loaded



// ---------------------------------------------------------------------------
// Mute / solo per line. Every labelled pattern line ("$:", "bass:", …) gets
// M and S buttons. They toggle Strudel's own syntax — "_$:" mutes a line,
// "S$:" solos it — and the change switches in exactly on the next beat.
// ---------------------------------------------------------------------------
const LABEL_LINE = /^([A-Za-z_$][\w$]*):(?!:)/;
const barBeat = (at) => {
  const bar = Math.floor(at + 1e-9) + 1;
  const beat = Math.round(((at % 1) + 1) % 1 * 4) + 1;
  return beat === 1 ? `bar ${bar}` : `bar ${bar} beat ${beat}`;
};

function parseLabel(label) {
  const muted = label.startsWith('_') || (label.endsWith('_') && label.length > 1);
  let base = label.replace(/^_+|_+$/g, '');
  const solo = !muted && base.length > 1 && base.startsWith('S');
  if (solo) base = base.slice(1);
  return { muted, solo, base: base || '$' };
}
const makeLabel = ({ base, muted, solo }) => (muted ? '_' + base : solo ? 'S' + base : base);

/** Lines that hold a pattern label: [{ line (0-based), label, muted, solo, base }] */
function patternLines(code) {
  return code.split('\n').flatMap((text, line) => {
    const m = text.match(LABEL_LINE);
    return m ? [{ line, label: m[1], ...parseLabel(m[1]) }] : [];
  });
}

const mixerPending = new Map(); // line → cycle at which the toggle takes effect

async function toggleLine(line, what) {
  const code = getCode();
  const lines = code.split('\n');
  const m = lines[line]?.match(LABEL_LINE);
  if (!m) return;
  const st = parseLabel(m[1]);
  if (what === 'mute') { st.muted = !st.muted; if (st.muted) st.solo = false; }
  else { st.solo = !st.solo; if (st.solo) st.muted = false; }
  lines[line] = lines[line].replace(LABEL_LINE, makeLabel(st) + ':');
  const next = lines.join('\n');
  if (!isPlaying()) { mirror().setCode(next); renderMixer(); return; }
  const at = nextBoundary(0.25); // next beat (¼ cycle)
  const verb = what === 'mute' ? (st.muted ? 'mute' : 'unmute') : (st.solo ? 'solo' : 'unsolo');
  const err = await evaluateCode(next, { at, label: `${verb} ${st.base === '$' ? 'line ' + (line + 1) : st.base}`, undo: false });
  if (err) { addMsg('error', `Couldn't ${what}: ${err.message}`); return; }
  mixerPending.set(line, at);
  renderMixer();
}

let mixerEl = null;
let lastMixerKey = '';
function renderMixer() {
  const view = mirror()?.editor;
  const host = $('editor-wrap')?.querySelector(':scope > div');
  if (!view?.coordsAtPos || !host) return;
  if (!mixerEl || !host.contains(mixerEl)) {
    mixerEl = document.createElement('div');
    mixerEl.className = 'mixer';
    host.style.position = 'relative';
    host.appendChild(mixerEl);
    mixerEl.addEventListener('mousedown', (e) => e.preventDefault()); // keep editor focus/selection
    // the code scrolls inside the editor: keep the M/S buttons next to their lines
    host.querySelector('.cm-scroller')?.addEventListener('scroll', () => renderMixer(), { passive: true });
    mixerEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-line]');
      if (b) toggleLine(Number(b.dataset.line), b.dataset.what);
    });
  }
  const code = getCode();
  const rows = patternLines(code);
  const now = nowCycle();
  for (const [l, at] of mixerPending) if (!isPlaying() || now >= at) mixerPending.delete(l);
  const anySolo = rows.some((r) => r.solo);
  const hostTop = host.getBoundingClientRect().top;
  const doc = view.state.doc;
  const pos = rows.map((r) => {
    if (r.line >= doc.lines) return null;
    const c = view.coordsAtPos(doc.line(r.line + 1).from);
    return c ? Math.round(c.top - hostTop) : null;
  });
  const key = JSON.stringify([rows, pos, [...mixerPending.keys()], anySolo]);
  if (key === lastMixerKey) return;
  lastMixerKey = key;
  mixerEl.innerHTML = rows
    .map((r, i) => {
      if (pos[i] == null) return '';
      const pend = mixerPending.has(r.line) ? ' pending' : '';
      const silenced = r.muted || (anySolo && !r.solo);
      return `<div class="mixer-row${pend}${silenced ? ' silenced' : ''}" style="top:${pos[i]}px">
        <button data-line="${r.line}" data-what="mute" class="m${r.muted ? ' on' : ''}" title="Mute this line (on the next beat)">M</button>
        <button data-line="${r.line}" data-what="solo" class="s${r.solo ? ' on' : ''}" title="Solo this line (on the next beat)">S</button>
      </div>`;
    })
    .join('');
}
replEl.addEventListener('update', () => requestAnimationFrame(renderMixer));
window.addEventListener('resize', () => { lastMixerKey = ''; renderMixer(); });
setInterval(renderMixer, 150);

// ---------------------------------------------------------------------------
// Hum → melody: hold the button (or the ` key), hum, release.
// ---------------------------------------------------------------------------
let SCALE_INTERVALS = null;
fetch('/scale-intervals.json').then((r) => r.json()).then((j) => (SCALE_INTERVALS = j)).catch(() => {});

/** Pitch classes of the first .scale("Tonic:name") in the code, or null. */
function scaleFromCode(code) {
  const m = code.match(/\.scale\(\s*["'`]<?\s*([A-Ga-g][#bsf]*-?\d*):([A-Za-z0-9#':-]+)/);
  if (!m || !SCALE_INTERVALS) return null;
  const name = m[2].replace(/:/g, ' ').toLowerCase();
  const iv = SCALE_INTERVALS[name];
  const t = tonicPc(m[1]);
  if (!iv || t == null) return null;
  return { label: `${m[1]}:${m[2]}`, pcs: intervalsToSemitones(iv).map((x) => (x + t) % 12) };
}

const hum = { rec: null, recording: false, frames: [], result: null, duckPrev: null, keyHeld: false };

function audioCtx() {
  try { return globalThis.getAudioContext?.() || (hum.ownCtx ||= new AudioContext()); }
  catch { return (hum.ownCtx ||= new AudioContext()); }
}
/** Cycle position of what you *hear* right now, minus analysis delay; null when stopped. */
function audibleCycle(analysisDelay = 0) {
  if (!isPlaying()) return null;
  const ctx = audioCtx();
  const outLat = (ctx.outputLatency || ctx.baseLatency || 0) + 0.1; // Strudel schedules 0.1 s ahead
  return nowCycle() - (outLat + analysisDelay) * cps();
}
function setDuck(on) {
  hum.ducked = on;
  applyMasterGain(on ? 0.05 : 0.1);
}

async function humStart() {
  if (hum.recording) return;
  hum.recording = true;
  hum.startedAt = performance.now();
  $('humBtn').classList.add('recording');
  $('humBtn').textContent = '🔴 Humming… release to finish';
  $('hum-panel').hidden = false;
  $('humSendAI').disabled = $('humInsert').disabled = true;
  $('humMini').textContent = '';
  $('humStatus').textContent = '🎤 listening…';
  hum.result = null;
  hum.frames = [];
  hum.rec ||= new HumRecorder({
    getContext: audioCtx,
    getCycle: audibleCycle,
    onFrame: (f) => { hum.frames.push(f); },
  });
  try {
    await hum.rec.start();
    if ($('humDuck').checked && isPlaying()) setDuck(true);
    drawHumLive();
  } catch (e) {
    hum.recording = false;
    $('humBtn').classList.remove('recording');
    $('humBtn').textContent = '🎤 Hum';
    $('humStatus').textContent = '⚠ ' + (e.name === 'NotAllowedError' ? 'microphone permission denied' : e.message);
  }
}

async function humStop() {
  if (!hum.recording) return;
  hum.recording = false;
  $('humBtn').classList.remove('recording');
  $('humBtn').textContent = '🎤 Hum';
  const frames = hum.rec.stop();
  setDuck(false);
  if (performance.now() - hum.startedAt < 350) {
    // a quick tap: just show the panel with its settings
    $('humStatus').textContent = 'Hold the 🎤 button (or the ` key) and hum. Release to finish.';
    return;
  }
  const scale = $('humSnap').checked ? scaleFromCode(getCode()) : null;
  const r = transcribe(frames, { cps: cps(), grid: Number($('humGrid').value), pcs: scale?.pcs || null });
  hum.result = r;
  drawHumResult(frames, r);
  if (!r.notes.length) {
    $('humStatus').textContent = '🤷 no melody detected — hum louder / closer to the mic (headphones help)';
    return;
  }
  $('humStatus').textContent =
    `🎵 ${r.notes.length} notes, ${r.bars} bar${r.bars > 1 ? 's' : ''}` +
    (scale ? ` · snapped to ${scale.label}` : '') + (isPlaying() ? ' · aligned to the beat' : '');
  $('humMini').textContent = `note("${r.mini}")`;
  $('humSendAI').disabled = $('humInsert').disabled = false;
  const mode = $('humMode').value;
  if (mode === 'ai') humSendToAI();
  else if (mode === 'insert') humInsert();
}

function humInsert() {
  const r = hum.result;
  if (!r?.mini) return;
  const existing = new Set(patternLines(getCode()).map((p) => p.base));
  let name = 'hum';
  for (let i = 2; existing.has(name); i++) name = `hum${i}`;
  const line = `${name}: note("${r.mini}").s("triangle").attack(0.01).release(0.2)\n  .room(slider(0.3, 0, 1))\n  .gain(slider(0.8, 0, 1.2))`;
  const code = getCode().trimEnd() + '\n' + line + '\n';
  applyQuantized(code, 'hummed melody').then((err) => {
    if (err) addMsg('error', `Couldn't insert melody: ${err.message}`);
    else addMsg('info', state.pending ? `🎤 melody armed — starts at bar ${state.pending.at + 1}` : '🎤 melody inserted');
  });
}

async function humSendToAI() {
  const r = hum.result;
  if (!r?.mini || state.busy) return;
  const typed = $('input').value.trim();
  $('input').value = '';
  const instruction = typed || 'Add this hummed melody to the music as a new melodic part with a fitting instrument.';
  const melody = `note("${r.mini}")`;
  const msg =
    `${instruction}\n\nHUMMED MELODY (${r.bars} bar${r.bars > 1 ? 's' : ''}, one bar per cycle):\n${melody}\n` +
    'Use this note pattern EXACTLY as written (same notes, same rhythm, same mini-notation string). ' +
    'You may choose the instrument, add .transpose(12) or .transpose(-12) for the octave, effects and gain.';
  // switch to the chat tab so the reply is visible
  document.querySelector('.tabs button[data-tab="chatTab"]')?.click();
  addMsg('user', `🎤 ${instruction}\n${melody}`);
  setBusy(true);
  state.abort = new AbortController();
  try {
    await runTurn(msg);
    const norm = (x) => x.replace(/\s+/g, '');
    if (!norm(getCode()).includes(norm(r.mini))) {
      const div = addMsg('info', '⚠ the AI changed your melody. ', { raw: false });
      const b = document.createElement('button');
      b.textContent = '＋ insert my melody as-is';
      b.className = 'link';
      b.onclick = humInsert;
      div.appendChild(b);
    }
  } catch (err) {
    if (err.name === 'AbortError') addMsg('info', 'stopped');
    else addMsg('error', err.message);
  } finally {
    setBusy(false);
  }
}

// --- drawing
function humCanvas() {
  const c = $('humCanvas');
  const w = c.clientWidth || 600;
  if (c.width !== w * devicePixelRatio) { c.width = w * devicePixelRatio; c.height = 110 * devicePixelRatio; }
  const g = c.getContext('2d');
  g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  g.clearRect(0, 0, w, 110);
  return { g, w, h: 110 };
}
function midiRange(ms) {
  const v = ms.filter(Number.isFinite);
  const lo = v.length ? Math.min(...v) - 3 : 48, hi = v.length ? Math.max(...v) + 3 : 72;
  return { lo: Math.min(lo, hi - 12), hi: Math.max(hi, lo + 12) };
}
function drawHumLive() {
  if (!hum.recording) return;
  const { g, w, h } = humCanvas();
  const frames = hum.frames;
  const span = 8; // seconds visible
  const tEnd = frames.length ? frames[frames.length - 1].t : 0;
  const t0 = Math.max(0, tEnd - span);
  const voiced = frames.filter((f) => f.freq && f.confidence > 0.75 && f.rms > 0.006);
  const { lo, hi } = midiRange(voiced.map((f) => freqToMidi(f.freq)));
  const y = (m) => h - ((m - lo) / (hi - lo)) * (h - 10) - 5;
  // semitone lines at each C
  g.strokeStyle = '#1d2029';
  for (let m = Math.ceil(lo); m <= hi; m++) if (m % 12 === 0) { g.beginPath(); g.moveTo(0, y(m)); g.lineTo(w, y(m)); g.stroke(); }
  g.fillStyle = '#7c5cff';
  for (const f of voiced) {
    if (f.t < t0) continue;
    g.fillRect(((f.t - t0) / span) * w, y(freqToMidi(f.freq)) - 1.5, 3, 3);
  }
  const last = frames[frames.length - 1];
  const lvl = last ? Math.min(1, last.rms * 8) : 0;
  g.fillStyle = '#20d3a6';
  g.fillRect(w - 6, h - lvl * h, 6, lvl * h);
  if (last?.freq && last.confidence > 0.75 && last.rms > 0.006) {
    $('humStatus').textContent = `🎤 ${midiToName(Math.round(freqToMidi(last.freq)))}`;
  }
  requestAnimationFrame(drawHumLive);
}
function drawHumResult(frames, r) {
  const { g, w, h } = humCanvas();
  if (!r.notes.length) return;
  const grid = r.grid;
  const total = r.bars * grid;
  const first = r.startBar * grid;
  const { lo, hi } = midiRange(r.notes.map((n) => n.midi));
  const y = (m) => h - ((m - lo) / (hi - lo)) * (h - 14) - 7;
  const x = (step) => ((step - first) / total) * w;
  for (let s = 0; s <= total; s++) {
    g.strokeStyle = s % grid === 0 ? '#3a3f4f' : s % (grid / 4) === 0 ? '#23262f' : '#16181f';
    g.beginPath(); g.moveTo(x(first + s), 0); g.lineTo(x(first + s), h); g.stroke();
  }
  // the raw pitch track, faint
  g.fillStyle = 'rgba(124,92,255,.35)';
  for (const f of frames) {
    if (!(f.freq && f.confidence > 0.75 && f.rms > 0.006)) continue;
    const pos = (f.c ?? null);
    if (pos == null) continue;
    g.fillRect(x(pos * grid), y(freqToMidi(f.freq)) - 1, 2, 2);
  }
  // quantized notes
  g.font = '10px ui-monospace, monospace';
  for (const n of r.notes) {
    const x0 = x(n.start * grid), x1 = x((n.start + n.dur) * grid);
    g.fillStyle = '#20d3a6';
    g.fillRect(x0 + 1, y(n.midi) - 4, Math.max(3, x1 - x0 - 2), 8);
    g.fillStyle = '#e6e8ee';
    g.fillText(n.name, x0 + 2, y(n.midi) - 6);
  }
}

// --- wiring: hold the button, or hold the ` key
const humBtn = $('humBtn');
humBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); humBtn.setPointerCapture?.(e.pointerId); humStart(); });
for (const ev of ['pointerup', 'pointercancel']) humBtn.addEventListener(ev, () => humStop());
humBtn.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Backquote' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, .cm-editor, [contenteditable="true"]')) return;
  e.preventDefault();
  hum.keyHeld = true;
  humStart();
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Backquote' && hum.keyHeld) { hum.keyHeld = false; humStop(); }
});
$('humSendAI').onclick = humSendToAI;
$('humInsert').onclick = humInsert;
$('humClose').onclick = () => { $('hum-panel').hidden = true; };
for (const id of ['humGrid', 'humSnap', 'humDuck', 'humMode']) {
  const el = $(id);
  const key = 'hum_' + id;
  if (saved[key] !== undefined) el[el.type === 'checkbox' ? 'checked' : 'value'] = saved[key];
  el.onchange = () => {
    save({ [key]: el.type === 'checkbox' ? el.checked : el.value });
    // re-quantize the last recording with the new grid / snap settings
    if (hum.result && !hum.recording && (id === 'humGrid' || id === 'humSnap') && hum.rec?.frames?.length) {
      const scale = $('humSnap').checked ? scaleFromCode(getCode()) : null;
      hum.result = transcribe(hum.rec.frames, { cps: cps(), grid: Number($('humGrid').value), pcs: scale?.pcs || null });
      drawHumResult(hum.rec.frames, hum.result);
      $('humMini').textContent = hum.result.mini ? `note("${hum.result.mini}")` : '';
    }
  };
}


// ---------------------------------------------------------------------------
// Resizable side panel (drag the handle between editor and chat)
// ---------------------------------------------------------------------------
(() => {
  const pane = $('chat-pane');
  const handle = $('resizer');
  const clamp = (w) => Math.max(260, Math.min(w, window.innerWidth - 320));
  const apply = (w) => { pane.style.flexBasis = clamp(w) + 'px'; };
  if (saved.paneWidth) apply(saved.paneWidth);
  let drag = null;
  handle.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, w: pane.getBoundingClientRect().width };
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    apply(drag.w + (drag.x - e.clientX));
    lastMixerKey = '';
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    document.body.classList.remove('resizing');
    save({ paneWidth: pane.getBoundingClientRect().width });
    window.dispatchEvent(new Event('resize'));
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', () => { pane.style.flexBasis = ''; save({ paneWidth: null }); window.dispatchEvent(new Event('resize')); });
  window.addEventListener('resize', () => { const w = load().paneWidth; if (w) apply(w); });
})();


// ---------------------------------------------------------------------------
// Version + self-update. The server stamps index.html with its build id; we poll
// /api/version and, when a new build is deployed, save the session and reload —
// right away if nothing is playing, otherwise as soon as playback stops.
// ---------------------------------------------------------------------------
const APP_VERSION = document.querySelector('meta[name="app-version"]')?.content || 'dev';
const APP_BUILD = document.querySelector('meta[name="app-build"]')?.content || 'dev';
$('appVersion').textContent = 'v' + APP_VERSION;
$('appVersion').title = `build ${APP_BUILD}`;
const RESUME_KEY = 'strudel-ai:resume';
const upd = { available: null, reloading: false };

function saveSession() {
  try {
    const msgs = $('messages').cloneNode(true);
    msgs.querySelectorAll('.actions, .typing').forEach((n) => n.remove());
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({
      messages: msgs.innerHTML,
      history: state.history,
      versions: state.versions.slice(-30),
      lastAICode: state.lastAICode ?? null,
      input: $('input').value,
      fromVersion: APP_VERSION,
      at: Date.now(),
    }));
  } catch {}
}
function restoreSession() {
  let r;
  try { r = JSON.parse(sessionStorage.getItem(RESUME_KEY) || 'null'); sessionStorage.removeItem(RESUME_KEY); } catch {}
  if (!r || Date.now() - r.at > 5 * 60 * 1000) return;
  $('messages').innerHTML = r.messages || $('messages').innerHTML;
  state.history = r.history || [];
  state.versions = r.versions || [];
  state.lastAICode = r.lastAICode;
  $('undo').disabled = state.versions.length === 0;
  if (r.input) $('input').value = r.input;
  addMsg('info', r.fromVersion !== APP_VERSION ? `⬆ updated v${r.fromVersion} → v${APP_VERSION} — your code and chat were kept` : `⬆ updated to build ${APP_BUILD} — your code and chat were kept`);
}

const canReloadNow = () => !isPlaying() && !state.busy && !hum.recording && !setlist.running && !setl.running && !state.pending;
function reloadForUpdate() {
  if (upd.reloading) return;
  upd.reloading = true;
  saveSession();
  location.reload();
}
async function checkForUpdate() {
  try {
    const v = await fetch('/api/version', { cache: 'no-store' }).then((r) => r.json());
    if (!v.build || v.build === APP_BUILD || APP_BUILD === 'dev') return;
    upd.available = v;
    if (canReloadNow()) return reloadForUpdate();
    const pill = $('updatePill');
    pill.hidden = false;
    pill.textContent = `⬆ v${v.version} ready — applies when you stop`;
    pill.title = 'A new version was deployed. Click to update now (stops the music).';
  } catch {}
}
$('updatePill').onclick = () => { mirror()?.stop(); stopSet(); stopSetlist(); reloadForUpdate(); };
setInterval(() => {
  if (upd.available && canReloadNow()) reloadForUpdate();
}, 1000);
setInterval(checkForUpdate, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
restoreSession();

// ---------------------------------------------------------------------------
// Share links: /s/<id> opens a song stored on the server.
// ---------------------------------------------------------------------------
$('shareBtn').onclick = (e) => {
  e.stopPropagation();
  const pop = $('sharePop');
  pop.hidden = !pop.hidden;
  if (!pop.hidden) {
    $('shareResult').hidden = true;
    $('shareSetlist').checked = !!$('setText').value.trim() && load().shareSetlist !== false;
    const take = rec.take?.events.length ? rec.take : rec.last;
    $('shareRecWrap').hidden = !take;
    $('shareRec').checked = !!take && load().shareRec !== false;
    if (take) {
      const n = take.events.length;
      $('shareRecInfo').textContent = `${n} change${n > 1 ? 's' : ''} · ${fmtTime(takeSeconds(take))}${rec.take === take ? ' so far' : ''}`;
    }
    $('shareTitle').focus();
  }
};
document.addEventListener('click', (e) => {
  if (!$('sharePop').hidden && !e.target.closest('.share-wrap')) $('sharePop').hidden = true;
});
$('shareSetlist').onchange = () => save({ shareSetlist: $('shareSetlist').checked });
$('shareRec').onchange = () => save({ shareRec: $('shareRec').checked });
$('shareCreate').onclick = async () => {
  const btn = $('shareCreate');
  btn.disabled = true;
  btn.textContent = 'creating…';
  try {
    const r = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: getCode(),
        title: $('shareTitle').value.trim(),
        setText: $('shareSetlist').checked ? $('setText').value : null,
        recording: $('shareRec').checked && !$('shareRecWrap').hidden ? recordingForShare() : null,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    const url = location.origin + j.path;
    $('shareUrl').value = url;
    $('shareOpen').href = url;
    $('shareResult').hidden = false;
    $('shareUrl').select();
    try { await navigator.clipboard.writeText(url); $('shareCopy').textContent = '✓ Copied'; } catch { $('shareCopy').textContent = '📋 Copy'; }
  } catch (e) {
    addMsg('error', `Share failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create link';
  }
};
$('shareCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('shareUrl').value); $('shareCopy').textContent = '✓ Copied'; }
  catch { $('shareUrl').select(); document.execCommand?.('copy'); }
};

async function openSharedSong() {
  const m = location.pathname.match(/^\/s\/([A-Za-z0-9]{6,16})$/);
  if (!m) return;
  history.replaceState(null, '', '/'); // a refresh shouldn't overwrite later edits with the shared song again
  try {
    const r = await fetch(`/api/share/${m[1]}`);
    const song = await r.json();
    if (!r.ok) throw new Error(song.error || r.status);
    const prev = getCode();
    if (prev.trim() && prev.trim() !== song.code.trim()) {
      state.versions.push(prev); // your previous code stays reachable via ↶ Undo
      $('undo').disabled = false;
    }
    mirror().setCode(song.code);
    if (song.setText) { $('setText').value = song.setText; save({ setText: song.setText }); }
    state.lastAICode = song.code;
    live.applied = song.code;
    const title = song.title ? `“${song.title}”` : 'a shared song';
    const take = decodeRecording(song.recording);
    if (song.song?.steps?.length) {
      const sg = loadSharedSong(song.song);
      addMsg('info', `🔗 Opened the song ${title} — ${sg.blocks.length} sections, ${sg.bars} bars${sg.sheet ? `, ${sg.sheet.bpm} bpm in ${sg.sheet.key}` : ''}. Press ▶ Play this song in the 🎵 Songs tab. Your previous code is one ↶ Undo away.`);
    } else if (take) {
      rec.last = take; // sharing again keeps the recording
      mirror().setCode(take.events[0].code);
      const div = addMsg('info', `🔗 Opened ${title} — a recording of ${take.events.length} timed change${take.events.length > 1 ? 's' : ''} (${fmtTime(takeSeconds(take))}). Your previous code is one ↶ Undo away. `);
      const b = document.createElement('button');
      b.textContent = '⏺ Play the recording';
      b.onclick = () => startReplay(take, song.title);
      div.appendChild(b);
    } else {
      addMsg('info', `🔗 Opened ${title}${song.setText ? ' (with its set list)' : ''} — press ▶ Play. Your previous code is one ↶ Undo away.`);
    }
    document.title = song.title ? `${song.title} · Strudel AI` : document.title;
  } catch (e) {
    addMsg('error', `Couldn't open shared song: ${e.message}`);
  }
}
openSharedSong();


// ---------------------------------------------------------------------------
// Master volume: scales Strudel's final output (and is what "duck music" lowers).
// ---------------------------------------------------------------------------
function masterGainNode() {
  try { return globalThis.getSuperdoughAudioController?.().output.destinationGain.gain || null; } catch { return null; }
}
function applyMasterGain(ramp = 0.03) {
  const g = masterGainNode();
  if (!g) return;
  const v = Number($('masterGain').value) * (hum.ducked ? 0.3 : 1);
  try { g.setTargetAtTime(v, audioCtx().currentTime, ramp); } catch { g.value = v; }
}
$('masterGain').value = saved.masterGain ?? 1;
const showMaster = () => { $('masterVal').textContent = Math.round($('masterGain').value * 100) + '%'; };
showMaster();
$('masterGain').oninput = () => { showMaster(); applyMasterGain(); save({ masterGain: Number($('masterGain').value) }); };
$('masterGain').ondblclick = () => { $('masterGain').value = 1; $('masterGain').oninput(); };
// the audio graph is created lazily by Strudel – (re)apply on play and on first interaction
document.addEventListener('pointerdown', () => setTimeout(applyMasterGain, 50), { once: true });
replEl.addEventListener('update', () => { if (isPlaying() && !applyMasterGain.done) { applyMasterGain.done = true; applyMasterGain(); } });
setTimeout(applyMasterGain, 500);

// ---------------------------------------------------------------------------
// Set list & Station: a list of songs (prompts). Each song's blocks are written by
// the AI while the previous song plays, then fed into the song-blocks engine.
// A station is an agent that keeps inventing new songs for a theme.
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setl = {
  running: false,
  mode: null,          // 'set' | 'station'
  songs: [],           // { title, desc, status, blocks, firstStep, error }
  nextSong: 0,         // next song to append to the engine
  current: -1,         // index of the song playing now
  forceJump: null,     // song index the user picked
  abort: null,
  station: null,       // { name, theme }
};

function parseSongs(text) {
  return text
    .split('\n')
    .map((l) => l.trim().replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ''))
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const m = l.match(/^(.{1,80}?)\s*[|–—:]\s+(.+)$/);
      const title = (m ? m[1] : l.split(/\s+/).slice(0, 4).join(' ')).replace(/^["“]|["”]$/g, '').trim();
      return { title, desc: (m ? m[2] : l).trim(), status: 'waiting' };
    });
}

// ---------------------------------------------------------------------------
// Song forms: the order and length of a song's sections. Users can edit and add
// forms (saved in the browser); the song-sheet request lists them for the AI, and
// the chosen form's bar counts are enforced on the sheet that comes back.
// ---------------------------------------------------------------------------
const DEFAULT_FORMS = [
  { name: 'pop', use: 'pop, synthwave, funk, disco, house, indie dance', sections: 'intro 4, verse 8, pre-chorus 4, chorus 8, verse 8, pre-chorus 4, chorus 8, bridge 8, chorus 8, outro 4' },
  { name: 'edm', use: 'EDM, techno, trance, big room, future bass, dubstep', sections: 'intro 8, build 8, drop 8, breakdown 8, build 4, drop 8, outro 4' },
  { name: 'drum & bass', use: 'drum & bass, jungle, breakbeat, liquid', sections: 'intro 8, build 4, drop 8, breakdown 8, build 4, drop 8, outro 4' },
  { name: 'hip hop', use: 'hip hop, trap, boom bap, r&b', sections: 'intro 4, verse 8, hook 8, verse 8, hook 8, bridge 4, hook 8, outro 4' },
  { name: 'lo-fi', use: 'lo-fi, chillhop, jazz-hop, downtempo, chill', sections: 'intro 4, A 8, A 8, B 8, A 8, outro 4' },
  { name: 'ambient', use: 'ambient, drone, cinematic, meditation, soundscape', sections: 'intro 8, A 8, B 8, A 8, outro 8' },
  { name: 'short', use: 'quick sketches, jingles, short pieces', sections: 'intro 4, A 8, B 8, A 8, outro 4' },
];
let songForms = load().songForms || DEFAULT_FORMS.map((f) => ({ ...f }));
let formIdx = 0;

/** "intro 4, verse 8 …" → [{ name, bars }] */
function parseFormSections(text) {
  return String(text || '')
    .split(/[,\n|→]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const m = t.match(/^(.*?)[\s:x×]*(\d+)\s*(?:bars?)?$/i);
      const name = (m ? m[1] : t).trim() || 'section';
      return { name, bars: Math.max(1, Math.min(32, m ? Number(m[2]) : 8)) };
    });
}
const formBars = (f) => parseFormSections(f.sections).reduce((a, x) => a + x.bars, 0);
const findForm = (name) => songForms.find((f) => f.name.toLowerCase() === String(name || '').trim().toLowerCase());

/** The forms part of a song-sheet request: one fixed form, or all of them to choose from. */
function formsForRequest(choice) {
  const line = (f) => `- "${f.name}"${f.use ? ` (for ${f.use})` : ''}: ${parseFormSections(f.sections).map((x) => `${x.name} ${x.bars}`).join(', ')}`;
  const fixed = choice && choice !== 'auto' ? findForm(choice) : null;
  if (fixed) return `SONG FORM — use exactly this one (set "form": "${fixed.name}"):\n${line(fixed)}`;
  return `SONG FORMS — pick the one that fits this song's genre, and set "form" to its name:\n${songForms.map(line).join('\n')}`;
}
const formChoice = () => $(setl.mode === 'station' ? 'stationForm' : 'setForm')?.value || 'auto';

function renderFormSelects() {
  for (const id of ['setForm', 'stationForm']) {
    const el = $(id);
    const keep = el.value || load()[id] || 'auto';
    el.innerHTML = '<option value="auto">auto (fits the genre)</option>' +
      songForms.map((f) => `<option value="${esc(f.name)}">${esc(f.name)} · ${formBars(f)} bars</option>`).join('');
    el.value = keep === 'auto' || findForm(keep) ? keep : 'auto';
  }
}
function saveForms() { save({ songForms }); renderFormSelects(); }
function renderFormsEditor() {
  formIdx = Math.max(0, Math.min(formIdx, songForms.length - 1));
  $('formSelect').innerHTML = songForms.map((f, i) => `<option value="${i}">${esc(f.name || 'untitled')}</option>`).join('');
  $('formSelect').value = String(formIdx);
  const f = songForms[formIdx] || { name: '', use: '', sections: '' };
  $('formName').value = f.name;
  $('formUse').value = f.use;
  $('formSections').value = f.sections;
  renderFormPreview();
}
function renderFormPreview() {
  const secs = parseFormSections($('formSections').value);
  $('formPreview').innerHTML = secs.length
    ? secs.map((x) => `<span class="chip" style="--w:${x.bars}"><b>${esc(x.name)}</b> ${x.bars}</span>`).join('') +
      `<div class="muted small">${secs.length} sections · ${formBars({ sections: $('formSections').value })} bars</div>`
    : '<span class="muted small">no sections yet</span>';
}
for (const id of ['formName', 'formUse', 'formSections']) {
  $(id).oninput = () => {
    const f = songForms[formIdx];
    if (!f) return;
    f.name = $('formName').value.trim();
    f.use = $('formUse').value.trim();
    f.sections = $('formSections').value;
    if (id === 'formName') $('formSelect').options[formIdx].textContent = f.name || 'untitled';
    if (id === 'formSections') renderFormPreview();
    saveForms();
  };
}
$('formSelect').onchange = () => { formIdx = Number($('formSelect').value); renderFormsEditor(); };
$('formNew').onclick = () => {
  songForms.push({ name: 'my form', use: '', sections: 'intro 4, A 8, B 8, A 8, outro 4' });
  formIdx = songForms.length - 1;
  saveForms(); renderFormsEditor(); $('formName').select();
};
$('formDelete').onclick = () => {
  if (!songForms[formIdx] || !confirm(`Delete the form “${songForms[formIdx].name}”?`)) return;
  songForms.splice(formIdx, 1);
  if (!songForms.length) songForms = DEFAULT_FORMS.map((f) => ({ ...f }));
  saveForms(); renderFormsEditor();
};
$('formReset').onclick = () => {
  for (const d of DEFAULT_FORMS) {
    const f = findForm(d.name);
    if (f) Object.assign(f, d); else songForms.push({ ...d });
  }
  saveForms(); renderFormsEditor();
};
for (const b of document.querySelectorAll('.forms-edit')) b.onclick = () => openSettings('setForms');
for (const id of ['setForm', 'stationForm']) $(id).onchange = () => save({ [id]: $(id).value });
renderFormSelects();

// ---------------------------------------------------------------------------
// Song sheets: for the Songs tab and the Station, the AI first plans the whole song
// as data (tempo, key, chord progressions, hook, parts, form), then writes every
// part once as a library of named patterns. The app arranges each section from the
// library itself, so a chorus is the same code every time, the key and sounds never
// drift, and parts that continue from one section to the next are identical (the
// crossfade keeps them steady).
// ---------------------------------------------------------------------------
const LIB_START = '// ── parts (shared by every section of this song) ──';
const SEC_START = '// ── this section ──';
const HARMONIC_ROLE = /bass|chord|pad|key|arp|harmon|string|piano|organ|guitar/i;

const ident = (x) => {
  const t = String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(t) ? t : 'p_' + (t || 'part');
};

/** First JSON object in a reply, tolerating fences, comments and trailing commas. */
function parseJSONLoose(text) {
  const t = stripThinking(text).replace(/```[a-z]*\n?|```/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON object in the reply');
  const body = t.slice(a, b + 1).replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(body); } catch (e) { throw new Error('invalid JSON: ' + e.message); }
}

// chord qualities Strudel's default voicings know (plus their m / M aliases)
const CHORD_Q = new Set(['', 'm', '7', 'm7', '^7', 'M7', '9', 'm9', '^9', 'M9', '6', 'm6', '69', 'm69', 'add9', 'madd9',
  'sus', '7sus', '9sus', 'o', 'o7', 'h7', 'h9', '+', 'aug', '11', 'm11', '13', '7b9', '7#9', '7#11', '7b5', '7#5',
  'm^7', 'mM7', 'm7b5', '^7#11', '^13', '2', '5']);
/** "Fmaj7" → "F^7", "Bdim" → "Bo", "Gsus4" → "Gsus", unknown qualities → nearest triad / 7th. */
function normChord(tok) {
  const m = tok.match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!m) return tok;
  let q = m[3].replace(/\/.*$/, ''); // no slash chords
  q = q.replace(/^(maj|Maj|M|Δ)7/, '^7').replace(/^(maj|Maj|M|Δ)9/, '^9').replace(/^(maj|Maj)$/, '')
    .replace(/^min/, 'm').replace(/^mi(?!n)/, 'm').replace(/^-/, 'm')
    .replace(/^dim7/, 'o7').replace(/^dim/, 'o').replace(/^ø7?/, 'h7').replace(/^m7b5$/, 'h7')
    .replace(/^sus[24]$/, 'sus').replace(/^7sus[24]$/, '7sus').replace(/^aug$/, '+');
  if (!CHORD_Q.has(q)) q = /^m(?!aj)/.test(q) ? (/7/.test(q) ? 'm7' : 'm') : /7/.test(q) ? '7' : '';
  return m[1].toUpperCase() + m[2] + q;
}
/** "Am F C G" / "<Am F C G>" / "Am | F | C | G" → "<Am F C G>" with valid chord symbols. */
function normProgression(p) {
  let t = String(p || '').replace(/[|,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  t = t.replace(/[A-Ga-g][#b]?[^\s\[\]<>@*!~]*/g, normChord);
  return t.startsWith('<') ? t : `<${t}>`;
}
function sectionType(name) {
  const n = String(name).toLowerCase();
  if (/pre-?chorus/.test(n)) return 'prechorus';
  if (/chorus|hook/.test(n)) return 'chorus';
  if (/drop/.test(n)) return 'drop';
  if (/break/.test(n)) return 'breakdown';
  if (/build|rise/.test(n)) return 'build';
  if (/bridge|^b\b/.test(n)) return 'bridge';
  if (/intro/.test(n)) return 'intro';
  if (/outro|end/.test(n)) return 'outro';
  return 'verse';
}

/** Validate + repair a song sheet from the model. Throws when it can't be used. */
function normalizeSheet(raw, choice = 'auto') {
  if (!raw || typeof raw !== 'object') throw new Error('the sheet is not an object');
  const bpm = Math.max(50, Math.min(200, Math.round(Number(raw.bpm) || 100)));
  // scale: "A:minor" (or derived from "key": "A minor"), checked against the real scale names
  let scale = String(raw.scale || raw.key || 'C minor').trim().replace(/\s+/, ':');
  const fixed = fixScaleString(scale);
  scale = fixed.unknown.length ? 'C:minor' : fixed.fixed;
  const chords = {};
  for (const [k, v] of Object.entries(raw.chords || raw.progressions || {})) {
    const p = normProgression(Array.isArray(v) ? v.join(' ') : v);
    if (p) chords[ident(k)] = p;
  }
  if (!Object.keys(chords).length) throw new Error('no chord progressions');
  const hook = String(raw.hook || '0 2 4 2').replace(/[^0-9~\s\-\[\]<>.*@!]/g, ' ').replace(/\s+/g, ' ').trim() || '0 2 4 2';
  const parts = [];
  for (const p of Array.isArray(raw.parts) ? raw.parts : []) {
    const id = ident(p.name || p.role);
    if (parts.some((q) => q.id === id)) continue;
    const variants = [...new Set(['main', ...(Array.isArray(p.variants) ? p.variants : []).map(ident)])];
    parts.push({ id, role: String(p.role || '').toLowerCase(), sound: String(p.sound || ''), desc: String(p.desc || p.description || ''), variants });
  }
  if (parts.length < 2) throw new Error('fewer than 2 parts');
  parts.splice(8);
  const firstChords = Object.keys(chords)[0];
  const sections = [];
  for (const sec of Array.isArray(raw.sections) ? raw.sections : []) {
    const bars = Math.max(1, Math.min(16, Math.round(Number(sec.bars) || 8)));
    const ck = ident(sec.chords);
    const play = [];
    for (const ref of Array.isArray(sec.play) ? sec.play : []) {
      const [pn, vn] = String(ref).split(/[.:]/);
      const part = parts.find((q) => q.id === ident(pn));
      if (!part) continue;
      const variant = vn && part.variants.includes(ident(vn)) ? ident(vn) : 'main';
      if (!play.some((x) => x.part === part.id)) play.push({ part: part.id, variant });
    }
    if (!play.length && sections.length) play.push(...sections[sections.length - 1].play);
    if (!play.length) play.push({ part: parts[0].id, variant: 'main' });
    const name = String(sec.name || sec.type || 'section').slice(0, 40);
    sections.push({ name, type: sectionType(name), bars, chords: chords[ck] ? ck : firstChords, play });
  }
  if (sections.length < 2) throw new Error('fewer than 2 sections');
  // the form decides the section lengths: take its bar counts when the sections line up, otherwise cap them
  const form = (choice !== 'auto' && findForm(choice)) || findForm(raw.form);
  const fsecs = form ? parseFormSections(form.sections) : [];
  if (fsecs.length === sections.length) sections.forEach((sec, j) => { sec.bars = fsecs[j].bars; });
  else {
    const cap = fsecs.length ? Math.max(...fsecs.map((x) => x.bars)) : 16;
    for (const sec of sections) sec.bars = Math.min(sec.bars, cap);
  }
  return { form: form?.name || String(raw.form || ''), bpm, key: String(raw.key || scale.replace(':', ' ')), scale, chords, hook, parts, sections };
}

/** The part that gets the one-bar fill before choruses / drops (drums with a "fill" variant). */
const fillPart = (sheet) => sheet.parts.find((p) => p.variants.includes('fill') && /drum|perc|beat/i.test(p.role + p.id)) ||
  sheet.parts.find((p) => p.variants.includes('fill'));
/** Library const names the sections need (+ the fill variant). */
function libraryIds(sheet) {
  const ids = new Set();
  for (const sec of sheet.sections) for (const x of sec.play) ids.add(`${x.part}_${x.variant}`);
  const fp = fillPart(sheet);
  if (fp) ids.add(`${fp.id}_fill`);
  return [...ids];
}
const isFnPart = (lib, id) => new RegExp(`(?:const|let|var)\\s+${id}\\s*=\\s*\\(?\\s*[A-Za-z_$][\\w$]*\\s*\\)?\\s*=>`).test(lib);
const definesId = (lib, id) => new RegExp(`(?:const|let|var)\\s+${id}\\s*=`).test(lib);
const partExpr = (lib, id) => (isFnPart(lib, id) ? `${id}(sectionChords)` : id);

/**
 * Strudel's transpiler turns double-quoted (and backtick) strings into mini-notation.
 * The silent test runs plain JS, so do the same: "bd sd" → mini("bd sd").
 */
function miniStrings(code) {
  let out = '', i = 0;
  while (i < code.length) {
    const c = code[i], d = code[i + 1];
    if (c === '/' && d === '/') { const e = code.indexOf('\n', i); const j = e < 0 ? code.length : e; out += code.slice(i, j); i = j; continue; }
    if (c === '/' && d === '*') { const e = code.indexOf('*/', i + 2); const j = e < 0 ? code.length : e + 2; out += code.slice(i, j); i = j; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < code.length && code[j] !== c) j += code[j] === '\\' ? 2 : 1;
      const lit = code.slice(i, j + 1);
      out += c === "'" || (c === '`' && lit.includes('${')) ? lit : `mini(${c === '`' ? JSON.stringify(lit.slice(1, -1)) : lit})`;
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Play the library silently (no editor, no scheduler): build every part with every
 * progression and query a few bars. Returns an Error or null.
 */
function testLibrary(lib, sheet) {
  const ids = libraryIds(sheet);
  const body = miniStrings(lib.replace(/^\s*setcp[ms]\([^)]*\)\s*;?\s*$/gm, '')).replace(/\bslider\(/g, '__slider(') +
    `\nreturn (sectionChords) => stack(${ids.map((id) => partExpr(lib, id)).join(', ')});`;
  let make;
  try { make = new Function('__slider', '"use strict";\n' + body)((v) => v); }
  catch (e) { return e; }
  for (const prog of Object.values(sheet.chords)) {
    let pat;
    try { pat = make(globalThis.mini ? globalThis.mini(prog) : prog); } catch (e) { return e; }
    if (!pat || typeof pat.queryArc !== 'function') return new Error('the parts are not Strudel patterns');
    const err = dryRun(pat);
    if (err) return err;
  }
  return null;
}

async function writeSongSheet(song, signal) {
  const choice = formChoice();
  const prev = setl.songs[setl.songs.indexOf(song) - 1]?.sheet;
  let msg = `SONG: "${song.title}" — ${song.desc}\n` +
    (prev ? `The previous song was ${prev.bpm} bpm in ${prev.key}; this one should flow from it (a related key or a nearby tempo is nice).\n` : '') +
    `\n${formsForRequest(choice)}\n\nWrite the song sheet JSON.`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    song.phase = 'writing the song sheet';
    const text = await requestLLM({ mode: 'sheet', messages: [{ role: 'user', content: msg }], signal });
    try { return normalizeSheet(parseJSONLoose(text), choice); }
    catch (e) {
      lastErr = e;
      msg = msg.replace(/\n\nYOUR PREVIOUS REPLY[\s\S]*$/, '') +
        `\n\nYOUR PREVIOUS REPLY could not be used (${e.message}). Reply with ONLY the JSON object, exactly in the example's format.`;
    }
  }
  throw new Error(`no usable song sheet (${lastErr?.message})`);
}

/** Write (or repair) the part library. Returns checked, corrected library code. */
async function writeSongLibrary(song, signal, { fix = null, prev = null } = {}) {
  const sh = song.sheet;
  const fp = fillPart(sh);
  const need = libraryIds(sh).map((id) => {
    const p = sh.parts.find((q) => id.startsWith(q.id + '_'));
    const variant = id.slice(p.id.length + 1);
    const kind = HARMONIC_ROLE.test(p.role) ? 'function of prog' : 'plain pattern';
    const extra = p.role === 'melody' && /hook/.test(p.id + p.desc) ? ` — plays the hook: n("${sh.hook}").scale("${sh.scale}")` : '';
    const vdesc = variant === 'main' ? '' : variant === 'fill' && p === fp ? ' (ONE-bar fill leading into the next section)' : ` (${variant} version of ${p.id}_main)`;
    return `- ${id}  [${kind}]  ${p.role}, sound ${p.sound || '(your choice)'}: ${p.desc}${vdesc}${extra}`;
  });
  const base =
    `SONG: "${song.title}" — ${song.desc}\n` +
    `Tempo line: setcpm(${sh.bpm}/4)   Key / scale: ${sh.key} → .scale("${sh.scale}")\n` +
    `Chord progressions the sections use: ${Object.entries(sh.chords).map(([k, v]) => `${k} ${v}`).join(' · ')}\n` +
    `Hook (scale degrees): "${sh.hook}"\n\n` +
    `Write the part library. Define EXACTLY these consts:\n${need.join('\n')}`;
  let content = fix && prev
    ? `${base}\n\nTHE CURRENT LIBRARY:\n\`\`\`javascript\n${prev}\n\`\`\`\nIt failed when played: ${fix}${/scale/i.test(fix) ? '\n' + scaleHelp() : ''}\nReturn the corrected COMPLETE library.`
    : base;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    song.phase = fix ? 'fixing the parts' : 'writing the parts';
    const text = await requestLLM({ mode: 'library', messages: [{ role: 'user', content }], signal });
    let lib = extractCode(text);
    let err = null;
    if (!lib) err = 'no ```javascript code block in the reply';
    else {
      // the app owns the tempo line
      lib = `setcpm(${sh.bpm}/4)\n` + lib.replace(/^\s*setcp[ms]\([^)]*\)\s*;?\s*$/gm, '').trim();
      const missing = libraryIds(sh).filter((id) => !definesId(lib, id));
      if (missing.length) err = `these consts are missing: ${missing.join(', ')}`;
      else if (patternLines(lib).length) err = 'the library must not contain labelled lines like "drums:" or "$:" — only const definitions';
      else err = syntaxError(lib);
      if (!err) {
        const prep = await prepareCode(lib, { quiet: true });
        lib = prep.code;
        err = prep.error || testLibrary(lib, sh)?.message || null;
      }
    }
    if (!err) return lib;
    lastErr = err;
    content = `${base}\n\nYOUR PREVIOUS LIBRARY:\n\`\`\`javascript\n${lib || ''}\n\`\`\`\nIt can't be used: ${err}${/scale/i.test(err) ? '\n' + scaleHelp() : ''}\nReturn the corrected COMPLETE library.`;
  }
  throw new Error(`no usable part library (${lastErr})`);
}

/** Full program for one section: the library, then one labelled group per part. */
function sectionCode(song, sec, { fill = false } = {}) {
  const lib = song.library;
  const fp = fill ? fillPart(song.sheet) : null;
  const lines = [
    `// ${song.title} — ${sec.name}${fill ? ' (fill)' : ''} · ${fill ? 1 : sec.bars} bars · chords: ${sec.chords}`,
    LIB_START,
    lib.trim(),
    '',
    SEC_START,
    `const sectionChords = ${JSON.stringify(song.sheet.chords[sec.chords])}`,
  ];
  for (const x of sec.play) {
    const id = `${x.part}_${fp && x.part === fp.id ? 'fill' : x.variant}`;
    lines.push(`${x.part}: ${partExpr(lib, id)}.postgain(slider(1, 0, 1.5))`);
  }
  return lines.join('\n') + '\n';
}

/** Engine steps for a sheet song: one per section, plus a one-bar fill before choruses / drops. */
function arrangeSong(song) {
  const sh = song.sheet;
  const fp = fillPart(sh);
  const steps = [];
  sh.sections.forEach((sec, j) => {
    const next = sh.sections[j + 1];
    const wantFill = fp && next && ['chorus', 'drop'].includes(next.type) && sec.bars >= 4 &&
      sec.play.some((x) => x.part === fp.id) && next.type !== sec.type;
    const prevFill = steps[steps.length - 1]?.fillStep;
    steps.push({
      bars: wantFill ? sec.bars - 1 : sec.bars, prompt: sec.name, section: sec, code: sectionCode(song, sec),
      status: 'ready', error: null,
      // land a drop, and the downbeat after a fill, hard; everything else uses the fade setting
      fade: prevFill || sec.type === 'drop' ? 0 : undefined,
    });
    if (wantFill) {
      steps.push({ bars: 1, prompt: `${sec.name} · fill`, section: sec, fillStep: true, code: sectionCode(song, sec, { fill: true }), status: 'ready', error: null, fade: 0 });
    }
  });
  return steps;
}

/** A section failed when it was about to play: fix the library and re-arrange the song's unplayed sections. */
function repairSong(song, err) {
  song.repairing ||= (async () => {
    addMsg('info', `🔧 “${song.title}”: a section failed (${err}) — fixing the parts…`);
    song.library = await writeSongLibrary(song, setl.abort?.signal, { fix: err, prev: song.library });
    for (const st of song.blocks || []) {
      if (['playing', 'done', 'armed'].includes(st.status)) continue;
      st.code = sectionCode(song, st.section, { fill: !!st.fillStep });
      st.status = 'ready';
      st.error = null;
    }
  })().finally(() => { song.repairing = null; });
  return song.repairing;
}

/**
 * When the next section of the same song switches in, keep what the performer changed:
 * fader positions in the parts, group faders, and mute / solo.
 */
function carryLiveState(prev, next) {
  const span = (c) => { const a = c.indexOf(LIB_START), b = c.indexOf(SEC_START); return a >= 0 && b > a ? [a, b] : null; };
  const ps = span(prev), ns = span(next);
  let out = next;
  if (ps && ns && sliderless(prev.slice(...ps)) === sliderless(next.slice(...ns))) out = next.slice(0, ns[0]) + prev.slice(...ps) + next.slice(ns[1]);
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

/** Write (or reuse) a song's blocks and append them to the engine. */
/** Sheet → library → arranged steps; null when that fails (the song is then written block by block). */
async function sheetSteps(song) {
  song.status = 'writing';
  try {
    song.sheet = await writeSongSheet(song, setl.abort.signal);
    song.library = await writeSongLibrary(song, setl.abort.signal);
    song.phase = null;
    return arrangeSong(song);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    song.sheet = song.sheet || null;
    song.library = null;
    addMsg('info', `“${song.title}”: ${e.message} — writing it block by block instead`);
    return null;
  }
}

async function appendSong(k) {
  const song = setl.songs[k];
  if (!song) return;
  let steps;
  if (song.blocks?.length) {
    // already written (loop / jump back): reuse blocks and their code
    steps = song.blocks.map((b) => ({ ...b, status: b.code ? 'ready' : 'waiting', startedAt: undefined, genPromise: undefined, error: null }));
  } else if ((steps = await sheetSteps(song))) {
    // song sheet → part library → sections arranged by the app
  } else {
    song.status = 'writing';
    song.phase = 'writing blocks one by one';
    const prev = [...setlist.steps].reverse().find((st) => st.code)?.code || getCode();
    const lines = await writeBlocks(
      `Song "${song.title}": ${song.desc}\n` +
        'Write the blocks for this whole song: roughly 48–96 bars in total, starting with an intro and ending with an outro ' +
        'that can hand over to the next song. First line states tempo and key. Include sections that take parts away ' +
        'and sections that switch up the beat, not only ones that add layers.',
      prev,
      setl.abort.signal,
    );
    steps = parseSetlist(lines.join('\n'));
  }
  steps.forEach((st, j) => Object.assign(st, { song, songPos: j, songLen: steps.length, songStart: j === 0 }));
  song.blocks = steps;
  song.firstStep = steps[0];
  song.bars = steps.reduce((a, b) => a + b.bars, 0);
  if (song.status !== 'playing') song.status = 'ready';
  song.phase = null;
  appendSteps(steps);
  return steps;
}

async function stationMoreSongs() {
  const n = 3;
  const recent = setl.songs.slice(-12).map((sg) => `${sg.title} (${sg.desc.slice(0, 60)})`);
  const text = await requestLLM({
    mode: 'songs',
    messages: [{
      role: 'user',
      content: `STATION THEME: ${setl.station.theme}\n` +
        (recent.length ? `Already played or queued — do NOT repeat these, but keep a good flow from the last one:\n- ${recent.join('\n- ')}\n` : '') +
        `Write the next ${n} songs.`,
    }],
    signal: setl.abort.signal,
  });
  const songs = parseSongs(stripThinking(text).replace(/```[a-z]*\n?|```/g, '')).slice(0, n);
  if (!songs.length) throw new Error('the model did not return songs as "title | description" lines');
  setl.songs.push(...songs);
}

async function feedLoop() {
  let failures = 0;
  while (setl.running) {
    try {
      if (setl.forceJump !== null) {
        const k = setl.forceJump;
        setl.forceJump = null;
        setl.nextSong = k + 1;
        const steps = await appendSong(k);
        if (steps?.length && setl.running) jumpTo(setlist.steps.indexOf(steps[0]));
        continue;
      }
      const ahead = setl.nextSong - 1 - setl.current; // songs written but not yet playing
      if (ahead < 1 && setl.nextSong < setl.songs.length) {
        await appendSong(setl.nextSong++);
        failures = 0;
        continue;
      }
      if (ahead < 1 && setl.mode === 'set' && $('setLoop').checked && setl.songs.length) {
        setl.nextSong = 0;
        continue;
      }
      if (setl.mode === 'station' && setl.songs.length - (setl.current + 1) < Number($('stationAhead').value)) {
        const before = setl.songs.length;
        setl.planning = true;
        try { await stationMoreSongs(); } finally { setl.planning = false; }
        if (setl.songs.length > before) failures = 0;
        continue;
      }
    } catch (e) {
      if (e.name === 'AbortError' || !setl.running) return;
      const sg = setl.songs[setl.nextSong - 1];
      if (sg && sg.status === 'writing') { sg.status = 'failed'; sg.error = e.message; }
      addMsg('error', `${setl.mode === 'station' ? 'Station' : 'Set list'}: ${e.message}`);
      failures++;
      if (failures >= 5) { addMsg('error', 'Too many failures in a row — stopping.'); stopSet(); return; }
      await sleep(3000 * failures);
    }
    await sleep(400);
  }
}

function makeFeeder() {
  return {
    label: setl.mode === 'station' ? `station “${setl.station.name || 'untitled'}”` : 'set list',
    active: () => setl.running && (setl.mode === 'station' || setl.nextSong < setl.songs.length || setl.forceJump !== null ||
      ($('setLoop').checked && setl.songs.length > 0) || setl.songs.some((sg) => sg.status === 'writing')),
    onStepStart: (step) => {
      if (!step.song) return;
      const k = setl.songs.indexOf(step.song);
      if (k < 0 || (k === setl.current && step.song.status === 'playing')) return;
      setl.songs.forEach((sg) => { if (sg.status === 'playing' && sg !== step.song) sg.status = 'done'; });
      step.song.status = 'playing';
      step.song.playedAt = Date.now();
      setl.current = k;
      addMsg('info', `🎵 now playing: “${step.song.title}” — ${step.song.desc}`);
      if (setl.mode === 'station') document.title = `📻 ${step.song.title} · ${setl.station.name || 'Station'}`;
      // keep the station's memory bounded
      if (setl.mode === 'station' && setl.current > 30) {
        const cut = setl.current - 20;
        setl.songs.splice(0, cut);
        setl.current -= cut;
        setl.nextSong -= cut;
        if (songSel.station != null) songSel.station = songSel.station >= cut ? songSel.station - cut : null;
      }
    },
    onStop: () => stopSet(false),
  };
}

function startSet(mode, { at = 0, keepSongs = false } = {}) {
  if (keepSongs && setl.mode === mode && setl.songs.length) {
    // resume with the songs we already have (their written blocks/code are reused)
    setl.songs.forEach((sg) => { sg.status = sg.blocks ? 'ready' : 'waiting'; sg.error = null; });
  } else if (mode === 'set') {
    const songs = parseSongs($('setText').value);
    if (!songs.length) { addMsg('error', 'The set list is empty — add one song per line.'); return; }
    setl.songs = songs;
  } else {
    const st = currentStation();
    if (!st.theme.trim()) { addMsg('error', 'Give the station a theme first.'); return; }
    setl.station = { ...st };
    setl.songs = [];
  }
  stopSet(false);
  songSel[mode] = null; // follow the song that is playing
  Object.assign(setl, { running: true, mode, nextSong: at, current: at - 1, forceJump: null, abort: new AbortController(), textDirty: false });
  startSetlist({ steps: [], feeder: makeFeeder() });
  updateSetButtons();
  addMsg('info', mode === 'station'
    ? `📻 station “${setl.station.name || 'untitled'}” on air — planning songs…`
    : `▶ set started (${setl.songs.length} songs) — writing “${setl.songs[at].title}”…`);
  feedLoop();
}

function stopSet(stopEngine = true) {
  if (!setl.running) return;
  setl.running = false;
  setl.abort?.abort();
  setl.songs.forEach((sg) => { if (sg.status === 'writing') sg.status = 'waiting'; });
  if (stopEngine && setlist.feeder) stopSetlist();
  updateSetButtons();
  document.title = 'Strudel AI';
}

function jumpToSong(k, from = 'set') {
  const mode = setl.running ? setl.mode : 'set';
  if (!setl.running) return startSet(from, { at: k, keepSongs: from === 'station' || (setl.mode === 'set' && !setl.textDirty) });
  const song = setl.songs[k];
  if (!song) return;
  const i = song.firstStep ? setlist.steps.indexOf(song.firstStep) : -1;
  if (i >= 0) { song.status = 'ready'; jumpTo(i); return; }
  // not written yet (or trimmed): drop upcoming blocks of other songs and write this one next
  dropUpcomingSteps();
  setl.songs.forEach((sg, j) => { if (j !== setl.current && sg.status === 'ready' && !setlist.steps.includes(sg.firstStep)) sg.status = 'waiting'; });
  setl.forceJump = k;
  addMsg('info', `⏭ writing “${song.title}” — it will start on the next bar line when ready`);
  void mode;
}

function updateSetButtons() {
  const set = setl.running && setl.mode === 'set', st = setl.running && setl.mode === 'station';
  $('setStart').disabled = set; $('setStop').disabled = !set;
  $('stationStart').disabled = st; $('stationStop').disabled = !st;
}

const SONG_ICON = { waiting: '·', writing: '✎', ready: '✓', playing: '▶', done: '✔', failed: '✗' };
let lastSongsKey = '';
const songSel = { set: null, station: null }; // index of the song shown in each tab's song view

function songMeta(sg) {
  const sh = sg.sheet;
  if (sg.phase) return `✎ ${sg.phase}…`;
  if (!sg.blocks) return sh ? `${sh.bpm} bpm · ${sh.key}` : '';
  const coded = sg.blocks.filter((b) => b.code).length;
  return sh && sg.library
    ? `${sh.bpm} bpm · ${sh.key} · ${sh.sections.length} sections · ${sg.bars} bars · ~${fmtTime((sg.bars * 4 * 60) / sh.bpm)}`
    : `${sg.blocks.length} blocks · ${sg.bars} bars · ${coded}/${sg.blocks.length} coded`;
}
function songsHTML(songs, live, sel) {
  return songs.map((sg, k) => {
    const meta = songMeta(sg);
    return `<div class="song ${sg.status}${k === sel ? ' selected' : ''}" data-k="${k}" title="Show this song's sheet and sections">
      <span class="ico">${SONG_ICON[sg.status] || '·'}</span>
      <div class="body"><div class="t">${k + 1}. ${esc(sg.title)}</div><div class="d">${esc(sg.desc)}</div>
        ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}${sg.error ? `<div class="err">${esc(sg.error)}</div>` : ''}</div>
      <button class="jump" data-song="${k}" title="Switch to this song">⏭ go</button>
    </div>`;
  }).join('') + (live && setl.planning ? '<div class="song writing"><span class="ico">✎</span><div class="body"><div class="d">planning the next songs…</div></div></div>' : '');
}

/** The song sheet and the sections of one song, with live status and jump buttons. */
function songViewHTML(sg, live) {
  if (!sg) return '';
  const sh = sg.sheet;
  const isCurrent = live && setl.songs[setl.current] === sg;
  const complete = sg.blocks?.length && sg.blocks.every((b) => b.code) && !sg.phase;
  let h = `<div class="sv-head"><b>${esc(sg.title)}</b>${isCurrent ? ' <span class="sv-live">▶ playing</span>' : ''}
      ${complete && !setl.running && setl.songs.includes(sg) ? '<button class="sv-play" title="Play this song (already written — no AI needed)">▶ Play this song</button>' : ''}
      ${complete ? `<button class="sv-share" title="Create a link that plays this whole song: its sheet, parts and every section">🔗 Share song</button>` : ''}</div>
    <div class="sv-desc">${esc(sg.desc)}</div>`;
  if (sg.shareUrl) {
    h += `<div class="sv-shared">🔗 <input readonly value="${esc(sg.shareUrl)}" /><button class="sv-copy">📋 Copy</button><a href="${esc(sg.shareUrl)}" target="_blank" rel="noopener">open ↗</a></div>`;
  }
  if (sg.phase) h += `<div class="sv-phase">✎ ${esc(sg.phase)}…</div>`;
  if (sh) {
    h += `<div class="sv-grid">
      ${sh.form ? `<span class="k">form</span><span>${esc(sh.form)} · ${sh.sections.length} sections · ${sh.sections.reduce((a, x) => a + x.bars, 0)} bars</span>` : ''}
      <span class="k">tempo</span><span>${sh.bpm} bpm · ${esc(sh.key)} <code>${esc(sh.scale)}</code></span>
      <span class="k">chords</span><span>${Object.entries(sh.chords).map(([k, v]) => `<span class="chip"><b>${esc(k)}</b> ${esc(v.replace(/^<|>$/g, ''))}</span>`).join(' ')}</span>
      <span class="k">hook</span><span><code>${esc(sh.hook)}</code></span>
      <span class="k">parts</span><span>${sh.parts.map((p) => `<span class="chip part" style="--c:${vizColor(p.id)}" title="${esc(`${p.role} · ${p.desc}${p.variants.length > 1 ? ` · variants: ${p.variants.join(', ')}` : ''}`)}"><b>${esc(p.id)}</b> ${esc(p.sound)}</span>`).join(' ')}</span>
    </div>`;
  }
  const steps = sg.blocks || (sh ? sh.sections.map((sec) => ({ section: sec, bars: sec.bars, prompt: sec.name, status: 'waiting' })) : []);
  if (steps.length) {
    if (isCurrent) {
      h += `<div class="sv-tools"><button class="sv-hold" title="Stay on the current section until you pick another one">${setlist.hold ? '▶ continue the song' : '⏸ hold this section'}</button>
        <small class="muted">Alt+1…9 jump to a section</small></div>`;
    }
    h += '<div class="sv-sections">' + steps.map((st, j) => {
      const i = setlist.steps.indexOf(st);
      const queued = i >= 0 && setlist.jumpTarget === i && st.status !== 'armed' && st.status !== 'playing';
      const sec = st.section;
      const parts = sec ? sec.play.map((x) => `<span class="chip part" style="--c:${vizColor(x.part)}">${esc(x.part)}${x.variant !== 'main' ? `<small>.${esc(st.fillStep && fillPart(sh)?.id === x.part ? 'fill' : x.variant)}</small>` : st.fillStep && fillPart(sh)?.id === x.part ? '<small>.fill</small>' : ''}</span>`).join('') : '';
      const name = sec ? `${esc(st.prompt)}${sec && !st.fillStep ? ` <span class="sv-chords">${esc(sec.chords)}</span>` : ''}` : esc(st.prompt);
      return `<details class="step ${st.status}${queued ? ' queued' : ''}${st.fillStep ? ' fill' : ''}" data-j="${j}">
        <summary><span class="ico">${queued ? '⏭' : STATUS_ICON[st.status] || ''}</span>
          <span class="bars">${st.bars}</span><span class="prompt">${name}${parts ? `<span class="sv-parts">${parts}</span>` : ''}</span>
          ${st.error ? `<span class="err">— ${esc(st.error)}</span>` : ''}${queued ? '<span class="next">next</span>' : ''}
          ${i >= 0 ? `<button class="jump" data-i="${i}" title="Switch to this section${j < 9 && isCurrent ? ` (Alt+${j + 1})` : ''}">⏭ go</button>` : ''}</summary>
        ${st.code ? `<pre>${esc(st.code.slice(st.code.indexOf(SEC_START) >= 0 ? st.code.indexOf(SEC_START) : 0))}</pre>` : ''}
      </details>`;
    }).join('') + '</div>';
  }
  if (sg.library) h += `<details class="sv-lib"><summary>parts code (shared by every section)</summary><pre>${esc(sg.library)}</pre></details>`;
  return h;
}

function renderSongs() {
  // Songs tab: the running/last set (until the text is edited), otherwise a preview of the text
  const setSongs = setl.mode === 'set' && setl.songs.length && !setl.textDirty ? setl.songs : parseSongs($('setText').value);
  const stationSongs = setl.mode === 'station' ? setl.songs : [];
  const now = setl.mode === 'station' ? setl.songs[setl.current] : null;
  const pick = (tab, list) => {
    const k = songSel[tab] ?? (setl.running && setl.mode === tab && setl.current >= 0 ? setl.current : null);
    return k != null && list[k] ? k : null;
  };
  const selSet = pick('set', setSongs), selSt = pick('station', stationSongs);
  const stepKey = (sg) => sg?.blocks?.map((b) => b.status + (b.code ? b.code.length : 0) + (b.error || '')).join() || '';
  const key = JSON.stringify([setl.running, setl.mode, setl.planning, now?.title, selSet, selSt, setlist.hold, setlist.jumpTarget, setl.current,
    ...[setSongs, stationSongs].map((l) => l.map((sg) => [sg.title, sg.status, sg.phase, sg.bars, sg.blocks?.filter((b) => b.code).length, sg.error, !!sg.sheet, sg.shareUrl])),
    stepKey(setSongs[selSet]), stepKey(stationSongs[selSt])]);
  if (key === lastSongsKey) return;
  lastSongsKey = key;
  $('setStatus').innerHTML = songsHTML(setSongs, setl.running && setl.mode === 'set', selSet);
  $('stationStatus').innerHTML = songsHTML(stationSongs, setl.running && setl.mode === 'station', selSt);
  for (const [id, sg, live] of [['setSongView', setSongs[selSet], setl.running && setl.mode === 'set'], ['stationSongView', stationSongs[selSt], setl.running && setl.mode === 'station']]) {
    const el = $(id);
    const open = new Set([...el.querySelectorAll('details[open]')].map((d) => d.dataset.j ?? 'lib'));
    el.hidden = !sg;
    el.innerHTML = songViewHTML(sg, live);
    for (const d of el.querySelectorAll('details')) if (open.has(d.dataset.j ?? 'lib')) d.open = true;
  }
  const onAir = setl.mode === 'station' && setl.running;
  $('stationNow').hidden = !onAir;
  if (onAir) {
    $('stationNow').innerHTML = now
      ? `📻 <b>On air:</b> ${esc(now.title)}<div class="d">${esc(now.desc)}</div>`
      : '📻 <b>Warming up…</b><div class="d">the agent is planning and writing the first song</div>';
  }
}
setInterval(renderSongs, 300);
for (const id of ['setStatus', 'stationStatus']) {
  const tab = id === 'stationStatus' ? 'station' : 'set';
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('.jump[data-song]');
    if (b) { jumpToSong(Number(b.dataset.song), tab); return; }
    const row = e.target.closest('.song[data-k]');
    if (row) { const k = Number(row.dataset.k); songSel[tab] = songSel[tab] === k ? null : k; lastSongsKey = ''; renderSongs(); }
  });
}
for (const id of ['setSongView', 'stationSongView']) {
  $(id).addEventListener('click', (e) => {
    const go = e.target.closest('.jump[data-i]');
    if (go) { e.preventDefault(); e.stopPropagation(); jumpTo(Number(go.dataset.i)); return; }
    if (e.target.closest('.sv-hold')) { e.preventDefault(); setHold(!setlist.hold); renderSongs(); return; }
    const sg = viewedSong(id === 'stationSongView' ? 'station' : 'set');
    if (e.target.closest('.sv-share') && sg) { shareSong(sg, e.target.closest('.sv-share')); return; }
    if (e.target.closest('.sv-play') && sg) { jumpToSong(setl.songs.indexOf(sg), setl.mode || 'set'); return; }
    if (e.target.closest('.sv-copy') && sg?.shareUrl) {
      navigator.clipboard?.writeText(sg.shareUrl).then(() => { e.target.textContent = '✓ Copied'; }, () => {});
    }
  });
}

/** The song shown in a tab's song view (same choice renderSongs makes). */
function viewedSong(tab) {
  const list = tab === 'station' ? (setl.mode === 'station' ? setl.songs : [])
    : setl.mode === 'set' && setl.songs.length && !setl.textDirty ? setl.songs : parseSongs($('setText').value);
  const k = songSel[tab] ?? (setl.running && setl.mode === tab && setl.current >= 0 ? setl.current : null);
  return k != null ? list[k] : null;
}

/** Share a finished song: its sheet, parts and every arranged section, playable without the AI. */
async function shareSong(sg, btn) {
  btn.disabled = true;
  btn.textContent = 'creating link…';
  try {
    const steps = sg.blocks.map((b) => ({ bars: b.bars, prompt: b.prompt, code: b.code, fade: b.fade ?? null, fillStep: !!b.fillStep, section: b.section || null }));
    const r = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: steps[0].code,
        title: sg.title,
        song: { title: sg.title, desc: sg.desc, sheet: sg.sheet || null, library: sg.library || null, steps },
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    sg.shareUrl = location.origin + j.path;
    try { await navigator.clipboard.writeText(sg.shareUrl); } catch {}
    addMsg('info', `🔗 “${sg.title}” shared: ${sg.shareUrl} (link copied)`);
  } catch (e) {
    addMsg('error', `Sharing “${sg.title}” failed: ${e.message}`);
    btn.disabled = false;
    btn.textContent = '🔗 Share song';
  }
  lastSongsKey = '';
  renderSongs();
}

/** A shared whole song: load it into the Songs tab, ready to play without any AI calls. */
function loadSharedSong(s) {
  const song = {
    title: s.title || 'shared song', desc: s.desc || '', status: 'ready', sheet: s.sheet || null, library: s.library || null,
    blocks: s.steps.map((st) => ({ bars: st.bars, prompt: st.prompt, code: st.code, fade: st.fade ?? undefined, fillStep: st.fillStep, section: st.section || undefined, status: 'ready', error: null })),
  };
  song.bars = song.blocks.reduce((a, b) => a + b.bars, 0);
  song.firstStep = song.blocks[0];
  stopSet(); stopSetlist();
  Object.assign(setl, { mode: 'set', songs: [song], current: -1, nextSong: 0, textDirty: false });
  songSel.set = 0;
  lastSongsKey = '';
  document.querySelector('.tabs button[data-tab="setTab"]')?.click();
  return song;
}

$('setText').value = saved.setText ?? '';
$('setText').oninput = () => { save({ setText: $('setText').value }); if (setl.mode === 'set' && !setl.running) setl.textDirty = true; lastSongsKey = ''; };
if (saved.setLoop !== undefined) $('setLoop').checked = saved.setLoop;
$('setLoop').onchange = () => save({ setLoop: $('setLoop').checked });
$('setStart').onclick = () => startSet('set');
$('setStop').onclick = () => { stopSet(); cancelPending(true); addMsg('info', '■ set stopped'); };
$('setWrite').onclick = async () => {
  const idea = prompt('What should the set be? (e.g. "a 5-song chill-to-dance warm-up set for a rooftop party")');
  if (!idea) return;
  const btn = $('setWrite');
  btn.disabled = true; btn.textContent = 'writing…';
  try {
    const text = await requestLLM({ mode: 'songs', messages: [{ role: 'user', content: `SET THEME: ${idea}\nWrite 5 songs for this set, in playing order.` }] });
    const songs = parseSongs(stripThinking(text).replace(/```[a-z]*\n?|```/g, ''));
    if (!songs.length) throw new Error('the model did not return songs as "title | description" lines');
    $('setText').value = `# ${idea}\n` + songs.map((sg) => `${sg.title} | ${sg.desc}`).join('\n');
    $('setText').oninput();
  } catch (e) {
    addMsg('error', `Writing the set list failed: ${e.message}`);
  } finally {
    btn.disabled = false; btn.textContent = '✨ Write with AI';
  }
};

// --- saved stations
const DEFAULT_STATIONS = [
  { name: 'Late Night Lo-fi', theme: 'late-night lo-fi hip hop with jazzy Rhodes chords, dusty drums and soft bass, 70–90 bpm, rainy city mood' },
  { name: 'Neon Highway', theme: 'synthwave and outrun: driving basslines, gated pads, arpeggios, 95–118 bpm, minor keys, nostalgic 80s night drive' },
  { name: 'Deep Focus', theme: 'minimal ambient techno for concentration: steady soft kick, evolving pads, subtle percussion, 110–122 bpm, no harsh sounds' },
];
let stations = load().stations || DEFAULT_STATIONS;
let stationIdx = Math.min(load().stationIdx ?? 0, stations.length - 1);
const currentStation = () => ({ name: stations[stationIdx]?.name || '', theme: stations[stationIdx]?.theme || '' });
function renderStations() {
  const opts = stations.map((st, i) => `<option value="${i}">${esc(st.name || 'untitled')}</option>`).join('');
  for (const id of ['stationSelect', 'stationEditSelect']) { $(id).innerHTML = opts; $(id).value = String(stationIdx); }
  $('stationName').value = stations[stationIdx]?.name || '';
  $('stationTheme').value = stations[stationIdx]?.theme || '';
  $('stationThemeView').textContent = stations[stationIdx]?.theme || 'No theme yet — ✎ edit stations to write one.';
}
function saveStations() { save({ stations, stationIdx }); }
renderStations();
for (const id of ['stationSelect', 'stationEditSelect']) $(id).onchange = () => { stationIdx = Number($(id).value); saveStations(); renderStations(); };
for (const id of ['stationName', 'stationTheme']) {
  $(id).oninput = () => {
    stations[stationIdx] = { name: $('stationName').value.trim(), theme: $('stationTheme').value.trim() };
    saveStations();
    const name = $('stationName').value || 'untitled';
    for (const sel of ['stationSelect', 'stationEditSelect']) if ($(sel).options[stationIdx]) $(sel).options[stationIdx].textContent = name;
    $('stationThemeView').textContent = $('stationTheme').value || 'No theme yet — ✎ edit stations to write one.';
  };
}
$('stationNew').onclick = () => { stations.push({ name: 'New station', theme: '' }); stationIdx = stations.length - 1; saveStations(); renderStations(); $('stationTheme').focus(); };
$('stationDelete').onclick = () => {
  if (!confirm(`Delete station “${stations[stationIdx]?.name}”?`)) return;
  stations.splice(stationIdx, 1);
  if (!stations.length) stations = [{ name: 'New station', theme: '' }];
  stationIdx = Math.max(0, stationIdx - 1);
  saveStations(); renderStations();
};
if (saved.stationAhead) $('stationAhead').value = saved.stationAhead;
$('stationAhead').onchange = () => save({ stationAhead: $('stationAhead').value });
$('stationStart').onclick = () => startSet('station');
$('stationStop').onclick = () => { stopSet(); cancelPending(true); addMsg('info', '■ station stopped'); };

// ---------------------------------------------------------------------------
// Docked visualizer: a piano roll of the pattern that is playing (read straight
// from the scheduler, so it also shows what's coming up) plus a spectrum or
// oscilloscope of the master output.
// ---------------------------------------------------------------------------
const viz = { on: false, analyser: null, src: null, haps: [], pat: null, from: null, colors: new Map(), raf: 0, freq: null, wave: null };

function vizColor(name) {
  let c = viz.colors.get(name);
  if (!c) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    c = `hsl(${h % 360}, 72%, 62%)`;
    viz.colors.set(name, c);
  }
  return c;
}

/** Note events from 1 cycle back to 3 cycles ahead, re-queried once per cycle or when the pattern changes. */
function vizHaps() {
  const pat = scheduler()?.pattern;
  if (!pat || !isPlaying()) return [];
  const from = Math.floor(nowCycle()) - 1;
  if (viz.pat === pat && viz.from === from) return viz.haps;
  viz.pat = pat;
  viz.from = from;
  const prevDry = inDryRun;
  vizQuerying = true;
  inDryRun = true; // errors from this query are the playing code's, already reported
  try {
    viz.haps = pat.queryArc(from, from + 5, { _cps: cps() })
      .filter((h) => h.whole && (!h.hasOnset || h.hasOnset()))
      .map((h) => {
        const v = h.value && typeof h.value === 'object' ? h.value : { note: h.value };
        const pitched = v.note !== undefined || v.freq !== undefined;
        const midi = pitched ? toMidi(v) : NaN;
        return {
          b: h.whole.begin.valueOf(),
          e: h.whole.end.valueOf(),
          midi,
          name: String(v.s ?? (pitched ? 'synth' : '?')) + (v.bank && !Number.isFinite(midi) ? `·${v.bank}` : ''),
          s: String(v.s ?? 'synth'),
        };
      });
  } catch {
    viz.haps = [];
  } finally {
    vizQuerying = false;
    inDryRun = prevDry;
  }
  return viz.haps;
}

function vizAnalyser() {
  let node = null;
  try { node = globalThis.getSuperdoughAudioController?.().output.destinationGain; } catch {}
  if (!node) return null;
  if (viz.src !== node) {
    const ctx = node.context;
    const mk = () => { const a = ctx.createAnalyser(); a.fftSize = 2048; a.smoothingTimeConstant = 0.78; return a; };
    viz.analyser = mk();
    node.connect(viz.analyser);
    // left / right for the stereo views
    const split = ctx.createChannelSplitter(2);
    node.connect(split);
    viz.left = mk();
    viz.right = mk();
    split.connect(viz.left, 0);
    split.connect(viz.right, 1);
    viz.src = node;
    viz.freq = new Uint8Array(viz.analyser.frequencyBinCount);
    viz.wave = new Float32Array(viz.analyser.fftSize);
    viz.waveL = new Float32Array(viz.analyser.fftSize);
    viz.waveR = new Float32Array(viz.analyser.fftSize);
  }
  return viz.analyser;
}
function drawRoll(g, x0, y0, w, h) {
  const now = nowCycle();
  const span = 3, back = 1; // cycles visible, playhead at 1/3
  const t0 = now - back;
  const X = (t) => x0 + ((t - t0) / span) * w;
  // bar + beat grid
  for (let b = Math.floor(t0 * 4) / 4; b <= t0 + span; b += 0.25) {
    const bar = Math.abs(b - Math.round(b)) < 1e-6;
    g.strokeStyle = bar ? '#2f3443' : '#181b23';
    g.beginPath(); g.moveTo(X(b) + 0.5, y0); g.lineTo(X(b) + 0.5, y0 + h); g.stroke();
    if (bar && isPlaying()) { g.fillStyle = '#4a5063'; g.font = '10px ui-monospace, monospace'; g.fillText(String(Math.round(b) + 1), X(b) + 3, y0 + 11); }
  }
  const haps = vizHaps().filter((n) => n.e > t0 && n.b < t0 + span);
  if (!haps.length) {
    g.fillStyle = '#4a5063';
    g.font = '12px system-ui, sans-serif';
    g.fillText(isPlaying() ? 'nothing playing in this pattern' : 'press ▶ Play to see the music', x0 + 12, y0 + h / 2);
    return;
  }
  const pitched = haps.filter((n) => Number.isFinite(n.midi));
  const lanes = [...new Set(haps.filter((n) => !Number.isFinite(n.midi)).map((n) => n.name))].sort();
  const laneH = lanes.length ? Math.max(6, Math.min(14, (h * (pitched.length ? 0.4 : 0.92)) / lanes.length)) : 0;
  const drumsH = laneH * lanes.length;
  const pitchH = h - drumsH - (lanes.length && pitched.length ? 6 : 0) - 14;
  const lo = pitched.length ? Math.min(...pitched.map((n) => n.midi)) - 2 : 0;
  const hi = pitched.length ? Math.max(...pitched.map((n) => n.midi)) + 2 : 1;
  const rowH = pitched.length ? Math.max(2, Math.min(10, pitchH / (hi - lo + 1))) : 0;
  const Y = (m) => y0 + 14 + (pitchH - rowH) * (1 - (m - lo) / Math.max(1, hi - lo));
  const alpha = (n) => (n.b <= now && now < n.e ? 1 : n.e <= now ? 0.35 : 0.6);
  for (const n of pitched) {
    g.globalAlpha = alpha(n);
    g.fillStyle = vizColor(n.s);
    g.fillRect(X(n.b) + 1, Y(n.midi), Math.max(2, X(n.e) - X(n.b) - 2), rowH);
  }
  const dy = y0 + h - drumsH;
  lanes.forEach((name, k) => {
    const y = dy + k * laneH;
    g.globalAlpha = 1;
    g.fillStyle = k % 2 ? '#101218' : '#0d0f14';
    g.fillRect(x0, y, w, laneH);
    for (const n of haps) {
      if (n.name !== name) continue;
      g.globalAlpha = alpha(n);
      g.fillStyle = vizColor(n.s);
      g.fillRect(X(n.b) + 1, y + 1, Math.max(3, Math.min(X(n.e) - X(n.b) - 2, 10)), laneH - 2);
    }
    g.globalAlpha = 0.85;
    g.fillStyle = '#8b90a0';
    g.font = `${Math.min(10, laneH)}px ui-monospace, monospace`;
    g.fillText(name, x0 + 3, y + laneH - 2);
  });
  g.globalAlpha = 1;
  g.strokeStyle = '#ffd166';
  g.beginPath(); g.moveTo(X(now) + 0.5, y0); g.lineTo(X(now) + 0.5, y0 + h); g.stroke();
}

/** Fills viz.waveL / viz.waveR; a mono output (silent right channel) is mirrored to both. */
function vizStereo() {
  if (!vizAnalyser()) return false;
  viz.left.getFloatTimeDomainData(viz.waveL);
  viz.right.getFloatTimeDomainData(viz.waveR);
  if (!viz.waveR.some((v) => v !== 0)) viz.waveR.set(viz.waveL);
  return true;
}
/** Log-spaced band levels 0..1 (30 Hz – 16 kHz). */
function vizBands(n) {
  const an = vizAnalyser();
  if (!an) return null;
  an.getByteFrequencyData(viz.freq);
  const bins = viz.freq.length, nyq = an.context.sampleRate / 2;
  const fLo = Math.log(30), fHi = Math.log(Math.min(16000, nyq));
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const fa = Math.exp(fLo + ((fHi - fLo) * k) / n), fb = Math.exp(fLo + ((fHi - fLo) * (k + 1)) / n);
    const ia = Math.floor((fa / nyq) * bins), ib = Math.max(ia + 1, Math.floor((fb / nyq) * bins));
    let v = 0;
    for (let i = ia; i < ib && i < bins; i++) v = Math.max(v, viz.freq[i]);
    out[k] = v / 255;
  }
  return out;
}
const vizLabel = (g, text, x, y) => { g.fillStyle = '#4a5063'; g.font = '10px ui-monospace, monospace'; g.fillText(text, x + 4, y + 11); };

function drawSpectrum(g, x0, y0, w, h) {
  const bars = Math.max(16, Math.floor(w / 5));
  const lv = vizBands(bars);
  if (!lv) return;
  for (let k = 0; k < bars; k++) {
    const bh = lv[k] * h;
    g.fillStyle = `hsl(${250 - (k / bars) * 90}, 80%, ${45 + lv[k] * 25}%)`;
    g.fillRect(x0 + (k * w) / bars, y0 + h - bh, w / bars - 1, bh);
  }
}

/** Index of a rising zero crossing, so periodic waves stand still. */
function zeroCross(buf) {
  for (let i = 1; i < buf.length / 2; i++) if (buf[i - 1] < 0 && buf[i] >= 0) return i;
  return 0;
}
function traceWave(g, buf, s0, x0, y0, w, h, color) {
  const n = buf.length / 2;
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const x = x0 + (i / n) * w, y = y0 + h / 2 - buf[s0 + i] * (h / 2) * 0.9;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  g.lineWidth = 1;
}
function drawScope(g, x0, y0, w, h) {
  const an = vizAnalyser();
  if (!an) return;
  an.getFloatTimeDomainData(viz.wave);
  g.strokeStyle = '#1d2029';
  g.beginPath(); g.moveTo(x0, y0 + h / 2); g.lineTo(x0 + w, y0 + h / 2); g.stroke();
  traceWave(g, viz.wave, zeroCross(viz.wave), x0, y0, w, h, '#20d3a6');
}
function drawStereoScope(g, x0, y0, w, h) {
  if (!vizStereo()) return;
  const s0 = zeroCross(viz.waveL);
  for (const [buf, y, c, name] of [[viz.waveL, y0, '#20d3a6', 'L'], [viz.waveR, y0 + h / 2, '#7c5cff', 'R']]) {
    g.strokeStyle = '#1d2029';
    g.beginPath(); g.moveTo(x0, y + h / 4); g.lineTo(x0 + w, y + h / 4); g.stroke();
    traceWave(g, buf, s0, x0, y, w, h / 2, c);
    vizLabel(g, name, x0, y);
  }
}
/** Vectorscope: mid (L+R) up, side (L−R) across — mono is a vertical line, wide stereo a cloud. */
function drawVectorscope(g, x0, y0, w, h) {
  if (!vizStereo()) return;
  const r = Math.min(w, h) / 2 - 6, cx = x0 + w / 2, cy = y0 + h / 2;
  g.strokeStyle = '#1d2029';
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.stroke();
  g.fillStyle = 'rgba(32, 211, 166, .55)';
  const L = viz.waveL, R = viz.waveR;
  for (let i = 0; i < L.length; i += 2) {
    const side = (L[i] - R[i]) * 0.707, mid = (L[i] + R[i]) * 0.707;
    g.fillRect(cx + Math.max(-1, Math.min(1, side)) * r, cy - Math.max(-1, Math.min(1, mid)) * r, 1.5, 1.5);
  }
  vizLabel(g, 'vector', x0, y0);
}
/** Scrolling spectrogram (time → right, low notes at the bottom). */
function drawSpectrogram(g, x0, y0, w, h) {
  const rows = Math.max(32, Math.min(160, Math.floor(h / 2)));
  const lv = vizBands(rows);
  if (!lv) return;
  const dpr = devicePixelRatio || 1;
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  let c = viz.specCanvas;
  if (!c || c.width !== W || c.height !== H) {
    c = viz.specCanvas = document.createElement('canvas');
    c.width = W; c.height = H;
    const sg = c.getContext('2d');
    sg.fillStyle = '#0b0c10';
    sg.fillRect(0, 0, W, H);
  }
  const sg = c.getContext('2d');
  const step = Math.max(1, Math.round(2 * dpr));
  sg.drawImage(c, -step, 0);
  for (let k = 0; k < rows; k++) {
    const v = lv[k];
    sg.fillStyle = v < 0.02 ? '#0b0c10' : `hsl(${260 - v * 220}, 85%, ${8 + v * 55}%)`;
    const y = H - ((k + 1) * H) / rows;
    sg.fillRect(W - step, Math.floor(y), step, Math.ceil(H / rows) + 1);
  }
  g.drawImage(c, x0, y0, w, h);
}
/** Circular spectrum around a waveform ring. */
function drawRadial(g, x0, y0, w, h) {
  const n = 96;
  const lv = vizBands(n);
  if (!lv) return;
  const cx = x0 + w / 2, cy = y0 + h / 2, r0 = Math.min(w, h) * 0.22, rMax = Math.min(w, h) / 2 - 4;
  g.lineWidth = Math.max(1.5, (2 * Math.PI * r0) / n - 1.5);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 - Math.PI / 2, len = lv[k] * (rMax - r0);
    g.strokeStyle = `hsl(${(k / n) * 300 + 200}, 80%, ${45 + lv[k] * 25}%)`;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
    g.stroke();
  }
  g.lineWidth = 1.5;
  viz.analyser.getFloatTimeDomainData(viz.wave);
  g.strokeStyle = '#e6e8ee';
  g.beginPath();
  const m = 256, s0 = zeroCross(viz.wave);
  for (let i = 0; i <= m; i++) {
    const a = (i / m) * Math.PI * 2 - Math.PI / 2, rr = r0 * (0.75 + viz.wave[s0 + i * 2] * 0.5);
    i ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.stroke();
  g.lineWidth = 1;
}
/** L/R level meters: RMS bar, peak tick with hold, dB scale. */
function drawMeters(g, x0, y0, w, h) {
  if (!vizStereo()) return;
  const db = (v) => (v > 0 ? 20 * Math.log10(v) : -96);
  const norm = (d) => Math.max(0, Math.min(1, (d + 48) / 48)); // −48 dB … 0 dB
  viz.peaks ||= [0, 0];
  const now = performance.now();
  const bw = Math.min(46, (w - 50) / 2);
  [viz.waveL, viz.waveR].forEach((buf, ch) => {
    let sum = 0, pk = 0;
    for (const v of buf) { sum += v * v; pk = Math.max(pk, Math.abs(v)); }
    const rms = norm(db(Math.sqrt(sum / buf.length))), peak = norm(db(pk));
    const hold = viz.peaks[ch];
    viz.peaks[ch] = peak >= hold ? peak : Math.max(peak, hold - (now - (viz.peakT || now)) / 2500);
    const x = x0 + 30 + ch * (bw + 10);
    const grd = g.createLinearGradient(0, y0 + h, 0, y0);
    grd.addColorStop(0, '#20d3a6'); grd.addColorStop(0.75, '#ffd166'); grd.addColorStop(1, '#ff5c7a');
    g.fillStyle = '#16181f';
    g.fillRect(x, y0 + 4, bw, h - 8);
    g.fillStyle = grd;
    g.fillRect(x, y0 + 4 + (h - 8) * (1 - rms), bw, (h - 8) * rms);
    g.fillStyle = '#e6e8ee';
    g.fillRect(x, y0 + 4 + (h - 8) * (1 - viz.peaks[ch]), bw, 2);
    vizLabel(g, ch ? 'R' : 'L', x + bw / 2 - 8, y0 + h - 16);
  });
  viz.peakT = now;
  g.fillStyle = '#4a5063';
  g.font = '9px ui-monospace, monospace';
  for (const d of [0, -6, -12, -24, -36, -48]) g.fillText(String(d), x0 + 2, y0 + 8 + (h - 8) * (1 - norm(d)));
}

const VIZ_MODES = {
  roll: (g, w, h) => drawRoll(g, 0, 0, w, h),
  spectrum: (g, w, h) => drawSpectrum(g, 0, 0, w, h),
  scope: (g, w, h) => drawScope(g, 0, 0, w, h),
  stereo: (g, w, h) => drawStereoScope(g, 0, 0, w, h),
  vector: (g, w, h) => drawVectorscope(g, 0, 0, w, h),
  spectrogram: (g, w, h) => drawSpectrogram(g, 0, 0, w, h),
  radial: (g, w, h) => drawRadial(g, 0, 0, w, h),
  meters: (g, w, h) => drawMeters(g, 0, 0, w, h),
  all: (g, w, h) => {
    const sh = Math.max(30, Math.round(h * 0.28));
    drawRoll(g, 0, 0, w, h - sh - 2);
    drawSpectrum(g, 0, h - sh, w, sh);
  },
  rollscope: (g, w, h) => {
    const sh = Math.max(30, Math.round(h * 0.32));
    drawRoll(g, 0, 0, w, h - sh - 2);
    drawScope(g, 0, h - sh, w, sh);
  },
  dashboard: (g, w, h) => {
    // scope | spectrum | vectorscope | meters, side by side
    const vw = Math.min(h, w * 0.22), mw = Math.min(110, w * 0.12);
    const rest = w - vw - mw - 12, sw = rest / 2;
    drawScope(g, 0, 0, sw - 4, h);
    drawSpectrum(g, sw, 0, sw - 4, h);
    drawVectorscope(g, rest + 4, 0, vw, h);
    drawMeters(g, rest + vw + 12, 0, mw, h);
    g.strokeStyle = '#1d2029';
    for (const x of [sw - 2, rest + 2, rest + vw + 8]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  },
};

function drawViz() {
  if (!viz.on) return;
  viz.raf = requestAnimationFrame(drawViz);
  const c = $('vizCanvas');
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  const dpr = devicePixelRatio || 1;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  (VIZ_MODES[$('vizMode').value] || VIZ_MODES.all)(g, w, h);
}

// ---------------------------------------------------------------------------
// Docks: the visualizer, keyboard and pads share docking (under / above the code
// or in the side panel), resizing, show / hide, and a remembered layout.
// ---------------------------------------------------------------------------
const docks = {};
function setupDock(name, { onShow, onHide } = {}) {
  const el = $(`${name}-dock`), sel = $(`${name}Dock`), btn = $(`${name}Btn`), handle = $(`${name}Handle`);
  const d = { name, el, on: false };
  const relayout = () => { lastMixerKey = ''; window.dispatchEvent(new Event('resize')); };
  d.place = (where) => {
    if (where === 'side') $('chat-pane').insertBefore(el, $('chat-pane').firstChild);
    else if (where === 'top') $('editor-pane').insertBefore(el, $('editor-wrap'));
    else { where = 'bottom'; $('editor-pane').insertBefore(el, $('editor-wrap').nextSibling); }
    el.classList.remove('dock-bottom', 'dock-top', 'dock-side');
    el.classList.add(`dock-${where}`);
    sel.value = where;
    relayout();
  };
  d.show = (on) => {
    d.on = on;
    el.hidden = !on;
    btn.classList.toggle('on', on);
    (on ? onShow : onHide)?.();
    relayout();
  };
  const st = load();
  if (st[`${name}H`]) el.style.setProperty('--viz-h', st[`${name}H`] + 'px');
  d.place(st[`${name}Dock`] || 'bottom');
  btn.onclick = () => { d.show(!d.on); save({ [`${name}On`]: d.on }); };
  $(`${name}Close`).onclick = () => { d.show(false); save({ [`${name}On`]: false }); };
  sel.onchange = () => { d.place(sel.value); save({ [`${name}Dock`]: sel.value }); };
  let drag = null;
  handle.addEventListener('pointerdown', (e) => {
    drag = { y: e.clientY, h: el.getBoundingClientRect().height, down: sel.value !== 'bottom' };
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('viz-resizing');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    el.style.setProperty('--viz-h', Math.round(Math.max(90, Math.min(window.innerHeight * 0.7, drag.h + (drag.down ? dy : -dy)))) + 'px');
    lastMixerKey = '';
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    document.body.classList.remove('viz-resizing');
    save({ [`${name}H`]: Math.round(el.getBoundingClientRect().height) });
    relayout();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  d.show(!!st[`${name}On`]);
  docks[name] = d;
  return d;
}

if (load().vizMode) $('vizMode').value = load().vizMode;
$('vizMode').onchange = () => save({ vizMode: $('vizMode').value });
setupDock('viz', {
  onShow: () => { viz.on = true; cancelAnimationFrame(viz.raf); drawViz(); },
  onHide: () => { viz.on = false; cancelAnimationFrame(viz.raf); },
});

// ---------------------------------------------------------------------------
// About: version, recent changes (from CHANGELOG.md) and project links.
// ---------------------------------------------------------------------------
/** Tiny renderer for the changelog: "## x.y.z" headings, "- " bullets, **bold**, `code`. */
function renderChangelog(md, versions = 3) {
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const parts = md.split(/^## /m).slice(1, versions + 1);
  if (!parts.length) return '<p class="muted">No changelog available.</p>';
  return parts.map((p) => {
    const [head, ...lines] = p.split('\n');
    let html = `<h4>${head.trim() === APP_VERSION ? `v${esc(head.trim())} <span class="tag">this version</span>` : 'v' + esc(head.trim())}</h4><ul>`;
    let item = null;
    const flush = () => { if (item !== null) html += `<li>${inline(item)}</li>`; item = null; };
    for (const l of lines) {
      const m = l.match(/^\s*- (.*)$/);
      if (m && !/^\s{2,}-/.test(l)) { flush(); item = m[1]; }
      else if (m) { flush(); html += `<li class="sub">${inline(m[1])}</li>`; }
      else if (l.trim() && item !== null) item += ' ' + l.trim();
    }
    flush();
    return html + '</ul>';
  }).join('');
}

async function openAbout() {
  const dlg = $('aboutDlg');
  $('aboutVersion').textContent = 'v' + APP_VERSION;
  $('aboutBuild').textContent = `build ${APP_BUILD}`;
  if (!dlg.open) dlg.showModal();
  try {
    const a = await fetch('/api/about', { cache: 'no-cache' }).then((r) => r.json());
    const repo = a.repo || 'https://github.com/eric256/strudel-ai';
    $('aboutRepo').href = repo;
    $('aboutIssues').href = repo + '/issues';
    $('aboutReleases').href = repo + '/releases';
    $('aboutChangelog').href = repo + '/blob/main/CHANGELOG.md';
    if (a.version && a.version !== APP_VERSION) $('aboutBuild').textContent += ` · v${a.version} is deployed — it loads when you stop`;
    $('aboutChanges').innerHTML = renderChangelog(a.changelog || '');
  } catch (e) {
    $('aboutChanges').textContent = `Couldn't load the changelog: ${e.message}`;
  }
}
$('aboutBtn').onclick = openAbout;
$('appVersion').onclick = openAbout;
$('aboutClose').onclick = () => $('aboutDlg').close();
$('aboutDlg').addEventListener('click', (e) => { if (e.target === $('aboutDlg')) $('aboutDlg').close(); }); // click outside

// ---------------------------------------------------------------------------
// ⚙ Settings: live edit, fade, autocomplete, song forms, stations, backup.
// Everything is kept in localStorage (STORE_KEY), so it survives reloads and updates.
// ---------------------------------------------------------------------------
function openSettings(sec = 'setGeneral') {
  for (const b of document.querySelectorAll('.settings-tabs button')) b.classList.toggle('active', b.dataset.sec === sec);
  for (const el of document.querySelectorAll('.settings-sec')) el.hidden = el.id !== sec;
  if (sec === 'setForms') renderFormsEditor();
  if (sec === 'setStations') renderStations();
  $('settingsMsg').textContent = '';
  if (!$('settingsDlg').open) $('settingsDlg').showModal();
}
$('settingsBtn').onclick = () => openSettings();
$('settingsClose').onclick = () => $('settingsDlg').close();
$('settingsDlg').addEventListener('click', (e) => { if (e.target === $('settingsDlg')) $('settingsDlg').close(); });
for (const b of document.querySelectorAll('.settings-tabs button')) b.onclick = () => openSettings(b.dataset.sec);
for (const b of document.querySelectorAll('.stations-edit')) b.onclick = () => openSettings('setStations');
$('settingsExport').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'strudel-ai', version: APP_VERSION, exported: new Date().toISOString(), settings: load() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `strudel-ai-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $('settingsMsg').textContent = '✓ exported';
};
$('settingsImport').onchange = async () => {
  const f = $('settingsImport').files[0];
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    const st = j.settings || j;
    if (!st || typeof st !== 'object' || Array.isArray(st)) throw new Error('not a settings file');
    if (!confirm('Replace this browser\'s settings, forms, stations and pads with the ones in this file?')) return;
    localStorage.setItem(STORE_KEY, JSON.stringify(st));
    saveSession();
    location.reload();
  } catch (e) {
    $('settingsMsg').textContent = `⚠ couldn't import: ${e.message}`;
  }
};
$('settingsReset').onclick = () => {
  if (!confirm('Reset everything this browser has saved (settings, forms, stations, pads, layout and your code)?')) return;
  try { localStorage.removeItem(STORE_KEY); } catch {}
  location.reload();
};

// ---------------------------------------------------------------------------
// Status bar (bottom): bar.beat + tempo, the song / section playing, the pending
// change, the recording, replay and update notices.
// ---------------------------------------------------------------------------
setInterval(() => {
  const step = setlist.running ? setlist.steps.find((s) => s.status === 'playing') : null;
  const sg = $('sbSong');
  if (step) {
    const pos = step.song?.blocks ? ` (${step.song.blocks.indexOf(step) + 1}/${step.song.blocks.length})` : '';
    sg.hidden = false;
    sg.textContent = `${step.song ? `🎵 ${step.song.title} · ` : '▶ '}${step.prompt}${pos}${setlist.hold ? ' · ⏸ held' : ''}`;
  } else sg.hidden = true;
  const take = rec.take?.events.length ? rec.take : null;
  $('sbRec').textContent = take ? `⏺ ${take.events.length} change${take.events.length > 1 ? 's' : ''} · ${fmtTime(takeSeconds(take))}` : '';
}, 250);

// ---------------------------------------------------------------------------
// 🎹 Keys: an on-screen keyboard (also the computer keyboard and MIDI keyboards)
// that plays a sound live through Strudel's engine. ⏺ Rec captures what you play
// on the bar grid and turns it into a note("…") part.
// ---------------------------------------------------------------------------
const keysState = { oct: Number(load().keysOct) || 4, rec: null, held: new Map(), kbd: new Map(), midiInputs: [], result: null };
const KEY_LETTERS = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16 };
const isBlack = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);

function keysSounds() {
  const reg = globalThis.soundMap?.get?.() || {};
  const synths = Object.keys(reg).filter((k) => reg[k].data?.type === 'synth' && !['user', 'bus', 'one'].includes(k));
  const fonts = Object.keys(reg).filter((k) => reg[k].data?.type === 'soundfont');
  const samples = ['piano'].filter((k) => reg[k]);
  return [...samples, ...synths, ...fonts];
}
function renderKeysSounds() {
  const list = keysSounds();
  const sel = $('keysSound');
  if (sel.options.length === list.length) return;
  const want = sel.value || load().keysSound || (list.includes('piano') ? 'piano' : 'triangle');
  sel.innerHTML = list.map((k) => `<option>${esc(k)}</option>`).join('') || '<option>triangle</option>';
  sel.value = list.includes(want) ? want : sel.options[0].value;
}
$('keysSound').onchange = () => save({ keysSound: $('keysSound').value });

function renderKeyboard() {
  const lo = keysState.oct * 12 + 12; // c<oct>
  const whites = [];
  for (let m = lo; m <= lo + 24; m++) if (!isBlack(m)) whites.push(m);
  const w = 100 / whites.length;
  let html = '';
  whites.forEach((m, i) => {
    html += `<div class="key white" data-m="${m}" style="left:${i * w}%;width:${w}%"><span>${m % 12 === 0 ? midiToName(m) : ''}</span></div>`;
  });
  whites.forEach((m, i) => {
    if (m + 1 <= lo + 24 && isBlack(m + 1)) html += `<div class="key black" data-m="${m + 1}" style="left:${(i + 0.68) * w}%;width:${w * 0.64}%"></div>`;
  });
  $('keysBoard').innerHTML = html;
  $('keysOct').textContent = keysState.oct;
}

function keysCycle() {
  // the cycle you HEAR right now (what you play along to), or time-based when nothing plays
  const c = audibleCycle(0);
  return c ?? (performance.now() - (keysState.rec?.t0 ?? performance.now())) / 1000 * cps();
}
async function keysPlay(midi, vel = 0.8) {
  try {
    const ctx = audioCtx();
    if (ctx.state !== 'running') await ctx.resume();
    const s = $('keysSound').value || 'triangle';
    globalThis.superdough?.({ s, note: midi, velocity: vel, gain: 0.8 }, ctx.currentTime + 0.005, 0.6);
  } catch (e) { console.warn('[strudel-ai] keys:', e); }
}
function noteOn(midi, vel = 0.8, src = 'ui') {
  if (keysState.held.has(midi)) return;
  keysState.held.set(midi, { c0: keysState.rec ? keysCycle() : null, src });
  keysPlay(midi, vel);
  $('keysBoard').querySelector(`.key[data-m="${midi}"]`)?.classList.add('down');
}
function noteOff(midi) {
  const h = keysState.held.get(midi);
  if (!h) return;
  keysState.held.delete(midi);
  $('keysBoard').querySelector(`.key[data-m="${midi}"]`)?.classList.remove('down');
  if (keysState.rec && h.c0 != null) keysState.rec.notes.push({ midi, c0: h.c0, c1: Math.max(keysCycle(), h.c0 + 0.01) });
  renderKeysInfo();
}

// pointer: press, slide across keys, release
let keysPointer = null;
$('keysBoard').addEventListener('pointerdown', (e) => {
  const k = e.target.closest('.key');
  if (!k) return;
  e.preventDefault();
  $('keysBoard').setPointerCapture(e.pointerId);
  keysPointer = Number(k.dataset.m);
  noteOn(keysPointer);
});
$('keysBoard').addEventListener('pointermove', (e) => {
  if (keysPointer == null) return;
  const k = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('#keysBoard .key');
  const m = k ? Number(k.dataset.m) : null;
  if (m !== keysPointer) { noteOff(keysPointer); keysPointer = m; if (m != null) noteOn(m); }
});
for (const ev of ['pointerup', 'pointercancel']) $('keysBoard').addEventListener(ev, () => { if (keysPointer != null) noteOff(keysPointer); keysPointer = null; });

// computer keyboard (only while the keys are shown and you're not typing somewhere)
const typingTarget = (e) => e.target.closest?.('input, textarea, select, .cm-editor, [contenteditable="true"]');
document.addEventListener('keydown', (e) => {
  if (!docks.keys?.on || e.repeat || e.ctrlKey || e.metaKey || e.altKey || typingTarget(e)) return;
  if (e.key === 'z' || e.key === 'x') { setKeysOct(keysState.oct + (e.key === 'x' ? 1 : -1)); e.preventDefault(); return; }
  const off = KEY_LETTERS[e.key.toLowerCase()];
  if (off === undefined) return;
  e.preventDefault();
  const m = keysState.oct * 12 + 12 + off;
  keysState.kbd.set(e.code, m);
  noteOn(m, 0.8, 'kbd');
});
document.addEventListener('keyup', (e) => {
  const m = keysState.kbd.get(e.code);
  if (m === undefined) return;
  keysState.kbd.delete(e.code);
  noteOff(m);
});
function setKeysOct(o) {
  keysState.oct = Math.max(1, Math.min(7, o));
  save({ keysOct: keysState.oct });
  renderKeyboard();
}
$('keysDown').onclick = () => setKeysOct(keysState.oct - 1);
$('keysUp').onclick = () => setKeysOct(keysState.oct + 1);

// MIDI keyboards (Web MIDI)
async function connectMidi() {
  if (keysState.midiAccess !== undefined || !navigator.requestMIDIAccess) return;
  keysState.midiAccess = null;
  try {
    const acc = await navigator.requestMIDIAccess();
    keysState.midiAccess = acc;
    const hook = () => {
      keysState.midiInputs = [...acc.inputs.values()];
      for (const inp of keysState.midiInputs) {
        inp.onmidimessage = (msg) => {
          const [st, note, vel] = msg.data;
          const cmd = st & 0xf0;
          if (cmd === 0x90 && vel > 0) noteOn(note, vel / 127, 'midi');
          else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) noteOff(note);
        };
      }
      renderKeysInfo();
    };
    acc.onstatechange = hook;
    hook();
  } catch { renderKeysInfo(); }
}

function renderKeysInfo() {
  const r = keysState.rec;
  const midi = keysState.midiInputs.length ? `MIDI: ${keysState.midiInputs.map((i) => i.name).join(', ')}` : 'keys: A W S E D F … (Z / X octave)';
  $('keysInfo').textContent = r ? `⏺ recording · ${r.notes.length} note${r.notes.length === 1 ? '' : 's'}` : midi;
}

function keysRecToggle() {
  if (!keysState.rec) {
    keysState.rec = { notes: [], t0: performance.now() };
    $('keysRec').classList.add('on');
    $('keysResult').hidden = true;
    renderKeysInfo();
    return;
  }
  for (const m of [...keysState.held.keys()]) noteOff(m);
  const r = keysState.rec;
  keysState.rec = null;
  $('keysRec').classList.remove('on');
  renderKeysInfo();
  if (!r.notes.length) return;
  const grid = Number($('keysGrid').value);
  const startBar = Math.floor(Math.min(...r.notes.map((n) => n.c0)));
  const endBar = Math.min(startBar + 8, Math.ceil(Math.max(...r.notes.map((n) => n.c1)) - 1e-6));
  const nBars = Math.max(1, endBar - startBar);
  const bars = Array.from({ length: nBars }, () => []);
  for (const n of r.notes) {
    const s = Math.round((n.c0 - startBar) * grid);
    const e = Math.max(s + 1, Math.round((n.c1 - startBar) * grid));
    const bar = Math.floor(s / grid);
    if (bar >= nBars) continue;
    bars[bar].push({ s: s - bar * grid, e: Math.min(e - bar * grid, grid), midi: n.midi });
  }
  // a bar plays at cycle c via "<…>" index c mod n: rotate so the recorded bars land where you played them
  const ordered = Array.from({ length: nBars }, (_, k) => bars[((k - startBar) % nBars + nBars) % nBars]);
  keysState.result = { mini: polyBarsToMini(ordered, grid), bars: nBars, sound: $('keysSound').value };
  $('keysMini').textContent = `note("${keysState.result.mini}").s("${keysState.result.sound}")`;
  $('keysResult').hidden = false;
}
$('keysRec').onclick = keysRecToggle;
$('keysDiscard').onclick = () => { keysState.result = null; $('keysResult').hidden = true; };
$('keysInsert').onclick = () => {
  const r = keysState.result;
  if (!r) return;
  const existing = new Set(patternLines(getCode()).map((p) => p.base));
  let name = 'keys';
  for (let i = 2; existing.has(name); i++) name = `keys${i}`;
  const code = getCode().trimEnd() + `\n${name}: note("${r.mini}").s("${r.sound}")\n  .room(slider(0.2, 0, 1))\n  .gain(slider(0.8, 0, 1.2))\n`;
  applyQuantized(code, 'recorded keys').then((err) => {
    if (err) addMsg('error', `Couldn't insert the recording: ${err.message}`);
    else { addMsg('info', state.pending ? `🎹 recording armed — starts at bar ${state.pending.at + 1}` : '🎹 recording inserted'); $('keysResult').hidden = true; }
  });
};
$('keysAI').onclick = async () => {
  const r = keysState.result;
  if (!r || state.busy) return;
  const typed = $('input').value.trim();
  $('input').value = '';
  const instruction = typed || 'Add this recorded part to the music as a new part with a fitting sound and effects.';
  const msg = `${instruction}\n\nRECORDED PART (${r.bars} bar${r.bars > 1 ? 's' : ''}, one bar per cycle, played on "${r.sound}"):\nnote("${r.mini}")\n` +
    'Use this note pattern EXACTLY as written (same notes, chords and rhythm). You may choose the sound, octave (.transpose), effects and gain.';
  document.querySelector('.tabs button[data-tab="chatTab"]')?.click();
  addMsg('user', `🎹 ${instruction}\nnote("${r.mini}")`);
  setBusy(true);
  state.abort = new AbortController();
  try { await runTurn(msg); $('keysResult').hidden = true; }
  catch (err) { addMsg(err.name === 'AbortError' ? 'info' : 'error', err.name === 'AbortError' ? 'stopped' : err.message); }
  finally { setBusy(false); }
};
if (load().keysGrid) $('keysGrid').value = load().keysGrid;
$('keysGrid').onchange = () => save({ keysGrid: $('keysGrid').value });
renderKeyboard();
setupDock('keys', { onShow: () => { renderKeysSounds(); renderKeysInfo(); connectMidi(); } });
setInterval(() => { if (docks.keys?.on) renderKeysSounds(); }, 2000);

// ---------------------------------------------------------------------------
// 🔲 Pads: a 4×4 grid, each pad programmed with a line of Strudel code. Pressing a
// pad adds or removes its line ("padN: …") in the running code on the next beat /
// bar, so pads layer with whatever is playing (and with mute / solo). Statements like
// all(x => x.lpf(400)) or setcpm(140/4) work too. ⏺ Rec writes the pad performance
// into the code as .mask("…") patterns, so it keeps looping.
// ---------------------------------------------------------------------------
const DEFAULT_PADS = [
  { label: 'kick', code: 's("bd*4").bank("RolandTR909")', mode: 'toggle', color: '#ff5c7a' },
  { label: 'clap', code: 's("~ cp ~ cp").bank("RolandTR909")', mode: 'toggle', color: '#ff5c7a' },
  { label: 'hats', code: 's("hh*8").bank("RolandTR909").velocity("0.5 1").gain(0.6)', mode: 'toggle', color: '#ff5c7a' },
  { label: 'open hat', code: 's("~ oh ~ oh").bank("RolandTR909").gain(0.5)', mode: 'toggle', color: '#ff5c7a' },
  { label: 'snare roll', code: 's("sd*16").bank("RolandTR909").gain(saw.range(0.2, 1))', mode: 'once', color: '#ffd166' },
  { label: 'rim', code: 's("rim(3,8)").bank("RolandTR909").gain(0.7)', mode: 'toggle', color: '#ffd166' },
  { label: 'shaker', code: 's("hh*16").bank("RolandTR808").gain(0.3).pan(sine)', mode: 'toggle', color: '#ffd166' },
  { label: 'crash', code: 's("cr").bank("RolandTR909").gain(0.6)', mode: 'once', color: '#ffd166' },
  { label: 'sub bass', code: 'note("<c1 c1 ab0 bb0>*4").s("sine").gain(0.8)', mode: 'toggle', color: '#20d3a6' },
  { label: 'acid', code: 'note("c2 c3 c2 eb2").s("sawtooth").lpf(sine.range(300, 2000).slow(4)).lpq(10).decay(0.1).sustain(0).gain(0.6)', mode: 'toggle', color: '#20d3a6' },
  { label: 'stabs', code: 'chord("<Cm7 Fm7>").voicing().struct("~ x ~ x").s("square").decay(0.1).sustain(0).gain(0.35)', mode: 'toggle', color: '#20d3a6' },
  { label: 'arp', code: 'n("0 2 4 7 4 2").scale("C:minor").fast(2).s("triangle").gain(0.5)', mode: 'toggle', color: '#20d3a6' },
  { label: 'pad', code: 'chord("<Cm9 Ab^7>").voicing().s("gm_pad_warm").gain(0.5)', mode: 'toggle', color: '#7c5cff' },
  { label: 'riser', code: 's("white").lpf(saw.range(200, 8000)).gain(0.25)', mode: 'hold', color: '#7c5cff' },
  { label: 'filter all', code: 'all(x => x.lpf(500))', mode: 'hold', color: '#7c5cff' },
  { label: 'echo all', code: 'all(x => x.delay(0.5).delaytime(0.1875).delayfeedback(0.6))', mode: 'hold', color: '#7c5cff' },
];
let pads = (load().pads || DEFAULT_PADS).map((p, i) => ({ ...DEFAULT_PADS[i], ...p }));
const padsState = { edit: false, sel: null, pending: new Map(), rec: null };
const savePads = () => save({ pads });

const padN = (i) => i + 1;
const isStatement = (code) => /^\s*(all|each|setcp[ms]|samples)\s*\(/.test(code);
const oneLine = (code) => code.replace(/\s*\n\s*/g, ' ').trim();
const padLineRe = (i) => new RegExp(`^(?:[_S]?pad${padN(i)}:.*|.*// pad${padN(i)}\\s*)$`);
const padIsOn = (i, code = getCode()) => code.split('\n').some((l) => padLineRe(i).test(l) && !/^_/.test(l));
function padLine(i, codeOverride) {
  const c = oneLine(codeOverride ?? pads[i].code);
  return isStatement(c) ? `${c} // pad${padN(i)}` : `pad${padN(i)}: ${c}`;
}
function codeWithPad(code, i, on, lineText) {
  const lines = code.split('\n').filter((l) => !padLineRe(i).test(l));
  let out = lines.join('\n').replace(/\n+$/, '');
  if (on) out += '\n' + (lineText || padLine(i));
  return out + '\n';
}

/** Switch pad i on/off on the next sync boundary (or now when nothing plays). Returns the switch cycle. */
async function setPad(i, on, { at = null, lineText = null } = {}) {
  const p = pads[i];
  if (!p?.code.trim()) return null;
  const next = codeWithPad(getCode(), i, on, lineText);
  if (!isPlaying() && !on) { mirror().setCode(next); return null; }
  const when = isPlaying() ? at ?? nextBoundary(Number($('padsSync').value)) : null;
  const err = await evaluateCode(next, { at: when, label: `pad “${p.label}” ${on ? 'on' : 'off'}`, undo: false });
  if (err) { addMsg('error', `Pad “${p.label}”: ${err.message}`); return null; }
  const c = when ?? 0;
  if (when != null) padsState.pending.set(i, when);
  padsState.rec?.log.push({ i, on, at: c });
  return c;
}

function renderPads() {
  const code = getCode();
  const now = nowCycle();
  for (const [i, at] of padsState.pending) if (!isPlaying() || now >= at) padsState.pending.delete(i);
  const key = JSON.stringify([pads, padsState.edit, padsState.sel, [...padsState.pending.keys()], pads.map((_, i) => padIsOn(i, code))]);
  if (key === renderPads.key) return;
  renderPads.key = key;
  $('padsGrid').innerHTML = pads.map((p, i) => {
    const on = padIsOn(i, code);
    return `<button class="pad${on ? ' on' : ''}${padsState.pending.has(i) ? ' pending' : ''}${padsState.sel === i && padsState.edit ? ' selected' : ''}" data-i="${i}"
      style="--pc:${esc(p.color || '#7c5cff')}" title="${esc(`${p.label} · ${p.mode}\n${p.code}`)}">
      <span class="pad-label">${esc(p.label || `pad ${i + 1}`)}</span><span class="pad-mode">${p.mode === 'toggle' ? '' : p.mode}</span></button>`;
  }).join('');
}
setInterval(() => { if (docks.pads?.on) renderPads(); }, 150);

$('padsGrid').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.pad');
  if (!b) return;
  e.preventDefault();
  const i = Number(b.dataset.i);
  if (padsState.edit) { selectPad(i); return; }
  const p = pads[i];
  if (p.mode === 'toggle') setPad(i, !padIsOn(i));
  else if (p.mode === 'once') padOnce(i);
  else { // hold
    $('padsGrid').setPointerCapture(e.pointerId);
    padsState.holding = { i, at: setPad(i, true) };
  }
});
for (const ev of ['pointerup', 'pointercancel']) {
  $('padsGrid').addEventListener(ev, async () => {
    const h = padsState.holding;
    if (!h) return;
    padsState.holding = null;
    const onAt = await h.at;
    const sync = Number($('padsSync').value);
    // play at least one sync step
    setPad(h.i, false, { at: isPlaying() ? Math.max(nextBoundary(sync), (onAt ?? 0) + sync) : null });
  });
}
/** "once": on at the next boundary, off one bar later. */
async function padOnce(i, lineText = null) {
  const at = await setPad(i, true, { lineText });
  if (at == null || !isPlaying()) return;
  await setPad(i, false, { at: at + 1 });
}

// programming
function selectPad(i) {
  padsState.sel = i;
  const p = pads[i];
  $('padEditor').hidden = false;
  $('padLabel').value = p.label;
  $('padCode').value = p.code;
  $('padMode').value = p.mode;
  $('padColor').value = /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#7c5cff';
  renderPads.key = '';
  renderPads();
}
for (const id of ['padLabel', 'padCode', 'padMode', 'padColor']) {
  $(id).addEventListener('input', () => {
    const p = pads[padsState.sel];
    if (!p) return;
    Object.assign(p, { label: $('padLabel').value, code: $('padCode').value, mode: $('padMode').value, color: $('padColor').value });
    savePads();
    renderPads.key = '';
  });
}
$('padsEdit').onclick = () => {
  padsState.edit = !padsState.edit;
  $('padsEdit').classList.toggle('on', padsState.edit);
  $('padsEdit').textContent = padsState.edit ? '✓ done programming' : '✎ program';
  if (padsState.edit) selectPad(padsState.sel ?? 0);
  else $('padEditor').hidden = true;
  renderPads.key = '';
};
$('padDone').onclick = () => { if (padsState.edit) $('padsEdit').onclick(); };
$('padTest').onclick = () => { const i = padsState.sel; if (i != null) padOnce(i, padLine(i, $('padCode').value)); };
if (load().padsSync) $('padsSync').value = load().padsSync;
$('padsSync').onchange = () => save({ padsSync: $('padsSync').value });

// ⏺ Rec: bake the pad performance into the code as masks over the recorded bars
function padsRecToggle() {
  if (!padsState.rec) {
    if (!isPlaying()) { addMsg('info', '🔲 start the music first, then record the pads'); return; }
    const start = Math.ceil(nowCycle() - 1e-9);
    padsState.rec = { start, log: [], initial: pads.map((_, i) => padIsOn(i)) };
    $('padsRec').classList.add('on');
    $('padsInfo').textContent = `⏺ recording from bar ${start + 1}…`;
    return;
  }
  const r = padsState.rec;
  padsState.rec = null;
  $('padsRec').classList.remove('on');
  $('padsInfo').textContent = '';
  const end = Math.max(r.start + 1, Math.ceil(switchCycle() - 1e-9));
  const nBars = Math.min(16, end - r.start);
  let code = getCode();
  const baked = [];
  pads.forEach((p, i) => {
    if (isStatement(p.code)) return; // statements can't be masked
    const evs = r.log.filter((e) => e.i === i).sort((a, b) => a.at - b.at);
    if (!evs.length) return;
    const onAt = (t) => { let v = r.initial[i]; for (const e of evs) if (e.at <= t + 1e-6) v = e.on; return v; };
    const bars = [];
    for (let b = 0; b < nBars; b++) {
      const beats = [0, 1, 2, 3].map((q) => (onAt(r.start + b + q / 4) ? 1 : 0));
      bars.push(beats.every((x) => x === beats[0]) ? String(beats[0]) : `[${beats.join(' ')}]`);
    }
    if (bars.every((x) => x === '0')) { code = codeWithPad(code, i, false); return; }
    const ordered = Array.from({ length: nBars }, (_, k) => bars[((k - r.start) % nBars + nBars) % nBars]);
    const mask = nBars === 1 ? ordered[0].replace(/^\[|\]$/g, '') : `<${ordered.join(' ')}>`;
    code = codeWithPad(code, i, true, `pad${padN(i)}: (${oneLine(p.code)}).mask("${mask}")`);
    baked.push(p.label);
  });
  if (!baked.length) { addMsg('info', '🔲 nothing to record — no pads changed while recording'); return; }
  evaluateCode(code, { at: nextBoundary(1), label: 'recorded pads' }).then((err) => {
    if (err) addMsg('error', `Couldn't write the pad recording: ${err.message}`);
    else addMsg('info', `🔲 pad performance written into the code (${baked.join(', ')}) — it loops every ${nBars} bar${nBars > 1 ? 's' : ''}`);
  });
}
$('padsRec').onclick = padsRecToggle;
setupDock('pads', { onShow: () => { renderPads.key = ''; renderPads(); } });

// handy for debugging from the browser console
window.strudelAI = { pads, padsState, keysState, noteOn, noteOff, setPad, docks, rec, replay, startReplay, recordingForShare, viz, checkScales, checkSounds, prepareCode, evaluateCode, dryRun, hum, transcribe, ensureSliders, setlist, setl };
