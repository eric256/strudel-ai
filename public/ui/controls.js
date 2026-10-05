// Console controls as elements that behave like <input type="range">: <sa-knob> (EQ, pan, effect amounts) and
// <sa-fader> (a channel fader with a dB scale). They have min / max / step / value, fire bubbling "input" while
// moving and "change" when let go, keep data-k, and reset to their default on double-click — so the mixer and the
// master handle them exactly like range inputs. Colours come from the theme (and --c, a channel's colour).
import { gainToPos, posToGain, faderMarks } from '../lib/taper.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
class RangeLike extends HTMLElement {
  static get observedAttributes() { return ['min', 'max', 'step', 'value', 'label', 'unit']; }
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._v = null;
    this.tabIndex = 0;
    this.addEventListener('keydown', (e) => {
      const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
      if (!d) return;
      e.preventDefault();
      this._set(this.valueAsNumber + d * this.step * (e.shiftKey ? 0.2 : 1), true, true);
    });
    this.addEventListener('dblclick', (e) => { if (this.hasAttribute('default')) { e.stopPropagation(); this._set(Number(this.getAttribute('default')), true, true); } });
    this.addEventListener('wheel', (e) => { if (this.ownerDocument.activeElement !== this) return; e.preventDefault(); this._set(this.valueAsNumber - Math.sign(e.deltaY) * this.step, true, true); }, { passive: false });
  }
  get min() { return Number(this.getAttribute('min') ?? 0); }
  get max() { return Number(this.getAttribute('max') ?? 1); }
  get step() { return Number(this.getAttribute('step') ?? 0.01) || 0.01; }
  get valueAsNumber() { return this._v ?? Number(this.getAttribute('value') ?? this.min); }
  get value() { return String(this.valueAsNumber); }
  set value(v) { const n = Number(v); if (Number.isFinite(n)) { this._v = clamp(n, this.min, this.max); this._draw(); } }
  attributeChangedCallback(name, old, now) { if (name === 'value' && this._v == null) this._v = Number(now); this._draw(); }
  connectedCallback() { this._render(); this._draw(); }
  /** Move to v (snapped to the step); fire input (and change). */
  _set(v, input, change) {
    const s = this.step, n = clamp(Math.round((v - this.min) / s) * s + this.min, this.min, this.max);
    const r = Math.round(n * 1e6) / 1e6;
    if (r === this._v && !change) return;
    this._v = r;
    this._draw();
    if (input) this.dispatchEvent(new Event('input', { bubbles: true }));
    if (change) this.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // the pointer is captured by the control: the drag follows it anywhere, in whichever window the control is
  // (a popped-out panel has its own), and nothing under it (a canvas, a node) takes the drag
  _drag(e, onMove) {
    e.preventDefault();
    e.stopPropagation();
    this.focus({ preventScroll: true });
    try { this.setPointerCapture(e.pointerId); } catch {}
    const move = (ev) => onMove(ev);
    const up = (ev) => {
      try { this.releasePointerCapture(ev.pointerId); } catch {}
      this.removeEventListener('pointermove', move); this.removeEventListener('pointerup', up); this.removeEventListener('pointercancel', up);
      this.classList.remove('dragging'); this.dispatchEvent(new Event('change', { bubbles: true }));
    };
    this.classList.add('dragging');
    this.addEventListener('pointermove', move);
    this.addEventListener('pointerup', up);
    this.addEventListener('pointercancel', up);
  }
}

/** A knob: drag up / down (Shift: fine), wheel, arrows. Bipolar ranges (−12 … +12) light up from the middle. */
class SaKnob extends RangeLike {
  _render() {
    this.shadowRoot.innerHTML = `<style>
      :host { display: inline-flex; flex-direction: column; align-items: center; gap: 1px; cursor: ns-resize; user-select: none; outline: none; touch-action: none; --size: 34px; }
      :host(:focus-visible) svg { filter: drop-shadow(0 0 3px var(--accent)); }
      svg { width: var(--size); height: var(--size); display: block; }
      .track { fill: none; stroke: var(--line, #333); stroke-width: 3.5; stroke-linecap: round; }
      .arc { fill: none; stroke: var(--c, var(--accent, #7c5cff)); stroke-width: 3.5; stroke-linecap: round; }
      .cap { fill: url(#g); stroke: var(--border, #444); }
      .tick { stroke: var(--text, #ddd); stroke-width: 2; stroke-linecap: round; }
      .txt { display: flex; gap: 3px; align-items: baseline; line-height: 1; white-space: nowrap; }
      :host([stack]) .txt { flex-direction: column; align-items: center; gap: 1px; } /* (narrow: the value under the label) */
      .lbl { font: 600 9px var(--mono, monospace); color: var(--muted, #999); text-transform: uppercase; letter-spacing: .04em; }
      .val { font: 9px var(--mono, monospace); color: var(--text, #ddd); }
    </style>
    <svg viewBox="0 0 40 40"><defs><radialGradient id="g" cx="40%" cy="35%"><stop offset="0" stop-color="#9aa0aa"/><stop offset="1" stop-color="#2b2f36"/></radialGradient></defs>
      <path class="track"/><path class="arc"/><circle class="cap" cx="20" cy="20" r="11"/><line class="tick" x1="20" y1="20" x2="20" y2="11"/></svg>
    <span class="txt"><span class="lbl"></span><span class="val"></span></span>`;
    this.addEventListener('pointerdown', (e) => {
      const y0 = e.clientY, v0 = this.valueAsNumber, span = this.max - this.min;
      this._drag(e, (ev) => this._set(v0 + ((y0 - ev.clientY) / (ev.shiftKey ? 600 : 150)) * span, true, false));
    });
  }
  _draw() {
    const r = this.shadowRoot;
    if (!r?.querySelector('.arc')) return;
    const a0 = -135, a1 = 135, span = this.max - this.min || 1;
    const t = (this.valueAsNumber - this.min) / span;
    const bip = this.min < 0 && this.max > 0;
    const zero = bip ? (0 - this.min) / span : 0;
    const ang = (u) => a0 + u * (a1 - a0);
    const pt = (deg, rad = 15) => { const q = ((deg - 90) * Math.PI) / 180; return [20 + rad * Math.cos(q), 20 + rad * Math.sin(q)]; };
    const arc = (from, to) => {
      if (Math.abs(to - from) < 0.5) return '';
      const [x0, y0] = pt(Math.min(from, to)), [x1, y1] = pt(Math.max(from, to));
      return `M${x0} ${y0} A15 15 0 ${Math.abs(to - from) > 180 ? 1 : 0} 1 ${x1} ${y1}`;
    };
    r.querySelector('.track').setAttribute('d', arc(a0, a1));
    r.querySelector('.arc').setAttribute('d', arc(ang(zero), ang(t)));
    const [tx, ty] = pt(ang(t), 9);
    r.querySelector('.tick').setAttribute('x2', tx); r.querySelector('.tick').setAttribute('y2', ty);
    const v = this.valueAsNumber, unit = this.getAttribute('unit') || '';
    r.querySelector('.val').textContent = this.hasAttribute('novalue') ? '' : `${bip && v > 0 ? '+' : ''}${Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10}${unit}`;
    r.querySelector('.lbl').textContent = this.getAttribute('label') || '';
  }
}

/**
 * A channel fader: a long throw with a dB scale (+6 … −60, −∞ at the bottom) and a metal cap. Its value is a gain
 * (1 = 0 dB); max-db sets the top of the scale (default +6). Drag the cap, click the track to jump, arrows, wheel.
 */
class SaFader extends RangeLike {
  get maxDb() { return Number(this.getAttribute('max-db') ?? 6); }
  /** linear: a plain scale (an EQ band's dB), marks from the "marks" attribute; else a gain on the dB taper. */
  get linear() { return this.hasAttribute('linear'); }
  _pos(v) { return this.linear ? (v - this.min) / ((this.max - this.min) || 1) : gainToPos(v, this.maxDb); }
  _val(p) { return this.linear ? this.min + p * (this.max - this.min) : posToGain(p, this.maxDb); }
  _render() {
    const marks = this.linear ? (this.getAttribute('marks') || '').split(',').filter(Boolean).map(Number) : faderMarks(this.maxDb);
    this.shadowRoot.innerHTML = `<style>
      :host { display: inline-block; position: relative; width: 52px; height: var(--fader-h, 170px); user-select: none; outline: none; touch-action: none; cursor: ns-resize; }
      :host(:focus-visible) .cap { box-shadow: 0 0 0 2px var(--accent); }
      .scale { position: absolute; left: 0; top: 8px; bottom: 8px; width: 24px; }
      .mark { position: absolute; right: 2px; transform: translateY(-50%); font: 8px var(--mono, monospace); color: var(--muted, #888); white-space: nowrap; }
      .mark::after { content: ''; display: inline-block; width: 4px; height: 1px; margin-left: 2px; vertical-align: middle; background: var(--muted, #888); }
      .slot { position: absolute; left: 33px; top: 8px; bottom: 8px; width: 4px; margin-left: -2px; border-radius: 2px; background: #0b0c0f; box-shadow: inset 0 1px 2px #000; }
      .cap { position: absolute; left: 22px; width: 22px; height: 30px; margin-top: -15px; border-radius: 4px;
        background: linear-gradient(180deg, #e9ecf0 0%, #b9bec6 18%, #8d939c 48%, #d8dce1 52%, #a5abb3 80%, #6e747d 100%);
        box-shadow: 0 2px 4px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.6); }
      .cap::before { content: ''; position: absolute; left: 3px; right: 3px; top: 50%; height: 2px; margin-top: -1px; background: var(--c, #333); border-radius: 1px; }
      .cap::after { content: ''; position: absolute; left: 4px; right: 4px; top: 4px; height: 7px; border-radius: 2px;
        background: repeating-linear-gradient(180deg, rgba(0,0,0,.25) 0 1px, transparent 1px 2.5px); }
    </style><div class="scale">${marks.map((d) => `<span class="mark" data-db="${d}">${d > 0 ? '+' + d : d}</span>`).join('')}${this.linear ? '' : '<span class="mark" data-db="-inf">∞</span>'}</div>
      <div class="slot"></div><div class="cap"></div>`;
    this.addEventListener('pointerdown', (e) => {
      const slot = this.shadowRoot.querySelector('.slot').getBoundingClientRect();
      const posAt = (y) => 1 - (y - slot.top) / slot.height;
      const cap = this.shadowRoot.querySelector('.cap').getBoundingClientRect();
      const onCap = e.clientY >= cap.top && e.clientY <= cap.bottom;
      const off = onCap ? posAt(e.clientY) - this._pos(this.valueAsNumber) : 0;
      if (!onCap) this._set(this._val(clamp(posAt(e.clientY), 0, 1)), true, false);
      this._drag(e, (ev) => this._set(this._val(clamp(posAt(ev.clientY) - off, 0, 1)), true, false));
    });
  }
  _draw() {
    const r = this.shadowRoot, cap = r?.querySelector('.cap');
    if (!cap) return;
    const pos = this._pos(this.valueAsNumber);
    cap.style.top = `calc(8px + (100% - 16px) * ${1 - pos})`;
    for (const m of r.querySelectorAll('.mark')) {
      const d = m.dataset.db === '-inf' ? 0 : this.linear ? this._pos(Number(m.dataset.db)) : gainToPos(Math.pow(10, Number(m.dataset.db) / 20), this.maxDb);
      m.style.top = `${(1 - d) * 100}%`;
    }
  }
}
// (the step for a fader is fine: gains don't snap to coarse steps)
SaFader.prototype._set = function (v, input, change) {
  const c = clamp(v, this.min, this.max);
  const n = this.linear ? Math.round(Math.round((c - this.min) / this.step) * this.step * 1e4 + this.min * 1e4) / 1e4 : Math.round(c * 1e4) / 1e4;
  if (n === this._v && !change) return;
  this._v = n;
  this._draw();
  if (input) this.dispatchEvent(new Event('input', { bubbles: true }));
  if (change) this.dispatchEvent(new Event('change', { bubbles: true }));
};

if (!customElements.get('sa-knob')) customElements.define('sa-knob', SaKnob);
if (!customElements.get('sa-fader')) customElements.define('sa-fader', SaFader);
