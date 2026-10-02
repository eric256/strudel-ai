// ---------------------------------------------------------------------------
// 🎨 Themes. A theme is a set of colour tokens (CSS custom properties on <html>) plus the code editor's theme. Every
// colour in style.css and every canvas drawing uses these tokens, so a theme only names its base colours; the soft /
// dim / text shades are mixed from them in style.css (:root).
// Built-in themes are below; your own (⚙ Settings → 🎨 Theme: edit, import, export) are saved in the browser.
// This module is imported early, so the saved theme applies before the panels are drawn.
// ---------------------------------------------------------------------------

/** The base colour tokens every theme sets: [name, label]. */
export const TOKENS = [
  ['bg', 'Background'], ['panel', 'Panels'], ['panel-2', 'Panel headers, inputs'], ['raised', 'Raised boxes'],
  ['sunken', 'Sunken areas (mixer, master)'], ['canvas', 'Meters and graphs'], ['border', 'Borders'], ['line', 'Grid lines'],
  ['text', 'Text'], ['muted', 'Secondary text'], ['faint', 'Faint text, labels'],
  ['accent', 'Accent'], ['accent-2', 'Second accent (playing, ok)'], ['danger', 'Danger (errors, mute, record)'], ['warn', 'Warning (solo, pending)'],
  ['on-accent', 'Text on accent'], ['on-warn', 'Text on warning'], ['shadow', 'Shadows'],
];

export const BUILTIN_THEMES = {
  dark: {
    name: 'Dark', editor: 'strudelTheme', scheme: 'dark',
    colors: { bg: '#0e0f13', panel: '#16181f', 'panel-2': '#1d2029', raised: '#1c1f28', sunken: '#101217', canvas: '#0b0c10', border: '#2a2e3a', line: '#262a36',
      text: '#e6e8ee', muted: '#8b90a0', faint: '#4a5063', accent: '#7c5cff', 'accent-2': '#20d3a6', danger: '#ff5c7a', warn: '#ffd166',
      'on-accent': '#ffffff', 'on-warn': '#222222', shadow: 'rgba(0, 0, 0, .45)' },
  },
  light: {
    name: 'Light', editor: 'githubLight', scheme: 'light',
    colors: { bg: '#eef0f4', panel: '#ffffff', 'panel-2': '#f2f4f8', raised: '#f7f8fb', sunken: '#e8ebf1', canvas: '#f4f6fa', border: '#d4d9e3', line: '#e2e6ee',
      text: '#1b1e27', muted: '#5b6273', faint: '#a2a8b6', accent: '#6747ff', 'accent-2': '#0b9677', danger: '#d92f55', warn: '#c98a00',
      'on-accent': '#ffffff', 'on-warn': '#ffffff', shadow: 'rgba(20, 24, 40, .16)' },
  },
  contrast: {
    name: 'High contrast', editor: 'blackscreen', scheme: 'dark',
    colors: { bg: '#000000', panel: '#0a0a0a', 'panel-2': '#151515', raised: '#1b1b1b', sunken: '#050505', canvas: '#000000', border: '#7a7a7a', line: '#3a3a3a',
      text: '#ffffff', muted: '#d0d0d0', faint: '#949494', accent: '#b794ff', 'accent-2': '#3ff2c3', danger: '#ff5a78', warn: '#ffe066',
      'on-accent': '#000000', 'on-warn': '#000000', shadow: 'rgba(0, 0, 0, .8)' },
  },
  synthwave: {
    name: 'Synthwave', editor: 'dracula', scheme: 'dark',
    colors: { bg: '#140b24', panel: '#1d1033', 'panel-2': '#27163f', raised: '#22133a', sunken: '#10081d', canvas: '#0c0616', border: '#40286a', line: '#2e1c4d',
      text: '#f7e9ff', muted: '#b69bd8', faint: '#6f5696', accent: '#ff3ea5', 'accent-2': '#2de2e6', danger: '#ff5470', warn: '#ffd166',
      'on-accent': '#ffffff', 'on-warn': '#1d1033', shadow: 'rgba(0, 0, 0, .5)' },
  },
  studio: {
    name: 'Studio (warm)', editor: 'gruvboxDark', scheme: 'dark',
    colors: { bg: '#161412', panel: '#1e1b18', 'panel-2': '#27231f', raised: '#23201c', sunken: '#12100e', canvas: '#0e0c0b', border: '#3b352e', line: '#2d2924',
      text: '#efe6db', muted: '#a99d8e', faint: '#6c6258', accent: '#ff8a3d', 'accent-2': '#7fd1a0', danger: '#ff5c5c', warn: '#ffcf5c',
      'on-accent': '#1a1210', 'on-warn': '#1a1210', shadow: 'rgba(0, 0, 0, .45)' },
  },
};

const STORE_KEY = 'strudel-ai:v1';
const stored = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } };

/** Your own themes: { id: { name, editor, scheme, colors } } (saved with the settings). */
export const userThemes = () => stored().userThemes || {};
/** Themes added by 🧩 plugins (while they're on). */
const pluginThemes = {};
export const allThemes = () => ({ ...BUILTIN_THEMES, ...pluginThemes, ...userThemes() });
export const isPluginTheme = (id) => id in pluginThemes;
/** Add a theme (a 🧩 plugin's). If it's the saved theme, it applies now. */
export function registerTheme(id, theme) {
  pluginThemes[id] = { ...theme, colors: { ...BUILTIN_THEMES.dark.colors, ...(theme.colors || {}) } };
  if (stored().theme === id) applyTheme(id);
}
export function unregisterTheme(id) {
  delete pluginThemes[id];
  if (currentThemeId() === id) applyTheme('dark');
}
export const currentThemeId = () => document.documentElement.dataset.theme || 'dark';
export const currentTheme = () => allThemes()[currentThemeId()] || BUILTIN_THEMES.dark;

const listeners = new Set();
/** Call fn(theme) whenever the theme changes (canvases redraw with the new colours). */
export const onThemeChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** Apply a theme (by id, or a theme object for a live preview). Missing colours fall back to the dark theme's. */
export function applyTheme(idOrTheme = 'dark', { editor = null } = {}) {
  const t = typeof idOrTheme === 'string' ? allThemes()[idOrTheme] || BUILTIN_THEMES.dark : idOrTheme;
  const root = document.documentElement;
  if (typeof idOrTheme === 'string') root.dataset.theme = allThemes()[idOrTheme] ? idOrTheme : 'dark';
  for (const [k] of TOKENS) root.style.setProperty(`--${k}`, t.colors?.[k] || BUILTIN_THEMES.dark.colors[k]);
  root.style.colorScheme = t.scheme || 'dark'; // native controls (scrollbars, date pickers) follow
  colorCache.clear();
  try { (editor || globalThis.document.querySelector('strudel-editor')?.editor)?.setTheme?.(t.editor || 'strudelTheme'); } catch {}
  for (const fn of listeners) { try { fn(t); } catch (e) { console.error('[theme listener]', e); } }
  return t;
}

// --- token colours for canvas drawing ---------------------------------------
const colorCache = new Map();
let probe = null;
/** A token's colour as the browser resolves it ("rgb(…)"): works for mixed shades too. */
export function themeColor(token) {
  const key = token.startsWith('--') ? token : `--${token}`;
  if (colorCache.has(key)) return colorCache.get(key);
  if (!probe) { probe = document.createElement('span'); probe.style.display = 'none'; document.body.appendChild(probe); }
  probe.style.color = `var(${key})`;
  const c = toRGB(getComputedStyle(probe).color) || '#888';
  colorCache.set(key, c);
  return c;
}
/** Mixed shades resolve as "color(srgb r g b / a)" (0–1): canvases and themeAlpha get plain rgb()/rgba(). */
function toRGB(c) {
  const m = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/.exec(c || '');
  if (!m) return c;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => Math.round(Math.min(1, Math.max(0, Number(v))) * 255));
  return m[4] != null && Number(m[4]) < 1 ? `rgba(${r}, ${g}, ${b}, ${Number(m[4])})` : `rgb(${r}, ${g}, ${b})`;
}
/** The same colour with an opacity, for canvas fills. */
export function themeAlpha(token, a) {
  const m = themeColor(token).match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})` : themeColor(token);
}

/** A theme as a file (JSON) — and back. Throws on something that isn't a theme. */
export const themeToJSON = (t) => JSON.stringify({ format: 'strudel-ai-theme', name: t.name, editor: t.editor, scheme: t.scheme, colors: t.colors }, null, 1);
export function themeFromJSON(text) {
  const j = typeof text === 'string' ? JSON.parse(text) : text;
  if (!j || typeof j.colors !== 'object') throw new Error('not a theme (no "colors")');
  const colors = {};
  for (const [k] of TOKENS) if (typeof j.colors[k] === 'string' && CSS.supports('color', j.colors[k])) colors[k] = j.colors[k];
  if (!Object.keys(colors).length) throw new Error('the theme has no usable colours');
  return { name: String(j.name || 'My theme').slice(0, 40), editor: String(j.editor || 'strudelTheme'), scheme: j.scheme === 'light' ? 'light' : 'dark', colors: { ...BUILTIN_THEMES.dark.colors, ...colors } };
}

// the saved theme, right away (before anything is drawn)
if (typeof document !== 'undefined') applyTheme(stored().theme || 'dark');
