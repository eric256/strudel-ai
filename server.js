import express from 'express';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeApi } from './server/api.js';
import { fileStore } from './server/file-store.js';
import { buildInfo, VENDOR } from './server/build-info.js';

// The Express server (Docker, or `npm start`): the app's files, and the /api endpoints — which live in server/api.js,
// shared with the Netlify version (see netlify.toml). Data (shared songs, favorites, accounts) is kept as JSON files
// in DATA_DIR (mount a volume).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PUBLIC_DIR = path.join(__dirname, 'public');
// 🧩 Plugins: the example plugins that come with the app (public/plugins/) and the server's own plugins folder
// (PLUGINS_DIR, default ./plugins: drop a .js file in, reload the page, and turn it on in ⚙ Settings → 🧩 Plugins).
const PLUGINS_DIR = env.PLUGINS_DIR || path.join(__dirname, 'plugins');
const INFO = buildInfo(__dirname);
console.log(`Strudel AI v${INFO.version} (build ${INFO.build})`);
const DATA_DIR = env.DATA_DIR || path.join(__dirname, 'data');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { console.error('data storage unavailable:', e.message); }
if (env.GOOGLE_CLIENT_ID && !env.SESSION_SECRET) console.warn('Google sign-in needs SESSION_SECRET too (a long random string) — sign-in is off');

const api = makeApi({
  env,
  store: fileStore(DATA_DIR),
  // (the server's plugins folder is read each time: drop a file in and reload)
  info: () => ({ ...INFO, plugins: { builtin: INFO.plugins.builtin, server: listJs(PLUGINS_DIR).map((f) => `/user-plugins/${f}`) } }),
});
function listJs(dir) { try { return fs.readdirSync(dir).filter((f) => /^[\w.-]+\.m?js$/.test(f)).sort(); } catch { return []; } }

const app = express();
app.set('trust proxy', true);

// /api: Express request → web Request → the shared handler → its Response streamed back (the chat streams)
app.use('/api', async (req, res, next) => {
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ac.abort(); });
  try {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const request = new Request(url, { method: req.method, headers, signal: ac.signal, ...(hasBody ? { body: Readable.toWeb(req), duplex: 'half' } : {}) });
    const response = await api(request);
    if (!response) return next();
    res.status(response.status);
    const cookies = response.headers.getSetCookie?.() || [];
    response.headers.forEach((v, k) => { if (k !== 'set-cookie') res.setHeader(k, v); });
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    if (!response.body) return res.end();
    res.flushHeaders();
    Readable.fromWeb(response.body).on('error', () => res.end()).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
    else res.end();
  }
});

const sendIndex = (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(INFO.indexHtml);
};
app.get(['/', '/index.html', '/s/:id'], sendIndex);
// the browser's libraries, served from node_modules (Strudel, dockview, Hydra, lit-html, lamejs, Drawflow)
for (const [name, dir] of Object.entries(VENDOR)) app.use(`/vendor/${name}`, express.static(path.join(__dirname, dir), { maxAge: '7d' }));
// app files: always revalidate, so a new build is picked up on the next load
app.use(express.static(PUBLIC_DIR, { setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
app.use('/user-plugins', express.static(PLUGINS_DIR, { setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));

// ---------------------------------------------------------------------------
// Listen: HTTP always, HTTPS optionally (browsers only allow AudioWorklet —
// which Strudel needs — on localhost or HTTPS, so use HTTPS for LAN access).
// ---------------------------------------------------------------------------
const PORT = Number(env.PORT || 3000);
http.createServer(app).listen(PORT, () => console.log(`Strudel AI  http://0.0.0.0:${PORT}`));

if (env.HTTPS_PORT) {
  const certDir = env.CERT_DIR || path.join(__dirname, 'certs');
  const keyFile = path.join(certDir, 'key.pem');
  const certFile = path.join(certDir, 'cert.pem');
  try {
    if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) {
      fs.mkdirSync(certDir, { recursive: true });
      console.log('Generating self-signed certificate…');
      execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
        '-keyout', keyFile, '-out', certFile, '-subj', '/CN=strudel-ai',
      ], { stdio: 'ignore' });
    }
    https
      .createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, app)
      .listen(Number(env.HTTPS_PORT), () =>
        console.log(`Strudel AI  https://0.0.0.0:${env.HTTPS_PORT} (self-signed)`),
      );
  } catch (e) {
    console.error('HTTPS disabled:', e.message);
  }
}
