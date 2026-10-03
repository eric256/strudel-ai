// 🎚 Mixer: a console with one channel per part of the WHOLE song (every part in the song sheet, plus any other
// labelled line in the code), whether or not it plays in the current section.
// Every labelled part plays on its own orbit (Strudel's output bus); the mixer puts a channel strip on that bus:
//   orbit → EQ (high shelf 4 kHz · mid peak 1 kHz · low shelf 200 Hz, ±12 dB) → pan → fader → speakers
//                                                                                   └→ meter / spectrum
// Settings are kept per part name, so they apply whenever that part plays — this section, the next, the next song.
// Nothing here touches the code; the code's own faders (.postgain) still work as a trim.
// (split out of app.js: start-up code runs in setup(), called from app.js)
import { parseLabel, patternLines } from '../lib/labels.js';
import { vizColor } from './visualizer.js';
import { onceAFrame } from '../lib/events.js';
import { audioCtx } from './hum-ui.js';
import { $, cps, docks, getCode, isPlaying, load, player, queue, save, scheduler, setSectionLevel, setupDock, ws } from '../app.js';
import { nowSong } from './song-lists.js';
import { currentMode } from './modes.js';
import { render } from '../html.js';
import { T, onTemplatesChange } from '../templates/index.js';
import { themeColor } from '../theme.js';
let saveMixer;
const MX_BANDS = [['high', 'highshelf', 4000], ['mid', 'peaking', 1000], ['low', 'lowshelf', 200]];
const MX_DEFAULT = { vol: 1, pan: 0, high: 0, mid: 0, low: 0, mute: false, solo: false };
export const mixer = { ch: {}, orbits: {}, nextOrbit: 2, key: '', dragging: false };
const chOf = (base) => (mixer.ch[base] ||= { ...MX_DEFAULT });
/** Every labelled part gets its own orbit ("$:" lines share the default one). */
function mixerOrbit(base) {
  if (!base || base === '$') return null;
  if (mixer.orbits[base] == null) mixer.orbits[base] = mixer.nextOrbit++;
  return mixer.orbits[base];
}

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

export const sdController = () => { try { return globalThis.getSuperdoughAudioController(); } catch { return null; } };
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
/** A solo section: its lead part steps forward, the others step back (on top of the faders). */
const SOLO_LEAD = 1.15, SOLO_OTHERS = 0.45;
const sectionGain = (base) => (!mixer.lead ? 1 : base === mixer.lead ? SOLO_LEAD : SOLO_OTHERS);
/** The section playing now has a solo (its part), or not (null): every channel moves smoothly. */
export function setSectionLead(part) {
  if ((part || null) === (mixer.lead || null)) return;
  mixer.lead = part || null;
  for (const base of Object.keys(mixer.orbits)) applyChannel(base, 0.25);
}
const audible = (base) => { const c = chOf(base); return !c.mute && (!anySolo() || c.solo); };
function applyChannel(base, ramp = 0.015) {
  const nodes = channelNodes(base);
  if (!nodes) return;
  const c = chOf(base);
  const t = nodes.gain.context.currentTime;
  for (const [b] of MX_BANDS) nodes[b].gain.setTargetAtTime(Number(c[b]) || 0, t, 0.02);
  nodes.pan.pan.setTargetAtTime(Number(c.pan) || 0, t, 0.02);
  nodes.gain.gain.setTargetAtTime(audible(base) ? Number(c.vol) * sectionGain(base) : 0, t, ramp);
}
const applyAllChannels = () => { for (const base of Object.keys(mixer.orbits)) applyChannel(base); };

/** How loud the music is right now, 0…1 (smoothed): 🌀 Hydra's L() makes visuals move with the music. */
let levelBuf = null, levelSmooth = 0;
export function musicLevel() {
  const an = masterAnalyser();
  if (!an) return 0;
  if (!levelBuf || levelBuf.length !== an.fftSize) levelBuf = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(levelBuf);
  let sum = 0;
  for (const v of levelBuf) sum += v * v;
  const rms = Math.min(1, Math.sqrt(sum / levelBuf.length) * 2);
  levelSmooth += (rms - levelSmooth) * (rms > levelSmooth ? 0.5 : 0.08); // fast up, slow down
  return levelSmooth;
}
/** The master meter: an analyser on the main output. */
function masterAnalyser() {
  const ctrl = sdController();
  const out = ctrl?.output?.destinationGain;
  if (!out) return null;
  if (out.__an?.context !== out.context) { out.__an = new AnalyserNode(out.context, { fftSize: 1024, smoothingTimeConstant: 0.6 }); out.connect(out.__an); }
  return out.__an;
}

/**
 * The channels: the song's parts (all of them, in the sheet's order) and every other labelled part in the code.
 * ⌨ Jam has no song: just the parts in the code, so a part you delete loses its channel.
 */
export function mixerChannels() {
  const code = getCode();
  const rows = patternLines(code);
  const sg = currentMode() === 'jam' ? null : queue.running ? queue.songs[queue.current] : nowSong;
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
  const EQ_TITLE = { high: '(4 kHz shelf)', mid: '(1 kHz peak)', low: '(200 Hz shelf)' };
  const channel = (ch) => {
    const c = chOf(ch.base);
    return {
      base: ch.base, color: vizColor(ch.base), title: `${ch.base}${ch.role ? ` · ${ch.role}` : ''}${ch.sound ? ` · ${ch.sound}` : ''}`,
      state: !ch.inSection ? 'absent' : ch.codeMuted ? 'code-muted' : 'playing', silenced: !audible(ch.base),
      eq: MX_BANDS.map(([b]) => ({ band: b, title: `${b} ${EQ_TITLE[b]} — double-click: 0 dB`, value: Number(c[b]) || 0 })),
      pan: Number(c.pan) || 0, mute: !!c.mute, solo: !!c.solo, vol: c.vol, db: dbText(c.vol),
    };
  };
  const gain = $('masterGain').value;
  render(T.mixer({ channels: chans.map(channel), master: { playing: isPlaying(), value: gain, db: dbText(Number(gain)) } }), $('mixerStrips'));
}

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
export const levelOf = (an, buf) => {
  an.getFloatTimeDomainData(buf);
  let sum = 0, peak = 0;
  for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); sum += v * v; if (v > peak) peak = v; }
  return { rms: Math.sqrt(sum / buf.length), peak };
};
export function drawChannelSpectrum(g, an, w, h, color) {
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
export function drawMeter(cv, lvl) {
  const g = cv.getContext('2d'), w = cv.width, h = cv.height;
  g.fillStyle = themeColor('canvas');
  g.fillRect(0, 0, w, h);
  const y = (v) => { const db = 20 * Math.log10(Math.max(v, 1e-5)); return h - Math.max(0, Math.min(1, (db + 60) / 60)) * h; }; // −60 … 0 dB
  const top = y(lvl.rms);
  const grad = g.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, themeColor('accent-2')); grad.addColorStop(0.75, themeColor('accent-2')); grad.addColorStop(0.88, themeColor('warn')); grad.addColorStop(1, themeColor('danger'));
  g.fillStyle = grad;
  g.fillRect(1, top, w - 2, h - top);
  cv.__hold = Math.min(cv.__hold ?? h, y(lvl.peak));
  cv.__hold += 0.6; // the peak marker falls slowly
  g.fillStyle = lvl.peak >= 0.99 ? themeColor('danger') : themeColor('text');
  g.fillRect(0, Math.min(h - 2, cv.__hold), w, 2);
}
function drawMixer() {
  mixer.raf = requestAnimationFrame(drawMixer);
  const buf = mixer.buf || (mixer.buf = new Float32Array(1024));
  for (const el of $('mixerStrips').querySelectorAll('.mx-strip')) { // (the panel may be in another window)
    const base = el.dataset.base;
    const isMaster = base === '__master';
    const an = isMaster ? masterAnalyser() : mixer.orbits[base] != null ? sdController()?.nodes?.[mixer.orbits[base]]?.__ch?.an : null;
    const color = getComputedStyle(el).getPropertyValue('--c') || themeColor('accent');
    // EQ curve + spectrum
    const cv = el.querySelector('.mx-eqviz');
    if (cv) {
      const g = cv.getContext('2d'), w = cv.width, h = cv.height;
      g.fillStyle = themeColor('canvas');
      g.fillRect(0, 0, w, h);
      g.strokeStyle = themeColor('line');
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      if (an && isPlaying()) drawChannelSpectrum(g, an, w, h, isMaster ? themeColor('accent') : color);
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

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  // a song's dynamics as its sections play: each section's volume, a solo's lead part forward, and the ending —
  // the last section fades out (or, for a hard ending, a bar of silence follows it)
  player.on('section', ({ step }) => {
    const sec = step.section, sh = step.song?.sheet;
    setSectionLead(!step.gap && sec?.solo || null);
    if (step.gap) return;
    const last = sh && sec === sh.sections[sh.sections.length - 1] && !step.fillStep;
    if (last && sh.ending !== 'cut') setSectionLevel(sec.level ?? 1, { fadeOut: step.bars / Math.max(0.05, cps()) });
    else setSectionLevel(sec?.level ?? 1);
  });
  const reset = () => { setSectionLead(null); setSectionLevel(1); };
  player.on('transport', ({ state }) => { if (state === 'stopped') reset(); });
  player.on('mode', reset);
  { // settings from before (EQ only) carry over
    const st = load();
    for (const [base, e] of Object.entries(st.mixerEq || {})) mixer.ch[base] = { ...MX_DEFAULT, ...e };
    Object.assign(mixer.ch, st.mixerCh || {});
  }
  saveMixer = (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => save({ mixerCh: mixer.ch }), 300); }; })();
  window.__mixerTrap = () => installOrbitTrap();
  // the audio engine creates orbits on the first note and can be reset: keep the strips in place
  setInterval(() => { if (isPlaying()) applyAllChannels(); }, 500);
  setupDock('mixer', {
    onShow: () => { mixer.key = ''; renderMixerPanel(); cancelAnimationFrame(mixer.raf); drawMixer(); ws.minSize?.('mixer', 330); },
    onHide: () => cancelAnimationFrame(mixer.raf),
  });
  {
    const soon = onceAFrame(() => { mixer.key = ''; renderMixerPanel(); });
    for (const e of ['section', 'song', 'mode']) player.on(e, soon);
    onTemplatesChange(soon);
    setInterval(renderMixerPanel, 1000);
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
}
