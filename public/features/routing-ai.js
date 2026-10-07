// ---------------------------------------------------------------------------
// 🔀 Routing by the AI: the chat designs the effect chains of the song playing (or the board), as chain lines
// (lib/routing.js: "pad > duck(key=drums, depth=-10) > verb(mix=0.3) > master") — read back into a graph and put on
// the song's own board (📌, heard while it plays) or, without a song, on the board shown now. The chat's 🎯 target
// "🔀 routing" sends every message here; "auto" does when the message talks about routing (sidechain, a bus, a send …).
// Songs written from a sheet can bring their routing too (the sheet's "routing" lines: features/song-writer.js).
// ---------------------------------------------------------------------------
import { bubbleRenderer, fencedBlock, requestLLM } from './llm.js';
import { parseChains } from '../lib/routing.js';
import { applyChains, boardChains } from './routing.js';
import { mixerChannels } from './mixer.js';
import { $, activeSong, addMsg, clog, queue } from '../app.js';

/** Words that make an "auto" chat message a routing request. */
export const ROUTING_WORDS = /\b(side-?chain(ed|ing)?|duck(s|ed|ing)?|pump(s|ing)?|routing|re-?route|route (the|it|them)|effects? chains?|fx chains?|drum bus|a bus|parallel comp(ression)?|new york comp(ression)?|reverb send|delay send|echo send)\b/i;
/** Does this message go to the routing AI? (the 🎯 target, or auto and routing words) */
export function wantsRouting(text) {
  const t = $('chatTarget')?.value;
  return t === 'routing' || (t === 'auto' && ROUTING_WORDS.test(text) && partNames().length > 0);
}
const songNow = () => (queue.running && queue.songs[queue.current]) || activeSong() || null;
function partNames() {
  const sg = songNow();
  return [...new Set([...(sg?.sheet?.parts || []).map((p) => p.id), ...mixerChannels().map((c) => c.base)])];
}

/** The request the AI gets: the song, its parts, the routing now, what's asked. */
export function routingRequest(text, { sg = songNow(), parts = partNames(), now = boardChains() } = {}) {
  const sh = sg?.sheet;
  const part = (n) => { const p = sh?.parts?.find((x) => x.id === n); return `- ${n}${p ? ` (${p.role}, ${p.sound}${p.layers?.length ? ` + ${p.layers.join(' + ')}` : ''})` : ''}`; };
  return [
    sg ? `SONG “${sg.title}”${sg.desc ? ` — ${String(sg.desc).slice(0, 300)}` : ''}` : 'NO SONG: the music in the editor.',
    sh ? `${[sh.band && sh.band !== 'none' && `band ${sh.band}`, sh.form && `form ${sh.form}`, `master style ${sh.master}`, `${sh.bpm} bpm`, sh.key].filter(Boolean).join(' · ')}` : '',
    `PARTS:\n${parts.map(part).join('\n')}`,
    `ROUTING NOW:\n${now.length ? now.join('\n') : '(none: every part goes straight to the master)'}`,
    `REQUEST: ${text}`,
  ].filter(Boolean).join('\n\n');
}

/** One routing chat turn: ask, show the reply, put the chains on the board. */
export async function askRouting(text, { signal } = {}) {
  const sg = songNow(), parts = partNames();
  if (!parts.length) { addMsg('info', '🔀 nothing to route yet: play a song (or code with named parts) first'); return; }
  const bubble = addMsg('assistant', '', { raw: true });
  const r = bubbleRenderer(bubble);
  const reply = await requestLLM({
    mode: 'routing', messages: [{ role: 'user', content: routingRequest(text, { sg, parts }) }], sounds: '',
    onUpdate: r.update, signal, label: '🔀 routing', onError: () => { if (!bubble.textContent.trim()) bubble.remove(); },
  });
  r.done();
  const block = fencedBlock(reply, 'routing') ?? fencedBlock(reply, '');
  if (block == null) { addMsg('error', '🔀 the reply had no routing block — nothing changed'); return; }
  const { graph, errors } = parseChains(block.split('\n'), parts);
  for (const e of errors) clog('warn', `🔀 skipped: ${e}`);
  if (!graph.nodes.length && !graph.edges.length && errors.length) { addMsg('error', `🔀 none of the chains could be used (${errors[0]}) — nothing changed`); return; }
  // a song that's written from a sheet keeps it (its own board); otherwise the board shown now
  const where = applyChains(graph, sg?.sheet ? sg : null);
  addMsg('info', `🔀 ${where === 'song' ? `“${sg.title}” now has its own board (📌 in 🔀 Routing)` : 'on the board'}: ${graph.nodes.length} effect${graph.nodes.length === 1 ? '' : 's'}${errors.length ? ` · ${errors.length} line${errors.length > 1 ? 's' : ''} skipped (see 🖥 Console)` : ''}`);
}

export function setup() {}
