// 📁 Songs as portable data: a song (sheet + parts code, or its section code for
// block-by-block songs, + its pads) is plain JSON, so it can be exported to a file,
// imported on any Strudel AI server, kept in "My songs", edited and logged.
// (split out of app.js: start-up code runs in setup(), called from app.js)
import { importerFor, runImporter, acceptList, onImportersChange } from './importers.js';
import { addSessionSong, addToPlaylist } from './playlist.js';
import { APP_VERSION } from './share.js';
import { arrangeSong } from '../lib/arrange.js';
import { JAM_ARP, JAM_LEAD, padProg, songPads } from './song-pads.js';
import { $, LOG_JSON_MARK, addMsg, clog, queue, showPanel, warnUser } from '../app.js';
import { normalizeSheet } from './bands.js';
import { rowTools, songSel, songsChanged, renderSongs, songAction, songMeta } from './song-lists.js';

export let mySongs;
const SONG_FORMAT = 'strudel-ai-song';
/** Song → JSON. Sheet songs store just the sheet and parts (the sections are re-arranged from them). */
export function songToJSON(sg) {
  const arranged = sg.sheet?.sections && sg.library;
  return {
    format: SONG_FORMAT, version: 1, app: APP_VERSION, saved: new Date().toISOString(),
    title: sg.title, desc: sg.desc || '',
    sheet: sg.sheet || null, library: sg.library || null,
    pads: sg.pads || null,
    steps: arranged ? undefined : (sg.blocks || []).filter((b) => b.code).map((b) => ({ bars: b.bars, prompt: b.prompt, code: b.code, fade: b.fade ?? null })),
  };
}
/** JSON (a file, a share link, a log entry) → song ready to play. Throws when unusable. */
export function songFromJSON(j) {
  if (!j || typeof j !== 'object') throw new Error('not a song');
  const song = { title: String(j.title || 'untitled').slice(0, 120), desc: String(j.desc || ''), status: 'ready', sheet: null, library: null, pads: Array.isArray(j.pads) ? j.pads.slice(0, 16) : null };
  if (j.sheet?.sections?.length && typeof j.library === 'string') {
    // stored sheets are already in the app's form; accept the AI's raw form too
    song.sheet = j.sheet.sections.every((x) => Array.isArray(x.play) && typeof x.play[0] === 'object') ? j.sheet : normalizeSheet(j.sheet, 'auto', { enforceForm: false });
    song.library = j.library;
    song.blocks = arrangeSong(song);
  } else if (Array.isArray(j.steps) && j.steps.length) {
    song.blocks = j.steps.filter((st) => typeof st.code === 'string').map((st) => ({ bars: Number(st.bars) || 8, prompt: String(st.prompt || ''), code: st.code, fade: st.fade ?? undefined, fillStep: !!st.fillStep, section: st.section || undefined, status: 'ready', error: null }));
  } else throw new Error('the song has no sheet and no sections');
  if (!song.blocks.length) throw new Error('the song has no sections');
  song.bars = song.blocks.reduce((a, b) => a + b.bars, 0);
  song.firstStep = song.blocks[0];
  const fresh = songPads(song);
  // older songs' pads referred to the song's library consts (lead_main …), which only exist while the song plays:
  // swap those for the self-contained versions
  const libRef = (c) => !/typeof sectionChords/.test(c) && (/^\s*\(?[A-Za-z]\w*_\w+\)?(\(sectionChords\))?\s*$/.test(c) || /\bsectionChords\b/.test(c));
  song.pads = song.pads && fresh
    ? song.pads.map((p) => {
      // older jam pads played the song's scale, not the chords: give them the chord-following version
      if (/^(arp|lead|jam lead)$/.test(p.label) && /\.scale\(/.test(p.code || '') && /^n\("(0 2 4 7 4 2|<0 \[2 4\] 7 \[4 2\]>)"\)/.test(p.code)) {
        return { ...p, label: p.label === 'lead' ? 'jam lead' : p.label, code: (p.label === 'arp' ? JAM_ARP : JAM_LEAD)(padProg(song.sheet)) };
      }
      const f = fresh.find((q) => q.label === p.label);
      if (!libRef(p.code || '')) return f?.part && !p.part && p.code === f.code ? { ...p, part: f.part, variant: f.variant } : p;
      return f ? { ...p, code: f.code, part: f.part, variant: f.variant } : { ...p, code: p.code.replace(/\bsectionChords\b/g, padProg(song.sheet)) };
    })
    : song.pads || fresh;
  return song;
}
export const slug = (t) => String(t || 'song').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song';
export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// --- My songs (kept in this browser, separate from the settings)
export const MY_SONGS_KEY = 'strudel-ai:songs';
export function saveMySongs() {
  try { localStorage.setItem(MY_SONGS_KEY, JSON.stringify(mySongs.map(songToJSON))); }
  catch (e) { warnUser(`Couldn't save My songs (browser storage full?): ${e.message}`); }
  songsChanged();
}
export const isMine = (sg) => mySongs.includes(sg);
export function addToMySongs(sg) {
  const copy = songFromJSON(JSON.parse(JSON.stringify(songToJSON(sg))));
  mySongs.unshift(copy);
  saveMySongs();
  songSel.set = 'mine:0';
  showPanel('songs');
  clog('ok', `📁 “${copy.title}” saved to My songs`);
  return copy;
}
/** 📁 My songs rows (templates/songs.js → mySongsList). */
export function myListRows() {
  return mySongs.map((sg, k) => {
    const selected = songSel.set === `mine:${k}`;
    return { song: sg, k, playing: queue.running && queue.songs[queue.current] === sg, selected, title: sg.title, meta: songMeta(sg), tools: selected ? rowTools(sg, false) : null };
  });
}
/** A song opened from a link or a file: listed in 🎵 Songs → This session, ready to play or queue. */
export function loadSongIntoSet(song) {
  addSessionSong(song);
  songsChanged();
}
/** ▶ Play: the song plays now (from the next bar line) and joins the 📃 Playlist; what was coming up still follows. */
export function playSong(song) {
  addToPlaylist(song, { at: 'now' });
}
/** A click on a song's buttons inside a list row. Returns true when handled. */
function rowToolsClick(e, sg) {
  const tools = e.target.closest('.song-tools');
  if (!tools || !sg) return false;
  const act = e.target.closest('[data-act]');
  if (act) songAction(act.dataset.act, sg, act, tools);
  else if (e.target.closest('.sv-copy') && sg.shareUrl) navigator.clipboard?.writeText(sg.shareUrl).then(() => { e.target.textContent = '✓ Copied'; }, () => {});
  return true;
}

// --- ★ Favorites: shared with everyone on this server (stored server-side, survive restarts)
export let favorites = []; // [{ id, favorited, song (object) }]
export async function loadFavorites() {
  try {
    const j = await fetch('/api/favorites', { cache: 'no-cache' }).then((r) => r.json());
    const keep = new Map(favorites.map((f) => [f.id, f]));
    favorites = (j.favorites || []).map((f) => {
      if (keep.has(f.id)) return keep.get(f.id); // keep the same object (it may be playing)
      try { return { id: f.id, favorited: f.favorited, song: songFromJSON(f.song) }; } catch { return null; }
    }).filter(Boolean);
    songsChanged();
  } catch (e) { clog('warn', `favorites unavailable: ${e.message}`); }
}
const favKey = (sg) => `${sg.title}\n${sg.library || ''}`;
export const favOf = (sg) => favorites.find((f) => f.song === sg || favKey(f.song) === favKey(sg));
export async function toggleFavorite(sg) {
  const f = favOf(sg);
  try {
    if (f) {
      if (!confirm(`Remove “${sg.title}” from the favorites everyone on this server sees?`)) return;
      await fetch(`/api/favorites/${f.id}`, { method: 'DELETE' });
      clog('ok', `★ “${sg.title}” removed from favorites`);
    } else {
      const r = await fetch('/api/favorites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song: songToJSON(sg) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      clog('ok', `★ “${sg.title}” is now a favorite on this server`);
    }
    await loadFavorites();
  } catch (e) { warnUser(`Favorite failed: ${e.message}`); }
  renderSongs();
}
/** ★ Favorites rows (templates/songs.js → favoritesList). */
export function favListRows() {
  return favorites.map((f, k) => {
    const sg = f.song;
    const selected = songSel.set === `fav:${k}`;
    return { song: f, k, playing: queue.running && queue.songs[queue.current] === sg, selected, title: sg.title, meta: songMeta(sg), tools: selected ? rowTools(sg, false) : null };
  });
}

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  mySongs = (() => {
    try { return (JSON.parse(localStorage.getItem(MY_SONGS_KEY)) || []).map((j) => { try { return songFromJSON(j); } catch { return null; } }).filter(Boolean); }
    catch { return []; }
  })();
  $('mySongs').addEventListener('click', (e) => {
    if (rowToolsClick(e, mySongs[Number(e.target.closest('[data-mine]')?.dataset.mine)])) return;
    const play = e.target.closest('[data-mine-play]');
    if (play) { const k = Number(play.dataset.minePlay); songSel.set = `mine:${k}`; playSong(mySongs[k]); return; }
    const del = e.target.closest('[data-mine-del]');
    if (del) {
      const k = Number(del.dataset.mineDel);
      if (!confirm(`Remove “${mySongs[k].title}” from My songs?`)) return;
      mySongs.splice(k, 1);
      if (songSel.set === `mine:${k}`) songSel.set = null;
      saveMySongs(); renderSongs();
      return;
    }
    const row = e.target.closest('[data-mine]');
    if (row) { const v = `mine:${row.dataset.mine}`; songSel.set = songSel.set === v ? null : v; songsChanged(); renderSongs(); }
  });
  // ⬆ import offers the importers' files too
  const accept = () => { $('songImport').accept = acceptList(); };
  accept();
  onImportersChange(accept);
  $('songImport').onchange = async () => {
    const f = $('songImport').files[0];
    $('songImport').value = '';
    if (!f) return;
    // a file a 🧩 plugin's importer reads (MusicXML …)
    const imp = importerFor(f);
    if (imp) {
      try {
        clog('info', `⬆ ${imp.icon || ''} ${imp.label || imp.id}: reading ${f.name}…`);
        const list = (await runImporter(imp, f)).map((j) => songFromJSON(j));
        mySongs.unshift(...list);
        saveMySongs();
        songSel.set = 'mine:0';
        renderSongs();
        clog('ok', `📁 imported ${list.map((x) => `“${x.title}”`).join(', ')} from ${f.name}`);
        addMsg('info', `📁 ${imp.icon || '⬆'} imported ${list.map((x) => `“${x.title}”`).join(', ')} from ${f.name} into My songs`);
      } catch (e) {
        warnUser(`Couldn't import ${f.name} (${imp.label || imp.id}): ${e.message}`);
      }
      return;
    }
    try {
      const text = await f.text();
      let data;
      try { data = JSON.parse(text); } catch {
        const at = text.indexOf(LOG_JSON_MARK);
        if (at < 0) throw new Error('no song JSON in this file');
        data = JSON.parse(text.slice(text.indexOf('\n', at) + 1));
      }
      const list = (Array.isArray(data) ? data : data.songs || [data]).map((j) => songFromJSON(j.json || j));
      mySongs.unshift(...list);
      saveMySongs();
      songSel.set = 'mine:0';
      renderSongs();
      clog('ok', `📁 imported ${list.length} song${list.length > 1 ? 's' : ''}: ${list.map((x) => x.title).join(', ')}`);
      addMsg('info', `📁 imported ${list.map((x) => `“${x.title}”`).join(', ')} into My songs`);
    } catch (e) {
      warnUser(`Couldn't import songs: ${e.message}`);
    }
  };
  $('favSongs').addEventListener('click', (e) => {
    if (rowToolsClick(e, favorites[Number(e.target.closest('[data-fav]')?.dataset.fav)]?.song)) return;
    const play = e.target.closest('[data-fav-play]');
    if (play) { const k = Number(play.dataset.favPlay); songSel.set = `fav:${k}`; playSong(favorites[k].song); return; }
    const row = e.target.closest('[data-fav]');
    if (row) { const v = `fav:${row.dataset.fav}`; songSel.set = songSel.set === v ? null : v; songsChanged(); renderSongs(); }
  });
  loadFavorites();
  setInterval(loadFavorites, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadFavorites(); });
}
