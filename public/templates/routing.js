// 🔀 Routing: the parts (left), effect nodes wired between them, and the master (right). features/routing.js
// handles the pointer (drag a node, drag from a ● port to wire, click a wire) through the data-* attributes, and
// draws the little scopes (.rt-scope) and live readouts (.rt-sub) — keep those.
import { html, svg } from '../html.js';

/**
 * v: { on, w, h,
 *      parts: [{ id, base, color, x, y, routed }],
 *      nodes: [{ id, type, label, kind, title, summary, x, y, off, dead, unfed, selected }],
 *      master: { x, y, h, db },
 *      wires: [{ from, to, d, kind, selected, implicit }], drag: { d } | null,
 *      sel: null | { node: { id, label, title, off, controls: [{ key, label, min, max, step, value, unit }] } }
 *                | { edge: { from, to, fromLabel, toLabel } },
 *      add: [{ type, label, title }], templates: [{ key, label, title }], targets: [string], target, parts: … }
 * act: { toggle(on), add(type), template(key), target(part), tidy(), clear(), remove(), off(), insert(type) }
 */
export function routing(v, act) {
  const port = (id, dir) => html`<span class="rt-port ${dir}" data-port=${dir} data-id=${id} title=${dir === 'out' ? 'Drag to a node (or the master) to wire it' : 'Input'}></span>`;
  const part = (p) => html`<div class="rt-card rt-part${p.routed ? ' routed' : ''}" data-id=${p.id} data-in="0" style="left:${p.x}px;top:${p.y}px;--c:${p.color}"
      title="${p.base}: after its 🎚 mixer fader${p.routed ? '' : ' — straight to the master (drag from ● to route it)'}">
      <b>${p.base}</b><span class="rt-sub" data-id=${p.id}>${p.routed ? 'routed' : 'direct'}</span><canvas class="rt-scope" data-id=${p.id} width="128" height="18"></canvas>${port(p.id, 'out')}</div>`;
  const node = (n) => html`<div class="rt-card rt-node k-${n.kind}${n.selected ? ' sel' : ''}${n.off ? ' off' : ''}${n.dead ? ' dead' : ''}" data-id=${n.id} data-in="1" data-drag="1"
      style="left:${n.x}px;top:${n.y}px" title="${n.title}${n.dead ? ' — ⚠ not wired to the master: you won’t hear it' : n.unfed ? ' — nothing goes in yet' : ''}">
      ${port(n.id, 'in')}<b>${n.label}${n.off ? ' ⏻' : ''}${n.dead ? ' ⚠' : ''}</b><span class="rt-sub" data-id=${n.id}>${n.summary}</span>
      <canvas class="rt-scope" data-id=${n.id} width="128" height="18"></canvas>${port(n.id, 'out')}</div>`;
  const sel = v.sel;
  return html`<div class="rt">
    <div class="rt-bar">
      <label title="Off: every part goes straight to the master (A / B)"><input type="checkbox" .checked=${v.on} @change=${(e) => act.toggle(e.target.checked)}> routing on</label>
      <span class="rt-add">＋ ${v.add.map((a) => html`<button title=${a.title} @click=${() => act.add(a.type)}>${a.label}</button>`)}</span>
      <span class="rt-tpl" title="A ready-made chain for a part (its routing is replaced)">
        <select @change=${(e) => act.target(e.target.value)}>${v.targets.map((t) => html`<option ?selected=${t === v.target}>${t}</option>`)}</select>
        ${v.templates.map((t) => html`<button title=${t.title} @click=${() => act.template(t.key)}>${t.label}</button>`)}
      </span>
      <span class="rt-right"><button class="link" title="Lay the graph out again" @click=${act.tidy}>tidy</button>
        <button class="link" title="Remove all routing: every part straight to the master" @click=${act.clear}>clear</button></span>
    </div>
    <div class="rt-main">
      <div class="rt-scroll"><div class="rt-canvas" style="width:${v.w}px;height:${v.h}px">
        <svg class="rt-wires" width=${v.w} height=${v.h}>${v.wires.map((w) => svg`<g class="rt-wire k-${w.kind}${w.selected ? ' sel' : ''}${w.implicit ? ' implicit' : ''}">
            <path class="hit" d=${w.d} data-from=${w.from} data-to=${w.to}></path><path class="line" d=${w.d}></path></g>`)}
          ${v.drag ? svg`<path class="rt-wire-temp" d=${v.drag.d}></path>` : ''}</svg>
        ${v.parts.map(part)}${v.nodes.map(node)}
        <div class="rt-card rt-master" data-id="master" data-in="1" style="left:${v.master.x}px;top:${v.master.y}px;height:${v.master.h}px" title="The master: on to 🎛 Master (double-click to open it)">
          ${port('master', 'in')}<b>Master</b><span class="rt-sub" data-id="master">${v.master.db}</span>
          <div class="rt-mmeter"><i></i></div><canvas class="rt-scope" data-id="master" width="128" height="18"></canvas></div>
      </div></div>
      <div class="rt-insp">${sel?.node ? html`
          <div class="rt-insp-head"><b>${sel.node.label}</b><span class="muted small">${sel.node.title}</span></div>
          <div class="rt-knobs">${sel.node.controls.length ? sel.node.controls.map((c) => html`<sa-knob data-p=${c.key} label=${c.label} min=${c.min} max=${c.max} step=${c.step} default=${c.def} .value=${String(c.value)}
              title="${c.label}${c.unit ? ` (${c.unit})` : ''} — double-click: default"></sa-knob>`) : html`<span class="muted small">no settings: it ${sel.node.label === 'Split' ? 'copies the sound to every wire out' : 'adds what comes in'}</span>`}</div>
          <div class="rt-insp-btns"><button class=${sel.node.off ? 'on' : ''} title="Bypass: the sound passes through untouched" @click=${act.off}>⏻ ${sel.node.off ? 'off' : 'on'}</button>
            <button title="Remove it (what fed it then feeds what it fed)" @click=${act.remove}>✕ remove</button></div>`
        : sel?.edge ? html`
          <div class="rt-insp-head"><b>Wire</b><span class="muted small">${sel.edge.fromLabel} → ${sel.edge.toLabel}</span></div>
          <div class="rt-insert">insert: ${v.add.map((a) => html`<button title=${a.title} @click=${() => act.insert(a.type)}>${a.label}</button>`)}</div>
          <div class="rt-insp-btns"><button @click=${act.remove}>✕ remove wire</button></div>`
        : html`<div class="muted small rt-help">
          <p>Each part comes out of its 🎚 mixer fader on the left. Drag from a <b>●</b> to a node or the master to wire it; a part you wire stops going straight to the master.</p>
          <p><b>＋</b> adds a node (after the selected node, or into the selected wire). <b>Split</b> sends the sound down parallel paths, <b>Sum</b> adds them back — wire several parts into one Sum for a bus.</p>
          <p>Click a node for its knobs, a wire to insert into or remove it. Delete removes the selection. Or start from a ready-made chain for a part.</p></div>`}</div>
    </div>
  </div>`;
}
