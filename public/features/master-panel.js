// 🎛 Master: the mastering style on the whole mix (master.js), live like a mixer. Every song carries a style
// ("master" in its sheet, picked by the songwriter or the band) and maybe its own tweaks; with "follow song" on,
// the master glides to the song's style when the song starts. Moving a control changes the sound at once.
// (split out of app.js: start-up code runs in setup(), called from app.js)
import { EQ_FLAT, normEq } from '../lib/eq.js';
import { MASTER_DEFAULTS, MASTER_NODES, MASTER_PARAMS, MASTER_STYLES, STYLE_NAMES, clampParams, createMaster, diffParams, effectiveParams, normStyle, styleParams } from '../master.js';
import { EQ_BANDS, presetOf, EQ_PRESETS } from '../lib/eq.js';
import { peakState } from '../lib/taper.js';
import { openEqualizer } from './equalizer.js';
import { audioCtx } from './hum-ui.js';
import { drawChannelSpectrum, drawMeter, levelOf, sdController } from './mixer.js';
import { songEdit } from './song-editor.js';
import { isMine, saveMySongs } from './song-library.js';
import { $, clog, docks, isPlaying, load, player, queue, save, scheduler, setupDock, ws } from '../app.js';
import { nowSong, songsChanged, renderSongs } from './song-lists.js';
import { songStyle } from './bands.js';
import { render, renderOptions } from '../html.js';
import { T, onTemplatesChange } from '../templates/index.js';
import { themeColor } from '../theme.js';
let MASTER_BYPASS, saveMaster;

export const master = { chain: null, style: 'clean', params: null, follow: true, songKey: '', bypass: false, dragging: null, msg: '', eq: EQ_FLAT, off: [] };
/** What the chain plays: the whole master bypassed, or your settings with the nodes that are off passed through. */
const heard = () => (master.bypass ? MASTER_BYPASS : effectiveParams(master.params, master.off));
/** The master's 🎚 Equalizer bands (dB): set, saved, heard at once. */
export function setMasterEq(gains) { master.eq = normEq(gains); masterChain()?.setEq(master.eq); save({ masterEq: master.eq }); }
/** The chain on Strudel's output (built the first time, rebuilt when the audio engine was reset). */
export function masterChain() {
  const ctrl = sdController();
  const merger = ctrl?.output?.channelMerger, dest = ctrl?.output?.destinationGain;
  if (!merger || !dest) return null;
  if (!merger.__master) {
    const chain = createMaster(merger.context);
    try { merger.disconnect(); } catch {}
    merger.connect(chain.input);
    chain.output.connect(dest);
    chain.set(heard(), 0);
    chain.setEq(master.eq, 0);
    merger.__master = chain;
  }
  master.chain = merger.__master;
  return master.chain;
}
/** One control of the master, as you turn it (from 🔀 Routing's master sections): heard at once, saved. */
export function setMasterParam(k, v) {
  master.msg = '';
  if (master.bypass) master.bypass = false;
  setMaster({ [k]: v });
  syncMasterUI();
}
/** The style's own value of a control (a knob's double-click). */
export const styleValue = (k) => styleParams(master.style)[k];
/** Switch one of the master's sections (EQ, Filter, Color, …) on or off: off, it passes the sound through. */
export function toggleMasterNode(g) {
  master.off = master.off.includes(g) ? master.off.filter((x) => x !== g) : [...master.off, g];
  if (master.bypass) master.bypass = false;
  masterChain()?.set(heard(), 0.05);
  save({ masterOff: master.off });
  syncMasterUI();
}
/** Set the master: some controls (live), or a whole style. ramp = seconds to glide. */
function setMaster(params, ramp = 0.03) {
  master.params = clampParams({ ...master.params, ...params });
  masterChain()?.set(heard(), ramp);
  saveMaster();
}
function setMasterStyle(style, tweaks = null, ramp = 0.4) {
  master.style = normStyle(style) || 'clean';
  master.params = styleParams(master.style, tweaks);
  masterChain()?.set(heard(), ramp);
  saveMaster();
  syncMasterUI();
}
/** The song whose style the master follows: the one playing (or the last one that played). */
const masterSong = () => (queue.running ? queue.songs[queue.current] : nowSong) || null;
/** Keep the master in step with the player: installed, gated, the tempo for its echo, the song's style. */
function masterTick() {
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
}

function renderMasterPanel() {
  renderOptions($('masterStyle'), STYLE_NAMES.map((n) => ({ value: n, label: n, title: MASTER_STYLES[n].desc })), master.style);
  // built once; syncMasterUI sets the values and the nodes' on / off (templates/master.js)
  render(T.masterPanel({ nodes: MASTER_NODES.map((n) => ({ ...n, controls: MASTER_PARAMS.filter((d) => d.group === n.group) })) }), $('masterBody'));
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
    const inp = $('masterBody').querySelector(`[data-k="${d.key}"]`);
    if (inp && master.dragging !== d.key) inp.value = v;
    if (inp) { inp.title = `${d.title}: ${fmtMaster(d, v)} — double-click: the style's value`; inp.classList.toggle('changed', Math.abs(v - base[d.key]) > d.step / 2); }
  }
  // the nodes: on / off
  for (const el of $('masterBody').querySelectorAll('.ms-node[data-group]')) el.classList.toggle('off', master.bypass || master.off.includes(el.dataset.group));
  const eqn = $('masterBody').querySelector('.ms-eqname');
  if (eqn) { const p = presetOf(master.eq); eqn.textContent = p ? EQ_PRESETS[p].label : 'custom'; }
  const sg = masterSong();
  const tweaked = Object.keys(diffParams(master.params, master.style)).length;
  $('masterSong').textContent = master.msg || (sg?.sheet ? `“${sg.title}”: ${songStyle(sg)}${sg.sheet.masterParams && Object.keys(sg.sheet.masterParams).length ? ' (its own mix)' : ''}${songStyle(sg) !== master.style ? ` · now: ${master.style}` : ''}${tweaked ? ' · you changed ' + tweaked : ''}` : tweaked ? `${tweaked} control${tweaked > 1 ? 's' : ''} changed from the style` : MASTER_STYLES[master.style].desc);
}
function drawMaster() {
  master.raf = requestAnimationFrame(drawMaster);
  const chain = master.chain, on = isPlaying() && chain;
  const cv = $('masterBody').querySelector('.ms-spec');
  if (cv) {
    const g = cv.getContext('2d'), w = cv.width, h = cv.height;
    g.fillStyle = themeColor('canvas');
    g.fillRect(0, 0, w, h);
    g.strokeStyle = themeColor('line');
    for (const f of [100, 1000, 10000]) { const x = (Math.log10(f / 20) / 3) * w; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    if (on) drawChannelSpectrum(g, chain.analyser, w, h, themeColor('accent'));
  }
  const out = $('masterBody').querySelector('.ms-out');
  const lvl = on ? levelOf(chain.analyser, master.buf || (master.buf = new Float32Array(2048))) : { rms: 0, peak: 0 };
  if (out) drawMeter(out, lvl);
  const led = $('masterBody').querySelector('.ms-clip');
  if (led) {
    const st = peakState(lvl.peak);
    if (st === 'clip') master.clip = true;
    if (st === 'hot') master.hot = performance.now();
    led.classList.toggle('clip', !!master.clip);
    led.classList.toggle('hot', !master.clip && performance.now() - (master.hot || 0) < 400);
  }
  drawEqMini($('masterBody').querySelector('.ms-eqmini'));
  const gr = $('masterBody').querySelector('.ms-gr-meter');
  if (gr) {
    const g = gr.getContext('2d'), w = gr.width, h = gr.height;
    const r = on ? chain.reduction() : { glue: 0, limit: 0 };
    g.fillStyle = themeColor('canvas');
    g.fillRect(0, 0, w, h);
    g.fillStyle = themeColor('warn');
    g.fillRect(1, 0, w - 2, Math.min(1, -r.glue / 20) * h); // gain reduction hangs from the top
    const lab = $('masterBody').querySelector('.ms-gr');
    if (lab && (master.grShown = (master.grShown || 0) + 1) % 10 === 0) lab.textContent = on ? `glue ${r.glue.toFixed(1)} dB · limit ${r.limit.toFixed(1)} dB` : '';
  }
}

// the EQ node's little curve
const mini = { nodes: null, freqs: null };
function drawEqMini(cv) {
  if (!cv) return;
  const ac = audioCtx();
  if (!ac) return;
  const g = cv.getContext('2d'), w = cv.width, h = cv.height;
  if (!mini.nodes) mini.nodes = EQ_BANDS.map((b) => new BiquadFilterNode(ac, { type: b.type, frequency: b.f, Q: b.q || 0.7 }));
  if (mini.freqs?.length !== w) mini.freqs = Float32Array.from({ length: w }, (_, i) => 20 * Math.pow(1000, i / (w - 1)));
  const total = new Float32Array(w), mag = new Float32Array(w), ph = new Float32Array(w);
  mini.nodes.forEach((n, i) => { n.gain.value = master.eq[i] || 0; n.getFrequencyResponse(mini.freqs, mag, ph); for (let k = 0; k < w; k++) total[k] += 20 * Math.log10(mag[k] || 1e-6); });
  g.fillStyle = themeColor('canvas');
  g.fillRect(0, 0, w, h);
  g.strokeStyle = themeColor('line');
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  g.strokeStyle = themeColor('accent');
  g.lineWidth = 1.5;
  g.beginPath();
  for (let x = 0; x < w; x++) { const y = h / 2 - (total[x] / 13) * (h / 2); x ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  g.lineWidth = 1;
}

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  onTemplatesChange(() => { if ($('masterBody').firstChild) renderMasterPanel(); });
  MASTER_BYPASS = { ...MASTER_DEFAULTS, glue: 0 };
  {
    const st = load();
    master.style = normStyle(st.masterStyle) || 'clean';
    master.params = clampParams(st.masterParams || styleParams(master.style));
    master.follow = st.masterFollow !== false;
    master.eq = normEq(st.masterEq);
    master.off = Array.isArray(st.masterOff) ? st.masterOff.filter((g) => MASTER_NODES.some((n) => n.group === g)) : [];
  }
  saveMaster = (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => save({ masterStyle: master.style, masterParams: master.params, masterFollow: master.follow }), 300); }; })();
  window.__masterInstall = () => { try { masterChain(); } catch (e) { console.warn('master chain:', e); } };
  for (const e of ['section', 'song', 'transport']) player.on(e, () => setTimeout(masterTick, 30)); // (after the new code is evaluated)
  setInterval(masterTick, 1000);
  setupDock('master', {
    onShow: () => { if (!$('masterBody').firstChild) renderMasterPanel(); syncMasterUI(); cancelAnimationFrame(master.raf); drawMaster(); ws.minSize?.('master', 250); },
    onHide: () => cancelAnimationFrame(master.raf),
  });
  setInterval(() => { if (docks.master?.on) syncMasterUI(); }, 1000);
  $('masterBody').addEventListener('pointerdown', (e) => { if (e.target.matches('input[type=range], sa-knob')) master.dragging = e.target.dataset.k; });
  // a node's ⏻: switch it on / off; the EQ node opens the Equalizer; the clip LED resets
  $('masterBody').addEventListener('click', (e) => {
    const pow = e.target.closest('[data-node]');
    if (pow) { toggleMasterNode(pow.dataset.node); return; }
    if (e.target.closest('[data-open-route]')) { ws.open('route'); return; }
    if (e.target.closest('[data-open-eq]')) { openEqualizer('master'); return; }
    if (e.target.closest('[data-clip]')) { master.clip = false; e.target.closest('[data-clip]').classList.remove('clip', 'hot'); }
  });
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
    masterChain()?.set(heard(), 0.05);
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
    songsChanged();
    renderSongs();
    master.msg = `✓ saved in “${sg.title}”: ${master.style}${Object.keys(d).length ? ` + ${Object.keys(d).length} tweak${Object.keys(d).length > 1 ? 's' : ''}` : ''}${isMine(sg) ? '' : ' (📁 save the song to keep it)'}`;
    syncMasterUI();
    setTimeout(() => { master.msg = ''; }, 6000);
  };
}
