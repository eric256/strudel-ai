// ---------------------------------------------------------------------------
// 🎨 ⚙ Settings → Theme: pick a theme (built-in or your own), edit its colours with a live preview, pick the code
// editor's theme, and import / export themes as files. Editing a built-in theme saves your version as a new theme.
// (The themes and the colour tokens themselves: public/theme.js.)
// ---------------------------------------------------------------------------
import { render } from '../html.js';
import { T } from '../templates/index.js';
import { TOKENS, BUILTIN_THEMES, allThemes, applyTheme, currentThemeId, isPluginTheme, themeFromJSON, themeToJSON, userThemes } from '../theme.js';
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
  const base = allThemes()[id] || BUILTIN_THEMES.dark;
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

export function renderThemeSettings() {
  const current = currentThemeId();
  render(T.themeCards(Object.entries(allThemes()).map(([id, t]) => ({
    id, name: t.name, colors: t.colors, current: id === current, kind: userThemes()[id] ? 'yours' : isPluginTheme(id) ? 'plugin' : 'built-in',
  })), { use: useTheme }), $('themeList'));
  const { id, theme } = editable();
  render(T.themeEditor({
    own: !!id, name: theme.name, editor: theme.editor, editors: EDITOR_THEMES,
    tokens: TOKENS.map(([key, label]) => { const value = theme.colors[key] || ''; return { key, label, value, hex: /^#[0-9a-f]{6}$/i.test(value) ? value : null }; }),
  }, {
    rename: (name) => editTheme({ name }),
    setEditor: (editor) => editTheme({ editor }),
    preview: (key, c) => applyTheme({ ...theme, colors: { ...theme.colors, [key]: c } }),
    setColor: (key, c) => CSS.supports('color', c) && editTheme({ colors: { [key]: c } }),
    exportTheme: () => download(`${slug(theme.name)}.strudel-theme.json`, themeToJSON(theme)),
    importFile: importTheme,
    remove: () => deleteTheme(id),
  }), $('themeEditor'));
}

export function setup() {
  // the code editor exists now: give it the theme's editor colours too
  applyTheme(currentThemeId());
  setTimeout(() => applyTheme(currentThemeId()), 1500);
}
