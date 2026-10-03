# Changelog

The version is in `package.json`. Bump it when you release. Open pages also notice *any* redeploy through the build id, which is a hash of the app files, even if the version wasn't bumped.

## 1.46.0
- **Genres rebuilt so everything fits together.** Trance songs kept getting the drum & bass band: no band was meant for trance, and a loose word match ("rolling … **bass**") won.
  - **19 genres** (`lib/genres.js`), each with the words that name it in a description (trance: trance, uplifting, psytrance, supersaw, euphoric …).
  - **Every form and band lists its genres** (a new **Genres** field in their editors), and every genre has at least two forms and two bands.
  - **Planning finds the description's genre first**, then picks one of that genre's forms and bands. Loose matching on the *use for* text is only the fallback.
  - **New forms:** trance anthem, psy journey, synthwave night, funk groove, disco, rock song, cinematic suite, dub riddim, chip quest, downtempo, bossa, latin jam and hip hop cypher.
  - **New bands:** trance rig, psy rig, festival stack, future bass kit, indie band, city pop band, funk band, disco orchestra, drone choir, film strings, roots reggae band, game boy, trip hop collective, lounge duo, bossa trio and latin jazz group.
  - Saved built-ins get their genres; your own forms and bands are matched by their *use for* text until you give them genres.
- **The melody is always heard, and it belongs with the hook:**
  - The AI writes the hook from a fragment of the melody (its rhythm cell or most memorable notes), and ends the melody on a note that leads into the hook.
  - The app makes sure one part plays the hook and one plays the melody (♪ in Now playing). If no part does, a *theme* part on the band's melody instrument joins the verses. Those parts are told to play their tune exactly.
  - 🎶 Now playing shows the melody next to the hook. The ✎ song editor edits both, and the parts' code follows.
- **Tests:** every genre has two forms and two bands; descriptions find their genre (trance → trance forms and bands); hook and melody parts are assigned, including adding a theme part (41 unit tests).

## 1.45.0
- **Song creation follows a plan.** Before the AI writes a song, the app decides:
  - **Form and band:** your picks, or ones that fit the description's genre. The app chooses at random among the close matches, so songs of one genre vary; nothing that only mentions the genre in passing is picked.
  - **Meter and key:** ones the form and band both allow. A meter or key named in the description wins.

  The AI writes the song inside that plan (🧭 in the 🖥 Console shows it).
- **Forms and bands carry more:**
  - Every form and band has the **meters** and **keys** it suits (the usual meter first).
  - Bands have **their own sound**: tweaks of their master style, e.g. the fusion band's brighter, wider mix. These become the song's master settings.
  - A band's instruments can be **optional** (a line starting with `+`). The core ones always play; optional ones are used when they suit the song, and the AI may add 1–2 parts of its own.
  - All of these are editable in ⚙ Settings → 🎼 Song forms / 🎸 Bands. Your saved built-ins get the new fields.
- **More forms and bands per genre:**
  - **Forms:** techno journey, techno tool, house extended, edm festival, dnb roller, beat tape, lo-fi loop, jazz ballad and city pop.
  - **Bands:** acid box, deep house quartet, chillhop crew, boom bap crate, darkwave rig and jungle crew.
- **Melody and hook:** the sheet has a main **melody** for the verses or theme as well as the chorus's **hook**, and a theme / melody part plays it.
- **Fills, reconsidered:**
  - A drum fill leads into choruses, drops and solos only (not into every change).
  - A song may have several fills of different kinds (`fill`, `fill2`, `fill3`: a snare roll, a tom run, a hat build, a stop), and they take turns.
  - Other changes are smoothed instead: parts drop out or come in halfway, the volume steps gradually, and half-time or alternate variants bridge sparse and full sections.
- **Tests:** unit tests for planning (genre matching and variety, your picks, the description, nothing fitting), every built-in form and band having real meters and keys, optional instruments, band tweaks and fills taking turns.

## 1.44.1
- **🌀 Hydra draws again.** Strudel's `H("<4 5 6>")` gave Hydra the pattern's text instead of a number, so every frame turned into NaN and the visuals were blank (the debug log showed "function does not return a number" on every frame).
  - Hydra now gets its own `H()`, which reads the pattern as mini-notation at the playing cycle and always returns a number.
  - **The presets move with the music:** a new `L()` returns how loud the mix is (0…1). Kaleidoscope, tunnel, waves, cells and feedback breathe with the volume. They no longer lean on `s0`, Strudel's own drawing, which is mostly empty now that the inline visuals are gone.
  - The ✎ code help names `L()` and `H()`.
- **Smoke test:** `H()` and `L()` return numbers.

## 1.44.0
- **New presets:**
  - **Stations:** 📻 *Blue Note Club* (small-combo jazz), *Tokyo Fusion* (80s Japanese jazz fusion and city pop) and *Pop Radio*.
  - **Bands:** fusion band (slap bass, FM electric piano, soprano-sax lead, synth brass), big band, jazz trio and pop studio.
  - **Song forms:** jazz head & solos, fusion and pop anthem.
- **Song forms are guides, not templates:** the AI keeps a form's shape but varies its section lengths (2, 4, 8, 12 or 16 bars) and may add, drop or repeat a section, so two techno tracks no longer both go 8 · 8 · 8 · 8. The app no longer rewrites the bar counts; it only caps sections at 16 bars and choruses at 4.
- **Dynamics:**
  - **Section volume:** intros and breakdowns softer, the last chorus loudest; the output follows it smoothly.
  - **Solo sections:** one part takes the lead with its *solo* variant, brought forward while the others step back.
  - **Endings:** a song fades out over its last section (most songs), or stops hard with a bar of silence before the next song.
  - **Key and tempo changes** are now encouraged where the genre does them: a lifted last chorus, jazz and fusion key changes, live-band tempo pushes.
- **More fills:** a one-bar drum fill now joins any two different kinds of section (into a chorus, back to a verse, into the bridge or the solo), not just choruses and drops.
- **More varied song titles:** the AI is given the titles already used and steered away from clichés (neon, midnight, echo, dreams …) towards places, times, names, phrases and fitting foreign words.
- **Song editor:** each section's volume and solo part, and the song's ending (fade out or stop with silence).
- **Tests:** unit tests for section volume, solos, endings and the new fills. A new smoke step checks that a solo brings its part forward and that a hard ending leaves a bar of silence.

## 1.43.0
- **A new song editor (✎ Edit song)** replaces the text boxes. You edit a draft and **✓ apply** it; if the song is playing, the section playing now changes from the next bar.
  - **Sections timeline:** each section is sized by its bars. Click one to edit its name, bars, chords, key change and tempo. Move it (← → or drag), duplicate it, delete it or add one, and while the song plays, **⏭ go** there or **🔁 loop** it while you work.
  - **Arrangement grid** (parts × sections): click a cell to cycle off → main → the part's variants; right-click it for comes in / drops out / alternates.
  - **Chord progressions:** rename, edit, add and delete them.
  - **Parts:** name, role, sound and variants, plus each variant's code in its own box. **✨ ask the AI** about a part, and **＋ part** adds one with starter code for its role.
  - **↺ revert** throws your changes away.
- **🎼 Studio** puts the song editor in the big space under the code, tabbed with the Mixer and Master. A Studio layout saved by 1.42 is reset to this once.
- **Edits follow the song:** a song played again is a copy, and editing either one now updates them all, including the one playing.
- `lib/library.js`: splits the parts code into one block per part and variant, joins it back, renames parts and writes starter code. It has unit tests.
- **Smoke test:** the song editor changes the master, section bars and an arrangement cell, adds a section and a part, and applies it live.

## 1.42.0
- **Three modes**, picked in the header:
  - **📻 Radio:** stations and the playlist write songs for you, and you play along on the pads, mixer and master.
  - **🎼 Studio:** work on one song with the AI.
  - **⌨ Jam:** live-code one piece of code with the AI, with no songs.
- **What changes with the mode:**
  - **Music:** switching stops all of it.
  - **Layout:** each mode has its own, saved separately. Your current layout becomes Radio's.
  - **Chat targets:** each mode offers its own, and remembers which one you picked. Jam only has *code in the editor* and *pads*.
  - **Code:** Jam keeps its own, saved as you type.
- **Mixer in Jam:** only the parts in the code get a channel, and deleting a part removes its channel. Radio and Studio keep a channel for every part of the song.
- Coming next:
  - Studio's song bench, where the song loops while you work on it;
  - **🎼 Open in Studio** on any song;
  - a new song editor;
  - promoting a jam to a song, and a song to a band or station.
- **Smoke test:** switch Radio → Jam → Studio → Radio and check the music stops; check each mode's layout, chat targets and code, and the Jam mixer (29 steps).

## 1.41.0
- **⬇ MP3 from the 📃 Playlist:** a song's recording is ready the moment it has played to its end, which is when the next song starts and 🎶 Now playing has already moved on.
  - Songs that played (and the one playing) now keep their buttons in the Playlist: **⬇ MP3** (highlighted once the recording is ready), ☆ favorite, 📁 save, ⬇ JSON and 🔗 link (📋 copy once it exists).
  - A song queued again also gives its recording to its entry in 🎵 Songs.
- **🌀 Hydra works again**, in its own panel. Its canvas used to sit behind the whole page, where the panels covered it.
  - **show:** **in this panel** (float it, pop it out or pin it on top), or **behind the code** (the code area turns see-through).
  - **🌀 Hydra ↗** in the visualizer bar opens it.
- **Floating panels:** every panel header has buttons that act on the panel showing in that group:
  - **⧉** float it over the layout, and **⇲** dock it back;
  - **↗** open it in its own browser window;
  - **📌** always on top: a small Picture-in-Picture window that stays above other windows (Chrome and Edge);
  - **⛶** maximise.
- **⚙ Settings is a large window** with the tabs down the left and a page that scrolls. Drag its corner to resize it; the size is remembered. On narrow screens the tabs go back on top.
- **Inline part visuals removed:** the punchcard, piano roll, spiral and other visuals under each part of a song's sections are gone, along with their setting. Older saved and shared songs drop them when they play.
- **Smoke test:** Hydra in its panel and behind the code; float and dock a panel; the Playlist's buttons for played songs (28 steps).

## 1.40.0
- **HTML templates in their own folder:** every panel's HTML is now in `public/templates/`, separate from the code. There is one file per panel: playlist, songs and Now playing, ✎ Edit song, mixer, master, pads, keys, the settings editors, themes, plugins and ▦ Panels.
  - **How they work:** each template is a function that gets plain data and actions and returns the markup. The comment above it lists what it gets.
  - **Editing:** change the look (markup, classes, labels, tooltips) without touching the code.
  - **Behind it:** the feature modules now work out what to show and pass it in. Templates import nothing from the app, and a test makes sure of it.
- **🧩 Plugins can change the HTML:** `api.overrideTemplate(name, (original) => newTemplate)` replaces any template, or wraps the original. The panels re-render straight away, and the original comes back when the plugin is turned off. An override that fails falls back to the original. `api.templateNames()` lists the templates.
- **Tests:**
  - every template the app uses exists, and templates stay markup-only;
  - smoke test: a plugin's template override shows in the 📃 Playlist and goes away when the plugin is removed.

## 1.39.0
- **🧩 Plugins (step 3 of templates → themes → plugins):** add to the app with small JavaScript files. Manage them in ⚙ Settings → 🧩 Plugins.
  - **What a plugin can add:** panels (they keep their place in the layout), header buttons, ⚙ Settings pages, themes, bands, song forms, stations, sounds and instructions for the AI. It can also follow the player's events (section, song, play / pause / stop).
  - **Where plugins come from:** the examples that come with the app, the server's `plugins/` folder (`PLUGINS_DIR`, `/app/plugins` in Docker), or installed in this browser from a file or a URL.
  - **Safe to try:** turning a plugin off removes what it added. A plugin that fails is turned off, its error is shown and goes to the 🐞 debug log, and the app carries on.
  - **Examples:** ⏱ **Bar counter** (a bar · beat panel, a header button, a settings page) and **Paper pack** (a light theme, a chamber-pop band, a song form, a station and an AI instruction). Both are off until you turn them on.
  - **How to write one:** [PLUGINS.md](PLUGINS.md).
- The 🐞 debug log lists the plugins and their errors.
- **Smoke test:** turn the examples on (panel, button, settings page, theme, band, AI instruction), turn them off, and install a broken plugin and a working one (26 steps).

## 1.38.0
- **🎨 Themes (step 2 of templates → themes → plugins):** ⚙ Settings → 🎨 Theme.
  - **Built-in themes:** Dark (the old look), Light, High contrast, Synthwave and Studio (warm). Each also picks a matching code editor theme.
  - **Your own themes:** change any colour with a live preview, or the code editor's theme. Editing a built-in theme saves your copy. Rename or delete your themes.
  - **⬇ export / ⬆ import** a theme as a `.strudel-theme.json` file.
  - **Colour tokens:** every colour in `style.css` is now one of 18 theme tokens (`--bg`, `--panel`, `--accent`, `--danger` …), with softer shades mixed from them. The panel layout (dockview) and the canvas drawings (mixer meters, Master graphs, visualizer, hum) follow the theme too.
  - The theme is saved with your settings and applies before the page is drawn.
- **Smoke test:** pick a theme, edit it into your own, export and import it (25 steps).

## 1.37.0
- **HTML templates (step 1 of templates → themes → plugins):** the panels are now built with [lit-html](https://lit.dev/docs/libraries/standalone-templates/) templates (`public/html.js`, served locally, no build step) instead of HTML strings.
  - **Converted:** 📃 Playlist, 🎵 Songs (This session, ★ Favorites, 📁 My songs), 🎶 Now playing, ✎ Edit song, 📻 Station, 🎚 Mixer, 🎛 Master, 🔲 Pads, 🎹 Keys, the form, band and station editors, the AI model pickers and the ▦ Panels menu.
  - **Automatic escaping:** a song title (or any text) can never turn into HTML. The hand-written escaping is gone from these panels.
  - **Steadier panels:** a re-render only changes what changed. A section you open in Now playing stays open while the song plays, a mixer strip keeps its meters as parts come and go, and the keyboard keeps its keys.
  - Still written as HTML: the chat's formatted replies, the About changelog, the session restore and the M / S buttons beside the code lines.
- **Smoke test:** a song title containing HTML shows as text and never runs, and an opened section stays open while the view updates (24 steps).

## 1.36.0
- **📃 Playlist:** every song now plays from one playlist. It's a new panel next to Chat / Songs / Station, showing what played, what's playing (with its section) and what's coming up.
  - **Upcoming songs:** ▶ play now, ⤴ play next, ↑ ↓ move, ✕ remove, ↻ rewrite a failed one.
  - **Played songs:** ↺ queues one again.
  - **clear upcoming** empties the queue; **🔁 loop** moved here.
  - The playlist writes ahead while it plays.
- **Adding songs from your lists:** every written song in 🎵 This session, ★ Favorites and 📁 My songs has **⤴ Play next** and **＋ Playlist** next to **▶ Play**. ▶ Play now plays the song without throwing away what was coming up, and ✨ new song from the chat plays next.
- **📻 The station feeds the playlist:**
  - **Start** no longer stops the song that's playing or clears what's queued, even when none of its songs are ready. Its songs are added to the end and written in the background while the queued ones play.
  - **■ Stop** only stops it adding songs: the ones it already wrote stay and play.
  - **Switching:** pick another station and press **📻 Switch to this station**, and its songs follow the ones already queued.
  - **keep ahead** sets how many songs it keeps coming up.
- A shared 🔗 link opens the song in 🎵 This session, ready to play.
- **Smoke test:**
  - a station starting while a song plays doesn't interrupt it;
  - its songs are written in the background;
  - switching stations works;
  - ■ Stop keeps the written songs and the music;
  - ＋ Playlist, move and remove work.

## 1.35.0
- **Refactor, part 4: features in their own modules.** `app.js` went from about 5,900 to 1,700 lines. The features now live in 24 modules in `public/features/`:
  - **AI and chat:** the AI client, chat, sound checks;
  - **songs:** writer, lists, library, editor, song pads, forms, bands, stations, part visuals;
  - **panels and tools:** mixer, line M / S buttons, master, visualizer, Hydra, keys, pads, hum, MP3, settings, share / updates, debug log.

  Each module imports what it uses, and its start-up code runs in `setup()` at the same point as before, so the app starts up in the same order. The page now loads a small `main.js` that loads `app.js`. Nothing changes for users.
- **Smoke test:** now also covers every panel opening, the keys, a pad, Hydra, 📁 My songs, a 🔗 share link opening in a new tab, ⏺ MP3 and the 📻 Station. That is 22 steps.

## 1.34.0
- **Refactor, part 3: one way to write a song.** The old block-by-block writer is gone, and every new song comes from the song-sheet engine.
  - **If a song can't be written:** after the usual tries (3 for the sheet, 3 for the parts), the song is started over once from a fresh sheet.
  - **If that fails too:** the song is marked ✗ with the reason, the set or station moves on, and **↻ Try again** in its row writes it from scratch and plays it next.
  - No more songs whose sections show AI instruction text instead of instruments.
  - **Older songs keep working:** songs saved in the block format still load, play and repair a failing section.
  - The "Blocks" prompt is gone from ⚙ Settings → 📝 Prompts.
- **Fixed:** a song that failed kept showing "✎ writing the song sheet…".
- **Smoke test:** a song whose sheet keeps failing gets ✗ and ↻ Try again, and is never written block by block. An old block-format song still loads and plays.

## 1.33.0
- **Refactor, part 2: the player announces what happens.** Sections starting, songs changing, play / pause / resume / stop and changes to the song lists are now events. The panels update the moment something happens, instead of each checking on its own timer (every 100–300 ms before).
  - **The switch is marked on time:** the app marks a section as playing exactly when it starts (it used to notice up to 100 ms later). The highlight, transport line, mixer and master's *follow song* change right on the bar line.
  - **Smooth progress bars:** they move every frame while music plays, and rest when it's stopped. No more stale or blinking bars.
  - **Lighter:** the song lists, transport, mixer and master now check only once a second as a safety net.
  - **Clearer code:** the two player objects are renamed after what they are, `engine` (sections) and `queue` (songs). The old names still work in `window.strudelAI`.
- The browser smoke test also checks that sections switch on time with Now playing following, pause / resume, and ⏭ next / ⏮ previous song.

## 1.32.0
- **Refactor, part 1:** the song engine's logic moved out of `app.js` into small modules in `public/lib/`: music theory, scale names, labels, forms, bands, song sheets and arranging. They have no DOM and no app state, so they are unit-tested in Node (`test/song.test.mjs`, 15 new tests). Nothing changes for users.
- **Browser smoke test** (`npm run smoke`, also in CI): starts the app with a mock AI and checks, in Chromium:
  - chat, writing a new song with a band, and playback;
  - Now playing, the mixer, the master chain and ✎ Edit song;
  - the settings editors, stop, and that no page errors occur.
- **🐞 Debug log:** 🖥 Console → **⬇ debug log** saves a text file to send back for fixes. It holds every error and warning (counted in a summary), what the app and song were doing, the song's sheet and code, the editor code, the recent chat and the full log since the page opened. That includes uncaught errors, failed promises, `console.error` / `console.warn` and Strudel's errors, which the panel didn't show before.
- **Fixed:** in ✎ Edit song (and in chat edits), sections were cut to 16 bars and choruses to 4, even though the editor allows up to 32. Your own edits now keep their lengths. The limits still apply to songs the AI writes.
- **Hygiene:**
  - Settings are read from browser storage once and kept in memory, and still stay in sync with other tabs and backup restores.
  - `hydra-synth` is now a declared dependency.
  - The update notice also notices changes to files in subfolders.
  - Unused code was removed.

## 1.31.2
- **Favicon:** the browser tab, bookmarks and popped-out panels show the app's icon, three mixer faders in the purple-to-teal accent. It comes as an SVG with PNG fallbacks (32 px, plus 180 px for the iOS home screen) and a web manifest, so the app can be installed with its own icon.

## 1.31.1
- **The window no longer scrolls away:** the page is a fixed frame. Focusing a text box, or the editor bringing its cursor into view, could scroll the whole window and push everything off the top. The page and the workspace can no longer scroll; only the panels inside them do.

## 1.31.0
- **🎛 Master styles:** every song now has a mastering style on the whole mix: clean, lo-fi, warm, pop, techno, house, edm, dnb, hiphop, synthwave, ambient, dub, cinematic, rock, chiptune or radio. The songwriter picks it (or takes the band's), it shows in the song's details, and ✎ Edit song and the chat can change it.
  - The chain: 3-band EQ, DJ filter, drive, bit crush, vinyl noise, reverb, tempo-synced echo, stereo width, glue compressor and a limiter.
- **🎛 Master panel:** plays the master style live, like a mixer. It has 16 controls, a style picker, *follow song* (glides to each song's style when it starts), 💾 save to song, ↺ style, bypass, a spectrum, an output meter and gain reduction.
- **🎸 Bands:** 13 built-in line-ups (instruments by role plus a master style), editable in ⚙ Settings → 🎸 Bands.
  - Pick one for new songs in Songs or Station, or leave it on *auto* and the AI picks the band that fits the genre.
  - The sheet is held to the band: each part takes the band's sound for its role.
- **Sound guide:** the song-sheet request now describes the useful sounds (role · character · genres), so the AI picks sounds that suit the genre and each other.
- Fixed a rare "Cannot access 'setlist' before initialization" error while the page loads.

## 1.30.1
- **Fewer songs written block by block:**
  - When the AI's part library is missing some parts, it's asked for just those, which are added to what it wrote, instead of rewriting everything.
  - The song sheet and the parts each get one more try (3).
  - Parts written as labels (`bass_main: …`) are taken as consts.
- **Block-written songs show their instruments:** if a song still falls back, each section in 🎶 Now playing shows its tempo and its instruments (the labelled parts in its code), with a short name instead of the AI's instruction text. The full instruction is in the tooltip.

## 1.30.0
- **Readable song code:** lines are wrapped to about 150 characters (sliders count for their width).
  - Method chains break before a method, indented two spaces.
  - Long `stack(…)` calls put one argument per line, with the chain continuing from the closing bracket.
  - Strings, mini-notation and comments are never broken.
  - This applies to parts code, every section and chat code. Part visuals go at the end of each part, even when it's wrapped.
- **The transport is also at the top left of the code:** ⏮ ▶ ⏸ ■ ⏭ and the "what's playing" line, mirroring 🎶 Now playing.

## 1.29.0
- **New songs come from the chat:** 🎯 **✨ new song** in 💬 Chat turns your message into a song. The AI names it and writes it, and it plays next, or right away if nothing is playing. The set-list text box, ▶ Start set, ■ Stop and ✨ Write with AI are gone from the Songs panel.
- **A simpler Songs panel:** this session's songs, ★ Favorites and 📁 My songs, each a list where clicking a song shows its buttons in place. The song view is gone from this panel.
- **✎ Edit song panel:** ✎ Edit, on any written song, opens it in its own panel: the editor (tempo, meter, scale, chords, sections, parts, parts code) above the song's sections. ✓ apply keeps the panel open.
- A song's sections now show only in 🎶 Now playing and ✎ Edit song.

## 1.28.0
- **dockview is the layout:** the built-in layout engine and the trial setting are gone. The default layout is the code on the left, Chat / Songs / Station on the right, and Now playing below them. Layouts saved by the trial start fresh once.
- **The transport moved into 🎶 Now playing:** ⏮ ▶ ⏸ ■ ⏭.
  - **⏭** skips to the next song.
  - **⏮** restarts the song, or near its start goes back to the previous song.
  - **▶** resumes a paused song or plays the editor's code.
  - A status line next to the buttons says what's playing.

  Play and Stop are no longer in the header.
- **Now playing is always shown:** it can't be closed, nothing tabs over it, and it never shrinks below its transport bar. The code editor and Now playing tabs have no close button.

## 1.27.1
- **dockview trial fixed:** dockview takes a panel's content out of the page while another tab covers it, which broke chat, playing songs and more (the app couldn't find their elements). Panels now stay in the page while hidden, and the app remembers its elements so it still finds them, including in popped-out windows.

## 1.27.0
- **🧪 dockview layout (trial):** ⚙ Settings → General → 🧪 layout → *dockview (trial)* runs every panel in [dockview](https://dockview.dev). It adds nested splits anywhere, plus maximise, float and **pop-out windows** from a tab's right-click menu. The code editor becomes a panel that can be moved but not closed. The layout is saved separately, and *built-in* stays the default.

## 1.26.1
- **AI edits of a playing song work:**
  - With the chat on **auto** and a song playing, requests go to the **whole song** (the selector shows "auto → whole song"). Before, the AI edited the section's code and sometimes pasted the song's parts back into the editor, which failed.
  - A reply that rewrites the song's parts as editor code (`const`s, or `part_variant:` labels) is now applied to the song's parts.
- **Clearer errors for two common mistakes:**
  - A label holding a function (`bass_main: (prog) => …`) used to fail with `.p is not a function`.
  - Code that only defines consts used to fail with "unexpected ast format without body expression".

  Both now get a plain explanation that the AI can fix, and the prompt warns about them.

## 1.26.0
- **🎨 Part visuals:** each part of a song section gets a Strudel inline visual under its line, in the part's colour, picked by its role: a punchcard for drums, a piano roll for bass and arps, a spiral for chords and pads, a pitch wheel for melodies, a scope for fx. Turn it on or off in ⚙ Settings → General.
- **🌀 Hydra visuals:** the visualizer has Hydra backgrounds behind the code, fed by Strudel's visuals (`initHydra({ feedStrudel: 1 })`). There are presets (kaleidoscope, tunnel, waves, cells, feedback), your own code (**✎ code**), and a **mix** slider. Hydra is served locally.
- **Song pads follow the chords:** the **arp** and **jam lead** pads play the tones of the chord sounding now, so they follow each section's chords and key changes. Pads saved with older songs are updated.
- **Chat and console stay at the bottom:** both follow new output unless you scroll up to read, and following resumes when you scroll back down. The console keeps following while its panel is hidden.

## 1.25.0
- **🎚 The mixer is a console for the whole song:**
  - There's a channel for every part in the song sheet, even ones the current section doesn't play (they're dimmed, and their settings apply when they come in), plus your own labelled parts and the master.
  - Each strip has a live **EQ display** (the curve over the channel's spectrum), H / M / L EQ, **pan**, M / S, a **fader** and a **level meter** with peak hold.
  - Every labelled part now plays on its own output bus, where the channel strip sits. Mixer changes are instant, stay out of the code, and are remembered per part name for the whole song (and the next ones).
  - The mixer dock opens tall enough for the strips.

## 1.24.0
- **🎚 Mixer panel:** a channel strip for every part, plus the master. Each strip has a volume fader (the part's `.postgain` slider in the code, moved live), a 3-band EQ (low, mid, high, ±12 dB), and mute and solo. **+ fader** adds a group fader to a part that has none. A part with EQ gets its own output bus, so EQ changes are instant and leave the code alone. EQ is remembered per part name.
- **🎯 Chat target:** a selector under the chat picks what it works on: the code in the editor, the **whole song**, the pads, or auto. In whole-song mode the AI changes the song's sections, chords, parts and variants across the whole song. The section playing now switches to its new version on the next bar, and the rest follow as they play.
- **Now playing during writing:** while the first song of a set or station is being written, Now playing shows it as **✎ being written** instead of "nothing is playing".
- **⏸ Pause / ▶ Resume in Now playing:** stops the song at its section and bar, and resumes from that bar later. ▶ Play resumes too.
- **Now playing keeps the last song:** when a song ends with nothing after it, it stays in the panel marked **■ stopped**, with ▶ Play.
- **Station tab without the song view:** the On air box (and a song you click in the list) has the song's buttons, and **🎶 Now playing ↗** opens the song's sheet and sections in the Now playing panel.
- **Long forms, about 4 minutes:** **long ballad** and **ambient journey** (80 bars each). The AI is told to keep them moving: every section changes something, with alternate lines, parts coming and going, and slowly evolving textures.
- Fixed a page error in the section progress when no song was paused.

## 1.23.0
- **Panels and layout:** chat, songs, station, a new **Now playing** panel, the visualizer, keys, pads and console are all panels. They tab together, dock on any side of the code editor, or float as windows. Drag a tab or header to move one: onto another group to tab it, to an edge to dock it, anywhere else to float it. You can resize areas, groups and windows, and **▦ Panels** opens or closes panels and resets the layout. The layout is saved, and earlier dock settings carry over.
- **More variety in songs:**
  - Parts get alternate lines (`bass.alt1`, `keys.alt2`), counter-melodies, riffs and a hook harmony, so sections have their own character.
  - Parts can enter or leave within a section (`riff@in`, `@out`, `@alt`).
  - Hooks vary in length (1–4 bars) and style.
- **Time signatures:** songs can be in 3/4, 6/8, 12/8, 5/4 or 7/8 where the genre fits. Tempo lines, crossfades, pad sync and the status bar follow the meter, and the song editor has a meter field.
- **Sections start on their first bar:** parts and chord progressions are anchored to the bar a section switches in on. Before, a progression could start mid-way.
- **Section tempo edits through chat apply:** section tempos and key shifts written as text ("104 bpm", "+2") or under other names are read. Changes you ask for may move further (±30% tempo, ±6 semitones). The chat's reply says what the song now does.
- **No more "non-finite AudioParam" errors:** notes with an invalid value (NaN or infinite gain, cutoff …) are skipped, and the console names the sound and control once. Filter cutoffs below 10 Hz are raised to 10 Hz.
- **Fixes:**
  - The section progress bar no longer blinks out when the song view refreshes.
  - The pad editor stays hidden until you program a pad.

## 1.22.0
- **Songs record as they play:** every song is recorded in the background from its first section. When it has played to its end, **⬇ MP3** in its toolbar downloads it. Songs cut short are discarded. Set it in ⚙ Settings → General (🎙 record songs).
  - **🎙 MP3** on a station song no longer stops the station. It records that song the next time it plays from the start.
- **Key and tempo changes:** sections may lift the key (−3…+3 semitones) or nudge the tempo (±8%) where the genre does it, such as a pop last chorus up a whole step. Chords and melodies move, drums don't. The song view and the song editor (`| key +2, 108 bpm`) show them.
- **Song pads follow the songs:** turning on 🔲 Song pads (or **follow song** in the pad dock) stays on, and the dock switches to each new song's pads as songs change.
- **Song pads always play:** song part pads (e.g. the lead or hook) carry their own code. They no longer fail with "lead_main is not defined" when another song or your own code is playing. Pads saved with older songs are repaired when the song loads.
- **Part pads show and switch the song's parts:** song pads start with one pad per part. A part pad is lit while the section plays that part, and pressing it mutes or unmutes the section's own line instead of adding a second copy.
- **Section progress:** the playing section fills up as it plays, with `bar 3/8 · next in 0:06` beneath it. It also says when the next section changes tempo (`then ↑ 108 bpm`), and shows `⏸ holding` while a section is held.
- **Tempo and key changes on the section lines:** each section line marks where the tempo moves (`♩ ↑ 108 bpm`) or the key moves (`key +2`, `key home`) compared with the section before.
- **Tempo pads:** **tempo −¼** and **tempo +¼** (hold) play everything at ¾ or 1¼ speed.

## 1.21.0
- **★ Favorites:** ☆ a song and it's stored on the server. Everyone who opens this server sees it in the Songs tab, it survives restarts, and it plays without any AI calls.
- **📁 My songs:**
  - Save any song, including a station song, into My songs in the Songs tab, then edit it there: tempo, scale, chords, sections, parts and parts code. Changes are checked, test-played and re-arranged live.
  - **⬇ JSON / ⬆ import** move whole songs (sheet, parts, sections, pads) between servers.
- **Chat works on the song and the pads:**
  - With a song playing or open, ask for structure changes ("make the chorus 16 bars", "add a breakdown"). The song switches over from its next section.
  - Ask to program or press pads ("make pad 1 a kick and turn it on").
- **Song pads:** every song comes with 16 pads made from its own parts, key and chords, no AI needed. **🔲 Song pads** loads them to jam along.
- **🎙 MP3 recording:** record what you hear (⏺ MP3 in the status bar), or one whole song from its toolbar.
- **🧾 Session log:** every song played is logged. **⬇ played this session** saves it as a text file that can be imported again.
- **Errors stay out of the page:** AI errors such as "overloaded" go to the console. Claude requests are retried 4 times first. If an error can't be resolved, the status bar shows ⚠ with the message as a tooltip.
- **Fixes work on the right code:** when the AI's code fails a check, the fix request now sends that failed code ("code to fix") instead of whatever is in the editor. Block-by-block song sections are regenerated from their own failed code too.
- **Shorter choruses:** choruses and hooks are 4 bars at most, in the built-in forms and on every AI-written song. Stored copies of the old built-in forms are updated unless you changed them.
- **Patterns span bars:** the AI is asked for 2–4 bar phrases instead of one bar on repeat:
  - bar-by-bar changes with `<…>`;
  - longer lines with `.slow(2)`;
  - fills in the last bar of a phrase with `.lastOf(4, …)`.

  Hooks are now 2-bar melodies.
- **Songs stop at the end:** a song played from a list (▶ on My songs, Favorites or a song view) stops after its last section, instead of looping or holding the last section. A finished set list stops too.
- **Much less AI usage:**
  - **Session cost and budget:** the status bar shows the session's cost. A session budget (default $2) stops requests at that point.
  - **Cheaper requests:** a 1-hour prompt cache; the parts step only gets the sounds it needs; song and pad context is only sent when the message is about them.
  - **Fewer requests:** two retries instead of three; stations write one song ahead.

## 1.20.0
- **Claude as an AI provider:** set `ANTHROPIC_API_KEY` in `.env` and pick **Claude** in ⚙ Settings → AI. The default model is Claude Sonnet 5.5, and `ANTHROPIC_MODEL` can change it.
  - It uses Anthropic's official SDK, with streaming in the same format as the other providers, so every feature works with it.
  - **Effort** (low / medium / high) replaces temperature for Claude.
  - The instructions and sound list are prompt-cached.
  - Server-side fallback is on for declined requests.
  - The console shows each reply's tokens and approximate cost.

## 1.19.0
- **⚙ Settings → 🤖 AI:** provider, model, **temperature** (how wild the AI gets), auto-apply and auto-fix moved out of the header and the chat. **switch on** (the bar timing) moved to Settings → General. The header is now just transport, volume and tools.
- **⚙ Settings → 📝 Prompts:** read and edit the system prompts for chat, song sheets, song parts, songs and blocks. Your versions are saved in the browser and sent instead of the built-in ones (new `/api/prompts` endpoint, and `/api/chat` accepts a prompt override).
- **🖥 Console:** a dockable log of AI requests (with live text), checks, automatic fixes, retries, repairs and engine errors.
  - Intermediate problems now stay out of the chat. A reply that needed fixing shows the code that finally worked, with a "🔧 fixed automatically" note.
  - The chat gets an error only when every attempt has failed.
- **Fewer "instrument doesn't exist" errors:** the silent test run now checks every note's actual sound, including the drum-machine bank. Before, a drum that exists in general but not in the chosen machine slipped through, e.g. `s("oh").bank("RolandTR808")`. The error lists the drums the machine has, so the AI fixes it before anything plays.
- **🎹 Keys fixed and extended:**
  - The keys now start the audio engine themselves. Before, they could stay silent, because Strudel only starts audio on a mouse-down and the keys use pointer, keyboard and MIDI events. Notes are also scheduled a little further ahead so they aren't dropped.
  - Choose an instrument, or write a **custom Strudel line** with `{note}`, e.g. `note({note}).s("sawtooth").lpf(1200)`. It's used live and for recordings.
  - New **len** sets the live note length.
  - New **auto-add** adds each recording as a part right away, for layering while you play along.
- **More built-ins:**
  - 15 song forms, with new verse-chorus, house, techno, trance, jazz AABA, dub, chiptune and build & release.
  - 12 stations, with new Sunrise House, Warehouse Techno, Liquid Drum & Bass, Ambient Drift, Boom Bap Café, Trance Horizons, Arcade Chiptune, Space Disco and Dub Station.
  - New built-ins are added to existing lists. Ones you deleted stay deleted.

## 1.18.0
- **⚙ Settings:** ⚡ live edit, fade and ⌨ autocomplete now live in one dialog. The song forms editor and the station definitions moved there too, from the Station tab and the forms dialog.
  - **💾 Backup** exports or imports everything saved in the browser, or resets it.
  - All settings are kept in local storage.
- **Status bar** at the bottom: bar, beat and BPM; the song and section playing; the pending change; the recording; and the replay and update notices. These moved out of the header.
- **🎹 Keys:** a dockable keyboard for mouse, touch, the computer keyboard (A W S E D F…) or MIDI keyboards via Web MIDI. It plays any loaded sound live.
  - **⏺ Rec** captures what you play on the bar grid, including chords.
  - The result can be inserted as a `keys:` part or sent to the AI to arrange.
- **🔲 Pads:** a dockable 4×4 pad. Each pad is a line of Strudel code that's added or removed on the next beat or bar.
  - Modes: toggle, hold and once. Effect pads like `all(x => x.lpf(500))` work too.
  - Pads are programmable and saved.
  - **⏺ Rec** writes your pad performance into the code as `.mask()` patterns, so it loops.
- The visualizer, keyboard and pads share the same docking: under or above the code, or in the side panel, resizable and remembered.

## 1.17.0
- **🎼 Song forms you can edit:** the forms songs follow (pop, edm, drum & bass, hip hop, lo-fi, ambient, short) are now editable data.
  - Change their sections and bar counts, what genres they're used for, or add your own.
  - The Songs and Station tabs have a **form** picker: *auto* (fits each song's genre) or one fixed form.
  - The chosen form's bar counts are applied to the song sheet.
- **Tighter sections:** the built-in forms use 4- and 8-bar sections, so songs run about 32–64 bars. Sections are capped at the form's longest section, or 16 bars.
- **⌨ Autocomplete in the code editor** (on by default, toggle in the header):
  - every Strudel function, with its description, parameters and examples;
  - the sound names that are actually loaded, drum-machine banks, scale names and chord symbols.

  Ctrl+Space opens it any time.
- **🔗 Share song:** a finished song's view has a share button. The link contains the sheet, the parts and every section, opens in the Songs tab, and **▶ Play this song** plays it exactly, with no AI calls.

## 1.16.0
- **Songs are planned as song sheets.** For the Songs tab and the Station, the AI first writes a sheet: tempo, key, 2–3 chord progressions, a hook, the parts and their sounds, and a standard form (verse/chorus, build/drop, A/B …) whose length decides the song's length. Then it writes every part once, and the app arranges the sections from those parts:
  - choruses repeat exactly, and the key and sounds stay consistent;
  - parts that continue between sections are identical, so changes are smooth;
  - drum fills play before choruses and drops;
  - fader positions and mutes carry over from section to section.

  The parts are test-played silently before use and sent back to the AI with any error. If no usable sheet comes back, the song is written block by block as before.
- **Tabs are now Chat, 🎵 Songs and 📻 Station.** Click a song to see its sheet (chords, hook, parts) and its sections with live status, jump buttons and **⏸ hold this section**. The separate Blocks tab and **+ Block** button are gone.

## 1.15.0
- **Smoother block changes:** new **fade** setting in the header (cut, 1 beat, 2 beats, 1 bar, 2 bars; default 2 beats). The old block fades out while the new one fades in, and the new block lands on the bar line at full level. Notes both blocks share, like a steady kick, keep playing at full level. Applies to song blocks, set lists, stations and AI changes, and recordings replay with the same fades.
- **More visualizer views:** a dashboard (oscilloscope, spectrum, vectorscope and meters together), stereo L/R oscilloscope, vectorscope, spectrogram waterfall, radial spectrum, L/R level meters, and piano roll + oscilloscope.
- **ⓘ About** (or click the version): version and build, recent changes, and links to the GitHub project, issues, releases and the Strudel docs.
- The code window's horizontal scrollbar now sits at the bottom of the window instead of under the last line of code.

## 1.14.0
- **📊 Visualizer** in a docked panel: a piano roll of what's playing and coming up (drums get their own lanes), plus a spectrum or oscilloscope of the output. Dock it under the code, above it, or in the side panel, and drag to resize.
- **Shared songs replay exactly:** every code change that plays (AI blocks, chat changes, your edits, mutes, fader moves) is recorded with the cycle it took effect on. Share links can include the recording, and **⏺ Play the recording** replays every change on the same bar.
- **⚡ live** (header): edits in the code window take effect as soon as you stop typing. Code with a syntax error isn't applied, and the last good version keeps playing.
- **Skipping ahead in song blocks:** jumping to a later block stops writing the unwritten blocks above it and generates from that block on. Skipped blocks are marked ↷ and are written if the blocks loop.
- Song blocks now take parts away and switch up the beat, instead of only adding layers.
- The AI uses the `space` sample much less often.

## 1.13.0
- "Setlist" renamed to **Song blocks** (the sections of one song).
- New **Set list**: a list of songs, one prompt each. While a song plays, the AI writes the next song's blocks and code. Songs hand over on the bar line, and you can jump to any song.
- New **📻 Station**: give it a theme and an AI agent keeps inventing songs for it and plays them endlessly. Stations are saved by name.
- **Master volume** fader in the header (double-click resets to 100%); "duck music" works with it.

## 1.12.0
- Version number shown in the header; hover it to see the build id.
- Self-update: open pages check for a new build every 20 s. When nothing is playing they save the session (code, chat, undo history, unsent text), reload and restore it. While music plays, an "update ready" pill appears and the update applies when you stop.
- Share links: **🔗 Share** creates a short `/s/<id>` link to the current song, optionally with its setlist. Songs are stored in the `songs` volume.

## 1.11.0
- Named groups (`drums:`, `bass:` …) with `stack()`, and group faders via `.postgain(slider())`.
- Every gain is a `slider()`; bare numbers are converted automatically and slider ranges are fixed. More live controls (filter, reverb …) have sliders.
- Mute/solo buttons moved to their own column; side panel is resizable.

## 1.10.0
- Prompts always build on the current editor code, including manual edits. Old code is removed from the chat history sent to the model.

## 1.9.0
- Per-line mute / solo, switched in on the next beat.

## 1.8.0
- Hum a melody: hold 🎤 (or the ` key), hum, release. Pitch tracking, quantization to the bar grid, snap to key, and the AI arranges the melody or it's inserted as-is.

## 1.7.0
- Scale names are checked and auto-corrected (`C:minor:pentatonic`). New code is test-played silently before it goes live, which catches errors Strudel only logs.

## 1.6.0
- Setlist: jump to any section (⏭ go / Alt+1…9) and an auto-advance toggle.

## 1.5.0
- Caddy HTTPS reverse proxy (AudioWorklet and the microphone need a secure page).

## 1.4.0
- Sound names are checked against the loaded sounds and auto-corrected. Soundfonts are preloaded. Out-of-range soundfont notes are moved into range.

## 1.3.0
- Changes switch in exactly on the bar line ("switch on" setting). Setlists of timed changes, generated ahead of time.

## 1.2.0
- Fix: the model no longer gets stuck replying "code applied" without code.

## 1.0.0
- Strudel REPL + AI chat (llama.cpp / OpenWebUI), auto-apply, auto-fix, Docker.
