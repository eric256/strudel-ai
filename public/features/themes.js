// ---------------------------------------------------------------------------
// 🎨 ⚙ Settings → Theme: pick a theme (built-in or your own), edit its colours with a live preview, pick the code
// editor's theme, and import / export themes as files. Editing a built-in theme saves your version as a new theme.
// (The themes and the colour tokens themselves: public/theme.js.)
// ---------------------------------------------------------------------------
import { html, render, nothing } from '../html.js';
import { TOKENS, BUILTIN_THEMES, allThemes, applyTheme, currentThemeId, themeFromJSON, themeToJSON, userThemes } from '../theme.js';
import { $, addMsg, save } from '../app.js';
import { download, slug } from './song-library.js';

/** Strudel's code editor themes (StrudelMirror.setTheme names). */
const EDITOR_THEMES = ['strudelTheme', 'githubDark', 'githubLight', 'vscodeDark', 'vscodeLight', 'dracula', 'tokyoNight', 'tokyoNightStorm', 'tokyoNightDay',
  'nord', 'monokai', 'gruvboxDark', 'gruvboxLight', 'solarizedDark', 'solarizedLight', 'materialDark', 'materialLight', 'atomone', 'aura', 'darcula',
  'duotoneDark', 'sublime', 'noctisLilac', 'androidstudio', 'eclipse', 'xcodeLight', 'bbedit', 'blackscreen', 'whitescreen', 'bluescreen',
  'bluescreenlight', 'teletext', 'greenText', 'redText', 'algoboy', 'archBtw', 'CutiePi', 'sonicPink', 'fruitDaw'];

const saveUserThemes = (themes) => save({ userThemes: themes });
/** Use a theme: apply it now and remember it. */
export function useTheme(id) {
  applyTheme(id);
  save({ theme: id });
  renderThemeSettings();
}

/** The theme being edited: your own theme, or (for a built-in) a copy that becomes yours on the first change. */
function editable() {
  const id = currentThemeId();
  if (userThemes()[id]) return { id, theme: userThemes()[id] };
  const base = BUILTIN_THEMES[id] || BUILTIN_THEMES.dark;
  return { id: null, theme: { ...base, name: `My ${base.name.toLowerCase()}`, colors: { ...base.colors } } };
}
/** Change one thing of the theme being edited (a colour, the editor theme, the name): saved as your theme. */
function editTheme(change) {
  let { id, theme } = editable();
  theme = { ...theme, ...change, colors: { ...theme.colors, ...(change.colors || {}) } };
  const mine = { ...userThemes() };
  if (!id) { id = `user-${Date.now().toString(36)}`; addMsg('info', `🎨 saved your changes as a new theme, “${theme.name}”`); }
  mine[id] = theme;
  saveUserThemes(mine);
  applyTheme(id);
  save({ theme: id });
  renderThemeSettings();
}
function deleteTheme(id) {
  const mine = { ...userThemes() };
  if (!mine[id] || !confirm(`Delete the theme “${mine[id].name}”?`)) return;
  delete mine[id];
  saveUserThemes(mine);
  if (currentThemeId() === id) useTheme('dark'); else renderThemeSettings();
}
async function importTheme(file) {
  try {
    const t = themeFromJSON(await file.text());
    const id = `user-${Date.now().toString(36)}`;
    saveUserThemes({ ...userThemes(), [id]: t });
    useTheme(id);
    addMsg('info', `🎨 imported the theme “${t.name}”`);
  } catch (e) { addMsg('error', `Couldn't import the theme: ${e.message}`); }
}

const swatches = (t) => html`<span class="th-swatches">${['bg', 'panel', 'accent', 'accent-2', 'danger', 'warn', 'text'].map((k) => html`<i style="background:${t.colors?.[k] || 'transparent'}"></i>`)}</span>`;

export function renderThemeSettings() {
  const current = currentThemeId();
  const themes = allThemes();
  render(html`${Object.entries(themes).map(([id, t]) => html`
    <button class="th-card${id === current ? ' on' : ''}" title=${id.startsWith('user-') ? 'Your theme' : 'Built-in theme'} @click=${() => useTheme(id)}>
      ${swatches(t)}<span class="th-name">${t.name}${id === current ? ' ✓' : ''}</span>
    </button>`)}`, $('themeList'));
  const { id, theme } = editable();
  render(html`<div class="th-edit">
    <div class="sl-buttons">
      <b>Colours</b>
      ${id ? html`<label>name <input .value=${theme.name} maxlength="40" @change=${(e) => editTheme({ name: e.target.value.trim() || 'My theme' })} /></label>`
        : html`<span class="muted small">a built-in theme: changing a colour saves your own copy</span>`}
      <span class="spacer"></span>
      <label title="The code editor's colours">editor
        <select @change=${(e) => editTheme({ editor: e.target.value })}>${EDITOR_THEMES.map((n) => html`<option ?selected=${n === theme.editor}>${n}</option>`)}</select></label>
    </div>
    <div class="th-tokens">${TOKENS.map(([k, label]) => {
      const v = theme.colors[k] || '';
      const hex = /^#[0-9a-f]{6}$/i.test(v) ? v : null;
      return html`<label class="th-token" title="--${k}">
        ${hex ? html`<input type="color" .value=${hex} @input=${(e) => applyTheme({ ...theme, colors: { ...theme.colors, [k]: e.target.value } })} @change=${(e) => editTheme({ colors: { [k]: e.target.value } })} />`
          : html`<input class="th-text" .value=${v} @change=${(e) => CSS.supports('color', e.target.value) && editTheme({ colors: { [k]: e.target.value } })} />`}
        <span>${label}</span></label>`;
    })}</div>
    <div class="sl-buttons">
      <button title="Download this theme as a file (to share, or to keep)" @click=${() => download(`${slug(theme.name)}.strudel-theme.json`, themeToJSON(theme))}>⬇ export</button>
      <label class="button-like" title="Load a theme file (.json)">⬆ import <input type="file" accept=".json,application/json" hidden @change=${(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importTheme(f); }} /></label>
      <span class="spacer"></span>
      ${id ? html`<button class="link" @click=${() => deleteTheme(id)}>delete this theme</button>` : nothing}
    </div>
  </div>`, $('themeEditor'));
}

export function setup() {
  // the code editor exists now: give it the theme's editor colours too
  applyTheme(currentThemeId());
  setTimeout(() => applyTheme(currentThemeId()), 1500);
}
