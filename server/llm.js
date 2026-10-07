// The AI proxy, in web-standard JavaScript only (fetch, Request / Response, streams): it runs in Node (the Express
// server) and on Netlify (functions and edge functions) alike. It builds the chat request (system prompt, the
// editor's code, the loaded sounds), sends it to the chosen provider, and streams the reply back as OpenAI-style
// server-sent events, which the browser parses. Claude is called through its HTTP API directly.
import { SYSTEM_PROMPT, SONGS_PROMPT, SHEET_PROMPT, LIBRARY_PROMPT, TITLE_PROMPT } from '../prompt.js';

export const PROMPTS = { code: SYSTEM_PROMPT, songs: SONGS_PROMPT, sheet: SHEET_PROMPT, library: LIBRARY_PROMPT, title: TITLE_PROMPT };
const trimSlash = (s) => (s || '').replace(/\/+$/, '');

/** The providers, from the environment (all OpenAI-compatible chat APIs, plus Claude). */
export function providersFrom(env = {}) {
  return {
    llamacpp: {
      label: 'llama.cpp', baseUrl: trimSlash(env.LLAMACPP_URL || 'http://host.docker.internal:8080'), apiKey: env.LLAMACPP_API_KEY || '',
      model: env.LLAMACPP_MODEL || '', chatPath: '/v1/chat/completions', modelsPath: '/v1/models',
    },
    // Claude: the key from ANTHROPIC_API_KEY (or a signed-in user's own), never sent to the browser
    anthropic: {
      label: 'Claude', kind: 'anthropic', baseUrl: trimSlash(env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'),
      apiKey: env.ANTHROPIC_API_KEY || '', model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    },
    openwebui: {
      label: 'OpenWebUI', baseUrl: trimSlash(env.OPENWEBUI_URL || 'http://host.docker.internal:3000'), apiKey: env.OPENWEBUI_API_KEY || '',
      model: env.OPENWEBUI_MODEL || '', chatPath: '/api/chat/completions', modelsPath: '/api/models',
    },
  };
}

/** The settings that don't depend on a request. */
export function llmSettings(env = {}) {
  const providers = providersFrom(env);
  const EFFORTS = ['low', 'medium', 'high'];
  return {
    providers,
    defaultProvider: providers[env.DEFAULT_PROVIDER] ? env.DEFAULT_PROVIDER : 'llamacpp',
    temperature: Number(env.LLM_TEMPERATURE ?? 0.7),
    maxTokens: Number(env.LLM_MAX_TOKENS ?? 2048),
    timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 180000),
    efforts: EFFORTS,
    claudeEffort: EFFORTS.includes(env.ANTHROPIC_EFFORT) ? env.ANTHROPIC_EFFORT : 'low',
    claudeMaxTokens: Number(env.ANTHROPIC_MAX_TOKENS || 32000), // thinking counts toward this too
    // a deployment for other people (Netlify) may only offer providers it can reach
    only: String(env.PROVIDERS || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const SSE_HEADERS = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' };
const headersFor = (p) => ({ 'Content-Type': 'application/json', ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}) });

/**
 * The UI's configuration: the providers (never their keys) and whether each can be used. claudeKey: the key this
 * request would use for Claude (a user's own, or the server's), so the UI knows whether Claude is ready.
 */
export function publicConfig(s, { claudeKey = '' } = {}) {
  const entries = Object.entries(s.providers).filter(([k]) => !s.only.length || s.only.includes(k));
  return {
    defaultProvider: s.only.length && !s.only.includes(s.defaultProvider) ? entries[0]?.[0] : s.defaultProvider,
    providers: Object.fromEntries(entries.map(([k, p]) => [k, {
      label: p.label, kind: p.kind || 'openai', baseUrl: p.baseUrl, defaultModel: p.model,
      hasKey: p.kind === 'anthropic' ? !!claudeKey : !!p.apiKey, defaultEffort: p.kind === 'anthropic' ? s.claudeEffort : undefined,
    }])),
  };
}

const CLAUDE_FALLBACK_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5'];
const claudeHeaders = (key, beta) => ({ 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', ...(beta ? { 'anthropic-beta': beta } : {}) });
/** A Claude API error → a sentence for the chat. */
export function claudeError(status, message = '', own = false) {
  const where = own ? 'your API key (⚙ Settings → AI → Account)' : 'ANTHROPIC_API_KEY on the server';
  if (status === 401) return `Claude rejected the API key — check ${where}`;
  if (status === 403) return `Claude: this key can't use that model (${message})`;
  if (status === 404) return `Claude: model not found (${message})`;
  if (status === 429) return 'Claude: rate limited — wait a moment and try again';
  if (status === 400) return `Claude: bad request (${message})`;
  if (status === 529 || status >= 500) return 'Claude is overloaded right now (retried) — try again in a minute';
  return `Could not reach Claude: ${message || status}`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** fetch, retried on rate limits and overloads (like the SDK does) before anything is streamed. */
async function fetchRetry(url, init, tries = 4) {
  let r;
  for (let k = 0; k < tries; k++) {
    r = await fetch(url, init);
    if (![429, 500, 502, 503, 529].includes(r.status) || k === tries - 1) return r;
    await r.body?.cancel?.();
    const wait = Number(r.headers.get('retry-after')) * 1000 || 600 * 2 ** k;
    await sleep(Math.min(wait, 8000));
  }
  return r;
}

/** GET models: the provider's list (Claude: its models, the default first; a short list if it can't say). */
export async function modelsResponse(s, providerName, { claudeKey = '', own = false } = {}) {
  const p = s.providers[providerName] || s.providers[s.defaultProvider];
  if (p.kind === 'anthropic') {
    if (!claudeKey) return json({ error: 'Claude needs an API key: sign in and add yours (⚙ Settings → AI → Account), or set ANTHROPIC_API_KEY on the server' }, 502);
    try {
      const r = await fetch(`${p.baseUrl}/v1/models?limit=100`, { headers: claudeHeaders(claudeKey), signal: AbortSignal.timeout(10000) });
      if (r.status === 401) return json({ error: claudeError(401, '', own) }, 502);
      if (!r.ok) throw new Error(String(r.status));
      const list = ((await r.json()).data || []).map((m) => ({ id: m.id, name: m.display_name || m.id }));
      list.sort((a, b) => (a.id === p.model ? -1 : b.id === p.model ? 1 : 0));
      return json({ models: list.length ? list : CLAUDE_FALLBACK_MODELS.map((id) => ({ id, name: id })) });
    } catch {
      // the model list is a convenience: fall back to the known current models
      return json({ models: CLAUDE_FALLBACK_MODELS.map((id) => ({ id, name: id })) });
    }
  }
  try {
    const r = await fetch(p.baseUrl + p.modelsPath, { headers: headersFor(p), signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    const list = (j.data || j.models || []).map((m) => ({ id: m.id || m.model || m.name, name: m.name || m.id || m.model }));
    return json({ models: list.filter((m) => m.id) });
  } catch (e) {
    return json({ error: `Could not reach ${p.label} at ${p.baseUrl}: ${e.message}` }, 502);
  }
}

/** The chat request the provider gets: the system prompt (yours, plus plugins' and the sounds), the conversation. */
export function chatBody(s, req) {
  const { provider, model, messages = [], code = '', temperature, mode = 'code', sounds = '', edited = false, systemPrompt = null, promptExtra = '', fixing = false } = req || {};
  const p = s.providers[provider] || s.providers[s.defaultProvider];
  const history = (Array.isArray(messages) ? messages : []).slice(-12).map((m) => ({ role: m.role, content: String(m.content) }));
  // the live editor contents go into the latest user turn, so the model always edits the real code
  if (!['songs', 'sheet', 'library', 'title'].includes(mode) && history.length && history[history.length - 1].role === 'user') {
    const last = history[history.length - 1];
    last.content =
      (fixing
        ? 'CODE TO FIX (your previous attempt — it has NOT been applied; fix THIS code, keep everything that works):\n'
        : 'CURRENT CODE (this is exactly what is in the editor right now — it is the ONLY valid starting point; ' +
          'ignore any code from earlier messages):\n') +
      `\`\`\`javascript\n${code || '// (empty)'}\n\`\`\`\n\n` +
      (edited ? 'NOTE: the performer has edited this code by hand since your last reply. Keep their edits and build on this version.\n\n' : '') +
      `REQUEST: ${last.content}\n\n` +
      'Reply with one short sentence, then the COMPLETE updated program in a single ```javascript code block.';
  }
  const system =
    // the user's own version of this prompt (⚙ Settings → Prompts), if any
    (typeof systemPrompt === 'string' && systemPrompt.trim() && systemPrompt.length <= 60_000 ? systemPrompt : PROMPTS[mode] || SYSTEM_PROMPT) +
    // 🧩 plugins' additions to this prompt
    (typeof promptExtra === 'string' && promptExtra.trim() ? '\n\n## ADDITIONAL INSTRUCTIONS\n' + promptExtra.slice(0, 8000) : '') +
    (sounds && ['code', 'sheet', 'library'].includes(mode)
      ? '\n\n## AVAILABLE SOUNDS (the complete list loaded right now — use these exact names, never invent, renumber or zero-pad names)\n' + String(sounds).slice(0, 32000)
      : '');
  return {
    p, mode, history, system,
    openai: {
      model: model || p.model || undefined,
      messages: [{ role: 'system', content: system }, ...history],
      stream: true,
      temperature: Number.isFinite(temperature) ? temperature : s.temperature,
      // a whole song sheet / part library is longer than one code edit
      max_tokens: mode === 'sheet' || mode === 'library' ? Math.max(s.maxTokens, 4096) : s.maxTokens,
    },
    model: model || p.model,
  };
}

/** POST chat: the provider's reply as a stream of OpenAI-style server-sent events (or a JSON error). */
export async function chatResponse(s, req, { claudeKey = '', own = false, signal } = {}) {
  const b = chatBody(s, req);
  if (b.p.kind === 'anthropic') return claudeChat(s, b, { key: claudeKey, own, effort: req?.effort, signal });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), s.timeoutMs);
  signal?.addEventListener?.('abort', () => ac.abort());
  try {
    const upstream = await fetch(b.p.baseUrl + b.p.chatPath, { method: 'POST', headers: headersFor(b.p), body: JSON.stringify(b.openai), signal: ac.signal });
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      clearTimeout(timer);
      return json({ error: `${b.p.label} returned ${upstream.status}: ${text.slice(0, 500)}` }, 502);
    }
    // pass the stream through untouched: the browser parses it
    const body = upstream.body.pipeThrough(new TransformStream({ flush() { clearTimeout(timer); } }));
    return new Response(body, { status: 200, headers: SSE_HEADERS });
  } catch (e) {
    clearTimeout(timer);
    return json({ error: `Could not reach ${b.p.label} at ${b.p.baseUrl}: ${e.message}` }, 502);
  }
}

/** Server-sent events → { event, data } objects. */
async function* sseEvents(stream) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (data) { try { yield JSON.parse(data); } catch {} }
    }
  }
}

/**
 * Claude: the Messages API, streamed, turned into the OpenAI-style events the browser reads — text → delta.content,
 * thinking summaries → delta.reasoning_content, then a usage line. The system prompt is cached (1 hour).
 */
export async function claudeChat(s, b, { key, own = false, effort, signal } = {}) {
  if (!key) return json({ error: 'Claude needs an API key: sign in and add yours (⚙ Settings → AI → Account), or set ANTHROPIC_API_KEY on the server' }, 502);
  // the API wants the conversation to start with the user
  const messages = b.history.filter((m) => m.role === 'user' || m.role === 'assistant');
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length) return json({ error: 'nothing to send' }, 400);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), s.timeoutMs);
  signal?.addEventListener?.('abort', () => ac.abort());
  let upstream;
  try {
    upstream = await fetchRetry(`${b.p.baseUrl}/v1/messages`, {
      method: 'POST', signal: ac.signal,
      // if a request is declined, Anthropic re-runs it on its recommended fallback model
      headers: claudeHeaders(key, 'server-side-fallback-2026-07-01'),
      body: JSON.stringify({
        model: b.model, max_tokens: s.claudeMaxTokens, stream: true,
        system: [{ type: 'text', text: b.system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
        messages,
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: s.efforts.includes(effort) ? effort : s.claudeEffort },
        fallbacks: 'default',
      }),
    });
  } catch (e) {
    clearTimeout(timer);
    return json({ error: claudeError(0, e.message, own) }, 502);
  }
  if (!upstream.ok || !upstream.body) {
    clearTimeout(timer);
    let msg = '';
    try { msg = (await upstream.json())?.error?.message || ''; } catch {}
    return json({ error: claudeError(upstream.status, msg, own) }, 502);
  }
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(ctrl) {
      const send = (obj) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const usage = { model: b.model, input: 0, output: 0, cache_read: 0, cache_write: 0, stop: null };
      let refusal = null;
      try {
        for await (const ev of sseEvents(upstream.body)) {
          if (ev.type === 'message_start') {
            const u = ev.message?.usage || {};
            Object.assign(usage, { model: ev.message?.model || usage.model, input: u.input_tokens || 0, cache_read: u.cache_read_input_tokens || 0, cache_write: u.cache_creation_input_tokens || 0 });
          } else if (ev.type === 'content_block_delta') {
            if (ev.delta?.type === 'text_delta') send({ choices: [{ delta: { content: ev.delta.text } }] });
            else if (ev.delta?.type === 'thinking_delta') send({ choices: [{ delta: { reasoning_content: ev.delta.thinking } }] });
          } else if (ev.type === 'message_delta') {
            if (ev.usage?.output_tokens != null) usage.output = ev.usage.output_tokens;
            if (ev.delta?.stop_reason) usage.stop = ev.delta.stop_reason;
            if (ev.delta?.stop_reason === 'refusal') refusal = ev.delta.stop_details?.category || '';
          } else if (ev.type === 'error') {
            send({ error: { message: claudeError(ev.error?.type === 'overloaded_error' ? 529 : 0, ev.error?.message, own) } });
          }
        }
        if (refusal != null) send({ error: { message: `Claude declined this request${refusal ? ` (${refusal})` : ''}. Try rewording it.` } });
        else send({ usage });
        ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
      } catch (e) {
        if (!ac.signal.aborted) send({ error: { message: claudeError(0, e.message, own) } });
      } finally {
        clearTimeout(timer);
        ctrl.close();
      }
    },
    cancel() { ac.abort(); clearTimeout(timer); },
  });
  return new Response(body, { status: 200, headers: SSE_HEADERS });
}

/** Check a Claude key (when a user saves it): null when it works, else why not. */
export async function checkClaudeKey(s, key) {
  try {
    const r = await fetch(`${s.providers.anthropic.baseUrl}/v1/models?limit=1`, { headers: claudeHeaders(key), signal: AbortSignal.timeout(10000) });
    if (r.status === 401) return 'Anthropic rejected this key';
    if (r.status === 403) return 'this key has no access to the API';
    return null;
  } catch (e) {
    return null; // can't tell (offline): accept it, the first request will say
  }
}
