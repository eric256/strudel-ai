// ---------------------------------------------------------------------------
// ⬆ Promotion: work grows from one mode into the next.
//   ⌨ Jam → 🎼 song: the jam's code becomes the seed of a whole song (same tempo, key, sounds; its groove is the song's
//     main section), written by the AI and opened in 🎼 Studio's song editor.
//   🎵 song → 🎸 band: the song's line-up (its parts' sounds and roles, its master sound) saved as a band.
//   🎵 song → 📻 station: a station that writes music like the song — its genre and description, played by that band.
// ---------------------------------------------------------------------------
import { $, addMsg, getCode, save } from '../app.js';
import { patternLines } from '../lib/labels.js';
import { BAND_ROLES } from '../lib/bands.js';
import { GENRES, detectGenre, genresOf } from '../lib/genres.js';
import { normMeter } from '../lib/music.js';
import { addToPlaylist } from './playlist.js';
import { addBand, bands } from './bands.js';
import { addStation, currentStation } from './stations.js';
import { startStation } from './song-writer.js';
import { editWhenWritten } from './song-editor.js';
import { currentMode, setMode } from './modes.js';
import { songsChanged } from './song-lists.js';

/** The tempo a jam sets (setcpm(120/4) → 120, in 4/4), or null. */
export function jamTempo(code) {
  const m = /setcp([ms])\(\s*([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)/.exec(code || '');
  if (!m) return null;
  const v = Number(m[2]) / (Number(m[3]) || 1);
  const beats = Number(m[3]) || 4;
  return Math.round(m[1] === 'm' ? v * beats : v * 60 * beats);
}

/** ⌨ Jam → 🎼 song: write a whole song from the jam, then open it in the song editor. */
export function promoteJam() {
  const code = getCode();
  const parts = [...new Set(patternLines(code).map((r) => r.base))];
  if (!parts.length && !/\b(s|sound|note|n)\(/.test(code)) { addMsg('error', '⌨ There is no jam to turn into a song yet — write some code first.'); return null; }
  const bpm = jamTempo(code);
  setMode('studio'); // (switching stops the music)
  const song = {
    title: 'New song', autoTitle: true, status: 'waiting', from: 'you',
    desc: `a whole song grown from my jam${parts.length ? ` (its parts: ${parts.join(', ')})` : ''}${bpm ? `, ${bpm} bpm` : ''} — keep its sound and groove`,
    seed: { code },
  };
  addToPlaylist(song, { at: 'now' });
  addMsg('info', '🎼 writing a song from your jam — it plays (and opens in ✎ Edit song) as soon as its first section is ready');
  editWhenWritten(song); // open it in the song editor once it's written
  return song;
}

const unique = (base, taken) => { let n = base, k = 2; while (taken.includes(n)) n = `${base} ${k++}`; return n; };
const tweaksText = (mp) => Object.entries(mp || {}).map(([k, v]) => `${k} ${Math.round(v * 100) / 100}`).join(', ');

/** 🎵 song → 🎸 band: its parts' sounds (by role), its master style and sound, its genre and meter. Returns the band. */
export function bandFromSong(sg) {
  const sh = sg?.sheet;
  if (!sh) return null;
  const genres = [...new Set([...(sh.band ? genresOf(bands.find((b) => b.name === sh.band)) : []), detectGenre(`${sg.desc} ${sh.form}`)].filter(Boolean))];
  const band = {
    name: unique(`${sg.title} band`, bands.map((b) => b.name)),
    genres: genres.join(', '),
    use: `music like “${sg.title}”: ${sg.desc}`.slice(0, 200),
    master: sh.master || 'clean',
    tweaks: tweaksText(sh.masterParams),
    titles: sg.title, // its naming style starts from the song it came from
    meters: normMeter(sh.meter),
    keys: '',
    instruments: sh.parts.map((p) => `${BAND_ROLES.includes(p.role) ? p.role : 'melody'}: ${p.sound} — ${p.desc || p.id}`).join('\n'),
  };
  addBand(band);
  addMsg('info', `🎸 saved the band “${band.name}”: ${sh.parts.length} instruments, master ${band.master} — pick it in 🎵 Songs or 📻 Station, or edit it in ⚙ Settings → 🎸 Bands`);
  return band;
}

/** 🎵 song → 📻 station: a station that writes music like the song, played by its band — and put it on air. */
export function stationFromSong(sg) {
  const sh = sg?.sheet;
  if (!sh) return null;
  const band = bandFromSong(sg);
  const genre = detectGenre(`${sg.desc} ${sh.form}`) || (band && genresOf(band)[0]);
  const theme = `${genre ? `${GENRES[genre].name}: ` : ''}music like “${sg.title}” — ${sg.desc} Around ${sh.bpm} bpm, ${normMeter(sh.meter)}, keys near ${sh.key}; the sound of ${sh.parts.map((p) => p.sound).slice(0, 6).join(', ')}; mastered ${sh.master}. Vary the tempo, key and form from song to song, but keep that feel.`;
  const st = addStation({ name: `${sg.title} Radio`, theme });
  if (currentMode() !== 'radio') setMode('radio'); // (stops the music)
  // its songs are written for the song's band, in the song's form
  if (band) { $('stationBand').value = band.name; save({ stationBand: band.name }); }
  if (sh.form && [...$('stationForm').options].some((o) => o.value === sh.form)) { $('stationForm').value = sh.form; save({ stationForm: sh.form }); }
  startStation(currentStation());
  addMsg('info', `📻 “${st.name}” is on air — songs like “${sg.title}”, played by “${band?.name}”`);
  songsChanged();
  return st;
}

export function setup() {
  $('jamPromote').onclick = () => promoteJam();
}
