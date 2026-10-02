// Feature module split out of app.js (see the section comments below).
import { signed } from '../lib/util.js';
import { html, nothing, render, repeat } from '../html.js';
import { addToMySongs, download, favListTemplate, favOf, favorites, isMine, loadSongIntoSet, myListTemplate, mySongs, playSong, slug, songFromJSON, songToJSON, toggleFavorite } from './song-library.js';
import { openSongEditor, saveSongEditor, songEdit, songEditorTemplate } from './song-editor.js';
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
const NOW_LINK = html`<button class="open-now" data-open-now title="Open the 🎶 Now playing panel: the song's sheet, sections and progress">🎶 Now playing ↗</button>`;
/** A song's share link (once it has one), with 📋 Copy and open ↗. */
export const sharedLinkTemplate = (sg) => (sg.shareUrl
  ? html`<div class="sv-shared">🔗 <input readonly .value=${sg.shareUrl} /><button class="sv-copy">📋 Copy</button><a href=${sg.shareUrl} target="_blank" rel="noopener">open ↗</a></div>`
  : nothing);
/** A song list. With `tools`, the selected song shows its toolbar in place (the details live in 🎶 Now playing). */
function songListTemplate(songs, live, sel, { tools = false } = {}) {
  return html`${repeat(songs, (sg) => sg, (sg, k) => {
    const meta = songMeta(sg);
    const isCurrent = live && queue.songs[queue.current] === sg;
    return html`<div class="song ${sg.status}${k === sel ? ' selected' : ''}" data-k=${k} title=${tools ? 'Show this song’s buttons' : 'Show this song’s sheet and sections'}>
      <span class="ico">${SONG_ICON[sg.status] || '·'}</span>
      <div class="body"><div class="t">${k + 1}. ${sg.title}</div><div class="d">${sg.desc}</div>
        ${meta ? html`<div class="meta">${meta}</div>` : nothing}${sg.error ? html`<span class="err-icon" title=${sg.error}>⚠</span>` : nothing}
        ${tools && k === sel ? html`<div class="song-tools">${songToolbarTemplate(sg, live)}${isCurrent ? NOW_LINK : nothing}${sharedLinkTemplate(sg)}</div>` : nothing}</div>
      <button class="jump" data-song=${k} title="Play this song now (it joins the 📃 Playlist)">▶</button>
    </div>`;
  })}${live && queue.planning ? html`<div class="song writing"><span class="ico">✎</span><div class="body"><div class="d">planning the next songs…</div></div></div>` : nothing}`;
}

/** A song's toolbar: play, edit, favorite, save, song pads, MP3, JSON, link (only once the song is written). */
export function songToolbarTemplate(sg, live) {
  const sh = sg.sheet;
  const isCurrent = live && queue.songs[queue.current] === sg;
  const complete = sg.blocks?.length && sg.blocks.every((b) => b.code) && !sg.phase;
  const btn = (act, label, title) => html`<button data-act=${act} title=${title}>${label}</button>`;
  if (!complete) {
    return sg.status === 'failed' && !sg.phase
      ? html`<div class="sv-toolbar">${btn('retry', '↻ Try again', `Write this song again from scratch${sg.error ? ` (last time: ${sg.error})` : ''}`)}</div>`
      : nothing;
  }
  const canPlay = !isCurrent;
  return html`<div class="sv-toolbar">
      ${canPlay ? btn('play', '▶ Play', 'Play this song from the start now (already written — no AI needed)') : nothing}
      ${canPlay ? btn('next', '⤴ Play next', 'Play this song after the one playing now (📃 Playlist)') : nothing}
      ${canPlay ? btn('queue', '＋ Playlist', 'Add this song to the end of the 📃 Playlist') : nothing}
      ${sh && sg.library ? btn('edit', songEdit.sg === sg ? '✎ editing…' : '✎ Edit', 'Open this song in the ✎ Edit song panel: sections, chords, parts and their code (or ask the chat)') : nothing}
      ${btn('fav', favOf(sg) ? '★ favorite' : '☆ Favorite', favOf(sg) ? 'A favorite on this server — click to remove it from the shared list' : 'Add to ★ Favorites: everyone on this server sees it, and it survives restarts')}
      ${isMine(sg) ? nothing : btn('save', '📁 Save to My songs', 'Copy this song into 📁 My songs, where you can edit it, keep it and export it')}
      ${sg.pads ? btn('pads', padsState.follow ? '🔲 song pads ✓' : '🔲 Song pads', padsState.follow ? 'Song pads are on: the pad dock switches to each song’s pads as the songs change — click to go back to your own pads' : 'Load this song’s 16 pads (its own parts, key and chords) into the pad dock — and keep switching to each new song’s pads as the songs change') : nothing}
      ${sg.take ? btn('mp3', html`⬇ MP3 <span class="muted">${fmtTime(sg.take.secs)}</span>`, `Download the recording of this song (${(sg.take.size / 1e6).toFixed(1)} MB) — kept until the page is reloaded`)
        : mp3.seg?.sg === sg ? btn('mp3', '🎙 recording…', 'Recording this song as it plays — ⬇ MP3 appears when it has played to its end')
        : btn('mp3', mp3.want.has(sg) ? '🎙 MP3 next time' : '🎙 MP3', queue.running ? 'Record this song the next time it plays from the start (the music keeps playing)' : 'Play this song from the start and record it — download the MP3 when it ends')}
      ${btn('json', '⬇ JSON', 'Download the whole song (sheet, parts, sections, pads) as a .json file — import it on any Strudel AI server')}
      ${sg.sharing ? html`<button disabled>creating link…</button>` : btn('link', '🔗 Link', 'Create a link that plays this whole song on this server')}
    </div>`;
}

/** A short name for a block-written section: "intro", "verse 2" … from its instruction, else "section n". */
function shortPrompt(prompt, j) {
  const p = String(prompt || '').trim();
  const m = p.match(/^\s*(intro|verse|pre-?chorus|chorus|hook|bridge|breakdown|break|build|drop|outro|interlude|solo|groove|[AB]\b)[\w\s'-]{0,10}?(?=[:—–,.(-]|\s{2}|$)/i);
  if (m) return m[0].trim();
  const words = p.split(/\s+/).slice(0, 3).join(' ');
  return words.length > 2 ? `${words}…` : `section ${j + 1}`;
}

const ENTER_TITLE = { in: 'comes in halfway through', out: 'drops out halfway through', alt: '2 bars on, 2 bars off' };
/** The parts a section plays, as coloured chips (block sections: the labelled parts in their code). */
function sectionParts(st, sh) {
  const sec = st.section;
  if (!sec) {
    const blockParts = st.code ? [...new Set(patternLines(st.code).filter((r) => !/^pad\d+$/.test(r.base)).map((r) => r.base))] : [];
    return blockParts.map((b) => html`<span class="chip part" style="--c:${vizColor(b)}">${b}</span>`);
  }
  const fill = st.fillStep && fillPart(sh)?.id;
  return sec.play.map((x) => html`<span class="chip part" style="--c:${vizColor(x.part)}">${x.part}${x.variant !== 'main'
    ? html`<small>.${fill === x.part ? 'fill' : x.variant}</small>` : fill === x.part ? html`<small>.fill</small>` : nothing}${x.enter && !st.fillStep
    ? html`<small title=${ENTER_TITLE[x.enter]}>@${x.enter}</small>` : nothing}</span>`);
}

/** The song sheet and the sections of one song, with live status and jump buttons. `note`: shown after the title. */
function songViewTemplate(sg, live, note = '') {
  const sh = sg.sheet;
  const isCurrent = live && queue.songs[queue.current] === sg;
  const steps = sg.blocks || (sh ? sh.sections.map((sec) => ({ section: sec, bars: sec.bars, prompt: sec.name, status: 'waiting' })) : []);
  // tempo and key of every section, so the lines can mark where they change
  const tempos = steps.map(stepTempo), shifts = steps.map((st) => st.section?.shift || 0);
  const section = (st, j) => {
    const i = engine.steps.indexOf(st);
    const queued = i >= 0 && engine.jumpTarget === i && st.status !== 'armed' && st.status !== 'playing';
    const sec = st.section;
    const parts = sectionParts(st, sh);
    // mark tempo / key changes against the section before (the first one shows the song's tempo)
    const bpm = tempos[j], prevBpm = j ? tempos[j - 1] : null;
    const moves = [
      bpm && (j === 0 || (prevBpm && bpm !== prevBpm)) ? (j === 0 ? `♩ ${bpm} bpm` : `♩ ${bpm > prevBpm ? '↑' : '↓'} ${bpm} bpm`) : '',
      j > 0 && shifts[j] !== shifts[j - 1] ? `key ${shifts[j] ? signed(shifts[j]) : 'home'}` : '',
    ].filter(Boolean).join(' · ');
    const moveTitle = j === 0 ? 'The song’s tempo' : `Changes here: ${prevBpm && bpm !== prevBpm ? `tempo ${prevBpm} → ${bpm} bpm ` : ''}${shifts[j] !== shifts[j - 1] ? `key ${signed(shifts[j - 1])} → ${signed(shifts[j])} semitones` : ''}`;
    const codeFrom = st.code ? Math.max(0, st.code.indexOf(SEC_START)) : 0;
    // (.sv-left is filled in by updateSectionProgress: it has no template values inside)
    return html`<details class="step ${st.status}${queued ? ' queued' : ''}${st.fillStep ? ' fill' : ''}" data-j=${j}>
      <summary><span class="ico">${queued ? '⏭' : STATUS_ICON[st.status] || ''}</span>
        <span class="bars">${st.bars}</span><span class="prompt">${sec ? st.prompt : html`<span title=${st.prompt}>${shortPrompt(st.prompt, j)}</span>`}${sec && !st.fillStep
          ? html` <span class="sv-chords">${sec.chords}</span>` : nothing}${moves ? html` <span class="sv-move${j === 0 ? ' first' : ''}" title=${moveTitle}>${moves}</span>` : nothing}${parts.length
          ? html`<span class="sv-parts">${parts}</span>` : nothing}</span>
        ${i >= 0 ? html`<span class="sv-left" data-i=${i}></span>` : nothing}${st.error ? html`<span class="err-icon" title=${st.error}>⚠</span>` : nothing}${queued ? html`<span class="next">next</span>` : nothing}
        ${i >= 0 ? html`<button class="jump" data-i=${i} title="Switch to this section${j < 9 && isCurrent ? ` (Alt+${j + 1})` : ''}">⏭ go</button>` : nothing}</summary>
      ${st.code ? html`<pre>${st.code.slice(codeFrom)}</pre>` : nothing}
    </details>`;
  };
  return html`<div class="sv-head"><b>${sg.title}</b>${isCurrent ? html` <span class="sv-live">▶ playing</span>` : nothing}${isMine(sg) ? html` <span class="sv-mine">📁 My songs</span>` : nothing}${note ? html` <span class="sv-stopped">${note}</span>` : nothing}</div>
    <div class="sv-desc">${sg.desc}</div>
    ${songToolbarTemplate(sg, live)}
    ${sharedLinkTemplate(sg)}
    ${sg.phase ? html`<div class="sv-phase">✎ ${sg.phase}…</div>` : nothing}
    ${sh ? html`<div class="sv-grid">
      ${sh.form ? html`<span class="k">form</span><span>${sh.form} · ${sh.sections.length} sections · ${sh.sections.reduce((a, x) => a + x.bars, 0)} bars</span>` : nothing}
      <span class="k">sound</span><span>${sh.band ? `🎸 ${sh.band} · ` : ''}<span class="chip master-chip" title="${MASTER_STYLES[songStyle(sg)]?.desc || ''} — change it in ✎ Edit or live in 🎛 Master">🎛 ${songStyle(sg)}${sh.masterParams && Object.keys(sh.masterParams).length ? html` <small>+ own mix</small>` : nothing}</span></span>
      <span class="k">tempo</span><span>${sh.bpm} bpm · ${normMeter(sh.meter)} · ${sh.key} <code>${sh.scale}</code></span>
      <span class="k">chords</span><span>${Object.entries(sh.chords).map(([k, v]) => html`<span class="chip"><b>${k}</b> ${v.replace(/^<|>$/g, '')}</span> `)}</span>
      <span class="k">hook</span><span><code>${sh.hook}</code></span>
      <span class="k">parts</span><span>${sh.parts.map((p) => html`<span class="chip part" style="--c:${vizColor(p.id)}" title="${p.role} · ${p.desc}${p.variants.length > 1 ? ` · variants: ${p.variants.join(', ')}` : ''}"><b>${p.id}</b> ${p.sound}</span> `)}</span>
    </div>` : nothing}
    ${steps.length && isCurrent ? html`<div class="sv-tools"><button class="sv-hold" title="Stay on the current section until you pick another one">${engine.hold ? '▶ continue the song' : '⏸ hold this section'}</button>
      <small class="muted">Alt+1…9 jump to a section</small></div>` : nothing}
    ${steps.length ? html`<div class="sv-sections">${repeat(steps, (st, j) => (sg.blocks ? st : `${sg.title}:${j}`), section)}</div>` : nothing}
    ${sg.library ? html`<details class="sv-lib"><summary>parts code (shared by every section)</summary><pre>${sg.library}</pre></details>` : nothing}`;
}

/** A section's tempo in bpm: from its code's setcpm / setcps line, else its sheet. */
function stepTempo(st) {
  const m = st?.code && /setcp([ms])\(\s*([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)/.exec(st.code);
  const b = meterBeats(st?.song?.sheet?.meter);
  if (m) { const v = Number(m[2]) / (Number(m[3]) || 1); return Math.round(m[1] === 'm' ? v * b : v * 60 * b); }
  return st?.section?.bpm || st?.song?.sheet?.bpm || null;
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
  for (const el of document.querySelectorAll('.sv-left[data-i]')) {
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
  render(setSongs.length ? songListTemplate(setSongs, queue.running, selSet, { tools: true })
    : html`<div class="muted small">No songs yet — in 💬 Chat pick 🎯 <b>✨ new song</b> and describe one, or play a favorite or one of My songs.</div>`, $('setStatus'));
  render(myListTemplate(), $('mySongs'));
  render(favListTemplate(), $('favSongs'));
  render(queue.station
    ? html`<div class="muted small">📃 ${stationSongs.length} of its songs coming up in the <button class="link" data-open-playlist>Playlist ↗</button>${queue.planning ? ' — planning more…' : ''}</div>`
    : html`<div class="muted small">Start a station and it adds its songs to the end of the 📃 Playlist; the songs already there play first. ■ Stop only stops it adding songs.</div>`, $('stationStatus'));
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
  if ($('editForm').__sg !== ed) { $('editForm').__sg = ed; render(ed?.sheet && ed.library ? songEditorTemplate(ed) : nothing, $('editForm')); }
  void setView;
  // (the views keep their DOM between renders, so opened sections stay open)
  for (const [id, sg, live] of [['editSongView', ed, !!(queue.running && queue.songs[queue.current] === ed)], ['nowSongView', playingSong, nowLive]]) {
    const el = $(id);
    el.hidden = !sg;
    const note = id === 'nowSongView' && sg && !live ? (sg === preparing ? '✎ being written — plays when ready' : '■ stopped') : '';
    render(sg ? songViewTemplate(sg, live, note) : nothing, el);
  }
  updateSectionProgress();
  const onAir = !!queue.station;
  $('stationNow').hidden = !onAir;
  if (onAir) {
    render(now
      ? html`📻 <b>On air:</b> ${now.title}<div class="d">${now.desc}</div><div class="song-tools">${songToolbarTemplate(now, true)}${NOW_LINK}${sharedLinkTemplate(now)}</div>`
      : html`📻 <b>${queue.station.name || 'Station'} on air</b><div class="d">${queue.running && queue.songs[queue.current] ? `its songs follow “${queue.songs[queue.current].title}” and the others in the 📃 Playlist` : 'the agent is planning and writing the first song'}</div>`, $('stationNow'));
  }
}

/** Toolbar actions in a song view. */
export function songAction(act, sg, btn, view) {
  if (act === 'play') { const k = queue.songs.indexOf(sg); if (k > queue.current) jumpToSong(k); else playSong(sg); }
  else if (act === 'next') addToPlaylist(sg, { at: 'next' });
  else if (act === 'queue') addToPlaylist(sg, { at: 'end' });
  else if (act === 'edit') openSongEditor(sg);
  else if (act === 'retry') retrySong(sg);
  else if (act === 'edit-save') saveSongEditor($('editForm').querySelector('.sv-edit'), songEdit.sg || sg);
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
  for (const id of ['editSongView', 'nowSongView']) {
    $(id).addEventListener('click', (e) => {
      const go = e.target.closest('.jump[data-i]');
      if (go) { e.preventDefault(); e.stopPropagation(); jumpTo(Number(go.dataset.i)); return; }
      if (e.target.closest('.sv-hold')) { e.preventDefault(); setHold(!engine.hold); renderSongs(); return; }
      const sg = id === 'nowSongView' ? (queue.running && queue.songs[queue.current]) || nowSong : songEdit.sg;
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act && sg) { songAction(act, sg, e.target.closest('[data-act]'), $(id)); return; }
      if (e.target.closest('.sv-copy') && sg?.shareUrl) {
        navigator.clipboard?.writeText(sg.shareUrl).then(() => { e.target.textContent = '✓ Copied'; }, () => {});
      }
    });
  }

}
