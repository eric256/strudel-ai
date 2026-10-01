# Strudel AI 🎛️

[![CI](https://github.com/eric256/strudel-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/eric256/strudel-ai/actions/workflows/ci.yml)
[![Image](https://github.com/eric256/strudel-ai/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/eric256/strudel-ai/pkgs/container/strudel-ai)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

A Docker webserver that runs the [Strudel](https://strudel.cc) live-coding REPL next to an AI chat panel.
Type what you want to hear ("dark techno at 128", "add a jazzy chord progression", "make the hats swing")
and a local LLM rewrites the code, which is evaluated **immediately** and swaps into the music without stopping playback.

Works with:

- **llama.cpp** (`llama-server`, OpenAI-compatible `/v1/chat/completions`)
- **OpenWebUI** (`/api/chat/completions` with an API key — so you can use any model OpenWebUI fronts: Ollama, llama.cpp, OpenAI, etc.)

Switch between them (and pick a model) from the dropdowns in the header.

## Quick start

```bash
git clone https://github.com/eric256/strudel-ai.git
cd strudel-ai
cp .env.example .env       # set SITE_ADDRESS to include your LAN IP, plus the LLM URLs / API key
docker compose up -d --build
```

Open **https://<SITE_ADDRESS>** (e.g. `https://192.168.1.50`) from any device on your network.
Two containers run: the app, and a **Caddy HTTPS reverse proxy** in front of it (see *HTTPS* below).

### llama.cpp

```bash
llama-server -m your-model.gguf --host 0.0.0.0 --port 8080 -c 8192
```

`.env`: `LLAMACPP_URL=http://host.docker.internal:8080`

### OpenWebUI

1. OpenWebUI → **Settings → Account → API Keys** → create a key.
2. `.env`:
   ```
   DEFAULT_PROVIDER=openwebui
   OPENWEBUI_URL=http://host.docker.internal:3000   # wherever OpenWebUI listens
   OPENWEBUI_API_KEY=sk-...
   ```

> If llama.cpp / OpenWebUI run in Docker on the same compose network, use their service name instead of `host.docker.internal`.

## How it works

```
Browser ── Strudel REPL (web component, WebAudio) ◄── setCode() + evaluate()
   │                                                        ▲
   └─ chat ──► /api/chat (Node proxy, streams SSE) ──► llama.cpp / OpenWebUI
```

- Each request sends the **current editor code** + your instruction + a Strudel reference system prompt (`prompt.js`).
- The model replies with one sentence + the full program in a ```` ```javascript ```` block; the app extracts it, loads it into the editor, and evaluates it live.
- **Auto-fix**: if the code throws, the error is sent back to the model (up to 2 retries).
- **Undo** reverts to the previous version; every reply also has an **Apply this version** button.
- API keys stay server-side; the browser only talks to this container.
- `<think>` blocks / `reasoning_content` from reasoning models are shown collapsed and ignored for code extraction.
- You can still edit the code by hand — **Ctrl+Enter** evaluates, **Ctrl+.** stops.

## Timing changes to the bar

**switch on** (in the header) sets when AI changes take effect: immediately, or on the next 1 / 2 / 4 / 8 / 16-bar boundary (1 bar = 1 Strudel cycle, which is one 4/4 bar with `setcpm(bpm/4)`).

- The new code is evaluated straight away, so errors show up at once. The scheduler then gets a *spliced* pattern: notes before the boundary come from the old code, and notes from the boundary on come from the new code. The switch lands exactly on the downbeat, and no notes are cut or doubled.
- Tempo changes (`setcpm`) in the new code are held back until the boundary too.
- A yellow **⏱ … at bar N** pill counts down to a pending switch. Click it to cancel the switch.
- The header shows `bar.beat` and the current BPM.
- Each chat reply also has **▶ Apply now** and **⏱ Apply on bar** buttons.

## Live update ⚡

Tick **⚡ live** in the header and your edits in the code window take effect about half a second after you stop typing, with no Ctrl+Enter needed.

- Code with a syntax error isn't applied. The checkbox turns red and the last good version keeps playing.
- Fader moves are live anyway, so they don't cause a re-evaluation.
- Live edits wait for a pending bar-line switch to happen first, and they don't go into the ↶ Undo history.

## Visualizer 📊

**📊 Viz** opens a docked panel:

- **Piano roll:** the notes of the pattern that's playing, read straight from the scheduler, so you see one bar back and two bars ahead. The yellow line is the playhead. Pitched parts are drawn by pitch, drums get one lane per sound, and colours are per instrument.
- **Spectrum / oscilloscope** of the master output.
- **Dock** it under the code, above it, or at the top of the side panel, and drag its edge to resize. All of this is remembered.

## Song blocks, Set list & 📻 Station

There are three layers, each built on the one below:

| Tab | What you give it | What it does |
|---|---|---|
| **Blocks** | the sections of one song: `bars \| instruction` lines | writes code for every block ahead of time and switches each one in exactly on the bar line |
| **Set list** | songs: `title \| description` lines | for each song, the AI writes its blocks and their code while the previous song plays, then hands over on the bar line |
| **📻 Station** | a theme | an agent keeps inventing new songs for the theme, writes them and plays them, forever |

### Blocks
```
8  | intro at 124 bpm: soft kick and closed hats only
16 | add a sub bass in C minor and a clap on 2 and 4
8  | breakdown: drop kick and bass, add a pad and a filtered arpeggio
16 | drop: everything back, open the bass filter
```
- **▶ Play blocks** writes code for every block ahead of time, each building on the previous one. The first block switches in on the next boundary, and each later one exactly when the previous block's bars are over.
- **Jump:** click **⏭ go** on any block, or press **Alt+1 … Alt+9**. **auto-advance** off holds the current block until you pick another.
- **Skipping ahead** stops writing the blocks above the one you picked that have no code yet, including a request that's in progress. Generation continues from the picked block, building on the code that's playing. Skipped blocks show ↷. With **loop** on they're written when the blocks come round again.
- **Sections change, not just grow:** the AI is told that blocks may remove parts as well as add them (it deletes what an instruction drops), to keep about 5 groups, and to switch up the beat (new kick patterns, half-time, broken beats, swing). **✨ Write with AI** plans sections that take things away and change the groove.
- **loop** repeats the blocks. **✨ Write with AI** turns a description into blocks. **+ Block** (under Send in the chat) adds what you typed as an 8-bar block.
- If a block fails, it's regenerated with the error, or skipped, and the set keeps going.

### Set list
```
Night Drive | synthwave, 100 bpm, A minor, pulsing bass, neon pads; slow build, big chorus
Rain on Glass | lo-fi hip hop, 80 bpm, jazzy Rhodes chords, vinyl crackle; laid back
```
- **▶ Start set:** the AI writes song 1's blocks and code. While song 1 plays, song 2 is written, and so on, always one song ahead.
- **Song changes:** each song's first block is told to start a fresh arrangement — its own tempo, key and sounds — and the switch happens on the bar line after the previous song's last block.
- **Jump:** **⏭ go** jumps to any song. If it isn't written yet, it's written first and switched in as soon as it's ready.
- **Progress:** the Blocks tab shows the running blocks grouped under each song's name.
- **loop** replays the set using the code that's already written, so looping needs no further AI calls. **✨ Write with AI** turns a theme into a set list.

### 📻 Station
- **Setup:** pick or create a station: a name and a theme, e.g. *"late-night lo-fi with jazzy chords, 70–90 bpm, rainy city mood"*. Stations are saved in the browser, and three examples are included.
- **How the agent runs:** **📻 Start station** starts an agent that keeps the queue filled with **songs ahead** (1–3) planned songs. It asks the AI for new songs that fit the theme, aren't in the recently played list, and flow from the last one (related keys and tempos, an energy arc). Then it writes and plays them like a set list, endlessly.
- **What you see:** the **On air** box shows the current song, and the list shows what's played, playing and coming up. **⏭ go** works there too.
- If the AI fails 5 times in a row, the station stops itself.

## Master volume
The 🔊 fader in the header sets the overall output level (0–150%), and double-clicking it resets it to 100%. It's remembered, and "duck music" while humming lowers it relative to this level.

## Groups, faders, mute / solo

The AI is told to organise the music into **named groups**, one label per musical role, with related instruments stacked together:

```js
drums: stack(
  s("bd*4").gain(slider(1, 0, 1.2)),
  s("hh*8").velocity("0.5 1").gain(slider(0.6, 0, 1.2))
).postgain(slider(1, 0, 1.5))          // group fader

bass: note("c2*8").s("sawtooth").lpf(slider(1200, 200, 4000)).gain(slider(0.6, 0, 1.2))
```

- **Faders everywhere:** every instrument's level is `.gain(slider(…))`, and every group ends with a group fader, `.postgain(slider(…))`. The group fader scales the whole group and keeps the balance inside it. Accent patterns use `.velocity("…")` instead of gain. The AI also adds sliders for the 1–3 values per part most worth tweaking live, such as filter cutoff, resonance, reverb or delay.
- **Guaranteed even if the model forgets:** any bare number in `.gain(…)` or `.postgain(…)` is turned into a slider automatically. Slider ranges are fixed too: Strudel only accepts plain, non-negative numbers for a slider's range, so negative minimums are raised to 0 and the range is widened if the value falls outside it.
- **Values stick:** dragging a fader rewrites the number in the code, so your fader positions survive mute/solo, re-evaluation and AI rewrites (the AI is told to keep them).
- **Mute / solo:** every group label (and every `$:` line) gets **M** and **S** buttons in the column left of the line numbers, so a group is muted or soloed as a whole. The change switches in on the **next beat**, a quarter of a cycle. A click within about 0.1 s of a beat lands on the one after, because Strudel has already sent those notes to the audio engine.
  - The buttons edit Strudel's own syntax: `_drums:` is muted and `Sdrums:` is soloed. Several groups can be soloed at once.
  - Strudel treats any label starting with a capital **S** as solo, so group names are kept lowercase.
  - Mute/solo clicks don't go into the ↶ Undo history.
  - The button pulses until the change happens. Groups silenced by another group's solo show a red **M**.
- **Side panel width:** drag the handle between the editor and the chat to resize it. Double-click the handle to reset. The width is remembered.

## Hum a melody 🎤

Hold **🎤 Hold to hum** (or hold the **`** key while the editor isn't focused), hum, and let go.

- **What you see:** while you hum, a live pitch trace and the current note name. When you let go, a piano roll of the notes it heard and the Strudel pattern, e.g. `note("<[c4@2 e4@2 g4@2 e4 d4] [d4@7 ~ f4@4 a4@3 ~]>")`.
- **Timing:** if music is playing, notes snap to its bar grid (1/8 or 1/16) and line up with the bars you hummed over. The app accounts for audio delay. If nothing is playing, the melody starts on the downbeat at the current tempo.
- **snap to key:** if the code uses a `.scale("…")`, wrong notes are pulled into that scale.
- **duck music:** lowers the music to 30% while you hum, so the mic hears you and not the speakers. Headphones work even better.
- **What happens on release:**
  - **AI arranges it** (default): the melody is sent to the model, which must use it unchanged and adds instrument, octave and effects. If you typed something in the chat box first, e.g. "make this the bassline", that's used as the instruction. If the model changes your notes anyway, you get a button to insert the original.
  - **insert as-is:** adds a `$: note("…")` line straight away.
  - **just show it:** only shows the result. The **Send to AI** and **Insert as-is** buttons stay available.
- **Changing settings after recording:** a quick tap on the button opens the panel. Changing the grid or snap re-processes the last recording.
- The microphone needs a secure page (HTTPS or localhost), the same as the audio. The browser asks for permission the first time.

## Versions, automatic updates & sharing

- **Version:** shown next to the logo, e.g. `v1.12.0`. Hover it to see the build id. The version is in `package.json`, and the history is in `CHANGELOG.md`. The build id is a hash of the app's files, so every rebuild gets a new one even if you forget to bump the version.
- **Updates without refreshing:** open pages check `/api/version` every 20 s and whenever you switch back to the tab. After `docker compose up -d --build`:
  - **Nothing playing** (no AI reply in progress, no blocks / set / station running, no pending change): the page saves your session — code, chat, undo history and unsent text — then reloads itself and restores it.
  - **Music playing:** reloading would cut the audio, so a green **⬆ vX ready — applies when you stop** pill appears instead. The update applies as soon as you press Stop, or right away if you click the pill.
- **Share links:** **🔗 Share** creates a short link like `https://your-host/s/AbC123xyz0` and copies it.
  - Opening it loads the song into the editor and, if you ticked *include song blocks & set list*, those too. It doesn't start playing until you press ▶.
  - The person's previous code stays one ↶ Undo away, and the address bar goes back to `/` so a refresh doesn't overwrite their later edits.
  - Shared songs are stored in the `songs` Docker volume, so they survive rebuilds.
  - Anyone who can reach your server can open a link. There are no accounts, so don't share anything private.
- **Recordings — share a generated song exactly as it played:**
  - **What's recorded:** from the moment playback starts until you stop it, every code change that actually plays is recorded with the cycle (bar) it took effect on. That covers AI song blocks, set lists and stations, chat changes, your own Ctrl+Enter / live edits, mutes and solos, and fader moves.
  - **Sharing:** tick *include recording* in the share pop-up. It shows how many changes and roughly how long. The current take is shared while it's still playing, otherwise the last one.
  - **Replaying:** the link offers **⏺ Play the recording**. Playback restarts from bar 1 and every change is switched in on exactly the same cycle as the original, so tempo changes, bar-line switches and Strudel's cycle-based randomness all come out the same. The replay stops at the point where the original was stopped. The pulsing **⏺ replaying · stop** pill stops following the recording and leaves the music playing.
  - **Re-sharing:** a link opened from a recording keeps it, so sharing it again includes the recording.

## Guardrails for AI-written code

Before any AI-written code plays, the app checks it:

1. **Syntax check.** If there's no code block at all, the app asks the model again.
2. **Sound names** are checked against the sounds actually loaded. Close misspellings are fixed automatically (`gm_epiano01` → `gm_epiano1`). Made-up names go back to the model with real suggestions.
3. **Scale names** are converted to the format Strudel needs, `Tonic:name` with colons in place of spaces. For example, `C:minorpentatonic`, `C minor pentatonic` and `C:pentatonic:minor` all become `C:minor:pentatonic`, and `D:harmonicMinor` becomes `D:harmonic:minor`. Unknown scales go back to the model along with the full list of valid scale names (`public/scales.json`).
4. **Test run.** The new pattern is played silently for 8 bars before it's applied. Strudel only *logs* many errors, such as bad scales or `scaleTranspose` without `.scale`, and silently drops those notes. The test run catches these, the old music keeps playing, and the model is asked to fix it. A song block that fails this way is rewritten and switched in once it works.
5. **Out-of-range soundfont notes** are moved into the instrument's range instead of erroring.

## Configuration (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `DEFAULT_PROVIDER` | `llamacpp` | `llamacpp` or `openwebui` |
| `LLAMACPP_URL` | `http://host.docker.internal:8080` | |
| `LLAMACPP_API_KEY` | – | only if `llama-server --api-key` |
| `LLAMACPP_MODEL` | – | usually blank |
| `OPENWEBUI_URL` | `http://host.docker.internal:3000` | |
| `OPENWEBUI_API_KEY` | – | required for OpenWebUI |
| `OPENWEBUI_MODEL` | – | default model id; can pick in UI |
| `LLM_TEMPERATURE` | `0.7` | UI slider overrides per request |
| `LLM_MAX_TOKENS` | `2048` | |
| `LLM_TIMEOUT_MS` | `180000` | |
| `SYSTEM_PROMPT_FILE` | – | path to a custom prompt (mount it as a volume) |
| `SITE_ADDRESS` | `localhost` | Caddy: names/IPs to serve HTTPS for (comma-separated) |
| `DEFAULT_SNI` | `localhost` | Caddy: certificate for bare-IP connections |
| `TLS_ISSUER` | `internal` | Caddy: `internal` or an e-mail for Let's Encrypt |
| `HTTP_PUBLIC_PORT` / `HTTPS_PUBLIC_PORT` | `80` / `443` | host ports for Caddy |
| `PORT` / `HTTPS_PORT` | `3000` / (off) | app's own ports; built-in self-signed HTTPS only when not using Caddy |

## HTTPS (why it's needed and how it works)

Strudel plays audio with the browser's **AudioWorklet**. Browsers only turn that on in a *secure context*: `https://…` or `http://localhost`.
On plain `http://192.168.x.x` you get **"AudioWorkletNode is not defined"**.

`docker compose` therefore starts **Caddy** in front of the app:

- It serves HTTPS on port 443 for every name/IP in `SITE_ADDRESS`, and redirects port 80 to HTTPS.
- It streams AI replies straight through, without buffering them.
- `TLS_ISSUER=internal` (default): Caddy creates its own local certificate authority. The first time you visit, the browser warns that the certificate isn't trusted. You can click *Advanced → Proceed*: audio works after that, but the warning comes back. To get rid of it, trust the CA once on each device:
  1. Download it from **`http://<your-ip>/strudel-ai-ca.crt`**.
  2. Install it:
     - **Windows:** double-click it → Install → *Local Machine* → *Trusted Root Certification Authorities*.
     - **macOS:** open it in Keychain Access → set to *Always Trust*.
     - **iOS:** install the profile, then *Settings → General → About → Certificate Trust Settings* → enable it.
     - **Android:** *Settings → Security → Install certificate → CA certificate*.
     - **Linux / Firefox:** import it in the browser's certificate settings, under *Authorities*.
  3. The CA is stored in the `caddy_data` volume, so it survives restarts and rebuilds. Don't delete that volume, or you'll have to trust a new CA on every device.
- `TLS_ISSUER=you@example.com`: for a public domain name, Caddy gets a real Let's Encrypt certificate automatically. Put that domain in `SITE_ADDRESS`, and make sure ports 80 and 443 are reachable from the internet.
- Ports 80 or 443 already in use? Set `HTTP_PUBLIC_PORT` / `HTTPS_PUBLIC_PORT` (e.g. `8080` / `8443`) and browse to `https://<ip>:8443`.
- Without Caddy (single container): the app can serve its own self-signed HTTPS on port 3443 if `HTTPS_PORT=3443` is set (the compose file turns this off).

Samples (drum machines, piano, soundfonts) are fetched by the browser from GitHub and felixroos.github.io, so the *browser* needs internet access. The LLM can be fully local.

## Model tips

Coder / instruct models do best (Qwen2.5-Coder 7B–32B, Qwen3, Llama 3.x 8B+, Mistral Small, DeepSeek-Coder).
Use ≥ 8k context. Small models hallucinate function names more often — auto-fix catches most of it. Edit `prompt.js` to add your own favorite sounds or style rules.

## Development

```bash
npm ci
npm run check     # syntax check
npm test          # unit tests (hum → melody pipeline)
LLAMACPP_URL=http://localhost:8080 npm start   # http://localhost:3000
```

CI runs the checks, the tests, a server smoke test and a Docker build on every push and pull request.
Every push to `main` publishes `ghcr.io/eric256/strudel-ai:latest`, and every `v*` tag publishes a versioned image.
To release: bump `version` in `package.json`, add a `CHANGELOG.md` entry, then `git tag vX.Y.Z && git push --tags`.

## License

Strudel is AGPL-3.0-or-later; this project bundles `@strudel/repl` and is therefore distributed under the same license.
