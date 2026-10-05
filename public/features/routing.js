// ---------------------------------------------------------------------------
// 🔀 Routing: each part's sound after its mixer fader, through a graph of effect nodes — parallel paths (Split /
// Sum), compression, saturation, EQ, filter, reverb, delay, buses of several parts — to the master. The graph and
// its rules are lib/routing.js, the audio blocks routing-audio.js; this module builds the audio between the
// mixer's channels (features/mixer.js) and the master, and runs the panel. Kept per part name in the browser,
// like the mixer.
// ---------------------------------------------------------------------------
import { $, addMsg, docks, isPlaying, load, save, setupDock, ws } from '../app.js';
import { render } from '../html.js';
import { T, onTemplatesChange } from '../templates/index.js';
import {
  NODE_TYPES, SINK, TEMPLATES, addNode, canConnect, connect, deadEnds, edgeKey, freeInput, inPorts, layoutGraph, nodeSummary,
  normGraph, outPorts, partOf, removeEdge, removeNode, routedParts, srcId, unfed, unplace, unroutePart,
} from '../lib/routing.js';
import { createBlock } from '../routing-audio.js';
import { channelHooks, channelIfAny, mixerChannels, sdController } from './mixer.js';
import { masterChain } from './master-panel.js';
import { vizColor } from './visualizer.js';
import { themeColor } from '../theme.js';

export const routing = {
  graph: { nodes: [], edges: [] }, on: true, sel: null, target: '',
  live: null,       // the audio: { ctrl, bus, blocks: { id: block }, wired: [[a, b]], closed: [part] }
  df: null,         // the canvas (Drawflow)
  raf: 0, hist: {},
};
const saveRouting = () => save({ routing: { graph: routing.graph, on: routing.on } });

// ---- audio ----
function ctxOf(ctrl) { return ctrl?.output?.channelMerger?.context || null; }
/** Take the audio graph down: channels go straight to the master again. */
function tearDown() {
  const L = routing.live;
  if (!L) return;
  for (const [a, b] of L.wired) { try { a.disconnect(b); } catch {} }
  for (const b of Object.values(L.blocks)) b.dispose();
  for (const p of L.closed) { const ch = channelIfAny(p); if (ch) ch.direct.gain.setTargetAtTime(1, ch.direct.context.currentTime, 0.01); }
  routing.live = null;
}
/** Build the audio for the graph (again): a block per node, the wires, and the routed parts' direct path closed. */
export function applyRouting() {
  tearDown();
  const ctrl = sdController(), ac = ctxOf(ctrl);
  if (!ctrl || !ac || !routing.on || !routing.graph.edges.length) return;
  // the bus into the master: one per audio engine (through 🎛 Master like everything else)
  if (!ctrl.output.__routeBus || ctrl.output.__routeBus.context !== ac) {
    ctrl.output.__routeBus = new GainNode(ac);
    ctrl.output.connectToDestination(ctrl.output.__routeBus, [0, 1]);
  }
  const L = { ctrl, bus: ctrl.output.__routeBus, blocks: {}, wired: [], closed: [] };
  for (const n of routing.graph.nodes) L.blocks[n.id] = createBlock(ac, n);
  const outOf = (id) => (partOf(id) != null ? channelIfAny(partOf(id))?.gain : L.blocks[id]?.output);
  const inOf = (id) => (id === SINK ? L.bus : L.blocks[id]?.input);
  for (const e of routing.graph.edges) {
    const a = outOf(e.from), b = inOf(e.to);
    if (!a || !b) continue;
    a.connect(b);
    L.wired.push([a, b]);
  }
  for (const p of routedParts(routing.graph)) {
    const ch = channelIfAny(p);
    if (!ch) continue;
    ch.direct.gain.setTargetAtTime(0, ac.currentTime, 0.01);
    L.closed.push(p);
  }
  routing.live = L;
}
// a new channel (a part's first note): wire it in if it's routed
channelHooks.add((base) => { if (routing.on && routedParts(routing.graph).includes(base)) queueMicrotask(applyRouting); });

/** Change the graph: structure changes rebuild the audio, a node's values only update its block. */
function setGraph(g, { rebuild = true } = {}) {
  routing.graph = normGraph(g);
  if (rebuild) applyRouting();
  saveRouting();
  renderRouting();
}
function setParam(id, key, value) {
  const n = routing.graph.nodes.find((x) => x.id === id);
  if (!n) return;
  n.params = { ...n.params, [key]: value };
  routing.graph = normGraph(routing.graph);
  const nn = routing.graph.nodes.find((x) => x.id === id);
  routing.live?.blocks[id]?.set(nn.params, nn.off);
  saveRouting();
  const sub = $('routeBody')?.querySelector(`.rt-sub[data-id="${id}"]`);
  if (sub) sub.textContent = nodeSummary(routing.graph, nn);
}

// ---- the panel: the toolbar and inspector (lit), the canvas (Drawflow) ----
// The graph (lib/routing.js) is the truth; Drawflow only shows it. Every change of the graph redraws the canvas from
// it, and what you do on the canvas (wire, move, select, remove) comes back through Drawflow's events, is checked
// against the graph's rules, and redraws — so a wire that isn't allowed (a loop, into a part) just doesn't stay.
const label = (id) => (id === SINK ? 'master' : partOf(id) ?? (routing.graph.nodes.find((n) => n.id === id) ? NODE_TYPES[routing.graph.nodes.find((n) => n.id === id).type].label : id));
const typeOfId = (id) => routing.graph.nodes.find((n) => n.id === id)?.type;
// a card: 150 × 76 (style.css); one with knobs is taller, and wider for each knob past four
const CARD_W = 150, CARD_H = 76, KNOB_H = 120, KNOB_W = 40;
const cardSize = (type) => { const k = Object.keys(NODE_TYPES[type]?.params || {}).length; return k ? { w: Math.max(CARD_W, 22 + k * KNOB_W), h: KNOB_H } : { w: CARD_W, h: CARD_H }; };

const act = {
  toggle(on) { routing.on = on; applyRouting(); saveRouting(); renderRouting(); },
  add(type) {
    // after the selected part or node, into the selected wire — nothing selected: after the part picked in the bar
    const s = routing.sel;
    const part = routing.target || mixerChannels()[0]?.base;
    const opts = s?.edge ? { onEdge: s.edge } : s?.node && s.node !== SINK ? { after: s.node } : part ? { after: srcId(part) } : {};
    const { graph, id } = addNode(routing.graph, type, opts);
    routing.sel = { node: id };
    setGraph(graph);
  },
  insert(type) { act.add(type); },
  template(key) {
    const t = TEMPLATES[key];
    const chans = mixerChannels();
    const parts = t.needs === 'parts' ? t.pick(chans) : [routing.target || chans[0]?.base].filter(Boolean);
    if (!parts.length) { flash(t.needs === 'parts' ? 'no drum parts here' : 'no part to route'); return; }
    routing.sel = null;
    setGraph(t.build(routing.graph, parts));
  },
  target(p) { routing.target = p; },
  tidy() { setGraph(unplace(routing.graph), { rebuild: false }); }, // (parts go back to their column too)
  clear() { routing.sel = null; setGraph({ nodes: [], edges: [] }); },
  remove() {
    const s = routing.sel;
    if (!s) return;
    routing.sel = null;
    if (s.node === SINK) renderRouting();
    else if (s.node && partOf(s.node) != null) setGraph(unroutePart(routing.graph, partOf(s.node)));
    else if (s.node) setGraph(removeNode(routing.graph, s.node));
    else if (s.edge) setGraph(removeEdge(routing.graph, s.edge));
  },
  off(id = routing.sel?.node) {
    const n = routing.graph.nodes.find((x) => x.id === id);
    if (!n) return;
    n.off = !n.off;
    routing.live?.blocks[n.id]?.set(n.params, n.off);
    saveRouting();
    renderRouting();
  },
  zoom(dir) {
    const df = routing.df;
    if (!df) return;
    if (dir > 0) df.zoom_in();
    else if (dir < 0) df.zoom_out();
    else fitCanvas(df);
  },
};
const flash = (msg) => addMsg('info', `🔀 ${msg}`);

/** The parts on the canvas: every mixer channel, and parts the graph routes that aren't playing now. */
function partsNow() {
  const parts = mixerChannels().map((c) => c.base);
  for (const p of routedParts(routing.graph)) if (!parts.includes(p)) parts.push(p);
  return parts;
}

export function renderRouting() {
  const el = $('routeBody');
  if (!el || !docks.route?.on) return;
  const g = routing.graph;
  const chans = mixerChannels();
  const s = routing.sel;
  const routed = routedParts(g);
  const selNode = s?.node && g.nodes.find((n) => n.id === s.node);
  const view = {
    on: routing.on,
    sel: selNode ? {
      node: {
        id: selNode.id, label: NODE_TYPES[selNode.type].label, title: NODE_TYPES[selNode.type].title, off: !!selNode.off,
        controls: Object.entries(NODE_TYPES[selNode.type].params).map(([key, [min, max, step, def, lbl, unit]]) => ({ key, label: lbl, min, max, step, def, unit, value: selNode.params[key] })),
      },
    } : s?.node && partOf(s.node) != null ? { part: { base: partOf(s.node), routed: routed.includes(partOf(s.node)) } }
      : s?.edge ? { edge: { ...s.edge, fromLabel: label(s.edge.from), toLabel: label(s.edge.to) } } : null,
    add: Object.entries(NODE_TYPES).map(([type, t]) => ({ type, label: t.label, title: t.title })),
    templates: Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, title: t.title })),
    targets: chans.map((c) => c.base),
    target: routing.target || chans[0]?.base || '',
  };
  render(T.routing(view, act), el);
  syncCanvas(el.querySelector('.rt-df'));
}
function masterDb() {
  const v = Number($('masterGain')?.value ?? 1);
  return v <= 0.0001 ? '-∞ dB' : `${(20 * Math.log10(v)).toFixed(1)} dB`;
}

// ---- the canvas (Drawflow) ----
const body = () => $('routeBody');
const winOf = () => body()?.ownerDocument.defaultView || window;
const port = (cls) => (/_2$/.test(cls || '') ? 1 : 0); // output_2 / input_2: a Split's second path, a Sum's second input
const df = { ids: {}, model: {}, key: '', syncing: false, fitted: false };

/** Zoom (never past 100 %) and move the canvas so everything on it shows. */
function fitCanvas(editor) {
  const box = editor.container.getBoundingClientRect();
  const cards = [...editor.precanvas.querySelectorAll('.drawflow-node')];
  if (!cards.length || box.width < 50) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cards) {
    const x = c.offsetLeft, y = c.offsetTop;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + c.offsetWidth); y1 = Math.max(y1, y + c.offsetHeight);
  }
  const pad = 16;
  const z = Math.max(editor.zoom_min, Math.min(1, (box.width - 2 * pad) / (x1 - x0), (box.height - 2 * pad) / (y1 - y0)));
  // Drawflow scales the canvas about its centre: put the content's top-left corner at the padding
  const cx = box.width / 2, cy = box.height / 2;
  editor.zoom = z;
  editor.zoom_last_value = z;
  editor.canvas_x = pad - cx - z * (x0 - cx);
  editor.canvas_y = pad - cy - z * (y0 - cy);
  editor.precanvas.style.transform = `translate(${editor.canvas_x}px, ${editor.canvas_y}px) scale(${z})`;
}

function makeEditor(box) {
  const editor = new globalThis.Drawflow(box);
  Object.assign(editor, { reroute: false, curvature: 0.45, zoom_min: 0.4, zoom_max: 1.6, force_first_input: true });
  // the keys are ours: Delete removes what's selected through the graph's rules (a removed node heals its chain)
  editor.key = (e) => {
    if (e.target.closest?.('input, select, textarea')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); act.remove(); }
    if (e.key === 'Escape') { routing.sel = null; renderRouting(); }
  };
  editor.start();
  // a knob or the ⏻ switch on a card works the control, it doesn't pick the node up (Drawflow only knows to leave
  // real inputs alone); stopped on the way up, before Drawflow's own listener on the canvas — the knob has it already
  for (const ev of ['mousedown', 'touchstart']) editor.precanvas.addEventListener(ev, (e) => { if (e.target.closest?.('sa-knob, .rt-pow')) e.stopPropagation(); });
  const m = (id) => df.model[id];
  editor.on('nodeSelected', (id) => {
    if (df.syncing) return;
    routing.sel = { node: m(id) };
    if (partOf(m(id)) != null) routing.target = partOf(m(id));
    renderRouting();
  });
  editor.on('connectionSelected', (c) => {
    if (df.syncing) return;
    routing.sel = { edge: { from: m(c.output_id), to: m(c.input_id), fp: port(c.output_class), tp: port(c.input_class) } };
    renderRouting();
  });
  for (const ev of ['nodeUnselected', 'connectionUnselected']) editor.on(ev, () => { if (!df.syncing && routing.sel) { routing.sel = null; renderRouting(); } });
  editor.on('connectionCreated', (c) => {
    if (df.syncing) return;
    const from = m(c.output_id), to = m(c.input_id), fp = port(c.output_class);
    let tp = port(c.input_class);
    // dropped on a Sum whose first input is taken: its free one
    if (typeOfId(to) === 'sum' && routing.graph.edges.some((e) => e.to === to && (e.tp || 0) === tp)) tp = freeInput(routing.graph, to);
    if (canConnect(routing.graph, from, to, { fp, tp })) setGraphSoon(connect(routing.graph, from, to, { fp, tp }));
    else { flash(partOf(to) != null ? 'a part has no input' : 'that would make a loop'); redrawSoon(); }
  });
  editor.on('connectionRemoved', (c) => { if (!df.syncing) setGraphSoon(removeEdge(routing.graph, { from: m(c.output_id), to: m(c.input_id), fp: port(c.output_class), tp: port(c.input_class) })); });
  editor.on('nodeRemoved', (id) => {
    if (df.syncing) return;
    const mid = m(id);
    routing.sel = null;
    if (mid === SINK || partOf(mid) != null) redrawSoon(); // (the master and the parts always stay)
    else setGraphSoon(removeNode(routing.graph, mid));
  });
  editor.on('nodeMoved', (id) => {
    if (df.syncing) return;
    const mid = m(id), n = editor.getNodeFromId(id);
    if (!n || mid === SINK) return;
    const at = { x: Math.round(n.pos_x), y: Math.round(n.pos_y) };
    if (partOf(mid) != null) routing.graph = normGraph({ ...routing.graph, pins: { ...routing.graph.pins, [mid]: at } });
    else { const node = routing.graph.nodes.find((x) => x.id === mid); if (node) Object.assign(node, at); routing.graph = normGraph(routing.graph); }
    df.key = canvasKey(); // (it's already where it should be)
    saveRouting();
  });
  return editor;
}
// a change from inside one of Drawflow's events: let it finish first
const setGraphSoon = (g) => setTimeout(() => setGraph(g));
const redrawSoon = () => setTimeout(() => { df.key = ''; renderRouting(); });

/**
 * What the canvas shows: when this changes, it's redrawn. (Not the selection: Drawflow shows that itself, and a
 * redraw in the middle of a click would pull the node out from under the drag.)
 */
function canvasKey() {
  const g = routing.graph;
  return JSON.stringify([routing.on, partsNow(), g.nodes.map((n) => [n.id, n.type, n.off, n.x, n.y]), g.edges, g.pins, deadEnds(g)]);
}
function syncCanvas(box) {
  if (!box || typeof globalThis.Drawflow !== 'function') return;
  if (!routing.df || routing.df.container !== box) { routing.df = makeEditor(box); df.key = ''; df.fitted = false; }
  const key = canvasKey();
  if (key === df.key) return;
  df.key = key;
  drawCanvas(routing.df);
  // the first time it's shown: all of it in view
  if (!df.fitted) { df.fitted = true; fitCanvas(routing.df); }
}
function drawCanvas(editor) {
  const g = routing.graph;
  const parts = partsNow();
  // the grid fits the biggest card in the graph
  const sizes = g.nodes.map((n) => cardSize(n.type));
  const pos = layoutGraph(g, parts, { colW: Math.max(CARD_W, ...sizes.map((z) => z.w)) + 44, rowH: Math.max(CARD_H, ...sizes.map((z) => z.h)) + 22 });
  const routed = routedParts(g), dead = deadEnds(g), dry = unfed(g), s = routing.sel;
  df.syncing = true;
  try {
    editor.clear();
    df.ids = {};
    df.model = {};
    const put = (mid, ins, outs, cls, card, at) => {
      const id = editor.addNode(mid, ins, outs, at.x, at.y, cls, {}, T.routingCard(card));
      df.ids[mid] = id;
      df.model[id] = mid;
      const el = editor.container.querySelector(`#node-${id}`);
      if (el) el.dataset.id = mid;
      return el;
    };
    for (const p of parts) {
      const el = put(srcId(p), 0, 1, `rt-card rt-part${routing.on && routed.includes(p) ? ' routed' : ''}`,
        { id: srcId(p), label: p, sub: routing.on && routed.includes(p) ? 'routed' : 'direct', title: `${p}: after its 🎚 mixer fader. Click it, then ＋ an effect` }, pos[srcId(p)]);
      el?.style.setProperty('--c', vizColor(p));
    }
    for (const n of g.nodes) {
      const t = NODE_TYPES[n.type];
      const controls = Object.entries(t.params).map(([key, [min, max, step, def, lbl, unit]]) => ({ key, label: lbl, min, max, step, def, unit, value: n.params[key] }));
      const el = put(n.id, inPorts(n.type), outPorts(n.type), `rt-card rt-node k-${t.kind}${n.off ? ' off' : ''}${dead.includes(n.id) ? ' dead' : ''}${controls.length ? ' has-knobs' : ''}`, {
        id: n.id, label: `${t.label}${dead.includes(n.id) ? ' ⚠' : ''}`, sub: nodeSummary(g, n), off: !!n.off, controls: n.type === 'split' || n.type === 'sum' ? null : controls,
        title: `${t.title}${dead.includes(n.id) ? ' — ⚠ not wired to the master: you won’t hear it' : dry.includes(n.id) ? ' — nothing goes in yet' : ''}`,
      }, pos[n.id]);
      const z = cardSize(n.type);
      if (el) Object.assign(el.style, { width: `${z.w}px`, height: `${z.h}px` });
    }
    const mel = put(SINK, 1, 0, 'rt-card rt-master', { id: SINK, label: 'Master', sub: masterDb(), title: 'The master: on to 🎛 Master (double-click to open it)', master: true }, pos[SINK]);
    if (mel) mel.style.height = `${pos[SINK].h}px`;
    const wire = (e, cls = '') => {
      const a = df.ids[e.from], b = df.ids[e.to];
      if (a == null || b == null) return;
      editor.addConnection(a, b, `output_${(e.fp || 0) + 1}`, `input_${(e.tp || 0) + 1}`);
      const svgEl = editor.container.querySelector(`.connection.node_in_node-${b}.node_out_node-${a}.output_${(e.fp || 0) + 1}.input_${(e.tp || 0) + 1}`);
      const kind = partOf(e.from) != null ? 'part' : NODE_TYPES[typeOfId(e.from)]?.kind || 'route';
      svgEl?.classList.add(`k-${kind}`, ...cls.split(' ').filter(Boolean));
      if (s?.edge && edgeKey(s.edge) === edgeKey(e)) svgEl?.querySelector('.main-path')?.classList.add('selected');
    };
    for (const e of g.edges) wire(e);
    // parts going straight to the master: a faint wire (not part of the graph)
    for (const p of parts) if (!routing.on || !routed.includes(p)) wire({ from: srcId(p), to: SINK }, 'implicit');
    // the selection survives the redraw
    if (s?.node && df.ids[s.node] != null) {
      const el = editor.container.querySelector(`#node-${df.ids[s.node]}`);
      el?.classList.add('selected');
      editor.node_selected = el || null;
    }
  } finally { df.syncing = false; }
}

// ---- the scopes and live readouts ----
const HIST = 60;
const levelOf = (an) => {
  if (!an) return 0;
  const b = (an.__buf ||= new Float32Array(an.fftSize));
  an.getFloatTimeDomainData(b);
  let s = 0;
  for (const v of b) s += v * v;
  return Math.sqrt(s / b.length);
};
function analyserOf(id) {
  if (id === SINK) return masterChain()?.analyser || null;
  if (partOf(id) != null) return channelIfAny(partOf(id))?.an || null;
  return routing.live?.blocks[id]?.analyser || null;
}
function draw() {
  routing.rafWin = winOf();
  routing.raf = routing.rafWin.requestAnimationFrame(draw);
  const el = $('routeBody');
  if (!el) return;
  const playing = isPlaying();
  for (const cv of el.querySelectorAll('canvas.rt-scope')) {
    const id = cv.dataset.id;
    const h = (routing.hist[id] ||= []);
    h.push(playing ? Math.min(1, levelOf(analyserOf(id)) * 3) : 0);
    if (h.length > HIST) h.shift();
    const g = cv.getContext('2d'), w = cv.width, ht = cv.height;
    g.clearRect(0, 0, w, ht);
    g.strokeStyle = getComputedStyle(cv).color || themeColor('muted');
    g.lineWidth = 1.5;
    g.beginPath();
    h.forEach((v, i) => { const x = (i / (HIST - 1)) * w, y = ht - 2 - v * (ht - 4); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  }
  // compressors: their gain reduction now
  for (const n of routing.graph.nodes) {
    if (n.type !== 'comp') continue;
    const b = routing.live?.blocks[n.id];
    const sub = el.querySelector(`.rt-sub[data-id="${n.id}"]`);
    if (sub && b) sub.textContent = nodeSummary(routing.graph, n, playing ? b.live() : {});
  }
  const mm = el.querySelector('.rt-mmeter i');
  if (mm) {
    const lv = playing ? levelOf(analyserOf(SINK)) : 0;
    const db = lv > 0 ? 20 * Math.log10(lv) : -60;
    mm.style.height = `${Math.max(0, Math.min(100, ((db + 48) / 48) * 100))}%`;
    mm.classList.toggle('hot', db > -6);
  }
}

const stopDraw = () => { try { (routing.rafWin || window).cancelAnimationFrame(routing.raf); } catch {} };

export function setup() {
  const st = load().routing;
  routing.graph = normGraph(st?.graph);
  routing.on = st?.on !== false;
  setupDock('route', {
    onShow: () => { renderRouting(); stopDraw(); draw(); ws.minSize?.('route', 320); },
    onHide: () => stopDraw(),
  });
  onTemplatesChange(() => renderRouting());
  const bodyEl = $('routeBody');
  // a knob on a node card (data-node) — or, without one, the selected node
  bodyEl.addEventListener('input', (e) => { const k = e.target.dataset?.p, id = e.target.dataset?.node || routing.sel?.node; if (k && id) setParam(id, k, Number(e.target.value)); });
  bodyEl.addEventListener('click', (e) => { const pow = e.target.closest?.('.rt-pow[data-node]'); if (pow) act.off(pow.dataset.node); });
  bodyEl.addEventListener('dblclick', (e) => { if (e.target.closest('.rt-master')) ws.open('master'); });
  // Drawflow follows the mouse only over its canvas: a drag let go outside it ends there too (in whichever window
  // the panel is — floating or popped out)
  const endDrag = (e) => { const ed = routing.df; if (ed && (ed.drag || ed.connection || ed.editor_selected) && !ed.container.contains(e.target)) ed.dragEnd(e); };
  let watched = null;
  setInterval(() => { const w = winOf(); if (w !== watched) { watched?.removeEventListener('mouseup', endDrag); w.addEventListener('mouseup', endDrag); watched = w; } }, 1000);
  // the audio engine can be rebuilt (and channels come and go): keep the graph wired, and the panel's parts current
  setInterval(() => {
    const ctrl = sdController();
    if (routing.on && routing.graph.edges.length && ctrl && (!routing.live || routing.live.ctrl !== ctrl || routing.live.bus.context !== ctxOf(ctrl))) applyRouting();
    else if (routing.live) for (const p of routedParts(routing.graph)) if (!routing.live.closed.includes(p) && channelIfAny(p)) { applyRouting(); break; }
    if (docks.route?.on && !routing.df?.drag && !routing.df?.connection) renderRouting();
  }, 1500);
}
