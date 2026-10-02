// 📃 Playlist panel (features/playlist.js fills these in).
import { html, nothing, repeat } from '../html.js';
import { T } from './index.js'; // templates use each other through T, so an override shows everywhere

/**
 * One song in the playlist.
 * row: { song (passed back to the actions), k (its place in the playlist), kind: 'played' | 'now' | 'up', status, icon, title, source, meta, error,
 *        failed, first (can't move up), last (can't move down) }
 * act: { retry, now, next, up, down, remove, again } — each called with row.song
 */
export function playlistRow(row, act) {
  const btn = (name, label, title, fn, disabled = false) => html`<button data-pl=${name} title=${title} ?disabled=${disabled} @click=${() => fn(row.song)}>${label}</button>`;
  const buttons = row.kind === 'up'
    ? html`${row.failed
        ? btn('retry', '↻', 'Write it again from scratch', act.retry)
        : btn('now', '▶', 'Play it now (from the next bar line, once its first section is written)', act.now)}
      ${btn('next', '⤴', 'Play it next', act.next)}
      ${btn('up', '↑', 'Move up', act.up, row.first)}
      ${btn('down', '↓', 'Move down', act.down, row.last)}
      ${btn('remove', '✕', 'Remove from the playlist', act.remove)}`
    : row.kind === 'played' ? btn('again', '↺', 'Play it again: queue it next', act.again) : nothing;
  return html`<div class="pl-row ${row.kind} ${row.status}" data-k=${row.k}>
    <span class="ico">${row.icon}</span>
    <div class="body">
      <div class="t">${row.title} <span class="pl-src">${row.source}</span></div>
      <div class="meta">${row.meta}</div>
      ${row.error ? html`<div class="meta bad" title=${row.error}>⚠ ${row.error.slice(0, 120)}</div>` : nothing}
    </div>
    <div class="pl-btns">${buttons}</div>
  </div>`;
}

/**
 * The playlist: what played, what's playing, what's coming up.
 * view: { played: [row], now: row | null, upcoming: [row] } (rows as in playlistRow)
 */
export function playlist(view, act) {
  const rows = (list) => repeat(list, (r) => r.song, (r) => T.playlistRow(r, act));
  return html`
    ${view.played.length ? html`<div class="pl-head">Played</div>${rows(view.played)}` : nothing}
    ${view.now ? html`<div class="pl-head">Now playing</div>${T.playlistRow(view.now, act)}` : nothing}
    <div class="pl-head">Up next${view.upcoming.length ? ` · ${view.upcoming.length}` : ''}</div>
    ${view.upcoming.length
      ? rows(view.upcoming)
      : html`<div class="muted small pl-empty">Nothing coming up. Add songs from 🎵 Songs (＋ Playlist), create one in 💬 Chat (🎯 ✨ new song), or start a 📻 Station.</div>`}`;
}

/** The station line above the playlist. station: { name, planning } or null. act: { stop } */
export function playlistStation(station, act) {
  return station
    ? html`📻 <b>${station.name || 'Station'}</b> is adding songs${station.planning ? ' — planning the next ones…' : ''}
        <button class="link" title="Stop adding songs — the ones already written still play" @click=${act.stop}>■ stop</button>`
    : nothing;
}
