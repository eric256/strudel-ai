// ⚙ Settings → 🧩 Plugins: the plugin list and the install row (features/plugins.js).
import { html, live, nothing, repeat } from '../html.js';

/**
 * v: { plugins: [{ src, name, version, kind: 'example' | 'server folder' | 'this browser', description, on, error, removable }], url }
 * act: { toggle(src, on), remove(src), installFile(file), setUrl(text), installUrl() }
 */
export function pluginList(v, act) {
  return html`
    <div class="plugin-list">
      ${v.plugins.length ? nothing : html`<p class="muted small">No plugins yet.</p>`}
      ${repeat(v.plugins, (p) => p.src, (p) => html`
        <div class="plugin-card${p.on ? ' on' : ''}${p.error ? ' bad' : ''}" data-src=${p.src}>
          <label class="plugin-switch" title=${p.on ? 'Turn it off' : 'Turn it on'}>
            <input type="checkbox" .checked=${live(p.on)} @change=${(e) => act.toggle(p.src, e.target.checked)} />
            <b>${p.name}</b></label>
          ${p.version ? html`<span class="muted small">v${p.version}</span>` : nothing}
          <span class="tag">${p.kind}</span>
          <span class="spacer"></span>
          ${p.removable ? html`<button class="link" @click=${() => act.remove(p.src)}>remove</button>` : nothing}
          ${p.description ? html`<div class="muted small plugin-desc">${p.description}</div>` : nothing}
          ${p.error ? html`<div class="plugin-err small">✗ ${p.error}</div>` : nothing}
        </div>`)}
    </div>
    <div class="plugin-install">
      <b>Install</b>
      <label class="button-like" title="A plugin's .js file">⬆ from a file
        <input type="file" accept=".js,.mjs,text/javascript" hidden @change=${(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) act.installFile(f); }} /></label>
      <input class="plugin-url" placeholder="https://…/my-plugin.js" .value=${live(v.url)} @input=${(e) => act.setUrl(e.target.value)} />
      <button @click=${act.installUrl}>⬇ from a URL</button>
    </div>
    <p class="plugin-warn small">⚠ A plugin runs with full access to this page: what you hear, your songs and your settings. Only install plugins you trust.</p>`;
}
