// Hum → melody: microphone capture, YIN pitch detection, note segmentation,
// quantization to the music's grid and conversion to Strudel mini-notation.
// Pure functions (yin, transcribe, toMini, …) have no DOM dependencies and can be unit-tested in Node.

// ---------------------------------------------------------------------------
// Pitch detection (YIN, de Cheveigné & Kawahara 2002)
// ---------------------------------------------------------------------------
export function yin(buf, sampleRate, { minFreq = 70, maxFreq = 1100, threshold = 0.15 } = {}) {
  const W = Math.floor(buf.length / 2);
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  const maxTau = Math.min(W - 1, Math.ceil(sampleRate / minFreq));
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < W; i++) {
      const x = buf[i] - buf[i + tau];
      sum += x * x;
    }
    d[tau] = sum;
  }
  // cumulative mean normalized difference
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= maxTau && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return { freq: null, confidence: 0 };
  // parabolic interpolation
  let better = tau;
  if (tau > 1 && tau < maxTau) {
    const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
    const denom = a + c - 2 * b;
    if (denom !== 0) better = tau + (a - c) / (2 * denom);
  }
  return { freq: sampleRate / better, confidence: 1 - cmnd[tau] };
}

export const rms = (buf) => {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
};
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);

const NAMES = ['c', 'c#', 'd', 'eb', 'e', 'f', 'f#', 'g', 'ab', 'a', 'bb', 'b'];
export const midiToName = (m) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

// ---------------------------------------------------------------------------
// Scales (for optional "snap to key")
// ---------------------------------------------------------------------------
const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
export function tonicPc(t) {
  const m = String(t).trim().match(/^([a-gA-G])([#sbf]*)/);
  if (!m) return null;
  const acc = [...m[2]].reduce((a, ch) => a + (ch === '#' || ch === 's' ? 1 : -1), 0);
  return (((PC[m[1].toLowerCase()] + acc) % 12) + 12) % 12;
}
/** "1P 2M 3m 4P 5P 6m 7m" → [0,2,3,5,7,8,10] */
export function intervalsToSemitones(str) {
  const base = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
  return str.split(/\s+/).filter(Boolean).map((iv) => {
    const m = iv.match(/^(\d+)([PMmAd]+)$/);
    if (!m) return null;
    const deg = ((Number(m[1]) - 1) % 7) + 1;
    const perfect = deg === 1 || deg === 4 || deg === 5;
    let st = base[deg];
    for (const q of m[2]) {
      if (q === 'A') st += 1;
      else if (q === 'm') st -= 1;
      else if (q === 'd') st -= perfect ? 1 : 2;
    }
    return ((st % 12) + 12) % 12;
  }).filter((x) => x !== null);
}
export function snapToSet(midi, pcs) {
  if (!pcs || !pcs.length) return Math.round(midi);
  let best = Math.round(midi), bestD = 99;
  for (let m = Math.floor(midi) - 2; m <= Math.ceil(midi) + 2; m++) {
    if (!pcs.includes(((m % 12) + 12) % 12)) continue;
    const d = Math.abs(m - midi);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Transcription: frames → notes → quantized bars → mini-notation
// frame = { t: seconds since start, c: cycle position (or null), freq, confidence, rms }
// ---------------------------------------------------------------------------
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

export function transcribe(frames, {
  cps = 0.5,          // cycles per second (1 cycle = 1 bar)
  grid = 16,          // steps per bar
  pcs = null,         // pitch classes to snap to (null = chromatic)
  maxBars = 8,
  minNoteSec = 0.07,
} = {}) {
  if (!frames.length) return { notes: [], bars: 0, mini: '', startBar: 0 };
  // time base: cycles if known, otherwise seconds × cps from the start
  const pos = frames.map((f) => (f.c ?? f.t * cps));
  const maxRms = Math.max(...frames.map((f) => f.rms));
  const gate = Math.max(0.006, maxRms * 0.12);

  // voiced pitch track (midi), with octave-jump repair and median smoothing
  const raw = frames.map((f) => (f.freq && f.confidence > 0.75 && f.rms > gate ? freqToMidi(f.freq) : null));
  for (let i = 1; i < raw.length; i++) {
    if (raw[i] == null || raw[i - 1] == null) continue;
    const diff = raw[i] - raw[i - 1];
    if (Math.abs(Math.abs(diff) - 12) < 1.2) raw[i] -= Math.sign(diff) * 12; // octave error
  }
  const pitch = raw.map((p, i) => {
    if (p == null) return null;
    const win = raw.slice(Math.max(0, i - 2), i + 3).filter((x) => x != null);
    return median(win);
  });

  // segmentation: voiced runs, split on pitch changes and on volume dips (re-articulation)
  const notes = [];
  let cur = null;
  let localPeak = 0;
  const close = (endIdx) => {
    if (!cur) return;
    const ps = cur.pitches.slice(Math.floor(cur.pitches.length * 0.2)); // skip attack scoop
    const start = pos[cur.startIdx];
    const end = pos[endIdx];
    const secs = (end - start) / cps;
    if (secs >= minNoteSec && ps.length) notes.push({ start, end, midiRaw: median(ps) });
    cur = null;
  };
  let deviating = 0;
  for (let i = 0; i < frames.length; i++) {
    const p = pitch[i];
    localPeak = Math.max(frames[i].rms, localPeak * 0.97);
    const dip = frames[i].rms < localPeak * 0.35;
    if (p == null || dip) { close(i); deviating = 0; continue; }
    if (!cur) { cur = { startIdx: i, pitches: [p] }; continue; }
    const ref = median(cur.pitches.slice(-8));
    if (Math.abs(p - ref) > 0.8) {
      deviating++;
      if (deviating >= 3) {
        close(i - 2);
        cur = { startIdx: i - 2, pitches: pitch.slice(i - 2, i + 1).filter((x) => x != null) };
        deviating = 0;
      }
    } else {
      deviating = 0;
      cur.pitches.push(p);
    }
  }
  close(frames.length - 1);
  if (!notes.length) return { notes: [], bars: 0, mini: '', startBar: 0 };

  // pitch → semitone (optionally snapped to key)
  for (const n of notes) n.midi = snapToSet(n.midiRaw, pcs);

  // quantize to grid
  let q = notes.map((n) => {
    const s = Math.round(n.start * grid);
    const e = Math.max(s + 1, Math.round(n.end * grid));
    return { s, e, midi: n.midi };
  });
  q.sort((a, b) => a.s - b.s);
  const merged = [];
  for (const n of q) {
    const prev = merged[merged.length - 1];
    if (prev && n.s <= prev.s) {
      // same start step: keep the longer one
      if (n.e - n.s > prev.e - prev.s) merged[merged.length - 1] = n;
      continue;
    }
    if (prev && prev.e > n.s) prev.e = n.s; // truncate overlap
    merged.push(n);
  }
  q = merged;

  // no music playing → there is no beat to align to: start the phrase on the downbeat
  if (frames.every((f) => f.c == null)) {
    const shift = q[0].s;
    for (const n of q) { n.s -= shift; n.e -= shift; }
  }

  const startBar = Math.floor(q[0].s / grid);
  // the bar count is decided by where the last note *starts*; a final note that
  // spills over the bar line is cut at the line instead of adding an almost-empty bar
  let lastBar = Math.floor(q[q.length - 1].s / grid);
  const lastNote = q[q.length - 1];
  if (lastNote.e > (lastBar + 1) * grid) lastNote.e = (lastBar + 1) * grid;
  let bars = lastBar - startBar + 1;
  if (bars > maxBars) { bars = maxBars; lastBar = startBar + bars - 1; }
  if (bars === 3) bars = 4;
  if (bars > 4 && bars < 8) bars = 8;

  // split into bars (notes crossing a bar line are cut at the line)
  const barSteps = [];
  for (let b = 0; b < bars; b++) {
    const b0 = (startBar + b) * grid, b1 = b0 + grid;
    const inBar = q
      .filter((n) => n.s < b1 && n.e > b0)
      .map((n) => ({ s: Math.max(n.s, b0) - b0, e: Math.min(n.e, b1) - b0, midi: n.midi }));
    barSteps.push(inBar);
  }
  // keep the phrase aligned to the song: bar k of the recording plays on cycles ≡ startBar+k (mod bars)
  const ordered = new Array(bars);
  for (let b = 0; b < bars; b++) ordered[(startBar + b) % bars] = barSteps[b];

  const outNotes = q
    .filter((n) => Math.floor(n.s / grid) <= lastBar)
    .map((n) => ({ start: n.s / grid, dur: (n.e - n.s) / grid, midi: n.midi, name: midiToName(n.midi) }));
  return { notes: outNotes, bars, startBar, grid, mini: barsToMini(ordered, grid), raw: notes };
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** One bar's notes (steps) → "[c4@2 ~ e4 …]" with weights reduced by their gcd. */
export function barToMini(notes, grid) {
  const items = [];
  let t = 0;
  for (const n of [...notes].sort((a, b) => a.s - b.s)) {
    if (n.s > t) items.push({ tok: '~', w: n.s - t });
    items.push({ tok: midiToName(n.midi), w: n.e - n.s });
    t = n.e;
  }
  if (t < grid) items.push({ tok: '~', w: grid - t });
  if (!items.some((it) => it.tok !== '~')) return '~';
  const g = items.reduce((a, it) => gcd(a, it.w), 0) || 1;
  // merge consecutive rests
  const merged = [];
  for (const it of items) {
    const last = merged[merged.length - 1];
    if (last && last.tok === '~' && it.tok === '~') last.w += it.w;
    else merged.push({ ...it });
  }
  return merged.map((it) => (it.w / g === 1 ? it.tok : `${it.tok}@${it.w / g}`)).join(' ');
}

export function barsToMini(bars, grid) {
  const parts = bars.map((b) => barToMini(b || [], grid));
  if (parts.length === 1) return parts[0];
  return '<' + parts.map((p) => (p === '~' ? '~' : `[${p}]`)).join(' ') + '>';
}

/**
 * Polyphonic bar → mini-notation: notes starting together become a chord "[c4,e4,g4]".
 * notes: [{ s, e, midi }] in grid steps within the bar (0 … grid). Each onset lasts until the
 * chord's longest note ends or the next onset, whichever comes first.
 */
export function polyBarToMini(notes, grid) {
  const groups = new Map();
  for (const n of notes) {
    const s = Math.max(0, Math.min(grid - 1, Math.round(n.s)));
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push({ ...n, s });
  }
  const starts = [...groups.keys()].sort((a, b) => a - b);
  const items = [];
  let t = 0;
  starts.forEach((s, k) => {
    const chord = groups.get(s);
    const next = k + 1 < starts.length ? starts[k + 1] : grid;
    const end = Math.max(s + 1, Math.min(next, Math.max(...chord.map((n) => Math.round(n.e)))));
    if (s > t) items.push({ tok: '~', w: s - t });
    const names = [...new Set(chord.sort((a, b) => a.midi - b.midi).map((n) => midiToName(n.midi)))];
    items.push({ tok: names.length > 1 ? `[${names.join(',')}]` : names[0], w: end - s });
    t = end;
  });
  if (t < grid) items.push({ tok: '~', w: grid - t });
  if (!items.some((it) => it.tok !== '~')) return '~';
  const merged = [];
  for (const it of items) {
    const last = merged[merged.length - 1];
    if (last && last.tok === '~' && it.tok === '~') last.w += it.w;
    else merged.push({ ...it });
  }
  const g = merged.reduce((a, it) => gcd(a, it.w), 0) || 1;
  return merged.map((it) => (it.w / g === 1 ? it.tok : `${it.tok}@${it.w / g}`)).join(' ');
}

export function polyBarsToMini(bars, grid) {
  const parts = bars.map((b) => polyBarToMini(b || [], grid));
  if (parts.length === 1) return parts[0];
  return '<' + parts.map((p) => (p === '~' ? '~' : `[${p}]`)).join(' ') + '>';
}

// ---------------------------------------------------------------------------
// Microphone recorder (browser only)
// ---------------------------------------------------------------------------
export class HumRecorder {
  constructor({ getContext, getCycle, onFrame } = {}) {
    this.getContext = getContext; // () => AudioContext
    this.getCycle = getCycle;     // () => current *audible* cycle position or null
    this.onFrame = onFrame;
    this.stream = null;
  }

  async init() {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone needs a secure page (https:// or http://localhost).');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
  }

  async start() {
    await this.init();
    const ctx = this.getContext();
    if (ctx.state !== 'running') await ctx.resume();
    this.ctx = ctx;
    this.source = ctx.createMediaStreamSource(this.stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.source.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.frames = [];
    this.t0 = performance.now();
    // the analysed window is centred ~half a window in the past, plus mic input latency
    this.analysisDelay = this.analyser.fftSize / 2 / ctx.sampleRate + 0.02;
    this.timer = setInterval(() => this.tick(), 12);
  }

  tick() {
    this.analyser.getFloatTimeDomainData(this.buf);
    const level = rms(this.buf);
    const { freq, confidence } = level > 0.004 ? yin(this.buf, this.ctx.sampleRate) : { freq: null, confidence: 0 };
    const t = (performance.now() - this.t0) / 1000 - this.analysisDelay;
    const cyc = this.getCycle?.(this.analysisDelay);
    const frame = { t, c: cyc, freq, confidence, rms: level };
    this.frames.push(frame);
    this.onFrame?.(frame);
  }

  stop() {
    clearInterval(this.timer);
    try { this.source?.disconnect(); } catch {}
    return this.frames || [];
  }

  release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
