// 🔲 Pads: the 4×4 grid. features/pads.js handles the buttons by their data-i.
import { html } from '../html.js';

/** pads: [{ i, label, mode, code, color, on, pending, selected }] */
export function padsGrid(pads) {
  return html`${pads.map((p) => html`<button class="pad${p.on ? ' on' : ''}${p.pending ? ' pending' : ''}${p.selected ? ' selected' : ''}" data-i=${p.i}
      style="--pc:${p.color || '#7c5cff'}" title="${p.label} · ${p.mode}\n${p.code}">
      <span class="pad-label">${p.label || `pad ${p.i + 1}`}</span><span class="pad-mode">${p.mode === 'toggle' ? '' : p.mode}</span></button>`)}`;
}
