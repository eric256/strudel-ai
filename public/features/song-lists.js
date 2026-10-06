// Feature module split out of app.js (see the section comments below).
import { signed } from '../lib/util.js';
import { nothing, render } from '../html.js';
import { T, onTemplatesChange } from '../templates/index.js';
import { addToMySongs, download, favListRows, favOf, favorites, isMine, loadSongIntoSet, myListRows, mySongs, playSong, slug, songFromJSON, songToJSON, toggleFavorite } from './song-library.js';
import { openSongEditor, renderSongEditor, songEdit, updatePlayhead } from './song-editor.js';
import { loadPads, padsState, setPadsFollow } from './pads.js';
import { mp3, songMp3 } from './mp3.js';
import { MASTER_STYLES } from '../master.js';
import { songStyle } from './bands.js';
import { meterBeats, normMeter } from '../lib/music.js';
import { vizColor } from './visualizer.js';
import { patternLines } from '../lib/labels.js';
import { fillPart } from '../lib/sheet.js';
import { SEC_START } from '../lib/arrange.js';
import { onceAFrame } from '../lib/events.js';
import { jumpToSong, retrySong } from './song-writer.js';
import { addToPlaylist, renderPlaylist, sessionSongs } from './playlist.js';
import { currentStation } from './stations.js';
import { bandFromSong, stationFromSong } from './promote.js';
import { renameSong } from './titles.js';
import { $, STATUS_ICON, addMsg, cps, engine, fmtTime, isPlaying, jumpTo, nowCycle, player, queue, setHold, showPanel, ws } from '../app.js';
// ---------------------------------------------------------------------------
// 🎵 Song lists and song views: the Songs and Station panels, 🎶 Now playing and the section progress bars.
// ---------------------------------------------------------------------------
/** 📻 Start puts the picked station on air (or switches to it); ■ Stop is for the station on air. */
export function updateSetButtons() {
  const on = queue.station, picked = currentStation();
  const same = on && on.name === picked.name && on.theme === picked.theme;
  $('stationStart').disabled = !!same;
  $('stationStart').textContent = on && !same ? '📻 Switch to this station' : '📻 Start station';
  $('stationStop').disabled = !on;
}

const SONG_ICON = { waiting: '·', writing: '✎', ready: '✓', playing: '▶', done: '✔', failed: '✗' };
let lastSongsKey = '';
/** Something in the song lists changed: re-render them on the next frame. */
export function songsChanged() { lastSongsKey = ''; player.emit('songs'); }
export const songSel = { set: null }; // the song whose buttons are open in 🎵 Songs: an index in This session, or 'mine:k' / 'fav:k'

export function songMeta(sg) {
  const sh = sg.sheet;
  if (sg.phase) return `✎ ${sg.phase}…`;
  if (!sg.blocks) return sh ? `${sh.bpm} bpm · ${sh.key}` : '';
  const coded = sg.blocks.filter((b) => b.code).length;
  return sh && sg.library
    ? `${sh.bpm} bpm · ${sh.key} · ${sh.sections.length} sections · ${sg.bars} bars · ~${fmtTime((sg.bars * 4 * 60) / sh.bpm)}`
    : `${sg.blocks.length} blocks · ${sg.bars} bars · ${coded}/${sg.blocks.length} coded`;
}
/** What a song's buttons show (templates/songs.js → songToolbar). */
export function toolbarView(sg, live) {
  const isCurrent = live && queue.songs[queue.current] === sg;
  const complete = sg.blocks?.length && sg.blocks.every((b) => b.code) && !sg.phase;
  return {
    state: complete ? 'written' : sg.status === 'failed' && !sg.phase ? 'failed' : 'writing', error: sg.error || '',
    canPlay: !isCurrent, canEdit: !!(sg.sheet && sg.library), editing: songEdit.sg === sg, fav: !!favOf(sg), mine: isMine(sg),
    hasPads: !!sg.pads, padsFollow: padsState.follow, canPromote: !!(sg.sheet && sg.library),
    mp3: sg.take ? { kind: 'take', time: fmtTime(sg.take.secs), mb: (sg.take.size / 1e6).toFixed(1) }
      : mp3.seg?.sg === sg ? { kind: 'recording' }
      : { kind: mp3.want.has(sg) ? 'next' : 'record', running: queue.running },
    sharing: !!sg.sharing,
    renaming: !!sg.renaming,
  };
}
/** The buttons inside a selected song row (templates/songs.js → songRowTools). */
export const rowTools = (sg, live, nowLink = false) => ({ toolbar: toolbarView(sg, live), nowLink, shareUrl: sg.shareUrl || '' });

/** A short name for a block-written section: "intro", "verse 2" … from its instruction, else "section n". */
function shortPrompt(prompt, j) {
  const p = String(prompt || '').trim();
  const m = p.match(/^\s*(intro|verse|pre-?chorus|chorus|hook|bridge|breakdown|break|build|drop|outro|interlude|solo|groove|[AB]\b)[\w\s'-]{0,10}?(?=[:—–,.(-]|\s{2}|$)/i);
  if (m) return m[0].trim();
  const words = p.split(/\s+/).slice(0, 3).join(' ');
  return words.length > 2 ? `${words}…` : `section ${j + 1}`;
}

const ENTER_TITLE = { in: 'comes in halfway through', out: 'drops out halfway through', alt: '2 bars on, 2 bars off' };
/** The parts a section plays, as chips (block sections: the labelled parts in their code). */
function sectionParts(st, sh) {
  const sec = st.section;
  if (!sec) {
    const blockParts = st.code ? [...new Set(patternLines(st.code).filter((r) => !/^pad\d+$/.test(r.base)).map((r) => r.base))] : [];
    return blockParts.map((b) => ({ name: b, color: vizColor(b) }));
  }
  const fill = st.fillStep && fillPart(sh)?.id;
  return sec.play.map((x) => ({
    name: x.part, color: vizColor(x.part),
    variant: fill === x.part ? (typeof st.fillStep === 'string' ? st.fillStep : 'fill') : x.variant !== 'main' ? x.variant : '',
    enter: x.enter && !st.fillStep ? x.enter : '', enterTitle: ENTER_TITLE[x.enter] || '',
  }));
}

/** What the song view shows (templates/songs.js → songView). `note`: shown after the title. */
function songViewModel(sg, live, note = '') {
  const sh = sg.sheet;
  const isCurrent = live && queue.songs[queue.current] === sg;
  const steps = sg.blocks || (sh ? sh.sections.map((sec) => ({ section: sec, bars: sec.bars, prompt: sec.name, status: 'waiting' })) : []);
  // tempo and key of every section, so the lines can mark where they change
  const tempos = steps.map(stepTempo), shifts = steps.map((st) => st.section?.shift || 0);
  const section = (st, j) => {
    const i = engine.steps.indexOf(st);
    const queued = i >= 0 && engine.jumpTarget === i && st.status !== 'armed' && st.status !== 'playing';
    const sec = st.section;
    // mark tempo / key changes against the section before (the first one shows the song's tempo)
    const bpm = tempos[j], prevBpm = j ? tempos[j - 1] : null;
    const moves = [
      bpm && (j === 0 || (prevBpm && bpm !== prevBpm)) ? (j === 0 ? `♩ ${bpm} bpm` : `♩ ${bpm > prevBpm ? '↑' : '↓'} ${bpm} bpm`) : '',
      j > 0 && shifts[j] !== shifts[j - 1] ? `key ${shifts[j] ? signed(shifts[j]) : 'home'}` : '',
    ].filter(Boolean).join(' · ');
    const codeFrom = st.code ? Math.max(0, st.code.indexOf(SEC_START)) : 0;
    return {
      key: sg.blocks ? st : `${sg.title}:${j}`, j, status: st.status, queued, fill: !!st.fillStep,
      icon: queued ? '⏭' : STATUS_ICON[st.status] || '', bars: st.bars,
      name: sec ? st.prompt : shortPrompt(st.prompt, j), fullName: sec ? '' : st.prompt,
      chords: sec && !st.fillStep && !st.gap ? sec.chords : '', moves,
      moveTitle: j === 0 ? 'The song’s tempo' : `Changes here: ${prevBpm && bpm !== prevBpm ? `tempo ${prevBpm} → ${bpm} bpm ` : ''}${shifts[j] !== shifts[j - 1] ? `key ${signed(shifts[j - 1])} → ${signed(shifts[j])} semitones` : ''}`,
      parts: st.gap ? [] : sectionParts(st, sh), i, error: st.error || '',
      jumpTitle: `Switch to this section${j < 9 && isCurrent ? ` (Alt+${j + 1})` : ''}`,
      code: st.code ? st.code.slice(codeFrom) : '',
    };
  };
  return {
    title: sg.title, live: !!isCurrent, mine: isMine(sg), note, desc: sg.desc, toolbar: toolbarView(sg, live), shareUrl: sg.shareUrl || '', phase: sg.phase || '',
    sheet: sh ? {
      form: sh.form || '', sectionCount: sh.sections.length, bars: sh.sections.reduce((a, x) => a + x.bars, 0), band: sh.band || '',
      style: songStyle(sg), styleDesc: MASTER_STYLES[songStyle(sg)]?.desc || '', ownMix: !!(sh.masterParams && Object.keys(sh.masterParams).length),
      bpm: sh.bpm, meter: normMeter(sh.meter), key: sh.key, scale: sh.scale,
      chords: Object.entries(sh.chords).map(([k, v]) => [k, v.replace(/^<|>$/g, '')]), melody: sh.melody || '', hook: sh.hook,
      parts: sh.parts.map((p) => ({ id: p.id, color: vizColor(p.id), sound: p.sound, tune: p.tune || '', poly: [p.voices?.length ? `${p.voices.length + 1} voices` : '', p.layers?.length ? `+ ${p.layers.join(' + ')}` : ''].filter(Boolean).join(' · '),
        title: `${p.role} · ${p.desc}${p.variants.length > 1 ? ` · variants: ${p.variants.join(', ')}` : ''}${p.voices?.length ? ` · voices: ${p.voices.map((v) => v.replace(/_/g, ' ')).join(', ')}` : ''}${p.layers?.length ? ` · layered with ${p.layers.join(', ')}` : ''}` })),
    } : null,
    sections: steps.map(section),
    hold: steps.length && isCurrent ? !!engine.hold : null,
    library: sg.library || '',
  };
}

/** A section's tempo in bpm: from its code's setcpm / setcps line, else its sheet. */
function stepTempo(st) {
  const m = st?.code && /setcp([ms])\(\s*([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)/.exec(st.code);
  const b = meterBeats(st?.song?.sheet?.meter);
  if (m) { const v = Number(m[2]) / (Number(m[3]) || 1); return Math.round(m[1] === 'm' ? v * b : v * 60 * b); }
  return st?.section?.bpm || st?.song?.sheet?.bpm || null;
}
/**
 * Play a song from one of its sections (k: its place in the sheet): jump there if it's the one playing (or paused);
 * otherwise play it again now, starting at that section. hold: stay on that section.
 */
export function playFromSection(sg, k, { hold = false } = {}) {
  if (!sg) return;
  const cur = queue.running && queue.songs[queue.current];
  const root = (x) => x?.copyOf || x;
  if (cur && engine.running && root(cur) === root(sg)) {
    const b = cur.blocks?.find((x) => engine.steps.includes(x) && !x.fillStep && !x.gap && (x.secIndex ?? cur.sheet?.sections.indexOf(x.section)) === k);
    if (b) { jumpTo(engine.steps.indexOf(b)); if (hold) setHold(true); return; }
  }
  sg.startAt = k;
  const song = addToPlaylist(sg, { at: 'now' });
  if (song !== sg) delete sg.startAt; // (a copy plays; the song itself keeps no hint — appendSong clears its own)
  if (hold && song) {
    let tries = 0;
    const wait = setInterval(() => {
      if (song.blocks?.some((x) => x.status === 'playing')) { clearInterval(wait); setHold(true); } else if (++tries > 150) clearInterval(wait);
    }, 100);
  }
}
/** How far the playing section is: { bar, bars, frac, left (seconds until the next section), hold } or null. */
function sectionProgress(st) {
  if (st?.status !== 'playing' || st.startedAt == null || !isPlaying()) return null;
  const now = nowCycle();
  const k = engine.steps.indexOf(st);
  const next = engine.steps.slice(k + 1).find((x) => x.status === 'armed' && x.startedAt != null);
  // the switch: an armed next section, else where the set list will switch next (its bar count when nothing is due)
  const end = next?.startedAt ?? (engine.nextAt != null && engine.nextAt > st.startedAt ? engine.nextAt : st.startedAt + st.bars);
  const len = Math.max(1, end - st.startedAt);
  const pos = Math.max(0, now - st.startedAt);
  const hold = engine.hold && !next;
  return { bar: Math.min(len, Math.floor(pos % (hold ? len : Infinity)) + 1), bars: len, frac: hold ? (pos % len) / len : Math.min(1, pos / len),
    left: Math.max(0, (end - now) / cps()), hold, waiting: !hold && pos >= len };
}
// progress of the playing section in the song views (updated without re-rendering the lists;
// renderSongs calls it right after it rebuilds a view, so the bar never blinks out)
function updateSectionProgress() {
  updatePlayhead(); // ✎ Edit song's arrangement follows the song too
  for (const el of $('nowSongView').querySelectorAll('.sv-left[data-i]')) { // (panels may be in another window)
    const st = engine.steps[Number(el.dataset.i)];
    const sum = el.closest('summary');
    if (engine.paused && engine.paused.step === st) {
      el.textContent = `⏸ paused at bar ${engine.paused.bar + 1}/${st.bars}`;
      sum?.style.setProperty('--p', `${((engine.paused.bar / Math.max(1, st.bars)) * 100).toFixed(1)}%`);
      continue;
    }
    const pr = sectionProgress(st);
    if (!pr) { if (el.textContent) { el.textContent = ''; sum?.style.removeProperty('--p'); } continue; }
    sum?.style.setProperty('--p', `${(pr.frac * 100).toFixed(1)}%`);
    // the next section changes the tempo: say so
    const k = Number(el.dataset.i), nb = stepTempo(engine.steps[k + 1]), cb = stepTempo(st);
    const tempo = !pr.hold && nb && cb && nb !== cb && engine.steps[k + 1]?.song === st.song ? ` · then ${nb > cb ? '↑' : '↓'} ${nb} bpm` : '';
    const text = pr.hold ? `bar ${pr.bar}/${pr.bars} · ⏸ holding`
      : pr.waiting ? 'next section is on its way…'
      : `bar ${pr.bar}/${pr.bars} · next in ${fmtTime(Math.ceil(pr.left))}${tempo}`;
    if (el.textContent !== text) el.textContent = text;
  }
}

export let nowSong = null; // the last song that started playing
/** A song started playing: 🎶 Now playing shows it (and keeps showing it after it ends). */
export const setNowSong = (sg) => { nowSong = sg; };
export function renderSongs() {
  // Songs tab: the running/last set (until the text is edited), otherwise a preview of the text
  const setSongs = sessionSongs;
  const stationSongs = queue.songs.filter((sg, k) => k > queue.current && sg.from === 'station');
  const now = queue.station && queue.running ? queue.songs[queue.current] : null;
  const pick = (tab, list) => {
    if (typeof songSel[tab] === 'string') return null; // a My songs entry is open
    // the station's playing song is in the On air box (and 🎶 Now playing): only an explicit pick opens a row
    const k = songSel[tab]; // only an explicit pick opens a row's buttons (the playing song is in 🎶 Now playing)
    return k != null && list[k] ? k : null;
  };
  const selSet = pick('set', setSongs), selSt = null;
  const setView = viewedSong('set');
  const stepKey = (sg) => sg?.blocks?.map((b) => b.status + (b.code ? b.code.length : 0) + (b.error || '')).join() || '';
  const key = JSON.stringify([queue.running, !!engine.paused, nowSong?.title, stepKey(nowSong), queue.songs.map((x) => `${x.title}:${x.phase || x.status}`).join(), queue.station?.name, queue.planning, now?.title, selSet, selSt, engine.hold, engine.jumpTarget, queue.current,
    ...[setSongs, stationSongs].map((l) => l.map((sg) => [sg.title, sg.status, sg.phase, sg.bars, sg.blocks?.filter((b) => b.code).length, sg.error, !!sg.sheet, sg.shareUrl])),
    stepKey(setView), stepKey(stationSongs[selSt]), stepKey(queue.songs[queue.current]), songSel.set, songEdit.sg?.title, padsState.owner?.title, padsState.follow,
    mySongs.map((sg) => [sg.title, sg.bars, queue.songs[queue.current] === sg]), mp3.seg?.sg?.title || '', mp3.takes.length, mp3.want.size,
    favorites.map((f) => [f.id, queue.songs[queue.current] === f.song])]);
  if (key === lastSongsKey) return;
  lastSongsKey = key;
  render(T.songList({
    songs: setSongs.map((sg, k) => ({
      song: sg, k, status: sg.status, icon: SONG_ICON[sg.status] || '·', title: sg.title, desc: sg.desc, meta: songMeta(sg), error: sg.error || '',
      selected: k === selSet, tools: k === selSet ? rowTools(sg, queue.running, queue.running && queue.songs[queue.current] === sg) : null,
    })),
    planning: queue.running && !!queue.planning,
  }), $('setStatus'));
  render(T.mySongsList(myListRows()), $('mySongs'));
  render(T.favoritesList(favListRows()), $('favSongs'));
  render(T.stationStatus({ onAir: !!queue.station, coming: stationSongs.length, planning: !!queue.planning }), $('stationStatus'));
  updateSetButtons();
  renderPlaylist();
  // 🎶 Now playing: the playing song — or, once it's over, the last one that played (stopped)
  // while a set or station is still writing its first song, show that song (with what's being written)
  const preparing = queue.running && !queue.songs[queue.current] ? queue.songs.find((x) => ['writing', 'waiting', 'ready'].includes(x.status)) : null;
  const playingSong = (queue.running && queue.songs[queue.current]) || preparing || nowSong;
  const nowLive = !!(queue.running && playingSong && queue.songs[queue.current] === playingSong);
  $('nowEmpty').hidden = !!playingSong;
  // ✎ Edit song panel: the editor (rendered when another song is opened) and the song's sections
  const ed = songEdit.sg;
  $('editEmpty').hidden = !!ed;
  if ($('editForm').__sg !== ed) { $('editForm').__sg = ed; renderSongEditor(); }
  void setView;
  // (the views keep their DOM between renders, so opened sections stay open)
  // (✎ Edit song doesn't repeat the song's sections: they're in 🎶 Now playing)
  for (const [id, sg, live] of [['nowSongView', playingSong, nowLive]]) {
    const el = $(id);
    el.hidden = !sg;
    const note = id === 'nowSongView' && sg && !live ? (sg === preparing ? '✎ being written — plays when ready' : '■ stopped') : '';
    render(sg ? T.songView(songViewModel(sg, live, note)) : nothing, el);
  }
  updateSectionProgress();
  const onAir = !!queue.station;
  $('stationNow').hidden = !onAir;
  if (onAir) {
    render(T.stationNow({
      song: now ? { title: now.title, desc: now.desc, tools: rowTools(now, true, true) } : null,
      station: queue.station.name,
      waitingNote: queue.running && queue.songs[queue.current] ? `its songs follow “${queue.songs[queue.current].title}” and the others in the 📃 Playlist` : 'the agent is planning and writing the first song',
    }), $('stationNow'));
  }
}

/** Toolbar actions in a song view. */
export function songAction(act, sg, btn, view) {
  if (act === 'play') { const k = queue.songs.indexOf(sg); if (k > queue.current) jumpToSong(k); else playSong(sg); }
  else if (act === 'next') addToPlaylist(sg, { at: 'next' });
  else if (act === 'queue') addToPlaylist(sg, { at: 'end' });
  else if (act === 'edit') openSongEditor(sg);
  else if (act === 'retry') retrySong(sg);
  else if (act === 'edit-cancel') { ws.close('edit'); songEdit.sg = null; songsChanged(); renderSongs(); }
  else if (act === 'save') addToMySongs(sg);
  else if (act === 'fav') toggleFavorite(sg);
  else if (act === 'pads') {
    if (padsState.owner === sg && padsState.follow) { setPadsFollow(false); loadPads(null); }
    else { loadPads(sg.pads, sg); setPadsFollow(true); }
  }
  else if (act === 'mp3') songMp3(sg);
  else if (act === 'json') download(`${slug(sg.title)}.strudel-song.json`, JSON.stringify(songToJSON(sg), null, 1));
  else if (act === 'link') shareSong(sg);
  else if (act === 'rename') {
    const before = sg.title;
    const done = renameSong(sg);
    songsChanged(); renderPlaylist();
    done.then(() => { addMsg('info', `🎲 “${before}” is now “${sg.title}”`); }, (e) => addMsg('error', `🎲 couldn't rename it: ${e.message}`))
      .finally(() => { songsChanged(); renderPlaylist(); if (songEdit.sg === sg) renderSongEditor(); });
  }
  else if (act === 'band') bandFromSong(sg);
  else if (act === 'station') stationFromSong(sg);
  songsChanged();
}

/** The song shown in a tab's song view (same choice renderSongs makes). */
export function viewedSong(tab) {
  if (tab === 'set' && typeof songSel.set === 'string') {
    const [kind, k] = songSel.set.split(':');
    return (kind === 'fav' ? favorites[Number(k)]?.song : mySongs[Number(k)]) || null;
  }
  return tab === 'set' && songSel.set != null ? sessionSongs[songSel.set] || null : null;
}

/** Share a finished song: its sheet, parts and every arranged section, playable without the AI. */
async function shareSong(sg) {
  if (sg.sharing) return;
  sg.sharing = true; // the 🔗 button shows "creating link…" (the template re-renders it)
  songsChanged();
  try {
    const steps = sg.blocks.map((b) => ({ bars: b.bars, prompt: b.prompt, code: b.code, fade: b.fade ?? null, fillStep: !!b.fillStep, section: b.section || null }));
    const r = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: steps[0].code,
        title: sg.title,
        song: { title: sg.title, desc: sg.desc, sheet: sg.sheet || null, library: sg.library || null, steps },
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    sg.shareUrl = location.origin + j.path;
    try { await navigator.clipboard.writeText(sg.shareUrl); } catch {}
    addMsg('info', `🔗 “${sg.title}” shared: ${sg.shareUrl} (link copied)`);
  } catch (e) {
    addMsg('error', `Sharing “${sg.title}” failed: ${e.message}`);
  }
  sg.sharing = false;
  songsChanged();
  renderSongs();
}

/** A shared whole song: load it into the Songs tab, ready to play without any AI calls. */
export function loadSharedSong(s) {
  let song;
  try { song = songFromJSON(s); }
  catch { // older share format
    song = {
      title: s.title || 'shared song', desc: s.desc || '', status: 'ready', sheet: s.sheet || null, library: s.library || null,
      blocks: s.steps.map((st) => ({ bars: st.bars, prompt: st.prompt, code: st.code, fade: st.fade ?? undefined, fillStep: st.fillStep, section: st.section || undefined, status: 'ready', error: null })),
    };
    song.bars = song.blocks.reduce((a, b) => a + b.bars, 0);
    song.firstStep = song.blocks[0];
  }
  loadSongIntoSet(song);
  songSel.set = sessionSongs.indexOf(song);
  songsChanged();
  showPanel('songs');
  return song;
}

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  // the progress bars move every frame while something plays (smooth, and never a stale bar); stopped, they rest
  {
    let running = false;
    const loop = () => {
      updateSectionProgress();
      if (isPlaying() || engine.paused) requestAnimationFrame(loop); else running = false;
    };
    const start = () => { if (!running) { running = true; requestAnimationFrame(loop); } };
    for (const e of ['section', 'transport', 'songs']) player.on(e, start);
    setInterval(() => (isPlaying() ? start() : updateSectionProgress()), 1000);
  }
  // the song lists re-render when something changes (and once a second for the AI's writing progress)
  {
    const soon = onceAFrame(renderSongs);
    for (const e of ['section', 'song', 'transport', 'songs']) player.on(e, soon);
    setInterval(renderSongs, 1000);
    onTemplatesChange(() => { lastSongsKey = ''; $('editForm').__sg = undefined; soon(); });
  }
  $('stationStatus').addEventListener('click', (e) => { if (e.target.closest('[data-open-playlist]')) showPanel('playlist'); });
  for (const id of ['setStatus']) {
    const tab = 'set';
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('.jump[data-song]');
      if (b) { addToPlaylist(sessionSongs[Number(b.dataset.song)], { at: 'now' }); return; }
      if (e.target.closest('[data-open-now]')) { showPanel('song'); return; }
      // a song's toolbar inside its row (station list)
      const act = e.target.closest('[data-act]');
      const tools = e.target.closest('.song-tools');
      if (tools) {
        const sg = sessionSongs[Number(tools.closest('.song[data-k]')?.dataset.k)];
        if (act && sg) songAction(act.dataset.act, sg, act, tools);
        else if (e.target.closest('.sv-copy') && sg?.shareUrl) navigator.clipboard?.writeText(sg.shareUrl).then(() => { e.target.textContent = '✓ Copied'; }, () => {});
        return;
      }
      const row = e.target.closest('.song[data-k]');
      if (row) { const k = Number(row.dataset.k); songSel[tab] = songSel[tab] === k ? null : k; songsChanged(); renderSongs(); }
    });
  }
  $('stationNow').addEventListener('click', (e) => {
    if (e.target.closest('[data-open-now]')) { showPanel('song'); return; }
    const sg = queue.songs[queue.current], act = e.target.closest('[data-act]');
    if (act && sg) songAction(act.dataset.act, sg, act, $('stationNow'));
    else if (e.target.closest('.sv-copy') && sg?.shareUrl) navigator.clipboard?.writeText(sg.shareUrl).then(() => { e.target.textContent = '✓ Copied'; }, () => {});
  });
  // the ✎ Edit song form: apply / cancel
  $('editForm').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (act && songEdit.sg) songAction(act.dataset.act, songEdit.sg, act, $('editForm'));
  });
  for (const id of ['nowSongView']) {
    $(id).addEventListener('click', (e) => {
      const go = e.target.closest('.jump[data-i]');
      if (go) {
        e.preventDefault(); e.stopPropagation();
        const st = engine.steps[Number(go.dataset.i)];
        // stopped (or another song took over): play this song again from that section
        if (engine.running && st && queue.songs[queue.current] === st.song) jumpTo(Number(go.dataset.i));
        else if (st?.song) playFromSection(st.song, st.secIndex ?? st.song.sheet?.sections.indexOf(st.section) ?? 0);
        return;
      }
      if (e.target.closest('.sv-hold')) { e.preventDefault(); setHold(!engine.hold); renderSongs(); return; }
      const sg = (queue.running && queue.songs[queue.current]) || nowSong;
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act && sg) { songAction(act, sg, e.target.closest('[data-act]'), $(id)); return; }
      if (e.target.closest('.sv-copy') && sg?.shareUrl) {
        navigator.clipboard?.writeText(sg.shareUrl).then(() => { e.target.textContent = '✓ Copied'; }, () => {});
      }
    });
  }

}
