// 🔀 Routing: the sound of each part after its mixer fader, as a graph of effect nodes — split into parallel paths,
// compress, saturate, EQ, filter, reverb, delay, sum them back, group parts into a bus — ending at the master.
// Pure: the graph model, its rules (no loops, values in range), templates and the layout. The audio is built in
// routing-audio.js, the panel in features/routing.js.
//
// A graph: { nodes: [{ id, type, params, off?, x?, y? }], edges: [{ from, to }] }
// Sources are the parts, `src:<part>`; the sink is `master`. A part with no edge from its source goes straight to
// the master (as without routing).

/** The node types: label, colour family, and their controls [min, max, step, default, label, unit]. */
export const NODE_TYPES = {
  split: { label: 'Split', kind: 'route', title: 'Sends the sound down several paths at once (parallel processing)', params: {} },
  sum: { label: 'Sum', kind: 'route', title: 'Adds its inputs back together', params: {} },
  gain: { label: 'Gain', kind: 'route', title: 'Turns the level up or down', params: { db: [-24, 12, 0.5, 0, 'level', 'dB'] } },
  comp: {
    label: 'Comp', kind: 'dyn', title: 'Compressor: evens out the level (and glues a bus)',
    params: { thresh: [-60, 0, 1, -24, 'thresh', 'dB'], ratio: [1, 20, 0.5, 4, 'ratio', ':1'], attack: [1, 200, 1, 10, 'attack', 'ms'], release: [20, 1000, 5, 200, 'release', 'ms'], makeup: [0, 24, 0.5, 0, 'makeup', 'dB'] },
  },
  sat: { label: 'Sat', kind: 'dyn', title: 'Saturation: warm, then gritty harmonics', params: { drive: [0, 30, 0.5, 6, 'drive', 'dB'], mix: [0, 1, 0.05, 1, 'mix', ''] } },
  eq: { label: 'EQ', kind: 'dyn', title: '3-band EQ: low shelf 200 Hz, mid 1 kHz, high shelf 4 kHz', params: { low: [-12, 12, 0.5, 0, 'low', 'dB'], mid: [-12, 12, 0.5, 0, 'mid', 'dB'], high: [-12, 12, 0.5, 0, 'high', 'dB'] } },
  geq: {
    label: 'EQ7', kind: 'dyn', title: '7-band EQ (60 Hz … 12 kHz, ±12 dB) — also in the 🎚 Equalizer, with its curve and presets',
    params: { b0: [-12, 12, 0.5, 0, '60', 'dB'], b1: [-12, 12, 0.5, 0, '150', 'dB'], b2: [-12, 12, 0.5, 0, '400', 'dB'], b3: [-12, 12, 0.5, 0, '1k', 'dB'], b4: [-12, 12, 0.5, 0, '2.5k', 'dB'], b5: [-12, 12, 0.5, 0, '6k', 'dB'], b6: [-12, 12, 0.5, 0, '12k', 'dB'] },
  },
  filter: { label: 'Filter', kind: 'dyn', title: 'High-pass and low-pass', params: { hp: [20, 2000, 1, 20, 'hp', 'Hz'], lp: [200, 20000, 10, 20000, 'lp', 'Hz'] } },
  verb: { label: 'Verb', kind: 'space', title: 'Reverb', params: { size: [0.2, 8, 0.1, 2, 'size', 's'], mix: [0, 1, 0.05, 0.3, 'mix', ''] } },
  delay: { label: 'Delay', kind: 'space', title: 'Echo', params: { time: [0.02, 1, 0.01, 0.25, 'time', 's'], feedback: [0, 0.9, 0.01, 0.35, 'fdbk', ''], mix: [0, 1, 0.05, 0.3, 'mix', ''] } },
  duck: {
    label: 'Duck', kind: 'dyn', title: 'Sidechain ducking: turns this sound down whenever the key (its 2nd input, e.g. the kick) plays — the pump of house and EDM, room for the kick in a busy mix',
    params: { depth: [-30, 0, 0.5, -10, 'depth', 'dB'], attack: [1, 100, 1, 5, 'attack', 'ms'], release: [20, 1000, 5, 180, 'release', 'ms'], sens: [0.5, 10, 0.1, 3, 'sens', '×'] },
  },
};
export const SINK = 'master';
/**
 * After the master (the sum of every channel): the Master FX block (the master style's chain) and Out (the master
 * volume, the speakers). Fixed, like the master: the wires between them are yours — effects after the mix, around
 * Master FX, in parallel. With no wires after the master, it's master → Master FX → out (withPost).
 */
export const MFX = 'mfx';
export const OUT = 'out';
export const srcId = (part) => `src:${part}`;
export const partOf = (id) => (typeof id === 'string' && id.startsWith('src:') ? id.slice(4) : null);
const isEnd = (id) => id === SINK || id === MFX || id === OUT || partOf(id) != null;

export const defaultParams = (type) => Object.fromEntries(Object.entries(NODE_TYPES[type]?.params || {}).map(([k, d]) => [k, d[3]]));
const clamp = (v, [min, max, step, def]) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const s = Math.round((Math.min(max, Math.max(min, n)) - min) / step) * step + min;
  return Math.round(s * 10000) / 10000;
};

// Ports: a Split has two outputs (fp: 0 | 1), a Sum two inputs (tp: 0 | 1). Both are visual (each output of a
// Split carries the same sound; a Sum adds everything that comes in), so a path's place is clear on the canvas.
export const outPorts = (type) => (type === 'split' ? 2 : 1);
export const inPorts = (type) => (type === 'sum' || type === 'duck' ? 2 : 1);
/**
 * A Duck's second input is its key (the sidechain): what comes in there only steers the ducking — it isn't heard
 * through the Duck. So a key wire doesn't route its part (the part still goes its own way to the master), doesn't
 * make a bus, and stays when its part is unrouted.
 */
/** A song's own board from its JSON ({ graph, on }) → normalised, or null (none, or nothing on it). */
export function songRouting(r) {
  if (!r || typeof r !== 'object' || !r.graph) return null;
  const graph = normGraph(r.graph);
  return graph.nodes.length || graph.edges.length ? { graph, on: r.on !== false } : null;
}
export const isKey = (g, e) => e.tp === 1 && typeOf(g.nodes, e.to) === 'duck';
/** The wires that carry sound (all but the Ducks' keys). */
export const audioEdges = (g) => g.edges.filter((e) => !isKey(g, e));
const typeOf = (nodes, id) => nodes.find((n) => n.id === id)?.type;
export const edgeKey = (e) => `${e.from}:${e.fp || 0}>${e.to}:${e.tp || 0}`;
const sameEdge = (a, b) => a.from === b.from && a.to === b.to && (a.fp || 0) === (b.fp || 0) && (a.tp || 0) === (b.tp || 0);

/**
 * A clean, safe graph: known types, values in range, unique ids, edges only between real nodes, ports that exist,
 * and no loops. A Split with every wire on one output spreads them over both (same for a Sum's inputs), so graphs
 * written without ports (templates, older saves) get them. `pins`: where you put the parts' cards.
 */
export function normGraph(g) {
  const nodes = [];
  for (const n of Array.isArray(g?.nodes) ? g.nodes : []) {
    const t = NODE_TYPES[n?.type];
    const id = String(n?.id || '');
    if (!t || !id || isEnd(id) || nodes.some((x) => x.id === id)) continue;
    const params = Object.fromEntries(Object.entries(t.params).map(([k, d]) => [k, clamp(n.params?.[k] ?? d[3], d)]));
    const node = { id, type: n.type, params };
    if (n.off) node.off = true;
    if (Number.isFinite(n.x) && Number.isFinite(n.y)) Object.assign(node, { x: Math.round(n.x), y: Math.round(n.y) });
    nodes.push(node);
  }
  const ok = (id) => partOf(id) != null || id === SINK || id === MFX || id === OUT || nodes.some((n) => n.id === id);
  const edges = [];
  for (const e of Array.isArray(g?.edges) ? g.edges : []) {
    const from = String(e?.from || ''), to = String(e?.to || '');
    if (!ok(from) || !ok(to) || from === to || from === OUT || partOf(to) != null) continue;
    const edge = { from, to };
    if (e.fp === 1 && typeOf(nodes, from) === 'split') edge.fp = 1;
    if (e.tp === 1 && ['sum', 'duck'].includes(typeOf(nodes, to))) edge.tp = 1;
    if (edges.some((x) => sameEdge(x, edge))) continue;
    if (reaches({ edges }, to, from)) continue; // would close a loop
    edges.push(edge);
  }
  for (const n of nodes) {
    if (n.type === 'split') { const outs = edges.filter((e) => e.from === n.id); if (outs.length > 1 && !outs.some((e) => e.fp)) outs.slice(1).forEach((e) => { e.fp = 1; }); }
    if (n.type === 'sum') { const ins = edges.filter((e) => e.to === n.id); if (ins.length > 1 && !ins.some((e) => e.tp)) ins.slice(1).forEach((e) => { e.tp = 1; }); }
  }
  const out = { nodes, edges };
  const pins = {};
  for (const [id, p] of Object.entries(g?.pins || {})) if ((partOf(id) != null || id === SINK) && Number.isFinite(p?.x) && Number.isFinite(p?.y)) pins[id] = { x: Math.round(p.x), y: Math.round(p.y) };
  if (Object.keys(pins).length) out.pins = pins;
  return out;
}

/** Is there a path a → … → b? */
export function reaches(g, a, b) {
  const seen = new Set([a]), todo = [a];
  while (todo.length) {
    const x = todo.pop();
    if (x === b) return true;
    for (const e of g.edges) if (e.from === x && !seen.has(e.to)) { seen.add(e.to); todo.push(e.to); }
  }
  return false;
}
/** Is there a path a → … → b before the master (not through it)? */
export function reachesPre(g, a, b) {
  const seen = new Set([a]), todo = [a];
  while (todo.length) {
    const x = todo.pop();
    if (x === b) return true;
    if (x === SINK) continue;
    for (const e of g.edges) if (e.from === x && !seen.has(e.to)) { seen.add(e.to); todo.push(e.to); }
  }
  return false;
}
/** The nodes after the master (its sum reaches them). */
export const postNodes = (g) => g.nodes.filter((n) => reaches(g, SINK, n.id)).map((n) => n.id);
/** The graph with the default way out when nothing says otherwise: master → Master FX → out. */
export function withPost(g) {
  const edges = [...g.edges];
  if (!edges.some((e) => e.from === SINK)) edges.push({ from: SINK, to: MFX });
  if (!edges.some((e) => e.to === OUT)) edges.push({ from: MFX, to: OUT });
  return { ...g, edges };
}
/** Can this edge be added? (not out of Out, not into a part, not twice, no loop) */
export const canConnect = (g, from, to, { fp = 0, tp = 0 } = {}) => from !== to && from !== OUT && partOf(to) == null
  && !g.edges.some((e) => sameEdge(e, { from, to, fp, tp })) && !reaches(g, to, from);

/** The parts that are routed (have an edge from their source): the others go straight to the master. */
export const routedParts = (g) => [...new Set(audioEdges(g).map((e) => partOf(e.from)).filter((p) => p != null))];
/** Nodes whose sound never reaches the master (a dead end: you won't hear what goes in). */
export const deadEnds = (g) => g.nodes.filter((n) => !reaches(g, n.id, SINK) && !reaches(g, n.id, OUT)).map((n) => n.id);
/** Nodes nothing flows into (they make no sound). */
export const unfed = (g) => g.nodes.filter((n) => !g.edges.some((e) => e.to === n.id)).map((n) => n.id);

export const newId = (g, taken = []) => { let k = 1; while (g.nodes.some((n) => n.id === `n${k}`) || taken.includes(`n${k}`)) k++; return `n${k}`; };
/** A Sum's free input (0 if both are taken). */
export const freeInput = (g, sum) => (g.edges.some((e) => e.to === sum && !e.tp) ? (g.edges.some((e) => e.to === sum && e.tp === 1) ? 0 : 1) : 0);

/**
 * Add a node:
 *  - into a wire (onEdge): from → new → to;
 *  - after a node or a part (after): between it and what it fed (a part going straight to the master: through the
 *    new node to the master). After a Split it goes on its second path (the one you process), keeping the first;
 *  - on its own (neither).
 * A new Split comes with its Sum: in → Split ⇒ both paths → Sum → out, ready for an effect on one path.
 */
export function addNode(g, type, { onEdge = null, after = null, x, y } = {}) {
  const id = newId(g);
  const nodes = [...g.nodes, { id, type, params: defaultParams(type), ...(Number.isFinite(x) ? { x, y } : {}) }];
  let edges = [...g.edges];
  // where the new node's input comes from, and where its output goes
  let ins = [], outs = [];
  if (onEdge) {
    edges = edges.filter((e) => !sameEdge(e, onEdge));
    ins = [{ from: onEdge.from, fp: onEdge.fp || 0 }];
    outs = [{ to: onEdge.to, tp: onEdge.tp || 0 }];
  } else if (after) {
    let mine = edges.filter((e) => e.from === after && !isKey(g, e)); // (its key wires stay where they are)
    if (typeOf(g.nodes, after) === 'split') {
      const second = mine.filter((e) => e.fp === 1);
      if (second.length) mine = second;
      else {
        // its second path is free: the new node takes it, and goes where the first path goes (a Sum's free input)
        const first = mine.filter((e) => !e.fp);
        ins = [{ from: after, fp: 1 }];
        outs = first.length ? first.map((e) => ({ to: e.to, tp: typeOf(g.nodes, e.to) === 'sum' ? freeInput(g, e.to) : 0 })) : [{ to: SINK, tp: 0 }];
        mine = null;
      }
    }
    if (mine) {
      edges = edges.filter((e) => !mine.includes(e));
      ins = [{ from: after, fp: mine[0]?.fp || 0 }];
      outs = mine.length ? mine.map((e) => ({ to: e.to, tp: e.tp || 0 })) : [{ to: SINK, tp: 0 }];
    }
  }
  if (type === 'split' && (ins.length || outs.length)) {
    const sum = newId({ nodes }, [id]);
    nodes.push({ id: sum, type: 'sum', params: {} });
    edges.push(...ins.map((i) => ({ from: i.from, fp: i.fp, to: id })), { from: id, to: sum }, { from: id, fp: 1, to: sum, tp: 1 }, ...outs.map((o) => ({ from: sum, to: o.to, tp: o.tp })));
  } else {
    edges.push(...ins.map((i) => ({ from: i.from, fp: i.fp, to: id })), ...outs.map((o) => ({ from: id, to: o.to, tp: o.tp })));
  }
  return { graph: normGraph({ ...g, nodes, edges }), id };
}
/** Remove a node and heal the chain: what fed it now feeds what it fed (once per pair). */
export function removeNode(g, id) {
  const ins = g.edges.filter((e) => e.to === id && !isKey(g, e)); // (a Duck's key doesn't carry on past it)
  const outs = g.edges.filter((e) => e.from === id);
  const edges = g.edges.filter((e) => e.from !== id && e.to !== id);
  for (const a of ins) for (const b of outs) if (!edges.some((e) => e.from === a.from && e.to === b.to)) edges.push({ from: a.from, fp: a.fp, to: b.to, tp: b.tp });
  return normGraph({ ...g, nodes: g.nodes.filter((n) => n.id !== id), edges });
}
export const removeEdge = (g, edge) => normGraph({ ...g, edges: g.edges.filter((e) => !sameEdge(e, edge)) });
export const connect = (g, from, to, ports = {}) => (canConnect(g, from, to, ports) ? normGraph({ ...g, edges: [...g.edges, { from, to, fp: ports.fp || 0, tp: ports.tp || 0 }] }) : g);
/** Take a part's routing out: the nodes only it feeds go too, and it goes straight to the master again. */
export function unroutePart(g, part) {
  const src = srcId(part);
  const mine = new Set();
  // (whose sound reaches what: along the sound's wires, not the Ducks' keys)
  const ag = { ...g, edges: audioEdges(g) };
  const others = ag.edges.filter((e) => partOf(e.from) != null && e.from !== src).map((e) => e.from);
  const fromOthers = new Set();
  // (only before the master: what's after it belongs to everyone)
  for (const o of others) for (const n of g.nodes) if (reachesPre(ag, o, n.id)) fromOthers.add(n.id);
  for (const n of g.nodes) if (reachesPre(ag, src, n.id) && !fromOthers.has(n.id)) mine.add(n.id);
  // (the part's key wires stay: it still steers the Ducks it keys)
  return normGraph({ ...g, nodes: g.nodes.filter((n) => !mine.has(n.id)), edges: g.edges.filter((e) => (e.from !== src || isKey(g, e)) && !mine.has(e.from) && !mine.has(e.to)) });
}

/** The line under a node's name: what it's doing (live readouts come from the audio: gr = gain reduction). */
export function nodeSummary(g, n, live = {}) {
  const p = n.params || {};
  const pct = (v) => `${Math.round(v * 100)}%`;
  switch (n.type) {
    case 'split': return `${new Set(g.edges.filter((e) => e.from === n.id).map((e) => e.fp || 0)).size} of 2 paths`;
    case 'sum': return `${g.edges.filter((e) => e.to === n.id).length} in · summing`;
    case 'gain': return `${p.db > 0 ? '+' : ''}${p.db} dB`;
    case 'comp': return live.gr != null ? `GR ${Math.abs(live.gr).toFixed(1)} dB` : `${p.ratio}:1 at ${p.thresh} dB`;
    case 'sat': return `Drive ${p.drive} dB${p.mix < 1 ? ` · ${pct(p.mix)}` : ''}`;
    case 'eq': return ['low', 'mid', 'high'].filter((k) => p[k]).map((k) => `${k[0].toUpperCase()} ${p[k] > 0 ? '+' : ''}${p[k]}`).join(' ') || '0 dB';
    case 'geq': { const g7 = [0, 1, 2, 3, 4, 5, 6].map((i) => p[`b${i}`] || 0); return g7.every((v) => !v) ? 'flat' : g7.map((v) => (v > 0 ? '+' : '') + v).join(' '); }
    case 'filter': return [p.hp > 20 && `HP ${Math.round(p.hp)}`, p.lp < 20000 && `LP ${p.lp >= 1000 ? `${(p.lp / 1000).toFixed(1)}k` : p.lp}`].filter(Boolean).join(' · ') || 'open';
    case 'verb': return `Mix ${pct(p.mix)} · ${p.size}s`;
    case 'delay': return `${Math.round(p.time * 1000)} ms · Mix ${pct(p.mix)}`;
    case 'duck': {
      const keys = [...new Set(g.edges.filter((e) => e.to === n.id && e.tp === 1).flatMap((e) => upstreamParts({ ...g, edges: audioEdges(g) }, e.from)))];
      return `${p.depth} dB · ${keys.length ? `to ${keys.join(' + ')}` : 'no key yet'}${live.duck != null ? ` · −${Math.abs(live.duck).toFixed(1)}` : ''}`;
    }
    default: return '';
  }
}

/** The parts whose sound reaches node id (a part's own source: just that part). */
export function upstreamParts(g, id) {
  if (partOf(id) != null) return [partOf(id)];
  const out = new Set(), seen = new Set([id]), todo = [id];
  const edges = audioEdges(g);
  while (todo.length) {
    const x = todo.pop();
    for (const e of edges) if (e.to === x && !seen.has(e.from) && e.from !== SINK) { seen.add(e.from); if (partOf(e.from) != null) out.add(partOf(e.from)); else todo.push(e.from); }
  }
  return [...out];
}
/**
 * The master's inputs: one per channel coming in — each part that reaches the master on its own (whatever its
 * paths), and each bus (a node that several parts reach) wired to it. A part with no wires is its own input too.
 * In the parts' order (a bus where its first part is). [{ key, part | null, parts, from: [ids] }]
 * The key is the part's name, or 'bus:<node id>' — its fader, pan, mute and solo are kept under it.
 */
export function masterInputs(g, parts) {
  const byKey = new Map();
  const add = (key, entry, from) => { const x = byKey.get(key) || { key, ...entry, from: [] }; if (from && !x.from.includes(from)) x.from.push(from); byKey.set(key, x); };
  for (const e of g.edges) {
    if (e.to !== SINK) continue;
    const up = upstreamParts(g, e.from);
    if (up.length === 1) add(up[0], { part: up[0], parts: up }, e.from);
    else if (up.length > 1) add(`bus:${e.from}`, { part: null, parts: up }, e.from);
  }
  const routed = new Set(routedParts(g));
  for (const p of parts) if (!routed.has(p)) add(p, { part: p, parts: [p] }, srcId(p));
  const rank = (x) => Math.min(...x.parts.map((p) => (parts.includes(p) ? parts.indexOf(p) : 1e6)));
  return [...byKey.values()].sort((a, b) => rank(a) - rank(b) || (a.part ? -1 : 1));
}
/** The key of the master input an edge into the master feeds. */
export const inputKey = (g, from) => { const up = upstreamParts(g, from); return up.length === 1 ? up[0] : `bus:${from}`; };
/**
 * What to show for the parts in the music now: those parts, the nodes they reach (and new nodes nothing feeds yet),
 * and the wires between them. Routing of parts that aren't in this music is kept, just not shown.
 */
export function visibleGraph(g, parts) {
  const reach = new Set(), todo = [...parts.map(srcId), SINK]; // (what's after the master always shows)
  while (todo.length) { const x = todo.pop(); for (const e of g.edges) if (e.from === x && !reach.has(e.to)) { reach.add(e.to); todo.push(e.to); } }
  const show = (id) => id === SINK || id === MFX || id === OUT || (partOf(id) != null ? parts.includes(partOf(id)) : reach.has(id) || !g.edges.some((e) => e.to === id));
  return { ...g, nodes: g.nodes.filter((n) => show(n.id)), edges: g.edges.filter((e) => show(e.from) && show(e.to)) };
}

/**
 * Where everything goes on the canvas: parts in a column on the left (in the mixer's order), the master on the
 * right, each node a column after the furthest node feeding it. A part's chain stays on its row; a Split's second
 * path goes on a new row below. Nodes and parts you've placed by hand stay put.
 */
export function layoutGraph(g, parts, { colW = 190, rowH = 125, pad = 18 } = {}) {
  const depth = {};
  const outsOf = (id) => g.edges.filter((e) => e.from === id).sort((a, b) => (a.fp || 0) - (b.fp || 0));
  // longest path from any part (no loops, so this terminates)
  const visit = (id, d) => {
    if (id === SINK || id === MFX || id === OUT) return;
    if (depth[id] != null && depth[id] >= d) return;
    depth[id] = d;
    for (const e of outsOf(id)) visit(e.to, d + 1);
  };
  for (const p of parts) visit(srcId(p), 0);
  const post = new Set(postNodes(g)); // (after the master: laid out from it, by the panel)
  for (const n of g.nodes) if (depth[n.id] == null && !post.has(n.id)) visit(n.id, 1);
  const row = {};
  let next = 0;
  const place = (id, r) => {
    if (id === SINK || id === MFX || id === OUT || row[id] != null) return;
    row[id] = r;
    let first = true;
    for (const e of outsOf(id)) { if (e.to === SINK || row[e.to] != null) continue; place(e.to, first ? r : next++); first = false; }
  };
  for (const p of parts) place(srcId(p), next++);
  for (const n of g.nodes) if (row[n.id] == null && !post.has(n.id)) place(n.id, next++);
  const cols = Math.max(1, ...Object.values(depth)) + 1;
  const pos = {};
  for (const [id, d] of Object.entries(depth)) pos[id] = { x: pad + d * colW, y: pad + (row[id] ?? 0) * rowH };
  for (const n of g.nodes) if (Number.isFinite(n.x)) pos[n.id] = { x: n.x, y: n.y };
  for (const [id, p] of Object.entries(g.pins || {})) if (pos[id]) pos[id] = { ...p };
  const maxX = Math.max(pad + cols * colW, ...Object.values(pos).map((p) => p.x + colW));
  const maxY = Math.max(next * rowH, ...Object.values(pos).map((p) => p.y + rowH));
  pos[SINK] = { x: maxX, y: pad, h: Math.max(maxY - pad - 20, 200) };
  return pos;
}
/**
 * After the master, left to right: each node (Master FX and Out too) a column after the furthest thing feeding it,
 * the first path on the master's row, a second path a row below. { id: { col, row } } — col 1 is right after it.
 */
export function layoutPost(g) {
  const gp = withPost(g);
  const outsOf = (id) => gp.edges.filter((e) => e.from === id).sort((a, b) => (a.fp || 0) - (b.fp || 0));
  const col = {};
  const visit = (id, d) => {
    if (col[id] != null && col[id] >= d) return;
    col[id] = d;
    if (id !== OUT) for (const e of outsOf(id)) if (partOf(e.to) == null && e.to !== SINK) visit(e.to, d + 1);
  };
  for (const e of outsOf(SINK)) visit(e.to, 1);
  // what nothing after the master reaches (Master FX left out of the path, say): after the rest
  const last = Math.max(0, ...Object.values(col));
  for (const id of [MFX, OUT]) if (col[id] == null) col[id] = last + 1;
  if (col[OUT] <= col[MFX] && !reaches(gp, OUT, MFX)) col[OUT] = Math.max(col[OUT], col[MFX] + 1);
  const row = {};
  let next = 1;
  const place = (id, r) => {
    if (row[id] != null || col[id] == null) return;
    row[id] = r;
    let first = true;
    for (const e of outsOf(id)) { if (row[e.to] != null || col[e.to] == null) continue; place(e.to, first ? r : next++); first = false; }
  };
  for (const e of outsOf(SINK)) place(e.to, row[e.to] == null && Object.keys(row).length ? next++ : 0);
  for (const id of Object.keys(col)) if (row[id] == null) row[id] = next++;
  return Object.fromEntries(Object.keys(col).map((id) => [id, { col: col[id], row: row[id] }]));
}
/** Forget hand placement (tidy up). */
export const unplace = (g) => ({ nodes: g.nodes.map(({ x, y, ...n }) => n), edges: g.edges });

// ---- templates: a ready-made chain for one part (or a bus for several) ----
const looksLike = (re) => (c) => re.test(c.role || '') || re.test(c.base);
const DRUMS = looksLike(/drum|kick|snare|hat|perc|clap|beat|bd|sd|hh/i);
/**
 * TEMPLATES[key]: { label, title, needs: 'part' | 'parts', pick(channels) (for 'parts'), none (when it picks nothing),
 * build(g, parts) → graph }. Built onto the graph as it is: the part's old routing is taken out first (Duck to kick
 * keeps it, and goes in front).
 */
export const TEMPLATES = {
  nycomp: {
    label: 'Parallel comp', title: 'New York compression: a squashed, driven copy under the dry sound — punch without losing the hits', needs: 'part',
    build(g, [part]) {
      return chain(unroutePart(g, part), part, (add, link) => {
        const s = add('split'), c = add('comp', { thresh: -36, ratio: 10, attack: 3, release: 120, makeup: 8 }), sat = add('sat', { drive: 4 }), sum = add('sum');
        link(srcId(part), s); link(s, sum); link(s, c); link(c, sat); link(sat, sum); link(sum, SINK);
      });
    },
  },
  space: {
    label: 'Wet space', title: 'Comp, then a 100% wet reverb path summed under the dry sound — big space, still upfront', needs: 'part',
    build(g, [part]) {
      return chain(unroutePart(g, part), part, (add, link) => {
        const c = add('comp', { thresh: -24, ratio: 3, makeup: 3 }), s = add('split'), v = add('verb', { size: 3.5, mix: 1 }), sum = add('sum');
        link(srcId(part), c); link(c, s); link(s, sum); link(s, v); link(v, sum); link(sum, SINK);
      });
    },
  },
  clean: {
    label: 'Clean', title: 'High-pass the rumble, a gentle EQ and comp — a clean, steady part', needs: 'part',
    build(g, [part]) {
      return chain(unroutePart(g, part), part, (add, link) => {
        const f = add('filter', { hp: 40 }), e = add('eq'), c = add('comp', { thresh: -20, ratio: 3, makeup: 2 });
        link(srcId(part), f); link(f, e); link(e, c); link(c, SINK);
      });
    },
  },
  dub: {
    label: 'Dub echo', title: 'A filtered echo path summed under the dry sound', needs: 'part',
    build(g, [part]) {
      return chain(unroutePart(g, part), part, (add, link) => {
        const s = add('split'), f = add('filter', { hp: 300, lp: 3000 }), d = add('delay', { time: 0.375, feedback: 0.55, mix: 1 }), sum = add('sum');
        link(srcId(part), s); link(s, sum); link(s, f); link(f, d); link(d, sum); link(sum, SINK);
      });
    },
  },
  drumbus: {
    label: 'Drum bus', title: 'Every drum part summed into one bus with glue compression and a little saturation', needs: 'parts',
    pick: (chans) => chans.filter(DRUMS).map((c) => c.base),
    build(g, parts) {
      let base = g;
      for (const p of parts) base = unroutePart(base, p);
      return chain(base, parts[0], (add, link) => {
        const sum = add('sum'), c = add('comp', { thresh: -18, ratio: 4, attack: 20, release: 150, makeup: 3 }), sat = add('sat', { drive: 3 });
        for (const p of parts) link(srcId(p), sum);
        link(sum, c); link(c, sat); link(sat, SINK);
      });
    },
  },
  duck: {
    label: 'Duck to kick', title: 'Sidechain: the pads, bass and chords dip whenever the kick hits — a Duck first in each of their chains (what they have stays), keyed by the kick', needs: 'parts',
    none: 'needs a kick (or drum) part and something to duck under it',
    pick(chans) {
      const key = chans.find(looksLike(/kick|\bbd\b/i)) || chans.find(DRUMS);
      if (!key) return [];
      const rest = chans.filter((c) => c !== key && !DRUMS(c));
      const under = rest.filter(looksLike(/pad|bass|chord|key|string|synth|organ|piano|rhodes|stab|drone|texture/i));
      const pick = under.length ? under : rest;
      return pick.length ? [key.base, ...pick.map((c) => c.base)] : [];
    },
    build(g, [key, ...parts]) {
      let graph = g;
      for (const p of parts) {
        // (already ducked under it, first thing: leave it)
        const first = audioEdges(graph).filter((e) => e.from === srcId(p)).map((e) => graph.nodes.find((n) => n.id === e.to));
        if (first.some((n) => n?.type === 'duck' && graph.edges.some((e) => e.to === n.id && e.from === srcId(key) && e.tp === 1))) continue;
        const r = addNode(graph, 'duck', { after: srcId(p) });
        graph = connect(r.graph, srcId(key), r.id, { tp: 1 });
      }
      return graph;
    },
  },
};
function chain(g, _part, fn) {
  const graph = { ...g, nodes: [...g.nodes], edges: [...g.edges] };
  const add = (type, params = {}) => { const id = newId(graph); graph.nodes.push({ id, type, params: { ...defaultParams(type), ...params } }); return id; };
  const link = (from, to) => graph.edges.push({ from, to });
  fn(add, link);
  return normGraph(graph);
}

// ---- chains as text: what the AI writes (and reads) ----
// One line per chain, left to right, ending at the master:
//   drums > comp(thresh=-18, ratio=4) > sat(drive=3) > master      a part's effects
//   kick+snare > comp(ratio=4) > master                             several parts into one bus
//   pad > duck(key=kick, depth=-12) > verb(size=4, mix=0.4)         ducked under the kick (> master is implied)
//   keys > par(verb(mix=1) > filter(lp=3000)) > master              a parallel path summed under the dry sound
/** Names the AI may use for the node types and their settings. */
const TYPE_ALIASES = { eq7: 'geq', geq: 'geq', reverb: 'verb', verb: 'verb', echo: 'delay', delay: 'delay', compressor: 'comp', comp: 'comp', compress: 'comp',
  saturation: 'sat', saturate: 'sat', drive: 'sat', sat: 'sat', filter: 'filter', gain: 'gain', eq: 'eq', duck: 'duck', sidechain: 'duck', ducker: 'duck' };
const PARAM_ALIASES = {
  verb: { size: 'size', time: 'size', decay: 'size', mix: 'mix', wet: 'mix' },
  delay: { time: 'time', feedback: 'feedback', fb: 'feedback', fdbk: 'feedback', mix: 'mix', wet: 'mix' },
  comp: { thresh: 'thresh', threshold: 'thresh', ratio: 'ratio', attack: 'attack', release: 'release', makeup: 'makeup', gain: 'makeup' },
  sat: { drive: 'drive', mix: 'mix' },
  filter: { hp: 'hp', highpass: 'hp', lp: 'lp', lowpass: 'lp' },
  gain: { db: 'db', gain: 'db', level: 'db' },
  eq: { low: 'low', mid: 'mid', high: 'high' },
  geq: { b0: 'b0', b1: 'b1', b2: 'b2', b3: 'b3', b4: 'b4', b5: 'b5', b6: 'b6', 60: 'b0', 150: 'b1', 400: 'b2', '1k': 'b3', '2.5k': 'b4', '6k': 'b5', '12k': 'b6' },
  duck: { depth: 'depth', amount: 'depth', attack: 'attack', release: 'release', sens: 'sens', sensitivity: 'sens' },
};
/** Split on a separator, outside parentheses. */
function splitTop(text, sep) {
  const out = [];
  let depth = 0, from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === sep && !depth) { out.push(text.slice(from, i)); from = i + 1; }
  }
  out.push(text.slice(from));
  return out.map((t) => t.trim()).filter(Boolean);
}
const nameKey = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/**
 * Chains (lines of text, as above) → a graph, for the parts there are. { graph, errors: [what was left out and why] }.
 * A line naming a part or a type there isn't is left out (and said so); an unknown setting is dropped; values are
 * kept in range.
 */
export function parseChains(lines, parts = []) {
  const byName = new Map(parts.map((p) => [nameKey(p), p]));
  const nodes = [], edges = [], errors = [];
  let bad = false; // (a line with an unknown part or type is left out whole; an unknown setting only loses that setting)
  const fail = (msg) => { errors.push(msg); bad = true; };
  const add = (type, params = {}) => { const id = `n${nodes.length + 1}`; nodes.push({ id, type, params: { ...defaultParams(type), ...params } }); return id; };
  const link = (from, to, ports = {}) => edges.push({ from, to, ...(ports.fp ? { fp: 1 } : {}), ...(ports.tp ? { tp: 1 } : {}) });
  const partIds = (text, where) => {
    const ids = [];
    for (const n of String(text).split('+')) {
      const p = byName.get(nameKey(n));
      if (p) ids.push(srcId(p)); else fail(`${where}: no part "${n.trim()}"`);
    }
    return ids;
  };
  /** Steps from `prev` (ids, with the port to leave by): returns where the chain ends. */
  const steps = (tokens, prev, line) => {
    for (const tok of tokens) {
      if (/^master$/i.test(tok)) return { prev, ended: true };
      const m = /^([a-z0-9]+)\s*(?:\((.*)\))?$/i.exec(tok);
      if (!m) { fail(`${line}: can't read "${tok}"`); continue; }
      const word = m[1].toLowerCase();
      if (word === 'par') {
        // a parallel path: split → (dry) → sum, split → path → sum
        const sp = add('split'), sum = add('sum');
        for (const p of prev) link(p.id, sp, { fp: p.fp });
        link(sp, sum);
        const inner = steps(splitTop(m[2] || '', '>'), [{ id: sp, fp: 1 }], line);
        for (const p of inner.prev) link(p.id, sum, { fp: p.fp, tp: 1 });
        prev = [{ id: sum }];
        continue;
      }
      const type = TYPE_ALIASES[word];
      if (!type) { fail(`${line}: no node type "${m[1]}"`); continue; }
      const params = {};
      let keys = [], keyed = false;
      for (const kv of splitTop(m[2] || '', ',')) {
        const [k, v] = kv.split('=').map((x) => x.trim());
        if (type === 'duck' && /^key$/i.test(k)) { keyed = true; keys = partIds(v, line); continue; }
        const key = PARAM_ALIASES[type]?.[String(k).toLowerCase()];
        if (!key || v == null || !Number.isFinite(parseFloat(v))) { errors.push(`${line}: ${m[1]} has no setting "${kv}"`); continue; }
        params[key] = parseFloat(v);
      }
      const id = add(type, params);
      for (const p of prev) link(p.id, id, { fp: p.fp });
      for (const k of keys) link(k, id, { tp: 1 });
      if (type === 'duck' && !keyed) fail(`${line}: duck needs key=<part> (what it ducks under)`);
      prev = [{ id }];
    }
    return { prev, ended: false };
  };
  for (const raw of [].concat(lines || [])) {
    const line = String(raw || '').trim().replace(/[→]/g, '>');
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const [head, ...rest] = splitTop(line, '>');
    const mark = [nodes.length, edges.length];
    bad = false;
    const srcs = partIds(head, line);
    const end = steps(rest, srcs.map((id) => ({ id })), line);
    for (const p of end.prev) link(p.id, SINK, { fp: p.fp });
    if (bad || !srcs.length) { nodes.length = mark[0]; edges.length = mark[1]; }
  }
  return { graph: normGraph({ nodes, edges }), errors };
}

/** A node as a step of a chain ("comp(thresh=-18, ratio=4)": its settings that aren't the defaults). */
function stepText(g, n) {
  const name = { geq: 'eq7' }[n.type] || n.type;
  const def = defaultParams(n.type);
  const kv = Object.entries(n.params || {}).filter(([k, v]) => v !== def[k]).map(([k, v]) => `${k}=${v}`);
  if (n.type === 'duck') {
    const keys = [...new Set(g.edges.filter((e) => e.to === n.id && e.tp === 1).flatMap((e) => upstreamParts(g, e.from)))];
    if (keys.length) kv.unshift(`key=${keys.join('+')}`);
  }
  return kv.length ? `${name}(${kv.join(', ')})` : name;
}
/**
 * A graph → chains (lines of text, as parseChains reads them): one per part or bus, before the master. Wiring that
 * isn't a chain (a node feeding two places) is described as far as it goes, then "…".
 */
export function describeChains(g) {
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const ae = audioEdges(g);
  const outs = (id) => ae.filter((e) => e.from === id);
  const ins = (id) => ae.filter((e) => e.to === id);
  const walk = (id, seen = new Set()) => {
    const res = [];
    let cur = id;
    for (let guard = 0; guard < 40; guard++) {
      const o = outs(cur);
      if (!o.length) return res;
      if (o.length === 1 && o[0].to === SINK) { res.push('master'); return res; }
      const n = nodes.get(cur);
      // a Split whose first path goes straight to a Sum and the second through effects into it: par(…)
      if (n?.type === 'split' && o.length === 2) {
        const dry = o.find((e) => !e.fp), wet = o.find((e) => e.fp === 1);
        const sum = dry && nodes.get(dry.to)?.type === 'sum' ? dry.to : null;
        if (sum && wet) {
          const inner = [];
          let x = wet.to, ok = true;
          for (let k = 0; x !== sum && k < 20; k++) {
            const xn = nodes.get(x), xo = outs(x);
            if (!xn || xo.length !== 1) { ok = false; break; }
            inner.push(stepText(g, xn));
            x = xo[0].to;
          }
          if (ok) { res.push(`par(${inner.join(' > ')})`); cur = sum; continue; }
        }
      }
      if (o.length > 1) { res.push('…'); return res; }
      const next = nodes.get(o[0].to);
      if (!next || seen.has(next.id)) { res.push('…'); return res; }
      // a node several parts come into starts its own (bus) line
      if (ins(next.id).filter((e) => partOf(e.from) != null).length > 1 && cur !== id) { res.push('…'); return res; }
      seen.add(next.id);
      res.push(stepText(g, next));
      cur = next.id;
    }
    return res;
  };
  // a node and what follows it (a Split that opens a par(…) prints as just the par)
  const from = (t) => {
    const w = walk(t.id);
    return t.type === 'split' && w[0]?.startsWith('par(') ? w : [stepText(g, t), ...w];
  };
  const lines = [];
  const done = new Set();
  for (const e of ae) {
    const p = partOf(e.from);
    if (p == null || done.has(e.from + '>' + e.to)) continue;
    const target = nodes.get(e.to);
    const fromParts = target ? ins(target.id).filter((x) => partOf(x.from) != null).map((x) => partOf(x.from)) : [p];
    if (target && fromParts.length > 1) {
      for (const x of ins(target.id)) done.add(x.from + '>' + x.to);
      lines.push([fromParts.join('+'), ...from(target)].join(' > '));
    } else {
      done.add(e.from + '>' + e.to);
      lines.push([p, ...(e.to === SINK ? ['master'] : target ? from(target) : [])].join(' > '));
    }
  }
  return lines;
}

/**
 * A board with new chains (parseChains) in place of its own, before the master: what it has after the master (your
 * effects on the whole mix, the wiring around Master FX) stays.
 */
export function withChains(g, chains) {
  const post = new Set(postNodes(g));
  const nodes = g.nodes.filter((n) => post.has(n.id));
  const ids = {};
  for (const n of chains.nodes) { const id = newId({ nodes }); ids[n.id] = id; nodes.push({ ...n, id }); }
  const id = (x) => ids[x] ?? x;
  const edges = [
    ...g.edges.filter((e) => e.from === SINK || e.from === MFX || post.has(e.from)),
    ...chains.edges.map((e) => ({ ...e, from: id(e.from), to: id(e.to) })),
  ];
  return normGraph({ nodes, edges, pins: g.pins });
}
