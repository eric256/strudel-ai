// 🔀 Routing's pure logic (lib/routing.js): the graph rules (no loops, values in range), editing (add on a wire,
// after a node, remove and heal, unroute a part), templates, summaries and the layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_TYPES, SINK, TEMPLATES, addNode, canConnect, connect, deadEnds, defaultParams, layoutGraph, nodeSummary,
  normGraph, reaches, removeEdge, removeNode, routedParts, srcId, unfed, unroutePart,
} from '../public/lib/routing.js';

const empty = { nodes: [], edges: [] };

test('normGraph: unknown types, bad ids, bad edges and loops are dropped; values are clamped to their range', () => {
  const g = normGraph({
    nodes: [{ id: 'a', type: 'comp', params: { ratio: 99, thresh: 'x' } }, { id: 'b', type: 'nope' }, { id: 'master', type: 'sum' }, { id: 'a', type: 'sat' }, { id: 'c', type: 'sum' }],
    edges: [{ from: 'src:drums', to: 'a' }, { from: 'a', to: 'c' }, { from: 'c', to: 'a' }, { from: 'a', to: 'src:bass' }, { from: 'master', to: 'a' }, { from: 'a', to: 'ghost' }, { from: 'c', to: 'master' }, { from: 'c', to: 'master' }],
  });
  assert.deepEqual(g.nodes.map((n) => n.id), ['a', 'c']);
  assert.equal(g.nodes[0].params.ratio, 20);
  assert.equal(g.nodes[0].params.thresh, NODE_TYPES.comp.params.thresh[3]);
  assert.deepEqual(g.edges, [{ from: 'src:drums', to: 'a' }, { from: 'a', to: 'c' }, { from: 'c', to: 'master' }]);
});

test('connect: no loops, nothing into a part, nothing out of the master, no duplicates', () => {
  let g = addNode(empty, 'comp').graph;
  g = connect(g, 'src:drums', 'n1');
  g = connect(g, 'n1', SINK);
  assert.equal(g.edges.length, 2);
  const { graph } = addNode(g, 'sat', { after: 'n1' });
  assert.deepEqual(graph.edges, [{ from: 'src:drums', to: 'n1' }, { from: 'n1', to: 'n2' }, { from: 'n2', to: 'master' }]);
  assert.equal(canConnect(graph, 'n2', 'n1'), false, 'a loop');
  assert.equal(canConnect(graph, 'n1', 'src:bass'), false);
  assert.equal(canConnect(graph, SINK, 'n1'), false);
  assert.equal(canConnect(graph, 'n1', 'n2'), false, 'already wired');
  assert.ok(reaches(graph, 'src:drums', SINK));
});

test('addNode on a wire puts it in between; after a part that went straight to the master, routes it', () => {
  let g = connect(connect(addNode(empty, 'comp').graph, 'src:lead', 'n1'), 'n1', SINK);
  g = addNode(g, 'verb', { onEdge: { from: 'n1', to: SINK } }).graph;
  assert.deepEqual(g.edges, [{ from: 'src:lead', to: 'n1' }, { from: 'n1', to: 'n2' }, { from: 'n2', to: 'master' }]);
  const h = addNode(empty, 'eq', { after: srcId('bass') }).graph;
  assert.deepEqual(h.edges, [{ from: 'src:bass', to: 'n1' }, { from: 'n1', to: 'master' }]);
  assert.deepEqual(routedParts(h), ['bass']);
  // the implicit wire part → master: inserting there routes the part too
  assert.deepEqual(addNode(empty, 'eq', { onEdge: { from: 'src:pad', to: SINK } }).graph.edges, [{ from: 'src:pad', to: 'n1' }, { from: 'n1', to: 'master' }]);
});

test('removeNode heals the chain; removeEdge; dead ends and unfed nodes are found', () => {
  let g = addNode(addNode(empty, 'comp', { after: 'src:drums' }).graph, 'sat', { after: 'n1' }).graph;
  g = removeNode(g, 'n1');
  const key = (es) => es.map((e) => `${e.from}>${e.to}`).sort();
  assert.deepEqual(key(g.edges), ['n2>master', 'src:drums>n2']);
  g = removeEdge(g, 'n2', SINK);
  assert.deepEqual(deadEnds(g), ['n2']);
  const lone = addNode(empty, 'sum').graph;
  assert.deepEqual(unfed(lone), ['n1']);
});

test('templates: parallel comp splits and sums; a drum bus sums every drum part; unroute takes a part\'s own nodes out', () => {
  const g = TEMPLATES.nycomp.build(empty, ['drums']);
  assert.deepEqual(g.nodes.map((n) => n.type), ['split', 'comp', 'sat', 'sum']);
  assert.equal(g.edges.filter((e) => e.to === 'n4').length, 2, 'two paths into the sum');
  assert.ok(reaches(g, 'src:drums', SINK));
  assert.equal(deadEnds(g).length, 0);
  // applying it again replaces it (no duplicate chain)
  assert.equal(TEMPLATES.nycomp.build(g, ['drums']).nodes.length, 4);
  // a bus of two drum parts, and the lead with its own space
  const chans = [{ base: 'kick', role: 'drums' }, { base: 'hats' }, { base: 'bass', role: 'bass' }, { base: 'lead' }];
  assert.deepEqual(TEMPLATES.drumbus.pick(chans), ['kick', 'hats']);
  let bus = TEMPLATES.drumbus.build(empty, ['kick', 'hats']);
  bus = TEMPLATES.space.build(bus, ['lead']);
  assert.deepEqual(routedParts(bus).sort(), ['hats', 'kick', 'lead']);
  // taking the lead out leaves the drum bus alone; taking kick out keeps the bus (hats still feeds it)
  const noLead = unroutePart(bus, 'lead');
  assert.deepEqual(routedParts(noLead).sort(), ['hats', 'kick']);
  assert.equal(noLead.nodes.length, 3);
  const noKick = unroutePart(noLead, 'kick');
  assert.deepEqual(routedParts(noKick), ['hats']);
  assert.equal(noKick.nodes.length, 3);
});

test('summaries say what a node does', () => {
  const g = TEMPLATES.nycomp.build(empty, ['drums']);
  const by = (t) => g.nodes.find((n) => n.type === t);
  assert.equal(nodeSummary(g, by('split')), '2 paths');
  assert.equal(nodeSummary(g, by('sum')), '2 in · summing');
  assert.equal(nodeSummary(g, by('comp'), { gr: -16.94 }), 'GR 16.9 dB');
  assert.equal(nodeSummary(g, by('sat')), 'Drive 4 dB');
  assert.equal(nodeSummary(g, { type: 'verb', params: { ...defaultParams('verb'), mix: 1 } }), 'Mix 100% · 2s');
  assert.equal(nodeSummary(g, { type: 'filter', params: { hp: 40, lp: 20000 } }), 'HP 40');
});

test('layout: parts on the left in order, a chain on its part\'s row, split paths below, the master right of everything', () => {
  const g = TEMPLATES.nycomp.build(empty, ['drums']);
  const pos = layoutGraph(g, ['drums', 'bass'], { colW: 100, rowH: 100, pad: 0 });
  assert.deepEqual(pos['src:drums'], { x: 0, y: 0 });
  assert.equal(pos['src:bass'].x, 0);
  assert.equal(pos.n1.y, 0, 'split on the drums row');
  assert.equal(pos.n4.x, 400, 'sum after split → comp → sat');
  assert.ok(pos.n2.y > 0 && pos.n2.y !== pos['src:bass'].y, 'the comp path on its own row');
  assert.ok(pos.master.x > pos.n4.x);
  // a node you moved stays where you put it
  const moved = { ...g, nodes: g.nodes.map((n) => (n.id === 'n2' ? { ...n, x: 333, y: 444 } : n)) };
  assert.deepEqual(layoutGraph(normGraph(moved), ['drums']).n2, { x: 333, y: 444 });
});
