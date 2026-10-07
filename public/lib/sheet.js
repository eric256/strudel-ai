// Song sheets: the AI's plan of a song (tempo, key, chords, hook, parts, sections) checked and repaired, and the
// part library's shape (which consts a sheet needs).
import { ident } from './util.js';
import { fixScaleString } from './scales.js';
import { normProgression, normMeter, sectionType, ENTER_MODES, MAX_KEY_SHIFT, MAX_TEMPO_DRIFT, MAX_CHORUS_BARS } from './music.js';

/** The longest section the AI may write (your own edits may be longer). */
const MAX_SECTION_BARS = 16;
import { findIn } from './forms.js';
import { enforceBand, parseInstruments, parseTweaks } from './bands.js';
import { normStyle, styleParams, diffParams } from '../master.js';
import { normVoices, normLayers, VOICE_ROLE } from './poly.js';

export function normalizeSheet(raw, choice = 'auto', { enforceForm = true, band: bandPick = null, forms = [], bands = [] } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('the sheet is not an object');
  const bpm = Math.max(50, Math.min(200, Math.round(Number(raw.bpm) || 100)));
  // scale: "A:minor" (or derived from "key": "A minor"), checked against the real scale names
  let scale = String(raw.scale || raw.key || 'C minor').trim().replace(/\s+/, ':');
  const fixed = fixScaleString(scale);
  scale = fixed.unknown.length ? 'C:minor' : fixed.fixed;
  const chords = {};
  for (const [k, v] of Object.entries(raw.chords || raw.progressions || {})) {
    const p = normProgression(Array.isArray(v) ? v.join(' ') : v);
    if (p) chords[ident(k)] = p;
  }
  if (!Object.keys(chords).length) throw new Error('no chord progressions');
  const meter = normMeter(raw.meter || raw.time || raw.timeSignature);
  const degrees = (t) => String(t || '').replace(/[^0-9~\s\-\[\]<>.*@!_?,:]/g, ' ').replace(/\s+/g, ' ').trim();
  const hook = degrees(raw.hook) || '0 2 4 2';
  // the main melody (the verses' tune); the hook is the chorus's catch
  const melody = degrees(raw.melody);
  const parts = [];
  for (const p of Array.isArray(raw.parts) ? raw.parts : []) {
    const id = ident(p.name || p.role);
    if (parts.some((q) => q.id === id)) continue;
    const variants = [...new Set(['main', ...(Array.isArray(p.variants) ? p.variants : []).map(ident)])];
    const tune = ['melody', 'hook'].includes(p.tune) ? p.tune : null;
    const role = String(p.role || '').toLowerCase(), sound = String(p.sound || '');
    // polyphony: voices (harmony lines, a counter-line) on single-line parts, layers (more sounds on the same notes)
    const voices = VOICE_ROLE.test(role + ' ' + id) ? normVoices(p.voices) : [];
    const layers = /drum|perc|beat/.test(role) ? [] : normLayers(p.layers, sound);
    parts.push({ id, role, sound, desc: String(p.desc || p.description || ''), variants, ...(tune ? { tune } : {}), ...(voices.length ? { voices } : {}), ...(layers.length ? { layers } : {}) });
  }
  if (parts.length < 2) throw new Error('fewer than 2 parts');
  parts.splice(10);
  const firstChords = Object.keys(chords)[0];
  const sections = [];
  for (const sec of Array.isArray(raw.sections) ? raw.sections : []) {
    const bars = Math.max(1, Math.min(enforceForm ? 16 : 32, Math.round(Number(sec.bars) || 8)));
    const ck = ident(sec.chords);
    const play = [];
    for (const ref of Array.isArray(sec.play) ? sec.play : []) {
      // "part", "part.variant", optionally "@in" (enters halfway), "@out" (drops out halfway), "@alt" (2 bars on, 2 off)
      const [name, how] = String(ref).split('@');
      const [pn, vn] = name.split(/[.:]/);
      const part = parts.find((q) => q.id === ident(pn));
      if (!part) continue;
      const variant = vn && part.variants.includes(ident(vn)) ? ident(vn) : 'main';
      const enter = ENTER_MODES.includes(String(how || '').trim().toLowerCase()) ? String(how).trim().toLowerCase() : null;
      if (!play.some((x) => x.part === part.id)) play.push({ part: part.id, variant, ...(enter ? { enter } : {}) });
    }
    if (!play.length && sections.length) play.push(...sections[sections.length - 1].play);
    if (!play.length) play.push({ part: parts[0].id, variant: 'main' });
    const name = String(sec.name || sec.type || 'section').slice(0, 40);
    const out = { name, type: sectionType(name), bars, chords: chords[ck] ? ck : firstChords, play };
    // key and tempo may move a little as the song goes on (a lifted last chorus, a tempo push)
    // (lenient: "+2", "104 bpm", tempo / key_shift spellings; edits the user asks for may move further)
    const shift = Math.round(parseFloat(sec.shift ?? sec.transpose ?? sec.key_shift ?? sec.keyShift) || 0);
    const maxShift = enforceForm ? MAX_KEY_SHIFT : 6;
    if (shift) out.shift = Math.max(-maxShift, Math.min(maxShift, shift));
    const sbpm = Math.round(parseFloat(sec.bpm ?? sec.tempo) || 0);
    if (sbpm) {
      const lim = Math.max(2, Math.round(bpm * (enforceForm ? MAX_TEMPO_DRIFT : 0.3)));
      const b2 = Math.max(bpm - lim, Math.min(bpm + lim, sbpm));
      if (b2 !== bpm) out.bpm = b2;
    }
    // dynamics: the section's volume (1 = as mixed; softer intros and breakdowns, a bigger last chorus)
    const level = parseFloat(sec.level ?? sec.volume ?? sec.dynamics);
    if (Number.isFinite(level) && Math.abs(level - 1) > 0.01) out.level = Math.round(Math.max(0.3, Math.min(1.3, level)) * 100) / 100;
    // a solo: one part takes the lead (it plays, louder) while the others step back
    const soloId = sec.solo ? ident(String(sec.solo).split(/[.@]/)[0]) : null;
    if (soloId && parts.some((p) => p.id === soloId)) {
      out.solo = soloId;
      if (!out.play.some((x) => x.part === soloId)) out.play.push({ part: soloId, variant: parts.find((p) => p.id === soloId).variants.includes('solo') ? 'solo' : 'main' });
    }
    sections.push(out);
  }
  if (sections.length < 2) throw new Error('fewer than 2 sections');
  // the form is a guide: the song keeps its shape, but sections may come and go and vary in length (up to 16 bars)
  const form = enforceForm ? (choice !== 'auto' && findIn(forms, choice)) || findIn(forms, raw.form) : null;
  if (enforceForm) for (const sec of sections) sec.bars = Math.min(sec.bars, MAX_SECTION_BARS);
  if (!enforceForm) for (const sec of sections) sec.bars = Math.max(1, Math.min(32, sec.bars));
  // choruses (and hooks) the AI writes are short and punchy: never longer than 4 bars (your own edits may be longer)
  if (enforceForm) for (const sec of sections) if (sec.type === 'chorus') sec.bars = Math.min(sec.bars, MAX_CHORUS_BARS);
  // the band: its instruments win (when the song is being written), and its master style is the default
  const band = (bandPick && bandPick !== 'auto' && findIn(bands, bandPick)) || findIn(bands, raw.band);
  if (band && enforceForm) enforceBand(parts, band);
  const masterStyle = normStyle(raw.master || raw.masterStyle) || normStyle(band?.master) || normStyle(form?.name || raw.form) || 'clean';
  // the song's own tweaks of its master style: what the sheet says, else the band's (its "sound")
  const own = raw.masterParams && typeof raw.masterParams === 'object' ? raw.masterParams : band && normStyle(band.master) === masterStyle ? parseTweaks(band.tweaks) : null;
  const tweaks = own ? diffParams(styleParams(masterStyle, own), masterStyle) : {};
  assignTunes(parts, sections, { melody, band });
  // the ending: the last section fades out, or stops hard with a moment of silence before the next song
  const ending = /cut|stop|hard/i.test(String(raw.ending || '')) ? 'cut' : 'fade';
  // the feel: the sheet's, else the band's, else its master style's
  const feel = normFeel(raw.feel) ?? normFeel(band?.feel) ?? STYLE_FEEL[masterStyle] ?? 0;
  return { form: form?.name || String(raw.form || ''), ...(band ? { band: band.name } : {}), master: masterStyle, ...(Object.keys(tweaks).length ? { masterParams: tweaks } : {}),
    bpm, meter, key: String(raw.key || scale.replace(':', ' ')), scale, chords, hook, ...(melody ? { melody } : {}), parts, sections, ending, feel,
    ...(routingLines(raw.routing).length ? { routing: routingLines(raw.routing) } : {}) };
}
/** The sheet's 🔀 routing: chain lines (lib/routing.js parseChains reads them) — an array, or one text of lines. */
export function routingLines(r) {
  const lines = Array.isArray(r) ? r : typeof r === 'string' ? r.split('\n') : [];
  return lines.filter((l) => typeof l === 'string' && l.trim()).map((l) => l.trim().slice(0, 400)).slice(0, 16);
}

/**
 * How loosely each master style's players play by default (the song's "feel": 0 = on the grid, like a machine; 1 = a live
 * band: every note a little softer or louder, a little behind the beat). Electronic styles stay tight.
 */
export const STYLE_FEEL = { acoustic: 0.8, warm: 0.6, cinematic: 0.5, rock: 0.45, ambient: 0.35, dub: 0.3, hiphop: 0.25, pop: 0.2 };
/** A feel value (0–1, two decimals), or null when there is none. */
export const normFeel = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.round(Math.max(0, Math.min(1, Number(v))) * 100) / 100);

/**
 * Which parts play the song's tunes (part.tune): the hook — a part named hook, else the melody part heard most in the
 * choruses — and the main melody — a part named theme / melody / lead / tune, else the melody part heard most in the
 * verses, else a new "theme" part (the band's melody instrument) added to the verses. So the melody is always heard.
 */
export function assignTunes(parts, sections, { melody = '', band = null } = {}) {
  const melodic = parts.filter((p) => /melody|lead/.test(p.role));
  const heardIn = (p, types) => sections.filter((x) => types.includes(x.type) && x.play.some((y) => y.part === p.id)).length;
  const most = (list, types) => list.slice().sort((a, b) => heardIn(b, types) - heardIn(a, types))[0];
  let hook = parts.find((p) => p.tune === 'hook') || melodic.find((p) => /hook/.test(p.id + ' ' + p.desc));
  if (!hook && melodic.length) hook = most(melodic, ['chorus', 'drop']);
  if (hook) hook.tune = 'hook';
  if (!melody) return;
  let tune = parts.find((p) => p.tune === 'melody') || melodic.find((p) => p !== hook && /melody|theme|tune|lead/.test(p.id + ' ' + p.desc));
  if (!tune) tune = most(melodic.filter((p) => p !== hook && heardIn(p, ['verse', 'intro', 'bridge', 'solo']) > 0), ['verse']);
  if (!tune && parts.length < 10) {
    const sound = parseInstruments(band?.instruments).find((i) => /melody|lead/.test(i.role))?.sound || hook?.sound || 'triangle';
    tune = { id: parts.some((p) => p.id === 'theme') ? 'theme2' : 'theme', role: 'melody', sound, desc: 'plays the main melody', variants: ['main'] };
    parts.push(tune);
    for (const x of sections) if (x.type === 'verse' && !x.play.some((y) => y.part === tune.id)) x.play.push({ part: tune.id, variant: 'main' });
  }
  if (tune) tune.tune = 'melody';
}

/** A fill variant: "fill", "fill2", "fill3" … (a part may have several, of different character). */
export const isFillVariant = (v) => /^fill\d*$/.test(v);
/** The part that plays the one-bar fills (drums with a fill variant). */
export const fillPart = (sheet) => sheet.parts.find((p) => p.variants.some(isFillVariant) && /drum|perc|beat/i.test(p.role + p.id)) ||
  sheet.parts.find((p) => p.variants.some(isFillVariant));
/** The fill part's fills, in the order they take turns. */
export const fillVariants = (sheet) => fillPart(sheet)?.variants.filter(isFillVariant) || [];

/** Library const names the sections need (+ the fill variant). */
export function libraryIds(sheet) {
  const ids = new Set();
  for (const sec of sheet.sections) for (const x of sec.play) ids.add(`${x.part}_${x.variant}`);
  const fp = fillPart(sheet);
  if (fp) for (const v of fillVariants(sheet)) ids.add(`${fp.id}_${v}`);
  return [...ids];
}

export const isFnPart = (lib, id) => new RegExp(`(?:const|let|var)\\s+${id}\\s*=\\s*\\(?\\s*[A-Za-z_$][\\w$]*\\s*\\)?\\s*=>`).test(lib);

export const definesId = (lib, id) => new RegExp(`(?:const|let|var)\\s+${id}\\s*=`).test(lib);

export const partExpr = (lib, id) => (isFnPart(lib, id) ? `${id}(sectionChords)` : id);

/**
 * Strudel's transpiler turns double-quoted (and backtick) strings into mini-notation.
 * The silent test runs plain JS, so do the same: "bd sd" → mini("bd sd").
 */
export function miniStrings(code) {
  let out = '', i = 0;
  while (i < code.length) {
    const c = code[i], d = code[i + 1];
    if (c === '/' && d === '/') { const e = code.indexOf('\n', i); const j = e < 0 ? code.length : e; out += code.slice(i, j); i = j; continue; }
    if (c === '/' && d === '*') { const e = code.indexOf('*/', i + 2); const j = e < 0 ? code.length : e + 2; out += code.slice(i, j); i = j; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < code.length && code[j] !== c) j += code[j] === '\\' ? 2 : 1;
      const lit = code.slice(i, j + 1);
      out += c === "'" || (c === '`' && lit.includes('${')) ? lit : `mini(${c === '`' ? JSON.stringify(lit.slice(1, -1)) : lit})`;
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
