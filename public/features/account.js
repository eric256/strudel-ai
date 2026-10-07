// ---------------------------------------------------------------------------
// 👤 Account: on a server with sign-in (GOOGLE_CLIENT_ID + SESSION_SECRET — the Netlify version, or Docker), sign in
// with Google and save your own Anthropic API key. The server checks it, keeps it encrypted with your account, and
// uses it for your Claude requests; the browser never sees it again (an HttpOnly cookie carries it, sealed).
// ⚙ Settings → AI shows it; /api/config says whether accounts are on (config.auth).
// ---------------------------------------------------------------------------
import { $, addMsg, reloadConfig, state } from '../app.js';
import { render, nothing } from '../html.js';
import { T } from '../templates/index.js';

const ui = { busy: false, msg: '', bad: false };
let gisLoading = null, gisReady = '';

/** Google's sign-in script, loaded once (only on servers with accounts). */
function loadGis() {
  gisLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Google sign-in could not load (offline, or blocked?)'));
    document.head.appendChild(s);
  });
  return gisLoading;
}

async function call(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
async function busy(fn, done) {
  Object.assign(ui, { busy: true, msg: '', bad: false });
  renderAccount();
  try { await fn(); Object.assign(ui, { msg: done || '', bad: false }); }
  catch (e) { Object.assign(ui, { msg: `⚠ ${e.message}`, bad: true }); }
  ui.busy = false;
  await reloadConfig().catch(() => {});
  renderAccount();
}

/** Sign in with a Google ID token (what Google's button hands back). */
export function signInWithCredential(credential) {
  return busy(async () => {
    const j = await call('POST', '/api/auth/google', { credential });
    addMsg('info', `👤 signed in as ${j.user.email}${j.key ? ` — using your Claude key ${j.key.hint}` : ''}`);
  });
}
const act = {
  save: (key) => busy(() => call('PUT', '/api/keys', { key }), '✓ saved — Claude now uses your key'),
  remove: () => busy(() => call('DELETE', '/api/keys'), 'your key is removed from this server'),
  signOut: () => busy(() => call('POST', '/api/auth/logout'), 'signed out'),
};

/**
 * Draw the account box, and Google's button when signed out — Google's script loads only once the box is shown
 * (⚙ Settings → AI), not with every page.
 */
export function renderAccount({ showing = false } = {}) {
  const el = $('accountBox');
  if (!el) return;
  const auth = state.config?.auth;
  el.hidden = !auth;
  if (!auth) { render(nothing, el); return; }
  render(T.accountBox({ user: auth.user, key: auth.key, shared: auth.shared, ...ui }, act), el);
  const slot = el.querySelector('.acc-google');
  if (!slot || auth.user || (!showing && !gisLoading)) return;
  loadGis().then(() => {
    const g = globalThis.google?.accounts?.id;
    if (!g) return;
    if (gisReady !== auth.google) {
      g.initialize({ client_id: auth.google, callback: (r) => signInWithCredential(r.credential), ux_mode: 'popup', auto_select: false });
      gisReady = auth.google;
    }
    if (!slot.childElementCount) g.renderButton(slot, { theme: 'outline', size: 'medium', text: 'signin_with', shape: 'pill' });
  }).catch((e) => { Object.assign(ui, { msg: `⚠ ${e.message}`, bad: true }); renderAccount(); });
}

export function setup() {
  document.addEventListener('strudel-ai:config', () => renderAccount());
}
