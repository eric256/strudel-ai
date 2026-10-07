// The Netlify edge function (POST /api/chat) in Deno — Netlify's edge runtime — against a stand-in for Claude: it
// must load (no Node-only APIs on the way: server/, prompt.js) and stream Claude's reply as the browser's events.
//   deno run --allow-net --allow-read --allow-env test/deno/edge-chat.mjs
const KEY = 'sk-ant-deno-key-0123456789';
const ac = new AbortController();
const server = Deno.serve({ port: 0, signal: ac.signal, onListen() {} }, (req) => {
  if (req.headers.get('x-api-key') !== KEY) return new Response('{"error":{"message":"bad key"}}', { status: 401 });
  const ev = (type, o) => `event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`;
  const body = new ReadableStream({ async start(c) {
    const e = new TextEncoder();
    c.enqueue(e.encode(ev('message_start', { message: { model: 'claude-deno', usage: { input_tokens: 5 } } })));
    await new Promise((r) => setTimeout(r, 20));
    c.enqueue(e.encode(ev('content_block_delta', { delta: { type: 'text_delta', text: 'hello ' } }) + ev('content_block_delta', { delta: { type: 'text_delta', text: 'deno' } })));
    c.enqueue(e.encode(ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } })));
    c.close();
  } });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
});
globalThis.Netlify = { env: { toObject: () => ({ ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.addr.port}` }) } };
const edge = await import(new URL('../../netlify/edge-functions/chat.mjs', import.meta.url).href);
const res = await edge.default(new Request('https://site.test/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ provider: 'anthropic', mode: 'code', code: 's("bd")', messages: [{ role: 'user', content: 'hi' }] }) }));
const events = (await res.text()).split('\n\n').filter((b) => b.startsWith('data: ') && !b.includes('[DONE]')).map((b) => JSON.parse(b.slice(6)));
ac.abort();
await server.finished;
const text = events.map((e) => e.choices?.[0]?.delta?.content || '').join('');
const usage = events.find((e) => e.usage)?.usage;
if (res.status !== 200 || text !== 'hello deno' || usage?.output !== 2 || edge.config.path !== '/api/chat') {
  console.error('✗ the edge function in Deno:', res.status, JSON.stringify(events));
  Deno.exit(1);
}
console.log('✓ the chat edge function runs in Deno and streams Claude\'s reply');
