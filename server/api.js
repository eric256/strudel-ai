// The /api endpoints as one web-standard handler (Request → Response), shared by the Express server (Docker) and
// Netlify (functions + an edge function for the chat). What differs between them comes in as options: the
// environment, a key/value store (files, or Netlify Blobs) and the build's info (version, plugins, changelog).
import { llmSettings, publicConfig, modelsResponse, chatResponse, checkClaudeKey, PROMPTS } from './llm.js';
import { verifyGoogleToken, signSession, sealKey, keyHint, setCookie, whoIs, SESSION_COOKIE, KEY_COOKIE } from './auth.js';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
const SHARE_ID = /^[A-Za-z0-9]{6,16}$/;
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const newId = () => [...crypto.getRandomValues(new Uint8Array(10))].map((b) => ABC[b % ABC.length]).join('');
const FAV_MAX = 300;

/**
 * A recording: { v, codes: [string], events: [{ c: cycle, i: index into codes, label }], end }.
 * Returns the cleaned recording, null when there is none, or false when it is malformed.
 */
export function cleanRecording(r) {
  if (r == null) return null;
  if (typeof r !== 'object' || !Array.isArray(r.codes) || !Array.isArray(r.events)) return false;
  if (!r.events.length) return null;
  if (r.codes.length > 5000 || r.events.length > 5000) return false;
  if (!r.codes.every((c) => typeof c === 'string' && c.length <= 200_000)) return false;
  const events = [];
  for (const ev of r.events) {
    if (!ev || !Number.isFinite(ev.c) || ev.c < 0 || !Number.isInteger(ev.i) || ev.i < 0 || ev.i >= r.codes.length) return false;
    const f = Number(ev.f);
    events.push({ c: ev.c, i: ev.i, label: String(ev.label || '').slice(0, 80), ...(f > 0 && f <= 8 ? { f } : {}) });
  }
  return { v: 1, codes: r.codes, events, end: Number.isFinite(r.end) ? r.end : events[events.length - 1].c };
}

/**
 * A whole written song (Songs tab / Station): its sheet, its parts code and every arranged section.
 * { title, desc, sheet, library, steps: [{ bars, prompt, code, fade, fillStep, section }] }
 * Returns the cleaned song, null when there is none, or false when it is malformed.
 */
export function cleanSong(s) {
  if (s == null) return null;
  if (typeof s !== 'object' || !Array.isArray(s.steps) || !s.steps.length || s.steps.length > 300) return false;
  const steps = [];
  for (const st of s.steps) {
    if (!st || typeof st.code !== 'string' || !st.code.trim() || st.code.length > 200_000) return false;
    const bars = Number(st.bars);
    if (!Number.isFinite(bars) || bars <= 0 || bars > 64) return false;
    const fade = Number(st.fade);
    steps.push({
      bars, prompt: String(st.prompt || '').slice(0, 200), code: st.code,
      fade: st.fade == null || !Number.isFinite(fade) ? null : Math.max(0, Math.min(8, fade)),
      fillStep: !!st.fillStep,
      section: st.section && typeof st.section === 'object' && JSON.stringify(st.section).length < 5000 ? st.section : null,
    });
  }
  const sheet = s.sheet && typeof s.sheet === 'object' && JSON.stringify(s.sheet).length < 100_000 ? s.sheet : null;
  return {
    title: String(s.title || '').slice(0, 120), desc: String(s.desc || '').slice(0, 1000), sheet,
    library: typeof s.library === 'string' && s.library.length <= 200_000 ? s.library : null, steps,
  };
}

/** A portable song (format strudel-ai-song) for ★ Favorites → cleaned copy, or false when malformed. */
export function cleanFavSong(s) {
  if (!s || typeof s !== 'object' || typeof s.title !== 'string' || !s.title.trim()) return false;
  const out = { format: 'strudel-ai-song', version: 1, title: s.title.slice(0, 120), desc: String(s.desc || '').slice(0, 1000), sheet: null, library: null, pads: null, steps: undefined };
  if (s.sheet && typeof s.sheet === 'object' && typeof s.library === 'string') {
    if (JSON.stringify(s.sheet).length > 100_000 || s.library.length > 200_000) return false;
    out.sheet = s.sheet;
    out.library = s.library;
  } else {
    const steps = cleanSong({ steps: s.steps });
    if (!steps) return false;
    out.steps = steps.steps;
  }
  if (Array.isArray(s.pads)) {
    out.pads = s.pads.slice(0, 16).map((p) => ({
      label: String(p?.label || '').slice(0, 24), code: String(p?.code || '').slice(0, 2000),
      mode: ['toggle', 'hold', 'once'].includes(p?.mode) ? p.mode : 'toggle', color: String(p?.color || '#7c5cff').slice(0, 40),
    }));
  }
  return out;
}

/**
 * The /api handler. opts: { env, store: { get(key) → text | null, set(key, text), delete(key), list(prefix) → keys },
 * info: () => ({ version, build, repo, changelog, plugins: { builtin, server } }) }. Returns a Response, or null for a
 * path that isn't an API endpoint.
 */
export function makeApi({ env = {}, store, info = () => ({}) }) {
  const s = llmSettings(env);
  const clientId = env.GOOGLE_CLIENT_ID || '';
  const secret = env.SESSION_SECRET || '';
  const authOn = !!(clientId && secret);
  const readJSON = async (key) => { const t = await store.get(key); try { return t ? JSON.parse(t) : null; } catch { return null; } };
  const secure = (req) => new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
  // state-changing account requests must come from this site's own pages
  const sameOrigin = (req) => { const o = req.headers.get('origin'); return !o || new URL(o).host === (req.headers.get('x-forwarded-host') || new URL(req.url).host); };
  const body = async (req) => { try { return await req.json(); } catch { return null; } };

  async function account(req) {
    const who = await whoIs(req, env);
    const rec = who.user ? await readJSON(`users/${who.user.sub}`) : null;
    return {
      who,
      auth: authOn
        ? { google: clientId, user: who.user && { email: who.user.email, name: who.user.name, picture: who.user.picture }, key: rec?.keyHint ? { hint: rec.keyHint, here: who.own } : null, shared: !!env.ANTHROPIC_API_KEY && !who.own && !!who.claudeKey }
        : null,
    };
  }

  const routes = {
    'GET /api/health': () => json({ ok: true }),
    'GET /api/version': () => { const i = info(); return json({ version: i.version, build: i.build }); },
    'GET /api/about': () => { const i = info(); return json({ version: i.version, build: i.build, repo: i.repo, changelog: i.changelog || '' }); },
    'GET /api/plugins': () => json(info().plugins || { builtin: [], server: [] }),
    'GET /api/prompts': () => json(PROMPTS),
    'GET /api/config': async (req) => {
      const { who, auth } = await account(req);
      return json({ ...publicConfig(s, { claudeKey: who.claudeKey }), auth });
    },
    'GET /api/models': async (req) => {
      const who = await whoIs(req, env);
      return modelsResponse(s, new URL(req.url).searchParams.get('provider'), { claudeKey: who.claudeKey, own: who.own });
    },
    'POST /api/chat': async (req) => {
      const who = await whoIs(req, env);
      const b = await body(req);
      if (!b) return json({ error: 'not JSON' }, 400);
      if (s.only.length && b.provider && !s.only.includes(b.provider)) return json({ error: `${b.provider} isn't offered here` }, 400);
      return chatResponse(s, b, { claudeKey: who.claudeKey, own: who.own, signal: req.signal });
    },

    // --- accounts: Google sign-in, and each user's own Claude key ---
    'POST /api/auth/google': async (req) => {
      if (!authOn) return json({ error: 'sign-in is not set up on this server (GOOGLE_CLIENT_ID and SESSION_SECRET)' }, 404);
      if (!sameOrigin(req)) return json({ error: 'wrong origin' }, 403);
      let user;
      try { user = await verifyGoogleToken((await body(req))?.credential, { clientId, jwksUrl: env.GOOGLE_JWKS_URL || undefined }); }
      catch (e) { return json({ error: `sign-in failed: ${e.message}` }, 401); }
      const rec = (await readJSON(`users/${user.sub}`)) || {};
      await store.set(`users/${user.sub}`, JSON.stringify({ ...rec, email: user.email, name: user.name, picture: user.picture, seen: new Date().toISOString() }));
      const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      headers.append('Set-Cookie', setCookie(SESSION_COOKIE, await signSession(user, secret), { secure: secure(req) }));
      // the key saved with the account comes along (on a new device too)
      if (rec.key) headers.append('Set-Cookie', setCookie(KEY_COOKIE, rec.key, { secure: secure(req) }));
      return new Response(JSON.stringify({ user: { email: user.email, name: user.name, picture: user.picture }, key: rec.keyHint ? { hint: rec.keyHint, here: true } : null }), { headers });
    },
    'POST /api/auth/logout': (req) => {
      if (!sameOrigin(req)) return json({ error: 'wrong origin' }, 403);
      const headers = new Headers({ 'Content-Type': 'application/json' });
      headers.append('Set-Cookie', setCookie(SESSION_COOKIE, '', { maxAge: 0, secure: secure(req) }));
      headers.append('Set-Cookie', setCookie(KEY_COOKIE, '', { maxAge: 0, secure: secure(req) }));
      return new Response('{"ok":true}', { headers });
    },
    'PUT /api/keys': async (req) => {
      if (!sameOrigin(req)) return json({ error: 'wrong origin' }, 403);
      const { user } = await whoIs(req, env);
      if (!user) return json({ error: 'sign in first' }, 401);
      const key = String((await body(req))?.key || '').trim();
      if (!/^sk-ant-[\w-]{20,}$/.test(key)) return json({ error: 'that isn\'t an Anthropic API key (it starts with sk-ant-)' }, 400);
      const bad = await checkClaudeKey(s, key);
      if (bad) return json({ error: bad }, 400);
      const sealed = await sealKey(key, secret, user.sub);
      const rec = (await readJSON(`users/${user.sub}`)) || {};
      await store.set(`users/${user.sub}`, JSON.stringify({ ...rec, email: user.email, key: sealed, keyHint: keyHint(key), keySaved: new Date().toISOString() }));
      return json({ key: { hint: keyHint(key), here: true } }, 200, { 'Set-Cookie': setCookie(KEY_COOKIE, sealed, { secure: secure(req) }) });
    },
    'DELETE /api/keys': async (req) => {
      if (!sameOrigin(req)) return json({ error: 'wrong origin' }, 403);
      const { user } = await whoIs(req, env);
      if (!user) return json({ error: 'sign in first' }, 401);
      const rec = (await readJSON(`users/${user.sub}`)) || {};
      delete rec.key; delete rec.keyHint;
      await store.set(`users/${user.sub}`, JSON.stringify(rec));
      return json({ key: null }, 200, { 'Set-Cookie': setCookie(KEY_COOKIE, '', { maxAge: 0, secure: secure(req) }) });
    },

    // --- 🔗 shared songs ---
    'POST /api/share': async (req) => {
      const { code, title = '', setlist = null, setText = null, recording = null, song: songIn = null } = (await body(req)) || {};
      if (typeof code !== 'string' || !code.trim()) return json({ error: 'no code to share' }, 400);
      if (code.length > 200_000 || String(setlist || '').length > 50_000 || String(setText || '').length > 50_000) return json({ error: 'song too large' }, 413);
      const rec = cleanRecording(recording);
      if (rec === false) return json({ error: 'invalid recording' }, 400);
      if (rec && JSON.stringify(rec).length > 6_000_000) return json({ error: 'recording too large' }, 413);
      const fullSong = cleanSong(songIn);
      if (fullSong === false) return json({ error: 'invalid song' }, 400);
      if (fullSong && JSON.stringify(fullSong).length > 4_000_000) return json({ error: 'song too large' }, 413);
      const id = newId();
      const shared = { id, title: String(title).slice(0, 120), code, setlist: setlist ? String(setlist) : null, setText: setText ? String(setText) : null, recording: rec, song: fullSong, created: new Date().toISOString(), appVersion: info().version };
      try { await store.set(`shares/${id}`, JSON.stringify(shared)); }
      catch (e) { return json({ error: 'could not store song: ' + e.message }, 500); }
      return json({ id, path: `/s/${id}` });
    },

    // --- ★ favorites: songs anyone on this server marked (no accounts needed) ---
    'GET /api/favorites': async () => json({ favorites: await favorites() }),
    'POST /api/favorites': async (req) => {
      const song = cleanFavSong((await body(req))?.song);
      if (!song) return json({ error: 'not a song' }, 400);
      const all = await favorites();
      const key = (x) => `${x.song.title}\n${x.song.library || JSON.stringify(x.song.steps || [])}`;
      const same = all.find((f) => key(f) === key({ song }));
      if (same) return json(same); // already a favorite
      if (all.length >= FAV_MAX) return json({ error: `the favorites list is full (${FAV_MAX})` }, 409);
      const fav = { id: newId(), favorited: new Date().toISOString(), song };
      try { await store.set(`favorites/${fav.id}`, JSON.stringify(fav)); }
      catch (e) { return json({ error: 'could not store the favorite: ' + e.message }, 500); }
      return json(fav);
    },
  };
  async function favorites() {
    const keys = (await store.list('favorites/')).filter((k) => SHARE_ID.test(k.slice('favorites/'.length)));
    const all = await Promise.all(keys.map((k) => readJSON(k)));
    return all.filter(Boolean).sort((a, b) => String(b.favorited).localeCompare(String(a.favorited)));
  }

  return async function handle(req) {
    const url = new URL(req.url);
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) return route(req);
    let m;
    if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/share\/([^/]+)$/))) {
      if (!SHARE_ID.test(m[1])) return json({ error: 'not found' }, 404);
      const t = await store.get(`shares/${m[1]}`);
      return t ? new Response(t, { headers: { 'Content-Type': 'application/json' } }) : json({ error: 'shared song not found' }, 404);
    }
    if (req.method === 'DELETE' && (m = url.pathname.match(/^\/api\/favorites\/([^/]+)$/))) {
      if (!SHARE_ID.test(m[1]) || !(await store.get(`favorites/${m[1]}`))) return json({ error: 'not found' }, 404);
      await store.delete(`favorites/${m[1]}`);
      return json({ ok: true });
    }
    return url.pathname.startsWith('/api/') ? json({ error: 'not found' }, 404) : null;
  };
}
