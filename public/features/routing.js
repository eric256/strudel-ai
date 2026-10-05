// ---------------------------------------------------------------------------
// 🔀 Routing: the whole signal path on one board.
//   each part (left) → its effects (nodes: Split / Sum, Comp, Sat, EQ, EQ7, Filter, Verb, Delay, Gain; buses of
//   several parts) → its input on the MASTER block (a row per channel coming in: fader, pan, mute / solo) → summed →
//   the master's sections (right: EQ7, Tone, Filter, Colour, Space, Echo, Dynamics, Output) → out (master volume).
// The graph and its rules are lib/routing.js, the effect blocks routing-audio.js; the parts' sources and the master's
// inputs (strips) are features/mixer.js, the master's chain features/master-panel.js + master.js — the 🎚 Mixer
// and 🎛 Master panels are simpler views of the same. Kept per part name in the browser, like the mixer.
// ---------------------------------------------------------------------------
import { $, addMsg, docks, isPlaying, load, player, save, setupDock, ws } from '../app.js';
import { render } from '../html.js';
import { T, onTemplatesChange } from '../templates/index.js';
import {
  MFX, NODE_TYPES, OUT, SINK, TEMPLATES, addNode, canConnect, connect, deadEnds, edgeKey, freeInput, inPorts, inputKey, layoutGraph,
  masterInputs, nodeSummary, normGraph, outPorts, partOf, removeEdge, removeNode, routedParts, srcId, unfed, unplace,
  unroutePart, visibleGraph, withPost, postNodes, layoutPost,
} from '../lib/routing.js';
import { createBlock } from '../routing-audio.js';
import { busList, busStrip, channelHooks, channelIfAny, chOf, fxHook, masterAnalyser, mixer, mixerChannels, sdController, setChannel, stripIfAny } from './mixer.js';
import { master, masterChain, setMasterEq, setMasterParam, styleValue, toggleMasterNode } from './master-panel.js';
import { openEqualizer } from './equalizer.js';
import { MASTER_NODES, MASTER_PARAMS } from '../master.js';
import { EQ_BANDS } from '../lib/eq.js';
import { vizColor } from './visualizer.js';
import { themeColor } from '../theme.js';

export const routing = {
  graph: { nodes: [], edges: [] }, on: true, sel: null, target: '',
  live: null,       // the audio: { ctrl, ac, blocks: { id: block }, wired: [[a, b]], closed: [part] }
  df: null,         // the canvas (Drawflow)
  raf: 0, hist: {},
};
const saveRouting = () => save({ routing: { graph: routing.graph, on: routing.on } });

// ---- audio ----
function ctxOf(ctrl) { return ctrl?.output?.channelMerger?.context || null; }
/** The return into the master for buses (through 🎛 Master like everything else): one per audio engine. */
function returnBus(ctrl) {
  const ac = ctxOf(ctrl);
  if (!ctrl.output.__routeBus || ctrl.output.__routeBus.context !== ac) {
    ctrl.output.__routeBus = new GainNode(ac);
    ctrl.output.connectToDestination(ctrl.output.__routeBus, [0, 1]);
  }
  return ctrl.output.__routeBus;
}
/** Take the effects down: every part goes straight to its own input on the master, the master to Master FX to out. */
function tearDown() {
  const L = routing.live;
  if (!L) return;
  for (const [a, b] of L.wired) { try { a.disconnect(b); } catch {} }
  for (const b of Object.values(L.blocks)) b.dispose();
  for (const p of L.closed) { const ch = channelIfAny(p); if (ch) ch.thru.gain.setTargetAtTime(1, ch.thru.context.currentTime, 0.01); }
  if (L.post) { try { L.post.merger.connect(L.post.chain.input); L.post.chain.output.connect(L.post.dest); } catch {} }
  routing.live = null;
}
/** Is the way out the plain one (master → Master FX → out, nothing else after the master)? */
const plainPost = (g) => {
  const gp = withPost(g), after = new Set([SINK, MFX, ...postNodes(gp)]);
  const out = gp.edges.filter((e) => after.has(e.from) || e.to === OUT || e.to === MFX);
  return out.length === 2 && out.some((e) => e.from === SINK && e.to === MFX) && out.some((e) => e.from === MFX && e.to === OUT);
};
/**
 * Build the audio for the graph (again): a block per node, the wires — from a part's source, into the master input
 * of the channel the wire carries (a part's, or a bus's) — and the routed parts' straight path closed. After the
 * master: unless it's the plain way out, the master's sum (its merger), the Master FX chain and out (the master
 * volume) are taken apart and wired as the graph says.
 */
export function applyRouting() {
  tearDown();
  const ctrl = sdController(), ac = ctxOf(ctrl);
  if (!ctrl || !ac || !routing.on) return;
  const g = withPost(routing.graph);
  const L = { ctrl, ac, blocks: {}, wired: [], closed: [], post: null };
  for (const n of g.nodes) L.blocks[n.id] = createBlock(ac, n);
  if (!plainPost(g)) {
    const chain = masterChain(), merger = ctrl.output.channelMerger, dest = ctrl.output.destinationGain;
    if (chain && merger && dest) {
      try { merger.disconnect(chain.input); } catch {}
      try { chain.output.disconnect(dest); } catch {}
      L.post = { merger, chain, dest };
    }
  }
  const outOf = (id) => (partOf(id) != null ? channelIfAny(partOf(id))?.src
    : id === SINK ? L.post?.merger : id === MFX ? L.post?.chain.output : L.blocks[id]?.output);
  const inOf = (e) => {
    if (e.to === MFX) return L.post?.chain.input;
    if (e.to === OUT) return L.post?.dest;
    if (e.to !== SINK) return L.blocks[e.to]?.input;
    const key = inputKey(g, e.from);
    return key.startsWith('bus:') ? busStrip(key, ctrl, returnBus(ctrl)).in : channelIfAny(key)?.in;
  };
  for (const e of g.edges) {
    const a = outOf(e.from), b = inOf(e);
    if (!a || !b) continue;
    a.connect(b);
    L.wired.push([a, b]);
  }
  for (const p of routedParts(g)) {
    const ch = channelIfAny(p);
    if (!ch) continue;
    ch.thru.gain.setTargetAtTime(0, ac.currentTime, 0.01);
    L.closed.push(p);
  }
  routing.live = L;
}
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

// ---- for the 🎚 Equalizer and the 🎚 Mixer ----
/** The EQ7 nodes on the board now: [{ id, label }] (the 🎚 Equalizer can work on them). */
export function eqNodes() {
  const vg = visibleGraph(routing.graph, partsNow());
  return vg.nodes.filter((n) => n.type === 'geq').map((n) => ({ id: n.id, label: `EQ7 · ${upLabel(vg, n.id)}` }));
}
export const nodeParams = (id) => routing.graph.nodes.find((n) => n.id === id)?.params || null;
/** Set several of a node's values (the 🎚 Equalizer's bands), heard at once, the board updated. */
export function setNodeParams(id, patch) {
  for (const [k, v] of Object.entries(patch)) setParam(id, k, v);
  syncValues();
}
export const nodeAnalyser = (id) => routing.live?.blocks[id]?.analyser || null;
const upLabel = (g, id) => [...new Set(g.edges.filter((e) => e.to === id).flatMap((e) => (partOf(e.from) != null ? [partOf(e.from)] : [])))].join(' + ') || label(id);
/** The mixer's links into the board (set up in setup(): the modules load in a circle, so not at load time). */
function linkMixer() {
  // the mixer shows a strip per bus
  busList.get = () => {
    const parts = partsNow(), vg = visibleGraph(routing.graph, parts);
    if (!routing.on) return [];
    return masterInputs(vg, parts).filter((x) => !x.part).map((x) => ({ key: x.key, label: `${label(x.from[0])} bus`, title: `A bus of ${x.parts.join(' + ')} (🔀 Routing)`, parts: x.parts }));
  };
  // "FX ↗" on a mixer strip: that part (or bus) on the board
  fxHook.open = (key) => {
    ws.open('route');
    routing.sel = { node: String(key).startsWith('bus:') ? key.slice(4) : key === '__master' ? SINK : srcId(key) };
    if (partOf(routing.sel.node) != null) routing.target = partOf(routing.sel.node);
    df.key = '';
    renderRouting();
  };
  // a new channel (a part's first note): wire it in — its source feeds the effects, the wires into the master find its input
  channelHooks.add(() => { if (routing.on && routing.graph.edges.length) queueMicrotask(applyRouting); });
}

// ---- the panel: the toolbar and inspector (lit), the canvas (Drawflow) ----
// The graph (lib/routing.js) is the truth; Drawflow only shows it. Every change of the graph redraws the canvas from
// it, and what you do on the canvas (wire, move, select, remove) comes back through Drawflow's events, is checked
// against the graph's rules, and redraws — so a wire that isn't allowed (a loop, into a part) just doesn't stay.
const label = (id) => (id === SINK ? 'master' : partOf(id) ?? (routing.graph.nodes.find((n) => n.id === id) ? NODE_TYPES[routing.graph.nodes.find((n) => n.id === id).type].label : id));
const typeOfId = (id) => routing.graph.nodes.find((n) => n.id === id)?.type;
// Master FX and Out: fixed (they can't be removed), but the wires around them are yours
const isPost = (id) => id === MFX || id === OUT;
// a card: 150 × 76 (style.css); one with knobs is taller, and wider for each knob past four
const CARD_W = 150, CARD_H = 76, KNOB_H = 120, KNOB_W = 40;
const sizeFor = (knobs) => (knobs ? { w: Math.max(CARD_W, 22 + knobs * KNOB_W), h: KNOB_H } : { w: CARD_W, h: CARD_H });
const cardSize = (type) => sizeFor(Object.keys(NODE_TYPES[type]?.params || {}).length);
const MASTER_W = 230, ROW_H = 40, ROW_GAP = 44, HEAD_H = 44;

const act = {
  toggle(on) { routing.on = on; applyRouting(); saveRouting(); df.key = ''; renderRouting(); },
  add(type) {
    // after the selected part or node, into the selected wire — otherwise after the part picked in the bar
    // (the master, Master FX: after it; Out: just before it)
    const s = routing.sel, base = withPost(routing.graph);
    const part = routing.target || mixerChannels()[0]?.base;
    const intoOut = s?.node === OUT ? base.edges.find((e) => e.to === OUT) : null;
    const opts = s?.edge ? { onEdge: s.edge } : intoOut ? { onEdge: intoOut } : s?.node && s.node !== OUT ? { after: s.node } : part ? { after: srcId(part) } : {};
    const { graph, id } = addNode(base, type, opts);
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
  tidy() { setGraph(unplace(routing.graph), { rebuild: false }); }, // (parts and the master go back to their places too)
  clear() { routing.sel = null; setGraph({ nodes: [], edges: [] }); },
  remove() {
    const s = routing.sel;
    if (!s) return;
    routing.sel = null;
    if (s.node === SINK || isPost(s.node)) renderRouting();
    else if (s.node && partOf(s.node) != null) setGraph(unroutePart(routing.graph, partOf(s.node)));
    else if (s.node) setGraph(removeNode(withPost(routing.graph), s.node));
    else if (s.edge) setGraph(removeEdge(withPost(routing.graph), s.edge));
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
    const ed = routing.df;
    if (!ed) return;
    if (dir > 0) ed.zoom_in();
    else if (dir < 0) ed.zoom_out();
    else fitCanvas(ed);
  },
};
const flash = (msg) => addMsg('info', `🔀 ${msg}`);

/** The parts on the board: the channels of the music now (a part that isn't in it keeps its routing, hidden). */
const partsNow = () => mixerChannels().map((c) => c.base);

export function renderRouting() {
  const el = $('routeBody');
  if (!el || !docks.route?.on) return;
  const g = routing.graph;
  const chans = mixerChannels();
  const s = routing.sel;
  const routed = routedParts(g);
  const selNode = s?.node && g.nodes.find((n) => n.id === s.node);
  const post = isPost(s?.node) ? s.node : null;
  const view = {
    on: routing.on,
    sel: selNode ? {
      node: {
        id: selNode.id, label: NODE_TYPES[selNode.type].label, title: NODE_TYPES[selNode.type].title, off: !!selNode.off,
        controls: Object.entries(NODE_TYPES[selNode.type].params).map(([key, [min, max, step, def, lbl, unit]]) => ({ key, label: lbl, min, max, step, def, unit, value: selNode.params[key] })),
      },
    } : s?.node && partOf(s.node) != null ? { part: { base: partOf(s.node), routed: routed.includes(partOf(s.node)) } }
      : s?.node === SINK || post ? { master: { name: post === MFX ? '🎛 Master FX' : post === OUT ? '🔊 Out' : 'Master', style: master.style } }
      : s?.edge ? { edge: { ...s.edge, fromLabel: label(s.edge.from), toLabel: label(s.edge.to) } } : null,
    add: Object.entries(NODE_TYPES).map(([type, t]) => ({ type, label: t.label, title: t.title })),
    templates: Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, title: t.title })),
    targets: chans.map((c) => c.base),
    target: routing.target || chans[0]?.base || '',
  };
  render(T.routing(view, act), el);
  syncCanvas(el.querySelector('.rt-df'));
  syncValues();
}
function masterDb() {
  const v = Number($('masterGain')?.value ?? 1);
  return v <= 0.0001 ? '-∞ dB' : `${(20 * Math.log10(v)).toFixed(1)} dB`;
}
const toDb = (v) => (v > 0.001 ? Math.max(-60, Math.round(20 * Math.log10(v) * 2) / 2) : -60);
const fromDb = (db) => (db <= -59.9 ? 0 : Math.pow(10, db / 20));

// ---- the canvas (Drawflow) ----
const body = () => $('routeBody');
const winOf = () => body()?.ownerDocument.defaultView || window;
const port = (cls) => (/_2$/.test(cls || '') ? 1 : 0); // output_2 / input_2: a Split's second path, a Sum's second input
const df = { ids: {}, model: {}, key: '', syncing: false, fitted: false, rows: [] };

/** Zoom (never past 100 %) and move the canvas so everything on it shows. False when it can't yet (not shown). */
function fitCanvas(editor) {
  const box = editor.container.getBoundingClientRect();
  const cards = [...editor.precanvas.querySelectorAll('.drawflow-node')];
  if (!cards.length || box.width < 50 || box.height < 50) return false;
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
  return true;
}

function makeEditor(box) {
  const editor = new globalThis.Drawflow(box);
  Object.assign(editor, { reroute: false, curvature: 0.45, zoom_min: 0.25, zoom_max: 1.6, force_first_input: true });
  // the keys are ours: Delete removes what's selected through the graph's rules (a removed node heals its chain)
  editor.key = (e) => {
    if (e.target.closest?.('input, select, textarea')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); act.remove(); }
    if (e.key === 'Escape') { routing.sel = null; renderRouting(); }
  };
  editor.start();
  // a knob, a switch or a button on a card works the control, it doesn't pick the node up (Drawflow only knows to
  // leave real inputs alone); stopped on the way up, before Drawflow's own listener on the canvas
  for (const ev of ['mousedown', 'touchstart']) editor.precanvas.addEventListener(ev, (e) => { if (e.target.closest?.('sa-knob, button')) e.stopPropagation(); });
  const m = (id) => df.model[id];
  editor.on('nodeSelected', (id) => {
    if (df.syncing) return;
    routing.sel = { node: m(id) };
    if (partOf(m(id)) != null) routing.target = partOf(m(id));
    renderRouting();
  });
  editor.on('connectionSelected', (c) => {
    if (df.syncing) return;
    const from = m(c.output_id), to = m(c.input_id);
    routing.sel = { edge: { from, to, fp: port(c.output_class), tp: to === SINK ? 0 : port(c.input_class) } };
    renderRouting();
  });
  for (const ev of ['nodeUnselected', 'connectionUnselected']) editor.on(ev, () => { if (!df.syncing && routing.sel) { routing.sel = null; renderRouting(); } });
  editor.on('connectionCreated', (c) => {
    if (df.syncing) return;
    const from = m(c.output_id), to = m(c.input_id), fp = port(c.output_class);
    // into the master, the wire takes its channel's row
    let tp = to === SINK || isPost(to) ? 0 : port(c.input_class);
    const base = withPost(routing.graph);
    // dropped on a Sum whose first input is taken: its free one
    if (typeOfId(to) === 'sum' && base.edges.some((e) => e.to === to && (e.tp || 0) === tp)) tp = freeInput(base, to);
    if (canConnect(base, from, to, { fp, tp })) setGraphSoon(connect(base, from, to, { fp, tp }));
    else { if (to !== SINK) flash(partOf(to) != null ? 'a part has no input' : 'that would make a loop'); redrawSoon(); }
  });
  editor.on('connectionRemoved', (c) => {
    if (df.syncing) return;
    const from = m(c.output_id), to = m(c.input_id);
    setGraphSoon(removeEdge(withPost(routing.graph), { from, to, fp: port(c.output_class), tp: to === SINK || isPost(to) ? 0 : port(c.input_class) }));
  });
  editor.on('nodeRemoved', (id) => {
    if (df.syncing) return;
    const mid = m(id);
    routing.sel = null;
    if (mid === SINK || isPost(mid) || partOf(mid) != null) redrawSoon(); // (the master, Master FX, out and the parts always stay)
    else setGraphSoon(removeNode(withPost(routing.graph), mid));
  });
  editor.on('nodeMoved', (id) => {
    if (df.syncing) return;
    const mid = m(id), n = editor.getNodeFromId(id);
    if (!n || isPost(mid)) return;
    const at = { x: Math.round(n.pos_x), y: Math.round(n.pos_y) };
    if (partOf(mid) != null || mid === SINK) routing.graph = normGraph({ ...routing.graph, pins: { ...routing.graph.pins, [mid]: at } });
    else { const node = routing.graph.nodes.find((x) => x.id === mid); if (node) Object.assign(node, at); routing.graph = normGraph(routing.graph); }
    saveRouting();
    if (mid === SINK) redrawSoon(); // (its sections follow it)
    else df.key = canvasKey(); // (it's already where it should be)
  });
  return editor;
}
// a change from inside one of Drawflow's events: let it finish first
const setGraphSoon = (g) => setTimeout(() => setGraph(g));
const redrawSoon = () => setTimeout(() => { df.key = ''; renderRouting(); });

/**
 * What the canvas shows: when this changes, it's redrawn. (Not the selection: Drawflow shows that itself, and a
 * redraw in the middle of a click would pull the node out from under the drag. Not the knobs' values either.)
 */
function canvasKey() {
  const parts = partsNow(), vg = visibleGraph(routing.graph, parts);
  return JSON.stringify([routing.on, parts, vg.nodes.map((n) => [n.id, n.type, n.off, n.x, n.y]), withPost(vg).edges, routing.graph.pins, deadEnds(withPost(vg)),
    masterInputs(vg, parts).map((x) => x.key), master.off, master.bypass]);
}
function syncCanvas(box) {
  if (!box || typeof globalThis.Drawflow !== 'function') return;
  if (!routing.df || routing.df.container !== box) { routing.df = makeEditor(box); df.key = ''; df.fitted = false; }
  const key = canvasKey();
  if (key === df.key) { if (!df.fitted) df.fitted = fitCanvas(routing.df); return; }
  df.key = key;
  drawCanvas(routing.df);
  // the first time it's shown: all of it in view
  if (!df.fitted) df.fitted = fitCanvas(routing.df);
}

/** The master block's rows: an input per channel, each at the height its wire comes in (the part's row, a bus's). */
function masterRows(vg, parts, pos, top) {
  const inputs = routing.on ? masterInputs(vg, parts) : parts.map((p) => ({ key: p, part: p, parts: [p], from: [srcId(p)] }));
  const rows = inputs.map((x) => {
    const anchor = x.part ? srcId(x.part) : x.from[0];
    const p = pos[anchor];
    const h = x.part ? CARD_H : cardSize(typeOfId(anchor)).h;
    const c = chOf(x.key);
    return {
      key: x.key, bus: !x.part, label: x.part || `${label(x.from[0])} bus`, color: x.part ? vizColor(x.part) : themeColor('accent'),
      title: x.part ? `${x.part}: its fader, pan, mute and solo into the master (the 🎚 Mixer's strip)` : `A bus of ${x.parts.join(' + ')}: its fader, pan and mute into the master`,
      y: p ? p.y + h / 2 - top - ROW_H / 2 : 0, db: toDb(c.vol), pan: Number(c.pan) || 0, mute: !!c.mute, solo: !!c.solo,
    };
  }).sort((a, b) => a.y - b.y);
  // no two rows on top of each other, none in the header
  let next = HEAD_H;
  for (const r of rows) { r.top = Math.max(r.y, next); next = r.top + ROW_GAP; }
  return rows;
}

function drawCanvas(editor) {
  const parts = partsNow();
  const vg = visibleGraph(routing.graph, parts);
  const vgp = withPost(vg);                      // (with the default way out if nothing says otherwise)
  const post = new Set(postNodes(vgp));
  // the grid fits the biggest card in the graph
  const sizes = vg.nodes.map((n) => cardSize(n.type));
  const pos = layoutGraph(vg, parts, { colW: Math.max(CARD_W, ...sizes.map((z) => z.w)) + 44, rowH: Math.max(CARD_H, ...sizes.map((z) => z.h)) + 22 });
  const mPos = routing.graph.pins?.[SINK] || pos[SINK];
  const routed = routing.on ? routedParts(vg) : [], dead = deadEnds(vgp), dry = unfed(vg), s = routing.sel;
  // after the master: Master FX, your effects and out, in columns from it (layoutPost)
  const MFX_W = 560, mfxH = df.mfxH || 250;
  const sizeOf = (id) => (id === MFX ? { w: MFX_W, h: mfxH } : id === OUT ? { w: CARD_W, h: 170 } : cardSize(typeOfId(id)));
  const pl = routing.on ? layoutPost(vg) : { [MFX]: { col: 1, row: 0 }, [OUT]: { col: 2, row: 0 } };
  const colW = {}, rowH = {};
  for (const [id, { col, row }] of Object.entries(pl)) { colW[col] = Math.max(colW[col] || 0, sizeOf(id).w); rowH[row] = Math.max(rowH[row] || 0, sizeOf(id).h); }
  const colX = (c) => mPos.x + MASTER_W + 50 + Object.keys(colW).filter((k) => k < c).reduce((x, k) => x + colW[k] + 44, 0);
  const rowY = (r) => mPos.y + Object.keys(rowH).filter((k) => k < r).reduce((y, k) => y + rowH[k] + 26, 0);
  for (const [id, { col, row }] of Object.entries(pl)) {
    const n = vg.nodes.find((x) => x.id === id);
    pos[id] = n && Number.isFinite(n.x) ? { x: n.x, y: n.y } : { x: colX(col), y: rowY(row) };
  }
  df.syncing = true;
  try {
    editor.clear();
    df.ids = {};
    df.model = {};
    const put = (mid, ins, outs, cls, html, at, size) => {
      const id = editor.addNode(mid, ins, outs, at.x, at.y, cls, {}, html);
      df.ids[mid] = id;
      df.model[id] = mid;
      const el = editor.container.querySelector(`#node-${id}`);
      if (el) { el.dataset.id = mid; if (size) Object.assign(el.style, { width: `${size.w}px`, height: size.h ? `${size.h}px` : 'auto' }); }
      return el;
    };
    // the parts
    for (const p of parts) {
      const el = put(srcId(p), 0, 1, `rt-card rt-part${routed.includes(p) ? ' routed' : ''}`, T.routingCard({
        id: srcId(p), label: p, sub: routed.includes(p) ? 'its effects →' : 'straight to the master', title: `${p}: its sound. Click it, then ＋ an effect`,
      }), pos[srcId(p)]);
      el?.style.setProperty('--c', vizColor(p));
    }
    // the effects (before the master, and after it)
    for (const n of vg.nodes) {
      if (!pos[n.id]) continue;
      const t = NODE_TYPES[n.type];
      const controls = Object.entries(t.params).map(([key, [min, max, step, def, lbl, unit]]) => ({ key, label: lbl, min, max, step, def, unit, value: n.params[key] }));
      put(n.id, inPorts(n.type), outPorts(n.type), `rt-card rt-node k-${t.kind}${n.off ? ' off' : ''}${dead.includes(n.id) ? ' dead' : ''}${controls.length ? ' has-knobs' : ''}${post.has(n.id) ? ' after-master' : ''}`, T.routingCard({
        id: n.id, label: `${t.label}${dead.includes(n.id) ? ' ⚠' : ''}`, sub: nodeSummary(vg, n), off: !!n.off, controls: n.type === 'split' || n.type === 'sum' ? null : controls,
        openEq: n.type === 'geq' ? n.id : null,
        title: `${t.title}${post.has(n.id) ? ' — after the master: on the whole mix' : ''}${dead.includes(n.id) ? ' — ⚠ not wired on to the master or out: you won’t hear it' : dry.includes(n.id) ? ' — nothing goes in yet' : ''}`,
      }), pos[n.id], cardSize(n.type));
    }
    // the master: a row (input) per channel coming in
    const rows = df.rows = masterRows(vg, parts, pos, mPos.y);
    const mh = Math.max(mPos.h || 0, (rows.at(-1)?.top ?? HEAD_H) + ROW_H + 14);
    const mel = put(SINK, Math.max(1, rows.length), 1, 'rt-card rt-master', T.routingMaster({ rows, sub: rows.length ? `${rows.length} channel${rows.length > 1 ? 's' : ''} in` : 'nothing in yet' }), mPos, { w: MASTER_W, h: mh });
    // each input port at its row
    mel?.querySelectorAll('.inputs .input').forEach((inp, k) => { inp.style.top = `${(rows[k]?.top ?? HEAD_H) + ROW_H / 2 - 7}px`; });
    // Master FX: the master's sections on one block (a grid of groups); Out: the master volume
    const groups = [
      { id: 'EQ7', label: '🎚 EQ7', title: 'The master’s 7-band EQ (first in its chain) — ↗ for its curve and presets', openEq: 'master', pow: null,
        controls: EQ_BANDS.map((bd, i) => ({ key: `b${i}`, label: bd.label, min: -12, max: 12, step: 0.5, def: 0, unit: 'dB', value: master.eq[i] || 0, data: { meq: i } })) },
      ...MASTER_NODES.map((n) => ({
        id: n.group, label: `${n.icon} ${n.name}`, title: n.title,
        off: master.bypass || master.off.includes(n.group), pow: { data: { mnode: n.group } },
        controls: MASTER_PARAMS.filter((d) => d.group === n.group).map((d) => ({ key: d.key, label: d.label, title: d.title, min: d.min, max: d.max, step: d.step, def: styleValue(d.key), unit: d.unit, value: master.params[d.key], data: { master: d.key } })),
      })),
    ];
    const fxEl = put(MFX, 1, 1, 'rt-card rt-node rt-post rt-fx', T.routingMasterFx({ sub: `style: ${master.style}${master.bypass ? ' · bypassed' : ''}`, groups }), pos[MFX], { w: MFX_W, h: 0 });
    if (fxEl?.offsetHeight > 40 && Math.abs(fxEl.offsetHeight - mfxH) > 4) { df.mfxH = fxEl.offsetHeight; df.key = ''; } // (its real height: the next draw spaces the rows by it)
    put(OUT, 1, 0, 'rt-card rt-node rt-post rt-out', T.routingCard({ id: OUT, label: '🔊 Out', sub: masterDb(), title: 'The master volume, and what comes out', pow: null, meter: true, scope: false,
      controls: [{ key: 'vol', label: 'volume', min: 0, max: 1.5, step: 0.01, def: 1, value: Number($('masterGain')?.value ?? 1), data: { mvol: 1 } }] }), pos[OUT], sizeOf(OUT));
    // the wires
    const rowOf = (key) => Math.max(0, rows.findIndex((r) => r.key === key));
    const wire = (e, cls = '') => {
      const a = df.ids[e.from], b = df.ids[e.to];
      if (a == null || b == null) return;
      const into = e.to === SINK ? rowOf(inputKey(vg, e.from)) : isPost(e.to) ? 0 : (e.tp || 0);
      editor.addConnection(a, b, `output_${(e.fp || 0) + 1}`, `input_${into + 1}`);
      const svgEl = editor.container.querySelector(`.connection.node_in_node-${b}.node_out_node-${a}.output_${(e.fp || 0) + 1}.input_${into + 1}`);
      const kind = partOf(e.from) != null ? 'part' : e.from === SINK || e.from === MFX ? 'post' : NODE_TYPES[typeOfId(e.from)]?.kind || 'route';
      svgEl?.classList.add(`k-${kind}`, ...cls.split(' ').filter(Boolean));
      if (s?.edge && edgeKey(s.edge) === edgeKey(e)) svgEl?.querySelector('.main-path')?.classList.add('selected');
    };
    if (routing.on) for (const e of vgp.edges) wire(e);
    else for (const e of withPost({ nodes: [], edges: [] }).edges) wire(e);
    // parts going straight to their input: a faint wire (not part of the graph)
    for (const p of parts) if (!routed.includes(p)) wire({ from: srcId(p), to: SINK }, 'implicit');
    // the selection survives the redraw
    if (s?.node && df.ids[s.node] != null) {
      const el = editor.container.querySelector(`#node-${df.ids[s.node]}`);
      el?.classList.add('selected');
      editor.node_selected = el || null;
    }
  } finally { df.syncing = false; }
  if (!df.key) setTimeout(() => renderRouting()); // (Master FX measured: once more, spaced by it)
}

/** The values on the board (knobs, mute / solo, switches) as they are now — without redrawing it. */
function syncValues() {
  const box = body()?.querySelector('.rt-df');
  if (!box) return;
  const set = (k, v) => { if (!k.classList.contains('dragging') && Math.abs(Number(k.value) - v) > 1e-6) k.value = v; };
  for (const k of box.querySelectorAll('sa-knob[data-master]')) set(k, master.params[k.dataset.master]);
  for (const k of box.querySelectorAll('sa-knob[data-meq]')) set(k, master.eq[Number(k.dataset.meq)] || 0);
  for (const k of box.querySelectorAll('sa-knob[data-mvol]')) set(k, Number($('masterGain')?.value ?? 1));
  for (const k of box.querySelectorAll('sa-knob[data-row]')) { const c = chOf(k.dataset.row); set(k, k.dataset.k === 'vol' ? toDb(c.vol) : Number(c.pan) || 0); }
  for (const b of box.querySelectorAll('button[data-row]')) b.classList.toggle('on', !!chOf(b.dataset.row)[b.dataset.mx]);
  for (const b of box.querySelectorAll('.rt-pow[data-mnode]')) { const off = master.bypass || master.off.includes(b.dataset.mnode); b.classList.toggle('off', off); b.closest('.rt-fxg')?.classList.toggle('off', off); }
  for (const k of box.querySelectorAll('sa-knob[data-p]')) { const n = routing.graph.nodes.find((x) => x.id === k.dataset.node); if (n) set(k, n.params[k.dataset.p]); }
  const out = box.querySelector(`.rt-sub[data-id="${OUT}"]`);
  if (out && out.textContent !== masterDb()) out.textContent = masterDb();
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
  if (id === OUT) return masterAnalyser();
  if (id.startsWith('row:')) return stripIfAny(id.slice(4))?.an || null;
  if (partOf(id) != null) return channelIfAny(partOf(id))?.srcAn || null;
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
  // what comes out
  const mm = el.querySelector('.rt-mmeter i');
  if (mm) {
    const lv = playing ? levelOf(analyserOf(OUT)) : 0; // (the very end: after anything wired after the master)
    const db = lv > 0 ? 20 * Math.log10(lv) : -60;
    mm.style.height = `${Math.max(0, Math.min(100, ((db + 48) / 48) * 100))}%`;
    mm.classList.toggle('hot', db > -6);
  }
}

const stopDraw = () => { try { (routing.rafWin || window).cancelAnimationFrame(routing.raf); } catch {} };

export function setup() {
  linkMixer();
  const st = load().routing;
  routing.graph = normGraph(st?.graph);
  routing.on = st?.on !== false;
  // the channels' EQ moved here from the mixer: EQ (low / mid / high) and EQ7 nodes first in each part's chain
  const moved = Object.entries(mixer.oldEq);
  if (moved.length) {
    let g = routing.graph;
    for (const [part, { three, geq }] of moved) {
      if (part.startsWith('bus:')) continue;
      if (geq) { const r = addNode(g, 'geq', { after: srcId(part) }); g = r.graph; Object.assign(g.nodes.find((n) => n.id === r.id).params, Object.fromEntries(geq.map((v, i) => [`b${i}`, v]))); }
      if (three.low || three.mid || three.high) { const r = addNode(g, 'eq', { after: srcId(part) }); g = r.graph; Object.assign(g.nodes.find((n) => n.id === r.id).params, three); }
    }
    routing.graph = normGraph(g);
    mixer.oldEq = {};
    saveRouting();
    save({ mixerCh: mixer.ch });
    addMsg('info', `🔀 the mixer's EQ settings (${moved.map(([p]) => p).join(', ')}) are now EQ nodes in 🔀 Routing`);
  }
  setupDock('route', {
    onShow: () => { renderRouting(); stopDraw(); draw(); ws.minSize?.('route', 320); },
    onHide: () => stopDraw(),
  });
  onTemplatesChange(() => { df.key = ''; renderRouting(); });
  const bodyEl = $('routeBody');
  // a knob on a card: a node's setting (data-node), the master's (data-master), its EQ (data-meq) and volume
  // (data-mvol), or a channel's fader / pan into the master (data-row) — or, without any, the selected node
  bodyEl.addEventListener('input', (e) => {
    const d = e.target.dataset || {}, v = Number(e.target.value);
    if (d.row) { setChannel(d.row, d.k, d.k === 'vol' ? fromDb(v) : v); mixer.key = ''; return; }
    if (d.master) { setMasterParam(d.master, v); return; }
    if (d.meq != null) { const g = [...master.eq]; g[Number(d.meq)] = v; setMasterEq(g); return; }
    if (d.mvol) { $('masterGain').value = v; $('masterGain').oninput?.(); syncValues(); return; }
    const id = d.node || routing.sel?.node;
    if (d.p && id) setParam(id, d.p, v);
  });
  bodyEl.addEventListener('click', (e) => {
    const t = e.target.closest?.('button');
    if (!t) return;
    if (t.matches('.rt-pow[data-node]')) act.off(t.dataset.node);
    else if (t.matches('.rt-pow[data-mnode]')) { toggleMasterNode(t.dataset.mnode); syncValues(); }
    else if (t.dataset.openEq) openEqualizer(t.dataset.openEq);
    else if (t.dataset.row && t.dataset.mx) {
      const c = chOf(t.dataset.row), k = t.dataset.mx;
      setChannel(t.dataset.row, k, !c[k]);
      if (k === 'mute' && c.mute) setChannel(t.dataset.row, 'solo', false);
      if (k === 'solo' && c.solo) setChannel(t.dataset.row, 'mute', false);
      mixer.key = '';
      syncValues();
    }
  });
  bodyEl.addEventListener('dblclick', (e) => { if (e.target.closest('.rt-master') && !e.target.closest('sa-knob, button')) ws.open('master'); });
  // Drawflow follows the mouse only over its canvas: a drag let go outside it ends there too (in whichever window
  // the panel is — floating or popped out)
  const endDrag = (e) => { const ed = routing.df; if (ed && (ed.drag || ed.connection || ed.editor_selected) && !ed.container.contains(e.target)) ed.dragEnd(e); };
  let watched = null;
  setInterval(() => { const w = winOf(); if (w !== watched) { watched?.removeEventListener('mouseup', endDrag); w.addEventListener('mouseup', endDrag); watched = w; } }, 1000);
  // the music changes (a new song, a section, the code): the board follows — its parts, and their inputs on the master
  const soon = (() => { let t = 0; return () => { if (!t) t = setTimeout(() => { t = 0; if (docks.route?.on && !routing.df?.drag && !routing.df?.connection) renderRouting(); }, 60); }; })();
  for (const ev of ['song', 'section', 'mode', 'transport']) player.on(ev, soon);
  // the audio engine can be rebuilt (and channels come and go): keep the graph wired, and the board current
  setInterval(() => {
    const ctrl = sdController();
    if (routing.on && routing.graph.edges.length && ctrl && (!routing.live || routing.live.ctrl !== ctrl || routing.live.ac !== ctxOf(ctrl))) applyRouting();
    else if (routing.live) for (const p of routedParts(routing.graph)) if (!routing.live.closed.includes(p) && channelIfAny(p)) { applyRouting(); break; }
    if (docks.route?.on && !routing.df?.drag && !routing.df?.connection) renderRouting();
  }, 1500);
}
