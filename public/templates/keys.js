// 🎹 Keys: the on-screen keyboard. features/keys.js plays the keys by their data-m (MIDI note).
import { html, repeat } from '../html.js';

/**
 * whites: [{ m, left, width, name }] (name: shown on C keys, else ''), blacks: [{ m, left, width }] — left / width in %.
 * Keyed by note: another octave gets fresh keys (a key held down doesn't carry over).
 */
export function keyboard({ whites, blacks }) {
  return html`${repeat(whites, (k) => k.m, (k) => html`<div class="key white" data-m=${k.m} style="left:${k.left}%;width:${k.width}%"><span>${k.name}</span></div>`)}${repeat(blacks, (k) => k.m, (k) => html`<div class="key black" data-m=${k.m} style="left:${k.left}%;width:${k.width}%"></div>`)}`;
}
