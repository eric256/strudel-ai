// 🎛 Master panel: the master chain as nodes in signal order — 🎚 Equalizer → Tone → Filter → Colour → Space → Echo →
// Dynamics → Output — each with its knobs and an on / off switch (⏻). features/master-panel.js sets the knob values
// by hand (data-k), switches the nodes (data-node) and draws the canvases — keep those attributes and classes.
import { html } from '../html.js';

/**
 * v: { nodes: [{ group, name, icon, title, controls: [{ key, label, title, min, max, step, unit }] }] }
 * The Output node also has the spectrum, the glue / limiter meter, the output meter and its clip LED.
 */
export function masterPanel(v) {
  const knob = (d) => html`<sa-knob data-k=${d.key} label=${d.label} min=${d.min} max=${d.max} step=${d.step} title="${d.title} — double-click: the style's value"></sa-knob>`;
  const node = (n) => html`<div class="ms-node" data-group=${n.group} title=${n.title}>
      <div class="ms-node-head"><button class="ms-pow" data-node=${n.group} title="Switch ${n.name} on / off (off: the sound passes through)">⏻</button><b>${n.icon} ${n.name}</b></div>
      <div class="ms-knobs">${n.controls.map(knob)}</div>
      ${n.group === 'Output' ? html`<div class="ms-out-row"><canvas class="ms-spec" width="150" height="70" title="Spectrum of the mastered mix"></canvas>
        <canvas class="ms-gr-meter" width="8" height="70" title="Glue compressor gain reduction (0 … −20 dB)"></canvas>
        <div class="mx-meterbox"><button class="mx-clip ms-clip" data-clip title="Peak: amber near the top, red when it clipped (click to reset)"></button><canvas class="mx-meter ms-out" width="10" height="60" title="Output level"></canvas></div></div>
        <div class="ms-gr muted"></div>` : ''}
    </div>`;
  return html`<div class="ms-chain">
    <div class="ms-node ms-eqnode" title="Your 7-band EQ, first in the chain">
      <div class="ms-node-head"><b>🎚 EQ</b></div>
      <canvas class="ms-eqmini" width="110" height="44"></canvas>
      <div class="ms-eqname muted"></div>
      <button class="ms-openeq" data-open-eq title="Open the 🎚 Equalizer on the master">7 bands ↗</button>
    </div>
    ${v.nodes.map((n) => html`<span class="ms-wire" aria-hidden="true"></span>${node(n)}`)}
  </div>`;
}
