// The server's shared core (server/): Google sign-in, sessions and sealed keys (auth.js), the /api handler with its
// account endpoints, shares and favorites (api.js), Claude's stream turned into the browser's events (llm.js), and
// the Netlify function / edge function around them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { verifyGoogleToken, signSession, readSession, sealKey, openKey, keyHint, b64url } from '../server/auth.js';
import { makeApi } from '../server/api.js';

const enc = new TextEncoder();
/** A test "Google": an RSA key, its JWKS, and ID tokens it signs. */
async function fakeGoogle(clientId = 'test-client') {
  const { privateKey, publicKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  // (a fresh key id each time, as Google's keys rotate: a cached set of keys is fetched again for a new one)
  const kid1 = `k${Math.random().toString(36).slice(2)}`;
  const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: kid1, use: 'sig', alg: 'RS256' };
  const token = async (claims = {}, kid = kid1) => {
    const h = b64url(enc.encode(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })));
    const p = b64url(enc.encode(JSON.stringify({ iss: 'https://accounts.google.com', aud: clientId, sub: '1234567890', email: 'ada@example.com', email_verified: true, name: 'Ada', exp: Math.floor(Date.now() / 1000) + 600, ...claims })));
    return `${h}.${p}.${b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(`${h}.${p}`)))}`;
  };
  return { jwks: { keys: [jwk] }, token, clientId };
}
const memStore = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k), list: async (p) => [...m.keys()].filter((k) => k.startsWith(p)) }; };
/** fetch, faked: Google's keys, and an Anthropic API that knows one good key. */
function fakeFetch(g, seen = []) {
  return async (url, init = {}) => {
    const u = String(url), h = new Headers(init.headers || {});
    seen.push({ url: u, key: h.get('x-api-key'), body: init.body ? JSON.parse(init.body) : null });
    if (u.endsWith('/jwks')) return Response.json(g.jwks);
    if (u.includes('/v1/models')) return h.get('x-api-key') === 'sk-ant-good-key-0123456789abcdef' ? Response.json({ data: [{ id: 'claude-x', display_name: 'Claude X' }] }) : new Response('{"error":{"message":"invalid x-api-key"}}', { status: 401 });
    if (u.endsWith('/v1/messages')) {
      const ev = (type, o) => `event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`;
      const sse = ev('message_start', { message: { model: 'claude-x', usage: { input_tokens: 12, cache_read_input_tokens: 3 } } }) +
        ev('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }) +
        ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'Here: ' } }) +
        ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: '```javascript\ns("bd")\n```' } }) +
        ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } }) + ev('message_stop', {});
      return new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return new Response('nope', { status: 404 });
  };
}
const ENV = { GOOGLE_CLIENT_ID: 'test-client', SESSION_SECRET: 'a long random test secret 0123456789', GOOGLE_JWKS_URL: 'http://google.test/jwks', ANTHROPIC_BASE_URL: 'http://anthropic.test', DEFAULT_PROVIDER: 'anthropic' };
const req = (method, path, { body, cookie = '', origin } = {}) => new Request(`https://app.test${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const cookieJar = (res, jar = {}) => { for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (/Max-Age=0/.test(c)) delete jar[k]; else jar[k] = v; } return jar; };
const asCookie = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
async function sseText(res) {
  const text = await res.text();
  return text.split('\n\n').filter((b) => b.startsWith('data: ') && !b.includes('[DONE]')).map((b) => JSON.parse(b.slice(6)));
}

test('Google ID tokens: checked against Google\'s keys, for this app, unexpired', async () => {
  const g = await fakeGoogle();
  const opts = { clientId: 'test-client', jwksUrl: 'http://google.test/jwks', fetchImpl: fakeFetch(g) };
  assert.deepEqual(await verifyGoogleToken(await g.token(), opts), { sub: '1234567890', email: 'ada@example.com', name: 'Ada', picture: '' });
  await assert.rejects(verifyGoogleToken(await g.token({ aud: 'another-app' }), opts), /another app/);
  await assert.rejects(verifyGoogleToken(await g.token({ exp: 1000 }), opts), /expired/);
  await assert.rejects(verifyGoogleToken(await g.token({ iss: 'https://evil.test' }), opts), /not issued by Google/);
  await assert.rejects(verifyGoogleToken(await g.token({ email_verified: false }), opts), /not verified/);
  const t = await g.token();
  await assert.rejects(verifyGoogleToken(t.slice(0, -4) + 'AAAA', opts), /bad signature/);
  await assert.rejects(verifyGoogleToken(await g.token({}, 'other-kid'), opts), /unknown signing key/);
  await assert.rejects(verifyGoogleToken('nonsense', opts), /not a Google ID token/);
});

test('sessions are signed and expire; keys are sealed per account', async () => {
  const s = await signSession({ sub: '1', email: 'a@b.c' }, 'secret');
  assert.equal((await readSession(s, 'secret')).email, 'a@b.c');
  assert.equal(await readSession(s, 'other secret'), null);
  assert.equal(await readSession(s.replace(/^./, 'x'), 'secret'), null, 'tampered');
  assert.equal(await readSession(await signSession({ sub: '1' }, 'secret', { now: 0 }), 'secret'), null, 'expired');
  const sealed = await sealKey('sk-ant-xyz', 'secret', '1');
  assert.ok(!sealed.includes('sk-ant'));
  assert.equal(await openKey(sealed, 'secret', '1'), 'sk-ant-xyz');
  assert.equal(await openKey(sealed, 'secret', '2'), null, 'another account can\'t open it');
  assert.equal(await openKey(sealed, 'other', '1'), null);
  assert.equal(keyHint('sk-ant-api03-abcdefgh1234'), 'sk-ant-…1234');
});

test('accounts: sign in with Google, save your own Claude key (checked, sealed), Claude uses it; sign out', async (t) => {
  const g = await fakeGoogle();
  const seen = [];
  t.mock.method(globalThis, 'fetch', fakeFetch(g, seen));
  const store = memStore();
  const api = makeApi({ env: ENV, store });
  // signed out: accounts are on, Claude has no key
  let cfg = await (await api(req('GET', '/api/config'))).json();
  assert.equal(cfg.auth.google, 'test-client');
  assert.equal(cfg.auth.user, null);
  assert.equal(cfg.providers.anthropic.hasKey, false);
  assert.equal((await api(req('PUT', '/api/keys', { body: { key: 'sk-ant-good-key-0123456789abcdef' } }))).status, 401, 'sign in first');
  // sign in
  const jar = {};
  let r = await api(req('POST', '/api/auth/google', { body: { credential: await g.token() }, origin: 'https://app.test' }));
  assert.equal(r.status, 200);
  cookieJar(r, jar);
  assert.ok(jar.sai_session && !jar.sai_key);
  assert.match(store.m.get('users/1234567890'), /ada@example\.com/);
  assert.equal((await api(req('POST', '/api/auth/google', { body: { credential: 'junk' } }))).status, 401);
  // a key that Anthropic rejects, a wrong shape, another site's request
  assert.match((await (await api(req('PUT', '/api/keys', { body: { key: 'sk-ant-bad-key-0123456789abcdefgh' }, cookie: asCookie(jar) }))).json()).error, /rejected/);
  assert.match((await (await api(req('PUT', '/api/keys', { body: { key: 'hello' }, cookie: asCookie(jar) }))).json()).error, /sk-ant-/);
  assert.equal((await api(req('PUT', '/api/keys', { body: { key: 'sk-ant-good-key-0123456789abcdef' }, cookie: asCookie(jar), origin: 'https://evil.test' }))).status, 403);
  // a good key: sealed in the store and the cookie, never in plain text
  r = await api(req('PUT', '/api/keys', { body: { key: 'sk-ant-good-key-0123456789abcdef' }, cookie: asCookie(jar), origin: 'https://app.test' }));
  assert.deepEqual(await r.json(), { key: { hint: 'sk-ant-…cdef', here: true } });
  cookieJar(r, jar);
  assert.ok(jar.sai_key && !decodeURIComponent(jar.sai_key).includes('sk-ant'));
  assert.ok(!store.m.get('users/1234567890').includes('sk-ant-good'), 'the store has it sealed only');
  cfg = await (await api(req('GET', '/api/config', { cookie: asCookie(jar) }))).json();
  assert.deepEqual(cfg.auth.user, { email: 'ada@example.com', name: 'Ada', picture: '' });
  assert.equal(cfg.auth.key.hint, 'sk-ant-…cdef');
  assert.equal(cfg.providers.anthropic.hasKey, true);
  // Claude, with your key: its stream becomes the browser's events
  r = await api(req('POST', '/api/chat', { body: { provider: 'anthropic', mode: 'code', code: 's("hh")', messages: [{ role: 'user', content: 'a beat' }] }, cookie: asCookie(jar) }));
  assert.equal(r.headers.get('content-type'), 'text/event-stream');
  const events = await sseText(r);
  assert.deepEqual(events.map((e) => e.choices?.[0]?.delta?.content ?? e.choices?.[0]?.delta?.reasoning_content ?? (e.usage && 'usage')), ['hmm', 'Here: ', '```javascript\ns("bd")\n```', 'usage']);
  assert.deepEqual(events[3].usage, { model: 'claude-x', input: 12, output: 7, cache_read: 3, cache_write: 0, stop: 'end_turn' });
  const call = seen.find((x) => x.url.endsWith('/v1/messages'));
  assert.equal(call.key, 'sk-ant-good-key-0123456789abcdef');
  assert.match(call.body.messages[0].content, /CURRENT CODE[\s\S]*s\("hh"\)[\s\S]*REQUEST: a beat/);
  assert.equal(call.body.system[0].cache_control.ttl, '1h');
  // on a new device: signing in brings the saved key along
  const jar2 = cookieJar(await api(req('POST', '/api/auth/google', { body: { credential: await g.token() } })));
  assert.equal(jar2.sai_key, jar.sai_key);
  // remove the key, sign out
  r = await api(req('DELETE', '/api/keys', { cookie: asCookie(jar) }));
  cookieJar(r, jar);
  assert.ok(!jar.sai_key && !store.m.get('users/1234567890').includes('keyHint'));
  cookieJar(await api(req('POST', '/api/auth/logout')), jar);
  assert.ok(!jar.sai_session);
});

test('the server\'s own Claude key: for everyone, or only ALLOWED_EMAILS; no key → a clear error', async (t) => {
  const g = await fakeGoogle();
  t.mock.method(globalThis, 'fetch', fakeFetch(g));
  const open = makeApi({ env: { ...ENV, ANTHROPIC_API_KEY: 'sk-ant-good-key-0123456789abcdef' }, store: memStore() });
  assert.equal((await (await open(req('GET', '/api/config'))).json()).providers.anthropic.hasKey, true);
  const only = makeApi({ env: { ...ENV, ANTHROPIC_API_KEY: 'sk-ant-good-key-0123456789abcdef', ALLOWED_EMAILS: 'ada@example.com' }, store: memStore() });
  assert.equal((await (await only(req('GET', '/api/config'))).json()).providers.anthropic.hasKey, false, 'not signed in');
  const jar = cookieJar(await only(req('POST', '/api/auth/google', { body: { credential: await g.token() } })));
  const cfg = await (await only(req('GET', '/api/config', { cookie: asCookie(jar) }))).json();
  assert.equal(cfg.providers.anthropic.hasKey, true);
  assert.equal(cfg.auth.shared, true);
  const none = makeApi({ env: ENV, store: memStore() });
  const r = await none(req('POST', '/api/chat', { body: { provider: 'anthropic', messages: [{ role: 'user', content: 'hi' }] } }));
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /needs an API key: sign in/);
  // no accounts set up: no auth in the config, sign-in refused
  const plain = makeApi({ env: {}, store: memStore() });
  assert.equal((await (await plain(req('GET', '/api/config'))).json()).auth, null);
  assert.equal((await plain(req('POST', '/api/auth/google', { body: {} }))).status, 404);
});

test('shares and favorites through the handler (any store)', async () => {
  const store = memStore();
  const api = makeApi({ env: {}, store, info: () => ({ version: '9.9.9' }) });
  const r = await (await api(req('POST', '/api/share', { body: { code: 's("bd")', title: 'Beat' } }))).json();
  assert.match(r.path, /^\/s\/[A-Za-z0-9]{10}$/);
  const got = await (await api(req('GET', `/api/share/${r.id}`))).json();
  assert.equal(got.code, 's("bd")');
  assert.equal(got.appVersion, '9.9.9');
  assert.equal((await api(req('GET', '/api/share/nope!'))).status, 404);
  assert.equal((await api(req('POST', '/api/share', { body: { code: '' } }))).status, 400);
  const fav = await (await api(req('POST', '/api/favorites', { body: { song: { title: 'Fav', sheet: { sections: [] }, library: 'const a = s("bd")' } } }))).json();
  assert.equal((await (await api(req('POST', '/api/favorites', { body: { song: { title: 'Fav', sheet: { sections: [] }, library: 'const a = s("bd")' } } }))).json()).id, fav.id, 'the same song once');
  assert.equal((await (await api(req('GET', '/api/favorites'))).json()).favorites.length, 1);
  assert.equal((await api(req('DELETE', `/api/favorites/${fav.id}`))).status, 200);
  assert.equal((await (await api(req('GET', '/api/favorites'))).json()).favorites.length, 0);
  assert.equal(await api(new Request('https://app.test/not-api')), null, 'not an API path');
  assert.equal((await api(req('GET', '/api/nothing'))).status, 404);
});

test('Netlify: the build writes the site and its info; the function serves the API from Blobs; the edge function chats', async (t) => {
  execFileSync(process.execPath, ['scripts/build-netlify.mjs'], { env: { ...process.env, NETLIFY_DIST: '.test-dist' } });
  const fs = await import('node:fs');
  try {
    const index = fs.readFileSync('.test-dist/index.html', 'utf8');
    assert.match(index, /<meta name="app-build" content="[0-9a-f]{8}"/);
    for (const f of ['app.js', 'vendor/strudel', 'vendor/lit-html', 'vendor/drawflow', 'plugins/midi-export.js']) assert.ok(fs.existsSync(`.test-dist/${f}`), f);
  } finally { fs.rmSync('.test-dist', { recursive: true, force: true }); }
  const fn = await import('../netlify/functions/api.mjs');
  assert.equal(fn.config.path, '/api/*');
  const api = fn.handlerWith(memStore(), {});
  const v = await (await api(req('GET', '/api/version'))).json();
  assert.equal(v.version, JSON.parse(fs.readFileSync('package.json', 'utf8')).version);
  assert.ok((await (await api(req('GET', '/api/plugins'))).json()).builtin.includes('/plugins/musicxml-import.js'));
  const cfg = await (await api(req('GET', '/api/config'))).json();
  assert.deepEqual(Object.keys(cfg.providers), ['anthropic'], 'hosted: Claude only');
  // a Blobs store as the API's store
  const blobs = new Map();
  const store = fn.blobStore({ get: async (k) => blobs.get(k) ?? null, set: async (k, v) => void blobs.set(k, v), delete: async (k) => void blobs.delete(k), list: async ({ prefix }) => ({ blobs: [...blobs.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }) });
  await store.set('favorites/abcdefgh', '{}');
  assert.deepEqual(await store.list('favorites/'), ['favorites/abcdefgh']);
  // the edge function: the chat, with the site's environment
  globalThis.Netlify = { env: { toObject: () => ({}) } };
  t.after(() => { delete globalThis.Netlify; });
  const edge = (await import('../netlify/edge-functions/chat.mjs'));
  assert.equal(edge.config.path, '/api/chat');
  const r = await edge.default(req('POST', '/api/chat', { body: { messages: [{ role: 'user', content: 'hi' }] } }));
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /Claude needs an API key/);
});
