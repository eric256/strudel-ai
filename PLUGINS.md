# 🧩 Writing a Strudel AI plugin

A plugin is one JavaScript file (an ES module). It gets an `api` object and adds things to the app through it:
- panels;
- header buttons;
- settings pages;
- themes;
- bands, song forms and stations;
- sounds;
- instructions for the AI.

It can also follow what the player does.

No build step is needed. Write the file, then add it in **⚙ Settings → 🧩 Plugins**.

```js
export default {
  id: 'hello',                 // letters, digits, - and _ (unique)
  name: 'Hello',
  version: '1.0.0',
  description: 'Says hello when a song starts.',

  setup(api) {
    api.on('song', ({ song }) => song && api.message(`now playing “${song.title}”`));
    api.addButton({ icon: '👋', title: 'Say hello', onClick: () => api.message('hello!') });
    // optional: return a function that runs when the plugin is turned off
    return () => {};
  },
};
```

Two examples come with the app. Both are off until you turn them on:
- [`public/plugins/bar-counter.js`](public/plugins/bar-counter.js) adds a panel, a header button, a settings page and its own setting, and redraws with the player's events.
- [`public/plugins/paper-pack.js`](public/plugins/paper-pack.js) adds a theme, a band, a song form, a station and an AI instruction.

## Where plugins come from

| Source | How | Starts |
| --- | --- | --- |
| **Examples** | `public/plugins/*.js`, shipped with the app | off |
| **Server folder** | any `.js` file in `PLUGINS_DIR` (default `./plugins`, `/app/plugins` in Docker; mount a folder there). Reload the page after adding one. | on |
| **This browser** | ⚙ Settings → 🧩 Plugins → **⬆ from a file** or **⬇ from a URL**. The code is kept in this browser; a URL must allow cross-origin requests (CORS). | on |

Switch any plugin on or off in ⚙ Settings → 🧩 Plugins.

When a plugin fails (an error in `setup`, a missing `id`, or an id another plugin already uses):
- it is turned off;
- its error is shown in the list and written to the 🖥 Console, so it ends up in the 🐞 debug log;
- the rest of the app carries on.

An error inside one of its callbacks (an event listener, a button) is logged and doesn't stop anything either.

⚠ **A plugin runs with full access to the page.** It can reach your songs, your settings and the AI. Only add plugins you trust.

## The `api`

Everything a plugin adds through `api` is removed again when the plugin is turned off. The exceptions are bands, forms and stations, which become yours (see below).

### Following the player

| | |
| --- | --- |
| `api.on('section', fn)` | a section starts: `{ step }` (`step.prompt` is its name, `step.song` its song) |
| `api.on('song', fn)` | the song changes: `{ song }` |
| `api.on('transport', fn)` | play / pause / stop: `{ state: 'playing' \| 'paused' \| 'stopped' }` |
| `api.on('songs', fn)` | the playlist or song lists changed |
| `api.on('*', (event, data) => …)` | every event |

`api.app` gives a read-mostly view of the app:

| | |
| --- | --- |
| `queue`, `engine` | the playlist and the section engine |
| `song` | the song playing now |
| `section` | the name of the section playing now |
| `isPlaying()` | whether the music is playing |
| `nowCycle()`, `cps()` | the clock: 1 cycle = 1 bar |
| `beatsPerBar()` | beats in a bar of the song playing |
| `getCode()` | the code in the editor |
| `play(code, label)` | plays code on the next bar line the user chose. It goes through the same checks and fixes as the AI's code. |
| `evaluateCode(code)` | runs code straight away |
| `playSong(song)`, `addToPlaylist(song, { at: 'end' \| 'next' \| 'now' })`, `songFromJSON(json)` | play songs, or put them in the playlist |
| `showPanel(id)` | brings a panel to the front |

### Adding to the page

| | |
| --- | --- |
| `api.addPanel({ id, title, icon, area, render(el), onVisible(shown) })` | A panel in the layout, listed in ▦ Panels. `area` (`'bottom'`, `'right'` or `'left'`) is where it first opens. It keeps its place in the saved layout. Returns `{ el, open(), close() }`. |
| `api.addButton({ icon, label, title, onClick })` | A button in the header. Returns the button. |
| `api.addSettings({ title, icon, render(el) })` | A page in ⚙ Settings. `render` runs each time the page opens. |
| `api.message(text, kind)` | A line in the chat (`kind`: `'info'` or `'error'`). |
| `api.log(…)`, `api.warn(…)` | Writes to the 🖥 Console and the debug log. |

To draw, use the same [lit-html](https://lit.dev/docs/libraries/standalone-templates/) the app uses: `api.html`, `api.svg`, `api.render`, `api.nothing`, `api.repeat`, `api.classMap`, `api.styleMap` and `api.live`. Values are escaped for you.

For colours that follow the user's theme:
- in CSS, use `var(--accent)`, `var(--text)`, `var(--panel)` and so on (the tokens are listed in `public/theme.js`);
- on a canvas, use `api.themeColor('accent')` and `api.themeAlpha('accent', 0.3)`;
- `api.onThemeChange(fn)` tells you when to redraw.

### Content

| | |
| --- | --- |
| `api.addTheme(id, { name, editor, scheme, colors })` | A theme in ⚙ Settings → 🎨 Theme, available while the plugin is on. `colors` uses the same tokens as a theme file; missing ones come from Dark. |
| `api.addBands([{ name, use, master, instruments }])` | Bands. `instruments` takes lines like `bass: gm_acoustic_bass — round upright bass`. |
| `api.addForms([{ name, use, sections }])` | Song forms. `sections` looks like `intro 4, verse 8, chorus 8`. |
| `api.addStations([{ name, theme }])` | Stations. |
| `api.addPromptHint(mode, text)` | Extra instructions added to the AI's system prompt. `mode` is `'code'` (chat edits), `'sheet'` (song sheets), `'library'` (song parts), `'songs'` (inventing songs) or `'*'` (all of them). |
| `await api.addSounds(map, baseUrl)` | Loads samples, like Strudel's `samples()`. `map` is a sample map or a `strudel.json` URL. |

Bands, forms and stations are added to your own lists **once**. After that they're yours to edit or delete, and a deleted one doesn't come back.

### Changing the HTML

Every panel's HTML is a template in [`public/templates/`](public/templates/), and a plugin can replace any of them. `api.overrideTemplate(name, make)` takes:
- the template's **name**, for example `playlistRow`, `songToolbar`, `songView`, `mixerStrip`, `padsGrid` or `layoutMenu` (`api.templateNames()` lists them all);
- a function **`make(original)`** that returns the new template.

The new template gets the same arguments as the original. These are listed in the comment above each template. Calling `original(...)` inside it wraps the built-in one, and leaving it out replaces it.

```js
// put a star in front of every song in the playlist
api.overrideTemplate('playlistRow', (original) => (row, act) => api.html`
  <div class="starred">⭐ ${original(row, act)}</div>`);
```

- **When it shows:** the panels using that template re-render straight away. When the plugin is turned off, the original comes back.
- **More than one plugin:** if several plugins override the same template, each wraps the one before.
- **Errors:** an override that throws while rendering falls back to the template underneath, and the error is logged.
- **What to keep:** keep the `data-…` attributes and classes the comment mentions. The app's click handlers and its hand-updated labels rely on them.

### Storage

`api.storage.get(key, fallback)`, `api.storage.set(key, value)` and `api.storage.remove(key)` keep the plugin's own settings in this browser.
