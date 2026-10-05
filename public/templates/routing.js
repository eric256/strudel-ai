// 🔀 Routing: the toolbar, the canvas (.rt-df, drawn by Drawflow — features/routing.js puts the parts, the nodes,
// the master and the wires in it; routingCard below is a card's inside) and the inspector of what's selected.
import { html } from '../html.js';

/**
 * v: { on,
 *      sel: null | { node: { id, label, title, off, controls: [{ key, label, min, max, step, def, value, unit }] } }
 *                | { part: { base, routed } } | { master: { name, style } } | { edge: { from, to, fromLabel, toLabel } },
 *      add: [{ type, label, title }], templates: [{ key, label, title }], targets: [string], target }
 * act: { toggle(on), add(type), template(key), target(part), tidy(), clear(), remove(), off(), insert(type), zoom(-1 | 0 | 1) }
 */
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const attrs = (o) => Object.entries(o || {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
/**
 * A card's inside, as HTML text (Drawflow, which draws the canvas, takes HTML).
 * c: { id, label, sub, title, off, scope (default true), meter, openEq,
 *      controls: [{ key, label, min, max, step, def, value, unit, data }] | null, pow: { data } | null }
 * A knob's data (default { node: id, p: key }) and the ⏻ switch's (default { node: id }) say what they set:
 * features/routing.js handles them, draws the scope (.rt-scope) and updates the readout (.rt-sub) — keep data-id.
 */
export function routingCard(c) {
  const knob = (k) => `<sa-knob stack${attrs(k.data || { node: c.id, p: k.key })} label="${esc(k.label)}" min="${k.min}" max="${k.max}" step="${k.step}" default="${k.def}" value="${k.value}"
    title="${esc(k.title || k.label)}${k.unit ? ` (${esc(k.unit)})` : ''} — drag up / down (Shift: fine), double-click: default"></sa-knob>`;
  const pow = c.controls && c.pow !== null
    ? `<button class="rt-pow${c.off ? ' off' : ''}"${attrs(c.pow?.data || { node: c.id })} title="${c.off ? 'Off (bypassed): click to switch it on' : 'On: click to bypass it (the sound passes through)'}">⏻</button>` : '';
  const eq = c.openEq ? `<button class="rt-pow rt-open" data-open-eq="${esc(c.openEq)}" title="Open it in the 🎚 Equalizer: its curve over the sound, and presets">↗</button>` : '';
  return `<div class="rt-in" title="${esc(c.title)}"><div class="rt-head"><b>${esc(c.label)}</b>${eq}${pow}</div>
    <span class="rt-sub" data-id="${esc(c.id)}">${esc(c.sub)}</span>${
    c.controls?.length ? `<div class="rt-knobs-on">${c.controls.map(knob).join('')}</div>` : ''}${
    c.meter ? '<div class="rt-mmeter"><i></i></div>' : ''}${c.scope === false ? '' : `<canvas class="rt-scope" data-id="${esc(c.id)}" width="128" height="18"></canvas>`}</div>`;
}

/**
 * The master block's inside: a row per input (a channel coming in), at the height its wire comes in — its name,
 * fader (dB) and pan knobs, mute / solo, and a level line. m: { rows: [{ key, label, title, color, top, db, pan, mute,
 * solo, bus }], sub }. The knobs (data-row, data-k) and buttons (data-row, data-mx) are handled by features/routing.js.
 */
export function routingMaster(m) {
  const row = (r) => `<div class="rt-mrow${r.bus ? ' bus' : ''}" style="top:${r.top}px;--c:${esc(r.color)}" title="${esc(r.title)}">
      <span class="rt-mname">${esc(r.label)}</span>
      <sa-knob stack data-row="${esc(r.key)}" data-k="vol" label="dB" min="-60" max="6" step="0.5" default="0" value="${r.db}" title="Its fader into the master (dB) — double-click: 0 dB"></sa-knob>
      <sa-knob stack data-row="${esc(r.key)}" data-k="pan" label="pan" min="-1" max="1" step="0.05" default="0" value="${r.pan}" title="Pan — double-click: centre"></sa-knob>
      <span class="rt-mbtns"><button data-row="${esc(r.key)}" data-mx="mute" class="m${r.mute ? ' on' : ''}" title="Mute">M</button>${r.bus ? '' : `<button data-row="${esc(r.key)}" data-mx="solo" class="s${r.solo ? ' on' : ''}" title="Solo">S</button>`}</span>
      <canvas class="rt-scope rt-rowscope" data-id="row:${esc(r.key)}" width="60" height="16"></canvas></div>`;
  return `<div class="rt-in rt-min" title="The master: every channel comes in on its own row (its fader, pan, mute / solo), they're summed, and the master's sections (right) finish the mix"><div class="rt-head"><b>Master</b></div>
    <span class="rt-sub" data-id="master">${esc(m.sub)}</span>${m.rows.map(row).join('')}</div>`;
}

/**
 * The master's effects, all on one block: a group per section (its name, ⏻, knobs), wrapped in a grid.
 * fx: { sub, groups: [{ id, label, title, off, pow: { data } | null, openEq, controls: [{ … data }] }] }
 */
export function routingMasterFx(fx) {
  const knob = (k) => `<sa-knob stack${attrs(k.data)} label="${esc(k.label)}" min="${k.min}" max="${k.max}" step="${k.step}" default="${k.def}" value="${k.value}"
    title="${esc(k.title || k.label)}${k.unit ? ` (${esc(k.unit)})` : ''} — drag up / down (Shift: fine), double-click: the style's value"></sa-knob>`;
  const group = (g) => `<div class="rt-fxg${g.off ? ' off' : ''}" data-group="${esc(g.id)}" title="${esc(g.title)}"><div class="rt-head"><b>${esc(g.label)}</b>${
    g.openEq ? `<button class="rt-pow rt-open" data-open-eq="${esc(g.openEq)}" title="Open it in the 🎚 Equalizer: its curve and presets">↗</button>` : ''}${
    g.pow ? `<button class="rt-pow${g.off ? ' off' : ''}"${attrs(g.pow.data)} title="${g.off ? 'Off: click to switch it on' : 'On: click to switch it off (the sound passes through)'}">⏻</button>` : ''}</div>
    <div class="rt-knobs-on">${g.controls.map(knob).join('')}</div></div>`;
  return `<div class="rt-in rt-fxin" title="The master's effects, in signal order (left to right, top to bottom) — they follow 🎛 Master's style"><div class="rt-head"><b>🎛 Master FX</b></div>
    <span class="rt-sub" data-id="mfx">${esc(fx.sub)}</span><div class="rt-fxgrid">${fx.groups.map(group).join('')}</div></div>`;
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
      <div class="parent-drawflow rt-df" tabindex="0"></div><!-- (Drawflow reads the first class to know a drag on the background pans) -->
      <div class="rt-insp">${sel?.node ? html`
          <div class="rt-insp-head"><b>${sel.node.label}</b><span class="muted small">${sel.node.title}</span></div>
          <div class="muted small">${sel.node.controls.length ? 'Its knobs are on the node: drag up / down (Shift: fine), double-click for the default.' : sel.node.label === 'Split' ? 'No settings: it copies the sound to both of its outputs.' : 'No settings: it adds what comes into it.'}</div>
          <div class="rt-insp-btns"><button class=${sel.node.off ? 'on' : ''} title="Bypass: the sound passes through untouched" @click=${act.off}>⏻ ${sel.node.off ? 'off' : 'on'}</button>
            <button title="Remove it (what fed it then feeds what it fed)" @click=${act.remove}>✕ remove</button></div>`
        : sel?.part ? html`
          <div class="rt-insp-head"><b>${sel.part.base}</b><span class="muted small">${sel.part.routed ? 'routed through the nodes it’s wired to' : 'straight to the master'}</span></div>
          <div class="rt-insert">＋ add after it: ${v.add.map((a) => html`<button title=${a.title} @click=${() => act.add(a.type)}>${a.label}</button>`)}</div>
          ${sel.part.routed ? html`<div class="rt-insp-btns"><button title="Take its routing out: straight to the master again" @click=${act.remove}>✕ unroute</button></div>` : ''}`
        : sel?.master ? html`
          <div class="rt-insp-head"><b>${sel.master.name}</b><span class="muted small">The master (style: ${sel.master.style}). Each channel comes in on its own row with its fader, pan, mute and solo — the 🎚 Mixer's strips; then the master's sections, left to right. Their knobs follow 🎛 Master's style; ⏻ switches a section off.</span></div>`
        : sel?.edge ? html`
          <div class="rt-insp-head"><b>Wire</b><span class="muted small">${sel.edge.fromLabel} → ${sel.edge.toLabel}</span></div>
          <div class="rt-insert">insert: ${v.add.map((a) => html`<button title=${a.title} @click=${() => act.insert(a.type)}>${a.label}</button>`)}</div>
          <div class="rt-insp-btns"><button @click=${act.remove}>✕ remove wire</button></div>`
        : html`<div class="muted small rt-help">
          <p>Each part comes out of its 🎚 mixer fader on the left. <b>Click a part, then ＋ an effect:</b> it goes part → effect → master. Click that effect and ＋ another: it goes in after it.</p>
          <p><b>Split</b> comes with its <b>Sum</b>: two parallel paths (the second is the one ＋ adds to). Wire several parts into one Sum for a bus. Drag from a <b>●</b> to wire by hand.</p>
          <p><b>After the mix:</b> click the Master (or Master FX) and ＋ an effect to put it on the whole mix; click Out and ＋ to put one just before the speakers. Wire around Master FX, or in parallel, like anywhere else.</p>
          <p>Turn the knobs on a node to shape it; ⏻ bypasses it. Click a wire to insert into it or remove it; Delete removes the selection. Drag the background to move around, Ctrl + wheel to zoom, ⟲ to fit it all in. Or start from a ready-made chain for a part.</p></div>`}</div>
    </div>
  </div>`;
}
