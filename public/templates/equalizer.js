// 🎚 Equalizer: 7 bands for the master or one mixer channel — a response curve over the live spectrum, a fader per
// band, presets. features/equalizer.js draws the curve canvas (.eq-curve).
import { html } from '../html.js';

/**
 * v: { target, targets: [{ value, label }], bands: [{ i, label, f, gain }], preset, presets: [{ key, label, title }], flat }
 * act: { target(value), band(i, dB), preset(key) }
 */
export function equalizer(v, act) {
  return html`<div class="eq">
    <div class="eq-bar">
      <label title="What this EQ works on">on <select @change=${(e) => act.target(e.target.value)}>${v.targets.map((t) => html`<option value=${t.value} ?selected=${t.value === v.target}>${t.label}</option>`)}</select></label>
      <span class="eq-presets">${v.presets.map((p) => html`<button class=${p.key === v.preset ? 'on' : ''} title=${p.title || ''} @click=${() => act.preset(p.key)}>${p.label}</button>`)}</span>
    </div>
    <div class="eq-body">
      <canvas class="eq-curve" width="560" height="170" title="The EQ's response (line) over the live spectrum"></canvas>
      <div class="eq-bands">${v.bands.map((b) => html`<div class="eq-band">
        <span class="eq-gain${b.gain ? ' on' : ''}">${b.gain > 0 ? '+' : ''}${b.gain}</span>
        <sa-fader linear data-i=${b.i} min="-12" max="12" step="0.5" default="0" marks="12,6,0,-6,-12" .value=${String(b.gain)}
          title="${b.label} Hz — double-click: 0 dB" @input=${(e) => act.band(b.i, Number(e.target.value))}></sa-fader>
        <span class="eq-f">${b.label}</span></div>`)}</div>
    </div>
  </div>`;
}
