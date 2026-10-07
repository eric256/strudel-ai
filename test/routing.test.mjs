// 🔀 Routing's pure logic (lib/routing.js): the graph rules (no loops, values in range), editing (add on a wire,
// after a node, remove and heal, unroute a part), templates, summaries and the layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_TYPES, SINK, TEMPLATES, addNode, canConnect, connect, deadEnds, defaultParams, layoutGraph, nodeSummary,
  normGraph, reaches, removeEdge, removeNode, routedParts, srcId, unfed, unroutePart, freeInput, partOf,
  isKey, audioEdges, masterInputs, upstreamParts, parseChains, describeChains, songRouting, withChains, withPost, MFX, OUT,
} from '../public/lib/routing.js';
import { normalizeSheet, routingLines } from '../public/lib/sheet.js';
import { cleanRouting, cleanFavSong, cleanSong } from '../server/api.js';

const empty = { nodes: [], edges: [] };

test('normGraph: unknown types, bad ids, bad edges and loops are dropped; values are clamped to their range', () => {
  const g = normGraph({
    nodes: [{ id: 'a', type: 'comp', params: { ratio: 99, thresh: 'x' } }, { id: 'b', type: 'nope' }, { id: 'master', type: 'sum' }, { id: 'a', type: 'sat' }, { id: 'c', type: 'sum' }],
    edges: [{ from: 'src:drums', to: 'a' }, { from: 'a', to: 'c' }, { from: 'c', to: 'a' }, { from: 'a', to: 'src:bass' }, { from: 'out', to: 'a' }, { from: 'a', to: 'ghost' }, { from: 'c', to: 'master' }, { from: 'c', to: 'master' }],
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
  g = removeEdge(g, { from: 'n2', to: SINK });
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
  assert.equal(nodeSummary(g, by('split')), '2 of 2 paths');
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

test('ports: a Split has two outputs and a Sum two inputs; templates and old saves get them spread', () => {
  const g = TEMPLATES.nycomp.build(empty, ['drums']); // split n1, comp n2, sat n3, sum n4
  const e = (from, to) => g.edges.find((x) => x.from === from && x.to === to);
  assert.equal(e('n1', 'n4').fp, undefined, 'the dry path on the first output');
  assert.equal(e('n1', 'n2').fp, 1, 'the comp path on the second');
  assert.equal(e('n1', 'n4').tp, undefined);
  assert.equal(e('n3', 'n4').tp, 1, 'into the second input of the sum');
  // ports only where they exist
  const bad = normGraph({ nodes: [{ id: 'a', type: 'comp' }], edges: [{ from: 'src:x', to: 'a', fp: 1, tp: 1 }, { from: 'a', to: 'master', fp: 1 }] });
  assert.deepEqual(bad.edges, [{ from: 'src:x', to: 'a' }, { from: 'a', to: 'master' }]);
  // the same two nodes wired twice on different ports is fine; the same ports twice isn't
  let s = addNode(addNode(empty, 'split').graph, 'sum').graph;
  s = connect(s, 'n1', 'n2', { fp: 0, tp: 0 });
  s = connect(s, 'n1', 'n2', { fp: 1, tp: 1 });
  s = connect(s, 'n1', 'n2', { fp: 1, tp: 1 });
  assert.equal(s.edges.length, 2);
  assert.equal(freeInput(addNode(empty, 'sum').graph, 'n1'), 0);
});

test('select a part, add an effect: it goes part → effect → master; select that and add another: inserted after it', () => {
  let { graph: g, id } = addNode(empty, 'comp', { after: srcId('bass') });
  assert.deepEqual(g.edges, [{ from: 'src:bass', to: id }, { from: id, to: 'master' }]);
  ({ graph: g } = addNode(g, 'sat', { after: id }));
  assert.deepEqual(g.edges.map((e) => `${e.from}>${e.to}`), ['src:bass>n1', 'n1>n2', 'n2>master']);
  // and after the part again: in front of the chain
  ({ graph: g } = addNode(g, 'eq', { after: srcId('bass') }));
  assert.ok(reaches(g, 'src:bass', 'n3') && reaches(g, 'n3', 'n1') && !g.edges.some((e) => e.from === 'src:bass' && e.to === 'n1'));
});

test('a new Split comes with its Sum; an effect added after the Split goes on its second path into the Sum', () => {
  let { graph: g, id: split } = addNode(empty, 'split', { after: srcId('drums') });
  const sum = g.nodes.find((n) => n.type === 'sum').id;
  const keys = (gr) => gr.edges.map((e) => `${e.from}:${e.fp || 0}>${e.to}:${e.tp || 0}`).sort();
  assert.deepEqual(keys(g), [`${split}:0>${sum}:0`, `${split}:1>${sum}:1`, `${sum}:0>master:0`, `src:drums:0>${split}:0`].sort());
  let comp;
  ({ graph: g, id: comp } = addNode(g, 'comp', { after: split }));
  assert.deepEqual(keys(g), [`${split}:0>${sum}:0`, `${split}:1>${comp}:0`, `${comp}:0>${sum}:1`, `${sum}:0>master:0`, `src:drums:0>${split}:0`].sort());
  // after the comp: between it and the sum's second input
  let sat;
  ({ graph: g, id: sat } = addNode(g, 'sat', { after: comp }));
  assert.ok(g.edges.some((e) => e.from === sat && e.to === sum && e.tp === 1));
  // a split into a wire: from → split ⇒ sum → to
  const w = addNode(addNode(empty, 'comp', { after: srcId('lead') }).graph, 'split', { onEdge: { from: 'n1', to: 'master' } }).graph;
  assert.ok(reaches(w, 'n1', 'n2') && reaches(w, 'n2', 'n3') && w.edges.some((e) => e.from === 'n3' && e.to === 'master'));
  // with the second path wired by hand, the next effect still goes on it
  ({ graph: g } = addNode(g, 'verb', { after: split }));
  assert.ok(g.edges.some((e) => e.from === split && e.fp === 1 && g.nodes.find((n) => n.id === e.to).type === 'verb'));
});

test('parts you move keep their place (pins), through templates too', () => {
  const g = normGraph({ nodes: [], edges: [], pins: { 'src:drums': { x: 40, y: 300 }, nope: { x: 1, y: 1 } } });
  assert.deepEqual(g.pins, { 'src:drums': { x: 40, y: 300 } });
  assert.deepEqual(layoutGraph(g, ['drums', 'bass'])['src:drums'], { x: 40, y: 300 });
  assert.deepEqual(TEMPLATES.nycomp.build(g, ['drums']).pins, g.pins);
});

test('master inputs: a row per channel coming in — each part on its own (whatever its paths), each bus, unwired parts too', async () => {
  const { masterInputs, inputKey, upstreamParts, visibleGraph } = await import('../public/lib/routing.js');
  // lead: comp → split ⇒ dry + verb → sum → master (one channel); kick + hats: a drum bus; bass: no effects
  let g = TEMPLATES.space.build(empty, ['lead']);
  g = TEMPLATES.drumbus.build(g, ['kick', 'hats']);
  const parts = ['kick', 'hats', 'bass', 'lead'];
  const ins = masterInputs(g, parts);
  const busEnd = g.edges.find((e) => e.to === SINK && upstreamParts(g, e.from).length === 2).from; // (the drum bus's last node)
  assert.deepEqual(ins.map((x) => x.key), [`bus:${busEnd}`, 'bass', 'lead']);
  assert.deepEqual(ins[0].parts.sort(), ['hats', 'kick']);
  assert.equal(ins[0].part, null);
  assert.equal(inputKey(g, srcId('bass')), 'bass');
  // a part split into two paths that both reach the master: still one channel
  let s = addNode(empty, 'split', { after: srcId('pad') }).graph;
  s = connect(removeEdge(s, { from: 'n2', to: SINK }), 'n1', SINK, { fp: 1 });
  assert.deepEqual(masterInputs(s, ['pad']).map((x) => x.key), ['pad']);
  // what's shown for the music now: parts that aren't in it, and the nodes only they reach, are kept but hidden
  const v = visibleGraph(g, ['bass', 'lead']);
  assert.ok(!v.nodes.some((n) => g.edges.some((e) => e.to === n.id && partOf(e.from) === 'kick')), 'the drum bus is hidden');
  assert.ok(v.nodes.length === 4 && v.edges.every((e) => partOf(e.from) !== 'kick'));
  // a node nothing feeds yet stays in view
  assert.equal(visibleGraph(addNode(empty, 'comp').graph, []).nodes.length, 1);
});

test('EQ7: seven bands in range, a summary of them', () => {
  const g = normGraph({ nodes: [{ id: 'a', type: 'geq', params: { b0: 3, b6: -20 } }], edges: [] });
  assert.deepEqual(Object.values(g.nodes[0].params), [3, 0, 0, 0, 0, 0, -12]);
  assert.equal(nodeSummary(g, g.nodes[0]), '+3 0 0 0 0 0 -12');
  assert.equal(nodeSummary(g, { type: 'geq', params: defaultParams('geq') }), 'flat');
});

test('after the master: its default way out, effects added after it, around Master FX — and unrouting a part leaves them alone', async () => {
  const { MFX, OUT, withPost, postNodes, layoutPost, reachesPre } = await import('../public/lib/routing.js');
  // the default: master → Master FX → out
  assert.deepEqual(withPost(empty).edges, [{ from: SINK, to: MFX }, { from: MFX, to: OUT }]);
  // select the master, ＋ a comp: master → comp → Master FX → out
  let { graph: g, id } = addNode(withPost(empty), 'comp', { after: SINK });
  assert.deepEqual(g.edges.map((e) => `${e.from}>${e.to}`).sort(), [`${MFX}>${OUT}`, `${SINK}>${id}`, `${id}>${MFX}`].sort());
  assert.deepEqual(postNodes(g), [id]);
  // a limiter-ish gain after Master FX, on the wire into out
  ({ graph: g } = addNode(g, 'gain', { onEdge: { from: MFX, to: OUT } }));
  const L = layoutPost(g);
  assert.ok(L[id].col < L[MFX].col && L[MFX].col < L.n2.col && L.n2.col < L[OUT].col, JSON.stringify(L));
  assert.ok([id, MFX, 'n2', OUT].every((k) => L[k].row === 0));
  // nothing out of Out, no loop back into the master, but around Master FX is fine
  assert.equal(canConnect(g, OUT, id), false);
  assert.equal(canConnect(g, id, SINK), false, 'a loop through the master');
  assert.equal(canConnect(g, SINK, OUT), true);
  // these are nobody's part: unrouting a part keeps them; they never show up as a part's own nodes
  g = TEMPLATES.nycomp.build(g, ['drums']);
  const un = unroutePart(g, 'drums');
  assert.ok(un.nodes.some((n) => n.id === id) && un.nodes.some((n) => n.id === 'n2'));
  assert.equal(reachesPre(g, srcId('drums'), id), false);
  // and they're not dead ends (they reach out), and the part layout leaves them to the panel
  assert.equal(deadEnds(g).includes(id), false);
  assert.equal(layoutGraph(g, ['drums'])[id], undefined);
});

// ---- 🦆 Duck (sidechain): its key wires are listened to, not heard ----
const ducked = () => {
  // pad → duck → master, keyed by drums; drums straight on → comp → master
  let { graph, id } = addNode(empty, 'duck', { after: srcId('pad') });
  graph = connect(graph, srcId('drums'), id, { tp: 1 });
  return { graph, id };
};
test('duck: a key wire is not a route — the keying part is still its own input, not routed through the Duck', () => {
  const { graph, id } = ducked();
  assert.ok(graph.edges.some((e) => e.from === srcId('drums') && e.to === id && e.tp === 1));
  assert.ok(isKey(graph, graph.edges.find((e) => e.from === srcId('drums'))));
  assert.equal(audioEdges(graph).length, 2);
  assert.deepEqual(routedParts(graph), ['pad']);
  assert.deepEqual(upstreamParts(graph, id), ['pad']);
  assert.deepEqual(masterInputs(graph, ['drums', 'pad']).map((x) => x.key), ['drums', 'pad']); // no "bus" of drums + pad
  assert.match(nodeSummary(graph, graph.nodes[0]), /-10 dB · to drums/);
  assert.match(nodeSummary(graph, graph.nodes[0], { duck: -6.5 }), /−6\.5/);
});
test('duck: adding after the keying part, removing the Duck and unrouting keep key wires where they belong', () => {
  const { graph, id } = ducked();
  // a Comp after drums takes drums' sound, not its key wire
  const c = addNode(graph, 'comp', { after: srcId('drums') });
  assert.ok(c.graph.edges.some((e) => e.from === srcId('drums') && e.to === id && e.tp === 1));
  assert.ok(c.graph.edges.some((e) => e.from === srcId('drums') && e.to === c.id && !e.tp));
  // removing the Duck: pad straight to the master, the key doesn't carry on into it
  const r = removeNode(graph, id);
  assert.deepEqual(r.edges, [{ from: srcId('pad'), to: SINK }]);
  // unrouting drums keeps its key wire (it still steers the pad's Duck); unrouting pad takes the Duck away
  assert.ok(unroutePart(c.graph, 'drums').edges.some((e) => e.to === id && e.tp === 1));
  assert.ok(!unroutePart(graph, 'pad').nodes.length);
  // normGraph keeps a Duck's second input
  assert.ok(normGraph(graph).edges.some((e) => e.tp === 1));
});
test('template Duck to kick: the kick keys a Duck first in the pads / bass chains, what they had stays; twice adds nothing', () => {
  const chans = [{ base: 'kick', role: 'drums' }, { base: 'hats', role: 'perc' }, { base: 'bass', role: 'bass' }, { base: 'pad', role: 'pad' }, { base: 'lead', role: 'melody' }];
  const parts = TEMPLATES.duck.pick(chans);
  assert.deepEqual(parts, ['kick', 'bass', 'pad']);
  const withVerb = addNode(empty, 'verb', { after: srcId('pad') }).graph;
  const g = TEMPLATES.duck.build(withVerb, parts);
  assert.deepEqual(describeChains(g).sort(), ['bass > duck(key=kick) > master', 'pad > duck(key=kick) > verb > master']);
  assert.equal(TEMPLATES.duck.build(g, parts).nodes.length, g.nodes.length);
  assert.deepEqual(TEMPLATES.duck.pick([{ base: 'pad', role: 'pad' }]), []);
});

// ---- chains as text (the AI's routing) ----
test('parseChains: chains, buses, Ducks with keys, parallel paths, aliases; bad lines are reported and skipped', () => {
  const { graph, errors } = parseChains([
    '# the drums', 'drums > compressor(threshold=-18, ratio=4) > drive(drive=3) > master',
    'pad → sidechain(key=drums, depth=-12) > reverb(size=4, wet=0.4)',
    'keys > par(verb(mix=1) > filter(lowpass=3000)) > master',
    'kick+snare > comp > master', 'bass > eq7(60=3, 12k=-2) > master',
    'ghost > comp', 'lead > wobble(x=1)', 'hook > duck(key=nobody) > master', '',
  ], ['drums', 'pad', 'keys', 'kick', 'snare', 'bass', 'lead', 'hook']);
  assert.equal(errors.length, 3);
  assert.match(errors.join('\n'), /no part "ghost"/);
  assert.match(errors.join('\n'), /no node type "wobble"/);
  assert.deepEqual(describeChains(graph), [
    'drums > comp(thresh=-18) > sat(drive=3) > master',
    'pad > duck(key=drums, depth=-12) > verb(size=4, mix=0.4) > master',
    'keys > par(verb(mix=1) > filter(lp=3000)) > master',
    'kick+snare > comp > master',
    'bass > eq7(b0=3, b6=-2) > master',
  ]);
  assert.deepEqual(masterInputs(graph, ['drums', 'pad', 'keys', 'kick', 'snare', 'bass']).map((x) => x.key), ['drums', 'pad', 'keys', `bus:${graph.edges.find((e) => e.from === srcId('kick')).to}`, 'bass']);
  // what describeChains writes, parseChains reads back the same
  assert.deepEqual(describeChains(parseChains(describeChains(graph), ['drums', 'pad', 'keys', 'kick', 'snare', 'bass']).graph), describeChains(graph));
});
test('withChains: new chains replace the board before the master; what is after it stays', () => {
  let g = addNode(empty, 'comp', { after: srcId('drums') }).graph;
  const post = addNode(g, 'sat', { after: SINK });
  g = post.graph;
  const { graph: chains } = parseChains(['bass > filter(hp=40) > master'], ['bass', 'drums']);
  const out = withChains(g, chains);
  assert.deepEqual(describeChains(out), ['bass > filter(hp=40) > master']);
  assert.ok(out.nodes.some((n) => n.id === post.id && n.type === 'sat'));
  assert.ok(withPost(out).edges.some((e) => e.from === SINK && e.to === post.id));
  assert.ok(!out.nodes.some((n) => n.type === 'comp'));
});

// ---- a song's own board ----
test('a song keeps its board: songRouting, the sheet\'s routing lines and the server keep it', () => {
  const { graph } = ducked();
  assert.equal(songRouting(null), null);
  assert.equal(songRouting({ graph: empty }), null);
  assert.deepEqual(songRouting({ graph, on: false }), { graph: normGraph(graph), on: false });
  assert.deepEqual(routingLines('a > comp\n\n b > verb '), ['a > comp', 'b > verb']);
  assert.deepEqual(routingLines(['a > comp', 3, '']), ['a > comp']);
  // the server passes a song's board through shares and favorites (and drops what isn't one)
  assert.deepEqual(cleanRouting({ graph, on: true }), { graph, on: true });
  assert.equal(cleanRouting({ graph: { nodes: 'x', edges: [] } }), null);
  assert.equal(cleanRouting({ graph: { nodes: Array(300).fill({}), edges: [] } }), null);
  const fav = cleanFavSong({ title: 'T', sheet: { sections: [] }, library: 'const a = 1', routing: { graph } });
  assert.deepEqual(fav.routing, { graph, on: true });
  assert.ok(!('routing' in cleanFavSong({ title: 'T', sheet: { sections: [] }, library: 'x' })));
  assert.deepEqual(cleanSong({ steps: [{ bars: 4, code: 'x' }], routing: { graph } }).routing, { graph, on: true });
});
test('the sheet\'s routing lines are kept; the routing prompt gets no editor code', async () => {
  const raw = {
    bpm: 120, key: 'A minor', scale: 'A:minor', chords: { verse: 'Am F C G' }, hook: '0 2 4 2',
    parts: [{ name: 'drums', role: 'drums', sound: 'RolandTR909' }, { name: 'pad', role: 'pad', sound: 'triangle' }],
    sections: [{ name: 'A', bars: 8, chords: 'verse', play: ['drums', 'pad'] }, { name: 'B', bars: 4, chords: 'verse', play: ['pad'] }],
  };
  assert.ok(!('routing' in normalizeSheet(raw, 'auto', { enforceForm: false })));
  const sh = normalizeSheet({ ...raw, routing: ['pad > duck(key=drums) > master'] }, 'auto', { enforceForm: false });
  assert.deepEqual(sh.routing, ['pad > duck(key=drums) > master']);
  assert.deepEqual(describeChains(parseChains(sh.routing, sh.parts.map((p) => p.id)).graph), ['pad > duck(key=drums) > master']);
  const { chatBody, llmSettings, PROMPTS } = await import('../server/llm.js');
  const body = chatBody(llmSettings({}), { mode: 'routing', code: 'SECRET_CODE', messages: [{ role: 'user', content: 'duck the pad' }] });
  assert.ok(!JSON.stringify(body.history).includes('SECRET_CODE'));
  assert.ok(body.system.startsWith('You are the mix engineer'));
  assert.match(PROMPTS.sheet, /duck\(key=<part>/);
});
