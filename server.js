import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SYSTEM_PROMPT, SETLIST_PROMPT, SONGS_PROMPT, SHEET_PROMPT, LIBRARY_PROMPT } from './prompt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

// ---------------------------------------------------------------------------
// Provider configuration (all OpenAI-compatible chat completion APIs)
// ---------------------------------------------------------------------------
const trimSlash = (s) => (s || '').replace(/\/+$/, '');

const PROVIDERS = {
  llamacpp: {
    label: 'llama.cpp',
    baseUrl: trimSlash(env.LLAMACPP_URL || 'http://host.docker.internal:8080'),
    apiKey: env.LLAMACPP_API_KEY || '',
    model: env.LLAMACPP_MODEL || '',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
  },
  // Claude via Anthropic's API (official SDK). Key from ANTHROPIC_API_KEY, never sent to the browser.
  anthropic: {
    label: 'Claude',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKey: env.ANTHROPIC_API_KEY || '',
    model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  },
  openwebui: {
    label: 'OpenWebUI',
    baseUrl: trimSlash(env.OPENWEBUI_URL || 'http://host.docker.internal:3000'),
    apiKey: env.OPENWEBUI_API_KEY || '',
    model: env.OPENWEBUI_MODEL || '',
    chatPath: '/api/chat/completions',
    modelsPath: '/api/models',
  },
};

const DEFAULT_PROVIDER = PROVIDERS[env.DEFAULT_PROVIDER] ? env.DEFAULT_PROVIDER : 'llamacpp';
const TEMPERATURE = Number(env.LLM_TEMPERATURE ?? 0.7);
const MAX_TOKENS = Number(env.LLM_MAX_TOKENS ?? 2048);
const REQUEST_TIMEOUT_MS = Number(env.LLM_TIMEOUT_MS ?? 180000);

function headersFor(p) {
  const h = { 'Content-Type': 'application/json' };
  if (p.apiKey) h.Authorization = `Bearer ${p.apiKey}`;
  return h;
}

function getProvider(name) {
  return PROVIDERS[name] || PROVIDERS[DEFAULT_PROVIDER];
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Version: semantic version from package.json + a build id = hash of the app's
// files. Any rebuild/redeploy changes the build id; open pages notice and update.
// ---------------------------------------------------------------------------
const PUBLIC_DIR = path.join(__dirname, 'public');
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
const BUILD = (() => {
  const h = crypto.createHash('sha1').update(VERSION);
  const files = ['server.js', 'prompt.js', ...fs.readdirSync(PUBLIC_DIR).map((f) => path.join('public', f))];
  for (const f of files.sort()) {
    try { h.update(f).update(fs.readFileSync(path.join(__dirname, f))); } catch {}
  }
  return h.digest('hex').slice(0, 8);
})();
console.log(`Strudel AI v${VERSION} (build ${BUILD})`);

// ---------------------------------------------------------------------------
// Shared songs: stored as small JSON files in DATA_DIR/shares (mount a volume)
// ---------------------------------------------------------------------------
const DATA_DIR = env.DATA_DIR || path.join(__dirname, 'data');
const SHARE_DIR = path.join(DATA_DIR, 'shares');
try { fs.mkdirSync(SHARE_DIR, { recursive: true }); } catch (e) { console.error('share storage unavailable:', e.message); }
const SHARE_ID = /^[A-Za-z0-9]{6,16}$/;
const newShareId = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  return [...bytes].map((b) => abc[b % abc.length]).join('');
};

const app = express();
app.use(express.json({ limit: '8mb' }));

// index.html carries the build id it was served with, so the page knows its own version
const INDEX_HTML = fs
  .readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
  .replace('<head>', `<head>\n  <meta name="app-version" content="${VERSION}" />\n  <meta name="app-build" content="${BUILD}" />`)
  .replace(/(\/(?:app\.js|style\.css))"/g, `$1?v=${BUILD}"`);
const sendIndex = (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(INDEX_HTML);
};
app.get(['/', '/index.html', '/s/:id'], sendIndex);

// Strudel REPL web component bundle, served locally from node_modules
app.use(
  '/vendor/strudel',
  express.static(path.join(__dirname, 'node_modules/@strudel/repl/dist'), { maxAge: '7d' }),
);
// app files: always revalidate, so a new build is picked up on the next load
app.use(express.static(PUBLIC_DIR, { setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));

// About dialog: version + the changelog (CHANGELOG.md is copied into the image)
const CHANGELOG = (() => {
  try { return fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8'); } catch { return ''; }
})();
const REPO_URL = 'https://github.com/eric256/strudel-ai';
app.get('/api/about', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json({ version: VERSION, build: BUILD, repo: REPO_URL, changelog: CHANGELOG });
});

app.get('/api/version', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ version: VERSION, build: BUILD });
});

app.post('/api/share', (req, res) => {
  const { code, title = '', setlist = null, setText = null, recording = null, song: songIn = null } = req.body || {};
  if (typeof code !== 'string' || !code.trim()) return res.status(400).json({ error: 'no code to share' });
  if (code.length > 200_000 || String(setlist || '').length > 50_000 || String(setText || '').length > 50_000) return res.status(413).json({ error: 'song too large' });
  const rec = cleanRecording(recording);
  if (rec === false) return res.status(400).json({ error: 'invalid recording' });
  if (rec && JSON.stringify(rec).length > 6_000_000) return res.status(413).json({ error: 'recording too large' });
  const fullSong = cleanSong(songIn);
  if (fullSong === false) return res.status(400).json({ error: 'invalid song' });
  if (fullSong && JSON.stringify(fullSong).length > 4_000_000) return res.status(413).json({ error: 'song too large' });
  const id = newShareId();
  const song = {
    id,
    title: String(title).slice(0, 120),
    code,
    setlist: setlist ? String(setlist) : null,
    setText: setText ? String(setText) : null,
    recording: rec,
    song: fullSong,
    created: new Date().toISOString(),
    appVersion: VERSION,
  };
  try {
    fs.writeFileSync(path.join(SHARE_DIR, `${id}.json`), JSON.stringify(song));
  } catch (e) {
    return res.status(500).json({ error: 'could not store song: ' + e.message });
  }
  res.json({ id, path: `/s/${id}` });
});

/**
 * A recording: { v, codes: [string], events: [{ c: cycle, i: index into codes, label }], end }.
 * Returns the cleaned recording, null when there is none, or false when it is malformed.
 */
function cleanRecording(r) {
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
function cleanSong(s) {
  if (s == null) return null;
  if (typeof s !== 'object' || !Array.isArray(s.steps) || !s.steps.length || s.steps.length > 300) return false;
  const steps = [];
  for (const st of s.steps) {
    if (!st || typeof st.code !== 'string' || !st.code.trim() || st.code.length > 200_000) return false;
    const bars = Number(st.bars);
    if (!Number.isFinite(bars) || bars <= 0 || bars > 64) return false;
    const fade = Number(st.fade);
    steps.push({
      bars,
      prompt: String(st.prompt || '').slice(0, 200),
      code: st.code,
      fade: st.fade == null || !Number.isFinite(fade) ? null : Math.max(0, Math.min(8, fade)),
      fillStep: !!st.fillStep,
      section: st.section && typeof st.section === 'object' && JSON.stringify(st.section).length < 5000 ? st.section : null,
    });
  }
  const sheet = s.sheet && typeof s.sheet === 'object' && JSON.stringify(s.sheet).length < 100_000 ? s.sheet : null;
  return {
    title: String(s.title || '').slice(0, 120),
    desc: String(s.desc || '').slice(0, 1000),
    sheet,
    library: typeof s.library === 'string' && s.library.length <= 200_000 ? s.library : null,
    steps,
  };
}

app.get('/api/share/:id', (req, res) => {
  if (!SHARE_ID.test(req.params.id)) return res.status(404).json({ error: 'not found' });
  try {
    res.json(JSON.parse(fs.readFileSync(path.join(SHARE_DIR, `${req.params.id}.json`), 'utf8')));
  } catch {
    res.status(404).json({ error: 'shared song not found' });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// The built-in system prompts, so the settings can show them and users can edit their own copies
const PROMPTS = { code: SYSTEM_PROMPT, setlist: SETLIST_PROMPT, songs: SONGS_PROMPT, sheet: SHEET_PROMPT, library: LIBRARY_PROMPT };
app.get('/api/prompts', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json(PROMPTS);
});

// Public config for the UI (never exposes API keys)
app.get('/api/config', (_req, res) => {
  res.json({
    defaultProvider: DEFAULT_PROVIDER,
    providers: Object.fromEntries(
      Object.entries(PROVIDERS).map(([k, p]) => [
        k,
        { label: p.label, kind: p.kind || 'openai', baseUrl: p.baseUrl, defaultModel: p.model, hasKey: !!p.apiKey, defaultEffort: p.kind === 'anthropic' ? CLAUDE_EFFORT : undefined },
      ]),
    ),
  });
});

// List models from the selected provider
app.get('/api/models', async (req, res) => {
  const p = getProvider(req.query.provider);
  if (p.kind === 'anthropic') return claudeModels(p, res);
  try {
    const r = await fetch(p.baseUrl + p.modelsPath, {
      headers: headersFor(p),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    const list = (j.data || j.models || []).map((m) => ({
      id: m.id || m.model || m.name,
      name: m.name || m.id || m.model,
    }));
    res.json({ models: list.filter((m) => m.id) });
  } catch (e) {
    res.status(502).json({ error: `Could not reach ${p.label} at ${p.baseUrl}: ${e.message}` });
  }
});

// Chat: proxies (and streams) an OpenAI-style chat completion.
// Body: { provider, model, messages:[{role,content}], code, error? }
app.post('/api/chat', async (req, res) => {
  const { provider, model, messages = [], code = '', temperature, mode = 'code', sounds = '', edited = false, systemPrompt = null } = req.body || {};
  const p = getProvider(provider);

  const history = messages.slice(-12).map((m) => ({ role: m.role, content: String(m.content) }));
  // Inject the live editor contents into the latest user turn so the model always edits the real code.
  if (mode === 'songs' || mode === 'sheet' || mode === 'library') {
    // song planning / song sheet / part library: the client sends the full request, no editor code
  } else if (mode === 'setlist' && history.length) {
    const last = history[history.length - 1];
    last.content = `CURRENT CODE (starting point):\n\`\`\`javascript\n${code}\n\`\`\`\n\nSET DESCRIPTION: ${last.content}`;
  } else if (history.length && history[history.length - 1].role === 'user') {
    const last = history[history.length - 1];
    last.content =
      `CURRENT CODE (this is exactly what is in the editor right now — it is the ONLY valid starting point; ` +
      `ignore any code from earlier messages):\n\`\`\`javascript\n${code || '// (empty)'}\n\`\`\`\n\n` +
      (edited
        ? 'NOTE: the performer has edited this code by hand since your last reply. Keep their edits and build on this version.\n\n'
        : '') +
      `REQUEST: ${last.content}\n\n` +
      'Reply with one short sentence, then the COMPLETE updated program in a single ```javascript code block.';
  }

  const body = {
    model: model || p.model || undefined,
    messages: [
      {
        role: 'system',
        content:
          // the user's own version of this prompt (⚙ Settings → Prompts), if any
          (typeof systemPrompt === 'string' && systemPrompt.trim() && systemPrompt.length <= 60_000
            ? systemPrompt
            : PROMPTS[mode] || SYSTEM_PROMPT) +
          (sounds && ['code', 'sheet', 'library'].includes(mode)
            ? '\n\n## AVAILABLE SOUNDS (the complete list loaded right now — use these exact names, never invent, renumber or zero-pad names)\n' +
              String(sounds).slice(0, 16000)
            : ''),
      },
      ...history,
    ],
    stream: true,
    temperature: Number.isFinite(temperature) ? temperature : TEMPERATURE,
    // a whole song sheet / part library is longer than one code edit
    max_tokens: mode === 'sheet' || mode === 'library' ? Math.max(MAX_TOKENS, 4096) : MAX_TOKENS,
  };

  if (p.kind === 'anthropic') {
    return claudeChat(p, { model: model || p.model, system: body.messages[0].content, mode, sounds, history, effort: req.body?.effort }, res);
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  res.on('close', () => ac.abort());

  try {
    const upstream = await fetch(p.baseUrl + p.chatPath, {
      method: 'POST',
      headers: headersFor(p),
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      res.status(502).json({ error: `${p.label} returned ${upstream.status}: ${text.slice(0, 500)}` });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Pass the SSE stream through untouched; the browser parses it.
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch (e) {
    if (!res.headersSent) {
      res.status(502).json({ error: `Could not reach ${p.label} at ${p.baseUrl}: ${e.message}` });
    } else {
      res.end();
    }
  } finally {
    clearTimeout(timer);
  }
});

// ---------------------------------------------------------------------------
// Claude (Anthropic API). The reply is streamed back in the same OpenAI-style SSE
// the browser already parses: text → delta.content, thinking summaries →
// delta.reasoning_content, plus a final usage line. Sampling parameters
// (temperature) don't exist on current Claude models; effort controls how much
// the model thinks before answering ("low" keeps live edits fast).
// ---------------------------------------------------------------------------
const CLAUDE_EFFORTS = ['low', 'medium', 'high'];
const CLAUDE_EFFORT = CLAUDE_EFFORTS.includes(env.ANTHROPIC_EFFORT) ? env.ANTHROPIC_EFFORT : 'low';
const CLAUDE_MAX_TOKENS = Number(env.ANTHROPIC_MAX_TOKENS || 32000); // thinking counts toward this too
const CLAUDE_FALLBACK_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5'];
let claudeClient = null;
const claude = (p) => (claudeClient ||= new Anthropic({ apiKey: p.apiKey, timeout: REQUEST_TIMEOUT_MS }));

function claudeError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Claude rejected the API key — check ANTHROPIC_API_KEY in .env';
  if (e instanceof Anthropic.PermissionDeniedError) return `Claude: this key can't use that model (${e.message})`;
  if (e instanceof Anthropic.NotFoundError) return `Claude: model not found (${e.message})`;
  if (e instanceof Anthropic.RateLimitError) return 'Claude: rate limited — wait a moment and try again';
  if (e instanceof Anthropic.BadRequestError) return `Claude: bad request (${e.message})`;
  if (e instanceof Anthropic.APIError) return `Claude API error ${e.status ?? ''}: ${e.message}`;
  return `Could not reach Claude: ${e.message}`;
}

async function claudeModels(p, res) {
  if (!p.apiKey) return res.status(502).json({ error: 'Claude needs ANTHROPIC_API_KEY in the server .env' });
  try {
    const list = [];
    for await (const m of claude(p).models.list()) list.push({ id: m.id, name: m.display_name || m.id });
    // current Claude models first, the configured default at the top
    list.sort((a, b) => (a.id === p.model ? -1 : b.id === p.model ? 1 : 0));
    res.json({ models: list });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return res.status(502).json({ error: claudeError(e) });
    // the model list is a convenience: fall back to the known current models
    res.json({ models: CLAUDE_FALLBACK_MODELS.map((id) => ({ id, name: id })) });
  }
}

async function claudeChat(p, { model, system, mode, sounds, history, effort }, res) {
  if (!p.apiKey) return res.status(502).json({ error: 'Claude needs ANTHROPIC_API_KEY in the server .env' });
  // the API wants the conversation to start with the user; same-role neighbours are merged by the API
  const messages = history.filter((m) => m.role === 'user' || m.role === 'assistant');
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length) return res.status(400).json({ error: 'nothing to send' });

  const stream = claude(p).beta.messages.stream({
    model,
    max_tokens: CLAUDE_MAX_TOKENS,
    // the system prompt (+ the loaded-sounds list) is long and identical on every
    // request, so cache it: later requests read it at a fraction of the price
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: CLAUDE_EFFORTS.includes(effort) ? effort : CLAUDE_EFFORT },
    // if a request is declined, Anthropic re-runs it on its recommended fallback model
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  res.on('close', () => stream.abort());
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  try {
    for await (const ev of stream) {
      if (ev.type !== 'content_block_delta') continue;
      if (ev.delta.type === 'text_delta') send({ choices: [{ delta: { content: ev.delta.text } }] });
      else if (ev.delta.type === 'thinking_delta') send({ choices: [{ delta: { reasoning_content: ev.delta.thinking } }] });
    }
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') {
      const cat = msg.stop_details?.category;
      send({ error: { message: `Claude declined this request${cat ? ` (${cat})` : ''}. Try rewording it.` } });
    } else {
      const u = msg.usage || {};
      send({
        usage: {
          model: msg.model,
          input: u.input_tokens, output: u.output_tokens,
          cache_read: u.cache_read_input_tokens || 0, cache_write: u.cache_creation_input_tokens || 0,
          stop: msg.stop_reason,
        },
      });
    }
    res.write('data: [DONE]\n\n');
  } catch (e) {
    if (!stream.controller?.signal?.aborted) send({ error: { message: claudeError(e) } });
  } finally {
    res.end();
  }
}

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
