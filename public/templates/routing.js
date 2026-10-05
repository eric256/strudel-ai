// 🔀 Routing: the toolbar, the canvas (.rt-df, drawn by Drawflow — features/routing.js puts the parts, the nodes,
// the master and the wires in it; routingCard below is a card's inside) and the inspector of what's selected.
import { html } from '../html.js';

/**
 * v: { on,
 *      sel: null | { node: { id, label, title, off, controls: [{ key, label, min, max, step, def, value, unit }] } }
 *                | { part: { base, routed } } | { edge: { from, to, fromLabel, toLabel } },
 *      add: [{ type, label, title }], templates: [{ key, label, title }], targets: [string], target }
 * act: { toggle(on), add(type), template(key), target(part), tidy(), clear(), remove(), off(), insert(type), zoom(-1 | 0 | 1) }
 */
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/**
 * A card's inside, as HTML text (Drawflow, which draws the canvas, takes HTML). c: { id, label, sub, title, master }
 * The scope (.rt-scope) and the readout (.rt-sub) are drawn / updated by features/routing.js — keep their data-id.
 */
export function routingCard(c) {
  return `<div class="rt-in" title="${esc(c.title)}"><b>${esc(c.label)}</b><span class="rt-sub" data-id="${esc(c.id)}">${esc(c.sub)}</span>${
    c.master ? '<div class="rt-mmeter"><i></i></div>' : ''}<canvas class="rt-scope" data-id="${esc(c.id)}" width="128" height="18"></canvas></div>`;
}

export function routing(v, act) {
  const sel = v.sel;
  return html`<div class="rt">
    <div class="rt-bar">
      <label title="Off: every part goes straight to the master (A / B)"><input type="checkbox" .checked=${v.on} @change=${(e) => act.toggle(e.target.checked)}> routing on</label>
      <span class="rt-add">＋ ${v.add.map((a) => html`<button title=${a.title} @click=${() => act.add(a.type)}>${a.label}</button>`)}</span>
      <span class="rt-tpl" title="A ready-made chain for a part (its routing is replaced)">
        <select @change=${(e) => act.target(e.target.value)}>${v.targets.map((t) => html`<option ?selected=${t === v.target}>${t}</option>`)}</select>
        ${v.templates.map((t) => html`<button title=${t.title} @click=${() => act.template(t.key)}>${t.label}</button>`)}
      </span>
      <span class="rt-right">
        <span class="rt-zoom"><button title="Zoom out (Ctrl + wheel)" @click=${() => act.zoom(-1)}>−</button><button title="Zoom back to 100 % and the start" @click=${() => act.zoom(0)}>⟲</button><button title="Zoom in (Ctrl + wheel)" @click=${() => act.zoom(1)}>＋</button></span>
        <button class="link" title="Lay the graph out again" @click=${act.tidy}>tidy</button>
        <button class="link" title="Remove all routing: every part straight to the master" @click=${act.clear}>clear</button></span>
    </div>
    <div class="rt-main">
      <div class="rt-df" tabindex="0"></div>
      <div class="rt-insp">${sel?.node ? html`
          <div class="rt-insp-head"><b>${sel.node.label}</b><span class="muted small">${sel.node.title}</span></div>
          <div class="rt-knobs">${sel.node.controls.length ? sel.node.controls.map((c) => html`<sa-knob data-p=${c.key} label=${c.label} min=${c.min} max=${c.max} step=${c.step} default=${c.def} .value=${String(c.value)}
              title="${c.label}${c.unit ? ` (${c.unit})` : ''} — double-click: default"></sa-knob>`) : html`<span class="muted small">no settings: it ${sel.node.label === 'Split' ? 'copies the sound to every wire out' : 'adds what comes in'}</span>`}</div>
          <div class="rt-insp-btns"><button class=${sel.node.off ? 'on' : ''} title="Bypass: the sound passes through untouched" @click=${act.off}>⏻ ${sel.node.off ? 'off' : 'on'}</button>
            <button title="Remove it (what fed it then feeds what it fed)" @click=${act.remove}>✕ remove</button></div>`
        : sel?.part ? html`
          <div class="rt-insp-head"><b>${sel.part.base}</b><span class="muted small">${sel.part.routed ? 'routed through the nodes it’s wired to' : 'straight to the master'}</span></div>
          <div class="rt-insert">＋ add after it: ${v.add.map((a) => html`<button title=${a.title} @click=${() => act.add(a.type)}>${a.label}</button>`)}</div>
          ${sel.part.routed ? html`<div class="rt-insp-btns"><button title="Take its routing out: straight to the master again" @click=${act.remove}>✕ unroute</button></div>` : ''}`
        : sel?.edge ? html`
          <div class="rt-insp-head"><b>Wire</b><span class="muted small">${sel.edge.fromLabel} → ${sel.edge.toLabel}</span></div>
          <div class="rt-insert">insert: ${v.add.map((a) => html`<button title=${a.title} @click=${() => act.insert(a.type)}>${a.label}</button>`)}</div>
          <div class="rt-insp-btns"><button @click=${act.remove}>✕ remove wire</button></div>`
        : html`<div class="muted small rt-help">
          <p>Each part comes out of its 🎚 mixer fader on the left. <b>Click a part, then ＋ an effect:</b> it goes part → effect → master. Click that effect and ＋ another: it goes in after it.</p>
          <p><b>Split</b> comes with its <b>Sum</b>: two parallel paths (the second is the one ＋ adds to). Wire several parts into one Sum for a bus. Drag from a <b>●</b> to wire by hand.</p>
          <p>Click a node for its knobs, a wire to insert into or remove it. Delete removes the selection. Drag the background to move around, Ctrl + wheel to zoom. Or start from a ready-made chain for a part.</p></div>`}</div>
    </div>
  </div>`;
}
