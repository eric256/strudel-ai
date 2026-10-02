// ▦ Panels menu: open or close any panel, reset the layout (app.js handles the checkboxes by data-panel and the
// reset button by its id).
import { html, nothing } from '../html.js';

/** panels: [{ id, icon, title, open, fixed }] */
export function layoutMenu(panels) {
  return html`${panels.map((p) => html`<label title=${p.fixed ? 'Always shown' : nothing}><input type="checkbox" data-panel=${p.id} .checked=${p.open} ?disabled=${p.fixed} /> ${p.icon} ${p.title}</label>`)}
    <div class="lm-foot"><button id="layoutReset" class="link" title="Back to the default layout">↺ reset layout</button></div>
    <small class="muted">Drag a tab onto another group to tab it, or to a group's edge to split it. Right-click a tab to maximise, float or pop it out into its own window.</small>`;
}
