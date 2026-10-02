// Docked visualizer: a piano roll of the pattern that is playing (read straight
// from the scheduler, so it also shows what's coming up) plus a spectrum or
// oscilloscope of the master output.
// (split out of app.js: start-up code runs in setup(), called from app.js)
import { $, cps, inDryRun, isPlaying, nowCycle, scheduler, setPatternQuery } from '../app.js';
import { toMidi } from './sound-check.js';
import { themeAlpha, themeColor } from '../theme.js';
export let viz;
let VIZ_MODES;

export function vizColor(name) {
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
  setPatternQuery(true); // errors from this query are the playing code's, already reported
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
    setPatternQuery(false, prevDry);
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
    g.strokeStyle = bar ? themeColor('border') : themeColor('line');
    g.beginPath(); g.moveTo(X(b) + 0.5, y0); g.lineTo(X(b) + 0.5, y0 + h); g.stroke();
    if (bar && isPlaying()) { g.fillStyle = themeColor('faint'); g.font = '10px ui-monospace, monospace'; g.fillText(String(Math.round(b) + 1), X(b) + 3, y0 + 11); }
  }
  const haps = vizHaps().filter((n) => n.e > t0 && n.b < t0 + span);
  if (!haps.length) {
    g.fillStyle = themeColor('faint');
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
    g.fillStyle = k % 2 ? themeColor('sunken') : themeColor('canvas');
    g.fillRect(x0, y, w, laneH);
    for (const n of haps) {
      if (n.name !== name) continue;
      g.globalAlpha = alpha(n);
      g.fillStyle = vizColor(n.s);
      g.fillRect(X(n.b) + 1, y + 1, Math.max(3, Math.min(X(n.e) - X(n.b) - 2, 10)), laneH - 2);
    }
    g.globalAlpha = 0.85;
    g.fillStyle = themeColor('muted');
    g.font = `${Math.min(10, laneH)}px ui-monospace, monospace`;
    g.fillText(name, x0 + 3, y + laneH - 2);
  });
  g.globalAlpha = 1;
  g.strokeStyle = themeColor('warn');
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
const vizLabel = (g, text, x, y) => { g.fillStyle = themeColor('faint'); g.font = '10px ui-monospace, monospace'; g.fillText(text, x + 4, y + 11); };

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
  g.strokeStyle = themeColor('line');
  g.beginPath(); g.moveTo(x0, y0 + h / 2); g.lineTo(x0 + w, y0 + h / 2); g.stroke();
  traceWave(g, viz.wave, zeroCross(viz.wave), x0, y0, w, h, themeColor('accent-2'));
}
function drawStereoScope(g, x0, y0, w, h) {
  if (!vizStereo()) return;
  const s0 = zeroCross(viz.waveL);
  for (const [buf, y, c, name] of [[viz.waveL, y0, themeColor('accent-2'), 'L'], [viz.waveR, y0 + h / 2, themeColor('accent'), 'R']]) {
    g.strokeStyle = themeColor('line');
    g.beginPath(); g.moveTo(x0, y + h / 4); g.lineTo(x0 + w, y + h / 4); g.stroke();
    traceWave(g, buf, s0, x0, y, w, h / 2, c);
    vizLabel(g, name, x0, y);
  }
}
/** Vectorscope: mid (L+R) up, side (L−R) across — mono is a vertical line, wide stereo a cloud. */
function drawVectorscope(g, x0, y0, w, h) {
  if (!vizStereo()) return;
  const r = Math.min(w, h) / 2 - 6, cx = x0 + w / 2, cy = y0 + h / 2;
  g.strokeStyle = themeColor('line');
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.stroke();
  g.fillStyle = themeAlpha('accent-2', 0.55);
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
    sg.fillStyle = themeColor('canvas');
    sg.fillRect(0, 0, W, H);
  }
  const sg = c.getContext('2d');
  const step = Math.max(1, Math.round(2 * dpr));
  sg.drawImage(c, -step, 0);
  for (let k = 0; k < rows; k++) {
    const v = lv[k];
    sg.fillStyle = v < 0.02 ? themeColor('canvas') : `hsl(${260 - v * 220}, 85%, ${8 + v * 55}%)`;
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
  g.strokeStyle = themeColor('text');
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
    grd.addColorStop(0, themeColor('accent-2')); grd.addColorStop(0.75, themeColor('warn')); grd.addColorStop(1, themeColor('danger'));
    g.fillStyle = themeColor('panel');
    g.fillRect(x, y0 + 4, bw, h - 8);
    g.fillStyle = grd;
    g.fillRect(x, y0 + 4 + (h - 8) * (1 - rms), bw, (h - 8) * rms);
    g.fillStyle = themeColor('text');
    g.fillRect(x, y0 + 4 + (h - 8) * (1 - viz.peaks[ch]), bw, 2);
    vizLabel(g, ch ? 'R' : 'L', x + bw / 2 - 8, y0 + h - 16);
  });
  viz.peakT = now;
  g.fillStyle = themeColor('faint');
  g.font = '9px ui-monospace, monospace';
  for (const d of [0, -6, -12, -24, -36, -48]) g.fillText(String(d), x0 + 2, y0 + 8 + (h - 8) * (1 - norm(d)));
}

export function drawViz() {
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

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  viz = { on: false, analyser: null, src: null, haps: [], pat: null, from: null, colors: new Map(), raf: 0, freq: null, wave: null };

  VIZ_MODES = {
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
      g.strokeStyle = themeColor('line');
      for (const x of [sw - 2, rest + 2, rest + vw + 8]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    },
  };
}
