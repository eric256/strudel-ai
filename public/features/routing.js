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

const W = 150, H = 76; // a card (style.css .rt-card)
export const routing = {
  graph: { nodes: [], edges: [] }, on: true, sel: null, target: '',
  live: null,       // the audio: { ctrl, bus, blocks: { id: block }, wired: [[a, b]], closed: [part] }
  pos: {}, drag: null, raf: 0, hist: {},
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

// ---- the panel ----
const label = (id) => (id === SINK ? 'master' : partOf(id) ?? (routing.graph.nodes.find((n) => n.id === id) ? NODE_TYPES[routing.graph.nodes.find((n) => n.id === id).type].label : id));
const wireD = (a, b) => { const mx = (a.x + b.x) / 2; return `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`; };
const typeOfId = (id) => routing.graph.nodes.find((n) => n.id === id)?.type;
// a port's height on its card: one port in the middle, two at a third and two thirds
const portY = (count, k) => (count > 1 ? (k ? 0.7 : 0.3) : 0.5) * H;
const outPt = (id, fp = 0) => { const p = routing.pos[id]; return p && { x: p.x + W, y: p.y + portY(partOf(id) != null ? 1 : outPorts(typeOfId(id)), fp) }; };
const inPt = (id, fromY, tp = 0) => {
  const p = routing.pos[id];
  if (!p) return null;
  if (id === SINK) return { x: p.x, y: Math.min(p.y + p.h - 16, Math.max(p.y + 40, fromY)) };
  return { x: p.x, y: p.y + portY(inPorts(typeOfId(id)), tp) };
};

const act = {
  toggle(on) { routing.on = on; applyRouting(); saveRouting(); renderRouting(); },
  add(type) {
    // after the selected part or node, into the selected wire — nothing selected: after the part picked in the bar
    const s = routing.sel;
    const part = routing.target || mixerChannels()[0]?.base;
    const opts = s?.edge ? { onEdge: s.edge } : s?.node ? { after: s.node } : part ? { after: srcId(part) } : {};
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
    if (s.node && partOf(s.node) != null) setGraph(unroutePart(routing.graph, partOf(s.node)));
    else if (s.node) setGraph(removeNode(routing.graph, s.node));
    else if (s.edge) setGraph(removeEdge(routing.graph, s.edge));
  },
  off() {
    const n = routing.graph.nodes.find((x) => x.id === routing.sel?.node);
    if (!n) return;
    n.off = !n.off;
    routing.live?.blocks[n.id]?.set(n.params, n.off);
    saveRouting();
    renderRouting();
  },
};
const flash = (msg) => addMsg('info', `🔀 ${msg}`);

export function renderRouting() {
  const el = $('routeBody');
  if (!el || !docks.route?.on) return;
  const g = routing.graph;
  const chans = mixerChannels();
  // parts in the graph that aren't playing now still show (their routing waits for them)
  const parts = [...chans.map((c) => c.base)];
  for (const p of routedParts(g)) if (!parts.includes(p)) parts.push(p);
  routing.pos = layoutGraph(g, parts, { colW: W + 44, rowH: H + 16 });
  if (routing.drag?.node && routing.drag.moved) routing.pos[routing.drag.node] = { x: routing.drag.x, y: routing.drag.y };
  const routed = routedParts(g), dead = deadEnds(g), dry = unfed(g);
  const s = routing.sel;
  const wires = [];
  const kindOf = (id) => (partOf(id) != null ? 'part' : NODE_TYPES[g.nodes.find((n) => n.id === id)?.type]?.kind || 'route');
  for (const e of g.edges) {
    const a = outPt(e.from, e.fp), b = a && inPt(e.to, a.y, e.tp);
    if (a && b) wires.push({ from: e.from, to: e.to, fp: e.fp || 0, tp: e.tp || 0, d: wireD(a, b), kind: kindOf(e.from), selected: !!s?.edge && edgeKey(s.edge) === edgeKey(e) });
  }
  for (const p of parts) if (!routed.includes(p) || !routing.on) {
    const a = outPt(srcId(p)), b = a && inPt(SINK, a.y);
    if (a && b) wires.push({ from: srcId(p), to: SINK, d: wireD(a, b), kind: 'part', implicit: true });
  }
  const m = routing.pos[SINK];
  const maxX = Math.max(...Object.values(routing.pos).map((p) => p.x + W)) + 20;
  const maxY = Math.max(...Object.values(routing.pos).map((p) => p.y + (p.h || H))) + 20;
  const selNode = s?.node && g.nodes.find((n) => n.id === s.node);
  const view = {
    on: routing.on, w: maxX, h: maxY,
    parts: parts.map((p) => ({ id: srcId(p), base: p, color: vizColor(p), routed: routing.on && routed.includes(p), selected: s?.node === srcId(p), ...routing.pos[srcId(p)] })),
    nodes: g.nodes.map((n) => ({ ins: inPorts(n.type), outs: outPorts(n.type),
      id: n.id, type: n.type, label: NODE_TYPES[n.type].label, kind: NODE_TYPES[n.type].kind, title: NODE_TYPES[n.type].title,
      summary: nodeSummary(g, n), off: !!n.off, dead: dead.includes(n.id), unfed: dry.includes(n.id), selected: s?.node === n.id, ...routing.pos[n.id],
    })),
    master: { ...m, db: masterDb() },
    wires,
    drag: routing.drag?.wire ? { d: wireD(routing.drag.from, routing.drag.to) } : null,
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
}
function masterDb() {
  const v = Number($('masterGain')?.value ?? 1);
  return v <= 0.0001 ? '-∞ dB' : `${(20 * Math.log10(v)).toFixed(1)} dB`;
}

// ---- pointer: drag nodes and parts, drag wires, select ----
// The pointer is captured by the panel, so a drag keeps going outside it and works the same when the panel is
// floating or popped out into its own window (that window's document and frames, not this one's).
const body = () => $('routeBody');
const winOf = () => body()?.ownerDocument.defaultView || window;
function canvasPt(e) {
  const r = body().querySelector('.rt-canvas').getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
let frame = 0;
const rerender = () => { if (!frame) frame = winOf().requestAnimationFrame(() => { frame = 0; renderRouting(); }); };
function capture(e) { try { body().setPointerCapture(e.pointerId); } catch {} }
function onDown(e) {
  if (e.button !== 0 || e.target.closest('.rt-insp, .rt-bar')) return;
  body().focus({ preventScroll: true }); // (for Delete / Esc)
  const port = e.target.closest('.rt-port[data-port="out"]');
  if (port) {
    e.preventDefault();
    const from = port.dataset.id, fp = Number(port.dataset.k) || 0;
    routing.drag = { wire: true, id: from, fp, from: outPt(from, fp), to: canvasPt(e) };
    capture(e);
    rerender();
    return;
  }
  const card = e.target.closest('.rt-card[data-drag]');
  if (card) {
    e.preventDefault(); // (no text selection while dragging)
    const id = card.dataset.id, p = routing.pos[id], pt = canvasPt(e);
    routing.drag = { node: id, dx: pt.x - p.x, dy: pt.y - p.y, x: p.x, y: p.y, x0: e.clientX, y0: e.clientY, moved: false };
    capture(e);
    return;
  }
  const hit = e.target.closest('path.hit');
  if (hit) {
    const d = hit.dataset;
    routing.sel = { edge: { from: d.from, to: d.to, fp: Number(d.fp) || 0, tp: Number(d.tp) || 0 } };
    renderRouting();
    return;
  }
  if (e.target.closest('.rt-canvas') && !e.target.closest('.rt-card')) { routing.sel = null; renderRouting(); }
}
function onMove(e) {
  const d = routing.drag;
  if (!d) return;
  if (d.wire) { d.to = canvasPt(e); rerender(); return; }
  if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
  d.moved = true;
  const pt = canvasPt(e);
  d.x = Math.max(0, Math.round(pt.x - d.dx));
  d.y = Math.max(0, Math.round(pt.y - d.dy));
  rerender();
}
function onUp(e) {
  const d = routing.drag;
  if (!d) return;
  routing.drag = null;
  try { body().releasePointerCapture(e.pointerId); } catch {}
  if (e.type === 'pointercancel') { renderRouting(); return; }
  if (d.wire) {
    // dropped on an input port (a Sum's first or second), or anywhere on a card (a Sum: its free input)
    const at = body().ownerDocument.elementFromPoint(e.clientX, e.clientY);
    const port = at?.closest('.rt-port[data-port="in"]');
    const to = (port || at?.closest('.rt-card[data-in="1"]'))?.dataset.id;
    const tp = port ? Number(port.dataset.k) || 0 : typeOfId(to) === 'sum' ? freeInput(routing.graph, to) : 0;
    if (to && canConnect(routing.graph, d.id, to, { fp: d.fp, tp })) {
      // wiring a part that went straight to the master: it now goes here instead
      setGraph(connect(routing.graph, d.id, to, { fp: d.fp, tp }));
    } else renderRouting();
    return;
  }
  if (d.moved) {
    if (partOf(d.node) != null) routing.graph = { ...routing.graph, pins: { ...routing.graph.pins, [d.node]: { x: d.x, y: d.y } } };
    else { const n = routing.graph.nodes.find((x) => x.id === d.node); if (n) { n.x = d.x; n.y = d.y; } }
    routing.graph = normGraph(routing.graph);
    saveRouting();
  } else {
    routing.sel = { node: d.node };
    if (partOf(d.node) != null) routing.target = partOf(d.node);
  }
  renderRouting();
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
  const body = $('routeBody');
  body.addEventListener('pointerdown', onDown);
  body.addEventListener('pointermove', onMove);
  body.addEventListener('pointerup', onUp);
  body.addEventListener('pointercancel', onUp);
  body.addEventListener('input', (e) => { const k = e.target.dataset?.p; if (k && routing.sel?.node) setParam(routing.sel.node, k, Number(e.target.value)); });
  body.addEventListener('dblclick', (e) => { if (e.target.closest('.rt-master')) ws.open('master'); });
  body.tabIndex = -1;
  body.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && routing.sel && !e.target.closest('input, select, textarea')) { e.preventDefault(); act.remove(); }
    if (e.key === 'Escape') { routing.sel = null; renderRouting(); }
  });
  // the audio engine can be rebuilt (and channels come and go): keep the graph wired, and the panel's parts current
  setInterval(() => {
    const ctrl = sdController();
    if (routing.on && routing.graph.edges.length && ctrl && (!routing.live || routing.live.ctrl !== ctrl || routing.live.bus.context !== ctxOf(ctrl))) applyRouting();
    else if (routing.live) for (const p of routedParts(routing.graph)) if (!routing.live.closed.includes(p) && channelIfAny(p)) { applyRouting(); break; }
    if (docks.route?.on && !routing.drag) renderRouting();
  }, 1500);
}
