// 🔲 Pads: a 4×4 grid, each pad programmed with a line of Strudel code. Pressing a
// pad adds or removes its line ("padN: …") in the running code on the next beat /
// bar, so pads layer with whatever is playing (and with mute / solo). Statements like
// all(x => x.lpf(400)) or setcpm(140/4) work too. ⏺ Rec writes the pad performance
// into the code as .mask("…") patterns, so it keeps looping.
// (split out of app.js: start-up code runs in setup(), called from app.js)
import { isMine, saveMySongs } from './song-library.js';
import { esc, oneLine } from '../lib/util.js';
import { $, addMsg, beatCycles, docks, evaluateCode, getCode, isPlaying, load, mirror, nextBoundary, nowCycle, queue, save, saved, setupDock, switchCycle } from '../app.js';
import { songsChanged } from './song-lists.js';
export let pads, padsState;
let myPads;
const DEFAULT_PADS = [
  { label: 'kick', code: 's("bd*4").bank("RolandTR909")', mode: 'toggle', color: '#ff5c7a' },
  { label: 'clap', code: 's("~ cp ~ cp").bank("RolandTR909")', mode: 'toggle', color: '#ff5c7a' },
  { label: 'hats', code: 's("hh*8").bank("RolandTR909").velocity("0.5 1").gain(0.6)', mode: 'toggle', color: '#ff5c7a' },
  { label: 'open hat', code: 's("~ oh ~ oh").bank("RolandTR909").gain(0.5)', mode: 'toggle', color: '#ff5c7a' },
  { label: 'snare roll', code: 's("sd*16").bank("RolandTR909").gain(saw.range(0.2, 1))', mode: 'once', color: '#ffd166' },
  { label: 'rim', code: 's("rim(3,8)").bank("RolandTR909").gain(0.7)', mode: 'toggle', color: '#ffd166' },
  { label: 'shaker', code: 's("hh*16").bank("RolandTR808").gain(0.3).pan(sine)', mode: 'toggle', color: '#ffd166' },
  { label: 'crash', code: 's("cr").bank("RolandTR909").gain(0.6)', mode: 'once', color: '#ffd166' },
  { label: 'sub bass', code: 'note("<c1 c1 ab0 bb0>*4").s("sine").gain(0.8)', mode: 'toggle', color: '#20d3a6' },
  { label: 'acid', code: 'note("c2 c3 c2 eb2").s("sawtooth").lpf(sine.range(300, 2000).slow(4)).lpq(10).decay(0.1).sustain(0).gain(0.6)', mode: 'toggle', color: '#20d3a6' },
  { label: 'stabs', code: 'chord("<Cm7 Fm7>").voicing().struct("${offbeats}").s("square").decay(0.1).sustain(0).gain(0.35)', mode: 'toggle', color: '#20d3a6' },
  { label: 'arp', code: 'n("0 2 4 7 4 2").scale("C:minor").fast(2).s("triangle").gain(0.5)', mode: 'toggle', color: '#20d3a6' },
  { label: 'pad', code: 'chord("<Cm9 Ab^7>").voicing().s("gm_pad_warm").gain(0.5)', mode: 'toggle', color: '#7c5cff' },
  { label: 'riser', code: 's("white").lpf(saw.range(200, 8000)).gain(0.25)', mode: 'hold', color: '#7c5cff' },
  { label: 'filter all', code: 'all(x => x.lpf(500))', mode: 'hold', color: '#7c5cff' },
  { label: 'echo all', code: 'all(x => x.delay(0.5).delaytime(0.1875).delayfeedback(0.6))', mode: 'hold', color: '#7c5cff' },
];
export function savePads() {
  if (padsState.owner) { padsState.owner.pads = pads; if (isMine(padsState.owner)) saveMySongs(); }
  else save({ pads: myPads });
}
/** Show a pad set: a song's pads (owner = the song), or null for your own. */
export function loadPads(list, owner = null) {
  if (!list) { pads = myPads; padsState.owner = null; }
  else { pads = Array.from({ length: 16 }, (_, i) => ({ label: '', code: '', mode: 'toggle', color: '#7c5cff', ...(list[i] || {}) })); padsState.owner = owner; if (owner) owner.pads = pads; }
  padsState.sel = null;
  $('padEditor').hidden = true;
  $('padsSource').textContent = owner ? `· ${owner.title}` : '';
  $('padsMine').hidden = !owner;
  renderPads.key = '';
  if (!docks.pads.on) { docks.pads.show(true); save({ padsOn: true }); }
  renderPads();
  songsChanged();
}

const padN = (i) => i + 1;
const isStatement = (code) => /^\s*(all|each|setcp[ms]|samples)\s*\(/.test(code);
const padLineRe = (i) => new RegExp(`^(?:[_S]?pad${padN(i)}:.*|.*// pad${padN(i)}\\s*)$`);
/**
 * A song-part pad (pad.part) is tied to that part's own line in the section that's playing ("bass: …", "_bass: …" when
 * muted). Returns that line, or null when the section doesn't play the part (or plays another variant of it).
 */
function padPartLine(p, code) {
  if (!p?.part) return null;
  const re = new RegExp(`^_?${p.part}:`);
  const line = code.split('\n').find((l) => re.test(l));
  if (!line || (p.variant && p.variant !== 'main' && !line.includes(`${p.part}_${p.variant}`))) return null;
  return line;
}
export const padIsOn = (i, code = getCode()) => {
  const pl = padPartLine(pads[i], code);
  return (pl != null && !pl.startsWith('_')) || code.split('\n').some((l) => padLineRe(i).test(l) && !/^_/.test(l));
};
function padLine(i, codeOverride) {
  const c = oneLine(codeOverride ?? pads[i].code);
  return isStatement(c) ? `${c} // pad${padN(i)}` : `pad${padN(i)}: ${c}`;
}
function codeWithPad(code, i, on, lineText) {
  const lines = code.split('\n').filter((l) => !padLineRe(i).test(l));
  let out = lines.join('\n').replace(/\n+$/, '');
  if (on) out += '\n' + (lineText || padLine(i));
  return out + '\n';
}

/** Switch pad i on/off on the next sync boundary (or now when nothing plays). Returns the switch cycle. */
export async function setPad(i, on, { at = null, lineText = null } = {}) {
  const p = pads[i];
  if (!p?.code.trim()) return null;
  const code = getCode();
  const pl = lineText ? null : padPartLine(p, code);
  // a part the section already plays: the pad mutes / unmutes the section's own line (no extra copy of it)
  const next = pl != null
    ? codeWithPad(code.split('\n').map((l) => (l === pl ? (on ? l.replace(/^_/, '') : l.startsWith('_') ? l : `_${l}`) : l)).join('\n'), i, false)
    : codeWithPad(code, i, on, lineText);
  if (!isPlaying() && !on) { mirror().setCode(next); return null; }
  const when = isPlaying() ? at ?? nextBoundary(padsSyncCycles()) : null;
  const err = await evaluateCode(next, { at: when, label: `pad “${p.label}” ${on ? 'on' : 'off'}`, undo: false });
  if (err) { addMsg('error', `Pad “${p.label}”: ${err.message}`); return null; }
  const c = when ?? 0;
  if (when != null) padsState.pending.set(i, when);
  padsState.rec?.log.push({ i, on, at: c });
  return c;
}

export function renderPads() {
  const code = getCode();
  const now = nowCycle();
  for (const [i, at] of padsState.pending) if (!isPlaying() || now >= at) padsState.pending.delete(i);
  const key = JSON.stringify([pads, padsState.edit, padsState.sel, [...padsState.pending.keys()], pads.map((_, i) => padIsOn(i, code))]);
  if (key === renderPads.key) return;
  renderPads.key = key;
  $('padsGrid').innerHTML = pads.map((p, i) => {
    const on = padIsOn(i, code);
    return `<button class="pad${on ? ' on' : ''}${padsState.pending.has(i) ? ' pending' : ''}${padsState.sel === i && padsState.edit ? ' selected' : ''}" data-i="${i}"
      style="--pc:${esc(p.color || '#7c5cff')}" title="${esc(`${p.label} · ${p.mode}\n${p.code}`)}">
      <span class="pad-label">${esc(p.label || `pad ${i + 1}`)}</span><span class="pad-mode">${p.mode === 'toggle' ? '' : p.mode}</span></button>`;
  }).join('');
}
/** "once": on at the next boundary, off one bar later. */
export async function padOnce(i, lineText = null) {
  const at = await setPad(i, true, { lineText });
  if (at == null || !isPlaying()) return;
  await setPad(i, false, { at: at + 1 });
}

// programming
function selectPad(i) {
  padsState.sel = i;
  const p = pads[i];
  $('padEditor').hidden = false;
  $('padLabel').value = p.label;
  $('padCode').value = p.code;
  $('padMode').value = p.mode;
  $('padColor').value = /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#7c5cff';
  renderPads.key = '';
  renderPads();
}
/** Pad sync in bars: "next beat" follows the playing song's meter. */
function padsSyncCycles() { const v = Number($('padsSync').value); return v < 1 ? beatCycles() : v; }

// ⏺ Rec: bake the pad performance into the code as masks over the recorded bars
function padsRecToggle() {
  if (!padsState.rec) {
    if (!isPlaying()) { addMsg('info', '🔲 start the music first, then record the pads'); return; }
    const start = Math.ceil(nowCycle() - 1e-9);
    padsState.rec = { start, log: [], initial: pads.map((_, i) => padIsOn(i)) };
    $('padsRec').classList.add('on');
    $('padsInfo').textContent = `⏺ recording from bar ${start + 1}…`;
    return;
  }
  const r = padsState.rec;
  padsState.rec = null;
  $('padsRec').classList.remove('on');
  $('padsInfo').textContent = '';
  const end = Math.max(r.start + 1, Math.ceil(switchCycle() - 1e-9));
  const nBars = Math.min(16, end - r.start);
  let code = getCode();
  const baked = [];
  pads.forEach((p, i) => {
    if (isStatement(p.code)) return; // statements can't be masked
    const evs = r.log.filter((e) => e.i === i).sort((a, b) => a.at - b.at);
    if (!evs.length) return;
    const onAt = (t) => { let v = r.initial[i]; for (const e of evs) if (e.at <= t + 1e-6) v = e.on; return v; };
    const bars = [];
    for (let b = 0; b < nBars; b++) {
      const beats = [0, 1, 2, 3].map((q) => (onAt(r.start + b + q / 4) ? 1 : 0));
      bars.push(beats.every((x) => x === beats[0]) ? String(beats[0]) : `[${beats.join(' ')}]`);
    }
    if (bars.every((x) => x === '0')) { code = codeWithPad(code, i, false); return; }
    const ordered = Array.from({ length: nBars }, (_, k) => bars[((k - r.start) % nBars + nBars) % nBars]);
    const mask = nBars === 1 ? ordered[0].replace(/^\[|\]$/g, '') : `<${ordered.join(' ')}>`;
    code = codeWithPad(code, i, true, `pad${padN(i)}: (${oneLine(p.code)}).mask("${mask}")`);
    baked.push(p.label);
  });
  if (!baked.length) { addMsg('info', '🔲 nothing to record — no pads changed while recording'); return; }
  evaluateCode(code, { at: nextBoundary(1), label: 'recorded pads' }).then((err) => {
    if (err) addMsg('error', `Couldn't write the pad recording: ${err.message}`);
    else addMsg('info', `🔲 pad performance written into the code (${baked.join(', ')}) — it loops every ${nBars} bar${nBars > 1 ? 's' : ''}`);
  });
}
/** Follow the song: whenever a new song starts, its pads replace the ones in the dock. */
export function setPadsFollow(on) {
  padsState.follow = on;
  $('padsFollow').checked = on;
  save({ padsFollow: on });
  const cur = queue.songs[queue.current];
  if (on && queue.running && cur?.pads && padsState.owner !== cur) loadPads(cur.pads, cur);
  songsChanged();
}

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  myPads = (load().pads || DEFAULT_PADS).map((p, i) => ({ ...DEFAULT_PADS[i], ...p }));
  pads = myPads;
  // owner: null = your own pads; a song = that song's pads (edits are saved with the song)
  padsState = { edit: false, sel: null, pending: new Map(), rec: null, owner: null, follow: !!saved.padsFollow };
  setInterval(() => { if (docks.pads?.on) renderPads(); }, 150);

  $('padsGrid').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.pad');
    if (!b) return;
    e.preventDefault();
    const i = Number(b.dataset.i);
    if (padsState.edit) { selectPad(i); return; }
    const p = pads[i];
    if (p.mode === 'toggle') setPad(i, !padIsOn(i));
    else if (p.mode === 'once') padOnce(i);
    else { // hold
      $('padsGrid').setPointerCapture(e.pointerId);
      padsState.holding = { i, at: setPad(i, true) };
    }
  });
  for (const ev of ['pointerup', 'pointercancel']) {
    $('padsGrid').addEventListener(ev, async () => {
      const h = padsState.holding;
      if (!h) return;
      padsState.holding = null;
      const onAt = await h.at;
      const sync = padsSyncCycles();
      // play at least one sync step
      setPad(h.i, false, { at: isPlaying() ? Math.max(nextBoundary(sync), (onAt ?? 0) + sync) : null });
    });
  }
  for (const id of ['padLabel', 'padCode', 'padMode', 'padColor']) {
    $(id).addEventListener('input', () => {
      const p = pads[padsState.sel];
      if (!p) return;
      if ($('padCode').value !== p.code) { delete p.part; delete p.variant; } // new code: no longer the song's part
      Object.assign(p, { label: $('padLabel').value, code: $('padCode').value, mode: $('padMode').value, color: $('padColor').value });
      savePads();
      renderPads.key = '';
    });
  }
  $('padsEdit').onclick = () => {
    padsState.edit = !padsState.edit;
    $('padsEdit').classList.toggle('on', padsState.edit);
    $('padsEdit').textContent = padsState.edit ? '✓ done programming' : '✎ program';
    if (padsState.edit) selectPad(padsState.sel ?? 0);
    else $('padEditor').hidden = true;
    renderPads.key = '';
  };
  $('padDone').onclick = () => { if (padsState.edit) $('padsEdit').onclick(); };
  $('padTest').onclick = () => { const i = padsState.sel; if (i != null) padOnce(i, padLine(i, $('padCode').value)); };
  if (load().padsSync) $('padsSync').value = load().padsSync;
  $('padsSync').onchange = () => save({ padsSync: $('padsSync').value });
  $('padsRec').onclick = padsRecToggle;
  $('padsMine').onclick = () => { setPadsFollow(false); loadPads(null); };
  $('padsFollow').checked = padsState.follow;
  $('padsFollow').onchange = () => setPadsFollow($('padsFollow').checked);
  setupDock('pads', { onShow: () => { renderPads.key = ''; renderPads(); } });
}
