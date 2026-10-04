// 🎧 Your taste: sounds you never want to hear (each with a stand-in), softer harsh synths, and what you like.
// The AI is told, and the app enforces it: avoided sounds are swapped in every piece of code before it plays, and
// harsh synth parts (square, saw …) without a filter of their own get a gentle low-pass.
import { stringArgs } from './partcode.js';
import { splitLibrary } from './library.js';

/** A softer stand-in for a sound you dislike (you can pick another in ⚙ Settings → 🎧 My taste). */
export const SOFTER = {
  square: 'triangle', pulse: 'triangle', sawtooth: 'triangle', saw: 'triangle', z_square: 'triangle', z_sawtooth: 'triangle',
  supersaw: 'gm_pad_warm', gm_lead_1_square: 'gm_lead_3_calliope', gm_lead_2_sawtooth: 'gm_lead_4_chiff', gm_lead_5_charang: 'gm_lead_6_voice',
  gm_lead_8_bass_lead: 'gm_synth_bass_1', gm_distortion_guitar: 'gm_overdriven_guitar', gm_overdriven_guitar: 'gm_electric_guitar_clean',
  gm_synth_bass_2: 'gm_synth_bass_1', white: 'pink', gm_orchestra_hit: 'gm_string_ensemble_1',
};
export function softerFor(sound) {
  const s = String(sound || '').toLowerCase();
  if (SOFTER[s] != null) return SOFTER[s];
  // a synth or soundfont: the gentlest wave (never itself); a drum machine or sample bank: none (the AI just avoids it)
  if (!sound || /^[A-Z]/.test(sound) || !/^(gm_)?[a-z0-9_]+$/.test(s)) return '';
  return s === 'triangle' ? 'sine' : 'triangle';
}
/** Synths that can sound harsh unfiltered. */
export const HARSH = ['square', 'sawtooth', 'saw', 'pulse', 'supersaw', 'z_square', 'z_sawtooth', 'gm_lead_1_square', 'gm_lead_2_sawtooth', 'gm_lead_5_charang', 'gm_lead_7_fifths', 'gm_lead_8_bass_lead'];

/** Settings → a clean taste: { avoid: [{ sound, instead }], soften, cutoff, likes, liked: [sound] }. */
export function normTaste(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const avoid = (Array.isArray(t.avoid) ? t.avoid : []).map((a) => ({ sound: String(a?.sound || '').trim(), instead: String(a?.instead || '').trim() }))
    .map((a) => (a.instead.toLowerCase() === a.sound.toLowerCase() ? { ...a, instead: '' } : a)) // (itself: no stand-in)
    .filter((a) => a.sound && !seen.has(a.sound.toLowerCase()) && seen.add(a.sound.toLowerCase()));
  const cutoff = Math.round(Math.max(800, Math.min(8000, Number(t.cutoff) || 3000)));
  const liked = [...new Set((Array.isArray(t.liked) ? t.liked : []).map((x) => String(x).trim()).filter(Boolean))].filter((x) => !seen.has(x.toLowerCase()));
  return { avoid, soften: !!t.soften, cutoff, likes: String(t.likes || '').slice(0, 1000), liked };
}
export const isEmpty = (t) => !t || (!t.avoid?.length && !t.soften && !t.likes?.trim() && !t.liked?.length);

/** A sound name with your taste applied: its stand-in if you avoid it (case kept as written in the taste). */
export function swapSound(name, taste) {
  const a = taste?.avoid?.find((x) => x.sound.toLowerCase() === String(name || '').trim().toLowerCase());
  return a?.instead ? a.instead : name;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Swap avoided sounds in code: inside the strings given to s / sound / bank (mini-notation: "square ~ square:2"),
 * whole words only. Returns { code, swapped: [[from, to, count]] }.
 */
export function applyAvoid(code, taste) {
  const rules = (taste?.avoid || []).filter((a) => a.instead);
  if (!rules.length || !code) return { code, swapped: [] };
  const args = stringArgs(code, ['s', 'sound', 'bank']).sort((a, b) => b.start - a.start);
  const count = new Map();
  let out = code;
  for (const arg of args) {
    let v = arg.value;
    for (const r of rules) {
      const re = new RegExp(`(^|[^\\w.])${esc(r.sound)}(?![\\w])`, 'gi');
      v = v.replace(re, (m, pre) => { count.set(r.sound, (count.get(r.sound) || 0) + 1); return pre + r.instead; });
    }
    if (v !== arg.value) out = out.slice(0, arg.start) + v + out.slice(arg.end);
  }
  return { code: out, swapped: rules.filter((r) => count.has(r.sound)).map((r) => [r.sound, r.instead, count.get(r.sound)]) };
}

/** Does this part's code play a harsh synth with no filter of its own? */
export function isHarsh(defCode) {
  if (!defCode || /\.(lpf|cutoff|lp|hpf|bandf|bpf|vowel)\s*\(/.test(defCode)) return false;
  return stringArgs(defCode, ['s', 'sound']).some((a) => a.value.split(/[^\w]+/).some((w) => HARSH.includes(w.toLowerCase())));
}
/** The part code to add for "soften harsh synths": a low-pass for a harsh part, else ''. */
export function softenCode(lib, id, taste) {
  if (!taste?.soften) return '';
  const def = splitLibrary(lib).defs.find((d) => d.id === id);
  return def && isHarsh(def.code) ? `.lpf(${taste.cutoff})` : '';
}

/** Your taste, for the AI's requests ('' when there's nothing to say). */
export function tasteForPrompt(taste) {
  if (isEmpty(taste)) return '';
  const lines = [];
  if (taste.avoid.length) lines.push(`- NEVER use these sounds: ${taste.avoid.map((a) => a.instead ? `${a.sound} (use ${a.instead} instead)` : a.sound).join(', ')}.`);
  if (taste.soften) lines.push('- Harsh, buzzy timbres bother this listener: keep bright synths (square, saw, pulse) filtered and soft, or prefer rounder sounds.');
  if (taste.liked.length) lines.push(`- Sounds they like: ${taste.liked.join(', ')} — use them where they fit.`);
  if (taste.likes.trim()) lines.push(`- In their words: ${taste.likes.trim()}`);
  return `THE LISTENER'S TASTE — always follow it:\n${lines.join('\n')}`;
}
