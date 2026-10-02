// Mute / solo per line. Every labelled pattern line ("$:", "bass:", …) gets
// M and S buttons. They toggle Strudel's own syntax — "_$:" mutes a line,
// "S$:" solos it — and the change switches in exactly on the next beat.
// (split out of app.js: start-up code runs in setup(), called from app.js)
import { LABEL_LINE, makeLabel, parseLabel, patternLines } from '../lib/labels.js';
import { $, addMsg, evaluateCode, getCode, isPlaying, mirror, nextBoundary, nowCycle, replEl } from '../app.js';
let mixerPending;
export const barBeat = (at) => {
  const bar = Math.floor(at + 1e-9) + 1;
  const beat = Math.round(((at % 1) + 1) % 1 * 4) + 1;
  return beat === 1 ? `bar ${bar}` : `bar ${bar} beat ${beat}`;
}; // line → cycle at which the toggle takes effect

async function toggleLine(line, what) {
  const code = getCode();
  const lines = code.split('\n');
  const m = lines[line]?.match(LABEL_LINE);
  if (!m) return;
  const st = parseLabel(m[1]);
  if (what === 'mute') { st.muted = !st.muted; if (st.muted) st.solo = false; }
  else { st.solo = !st.solo; if (st.solo) st.muted = false; }
  lines[line] = lines[line].replace(LABEL_LINE, makeLabel(st) + ':');
  const next = lines.join('\n');
  if (!isPlaying()) { mirror().setCode(next); renderMixer(); return; }
  const at = nextBoundary(0.25); // next beat (¼ cycle)
  const verb = what === 'mute' ? (st.muted ? 'mute' : 'unmute') : (st.solo ? 'solo' : 'unsolo');
  const err = await evaluateCode(next, { at, label: `${verb} ${st.base === '$' ? 'line ' + (line + 1) : st.base}`, undo: false });
  if (err) { addMsg('error', `Couldn't ${what}: ${err.message}`); return; }
  mixerPending.set(line, at);
  renderMixer();
}

let mixerEl = null;
let lastMixerKey = '';
/** Re-draw the M / S buttons beside the code lines (a panel opened or closed: the editor's width changed). */
export function resetLineControls() { lastMixerKey = ''; }
function renderMixer() {
  const view = mirror()?.editor;
  const host = $('editor-wrap')?.querySelector(':scope > div');
  if (!view?.coordsAtPos || !host) return;
  if (!mixerEl || !host.contains(mixerEl)) {
    mixerEl = document.createElement('div');
    mixerEl.className = 'mixer';
    host.style.position = 'relative';
    host.appendChild(mixerEl);
    mixerEl.addEventListener('mousedown', (e) => e.preventDefault()); // keep editor focus/selection
    // the code scrolls inside the editor: keep the M/S buttons next to their lines
    host.querySelector('.cm-scroller')?.addEventListener('scroll', () => renderMixer(), { passive: true });
    mixerEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-line]');
      if (b) toggleLine(Number(b.dataset.line), b.dataset.what);
    });
  }
  const code = getCode();
  const rows = patternLines(code);
  const now = nowCycle();
  for (const [l, at] of mixerPending) if (!isPlaying() || now >= at) mixerPending.delete(l);
  const anySolo = rows.some((r) => r.solo);
  const hostTop = host.getBoundingClientRect().top;
  const doc = view.state.doc;
  const pos = rows.map((r) => {
    if (r.line >= doc.lines) return null;
    const c = view.coordsAtPos(doc.line(r.line + 1).from);
    return c ? Math.round(c.top - hostTop) : null;
  });
  const key = JSON.stringify([rows, pos, [...mixerPending.keys()], anySolo]);
  if (key === lastMixerKey) return;
  lastMixerKey = key;
  mixerEl.innerHTML = rows
    .map((r, i) => {
      if (pos[i] == null) return '';
      const pend = mixerPending.has(r.line) ? ' pending' : '';
      const silenced = r.muted || (anySolo && !r.solo);
      return `<div class="mixer-row${pend}${silenced ? ' silenced' : ''}" style="top:${pos[i]}px">
        <button data-line="${r.line}" data-what="mute" class="m${r.muted ? ' on' : ''}" title="Mute this line (on the next beat)">M</button>
        <button data-line="${r.line}" data-what="solo" class="s${r.solo ? ' on' : ''}" title="Solo this line (on the next beat)">S</button>
      </div>`;
    })
    .join('');
}

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  mixerPending = new Map();
  replEl.addEventListener('update', () => requestAnimationFrame(renderMixer));
  window.addEventListener('resize', () => { lastMixerKey = ''; renderMixer(); });
  setInterval(renderMixer, 150);
}
