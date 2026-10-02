// Feature module split out of app.js (see the section comments below).
import { stripThinking } from '../lib/util.js';
import { soundCatalog } from './sound-check.js';
import { promptOverride } from './settings.js';
import { $, clog, load, renderMarkdownLite, scrollChat } from '../app.js';
export let session;
// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

const CODE_LINE = /^\s*(\$:|_\$:|setcp[ms]\(|stack\(|s\(|sound\(|note\(|n\(|chord\(|samples\(|\.|\/\/|\)|let |const )/;

export function extractCode(text) {
  // never treat the history placeholder as code
  const clean = stripThinking(text).replace(/```[a-zA-Z]*\n\s*\/\/ \[older version omitted[^\n]*\n```/g, '');
  // only code fences count — ```song / ```parts / ```pads blocks are handled separately
  const isCode = (lang) => ['', 'javascript', 'js', 'strudel'].includes(lang.toLowerCase());
  const blocks = [...clean.matchAll(/```([\w-]*)[^\n]*\n([\s\S]*?)```/g)]
    .filter((m) => isCode(m[1]))
    .map((m) => m[2].trim())
    .filter(Boolean);
  if (blocks.length) return blocks[blocks.length - 1];
  if ([...clean.matchAll(/```([\w-]*)/g)].some((m) => m[1] && !isCode(m[1]))) return null; // only song / pads blocks
  const open = clean.match(/```(?:javascript|js|strudel)?[^\n]*\n([\s\S]+)$/);
  if (open && open[1].trim()) return open[1].trim();
  const lines = clean.split('\n').filter((l) => l.trim());
  const codeLines = lines.filter((l) => CODE_LINE.test(l));
  if (codeLines.length >= 1 && codeLines.length >= lines.length - 1) {
    return lines.filter((l) => CODE_LINE.test(l) || /^\s/.test(l)).join('\n').trim();
  }
  return null;
}

/** The body of the last ```<lang> block in a reply, or null. */
export function fencedBlock(text, lang) {
  const all = [...stripThinking(text).matchAll(new RegExp('```' + lang + '[^\\n]*\\n([\\s\\S]*?)```', 'g'))];
  return all.length ? all[all.length - 1][1].trim() : null;
}

/** Cheap syntax check ("$:" lines are valid JS labels). Returns error message or null. */
export function syntaxError(code) {
  try { new Function(code); return null; } catch (e) { return e.message; }
}

/**
 * Stream a completion. onUpdate({content, thinking}) is called as tokens arrive.
 * mode: 'code' (edit the given code) | 'songs' | 'sheet' | 'library' (the song writer's steps)
 */
export async function requestLLM({ messages, code = '', mode = 'code', onUpdate, signal, edited = false, label = '', sounds = null, onError = null, fixing = false }) {
  try { return await requestLLMLogged({ messages, code, mode, onUpdate, signal, edited, label, sounds, fixing }); }
  catch (e) { onError?.(e); throw e; }
}
async function requestLLMLogged({ messages, code, mode, onUpdate, signal, edited, label, sounds, fixing }) {
  // session budget (Claude reports usage, so its cost is known): stop before spending more
  const budget = Number(load().aiBudget ?? 2);
  if (budget > 0 && session.cost >= budget) {
    const e = new Error(`session AI budget reached (${money(session.cost)} of ${money(budget)}) — raise it in ⚙ Settings → AI`);
    clog('error', `✗ AI · ${mode}: ${e.message}`);
    throw e;
  }
  sounds ??= await soundCatalog().catch(() => '');
  const lastUser = String(messages[messages.length - 1]?.content || '').split('\n')[0].slice(0, 140);
  const t0 = performance.now();
  const entry = clog('ai', `→ AI · ${mode}${label ? ` · ${label}` : ''} · ${$('model').value || 'default model'}: ${lastUser}`);
  const update = onUpdate;
  onUpdate = (u) => { entry.stream((u.thinking ? `[thinking] ${u.thinking.slice(-600)}\n\n` : '') + u.content); update?.(u); };
  try {
    lastUsage = null;
    const text = await requestLLMRaw({ messages, code, mode, onUpdate, signal, edited, sounds, fixing });
    entry.done(`✓ AI · ${mode}${label ? ` · ${label}` : ''}: ${text.length} chars in ${((performance.now() - t0) / 1000).toFixed(1)}s${usageText(lastUsage)}`, 'ok');
    addSessionCost(lastUsage);
    return text;
  } catch (e) {
    entry.done(`✗ AI · ${mode}${label ? ` · ${label}` : ''}: ${e.name === 'AbortError' ? 'stopped' : e.message}`, e.name === 'AbortError' ? 'info' : 'error');
    throw e;
  }
}

let lastUsage = null; // token usage of the last Claude reply (other providers don't report it)
export const money = (v) => `$${v.toFixed(v < 0.1 ? 3 : 2)}`;
function usageCost(u) {
  const p = u && CLAUDE_PRICES[u.model];
  // 1-hour cache writes cost 2× input
  return p ? (u.input * p[0] + u.output * p[1] + u.cache_read * p[2] + u.cache_write * p[0] * 2) / 1e6 : 0;
}
function addSessionCost(u) {
  if (!u) return;
  session.cost += usageCost(u);
  session.requests++;
  session.tokensIn += (u.input || 0) + (u.cache_read || 0) + (u.cache_write || 0);
  session.tokensOut += u.output || 0;
  try { sessionStorage.setItem('strudel-ai:session', JSON.stringify(session)); } catch {}
}
// $ per million tokens: input, output, cache read, cache write (5 min)
const CLAUDE_PRICES = { 'claude-sonnet-5-5': [2, 10, 0.2, 2.5], 'claude-opus-5-5': [4, 20, 0.2, 5], 'claude-haiku-4-5': [1, 5, 0.1, 1.25] };
function usageText(u) {
  if (!u) return '';
  const cost = CLAUDE_PRICES[u.model] ? usageCost(u) : null;
  return ` · ${u.input + u.cache_read + u.cache_write} in (${u.cache_read} cached) / ${u.output} out` + (cost != null ? ` · ≈${(cost * 100).toFixed(1)}¢` : '');
}

async function requestLLMRaw({ messages, code, mode, onUpdate, signal, edited, sounds, fixing }) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: $('provider').value,
      model: $('model').value,
      messages,
      code,
      mode,
      edited,
      sounds,
      fixing: !!fixing,
      systemPrompt: promptOverride(mode),
      temperature: Number($('temp').value),
      effort: $('claudeEffort').value,
    }),
    signal,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `HTTP ${res.status}`);
  }
  let content = '', thinking = '';
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    const j = await res.json();
    content = j.choices?.[0]?.message?.content || '';
    onUpdate?.({ content, thinking });
    return content;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith('data:')) continue;
      const data = l.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let j;
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
      if (j.usage) { lastUsage = j.usage; continue; }
      const d = j.choices?.[0]?.delta || j.choices?.[0]?.message || {};
      if (d.reasoning_content || d.reasoning) thinking += d.reasoning_content || d.reasoning;
      if (d.content) content += d.content;
    }
    onUpdate?.({ content, thinking });
  }
  return content;
}

/** Render a streaming reply into a chat bubble. */
export function bubbleRenderer(bubble) {
  const contentEl = document.createElement('div');
  contentEl.className = 'typing';
  bubble.appendChild(contentEl);
  let thinkEl = null;
  return {
    update({ content, thinking }) {
      if (thinking) {
        if (!thinkEl) {
          thinkEl = document.createElement('details');
          thinkEl.innerHTML = '<summary>thinking…</summary><div></div>';
          bubble.insertBefore(thinkEl, contentEl);
        }
        thinkEl.querySelector('div').textContent = thinking;
      }
      contentEl.innerHTML = renderMarkdownLite(content);
      scrollChat();
    },
    done() {
      contentEl.classList.remove('typing');
      if (thinkEl) thinkEl.querySelector('summary').textContent = 'reasoning';
    },
  };
}

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  // running AI cost for this browser session (shown in the status bar, checked against the budget)
  session = (() => { try { return JSON.parse(sessionStorage.getItem('strudel-ai:session')) || { cost: 0, requests: 0, tokensIn: 0, tokensOut: 0 }; } catch { return { cost: 0, requests: 0, tokensIn: 0, tokensOut: 0 }; } })();
}
