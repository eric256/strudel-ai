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
  filter: { label: 'Filter', kind: 'dyn', title: 'High-pass and low-pass', params: { hp: [20, 2000, 1, 20, 'hp', 'Hz'], lp: [200, 20000, 10, 20000, 'lp', 'Hz'] } },
  verb: { label: 'Verb', kind: 'space', title: 'Reverb', params: { size: [0.2, 8, 0.1, 2, 'size', 's'], mix: [0, 1, 0.05, 0.3, 'mix', ''] } },
  delay: { label: 'Delay', kind: 'space', title: 'Echo', params: { time: [0.02, 1, 0.01, 0.25, 'time', 's'], feedback: [0, 0.9, 0.01, 0.35, 'fdbk', ''], mix: [0, 1, 0.05, 0.3, 'mix', ''] } },
};
export const SINK = 'master';
export const srcId = (part) => `src:${part}`;
export const partOf = (id) => (typeof id === 'string' && id.startsWith('src:') ? id.slice(4) : null);
const isEnd = (id) => id === SINK || partOf(id) != null;

export const defaultParams = (type) => Object.fromEntries(Object.entries(NODE_TYPES[type]?.params || {}).map(([k, d]) => [k, d[3]]));
const clamp = (v, [min, max, step, def]) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const s = Math.round((Math.min(max, Math.max(min, n)) - min) / step) * step + min;
  return Math.round(s * 10000) / 10000;
};

/** A clean, safe graph: known types, values in range, unique ids, edges only between real nodes, and no loops. */
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
  const ok = (id) => partOf(id) != null || id === SINK || nodes.some((n) => n.id === id);
  const edges = [];
  for (const e of Array.isArray(g?.edges) ? g.edges : []) {
    const from = String(e?.from || ''), to = String(e?.to || '');
    if (!ok(from) || !ok(to) || from === to || from === SINK || partOf(to) != null) continue;
    if (edges.some((x) => x.from === from && x.to === to)) continue;
    if (reaches({ edges }, to, from)) continue; // would close a loop
    edges.push({ from, to });
  }
  return { nodes, edges };
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
/** Can this edge be added? (not from the master, not into a part, not twice, no loop) */
export const canConnect = (g, from, to) => from !== to && from !== SINK && partOf(to) == null
  && !g.edges.some((e) => e.from === from && e.to === to) && !reaches(g, to, from);

/** The parts that are routed (have an edge from their source): the others go straight to the master. */
export const routedParts = (g) => [...new Set(g.edges.map((e) => partOf(e.from)).filter((p) => p != null))];
/** Nodes whose sound never reaches the master (a dead end: you won't hear what goes in). */
export const deadEnds = (g) => g.nodes.filter((n) => !reaches(g, n.id, SINK)).map((n) => n.id);
/** Nodes nothing flows into (they make no sound). */
export const unfed = (g) => g.nodes.filter((n) => !g.edges.some((e) => e.to === n.id)).map((n) => n.id);

export const newId = (g) => { let k = 1; while (g.nodes.some((n) => n.id === `n${k}`)) k++; return `n${k}`; };

/** Add a node; on an edge (insert it there), after a node (between it and what it fed), or on its own. */
export function addNode(g, type, { onEdge = null, after = null, x, y } = {}) {
  const id = newId(g);
  const node = { id, type, params: defaultParams(type), ...(Number.isFinite(x) ? { x, y } : {}) };
  let edges = g.edges;
  if (onEdge) {
    edges = edges.filter((e) => !(e.from === onEdge.from && e.to === onEdge.to)).concat([{ from: onEdge.from, to: id }, { from: id, to: onEdge.to }]);
  } else if (after) {
    const outs = edges.filter((e) => e.from === after);
    // a part going straight to the master: through the new node to the master
    const targets = outs.length ? outs.map((e) => e.to) : [SINK];
    edges = edges.filter((e) => e.from !== after).concat([{ from: after, to: id }], targets.map((t) => ({ from: id, to: t })));
  }
  return { graph: normGraph({ nodes: [...g.nodes, node], edges }), id };
}
/** Remove a node and heal the chain: what fed it now feeds what it fed. */
export function removeNode(g, id) {
  const ins = g.edges.filter((e) => e.to === id).map((e) => e.from);
  const outs = g.edges.filter((e) => e.from === id).map((e) => e.to);
  const edges = g.edges.filter((e) => e.from !== id && e.to !== id);
  for (const a of ins) for (const b of outs) edges.push({ from: a, to: b });
  return normGraph({ nodes: g.nodes.filter((n) => n.id !== id), edges });
}
export const removeEdge = (g, from, to) => normGraph({ nodes: g.nodes, edges: g.edges.filter((e) => !(e.from === from && e.to === to)) });
export const connect = (g, from, to) => (canConnect(g, from, to) ? normGraph({ nodes: g.nodes, edges: [...g.edges, { from, to }] }) : g);
/** Take a part's routing out: the nodes only it feeds go too, and it goes straight to the master again. */
export function unroutePart(g, part) {
  const src = srcId(part);
  const mine = new Set();
  const others = g.edges.filter((e) => partOf(e.from) != null && e.from !== src).map((e) => e.from);
  const fromOthers = new Set();
  for (const o of others) for (const n of g.nodes) if (reaches(g, o, n.id)) fromOthers.add(n.id);
  for (const n of g.nodes) if (reaches(g, src, n.id) && !fromOthers.has(n.id)) mine.add(n.id);
  return normGraph({ nodes: g.nodes.filter((n) => !mine.has(n.id)), edges: g.edges.filter((e) => e.from !== src && !mine.has(e.from) && !mine.has(e.to)) });
}

/** The line under a node's name: what it's doing (live readouts come from the audio: gr = gain reduction). */
export function nodeSummary(g, n, live = {}) {
  const p = n.params || {};
  const pct = (v) => `${Math.round(v * 100)}%`;
  switch (n.type) {
    case 'split': return `${g.edges.filter((e) => e.from === n.id).length} paths`;
    case 'sum': return `${g.edges.filter((e) => e.to === n.id).length} in · summing`;
    case 'gain': return `${p.db > 0 ? '+' : ''}${p.db} dB`;
    case 'comp': return live.gr != null ? `GR ${Math.abs(live.gr).toFixed(1)} dB` : `${p.ratio}:1 at ${p.thresh} dB`;
    case 'sat': return `Drive ${p.drive} dB${p.mix < 1 ? ` · ${pct(p.mix)}` : ''}`;
    case 'eq': return ['low', 'mid', 'high'].filter((k) => p[k]).map((k) => `${k[0].toUpperCase()} ${p[k] > 0 ? '+' : ''}${p[k]}`).join(' ') || '0 dB';
    case 'filter': return [p.hp > 20 && `HP ${Math.round(p.hp)}`, p.lp < 20000 && `LP ${p.lp >= 1000 ? `${(p.lp / 1000).toFixed(1)}k` : p.lp}`].filter(Boolean).join(' · ') || 'open';
    case 'verb': return `Mix ${pct(p.mix)} · ${p.size}s`;
    case 'delay': return `${Math.round(p.time * 1000)} ms · Mix ${pct(p.mix)}`;
    default: return '';
  }
}

/**
 * Where everything goes on the canvas: parts in a column on the left (in the mixer's order), the master on the
 * right, each node a column after the furthest node feeding it. A part's chain stays on its row; a split's extra
 * paths go on new rows below. Nodes you've placed by hand (x, y) stay put.
 */
export function layoutGraph(g, parts, { colW = 190, rowH = 125, pad = 18 } = {}) {
  const depth = {};
  const order = [];
  // longest path from any part (no loops, so this terminates)
  const visit = (id, d) => {
    if (id === SINK) return;
    if (depth[id] != null && depth[id] >= d) return;
    depth[id] = d;
    if (!order.includes(id)) order.push(id);
    for (const e of g.edges) if (e.from === id) visit(e.to, d + 1);
  };
  for (const p of parts) visit(srcId(p), 0);
  for (const n of g.nodes) if (depth[n.id] == null) visit(n.id, 1);
  const row = {};
  let next = 0;
  const place = (id, r) => {
    if (id === SINK || row[id] != null) return;
    row[id] = r;
    let first = true;
    for (const e of g.edges) if (e.from === id) { if (e.to === SINK || row[e.to] != null) continue; place(e.to, first ? r : next++); first = false; }
  };
  for (const p of parts) place(srcId(p), next++);
  for (const n of g.nodes) if (row[n.id] == null) place(n.id, next++);
  const cols = Math.max(1, ...Object.values(depth)) + 1;
  const pos = {};
  for (const [id, d] of Object.entries(depth)) pos[id] = { x: pad + d * colW, y: pad + (row[id] ?? 0) * rowH };
  for (const n of g.nodes) if (Number.isFinite(n.x)) pos[n.id] = { x: n.x, y: n.y };
  const maxX = Math.max(pad + cols * colW, ...Object.values(pos).map((p) => p.x + colW));
  const rows = Math.max(next, 1);
  pos[SINK] = { x: maxX, y: pad, h: Math.max(rows * rowH - 20, 200) };
  return pos;
}
/** Forget hand placement (tidy up). */
export const unplace = (g) => ({ ...g, nodes: g.nodes.map(({ x, y, ...n }) => n) });

// ---- templates: a ready-made chain for one part (or a bus for several) ----
const looksLike = (re) => (c) => re.test(c.role || '') || re.test(c.base);
const DRUMS = looksLike(/drum|kick|snare|hat|perc|clap|beat|bd|sd|hh/i);
/**
 * TEMPLATES[key]: { label, title, needs: 'part' | 'parts', build(g, parts) → graph }.
 * Built onto the graph as it is: the part's old routing is taken out first.
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
};
function chain(g, _part, fn) {
  let graph = { nodes: [...g.nodes], edges: [...g.edges] };
  const add = (type, params = {}) => { const id = newId(graph); graph.nodes.push({ id, type, params: { ...defaultParams(type), ...params } }); return id; };
  const link = (from, to) => graph.edges.push({ from, to });
  fn(add, link);
  return normGraph(graph);
}
