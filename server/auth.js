// Accounts, in web-standard JavaScript (WebCrypto): Google sign-in (the ID token Google gives the page, checked
// against Google's public keys), a signed session cookie, and the user's own API key sealed with the server's secret
// (AES-GCM) — stored per account, and carried in an HttpOnly cookie so the chat (an edge function) needs no database.

const enc = new TextEncoder(), dec = new TextDecoder();
export const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));

const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
let jwksCache = { url: '', at: 0, keys: [] };
async function jwks(url, fetchImpl) {
  if (jwksCache.url === url && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Google's keys: HTTP ${r.status}`);
  jwksCache = { url, at: Date.now(), keys: (await r.json()).keys || [] };
  return jwksCache.keys;
}

/**
 * A Google ID token (the credential "Sign in with Google" hands the page) → { sub, email, name, picture }. Throws
 * when it isn't one: a bad signature, another app's token (aud), expired, or an unverified email.
 */
export async function verifyGoogleToken(token, { clientId, jwksUrl = GOOGLE_JWKS, fetchImpl = fetch, now = Date.now() } = {}) {
  if (!clientId) throw new Error('Google sign-in is not set up (GOOGLE_CLIENT_ID)');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('not a Google ID token');
  const head = JSON.parse(dec.decode(unb64url(parts[0])));
  const claims = JSON.parse(dec.decode(unb64url(parts[1])));
  if (head.alg !== 'RS256') throw new Error('unexpected token algorithm');
  let jwk = (await jwks(jwksUrl, fetchImpl)).find((k) => k.kid === head.kid);
  if (!jwk) { jwksCache.at = 0; jwk = (await jwks(jwksUrl, fetchImpl)).find((k) => k.kid === head.kid); } // keys rotate
  if (!jwk) throw new Error('unknown signing key');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error('bad signature');
  if (!GOOGLE_ISSUERS.includes(claims.iss)) throw new Error('not issued by Google');
  if (claims.aud !== clientId) throw new Error('a token for another app');
  if (!(claims.exp * 1000 > now)) throw new Error('expired');
  if (claims.email && claims.email_verified === false) throw new Error('the email is not verified');
  return { sub: String(claims.sub), email: String(claims.email || ''), name: String(claims.name || ''), picture: String(claims.picture || '') };
}

const keyCache = new Map();
async function hmacKey(secret) {
  const k = `h:${secret}`;
  if (!keyCache.has(k)) keyCache.set(k, await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']));
  return keyCache.get(k);
}
async function aesKey(secret) {
  const k = `a:${secret}`;
  if (!keyCache.has(k)) {
    const raw = await crypto.subtle.digest('SHA-256', enc.encode(`strudel-ai api keys\n${secret}`));
    keyCache.set(k, await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
  }
  return keyCache.get(k);
}

/** A signed session: { sub, email, name, picture } valid for `days` → a cookie value. */
export async function signSession(user, secret, { days = 30, now = Date.now() } = {}) {
  const body = b64url(enc.encode(JSON.stringify({ ...user, exp: Math.floor(now / 1000) + days * 86400 })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}
/** A session cookie value → the user, or null (missing, tampered with or expired). */
export async function readSession(value, secret, { now = Date.now() } = {}) {
  if (!value || !secret) return null;
  const [body, sig] = String(value).split('.');
  if (!body || !sig) return null;
  try {
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(sig), enc.encode(body)))) return null;
    const s = JSON.parse(dec.decode(unb64url(body)));
    return s.exp * 1000 > now ? s : null;
  } catch { return null; }
}

/** Seal an API key with the server's secret (bound to the account: another account's cookie can't open it). */
export async function sealKey(plain, secret, sub) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(String(sub)) }, await aesKey(secret), enc.encode(plain));
  return b64url([...iv, ...new Uint8Array(ct)]);
}
/** Open a sealed key, or null. */
export async function openKey(sealed, secret, sub) {
  if (!sealed || !secret) return null;
  try {
    const b = unb64url(sealed);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12), additionalData: enc.encode(String(sub)) }, await aesKey(secret), b.slice(12));
    return dec.decode(pt);
  } catch { return null; }
}
/** How a key is shown: its start and last 4 ("sk-ant-…a1b2"). */
export const keyHint = (k) => (k ? `${String(k).slice(0, 7)}…${String(k).slice(-4)}` : '');

/** Cookies of a request: { name: value }. */
export function cookies(request) {
  const out = {};
  for (const part of String(request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
/** A Set-Cookie header: HttpOnly, SameSite=Lax, Secure on https; maxAge 0 deletes it. */
export function setCookie(name, value, { maxAge = 30 * 86400, secure = true } = {}) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
export const SESSION_COOKIE = 'sai_session', KEY_COOKIE = 'sai_key';

/**
 * Who is asking, and with which Claude key: { user (or null), claudeKey, own (it's the user's own key) }. The user's
 * key (from its cookie) wins; else the server's ANTHROPIC_API_KEY — for everyone, or (ALLOWED_EMAILS) only for some.
 */
export async function whoIs(request, env) {
  const c = cookies(request);
  const secret = env.SESSION_SECRET || '';
  const user = await readSession(c[SESSION_COOKIE], secret);
  const own = user ? await openKey(c[KEY_COOKIE], secret, user.sub) : null;
  if (own) return { user, claudeKey: own, own: true };
  const allowed = String(env.ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const shared = env.ANTHROPIC_API_KEY && (!allowed.length || (user && allowed.includes(user.email.toLowerCase()))) ? env.ANTHROPIC_API_KEY : '';
  return { user, claudeKey: shared, own: false };
}
