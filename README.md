# Strudel AI 🎛️

[![CI](https://github.com/eric256/strudel-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/eric256/strudel-ai/actions/workflows/ci.yml)
[![Image](https://github.com/eric256/strudel-ai/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/eric256/strudel-ai/pkgs/container/strudel-ai)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

📸 **[Feature tour with screenshots](docs/FEATURES.md)**: every mode, editor, panel and setting.

A Docker webserver that runs the [Strudel](https://strudel.cc) live-coding REPL next to an AI chat panel.
Type what you want to hear ("dark techno at 128", "add a jazzy chord progression", "make the hats swing")
and a local LLM rewrites the code, which is evaluated **immediately** and swaps into the music without stopping playback.

Works with:

- **llama.cpp** (`llama-server`, OpenAI-compatible `/v1/chat/completions`)
- **OpenWebUI** (`/api/chat/completions` with an API key — so you can use any model OpenWebUI fronts: Ollama, llama.cpp, OpenAI, etc.)
- **Claude** (Anthropic's API, through the official `@anthropic-ai/sdk`) — Claude Sonnet 5.5 by default

Switch between them, pick a model and set the temperature in **⚙ Settings → AI**.

## Three modes

Pick one in the header. Switching stops all music. Each mode has its own panel layout (arrange it and it's remembered), its own chat targets and its own code.

| Mode | For | Chat works on | Layout |
| --- | --- | --- | --- |
| **📻 Radio** | Stations and the playlist write songs for you; play along on the pads, mixer and master, with visuals | the whole song, the code, the pads, or ✨ a new song | Chat · Songs · Station · Playlist, Now playing |
| **🎼 Studio** | Working on one song with the AI | the song (its sections, chords and parts) | Chat · Songs, Now playing; the ✎ song editor · Mixer · Master below the code |
| **⌨ Jam** | Live-coding: you and the AI write one piece of code in the editor, with no songs | the code in the editor (or the pads) | Chat, Keys · Pads · Visualizer below |

- **🎼 Studio's chat always works on a song, never on the code by itself:**
  - **The song it works on:** the one open in ✎ Edit song, even while another one plays.
  - **With no song open:** your message describes a new song. It's written, starts playing, and opens in ✎ Edit song. From then on the chat changes that song.
  - **While that song is still being written:** the chat asks you to wait instead of editing the code.
- **⌨ Jam** keeps its own code, saved as you type, so it's still there when you come back.
- **⬆ Promotion, from one mode to the next:**
  - **⌨ Jam → 🎼 song:** **🎼 Make it a song** (in Jam's code bar) grows the jam into a whole song. The AI keeps its tempo, key, sounds and patterns; the jam's groove becomes the main section, and the other sections grow from it (a thinner intro, verses, a breakdown) with a melody and hook added. It switches to 🎼 Studio, plays the song and opens it in ✎ Edit song.
  - **🎵 song → 🎸 band:** **🎸 Band** (in a song's buttons) saves the song's line-up as a band: each part's role and sound, its master style and own sound, its genre and meter. Use it for new songs, or edit it in ⚙ Settings → 🎸 Bands.
  - **🎵 song → 📻 station:** **📻 Station** makes that band, plus a station whose theme describes the song: its genre, mood, tempo, key area and sounds. It picks the band and form for the station's songs and puts it on air in 📻 Radio, so it writes music like the song.
- **The mixer in Jam** has a channel for each part in the code, and a channel goes away when you delete its part. In Radio and Studio it has a channel for every part of the song, even ones not playing in the current section.

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

### Claude

1. Create an API key at [console.anthropic.com](https://console.anthropic.com) → **API Keys**.
2. `.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   DEFAULT_PROVIDER=anthropic         # optional: select Claude by default
   ANTHROPIC_MODEL=claude-sonnet-5-5  # default; claude-opus-5-5 is the most capable
   ANTHROPIC_EFFORT=low               # low | medium | high
   ```
3. Rebuild: `docker compose up -d --build`, then pick **Claude** in **⚙ Settings → AI**.

**How it works:**
- The server talks to Claude with the official SDK and streams the reply to the browser in the same format as the other providers, so chat, songs, stations, keys and pads all work unchanged. The key never leaves the server.
- **Effort** replaces temperature, because Claude has no temperature setting. It controls how much Claude thinks before answering:
  - **low** (default) keeps live changes quick;
  - **medium** / **high** can help with songs and parts, but take longer and cost more.
- Claude's short reasoning summary appears collapsed above its reply, and in the 🖥 Console.
- **Prompt caching:** the long, unchanging instructions plus the sound list are cached, so repeat requests read them at about a tenth of the price.
- **Cost:** the console shows each reply's token usage and approximate cost. The status bar shows the session total (💲).
- **Session budget** (⚙ Settings → AI, default $2): once the session has spent that much, no more AI requests are sent until you raise it. 0 means no limit.
- **Keeping usage down:**
  - the instructions are cached for an hour;
  - the parts step only gets the sounds the song sheet chose;
  - the song and pads are only sent when your message is about them;
  - retries are capped at two;
  - stations write one song ahead (*songs ahead* = 1);
  - playing a written, saved or favorite song never calls the AI. As a rough guide on Sonnet 5.5, a chat change is about 1–2¢ and a whole station song (sheet + parts) about 5–7¢.
- **Declines:** if Claude declines a request, Anthropic's server-side fallback retries it on a recommended fallback model. If that doesn't help either, the chat shows a short "Claude declined" message.

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

**switch on** (⚙ Settings → General) sets when AI changes take effect: immediately, or on the next 1 / 2 / 4 / 8 / 16-bar boundary (1 bar = 1 Strudel cycle, which is one 4/4 bar with `setcpm(bpm/4)`).

- The new code is evaluated straight away, so errors show up at once. The scheduler then gets a *spliced* pattern: notes before the boundary come from the old code, and notes from the boundary on come from the new code. The switch lands exactly on the downbeat, and no notes are cut or doubled.
- Tempo changes (`setcpm`) in the new code are held back until the boundary too.
- A yellow **⏱ … at bar N** pill in the status bar counts down to a pending switch. Click it to cancel the switch.
- **fade** (⚙ Settings → General) crossfades into the new code instead of cutting: *cut*, *1 beat*, *2 beats* (default), *1 bar* or *2 bars*.
  - During the fade both versions play. The old one's notes get quieter and the new one's louder (equal-power curves, applied to each note's velocity). The new code lands on the bar line at full level.
  - Notes that both versions play at the same moment, such as a kick that doesn't change, are played once at full level, so the shared groove doesn't dip.
  - It applies to AI changes, songs and stations. Mute/solo, live edits and *immediately* switches stay instant.
  - Strudel has one audio engine, so the crossfade happens in the pattern itself rather than by running a second Strudel and fading between them. That keeps both versions on exactly the same clock.
- The **status bar** at the bottom of the window shows:
  - `bar.beat` and the current BPM;
  - the song and section that's playing (and whether it's held);
  - the pending change;
  - how much has been recorded for sharing;
  - replay and update notices.
- Each chat reply also has **▶ Apply now** and **⏱ Apply on bar** buttons.

## Autocomplete ⌨

The code editor completes as you type. Ctrl+Space opens the list any time, and **⚙ Settings → General → ⌨ autocomplete** turns it off.
- **Functions:** after `.` or anywhere in the code, every Strudel function, e.g. `.lpf`. A side panel shows its description, synonyms, parameters and examples.
- **Sounds** inside `s("…")` / `sound("…")`: the synths, samples and soundfonts that are actually loaded, plus the drum names to use with `.bank`.
- **Drum machines** inside `.bank("…")`.
- **Scales** inside `.scale("A:…")`, in the colon format Strudel needs, e.g. `minor:pentatonic`.
- **Chord symbols** inside `chord("…")`.

## Live update ⚡

Tick **⚡ live** (⚙ Settings → General) and your edits in the code window take effect about half a second after you stop typing, with no Ctrl+Enter needed.

- Code with a syntax error isn't applied. The checkbox turns red and the last good version keeps playing.
- Fader moves are live anyway, so they don't cause a re-evaluation.
- Live edits wait for a pending bar-line switch to happen first, and they don't go into the ↶ Undo history.

## Visualizer 📊

**📊 Viz** opens a docked panel:

- **Piano roll:** the notes of the pattern that's playing, read straight from the scheduler, so you see one bar back and two bars ahead. The yellow line is the playhead. Pitched parts are drawn by pitch, drums get one lane per sound, and colours are per instrument.
- **Sound views** of the master output:
  - **dashboard:** oscilloscope, spectrum, vectorscope and meters side by side.
  - **oscilloscope**, or a **stereo** version with left and right traces.
  - **vectorscope:** the stereo field. Mono is a vertical line, and wide stereo is a cloud.
  - **spectrum**, **spectrogram** (a scrolling waterfall) and **radial spectrum**.
  - **level meters:** left/right RMS with peak hold, in dB.
- **Combined views:** piano roll + spectrum, and piano roll + oscilloscope.

## 🎙 Recording to MP3

**⏺ MP3** in the status bar records what you hear (the master output) and saves an MP3 when you click it again.

**Songs are recorded as they play** (⚙ Settings → General → 🎙 record songs, on by default). Recording never interrupts the music: each song is recorded in the background from its first section, and once it has played to its end its toolbar shows **⬇ MP3** to download it. Songs that are cut short (skipped, stopped, or joined mid-way) are discarded. Recordings stay in memory until the page is reloaded; the last 20 are kept.

Encoding happens in the browser while you record (lamejs, 192 kbps stereo), so nothing is uploaded.
- It's a panel: dock, tab or float it like any other (see [Panels and layout](#panels-and-layout)).
- **🌀 Hydra** (its own panel, or **🌀 Hydra ↗** in the visualizer bar): live video-synth visuals ([Hydra](https://hydra.ojack.xyz)) fed by Strudel's own visuals (`initHydra({ feedStrudel: 1 })`, so `s0` is Strudel's canvas).
  - **visual:** kaleidoscope, tunnel, waves, cells, feedback, or your own code (**✎ code**).
    - In your own code, **`L()`** is how loud the music is (0…1). **`H("<4 5 6>")`** turns a Strudel pattern into a value that changes with the music, e.g. `osc(20, 0.1, 1).kaleid(H("<4 6>")).modulateScale(osc(2), () => L()).out()`. `s0` is Strudel's own drawing.
  - **show:** **in this panel**, which can float, pop out or stay 📌 on top like any panel, or **behind the code**, where the code area turns see-through and the code gets a shadow.
  - **mix** sets how strongly it shows behind the code. Hydra is served by this server, and your choices are remembered.

## 🎵 Songs & 📻 Station

| Tab | What you give it | What it does |
|---|---|---|
| **🎵 Songs** | a set list: `title \| description` lines | writes each song while the previous one plays, then hands over on the bar line |
| **📻 Station** | a theme | an agent keeps inventing new songs for the theme, writes them and plays them, forever |

### How a song is written: plan → song sheet → parts → arrangement
0. **Plan.** The app decides a few things before the AI writes:
   - **Form and band:** your picks in the Songs / Station tab, or ones that fit the description's genre. Forms and bands list the genres they're *used for*, and the app picks one of the close matches at random, so songs of one genre vary.
   - **Meter and key:** ones the form and band both allow (each lists its usual **meters** and **keys**). A meter or key the description names wins.

   The plan goes to the AI as decided. The 🖥 Console shows it (🧭).
1. **Song sheet.** The AI plans the whole song as data:
   - tempo, **meter** (4/4 for most dance music; 3/4, 6/8, 12/8, 5/4 or 7/8 where the genre or description calls for it), key and scale;
   - 2–3 chord progressions, e.g. *verse* `Am F C G`, *chorus* `F G Am Am`;
   - a main **melody** for the verses or theme, and a **hook**: the short, catchy figure of the choruses (1–4 bars, in a style that suits the genre: call and answer, a syncopated riff, held notes, octave leaps …);
   - 5–9 **parts** (drums, bass, keys, pad, hook, a counter-melody, a riff …), each with one sound and variants:
     - `drums.half` and `drums.fill`;
     - alternate lines such as `bass.alt1` or `keys.alt2`, a different figure on the same sound, so each section has something of its own;
     - `hook.harmony` (the hook a third above) for a last chorus;
   - parts can come and go inside a section: `riff@in` enters halfway, `counter@out` drops out halfway, `riff@alt` plays 2 bars on and 2 off;
   - the **form**: the order and length of the sections, built on the planned song form but varied for this song (see below). Each section says which chords it uses and which parts play;
   - the **band**: its core instruments, any of its optional ones that suit the song, and 1–2 parts of the AI's own.
   - **Master:** the song is mastered in the band's style, with the band's own tweaks to it (its sound).
2. **Parts.** The AI writes every part once, as a library of named patterns (`drums_main`, `bass_main` …).
   - Harmonic parts (bass, chords, pads, arpeggios) are functions of the chord progression, so each section can give them its own chords.
   - The library is test-played silently before it's used. If a part is missing or a sound, scale or chord doesn't exist, it goes back to the AI with the error (up to 3 tries).
3. **Arrangement.** The app builds each section itself: the library, the section's chords, and one labelled group per part that plays.
   - **Repeats stay recognisable:** a chorus uses the same chords and parts every time, so the key and sounds can't drift. A later repeat may swap in an alternate line or add the harmony.
   - **Sections start on their first bar:** each section's parts and chord progression are anchored to the bar it switches in on, so phrases and progressions always begin at their start.
   - **Meters:** one cycle is one bar. The tempo line follows the meter (`setcpm(bpm/3)` in 3/4), and the *fade*, pad *sync* and status bar beat count use the playing song's meter.
   - **Smooth changes:** parts that continue into the next section are identical code, so the crossfade keeps them steady and only what changes fades.
   - **Feel:** acoustic and live-band songs are played like a band, not a machine. Every note is a little softer or louder and a little behind the beat, each part in its own way; drums and bass stay steadier. Electronic styles stay on the grid. The feel (0–100) comes from the master style (acoustic 80, warm 60, cinematic 50, rock 45 …), a band's `feel` (plugin bands), or the song editor's **feel** field. The timing nudge applies to sampled sounds; soundfont and synth notes only get the dynamics.
   - **Fills:** the drums' fill variants (*fill*, *fill2* …) play in the last bar before a chorus, a drop or a solo, taking turns so they vary. The fill and the drop's downbeat cut in hard; everything else uses the *fade* setting.
   - **Your changes stay:** fader positions and mute/solo carry over from one section to the next.
   - **Repairs:** if a section fails when it's about to play, the parts are fixed with the error and the song's remaining sections are re-arranged. The old music keeps playing meanwhile.
   - **If it fails:** the sheet and the parts each get 3 tries. If they still fail, the song is started over once from a fresh sheet. If that fails too, the song is marked ✗: the set or station moves on, and **↻ Try again** in the song's row writes it from scratch and plays it next. Songs are no longer written block by block. Songs saved in that older format still load, play and repair themselves.

### 🎚 Genres
**Genres tie songs, forms and bands together.** There are 20: house, techno, trance, EDM, drum & bass, synthwave, lo-fi, hip hop, pop, rock, jazz, fusion, funk & disco, ambient, cinematic, dub & reggae, chiptune, downtempo, acoustic & folk and latin (`public/lib/genres.js`).
- **Each genre has the words that name it** in a description: "uplifting", "supersaw" and "psytrance" mean trance; "city pop" and "slap bass" mean fusion.
- **Every form and band lists its genres**, and every genre has at least two forms and two bands.
- **Picking:** a song's description is matched to its genre first, then one of that genre's forms and one of its bands are picked at random. Your own forms and bands take part through their **Genres** field (or their *use for* text).

### 🎼 Song forms
A form lists a song's sections with their lengths, e.g. `intro 4, verse 8, pre-chorus 4, chorus 8, …, outro 4`.
- **Built-in forms:** 45 of them, at least two per genre (e.g. trance: trance, trance anthem, psy journey, edm), about 32–80 bars per song.
- **Long forms, about 4 minutes:** **long ballad** (80 bars: sparse verses, fuller choruses, a stripped breakdown, the biggest choruses last) and **ambient journey** (80 bars: intro, drift, A, A′, swell, B, B′, still, return, outro). For these the AI is told that every section must change something: an alternate line, a part coming in or out, a layer added or dropped. Ambient parts are slow-moving textures.
- **🎼 edit forms** (in the Songs and Station tabs) opens the editor:
  - Change a form's name, what it's *used for* (genres and moods, which is how *auto* picks it) and its sections.
  - Add your own forms or delete any.
  - **restore built-in forms** brings the originals back and keeps your own.
  - Forms are saved in the browser.
- **form** (in each tab): *auto* lets the AI pick the form that fits each song's genre, or you choose one form for every song.
- **A form is a guide, not a template.** The song keeps the form's shape (how it opens, builds, peaks and ends). The AI varies the details from song to song:
  - section lengths: a 2-bar riser, a 12-bar groove, a 16-bar peak;
  - an added, dropped or repeated section.

  Sections are capped at 16 bars, and choruses at 4.

### 🎧 My taste
Tell the app what you like and what you never want to hear (⚙ Settings → 🎧 My taste). It's saved in this browser and included in 💾 Backup.
- **Sounds I never want**, each with a stand-in (square → triangle by default; a drum machine with no stand-in is just avoided).
  - **The AI is told** in every request: song sheets, parts, chat edits and jams. Avoided sounds aren't offered in the sound guide either.
  - **The app makes sure:** every piece of code is checked before it plays, and an avoided sound in `s("…")`, `sound("…")` or `.bank("…")` is swapped for its stand-in. The console shows 🎧 for each swap.
  - **Songs already written** are changed too: the playlist, this session and My songs. The song playing changes from the next bar.
- **Soften harsh synths:** parts playing square, saw, pulse or similar synths, with no filter of their own, get a gentle low-pass (1500–6000 Hz, 3000 by default) as they're arranged.
- **Sounds I like** and **my taste in my words** go to the AI with every song and change.
- **While you listen:** 👍 / 👎 on a 🎚 mixer channel likes or bans the sound that part plays, and a ban takes effect right away.

### 🎸 Bands and the sound guide
A band is a line-up of instruments (`role: sound — what it plays`) plus a master style.
- **Built-in bands:** 44 of them, at least two per genre (e.g. trance: trance rig, psy rig; latin: bossa trio, latin jazz group, lounge duo; acoustic: acoustic duo, folk band, bluegrass pickers, celtic session, piano & strings). Each has its genres, meters, keys, its own sound, and core and optional (`+`) instruments.
- **band** (in the Songs and Station tabs): *auto* lists every band in the song-sheet request and the AI picks the one that fits the genre (or none, and chooses its own sounds). Pick a band and every new song is written for it.
- **The band's instruments win:** each part of the sheet takes the band's sound for its role (a band with two pads hands them out in turn). Parts whose role the band doesn't have keep the AI's sound.
- **🎸 edit bands** opens ⚙ Settings → 🎸 Bands: change a band's name, genres, master style and instruments, add your own, delete any, or restore the built-ins. Sounds that aren't loaded are marked in red.
- **Real recordings (🎙):** Strudel loads sampled acoustic instruments as well as the General MIDI soundfonts: a Salamander grand piano (`piano`), and from the VCSL library `steinway`, `kawai`, harp and folk harp, strumstick, psaltery, vibraphone, marimba, kalimba, sax, harmonica, recorders, ocarina, pipe organ, and hand percussion and kit pieces (`cajon`, `framedrum`, `conga`, `bongo`, `shaker_small`, `tambourine`, `bassdrum1`, `snare_modern`, `hihat` …). Each recorded drum has several hits, soft to loud, and `.n()` picks one. The sound guide marks these 🎙, and the AI prefers them for acoustic, folk, jazz and classical songs. The jazz, lo-fi, latin and cinematic bands now use the recorded piano and mallets.
- **Sound guide:** the song-sheet request also describes about 160 of the most useful sounds (role · character · genres, e.g. `gm_epiano1: chords, comping · warm Rhodes · lo-fi, neo-soul, jazz, chillhop`), so the AI picks sounds that fit the genre and each other instead of guessing from names. Only loaded sounds are listed (`public/sounds.js`).

### 🎵 Songs

**Create a song in the chat:** in 💬 Chat pick 🎯 **✨ new song** and describe it, e.g. *"dreamy synthwave at 100 bpm with a big hook"* (or *"Night Drive | synthwave, 100 bpm, A minor, slow build, big chorus"* to name it yourself). The AI names it, writes it, and it plays as soon as its first section is ready. If a song is already playing, the new one plays next (⏭ skips to it). The chat then goes back to *auto*, which works on the song that's playing.

The **🎵 Songs** panel is a simple list:
- **This session:** the songs created, opened or played so far, with their status (✎ writing, ✓ ready, ▶ playing, ✔ played).
  - Click one for its buttons: ▶ Play, ⤴ Play next, ＋ Playlist, ✎ Edit, ☆ Favorite, 📁 Save to My songs, 🔲 Song pads, MP3, JSON and 🔗 Link.
  - **▶** on the row plays it now.
  - **form for new songs** picks the song form (*auto* fits each song's genre).
- **★ Favorites** and **📁 My songs** below it work the same way.

### 📃 Playlist
Every song plays from the **📃 Playlist**. It shows what played, the song playing now (with its section) and what's coming up. Songs get there three ways:
- from 💬 Chat (✨ new song plays next);
- from 🎵 Songs, ★ Favorites and 📁 My songs: **▶ Play** plays now, **⤴ Play next** puts it after the current song, **＋ Playlist** adds it to the end;
- from a 📻 Station on air, which adds its songs to the end.

The playlist plays and writes ahead at the same time: while one song plays, the next is written in the background. For each upcoming song:
- **▶** plays it now (from the next bar line, once its first section is written);
- **⤴** plays it next, **↑ ↓** move it, **✕** removes it, and **↻** rewrites a song that failed.

Played songs have **↺** to queue them again. **clear upcoming** empties the queue, and the song playing plays on. **🔁 loop** starts over after the last song, except while a station is adding songs. ⏭ / ⏮ in the transport move through the playlist. ■ stops the music, and the station too.

A song's sheet and sections show in two places only:
- **🎶 Now playing:** the song that's playing, with live progress.
  - **⏭ go** on a section jumps to it on the next boundary, and **Alt+1 … Alt+9** jump to the playing song's sections.
    - **While paused,** it carries on from that section.
    - **When the song has stopped,** it plays the song again starting there. The same goes for ⏭ go and 🔁 loop in ✎ Edit song.
  - **⏸ hold this section** stays on it until you pick another.
- **✎ Edit song:** **✎ Edit** opens the song editor in its own panel. In 🎼 Studio it gets the big space under the code. You change a draft of the song, and **✓ apply** checks it, test-plays the parts and switches the song over. If it's playing, you hear the section playing now change from the next bar.
  - **Song:** title, tempo, meter, scale, master style and **feel** (0 = on the grid, 100 = a loose live band).
  - **Sections:** a timeline, with each section as wide as its bars. Click one to edit its name, bars, chord progression, key change and tempo. You can move it (← → or drag), duplicate it, delete it, add one, or, while the song plays, **⏭ go** there or **🔁 loop** it while you work.
  - **Arrangement:** a grid of parts × sections. Click a cell to cycle off → the main version → the part's other variants. Right-click it to make the part come in halfway, drop out halfway or alternate. While the song plays, a **playhead line** moves across the grid with it.
  - **Chords:** the named progressions the sections use.
  - **Parts:** name, role, sound and variants. Open a part to edit the code of each variant, or **✨ ask the AI** about it ("make it busier", "a darker sound"). **＋ part** adds one with starter code that fits its role.
  - **↺ revert** throws your changes away. A song played again is a copy, and an edit applies to every copy of it.
  - Songs in My songs are saved; for other songs, 📁 Save to My songs keeps the edit.
  - Closing the panel ends editing.
  - The song's sections and progress are in 🎶 Now playing; the editor doesn't repeat them.
- **🧩 Part editor:** **🧩 edit** on a part in ✎ Edit song opens it in its own panel. It edits the same draft, so ✓ apply there or here puts the changes into the song.
  - **Variant** picks which version of the part you edit (main, alt1, fill …), with the sections each one plays in. **Section** picks whose chords it loops over.
  - **▶ loop** plays the part over and over, **solo** or with the rest of that section. Every change plays as you make it.
    - **A playing song** is paused where it is (section and bar).
    - **Carrying on:** ■ stop the loop, ✓ apply, then ▶ in 🎶 Now playing carries on from there with your fix. The paused section takes the new version.
  - **Effects:**
    - The methods on the whole part (gain, velocity, pan, low-/high-pass and resonance, vowel, envelope, note length, reverb, delay, shape, distort, crush, coarse, phaser, speed, vibrato) as sliders. Pitch filters use a log scale.
    - A value that's a live slider in the song (◉) stays one.
    - **＋ effect** adds one before the part's gain; × takes one off.
  - **Notes:** each mini-notation pattern in the part's code, in the editor that fits it:
    - **Staff:** melodies, in scale degrees (`n("0 2 4").scale(…)`) or note names (`note("c4 eb4")`), on a treble or bass staff with accidentals, stems and flags.
      - Click the staff to put a note at that step and pitch, or move the one there. Right-click removes it.
      - ▲▼ or the arrows move the selected note by a scale step, 8va / 8vb or Shift+arrows by an octave. ½ / ×2 or − / + change its length, and Delete makes it a rest.
    - **Grid:** drums (`s("bd ~ sd ~")`, one row per sound, ＋ sound for a new row), chord tones (`n("0 1 2").chord(…)`), sample hits (`.n("<3 4>")`) and rhythms (`struct("x ~ x")`). Click a cell to add or remove a hit.
    - **Level bars:** velocity and gain patterns. Click a column at a height to set it; right-click clears it.
    - **For every pattern:** steps per bar sets the grid, and ＋ bar / − bar add (a copy of the last) or remove bars, one per cycle with `<…>`. The pattern is also shown **as text** to edit directly.
    - **Read-only notation:** patterns using notation the editor can't change (euclid `(3,8)`, `?`, `{…}`, `.`, alternation inside a step) are shown as text only. The part's whole **code** is below.

**🔗 Link** shares a whole written song: its sheet, its parts code and every arranged section. Opening the link puts it in the Songs panel (This session), ready to play exactly as written, with no AI calls. When the playlist runs out (without loop or a station), the music stops after the last section.

### 📁 My songs, ★ Favorites and portable songs
Every finished song has a toolbar:

| Button | What it does |
|---|---|
| ▶ Play | plays it from the start (already written, so no AI is used) |
| ☆ Favorite | adds it to **★ Favorites**, a list stored on the server that everyone who opens this server sees and that survives restarts. Click again to remove it |
| 📁 Save to My songs | copies it into **My songs** (kept in your browser) — this is how a station song moves to the Songs tab to be worked on |
| ✎ Edit | open the song editor (see *✎ Edit song* above) |
| 🔲 Song pads | loads the song's own 16 pads into the pad dock to jam along, and keeps following: as songs change, the dock switches to each new song's pads (**follow song** in the pad dock; click again or **↩ my pads** to stop) |
| ⬇ MP3 / 🎙 MP3 | **⬇ MP3** downloads the song's recording once it has played to its end. With no recording yet, **🎙 MP3** plays the song now if nothing is playing, or records it the next time it plays from the start (the station keeps playing) |
| ⬇ JSON | downloads the whole song (sheet, parts, sections, pads) as a `.json` file. **⬆ import** loads such a file — or a session log — on any Strudel AI server |
| 🔗 Link | a short link to the song on this server |

**🎯 Chat target:** the selector under the chat says what the chat works on:
- **🎛 code in the editor:** the section playing now, as before.
- **🎵 whole song:** the open or playing song's whole structure. Every message sends the song's sheet and parts, and the AI answers with the updated sheet and parts instead of editor code. Sections, form, chords, parts and variants change across the song. The section playing now switches to its new version on the next bar, and the rest follow as they come up.
- **🔲 pads:** the pad dock.
- **auto:** the whole song while one of the song's sections is playing in the editor, otherwise the code (or the pads when your message mentions them).

**Chat edits the song, too:** with a song playing (or open in the Songs tab), ask things like *"make the chorus 16 bars"*, *"add a breakdown before the last chorus"* or *"give the bass a funkier line"*. The chat changes the song's sheet and parts, and they're checked and re-arranged the same way. The song is only sent to the AI when your message is about the song (sections, chorus, chords, parts …), which keeps requests small.

**Following along:** in a song view, the playing section fills up as it plays and shows `bar 3/8 · next in 0:06`, so you know when the next section starts. It adds `then ↑ 108 bpm` when the next section changes tempo. Section lines mark tempo changes (`♩ ↑ 108 bpm`) and key moves (`key +2`, `key home`).

**Dynamics:**
- **Volume:** each section has its own (quieter intros and breakdowns, a bigger last chorus). The output follows it smoothly as the sections change.
- **Solo sections:** one part takes the lead and plays its *solo* variant. The mixer brings it forward and softens the others.
- **Smooth changes:** the AI eases the moves between sections: parts drop out or come in halfway, the volume steps gradually, and half-time or alternate variants bridge sparse and full sections. A drum fill leads into choruses, drops and solos. A song can have several fills of different kinds (a snare roll, a tom run, a hat build, a stop), and they take turns.
- **Endings:** a song either **fades out** over its last section, or **stops hard** with a bar of silence before the next song.
- **In the song editor:** a section's **volume** and **solo**, and the song's **ending**.

**Key and tempo can move:** where the genre does it, a section may lift the key (a pop or gospel last chorus +1 or +2 semitones, a jazz or Japanese-fusion key change for the last theme) or move the tempo a little (up to ±8%). Chords and melodies move with the key and drums never do. Dance genres like techno and house keep one key and tempo. The song view marks those sections (`key +2`, `108 bpm`), and the song editor takes them as an optional last column: `chorus | 4 | chorus | drums, bass | key +2, 108 bpm`.

**Song pads** are made from the song itself, with no AI:
- **one pad per song part** (drums, bass, keys, hook …), then its extra variants (half-time drums, fills). A part pad is lit while the playing section has that part. Pressing it mutes or unmutes the section's own line (the mute carries into the next sections). If the section doesn't have the part, pressing it plays the part on top. Part pads carry their code, so they work even when another song is playing;
- **tempo −¼ / tempo +¼**: hold to play everything at ¾ or 1¼ speed;
- effects and drum one-shots (filter, snare roll, crash, riser, echo, half time), then jam parts (arp, jam lead, stabs, jam pad) as space allows. These play the tones of the chord sounding now, so they follow each section's chords and any key change. Older songs' arp and lead pads are updated when they load.

Edit them like any pads; they're saved with the song. **↩ my pads** goes back to your own set.

**🧾 Played this session:** every song that plays (Songs tab or station) is logged for the browser tab. **⬇ played this session** downloads the log as a text file listing each song (time, tempo, key, form, chords, sections, parts code), plus the songs as JSON at the end, so the file can be imported again.

### 📻 Station
- **Setup:** pick or create a station: a name and a theme, e.g. *"late-night lo-fi with jazzy chords, 70–90 bpm, rainy city mood"*. Stations are saved in the browser, and three examples are included.
- **📻 Start station** puts it on air: an agent adds its songs to the end of the 📃 Playlist. It keeps **keep ahead** (1–3) songs coming up, asking the AI for new songs that fit the theme, aren't in the recently played list, and flow from the last one (related keys and tempos, an energy arc).
- **Nothing stops when it starts:** the song playing and the songs already in the playlist play first, while the station's songs are written in the background.
- **■ Stop** only stops it adding songs. The songs it already wrote stay in the playlist and play; the ones it had only named are dropped.
- **Switch station:** pick another one and press **📻 Switch to this station**. Its songs follow the ones already queued.
- **What you see:** the **On air** box shows the current song with its buttons and **🎶 Now playing ↗**, and how many of the station's songs are coming up.
- If the AI fails 5 times in a row, the playlist stops itself.

## About

**ⓘ About** in the header, or a click on the version number, shows:
- the version and build id;
- the most recent changes, read from `CHANGELOG.md`;
- links to the GitHub project, issues, releases, the full changelog and the Strudel docs.

## ⚙ Settings

**⚙** in the header opens the settings:
- **General:** switch on (bar timing), ⚡ live edit, fade and ⌨ autocomplete.
- **🤖 AI:**
  - provider and model;
  - **temperature**: how wild the AI gets, from 0 (predictable) to 1.5 (adventurous, more mistakes);
  - auto-apply and auto-fix.

  The line under the chat shows the current model and temperature. Click it to jump here.
- **📝 Prompts:** read the built-in system prompts the AI gets for each job: chat edits, song sheets, song parts and inventing songs.
  - Edit any of them. Your version is saved in the browser and sent instead of the built-in one; the list of loaded sounds is still appended.
  - **reset to built-in** undoes your changes.
- **🎼 Song forms:** edit, add and delete forms (see *Song forms* above).
- **📻 Stations:** each station's name and theme. The Station tab just picks one and plays it.
- **🎨 Theme:** the app's colours.
  - Pick a built-in theme: Dark, Light, High contrast, Synthwave or Studio (warm). Each also sets the code editor's colours.
  - **Edit:** change any colour (it previews as you drag) and the code editor's theme. Editing a built-in theme saves your version as a new theme; your own themes can be renamed and deleted.
  - **⬇ export / ⬆ import:** share a theme as a small `.strudel-theme.json` file.
  - Every colour in the app, including the panels, the mixer meters, the Master graphs and the visualizer, comes from the theme's colour tokens (`public/theme.js`).
- **🧩 Plugins:** turn plugins on and off, or install one from a file or URL (see *Plugins* below).
- **💾 Backup:** export everything this browser has saved to a file, import such a file, or reset.

Settings, themes, plugins, forms, stations, pads, layout, docks and your last code are saved in the browser's local storage. They survive reloads and updates.

Each address keeps its own storage, so `https://192.168.1.50` and `https://myhost` don't share settings. Use Backup to copy them from one to the other.

## 🎹 Keys (keyboard)

**🎹 Keys** opens a dockable keyboard, two octaves plus one key, that plays a sound live through Strudel's audio engine. Play along with the music and add your own parts.

**The sound** is either an instrument from the list (piano, synths, soundfonts) or **✎ custom Strudel line**, a line of Strudel with `{note}` where the note goes:
- `note({note}).s("sawtooth").lpf(1200).decay(0.2)`: a plucky saw.
- `note({note}).add(note("0,7")).s("square")`: plays a fifth on every key.
- `note({note}).s("gm_epiano1").room(0.4).delay(0.25)`: an electric piano with reverb and echo.

Live, `{note}` is the key you press. In a recording it becomes the recorded notes, so the part sounds exactly as you played it. **len** sets how long a live note lasts.

**Playing it:**
- **Mouse / touch:** press a key, or slide across keys.
- **Computer keyboard:** `A W S E D F T G Y H U J K O L P ;` play the notes, and `Z` / `X` shift the octave. This only works while the keyboard is shown and you're not typing in a text field or the editor.
- **MIDI keyboards** connect through Web MIDI. The browser asks for permission, and connected devices are listed in the bar.
- The octave is set with − / +.
- Live notes last the **len** you chose. Recorded parts keep the lengths you actually held.
- The keys start the audio engine themselves, so they work even before you've pressed ▶.

**⏺ Rec:**
- While the music plays, what you play is captured against the bar you hear, on a 1/8 or 1/16 grid, for up to 8 bars. Chords are kept, written as `[c4,e4,g4]`.
- Press **⏺ Rec** again and you get the part as `note("…").s("…")`. Each recorded bar plays on the same bar you played it on. Then:
  - **＋ Insert as a part** adds it as a `keys:` group on the next switch boundary. With **auto-add** on, every recording is added as soon as you stop, so you can layer part after part while the music plays;
  - **✨ Send to AI** asks the AI to arrange it. Anything typed in the chat box is used as the instruction.

## 🔲 Pads

**🔲 Pads** opens a dockable 4×4 pad. Each pad holds one line of Strudel code.

**What a pad does:** pressing a pad adds its line to the running code as its own group, `padN: …`, on the next beat or bar (**sync**). So pads layer with the music and get mute / solo buttons.

**Effect pads:** lines like `all(x => x.lpf(500))` or `setcpm(140/4)` affect everything.

**Modes:**
- **toggle:** on / off.
- **hold:** on while pressed, at least one sync step.
- **once:** plays for one bar.

**Defaults:** kick, clap, hats, open hat, snare roll, rim, shaker, crash, sub bass, acid, stabs, arp, pad, riser, filter all, echo all.

**✎ program:** click a pad to change its label, code, mode and colour. **▶ test** plays it once. Pads are saved in the browser.

**⏺ Rec:**
- Records from the next bar while you play the pads.
- When you stop, the performance is written into the code. Each pad that changed gets a `.mask("…")` with its on/off pattern per beat over the recorded bars, up to 16, so it keeps looping exactly as you played it.
- Effect pads (`all(…)`, `setcpm(…)`) aren't masked.

## 🖥 Console

**🖥 Console** opens a dockable log of what happens behind the scenes:
- every AI request, with its text streaming in live (turn off *live AI text* for just the summary lines);
- the automatic fixes (sound and scale names, sliders);
- song sheets and parts as they're written and checked;
- retries and repairs;
- errors from the audio engine.

**⬇ debug log** saves a text file (`strudel-ai-debug-YYYYMMDDHHMM.txt`) to send back when something goes wrong or could be better. It contains:
- **a summary** of every error and warning, counted;
- **the app:** version, browser, audio, AI model, open panels and main settings;
- **what was playing:** the song, its section, the master style and the mixer;
- **the song:** its sheet and parts code, the code in the editor and the last 8 chat messages;
- **every problem**, then **the full log**.

The log keeps everything since the page opened (up to 5,000 entries; the panel shows only the last 400). That includes uncaught errors, failed promises, `console.error` / `console.warn` from Strudel and the audio engine, and Strudel's own error messages. Errors from *test plays* of new code are marked as expected warnings. There are no API keys in it: they stay on the server.

Problems the app is still fixing stay in the console. When an AI problem can't be fixed (e.g. Claude is overloaded after 4 automatic retries, or the budget is reached), it's shown only as **⚠** in the status bar, with the message as its tooltip; click it to open the console.

Fix attempts always work on the AI's own failed code (sent as *code to fix*), not on what's in the editor. The chat only gets the final result:
- If a reply needed fixing, its bubble shows the code that finally worked, with a note like *🔧 fixed automatically (1 retry)*.
- An error reaches the chat only when every attempt has failed.

## 🎚 Mixer

**🎚 Mixer** opens a console with a channel for **every part of the song**, whether or not it plays in the current section. That's every part in the song sheet, plus any other labelled line in the code (your own parts, pad lines). It ends with the master.

Each channel strip is laid out like a console channel:
- **Name and state:** ● playing, *not in section* (the strip is dimmed, but its settings apply when the part comes in), or *muted in code*.
- **EQ display:** the channel's EQ curve drawn over its live spectrum.
- **Knobs:** H (high shelf at 4 kHz), M (mid peak at 1 kHz) and L (low shelf at 200 Hz), ±12 dB each, plus **pan**. Drag up / down (Shift: fine), scroll or use the arrow keys while focused, and double-click to centre.
- **M / S / EQ:** mute and solo the channel for the whole song; **EQ** opens it in the 🎚 Equalizer.
- **Fader** with a dB scale (+6 … −40, ∞) and a metal cap. 0 dB is the rest position, and double-clicking it returns there.
- **Meter and clip LED:** RMS level, a slowly falling peak line, red at full scale. The LED above it lights amber when the channel peaks within 3 dB of the top and red when it clips; click it to reset.

How it works:
- Every labelled part plays on its own Strudel *orbit* (output bus). The channel strip sits on that bus: 3-band EQ → 7-band EQ → pan → fader → speakers, and the meter and spectrum tap the fader's output.
- Mixer changes are instant and never touch the code. The code's own faders (`.postgain(slider(…))`) still work as a trim before the channel.
- Settings are kept per part name in the browser, so `bass` keeps its fader, EQ, pan, mute and solo from section to section and song to song.
- **flat EQ** resets every EQ and pan. **reset all** also resets faders, mutes and solos.
- Anonymous `$:` lines share the default bus and don't get a channel: name them (e.g. `lead:`) to mix them.

### Level alerts
The status bar watches the whole mix. **● HOT** (amber) means it peaks within 3 dB of the top or the limiter is working hard; **● CLIP** (red, blinking) means it hits the top or the limiter takes more than 6 dB off. Hover it for how much and the loudest channels, and click it to open the mixer. Clipping is also noted in the 🖥 console (at most every 15 seconds).

## 🎚 Equalizer
**🎚 EQ** opens a 7-band equalizer for the master or any mixer channel (pick it under **on**, or press a strip's **EQ** button): a low shelf at 60 Hz, peaks at 150, 400 Hz, 1, 2.5 and 6 kHz, and a high shelf at 12 kHz, ±12 dB each.
- The response curve is drawn over the live spectrum of what it's working on, with a dot per band.
- Each band has its own fader; double-click one for 0 dB.
- **Presets:** Flat, Soft top (tames harsh square waves and cymbals), Warm, Bass boost, Bright, Presence, De-mud and Smile.
- It's remembered: the master's EQ in the browser, a channel's with that part's mixer settings.

## 🔀 Routing
**🔀 Routing** sends parts through chains of effects after their mixer faders, the way a studio console routes channels through outboard gear and buses. It's drawn as a graph: the parts on the left, the master on the right, effect nodes wired in between. Each card has a little scope of its sound now.

- **Wiring:** drag from a part's or node's **●** to a node or to the master. A part you wire stops going straight to the master; one with no wires goes straight there (the faint line).
- **Nodes:**
  - **Split** sends the sound down several paths at once; **Sum** adds paths back together. Wire several parts into one Sum to make a bus.
  - **Comp** (threshold, ratio, attack, release, makeup; its card shows the gain reduction live), **Sat** (drive, mix), **EQ** (low / mid / high), **Filter** (high-pass, low-pass), **Verb** (size, mix), **Delay** (time, feedback, mix) and **Gain**.
- **Editing:**
  - Click a node for its knobs, ⏻ (bypass) and ✕ remove. Removing a node joins what fed it to what it fed.
  - Click a wire to insert a node into it or remove it. **＋** adds a node after the selected node or into the selected wire.
  - Drag a node to move it; **tidy** lays the graph out again. Delete removes the selection, Esc unselects.
- **Ready-made chains** for the part picked in the bar:
  - **Parallel comp:** New York compression, a squashed, driven copy under the dry sound.
  - **Wet space:** comp, then a 100 % wet reverb path summed under the dry sound.
  - **Clean:** high-pass, EQ, gentle comp.
  - **Dub echo:** a filtered echo path.
  - **Drum bus:** every drum part into one Sum with glue compression and saturation.
- **routing on** switches it all off and on to compare (A / B); **clear** removes it.
- A node that never reaches the master is outlined in amber (⚠): you won't hear what goes into it.
- Kept in the browser by part name, like the mixer, so `drums` keeps its chain from song to song.

How it works: each part's channel strip ends in its fader, then a *direct* path to the master. Routing closes that path and wires the fader's output into Web Audio nodes (`DynamicsCompressorNode`, `WaveShaperNode`, biquads, `ConvolverNode`, `DelayNode`). Their sum goes into the master chain, so 🎛 Master and the master volume still apply. Node changes are instant; adding or removing nodes rebuilds the graph. The graph rules (no loops, values in range, templates, layout) are in `lib/routing.js` and the audio blocks in `routing-audio.js`.

## 🎛 Master (mastering style)
Every song has a **master style**: post-processing on the whole mix, picked by the songwriter (or the band) and shown in the song's details as 🎛. Styles: clean, lo-fi, warm, acoustic (natural and open: a wooden room, gentle compression), pop, techno, house, edm, dnb, hiphop, synthwave, ambient, dub, cinematic, rock, chiptune and radio.

The chain sits between Strudel's output and the master volume:
EQ (low shelf 120 Hz · mid 1 kHz · high shelf 6 kHz) → DJ filter (low-pass ← off → high-pass, with resonance) → drive (tape-style saturation) → crush (bit reduction) → reverb and tempo-synced echo sends, vinyl hiss and crackle → stereo width → glue compressor with makeup gain → output level → limiter (−1 dB).

**🎛 Master** shows the chain as nodes in signal order, like the effects of a part: 🎚 EQ → Tone → Filter → Colour → Space → Echo → Dynamics → Output.
- **🎚 EQ:** a small picture of the master's 7-band EQ and its preset; **7 bands ↗** opens the 🎚 Equalizer.
- **Each node** has knobs for its settings (16 in all). A knob in yellow differs from the style; double-click it to return to the style's value.
- **⏻ on each node** switches it off: its effect goes neutral and the sound passes through (remembered). It's for hearing what one stage does.
- **Output:** the mastered spectrum, the glue / limiter gain reduction, the level meter and its clip LED.
- **style** loads a style. **↺ style** throws away your tweaks. **bypass** lets you hear the mix without it (A/B).
- **follow song** (on by default): when a song starts, the master glides to its style and its own tweaks.
- **💾 save to song** stores the style and your tweaks in the playing song (in its sheet as `master` / `masterParams`, kept in 📁 My songs, files and links).
- In ✎ Edit song, **master** changes the song's style. The chat can change it too ("make it more lo-fi", "give it a dub feel").

## Master volume
The 🔊 fader in the header sets the overall output level (0–150%), and double-clicking it resets it to 100%. It's remembered, and "duck music" while humming lowers it relative to this level.

## Readable code

Song code is wrapped to about **150 characters** a line. A slider counts as about 8 more characters, because it draws a fader in the editor.
- **Method chains** break before a method, with continuation lines indented two spaces.
- **A long `stack(…)`** (or any call with several arguments) puts one argument per line, and the chain carries on from the closing bracket: `).bank(…).gain(…)`.
- **Strings and comments are never broken:** mini-notation stays whole.

The song's parts code, every section as it switches in, and the AI's code from the chat are all wrapped this way, so the code always looks the same.

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

## 🧩 Plugins

Plugins are small JavaScript files that add to the app:
- panels and header buttons;
- ⚙ Settings pages;
- themes, bands, song forms and stations;
- sounds;
- extra instructions for the AI.

They can also follow the player (section, song, play / pause / stop). Manage them in **⚙ Settings → 🧩 Plugins**.

**Where they come from:**
- **Examples** that come with the app, off until you turn them on:
  - **⏱ Bar counter:** a big bar · beat panel with a header button and a settings page.
  - **Paper pack:** a warm light theme, a chamber-pop band, a song form, a station and an AI instruction.
- **The server's `plugins/` folder** (`PLUGINS_DIR`). Every `.js` file in it is offered, and starts on. In Docker, mount a folder at `/app/plugins`.
- **This browser:** ⬆ install from a file or ⬇ from a URL. The code is kept in this browser.

**When a plugin breaks:** it is turned off, its error is shown in the list and written to the 🐞 debug log, and the app carries on. Turning a plugin off removes what it added. Bands, forms and stations it added stay in your lists, to keep or delete.

⚠ A plugin runs with full access to the page. Only install plugins you trust.

To write one, see **[PLUGINS.md](PLUGINS.md)**.

## Panels and layout

Every part of the app is a panel in [dockview](https://dockview.dev): the code editor ⌨, Chat 💬, Songs 🎵, Station 📻, Playlist 📃, **Now playing** 🎶, Visualizer 📊, Hydra 🌀, Keys 🎹, Pads 🔲, Mixer 🎚, Equalizer 🎚, Routing 🔀, Master 🎛 and Console 🖥.

- **Tabs and splits:** drag a tab onto another group to tab it there, or onto any edge of any group to split it. Splits can nest as deeply as you like, and you drag the bars between groups to resize them. A panel you open joins the group its kind already lives in (the tools go below the code, the song panels go on the right).
- **The buttons at the right of each panel header** act on the panel showing in that group:
  - **⧉ float** it over the layout (drag it anywhere, resize it), and **⇲ dock** it back;
  - **↗** open it in its own browser window, for example the visualizer or mixer on a second screen;
  - **📌 always on top:** a small window that stays above your other windows, even other apps (Document Picture-in-Picture: Chrome and Edge). Close that window to bring the panel back. One panel at a time; its animations may pause while the main tab is hidden.
  - **⛶** maximise or restore.

  Right-clicking a tab offers the same.
- **Open / close:** **✕** on a tab closes it, and the header buttons (📊 🎹 🔲 🎚 🖥) toggle their panels. **▦ Panels** lists every panel and has **↺ reset layout**.
- **Always there:** the code editor and **Now playing** can't be closed. Now playing keeps a group of its own (nothing tabs over it) and never gets shorter than its transport bar.
- The layout is saved in the browser. dockview is served by this server.

### 🎶 Now playing and the transport

The transport sits at the top of Now playing, which stays visible however small you make the panel, and again at the top left of the code:

| Button | What it does |
|---|---|
| ⏮ | Restarts the song. Within its first few bars it goes back to the previous song instead, like a music player. |
| ▶ | Resumes a paused song, or plays the code in the editor (same as **Ctrl+Enter**). |
| ⏸ | Pauses the song where it is (section and bar), and ▶ picks it up from that bar. The song's MP3 recording pauses too. Your own code just stops. |
| ■ | Stops everything (**Ctrl+.**). |
| ⏭ | Skips to the next song of the set or station. A song that isn't written yet plays as soon as it is. |
| ↺ | **Restart:** stops everything and plays the song again from its first section, fresh (holds, section volume and solos reset, every section arranged anew). For when something got into a strange state: like pressing ▶ on the first block. |

Next to the buttons, a line says what's happening: ▶ the song and section, ⏸ paused at bar n, ✎ writing, or ■ stopped.

Below the transport is the song itself: its sheet, its sections with live progress, and its toolbar.
- When a song ends and nothing follows, it stays here marked **■ stopped**, with **▶ Play** to hear it again.
- While a set or station is still writing its first song, it shows that song as **✎ being written**.

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
  - Opening it loads the song into the editor and, if you ticked *include the set list*, the set list too. It doesn't start playing until you press ▶.
  - The person's previous code stays one ↶ Undo away, and the address bar goes back to `/` so a refresh doesn't overwrite their later edits.
  - Shared songs are stored in the `songs` Docker volume, so they survive rebuilds.
  - Anyone who can reach your server can open a link. There are no accounts, so don't share anything private.
- **Recordings — share a generated song exactly as it played:**
  - **What's recorded:** from the moment playback starts until you stop it, every code change that actually plays is recorded with the cycle (bar) it took effect on. That covers songs and stations, chat changes, your own Ctrl+Enter / live edits, mutes and solos, and fader moves.
  - **Sharing:** tick *include recording* in the share pop-up. It shows how many changes and roughly how long. The current take is shared while it's still playing, otherwise the last one.
  - **Replaying:** the link offers **⏺ Play the recording**. Playback restarts from bar 1 and every change is switched in on exactly the same cycle as the original, so tempo changes, bar-line switches and Strudel's cycle-based randomness all come out the same. The replay stops at the point where the original was stopped. The pulsing **⏺ replaying · stop** pill stops following the recording and leaves the music playing.
  - **Re-sharing:** a link opened from a recording keeps it, so sharing it again includes the recording.

## Guardrails for AI-written code

Before any AI-written code plays, the app checks it:

1. **Syntax check.** If there's no code block at all, the app asks the model again.
2. **Sound names** are checked against the sounds actually loaded. During the test run (step 4), every note's actual sound is checked too, including drum-machine banks: `s("oh").bank("RolandTR808")` fails if that machine has no `oh`, and the error lists the drums it does have. Close misspellings are fixed automatically (`gm_epiano01` → `gm_epiano1`). Made-up names go back to the model with real suggestions.
3. **Scale names** are converted to the format Strudel needs, `Tonic:name` with colons in place of spaces. For example, `C:minorpentatonic`, `C minor pentatonic` and `C:pentatonic:minor` all become `C:minor:pentatonic`, and `D:harmonicMinor` becomes `D:harmonic:minor`. Unknown scales go back to the model along with the full list of valid scale names (`public/scales.json`).
4. **Test run.** The new pattern is played silently for 8 bars before it's applied. Strudel only *logs* many errors, such as bad scales or `scaleTranspose` without `.scale`, and silently drops those notes. The test run catches these, the old music keeps playing, and the model is asked to fix it. A song block that fails this way is rewritten and switched in once it works.
5. **Out-of-range soundfont notes** are moved into the instrument's range instead of erroring.

## Configuration (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `DEFAULT_PROVIDER` | `llamacpp` | `llamacpp`, `openwebui` or `anthropic` |
| `LLAMACPP_URL` | `http://host.docker.internal:8080` | |
| `LLAMACPP_API_KEY` | – | only if `llama-server --api-key` |
| `LLAMACPP_MODEL` | – | usually blank |
| `OPENWEBUI_URL` | `http://host.docker.internal:3000` | |
| `OPENWEBUI_API_KEY` | – | required for OpenWebUI |
| `OPENWEBUI_MODEL` | – | default model id; can pick in UI |
| `ANTHROPIC_API_KEY` | – | enables the **Claude** provider |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | default Claude model; can pick in UI |
| `ANTHROPIC_EFFORT` | `low` | `low` / `medium` / `high`; UI setting overrides per browser |
| `ANTHROPIC_MAX_TOKENS` | `32000` | per Claude reply, thinking included |
| `LLM_TEMPERATURE` | `0.7` | UI slider overrides per request |
| `LLM_MAX_TOKENS` | `2048` | |
| `LLM_TIMEOUT_MS` | `180000` | |
| `SYSTEM_PROMPT_FILE` | – | path to a custom prompt (mount it as a volume) |
| `PLUGINS_DIR` | `./plugins` (`/app/plugins` in Docker) | the server's 🧩 plugins folder (see [PLUGINS.md](PLUGINS.md)) |
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
npm test          # unit tests: song engine, music theory, code wrapping, hum → melody
npm run smoke     # the whole app in Chromium with a mock AI (needs Playwright: npm i --no-save playwright && npx playwright install chromium)
LLAMACPP_URL=http://localhost:8080 npm start   # http://localhost:3000
```

Code layout:
- `server.js`: the web server, the AI providers, share links and favorites. `prompt.js`: the AI's system prompts.
- `public/main.js`: the page's entry point. It loads `app.js`.
- `public/app.js`: the player core, about 1,700 lines:
  - the Strudel editor, quantized switching and crossfades, and the recorder / replay;
  - the workspace, the console, the section engine and the transport;
  - the status bar, and the start-up order of the feature modules.

  Playback has two layers:
  - `engine`: the sections, armed and switched in on the bar line;
  - `queue`: the songs of the Songs list or the Station, which feed their sections to the engine.

  The player announces `section`, `song`, `transport` (playing / paused / stopped) and `songs` (the lists changed) events. Now playing, the transport bars, the progress bars, the song lists, the mixer, the master and the chat target react to them.
- `public/templates/`: the HTML of every panel, kept away from the code. Each file covers one panel or feature: `playlist.js`, `songs.js` (song lists, a song's buttons, Now playing), `song-editor.js`, `mixer.js`, `master.js`, `pads.js`, `keys.js`, `editors.js` (band and form previews), `themes.js`, `plugins.js` and `layout.js` (▦ Panels).
  - **What a template is:** a function. It takes plain data (and the actions its buttons call) and returns markup. The comment above each one lists what it gets.
  - **Changing the look:** edit a template's markup, classes, labels or tooltips there. The feature module works out the data, so the code doesn't need to change.
  - **Markup only:** templates import nothing from the app. A test checks this, and also checks that every template the app uses exists.
  - **The registry:** `templates/index.js` collects the templates as `T`. The app renders with `render(T.playlist(view, actions), el)`. 🧩 Plugins can replace any of them with `api.overrideTemplate` (see [PLUGINS.md](PLUGINS.md)), and panels re-render when that happens.
- `public/html.js`: [lit-html](https://lit.dev/docs/libraries/standalone-templates/), served from `/vendor/lit-html` (no build step). Values are escaped automatically, event handlers can attach in the template, and a re-render only touches what changed. Two rules:
  - an element the app updates by hand (a progress label, a fader's dB value) has no template values inside it;
  - a rendered container is never written with `innerHTML`.

  `renderOptions(select, items)` fills a `<select>`.
- `public/features/`: the features. Each module imports what it needs from `app.js` and from the other modules. The code that ran at start-up is in its `setup()`, which `app.js` calls in the original order.
  - AI: `llm.js` (the AI client and its costs), `chat.js` (a chat turn), `sound-check.js` (sound, soundfont, scale and slider checks)
  - songs:
    - `song-writer.js`: sheet → parts → sections, and the feed loop
    - `song-lists.js`: the Songs / Station lists, Now playing and progress
    - `song-library.js`: files, 📁 My songs and ★ Favorites
    - `song-editor.js`: ✎ Edit song
    - `song-pads.js`
    - `forms.js`, `bands.js` and `stations.js`: their editors and pickers
    - `part-visuals.js`
  - panels and tools:
    - `mixer.js` and `mute-solo.js` (the M / S buttons beside the code)
    - `master-panel.js`, `visualizer.js` and `hydra.js`
    - `keys.js` (with MIDI) and `pads.js`
    - `hum-ui.js` and `mp3.js`
    - `settings.js` (also About and Prompts), `share.js` (also updates) and `debug.js`
- `public/lib/`: the song engine's pure logic, with no DOM and no app state, so it is unit-tested in Node:
  - `music.js`: chords, transposing, meters, tempo
  - `scales.js`: scale-name repair
  - `labels.js`: labelled pattern lines
  - `forms.js` and `bands.js`: forms and bands
  - `sheet.js`: song-sheet checks and repair
  - `arrange.js`: section code and arrangement
  - `util.js`: small helpers
  - `events.js`: the player's event emitter
- `public/master.js` (master chain and styles), `format.js` (code wrapping), `hum.js` (humming), `workspace.js` (panels), `sounds.js` (sound guide), `debuglog.js` (the debug log's collector).
- `test/`: unit tests (`*.test.mjs`) and the browser smoke test (`smoke/`).

CI runs the checks, the unit tests, a server check, the browser smoke test and a Docker build on every push and pull request.
Every push to `main` publishes `ghcr.io/eric256/strudel-ai:latest`, and every `v*` tag publishes a versioned image.
To release: bump `version` in `package.json`, add a `CHANGELOG.md` entry, then `git tag vX.Y.Z && git push --tags`.

## License

Strudel is AGPL-3.0-or-later; this project bundles `@strudel/repl` and is therefore distributed under the same license.
