// 🎧 My taste (⚙ Settings): sounds you never want, softer synths, sounds you liked, your taste in words.
import { html, nothing } from '../html.js';

/**
 * v: { avoid: [{ sound, instead }], soften, cutoff, likes, liked: [sound], draft: { sound, instead } }
 * act: { add(sound, instead), draft(k, v), instead(i, v), remove(i), soften(on), cutoff(v), likes(text), unlike(sound) }
 */
export function tasteSettings(v, act) {
  return html`<div class="taste">
    <div class="se-label">Sounds I never want <span class="muted small">swapped for the stand-in everywhere — songs, parts, chat code — and the AI is told not to use them</span></div>
    <div class="taste-rows">
      ${v.avoid.length ? v.avoid.map((a, i) => html`<div class="taste-row">
        <span class="taste-sound">🚫 ${a.sound}</span><span class="muted">→</span>
        <input class="taste-instead" .value=${a.instead} placeholder="(none — the AI just avoids it)" title="What plays instead" @change=${(e) => act.instead(i, e.target.value)} />
        <button class="link" title="Allow it again" @click=${() => act.remove(i)}>🗑</button></div>`)
        : html`<div class="muted small">None yet. Add one below, or 👎 a channel in the 🎚 mixer while it plays.</div>`}
      <form class="taste-row taste-add" @submit=${(e) => { e.preventDefault(); act.add(v.draft.sound, v.draft.instead); }}>
        <input class="taste-sound-in" .value=${v.draft.sound} placeholder="a sound, e.g. square" @input=${(e) => act.draft('sound', e.target.value)} />
        <span class="muted">→</span>
        <input class="taste-instead" .value=${v.draft.instead} placeholder="instead, e.g. triangle" @input=${(e) => act.draft('instead', e.target.value)} />
        <button>＋ never this</button>
      </form>
    </div>

    <div class="se-label">Soften harsh synths</div>
    <label class="taste-check"><input type="checkbox" .checked=${v.soften} @change=${(e) => act.soften(e.target.checked)} />
      Bright synths (square, saw, pulse …) without a filter of their own get a gentle low-pass</label>
    ${v.soften ? html`<label class="taste-check">at <input type="range" min="1500" max="6000" step="100" .value=${String(v.cutoff)} @change=${(e) => act.cutoff(e.target.value)} />
      <b>${v.cutoff} Hz</b> <span class="muted small">lower is softer</span></label>` : nothing}

    <div class="se-label">Sounds I like <span class="muted small">the AI uses them where they fit (👍 a channel in the 🎚 mixer)</span></div>
    <div class="taste-liked">${v.liked.length ? v.liked.map((s) => html`<span class="taste-chip">👍 ${s} <button class="link" title="Forget it" @click=${() => act.unlike(s)}>×</button></span>`) : html`<span class="muted small">None yet.</span>`}</div>

    <div class="se-label">My taste, in my words <span class="muted small">sent to the AI with every song and change</span></div>
    <textarea class="taste-likes" rows="3" placeholder="warm, round sounds; Rhodes and upright bass; nothing screechy; not too busy" .value=${v.likes} @change=${(e) => act.likes(e.target.value)}></textarea>
  </div>`;
}
