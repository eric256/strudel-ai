// ---------------------------------------------------------------------------
// 📃 Playlist: the songs coming up (and the ones that played). Songs get here from 💬 Chat (✨ new song, plays next),
// from 🎵 Songs (＋ Playlist, ⤴ Play next, ▶ Play) and from a 📻 Station on air, which adds its songs to the end.
// Upcoming songs can be moved, removed or played now; the playlist is written ahead of time while it plays.
// ---------------------------------------------------------------------------
import { render } from '../html.js';
import { T, onTemplatesChange } from '../templates/index.js';
import { songMeta, songsChanged } from './song-lists.js';
import { jumpToSong, retrySong, startPlaylist, stopStation } from './song-writer.js';
import { $, addMsg, dropQueuedSongs, engine, isPlaying, player, queue, save, saved, showPanel } from '../app.js';
import { onceAFrame } from '../lib/events.js';

/** Every song written or opened this session (🎵 Songs → This session), newest last. */
export const sessionSongs = [];
export function addSessionSong(sg) {
  if (sg && !sessionSongs.includes(sg) && !sg.copyOf) sessionSongs.push(sg);
}

/** A song that already played (or is playing) is queued again as a copy, so every playlist entry is its own. */
function copyForPlaylist(sg) {
  return {
    ...sg, copyOf: sg.copyOf || sg, status: sg.blocks ? 'ready' : 'waiting', error: null, phase: null, firstStep: null, take: null, playedAt: null,
    blocks: sg.blocks ? sg.blocks.map((b) => ({ ...b, status: b.code ? 'ready' : 'waiting', startedAt: undefined })) : null,
  };
}

/**
 * The order of the songs after the playing one changed: take back the sections of later songs the engine already
 * queued, and carry on writing / queueing from the song after the last one it keeps.
 */
function requeue() {
  if (!queue.running) return;
  const kept = dropQueuedSongs(queue.songs[queue.current]);
  const k = kept ? queue.songs.indexOf(kept) : -1;
  queue.nextSong = Math.max(queue.current + 1, k + 1);
  for (let j = queue.nextSong; j < queue.songs.length; j++) {
    const sg = queue.songs[j];
    if (sg.status === 'ready' && !sg.blocks) sg.status = 'waiting';
  }
}

/**
 * Add a song: at the end ('end'), right after the playing one ('next'), or play it now ('now'). A song already coming
 * up is moved; one that already played is queued again. Nothing playing: the playlist starts.
 */
export function addToPlaylist(sg, { at = 'end' } = {}) {
  if (!sg) return null;
  let song = sg;
  const was = queue.songs.indexOf(sg);
  if (was > queue.current) {
    if (at === 'end') { addMsg('info', `📃 “${sg.title}” is already in the playlist`); return sg; }
    queue.songs.splice(was, 1);
    if (was < queue.nextSong) queue.nextSong--;
  } else if (was >= 0) song = copyForPlaylist(sg);
  song.from ||= 'you';
  addSessionSong(sg);
  // next: right after the playing song (nothing playing yet: after the song being written for it)
  const pos = at === 'end' ? queue.songs.length : queue.current >= 0 || !queue.running ? Math.max(0, queue.current + 1) : Math.min(queue.nextSong, queue.songs.length);
  queue.songs.splice(pos, 0, song);
  if (queue.running && (was > queue.current || pos < queue.nextSong)) requeue();
  if (!queue.running) startPlaylist({ at: at === 'end' ? queue.current + 1 : pos });
  else if (at === 'now') jumpToSong(pos);
  if (at === 'end') addMsg('info', `📃 “${song.title}” added to the playlist${queue.songs.length - queue.current - 1 > 1 ? ` (${queue.songs.length - queue.current - 1} coming up)` : ''}`);
  if (at === 'next' && sg.from !== 'chat') addMsg('info', `⤴ “${song.title}” plays next`);
  songsChanged();
  return song;
}

/** Take an upcoming song out of the playlist. */
export function removeFromPlaylist(k) {
  if (k <= queue.current || !queue.songs[k]) return;
  const [sg] = queue.songs.splice(k, 1);
  if (k < queue.nextSong) queue.nextSong--;
  requeue();
  addMsg('info', `✕ “${sg.title}” removed from the playlist`);
  songsChanged();
}
/** Move an upcoming song up (-1) or down (+1). */
export function moveInPlaylist(k, dir) {
  const j = k + dir;
  if (k <= queue.current || j <= queue.current || !queue.songs[k] || !queue.songs[j]) return;
  [queue.songs[k], queue.songs[j]] = [queue.songs[j], queue.songs[k]];
  requeue();
  songsChanged();
}
/** Remove every upcoming song (the playing one plays on). */
export function clearUpcoming() {
  const n = queue.songs.length - queue.current - 1;
  if (n <= 0) return;
  queue.songs.splice(queue.current + 1);
  queue.nextSong = Math.min(queue.nextSong, queue.songs.length);
  requeue();
  addMsg('info', `📃 cleared ${n} upcoming song${n > 1 ? 's' : ''}${queue.station ? ' — the station keeps adding new ones (■ Stop it in 📻 Station)' : ''}`);
  songsChanged();
}

const ICON = { waiting: '·', writing: '✎', ready: '✓', playing: '▶', done: '✔', failed: '✗' };
const source = (sg) => (sg.from === 'station' ? `📻 ${sg.station || 'station'}` : sg.from === 'chat' ? '✨ chat' : '📁 added');

/** What a playlist row shows (templates/playlist.js → playlistRow). */
function rowView(sg, k, kind, section) {
  const meta = kind === 'now' ? `${section ? `${section} · ` : ''}${songMeta(sg)}` : songMeta(sg);
  return {
    song: sg, k, kind, status: sg.status, icon: kind === 'now' ? (isPlaying() ? '▶' : '⏸') : ICON[sg.status] || '·',
    title: sg.title, source: source(sg), meta: meta || sg.desc || '', error: sg.error || '', failed: sg.status === 'failed',
    first: k - 1 <= queue.current, last: k + 1 >= queue.songs.length,
  };
}
const rowActions = {
  retry: (sg) => retrySong(sg),
  now: (sg) => jumpToSong(queue.songs.indexOf(sg)),
  next: (sg) => addToPlaylist(sg, { at: 'next' }),
  up: (sg) => moveInPlaylist(queue.songs.indexOf(sg), -1),
  down: (sg) => moveInPlaylist(queue.songs.indexOf(sg), 1),
  remove: (sg) => removeFromPlaylist(queue.songs.indexOf(sg)),
  again: (sg) => addToPlaylist(sg, { at: 'next' }),
};

export function renderPlaylist() {
  const playingNow = queue.running && queue.current >= 0 ? queue.songs[queue.current] : null;
  const section = engine.steps.find((x) => x.status === 'playing')?.prompt;
  const entries = queue.songs.map((sg, k) => ({ sg, k }));
  const upcoming = entries.filter(({ k }) => k > queue.current);
  const played = entries.filter(({ k }) => k < queue.current || (!queue.running && k === queue.current)).slice(-8);
  render(T.playlistStation(queue.station ? { name: queue.station.name, planning: !!queue.planning } : null, { stop: stopStation }), $('plStation'));
  render(T.playlist({
    played: played.map(({ sg, k }) => rowView(sg, k, 'played')),
    now: playingNow ? rowView(playingNow, queue.current, 'now', section) : null,
    upcoming: upcoming.map(({ sg, k }) => rowView(sg, k, 'up')),
  }, rowActions), $('playlist'));
  $('plClear').disabled = !upcoming.length;
}

export function setup() {
  if (saved.setLoop !== undefined) $('setLoop').checked = saved.setLoop;
  $('setLoop').onchange = () => { save({ setLoop: $('setLoop').checked }); songsChanged(); };
  $('plClear').onclick = clearUpcoming;
  $('playlistOpen')?.addEventListener('click', () => showPanel('playlist'));
  const soon = onceAFrame(renderPlaylist);
  for (const e of ['section', 'song', 'transport', 'songs']) player.on(e, soon);
  setInterval(renderPlaylist, 1000);
  onTemplatesChange(soon);
  renderPlaylist();
}
