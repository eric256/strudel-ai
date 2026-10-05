// 🎛 Master panel: the master at a glance — its sections in signal order, each switched on / off (⏻), the 🎚 EQ,
// and what comes out (spectrum, glue / limiter, level). The sections' knobs are in 🔀 Routing, right of the master
// block. features/master-panel.js switches the sections (data-node), opens the EQ / Routing (data-open-eq /
// data-open-route) and draws the canvases — keep those attributes and classes.
import { html } from '../html.js';

/** v: { nodes: [{ group, name, icon, title }] } */
export function masterPanel(v) {
  return html`<div class="ms-glance">
    <div class="ms-chips">
      <button class="ms-eqchip" data-open-eq title="The master's 7-band EQ (first in the chain) — open the 🎚 Equalizer"><canvas class="ms-eqmini" width="70" height="26"></canvas><span class="ms-eqname muted"></span></button>
      ${v.nodes.map((n) => html`<span class="ms-arrow" aria-hidden="true">→</span>
        <button class="ms-chip ms-node" data-group=${n.group} data-node=${n.group} title="${n.title} — click: on / off (off: the sound passes through)">⏻ ${n.icon} ${n.name}</button>`)}
      <button class="ms-route" data-open-route title="Every knob of the master's sections, right of the master block in 🔀 Routing">🔀 edit in Routing ↗</button>
    </div>
    <div class="ms-out-row"><canvas class="ms-spec" width="220" height="70" title="Spectrum of the mastered mix"></canvas>
      <canvas class="ms-gr-meter" width="8" height="70" title="Glue compressor gain reduction (0 … −20 dB)"></canvas>
      <div class="mx-meterbox"><button class="mx-clip ms-clip" data-clip title="Peak: amber near the top, red when it clipped (click to reset)"></button><canvas class="mx-meter ms-out" width="10" height="60" title="Output level"></canvas></div>
      <div class="ms-gr muted"></div></div>
  </div>`;
}
