// 🧩 Example plugin: MusicXML import. ⬆ import in 🎵 Songs reads .musicxml / .xml / .mxl scores (from MuseScore,
// Finale, Sibelius, Dorico, Noteflight …) and turns them into songs you can play, edit and remix:
//   • every part (each staff of a piano) becomes a song part, its voices played together (stack), on its General
//     MIDI sound (or one guessed from its name); percussion becomes drums (bd, sd, hh …);
//   • repeats and 1st / 2nd endings are played out; the piece is cut into sections at rehearsal marks and double bar
//     lines (else every 8 bars), and sections that repeat share their parts;
//   • chord symbols (or, without them, chords worked out from the notes) become the sections' progressions, and a
//     lead sheet's chord symbols get a part of their own;
//   • tempo, meter and key come from the score.
// Not carried over: dynamics, articulations, ties across bar lines (the note sounds again), grace notes, lyrics.
// (How plugins work: PLUGINS.md — this one uses api.addImporter.)

// --- a small XML reader (MusicXML is plain XML: elements, attributes, text) -------------------------------------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (t) => t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m));
/** XML text → its root element { name, attrs, children, text }. */
export function parseXML(src) {
  const root = { name: '#doc', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] != null) top.text += m[1];
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const attrs = {};
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unescape(a[2] ?? a[3]);
      const el = { name: m[3], attrs, children: [], text: '' };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] != null) top.text += unescape(m[6]);
  }
  return root.children.find((c) => c.name !== '#text') || null;
}
const kid = (n, name) => n?.children.find((c) => c.name === name) || null;
const kids = (n, name) => n?.children.filter((c) => c.name === name) || [];
const txt = (n, name) => { const c = name ? kid(n, name) : n; return c ? c.text.trim() : ''; };
const num = (n, name, d = null) => { const t = txt(n, name); return t === '' || !Number.isFinite(Number(t)) ? d : Number(t); };

// --- the score -----------------------------------------------------------------------------------------------------
const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_KEYS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const MINOR_KEYS = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'];
const CHORD_KIND = { major: '', minor: 'm', augmented: 'aug', diminished: 'o', dominant: '7', 'major-seventh': '^7', 'minor-seventh': 'm7',
  'diminished-seventh': 'o7', 'augmented-seventh': 'aug7', 'half-diminished': 'm7b5', 'major-minor': 'm^7', 'major-sixth': '6', 'minor-sixth': 'm6',
  'dominant-ninth': '9', 'major-ninth': '^9', 'minor-ninth': 'm9', 'dominant-11th': '11', 'minor-11th': 'm11', 'dominant-13th': '13',
  'suspended-second': 'sus2', 'suspended-fourth': 'sus', power: '5' };
const PC_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** A sound for a part from its name, when the score has no MIDI program. */
const NAME_SOUNDS = [[/piano|keyboard|klavier/, 'gm_piano'], [/organ/, 'gm_church_organ'], [/harpsichord|cembalo/, 'gm_harpsichord'],
  [/acoustic bass|double bass|contrabass|upright/, 'gm_acoustic_bass'], [/electric bass|bass guitar/, 'gm_electric_bass_finger'],
  [/violin|fiddle/, 'gm_violin'], [/viola/, 'gm_viola'], [/cello|violoncello/, 'gm_cello'], [/strings?\b/, 'gm_string_ensemble_1'],
  [/harp/, 'gm_orchestral_harp'], [/flute|flauto/, 'gm_flute'], [/piccolo/, 'gm_piccolo'], [/oboe/, 'gm_oboe'], [/clarinet/, 'gm_clarinet'],
  [/bassoon/, 'gm_bassoon'], [/horn/, 'gm_french_horn'], [/trumpet|cornet/, 'gm_trumpet'], [/trombone/, 'gm_trombone'], [/tuba/, 'gm_tuba'],
  [/soprano sax/, 'gm_soprano_sax'], [/alto sax/, 'gm_alto_sax'], [/tenor sax/, 'gm_tenor_sax'], [/baritone sax|bari sax/, 'gm_baritone_sax'], [/sax/, 'gm_alto_sax'],
  [/electric guitar/, 'gm_electric_guitar_clean'], [/guitar/, 'gm_acoustic_guitar_nylon'], [/bass/, 'gm_acoustic_bass'], [/marimba/, 'gm_marimba'],
  [/vibraphone|vibes/, 'gm_vibraphone'], [/xylophone/, 'gm_xylophone'], [/glockenspiel/, 'gm_glockenspiel'], [/celesta/, 'gm_celesta'],
  [/accordion/, 'gm_accordion'], [/harmonica/, 'gm_harmonica'], [/recorder/, 'gm_recorder'], [/choir|voice|vocal|soprano|alto|tenor|baritone|melody/, 'gm_choir_aahs'],
  [/timpani/, 'gm_timpani'], [/banjo/, 'gm_banjo'], [/mandolin|ukulele/, 'gm_acoustic_guitar_steel'], [/synth/, 'gm_lead_2_sawtooth']];
const soundFromName = (name) => NAME_SOUNDS.find(([re]) => re.test(name.toLowerCase()))?.[1] || null;

/** The measures in playing order: repeats played (twice, or `times`), 1st / 2nd endings followed. */
export function playOrder(measures) {
  const order = [];
  let start = 0, pass = 1, i = 0, guard = 0;
  const done = new Set(); // backward repeats already taken their passes
  while (i < measures.length && guard++ < 5000) {
    const m = measures[i];
    if (m.repeatForward && !done.has(`f${i}`)) { start = i; }
    if (m.ending && !m.ending.includes(pass)) { i++; continue; }
    order.push(i);
    const times = m.repeatBackward;
    if (times && !done.has(i)) {
      if (pass < times) { pass++; i = start; continue; }
      done.add(i);
      pass = 1;
      start = i + 1;
    }
    i++;
  }
  return order;
}

/** One part of the score, walked: its measures' notes per (staff, voice), and what the measures say. */
function readPart(partEl, info) {
  let divisions = 1, beats = 4, beatType = 4, chromatic = 0;
  const measures = [];
  for (const [mi, mEl] of kids(partEl, 'measure').entries()) {
    const meas = { number: mEl.attrs.number, implicit: mEl.attrs.implicit === 'yes', notes: [], chords: [] };
    let pos = 0, lastStart = 0, maxPos = 0;
    for (const el of mEl.children) {
      if (el.name === 'attributes') {
        divisions = num(el, 'divisions', divisions);
        const time = kid(el, 'time');
        if (time && num(time, 'beats') != null) { beats = num(time, 'beats'); beatType = num(time, 'beat-type', 4); meas.time = `${beats}/${beatType}`; }
        const key = kid(el, 'key');
        if (key && num(key, 'fifths') != null) meas.key = { fifths: num(key, 'fifths'), mode: txt(key, 'mode') || 'major' };
        const tr = kid(el, 'transpose');
        if (tr) chromatic = num(tr, 'chromatic', 0) + 12 * num(tr, 'octave-change', 0);
      } else if (el.name === 'backup') pos -= num(el, 'duration', 0);
      else if (el.name === 'forward') pos += num(el, 'duration', 0);
      else if (el.name === 'direction') {
        const snd = kid(el, 'sound');
        if (snd?.attrs.tempo && meas.tempo == null) meas.tempo = Number(snd.attrs.tempo);
        const metro = kid(kid(el, 'direction-type'), 'metronome');
        if (metro && meas.tempo == null && num(metro, 'per-minute') != null) {
          const unit = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }[txt(metro, 'beat-unit')] || 1;
          meas.tempo = num(metro, 'per-minute') * unit * (kid(metro, 'beat-unit-dot') ? 1.5 : 1);
        }
        const reh = kid(kid(el, 'direction-type'), 'rehearsal');
        if (reh && txt(reh)) meas.mark = txt(reh);
      } else if (el.name === 'sound' && el.attrs.tempo && meas.tempo == null) meas.tempo = Number(el.attrs.tempo);
      else if (el.name === 'harmony') {
        const root = kid(el, 'root');
        if (root) {
          const pc = (STEP[txt(root, 'root-step')] ?? 0) + num(root, 'root-alter', 0);
          const kindEl = kid(el, 'kind');
          const kind = CHORD_KIND[txt(kindEl)] ?? (kindEl?.attrs.text || '');
          meas.chords.push({ at: pos + num(el, 'offset', 0), name: `${PC_NAMES[((pc % 12) + 12) % 12]}${kind}` });
        }
      } else if (el.name === 'barline') {
        const rep = kid(el, 'repeat');
        if (rep?.attrs.direction === 'forward') meas.repeatForward = true;
        if (rep?.attrs.direction === 'backward') meas.repeatBackward = Number(rep.attrs.times) || 2;
        const end = kid(el, 'ending');
        if (end && (end.attrs.type === 'start' || !meas.ending)) meas.ending = String(end.attrs.number || '1').split(/[,\s]+/).map(Number).filter(Boolean);
        if (/light-light|light-heavy|heavy-light/.test(txt(el, 'bar-style'))) meas.double = true;
      } else if (el.name === 'note') {
        if (kid(el, 'grace') || kid(el, 'cue')) continue;
        const dur = num(el, 'duration', 0);
        const start = kid(el, 'chord') ? lastStart : pos;
        if (!kid(el, 'chord')) { lastStart = pos; pos += dur; }
        maxPos = Math.max(maxPos, pos);
        if (kid(el, 'rest')) continue;
        const staff = txt(el, 'staff') || '1', voice = txt(el, 'voice') || '1';
        const tieStop = kids(el, 'tie').some((t) => t.attrs.type === 'stop'), tieStart = kids(el, 'tie').some((t) => t.attrs.type === 'start');
        let val = null, midi = null;
        const p = kid(el, 'pitch');
        if (p) { midi = (num(p, 'octave', 4) + 1) * 12 + (STEP[txt(p, 'step')] ?? 0) + num(p, 'alter', 0) + chromatic; }
        else if (kid(el, 'unpitched')) {
          const inst = kid(el, 'instrument')?.attrs.id;
          const gm = info.drums[inst] ?? null;
          const u = kid(el, 'unpitched');
          const disp = (num(u, 'display-octave', 4) + 1) * 12 + (STEP[txt(u, 'display-step')] ?? 0);
          val = info.drumName(gm, disp);
        } else continue;
        meas.notes.push({ start, dur, staff, voice, midi, val, tieStop, tieStart, bar: mi });
      }
    }
    meas.len = Math.round(beats * (4 / beatType) * divisions);
    meas.used = maxPos;
    meas.beats = beats; meas.beatType = beatType;
    measures.push(meas);
  }
  return measures;
}

/** A drum sound for a percussion note: its General MIDI drum, else where it sits on the staff. */
function drumNamer(gmDrums) {
  return (gm, disp) => {
    if (gm != null && gmDrums[gm]) return gmDrums[gm];
    if (disp <= 65) return 'bd'; // F4 and below: kick
    if (disp <= 72) return 'sd'; // C5: snare
    if (disp <= 74) return 'lt';
    return 'hh';
  };
}

/** The best plain chord (major / minor triad) for a bar's notes: { name } or null. */
export function guessChord(weights) {
  let best = null, bestScore = 0;
  for (let r = 0; r < 12; r++) for (const [q, third] of [['', 4], ['m', 3]]) {
    const score = weights[r] * 1.2 + weights[(r + third) % 12] + weights[(r + 7) % 12] * 0.8 - weights[(r + (third === 4 ? 3 : 4)) % 12] * 0.6;
    if (score > bestScore) { bestScore = score; best = `${PC_NAMES[r]}${q}`; }
  }
  return best;
}

/**
 * MusicXML text → a song as JSON ({ format, title, desc, sheet, library }): what the app's ⬆ import makes a song of.
 * tools: the importer helpers (serializeMini, midiToNote, gmSound, GM_DRUMS, ident, meterBeats, normMeter …).
 */
export function musicXmlToSong(xml, tools, { fileName = 'score' } = {}) {
  const score = parseXML(xml);
  if (!score) throw new Error('this is not an XML file');
  if (score.name === 'score-timewise') throw new Error('timewise MusicXML isn\'t supported — export it as partwise (the usual kind)');
  if (score.name !== 'score-partwise') throw new Error(`not a MusicXML score (it starts with <${score.name}>)`);
  const title = txt(kid(score, 'work'), 'work-title') || txt(score, 'movement-title') || txt(kid(score, 'credit'), 'credit-words') || fileName.replace(/\.\w+$/, '');
  const composer = kids(kid(score, 'identification'), 'creator').find((c) => c.attrs.type === 'composer');

  // the parts: their names, MIDI programs, percussion
  const list = kid(score, 'part-list');
  const meta = new Map();
  for (const sp of kids(list, 'score-part')) {
    const drums = {};
    let program = null, channel = null;
    for (const mi of kids(sp, 'midi-instrument')) {
      if (num(mi, 'midi-unpitched') != null) drums[mi.attrs.id] = num(mi, 'midi-unpitched') - 1; // (1-based in MusicXML)
      program ??= num(mi, 'midi-program');
      channel ??= num(mi, 'midi-channel');
    }
    meta.set(sp.attrs.id, { name: txt(sp, 'part-name') || txt(sp, 'part-abbreviation') || sp.attrs.id, program, channel, drums });
  }
  const read = kids(score, 'part').map((pEl) => {
    const m = meta.get(pEl.attrs.id) || { name: pEl.attrs.id, drums: {} };
    return { ...m, measures: readPart(pEl, { drums: m.drums, drumName: drumNamer(tools.GM_DRUMS) }) };
  }).filter((p) => p.measures.length);
  if (!read.length) throw new Error('the score has no parts');
  const first = read[0].measures;
  const order = playOrder(first);
  if (!order.length) throw new Error('the score has no measures');

  // tempo, meter, key (from the first measure that says)
  const firstOf = (k) => first.find((m) => m[k] != null)?.[k];
  const meterRaw = firstOf('time') || '4/4';
  const [bt, bty] = meterRaw.split('/').map(Number);
  const meter = tools.normMeter(meterRaw);
  const quarterBpm = firstOf('tempo') || 100;
  const barQuarters = bt * (4 / bty);
  const toBpm = (q) => Math.round((q / barQuarters) * tools.meterBeats(meter)); // (one cycle = one bar)
  const keyInfo = firstOf('key') || { fifths: 0, mode: 'major' };
  const minor = /minor|aeolian/.test(keyInfo.mode);
  const tonic = (minor ? MINOR_KEYS : MAJOR_KEYS)[Math.max(0, Math.min(14, keyInfo.fifths + 7))];
  const flats = keyInfo.fifths < 0;

  // lines: (part, staff) → song parts; voices in a staff play together
  const lines = [];
  for (const p of read) {
    const perc = Object.keys(p.drums).length > 0 || p.channel === 10 || p.measures.some((m) => m.notes.some((n) => n.val));
    const staves = [...new Set(p.measures.flatMap((m) => m.notes.map((n) => n.staff)))].sort();
    for (const staff of staves) lines.push({ part: p, staff, perc, many: staves.length > 1 });
  }
  // a bar of one voice: events on the bar's grid (48 steps), chords merged
  const barOf = (m, staff, voice, perc) => {
    const full = m.len || 1, q = full / 48;
    const shift = m.implicit && m.used < full ? full - m.used : 0; // a pickup bar sits at the end of the bar
    const snap = (x) => Math.max(0, Math.min(full, Math.round(x / q) * q));
    const evs = new Map();
    for (const n of m.notes) {
      if (n.staff !== staff || n.voice !== voice) continue;
      const v = perc ? n.val : n.midi;
      if (v == null) continue;
      const t = snap(n.start + shift);
      if (t >= full) continue;
      // a tied note continues the same pitch in this bar: longer, not again
      const held = n.tieStop && [...evs.values()].find((e) => e.t + e.len === t && e.vals.includes(v));
      if (held) { held.len = snap(t + n.dur) - held.t || held.len; continue; }
      const e = evs.get(t) || { t, len: Math.max(q, snap(t + n.dur) - t), vals: [] };
      if (!e.vals.includes(v)) e.vals.push(v);
      e.len = Math.max(e.len, Math.max(q, snap(t + n.dur) - t));
      evs.set(t, e);
    }
    const events = [...evs.values()].sort((a, b) => a.t - b.t);
    for (let k = 0; k < events.length - 1; k++) events[k].len = Math.min(events[k].len, events[k + 1].t - events[k].t);
    for (const e of events) e.len = Math.min(e.len, full - e.t);
    const res = 48;
    const k = res / full;
    return { res, events: events.map((e) => ({ t: Math.round(e.t * k), len: Math.max(1, Math.round(e.len * k)),
      vals: (perc ? e.vals : e.vals.slice().sort((a, b) => a - b).map((x) => tools.midiToNote(x, flats))).map(String) })) };
  };

  // sections: at rehearsal marks, double bar lines and repeat signs; else every 8 bars (at most 16)
  const cuts = [0];
  order.forEach((mi, k) => {
    if (k === 0) return;
    const m = first[mi], prev = first[order[k - 1]];
    const since = k - cuts[cuts.length - 1];
    if (m.mark || prev.double || m.repeatForward || prev.repeatBackward || mi !== order[k - 1] + 1 || since >= 16 || (since >= 8 && !first.some((x) => x.mark || x.double))) cuts.push(k);
  });
  if (cuts.length < 2) { const half = Math.max(1, Math.floor(order.length / 2)); if (half < order.length) cuts.push(half); }
  const spans = cuts.map((c, k) => [c, cuts[k + 1] ?? order.length]).filter(([a, b]) => b > a);
  if (spans.length < 2) spans.push(spans[0]); // a one-bar piece: played twice

  // chords per bar: the score's chord symbols, else worked out from the notes
  const hasSymbols = first.some((m) => m.chords.length);
  let lastChord = `${tonic}${minor ? 'm' : ''}`;
  const barChord = order.map((mi) => {
    const sym = read.flatMap((p) => p.measures[mi]?.chords || []).sort((a, b) => a.at - b.at)[0];
    if (sym) return (lastChord = sym.name);
    if (hasSymbols) return lastChord;
    const w = new Array(12).fill(0);
    for (const p of read) for (const n of p.measures[mi]?.notes || []) if (n.midi != null) w[((n.midi % 12) + 12) % 12] += n.dur || 1;
    return (lastChord = guessChord(w) || lastChord);
  });

  // the song's parts and their variants (a variant per distinct section; repeats share)
  const used = new Set();
  const nameOf = (line) => {
    let base = tools.ident(line.part.name).slice(0, 20);
    if (line.many) base += line.staff === '1' ? '_rh' : line.staff === '2' ? '_lh' : `_s${line.staff}`;
    let id = base, k = 2;
    while (used.has(id)) id = `${base}${k++}`;
    used.add(id);
    return id;
  };
  const parts = [], defs = [];
  const sectionsPlay = spans.map(() => []);
  for (const line of lines) {
    const voices = [...new Set(line.part.measures.flatMap((m) => m.notes.filter((n) => n.staff === line.staff).map((n) => n.voice)))].sort();
    const codes = spans.map(([a, b]) => {
      const lineCodes = voices.map((v) => {
        const bars = order.slice(a, b).map((mi) => barOf(line.part.measures[mi] || { len: 1, notes: [], chords: [] }, line.staff, v, line.perc));
        if (!bars.some((x) => x.events.length)) return null;
        return `${line.perc ? 's' : 'note'}("${tools.serializeMini({ alt: bars.length > 1, bars })}")`;
      }).filter(Boolean);
      return lineCodes.length ? (lineCodes.length > 1 ? `stack(${lineCodes.join(', ')})` : lineCodes[0]) : null;
    });
    if (!codes.some(Boolean)) continue;
    const id = nameOf(line);
    const notes = line.part.measures.flatMap((m) => m.notes.filter((n) => n.staff === line.staff));
    const low = notes.filter((n) => n.midi != null).reduce((a, n) => a + n.midi, 0) / Math.max(1, notes.filter((n) => n.midi != null).length);
    const chordy = notes.length > 0 && notes.length / new Set(notes.map((n) => `${n.bar}|${n.start}|${n.voice}`)).size > 1.5;
    const role = line.perc ? 'drums' : /bass|contrabass|tuba/i.test(line.part.name) || (line.staff === '2' && low < 52) || low < 45 ? 'bass' : chordy ? 'chords' : 'melody';
    const sound = line.perc ? '' : tools.gmSound(line.part.program) || soundFromName(line.part.name) || 'gm_piano';
    const variants = [];
    codes.forEach((code, s) => {
      if (!code) return;
      let k = variants.findIndex((v) => v.code === code);
      if (k < 0) { variants.push({ code, name: variants.length ? `v${variants.length + 1}` : 'main' }); k = variants.length - 1; }
      sectionsPlay[s].push(variants[k].name === 'main' ? id : `${id}.${variants[k].name}`);
    });
    const tail = line.perc ? `.gain(slider(0.8, 0, 1.2))` : `.s("${sound}").gain(slider(0.7, 0, 1.2))`;
    for (const v of variants) defs.push(`const ${id}_${v.name} = ${v.code}${tail}`);
    parts.push({ name: id, role, sound: line.perc ? 'bd' : sound, variants: variants.map((v) => v.name), desc: `${line.part.name}${line.many ? ` (staff ${line.staff})` : ''} from the score`, notes: notes.length });
  }
  if (!parts.length) throw new Error('the score has no notes');

  // the chord progressions (one per distinct section's chords)
  const chords = {}, sectionChords = spans.map(([a, b]) => {
    const prog = tools.normProgression(barChord.slice(a, b).join(' ')) || `<${lastChord}>`;
    let key = Object.keys(chords).find((k) => chords[k] === prog);
    if (!key) { key = `c${Object.keys(chords).length + 1}`; chords[key] = prog; }
    return key;
  });
  // a lead sheet's chord symbols get a part of their own (and a song needs 2 parts)
  if (hasSymbols || parts.length < 2) {
    parts.push({ name: 'chords', role: 'chords', sound: 'gm_epiano1', variants: ['main'], desc: hasSymbols ? 'the score\'s chord symbols' : 'chords worked out from the notes' });
    defs.push('const chords_main = (prog) => chord(prog).voicing().s("gm_epiano1").gain(slider(0.4, 0, 1.2))');
    sectionsPlay.forEach((pl) => pl.push('chords'));
  }
  // at most 10 parts: the busiest
  let dropped = [];
  if (parts.length > 10) {
    const keep = new Set(parts.slice().sort((a, b) => (b.notes ?? 1e9) - (a.notes ?? 1e9)).slice(0, 10).map((p) => p.name));
    dropped = parts.filter((p) => !keep.has(p.name)).map((p) => p.name);
  }
  const keepPart = (n) => !dropped.includes(String(n).split('.')[0]);

  // section names: rehearsal marks, else letters; sections with the same music share a name
  const letters = new Map();
  const sections = spans.map(([a, b], s) => {
    const play = sectionsPlay[s].filter(keepPart);
    const sig = `${play.join(',')}|${sectionChords[s]}`;
    const mark = first[order[a]].mark;
    if (!letters.has(sig)) letters.set(sig, mark || String.fromCharCode(65 + Math.min(25, letters.size)));
    const tempo = first[order[a]].tempo;
    return { name: mark || letters.get(sig), bars: b - a, chords: sectionChords[s], play: play.length ? play : [parts[0].name],
      ...(tempo && Math.abs(tempo - quarterBpm) > 1 ? { bpm: toBpm(tempo) } : {}) };
  });

  const bpm = toBpm(quarterBpm);
  const library = [tools.tempoLine(bpm, meter), ...defs.filter((d) => keepPart(d.match(/^const (\w+?)_(?:main|v\d+) /)?.[1] || ''))].join('\n') + '\n';
  const partNames = parts.filter((p) => keepPart(p.name)).map((p) => p.name);
  return {
    format: 'strudel-ai-song', version: 1, title: title.slice(0, 80),
    desc: `Imported from MusicXML (${fileName})${composer ? ` — ${txt(composer)}` : ''}: ${order.length} bars in ${meterRaw}, ${tonic} ${minor ? 'minor' : 'major'}, ${Math.round(quarterBpm)} bpm; parts ${partNames.join(', ')}${dropped.length ? ` (left out: ${dropped.join(', ')})` : ''}`,
    sheet: {
      title, form: 'imported', master: 'clean', bpm, meter, key: `${tonic} ${minor ? 'minor' : 'major'}`, scale: `${tonic}:${minor ? 'minor' : 'major'}`,
      chords, parts: parts.filter((p) => keepPart(p.name)).map(({ notes, ...p }) => p), sections, ending: 'fade',
    },
    library,
  };
}

export default {
  id: 'musicxml-import',
  name: 'MusicXML import',
  version: '1.0.0',
  description: 'Import MusicXML scores (.musicxml, .xml, .mxl from MuseScore, Finale, Sibelius, Dorico …) as songs: ⬆ import in 🎵 Songs.',
  setup(api) {
    api.addImporter({
      id: 'musicxml', label: 'MusicXML', icon: '🎼', accept: ['.musicxml', '.mxl', '.xml'],
      title: 'A MusicXML score: its parts, notes, repeats, chords, tempo and key',
      async import(file, tools) {
        let xml;
        if (/\.mxl$/i.test(file.name)) {
          // compressed MusicXML: a zip whose META-INF/container.xml names the score
          const files = await tools.unzip(new Uint8Array(await file.arrayBuffer()));
          const container = tools.zipText(files, 'META-INF/container.xml');
          const path = container?.match(/full-path\s*=\s*"([^"]+)"/)?.[1] || [...files.keys()].find((n) => /\.(musicxml|xml)$/i.test(n) && !n.startsWith('META-INF'));
          xml = path && tools.zipText(files, path);
          if (!xml) throw new Error('no score inside this .mxl');
        } else xml = await file.text();
        return musicXmlToSong(xml, tools, { fileName: file.name });
      },
    });
  },
};
