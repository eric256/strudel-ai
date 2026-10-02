// ⚙ Settings → 🎨 Theme: the theme cards and the colour editor (features/themes.js).
import { html, nothing } from '../html.js';

const SWATCHES = ['bg', 'panel', 'accent', 'accent-2', 'danger', 'warn', 'text'];

/** cards: [{ id, name, colors, current, kind: 'yours' | 'plugin' | 'built-in' }]. act: { use(id) } */
export function themeCards(cards, act) {
  const title = { yours: 'Your theme', plugin: 'From a 🧩 plugin', 'built-in': 'Built-in theme' };
  return html`${cards.map((c) => html`
    <button class="th-card${c.current ? ' on' : ''}" title=${title[c.kind]} @click=${() => act.use(c.id)}>
      <span class="th-swatches">${SWATCHES.map((k) => html`<i style="background:${c.colors?.[k] || 'transparent'}"></i>`)}</span><span class="th-name">${c.name}${c.current ? ' ✓' : ''}</span>
    </button>`)}`;
}

/**
 * The editor for the theme in use.
 * v: { own (it's yours: rename / delete), name, editor, editors: [..], tokens: [{ key, label, value, hex (for the colour picker) | null }] }
 * act: { rename(name), setEditor(name), preview(key, colour), setColor(key, colour), exportTheme(), importFile(file), remove() }
 */
export function themeEditor(v, act) {
  return html`<div class="th-edit">
    <div class="sl-buttons">
      <b>Colours</b>
      ${v.own ? html`<label>name <input .value=${v.name} maxlength="40" @change=${(e) => act.rename(e.target.value.trim() || 'My theme')} /></label>`
        : html`<span class="muted small">a built-in or plugin theme: changing a colour saves your own copy</span>`}
      <span class="spacer"></span>
      <label title="The code editor's colours">editor
        <select @change=${(e) => act.setEditor(e.target.value)}>${v.editors.map((n) => html`<option ?selected=${n === v.editor}>${n}</option>`)}</select></label>
    </div>
    <div class="th-tokens">${v.tokens.map((t) => html`<label class="th-token" title="--${t.key}">
        ${t.hex ? html`<input type="color" .value=${t.hex} @input=${(e) => act.preview(t.key, e.target.value)} @change=${(e) => act.setColor(t.key, e.target.value)} />`
          : html`<input class="th-text" .value=${t.value} @change=${(e) => act.setColor(t.key, e.target.value)} />`}
        <span>${t.label}</span></label>`)}</div>
    <div class="sl-buttons">
      <button title="Download this theme as a file (to share, or to keep)" @click=${act.exportTheme}>⬇ export</button>
      <label class="button-like" title="Load a theme file (.json)">⬆ import <input type="file" accept=".json,application/json" hidden @change=${(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) act.importFile(f); }} /></label>
      <span class="spacer"></span>
      ${v.own ? html`<button class="link" @click=${act.remove}>delete this theme</button>` : nothing}
    </div>
  </div>`;
}
