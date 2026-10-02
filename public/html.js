// HTML templates: lit-html (https://lit.dev/docs/libraries/standalone-templates/), served from /vendor/lit-html.
//
//   render(html`<li class=${cls} @click=${() => play(sg)}>${sg.title}</li>`, container)
//
// Values are escaped automatically (no esc() needed), event handlers attach in the template, and a re-render only
// touches what changed, so a list keeps its DOM (open <details>, focus, scroll, canvases) while it updates.
// Rules: an element the app changes by hand (e.g. a progress label's text) must have no template values inside it,
// and a container rendered with render() must not also be written with innerHTML.
import { html, svg, render, nothing } from '/vendor/lit-html/lit-html.js';

export { html, svg, render, nothing };
export { repeat } from '/vendor/lit-html/directives/repeat.js';
export { classMap } from '/vendor/lit-html/directives/class-map.js';
export { styleMap } from '/vendor/lit-html/directives/style-map.js';
export { unsafeHTML } from '/vendor/lit-html/directives/unsafe-html.js';
export { live } from '/vendor/lit-html/directives/live.js';

/**
 * Fill a <select> with options [{ value, label, title? }] and select `value` (by default the one selected now, when
 * it's still there). Re-render it this way to rename an option — never change an option's text by hand.
 */
export function renderOptions(select, items, value = select.value) {
  render(html`${items.map((o) => html`<option value=${o.value} title=${o.title ?? nothing}>${o.label}</option>`)}`, select);
  if (value != null) select.value = String(value);
}
