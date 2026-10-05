// 🎚 Mixer: the master's inputs as a console — one strip per part of the WHOLE song (every part in the song sheet,
// plus any other labelled line in the code), whether or not it plays in the current section, and one per bus.
// Every labelled part plays on its own orbit (Strudel's output bus). Its sound:
//   orbit → src (mute / solo / the section's solo lead) → its effects in 🔀 Routing → its input on the master:
//   pan → fader → master                                                           └→ meter / spectrum
// A part with no effects goes straight to its input (src → thru → input). A bus (a node in 🔀 Routing that several
// parts reach) gets an input of its own. The effects themselves (EQ included) are all in 🔀 Routing.
// Settings are kept per part name (a bus: per its node), so they apply whenever that part plays.
// Nothing here touches the code; the code's own faders (.postgain) still work as a trim.
// (split out of app.js: start-up code runs in setup(), called from app.js)
import { master } from './master-panel.js';
import { normEq, isFlat } from '../lib/eq.js';
import { peakState } from '../lib/taper.js';
import { stringArgs } from '../lib/partcode.js';
import { splitLibrary } from '../lib/library.js';
import { getTaste, avoidSound, likeSound } from './taste.js';
import { parseLabel, patternLines } from '../lib/labels.js';
import { vizColor } from './visualizer.js';
import { onceAFrame } from '../lib/events.js';
import { audioCtx } from './hum-ui.js';
import { $, clog, cps, docks, getCode, isPlaying, load, player, queue, save, scheduler, setSectionLevel, setupDock, ws } from '../app.js';
import { nowSong } from './song-lists.js';
import { currentMode } from './modes.js';
import { render } from '../html.js';
import { T, onTemplatesChange } from '../templates/index.js';
import { themeColor } from '../theme.js';
let saveMixer;
const MX_DEFAULT = { vol: 1, pan: 0, mute: false, solo: false };
export const mixer = { ch: {}, orbits: {}, nextOrbit: 2, key: '', dragging: false, buses: {}, oldEq: {} };
export const chOf = (key) => (mixer.ch[key] ||= { ...MX_DEFAULT });
/** A channel's input on the master (its pan → fader → meter): its analyser, or null while it hasn't played. */
export const channelAnalyser = (key) => stripIfAny(key)?.an || null;
/** The buses on the master (from 🔀 Routing): [{ key, label, title, parts }] — set by features/routing.js. */
export const busList = { get: () => [] };
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
/**
 * A part's nodes on its orbit (built the first time, rebuilt if the audio engine was reset):
 *   orbit → src → thru → in → pan → gain (fader) → an, and gain → the master.
 * 🔀 Routing takes src's sound through its effects (closing thru) and brings it back into `in` (or a bus's).
 */
function channelNodes(base) {
  const n = mixer.orbits[base];
  const ctrl = sdController();
  if (n == null || !ctrl) return null;
  const orbit = ctrl.getOrbit(n, [0, 1]);
  if (!orbit.__ch) {
    const ac = orbit.audioContext;
    const src = new GainNode(ac), thru = new GainNode(ac), srcAn = new AnalyserNode(ac, { fftSize: 512, smoothingTimeConstant: 0.5 });
    try { orbit.output.disconnect(); } catch {}
    orbit.output.connect(src).connect(thru);
    src.connect(srcAn); // (the part's own sound, before its effects: 🔀 Routing's part cards)
    const strip = makeStrip(ac);
    thru.connect(strip.in);
    ctrl.output.connectToDestination(strip.gain, [0, 1]);
    orbit.__ch = { src, srcAn, thru, ...strip };
    for (const f of channelHooks) f(base, orbit.__ch);
  }
  return orbit.__ch;
}
/** An input on the master: pan → fader, with a meter after the fader. */
function makeStrip(ac) {
  const input = new GainNode(ac), pan = new StereoPannerNode(ac, { pan: 0 }), gain = new GainNode(ac), an = new AnalyserNode(ac, { fftSize: 1024, smoothingTimeConstant: 0.6 });
  input.connect(pan).connect(gain).connect(an);
  return { in: input, pan, gain, an };
}
/** A bus's input on the master (made the first time it's needed; it joins the master through 🔀 Routing's return). */
export function busStrip(key, ctrl, ret) {
  let b = mixer.buses[key];
  if (!b || b.ctx !== ctrl.output.channelMerger.context) {
    b = mixer.buses[key] = { ...makeStrip(ctrl.output.channelMerger.context), ctx: ctrl.output.channelMerger.context };
    b.gain.connect(ret);
  }
  applyChannel(key);
  return b;
}
/** Called when a part's nodes are made (🔀 Routing wires a new channel in). */
export const channelHooks = new Set();
/** A part's nodes, if its orbit has them yet (no new ones made). */
export const channelIfAny = (base) => (mixer.orbits[base] != null ? sdController()?.nodes?.[mixer.orbits[base]]?.__ch || null : null);
/** "FX ↗" on a strip: its effects in 🔀 Routing (set by features/routing.js). */
export const fxHook = { open: () => {} };
/** A master input's nodes, by key (a part's name, or 'bus:<node>'), if it has them yet. */
export const stripIfAny = (key) => (String(key).startsWith('bus:') ? mixer.buses[key] || null : channelIfAny(key));
/** A part's input on the master (made if its orbit exists). */
export const stripFor = (key) => channelNodes(key);
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
const audible = (key) => { const c = chOf(key); return !c.mute && (String(key).startsWith('bus:') || !anySolo() || c.solo); };
/** Mute, solo and the section's lead act on a part's src (so its effects and buses follow); pan and fader on its input. */
function applyChannel(key, ramp = 0.015) {
  const bus = String(key).startsWith('bus:');
  const nodes = bus ? mixer.buses[key] : channelNodes(key);
  if (!nodes) return;
  const c = chOf(key);
  const t = nodes.gain.context.currentTime;
  if (!bus) nodes.src.gain.setTargetAtTime(audible(key) ? sectionGain(key) : 0, t, ramp);
  nodes.pan.pan.setTargetAtTime(Number(c.pan) || 0, t, 0.02);
  nodes.gain.gain.setTargetAtTime((bus && c.mute ? 0 : 1) * Number(c.vol), t, ramp);
}
const applyAllChannels = () => { for (const key of [...Object.keys(mixer.orbits), ...Object.keys(mixer.buses)]) applyChannel(key); };

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
  // a song part's sound: what its code plays (its main version), else the sheet's
  const defSound = (id) => {
    const def = sg?.library && splitLibrary(sg.library).defs.find((d) => d.id === `${id}_main`);
    return def ? (stringArgs(def.code, ['s', 'sound'])[0]?.value.match(/[A-Za-z_][\w]*/) || [])[0] : null;
  };
  for (const p of sg?.sheet?.parts || []) add(p.id, { role: p.role, sound: defSound(p.id) || p.sound, song: true });
  for (const r of rows) add(r.base);
  const lines = code.split('\n');
  for (const ch of out) {
    const r = rows.find((x) => x.base === ch.base);
    ch.inSection = !!r;
    ch.codeMuted = !!r?.muted;
    // its sound: the song part's, else the first sound in its line of code (s("square …")) — for 👍 / 👎
    if (!ch.sound && r) ch.sound = (stringArgs(lines[r.line] || '', ['s', 'sound'])[0]?.value.match(/[A-Za-z_][\w]*/) || [])[0] || '';
  }
  return out;
}

const dbText = (v) => (v <= 0.0001 ? '-∞' : `${(20 * Math.log10(v)).toFixed(1)}`);
function renderMixerPanel() {
  if (!docks.mixer?.on || mixer.dragging) return;
  const chans = mixerChannels();
  const key = JSON.stringify([chans, busList.get(), mixer.ch, $('masterGain').value]);
  if (key === mixer.key) return;
  mixer.key = key;
  const channel = (ch) => {
    const c = chOf(ch.base);
    return {
      base: ch.base, color: vizColor(ch.base), title: `${ch.base}${ch.role ? ` · ${ch.role}` : ''}${ch.sound ? ` · ${ch.sound}` : ''}`,
      state: !ch.inSection ? 'absent' : ch.codeMuted ? 'code-muted' : 'playing', silenced: !audible(ch.base),
      pan: Number(c.pan) || 0, mute: !!c.mute, solo: !!c.solo, vol: c.vol, db: dbText(c.vol),
      sound: ch.sound || '', liked: !!ch.sound && getTaste().liked.includes(ch.sound),
    };
  };
  // the buses (🔀 Routing): a strip each, after the parts
  const buses = busList.get().map((b) => {
    const c = chOf(b.key);
    return { base: b.key, bus: true, label: b.label, color: themeColor('accent'), title: b.title, state: 'playing', silenced: !!c.mute, pan: Number(c.pan) || 0, mute: !!c.mute, solo: false, vol: c.vol, db: dbText(c.vol), sound: '', liked: false };
  });
  const gain = $('masterGain').value;
  render(T.mixer({ channels: [...chans.map(channel), ...buses], master: { playing: isPlaying(), value: gain, db: dbText(Number(gain)) } }), $('mixerStrips'));
}

// live visuals: each channel's spectrum, and a level meter beside each fader
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
    const an = isMaster ? masterAnalyser() : channelAnalyser(base);
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
    }
    const m = el.querySelector('.mx-meter');
    const lvl = an && isPlaying() ? levelOf(an, buf) : { rms: 0, peak: 0 };
    if (m) drawMeter(m, lvl);
    // the clip LED: amber near the top (for a moment), red once it clipped (until clicked)
    const led = el.querySelector('.mx-clip');
    if (led) {
      const st = peakState(lvl.peak);
      if (st === 'clip') el.__clip = true;
      if (st === 'hot') el.__hot = performance.now();
      const hot = !el.__clip && el.__hot && performance.now() - el.__hot < 400;
      led.classList.toggle('clip', !!el.__clip);
      led.classList.toggle('hot', !!hot);
    }
  }
}

/**
 * Level alerts: while music plays, the final output is watched — ● HOT in the status bar when it peaks near the top
 * (or the limiter works hard), ● CLIP when it hits the top (or the limiter squashes it by more than 6 dB), with the
 * loudest channels named. It stays lit a moment after the last peak; click it for the 🎚 mixer.
 */
const levelWatch = { state: '', until: 0, logged: 0, buf: null };
export function checkLevels() {
  const btn = $('sbLevel');
  if (!btn) return;
  const now = performance.now();
  const an = isPlaying() ? masterAnalyser() : null;
  if (an) {
    const buf = levelWatch.buf?.length === an.fftSize ? levelWatch.buf : (levelWatch.buf = new Float32Array(an.fftSize));
    const peak = levelOf(an, buf).peak;
    const limit = master.chain && isPlaying() ? master.chain.reduction().limit : 0;
    let st = peakState(peak);
    if (limit < -6) st = 'clip'; else if (limit < -2 && !st) st = 'hot';
    if (st && (st === 'clip' || levelWatch.state !== 'clip' || now > levelWatch.until)) {
      // which channels are loudest
      const loud = Object.keys(mixer.orbits).map((base) => {
        const a = channelAnalyser(base);
        return a ? { base, peak: levelOf(a, buf.length === a.fftSize ? buf : new Float32Array(a.fftSize)).peak } : null;
      }).filter((x) => x && x.peak > 0.5).sort((a, b) => b.peak - a.peak).slice(0, 3);
      levelWatch.state = st;
      levelWatch.until = now + 2500;
      const who = loud.length ? ` — loudest: ${loud.map((x) => `${x.base} (${(20 * Math.log10(x.peak)).toFixed(1)} dB)`).join(', ')}` : '';
      btn.title = (st === 'clip'
        ? `Clipping: the mix hits the top${limit < -6 ? ` (the limiter takes ${(-limit).toFixed(1)} dB off)` : ''}. Pull down the master or the loudest channel, or lower 🎛 Master → Output.`
        : 'Running hot: close to the top. A little less level keeps it clean.') + who + ' (click for the 🎚 mixer)';
      if (st === 'clip' && now - levelWatch.logged > 15000) { levelWatch.logged = now; clog('warn', `🔴 clipping${who}`); }
    }
  }
  const show = levelWatch.state && now < levelWatch.until ? levelWatch.state : '';
  if (!show) levelWatch.state = '';
  btn.hidden = !show;
  btn.className = `sb-level ${show}`;
  const text = show === 'clip' ? '● CLIP' : show === 'hot' ? '● HOT' : '';
  if (btn.textContent !== text) btn.textContent = text;
}

/** Set a master input's fader, pan, mute or solo (the mixer and 🔀 Routing's master block both use this). */
export function setChannel(base, k, v) {
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
    // the channels' EQ moved to 🔀 Routing: what was set here is handed over (routing makes it EQ nodes), then dropped
    for (const [key, c] of Object.entries(mixer.ch)) {
      const three = { low: Number(c.low) || 0, mid: Number(c.mid) || 0, high: Number(c.high) || 0 };
      const geq = c.geq ? normEq(c.geq) : null;
      if (three.low || three.mid || three.high || (geq && !isFlat(geq))) mixer.oldEq[key] = { three, geq: geq && !isFlat(geq) ? geq : null };
      for (const k of ['low', 'mid', 'high', 'geq']) delete c[k];
    }
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
    setInterval(checkLevels, 150);
    $('sbLevel').onclick = () => ws.open('mixer');
  }
  $('mixerStrips').addEventListener('pointerdown', (e) => { if (e.target.matches('input[type=range], sa-knob, sa-fader')) mixer.dragging = true; });
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
    if (!t.matches('input[type=range]')) return; // (knobs and faders reset themselves)
    t.value = t.dataset.k === 'vol' || t.dataset.k === 'master' ? 1 : 0;
    t.dispatchEvent(new Event('input', { bubbles: true }));
    mixer.key = '';
  });
  $('mixerStrips').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mx]');
    const base = b?.closest('.mx-strip')?.dataset.base;
    if (!base) return;
    // the clip LED: click to reset it; EQ: this channel in the 🎚 Equalizer
    if (b.dataset.mx === 'clip') { b.closest('.mx-strip').__clip = false; b.classList.remove('clip', 'hot'); return; }
    if (b.dataset.mx === 'fx') { if (base === '__master') ws.open('route'); fxHook.open(base); return; }
    // 🎧 👍 / 👎 its sound (your taste)
    if (b.dataset.mx === 'like' || b.dataset.mx === 'dislike') {
      const sound = mixerChannels().find((x) => x.base === base)?.sound;
      if (sound) (b.dataset.mx === 'like' ? likeSound : avoidSound)(sound);
      mixer.key = '';
      renderMixerPanel();
      return;
    }
    const c = chOf(base);
    if (b.dataset.mx === 'mute') { c.mute = !c.mute; if (c.mute) c.solo = false; }
    else { c.solo = !c.solo; if (c.solo) c.mute = false; }
    saveMixer();
    applyAllChannels();
    mixer.key = '';
    renderMixerPanel();
  });
  $('mixerFlat').onclick = () => {
    for (const c of Object.values(mixer.ch)) c.pan = 0;
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
