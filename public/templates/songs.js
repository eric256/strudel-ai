// 🎵 Songs, 📻 Station and 🎶 Now playing: song lists, a song's toolbar and the song view (sheet + sections).
// features/song-lists.js and features/song-library.js work out what to show; the buttons with data-act are
// handled there (one click handler per panel).
import { html, nothing, repeat } from '../html.js';
import { T } from './index.js';

/**
 * A song's buttons. tb: { state: 'writing' | 'failed' | 'written', error, canPlay, canEdit, editing, fav, mine,
 *   hasPads, padsFollow, canPromote (a written sheet song: 🎸 Band / 📻 Station), mp3: { kind: 'take' | 'recording' | 'next' | 'record', time, mb, running }, sharing,
 *   renaming }
 */
export function songToolbar(tb) {
  const btn = (act, label, title) => html`<button data-act=${act} title=${title}>${label}</button>`;
  if (tb.state === 'failed') return html`<div class="sv-toolbar">${btn('retry', '↻ Try again', `Write this song again from scratch${tb.error ? ` (last time: ${tb.error})` : ''}`)}</div>`;
  if (tb.state !== 'written') return nothing;
  const m = tb.mp3;
  return html`<div class="sv-toolbar">
      ${tb.canPlay ? btn('play', '▶ Play', 'Play this song from the start now (already written — no AI needed)') : nothing}
      ${tb.canPlay ? btn('next', '⤴ Play next', 'Play this song after the one playing now (📃 Playlist)') : nothing}
      ${tb.canPlay ? btn('queue', '＋ Playlist', 'Add this song to the end of the 📃 Playlist') : nothing}
      ${tb.canEdit ? btn('edit', tb.editing ? '✎ editing…' : '✎ Edit', 'Open this song in the ✎ Edit song panel: sections, chords, parts and their code (or ask the chat)') : nothing}
      ${btn('fav', tb.fav ? '★ favorite' : '☆ Favorite', tb.fav ? 'A favorite on this server — click to remove it from the shared list' : 'Add to ★ Favorites: everyone on this server sees it, and it survives restarts')}
      ${tb.mine ? nothing : btn('save', '📁 Save to My songs', 'Copy this song into 📁 My songs, where you can edit it, keep it and export it')}
      ${tb.hasPads ? btn('pads', tb.padsFollow ? '🔲 song pads ✓' : '🔲 Song pads', tb.padsFollow ? 'Song pads are on: the pad dock switches to each song’s pads as the songs change — click to go back to your own pads' : 'Load this song’s 16 pads (its own parts, key and chords) into the pad dock — and keep switching to each new song’s pads as the songs change') : nothing}
      ${m.kind === 'take' ? btn('mp3', html`⬇ MP3 <span class="muted">${m.time}</span>`, `Download the recording of this song (${m.mb} MB) — kept until the page is reloaded`)
        : m.kind === 'recording' ? btn('mp3', '🎙 recording…', 'Recording this song as it plays — ⬇ MP3 appears when it has played to its end')
        : btn('mp3', m.kind === 'next' ? '🎙 MP3 next time' : '🎙 MP3', m.running ? 'Record this song the next time it plays from the start (the music keeps playing)' : 'Play this song from the start and record it — download the MP3 when it ends')}
      ${tb.canPromote ? btn('band', '🎸 Band', 'Save this song\'s line-up (its sounds, roles and master sound) as a band, to write more songs with') : nothing}
      ${tb.canPromote ? btn('station', '📻 Station', 'Start a station that writes music like this song, played by its band') : nothing}
      ${tb.renaming ? html`<button disabled>🎲 naming…</button>` : btn('rename', '🎲 Rename', 'Give this song a new title: the AI names it again, in another shape (a place, a name, a time, a phrase …), clear of the titles already used')}
      ${btn('json', '⬇ JSON', 'Download the whole song (sheet, parts, sections, pads) as a .json file — import it on any Strudel AI server')}
      ${tb.sharing ? html`<button disabled>creating link…</button>` : btn('link', '🔗 Link', 'Create a link that plays this whole song on this server')}
    </div>`;
}

/** A song's share link (once it has one), with 📋 Copy and open ↗. */
export function sharedLink(url) {
  return url
    ? html`<div class="sv-shared">🔗 <input readonly .value=${url} /><button class="sv-copy">📋 Copy</button><a href=${url} target="_blank" rel="noopener">open ↗</a></div>`
    : nothing;
}

/** The button that opens 🎶 Now playing. */
export function nowPlayingLink() {
  return html`<button class="open-now" data-open-now title="Open the 🎶 Now playing panel: the song's sheet, sections and progress">🎶 Now playing ↗</button>`;
}

/** The buttons shown inside a selected song row: tools: { toolbar, nowLink, shareUrl } */
export function songRowTools(tools) {
  return html`<div class="song-tools">${T.songToolbar(tools.toolbar)}${tools.nowLink ? T.nowPlayingLink() : nothing}${T.sharedLink(tools.shareUrl)}</div>`;
}

/**
 * 🎵 Songs → This session.
 * view: { songs: [{ song, k, status, icon, title, desc, meta, error, selected, tools (for songRowTools) | null }], planning }
 */
export function songList(view) {
  if (!view.songs.length) return html`<div class="muted small">No songs yet — in 💬 Chat pick 🎯 <b>✨ new song</b> and describe one, or play a favorite or one of My songs.</div>`;
  return html`${repeat(view.songs, (r) => r.song, (r) => html`<div class="song ${r.status}${r.selected ? ' selected' : ''}" data-k=${r.k} title="Show this song’s buttons">
      <span class="ico">${r.icon}</span>
      <div class="body"><div class="t">${r.k + 1}. ${r.title}</div><div class="d">${r.desc}</div>
        ${r.meta ? html`<div class="meta">${r.meta}</div>` : nothing}${r.error ? html`<span class="err-icon" title=${r.error}>⚠</span>` : nothing}
        ${r.tools ? T.songRowTools(r.tools) : nothing}</div>
      <button class="jump" data-song=${r.k} title="Play this song now (it joins the 📃 Playlist)">▶</button>
    </div>`)}${view.planning ? html`<div class="song writing"><span class="ico">✎</span><div class="body"><div class="d">planning the next songs…</div></div></div>` : nothing}`;
}

/** 📁 My songs. rows: [{ song, k, playing, selected, title, meta, tools | null }] */
export function mySongsList(rows) {
  if (!rows.length) return html`<div class="muted small">No songs yet — save one from a set or station (☆ / → My songs), or import a .json file.</div>`;
  return repeat(rows, (r) => r.song, (r) => html`<div class="song mine ${r.playing ? 'playing' : 'ready'}${r.selected ? ' selected' : ''}" data-mine=${r.k} title="Show, edit or play this song">
      <span class="ico">${r.playing ? '▶' : '♪'}</span>
      <div class="body"><div class="t">${r.title}</div><div class="meta">${r.meta}</div>${r.tools ? T.songRowTools(r.tools) : nothing}</div>
      <button class="jump" data-mine-play=${r.k} title="Play this song (no AI needed)">▶</button>
      <button class="link" data-mine-del=${r.k} title="Remove from My songs">🗑</button>
    </div>`);
}

/** ★ Favorites. rows: [{ song, k, playing, selected, title, meta, tools | null }] */
export function favoritesList(rows) {
  if (!rows.length) return html`<div class="muted small">No favorites yet — ★ a song you like and everyone on this server will see it here.</div>`;
  return repeat(rows, (r) => r.song, (r) => html`<div class="song fav ${r.playing ? 'playing' : 'ready'}${r.selected ? ' selected' : ''}" data-fav=${r.k} title="Show or play this song">
      <span class="ico">${r.playing ? '▶' : '★'}</span>
      <div class="body"><div class="t">${r.title}</div><div class="meta">${r.meta}</div>${r.tools ? T.songRowTools(r.tools) : nothing}</div>
      <button class="jump" data-fav-play=${r.k} title="Play this song (no AI needed)">▶</button>
    </div>`);
}

/** A part as a coloured chip: { name, color, variant, enter, enterTitle } */
export function partChip(p) {
  return html`<span class="chip part" style="--c:${p.color}">${p.name}${p.variant ? html`<small>.${p.variant}</small>` : nothing}${p.enter ? html`<small title=${p.enterTitle}>@${p.enter}</small>` : nothing}</span>`;
}

/**
 * One section of a song view (a <details>: open it to see its code).
 * s: { j, status, queued, fill, icon, bars, name, fullName (the whole instruction, for block songs), chords, moves,
 *      moveTitle, parts: [partChip], i (its place in the engine, -1 if not queued), error, jumpTitle, code }
 * The .sv-left element is filled in by hand (the progress text): it must stay empty here.
 */
export function songSection(s) {
  return html`<details class="step ${s.status}${s.queued ? ' queued' : ''}${s.fill ? ' fill' : ''}" data-j=${s.j}>
      <summary><span class="ico">${s.icon}</span>
        <span class="bars">${s.bars}</span><span class="prompt">${s.fullName ? html`<span title=${s.fullName}>${s.name}</span>` : s.name}${s.chords
          ? html` <span class="sv-chords">${s.chords}</span>` : nothing}${s.moves ? html` <span class="sv-move${s.j === 0 ? ' first' : ''}" title=${s.moveTitle}>${s.moves}</span>` : nothing}${s.parts.length
          ? html`<span class="sv-parts">${s.parts.map((p) => T.partChip(p))}</span>` : nothing}</span>
        ${s.i >= 0 ? html`<span class="sv-left" data-i=${s.i}></span>` : nothing}${s.error ? html`<span class="err-icon" title=${s.error}>⚠</span>` : nothing}${s.queued ? html`<span class="next">next</span>` : nothing}
        ${s.i >= 0 ? html`<button class="jump" data-i=${s.i} title=${s.jumpTitle}>⏭ go</button>` : nothing}</summary>
      ${s.code ? html`<pre>${s.code}</pre>` : nothing}
    </details>`;
}

/**
 * The song sheet. sheet: { form, sectionCount, bars, band, style, styleDesc, ownMix, bpm, meter, key, scale,
 *   chords: [[name, chords]], melody, hook, parts: [{ id, color, title, sound, tune, poly }] }
 */
export function songSheet(sh) {
  return html`<div class="sv-grid">
      ${sh.form ? html`<span class="k">form</span><span>${sh.form} · ${sh.sectionCount} sections · ${sh.bars} bars</span>` : nothing}
      <span class="k">sound</span><span>${sh.band ? `🎸 ${sh.band} · ` : ''}<span class="chip master-chip" title="${sh.styleDesc} — change it in ✎ Edit or live in 🎛 Master">🎛 ${sh.style}${sh.ownMix ? html` <small>+ own mix</small>` : nothing}</span></span>
      <span class="k">tempo</span><span>${sh.bpm} bpm · ${sh.meter} · ${sh.key} <code>${sh.scale}</code></span>
      <span class="k">chords</span><span>${sh.chords.map(([k, v]) => html`<span class="chip"><b>${k}</b> ${v}</span> `)}</span>
      ${sh.melody ? html`<span class="k">melody</span><span><code>${sh.melody}</code></span>` : nothing}
      <span class="k">hook</span><span><code>${sh.hook}</code></span>
      <span class="k">parts</span><span>${sh.parts.map((p) => html`<span class="chip part" style="--c:${p.color}" title=${p.title}><b>${p.id}</b> ${p.sound}${p.tune ? html` <small>♪ ${p.tune}</small>` : nothing}${p.poly ? html` <small>♫ ${p.poly}</small>` : nothing}</span> `)}</span>
    </div>`;
}

/**
 * A whole song: title, buttons, sheet and sections (🎶 Now playing and ✎ Edit song).
 * v: { title, live, mine, note, desc, toolbar, shareUrl, phase, sheet (songSheet) | null,
 *      sections: [{ key, ...songSection }], hold: null | boolean (null: no hold button), library }
 */
export function songView(v) {
  return html`<div class="sv-head"><b>${v.title}</b>${v.live ? html` <span class="sv-live">▶ playing</span>` : nothing}${v.mine ? html` <span class="sv-mine">📁 My songs</span>` : nothing}${v.note ? html` <span class="sv-stopped">${v.note}</span>` : nothing}</div>
    <div class="sv-desc">${v.desc}</div>
    ${T.songToolbar(v.toolbar)}
    ${T.sharedLink(v.shareUrl)}
    ${v.phase ? html`<div class="sv-phase">✎ ${v.phase}…</div>` : nothing}
    ${v.sheet ? T.songSheet(v.sheet) : nothing}
    ${v.hold != null ? html`<div class="sv-tools"><button class="sv-hold" title="Stay on the current section until you pick another one">${v.hold ? '▶ continue the song' : '⏸ hold this section'}</button>
      <small class="muted">Alt+1…9 jump to a section</small></div>` : nothing}
    ${v.sections.length ? html`<div class="sv-sections">${repeat(v.sections, (s) => s.key, (s) => T.songSection(s))}</div>` : nothing}
    ${v.library ? html`<details class="sv-lib"><summary>parts code (shared by every section)</summary><pre>${v.library}</pre></details>` : nothing}`;
}

/** 📻 Station: the line about its songs. v: { onAir, coming, planning } */
export function stationStatus(v) {
  return v.onAir
    ? html`<div class="muted small">📃 ${v.coming} of its songs coming up in the <button class="link" data-open-playlist>Playlist ↗</button>${v.planning ? ' — planning more…' : ''}</div>`
    : html`<div class="muted small">Start a station and it adds its songs to the end of the 📃 Playlist; the songs already there play first. ■ Stop only stops it adding songs.</div>`;
}

/** 📻 On air box. v: { song: { title, desc, tools } | null, station, waitingNote } */
export function stationNow(v) {
  return v.song
    ? html`📻 <b>On air:</b> ${v.song.title}<div class="d">${v.song.desc}</div>${T.songRowTools(v.song.tools)}`
    : html`📻 <b>${v.station || 'Station'} on air</b><div class="d">${v.waitingNote}</div>`;
}
