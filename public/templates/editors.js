// ⚙ Settings editors: the live previews under the 🎸 band and 🎼 song form editors.
import { html } from '../html.js';

/** A band's instruments as chips. v: { instruments: [{ role, sound, title, bad }], master } */
export function bandPreview(v) {
  return v.instruments.length
    ? html`${v.instruments.map((i) => html`<span class="chip${i.bad ? ' bad' : ''}" title=${i.title}><b>${i.role}</b> ${i.sound}</span>`)}
      <div class="muted small">${v.instruments.length} instruments · master ${v.master}</div>`
    : html`<span class="muted small">no instruments yet</span>`;
}

/** A song form's sections as chips (sized by their bars). v: { sections: [{ name, bars }], bars } */
export function formPreview(v) {
  return v.sections.length
    ? html`${v.sections.map((x) => html`<span class="chip" style="--w:${x.bars}"><b>${x.name}</b> ${x.bars}</span>`)}
      <div class="muted small">${v.sections.length} sections · ${v.bars} bars</div>`
    : html`<span class="muted small">no sections yet</span>`;
}
