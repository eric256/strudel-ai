// ---------------------------------------------------------------------------
// 🎚 Equalizer: a 7-band graphic EQ (60 Hz … 12 kHz, ±12 dB) on the master or on any mixer channel, with presets
// (Soft top tames harsh highs). The bands sit in the master chain (master.js) and in each channel strip
// (mixer.js); settings are saved with the master / the channel.
// ---------------------------------------------------------------------------
import { $, docks, isPlaying, setupDock, ws } from '../app.js';
import { render } from '../html.js';
import { T, onTemplatesChange } from '../templates/index.js';
import { EQ_BANDS, EQ_PRESETS, normEq, presetOf } from '../lib/eq.js';
import { master, masterChain, setMasterEq } from './master-panel.js';
import { chOf, channelAnalyser, mixerChannels, setChannelEq, drawChannelSpectrum } from './mixer.js';
import { audioCtx } from './hum-ui.js';
import { themeColor } from '../theme.js';

const eq = { target: 'master', raf: 0 };
const gainsOf = (t) => (t === 'master' ? normEq(master.eq) : normEq(chOf(t).geq));
function setGains(t, g) { if (t === 'master') setMasterEq(g); else setChannelEq(t, g); }

/** Open the Equalizer on the master or a channel. */
export function openEqualizer(target = 'master') {
  eq.target = target;
  ws.open('eq');
  renderEqualizer();
}

const act = {
  target(t) { eq.target = t; renderEqualizer(); },
  band(i, db) { const g = gainsOf(eq.target); g[i] = db; setGains(eq.target, g); renderEqualizer(); },
  preset(key) { setGains(eq.target, EQ_PRESETS[key].gains); renderEqualizer(); },
};
export function renderEqualizer() {
  const el = $('eqBody');
  if (!el) return;
  const chans = mixerChannels().map((c) => c.base);
  if (eq.target !== 'master' && !chans.includes(eq.target)) chans.push(eq.target);
  const g = gainsOf(eq.target);
  render(T.equalizer({
    target: eq.target,
    targets: [{ value: 'master', label: '🎛 master (the whole mix)' }, ...chans.map((c) => ({ value: c, label: `🎚 ${c}` }))],
    bands: EQ_BANDS.map((b, i) => ({ i, label: b.label, f: b.f, gain: g[i] })),
    preset: presetOf(g),
    presets: Object.entries(EQ_PRESETS).map(([key, p]) => ({ key, label: p.label, title: p.title })),
  }, act), el);
}

// the response curve over the live spectrum
const probe = { nodes: null, freqs: null };
function response(gains, width) {
  const ac = audioCtx();
  if (!ac) return null;
  if (!probe.nodes) probe.nodes = EQ_BANDS.map((b) => new BiquadFilterNode(ac, { type: b.type, frequency: b.f, Q: b.q || 0.7 }));
  if (probe.freqs?.length !== width) probe.freqs = Float32Array.from({ length: width }, (_, i) => 20 * Math.pow(1000, i / (width - 1)));
  const total = new Float32Array(width), mag = new Float32Array(width), ph = new Float32Array(width);
  probe.nodes.forEach((n, i) => {
    n.gain.value = gains[i];
    n.getFrequencyResponse(probe.freqs, mag, ph);
    for (let k = 0; k < width; k++) total[k] += 20 * Math.log10(mag[k] || 1e-6);
  });
  return total;
}
function draw() {
  eq.raf = requestAnimationFrame(draw);
  const cv = $('eqBody')?.querySelector('.eq-curve');
  if (!cv) return;
  const r = cv.getBoundingClientRect();
  if (r.width > 10 && Math.abs(cv.width - Math.round(r.width)) > 2) cv.width = Math.round(r.width);
  const g = cv.getContext('2d'), w = cv.width, h = cv.height;
  g.fillStyle = themeColor('canvas');
  g.fillRect(0, 0, w, h);
  const xOf = (f) => (Math.log10(f / 20) / 3) * w, yOf = (db) => h / 2 - (db / 15) * (h / 2);
  g.strokeStyle = themeColor('line');
  g.fillStyle = themeColor('muted');
  g.font = '10px monospace';
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = xOf(f); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 2, h - 3); }
  for (const db of [-12, -6, 6, 12]) { const y = yOf(db); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.fillText(`${db > 0 ? '+' : ''}${db}`, 2, y - 2); }
  g.strokeStyle = themeColor('muted');
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  const an = eq.target === 'master' ? masterChain()?.analyser : channelAnalyser(eq.target);
  if (an && isPlaying()) drawChannelSpectrum(g, an, w, h, themeColor('accent-2'));
  const gains = gainsOf(eq.target);
  const curve = response(gains, w);
  if (curve) {
    g.strokeStyle = themeColor('accent');
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x < w; x++) { const y = yOf(curve[x]); x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    g.lineWidth = 1;
    // a dot per band
    g.fillStyle = themeColor('accent');
    EQ_BANDS.forEach((b, i) => { g.beginPath(); g.arc(xOf(b.f), yOf(gains[i]), 3.5, 0, Math.PI * 2); g.fill(); });
  }
}

export function setup() {
  setupDock('eq', {
    onShow: () => { renderEqualizer(); cancelAnimationFrame(eq.raf); draw(); ws.minSize?.('eq', 300); },
    onHide: () => cancelAnimationFrame(eq.raf),
  });
  onTemplatesChange(() => renderEqualizer());
  setInterval(() => { if (docks.eq?.on) renderEqualizer(); }, 2000); // (channels come and go)
}
