import { loadDockview, createWorkspace } from './workspace.js';
import { wrapCode } from './format.js';
import { createMaster, MASTER_PARAMS, MASTER_DEFAULTS, MASTER_STYLES, STYLE_NAMES, styleParams, normStyle, clampParams, diffParams, stylesForPrompt } from './master.js';
import { soundGuide } from './sounds.js';
import { HumRecorder, transcribe, intervalsToSemitones, tonicPc, midiToName, freqToMidi, polyBarsToMini } from './hum.js';
// Strudel AI — browser app
/**
 * Element by id. Remembered once found, so panels keep working when the layout engine takes them out of the
 * page (a hidden tab) or into another window (a popped-out panel), where document.getElementById can't see them.
 */
const $els = new Map();
const $ = (id) => {
  const known = $els.get(id);
  if (known?.isConnected && known.id === id) return known;
  const el = document.getElementById(id);
  if (el) { $els.set(id, el); return el; }
  return known || null;
};
for (const el of document.querySelectorAll('[id]')) $els.set(el.id, el); // every element the page starts with

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
if (saved.partVisuals !== undefined) $('partVisuals').checked = saved.partVisuals;
$('partVisuals').onchange = async () => {
  save({ partVisuals: $('partVisuals').checked });
  // the song section playing now gets (or loses) its visuals on the next bar
  const code = getCode();
  if (isPlaying() && code.includes(SEC_START) && !state.pending) await evaluateCode(wrapCode(partVisuals(code)), { at: nextBoundary(1), label: 'part visuals', undo: false });
};
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

/**
 * Notes carrying a non-finite number (NaN / Infinity gain, frequency, cutoff …) make the audio engine throw
 * "Failed to set the 'value' property on 'AudioParam'" for every one of them. Drop such notes before they're
 * played, and say once in the console which control and sound produced them.
 */
const nonFiniteSeen = new Set();
const CUTOFF_KEYS = ['cutoff', 'hcutoff', 'bandf'];
function finiteGuard(pat) {
  if (!pat || pat.__finite || typeof pat.query !== 'function') return pat;
  const guarded = new pat.constructor((st) => pat.query(st).map((h) => {
    // a cutoff of 0 or below (e.g. lpf(sine.range(0, 2000))) turns into a non-finite filter value
    const v = h.value;
    if (!v || typeof v !== 'object' || !CUTOFF_KEYS.some((k) => typeof v[k] === 'number' && v[k] < 10)) return h;
    return h.withValue((x) => { const o = { ...x }; for (const k of CUTOFF_KEYS) if (typeof o[k] === 'number' && o[k] < 10) o[k] = 10; return o; });
  }).filter((h) => {
    const v = h.value;
    if (!v || typeof v !== 'object') return true;
    for (const k in v) {
      const x = v[k];
      if (typeof x === 'number' && !Number.isFinite(x)) {
        const id = `${k}|${v.s ?? ''}`;
        if (!nonFiniteSeen.has(id) && !vizQuerying && !inDryRun) {
          nonFiniteSeen.add(id);
          clog('warn', `Skipped notes with an invalid ${k} (${x}) on sound “${v.s ?? '?'}”${v.note != null ? `, note ${v.note}` : ''} — check that part's ${k} value`);
        }
        return false;
      }
    }
    return true;
  }));
  guarded.__finite = true;
  return guarded;
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
  const reg = globalThis.soundMap?.get?.();
  const missing = new Map(); // what isn't loaded → hint
  try {
    for (const [a, b] of [[c, c + 8], [0, 2]]) {
      for (const h of pat.queryArc(a, b)) {
        const v = h.value;
        if (v && typeof v === 'object') {
          if (typeof v.note === 'number' && !Number.isFinite(v.note)) throw new Error(`invalid note value (NaN) in "${v.s ?? ''}" part`);
          if (typeof v.note === 'string' && /undefined|NaN/.test(v.note)) throw new Error(`invalid note "${v.note}"`);
          // the exact sound the engine will look up — a drum name must exist in the chosen drum machine
          if (reg && typeof v.s === 'string' && v.s) {
            const key = (v.bank ? `${v.bank}_${v.s}` : v.s).toLowerCase();
            if (!reg[key] && !missing.has(key)) missing.set(key, soundHint(reg, v.s, v.bank));
          }
        }
      }
    }
    if (missing.size) logged.push(`these sounds don't exist: ${[...missing.values()].join('; ')}`);
    if (logged.length) for (const m of logged) recentDryRunErrors.set(m, performance.now());
    return logged.length ? new Error([...new Set(logged)].join('; ')) : null;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  } finally {
    inDryRun = false;
    document.removeEventListener('strudel.log', onLog);
  }
}

/** Explain a missing sound: for a drum machine, list the drums it does have. */
function soundHint(reg, s, bank) {
  if (bank) {
    const pre = String(bank).toLowerCase() + '_';
    const drums = Object.keys(reg).filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length));
    return drums.length
      ? `"${s}" is not in the drum machine "${bank}" (it has: ${drums.slice(0, 24).join(' ')})`
      : `the drum machine "${bank}" doesn't exist`;
  }
  return `"${s}"`;
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
    captured = finiteGuard(pat);
    autostart = auto;
    // the editor's highlighter queries scheduler.pattern after evaluating – give it something harmless
    if (!sch.pattern) sch.pattern = new pat.constructor(() => []);
  };
  window.__mixerTrap?.(); // mixer EQ: route parts to their own orbit
  window.__masterInstall?.(); // 🎛 master style on the whole mix
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
/**
 * The crossfade in bars (cycles). The beat options (1 or 2 beats) follow the meter of the song that is
 * switching in: a beat is ¼ bar in 4/4, ⅓ bar in 3/4, ½ bar in 6/8.
 */
const fadeCycles = (song = setl.songs[setl.current]) => {
  const v = Number($('fade').value);
  return v > 0 && v < 1 ? (v * 4) / meterBeats(songMeter(song)) : v;
};
/** One beat of the playing song, in bars. */
const beatCycles = () => 1 / meterBeats(songMeter(setl.songs[setl.current]));

/** Apply code using the current quantize setting. */
function applyQuantized(code, label) {
  const q = quantize();
  const at = q > 0 && isPlaying() ? nextBoundary(q) : null;
  return evaluateCode(code, { at, label, fade: fadeCycles() });
}

$('play').onclick = async () => {
  if (setlist.paused) return resumeSong();
  cancelPending(false);
  const err = await evaluateCode(getCode());
  if (err) addMsg('error', `Not applied: ${err.message}`);
};
$('stop').onclick = () => { stopReplay(); mp3TakeEnd(false); cancelPending(false); stopSet?.(); stopSetlist(); mirror()?.stop(); if (upd.available) setTimeout(reloadForUpdate, 300); };
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
    // beats follow the playing song's meter (4/4 for your own code)
    const meter = setl.running ? songMeter(setl.songs[setl.current]) : '4/4', beats = meterBeats(meter);
    const beat = Math.floor((c % 1) * beats) + 1;
    st.textContent = `bar ${bar}.${beat}  ${Math.round(cps() * 60 * beats)}bpm${meter === '4/4' ? '' : ` ${meter}`}`;
    st.className = 'status ' + (err ? 'error' : 'playing');
  }
  const p = state.pending;
  const pb = $('pending');
  if (p && isPlaying() && nowCycle() < p.at) {
    const secs = Math.max(0, (p.at - nowCycle()) / cps());
    pb.hidden = false;
    pb.textContent = `⏱ ${p.label || 'next change'} at ${barBeat(p.at)} (${secs.toFixed(1)}s)`;
  } else pb.hidden = true;
  try { updateStepStates(); } catch {} // the page is still loading (the setlist isn't defined yet)
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
    const r = await proto.setPattern.call(this, finiteGuard(pat), auto);
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

function renderProviderControls() {
  const claude = state.config?.providers?.[$('provider').value]?.kind === 'anthropic';
  $('effortRow').hidden = !claude;
  $('tempRow').hidden = claude;
}

async function loadModels() {
  const provider = $('provider').value;
  const pcfg = state.config.providers[provider];
  renderProviderControls();
  if (pcfg.kind === 'anthropic') $('claudeEffort').value = load().claudeEffort || pcfg.defaultEffort || 'low';
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
    warnUser(`Model list unavailable (⚙ Settings → AI): ${e.message}`);
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

// ---------------------------------------------------------------------------
// Workspace: the code editor, chat, songs, station, now playing and the tool docks are dockview panels that tab
// together, split anywhere, float or pop out into their own window (see workspace.js).
// ---------------------------------------------------------------------------
const PANELS = [
  { id: 'chat', title: 'Chat', icon: '💬', el: $('chatTab'), area: 'right' },
  { id: 'songs', title: 'Songs', icon: '🎵', el: $('setTab'), area: 'right' },
  { id: 'station', title: 'Station', icon: '📻', el: $('stationTab'), area: 'right' },
  { id: 'song', title: 'Now playing', icon: '🎶', el: $('songPanel'), area: 'right' },
  { id: 'edit', title: 'Edit song', icon: '✎', el: $('editPanel'), area: 'right' },
  { id: 'viz', title: 'Visualizer', icon: '📊', el: $('viz-dock'), area: 'bottom' },
  { id: 'keys', title: 'Keys', icon: '🎹', el: $('keys-dock'), area: 'bottom' },
  { id: 'pads', title: 'Pads', icon: '🔲', el: $('pads-dock'), area: 'bottom' },
  { id: 'mixer', title: 'Mixer', icon: '🎚', el: $('mixer-dock'), area: 'bottom' },
  { id: 'master', title: 'Master', icon: '🎛', el: $('master-dock'), area: 'bottom' },
  { id: 'console', title: 'Console', icon: '🖥', el: $('console-dock'), area: 'bottom' },
];
let ws;
try {
  ws = createWorkspace({ dv: await loadDockview(), root: $('workspace'), center: document.querySelector('#workspace .ws-center'), panels: PANELS, saved: saved.panelLayout || null, onSave: (layout) => save({ panelLayout: layout }) });
} catch (e) {
  const msg = document.createElement('div');
  msg.className = 'fatal';
  msg.textContent = `The panel layout could not be loaded (${e.message || e}). Reload the page; if it keeps failing, check that the server serves /vendor/dockview/.`;
  document.body.prepend(msg);
  throw e;
}
/** Bring a panel to the front (opening it if it's closed). */
const showPanel = (id) => ws.open(id);
// the ▦ Panels menu: open / close any panel, reset the layout
function renderLayoutMenu() {
  $('layoutMenu').innerHTML = ws.panels().map((p) => `<label${p.fixed ? ' title="Always shown"' : ''}><input type="checkbox" data-panel="${p.id}"${p.open ? ' checked' : ''}${p.fixed ? ' disabled' : ''} /> ${p.icon} ${esc(p.title)}</label>`).join('') +
    '<div class="lm-foot"><button id="layoutReset" class="link" title="Back to the default layout">↺ reset layout</button></div>' +
    '<small class="muted">Drag a tab onto another group to tab it, or to a group\'s edge to split it. Right-click a tab to maximise, float or pop it out into its own window.</small>';
}
$('layoutBtn').onclick = (e) => {
  e.stopPropagation();
  renderLayoutMenu();
  const m = $('layoutMenu');
  m.hidden = !m.hidden;
  // open towards the side with room
  const r = $('layoutBtn').getBoundingClientRect();
  Object.assign(m.style, r.left + 260 > innerWidth ? { left: 'auto', right: '0' } : { left: '0', right: 'auto' });
};
$('layoutMenu').addEventListener('change', (e) => { const id = e.target.dataset.panel; if (id) e.target.checked ? ws.open(id) : ws.close(id); });
$('layoutMenu').addEventListener('click', (e) => { if (e.target.id === 'layoutReset') { ws.reset(); renderLayoutMenu(); } e.stopPropagation(); });
document.addEventListener('click', () => { $('layoutMenu').hidden = true; });

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
/**
 * Tail a scrolling log: it follows new content (stays at the bottom) unless you scroll up to read;
 * scrolling back to the bottom resumes following.
 */
function tail(el) {
  el.__follow = true;
  const toBottom = () => { if (el.__follow) el.scrollTop = el.scrollHeight; };
  el.addEventListener('scroll', () => { el.__follow = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }, { passive: true });
  new MutationObserver(toBottom).observe(el, { childList: true, subtree: true, characterData: true });
  new ResizeObserver(toBottom).observe(el);
}
tail($('messages'));
tail($('consoleLog'));
const scrollChat = () => { const m = $('messages'); m.__follow = true; m.scrollTop = m.scrollHeight; };

// ---------------------------------------------------------------------------
// 🖥 Console: a running log of what happens behind the scenes — every AI request
// (with its text streaming in), the checks and automatic fixes, retries and errors.
// Intermediate problems go here; the chat only gets the final outcome.
// ---------------------------------------------------------------------------
const CONSOLE_MAX = 400;
/**
 * A problem the app couldn't resolve (AI errors after retries, budget, …): it goes to the console,
 * and the status bar shows ⚠ with the message as its tooltip — never into the chat or the page.
 */
function warnUser(msg) {
  clog('error', msg);
  const w = $('sbWarn');
  w.hidden = false;
  w.title = `${msg}\n(click to open the 🖥 Console)`;
  w.dataset.count = String(Number(w.dataset.count || 0) + 1);
  w.textContent = `⚠ ${w.dataset.count}`;
}
/** Add a console line. kind: ai | ok | fix | warn | error | info. Returns { set(text), done(text, kind) }. */
function clog(kind, text) {
  const log = $('consoleLog');
  const row = document.createElement('div');
  row.className = `con-row ${kind}`;
  const time = document.createElement('span');
  time.className = 'con-time';
  time.textContent = new Date().toTimeString().slice(0, 8);
  const body = document.createElement('span');
  body.className = 'con-text';
  body.textContent = text;
  row.append(time, body);
  log.appendChild(row); // (the log is tailed: it stays at the bottom unless you scroll up)
  while (log.childElementCount > CONSOLE_MAX) log.firstElementChild.remove();
  let stream = null;
  return {
    stream(t) {
      if (!$('consoleStream').checked) return;
      if (!stream) { stream = document.createElement('pre'); stream.className = 'con-stream'; row.appendChild(stream); tail(stream); }
      stream.textContent = t.length > 4000 ? '…' + t.slice(-4000) : t;
    },
    done(t, k) { if (t) body.textContent = t; if (k) row.className = `con-row ${k}`; },
  };
}
$('consoleClear').onclick = () => { $('consoleLog').innerHTML = ''; };
if (load().consoleStream !== undefined) $('consoleStream').checked = load().consoleStream;
$('consoleStream').onchange = () => save({ consoleStream: $('consoleStream').checked });

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
  // only code fences count — ```song / ```parts / ```pads blocks are handled separately
  const isCode = (lang) => ['', 'javascript', 'js', 'strudel'].includes(lang.toLowerCase());
  const blocks = [...clean.matchAll(/```([\w-]*)[^\n]*\n([\s\S]*?)```/g)]
    .filter((m) => isCode(m[1]))
    .map((m) => m[2].trim())
    .filter(Boolean);
  if (blocks.length) return blocks[blocks.length - 1];
  if ([...clean.matchAll(/```([\w-]*)/g)].some((m) => m[1] && !isCode(m[1]))) return null; // only song / pads blocks
  const open = clean.match(/```(?:javascript|js|strudel)?[^\n]*\n([\s\S]+)$/);
  if (open && open[1].trim()) return open[1].trim();
  const lines = clean.split('\n').filter((l) => l.trim());
  const codeLines = lines.filter((l) => CODE_LINE.test(l));
  if (codeLines.length >= 1 && codeLines.length >= lines.length - 1) {
    return lines.filter((l) => CODE_LINE.test(l) || /^\s/.test(l)).join('\n').trim();
  }
  return null;
}

/** The body of the last ```<lang> block in a reply, or null. */
function fencedBlock(text, lang) {
  const all = [...stripThinking(text).matchAll(new RegExp('```' + lang + '[^\\n]*\\n([\\s\\S]*?)```', 'g'))];
  return all.length ? all[all.length - 1][1].trim() : null;
}

/** Cheap syntax check ("$:" lines are valid JS labels). Returns error message or null. */
function syntaxError(code) {
  try { new Function(code); return null; } catch (e) { return e.message; }
}

/**
 * Stream a completion. onUpdate({content, thinking}) is called as tokens arrive.
 * mode: 'code' (edit the given code) | 'setlist' (write a setlist)
 */
async function requestLLM({ messages, code = '', mode = 'code', onUpdate, signal, edited = false, label = '', sounds = null, onError = null, fixing = false }) {
  try { return await requestLLMLogged({ messages, code, mode, onUpdate, signal, edited, label, sounds, fixing }); }
  catch (e) { onError?.(e); throw e; }
}
async function requestLLMLogged({ messages, code, mode, onUpdate, signal, edited, label, sounds, fixing }) {
  // session budget (Claude reports usage, so its cost is known): stop before spending more
  const budget = Number(load().aiBudget ?? 2);
  if (budget > 0 && session.cost >= budget) {
    const e = new Error(`session AI budget reached (${money(session.cost)} of ${money(budget)}) — raise it in ⚙ Settings → AI`);
    clog('error', `✗ AI · ${mode}: ${e.message}`);
    throw e;
  }
  sounds ??= await soundCatalog().catch(() => '');
  const lastUser = String(messages[messages.length - 1]?.content || '').split('\n')[0].slice(0, 140);
  const t0 = performance.now();
  const entry = clog('ai', `→ AI · ${mode}${label ? ` · ${label}` : ''} · ${$('model').value || 'default model'}: ${lastUser}`);
  const update = onUpdate;
  onUpdate = (u) => { entry.stream((u.thinking ? `[thinking] ${u.thinking.slice(-600)}\n\n` : '') + u.content); update?.(u); };
  try {
    lastUsage = null;
    const text = await requestLLMRaw({ messages, code, mode, onUpdate, signal, edited, sounds, fixing });
    entry.done(`✓ AI · ${mode}${label ? ` · ${label}` : ''}: ${text.length} chars in ${((performance.now() - t0) / 1000).toFixed(1)}s${usageText(lastUsage)}`, 'ok');
    addSessionCost(lastUsage);
    return text;
  } catch (e) {
    entry.done(`✗ AI · ${mode}${label ? ` · ${label}` : ''}: ${e.name === 'AbortError' ? 'stopped' : e.message}`, e.name === 'AbortError' ? 'info' : 'error');
    throw e;
  }
}

let lastUsage = null; // token usage of the last Claude reply (other providers don't report it)
const money = (v) => `$${v.toFixed(v < 0.1 ? 3 : 2)}`;
// running AI cost for this browser session (shown in the status bar, checked against the budget)
const session = (() => { try { return JSON.parse(sessionStorage.getItem('strudel-ai:session')) || { cost: 0, requests: 0, tokensIn: 0, tokensOut: 0 }; } catch { return { cost: 0, requests: 0, tokensIn: 0, tokensOut: 0 }; } })();
function usageCost(u) {
  const p = u && CLAUDE_PRICES[u.model];
  // 1-hour cache writes cost 2× input
  return p ? (u.input * p[0] + u.output * p[1] + u.cache_read * p[2] + u.cache_write * p[0] * 2) / 1e6 : 0;
}
function addSessionCost(u) {
  if (!u) return;
  session.cost += usageCost(u);
  session.requests++;
  session.tokensIn += (u.input || 0) + (u.cache_read || 0) + (u.cache_write || 0);
  session.tokensOut += u.output || 0;
  try { sessionStorage.setItem('strudel-ai:session', JSON.stringify(session)); } catch {}
}
// $ per million tokens: input, output, cache read, cache write (5 min)
const CLAUDE_PRICES = { 'claude-sonnet-5-5': [2, 10, 0.2, 2.5], 'claude-opus-5-5': [4, 20, 0.2, 5], 'claude-haiku-4-5': [1, 5, 0.1, 1.25] };
function usageText(u) {
  if (!u) return '';
  const cost = CLAUDE_PRICES[u.model] ? usageCost(u) : null;
  return ` · ${u.input + u.cache_read + u.cache_write} in (${u.cache_read} cached) / ${u.output} out` + (cost != null ? ` · ≈${(cost * 100).toFixed(1)}¢` : '');
}

async function requestLLMRaw({ messages, code, mode, onUpdate, signal, edited, sounds, fixing }) {
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
      fixing: !!fixing,
      systemPrompt: promptOverride(mode),
      temperature: Number($('temp').value),
      effort: $('claudeEffort').value,
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
      if (j.usage) { lastUsage = j.usage; continue; }
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
async function prepareCode(code, { quiet = false, library = false } = {}) {
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
  const failed = await preloadSoundfonts(chk.code);
  if (failed.length && !quiet) {
    addMsg('error', `Couldn't download soundfont(s) ${failed.join(', ')} from felixroos.github.io — they will be silent. Check the browser's internet access.`);
  }
  return { code: wrapCode(chk.code), error: null, corrections: allCorrections };
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
  // the chat only hears about problems with code the app has finished checking; details go to the console
  clog('error', `engine: ${msg}`);
});

// ---------------------------------------------------------------------------
// Chat turn
// ---------------------------------------------------------------------------
/**
 * One chat request. The first reply streams into a chat bubble; if its code needs
 * fixing (no code, unknown names, errors when test-played), the retries run quietly
 * — they stream into the 🖥 Console — and the bubble is updated with the final, working
 * reply. Only when every attempt fails does an error reach the chat.
 */
async function runTurn(userText, attempt = 0, bubble = null, failedCode = null) {
  state.history.push({ role: 'user', content: userText });
  let r = null;
  if (!bubble) {
    bubble = addMsg('assistant', '', { raw: true });
    r = bubbleRenderer(bubble);
  } else {
    setBubbleNote(bubble, `🔧 checking and fixing (attempt ${attempt + 1}/${MAX_FIX_ATTEMPTS + 1}) — see 🖥 Console`);
  }
  // song / pads context only rides along on this request (not stored in the history)
  const messages = historyForModel();
  const ctx = chatContext(userText);
  if (ctx) messages[messages.length - 1] = { role: 'user', content: `${ctx}\n\n${messages[messages.length - 1].content}` };
  const text = await requestLLM({
    messages,
    // a fix request works on the AI's failed attempt — not on what's in the editor
    code: failedCode ?? getCode(),
    fixing: failedCode != null,
    onError: () => { if (!bubble.textContent.trim()) bubble.remove(); },
    edited: state.lastAICode != null && normCode(getCode()) !== normCode(state.lastAICode),
    onUpdate: r?.update,
    signal: state.abort.signal,
    label: attempt ? `fix ${attempt}` : 'chat',
  });
  r?.done();
  let code = extractCode(text);

  const retry = (why, msg, fixCode = null) => {
    clog('warn', `✗ ${why} — asking the AI again (${attempt + 1}/${MAX_FIX_ATTEMPTS})`);
    return runTurn(msg, attempt + 1, bubble, fixCode);
  };
  // couldn't fix it: details stay in the console; the reply only gets a ⚠ with the reason as tooltip
  const giveUp = (msg) => { setBubbleNote(bubble, '⚠ not applied', msg); warnUser(msg); };

  // song structure / parts / pads answers
  const songBlock = fencedBlock(text, 'song'), padsBlock = fencedBlock(text, 'pads');
  let partsBlock = fencedBlock(text, 'parts');
  // a reply that rewrote the song's part library as editor code (consts or "part_variant:" labels) is a parts edit
  if (!partsBlock && code && chatTarget() !== 'code') {
    const lib = libraryFromReply(code, activeSong());
    if (lib) { clog('fix', '🎵 the reply rewrote the song’s parts as editor code — applying it to the song’s parts instead'); partsBlock = lib; code = null; }
  }
  const notes = [];
  if (padsBlock) {
    try { const done = applyPadsReply(padsBlock); if (done) notes.push(`🔲 ${done}`); }
    catch (e) { clog('warn', `pads reply unusable: ${e.message}`); }
  }
  if (songBlock || partsBlock) {
    const sg = activeSong();
    if (!sg) notes.push('🎵 no song is open — open one in 🎵 Songs to edit it');
    else {
      let raw = null;
      try { raw = songBlock ? parseJSONLoose(songBlock) : rawSheet(sg.sheet); } catch (e) { raw = null; clog('warn', `song reply unusable: ${e.message}`); }
      const err = raw ? await applySongEdit(sg, raw, partsBlock) : 'the ```song block is not valid JSON';
      if (err) {
        if (attempt < MAX_FIX_ATTEMPTS) {
          return retry(`song edit: ${err}`, `${userText.replace(/\n\nTHE SONG EDIT FAILED[\s\S]*$/, '')}\n\nTHE SONG EDIT FAILED: ${err}. Return the corrected \`\`\`song and \`\`\`parts blocks.`);
        }
        notes.push('⚠ song not changed');
        warnUser(`Song edit failed: ${err}`);
      } else {
        // say what the song really does now (tempo / key moves), not just what the reply claims
        const moved = sg.sheet.sections.filter((x) => x.bpm || x.shift).map((x) => `${x.name}: ${[x.bpm ? `${x.bpm} bpm` : '', x.shift ? `key ${signed(x.shift)}` : ''].filter(Boolean).join(', ')}`);
        // the section playing now switches to its new version on the next bar (the rest already did)
        const nowToo = await refreshPlayingSection(sg);
        const when = setl.songs.includes(sg) && setl.running ? (nowToo ? ' — from the next bar' : ' — from its next section') : '';
        notes.push(`🎵 “${sg.title}” updated${when} · ${sg.sheet.bpm} bpm${moved.length ? `; ${moved.join(' · ')}` : ', one tempo throughout'}`);
      }
    }
  }
  // whole-song mode: the song blocks are the answer; editor code would only change the section playing now
  if (chatTarget() === 'song' && (songBlock || partsBlock) && code) { clog('info', 'whole-song mode: ignored the reply’s editor code'); code = null; }
  if (!code && notes.length) {
    // a song / pads answer without new editor code
    state.history.push({ role: 'assistant', content: stripThinking(text) });
    setBubbleNote(bubble, notes.join(' · '));
    return;
  }

  if (!code) {
    state.history.pop(); // don't let the model imitate a code-less reply
    if (attempt < MAX_FIX_ATTEMPTS) {
      const base = userText.replace(/\n\nIMPORTANT: your previous reply[\s\S]*$/, '');
      if (chatTarget() === 'song') {
        return retry('no song in the reply', base + '\n\nIMPORTANT: your previous reply changed nothing. Reply with the COMPLETE updated sheet in a ```song block ' +
          '(and a ```parts block if parts change).');
      }
      return retry('no code in the reply', base + '\n\nIMPORTANT: your previous reply had no code. Answer with ONE short sentence, then the COMPLETE ' +
        'updated program in a single ```javascript code block.');
    }
    return giveUp('The model did not return any code. Try rephrasing, clearing the chat, or a different model.');
  }
  const prep = await prepareCode(code);
  code = prep.code;
  let reply = stripThinking(text);
  for (const [a, b] of prep.corrections) reply = reply.split(a).join(b); // don't let the model learn wrong names
  state.history.push({ role: 'assistant', content: reply });
  state.lastAICode = code;
  // show the corrected code, not the misspelled one
  if (prep.corrections.length && attempt === 0) { const d = bubble.querySelector(':scope > .typing, :scope > div:not(.note):not(.actions)'); if (d) d.innerHTML = renderMarkdownLite(reply); }

  if (prep.error) {
    if (attempt < MAX_FIX_ATTEMPTS) return retry(prep.error, prep.error + ' Return the full corrected program.', code);
    return giveUp(`Couldn't get working code: ${prep.error}`);
  }

  const finish = () => {
    // the bubble shows the reply that actually worked
    if (attempt > 0) { bubble.innerHTML = ''; const d = document.createElement('div'); d.innerHTML = renderMarkdownLite(reply); bubble.appendChild(d); }
    setBubbleNote(bubble, [attempt > 0 ? `🔧 fixed automatically (${attempt} retr${attempt > 1 ? 'ies' : 'y'})` : '', ...notes].filter(Boolean).join(' · '));
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
  };

  if (!$('autoApply').checked) { finish(); return; }

  const err = await applyQuantized(code, 'chat change');
  if (!err) {
    finish();
    clog('ok', state.pending ? `✓ chat change armed for bar ${state.pending.at + 1}` : '✓ chat change applied');
    addMsg('info', state.pending ? `✓ armed — switching at bar ${state.pending.at + 1}` : '✓ applied & playing');
    return;
  }
  if ($('autoFix').checked && attempt < MAX_FIX_ATTEMPTS) {
    return retry(`error when test-played: ${err.message}`,
      `The code you returned threw this error when it played:\n${err.message}\n` +
        (/scale/i.test(err.message) ? scaleHelp() + '\n' : '') +
        'Fix it and return the full corrected program. Only use functions from the reference.', code);
  }
  finish();
  giveUp(`Not applied (the old music keeps playing): ${err.message}`);
}

/** A small status line under a chat reply. */
function setBubbleNote(bubble, text, tooltip = '') {
  let n = bubble.querySelector(':scope > .note');
  if (!text) { n?.remove(); return; }
  if (!n) { n = document.createElement('div'); n.className = 'note'; bubble.appendChild(n); }
  n.textContent = text;
  n.title = tooltip;
  n.classList.toggle('warn', !!tooltip);
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
  if ($('chatTarget').value === 'new') { createSongFromChat(text); return; }
  setBusy(true);
  state.abort = new AbortController();
  try {
    await runTurn(text);
  } catch (err) {
    if (err.name === 'AbortError') addMsg('info', 'stopped');
    else warnUser(`AI request failed: ${err.message}`);
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
  // a section that failed when it was about to play is fixed from its own failed code
  let fixCode = step.failedCode || null;
  delete step.failedCode;
  for (let attempt = 0; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
    const text = await requestLLM({
      messages: [{ role: 'user', content: prompt }],
      code: fixCode ?? base,
      fixing: fixCode != null,
      signal: step.abort.signal,
      label: `block ${i + 1}${fixCode ? ' fix' : ''}`,
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
    if (code) fixCode = code; // fix the attempt itself next time
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
  if (!setlist.running || setlist.paused) return;
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
      addMsg('info', `■ ${setlist.feeder?.label || 'song blocks'} finished`);
      stopSetlist();
      // the last section has played out: stop (sounds already scheduled still ring out)
      mirror()?.stop();
      setTimeout(mp3TakeEnd, 1500); // let the tail ring out into the recording
      return;
    }
  }
  const step = setlist.steps[setlist.playIndex];
  if (!step?.code || step.status === 'armed') return;
  if (!isPlaying()) {
    // nothing playing yet → start with the first ready step immediately
    step.status = 'armed';
    await evaluateCode(atSectionStart(step.code, 0), { label: `block ${setlist.playIndex + 1}` });
    step.startedAt = 0;
    setlist.nextAt = step.bars;
    setlist.playIndex++;
    setlist.jumpTarget = null;
    return;
  }
  if (setlist.nextAt === null && quantize() === 0) {
    // "switch on: immediately" → no waiting for a bar line
    step.status = 'armed';
    const err = await evaluateCode(atSectionStart(step.code, Math.floor(nowCycle())), { label: `block ${setlist.playIndex + 1}` });
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
  const fade = step.fade ?? fadeCycles(step.song);
  const secsUntil = (at - fade - nowCycle()) / cps();
  if (secsUntil > 2) return;
  step.status = 'armed';
  const playing = setlist.steps.find((s) => s.status === 'playing');
  const code = atSectionStart(step.section && playing?.song === step.song ? carryLiveState(getCode(), step.code) : step.code, at);
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
      clog('warn', `Block ${idx + 1} failed when test-played (${err.message}) — regenerating; the music keeps playing meanwhile`);
      step.status = 'waiting';
      step.failedCode = step.code;
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
    clog('error', `Block ${idx + 1} still fails (${err.message}) — skipped`);
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
    running: true, paused: null, steps, genIndex: at, playIndex: at, nextAt: null, jumpTarget: at,
    abort: new AbortController(), feeder, hold: false,
  });
  steps.forEach((s, j) => { if (j < at && !s.code) s.status = 'skipped'; }); // started further down: don't write the blocks above
  setlist.timer = setInterval(() => tickSetlist().catch((e) => warnUser(`song blocks: ${e.message}`)), 100);
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
  setlist.paused = null;
  mp3.paused = false;
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

// ---------------------------------------------------------------------------
// ⏸ Pause / ▶ Resume (🎶 Now playing): stop the sound where the song is — section and bar — and pick up
// there later. The resumed section is anchored so its bar `bar` plays first (sectionStart = −bar).
// ---------------------------------------------------------------------------
function pauseSong() {
  if (!setlist.running || setlist.paused || !isPlaying()) return;
  const st = setlist.steps.find((x) => x.status === 'playing');
  if (!st) return;
  const len = Math.max(1, st.bars);
  const bar = Math.max(0, Math.floor(nowCycle() - (st.startedAt ?? 0))) % len;
  // a next section armed for the bar line: take it back, it plays after the resume
  cancelPending(true);
  setlist.steps.forEach((x) => { if (x.status === 'armed') { x.status = 'ready'; delete x.startedAt; } });
  setlist.playIndex = setlist.steps.indexOf(st) + 1;
  setlist.jumpTarget = null;
  setlist.paused = { step: st, bar, code: getCode() };
  mp3.paused = true;
  mirror()?.stop();
  addMsg('info', `⏸ paused “${st.song?.title || 'song'}” at ${st.prompt || 'this section'}, bar ${bar + 1}/${len}`);
  lastSongsKey = '';
}
async function resumeSong() {
  const p = setlist.paused;
  if (!p) return;
  setlist.paused = null;
  const err = await evaluateCode(atSectionStart(p.code, -p.bar), { label: `resume ${p.step.prompt || ''}`, undo: false });
  if (err) { addMsg('error', `Couldn't resume: ${err.message}`); setlist.paused = p; return; }
  p.step.startedAt = -p.bar;
  setlist.nextAt = p.step.startedAt + p.step.bars;
  mp3.paused = false;
  addMsg('info', `▶ resumed at bar ${p.bar + 1}`);
  lastSongsKey = '';
}
// ⏮ ▶ ⏸ ■ ⏭ in 🎶 Now playing
$('nowPause').onclick = () => {
  if (setlist.paused) return resumeSong();
  if (setlist.running) return pauseSong();
  if (isPlaying()) mirror()?.stop(); // your own code: pausing stops it (▶ plays it again)
};
/**
 * ✨ New song (🎯 in the chat): the message describes it ("Title | description", or just a description — then its
 * first words become the title). It's written and plays next: after the song playing now, or right away.
 */
function createSongFromChat(text) {
  const [song] = parseSongs(text.replace(/\n+/g, ' '));
  if (!song) return;
  if (!/[|–—:]\s/.test(text)) { song.title = 'New song'; song.autoTitle = true; } // the AI names it with the song sheet
  if (setl.running) {
    const at = setl.current < 0 ? setl.songs.length : setl.current + 1; // nothing playing yet: after the songs being written
    setl.songs.splice(at, 0, song);
    if (setl.nextSong > at) setl.nextSong = at; // write it before the songs that were queued after it
    addMsg('info', `✨ “${song.title}” — writing it now; it plays after “${setl.songs[setl.current]?.title || 'this song'}” (⏭ to skip there)`);
  } else {
    Object.assign(setl, { mode: 'set', songs: [...(setl.mode === 'set' ? setl.songs : []), song], current: -1, nextSong: 0 });
    startSet('set', { at: setl.songs.length - 1, keepSongs: true });
    setl.single = false;
    addMsg('info', `✨ “${song.title}” — writing it now; it starts as soon as its first section is ready`);
  }
  // back to working on the (new) song
  $('chatTarget').value = 'auto';
  save({ chatTarget: 'auto' });
  renderChatTarget();
  lastSongsKey = '';
  showPanel('song');
}

/** ⏭ the next song of the set list or station. */
function nextSong() {
  if (!setl.running) { addMsg('info', '⏭ nothing to skip to — start a set in 🎵 Songs or a 📻 Station'); return; }
  if (setlist.paused) setlist.paused = null;
  const k = setl.current + 1;
  if (setl.songs[k]) { addMsg('info', `⏭ next: “${setl.songs[k].title}”`); jumpToSong(k, setl.mode); }
  else if (setl.mode === 'station') addMsg('info', '⏭ the next song is still being planned — it plays as soon as it is written');
  else if ($('setLoop').checked && setl.songs[0]) jumpToSong(0, setl.mode);
  else addMsg('info', '⏭ this is the last song of the set');
}
/** ⏮ restart the song — or, within its first bars, go back to the previous song (like a music player). */
function prevSong() {
  if (!setl.running) { if (nowSong) playSong(nowSong); return; }
  if (setlist.paused) setlist.paused = null;
  const cur = setl.songs[setl.current];
  const first = cur?.firstStep;
  const intoSong = first?.startedAt != null ? nowCycle() - first.startedAt : Infinity;
  if ((intoSong < 4 || !cur) && setl.current > 0) { addMsg('info', `⏮ back to “${setl.songs[setl.current - 1].title}”`); jumpToSong(setl.current - 1, setl.mode); }
  else if (cur) { addMsg('info', `⏮ “${cur.title}” from the start`); jumpToSong(setl.current, setl.mode); }
}
$('nextSong').onclick = nextSong;
$('prevSong').onclick = prevSong;
/** The transport: which buttons apply now, and a one-line "what's playing". */
function renderTransport() {
  const playing = isPlaying(), paused = !!setlist.paused, running = setl.running;
  const cur = running ? setl.songs[setl.current] : null;
  $('play').disabled = playing && !paused;
  $('play').classList.toggle('on', paused);
  $('nowPause').disabled = !playing && !paused;
  $('nowPause').classList.toggle('on', paused);
  $('stop').disabled = !playing && !running && !paused;
  $('nextSong').disabled = !running;
  $('prevSong').disabled = !running && !nowSong;
  const st = setlist.steps.find((x) => x.status === 'playing');
  const line = paused ? `⏸ paused · ${cur?.title || ''} · ${setlist.paused.step.prompt || ''} bar ${setlist.paused.bar + 1}`
    : cur && playing ? `▶ ${cur.title}${st?.prompt ? ` · ${st.prompt}` : ''}`
    : running ? `✎ ${setl.songs.find((x) => x.status === 'writing')?.title || 'getting the first song ready'}…`
    : playing ? '▶ the code in the editor' : nowSong ? `■ stopped · ${nowSong.title}` : '■ stopped';
  if ($('nowLine').textContent !== line) $('nowLine').textContent = line;
  // the same transport at the top left of the code
  for (const b of $('codeBar').querySelectorAll('[data-tp]')) {
    const twin = $(b.dataset.tp);
    b.disabled = twin.disabled;
    b.classList.toggle('on', twin.classList.contains('on'));
  }
  if ($('codeLine').textContent !== line) $('codeLine').textContent = line;
}
$('codeBar').addEventListener('click', (e) => { const b = e.target.closest('[data-tp]'); if (b && !b.disabled) $(b.dataset.tp).click(); });
setInterval(renderTransport, 250);

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
  showPanel('chat');
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
    else warnUser(`AI request failed: ${err.message}`);
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
    $('shareSetlist').checked = !!setListText() && load().shareSetlist !== false;
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
        setText: $('shareSetlist').checked ? setListText() : null,
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
    if (song.setText && !setl.running) Object.assign(setl, { mode: 'set', songs: parseSongs(song.setText), current: -1, nextSong: 0 });
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

/** This session's songs as "title | description" lines (shared with a link). */
const setListText = () => (setl.mode === 'set' ? setl.songs.map((sg) => `${sg.title} | ${sg.desc}`).join('\n') : '');
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
  { name: 'pop', use: 'pop, synthwave, funk, disco, indie dance', sections: 'intro 4, verse 8, pre-chorus 4, chorus 4, verse 8, pre-chorus 4, chorus 4, bridge 8, chorus 4, outro 4' },
  { name: 'verse-chorus', use: 'short pop songs, city pop, synth pop, rock', sections: 'intro 4, verse 8, chorus 4, verse 8, chorus 4, outro 4' },
  { name: 'edm', use: 'EDM, big room, future bass, dubstep, electro', sections: 'intro 8, build 8, drop 8, breakdown 8, build 4, drop 8, outro 4' },
  { name: 'house', use: 'house, deep house, tech house, afro house, nu-disco', sections: 'intro 8, groove 8, build 4, drop 8, break 8, build 4, drop 8, outro 8' },
  { name: 'techno', use: 'techno, minimal, industrial, acid', sections: 'intro 8, groove 8, build 8, peak 8, break 8, peak 8, outro 8' },
  { name: 'trance', use: 'trance, progressive, psytrance, uplifting', sections: 'intro 8, build 8, breakdown 8, build 4, drop 8, breakdown 4, drop 8, outro 8' },
  { name: 'drum & bass', use: 'drum & bass, jungle, breakbeat, liquid', sections: 'intro 8, build 4, drop 8, breakdown 8, build 4, drop 8, outro 4' },
  { name: 'hip hop', use: 'hip hop, trap, boom bap, r&b', sections: 'intro 4, verse 8, hook 4, verse 8, hook 4, bridge 4, hook 4, outro 4' },
  { name: 'lo-fi', use: 'lo-fi, chillhop, jazz-hop, downtempo, chill', sections: 'intro 4, A 8, A 8, B 8, A 8, outro 4' },
  { name: 'jazz AABA', use: 'jazz, neo-soul, bossa nova, swing, lounge', sections: 'intro 4, A 8, A 8, B 8, A 8, solo 8, A 8, outro 4' },
  { name: 'dub', use: 'dub, reggae, dub techno, ska', sections: 'intro 8, riddim 8, dub 8, riddim 8, dub 8, outro 8' },
  { name: 'chiptune', use: 'chiptune, video game, 8-bit, arcade', sections: 'intro 4, A 8, B 8, A 8, C 8, A 8, outro 4' },
  { name: 'build & release', use: 'post-rock, cinematic builds, epic, anthems', sections: 'intro 4, build 8, build 8, peak 8, release 8, outro 4' },
  { name: 'ambient', use: 'ambient, drone, cinematic, meditation, soundscape', sections: 'intro 8, A 8, B 8, A 8, outro 8' },
  { name: 'short', use: 'quick sketches, jingles, short pieces', sections: 'intro 4, A 8, B 8, A 8, outro 4' },
  // long forms (about 4 minutes): every section changes something, so they keep moving
  { name: 'long ballad', use: 'long ballads, power ballads, soul, gospel, slow builds — about 4 minutes', sections: "intro 4, verse 8, verse 8, pre-chorus 4, chorus 4, interlude 4, verse 8, pre-chorus 4, chorus 4, chorus 4, bridge 8, breakdown 4, chorus 4, chorus 4, outro 8" },
  { name: 'ambient journey', use: 'long ambient, environmental, nature soundscapes, drone, generative, meditation — about 4 minutes', sections: "intro 8, drift 8, A 8, A' 8, swell 8, B 8, B' 8, still 8, return 8, outro 8" },
];
// built-ins before v1.19 — anything else new is added for people who already have their own list
const OLD_DEFAULT_FORMS = ['pop', 'edm', 'drum & bass', 'hip hop', 'lo-fi', 'ambient', 'short'];
/** Add built-in items the user hasn't seen yet (deleted built-ins stay deleted). */
function addNewDefaults(list, defaults, kind, oldNames) {
  const st = load();
  save({ defaultsSeen: { ...(st.defaultsSeen || {}), [kind]: defaults.map((d) => d.name) } });
  if (!list) return defaults.map((d) => ({ ...d }));
  const seen = new Set(st.defaultsSeen?.[kind] || oldNames);
  const out = [...list];
  for (const d of defaults) if (!seen.has(d.name) && !out.some((x) => x.name === d.name)) out.push({ ...d });
  return out;
}
let songForms = addNewDefaults(load().songForms, DEFAULT_FORMS, 'forms', OLD_DEFAULT_FORMS);
// built-in forms whose choruses used to be 8 bars: update them unless the user changed them
const OLD_FORM_SECTIONS = { 'pop': 'intro 4, verse 8, pre-chorus 4, chorus 8, verse 8, pre-chorus 4, chorus 8, bridge 8, chorus 8, outro 4', 'verse-chorus': 'intro 4, verse 8, chorus 8, verse 8, chorus 8, outro 4', 'hip hop': 'intro 4, verse 8, hook 8, verse 8, hook 8, bridge 4, hook 8, outro 4' };
for (const f of songForms) {
  const d = DEFAULT_FORMS.find((x) => x.name === f.name);
  if (d && OLD_FORM_SECTIONS[f.name] === f.sections) f.sections = d.sections;
}
save({ songForms });
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
// Bands: a line-up of instruments (role, sound, what it plays) and a master style. A song is written for a band:
// the song-sheet request gives the AI the band's instruments, and the sheet that comes back is held to them (each
// part takes the band's sound for its role). Auto: the AI picks the band that fits the genre. Editable in ⚙ Settings.
// ---------------------------------------------------------------------------
const DEFAULT_BANDS = [
  { name: 'lo-fi trio', use: 'lo-fi, chillhop, jazz-hop, study beats', master: 'lo-fi', instruments: 'drums: AkaiMPC60 — dusty, laid-back boom-bap kit\nbass: gm_acoustic_bass — round upright bass\nchords: gm_epiano1 — warm Rhodes chords\nmelody: gm_vibraphone — soft mallet hook\ncounter: gm_muted_trumpet — smoky answers to the hook\npad: gm_pad_warm — a soft bed under the chords\nfx: gm_fx_rain — rain-like texture' },
  { name: 'house crew', use: 'house, deep house, tech house, nu-disco, garage', master: 'house', instruments: 'drums: RolandTR909 — four-on-the-floor kick, open hats, claps\nbass: gm_synth_bass_1 — rolling analog bass\nchords: gm_percussive_organ — offbeat organ stabs\npad: gm_string_ensemble_1 — disco strings\nmelody: gm_epiano2 — glassy hook\ncounter: gm_electric_guitar_muted — funky muted riff' },
  { name: 'techno rig', use: 'techno, minimal, industrial, acid', master: 'techno', instruments: 'drums: RolandTR909 — driving kick, rides, claps\nperc: RolandTR606 — ticky percussion and toms\nbass: sawtooth — acid bass, filtered\narp: square — hypnotic sequence\npad: gm_pad_sweep — dark filter-swept pad\nfx: white — noise risers and sweeps' },
  { name: 'synthwave', use: 'synthwave, retrowave, outrun, 80s pop, Italo disco', master: 'synthwave', instruments: 'drums: LinnDrum — big 80s kit\nbass: gm_synth_bass_1 — pulsing eighth-note bass\nchords: gm_pad_poly — polysynth chords\narp: sawtooth — bright arpeggio\nmelody: gm_lead_2_sawtooth — soaring saw lead\ncounter: gm_synth_brass_1 — synth brass answers\npad: gm_synth_strings_1 — string machine' },
  { name: 'jazz combo', use: 'jazz, swing, bossa nova, neo-soul, lounge', master: 'warm', instruments: 'drums: YamahaRY30 — light kit, brushes feel, ride\nbass: gm_acoustic_bass — walking upright bass\nchords: gm_piano — comping piano\nmelody: gm_tenor_sax — the tune\ncounter: gm_vibraphone — vibes answering the sax\npad: gm_electric_guitar_jazz — soft hollow-body chords' },
  { name: 'hip hop producer', use: 'hip hop, trap, boom bap, R&B', master: 'hiphop', instruments: 'drums: RolandTR808 — booming kick, snappy snare, rolling hats\nbass: sine — deep 808-style sub\nchords: gm_epiano1 — mellow keys\nmelody: gm_celesta — bell hook\ncounter: gm_pizzicato_strings — plucked answers\npad: gm_string_ensemble_2 — slow strings' },
  { name: 'drum & bass unit', use: 'drum & bass, jungle, liquid, breakbeat', master: 'dnb', instruments: 'drums: AkaiMPC60 — fast breakbeat kit\nbass: gm_lead_8_bass_lead — heavy reese-style bass\nchords: gm_epiano2 — liquid chords\npad: gm_pad_new_age — shimmering pad\nmelody: gm_lead_6_voice — airy vocal-like lead\nfx: white — risers' },
  { name: 'pop band', use: 'pop, synth-pop, city pop, funk, disco, indie', master: 'pop', instruments: 'drums: LinnDrum — punchy pop kit\nbass: gm_electric_bass_finger — round electric bass\nchords: gm_electric_guitar_clean — clean rhythm guitar\nmelody: gm_lead_1_square — catchy synth hook\ncounter: gm_glockenspiel — sparkly answers\npad: gm_synth_strings_1 — string pad' },
  { name: 'rock band', use: 'rock, indie rock, punk, metal, grunge', master: 'rock', instruments: 'drums: AlesisHR16 — rock kit, crashes\nbass: gm_electric_bass_pick — punchy picked bass\nchords: gm_overdriven_guitar — crunchy rhythm guitar\nmelody: gm_distortion_guitar — lead guitar\npad: gm_rock_organ — organ swell' },
  { name: 'ambient ensemble', use: 'ambient, drone, new age, soundscapes, meditation', master: 'ambient', instruments: 'pad: gm_pad_halo — airy pad\npad: gm_pad_bowed — bowed glass drone\nbass: sine — soft sub\nmelody: gm_kalimba — sparse thumb-piano figure\ncounter: gm_shakuhachi — breathy long notes\nfx: gm_fx_atmosphere — evolving texture\nperc: gm_marimba — soft, sparse wooden hits' },
  { name: 'cinematic orchestra', use: 'cinematic, film score, epic, orchestral, post-rock', master: 'cinematic', instruments: 'perc: gm_taiko_drum — big drums\nbass: gm_contrabass — low strings\nchords: gm_string_ensemble_1 — orchestral strings\nmelody: gm_french_horn — the theme\ncounter: gm_violin — soaring counter-line\narp: gm_orchestral_harp — harp arpeggios\npad: gm_choir_aahs — choir' },
  { name: 'dub sound system', use: 'dub, reggae, dub techno, ska', master: 'dub', instruments: 'drums: RolandTR808 — one-drop kit, rimshots\nbass: gm_electric_bass_finger — deep, heavy bass\nchords: gm_drawbar_organ — offbeat skank\nmelody: gm_trombone — the riddim melody\nfx: gm_fx_echoes — echo texture' },
  { name: 'chip band', use: 'chiptune, 8-bit, video game, arcade', master: 'chiptune', instruments: 'perc: white — noise drums\nbass: triangle — chip bass\narp: square — fast chord arpeggios\nmelody: pulse — chip lead\ncounter: square — second channel' },
];
const BAND_ROLES = ['drums', 'perc', 'bass', 'chords', 'pad', 'arp', 'melody', 'counter', 'fx'];
let bands = addNewDefaults(load().bands, DEFAULT_BANDS, 'bands', []);
save({ bands });
let bandIdx = 0;
/** "drums: RolandTR909 — four on the floor" lines → [{ role, sound, desc }] */
function parseInstruments(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^([a-z]+)\s*:\s*([A-Za-z0-9_]+)\s*(?:[—–-]+\s*(.*))?$/i);
    return m ? { role: m[1].toLowerCase(), sound: m[2], desc: (m[3] || '').trim() } : null;
  }).filter(Boolean);
}
const findBand = (name) => bands.find((b) => b.name.toLowerCase() === String(name || '').trim().toLowerCase());
/** A song's master style: its own, else its band's, else one that fits its form, else clean. */
const songStyle = (sg) => normStyle(sg?.sheet?.master) || normStyle(findBand(sg?.sheet?.band)?.master) || normStyle(sg?.sheet?.form) || 'clean';
const bandChoice = () => $(setl.mode === 'station' ? 'stationBand' : 'setBand')?.value || 'auto';
/** The bands part of a song-sheet request: one fixed band, or all of them to choose from. */
function bandsForRequest(choice) {
  const line = (b) => `- "${b.name}"${b.use ? ` (for ${b.use})` : ''} — master "${normStyle(b.master) || 'clean'}":\n${parseInstruments(b.instruments).map((i) => `    ${i.role}: ${i.sound}${i.desc ? ` — ${i.desc}` : ''}`).join('\n')}`;
  const fixed = choice && choice !== 'auto' ? findBand(choice) : null;
  if (fixed) return `BAND — write the song for exactly this band (set "band": "${fixed.name}" and "master": "${normStyle(fixed.master) || 'clean'}"); every part uses one of its instruments, with the role given:\n${line(fixed)}`;
  return `BANDS — if one fits this song's genre, write for it: set "band" to its name, take its master style, and give every part one of its instruments (with the role given). If none fits, set "band": "none" and choose the sounds yourself from the sound guide:\n${bands.map(line).join('\n')}`;
}
/** Hold a sheet's parts to its band: a part whose sound isn't the band's for its role gets the band's sound. */
function enforceBand(parts, band) {
  const inst = parseInstruments(band.instruments);
  const used = new Map();
  for (const p of parts) {
    const cands = inst.filter((i) => i.role === p.role);
    if (!cands.length || cands.some((i) => i.sound.toLowerCase() === p.sound.toLowerCase())) continue;
    const n = used.get(p.role) || 0;
    used.set(p.role, n + 1);
    p.sound = cands[n % cands.length].sound;
  }
}
function renderBandSelects() {
  for (const id of ['setBand', 'stationBand']) {
    const el = $(id);
    const keep = el.value || load()[id] || 'auto';
    el.innerHTML = '<option value="auto">auto (fits the genre)</option>' + bands.map((b) => `<option value="${esc(b.name)}">${esc(b.name)} · ${esc(normStyle(b.master) || 'clean')}</option>`).join('');
    el.value = keep === 'auto' || findBand(keep) ? keep : 'auto';
  }
}
function saveBands() { save({ bands }); renderBandSelects(); }
function renderBandsEditor() {
  bandIdx = Math.max(0, Math.min(bandIdx, bands.length - 1));
  $('bandSelect').innerHTML = bands.map((b, i) => `<option value="${i}">${esc(b.name || 'untitled')}</option>`).join('');
  $('bandSelect').value = String(bandIdx);
  $('bandMaster').innerHTML = STYLE_NAMES.map((n) => `<option value="${n}">${n} — ${esc(MASTER_STYLES[n].desc)}</option>`).join('');
  const b = bands[bandIdx] || { name: '', use: '', master: 'clean', instruments: '' };
  $('bandName').value = b.name;
  $('bandUse').value = b.use;
  $('bandMaster').value = normStyle(b.master) || 'clean';
  $('bandInstruments').value = b.instruments;
  renderBandPreview();
}
async function renderBandPreview() {
  const inst = parseInstruments($('bandInstruments').value);
  const reg = await soundRegistry().catch(() => null);
  const known = (snd) => !reg || reg[snd.toLowerCase()] || Object.keys(reg).some((k) => k.startsWith(snd.toLowerCase() + '_'));
  $('bandPreview').innerHTML = inst.length
    ? inst.map((i) => `<span class="chip${BAND_ROLES.includes(i.role) && known(i.sound) ? '' : ' bad'}" title="${esc(i.desc)}${known(i.sound) ? '' : ' — this sound is not loaded'}${BAND_ROLES.includes(i.role) ? '' : ' — unknown role'}"><b>${esc(i.role)}</b> ${esc(i.sound)}</span>`).join('') + `<div class="muted small">${inst.length} instruments · master ${esc($('bandMaster').value)}</div>`
    : '<span class="muted small">no instruments yet</span>';
}
for (const id of ['bandName', 'bandUse', 'bandInstruments', 'bandMaster']) {
  $(id)[id === 'bandMaster' ? 'onchange' : 'oninput'] = () => {
    const b = bands[bandIdx];
    if (!b) return;
    b.name = $('bandName').value.trim();
    b.use = $('bandUse').value.trim();
    b.master = $('bandMaster').value;
    b.instruments = $('bandInstruments').value;
    if (id === 'bandName') $('bandSelect').options[bandIdx].textContent = b.name || 'untitled';
    if (id === 'bandInstruments' || id === 'bandMaster') renderBandPreview();
    saveBands();
  };
}
$('bandSelect').onchange = () => { bandIdx = Number($('bandSelect').value); renderBandsEditor(); };
$('bandNew').onclick = () => {
  bands.push({ name: 'my band', use: '', master: 'clean', instruments: 'drums: RolandTR909 — the beat\nbass: gm_synth_bass_1 — the low end\nchords: gm_epiano1 — the harmony\nmelody: gm_lead_2_sawtooth — the hook' });
  bandIdx = bands.length - 1;
  saveBands(); renderBandsEditor(); $('bandName').select();
};
$('bandDelete').onclick = () => {
  if (!bands[bandIdx] || !confirm(`Delete the band “${bands[bandIdx].name}”?`)) return;
  bands.splice(bandIdx, 1);
  if (!bands.length) bands = DEFAULT_BANDS.map((b) => ({ ...b }));
  saveBands(); renderBandsEditor();
};
$('bandReset').onclick = () => {
  for (const d of DEFAULT_BANDS) {
    const b = findBand(d.name);
    if (b) Object.assign(b, d); else bands.push({ ...d });
  }
  saveBands(); renderBandsEditor();
};
for (const b of document.querySelectorAll('.bands-edit')) b.onclick = () => openSettings('setBands');
for (const id of ['setBand', 'stationBand']) $(id).onchange = () => save({ [id]: $(id).value });
renderBandSelects();

// ---------------------------------------------------------------------------
// Song sheets: for the Songs tab and the Station, the AI first plans the whole song
// as data (tempo, key, chord progressions, hook, parts, form), then writes every
// part once as a library of named patterns. The app arranges each section from the
// library itself, so a chorus is the same code every time, the key and sounds never
// drift, and parts that continue from one section to the next are identical (the
// crossfade keeps them steady).
// ---------------------------------------------------------------------------
const MAX_CHORUS_BARS = 4;
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
const ENTER_MODES = ['in', 'out', 'alt'];
/** Bars a part plays in a section that brings it in / out: a mask, one step per bar. */
function enterMask(mode, bars) {
  if (!mode || bars < 2) return null;
  const half = Math.floor(bars / 2);
  const steps = Array.from({ length: bars }, (_, k) => (mode === 'in' ? k >= half : mode === 'out' ? k < half : k % 4 < 2) ? 1 : 0);
  return `<${steps.join(' ')}>`;
}
/** Every part of a section is anchored to the bar the section starts on (set when it's armed), so phrases and chord progressions start on their first bar. */
const SECTION_START_RE = /^const sectionStart = -?[\d.]+.*$/m;
// (the finished section is wrapped to about 150 characters a line: see format.js)
const atSectionStart = (code, bar) => wrapCode(partVisuals(SECTION_START_RE.test(code) ? code.replace(SECTION_START_RE, `const sectionStart = ${Math.round(bar)} // the bar this section started on`) : code));

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
function partVisuals(code) {
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
const MAX_KEY_SHIFT = 3;      // semitones a section may move away from the song's key
const MAX_TEMPO_DRIFT = 0.08; // a section's tempo stays within ±8% of the song's
// usual spellings: major-ish roots Db Eb F# Ab Bb, minor roots C# Eb F# G# Bb
const ROOT_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const ROOT_MINOR = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Move every chord root (and slash bass) of a progression by n semitones: "<Am F C G>" +2 → "<Bm G D A>". */
function transposeProgression(prog, n) {
  if (!n) return prog;
  return prog.replace(/(^|[\s<\[/])([A-G])([#b]?)(m(?!aj)|o)?/g, (_, pre, l, acc, minor = '') => {
    const pc = (NOTE_PC[l] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + n + 120) % 12;
    return pre + (minor && pre !== '/' ? ROOT_MINOR : ROOT_MAJOR)[pc] + minor;
  });
}
const signed = (n) => (n > 0 ? `+${n}` : String(n));
// time signatures: one cycle is one bar; bpm counts the meter's beats (dotted quarters in 6/8, 9/8, 12/8)
const METERS = ['4/4', '3/4', '6/8', '12/8', '5/4', '7/8', '7/4', '9/8', '2/4'];
function normMeter(m) {
  const t = String(m || '').replace(/\s+/g, '').match(/^(\d+)\/(\d+)$/);
  const k = t ? `${Number(t[1])}/${Number(t[2])}` : '4/4';
  return METERS.includes(k) ? k : '4/4';
}
/** Beats per bar for the tempo line: 4/4 → 4, 3/4 → 3, 6/8 → 2 (dotted quarters), 7/8 → 3.5 (quarters). */
function meterBeats(m) {
  const [n, d] = normMeter(m).split('/').map(Number);
  return d === 8 && n % 3 === 0 ? n / 3 : (n * 4) / d;
}
/** Steps per bar for rhythms: the meter's top number. */
const meterSteps = (m) => Number(normMeter(m).split('/')[0]);
/** The app's tempo line for a bpm in a meter. */
const tempoLine = (bpm, meter) => `setcpm(${bpm}/${meterBeats(meter)})`;
const songMeter = (sg) => normMeter(sg?.sheet?.meter);

function normalizeSheet(raw, choice = 'auto', { enforceForm = true, band: bandPick = null } = {}) {
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
  const meter = normMeter(raw.meter || raw.time || raw.timeSignature);
  const hook = String(raw.hook || '0 2 4 2').replace(/[^0-9~\s\-\[\]<>.*@!_?,:]/g, ' ').replace(/\s+/g, ' ').trim() || '0 2 4 2';
  const parts = [];
  for (const p of Array.isArray(raw.parts) ? raw.parts : []) {
    const id = ident(p.name || p.role);
    if (parts.some((q) => q.id === id)) continue;
    const variants = [...new Set(['main', ...(Array.isArray(p.variants) ? p.variants : []).map(ident)])];
    parts.push({ id, role: String(p.role || '').toLowerCase(), sound: String(p.sound || ''), desc: String(p.desc || p.description || ''), variants });
  }
  if (parts.length < 2) throw new Error('fewer than 2 parts');
  parts.splice(10);
  const firstChords = Object.keys(chords)[0];
  const sections = [];
  for (const sec of Array.isArray(raw.sections) ? raw.sections : []) {
    const bars = Math.max(1, Math.min(enforceForm ? 16 : 32, Math.round(Number(sec.bars) || 8)));
    const ck = ident(sec.chords);
    const play = [];
    for (const ref of Array.isArray(sec.play) ? sec.play : []) {
      // "part", "part.variant", optionally "@in" (enters halfway), "@out" (drops out halfway), "@alt" (2 bars on, 2 off)
      const [name, how] = String(ref).split('@');
      const [pn, vn] = name.split(/[.:]/);
      const part = parts.find((q) => q.id === ident(pn));
      if (!part) continue;
      const variant = vn && part.variants.includes(ident(vn)) ? ident(vn) : 'main';
      const enter = ENTER_MODES.includes(String(how || '').trim().toLowerCase()) ? String(how).trim().toLowerCase() : null;
      if (!play.some((x) => x.part === part.id)) play.push({ part: part.id, variant, ...(enter ? { enter } : {}) });
    }
    if (!play.length && sections.length) play.push(...sections[sections.length - 1].play);
    if (!play.length) play.push({ part: parts[0].id, variant: 'main' });
    const name = String(sec.name || sec.type || 'section').slice(0, 40);
    const out = { name, type: sectionType(name), bars, chords: chords[ck] ? ck : firstChords, play };
    // key and tempo may move a little as the song goes on (a lifted last chorus, a tempo push)
    // (lenient: "+2", "104 bpm", tempo / key_shift spellings; edits the user asks for may move further)
    const shift = Math.round(parseFloat(sec.shift ?? sec.transpose ?? sec.key_shift ?? sec.keyShift) || 0);
    const maxShift = enforceForm ? MAX_KEY_SHIFT : 6;
    if (shift) out.shift = Math.max(-maxShift, Math.min(maxShift, shift));
    const sbpm = Math.round(parseFloat(sec.bpm ?? sec.tempo) || 0);
    if (sbpm) {
      const lim = Math.max(2, Math.round(bpm * (enforceForm ? MAX_TEMPO_DRIFT : 0.3)));
      const b2 = Math.max(bpm - lim, Math.min(bpm + lim, sbpm));
      if (b2 !== bpm) out.bpm = b2;
    }
    sections.push(out);
  }
  if (sections.length < 2) throw new Error('fewer than 2 sections');
  // the form decides the section lengths: take its bar counts when the sections line up, otherwise cap them
  const form = enforceForm ? (choice !== 'auto' && findForm(choice)) || findForm(raw.form) : null;
  const fsecs = form ? parseFormSections(form.sections) : [];
  if (fsecs.length === sections.length) sections.forEach((sec, j) => { sec.bars = fsecs[j].bars; });
  else {
    const cap = fsecs.length ? Math.max(...fsecs.map((x) => x.bars)) : 16;
    for (const sec of sections) sec.bars = Math.min(sec.bars, cap);
  }
  if (!enforceForm) for (const sec of sections) sec.bars = Math.max(1, Math.min(32, sec.bars));
  // choruses (and hooks) are short and punchy: never longer than 4 bars
  for (const sec of sections) if (sec.type === 'chorus') sec.bars = Math.min(sec.bars, MAX_CHORUS_BARS);
  // the band: its instruments win (when the song is being written), and its master style is the default
  const band = (bandPick && bandPick !== 'auto' && findBand(bandPick)) || findBand(raw.band);
  if (band && enforceForm) enforceBand(parts, band);
  const masterStyle = normStyle(raw.master || raw.masterStyle) || normStyle(band?.master) || normStyle(form?.name || raw.form) || 'clean';
  const tweaks = raw.masterParams && typeof raw.masterParams === 'object' ? diffParams(styleParams(masterStyle, raw.masterParams), masterStyle) : {};
  return { form: form?.name || String(raw.form || ''), ...(band ? { band: band.name } : {}), master: masterStyle, ...(Object.keys(tweaks).length ? { masterParams: tweaks } : {}),
    bpm, meter, key: String(raw.key || scale.replace(':', ' ')), scale, chords, hook, parts, sections };
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

/** The sounds for a song sheet: the full list plus the sound guide (what each sound is good for). */
async function sheetSounds() {
  const catalog = await soundCatalog().catch(() => '');
  const reg = await soundRegistry().catch(() => null);
  if (!reg) return catalog;
  const avail = new Set(Object.keys(reg));
  for (const k of Object.keys(reg)) { const i = k.lastIndexOf('_'); if (i > 0 && reg[k].data?.type === 'sample') avail.add(k.slice(0, i)); }
  const guide = soundGuide(avail);
  return guide.length ? `${catalog}\n\nSOUND GUIDE — what the most useful sounds are good for (role · character · genres); pick sounds that fit the genre and each other:\n${guide.join('\n')}` : catalog;
}
async function writeSongSheet(song, signal) {
  const choice = formChoice(), bandPick = bandChoice();
  const prev = setl.songs[setl.songs.indexOf(song) - 1]?.sheet;
  let msg = (song.autoTitle ? `SONG (no title yet — give it one in "title"): ${song.desc}\n` : `SONG: "${song.title}" — ${song.desc}\n`) +
    (prev ? `The previous song was ${prev.bpm} bpm, ${normMeter(prev.meter)}, in ${prev.key}; this one should flow from it (a related key or a nearby tempo is nice).\n` : '') +
    `\n${formsForRequest(choice)}\n\n${bandsForRequest(bandPick)}\n\nMASTER STYLES — set "master" to the one that fits (the band's, unless the description asks for another):\n${stylesForPrompt()}\n\nWrite the song sheet JSON.`;
  const sounds = await sheetSounds();
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    song.phase = 'writing the song sheet';
    const text = await requestLLM({ mode: 'sheet', messages: [{ role: 'user', content: msg }], signal, label: `“${song.title}” sheet`, sounds });
    try {
      const raw = parseJSONLoose(text);
      const sh = normalizeSheet(raw, choice, { band: bandPick });
      // a song created from a description gets its name from the songwriter
      if (song.autoTitle && typeof raw.title === 'string' && raw.title.trim()) { song.title = raw.title.trim().slice(0, 60); song.autoTitle = false; }
      clog('ok', `✓ “${song.title}” sheet: ${sh.form || 'form ?'}${sh.band ? ` · 🎸 ${sh.band}` : ''} · 🎛 ${sh.master} · ${sh.bpm} bpm · ${sh.key} · ${sh.sections.length} sections · parts ${sh.parts.map((p) => p.id).join(', ')}`);
      return sh;
    } catch (e) {
      lastErr = e;
      clog('warn', `✗ “${song.title}” sheet unusable: ${e.message}`);
      msg = msg.replace(/\n\nYOUR PREVIOUS REPLY[\s\S]*$/, '') +
        `\n\nYOUR PREVIOUS REPLY could not be used (${e.message}). Reply with ONLY the JSON object, exactly in the example's format.`;
    }
  }
  throw new Error(`no usable song sheet (${lastErr?.message})`);
}

/** The sounds a song's parts may use: the sheet's choices, their drum machines' drums, plus the basic synths. */
async function partsCatalog(sh) {
  const reg = await soundRegistry();
  if (!reg) return '';
  const keys = Object.keys(reg);
  const want = new Set(['sawtooth', 'square', 'triangle', 'sine', 'supersaw', 'white', 'pink', 'brown']);
  const lines = [];
  for (const p of sh.parts) {
    const snd = String(p.sound || '').trim();
    const key = snd.toLowerCase();
    const drums = keys.filter((k) => k.startsWith(key + '_') && reg[k].data?.type === 'sample').map((k) => k.slice(key.length + 1));
    if (drums.length) lines.push(`Drum machine ${snd}: s("…").bank("${snd}") with drums: ${drums.join(' ')}`);
    else if (reg[key]) want.add(key);
    else {
      const { best } = closest(snd || 'x', keys);
      if (best) want.add(best);
    }
  }
  // plain drum samples for parts without a bank
  for (const k of ['bd', 'sd', 'hh', 'oh', 'cp', 'rim', 'lt', 'mt', 'ht', 'cr', 'perc']) if (reg[k]) want.add(k);
  return `Sounds for this song: ${[...want].filter((k) => reg[k]).join(' ')}\n${lines.join('\n')}`;
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
    const vdesc = variant === 'main' ? ''
      : variant === 'fill' && p === fp ? ' (ONE-bar fill leading into the next section)'
      : /^alt/.test(variant) ? ` (an ALTERNATE ${p.role || 'part'}: same sound and register as ${p.id}_main, but a clearly different line — new rhythm, contour or figure — that still fits the chords and the other parts; it gives the sections that use it their own character)`
      : /harm/.test(variant) ? ` (a HARMONY of ${p.id}_main: same rhythm, a third or sixth above — e.g. the same degrees .add(2) — softer gain)`
      : ` (${variant} version of ${p.id}_main)`;
    return `- ${id}  [${kind}]  ${p.role}, sound ${p.sound || '(your choice)'}: ${p.desc}${vdesc}${extra}`;
  });
  const base =
    `SONG: "${song.title}" — ${song.desc}\n` +
    `Tempo line: ${tempoLine(sh.bpm, sh.meter)}   Key / scale: ${sh.key} → .scale("${sh.scale}")\n` +
    `Meter: ${normMeter(sh.meter)} — one cycle is ONE BAR of ${meterSteps(sh.meter)} ${/\/8$/.test(normMeter(sh.meter)) ? 'eighth notes' : 'beats'}: ` +
    `write every rhythm with ${meterSteps(sh.meter)} (or ${meterSteps(sh.meter) * 2}) steps per bar${normMeter(sh.meter) === '4/4' ? '' : ' — NOT 4 or 8'}.\n` +
    `Chord progressions the sections use: ${Object.entries(sh.chords).map(([k, v]) => `${k} ${v}`).join(' · ')}\n` +
    `Hook (scale degrees): "${sh.hook}"\n\n` +
    `Write the part library. Define EXACTLY these consts:\n${need.join('\n')}`;
  let content = fix && prev
    ? `${base}\n\nTHE CURRENT LIBRARY:\n\`\`\`javascript\n${prev}\n\`\`\`\nIt failed when played: ${fix}${/scale/i.test(fix) ? '\n' + scaleHelp() : ''}\nReturn the corrected COMPLETE library.`
    : base;
  let lastErr;
  // the parts step only needs the sounds the sheet chose (a fraction of the full list → far fewer tokens)
  const sounds = await partsCatalog(sh);
  let partial = null; // a library that only lacked some consts: the next reply adds just those
  for (let attempt = 0; attempt < 3; attempt++) {
    song.phase = fix ? 'fixing the parts' : partial ? 'writing the missing parts' : 'writing the parts';
    const text = await requestLLM({ mode: 'library', messages: [{ role: 'user', content }], signal, sounds, label: `“${song.title}” parts${fix ? ' fix' : partial ? ' (missing)' : ''}` });
    let lib = extractCode(text);
    let err = null;
    if (!lib) err = 'no ```javascript code block in the reply';
    else {
      // parts written as labels ("bass_main: …") are meant as consts
      lib = lib.replace(/^([A-Za-z_$][\w$]*):(?!:)\s*/gm, (m, n) => (libraryIds(sh).includes(n) ? `const ${n} = ` : m));
      // the missing consts were asked for: add them to what we had (a repeated one keeps the first version)
      if (partial) {
        const extra = lib.split(/\n(?=\s*const\s)/).filter((d) => { const id = d.match(/^\s*const\s+([\w$]+)/)?.[1]; return !id || !definesId(partial, id); });
        lib = `${partial}\n${extra.join('\n')}`;
      }
      // the app owns the tempo line
      lib = `${tempoLine(sh.bpm, sh.meter)}\n` + lib.replace(/^\s*setcp[ms]\([^)]*\)\s*;?\s*$/gm, '').trim();
      const missing = libraryIds(sh).filter((id) => !definesId(lib, id));
      if (missing.length) err = `these consts are missing: ${missing.join(', ')}`;
      else if (patternLines(lib).length) err = 'the library must not contain labelled lines like "drums:" or "$:" — only const definitions';
      else err = syntaxError(lib);
      if (!err) {
        const prep = await prepareCode(lib, { quiet: true, library: true });
        lib = prep.code;
        err = prep.error || testLibrary(lib, sh)?.message || null;
      }
    }
    if (!err) { clog('ok', `✓ “${song.title}” parts checked and test-played`); return wrapCode(lib); }
    lastErr = err;
    clog('warn', `✗ “${song.title}” parts: ${err}`);
    // only some consts are missing: ask for just those (much shorter than the whole library again)
    const missing = lib ? libraryIds(sh).filter((id) => !definesId(lib, id)) : [];
    if (lib && missing.length && missing.length < libraryIds(sh).length && !syntaxError(lib)) {
      partial = lib;
      content = `${base}\n\nTHE LIBRARY SO FAR (keep it as it is):\n\`\`\`javascript\n${lib}\n\`\`\`\n` +
        `It is missing these consts: ${missing.join(', ')}. Reply with ONE \`\`\`javascript block that defines ONLY the missing consts, ` +
        'in the same style, sounds and key, fitting the parts above.';
      continue;
    }
    partial = null;
    content = `${base}\n\nYOUR PREVIOUS LIBRARY:\n\`\`\`javascript\n${lib || ''}\n\`\`\`\nIt can't be used: ${err}${/scale/i.test(err) ? '\n' + scaleHelp() : ''}\nReturn the corrected COMPLETE library.`;
  }
  throw new Error(`no usable part library (${lastErr})`);
}

/** Full program for one section: the library, then one labelled group per part. */
function sectionCode(song, sec, { fill = false } = {}) {
  const lib = song.library;
  const fp = fill ? fillPart(song.sheet) : null;
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
    const id = `${x.part}_${fp && x.part === fp.id ? 'fill' : x.variant}`;
    const part = song.sheet.parts.find((p) => p.id === x.part);
    // harmonic parts follow the (moved) chords; melodic plain parts (the hook) are moved with them; drums never
    const lift = shift && !isFnPart(lib, id) && !/drum|perc|beat|fx|noise/i.test(`${part?.role} ${x.part}`) ? `.transpose(${shift})` : '';
    const mask = fill ? null : enterMask(x.enter, sec.bars);
    lines.push(`${x.part}: ${partExpr(lib, id)}${lift}${mask ? `.mask("${mask}")` : ''}.postgain(slider(1, 0, 1.5)).late(sectionStart)`);
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
    clog('warn', `🔧 “${song.title}”: a section failed when test-played (${err}) — fixing the parts…`);
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

/** Write (or reuse) a song's blocks and append them to the engine. */
/** Sheet → library → arranged steps; null when that fails (the song is then written block by block). */
async function sheetSteps(song) {
  song.status = 'writing';
  try {
    song.sheet = await writeSongSheet(song, setl.abort.signal);
    song.library = await writeSongLibrary(song, setl.abort.signal);
    song.phase = null;
    const steps = arrangeSong(song);
    song.pads = songPads(song);
    return steps;
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    song.sheet = song.sheet || null;
    song.library = null;
    clog('warn', `“${song.title}”: ${e.message} — writing it block by block instead`);
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
      if (ahead < 1 && setl.mode === 'set' && $('setLoop').checked && !setl.single && setl.songs.length) {
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
      clog('error', `${setl.mode === 'station' ? 'Station' : 'Set list'}: ${e.message} (try ${failures + 1}/5)`);
      failures++;
      if (failures >= 5) { warnUser(`${setl.mode === 'station' ? 'Station' : 'Set list'} stopped: the AI failed 5 times in a row (last: ${e.message})`); addMsg('info', `■ ${setl.mode === 'station' ? 'station' : 'set'} stopped — see ⚠ in the status bar`); stopSet(); return; }
      await sleep(3000 * failures);
    }
    await sleep(400);
  }
}

function makeFeeder() {
  return {
    label: setl.mode === 'station' ? `station “${setl.station.name || 'untitled'}”` : 'set list',
    active: () => setl.running && (setl.mode === 'station' || setl.nextSong < setl.songs.length || setl.forceJump !== null ||
      ($('setLoop').checked && !setl.single && setl.songs.length > 0) || setl.songs.some((sg) => sg.status === 'writing')),
    onStepStart: (step) => {
      if (!step.song) return;
      mp3SongStep(step);
      nowSong = step.song; // 🎶 Now playing keeps showing it after it ends
      if (padsState.follow && step.song.pads && padsState.owner !== step.song) loadPads(step.song.pads, step.song);
      const k = setl.songs.indexOf(step.song);
      if (k < 0 || (k === setl.current && step.song.status === 'playing')) return;
      setl.songs.forEach((sg) => { if (sg.status === 'playing' && sg !== step.song) sg.status = 'done'; });
      step.song.status = 'playing';
      step.song.playedAt = Date.now();
      logPlayed(step.song, setl.mode === 'station' ? `station “${setl.station?.name || ''}”` : 'songs');
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
    if (setl.mode !== 'set' || !setl.songs.length) { addMsg('info', 'No songs yet — create one in 💬 Chat with 🎯 ✨ new song.'); return; }
    setl.songs.forEach((sg) => { sg.status = sg.blocks ? 'ready' : 'waiting'; sg.error = null; });
  } else {
    const st = currentStation();
    if (!st.theme.trim()) { addMsg('error', 'Give the station a theme first.'); return; }
    setl.station = { ...st };
    setl.songs = [];
  }
  stopSet(false);
  songSel[mode] = null; // follow the song that is playing
  Object.assign(setl, { running: true, mode, nextSong: at, current: at - 1, forceJump: null, abort: new AbortController(), textDirty: false, single: false });
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
  if (stopEngine) mp3TakeEnd(false); // stopped mid-song: drop the partial recording
  if (stopEngine && setlist.feeder) stopSetlist();
  updateSetButtons();
  document.title = 'Strudel AI';
}

function jumpToSong(k, from = 'set') {
  const mode = setl.running ? setl.mode : 'set';
  if (!setl.running) return startSet(from, { at: k, keepSongs: true });
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
  void set;
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
const NOW_LINK = '<button class="open-now" data-open-now title="Open the 🎶 Now playing panel: the song\'s sheet, sections and progress">🎶 Now playing ↗</button>';
const sharedLinkHTML = (sg) => (sg.shareUrl ? `<div class="sv-shared">🔗 <input readonly value="${esc(sg.shareUrl)}" /><button class="sv-copy">📋 Copy</button><a href="${esc(sg.shareUrl)}" target="_blank" rel="noopener">open ↗</a></div>` : '');
/** A song list. With `tools`, the selected song shows its toolbar in place (the station list: details live in 🎶 Now playing). */
function songsHTML(songs, live, sel, { tools = false } = {}) {
  return songs.map((sg, k) => {
    const meta = songMeta(sg);
    const isCurrent = live && setl.songs[setl.current] === sg;
    const toolbar = tools && k === sel ? `<div class="song-tools">${songToolbarHTML(sg, live)}${isCurrent ? NOW_LINK : ''}${sharedLinkHTML(sg)}</div>` : '';
    return `<div class="song ${sg.status}${k === sel ? ' selected' : ''}" data-k="${k}" title="${tools ? 'Show this song’s buttons' : 'Show this song’s sheet and sections'}">
      <span class="ico">${SONG_ICON[sg.status] || '·'}</span>
      <div class="body"><div class="t">${k + 1}. ${esc(sg.title)}</div><div class="d">${esc(sg.desc)}</div>
        ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}${sg.error ? `<span class="err-icon" title="${esc(sg.error)}">⚠</span>` : ''}${toolbar}</div>
      <button class="jump" data-song="${k}" title="Switch to this song">⏭ go</button>
    </div>`;
  }).join('') + (live && setl.planning ? '<div class="song writing"><span class="ico">✎</span><div class="body"><div class="d">planning the next songs…</div></div></div>' : '');
}

/** A song's toolbar: play, edit, favorite, save, song pads, MP3, JSON, link (only once the song is written). */
function songToolbarHTML(sg, live) {
  const sh = sg.sheet;
  const isCurrent = live && setl.songs[setl.current] === sg;
  const complete = sg.blocks?.length && sg.blocks.every((b) => b.code) && !sg.phase;
  if (!complete) return '';
  const mine = isMine(sg);
  const canPlay = complete && !(isCurrent);
  const btn = (act, label, title) => `<button data-act="${act}" title="${esc(title)}">${label}</button>`;
  return `<div class="sv-toolbar">
      ${canPlay ? btn('play', '▶ Play', 'Play this song from the start (already written — no AI needed)') : ''}
      ${sh && sg.library ? btn('edit', songEdit.sg === sg ? '✎ editing…' : '✎ Edit', 'Open this song in the ✎ Edit song panel: sections, chords, parts and their code (or ask the chat)') : ''}
      ${btn('fav', favOf(sg) ? '★ favorite' : '☆ Favorite', favOf(sg) ? 'A favorite on this server — click to remove it from the shared list' : 'Add to ★ Favorites: everyone on this server sees it, and it survives restarts')}
      ${mine ? '' : btn('save', '📁 Save to My songs', 'Copy this song into 📁 My songs, where you can edit it, keep it and export it')}
      ${sg.pads ? btn('pads', padsState.follow ? '🔲 song pads ✓' : '🔲 Song pads', padsState.follow ? 'Song pads are on: the pad dock switches to each song’s pads as the songs change — click to go back to your own pads' : 'Load this song’s 16 pads (its own parts, key and chords) into the pad dock — and keep switching to each new song’s pads as the songs change') : ''}
      ${sg.take ? btn('mp3', `⬇ MP3 <span class="muted">${fmtTime(sg.take.secs)}</span>`, `Download the recording of this song (${(sg.take.size / 1e6).toFixed(1)} MB) — kept until the page is reloaded`)
        : mp3.seg?.sg === sg ? btn('mp3', '🎙 recording…', 'Recording this song as it plays — ⬇ MP3 appears when it has played to its end')
        : btn('mp3', mp3.want.has(sg) ? '🎙 MP3 next time' : '🎙 MP3', setl.running ? 'Record this song the next time it plays from the start (the music keeps playing)' : 'Play this song from the start and record it — download the MP3 when it ends')}
      ${btn('json', '⬇ JSON', 'Download the whole song (sheet, parts, sections, pads) as a .json file — import it on any Strudel AI server')}
      ${btn('link', '🔗 Link', 'Create a link that plays this whole song on this server')}
    </div>`;
}

/** A short name for a block-written section: "intro", "verse 2" … from its instruction, else "section n". */
function shortPrompt(prompt, j) {
  const p = String(prompt || '').trim();
  const m = p.match(/^\s*(intro|verse|pre-?chorus|chorus|hook|bridge|breakdown|break|build|drop|outro|interlude|solo|groove|[AB]\b)[\w\s'-]{0,10}?(?=[:—–,.(-]|\s{2}|$)/i);
  if (m) return m[0].trim();
  const words = p.split(/\s+/).slice(0, 3).join(' ');
  return words.length > 2 ? `${words}…` : `section ${j + 1}`;
}

/** The song sheet and the sections of one song, with live status and jump buttons. */
function songViewHTML(sg, live) {
  if (!sg) return '';
  const sh = sg.sheet;
  const isCurrent = live && setl.songs[setl.current] === sg;
  const complete = sg.blocks?.length && sg.blocks.every((b) => b.code) && !sg.phase;
  const mine = isMine(sg);
  let h = `<div class="sv-head"><b>${esc(sg.title)}</b>${isCurrent ? ' <span class="sv-live">▶ playing</span>' : ''}${mine ? ' <span class="sv-mine">📁 My songs</span>' : ''}</div>
    <div class="sv-desc">${esc(sg.desc)}</div>`;
  h += songToolbarHTML(sg, live);
  if (sg.shareUrl) {
    h += `<div class="sv-shared">🔗 <input readonly value="${esc(sg.shareUrl)}" /><button class="sv-copy">📋 Copy</button><a href="${esc(sg.shareUrl)}" target="_blank" rel="noopener">open ↗</a></div>`;
  }
  if (sg.phase) h += `<div class="sv-phase">✎ ${esc(sg.phase)}…</div>`;
  if (sh) {
    h += `<div class="sv-grid">
      ${sh.form ? `<span class="k">form</span><span>${esc(sh.form)} · ${sh.sections.length} sections · ${sh.sections.reduce((a, x) => a + x.bars, 0)} bars</span>` : ''}
      <span class="k">sound</span><span>${sh.band ? `🎸 ${esc(sh.band)} · ` : ''}<span class="chip master-chip" title="${esc(MASTER_STYLES[songStyle(sg)]?.desc || '')} — change it in ✎ Edit or live in 🎛 Master">🎛 ${esc(songStyle(sg))}${sh.masterParams && Object.keys(sh.masterParams).length ? ' <small>+ own mix</small>' : ''}</span></span>
      <span class="k">tempo</span><span>${sh.bpm} bpm · ${normMeter(sh.meter)} · ${esc(sh.key)} <code>${esc(sh.scale)}</code></span>
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
    // tempo and key of every section, so the lines can mark where they change
    const tempos = steps.map(stepTempo), shifts = steps.map((st) => st.section?.shift || 0);
    h += '<div class="sv-sections">' + steps.map((st, j) => {
      const i = setlist.steps.indexOf(st);
      const queued = i >= 0 && setlist.jumpTarget === i && st.status !== 'armed' && st.status !== 'playing';
      const sec = st.section;
      // a section written block by block (no song sheet): its instruments are the labelled parts in its code
      const blockParts = !sec && st.code ? [...new Set(patternLines(st.code).filter((r) => !/^pad\d+$/.test(r.base)).map((r) => r.base))] : [];
      const parts = !sec ? blockParts.map((b) => `<span class="chip part" style="--c:${vizColor(b)}">${esc(b)}</span>`).join('') : sec.play.map((x) => `<span class="chip part" style="--c:${vizColor(x.part)}">${esc(x.part)}${x.variant !== 'main' ? `<small>.${esc(st.fillStep && fillPart(sh)?.id === x.part ? 'fill' : x.variant)}</small>` : st.fillStep && fillPart(sh)?.id === x.part ? '<small>.fill</small>' : ''}${x.enter && !st.fillStep ? `<small title="${{ in: 'comes in halfway through', out: 'drops out halfway through', alt: '2 bars on, 2 bars off' }[x.enter]}">@${x.enter}</small>` : ''}</span>`).join('');
      // mark tempo / key changes against the section before (the first one shows the song's tempo)
      const bpm = tempos[j], prevBpm = j ? tempos[j - 1] : null;
      const moves = [
        bpm && (j === 0 || (prevBpm && bpm !== prevBpm)) ? (j === 0 ? `♩ ${bpm} bpm` : `♩ ${bpm > prevBpm ? '↑' : '↓'} ${bpm} bpm`) : '',
        j > 0 && shifts[j] !== shifts[j - 1] ? `key ${shifts[j] ? signed(shifts[j]) : 'home'}` : '',
      ].filter(Boolean).join(' · ');
      const moveTitle = j === 0 ? 'The song’s tempo' : `Changes here: ${prevBpm && bpm !== prevBpm ? `tempo ${prevBpm} → ${bpm} bpm ` : ''}${shifts[j] !== shifts[j - 1] ? `key ${signed(shifts[j - 1])} → ${signed(shifts[j])} semitones` : ''}`;
      // block sections: a short name (the instruction's first words), the whole instruction as a tooltip
      const label = sec ? esc(st.prompt) : `<span title="${esc(st.prompt)}">${esc(shortPrompt(st.prompt, j))}</span>`;
      const name = `${label}${sec && !st.fillStep ? ` <span class="sv-chords">${esc(sec.chords)}</span>` : ''}${moves ? ` <span class="sv-move${j === 0 ? ' first' : ''}" title="${esc(moveTitle)}">${esc(moves)}</span>` : ''}`;
      return `<details class="step ${st.status}${queued ? ' queued' : ''}${st.fillStep ? ' fill' : ''}" data-j="${j}">
        <summary><span class="ico">${queued ? '⏭' : STATUS_ICON[st.status] || ''}</span>
          <span class="bars">${st.bars}</span><span class="prompt">${name}${parts ? `<span class="sv-parts">${parts}</span>` : ''}</span>
          ${i >= 0 ? `<span class="sv-left" data-i="${i}"></span>` : ''}${st.error ? `<span class="err-icon" title="${esc(st.error)}">⚠</span>` : ''}${queued ? '<span class="next">next</span>' : ''}
          ${i >= 0 ? `<button class="jump" data-i="${i}" title="Switch to this section${j < 9 && isCurrent ? ` (Alt+${j + 1})` : ''}">⏭ go</button>` : ''}</summary>
        ${st.code ? `<pre>${esc(st.code.slice(st.code.indexOf(SEC_START) >= 0 ? st.code.indexOf(SEC_START) : 0))}</pre>` : ''}
      </details>`;
    }).join('') + '</div>';
  }
  if (sg.library) h += `<details class="sv-lib"><summary>parts code (shared by every section)</summary><pre>${esc(sg.library)}</pre></details>`;
  return h;
}

/** A section's tempo in bpm: from its code's setcpm / setcps line, else its sheet. */
function stepTempo(st) {
  const m = st?.code && /setcp([ms])\(\s*([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)/.exec(st.code);
  const b = meterBeats(st?.song?.sheet?.meter);
  if (m) { const v = Number(m[2]) / (Number(m[3]) || 1); return Math.round(m[1] === 'm' ? v * b : v * 60 * b); }
  return st?.section?.bpm || st?.song?.sheet?.bpm || null;
}
/** How far the playing section is: { bar, bars, frac, left (seconds until the next section), hold } or null. */
function sectionProgress(st) {
  if (st?.status !== 'playing' || st.startedAt == null || !isPlaying()) return null;
  const now = nowCycle();
  const k = setlist.steps.indexOf(st);
  const next = setlist.steps.slice(k + 1).find((x) => x.status === 'armed' && x.startedAt != null);
  // the switch: an armed next section, else where the set list will switch next (its bar count when nothing is due)
  const end = next?.startedAt ?? (setlist.nextAt != null && setlist.nextAt > st.startedAt ? setlist.nextAt : st.startedAt + st.bars);
  const len = Math.max(1, end - st.startedAt);
  const pos = Math.max(0, now - st.startedAt);
  const hold = setlist.hold && !next;
  return { bar: Math.min(len, Math.floor(pos % (hold ? len : Infinity)) + 1), bars: len, frac: hold ? (pos % len) / len : Math.min(1, pos / len),
    left: Math.max(0, (end - now) / cps()), hold, waiting: !hold && pos >= len };
}
// progress of the playing section in the song views (updated without re-rendering the lists;
// renderSongs calls it right after it rebuilds a view, so the bar never blinks out)
function updateSectionProgress() {
  for (const el of document.querySelectorAll('.sv-left[data-i]')) {
    const st = setlist.steps[Number(el.dataset.i)];
    const sum = el.closest('summary');
    if (setlist.paused && setlist.paused.step === st) {
      el.textContent = `⏸ paused at bar ${setlist.paused.bar + 1}/${st.bars}`;
      sum?.style.setProperty('--p', `${((setlist.paused.bar / Math.max(1, st.bars)) * 100).toFixed(1)}%`);
      continue;
    }
    const pr = sectionProgress(st);
    if (!pr) { if (el.textContent) { el.textContent = ''; sum?.style.removeProperty('--p'); } continue; }
    sum?.style.setProperty('--p', `${(pr.frac * 100).toFixed(1)}%`);
    // the next section changes the tempo: say so
    const k = Number(el.dataset.i), nb = stepTempo(setlist.steps[k + 1]), cb = stepTempo(st);
    const tempo = !pr.hold && nb && cb && nb !== cb && setlist.steps[k + 1]?.song === st.song ? ` · then ${nb > cb ? '↑' : '↓'} ${nb} bpm` : '';
    el.textContent = pr.hold ? `bar ${pr.bar}/${pr.bars} · ⏸ holding`
      : pr.waiting ? 'next section is on its way…'
      : `bar ${pr.bar}/${pr.bars} · next in ${fmtTime(Math.ceil(pr.left))}${tempo}`;
  }
}
setInterval(updateSectionProgress, 250);

let nowSong = null; // the last song that started playing
function renderSongs() {
  // Songs tab: the running/last set (until the text is edited), otherwise a preview of the text
  const setSongs = setl.mode === 'set' ? setl.songs : [];
  const stationSongs = setl.mode === 'station' ? setl.songs : [];
  const now = setl.mode === 'station' ? setl.songs[setl.current] : null;
  const pick = (tab, list) => {
    if (typeof songSel[tab] === 'string') return null; // a My songs entry is open
    // the station's playing song is in the On air box (and 🎶 Now playing): only an explicit pick opens a row
    const k = songSel[tab]; // only an explicit pick opens a row's buttons (the playing song is in 🎶 Now playing)
    return k != null && list[k] ? k : null;
  };
  const selSet = pick('set', setSongs), selSt = pick('station', stationSongs);
  const setView = viewedSong('set');
  const stepKey = (sg) => sg?.blocks?.map((b) => b.status + (b.code ? b.code.length : 0) + (b.error || '')).join() || '';
  const key = JSON.stringify([setl.running, !!setlist.paused, nowSong?.title, stepKey(nowSong), setl.songs.map((x) => x.phase || x.status).join(), setl.mode, setl.planning, now?.title, selSet, selSt, setlist.hold, setlist.jumpTarget, setl.current,
    ...[setSongs, stationSongs].map((l) => l.map((sg) => [sg.title, sg.status, sg.phase, sg.bars, sg.blocks?.filter((b) => b.code).length, sg.error, !!sg.sheet, sg.shareUrl])),
    stepKey(setView), stepKey(stationSongs[selSt]), stepKey(setl.songs[setl.current]), songSel.set, songEdit.sg?.title, padsState.owner?.title, padsState.follow,
    mySongs.map((sg) => [sg.title, sg.bars, setl.songs[setl.current] === sg]), mp3.seg?.sg?.title || '', mp3.takes.length, mp3.want.size,
    favorites.map((f) => [f.id, setl.songs[setl.current] === f.song])]);
  if (key === lastSongsKey) return;
  lastSongsKey = key;
  $('setStatus').innerHTML = setSongs.length ? songsHTML(setSongs, setl.running && setl.mode === 'set', selSet, { tools: true })
    : '<div class="muted small">No songs yet — in 💬 Chat pick 🎯 <b>✨ new song</b> and describe one, or play a favorite or one of My songs.</div>';
  $('mySongs').innerHTML = myListHTML();
  $('favSongs').innerHTML = favListHTML();
  $('stationStatus').innerHTML = songsHTML(stationSongs, setl.running && setl.mode === 'station', selSt, { tools: true });
  // 🎶 Now playing: the playing song — or, once it's over, the last one that played (stopped)
  // while a set or station is still writing its first song, show that song (with what's being written)
  const preparing = setl.running && !setl.songs[setl.current] ? setl.songs.find((x) => ['writing', 'waiting', 'ready'].includes(x.status)) : null;
  const playingSong = (setl.running && setl.songs[setl.current]) || preparing || nowSong;
  const nowLive = !!(setl.running && playingSong && setl.songs[setl.current] === playingSong);
  $('nowEmpty').hidden = !!playingSong;
  // ✎ Edit song panel: the editor (rendered when another song is opened) and the song's sections
  const ed = songEdit.sg;
  $('editEmpty').hidden = !!ed;
  if ($('editForm').__sg !== ed) { $('editForm').__sg = ed; $('editForm').innerHTML = ed?.sheet && ed.library ? songEditorHTML(ed) : ''; }
  void setView;
  for (const [id, sg, live] of [['editSongView', ed, !!(setl.running && setl.songs[setl.current] === ed)], ['nowSongView', playingSong, nowLive]]) {
    const el = $(id);
    const open = new Set([...el.querySelectorAll('details[open]')].map((d) => d.dataset.j ?? 'lib'));
    el.hidden = !sg;
    el.innerHTML = songViewHTML(sg, live);
    if (id === 'nowSongView' && sg && !live) el.querySelector('.sv-head')?.insertAdjacentHTML('beforeend', sg === preparing ? ' <span class="sv-stopped">✎ being written — plays when ready</span>' : ' <span class="sv-stopped">■ stopped</span>');
    for (const d of el.querySelectorAll('details')) if (open.has(d.dataset.j ?? 'lib')) d.open = true;
  }
  updateSectionProgress();
  const onAir = setl.mode === 'station' && setl.running;
  $('stationNow').hidden = !onAir;
  if (onAir) {
    $('stationNow').innerHTML = now
      ? `📻 <b>On air:</b> ${esc(now.title)}<div class="d">${esc(now.desc)}</div><div class="song-tools">${songToolbarHTML(now, true)}${NOW_LINK}${sharedLinkHTML(now)}</div>`
      : '📻 <b>Warming up…</b><div class="d">the agent is planning and writing the first song</div>';
  }
}
setInterval(renderSongs, 300);
for (const id of ['setStatus', 'stationStatus']) {
  const tab = id === 'stationStatus' ? 'station' : 'set';
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('.jump[data-song]');
    if (b) { jumpToSong(Number(b.dataset.song), tab); return; }
    if (e.target.closest('[data-open-now]')) { showPanel('song'); return; }
    // a song's toolbar inside its row (station list)
    const act = e.target.closest('[data-act]');
    const tools = e.target.closest('.song-tools');
    if (tools) {
      const sg = setl.songs[Number(tools.closest('.song[data-k]')?.dataset.k)];
      if (act && sg) songAction(act.dataset.act, sg, act, tools);
      else if (e.target.closest('.sv-copy') && sg?.shareUrl) navigator.clipboard?.writeText(sg.shareUrl).then(() => { e.target.textContent = '✓ Copied'; }, () => {});
      return;
    }
    const row = e.target.closest('.song[data-k]');
    if (row) { const k = Number(row.dataset.k); songSel[tab] = songSel[tab] === k ? null : k; lastSongsKey = ''; renderSongs(); }
  });
}
$('stationNow').addEventListener('click', (e) => {
  if (e.target.closest('[data-open-now]')) { showPanel('song'); return; }
  const sg = setl.songs[setl.current], act = e.target.closest('[data-act]');
  if (act && sg) songAction(act.dataset.act, sg, act, $('stationNow'));
  else if (e.target.closest('.sv-copy') && sg?.shareUrl) navigator.clipboard?.writeText(sg.shareUrl).then(() => { e.target.textContent = '✓ Copied'; }, () => {});
});
// the ✎ Edit song form: apply / cancel
$('editForm').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (act && songEdit.sg) songAction(act.dataset.act, songEdit.sg, act, $('editForm'));
});
for (const id of ['editSongView', 'nowSongView']) {
  $(id).addEventListener('click', (e) => {
    const go = e.target.closest('.jump[data-i]');
    if (go) { e.preventDefault(); e.stopPropagation(); jumpTo(Number(go.dataset.i)); return; }
    if (e.target.closest('.sv-hold')) { e.preventDefault(); setHold(!setlist.hold); renderSongs(); return; }
    const sg = id === 'nowSongView' ? (setl.running && setl.songs[setl.current]) || nowSong : songEdit.sg;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act && sg) { songAction(act, sg, e.target.closest('[data-act]'), $(id)); return; }
    if (e.target.closest('.sv-copy') && sg?.shareUrl) {
      navigator.clipboard?.writeText(sg.shareUrl).then(() => { e.target.textContent = '✓ Copied'; }, () => {});
    }
  });
}

/** Toolbar actions in a song view. */
function songAction(act, sg, btn, view) {
  if (act === 'play') { if (setl.songs.includes(sg) && setl.mode) jumpToSong(setl.songs.indexOf(sg), setl.mode); else playSong(sg); }
  else if (act === 'edit') openSongEditor(sg);
  else if (act === 'edit-save') saveSongEditor($('editForm').querySelector('.sv-edit'), songEdit.sg || sg);
  else if (act === 'edit-cancel') { ws.close('edit'); songEdit.sg = null; lastSongsKey = ''; renderSongs(); }
  else if (act === 'save') addToMySongs(sg);
  else if (act === 'fav') toggleFavorite(sg);
  else if (act === 'pads') {
    if (padsState.owner === sg && padsState.follow) { setPadsFollow(false); loadPads(null); }
    else { loadPads(sg.pads, sg); setPadsFollow(true); }
  }
  else if (act === 'mp3') songMp3(sg);
  else if (act === 'json') download(`${slug(sg.title)}.strudel-song.json`, JSON.stringify(songToJSON(sg), null, 1));
  else if (act === 'link') shareSong(sg, btn);
  lastSongsKey = '';
}

/** The song shown in a tab's song view (same choice renderSongs makes). */
function viewedSong(tab) {
  if (tab === 'set' && typeof songSel.set === 'string') {
    const [kind, k] = songSel.set.split(':');
    return (kind === 'fav' ? favorites[Number(k)]?.song : mySongs[Number(k)]) || null;
  }
  const list = tab === 'station' ? (setl.mode === 'station' ? setl.songs : [])
    : setl.mode === 'set' ? setl.songs : [];
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
  try {
    const song = songFromJSON(s);
    loadSongIntoSet(song);
    songSel.set = 0;
    showPanel('songs');
    return song;
  } catch { /* older share format below */ }
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
  showPanel('songs');
  return song;
}

if (saved.setLoop !== undefined) $('setLoop').checked = saved.setLoop;
$('setLoop').onchange = () => save({ setLoop: $('setLoop').checked });

// --- saved stations
const DEFAULT_STATIONS = [
  { name: 'Late Night Lo-fi', theme: 'late-night lo-fi hip hop with jazzy Rhodes chords, dusty drums and soft bass, 70–90 bpm, rainy city mood' },
  { name: 'Neon Highway', theme: 'synthwave and outrun: driving basslines, gated pads, arpeggios, 95–118 bpm, minor keys, nostalgic 80s night drive' },
  { name: 'Deep Focus', theme: 'minimal ambient techno for concentration: steady soft kick, evolving pads, subtle percussion, 110–122 bpm, no harsh sounds' },
  { name: 'Sunrise House', theme: 'warm deep house at sunrise: soulful chords, rolling basslines, shuffled hats, 118–124 bpm, uplifting major and dorian keys' },
  { name: 'Warehouse Techno', theme: 'dark driving techno: pounding kick, rumbling sub, hypnotic synth loops, acid lines, 128–136 bpm, minor keys, little melody' },
  { name: 'Liquid Drum & Bass', theme: 'liquid drum & bass: fast breakbeats, deep reese and sub bass, lush pads and soft keys, 170–174 bpm, emotional minor-key chords' },
  { name: 'Ambient Drift', theme: 'slow ambient soundscapes: long evolving pads, soft bells and drones, gentle textures, almost no drums, 60–80 bpm' },
  { name: 'Boom Bap Café', theme: 'jazzy boom bap instrumentals: swung drums, upright-style bass, vibraphone and piano samples feel, 84–94 bpm' },
  { name: 'Trance Horizons', theme: 'uplifting trance: rolling offbeat bass, supersaw leads, big breakdowns and builds, 136–140 bpm, euphoric minor keys' },
  { name: 'Arcade Chiptune', theme: 'retro video-game chiptune: square and triangle leads, fast arpeggios, punchy 8-bit drums, 120–150 bpm, catchy hooks' },
  { name: 'Space Disco', theme: 'cosmic nu-disco: four-on-the-floor, octave basslines, funky guitars and strings, sparkling synths, 110–122 bpm' },
  { name: 'Dub Station', theme: 'deep dub and dub techno: skanking chords with long echoes, heavy sub bass, one-drop and steppers rhythms, 70–85 bpm (or 120 dub techno)' },
];
let stations = addNewDefaults(load().stations, DEFAULT_STATIONS, 'stations', ['Late Night Lo-fi', 'Neon Highway', 'Deep Focus']);
save({ stations });
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
// Docks: the visualizer, keyboard, pads and console are workspace panels; their
// header buttons open / close them.
// ---------------------------------------------------------------------------
const docks = {};
function setupDock(name, { onShow, onHide } = {}) {
  const btn = $(`${name}Btn`);
  const d = { name, el: $(`${name}-dock`), on: ws.isOpen(name) };
  d.show = (on) => (on ? ws.open(name) : ws.close(name));
  btn.onclick = () => ws.toggle(name);
  ws.on(name, {
    onOpen: (o) => { d.on = o; btn.classList.toggle('on', o); lastMixerKey = ''; },
    onVisible: (v) => (v ? onShow : onHide)?.(),
  });
  docks[name] = d;
  return d;
}

if (load().vizMode) $('vizMode').value = load().vizMode;
$('vizMode').onchange = () => save({ vizMode: $('vizMode').value });
// ---------------------------------------------------------------------------
// 🌀 Hydra: live video-synth visuals behind the code (Strudel's initHydra({ feedStrudel: 1 }) — s0 is Strudel's
// own visuals). Presets or your own Hydra code; the code area turns see-through while it runs.
// ---------------------------------------------------------------------------
const HYDRA_PRESETS = {
  kaleido: 'src(s0).kaleid(H("<4 5 6>"))\n  .diff(osc(1, 0.5, 5))\n  .modulateScale(osc(2, -0.25, 1))\n  .out()',
  tunnel: 'src(o0).scale(1.02).rotate(0.006)\n  .blend(src(s0).kaleid(H("<3 4 6>")), 0.25)\n  .modulate(osc(4, 0.1, 1), 0.02)\n  .out()',
  waves: 'osc(18, 0.03, 1.1).color(0.6, 0.25, 0.9)\n  .modulate(noise(2.5), 0.25)\n  .diff(src(s0))\n  .out()',
  voronoi: 'voronoi(H("<6 8 12>"), 0.3, 0.4)\n  .mult(osc(10, 0.08, 1.4))\n  .modulate(src(s0), 0.3)\n  .out()',
  feedback: 'src(o0).modulateHue(src(o0).scale(1.01), 1)\n  .layer(src(s0).luma(0.15))\n  .out()',
};
const hydraState = { on: false, mode: load().hydraMode || 'off', custom: load().hydraCustom || HYDRA_PRESETS.kaleido };
const hydraCodeFor = (mode) => (mode === 'custom' ? hydraState.custom : HYDRA_PRESETS[mode]);
async function runHydra(mode = hydraState.mode) {
  hydraState.mode = mode;
  $('hydraMode').value = mode;
  if (mode === 'off') return stopHydra();
  try {
    if (typeof globalThis.initHydra !== 'function') throw new Error('Hydra is not available in this Strudel build');
    await globalThis.initHydra({ feedStrudel: 1, src: '/vendor/hydra/hydra-synth.js' });
    new Function(hydraCodeFor(mode))(); // Hydra's functions (osc, src, s0, o0 …) and Strudel's H() are globals
    hydraState.on = true;
    document.body.classList.add('hydra-on');
    applyHydraMix();
    $('hydraMsg').textContent = '▶ running';
  } catch (e) {
    $('hydraMsg').textContent = `⚠ ${e.message}`;
    clog('warn', `🌀 Hydra: ${e.message}`);
  }
}
function stopHydra() {
  try { globalThis.solid?.(0, 0, 0, 0).out(); } catch {}
  document.getElementById('hydra-canvas')?.remove();
  try { globalThis.getDrawContext?.().canvas.style.removeProperty('display'); } catch {} // feedStrudel hid Strudel's own canvas
  hydraState.on = false;
  document.body.classList.remove('hydra-on');
}
function applyHydraMix() {
  const c = document.getElementById('hydra-canvas');
  if (c) c.style.opacity = $('hydraMix').value;
}
$('hydraMode').value = hydraState.mode;
$('hydraMix').value = load().hydraMix ?? 0.6;
$('hydraMode').onchange = () => { save({ hydraMode: $('hydraMode').value }); if ($('hydraMode').value !== 'custom' && $('hydraMode').value !== 'off') $('hydraCode').value = hydraCodeFor($('hydraMode').value); runHydra($('hydraMode').value); };
$('hydraMix').oninput = () => { applyHydraMix(); save({ hydraMix: Number($('hydraMix').value) }); };
$('hydraEdit').onclick = () => {
  $('hydraEditor').hidden = !$('hydraEditor').hidden;
  if (!$('hydraEditor').hidden) $('hydraCode').value = hydraCodeFor(hydraState.mode === 'off' ? 'custom' : hydraState.mode) || hydraState.custom;
};
$('hydraApply').onclick = () => {
  hydraState.custom = $('hydraCode').value;
  save({ hydraCustom: hydraState.custom, hydraMode: 'custom' });
  runHydra('custom');
};
// Hydra needs Strudel loaded: start the saved mode once the editor is ready
if (hydraState.mode !== 'off') {
  const wait = setInterval(() => { if (typeof globalThis.initHydra === 'function' && mirror()) { clearInterval(wait); runHydra(); } }, 500);
}

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
  if (sec === 'setBands') renderBandsEditor();
  if (sec === 'setStations') renderStations();
  if (sec === 'setPrompts') renderPromptEditor();
  $('settingsMsg').textContent = '';
  if (!$('settingsDlg').open) $('settingsDlg').showModal();
}
$('settingsBtn').onclick = () => openSettings();
$('settingsClose').onclick = () => $('settingsDlg').close();
$('settingsDlg').addEventListener('click', (e) => { if (e.target === $('settingsDlg')) $('settingsDlg').close(); });
for (const b of document.querySelectorAll('.settings-tabs button')) b.onclick = () => openSettings(b.dataset.sec);
for (const b of document.querySelectorAll('.stations-edit')) b.onclick = () => openSettings('setStations');
$('settingsExport').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'strudel-ai', version: APP_VERSION, exported: new Date().toISOString(), settings: load(), mySongs: mySongs.map(songToJSON) }, null, 2)], { type: 'application/json' });
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
    if (Array.isArray(j.mySongs)) localStorage.setItem(MY_SONGS_KEY, JSON.stringify(j.mySongs));
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

// --- 📝 Prompts: the built-in system prompts, and the user's own versions (sent with each request)
let builtinPrompts = null;
const loadBuiltinPrompts = async () => (builtinPrompts ||= await fetch('/api/prompts').then((r) => r.json()).catch(() => ({})));
/** The user's version of the system prompt for this kind of request, or null for the built-in one. */
function promptOverride(mode) {
  const own = load().prompts?.[mode];
  return typeof own === 'string' && own.trim() ? own : null;
}
async function renderPromptEditor() {
  const mode = $('promptSelect').value;
  const builtin = (await loadBuiltinPrompts())[mode] ?? '';
  const own = promptOverride(mode);
  $('promptText').value = own ?? builtin;
  $('promptState').textContent = own ? '✎ your version (used instead of the built-in one)' : 'built-in';
  $('promptReset').hidden = !own;
}
$('promptSelect').onchange = renderPromptEditor;
$('promptText').oninput = async () => {
  const mode = $('promptSelect').value;
  const builtin = (await loadBuiltinPrompts())[mode] ?? '';
  const prompts = { ...(load().prompts || {}) };
  const v = $('promptText').value;
  if (!v.trim() || v === builtin) delete prompts[mode]; else prompts[mode] = v;
  save({ prompts });
  $('promptState').textContent = prompts[mode] ? '✎ your version (used instead of the built-in one)' : 'built-in';
  $('promptReset').hidden = !prompts[mode];
};
$('promptReset').onclick = () => {
  const prompts = { ...(load().prompts || {}) };
  delete prompts[$('promptSelect').value];
  save({ prompts });
  renderPromptEditor();
};

// --- the AI settings summary under the chat
function renderAISummary() {
  const model = $('model').selectedOptions[0]?.textContent || 'default model';
  const own = Object.keys(load().prompts || {}).length;
  const claude = state.config?.providers?.[$('provider').value]?.kind === 'anthropic';
  $('aiSummary').textContent = `🤖 ${model} · ${claude ? `effort ${$('claudeEffort').value}` : `temp ${$('temp').value}`}${$('autoApply').checked ? '' : ' · manual apply'}${own ? ` · ${own} custom prompt${own > 1 ? 's' : ''}` : ''}`;
}
for (const id of ['model', 'provider', 'temp', 'autoApply', 'claudeEffort']) $(id).addEventListener('change', renderAISummary);
$('claudeEffort').addEventListener('change', () => save({ claudeEffort: $('claudeEffort').value }));
$('temp').addEventListener('input', renderAISummary);
$('aiSummary').onclick = () => openSettings('setAI');
setInterval(renderAISummary, 2000);
renderAISummary();

setupDock('console');

// ---------------------------------------------------------------------------
// 🎚 Mixer: a console with one channel per part of the WHOLE song (every part in the song sheet, plus any other
// labelled line in the code), whether or not it plays in the current section.
// Every labelled part plays on its own orbit (Strudel's output bus); the mixer puts a channel strip on that bus:
//   orbit → EQ (high shelf 4 kHz · mid peak 1 kHz · low shelf 200 Hz, ±12 dB) → pan → fader → speakers
//                                                                                   └→ meter / spectrum
// Settings are kept per part name, so they apply whenever that part plays — this section, the next, the next song.
// Nothing here touches the code; the code's own faders (.postgain) still work as a trim.
// ---------------------------------------------------------------------------
const MX_BANDS = [['high', 'highshelf', 4000], ['mid', 'peaking', 1000], ['low', 'lowshelf', 200]];
const MX_DEFAULT = { vol: 1, pan: 0, high: 0, mid: 0, low: 0, mute: false, solo: false };
const mixer = { ch: {}, orbits: {}, nextOrbit: 2, key: '', dragging: false };
{ // settings from before (EQ only) carry over
  const st = load();
  for (const [base, e] of Object.entries(st.mixerEq || {})) mixer.ch[base] = { ...MX_DEFAULT, ...e };
  Object.assign(mixer.ch, st.mixerCh || {});
}
const chOf = (base) => (mixer.ch[base] ||= { ...MX_DEFAULT });
const saveMixer = (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => save({ mixerCh: mixer.ch }), 300); }; })();
/** Every labelled part gets its own orbit ("$:" lines share the default one). */
function mixerOrbit(base) {
  if (!base || base === '$') return null;
  if (mixer.orbits[base] == null) mixer.orbits[base] = mixer.nextOrbit++;
  return mixer.orbits[base];
}
window.__mixerTrap = () => installOrbitTrap();

// Strudel turns "bass: …" into pattern.p('bass') and redefines Pattern.prototype.p on every evaluation:
// trap that assignment so the label's pattern is routed to the part's orbit.
function installOrbitTrap() {
  const P = globalThis.Pattern || scheduler()?.pattern?.constructor;
  if (!P?.prototype || P.__mixerTrap) return;
  let inner = P.prototype.p;
  Object.defineProperty(P.prototype, 'p', {
    configurable: true,
    get() {
      return function (id) {
        const o = typeof id === 'string' ? mixerOrbit(parseLabel(id).base) : null;
        return inner.call(o != null && typeof this.orbit === 'function' ? this.orbit(o) : this, id);
      };
    },
    set(fn) { inner = fn; },
  });
  P.__mixerTrap = true;
}

const sdController = () => { try { return globalThis.getSuperdoughAudioController(); } catch { return null; } };
/** The channel strip on a part's orbit (built the first time, rebuilt if the audio engine was reset). */
function channelNodes(base) {
  const n = mixer.orbits[base];
  const ctrl = sdController();
  if (n == null || !ctrl) return null;
  const orbit = ctrl.getOrbit(n, [0, 1]);
  if (!orbit.__ch) {
    const ac = orbit.audioContext;
    const eq = MX_BANDS.map(([, type, f]) => new BiquadFilterNode(ac, { type, frequency: f, Q: type === 'peaking' ? 0.8 : 0.7, gain: 0 }));
    const pan = new StereoPannerNode(ac, { pan: 0 });
    const gain = new GainNode(ac, { gain: 1 });
    const an = new AnalyserNode(ac, { fftSize: 1024, smoothingTimeConstant: 0.6 });
    try { orbit.output.disconnect(); } catch {}
    orbit.output.connect(eq[0]);
    eq[0].connect(eq[1]);
    eq[1].connect(eq[2]);
    eq[2].connect(pan);
    pan.connect(gain);
    gain.connect(an);
    ctrl.output.connectToDestination(gain, [0, 1]);
    orbit.__ch = { high: eq[0], mid: eq[1], low: eq[2], pan, gain, an };
  }
  return orbit.__ch;
}
const anySolo = () => Object.values(mixer.ch).some((c) => c.solo);
const audible = (base) => { const c = chOf(base); return !c.mute && (!anySolo() || c.solo); };
function applyChannel(base) {
  const nodes = channelNodes(base);
  if (!nodes) return;
  const c = chOf(base);
  const t = nodes.gain.context.currentTime;
  for (const [b] of MX_BANDS) nodes[b].gain.setTargetAtTime(Number(c[b]) || 0, t, 0.02);
  nodes.pan.pan.setTargetAtTime(Number(c.pan) || 0, t, 0.02);
  nodes.gain.gain.setTargetAtTime(audible(base) ? Number(c.vol) : 0, t, 0.015);
}
const applyAllChannels = () => { for (const base of Object.keys(mixer.orbits)) applyChannel(base); };
// the audio engine creates orbits on the first note and can be reset: keep the strips in place
setInterval(() => { if (isPlaying()) applyAllChannels(); }, 500);

/** The master meter: an analyser on the main output. */
function masterAnalyser() {
  const ctrl = sdController();
  const out = ctrl?.output?.destinationGain;
  if (!out) return null;
  if (out.__an?.context !== out.context) { out.__an = new AnalyserNode(out.context, { fftSize: 1024, smoothingTimeConstant: 0.6 }); out.connect(out.__an); }
  return out.__an;
}

/** The channels: the song's parts (all of them, in the sheet's order) and every other labelled part in the code. */
function mixerChannels() {
  const code = getCode();
  const rows = patternLines(code);
  const sg = setl.running ? setl.songs[setl.current] : nowSong;
  const out = [];
  const add = (base, extra = {}) => { if (base && base !== '$' && !out.some((x) => x.base === base)) out.push({ base, ...extra }); };
  for (const p of sg?.sheet?.parts || []) add(p.id, { role: p.role, sound: p.sound, song: true });
  for (const r of rows) add(r.base);
  for (const ch of out) {
    const r = rows.find((x) => x.base === ch.base);
    ch.inSection = !!r;
    ch.codeMuted = !!r?.muted;
  }
  return out;
}

const dbText = (v) => (v <= 0.0001 ? '-∞' : `${(20 * Math.log10(v)).toFixed(1)}`);
function renderMixerPanel() {
  if (!docks.mixer?.on || mixer.dragging) return;
  const chans = mixerChannels();
  const key = JSON.stringify([chans, mixer.ch, $('masterGain').value]);
  if (key === mixer.key) return;
  mixer.key = key;
  const slider = (cls, k, min, max, step, v, title, extra = '') => `<input type="range" class="${cls}" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}" title="${title}" ${extra}/>`;
  const strip = (ch) => {
    const c = chOf(ch.base);
    const off = !audible(ch.base);
    return `<div class="mx-strip${ch.inSection ? '' : ' absent'}${off ? ' silenced' : ''}" style="--c:${vizColor(ch.base)}" data-base="${esc(ch.base)}">
      <div class="mx-name" title="${esc(`${ch.base}${ch.role ? ` · ${ch.role}` : ''}${ch.sound ? ` · ${ch.sound}` : ''}`)}">${esc(ch.base)}</div>
      <div class="mx-state">${ch.inSection ? (ch.codeMuted ? '<span class="cm" title="muted in the code (_label:)">muted in code</span>' : '<span class="on">● playing</span>') : '<span title="This part doesn’t play in the current section — its settings apply when it comes in">not in section</span>'}</div>
      <canvas class="mx-eqviz" width="76" height="40" title="EQ curve over the channel's live spectrum"></canvas>
      <div class="mx-eqs">${MX_BANDS.map(([b]) => `<label title="${b} ${b === 'mid' ? '(1 kHz peak)' : b === 'low' ? '(200 Hz shelf)' : '(4 kHz shelf)'} — double-click: 0 dB"><span>${b[0].toUpperCase()}</span>${slider('mx-h', b, -12, 12, 0.5, Number(c[b]) || 0, `${b}: ${c[b] || 0} dB`)}</label>`).join('')}
        <label title="Pan — double-click: centre"><span>P</span>${slider('mx-h', 'pan', -1, 1, 0.05, Number(c.pan) || 0, `pan ${c.pan || 0}`)}</label></div>
      <div class="mx-ms"><button data-mx="mute" class="m${c.mute ? ' on' : ''}" title="Mute this channel (whole song)">M</button><button data-mx="solo" class="s${c.solo ? ' on' : ''}" title="Solo this channel (whole song)">S</button></div>
      <div class="mx-fader">${slider('mx-v mx-vol', 'vol', 0, 1.5, 0.01, c.vol, 'Channel fader — double-click: 0 dB')}<canvas class="mx-meter" width="10" height="100"></canvas></div>
      <div class="mx-val">${dbText(c.vol)} dB</div>
    </div>`;
  };
  const master = `<div class="mx-strip master" data-base="__master">
      <div class="mx-name">master</div><div class="mx-state"><span>${isPlaying() ? '● on' : 'stopped'}</span></div>
      <canvas class="mx-eqviz" width="76" height="40" title="Spectrum of the whole mix"></canvas>
      <div class="mx-eqs"></div><div class="mx-ms"></div>
      <div class="mx-fader">${slider('mx-v mx-vol', 'master', 0, 1.5, 0.01, $('masterGain').value, 'Master volume — double-click: 100%')}<canvas class="mx-meter" width="10" height="100"></canvas></div>
      <div class="mx-val">${dbText(Number($('masterGain').value))} dB</div>
    </div>`;
  $('mixerStrips').innerHTML = (chans.length ? chans.map(strip).join('') : '<div class="muted small mx-empty">No parts yet: every part of the song, and every labelled line in the code (<code>drums: …</code>), gets a channel here.</div>') + master;
}
setupDock('mixer', {
  onShow: () => { mixer.key = ''; renderMixerPanel(); cancelAnimationFrame(mixer.raf); drawMixer(); ws.minSize?.('mixer', 330); },
  onHide: () => cancelAnimationFrame(mixer.raf),
});
setInterval(renderMixerPanel, 250);

// live visuals: an EQ curve over each channel's spectrum, and a level meter beside each fader
const eqProbe = { freqs: null, nodes: null };
function eqCurve(c, width) {
  const ac = audioCtx();
  if (!ac) return null;
  if (!eqProbe.nodes) eqProbe.nodes = MX_BANDS.map(([, type, f]) => new BiquadFilterNode(ac, { type, frequency: f, Q: type === 'peaking' ? 0.8 : 0.7 }));
  if (eqProbe.freqs?.length !== width) eqProbe.freqs = Float32Array.from({ length: width }, (_, i) => 20 * Math.pow(1000, i / (width - 1))); // 20 Hz … 20 kHz
  const total = new Float32Array(width);
  const mag = new Float32Array(width), ph = new Float32Array(width);
  MX_BANDS.forEach(([b], i) => {
    eqProbe.nodes[i].gain.value = Number(c[b]) || 0;
    eqProbe.nodes[i].getFrequencyResponse(eqProbe.freqs, mag, ph);
    for (let k = 0; k < width; k++) total[k] += 20 * Math.log10(mag[k] || 1e-6);
  });
  return total;
}
const levelOf = (an, buf) => {
  an.getFloatTimeDomainData(buf);
  let sum = 0, peak = 0;
  for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); sum += v * v; if (v > peak) peak = v; }
  return { rms: Math.sqrt(sum / buf.length), peak };
};
function drawChannelSpectrum(g, an, w, h, color) {
  const bins = new Uint8Array(an.frequencyBinCount);
  an.getByteFrequencyData(bins);
  const ny = an.context.sampleRate / 2;
  g.beginPath();
  g.moveTo(0, h);
  for (let x = 0; x < w; x++) {
    const f = 20 * Math.pow(1000, x / (w - 1));
    const v = bins[Math.min(bins.length - 1, Math.round((f / ny) * bins.length))] / 255;
    g.lineTo(x, h - v * h);
  }
  g.lineTo(w, h);
  g.closePath();
  g.fillStyle = color;
  g.globalAlpha = 0.28;
  g.fill();
  g.globalAlpha = 1;
}
function drawMeter(cv, lvl) {
  const g = cv.getContext('2d'), w = cv.width, h = cv.height;
  g.fillStyle = '#0b0c10';
  g.fillRect(0, 0, w, h);
  const y = (v) => { const db = 20 * Math.log10(Math.max(v, 1e-5)); return h - Math.max(0, Math.min(1, (db + 60) / 60)) * h; }; // −60 … 0 dB
  const top = y(lvl.rms);
  const grad = g.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, '#20d3a6'); grad.addColorStop(0.75, '#20d3a6'); grad.addColorStop(0.88, '#ffd166'); grad.addColorStop(1, '#ff5c7a');
  g.fillStyle = grad;
  g.fillRect(1, top, w - 2, h - top);
  cv.__hold = Math.min(cv.__hold ?? h, y(lvl.peak));
  cv.__hold += 0.6; // the peak marker falls slowly
  g.fillStyle = lvl.peak >= 0.99 ? '#ff5c7a' : '#e6e8ee';
  g.fillRect(0, Math.min(h - 2, cv.__hold), w, 2);
}
function drawMixer() {
  mixer.raf = requestAnimationFrame(drawMixer);
  const buf = mixer.buf || (mixer.buf = new Float32Array(1024));
  for (const el of document.querySelectorAll('#mixerStrips .mx-strip')) {
    const base = el.dataset.base;
    const isMaster = base === '__master';
    const an = isMaster ? masterAnalyser() : mixer.orbits[base] != null ? sdController()?.nodes?.[mixer.orbits[base]]?.__ch?.an : null;
    const color = getComputedStyle(el).getPropertyValue('--c') || '#7c5cff';
    // EQ curve + spectrum
    const cv = el.querySelector('.mx-eqviz');
    if (cv) {
      const g = cv.getContext('2d'), w = cv.width, h = cv.height;
      g.fillStyle = '#0b0c10';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#1d2029';
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      if (an && isPlaying()) drawChannelSpectrum(g, an, w, h, isMaster ? '#7c5cff' : color);
      if (!isMaster) {
        const curve = eqCurve(chOf(base), w);
        if (curve) {
          g.strokeStyle = color;
          g.lineWidth = 1.5;
          g.beginPath();
          for (let x = 0; x < w; x++) { const yv = h / 2 - (curve[x] / 15) * (h / 2); x ? g.lineTo(x, yv) : g.moveTo(x, yv); }
          g.stroke();
          g.lineWidth = 1;
        }
      }
    }
    const m = el.querySelector('.mx-meter');
    if (m) drawMeter(m, an && isPlaying() ? levelOf(an, buf) : { rms: 0, peak: 0 });
  }
}

function setChannel(base, k, v) {
  chOf(base)[k] = v;
  saveMixer();
  if (k === 'solo' || k === 'mute') applyAllChannels(); else applyChannel(base);
}
$('mixerStrips').addEventListener('pointerdown', (e) => { if (e.target.matches('input[type=range]')) mixer.dragging = true; });
window.addEventListener('pointerup', () => { if (mixer.dragging) { mixer.dragging = false; mixer.key = ''; } });
$('mixerStrips').addEventListener('input', (e) => {
  const t = e.target, base = t.closest('.mx-strip')?.dataset.base;
  if (!base || !t.dataset.k) return;
  const v = Number(t.value);
  if (t.dataset.k === 'master') { $('masterGain').value = t.value; $('masterGain').oninput(); }
  else setChannel(base, t.dataset.k, v);
  if (t.dataset.k === 'vol' || t.dataset.k === 'master') t.closest('.mx-strip').querySelector('.mx-val').textContent = `${dbText(v)} dB`;
  t.title = `${t.dataset.k}: ${t.value}`;
});
$('mixerStrips').addEventListener('dblclick', (e) => {
  const t = e.target;
  if (!t.matches('input[type=range]')) return;
  t.value = t.dataset.k === 'vol' || t.dataset.k === 'master' ? 1 : 0;
  t.dispatchEvent(new Event('input', { bubbles: true }));
  mixer.key = '';
});
$('mixerStrips').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mx]');
  const base = b?.closest('.mx-strip')?.dataset.base;
  if (!base) return;
  const c = chOf(base);
  if (b.dataset.mx === 'mute') { c.mute = !c.mute; if (c.mute) c.solo = false; }
  else { c.solo = !c.solo; if (c.solo) c.mute = false; }
  saveMixer();
  applyAllChannels();
  mixer.key = '';
  renderMixerPanel();
});
$('mixerFlat').onclick = () => {
  for (const c of Object.values(mixer.ch)) Object.assign(c, { ...MX_DEFAULT, vol: c.vol, mute: c.mute, solo: c.solo });
  saveMixer();
  applyAllChannels();
  mixer.key = '';
};
$('mixerReset').onclick = () => {
  mixer.ch = {};
  saveMixer();
  applyAllChannels();
  mixer.key = '';
};

// ---------------------------------------------------------------------------
// 🎛 Master: the mastering style on the whole mix (master.js), live like a mixer. Every song carries a style
// ("master" in its sheet, picked by the songwriter or the band) and maybe its own tweaks; with "follow song" on,
// the master glides to the song's style when the song starts. Moving a control changes the sound at once.
// ---------------------------------------------------------------------------
const MASTER_BYPASS = { ...MASTER_DEFAULTS, glue: 0 };
const master = { chain: null, style: 'clean', params: null, follow: true, songKey: '', bypass: false, dragging: null, msg: '' };
{
  const st = load();
  master.style = normStyle(st.masterStyle) || 'clean';
  master.params = clampParams(st.masterParams || styleParams(master.style));
  master.follow = st.masterFollow !== false;
}
const saveMaster = (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => save({ masterStyle: master.style, masterParams: master.params, masterFollow: master.follow }), 300); }; })();
/** The chain on Strudel's output (built the first time, rebuilt when the audio engine was reset). */
function masterChain() {
  const ctrl = sdController();
  const merger = ctrl?.output?.channelMerger, dest = ctrl?.output?.destinationGain;
  if (!merger || !dest) return null;
  if (!merger.__master) {
    const chain = createMaster(merger.context);
    try { merger.disconnect(); } catch {}
    merger.connect(chain.input);
    chain.output.connect(dest);
    chain.set(master.bypass ? MASTER_BYPASS : master.params, 0);
    merger.__master = chain;
  }
  master.chain = merger.__master;
  return master.chain;
}
window.__masterInstall = () => { try { masterChain(); } catch (e) { console.warn('master chain:', e); } };
/** Set the master: some controls (live), or a whole style. ramp = seconds to glide. */
function setMaster(params, ramp = 0.03) {
  master.params = clampParams({ ...master.params, ...params });
  if (!master.bypass) masterChain()?.set(master.params, ramp);
  saveMaster();
}
function setMasterStyle(style, tweaks = null, ramp = 0.4) {
  master.style = normStyle(style) || 'clean';
  master.params = styleParams(master.style, tweaks);
  if (!master.bypass) masterChain()?.set(master.params, ramp);
  saveMaster();
  syncMasterUI();
}
/** The song whose style the master follows: the one playing (or the last one that played). */
const masterSong = () => (setl.running ? setl.songs[setl.current] : nowSong) || null;
setInterval(() => {
  const playing = isPlaying();
  if (!playing && !master.chain) return;
  const chain = masterChain();
  if (!chain) return;
  chain.setRunning(playing);
  const cps = scheduler()?.cps;
  if (cps > 0) chain.setTempo(cps);
  // follow the song: glide to its style when it starts (or when its style is edited)
  const sg = playing ? masterSong() : null;
  const key = sg?.sheet ? `${sg.title}|${songStyle(sg)}|${JSON.stringify(sg.sheet.masterParams || {})}` : '';
  if (key && key !== master.songKey) {
    master.songKey = key;
    if (master.follow) {
      setMasterStyle(songStyle(sg), sg.sheet.masterParams, 1.2);
      clog('info', `🎛 master: ${master.style} for “${sg.title}”`);
    }
  }
}, 250);

function renderMasterPanel() {
  $('masterStyle').innerHTML = STYLE_NAMES.map((n) => `<option value="${n}" title="${esc(MASTER_STYLES[n].desc)}">${n}</option>`).join('');
  const groups = [...new Set(MASTER_PARAMS.map((d) => d.group))];
  const ctl = (d) => `<div class="ms-ctl" title="${esc(d.title)} — double-click: the style's value">
      <input type="range" class="mx-v ms-v" data-k="${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" />
      <span class="ms-val" data-v="${d.key}"></span><span class="ms-lbl">${d.label}</span></div>`;
  $('masterBody').innerHTML = groups.map((g) => `<div class="ms-mod"><div class="ms-title">${g}</div><div class="ms-ctls">${MASTER_PARAMS.filter((d) => d.group === g).map(ctl).join('')}</div></div>`).join('') +
    `<div class="ms-mod ms-scope"><div class="ms-title">Output <span class="ms-gr muted"></span></div>
      <div class="ms-ctls"><canvas class="ms-spec" width="220" height="96" title="Spectrum of the mastered mix"></canvas>
      <div class="ms-meters"><canvas class="ms-gr-meter" width="8" height="96" title="Glue compressor gain reduction (0 … −20 dB)"></canvas><canvas class="mx-meter ms-out" width="10" height="96" title="Output level"></canvas></div></div></div>`;
  syncMasterUI();
}
const fmtMaster = (d, v) => (d.unit === 'dB' ? `${v > 0 ? '+' : ''}${v}` : d.key === 'time' ? `${Math.round(v * 16)}/16` : d.key === 'filter' ? (Math.abs(v) < 0.01 ? 'off' : v < 0 ? `LP ${Math.round(-v * 100)}` : `HP ${Math.round(v * 100)}`) : `${Math.round(v * 100)}`);
function syncMasterUI() {
  if (!$('masterBody').firstChild) return;
  $('masterStyle').value = master.style;
  $('masterFollow').checked = master.follow;
  $('masterBypass').classList.toggle('on', master.bypass);
  $('masterBypass').textContent = master.bypass ? 'bypassed — click to hear the style' : 'bypass';
  const base = styleParams(master.style);
  for (const d of MASTER_PARAMS) {
    const v = master.params[d.key];
    const inp = $('masterBody').querySelector(`input[data-k="${d.key}"]`);
    if (inp && master.dragging !== d.key) inp.value = v;
    const lab = $('masterBody').querySelector(`[data-v="${d.key}"]`);
    if (lab) { lab.textContent = fmtMaster(d, v); lab.classList.toggle('changed', Math.abs(v - base[d.key]) > d.step / 2); }
  }
  const sg = masterSong();
  const tweaked = Object.keys(diffParams(master.params, master.style)).length;
  $('masterSong').textContent = master.msg || (sg?.sheet ? `“${sg.title}”: ${songStyle(sg)}${sg.sheet.masterParams && Object.keys(sg.sheet.masterParams).length ? ' (its own mix)' : ''}${songStyle(sg) !== master.style ? ` · now: ${master.style}` : ''}${tweaked ? ' · you changed ' + tweaked : ''}` : tweaked ? `${tweaked} control${tweaked > 1 ? 's' : ''} changed from the style` : MASTER_STYLES[master.style].desc);
}
setupDock('master', {
  onShow: () => { if (!$('masterBody').firstChild) renderMasterPanel(); syncMasterUI(); cancelAnimationFrame(master.raf); drawMaster(); ws.minSize?.('master', 250); },
  onHide: () => cancelAnimationFrame(master.raf),
});
setInterval(() => { if (docks.master?.on) syncMasterUI(); }, 1000);
function drawMaster() {
  master.raf = requestAnimationFrame(drawMaster);
  const chain = master.chain, on = isPlaying() && chain;
  const cv = $('masterBody').querySelector('.ms-spec');
  if (cv) {
    const g = cv.getContext('2d'), w = cv.width, h = cv.height;
    g.fillStyle = '#0b0c10';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1d2029';
    for (const f of [100, 1000, 10000]) { const x = (Math.log10(f / 20) / 3) * w; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    if (on) drawChannelSpectrum(g, chain.analyser, w, h, '#7c5cff');
  }
  const out = $('masterBody').querySelector('.ms-out');
  if (out) drawMeter(out, on ? levelOf(chain.analyser, master.buf || (master.buf = new Float32Array(2048))) : { rms: 0, peak: 0 });
  const gr = $('masterBody').querySelector('.ms-gr-meter');
  if (gr) {
    const g = gr.getContext('2d'), w = gr.width, h = gr.height;
    const r = on ? chain.reduction() : { glue: 0, limit: 0 };
    g.fillStyle = '#0b0c10';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd166';
    g.fillRect(1, 0, w - 2, Math.min(1, -r.glue / 20) * h); // gain reduction hangs from the top
    const lab = $('masterBody').querySelector('.ms-gr');
    if (lab && (master.grShown = (master.grShown || 0) + 1) % 10 === 0) lab.textContent = on ? `glue ${r.glue.toFixed(1)} dB · limit ${r.limit.toFixed(1)} dB` : '';
  }
}
$('masterBody').addEventListener('pointerdown', (e) => { if (e.target.matches('input[type=range]')) master.dragging = e.target.dataset.k; });
window.addEventListener('pointerup', () => { master.dragging = null; });
$('masterBody').addEventListener('input', (e) => {
  const k = e.target.dataset.k;
  if (!k) return;
  master.msg = '';
  if (master.bypass) { master.bypass = false; }
  setMaster({ [k]: Number(e.target.value) });
  syncMasterUI();
});
$('masterBody').addEventListener('dblclick', (e) => {
  const k = e.target.dataset?.k;
  if (!k) return;
  setMaster({ [k]: styleParams(master.style)[k] }, 0.1);
  syncMasterUI();
});
$('masterStyle').onchange = () => { master.msg = ''; master.bypass = false; setMasterStyle($('masterStyle').value); };
$('masterFollow').onchange = () => {
  master.follow = $('masterFollow').checked;
  saveMaster();
  master.songKey = ''; // following again: take the playing song's style now
};
$('masterRevert').onclick = () => { master.msg = ''; setMasterStyle(master.style); };
$('masterBypass').onclick = () => {
  master.bypass = !master.bypass;
  masterChain()?.set(master.bypass ? MASTER_BYPASS : master.params, 0.05);
  syncMasterUI();
};
$('masterSave').onclick = () => {
  const sg = masterSong() || songEdit.sg;
  if (!sg?.sheet) { master.msg = 'play a song first: its style is saved in the song'; syncMasterUI(); return; }
  sg.sheet.master = master.style;
  const d = diffParams(master.params, master.style);
  if (Object.keys(d).length) sg.sheet.masterParams = d; else delete sg.sheet.masterParams;
  master.songKey = `${sg.title}|${songStyle(sg)}|${JSON.stringify(sg.sheet.masterParams || {})}`;
  if (isMine(sg)) saveMySongs();
  lastSongsKey = '';
  renderSongs();
  master.msg = `✓ saved in “${sg.title}”: ${master.style}${Object.keys(d).length ? ` + ${Object.keys(d).length} tweak${Object.keys(d).length > 1 ? 's' : ''}` : ''}${isMine(sg) ? '' : ' (📁 save the song to keep it)'}`;
  syncMasterUI();
  setTimeout(() => { master.msg = ''; }, 6000);
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
  $('sbCost').textContent = session.cost > 0 ? `💲${money(session.cost).slice(1)}${Number(load().aiBudget ?? 2) > 0 ? ` / ${money(Number(load().aiBudget ?? 2)).slice(1)}` : ''}` : '';
  $('sbCost').title = `AI this session: ${session.requests} request${session.requests === 1 ? '' : 's'}, ${session.tokensIn} tokens in / ${session.tokensOut} out (Claude only — local models are free)`;
  const take = rec.take?.events.length ? rec.take : null;
  $('sbRec').textContent = take ? `⏺ ${take.events.length} change${take.events.length > 1 ? 's' : ''} · ${fmtTime(takeSeconds(take))}` : '';
}, 250);

$('sbWarn').onclick = () => { if (!docks.console.on) docks.console.show(true); $('sbWarn').hidden = true; $('sbWarn').dataset.count = '0'; };
// budget setting
$('aiBudget').value = load().aiBudget ?? 2;
$('aiBudget').oninput = () => save({ aiBudget: Math.max(0, Number($('aiBudget').value) || 0) });
setInterval(() => { $('aiSpent').textContent = `${money(session.cost)} in ${session.requests} request${session.requests === 1 ? '' : 's'}`; }, 1000);

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
  if (sel.options.length === list.length + 1) return;
  const want = sel.value || load().keysSound || (list.includes('piano') ? 'piano' : 'triangle');
  sel.innerHTML = '<option value="__custom">✎ custom Strudel line…</option>' + (list.map((k) => `<option>${esc(k)}</option>`).join('') || '<option>triangle</option>');
  sel.value = want === '__custom' || list.includes(want) ? want : sel.options[1].value;
  showKeysTemplate();
}
function showKeysTemplate() {
  const custom = $('keysSound').value === '__custom';
  $('keysTemplate').hidden = !custom;
  if (custom && !$('keysTemplate').value) $('keysTemplate').value = load().keysTemplate || 'note({note}).s("sawtooth").lpf(1600).decay(0.25).sustain(0.3).room(0.2)';
}
$('keysSound').onchange = () => { save({ keysSound: $('keysSound').value }); showKeysTemplate(); keysCompiled = null; };
$('keysTemplate').oninput = () => { save({ keysTemplate: $('keysTemplate').value }); keysCompiled = null; };

/** The sound as a Strudel line with a {note} placeholder: the chosen instrument, or the user's own line. */
const keysTemplate = () => ($('keysSound').value === '__custom' ? $('keysTemplate').value.trim() : `note({note}).s("${$('keysSound').value || 'triangle'}")`) || 'note({note})';
let keysCompiled = null; // { tpl, fn }
/** Compile the template once into (note) → Pattern, the same way the editor reads code ("…" = mini-notation). */
function keysPattern(noteName) {
  const tpl = keysTemplate();
  if (keysCompiled?.tpl !== tpl) {
    if (!tpl.includes('{note}')) throw new Error('the line needs {note} where the played note goes');
    const body = miniStrings(tpl.replace(/\{note\}/g, '__note')).replace(/\bslider\(/g, '__slider(');
    keysCompiled = { tpl, fn: new Function('__slider', '__note', `"use strict"; return (${body});`) };
  }
  const pat = keysCompiled.fn((v) => v, globalThis.mini ? globalThis.mini(noteName) : noteName);
  if (!pat?.queryArc) throw new Error('the line is not a Strudel pattern');
  return pat;
}

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
/**
 * Strudel starts its audio engine on the first mouse-down; the keys use pointer events
 * (and the computer / MIDI keyboard send none), so start it ourselves before the first note.
 */
function ensureAudio() {
  keysState.audio ||= (async () => {
    try { await globalThis.initAudio?.(); } catch {}
    const ctx = audioCtx();
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  })();
  return keysState.audio;
}
async function keysPlay(midi, vel = 0.8) {
  try {
    await ensureAudio();
    const ctx = audioCtx();
    if (ctx.state !== 'running') await ctx.resume();
    const c = cps() || 0.5;
    const pat = keysPattern(midiToName(midi));
    const haps = pat.queryArc(0, 1).filter((h) => h.whole && (!h.hasOnset || h.hasOnset())).slice(0, 16);
    const t0 = ctx.currentTime + 0.03; // a little ahead: the engine drops notes "in the past"
    const len = Number($('keysLen').value) / c; // live notes: the chosen length (you can't know the release yet)
    for (const h of haps) {
      const b = h.whole.begin.valueOf(), e = h.whole.end.valueOf();
      const single = haps.length === 1 && b === 0 && e === 1;
      const v = { ...h.value, velocity: (h.value.velocity ?? 1) * vel };
      globalThis.superdough?.(v, t0 + b / c, single ? len : (e - b) / c, c);
    }
    $('keysInfo').classList.remove('bad');
  } catch (e) {
    $('keysInfo').textContent = `⚠ ${e.message}`;
    $('keysInfo').classList.add('bad');
    clog('error', `keys: ${e.message}`);
  }
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
  if ($('keysInfo').classList.contains('bad') && !keysState.rec) return; // keep the error visible until a note plays
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
  const mini = polyBarsToMini(ordered, grid);
  keysState.result = { mini, bars: nBars, line: keysTemplate().replace(/\{note\}/g, JSON.stringify(mini)) };
  $('keysMini').textContent = keysState.result.line;
  $('keysResult').hidden = false;
  if ($('keysAuto').checked) $('keysInsert').onclick();
}
$('keysRec').onclick = keysRecToggle;
$('keysDiscard').onclick = () => { keysState.result = null; $('keysResult').hidden = true; };
$('keysInsert').onclick = () => {
  const r = keysState.result;
  if (!r) return;
  const existing = new Set(patternLines(getCode()).map((p) => p.base));
  let name = 'keys';
  for (let i = 2; existing.has(name); i++) name = `keys${i}`;
  const fader = /\.gain\(/.test(r.line) ? '.postgain(slider(1, 0, 1.5))' : '.gain(slider(0.8, 0, 1.2))';
  const code = getCode().trimEnd() + `\n${name}: ${r.line}\n  ${fader}\n`;
  keysState.result = null;
  $('keysResult').hidden = true;
  applyQuantized(code, 'recorded keys').then((err) => {
    if (err) { addMsg('error', `Couldn't add the recording: ${err.message}`); clog('error', `keys: ${err.message}`); }
    else clog('ok', state.pending ? `🎹 ${name} armed — starts at bar ${state.pending.at + 1}` : `🎹 ${name} added`);
  });
};
$('keysAI').onclick = async () => {
  const r = keysState.result;
  if (!r || state.busy) return;
  const typed = $('input').value.trim();
  $('input').value = '';
  const instruction = typed || 'Add this recorded part to the music as a new part with a fitting sound and effects.';
  const msg = `${instruction}\n\nRECORDED PART (${r.bars} bar${r.bars > 1 ? 's' : ''}, one bar per cycle, played as: ${r.line}):\nnote("${r.mini}")\n` +
    'Use this note pattern EXACTLY as written (same notes, chords and rhythm). You may choose the sound, octave (.transpose), effects and gain.';
  showPanel('chat');
  addMsg('user', `🎹 ${instruction}\nnote("${r.mini}")`);
  setBusy(true);
  state.abort = new AbortController();
  try { await runTurn(msg); $('keysResult').hidden = true; }
  catch (err) { if (err.name === 'AbortError') addMsg('info', 'stopped'); else warnUser(`AI request failed: ${err.message}`); }
  finally { setBusy(false); }
};
if (load().keysGrid) $('keysGrid').value = load().keysGrid;
$('keysGrid').onchange = () => save({ keysGrid: $('keysGrid').value });
renderKeyboard();
if (load().keysLen) $('keysLen').value = load().keysLen;
$('keysLen').onchange = () => save({ keysLen: $('keysLen').value });
if (load().keysAuto !== undefined) $('keysAuto').checked = load().keysAuto;
$('keysAuto').onchange = () => save({ keysAuto: $('keysAuto').checked });
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
  { label: 'stabs', code: 'chord("<Cm7 Fm7>").voicing().struct("${offbeats}").s("square").decay(0.1).sustain(0).gain(0.35)', mode: 'toggle', color: '#20d3a6' },
  { label: 'arp', code: 'n("0 2 4 7 4 2").scale("C:minor").fast(2).s("triangle").gain(0.5)', mode: 'toggle', color: '#20d3a6' },
  { label: 'pad', code: 'chord("<Cm9 Ab^7>").voicing().s("gm_pad_warm").gain(0.5)', mode: 'toggle', color: '#7c5cff' },
  { label: 'riser', code: 's("white").lpf(saw.range(200, 8000)).gain(0.25)', mode: 'hold', color: '#7c5cff' },
  { label: 'filter all', code: 'all(x => x.lpf(500))', mode: 'hold', color: '#7c5cff' },
  { label: 'echo all', code: 'all(x => x.delay(0.5).delaytime(0.1875).delayfeedback(0.6))', mode: 'hold', color: '#7c5cff' },
];
const myPads = (load().pads || DEFAULT_PADS).map((p, i) => ({ ...DEFAULT_PADS[i], ...p }));
let pads = myPads;
// owner: null = your own pads; a song = that song's pads (edits are saved with the song)
const padsState = { edit: false, sel: null, pending: new Map(), rec: null, owner: null, follow: !!saved.padsFollow };
function savePads() {
  if (padsState.owner) { padsState.owner.pads = pads; if (isMine(padsState.owner)) saveMySongs(); }
  else save({ pads: myPads });
}
/** Show a pad set: a song's pads (owner = the song), or null for your own. */
function loadPads(list, owner = null) {
  if (!list) { pads = myPads; padsState.owner = null; }
  else { pads = Array.from({ length: 16 }, (_, i) => ({ label: '', code: '', mode: 'toggle', color: '#7c5cff', ...(list[i] || {}) })); padsState.owner = owner; if (owner) owner.pads = pads; }
  padsState.sel = null;
  $('padEditor').hidden = true;
  $('padsSource').textContent = owner ? `· ${owner.title}` : '';
  $('padsMine').hidden = !owner;
  renderPads.key = '';
  if (!docks.pads.on) { docks.pads.show(true); save({ padsOn: true }); }
  renderPads();
  lastSongsKey = '';
}

const padN = (i) => i + 1;
const isStatement = (code) => /^\s*(all|each|setcp[ms]|samples)\s*\(/.test(code);
const oneLine = (code) => code.replace(/\s*\n\s*/g, ' ').trim();
const padLineRe = (i) => new RegExp(`^(?:[_S]?pad${padN(i)}:.*|.*// pad${padN(i)}\\s*)$`);
/**
 * A song-part pad (pad.part) is tied to that part's own line in the section that's playing ("bass: …", "_bass: …" when
 * muted). Returns that line, or null when the section doesn't play the part (or plays another variant of it).
 */
function padPartLine(p, code) {
  if (!p?.part) return null;
  const re = new RegExp(`^_?${p.part}:`);
  const line = code.split('\n').find((l) => re.test(l));
  if (!line || (p.variant && p.variant !== 'main' && !line.includes(`${p.part}_${p.variant}`))) return null;
  return line;
}
const padIsOn = (i, code = getCode()) => {
  const pl = padPartLine(pads[i], code);
  return (pl != null && !pl.startsWith('_')) || code.split('\n').some((l) => padLineRe(i).test(l) && !/^_/.test(l));
};
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
  const code = getCode();
  const pl = lineText ? null : padPartLine(p, code);
  // a part the section already plays: the pad mutes / unmutes the section's own line (no extra copy of it)
  const next = pl != null
    ? codeWithPad(code.split('\n').map((l) => (l === pl ? (on ? l.replace(/^_/, '') : l.startsWith('_') ? l : `_${l}`) : l)).join('\n'), i, false)
    : codeWithPad(code, i, on, lineText);
  if (!isPlaying() && !on) { mirror().setCode(next); return null; }
  const when = isPlaying() ? at ?? nextBoundary(padsSyncCycles()) : null;
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
    const sync = padsSyncCycles();
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
    if ($('padCode').value !== p.code) { delete p.part; delete p.variant; } // new code: no longer the song's part
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
/** Pad sync in bars: "next beat" follows the playing song's meter. */
function padsSyncCycles() { const v = Number($('padsSync').value); return v < 1 ? beatCycles() : v; }
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
$('padsMine').onclick = () => { setPadsFollow(false); loadPads(null); };
/** Follow the song: whenever a new song starts, its pads replace the ones in the dock. */
function setPadsFollow(on) {
  padsState.follow = on;
  $('padsFollow').checked = on;
  save({ padsFollow: on });
  const cur = setl.songs[setl.current];
  if (on && setl.running && cur?.pads && padsState.owner !== cur) loadPads(cur.pads, cur);
  lastSongsKey = '';
}
$('padsFollow').checked = padsState.follow;
$('padsFollow').onchange = () => setPadsFollow($('padsFollow').checked);
setupDock('pads', { onShow: () => { renderPads.key = ''; renderPads(); } });

// ---------------------------------------------------------------------------
// 📁 Songs as portable data: a song (sheet + parts code, or its section code for
// block-by-block songs, + its pads) is plain JSON, so it can be exported to a file,
// imported on any Strudel AI server, kept in "My songs", edited and logged.
// ---------------------------------------------------------------------------
const SONG_FORMAT = 'strudel-ai-song';
/** Song → JSON. Sheet songs store just the sheet and parts (the sections are re-arranged from them). */
function songToJSON(sg) {
  const arranged = sg.sheet?.sections && sg.library;
  return {
    format: SONG_FORMAT, version: 1, app: APP_VERSION, saved: new Date().toISOString(),
    title: sg.title, desc: sg.desc || '',
    sheet: sg.sheet || null, library: sg.library || null,
    pads: sg.pads || null,
    steps: arranged ? undefined : (sg.blocks || []).filter((b) => b.code).map((b) => ({ bars: b.bars, prompt: b.prompt, code: b.code, fade: b.fade ?? null })),
  };
}
/** JSON (a file, a share link, a log entry) → song ready to play. Throws when unusable. */
function songFromJSON(j) {
  if (!j || typeof j !== 'object') throw new Error('not a song');
  const song = { title: String(j.title || 'untitled').slice(0, 120), desc: String(j.desc || ''), status: 'ready', sheet: null, library: null, pads: Array.isArray(j.pads) ? j.pads.slice(0, 16) : null };
  if (j.sheet?.sections?.length && typeof j.library === 'string') {
    // stored sheets are already in the app's form; accept the AI's raw form too
    song.sheet = j.sheet.sections.every((x) => Array.isArray(x.play) && typeof x.play[0] === 'object') ? j.sheet : normalizeSheet(j.sheet, 'auto', { enforceForm: false });
    song.library = j.library;
    song.blocks = arrangeSong(song);
  } else if (Array.isArray(j.steps) && j.steps.length) {
    song.blocks = j.steps.filter((st) => typeof st.code === 'string').map((st) => ({ bars: Number(st.bars) || 8, prompt: String(st.prompt || ''), code: st.code, fade: st.fade ?? undefined, fillStep: !!st.fillStep, section: st.section || undefined, status: 'ready', error: null }));
  } else throw new Error('the song has no sheet and no sections');
  if (!song.blocks.length) throw new Error('the song has no sections');
  song.bars = song.blocks.reduce((a, b) => a + b.bars, 0);
  song.firstStep = song.blocks[0];
  const fresh = songPads(song);
  // older songs' pads referred to the song's library consts (lead_main …), which only exist while the song plays:
  // swap those for the self-contained versions
  const libRef = (c) => !/typeof sectionChords/.test(c) && (/^\s*\(?[A-Za-z]\w*_\w+\)?(\(sectionChords\))?\s*$/.test(c) || /\bsectionChords\b/.test(c));
  song.pads = song.pads && fresh
    ? song.pads.map((p) => {
      // older jam pads played the song's scale, not the chords: give them the chord-following version
      if (/^(arp|lead|jam lead)$/.test(p.label) && /\.scale\(/.test(p.code || '') && /^n\("(0 2 4 7 4 2|<0 \[2 4\] 7 \[4 2\]>)"\)/.test(p.code)) {
        return { ...p, label: p.label === 'lead' ? 'jam lead' : p.label, code: (p.label === 'arp' ? JAM_ARP : JAM_LEAD)(padProg(song.sheet)) };
      }
      const f = fresh.find((q) => q.label === p.label);
      if (!libRef(p.code || '')) return f?.part && !p.part && p.code === f.code ? { ...p, part: f.part, variant: f.variant } : p;
      return f ? { ...p, code: f.code, part: f.part, variant: f.variant } : { ...p, code: p.code.replace(/\bsectionChords\b/g, padProg(song.sheet)) };
    })
    : song.pads || fresh;
  return song;
}
const slug = (t) => String(t || 'song').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song';
function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// --- My songs (kept in this browser, separate from the settings)
const MY_SONGS_KEY = 'strudel-ai:songs';
let mySongs = (() => {
  try { return (JSON.parse(localStorage.getItem(MY_SONGS_KEY)) || []).map((j) => { try { return songFromJSON(j); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
})();
function saveMySongs() {
  try { localStorage.setItem(MY_SONGS_KEY, JSON.stringify(mySongs.map(songToJSON))); }
  catch (e) { warnUser(`Couldn't save My songs (browser storage full?): ${e.message}`); }
  lastSongsKey = '';
}
const isMine = (sg) => mySongs.includes(sg);
function addToMySongs(sg) {
  const copy = songFromJSON(JSON.parse(JSON.stringify(songToJSON(sg))));
  mySongs.unshift(copy);
  saveMySongs();
  songSel.set = 'mine:0';
  showPanel('songs');
  clog('ok', `📁 “${copy.title}” saved to My songs`);
  return copy;
}
function myListHTML() {
  if (!mySongs.length) return '<div class="muted small">No songs yet — save one from a set or station (☆ / → My songs), or import a .json file.</div>';
  return mySongs.map((sg, k) => {
    const sel = songSel.set === `mine:${k}`;
    const playing = setl.running && setl.songs[setl.current] === sg;
    return `<div class="song mine ${playing ? 'playing' : 'ready'}${sel ? ' selected' : ''}" data-mine="${k}" title="Show, edit or play this song">
      <span class="ico">${playing ? '▶' : '♪'}</span>
      <div class="body"><div class="t">${esc(sg.title)}</div><div class="meta">${esc(songMeta(sg))}</div>${sel ? `<div class="song-tools">${songToolbarHTML(sg, false)}${sharedLinkHTML(sg)}</div>` : ''}</div>
      <button class="jump" data-mine-play="${k}" title="Play this song (no AI needed)">▶</button>
      <button class="link" data-mine-del="${k}" title="Remove from My songs">🗑</button>
    </div>`;
  }).join('');
}
/** Load a song into the Songs tab's player (replaces the set list's running songs). */
function loadSongIntoSet(song) {
  stopSet(); stopSetlist();
  Object.assign(setl, { mode: 'set', songs: [song], current: -1, nextSong: 0, textDirty: false });
  lastSongsKey = '';
}
function playSong(song) {
  loadSongIntoSet(song);
  startSet('set', { keepSongs: true });
  setl.single = true; // one song: stop after its last section, never loop
}
/** A click on a song's buttons inside a list row. Returns true when handled. */
function rowToolsClick(e, sg) {
  const tools = e.target.closest('.song-tools');
  if (!tools || !sg) return false;
  const act = e.target.closest('[data-act]');
  if (act) songAction(act.dataset.act, sg, act, tools);
  else if (e.target.closest('.sv-copy') && sg.shareUrl) navigator.clipboard?.writeText(sg.shareUrl).then(() => { e.target.textContent = '✓ Copied'; }, () => {});
  return true;
}
$('mySongs').addEventListener('click', (e) => {
  if (rowToolsClick(e, mySongs[Number(e.target.closest('[data-mine]')?.dataset.mine)])) return;
  const play = e.target.closest('[data-mine-play]');
  if (play) { const k = Number(play.dataset.minePlay); songSel.set = `mine:${k}`; playSong(mySongs[k]); return; }
  const del = e.target.closest('[data-mine-del]');
  if (del) {
    const k = Number(del.dataset.mineDel);
    if (!confirm(`Remove “${mySongs[k].title}” from My songs?`)) return;
    mySongs.splice(k, 1);
    if (songSel.set === `mine:${k}`) songSel.set = null;
    saveMySongs(); renderSongs();
    return;
  }
  const row = e.target.closest('[data-mine]');
  if (row) { const v = `mine:${row.dataset.mine}`; songSel.set = songSel.set === v ? null : v; lastSongsKey = ''; renderSongs(); }
});
$('songImport').onchange = async () => {
  const f = $('songImport').files[0];
  $('songImport').value = '';
  if (!f) return;
  try {
    const text = await f.text();
    let data;
    try { data = JSON.parse(text); } catch {
      const at = text.indexOf(LOG_JSON_MARK);
      if (at < 0) throw new Error('no song JSON in this file');
      data = JSON.parse(text.slice(text.indexOf('\n', at) + 1));
    }
    const list = (Array.isArray(data) ? data : data.songs || [data]).map((j) => songFromJSON(j.json || j));
    mySongs.unshift(...list);
    saveMySongs();
    songSel.set = 'mine:0';
    renderSongs();
    clog('ok', `📁 imported ${list.length} song${list.length > 1 ? 's' : ''}: ${list.map((x) => x.title).join(', ')}`);
    addMsg('info', `📁 imported ${list.map((x) => `“${x.title}”`).join(', ')} into My songs`);
  } catch (e) {
    warnUser(`Couldn't import songs: ${e.message}`);
  }
};

// --- ★ Favorites: shared with everyone on this server (stored server-side, survive restarts)
let favorites = []; // [{ id, favorited, song (object) }]
async function loadFavorites() {
  try {
    const j = await fetch('/api/favorites', { cache: 'no-cache' }).then((r) => r.json());
    const keep = new Map(favorites.map((f) => [f.id, f]));
    favorites = (j.favorites || []).map((f) => {
      if (keep.has(f.id)) return keep.get(f.id); // keep the same object (it may be playing)
      try { return { id: f.id, favorited: f.favorited, song: songFromJSON(f.song) }; } catch { return null; }
    }).filter(Boolean);
    lastSongsKey = '';
  } catch (e) { clog('warn', `favorites unavailable: ${e.message}`); }
}
const favKey = (sg) => `${sg.title}\n${sg.library || ''}`;
const favOf = (sg) => favorites.find((f) => f.song === sg || favKey(f.song) === favKey(sg));
async function toggleFavorite(sg) {
  const f = favOf(sg);
  try {
    if (f) {
      if (!confirm(`Remove “${sg.title}” from the favorites everyone on this server sees?`)) return;
      await fetch(`/api/favorites/${f.id}`, { method: 'DELETE' });
      clog('ok', `★ “${sg.title}” removed from favorites`);
    } else {
      const r = await fetch('/api/favorites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song: songToJSON(sg) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      clog('ok', `★ “${sg.title}” is now a favorite on this server`);
    }
    await loadFavorites();
  } catch (e) { warnUser(`Favorite failed: ${e.message}`); }
  renderSongs();
}
function favListHTML() {
  if (!favorites.length) return '<div class="muted small">No favorites yet — ★ a song you like and everyone on this server will see it here.</div>';
  return favorites.map((f, k) => {
    const sg = f.song;
    const sel = songSel.set === `fav:${k}`;
    const playing = setl.running && setl.songs[setl.current] === sg;
    return `<div class="song fav ${playing ? 'playing' : 'ready'}${sel ? ' selected' : ''}" data-fav="${k}" title="Show or play this song">
      <span class="ico">${playing ? '▶' : '★'}</span>
      <div class="body"><div class="t">${esc(sg.title)}</div><div class="meta">${esc(songMeta(sg))}</div>${sel ? `<div class="song-tools">${songToolbarHTML(sg, false)}${sharedLinkHTML(sg)}</div>` : ''}</div>
      <button class="jump" data-fav-play="${k}" title="Play this song (no AI needed)">▶</button>
    </div>`;
  }).join('');
}
$('favSongs').addEventListener('click', (e) => {
  if (rowToolsClick(e, favorites[Number(e.target.closest('[data-fav]')?.dataset.fav)]?.song)) return;
  const play = e.target.closest('[data-fav-play]');
  if (play) { const k = Number(play.dataset.favPlay); songSel.set = `fav:${k}`; playSong(favorites[k].song); return; }
  const row = e.target.closest('[data-fav]');
  if (row) { const v = `fav:${row.dataset.fav}`; songSel.set = songSel.set === v ? null : v; lastSongsKey = ''; renderSongs(); }
});
loadFavorites();
setInterval(loadFavorites, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadFavorites(); });

// --- editing a song: re-arranged by the app (no AI), live if it's playing
function rawSheet(sh) {
  return {
    form: sh.form, ...(sh.band ? { band: sh.band } : {}), master: sh.master || 'clean', ...(sh.masterParams ? { masterParams: sh.masterParams } : {}),
    bpm: sh.bpm, meter: normMeter(sh.meter), key: sh.key, scale: sh.scale, hook: sh.hook,
    chords: Object.fromEntries(Object.entries(sh.chords).map(([k, v]) => [k, v.replace(/^<|>$/g, '')])),
    parts: sh.parts.map((p) => ({ name: p.id, role: p.role, sound: p.sound, variants: p.variants, desc: p.desc })),
    sections: sh.sections.map((x) => ({ name: x.name, bars: x.bars, chords: x.chords, play: x.play.map((y) => (y.variant === 'main' ? y.part : `${y.part}.${y.variant}`) + (y.enter ? `@${y.enter}` : '')), ...(x.shift ? { shift: x.shift } : {}), ...(x.bpm ? { bpm: x.bpm } : {}) })),
  };
}
/**
 * Apply a new sheet and/or parts code to a song. Checks the parts (names, sounds, a silent test
 * play) and re-arranges the sections; a playing song switches to the new arrangement from its
 * next section. Returns an error message, or null.
 */
async function applySongEdit(sg, raw, partsCode = null) {
  let sheet;
  try { sheet = normalizeSheet(raw, 'auto', { enforceForm: false }); } catch (e) { return `the song sheet can't be used: ${e.message}`; }
  let lib = partsCode ? `${tempoLine(sheet.bpm, sheet.meter)}\n` + partsCode.replace(/^\s*setcp[ms]\([^)]*\)\s*;?\s*$/gm, '').trim() : sg.library.replace(/setcp[ms]\([^)]*\)/, tempoLine(sheet.bpm, sheet.meter));
  const missing = libraryIds(sheet).filter((id) => !definesId(lib, id));
  if (missing.length) return `the parts code is missing: ${missing.join(', ')} (every part.variant the sections play needs a const)`;
  if (patternLines(lib).length) return 'the parts code must only contain const definitions (no "name:" lines)';
  const syn = syntaxError(lib);
  if (syn) return `the parts code has a syntax error: ${syn}`;
  const prep = await prepareCode(lib, { quiet: true, library: true });
  if (prep.error) return prep.error;
  lib = prep.code;
  const testErr = testLibrary(lib, sheet);
  if (testErr) return `the parts fail when test-played: ${testErr.message}`;
  sg.sheet = sheet;
  sg.library = wrapCode(lib);
  rearrangeSong(sg);
  if (isMine(sg)) saveMySongs();
  lastSongsKey = '';
  const tempos = sheet.sections.map((x) => `${x.name} ${x.bpm || sheet.bpm}${x.shift ? ` key ${signed(x.shift)}` : ''}`).join(' · ');
  clog('ok', `🎵 “${sg.title}” updated: ${sheet.sections.length} sections, ${sheet.sections.reduce((a, x) => a + x.bars, 0)} bars — ${tempos} bpm`);
  return null;
}
/**
 * After a song edit: switch the section that's playing to its new version on the next bar (keeping faders,
 * mute / solo and its place in the phrase). Returns true when it did.
 */
async function refreshPlayingSection(sg) {
  if (!setl.running || setl.songs[setl.current] !== sg || state.pending || setlist.paused || !isPlaying()) return false;
  const st = setlist.steps.find((x) => x.status === 'playing' && x.song === sg);
  const sec = st?.section && sg.sheet.sections.find((x) => x.name === st.section.name);
  if (!sec) return false;
  const code = atSectionStart(carryLiveState(getCode(), sectionCode(sg, sec, { fill: !!st.fillStep })), st.startedAt ?? 0);
  const err = await evaluateCode(code, { at: nextBoundary(1), fade: fadeCycles(sg), label: `“${sg.title}” ${st.prompt} (edited)` });
  if (err) { clog('warn', `the edited ${st.prompt} didn't play (${err.message}) — it changes from the next section`); return false; }
  st.code = code;
  st.section = sec;
  return true;
}

/** Rebuild a song's sections; if it's in the player, replace the ones that haven't started. */
function rearrangeSong(sg) {
  const fresh = arrangeSong(sg);
  fresh.forEach((st) => Object.assign(st, { song: sg }));
  const inEngine = sg.blocks?.some((b) => setlist.steps.includes(b));
  if (!inEngine) {
    sg.blocks = fresh;
  } else {
    const started = sg.blocks.filter((b) => ['playing', 'done', 'armed'].includes(b.status) && setlist.steps.includes(b));
    const lastStarted = started[started.length - 1];
    const fromSec = lastStarted ? sg.sheet.sections.findIndex((x) => x.name === lastStarted.section?.name) + 1 || started.filter((b) => !b.fillStep).length : 0;
    const tail = fresh.filter((st) => sg.sheet.sections.indexOf(st.section) >= fromSec);
    const pending = sg.blocks.filter((b) => !started.includes(b));
    const at = pending.length ? setlist.steps.indexOf(pending[0]) : setlist.steps.indexOf(lastStarted) + 1;
    setlist.steps = setlist.steps.filter((b) => !pending.includes(b));
    setlist.steps.splice(at, 0, ...tail);
    if (setlist.playIndex > at) setlist.playIndex = at;
    setlist.genIndex = Math.min(setlist.genIndex, at);
    sg.blocks = [...started, ...tail];
  }
  sg.blocks.forEach((st, j) => Object.assign(st, { song: sg, songPos: j, songLen: sg.blocks.length, songStart: j === 0 }));
  sg.bars = sg.blocks.reduce((a, b) => a + b.bars, 0);
  sg.firstStep = sg.blocks[0];
  if (padsState.owner === sg) loadPads(sg.pads, sg);
}

// ✎ Edit song: a panel with the song's sections / chords / parts as text lines and its parts code
const songEdit = { sg: null };
// closing ✎ Edit song stops editing
ws.on('edit', { onOpen: (o) => { if (!o && songEdit.sg) { songEdit.sg = null; lastSongsKey = ''; } } });
function openSongEditor(sg) {
  songEdit.sg = sg;
  $('editForm').__sg = null; // render the editor for this song
  ws.open('edit');
  ws.api?.getPanel('edit')?.api.setTitle?.(`✎ ${sg.title}`);
  lastSongsKey = '';
  renderSongs();
}
function songEditorHTML(sg) {
  const r = rawSheet(sg.sheet);
  return `<div class="sv-edit">
    <div class="sv-edit-row"><label>title <input data-f="title" value="${esc(sg.title)}" /></label><label>bpm <input data-f="bpm" type="number" min="50" max="200" value="${r.bpm}" /></label><label>meter <select data-f="meter">${METERS.map((m) => `<option${m === r.meter ? ' selected' : ''}>${m}</option>`).join('')}</select></label><label>scale <input data-f="scale" value="${esc(r.scale)}" /></label><label title="The master style: the mastering on the whole song (tweak it live in 🎛 Master)">master <select data-f="master">${STYLE_NAMES.map((n) => `<option${n === r.master ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div>
    <label>chords — <span class="muted">one per line: <code>name: Am F C G</code></span>
      <textarea data-f="chords" rows="3">${esc(Object.entries(r.chords).map(([k, v]) => `${k}: ${v}`).join('\n'))}</textarea></label>
    <label>sections — <span class="muted">one per line: <code>name | bars | chords | parts (part or part.variant)</code>, optionally <code>| key +2, 106 bpm</code></span>
      <textarea data-f="sections" rows="${Math.min(14, r.sections.length + 1)}">${esc(r.sections.map((x) => `${x.name} | ${x.bars} | ${x.chords} | ${x.play.join(', ')}${x.shift || x.bpm ? ` | ${[x.shift ? `key ${signed(x.shift)}` : '', x.bpm ? `${x.bpm} bpm` : ''].filter(Boolean).join(', ')}` : ''}`).join('\n'))}</textarea></label>
    <label>parts — <span class="muted">one per line: <code>name | role | sound | variants</code></span>
      <textarea data-f="parts" rows="${Math.min(8, r.parts.length + 1)}">${esc(r.parts.map((p) => `${p.name} | ${p.role} | ${p.sound} | ${p.variants.join(', ')}`).join('\n'))}</textarea></label>
    <label>parts code — <span class="muted">a <code>const name_variant = …</code> for every part.variant the sections use (harmonic parts take <code>(prog)</code>)</span>
      <textarea data-f="library" rows="10" spellcheck="false">${esc(sg.library)}</textarea></label>
    <div class="sl-buttons"><button data-act="edit-save">✓ apply</button><button data-act="edit-cancel" class="link">cancel</button><span class="sv-edit-msg muted small"></span></div>
    <div class="muted small">Or ask the chat: “make the chorus 16 bars”, “add a breakdown before the last chorus”, “give the bass a funkier line”.</div>
  </div>`;
}
async function saveSongEditor(el, sg) {
  const v = (f) => el.querySelector(`[data-f="${f}"]`).value;
  const lines = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean);
  const raw = rawSheet(sg.sheet);
  raw.bpm = Number(v('bpm')) || raw.bpm;
  raw.meter = v('meter') || raw.meter;
  raw.scale = v('scale').trim() || raw.scale;
  raw.key = raw.scale.replace(':', ' ');
  if (v('master') !== raw.master) { raw.master = v('master'); delete raw.masterParams; } // a new style starts from its own settings
  raw.chords = Object.fromEntries(lines(v('chords')).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }).filter(([k, c]) => k && c));
  raw.parts = lines(v('parts')).map((l) => { const [name, role, sound, variants] = l.split('|').map((x) => (x || '').trim()); return { name, role, sound, variants: (variants || 'main').split(/[,\s]+/).filter(Boolean) }; });
  raw.sections = lines(v('sections')).map((l) => {
    const [name, bars, chords, play, moves = ''] = l.split('|').map((x) => (x || '').trim());
    return { name, bars: Number(bars) || 8, chords, play: (play || '').split(/[,\s]+/).filter(Boolean),
      shift: Number(moves.match(/key\s*([+-]?\d+)/i)?.[1]) || 0, bpm: Number(moves.match(/(\d+)\s*bpm/i)?.[1]) || 0 };
  });
  const msg = el.querySelector('.sv-edit-msg');
  msg.textContent = 'checking…';
  const title = v('title').trim();
  const err = await applySongEdit(sg, raw, v('library'));
  if (err) { msg.textContent = `⚠ ${err}`; msg.classList.add('bad'); return; }
  if (title) sg.title = title;
  if (isMine(sg)) saveMySongs();
  $('editForm').__sg = null; // re-render the editor with the song as it is now
  lastSongsKey = '';
  renderSongs();
  const done = $('editForm').querySelector('.sv-edit-msg');
  if (done) done.textContent = `✓ applied${setl.running && setl.songs[setl.current] === sg ? ' — from the next section' : ''}${isMine(sg) ? ' and saved' : ' (📁 Save to My songs to keep it)'}`;
}

// --- song pads: 16 pads built from the song itself (its parts, key and chords) — no AI needed
/** The expression a library const is defined as (so a pad can play the part without the library loaded). */
function libExpr(lib, id) {
  const m = new RegExp(`^\\s*(?:const|let|var)\\s+${id}\\s*=\\s*`, 'm').exec(lib);
  if (!m) return null;
  const rest = lib.slice(m.index + m[0].length);
  const end = rest.search(/^\s*(?:const|let|var)\s+[\w$]+\s*=|^\s*setcp[ms]\(/m);
  return (end < 0 ? rest : rest.slice(0, end)).trim().replace(/;\s*$/, '');
}
const JAM_ARP = (prog) => `n("0 1 2 3 2 1").chord(${prog}).voicing().fast(2).s("triangle").gain(0.4)`;
const JAM_LEAD = (prog) => `n("<[0 ~ 2] [3 2] [4 ~ 3] [2 1]>").chord(${prog}).voicing().add(note(12)).s("sawtooth").lpf(2000).decay(0.2).sustain(0.3).gain(0.3)`;
/** Chords for a pad: the section's chords when one of the song's sections plays, else the song's first progression. */
const padProg = (sh) => `(typeof sectionChords === 'undefined' ? ${JSON.stringify(Object.values(sh.chords)[0])} : sectionChords)`;
function songPads(sg) {
  const sh = sg.sheet, lib = sg.library;
  if (!sh || !lib) return null;
  const pads = [];
  const add = (label, code, mode = 'toggle', color = '#7c5cff', extra = {}) => { if (pads.length < 16) pads.push({ label, code, mode, color, ...extra }); };
  // pads must work whatever is playing (see padProg)
  const prog = padProg(sh);
  const drums = sh.parts.find((p) => /drum|perc|beat/i.test(p.role + p.id));
  const bank = drums && /^[A-Z]/.test(drums.sound) ? `.bank("${drums.sound}")` : '';
  const scale = sh.scale;
  // rhythms in the song's meter: a 16th-note roll is 16 steps in 4/4, 12 in 3/4, 12 in 6/8
  const steps = meterSteps(sh.meter), roll = /\/8$/.test(normMeter(sh.meter)) ? steps * 2 : steps * 4;
  const offbeats = Array.from({ length: steps }, (_, k) => (k % 2 ? 'x' : '~')).join(' ');
  // the song's own parts, one pad each: lit while the section plays the part, pressing mutes / unmutes it
  // (or plays it on top when the section doesn't have it); then their extra variants (half-time drums, fills …)
  const partPad = (p, v) => {
    const id = `${p.id}_${v}`, expr = libExpr(lib, id);
    if (!expr) return;
    // the part's own code, inlined (the library consts only exist while one of this song's sections plays)
    const code = isFnPart(lib, id) ? `(${expr})(${prog})` : `(${expr})`;
    add(v === 'main' ? p.id : `${p.id} ${v}`, code, v === 'fill' ? 'once' : 'toggle', v === 'fill' ? '#ffd166' : '#4cc9f0', { part: p.id, variant: v });
  };
  for (const p of sh.parts) partPad(p, 'main');
  for (const p of sh.parts) for (const v of p.variants) if (v !== 'main' && pads.length < 10) partPad(p, v);
  // jam pads, most useful first (the song's parts may leave room for only some of them)
  add('tempo −¼', 'all(x => x.slow(4/3))', 'hold', '#ff8fa3'); // everything at ¾ speed while held
  add('tempo +¼', 'all(x => x.fast(5/4))', 'hold', '#ff8fa3'); // everything at 1¼ speed while held
  add('filter all', 'all(x => x.lpf(500))', 'hold', '#7c5cff');
  add('snare roll', `s("sd*${roll}")${bank}.gain(saw.range(0.2, 0.9))`, 'once', '#ffd166');
  add('crash', `s("cr")${bank}.gain(0.6)`, 'once', '#ffd166');
  add('riser', 's("white").lpf(saw.range(200, 8000)).gain(0.25)', 'hold', '#7c5cff');
  add('echo all', 'all(x => x.delay(0.5).delaytime(0.1875).delayfeedback(0.6))', 'hold', '#7c5cff');
  add('half time', 'all(x => x.slow(2))', 'hold', '#7c5cff');
  // jam parts in the song's key, following the section's chords
  // the arp and lead play the tones of the chord sounding now (the section's chords, moved with any key change)
  add('arp', JAM_ARP(prog), 'toggle', '#20d3a6');
  add('jam lead', JAM_LEAD(prog), 'toggle', '#20d3a6');
  add('stabs', `chord(${prog}).voicing().struct("~ x ~ x").s("square").decay(0.1).sustain(0).gain(0.3)`, 'toggle', '#20d3a6');
  add('jam pad', `chord(${prog}).voicing().s("supersaw").attack(0.4).release(1).lpf(1800).gain(0.25)`, 'toggle', '#7c5cff');
  return pads;
}

// --- 🧾 every song played this session (kept in the tab; download as a text file)
const LOG_KEY = 'strudel-ai:playlog';
const LOG_JSON_MARK = '--- SONGS AS JSON';
const playLog = (() => { try { return JSON.parse(sessionStorage.getItem(LOG_KEY)) || []; } catch { return []; } })();
function logPlayed(sg, mode) {
  if (!sg?.blocks?.length || playLog[playLog.length - 1]?.title === sg.title) return;
  playLog.push({ at: new Date().toISOString(), mode, title: sg.title, json: songToJSON(sg) });
  try { sessionStorage.setItem(LOG_KEY, JSON.stringify(playLog.slice(-200))); } catch {}
}
function playLogText() {
  const out = [`Strudel AI — songs played this session (${new Date().toLocaleString()})`, ''];
  playLog.forEach((e, i) => {
    const j = e.json, sh = j.sheet;
    out.push(`${i + 1}. ${new Date(e.at).toLocaleTimeString()}  “${j.title}”  (${e.mode})`);
    if (j.desc) out.push(`   ${j.desc}`);
    if (sh) {
      out.push(`   ${sh.bpm} bpm · ${sh.key} · form ${sh.form || '?'} · ${sh.sections.length} sections · ${sh.sections.reduce((a, x) => a + x.bars, 0)} bars`);
      out.push(`   chords: ${Object.entries(sh.chords).map(([k, v]) => `${k} ${v}`).join(' · ')}   hook: ${sh.hook}`);
      out.push(`   sections: ${sh.sections.map((x) => `${x.name} ${x.bars}`).join(', ')}`);
      out.push('   parts code:', ...String(j.library || '').split('\n').map((l) => '     ' + l));
    } else {
      out.push(`   ${(j.steps || []).length} sections:`, ...(j.steps || []).map((st) => `     ${st.bars} bars — ${st.prompt}`));
    }
    out.push('');
  });
  out.push(`${LOG_JSON_MARK} (import this file in 🎵 Songs → 📁 My songs → ⬆ import) ---`, JSON.stringify(playLog.map((e) => e.json), null, 1));
  return out.join('\n');
}
for (const b of [$('logDownload'), ...document.querySelectorAll('.log-dl')]) {
  b.onclick = () => {
    if (!playLog.length) { clog('info', 'no songs played yet this session'); b.title = 'No songs played yet this session'; return; }
    download(`strudel-ai-session-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`, playLogText(), 'text/plain');
  };
}

// --- chat ↔ song / pads: the context the chat needs, and applying its replies
/** The song chat should work on: the one playing (if written from a sheet), else the one open in the Songs tab. */
function activeSong() {
  const playing = setl.running ? setl.songs[setl.current] : null;
  if (playing?.sheet && playing.library) return playing;
  if (songEdit.sg?.sheet && songEdit.sg.library) return songEdit.sg;
  const viewed = viewedSong('set');
  return viewed?.sheet && viewed.library ? viewed : null;
}
const SONG_WORDS = /\b(song|section|sections|verse|chorus|bridge|intro|outro|drop|build|breakdown|break|structure|form|arrange|arrangement|chords?|progression|parts?|bars?|hook|tempo|bpm|key|master|mastering|mix|style|band|lo-?fi)\b/i;
/** Extra context for a chat request — only when the message is about the song / pads (keeps requests small). */
function chatContext(text) {
  const out = [];
  const target = chatTarget();
  const sg = activeSong();
  if (sg && (target === 'song' || (target === 'auto' && SONG_WORDS.test(text)))) {
    out.push(`ACTIVE SONG "${sg.title}" — sheet JSON ("master" is the song's mastering style, one of: ${STYLE_NAMES.join(', ')}; "masterParams" optional tweaks of it: ${MASTER_PARAMS.map((d) => `${d.key} ${d.min}…${d.max}`).join(', ')}):\n${JSON.stringify(rawSheet(sg.sheet))}\nPARTS CODE:\n\`\`\`javascript\n${sg.library}\n\`\`\``);
  }
  if (target === 'song' && sg) {
    out.push('TARGET: THE WHOLE SONG. Make the change across the song — its sections, form, chords, parts and their variants — ' +
      'by replying with a ```song block (the COMPLETE updated sheet) and, when parts are added or their code changes, a ```parts block ' +
      '(the COMPLETE parts code). Do NOT reply with a ```javascript block: the editor only shows the section playing now and is rebuilt from the song.');
  }
  if (target === 'pads' || (target === 'auto' && /\bpads?\b/i.test(text))) {
    out.push('PADS (number. label [mode]: code):\n' + pads.map((p, i) => `${i + 1}. ${p.label} [${p.mode}]${padIsOn(i) ? ' (on)' : ''}: ${oneLine(p.code)}`).join('\n'));
    if (target === 'pads') out.push('TARGET: THE PADS. Reply with a ```pads block; only include a ```javascript block if the code in the editor must change too.');
  }
  return out.join('\n\n');
}
/**
 * 🎯 What the chat works on: auto | code | song | pads. "song" falls back to auto when no song is open; auto means the
 * whole song while the editor shows a section of the song that's playing (an edit to just that section's code would
 * be replaced at the next section), otherwise the code.
 */
function chatTarget() {
  const v = $('chatTarget').value;
  if (v === 'song') return activeSong() ? 'song' : 'auto';
  if (v === 'auto' && songSectionInEditor()) return 'song';
  return v;
}
const songSectionInEditor = () => {
  const sg = activeSong();
  return !!(sg && setl.running && setl.songs[setl.current] === sg && getCode().includes(SEC_START));
};
/** If editor code from the AI is really the song's part library, return it as library code (consts), else null. */
function libraryFromReply(code, sg) {
  if (!sg?.sheet || !sg.library) return null;
  const ids = new Set(libraryIds(sg.sheet));
  const lines = code.split('\n');
  const named = lines.map((l) => l.match(/^(?:const\s+|let\s+|var\s+)?([A-Za-z_$][\w$]*)\s*(?:=|:(?!:))/)?.[1]).filter((n) => n && ids.has(n));
  if (new Set(named).size < 2) return null; // not the library — ordinary code
  if (code.includes(SEC_START) || /^\s*const sectionChords\b/m.test(code)) return null; // a whole section, not just parts
  return lines.map((l) => l.replace(/^([A-Za-z_$][\w$]*):(?!:)\s*/, (m, n) => (ids.has(n) || /_\w+$/.test(n) ? `const ${n} = ` : m))).join('\n');
}
if (saved.chatTarget) $('chatTarget').value = saved.chatTarget;
$('chatTarget').onchange = () => { save({ chatTarget: $('chatTarget').value }); renderChatTarget(); };
/** Keep the song option labelled with the song it works on. */
function renderChatTarget() {
  const sg = activeSong();
  const opt = $('chatTarget').querySelector('option[value="song"]');
  const label = sg ? `🎵 whole song: ${sg.title.slice(0, 28)}` : '🎵 whole song (none open)';
  if (opt.textContent !== label) opt.textContent = label;
  const auto = $('chatTarget').value === 'auto' && songSectionInEditor();
  $('chatTarget').querySelector('option[value="auto"]').textContent = auto ? 'auto → whole song' : 'auto';
  if ($('chatTarget').value === 'new') { $('input').placeholder = 'Describe a new song: style, tempo, key, mood, instruments… (or “Title | description”)'; return; }
  $('input').placeholder = { song: sg ? `Change the whole song “${sg.title}”… (sections, chords, parts)` : 'No song is open — open one in 🎵 Songs (Enter to send)', pads: 'Program or press the pads… (Enter to send)', code: 'Change the code in the editor… (Enter to send, Shift+Enter for newline)' }[auto ? 'song' : $('chatTarget').value]
    || 'Make it groovier… (Enter to send, Shift+Enter for newline)';
}
setInterval(renderChatTarget, 1000);
/** ```pads reply: program pads and/or switch them on / off. Returns a short summary. */
function applyPadsReply(block) {
  const j = parseJSONLoose(block.startsWith('{') ? block : `{${block}}`);
  const done = [];
  for (const p of Array.isArray(j.program) ? j.program : []) {
    const i = Number(p.pad) - 1;
    if (!(i >= 0 && i < 16)) continue;
    if (p.code != null && String(p.code) !== pads[i].code) { delete pads[i].part; delete pads[i].variant; }
    pads[i] = { ...pads[i], ...(p.label != null ? { label: String(p.label).slice(0, 24) } : {}), ...(p.code != null ? { code: String(p.code) } : {}), ...(['toggle', 'hold', 'once'].includes(p.mode) ? { mode: p.mode } : {}), ...(p.color ? { color: String(p.color) } : {}) };
    done.push(`programmed pad ${i + 1} (${pads[i].label})`);
  }
  if (done.length) savePads();
  for (const n of Array.isArray(j.on) ? j.on : []) { const i = Number(n) - 1; if (pads[i]) { (pads[i].mode === 'once' ? padOnce(i) : setPad(i, true)); done.push(`pad ${i + 1} on`); } }
  for (const n of Array.isArray(j.off) ? j.off : []) { const i = Number(n) - 1; if (pads[i]) { setPad(i, false); done.push(`pad ${i + 1} off`); } }
  renderPads.key = '';
  if (done.length && !docks.pads.on) { docks.pads.show(true); save({ padsOn: true }); }
  return done.join(', ');
}

// ---------------------------------------------------------------------------
// 🎙 MP3 recording: one tap on the master output (what you hear) feeds MP3
// encoders running in Web Workers (lamejs). Two kinds of recording share it:
//  · song takes: every song is recorded in the background as it plays (from its
//    first section); when it has played to its end the take is kept and the song
//    gets a "⬇ MP3" button. Songs cut short are thrown away. Never touches playback.
//  · the status-bar ⏺ MP3: records everything until clicked again, then downloads.
// ---------------------------------------------------------------------------
const mp3 = { rec: null, seg: null, tap: null, takes: [], want: new Set() };
const MP3_MAX_TAKES = 20; // takes live in memory for this page; oldest are dropped
function mp3Worker() {
  const lib = new URL('/vendor/lamejs/lame.min.js', location.href).href;
  const src = `importScripts(${JSON.stringify(lib)});
let enc = null; const out = [];
const toI16 = (f) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } return o; };
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'start') { enc = new lamejs.Mp3Encoder(2, m.sampleRate, 192); out.length = 0; }
  else if (m.type === 'data') { const b = enc.encodeBuffer(toI16(m.l), toI16(m.r)); if (b.length) out.push(b); }
  else if (m.type === 'end') { const b = enc.flush(); if (b.length) out.push(b); postMessage(out); }
};`;
  return new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
}
/** Connect (or disconnect, when nothing records) the shared tap on the master output. */
function mp3TapUpdate() {
  const need = !!(mp3.rec || mp3.seg);
  if (need && !mp3.tap) {
    const ctx = audioCtx();
    let node;
    try { node = globalThis.getSuperdoughAudioController().output.destinationGain; } catch { return false; }
    const proc = ctx.createScriptProcessor(4096, 2, 2);
    proc.onaudioprocess = (e) => {
      const l = e.inputBuffer.getChannelData(0), r = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : l;
      if (mp3.paused) return; // ⏸ paused song: the recording pauses too
      for (const sink of [mp3.rec, mp3.seg]) if (sink) sink.worker.postMessage({ type: 'data', l: l.slice(), r: r.slice() });
    };
    node.connect(proc);
    proc.connect(ctx.destination); // a ScriptProcessor only runs when connected; it outputs silence
    mp3.tap = { node, proc };
  } else if (!need && mp3.tap) {
    try { mp3.tap.node.disconnect(mp3.tap.proc); mp3.tap.proc.disconnect(); } catch {}
    mp3.tap = null;
  }
  return true;
}
function mp3Sink(name) {
  const worker = mp3Worker();
  worker.postMessage({ type: 'start', sampleRate: audioCtx().sampleRate });
  return { worker, name, t0: performance.now() };
}
/** Finish an encoder: cb(blob, seconds) once the MP3 is flushed. */
function mp3Finish(sink, cb) {
  const secs = (performance.now() - sink.t0) / 1000;
  if (!cb) { sink.worker.terminate(); return; }
  sink.worker.onmessage = (e) => { sink.worker.terminate(); cb(new Blob(e.data, { type: 'audio/mpeg' }), secs); };
  sink.worker.postMessage({ type: 'end' });
}
const mp3Name = (name) => `${slug(name)}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.mp3`;
function downloadBlob(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---- status-bar ⏺ MP3: record everything ----
async function mp3Start(name = 'strudel-ai') {
  if (mp3.rec) return;
  await ensureAudio();
  mp3.rec = mp3Sink(name);
  if (!mp3TapUpdate()) { mp3Finish(mp3.rec); mp3.rec = null; warnUser('MP3: the audio engine is not ready yet — press ▶ first'); return; }
  $('mp3Btn').classList.add('on');
  clog('info', `🎙 recording MP3 “${name}”…`);
}
function mp3Stop() {
  const r = mp3.rec;
  if (!r) return;
  mp3.rec = null;
  mp3TapUpdate();
  $('mp3Btn').classList.remove('on');
  $('mp3Btn').textContent = '⏺ MP3';
  mp3Finish(r, (blob, secs) => {
    const name = mp3Name(r.name);
    downloadBlob(name, blob);
    clog('ok', `🎙 MP3 saved: ${name} (${fmtTime(secs)}, ${(blob.size / 1e6).toFixed(1)} MB)`);
  });
}
$('mp3Btn').onclick = () => (mp3.rec ? mp3Stop() : mp3Start(setl.songs[setl.current]?.title || 'strudel-ai'));
setInterval(() => { if (mp3.rec) $('mp3Btn').textContent = `■ ${fmtTime((performance.now() - mp3.rec.t0) / 1000)}`; }, 500);

// ---- song takes: recorded in the background, kept when the song plays to its end ----
const recordSongsOn = () => $('recSongs').checked;
if (saved.recSongs !== undefined) $('recSongs').checked = saved.recSongs;
$('recSongs').onchange = () => { save({ recSongs: $('recSongs').checked }); if (!recordSongsOn()) mp3TakeEnd(false); lastSongsKey = ''; };
/** A section of a song started playing: begin, follow or end the song's take. */
function mp3SongStep(step) {
  const sg = step.song;
  const idx = sg.blocks?.indexOf(step) ?? -1;
  if (mp3.seg && mp3.seg.sg !== sg) mp3TakeEnd(); // the previous song is over (complete if it reached its last section)
  if (mp3.seg) { mp3.seg.reached = Math.max(mp3.seg.reached, idx); return; }
  if (idx !== 0 || !(recordSongsOn() || mp3.want.has(sg))) return; // takes start at the song's first section
  mp3.seg = Object.assign(mp3Sink(sg.title), { sg, reached: 0 });
  if (!mp3TapUpdate()) { mp3Finish(mp3.seg); mp3.seg = null; return; }
  mp3.want.delete(sg);
  clog('info', `🎙 recording “${sg.title}” in the background — it can be downloaded when the song is over`);
  lastSongsKey = '';
}
/** End the current take: keep it if the song got to its last section (and `keep` allows), else drop it. */
function mp3TakeEnd(keep = true) {
  const seg = mp3.seg;
  if (!seg) return;
  mp3.seg = null;
  mp3TapUpdate();
  const sg = seg.sg, whole = keep && seg.reached >= (sg.blocks?.length || 1) - 1;
  lastSongsKey = '';
  if (!whole) { mp3Finish(seg); clog('info', `🎙 “${sg.title}” didn't play to its end — its recording was discarded`); return; }
  mp3Finish(seg, (blob, secs) => {
    if (sg.take) URL.revokeObjectURL(sg.take.url);
    sg.take = { url: URL.createObjectURL(blob), name: mp3Name(sg.title), secs, size: blob.size };
    mp3.takes = mp3.takes.filter((t) => t !== sg).concat(sg);
    while (mp3.takes.length > MP3_MAX_TAKES) { const old = mp3.takes.shift(); URL.revokeObjectURL(old.take.url); delete old.take; }
    clog('ok', `🎙 “${sg.title}” recorded (${fmtTime(secs)}, ${(blob.size / 1e6).toFixed(1)} MB) — ⬇ MP3 in its song view`);
    lastSongsKey = '';
    renderSongs();
  });
}
/** The song view's MP3 button: download the take, or record the song next time it plays from the start. */
function songMp3(sg) {
  if (sg.take) {
    const a = document.createElement('a');
    a.href = sg.take.url;
    a.download = sg.take.name;
    a.click();
    return;
  }
  if (mp3.seg?.sg === sg) return addMsg('info', `🎙 “${sg.title}” is being recorded — ⬇ MP3 appears when it has played to its end`);
  mp3.want.add(sg);
  if (!setl.running) { playSong(sg); return; } // nothing playing: play it now (and record it)
  addMsg('info', `🎙 “${sg.title}” will be recorded the next time it plays from the start — the music keeps playing`);
}

// handy for debugging from the browser console
window.strudelAI = { ws, mixer, mixerChannels, master, masterChain, getBands: () => bands, normalizeSheet, playSong, songMp3, loadPads, songPads, transposeProgression, sectionCode, getForms: () => songForms, getFavorites: () => favorites, loadFavorites, getPads: () => pads, mySongs, activeSong, songFromJSON, songToJSON, mp3, session, pads, padsState, keysState, noteOn, noteOff, setPad, docks, rec, replay, startReplay, recordingForShare, viz, checkScales, checkSounds, prepareCode, evaluateCode, dryRun, hum, transcribe, ensureSliders, setlist, setl };
