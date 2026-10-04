// ---------------------------------------------------------------------------
// Master style: a mastering chain on the whole mix, between Strudel's output merger and the master volume.
//
//   mix → EQ (low shelf 120 Hz · mid peak 1 kHz · high shelf 6 kHz) → DJ filter (low-pass ← 0 → high-pass)
//       → drive (tape-style saturation) → crush (bit reduction) → [dry + reverb send + echo send] → glue compressor
//       → makeup → limiter → out                                           vinyl noise ─┘
//
// A STYLE (lo-fi, techno, ambient …) is a set of these settings. Songs carry a style ("master" in the song sheet)
// and optionally their own tweaks; the 🎛 Master panel moves every control live, like a mixer.
// ---------------------------------------------------------------------------
import { EQ_BANDS, normEq } from './lib/eq.js';

/** Every control: key, label, range, default, unit, the panel's group. */
export const MASTER_PARAMS = [
  { key: 'low', label: 'Low', min: -12, max: 12, step: 0.5, def: 0, unit: 'dB', group: 'EQ', title: 'Low shelf at 120 Hz' },
  { key: 'mid', label: 'Mid', min: -12, max: 12, step: 0.5, def: 0, unit: 'dB', group: 'EQ', title: 'Mid peak at 1 kHz' },
  { key: 'high', label: 'High', min: -12, max: 12, step: 0.5, def: 0, unit: 'dB', group: 'EQ', title: 'High shelf at 6 kHz' },
  { key: 'filter', label: 'Filter', min: -1, max: 1, step: 0.01, def: 0, unit: '', group: 'Filter', title: 'DJ filter: left closes a low-pass, right opens a high-pass' },
  { key: 'reso', label: 'Reso', min: 0, max: 1, step: 0.01, def: 0.2, unit: '', group: 'Filter', title: 'Filter resonance' },
  { key: 'drive', label: 'Drive', min: 0, max: 1, step: 0.01, def: 0, unit: '', group: 'Color', title: 'Tape-style saturation' },
  { key: 'crush', label: 'Crush', min: 0, max: 1, step: 0.01, def: 0, unit: '', group: 'Color', title: 'Bit reduction (12 bits → 3 bits)' },
  { key: 'vinyl', label: 'Vinyl', min: 0, max: 1, step: 0.01, def: 0, unit: '', group: 'Color', title: 'Record hiss and crackle (only while playing)' },
  { key: 'space', label: 'Space', min: 0, max: 1, step: 0.01, def: 0, unit: '', group: 'Space', title: 'Reverb on the whole mix' },
  { key: 'size', label: 'Size', min: 0, max: 1, step: 0.01, def: 0.4, unit: '', group: 'Space', title: 'Reverb size (0.5 s … 7 s)' },
  { key: 'echo', label: 'Echo', min: 0, max: 1, step: 0.01, def: 0, unit: '', group: 'Echo', title: 'Tempo-synced echo on the whole mix' },
  { key: 'time', label: 'Time', min: 0.0625, max: 0.5, step: 0.0625, def: 0.1875, unit: 'bar', group: 'Echo', title: 'Echo time in bars (1/16 … 1/2, synced to the tempo)' },
  { key: 'feedback', label: 'Fdbk', min: 0, max: 0.9, step: 0.01, def: 0.35, unit: '', group: 'Echo', title: 'Echo repeats' },
  { key: 'glue', label: 'Glue', min: 0, max: 1, step: 0.01, def: 0.25, unit: '', group: 'Dynamics', title: 'Bus compression that glues the mix together (with automatic makeup gain)' },
  { key: 'width', label: 'Width', min: 0, max: 2, step: 0.01, def: 1, unit: '', group: 'Dynamics', title: 'Stereo width: 0 mono · 1 as mixed · 2 extra wide' },
  { key: 'loud', label: 'Out', min: -12, max: 6, step: 0.5, def: 0, unit: 'dB', group: 'Output', title: 'Output level into the limiter (−1 dB ceiling)' },
];
export const MASTER_DEFAULTS = Object.fromEntries(MASTER_PARAMS.map((p) => [p.key, p.def]));

/**
 * The master as a chain of nodes, in signal order: each a group of controls (the 🎚 Equalizer's 7 bands come first,
 * in their own panel). A node switched off passes the sound through: its controls are sent at their neutral values.
 */
export const MASTER_NODES = [
  { group: 'EQ', name: 'Tone', icon: '🎛', title: 'The style\'s tone: low shelf, mid peak, high shelf' },
  { group: 'Filter', name: 'Filter', icon: '〰', title: 'A DJ filter on the whole mix' },
  { group: 'Color', name: 'Colour', icon: '🔥', title: 'Saturation, bit crush and vinyl' },
  { group: 'Space', name: 'Space', icon: '🌫', title: 'Reverb on the whole mix' },
  { group: 'Echo', name: 'Echo', icon: '🔁', title: 'Tempo-synced echo' },
  { group: 'Dynamics', name: 'Dynamics', icon: '🗜', title: 'Glue compression and stereo width' },
  { group: 'Output', name: 'Output', icon: '🔊', title: 'Level into the limiter (−1 dB ceiling), and what comes out' },
];
/** A node's controls when it's off: no change to the sound. */
const NEUTRAL = { ...MASTER_DEFAULTS, glue: 0 };
/** The settings the chain gets: yours, with the nodes that are off at their neutral values. */
export function effectiveParams(params, off = []) {
  const out = { ...params };
  for (const d of MASTER_PARAMS) if (off.includes(d.group) && d.key !== 'size' && d.key !== 'time' && d.key !== 'reso' && d.key !== 'feedback') out[d.key] = NEUTRAL[d.key];
  return out;
}

/** The styles: what each is for, and its settings (anything not given is the default). */
export const MASTER_STYLES = {
  clean: { desc: 'transparent: light glue, nothing else — any genre', p: {} },
  'lo-fi': { desc: 'lo-fi hip hop, chillhop, jazz-hop: dusty, warm, rolled-off highs, vinyl crackle', p: { low: 2, high: -5, filter: -0.18, drive: 0.3, crush: 0.25, vinyl: 0.45, space: 0.18, size: 0.35, glue: 0.5, width: 0.85 } },
  warm: { desc: 'jazz, soul, neo-soul, bossa nova: round, soft, a little tape', p: { low: 1.5, mid: -1, high: -1.5, drive: 0.15, space: 0.15, size: 0.45, glue: 0.35 } },
  acoustic: { desc: 'acoustic, folk, unplugged, singer-songwriter, bluegrass, celtic: natural and open — a wooden room, gentle compression, no colour', p: { low: 0.5, mid: 0.5, high: 1, space: 0.2, size: 0.4, glue: 0.25, width: 1.15 } },
  pop: { desc: 'pop, synth-pop, city pop, funk, disco: bright, polished, loud', p: { low: 1.5, mid: -0.5, high: 3, space: 0.1, size: 0.35, glue: 0.55, width: 1.2, loud: 2 } },
  techno: { desc: 'techno, minimal, industrial, acid: punchy low end, tight, driven', p: { low: 3, mid: -1.5, high: 1, drive: 0.25, space: 0.08, size: 0.3, glue: 0.65, width: 1.05, loud: 2.5 } },
  house: { desc: 'house, deep house, tech house, nu-disco: warm low end, smooth top, pumping glue', p: { low: 2.5, mid: -1, high: 1.5, drive: 0.12, space: 0.1, size: 0.35, glue: 0.6, width: 1.15, loud: 2 } },
  edm: { desc: 'EDM, big room, trance, future bass: huge, wide, bright and loud', p: { low: 3, mid: -1, high: 3.5, drive: 0.15, space: 0.16, size: 0.55, glue: 0.7, width: 1.4, loud: 3 } },
  dnb: { desc: 'drum & bass, jungle, breakbeat: hard low end, crisp top, tight', p: { low: 3.5, mid: -1, high: 2.5, drive: 0.2, space: 0.08, size: 0.3, glue: 0.65, width: 1.15, loud: 2.5 } },
  hiphop: { desc: 'hip hop, trap, boom bap, R&B: heavy low end, slightly dark, punchy', p: { low: 4, mid: -1, high: 0.5, drive: 0.18, space: 0.06, size: 0.3, glue: 0.6, loud: 2 } },
  synthwave: { desc: 'synthwave, retrowave, 80s pop, Italo: wide, shiny, big gated-style space and echo', p: { low: 1.5, high: 2.5, drive: 0.12, space: 0.28, size: 0.55, echo: 0.14, time: 0.1875, feedback: 0.35, glue: 0.5, width: 1.35, loud: 1.5 } },
  ambient: { desc: 'ambient, drone, new age, soundscapes, meditation: vast reverb, long echoes, soft and wide', p: { low: 0.5, high: -1, space: 0.55, size: 0.9, echo: 0.2, time: 0.375, feedback: 0.5, glue: 0.2, width: 1.5, loud: -1 } },
  dub: { desc: 'dub, reggae, dub techno: deep bass, dark top, heavy tape echo', p: { low: 4, mid: -1.5, high: -2.5, filter: -0.08, drive: 0.15, space: 0.2, size: 0.5, echo: 0.32, time: 0.1875, feedback: 0.6, glue: 0.45, width: 1.2 } },
  cinematic: { desc: 'cinematic, orchestral, epic, post-rock: big hall, wide, dynamic (light compression)', p: { low: 1.5, high: 1, space: 0.38, size: 0.85, glue: 0.18, width: 1.35 } },
  rock: { desc: 'rock, indie, punk, metal: mid-forward, saturated, compact room', p: { low: 1.5, mid: 1.5, high: 1, drive: 0.35, space: 0.12, size: 0.3, glue: 0.6, width: 1.1, loud: 2 } },
  chiptune: { desc: 'chiptune, 8-bit, video game: crunchy, narrow, bright', p: { high: 1.5, crush: 0.5, glue: 0.4, width: 0.6, loud: 1 } },
  radio: { desc: 'an old radio: narrow band, distorted, mono — for effect', p: { low: -10, high: -8, mid: 4, filter: 0.25, drive: 0.5, crush: 0.2, vinyl: 0.25, glue: 0.7, width: 0, loud: 1 } },
};
export const STYLE_NAMES = Object.keys(MASTER_STYLES);

/** A style's full settings (with the song's own tweaks on top). Unknown style → clean. */
export function styleParams(style, tweaks = null) {
  const s = MASTER_STYLES[normStyle(style)] || MASTER_STYLES.clean;
  return clampParams({ ...MASTER_DEFAULTS, ...s.p, ...(tweaks || {}) });
}
/** "Lo-Fi", "lofi", "lo fi hip hop" → "lo-fi"; unknown → "" */
export function normStyle(name) {
  const n = String(name || '').toLowerCase().trim();
  if (!n) return '';
  if (MASTER_STYLES[n]) return n;
  const flat = (x) => x.replace(/[^a-z0-9]/g, '');
  const f = flat(n);
  const hit = STYLE_NAMES.find((s) => flat(s) === f) || STYLE_NAMES.find((s) => f.startsWith(flat(s)) || flat(s).startsWith(f));
  if (hit) return hit;
  // by genre: the first style whose description names it
  if (n.length < 3) return '';
  return STYLE_NAMES.find((s) => MASTER_STYLES[s].desc.toLowerCase().split(/[:,]/)[0].includes(n)) || '';
}
export function clampParams(p) {
  const out = {};
  for (const d of MASTER_PARAMS) {
    const v = Number(p?.[d.key]);
    out[d.key] = Number.isFinite(v) ? Math.max(d.min, Math.min(d.max, v)) : d.def;
  }
  return out;
}
/** Only the settings that differ from a style (what a song stores as its own tweaks). */
export function diffParams(params, style) {
  const base = styleParams(style);
  const out = {};
  for (const d of MASTER_PARAMS) if (Math.abs((params[d.key] ?? d.def) - base[d.key]) > d.step / 2) out[d.key] = params[d.key];
  return out;
}
/** The styles for an AI prompt: one line each. */
export const stylesForPrompt = () => STYLE_NAMES.map((s) => `- "${s}": ${MASTER_STYLES[s].desc}`).join('\n');

// --- the audio chain -------------------------------------------------------
const dB = (v) => Math.pow(10, v / 20);

function driveCurve(amount) {
  const k = 1 + amount * 14, n = 2048, c = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
  return c;
}
function crushCurve(amount) {
  const bits = 12 - amount * 9, steps = Math.pow(2, bits) / 2, n = 8192, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.round(x * steps) / steps; }
  return c;
}
function impulse(ac, seconds) {
  const len = Math.max(1, Math.round(ac.sampleRate * seconds)), buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3) * (i < ac.sampleRate * 0.012 ? i / (ac.sampleRate * 0.012) : 1);
    }
  }
  return buf;
}
function vinylBuffer(ac) {
  const len = ac.sampleRate * 4, buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b = 0;
    for (let i = 0; i < len; i++) {
      b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); // soft hiss
      let v = b * 0.35;
      if (Math.random() < 0.00018) v += (Math.random() * 2 - 1) * 0.9; // crackle
      d[i] = v;
    }
  }
  return buf;
}

/**
 * Build the chain in an AudioContext. Returns { input, output, set(params, ramp), params, setTempo(cps),
 * setRunning(bool), analyser, reduction() }.
 */
export function createMaster(ac) {
  const node = (Ctor, o) => new Ctor(ac, o);
  const input = node(GainNode, { gain: 1 });
  // the 🎚 Equalizer's 7 bands come first (your EQ), then the style's tone controls
  const geq = EQ_BANDS.map((b) => node(BiquadFilterNode, { type: b.type, frequency: b.f, Q: b.q || 0.7, gain: 0 }));
  input.connect(geq[0]);
  for (let i = 1; i < geq.length; i++) geq[i - 1].connect(geq[i]);
  const low = node(BiquadFilterNode, { type: 'lowshelf', frequency: 120 });
  const mid = node(BiquadFilterNode, { type: 'peaking', frequency: 1000, Q: 0.7 });
  const high = node(BiquadFilterNode, { type: 'highshelf', frequency: 6000 });
  const lp = node(BiquadFilterNode, { type: 'lowpass', frequency: 20000, Q: 0.7 });
  const hp = node(BiquadFilterNode, { type: 'highpass', frequency: 10, Q: 0.7 });
  geq[geq.length - 1].connect(low); low.connect(mid); mid.connect(high); high.connect(lp); lp.connect(hp);
  // drive and crush: wet / dry pairs
  const driveDry = node(GainNode, { gain: 1 }), driveWet = node(GainNode, { gain: 0 });
  const shaper = node(WaveShaperNode, { oversample: '2x' });
  const afterDrive = node(GainNode, { gain: 1 });
  hp.connect(driveDry); hp.connect(shaper); shaper.connect(driveWet);
  driveDry.connect(afterDrive); driveWet.connect(afterDrive);
  const crushDry = node(GainNode, { gain: 1 }), crushWet = node(GainNode, { gain: 0 });
  const crusher = node(WaveShaperNode, {});
  const color = node(GainNode, { gain: 1 });
  afterDrive.connect(crushDry); afterDrive.connect(crusher); crusher.connect(crushWet);
  crushDry.connect(color); crushWet.connect(color);
  // sends: reverb and echo
  const bus = node(GainNode, { gain: 1 });
  color.connect(bus);
  const verb = node(ConvolverNode, { normalize: true });
  const verbSend = node(GainNode, { gain: 0 });
  const verbTone = node(BiquadFilterNode, { type: 'highpass', frequency: 180 });
  color.connect(verbSend); verbSend.connect(verbTone); verbTone.connect(verb); verb.connect(bus);
  const delay = node(DelayNode, { maxDelayTime: 4, delayTime: 0.3 });
  const fb = node(GainNode, { gain: 0.35 });
  const echoSend = node(GainNode, { gain: 0 });
  const echoTone = node(BiquadFilterNode, { type: 'bandpass', frequency: 1800, Q: 0.5 });
  color.connect(echoSend); echoSend.connect(delay); delay.connect(echoTone); echoTone.connect(fb); fb.connect(delay); echoTone.connect(bus);
  // vinyl noise (started on first use, gated while stopped)
  const vinylGain = node(GainNode, { gain: 0 });
  vinylGain.connect(bus);
  let vinylSrc = null;
  // stereo width (mid / side): L' = M + w·S, R' = M − w·S
  const split = node(ChannelSplitterNode, { numberOfOutputs: 2 });
  const merge = node(ChannelMergerNode, { numberOfInputs: 2 });
  const mL = node(GainNode, { gain: 0.5 }), mR = node(GainNode, { gain: 0.5 });
  const sL = node(GainNode, { gain: 0.5 }), sR = node(GainNode, { gain: -0.5 });
  const sideL = node(GainNode, { gain: 1 }), sideR = node(GainNode, { gain: -1 });
  const mSum = node(GainNode, { gain: 1 }), sSum = node(GainNode, { gain: 1 });
  bus.connect(split);
  split.connect(mL, 0); split.connect(mR, 1); split.connect(sL, 0); split.connect(sR, 1);
  mL.connect(mSum); mR.connect(mSum); sL.connect(sSum); sR.connect(sSum);
  mSum.connect(merge, 0, 0); mSum.connect(merge, 0, 1);
  sSum.connect(sideL); sSum.connect(sideR); sideL.connect(merge, 0, 0); sideR.connect(merge, 0, 1);
  // dynamics: glue → makeup → out level → limiter
  const glue = node(DynamicsCompressorNode, { threshold: -10, ratio: 2, attack: 0.02, release: 0.25, knee: 8 });
  const makeup = node(GainNode, { gain: 1 });
  const loud = node(GainNode, { gain: 1 });
  const limiter = node(DynamicsCompressorNode, { threshold: -1, ratio: 20, attack: 0.002, release: 0.1, knee: 0 });
  const output = node(GainNode, { gain: 1 });
  merge.connect(glue); glue.connect(makeup); makeup.connect(loud); loud.connect(limiter); limiter.connect(output);
  const analyser = node(AnalyserNode, { fftSize: 2048, smoothingTimeConstant: 0.7 });
  output.connect(analyser);

  let params = { ...MASTER_DEFAULTS }, cps = 0.5, running = false, sizeShown = -1, driveShown = -1, crushShown = -1;
  const to = (param, v, ramp) => { const t = ac.currentTime; try { param.cancelScheduledValues(t); param.setTargetAtTime(v, t, ramp); } catch { param.value = v; } };
  function apply(ramp = 0.03) {
    const p = params;
    to(low.gain, p.low, ramp); to(mid.gain, p.mid, ramp); to(high.gain, p.high, ramp);
    // DJ filter: low-pass 20 kHz → 150 Hz on the left, high-pass 10 Hz → 6 kHz on the right
    const f = p.filter, q = 0.7 + p.reso * 9;
    to(lp.frequency, f < 0 ? 20000 * Math.pow(150 / 20000, -f) : 20000, ramp);
    to(hp.frequency, f > 0 ? 10 * Math.pow(600, f) : 10, ramp);
    to(lp.Q, f < -0.02 ? q : 0.7, ramp); to(hp.Q, f > 0.02 ? q : 0.7, ramp);
    if (Math.abs(p.drive - driveShown) > 0.02) { shaper.curve = driveCurve(p.drive); driveShown = p.drive; }
    to(driveWet.gain, p.drive * (1 - p.drive * 0.35), ramp); to(driveDry.gain, 1 - p.drive, ramp);
    if (Math.abs(p.crush - crushShown) > 0.02) { crusher.curve = crushCurve(p.crush); crushShown = p.crush; }
    const cw = Math.min(1, p.crush * 3);
    to(crushWet.gain, cw, ramp); to(crushDry.gain, 1 - cw, ramp);
    if (p.space > 0 && Math.abs(p.size - sizeShown) > 0.03) { verb.buffer = impulse(ac, 0.5 + p.size * 6.5); sizeShown = p.size; }
    to(verbSend.gain, p.space * 1.2, ramp);
    to(echoSend.gain, p.echo * 0.8, ramp);
    to(fb.gain, p.feedback, ramp);
    to(delay.delayTime, Math.min(4, p.time / Math.max(0.05, cps)), Math.max(ramp, 0.08));
    if (p.vinyl > 0 && !vinylSrc) {
      vinylSrc = node(AudioBufferSourceNode, { buffer: vinylBuffer(ac), loop: true });
      vinylSrc.connect(vinylGain);
      vinylSrc.start();
    }
    to(vinylGain.gain, running ? p.vinyl * 0.12 : 0, ramp);
    to(sideL.gain, p.width, ramp); to(sideR.gain, -p.width, ramp);
    // glue: more amount → lower threshold, higher ratio; makeup gives back about half of what it takes
    to(glue.threshold, -4 - p.glue * 26, ramp);
    to(glue.ratio, 1 + p.glue * 5, ramp);
    to(makeup.gain, dB(p.glue * 7), ramp);
    to(loud.gain, dB(p.loud), ramp);
  }
  apply(0);
  return {
    input, output, analyser,
    get params() { return { ...params }; },
    /** Set some or all controls; ramp = seconds to glide there. */
    set(next, ramp = 0.03) { params = clampParams({ ...params, ...next }); apply(ramp); },
    /** The 🎚 Equalizer's band gains (dB, low → high). */
    setEq(gains, ramp = 0.03) { const g = normEq(gains); geq.forEach((n, i) => to(n.gain, g[i], ramp)); },
    eqNodes: geq,
    setTempo(c) { if (c > 0 && Math.abs(c - cps) > 1e-4) { cps = c; apply(0.1); } },
    setRunning(r) { if (r !== running) { running = r; to(vinylGain.gain, r ? params.vinyl * 0.12 : 0, 0.05); } },
    /** Gain reduction of the glue compressor and the limiter, in dB (≤ 0). */
    reduction: () => ({ glue: glue.reduction, limit: limiter.reduction }),
  };
}
