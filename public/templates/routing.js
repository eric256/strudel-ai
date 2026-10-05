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
 * A card's inside, as HTML text (Drawflow, which draws the canvas, takes HTML).
 * c: { id, label, sub, title, master, off, controls: [{ key, label, min, max, step, def, value, unit }] | null }
 * The scope (.rt-scope) and the readout (.rt-sub) are drawn / updated by features/routing.js — keep their data-id;
 * the knobs (data-node, data-p) and the ⏻ switch (.rt-pow[data-node]) are handled there too.
 */
export function routingCard(c) {
  const knob = (k) => `<sa-knob stack data-node="${esc(c.id)}" data-p="${esc(k.key)}" label="${esc(k.label)}" min="${k.min}" max="${k.max}" step="${k.step}" default="${k.def}" value="${k.value}"
    title="${esc(k.label)}${k.unit ? ` (${esc(k.unit)})` : ''} — drag up / down (Shift: fine), double-click: default"></sa-knob>`;
  return `<div class="rt-in" title="${esc(c.title)}"><div class="rt-head"><b>${esc(c.label)}</b>${c.controls
    ? `<button class="rt-pow${c.off ? ' off' : ''}" data-node="${esc(c.id)}" title="${c.off ? 'Off (bypassed): click to switch it on' : 'On: click to bypass it (the sound passes through)'}">⏻</button>` : ''}</div>
    <span class="rt-sub" data-id="${esc(c.id)}">${esc(c.sub)}</span>${
    c.controls?.length ? `<div class="rt-knobs-on">${c.controls.map(knob).join('')}</div>` : ''}${
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
        <span class="rt-zoom"><button title="Zoom out (Ctrl + wheel)" @click=${() => act.zoom(-1)}>−</button><button title="Fit: the whole graph in view" @click=${() => act.zoom(0)}>⟲</button><button title="Zoom in (Ctrl + wheel)" @click=${() => act.zoom(1)}>＋</button></span>
        <button class="link" title="Lay the graph out again" @click=${act.tidy}>tidy</button>
        <button class="link" title="Remove all routing: every part straight to the master" @click=${act.clear}>clear</button></span>
    </div>
    <div class="rt-main">
      <div class="rt-df" tabindex="0"></div>
      <div class="rt-insp">${sel?.node ? html`
          <div class="rt-insp-head"><b>${sel.node.label}</b><span class="muted small">${sel.node.title}</span></div>
          <div class="muted small">${sel.node.controls.length ? 'Its knobs are on the node: drag up / down (Shift: fine), double-click for the default.' : sel.node.label === 'Split' ? 'No settings: it copies the sound to both of its outputs.' : 'No settings: it adds what comes into it.'}</div>
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
          <p>Turn the knobs on a node to shape it; ⏻ bypasses it. Click a wire to insert into it or remove it; Delete removes the selection. Drag the background to move around, Ctrl + wheel to zoom, ⟲ to fit it all in. Or start from a ready-made chain for a part.</p></div>`}</div>
    </div>
  </div>`;
}
