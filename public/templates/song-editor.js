// ✎ Edit song: the song editor (features/song-editor.js keeps the draft and does the edits).
// Everything here edits a draft of the song; ✓ apply checks it and switches the song over (live, if it's playing).
import { html, nothing, repeat } from '../html.js';

/**
 * v: { title, bpm, meter, meters, scale, master, masters, melody, hook, dirty, msg, bad, playing, canJump,
 *      sections: [{ i, name, bars, chords, selected }], totalBars,
 *      sel: { i, name, bars, chords, shift, bpm, level (%), solo } | null, chordNames: [..], partNames: [..],
 *      feel: 0–100 (how loosely the band plays: humanized dynamics and timing),
 *      ending: 'fade' | 'cut' (how the song ends: its last section fades out, or it stops with a bar of silence after),
 *      grid: { parts: [{ name, color }], rows: [[{ state: 'off' | 'main' | 'variant', label, enter, title }]] } (rows[part][section]),
 *      chords: [{ name, chords, used }],
 *      parts: [{ i, name, role, sound, variants, color, open, defs: [{ id, code }] }], roles: [..] }
 * act: { field(k, v), selectSection(i), sectionField(i, k, v), moveSection(i, d), dupSection(i), delSection(i), addSection(),
 *        dragSection(i), dropSection(i), cell(part, i), cellEnter(part, i), chordName(old, name), chords(name, text),
 *        addChords(), delChords(name), partField(i, k, v), addPart(), delPart(i), togglePart(i), def(id, code),
 *        ask(part, text), editPart(part), apply(), revert(), close(), play(), jump(i), loop(i) }
 */
export function songEditor(v, act) {
  const num = (val, k, attrs = {}) => html`<input type="number" class="se-num" .value=${String(val ?? '')} min=${attrs.min ?? nothing} max=${attrs.max ?? nothing} placeholder=${attrs.placeholder ?? nothing} @change=${(e) => act[attrs.on || 'field'](...(attrs.args || []), k, e.target.value)} />`;
  return html`<div class="se">
    <div class="se-head">
      <label>title <input class="se-title" .value=${v.title} @change=${(e) => act.field('title', e.target.value)} /></label>
      <label>bpm ${num(v.bpm, 'bpm', { min: 40, max: 220 })}</label>
      <label>meter <select @change=${(e) => act.field('meter', e.target.value)}>${v.meters.map((m) => html`<option ?selected=${m === v.meter}>${m}</option>`)}</select></label>
      <label>scale <input class="se-scale" .value=${v.scale} @change=${(e) => act.field('scale', e.target.value)} /></label>
      <label title="The master style: the mastering on the whole song (tweak it live in 🎛 Master)">master <select @change=${(e) => act.field('master', e.target.value)}>${v.masters.map((n) => html`<option ?selected=${n === v.master}>${n}</option>`)}</select></label>
      <label title="How the song ends: the last section fades out, or it stops on the last bar with a moment of silence before the next song">ending <select @change=${(e) => act.field('ending', e.target.value)}>
        <option value="fade" ?selected=${v.ending !== 'cut'}>fade out</option><option value="cut" ?selected=${v.ending === 'cut'}>stop + silence</option></select></label>
      <label title="Feel: how loosely the band plays — 0 = on the grid, like a machine; 100 = a live band (each note a little softer or louder, a little behind the beat)">feel ${num(v.feel, 'feel', { min: 0, max: 100 })}</label>
      <span class="spacer"></span>
      ${v.playing ? nothing : html`<button title="Play this song" @click=${act.play}>▶ play</button>`}
      <button class="se-apply${v.dirty ? ' dirty' : ''}" ?disabled=${!v.dirty} title="Check the changes and switch the song over (from its next section, if it's playing)" @click=${act.apply}>✓ apply</button>
      <button class="link" ?disabled=${!v.dirty} title="Throw away the changes" @click=${act.revert}>↺ revert</button>
      <button class="link" title="Close the editor" @click=${act.close}>close</button>
    </div>
    <div class="se-tunes">
      <label title="The main melody, in scale degrees (0 = the key's root): the verses' tune">melody <input class="se-tune" .value=${v.melody} placeholder="<[0 ~ 2 4] [5 4 2 ~]>" @change=${(e) => act.field('melody', e.target.value)} /></label>
      <label title="The hook, in scale degrees: the choruses' catchy figure">hook <input class="se-tune" .value=${v.hook} @change=${(e) => act.field('hook', e.target.value)} /></label>
    </div>
    <div class="se-msg small${v.bad ? ' bad' : ''}">${v.msg || (v.dirty ? '● changed — ✓ apply to hear it' : '')}</div>

    <div class="se-label">Sections <span class="muted small">${v.sections.length} · ${v.totalBars} bars — click one to edit it, drag to reorder</span></div>
    <div class="se-timeline">
      ${repeat(v.sections, (s) => s.i, (s) => html`<div class="se-sec${s.selected ? ' on' : ''}" draggable="true" style="flex-grow:${s.bars}"
          title="${s.name} · ${s.bars} bars · chords ${s.chords}" @click=${() => act.selectSection(s.i)}
          @dragstart=${(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(s.i)); act.dragSection(s.i); }}
          @dragover=${(e) => e.preventDefault()} @drop=${(e) => { e.preventDefault(); act.dropSection(s.i); }}>
          <b>${s.solo ? '★ ' : ''}${s.name}</b><span>${s.bars}${s.level !== 1 ? html` · ${Math.round(s.level * 100)}%` : nothing}</span><small>${s.chords}</small></div>`)}
      <button class="se-add" title="Add a section at the end" @click=${act.addSection}>＋</button>
    </div>

    ${v.sel ? html`<div class="se-selrow">
      <label>name <input class="se-secname" .value=${v.sel.name} @change=${(e) => act.sectionField(v.sel.i, 'name', e.target.value)} /></label>
      <label>bars ${num(v.sel.bars, 'bars', { min: 1, max: 64, on: 'sectionField', args: [v.sel.i] })}</label>
      <label>chords <select @change=${(e) => act.sectionField(v.sel.i, 'chords', e.target.value)}>${v.chordNames.map((n) => html`<option ?selected=${n === v.sel.chords}>${n}</option>`)}</select></label>
      <label title="Move this section's key, in semitones">key ${num(v.sel.shift, 'shift', { min: -12, max: 12, placeholder: '0', on: 'sectionField', args: [v.sel.i] })}</label>
      <label title="This section's own tempo (empty: the song's)">bpm ${num(v.sel.bpm, 'bpm', { min: 40, max: 220, placeholder: String(v.bpm), on: 'sectionField', args: [v.sel.i] })}</label>
      <label title="This section's volume, % of the mix: softer intros and breakdowns, a bigger last chorus">volume ${num(v.sel.level, 'level', { min: 30, max: 130, on: 'sectionField', args: [v.sel.i] })}%</label>
      <label title="A solo: this part takes the lead (it steps forward) while the others step back">solo <select @change=${(e) => act.sectionField(v.sel.i, 'solo', e.target.value)}>
        <option value="" ?selected=${!v.sel.solo}>—</option>${v.partNames.map((n) => html`<option ?selected=${n === v.sel.solo}>${n}</option>`)}</select></label>
      <span class="spacer"></span>
      <button title="Move it earlier" @click=${() => act.moveSection(v.sel.i, -1)}>←</button>
      <button title="Move it later" @click=${() => act.moveSection(v.sel.i, 1)}>→</button>
      <button title="Duplicate it" @click=${() => act.dupSection(v.sel.i)}>⧉</button>
      <button title="Delete it" @click=${() => act.delSection(v.sel.i)}>🗑</button>
      ${v.canJump ? html`<button title="Play from this section (from the next bar)" @click=${() => act.jump(v.sel.i)}>⏭ go</button>
        <button title="Play this section on a loop while you work on it (▶ continue the song in 🎶 Now playing)" @click=${() => act.loop(v.sel.i)}>🔁 loop</button>` : nothing}
    </div>` : nothing}

    <div class="se-label">Arrangement <span class="muted small">which parts play in each section — click a cell: off → main → its variants; right-click: comes in / drops out / alternates</span></div>
    <div class="se-grid-wrap"><div class="se-playhead" hidden title="where the song is"></div><table class="se-grid">
      <thead><tr><th></th>${v.sections.map((s) => html`<th class=${s.selected ? 'on' : ''} @click=${() => act.selectSection(s.i)}>${s.name}</th>`)}</tr></thead>
      <tbody>${v.grid.parts.map((p, r) => html`<tr><th style="--c:${p.color}">${p.name}</th>${v.grid.rows[r].map((c, i) => html`<td>
        <button class="se-cell ${c.state}${v.sections[i]?.selected ? ' col' : ''}" style="--c:${p.color}" title=${c.title}
          @click=${() => act.cell(p.name, i)} @contextmenu=${(e) => { e.preventDefault(); act.cellEnter(p.name, i); }}>${c.label}${c.enter ? html`<small>@${c.enter}</small>` : nothing}</button></td>`)}</tr>`)}</tbody>
    </table></div>

    <div class="se-label">Chords <span class="muted small">named progressions the sections use</span></div>
    <div class="se-chords">${v.chords.map((c) => html`<div class="se-chord">
      <input class="se-cname" .value=${c.name} @change=${(e) => act.chordName(c.name, e.target.value)} />
      <input class="se-cval" .value=${c.chords} placeholder="Am F C G" @change=${(e) => act.chords(c.name, e.target.value)} />
      <button class="link" title=${c.used ? 'Used by a section — the sections switch to another progression' : 'Delete'} @click=${() => act.delChords(c.name)}>🗑</button></div>`)}
      <button class="link" @click=${act.addChords}>＋ progression</button></div>

    <div class="se-label">Parts <span class="muted small">their sound and code — open one to edit its code, or ask the AI about it</span></div>
    <div class="se-parts">${repeat(v.parts, (p) => p.i, (p) => html`<div class="se-part${p.open ? ' open' : ''}" style="--c:${p.color}">
      <div class="se-prow">
        <button class="se-toggle" title=${p.open ? 'Hide its code' : 'Show its code'} @click=${() => act.togglePart(p.i)}>${p.open ? '▾' : '▸'}</button>
        <button class="se-pedit" title="Open it in the 🧩 part editor: loop it, shape its effects, change its notes on a staff" @click=${() => act.editPart(p.name)}>🧩 edit</button>
        <input class="se-pname" .value=${p.name} title="name" @change=${(e) => act.partField(p.i, 'name', e.target.value)} />
        <select title="role" @change=${(e) => act.partField(p.i, 'role', e.target.value)}>${v.roles.map((r) => html`<option ?selected=${r === p.role}>${r}</option>`)}</select>
        <input class="se-psound" .value=${p.sound} title="sound" @change=${(e) => act.partField(p.i, 'sound', e.target.value)} />
        <input class="se-pvars" .value=${p.variants} title="variants (comma-separated: main, plus any others the sections can pick)" @change=${(e) => act.partField(p.i, 'variants', e.target.value)} />
        <button class="link" title="Delete this part" @click=${() => act.delPart(p.i)}>🗑</button>
      </div>
      ${p.open ? html`${p.defs.map((d) => html`<label class="se-def"><span>${d.id}</span>
          <textarea spellcheck="false" rows=${Math.min(10, d.code.split('\n').length + 1)} .value=${d.code} @change=${(e) => act.def(d.id, e.target.value)}></textarea></label>`)}
        <form class="se-ask" @submit=${(e) => { e.preventDefault(); const i = e.target.querySelector('input'); if (i.value.trim()) act.ask(p.name, i.value.trim()); i.value = ''; }}>
          <input placeholder="✨ ask the AI about ${p.name}: “make it busier”, “a darker sound”…" /><button>ask</button></form>` : nothing}
    </div>`)}
      <button class="link" @click=${act.addPart}>＋ part</button></div>
  </div>`;
}
