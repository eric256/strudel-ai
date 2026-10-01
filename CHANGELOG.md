# Changelog

The version is in `package.json`. Bump it when you release. Open pages also notice *any* redeploy through the build id, which is a hash of the app files, even if the version wasn't bumped.

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
