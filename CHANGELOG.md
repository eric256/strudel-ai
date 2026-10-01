# Changelog

The version is in `package.json`. Bump it when you release. Open pages also notice *any* redeploy through the build id, which is a hash of the app files, even if the version wasn't bumped.

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
