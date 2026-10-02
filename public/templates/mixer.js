// 🎚 Mixer: one strip per part, and the master strip. features/mixer.js handles the controls by their data-k /
// data-mx attributes and draws the canvases (.mx-eqviz, .mx-meter) — keep those classes.
import { html, live, repeat } from '../html.js';
import { T } from './index.js';

// faders: live() so a re-render never fights the value you're dragging
const slider = (cls, k, min, max, step, v, title) => html`<input type="range" class=${cls} data-k=${k} min=${min} max=${max} step=${step} .value=${live(String(v))} title=${title} />`;

/**
 * One part's strip.
 * ch: { base, color, title, state: 'playing' | 'code-muted' | 'absent', silenced,
 *       eq: [{ band: 'high' | 'mid' | 'low', title, value }], pan, mute, solo, vol, db }
 * The dB label (.mx-val) is a .textContent binding: the mixer also sets it by hand while you drag.
 */
export function mixerStrip(ch) {
  return html`<div class="mx-strip${ch.state === 'absent' ? ' absent' : ''}${ch.silenced ? ' silenced' : ''}" style="--c:${ch.color}" data-base=${ch.base}>
      <div class="mx-name" title=${ch.title}>${ch.base}</div>
      <div class="mx-state">${ch.state === 'code-muted' ? html`<span class="cm" title="muted in the code (_label:)">muted in code</span>`
        : ch.state === 'playing' ? html`<span class="on">● playing</span>`
        : html`<span title="This part doesn’t play in the current section — its settings apply when it comes in">not in section</span>`}</div>
      <canvas class="mx-eqviz" width="76" height="40" title="EQ curve over the channel's live spectrum"></canvas>
      <div class="mx-eqs">${ch.eq.map((e) => html`<label title=${e.title}><span>${e.band[0].toUpperCase()}</span>${slider('mx-h', e.band, -12, 12, 0.5, e.value, `${e.band}: ${e.value} dB`)}</label>`)}
        <label title="Pan — double-click: centre"><span>P</span>${slider('mx-h', 'pan', -1, 1, 0.05, ch.pan, `pan ${ch.pan}`)}</label></div>
      <div class="mx-ms"><button data-mx="mute" class="m${ch.mute ? ' on' : ''}" title="Mute this channel (whole song)">M</button><button data-mx="solo" class="s${ch.solo ? ' on' : ''}" title="Solo this channel (whole song)">S</button></div>
      <div class="mx-fader">${slider('mx-v mx-vol', 'vol', 0, 1.5, 0.01, ch.vol, 'Channel fader — double-click: 0 dB')}<canvas class="mx-meter" width="10" height="100"></canvas></div>
      <div class="mx-val" .textContent=${`${ch.db} dB`}></div>
    </div>`;
}

/** The master strip. m: { playing, value, db } */
export function mixerMaster(m) {
  return html`<div class="mx-strip master" data-base="__master">
      <div class="mx-name">master</div><div class="mx-state"><span>${m.playing ? '● on' : 'stopped'}</span></div>
      <canvas class="mx-eqviz" width="76" height="40" title="Spectrum of the whole mix"></canvas>
      <div class="mx-eqs"></div><div class="mx-ms"></div>
      <div class="mx-fader">${slider('mx-v mx-vol', 'master', 0, 1.5, 0.01, m.value, 'Master volume — double-click: 100%')}<canvas class="mx-meter" width="10" height="100"></canvas></div>
      <div class="mx-val" .textContent=${`${m.db} dB`}></div>
    </div>`;
}

/** The whole mixer: strips keyed by part (a channel keeps its strip and canvases as parts come and go). */
export function mixer(view) {
  return html`${view.channels.length ? repeat(view.channels, (ch) => ch.base, (ch) => T.mixerStrip(ch))
    : html`<div class="muted small mx-empty">No parts yet: every part of the song, and every labelled line in the code (<code>drums: …</code>), gets a channel here.</div>`}${T.mixerMaster(view.master)}`;
}
