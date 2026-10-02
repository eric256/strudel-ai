// Song sheets: the AI's plan of a song (tempo, key, chords, hook, parts, sections) checked and repaired, and the
// part library's shape (which consts a sheet needs).
import { ident } from './util.js';
import { fixScaleString } from './scales.js';
import { normProgression, normMeter, sectionType, ENTER_MODES, MAX_KEY_SHIFT, MAX_TEMPO_DRIFT, MAX_CHORUS_BARS } from './music.js';
import { parseFormSections, findIn } from './forms.js';
import { enforceBand } from './bands.js';
import { normStyle, styleParams, diffParams } from '../master.js';

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
  const hook = String(raw.hook || '0 2 4 2').replace(/[^0-9~\s\-\[\]<>.*@!_?,:]/g, ' ').replace(/\s+/g, ' ').trim() || '0 2 4 2';
  const parts = [];
  for (const p of Array.isArray(raw.parts) ? raw.parts : []) {
    const id = ident(p.name || p.role);
    if (parts.some((q) => q.id === id)) continue;
    const variants = [...new Set(['main', ...(Array.isArray(p.variants) ? p.variants : []).map(ident)])];
    parts.push({ id, role: String(p.role || '').toLowerCase(), sound: String(p.sound || ''), desc: String(p.desc || p.description || ''), variants });
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
    sections.push(out);
  }
  if (sections.length < 2) throw new Error('fewer than 2 sections');
  // the form decides the section lengths: take its bar counts when the sections line up, otherwise cap them
  const form = enforceForm ? (choice !== 'auto' && findIn(forms, choice)) || findIn(forms, raw.form) : null;
  const fsecs = form ? parseFormSections(form.sections) : [];
  if (fsecs.length === sections.length) sections.forEach((sec, j) => { sec.bars = fsecs[j].bars; });
  else if (enforceForm) {
    const cap = fsecs.length ? Math.max(...fsecs.map((x) => x.bars)) : 16;
    for (const sec of sections) sec.bars = Math.min(sec.bars, cap);
  }
  if (!enforceForm) for (const sec of sections) sec.bars = Math.max(1, Math.min(32, sec.bars));
  // choruses (and hooks) the AI writes are short and punchy: never longer than 4 bars (your own edits may be longer)
  if (enforceForm) for (const sec of sections) if (sec.type === 'chorus') sec.bars = Math.min(sec.bars, MAX_CHORUS_BARS);
  // the band: its instruments win (when the song is being written), and its master style is the default
  const band = (bandPick && bandPick !== 'auto' && findIn(bands, bandPick)) || findIn(bands, raw.band);
  if (band && enforceForm) enforceBand(parts, band);
  const masterStyle = normStyle(raw.master || raw.masterStyle) || normStyle(band?.master) || normStyle(form?.name || raw.form) || 'clean';
  const tweaks = raw.masterParams && typeof raw.masterParams === 'object' ? diffParams(styleParams(masterStyle, raw.masterParams), masterStyle) : {};
  return { form: form?.name || String(raw.form || ''), ...(band ? { band: band.name } : {}), master: masterStyle, ...(Object.keys(tweaks).length ? { masterParams: tweaks } : {}),
    bpm, meter, key: String(raw.key || scale.replace(':', ' ')), scale, chords, hook, parts, sections };
}

/** The part that gets the one-bar fill before choruses / drops (drums with a "fill" variant). */
export const fillPart = (sheet) => sheet.parts.find((p) => p.variants.includes('fill') && /drum|perc|beat/i.test(p.role + p.id)) ||
  sheet.parts.find((p) => p.variants.includes('fill'));

/** Library const names the sections need (+ the fill variant). */
export function libraryIds(sheet) {
  const ids = new Set();
  for (const sec of sheet.sections) for (const x of sec.play) ids.add(`${x.part}_${x.variant}`);
  const fp = fillPart(sheet);
  if (fp) ids.add(`${fp.id}_fill`);
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
