# Strudel AI — feature tour

Screenshots of every part of the app, taken with `npm run screenshots` (the app in a real browser, with a demo AI that writes the song "Neon Rain"). See the [README](../README.md) for how each feature works.

## Three modes

### 📻 Radio: stations write songs for you
Pick or describe a station, put it on air, and an AI agent keeps inventing, writing and playing songs for its theme. The code of the section that's playing is in the editor, and the panels on the right show the station, the playlist and the song that's playing.
![Radio mode](screenshots/01-radio-mode.png)

| 📻 Station | 📃 Playlist | 🎶 Now playing |
|---|---|---|
| ![Station](screenshots/02-station.png) | ![Playlist](screenshots/03-playlist.png) | ![Now playing](screenshots/04-now-playing.png) |
| The theme, form and band for its songs, and what's on air. | What's playing and coming up: play next, reorder, remove, loop. | The song's sheet, its sections with live progress, ⏭ go, ⏸ hold, and its toolbar (✎ edit, ★ favorite, 📁 save, MP3, 🎸 band, 📻 station, link). |

**🎵 Songs:** this session's songs, ★ Favorites (shared on the server) and 📁 My songs (saved, with import / export).
![Songs](screenshots/05-songs.png)

### 🎼 Studio: work on one song with the AI
The chat changes the song open in ✎ Edit song; a new song described in the chat is written, plays and opens there.
![Studio mode](screenshots/06-studio-mode.png)

**✎ Edit song:** the song's title, tempo, meter, scale, master style, ending and feel; melody and hook; sections on a timeline (bars, chords, key, tempo, volume, solo, ⏭ go, 🔁 loop); the arrangement; chord progressions; and the parts.
![Song editor](screenshots/07-song-editor.png)

**Arrangement:** which parts play in each section (variants, coming in / dropping out). The playhead line follows the song.
![Arrangement with playhead](screenshots/08-arrangement-playhead.png)

**🧩 Part editor:** one part on its own — ▶ loop it (solo or with its section), shape its effects with sliders, and change its notes.

Melodies on a staff (click to place or move a note, arrows / octave / length / rest on the selected one):
![Part editor: staff](screenshots/09-part-editor-staff.png)

Drums on a grid (one row per sound), with velocity as level bars:
![Part editor: drums](screenshots/10-part-editor-drums.png)

Chord-tone arpeggios on a grid, and the part's effects:
![Part editor: chord tones](screenshots/11-part-editor-chord-tones.png)

### ⌨ Jam: live-code with the AI
You and the AI write one piece of code in the editor; 🎼 Make it a song grows the jam into a whole song in Studio.
![Jam mode](screenshots/12-jam-mode.png)

## Play along

| 🔲 Pads | 🎹 Keys |
|---|---|
| ![Pads](screenshots/13-pads.png) | ![Keys](screenshots/14-keys.png) |
| Trigger one-shots, loops and effects; the AI can program them. | Play any sound from the keyboard or mouse, record into the code. |

## Mix and master

| 🎚 Mixer | 🎛 Master |
|---|---|
| ![Mixer](screenshots/15-mixer.png) | ![Master](screenshots/16-master.png) |
| A channel per part: level, EQ, pan, mute / solo, meters. | The master style of the song: EQ, filter, drive, reverb, echo, glue, width and loudness. |

## Visuals

| 📊 Visualizer | 🌀 Hydra |
|---|---|
| ![Visualizer](screenshots/17-visualizer.png) | ![Hydra](screenshots/18-hydra.png) |
| Piano roll, oscilloscope, spectrum, vectorscope and meters. | Hydra visuals that move with the music, in a panel or behind the code. |

## Panels anywhere
Every panel docks, tabs, splits, floats, pops out into its own window or pins on top.
![Floating panel](screenshots/19-floating-panel.png)

## ⚙ Settings
| General | 🤖 AI | 🎸 Bands |
|---|---|---|
| ![General](screenshots/20-settings-general.png) | ![AI](screenshots/21-settings-ai.png) | ![Bands](screenshots/22-settings-bands.png) |
| 🎼 Song forms | 📻 Stations | 🎨 Theme |
| ![Song forms](screenshots/23-settings-forms.png) | ![Stations](screenshots/24-settings-stations.png) | ![Theme](screenshots/25-settings-themes.png) |

**🧩 Plugins:** panels, buttons, settings pages, themes, bands, forms, stations, sounds, AI instructions and template overrides.
![Plugins](screenshots/26-settings-plugins.png)

## 🎨 Themes
| Light | Synthwave |
|---|---|
| ![Light theme](screenshots/27-theme-light.png) | ![Synthwave theme](screenshots/27-theme-synthwave.png) |
