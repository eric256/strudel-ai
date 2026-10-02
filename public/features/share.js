// Version + self-update. The server stamps index.html with its build id; we poll
// /api/version and, when a new build is deployed, save the session and reload —
// right away if nothing is playing, otherwise as soon as playback stops.
// (split out of app.js: start-up code runs in setup(), called from app.js)
import { hum } from './hum-ui.js';
import { $, addMsg, decodeRecording, engine, fmtTime, getCode, isPlaying, live, load, mirror, parseSongs, queue, rec, recordingForShare, save, setListText, startReplay, state, stopSetlist, takeSeconds } from '../app.js';
import { stopSet } from './song-writer.js';
import { loadSharedSong } from './song-lists.js';
export let APP_VERSION, APP_BUILD;

const RESUME_KEY = 'strudel-ai:resume';
export const upd = { available: null, reloading: false };

export function saveSession() {
  try {
    const msgs = $('messages').cloneNode(true);
    msgs.querySelectorAll('.actions, .typing').forEach((n) => n.remove());
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({
      messages: msgs.innerHTML,
      history: state.history,
      versions: state.versions.slice(-30),
      lastAICode: state.lastAICode ?? null,
      input: $('input').value,
      fromVersion: APP_VERSION,
      at: Date.now(),
    }));
  } catch {}
}
function restoreSession() {
  let r;
  try { r = JSON.parse(sessionStorage.getItem(RESUME_KEY) || 'null'); sessionStorage.removeItem(RESUME_KEY); } catch {}
  if (!r || Date.now() - r.at > 5 * 60 * 1000) return;
  $('messages').innerHTML = r.messages || $('messages').innerHTML;
  state.history = r.history || [];
  state.versions = r.versions || [];
  state.lastAICode = r.lastAICode;
  $('undo').disabled = state.versions.length === 0;
  if (r.input) $('input').value = r.input;
  addMsg('info', r.fromVersion !== APP_VERSION ? `⬆ updated v${r.fromVersion} → v${APP_VERSION} — your code and chat were kept` : `⬆ updated to build ${APP_BUILD} — your code and chat were kept`);
}

const canReloadNow = () => !isPlaying() && !state.busy && !hum.recording && !engine.running && !queue.running && !state.pending;
export function reloadForUpdate() {
  if (upd.reloading) return;
  upd.reloading = true;
  saveSession();
  location.reload();
}
async function checkForUpdate() {
  try {
    const v = await fetch('/api/version', { cache: 'no-store' }).then((r) => r.json());
    if (!v.build || v.build === APP_BUILD || APP_BUILD === 'dev') return;
    upd.available = v;
    if (canReloadNow()) return reloadForUpdate();
    const pill = $('updatePill');
    pill.hidden = false;
    pill.textContent = `⬆ v${v.version} ready — applies when you stop`;
    pill.title = 'A new version was deployed. Click to update now (stops the music).';
  } catch {}
}

async function openSharedSong() {
  const m = location.pathname.match(/^\/s\/([A-Za-z0-9]{6,16})$/);
  if (!m) return;
  history.replaceState(null, '', '/'); // a refresh shouldn't overwrite later edits with the shared song again
  try {
    const r = await fetch(`/api/share/${m[1]}`);
    const song = await r.json();
    if (!r.ok) throw new Error(song.error || r.status);
    const prev = getCode();
    if (prev.trim() && prev.trim() !== song.code.trim()) {
      state.versions.push(prev); // your previous code stays reachable via ↶ Undo
      $('undo').disabled = false;
    }
    mirror().setCode(song.code);
    if (song.setText && !queue.running) Object.assign(queue, { mode: 'set', songs: parseSongs(song.setText), current: -1, nextSong: 0 });
    state.lastAICode = song.code;
    live.applied = song.code;
    const title = song.title ? `“${song.title}”` : 'a shared song';
    const take = decodeRecording(song.recording);
    if (song.song?.steps?.length) {
      const sg = loadSharedSong(song.song);
      addMsg('info', `🔗 Opened the song ${title} — ${sg.blocks.length} sections, ${sg.bars} bars${sg.sheet ? `, ${sg.sheet.bpm} bpm in ${sg.sheet.key}` : ''}. Press ▶ Play this song in the 🎵 Songs tab. Your previous code is one ↶ Undo away.`);
    } else if (take) {
      rec.last = take; // sharing again keeps the recording
      mirror().setCode(take.events[0].code);
      const div = addMsg('info', `🔗 Opened ${title} — a recording of ${take.events.length} timed change${take.events.length > 1 ? 's' : ''} (${fmtTime(takeSeconds(take))}). Your previous code is one ↶ Undo away. `);
      const b = document.createElement('button');
      b.textContent = '⏺ Play the recording';
      b.onclick = () => startReplay(take, song.title);
      div.appendChild(b);
    } else {
      addMsg('info', `🔗 Opened ${title}${song.setText ? ' (with its set list)' : ''} — press ▶ Play. Your previous code is one ↶ Undo away.`);
    }
    document.title = song.title ? `${song.title} · Strudel AI` : document.title;
  } catch (e) {
    addMsg('error', `Couldn't open shared song: ${e.message}`);
  }
}

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  APP_VERSION = document.querySelector('meta[name="app-version"]')?.content || 'dev';
  APP_BUILD = document.querySelector('meta[name="app-build"]')?.content || 'dev';
  $('appVersion').textContent = 'v' + APP_VERSION;
  $('appVersion').title = `build ${APP_BUILD}`;
  $('updatePill').onclick = () => { mirror()?.stop(); stopSet(); stopSetlist(); reloadForUpdate(); };
  setInterval(() => {
    if (upd.available && canReloadNow()) reloadForUpdate();
  }, 1000);
  setInterval(checkForUpdate, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  restoreSession();

  // ---------------------------------------------------------------------------
  // Share links: /s/<id> opens a song stored on the server.
  // ---------------------------------------------------------------------------
  $('shareBtn').onclick = (e) => {
    e.stopPropagation();
    const pop = $('sharePop');
    pop.hidden = !pop.hidden;
    if (!pop.hidden) {
      $('shareResult').hidden = true;
      $('shareSetlist').checked = !!setListText() && load().shareSetlist !== false;
      const take = rec.take?.events.length ? rec.take : rec.last;
      $('shareRecWrap').hidden = !take;
      $('shareRec').checked = !!take && load().shareRec !== false;
      if (take) {
        const n = take.events.length;
        $('shareRecInfo').textContent = `${n} change${n > 1 ? 's' : ''} · ${fmtTime(takeSeconds(take))}${rec.take === take ? ' so far' : ''}`;
      }
      $('shareTitle').focus({ preventScroll: true });
    }
  };
  document.addEventListener('click', (e) => {
    if (!$('sharePop').hidden && !e.target.closest('.share-wrap')) $('sharePop').hidden = true;
  });
  $('shareSetlist').onchange = () => save({ shareSetlist: $('shareSetlist').checked });
  $('shareRec').onchange = () => save({ shareRec: $('shareRec').checked });
  $('shareCreate').onclick = async () => {
    const btn = $('shareCreate');
    btn.disabled = true;
    btn.textContent = 'creating…';
    try {
      const r = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: getCode(),
          title: $('shareTitle').value.trim(),
          setText: $('shareSetlist').checked ? setListText() : null,
          recording: $('shareRec').checked && !$('shareRecWrap').hidden ? recordingForShare() : null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      const url = location.origin + j.path;
      $('shareUrl').value = url;
      $('shareOpen').href = url;
      $('shareResult').hidden = false;
      $('shareUrl').select();
      try { await navigator.clipboard.writeText(url); $('shareCopy').textContent = '✓ Copied'; } catch { $('shareCopy').textContent = '📋 Copy'; }
    } catch (e) {
      addMsg('error', `Share failed: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create link';
    }
  };
  $('shareCopy').onclick = async () => {
    try { await navigator.clipboard.writeText($('shareUrl').value); $('shareCopy').textContent = '✓ Copied'; }
    catch { $('shareUrl').select(); document.execCommand?.('copy'); }
  };
  openSharedSong();
}
