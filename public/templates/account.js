// 👤 Account (⚙ Settings → AI): Google sign-in and your own Anthropic API key, on servers that offer accounts.
// features/account.js fills it; the Google button is drawn into .acc-google by Google's own script.
import { html, nothing } from '../html.js';

/**
 * a: { user: { email, name, picture } | null, key: { hint, here } | null, shared (the server's key works for you),
 *      busy, msg, bad }
 * act: { save(key), remove(), signOut() }
 */
export function accountBox(a, act) {
  if (!a.user) return html`<div class="acc">
      <div class="acc-head"><b>👤 Account</b><span class="muted small">Sign in to use Claude with <b>your own</b> Anthropic API key — it's kept encrypted on this server and never sent back to the browser.</span></div>
      <div class="acc-google"></div>
      ${a.shared ? html`<div class="muted small">This server also lets you use its own Claude key without signing in.</div>` : nothing}
      ${a.msg ? html`<div class="small ${a.bad ? 'acc-bad' : 'muted'}">${a.msg}</div>` : nothing}
    </div>`;
  return html`<div class="acc">
    <div class="acc-head">${a.user.picture ? html`<img class="acc-pic" src=${a.user.picture} alt="" referrerpolicy="no-referrer" />` : nothing}
      <b>${a.user.name || a.user.email}</b><span class="muted small">${a.user.email}</span>
      <button class="link" @click=${act.signOut}>sign out</button></div>
    <div class="acc-key">
      <span class="small">Your Anthropic API key: ${a.key ? html`<code>${a.key.hint}</code> ${a.key.here ? html`<span class="acc-ok">✓ in use</span>` : nothing}` : html`<span class="muted">none yet${a.shared ? ' — using the server\'s key' : ''}</span>`}</span>
      <form @submit=${(e) => { e.preventDefault(); const i = e.target.querySelector('input'); if (i.value.trim()) act.save(i.value.trim()); i.value = ''; }}>
        <input type="password" autocomplete="off" spellcheck="false" placeholder=${a.key ? 'replace it: sk-ant-…' : 'sk-ant-…'} aria-label="Your Anthropic API key" ?disabled=${a.busy} />
        <button ?disabled=${a.busy}>${a.busy ? 'checking…' : 'save key'}</button>
        ${a.key ? html`<button type="button" class="link" ?disabled=${a.busy} @click=${act.remove}>remove</button>` : nothing}
      </form>
      <span class="muted small">Get one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. Your requests are billed to it; the session budget below still applies.</span>
    </div>
    ${a.msg ? html`<div class="small ${a.bad ? 'acc-bad' : 'muted'}">${a.msg}</div>` : nothing}
  </div>`;
}
