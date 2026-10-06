// ---------------------------------------------------------------------------
// 🎲 Song titles: every AI-named song is named by its own short request — the app picks the title's shape (and now and
// then a world to take the image from and a starting letter), shows a few titles in the style of the song's genre or
// band, and checks what comes back against the titles already used (kept across sessions, with My songs). A refused
// title goes back with the reason (up to 3 tries). 🎲 Rename on a song names it again.
// ---------------------------------------------------------------------------
import { clog, queue } from '../app.js';
import { requestLLM } from './llm.js';
import { sessionSongs } from './playlist.js';
import { mySongs, isMine, saveMySongs } from './song-library.js';
import { bands } from './bands.js';
import { findIn } from '../lib/forms.js';
import { detectGenre, GENRES } from '../lib/genres.js';
import { checkTitle, cleanTitle, fallbackTitle, titleExamples, titlePattern, titleRequest } from '../lib/titles.js';

const KEY = 'strudel-ai.titles';
/** Titles named before (this browser, newest last). */
let past = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]').filter((x) => typeof x === 'string'); } catch { return []; } })();
/** The shapes used lately (so the next title takes another). */
const recentShapes = [];

/** Keep a title in the history (so later songs keep clear of it). */
export function rememberTitle(t) {
  if (!t) return;
  past = [...past.filter((x) => x.toLowerCase() !== t.toLowerCase()), t].slice(-300);
  try { localStorage.setItem(KEY, JSON.stringify(past)); } catch {}
}
/** Every title in sight, newest last: the history, My songs, this session's songs and the playlist (not `song`'s). */
function allTitles(song) {
  const others = [...(mySongs || []), ...sessionSongs, ...queue.songs].filter((x) => x && x !== song && !x.autoTitle).map((x) => x.title);
  return [...new Set([...past, ...others].filter((t) => t && t !== 'New song'))];
}

/** The genre and band a song's title takes its style from. */
function styleOf(song, { genre = null, band = null } = {}) {
  const b = band || findIn(bands || [], song.sheet?.band) || findIn(bands || [], queue.station?.band) || null;
  const g = genre || detectGenre(`${song.title} ${song.desc}`) || detectGenre(b?.use) || (song.from === 'station' ? detectGenre(queue.station?.theme) : null);
  return { genre: g, band: b };
}

/**
 * Name a song: its own short request (a shape, examples, the titles to avoid), checked; refused ones go back with the
 * reason, up to 3 tries; then the last try with a number. Returns the title (the song isn't changed).
 */
export async function nameSong(song, { signal, genre = null, band = null, avoid = [] } = {}) {
  const style = styleOf(song, { genre, band });
  const all = allTitles(song), recent = [...all.slice(-80), ...avoid];
  const pattern = titlePattern({ recent: recentShapes });
  recentShapes.push(pattern.shape.id);
  if (recentShapes.length > 6) recentShapes.shift();
  const examples = titleExamples({ genre: style.genre, band: style.band });
  const desc = [song.desc, song.sheet && `${song.sheet.bpm} bpm, ${song.sheet.key}`, style.band && `played by the ${style.band.name}`].filter(Boolean).join(' — ');
  const refused = [];
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const content = titleRequest({ desc, genre: style.genre ? GENRES[style.genre].name : '', pattern, examples, avoid: recent.slice(-40), refused });
    const text = await requestLLM({ mode: 'title', messages: [{ role: 'user', content }], signal, label: `title for “${String(song.desc).slice(0, 30)}…”`, temperature: 1, effort: 'low' });
    const t = cleanTitle(text);
    last = t || last;
    const why = checkTitle(t, recent, all);
    if (!why) { clog('ok', `🎲 “${t}” (${pattern.shape.id}${pattern.letter ? `, ${pattern.letter}…` : ''}${pattern.world ? `, ${pattern.world}` : ''})`); return t; }
    clog('warn', `🎲 title “${t}” refused: ${why}`);
    refused.push({ title: t, why });
  }
  return fallbackTitle(last || String(song.desc).split(/[,.;]/)[0].split(/\s+/).slice(0, 3).join(' '), all);
}

/** Give a song a title (and remember it). */
export function setTitle(song, t) {
  song.title = t;
  song.autoTitle = false;
  rememberTitle(t);
  if (isMine(song)) saveMySongs();
}

/** 🎲 Rename: a new title for a song (a different shape than its current one). */
export async function renameSong(song) {
  if (song.renaming) return;
  song.renaming = true;
  try { setTitle(song, await nameSong(song, { avoid: [song.title] })); }
  finally { song.renaming = false; }
}
