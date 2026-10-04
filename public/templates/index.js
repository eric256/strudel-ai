// ---------------------------------------------------------------------------
// The HTML templates: every panel's markup lives in public/templates/*.js, away from the code that runs the app.
// A template is a function: plain data (and the actions its buttons call) in, lit-html out. Templates never reach
// into the app's state: the feature modules work out what to show and pass it in.
//
//   import { T } from '../templates/index.js';
//   render(T.playlist(view, actions), $('playlist'));
//
// 🧩 Plugins can replace any template (api.overrideTemplate): an override gets the template it replaces, so it can
// wrap it or ignore it. Panels re-render when a template changes (onTemplatesChange).
// ---------------------------------------------------------------------------
import * as playlist from './playlist.js';
import * as songs from './songs.js';
import * as songEditor from './song-editor.js';
import * as mixer from './mixer.js';
import * as master from './master.js';
import * as pads from './pads.js';
import * as keys from './keys.js';
import * as editors from './editors.js';
import * as themes from './themes.js';
import * as plugins from './plugins.js';
import * as layout from './layout.js';
import * as modes from './modes.js';
import * as partEditor from './part-editor.js';
import * as taste from './taste.js';

/** The built-in templates by name (each name is unique across the files). */
const BUILTIN = {};
for (const mod of [playlist, songs, songEditor, mixer, master, pads, keys, editors, themes, plugins, layout, modes, partEditor, taste]) {
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn !== 'function') continue;
    if (name in BUILTIN) throw new Error(`template "${name}" is defined twice`);
    BUILTIN[name] = fn;
  }
}
/** The templates in use: the built-in ones, with overrides on top (the last override wins). */
const current = { ...BUILTIN };
/** Overrides: name → [{ owner, make }] in the order they were added. */
const overrides = new Map();
const listeners = new Set();

/** The templates. Look them up at render time (T.name(...)), so an override shows on the next render. */
export const T = new Proxy(current, {
  get(target, name) {
    if (!(name in target)) throw new Error(`no template "${String(name)}"`);
    return target[name];
  },
  set() { throw new Error('templates are changed with overrideTemplate()'); },
});

export const templateNames = () => Object.keys(BUILTIN).sort();

/** Rebuild one template from the built-in one and its overrides. A broken override is skipped (and logged). */
function rebuild(name) {
  let fn = BUILTIN[name];
  for (const { owner, make } of overrides.get(name) || []) {
    try {
      const made = make(fn);
      if (typeof made !== 'function') throw new Error('the override must return a template function');
      const inner = fn;
      // an override that throws while rendering falls back to the template underneath it
      fn = (...args) => { try { return made(...args); } catch (e) { console.error(`[template ${name}] the override from ${owner} failed:`, e); return inner(...args); } };
    } catch (e) { console.error(`[template ${name}] the override from ${owner} was skipped:`, e); }
  }
  current[name] = fn;
}
function changed(name) {
  for (const fn of listeners) { try { fn(name); } catch (e) { console.error('[templates listener]', e); } }
}

/**
 * Replace a template. make(original) returns the new template; it can call original(...) to wrap it.
 * Returns a function that takes the override back out.
 */
export function overrideTemplate(name, make, owner = 'an override') {
  if (!(name in BUILTIN)) throw new Error(`no template "${name}" (see templateNames())`);
  const entry = { owner, make };
  overrides.set(name, [...(overrides.get(name) || []), entry]);
  rebuild(name);
  changed(name);
  return () => {
    overrides.set(name, (overrides.get(name) || []).filter((x) => x !== entry));
    rebuild(name);
    changed(name);
  };
}

/** fn(name) runs when a template is overridden or restored: re-render what uses it. */
export function onTemplatesChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
