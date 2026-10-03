// The mode switcher in the header: 📻 Radio · 🎼 Studio · ⌨ Jam (features/modes.js).
import { html } from '../html.js';

/** modes: [{ id, label, title, on }]. act: { pick(id) } */
export function modeSwitch(modes, act) {
  return html`${modes.map((m) => html`<button class="mode-btn${m.on ? ' on' : ''}" data-mode=${m.id} title=${m.title} aria-pressed=${m.on ? 'true' : 'false'} @click=${() => act.pick(m.id)}>${m.label}</button>`)}`;
}
