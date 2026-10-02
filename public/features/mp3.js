// 🎙 MP3 recording: one tap on the master output (what you hear) feeds MP3
// encoders running in Web Workers (lamejs). Two kinds of recording share it:
//  · song takes: every song is recorded in the background as it plays (from its
//    first section); when it has played to its end the take is kept and the song
//    gets a "⬇ MP3" button. Songs cut short are thrown away. Never touches playback.
//  · the status-bar ⏺ MP3: records everything until clicked again, then downloads.
// (split out of app.js: start-up code runs in setup(), called from app.js)
import { audioCtx } from './hum-ui.js';
import { playSong, slug } from './song-library.js';
import { ensureAudio } from './keys.js';
import { $, addMsg, clog, fmtTime, queue, save, saved, warnUser } from '../app.js';
import { songsChanged, renderSongs } from './song-lists.js';
export let mp3;

const MP3_MAX_TAKES = 20; // takes live in memory for this page; oldest are dropped
function mp3Worker() {
  const lib = new URL('/vendor/lamejs/lame.min.js', location.href).href;
  const src = `importScripts(${JSON.stringify(lib)});
let enc = null; const out = [];
const toI16 = (f) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } return o; };
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'start') { enc = new lamejs.Mp3Encoder(2, m.sampleRate, 192); out.length = 0; }
  else if (m.type === 'data') { const b = enc.encodeBuffer(toI16(m.l), toI16(m.r)); if (b.length) out.push(b); }
  else if (m.type === 'end') { const b = enc.flush(); if (b.length) out.push(b); postMessage(out); }
};`;
  return new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
}
/** Connect (or disconnect, when nothing records) the shared tap on the master output. */
function mp3TapUpdate() {
  const need = !!(mp3.rec || mp3.seg);
  if (need && !mp3.tap) {
    const ctx = audioCtx();
    let node;
    try { node = globalThis.getSuperdoughAudioController().output.destinationGain; } catch { return false; }
    const proc = ctx.createScriptProcessor(4096, 2, 2);
    proc.onaudioprocess = (e) => {
      const l = e.inputBuffer.getChannelData(0), r = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : l;
      if (mp3.paused) return; // ⏸ paused song: the recording pauses too
      for (const sink of [mp3.rec, mp3.seg]) if (sink) sink.worker.postMessage({ type: 'data', l: l.slice(), r: r.slice() });
    };
    node.connect(proc);
    proc.connect(ctx.destination); // a ScriptProcessor only runs when connected; it outputs silence
    mp3.tap = { node, proc };
  } else if (!need && mp3.tap) {
    try { mp3.tap.node.disconnect(mp3.tap.proc); mp3.tap.proc.disconnect(); } catch {}
    mp3.tap = null;
  }
  return true;
}
function mp3Sink(name) {
  const worker = mp3Worker();
  worker.postMessage({ type: 'start', sampleRate: audioCtx().sampleRate });
  return { worker, name, t0: performance.now() };
}
/** Finish an encoder: cb(blob, seconds) once the MP3 is flushed. */
function mp3Finish(sink, cb) {
  const secs = (performance.now() - sink.t0) / 1000;
  if (!cb) { sink.worker.terminate(); return; }
  sink.worker.onmessage = (e) => { sink.worker.terminate(); cb(new Blob(e.data, { type: 'audio/mpeg' }), secs); };
  sink.worker.postMessage({ type: 'end' });
}
const mp3Name = (name) => `${slug(name)}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.mp3`;
function downloadBlob(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---- status-bar ⏺ MP3: record everything ----
async function mp3Start(name = 'strudel-ai') {
  if (mp3.rec) return;
  await ensureAudio();
  mp3.rec = mp3Sink(name);
  if (!mp3TapUpdate()) { mp3Finish(mp3.rec); mp3.rec = null; warnUser('MP3: the audio engine is not ready yet — press ▶ first'); return; }
  $('mp3Btn').classList.add('on');
  clog('info', `🎙 recording MP3 “${name}”…`);
}
function mp3Stop() {
  const r = mp3.rec;
  if (!r) return;
  mp3.rec = null;
  mp3TapUpdate();
  $('mp3Btn').classList.remove('on');
  $('mp3Btn').textContent = '⏺ MP3';
  mp3Finish(r, (blob, secs) => {
    const name = mp3Name(r.name);
    downloadBlob(name, blob);
    clog('ok', `🎙 MP3 saved: ${name} (${fmtTime(secs)}, ${(blob.size / 1e6).toFixed(1)} MB)`);
  });
}

// ---- song takes: recorded in the background, kept when the song plays to its end ----
const recordSongsOn = () => $('recSongs').checked;
/** A section of a song started playing: begin, follow or end the song's take. */
export function mp3SongStep(step) {
  const sg = step.song;
  const idx = sg.blocks?.indexOf(step) ?? -1;
  if (mp3.seg && mp3.seg.sg !== sg) mp3TakeEnd(); // the previous song is over (complete if it reached its last section)
  if (mp3.seg) { mp3.seg.reached = Math.max(mp3.seg.reached, idx); return; }
  if (idx !== 0 || !(recordSongsOn() || mp3.want.has(sg))) return; // takes start at the song's first section
  mp3.seg = Object.assign(mp3Sink(sg.title), { sg, reached: 0 });
  if (!mp3TapUpdate()) { mp3Finish(mp3.seg); mp3.seg = null; return; }
  mp3.want.delete(sg);
  clog('info', `🎙 recording “${sg.title}” in the background — it can be downloaded when the song is over`);
  songsChanged();
}
/** End the current take: keep it if the song got to its last section (and `keep` allows), else drop it. */
export function mp3TakeEnd(keep = true) {
  const seg = mp3.seg;
  if (!seg) return;
  mp3.seg = null;
  mp3TapUpdate();
  const sg = seg.sg, whole = keep && seg.reached >= (sg.blocks?.length || 1) - 1;
  songsChanged();
  if (!whole) { mp3Finish(seg); clog('info', `🎙 “${sg.title}” didn't play to its end — its recording was discarded`); return; }
  mp3Finish(seg, (blob, secs) => {
    if (sg.take) URL.revokeObjectURL(sg.take.url);
    sg.take = { url: URL.createObjectURL(blob), name: mp3Name(sg.title), secs, size: blob.size };
    mp3.takes = mp3.takes.filter((t) => t !== sg).concat(sg);
    while (mp3.takes.length > MP3_MAX_TAKES) { const old = mp3.takes.shift(); URL.revokeObjectURL(old.take.url); delete old.take; }
    clog('ok', `🎙 “${sg.title}” recorded (${fmtTime(secs)}, ${(blob.size / 1e6).toFixed(1)} MB) — ⬇ MP3 in its song view`);
    songsChanged();
    renderSongs();
  });
}
/** The song view's MP3 button: download the take, or record the song next time it plays from the start. */
export function songMp3(sg) {
  if (sg.take) {
    const a = document.createElement('a');
    a.href = sg.take.url;
    a.download = sg.take.name;
    a.click();
    return;
  }
  if (mp3.seg?.sg === sg) return addMsg('info', `🎙 “${sg.title}” is being recorded — ⬇ MP3 appears when it has played to its end`);
  mp3.want.add(sg);
  if (!queue.running) { playSong(sg); return; } // nothing playing: play it now (and record it)
  addMsg('info', `🎙 “${sg.title}” will be recorded the next time it plays from the start — the music keeps playing`);
}

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  mp3 = { rec: null, seg: null, tap: null, takes: [], want: new Set() };
  $('mp3Btn').onclick = () => (mp3.rec ? mp3Stop() : mp3Start(queue.songs[queue.current]?.title || 'strudel-ai'));
  setInterval(() => { if (mp3.rec) $('mp3Btn').textContent = `■ ${fmtTime((performance.now() - mp3.rec.t0) / 1000)}`; }, 500);
  if (saved.recSongs !== undefined) $('recSongs').checked = saved.recSongs;
  $('recSongs').onchange = () => { save({ recSongs: $('recSongs').checked }); if (!recordSongsOn()) mp3TakeEnd(false); songsChanged(); };
}
