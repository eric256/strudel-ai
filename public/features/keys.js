// 🎹 Keys: an on-screen keyboard (also the computer keyboard and MIDI keyboards)
// that plays a sound live through Strudel's engine. ⏺ Rec captures what you play
// on the bar grid and turns it into a note("…") part.
// (split out of app.js: start-up code runs in setup(), called from app.js)
import { miniStrings } from '../lib/sheet.js';
import { midiToName, polyBarsToMini } from '../hum.js';
import { audibleCycle, audioCtx } from './hum-ui.js';
import { patternLines } from '../lib/labels.js';
import { $, addMsg, applyQuantized, clog, cps, docks, getCode, load, save, setupDock, showPanel, state, warnUser } from '../app.js';
import { runTurn, setBusy } from './chat.js';
import { render, renderOptions } from '../html.js';
import { T, onTemplatesChange } from '../templates/index.js';
export let keysState;

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
  const sounds = list.length ? list : ['triangle'];
  renderOptions(sel, [{ value: '__custom', label: '✎ custom Strudel line…' }, ...sounds.map((k) => ({ value: k, label: k }))],
    want === '__custom' || sounds.includes(want) ? want : sounds[0]);
  showKeysTemplate();
}
function showKeysTemplate() {
  const custom = $('keysSound').value === '__custom';
  $('keysTemplate').hidden = !custom;
  if (custom && !$('keysTemplate').value) $('keysTemplate').value = load().keysTemplate || 'note({note}).s("sawtooth").lpf(1600).decay(0.25).sustain(0.3).room(0.2)';
}

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
  const blacks = whites.map((m, i) => [m + 1, i]).filter(([b]) => b <= lo + 24 && isBlack(b));
  render(T.keyboard({
    whites: whites.map((m, i) => ({ m, left: i * w, width: w, name: m % 12 === 0 ? midiToName(m) : '' })),
    blacks: blacks.map(([m, i]) => ({ m, left: (i + 0.68) * w, width: w * 0.64 })),
  }), $('keysBoard'));
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
export function ensureAudio() {
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
export function noteOn(midi, vel = 0.8, src = 'ui') {
  if (keysState.held.has(midi)) return;
  keysState.held.set(midi, { c0: keysState.rec ? keysCycle() : null, src });
  keysPlay(midi, vel);
  $('keysBoard').querySelector(`.key[data-m="${midi}"]`)?.classList.add('down');
}
export function noteOff(midi) {
  const h = keysState.held.get(midi);
  if (!h) return;
  keysState.held.delete(midi);
  $('keysBoard').querySelector(`.key[data-m="${midi}"]`)?.classList.remove('down');
  if (keysState.rec && h.c0 != null) keysState.rec.notes.push({ midi, c0: h.c0, c1: Math.max(keysCycle(), h.c0 + 0.01) });
  renderKeysInfo();
}

// pointer: press, slide across keys, release
let keysPointer = null;

// computer keyboard (only while the keys are shown and you're not typing somewhere)
const typingTarget = (e) => e.target.closest?.('input, textarea, select, .cm-editor, [contenteditable="true"]');
function setKeysOct(o) {
  keysState.oct = Math.max(1, Math.min(7, o));
  save({ keysOct: keysState.oct });
  renderKeyboard();
}

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

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  onTemplatesChange(() => renderKeyboard());
  keysState = { oct: Number(load().keysOct) || 4, rec: null, held: new Map(), kbd: new Map(), midiInputs: [], result: null };
  $('keysSound').onchange = () => { save({ keysSound: $('keysSound').value }); showKeysTemplate(); keysCompiled = null; };
  $('keysTemplate').oninput = () => { save({ keysTemplate: $('keysTemplate').value }); keysCompiled = null; };
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
  $('keysDown').onclick = () => setKeysOct(keysState.oct - 1);
  $('keysUp').onclick = () => setKeysOct(keysState.oct + 1);
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
}
