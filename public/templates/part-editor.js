// 🧩 Part editor: one part of the song, on its own — loop it, shape its sound with its effects, and change its notes
// on a staff (melodies) or a grid (drums, chord tones, rhythms, levels). Edits go into ✎ Edit song's draft.
import { html, svg, nothing } from '../html.js';

/** Staff geometry: half a line-gap per step; the bottom line is at BOTTOM. */
const HALF = 5, BOTTOM = 92, HEIGHT = 150;
const yOf = (step) => BOTTOM - step * HALF;

/**
 * v: { part, variant, color, role, sound, variants: [{ name, on, used }], sections: [{ i, name, chords, on, uses }],
 *      solo, playing, dirty, msg, bad, effects: [{ group, items: [{ i, key, label, kind, value, min, max, step, log, unit }] }],
 *      addable: [{ key, label, group }], sources: [{ i, label, on, color }], src: (see noteEditor), code,
 *      voices: null | { options: [{ key, label }], canRemove }, layers: null | { list: [{ k, sound, text }], can } }
 * act: { variant, section, play, stop, solo, effect, effectText, addEffect, removeEffect, source, steps, staff, key,
 *        grid, level, bar, up, octave, length, rest, chord, addVoice, removeVoice, addLayer, removeLayer, text, code,
 *        apply, revert, close }
 */
export function partEditor(v, act) {
  return html`<div class="pe" style="--c:${v.color}">
    <div class="pe-head">
      <b class="pe-name">${v.part}</b><span class="muted small">${v.role} · ${v.sound}</span>
      <span class="spacer"></span>
      ${v.playing ? html`<button class="pe-stop" title="Stop the loop" @click=${act.stop}>■ stop</button>`
        : html`<button class="pe-play" title="Loop this part (with the section's chords), and hear every change as you make it" @click=${act.play}>▶ loop</button>`}
      <label class="pe-solo" title="On its own, or with the rest of the section playing"><input type="checkbox" .checked=${v.solo} @change=${(e) => act.solo(e.target.checked)} /> solo</label>
      <button class="se-apply${v.dirty ? ' dirty' : ''}" ?disabled=${!v.dirty} title="Apply the song's changes (✎ Edit song's ✓ apply)" @click=${act.apply}>✓ apply</button>
      <button class="link" ?disabled=${!v.dirty} title="Throw away the song's changes" @click=${act.revert}>↺ revert</button>
      <button class="link" title="Close the part editor" @click=${act.close}>close</button>
    </div>
    <div class="se-msg${v.bad ? ' bad' : ''}">${v.msg}</div>

    <div class="pe-row">
      <span class="se-label">Variant</span>
      ${v.variants.map((x) => html`<button class="pe-chip${x.on ? ' on' : ''}" title=${x.used ? `played in: ${x.used}` : 'not played in any section yet'} @click=${() => act.variant(x.name)}>${x.name}${x.used ? html` <small>${x.used}</small>` : html` <small class="faint">${x.fill ? 'fills into choruses, drops, solos' : 'unused'}</small>`}</button>`)}
    </div>
    <div class="pe-row">
      <span class="se-label">Section</span>
      ${v.sections.map((s) => html`<button class="pe-chip${s.on ? ' on' : ''}${s.uses ? ' uses' : ''}" title="Loop it with ${s.name}'s chords (${s.chords})${s.uses ? ' — this variant plays here' : ''}" @click=${() => act.section(s.i)}>${s.name}</button>`)}
    </div>

    <div class="se-label">Effects <span class="muted small">the part's sound — slider values stay live controls in the song</span></div>
    <div class="pe-fx">
      ${v.effects.map((g) => html`<div class="pe-fxgroup"><div class="pe-fxname">${g.group}</div>${g.items.map((e) => fxRow(e, act))}</div>`)}
      <select class="pe-addfx" @change=${(e) => { if (e.target.value) act.addEffect(e.target.value); e.target.value = ''; }}>
        <option value="">＋ effect…</option>
        ${[...new Set(v.addable.map((a) => a.group))].map((grp) => html`<optgroup label=${grp}>${v.addable.filter((a) => a.group === grp).map((a) => html`<option value=${a.key}>${a.label}</option>`)}</optgroup>`)}
      </select>
    </div>
    ${v.layers && (v.layers.can || v.layers.list.length) ? html`<div class="pe-row pe-layers">
      <span class="se-label" title="The same notes on more sounds at once, each with its own effects (still one part, one mixer channel)">Layers</span>
      ${v.layers.list.length ? v.layers.list.map((l) => html`<span class="pe-chip pe-layer" title=${l.text}>${l.sound}${v.layers.list.length > 1 ? html` <button class="link pe-del" title="Take this layer off" @click=${() => act.removeLayer(l.k)}>×</button>` : nothing}</span>`)
        : html`<span class="muted small">one sound</span>`}
      <input class="pe-addlayer" placeholder="＋ layer a sound…" title="Play the same notes on another sound too (e.g. gm_string_ensemble_1) — its own effects go inside its x => x.s(…) in the code" @change=${(e) => { if (e.target.value.trim()) act.addLayer(e.target.value); e.target.value = ''; }} />
    </div>` : nothing}

    <div class="se-label">Notes <span class="muted small">${!v.sources.length ? 'this part has no patterns the note editor can change — edit its code below' : v.sources.length > 1 ? 'pick what to edit' : v.src?.label || ''}</span></div>
    ${v.sources.length > 1 || v.voices ? html`<div class="pe-row pe-voices">${v.sources.length > 1 ? v.sources.map((s) => html`<button class="pe-chip${s.on ? ' on' : ''}${s.color ? ' pe-voice' : ''}" style=${s.color ? `--vc:${s.color}` : ''} @click=${() => act.source(s.i)}>${s.label}</button>`) : nothing}
      ${v.voices ? html`<select class="pe-addvoice" title="Another line played with this one — still one part (one mixer channel)" @change=${(e) => { if (e.target.value) act.addVoice(e.target.value); e.target.value = ''; }}>
          <option value="">＋ voice…</option>${v.voices.options.map((o) => html`<option value=${o.key}>${o.label}</option>`)}</select>
        ${v.voices.canRemove ? html`<button class="link" title="Take this voice out" @click=${act.removeVoice}>✕ voice</button>` : nothing}` : nothing}</div>` : nothing}
    ${v.src ? noteEditor(v.src, act) : nothing}

    <details class="pe-code"><summary>code</summary>
      <textarea spellcheck="false" rows=${Math.min(14, v.code.split('\n').length + 1)} .value=${v.code} @change=${(e) => act.code(e.target.value)}></textarea>
    </details>
  </div>`;
}

function fxRow(e, act) {
  const del = html`<button class="link pe-del" title="Take ${e.label} off" @click=${() => act.removeEffect(e.i)}>×</button>`;
  if (e.kind === 'slider' || e.kind === 'number') {
    const pos = e.log ? Math.round((Math.log(Math.max(e.min, e.value) / e.min) / Math.log(e.max / e.min)) * 1000) : e.value;
    return html`<label class="pe-fxrow" title=${e.kind === 'slider' ? 'a live slider in the song' : ''}><span>${e.label}${e.kind === 'slider' ? html` <small class="faint">◉</small>` : nothing}</span>
      <input type="range" min=${e.log ? 0 : e.min} max=${e.log ? 1000 : e.max} step=${e.log ? 1 : e.step} .value=${String(pos)}
        @input=${(ev) => act.effect(e.i, e.log ? e.min * Math.pow(e.max / e.min, ev.target.value / 1000) : Number(ev.target.value), true)}
        @change=${(ev) => act.effect(e.i, e.log ? e.min * Math.pow(e.max / e.min, ev.target.value / 1000) : Number(ev.target.value))} />
      <input class="pe-num" type="number" step=${e.step || 0.01} .value=${String(Math.round(e.value * 1000) / 1000)} @change=${(ev) => act.effect(e.i, Number(ev.target.value))} />
      <small class="faint">${e.unit || ''}</small>${del}</label>`;
  }
  return html`<label class="pe-fxrow"><span>${e.label}</span>
    <input class="pe-text" .value=${e.value} ?disabled=${e.kind === 'code'} title=${e.kind === 'pattern' ? 'a pattern: one value per step, like "0.8 0.5"' : ''} @change=${(ev) => act.effectText(e.i, ev.target.value)} />${del}</label>`;
}

/**
 * src: { kind, view: 'staff' | 'grid' | 'level', text, error, stepsPer, stepOptions, clef, info, sel,
 *        bars: [{ b, res, steps, events: [{ k, t, len, notes: [{ step, acc }], vals, sel, level }], rests: [{ t, len }] }],
 *        rows: [{ val, label }] (grid) }
 */
function noteEditor(s, act) {
  return html`<div class="pe-notes">
    <div class="pe-tools">
      ${s.error ? nothing : html`
        <label class="small muted">steps / bar <select @change=${(e) => act.steps(Number(e.target.value))}>${s.stepOptions.map((n) => html`<option ?selected=${n === s.stepsPer}>${n}</option>`)}</select></label>
        <button title="Add a bar (a copy of the last one)" @click=${() => act.bar('add')}>＋ bar</button>
        <button title="Remove the selected bar (or the last one)" ?disabled=${s.bars.length < 2} @click=${() => act.bar('del')}>− bar</button>
        ${s.view === 'staff' ? html`<span class="pe-sep"></span>
          <button title="Up a step (↑)" ?disabled=${!s.sel} @click=${() => act.up(1)}>▲</button>
          <button title="Down a step (↓)" ?disabled=${!s.sel} @click=${() => act.up(-1)}>▼</button>
          <button title="Up an octave (Shift+↑)" ?disabled=${!s.sel} @click=${() => act.octave(1)}>8va</button>
          <button title="Down an octave (Shift+↓)" ?disabled=${!s.sel} @click=${() => act.octave(-1)}>8vb</button>
          <button title="Shorter (−)" ?disabled=${!s.sel} @click=${() => act.length(0.5)}>½</button>
          <button title="Longer (+)" ?disabled=${!s.sel} @click=${() => act.length(2)}>×2</button>
          <button title="Make it a rest (Delete)" ?disabled=${!s.sel} @click=${act.rest}>rest</button>
          <label class="pe-chordmode" title="On: a click adds a note to the chord at that step (or hold Shift) — off: it moves the note"><input type="checkbox" .checked=${s.chord} @change=${(e) => act.chord(e.target.checked)} /> chord</label>
          <span class="small muted">${s.info}</span>` : nothing}`}
    </div>
    ${s.error ? html`<div class="se-msg bad">${s.error}</div>`
      : s.view === 'staff' ? staffView(s, act) : s.view === 'level' ? levelView(s, act) : gridView(s, act)}
    <label class="pe-mini"><span class="small muted">as text</span><input spellcheck="false" .value=${s.text} @change=${(e) => act.text(e.target.value)} /></label>
    ${s.view === 'staff' && !s.error ? html`<div class="small faint">Click the staff to put a note there (or move the one at that step) · Shift-click (or chord on) adds a note to the chord · right-click a note to remove it · arrows / Delete / + − on the selected note${s.bars.some((b) => b.others?.length) ? ' · the other voices show faded in their colours' : ''}</div>`
      : s.view === 'grid' && !s.error ? html`<div class="small faint">Click a cell to add or remove a hit</div>` : nothing}
  </div>`;
}

function staffView(s, act) {
  return html`<div class="pe-staff" tabindex="0" @keydown=${act.key}>${s.bars.map((bar) => {
    const first = bar.b === 0;
    const padL = first ? 44 : 10, cw = bar.steps <= 4 ? 48 : bar.steps <= 8 ? 32 : bar.steps <= 16 ? 22 : 14, width = padL + bar.steps * cw + 10;
    const tick = bar.res / bar.steps;
    const xOf = (t) => padL + (t / tick) * cw + cw / 2;
    const click = (e) => {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      const col = Math.max(0, Math.min(bar.steps - 1, Math.floor((e.clientX - r.left - padL) / cw)));
      act.staff(bar.b, col, Math.round((BOTTOM - (e.clientY - r.top)) / HALF), e.type === 'contextmenu', e.shiftKey);
    };
    return html`<svg class="pe-bar" style=${s.voiceColor ? `--vc:${s.voiceColor}` : ''} width=${width} height=${HEIGHT} viewBox="0 0 ${width} ${HEIGHT}" @click=${click} @contextmenu=${click}>
      ${[...Array(bar.steps)].map((_, c) => svg`<rect class="pe-col${bar.steps >= 8 && c % beatOf(bar.steps) === 0 ? ' beat' : ''}" x=${padL + c * cw} y="20" width=${cw} height=${HEIGHT - 40}></rect>`)}
      ${[0, 2, 4, 6, 8].map((st) => svg`<line class="pe-line" x1="0" x2=${width} y1=${yOf(st)} y2=${yOf(st)}></line>`)}
      <line class="pe-barline" x1=${width - 0.5} x2=${width - 0.5} y1=${yOf(8)} y2=${yOf(0)}></line>
      ${first ? svg`<text class="pe-clef" x="4" y=${s.clef === 'bass' ? yOf(4) + 13 : yOf(0) + 11} font-size=${s.clef === 'bass' ? 34 : 50}>${s.clef === 'bass' ? '𝄢' : '𝄞'}</text>` : nothing}
      ${bar.rests.map((r) => svg`<rect class="pe-rest" x=${xOf(r.t) - 4} y=${yOf(4) - 2} width="8" height="4"></rect>`)}
      ${(bar.others || []).map((o) => svg`<g class="pe-ghost" style="--vc:${o.color}">${o.notes.map((n) => {
        const x = padL + o.pos * bar.steps * cw + cw / 2;
        return svg`<rect class="pe-gdur" x=${x - 4} y=${yOf(n.step) - 2} width=${Math.max(6, o.len * bar.steps * cw - 2)} height="4" rx="2"></rect>
          <ellipse class="pe-ghead" cx=${x} cy=${yOf(n.step)} rx="5.5" ry="4" transform="rotate(-20 ${x} ${yOf(n.step)})"></ellipse>`;
      })}</g>`)}
      ${bar.events.map((ev) => {
        const x = xOf(ev.t), f = ev.len / bar.res, hollow = f >= 0.5, flags = f >= 0.25 ? 0 : f >= 0.125 ? 1 : 2;
        const steps = ev.notes.map((n) => n.step), hi = Math.max(...steps), lo = Math.min(...steps);
        const up = (hi + lo) / 2 < 4;
        const stemX = up ? x + 5.5 : x - 5.5, stemEnd = up ? yOf(hi) - 32 : yOf(lo) + 32;
        return svg`<g class="pe-note${ev.sel ? ' sel' : ''}">
          <rect class="pe-dur" x=${x - 4} y=${yOf(hi) - 3} width=${Math.max(8, (ev.len / tick) * cw - 2)} height=${(hi - lo) * HALF + 6} rx="3"></rect>
          ${ev.notes.map((n) => svg`
            ${ledgers(n.step, x)}
            ${n.acc ? svg`<text class="pe-acc" x=${x - 16} y=${yOf(n.step) + 4}>${n.acc}</text>` : nothing}
            <ellipse class="pe-head${hollow ? ' hollow' : ''}" cx=${x} cy=${yOf(n.step)} rx="6" ry="4.4" transform="rotate(-20 ${x} ${yOf(n.step)})"></ellipse>`)}
          ${f < 1 ? svg`<line class="pe-stem" x1=${stemX} x2=${stemX} y1=${up ? yOf(lo) : yOf(hi)} y2=${stemEnd}></line>` : nothing}
          ${[...Array(flags)].map((_, k) => svg`<path class="pe-flag" d=${up ? `M${stemX} ${stemEnd + k * 7} q 9 6 4 16` : `M${stemX} ${stemEnd - k * 7} q 9 -6 4 -16`}></path>`)}
        </g>`;
      })}
    </svg>`;
  })}</div>`;
}
/** Steps per beat (4 beats a bar; a bar of 6 steps counts in threes). */
const beatOf = (steps) => (steps % 4 === 0 ? steps / 4 : steps % 3 === 0 ? 3 : steps);
const ledgers = (step, x) => {
  const out = [];
  for (let st = -2; st >= step; st -= 2) out.push(st);
  for (let st = 10; st <= step; st += 2) out.push(st);
  return out.map((st) => svg`<line class="pe-line" x1=${x - 10} x2=${x + 10} y1=${yOf(st)} y2=${yOf(st)}></line>`);
};

function gridView(s, act) {
  return html`<div class="pe-gridwrap"><table class="pe-grid">
    <tbody>${s.rows.map((row) => html`<tr><th title=${row.val}>${row.label}</th>${s.bars.map((bar) => html`${[...Array(bar.steps)].map((_, c) => {
      const t = (c * bar.res) / bar.steps;
      const hit = bar.events.find((e) => e.t === t && e.vals.includes(row.val));
      const held = !hit && bar.events.some((e) => e.t < t && t < e.t + e.len && e.vals.includes(row.val));
      return html`<td class=${`${c === 0 ? 'barstart ' : ''}${bar.steps >= 8 && c % beatOf(bar.steps) === 0 ? 'beat' : ''}`}><button class="pe-cell${hit ? ' on' : held ? ' held' : ''}" title="${row.label} · bar ${bar.b + 1}, step ${c + 1}" @click=${() => act.grid(bar.b, c, row.val)}></button></td>`;
    })}`)}</tr>`)}
    <tr class="pe-addrow"><th colspan="1">${s.kind === 'drums' || s.kind === 'index' ? html`<input placeholder=${s.kind === 'drums' ? '＋ sound' : '＋ number'} @change=${(e) => { if (e.target.value.trim()) act.grid(-1, -1, e.target.value.trim()); e.target.value = ''; }} />` : nothing}</th></tr>
    </tbody></table></div>`;
}

function levelView(s, act) {
  const H = 60;
  return html`<div class="pe-levels">${s.bars.map((bar) => html`<div class="pe-lbar">${[...Array(bar.steps)].map((_, c) => {
    const t = (c * bar.res) / bar.steps;
    const ev = bar.events.find((e) => e.t <= t && t < e.t + e.len);
    const val = ev ? Number(ev.vals[0]) : null;
    const click = (e) => {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      act.level(bar.b, c, e.type === 'contextmenu' ? null : Math.max(0, Math.min(1, Math.round((1 - (e.clientY - r.top) / H) * 20) / 20)));
    };
    return html`<div class="pe-lcol${c === 0 ? ' barstart' : ''}" style="height:${H}px" title=${val != null ? `${val}` : 'not set'} @click=${click} @contextmenu=${click}>
      ${val != null ? html`<div class="pe-lval${ev.t === t ? '' : ' held'}" style="height:${Math.round(Math.min(1, val) * H)}px"></div>` : nothing}</div>`;
  })}</div>`)}</div>`;
}
