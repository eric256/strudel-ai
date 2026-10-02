// Hum → melody: hold the button (or the ` key), hum, release.
// (split out of app.js: start-up code runs in setup(), called from app.js)
import { HumRecorder, freqToMidi, intervalsToSemitones, midiToName, tonicPc, transcribe } from '../hum.js';
import { patternLines } from '../lib/labels.js';
import { $, addMsg, applyMasterGain, applyQuantized, cps, getCode, isPlaying, nowCycle, save, saved, showPanel, state, warnUser } from '../app.js';
import { runTurn, setBusy } from './chat.js';
import { themeAlpha, themeColor } from '../theme.js';
let humBtn;
let SCALE_INTERVALS = null;

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

export const hum = { rec: null, recording: false, frames: [], result: null, duckPrev: null, keyHeld: false };

export function audioCtx() {
  try { return globalThis.getAudioContext?.() || (hum.ownCtx ||= new AudioContext()); }
  catch { return (hum.ownCtx ||= new AudioContext()); }
}
/** Cycle position of what you *hear* right now, minus analysis delay; null when stopped. */
export function audibleCycle(analysisDelay = 0) {
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
  g.strokeStyle = themeColor('line');
  for (let m = Math.ceil(lo); m <= hi; m++) if (m % 12 === 0) { g.beginPath(); g.moveTo(0, y(m)); g.lineTo(w, y(m)); g.stroke(); }
  g.fillStyle = themeColor('accent');
  for (const f of voiced) {
    if (f.t < t0) continue;
    g.fillRect(((f.t - t0) / span) * w, y(freqToMidi(f.freq)) - 1.5, 3, 3);
  }
  const last = frames[frames.length - 1];
  const lvl = last ? Math.min(1, last.rms * 8) : 0;
  g.fillStyle = themeColor('accent-2');
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
    g.strokeStyle = s % grid === 0 ? themeColor('faint') : s % (grid / 4) === 0 ? themeColor('line') : themeColor('panel');
    g.beginPath(); g.moveTo(x(first + s), 0); g.lineTo(x(first + s), h); g.stroke();
  }
  // the raw pitch track, faint
  g.fillStyle = themeAlpha('accent', 0.35);
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
    g.fillStyle = themeColor('accent-2');
    g.fillRect(x0 + 1, y(n.midi) - 4, Math.max(3, x1 - x0 - 2), 8);
    g.fillStyle = themeColor('text');
    g.fillText(n.name, x0 + 2, y(n.midi) - 6);
  }
}

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  fetch('/scale-intervals.json').then((r) => r.json()).then((j) => (SCALE_INTERVALS = j)).catch(() => {});

  // --- wiring: hold the button, or hold the ` key
  humBtn = $('humBtn');
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
}
