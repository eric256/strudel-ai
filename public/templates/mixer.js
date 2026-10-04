// 🎚 Mixer: one strip per part, and the master strip. features/mixer.js handles the controls by their data-k /
// data-mx attributes and draws the canvases (.mx-eqviz, .mx-meter) — keep those classes.
import { html, live, repeat } from '../html.js';
import { T } from './index.js';

// knobs and faders (ui/controls.js) act like range inputs; live() so a re-render never fights the value you're dragging

/**
 * One part's strip.
 * ch: { base, color, title, state: 'playing' | 'code-muted' | 'absent', silenced,
 *       eq: [{ band: 'high' | 'mid' | 'low', title, value }], pan, mute, solo, vol, db, sound, liked }
 * The dB label (.mx-val) is a .textContent binding: the mixer also sets it by hand while you drag. The clip LED
 * (.mx-clip) is lit by hand from the meter.
 */
export function mixerStrip(ch) {
  return html`<div class="mx-strip${ch.state === 'absent' ? ' absent' : ''}${ch.silenced ? ' silenced' : ''}" style="--c:${ch.color}" data-base=${ch.base}>
      <div class="mx-name" title=${ch.title}>${ch.base}</div>
      <div class="mx-state">${ch.state === 'code-muted' ? html`<span class="cm" title="muted in the code (_label:)">muted in code</span>`
        : ch.state === 'playing' ? html`<span class="on">● playing</span>`
        : html`<span title="This part doesn’t play in the current section — its settings apply when it comes in">not in section</span>`}</div>
      <canvas class="mx-eqviz" width="76" height="40" title="EQ curve over the channel's live spectrum"></canvas>
      <div class="mx-knobs">${ch.eq.map((e) => html`<sa-knob data-k=${e.band} label=${e.band[0]} min="-12" max="12" step="0.5" default="0" .value=${live(String(e.value))} title=${e.title}></sa-knob>`)}
        <sa-knob data-k="pan" label="pan" min="-1" max="1" step="0.05" default="0" .value=${live(String(ch.pan))} title="Pan — double-click: centre"></sa-knob></div>
      <div class="mx-ms"><button data-mx="mute" class="m${ch.mute ? ' on' : ''}" title="Mute this channel (whole song)">M</button><button data-mx="solo" class="s${ch.solo ? ' on' : ''}" title="Solo this channel (whole song)">S</button><button data-mx="eq" class="eq" title="Open this channel in the 🎚 Equalizer (7 bands)">EQ</button></div>
      ${ch.sound ? html`<div class="mx-taste"><button data-mx="like" class=${ch.liked ? 'on' : ''} title="I like ${ch.sound} — the AI uses it where it fits">👍</button><button data-mx="dislike" title="Never ${ch.sound} again — a softer sound plays instead (⚙ Settings → 🎧 My taste)">👎</button></div>` : html`<div class="mx-taste"></div>`}
      <div class="mx-fader"><sa-fader class="mx-vol" data-k="vol" min="0" max="1.995" max-db="6" default="1" .value=${live(String(ch.vol))} title="Channel fader — double-click: 0 dB"></sa-fader>
        <div class="mx-meterbox"><button class="mx-clip" data-mx="clip" title="Peak: lights amber near the top, red when it clipped (click to reset)"></button><canvas class="mx-meter" width="10" height="150"></canvas></div></div>
      <div class="mx-val" .textContent=${`${ch.db} dB`}></div>
    </div>`;
}

/** The master strip. m: { playing, value, db } */
export function mixerMaster(m) {
  return html`<div class="mx-strip master" data-base="__master">
      <div class="mx-name">master</div><div class="mx-state"><span>${m.playing ? '● on' : 'stopped'}</span></div>
      <canvas class="mx-eqviz" width="76" height="40" title="Spectrum of the whole mix"></canvas>
      <div class="mx-knobs master-note muted">the whole mix</div>
      <div class="mx-ms"><button data-mx="eq" class="eq" title="Open the master in the 🎚 Equalizer (7 bands)">EQ</button></div><div class="mx-taste"></div>
      <div class="mx-fader"><sa-fader class="mx-vol" data-k="master" min="0" max="1.5" max-db="3.5" default="1" .value=${live(String(m.value))} title="Master volume — double-click: 0 dB"></sa-fader>
        <div class="mx-meterbox"><button class="mx-clip" data-mx="clip" title="Peak: lights amber near the top, red when it clipped (click to reset)"></button><canvas class="mx-meter" width="10" height="150"></canvas></div></div>
      <div class="mx-val" .textContent=${`${m.db} dB`}></div>
    </div>`;
}

/** The whole mixer: strips keyed by part (a channel keeps its strip and canvases as parts come and go). */
export function mixer(view) {
  return html`${view.channels.length ? repeat(view.channels, (ch) => ch.base, (ch) => T.mixerStrip(ch))
    : html`<div class="muted small mx-empty">No parts yet: every part of the song, and every labelled line in the code (<code>drums: …</code>), gets a channel here.</div>`}${T.mixerMaster(view.master)}`;
}
