// 🌀 Hydra: live video-synth visuals (Strudel's initHydra({ feedStrudel: 1 }) — s0 is Strudel's own visuals).
// Presets or your own Hydra code. They show in the 🌀 Hydra panel, or behind the code (the code area turns
// see-through). Strudel makes the canvas full-window behind the page; we move it into the place you picked.
// (split out of app.js: start-up code runs in setup(), called from app.js)
import { drawViz, viz } from './visualizer.js';
import { $, clog, load, mirror, save, setupDock, showPanel, ws } from '../app.js';
let hydraState;
const HYDRA_PRESETS = {
  kaleido: 'src(s0).kaleid(H("<4 5 6>"))\n  .diff(osc(1, 0.5, 5))\n  .modulateScale(osc(2, -0.25, 1))\n  .out()',
  tunnel: 'src(o0).scale(1.02).rotate(0.006)\n  .blend(src(s0).kaleid(H("<3 4 6>")), 0.25)\n  .modulate(osc(4, 0.1, 1), 0.02)\n  .out()',
  waves: 'osc(18, 0.03, 1.1).color(0.6, 0.25, 0.9)\n  .modulate(noise(2.5), 0.25)\n  .diff(src(s0))\n  .out()',
  voronoi: 'voronoi(H("<6 8 12>"), 0.3, 0.4)\n  .mult(osc(10, 0.08, 1.4))\n  .modulate(src(s0), 0.3)\n  .out()',
  feedback: 'src(o0).modulateHue(src(o0).scale(1.01), 1)\n  .layer(src(s0).luma(0.15))\n  .out()',
};
const hydraCodeFor = (mode) => (mode === 'custom' ? hydraState.custom : HYDRA_PRESETS[mode]);
async function runHydra(mode = hydraState.mode) {
  hydraState.mode = mode;
  $('hydraMode').value = mode;
  if (mode === 'off') return stopHydra();
  try {
    if (typeof globalThis.initHydra !== 'function') throw new Error('Hydra is not available in this Strudel build');
    await globalThis.initHydra({ feedStrudel: 1, src: '/vendor/hydra/hydra-synth.js' });
    new Function(hydraCodeFor(mode))(); // Hydra's functions (osc, src, s0, o0 …) and Strudel's H() are globals
    hydraState.on = true;
    placeHydra();
    $('hydraMsg').textContent = '▶ running';
  } catch (e) {
    $('hydraMsg').textContent = `⚠ ${e.message}`;
    clog('warn', `🌀 Hydra: ${e.message}`);
  }
}
function stopHydra() {
  try { globalThis.solid?.(0, 0, 0, 0).out(); } catch {}
  document.getElementById('hydra-canvas')?.remove();
  try { globalThis.getDrawContext?.().canvas.style.removeProperty('display'); } catch {} // feedStrudel hid Strudel's own canvas
  hydraState.on = false;
  placeHydra();
}
/** Put the canvas where it shows: in the 🌀 Hydra panel's stage, or behind the code (under the editor). */
function placeHydra() {
  const c = document.getElementById('hydra-canvas');
  const behind = hydraState.on && hydraState.where === 'code';
  document.body.classList.toggle('hydra-on', hydraState.on);
  document.body.classList.toggle('hydra-behind', behind);
  $('hydraEmpty').hidden = hydraState.on && !behind;
  $('hydraEmpty').textContent = behind ? '🌀 showing behind the code (switch “show” to see it here)'
    : 'Pick a visual above. It runs on Strudel’s own visuals (s0), so it moves with the music.';
  if (c) {
    const host = behind ? document.querySelector('#workspace .ws-center') : $('hydraStage');
    if (c.parentElement !== host) host.prepend(c);
  }
  applyHydraMix();
}
function applyHydraMix() {
  const c = document.getElementById('hydra-canvas');
  if (c) c.style.opacity = hydraState.where === 'code' ? $('hydraMix').value : 1;
}

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  hydraState = { on: false, mode: load().hydraMode || 'off', where: load().hydraWhere || 'panel', custom: load().hydraCustom || HYDRA_PRESETS.kaleido };
  $('hydraMode').value = hydraState.mode;
  $('hydraWhere').value = hydraState.where;
  $('hydraWhere').onchange = () => { hydraState.where = $('hydraWhere').value; save({ hydraWhere: hydraState.where }); placeHydra(); };
  $('hydraOpen').onclick = () => showPanel('hydra');
  $('hydraMix').value = load().hydraMix ?? 0.6;
  $('hydraMode').onchange = () => { save({ hydraMode: $('hydraMode').value }); if ($('hydraMode').value !== 'custom' && $('hydraMode').value !== 'off') $('hydraCode').value = hydraCodeFor($('hydraMode').value); runHydra($('hydraMode').value); if (hydraState.where === 'panel' && $('hydraMode').value !== 'off') ws.open('hydra'); };
  $('hydraMix').oninput = () => { applyHydraMix(); save({ hydraMix: Number($('hydraMix').value) }); };
  $('hydraEdit').onclick = () => {
    $('hydraEditor').hidden = !$('hydraEditor').hidden;
    if (!$('hydraEditor').hidden) $('hydraCode').value = hydraCodeFor(hydraState.mode === 'off' ? 'custom' : hydraState.mode) || hydraState.custom;
  };
  $('hydraApply').onclick = () => {
    hydraState.custom = $('hydraCode').value;
    save({ hydraCustom: hydraState.custom, hydraMode: 'custom' });
    runHydra('custom');
  };
  // Hydra needs Strudel loaded: start the saved mode once the editor is ready
  if (hydraState.mode !== 'off') {
    const wait = setInterval(() => { if (typeof globalThis.initHydra === 'function' && mirror()) { clearInterval(wait); runHydra(); } }, 500);
  }

  setupDock('viz', {
    onShow: () => { viz.on = true; cancelAnimationFrame(viz.raf); drawViz(); },
    onHide: () => { viz.on = false; cancelAnimationFrame(viz.raf); },
  });
}
