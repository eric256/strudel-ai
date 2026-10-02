// 🎛 Master: the mastering style on the whole mix (master.js), live like a mixer. Every song carries a style
// ("master" in its sheet, picked by the songwriter or the band) and maybe its own tweaks; with "follow song" on,
// the master glides to the song's style when the song starts. Moving a control changes the sound at once.
// (split out of app.js: start-up code runs in setup(), called from app.js)
import { MASTER_DEFAULTS, MASTER_PARAMS, MASTER_STYLES, STYLE_NAMES, clampParams, createMaster, diffParams, normStyle, styleParams } from '../master.js';
import { drawChannelSpectrum, drawMeter, levelOf, sdController } from './mixer.js';
import { esc } from '../lib/util.js';
import { songEdit } from './song-editor.js';
import { isMine, saveMySongs } from './song-library.js';
import { $, clog, docks, isPlaying, load, player, queue, save, scheduler, setupDock, ws } from '../app.js';
import { nowSong, songsChanged, renderSongs } from './song-lists.js';
import { songStyle } from './bands.js';
let MASTER_BYPASS, saveMaster;

export const master = { chain: null, style: 'clean', params: null, follow: true, songKey: '', bypass: false, dragging: null, msg: '' };
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
    chain.set(master.bypass ? MASTER_BYPASS : master.params, 0);
    merger.__master = chain;
  }
  master.chain = merger.__master;
  return master.chain;
}
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

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  MASTER_BYPASS = { ...MASTER_DEFAULTS, glue: 0 };
  {
    const st = load();
    master.style = normStyle(st.masterStyle) || 'clean';
    master.params = clampParams(st.masterParams || styleParams(master.style));
    master.follow = st.masterFollow !== false;
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
    songsChanged();
    renderSongs();
    master.msg = `✓ saved in “${sg.title}”: ${master.style}${Object.keys(d).length ? ` + ${Object.keys(d).length} tweak${Object.keys(d).length > 1 ? 's' : ''}` : ''}${isMine(sg) ? '' : ' (📁 save the song to keep it)'}`;
    syncMasterUI();
    setTimeout(() => { master.msg = ''; }, 6000);
  };
}
