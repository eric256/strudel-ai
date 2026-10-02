// 🎛 Master panel: the controls of the master chain, grouped by module, and the output scope.
// features/master-panel.js sets the values by hand (input value, .ms-val text) — keep .ms-val empty here, and keep
// the data-k / data-v attributes and the canvas classes it draws on.
import { html } from '../html.js';

/** groups: [{ name, controls: [{ key, label, title, min, max, step }] }] */
export function masterPanel(groups) {
  const ctl = (d) => html`<div class="ms-ctl" title="${d.title} — double-click: the style's value">
      <input type="range" class="mx-v ms-v" data-k=${d.key} min=${d.min} max=${d.max} step=${d.step} />
      <span class="ms-val" data-v=${d.key}></span><span class="ms-lbl">${d.label}</span></div>`;
  return html`${groups.map((g) => html`<div class="ms-mod"><div class="ms-title">${g.name}</div><div class="ms-ctls">${g.controls.map(ctl)}</div></div>`)}
    <div class="ms-mod ms-scope"><div class="ms-title">Output <span class="ms-gr muted"></span></div>
      <div class="ms-ctls"><canvas class="ms-spec" width="220" height="96" title="Spectrum of the mastered mix"></canvas>
      <div class="ms-meters"><canvas class="ms-gr-meter" width="8" height="96" title="Glue compressor gain reduction (0 … −20 dB)"></canvas><canvas class="mx-meter ms-out" width="10" height="96" title="Output level"></canvas></div></div></div>`;
}
