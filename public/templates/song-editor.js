// ✎ Edit song: the form (features/song-editor.js reads it back by its data-f fields when you press ✓ apply).
import { html } from '../html.js';

/**
 * The editor form. All fields are plain text, filled in as .value (so re-rendering after ✓ apply updates them).
 * f: { title, bpm, meter, meters: [..], scale, master, masters: [..], chords, sections, sectionRows, parts, partRows, library }
 * The buttons are data-act="edit-save" / "edit-cancel"; .sv-edit-msg is written by hand (keep it empty here).
 */
export function songEditor(f) {
  return html`<div class="sv-edit">
    <div class="sv-edit-row"><label>title <input data-f="title" .value=${f.title} /></label><label>bpm <input data-f="bpm" type="number" min="50" max="200" .value=${String(f.bpm)} /></label><label>meter <select data-f="meter">${f.meters.map((m) => html`<option ?selected=${m === f.meter}>${m}</option>`)}</select></label><label>scale <input data-f="scale" .value=${f.scale} /></label><label title="The master style: the mastering on the whole song (tweak it live in 🎛 Master)">master <select data-f="master">${f.masters.map((n) => html`<option ?selected=${n === f.master}>${n}</option>`)}</select></label></div>
    <label>chords — <span class="muted">one per line: <code>name: Am F C G</code></span>
      <textarea data-f="chords" rows="3" .value=${f.chords}></textarea></label>
    <label>sections — <span class="muted">one per line: <code>name | bars | chords | parts (part or part.variant)</code>, optionally <code>| key +2, 106 bpm</code></span>
      <textarea data-f="sections" rows=${Math.min(14, f.sectionRows + 1)} .value=${f.sections}></textarea></label>
    <label>parts — <span class="muted">one per line: <code>name | role | sound | variants</code></span>
      <textarea data-f="parts" rows=${Math.min(8, f.partRows + 1)} .value=${f.parts}></textarea></label>
    <label>parts code — <span class="muted">a <code>const name_variant = …</code> for every part.variant the sections use (harmonic parts take <code>(prog)</code>)</span>
      <textarea data-f="library" rows="10" spellcheck="false" .value=${f.library}></textarea></label>
    <div class="sl-buttons"><button data-act="edit-save">✓ apply</button><button data-act="edit-cancel" class="link">cancel</button><span class="sv-edit-msg muted small"></span></div>
    <div class="muted small">Or ask the chat: “make the chorus 16 bars”, “add a breakdown before the last chorus”, “give the bass a funkier line”.</div>
  </div>`;
}
