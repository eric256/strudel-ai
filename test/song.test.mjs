// The song engine's pure logic (public/lib): music theory, labels, forms, bands, sheets, arranging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normChord, normProgression, transposeProgression, normMeter, meterBeats, meterSteps, tempoLine, sectionType, enterMask } from '../public/lib/music.js';
import { parseLabel, makeLabel, patternLines } from '../public/lib/labels.js';
import { setScales, fixScaleString } from '../public/lib/scales.js';
import { DEFAULT_FORMS, parseFormSections, formBars, findIn, formsForRequest } from '../public/lib/forms.js';
import { DEFAULT_BANDS, parseInstruments, enforceBand, bandsForRequest, parseTweaks } from '../public/lib/bands.js';
import { planSong, planForRequest, genreScore, describedKey, describedMeter } from '../public/lib/plan.js';
import { normalizeSheet, libraryIds, fillPart, isFnPart, miniStrings, assignTunes, STYLE_FEEL, normFeel } from '../public/lib/sheet.js';
import { GENRES, detectGenre, genresOf } from '../public/lib/genres.js';
import { GAP_BARS, feelCode, sectionAfterEdit, sectionCode, arrangeSong, carryLiveState, LIB_START, SEC_START } from '../public/lib/arrange.js';
import { parseJSONLoose, closest, esc } from '../public/lib/util.js';
import { normStyle, styleParams, diffParams, MASTER_STYLES } from '../public/master.js';
import { SOUND_GUIDE, ACOUSTIC_PERC, soundGuide } from '../public/sounds.js';

setScales(JSON.parse(readFileSync(new URL('../public/scales.json', import.meta.url), 'utf8')));

test('chords are normalised to symbols Strudel knows', () => {
  assert.equal(normChord('Fmaj7'), 'F^7');
  assert.equal(normChord('Bdim'), 'Bo');
  assert.equal(normChord('Gsus4'), 'Gsus');
  assert.equal(normChord('C/E'), 'C');
  assert.equal(normProgression('Am | F | C | G'), '<Am F C G>');
  assert.equal(normProgression(''), null);
});

test('progressions transpose with sensible spellings', () => {
  assert.equal(transposeProgression('<Am F C G>', 2), '<Bm G D A>');
  assert.equal(transposeProgression('<C G/B Am>', 1), '<Db Ab/C Bbm>');
  assert.equal(transposeProgression('<Am F C G>', 0), '<Am F C G>');
});

test('meters: beats for the tempo line, steps for rhythms', () => {
  assert.equal(normMeter(' 6 / 8 '), '6/8');
  assert.equal(normMeter('11/16'), '4/4');
  assert.equal(meterBeats('4/4'), 4);
  assert.equal(meterBeats('6/8'), 2);
  assert.equal(meterBeats('7/8'), 3.5);
  assert.equal(meterSteps('5/4'), 5);
  assert.equal(tempoLine(120, '3/4'), 'setcpm(120/3)');
});

test('section types and enter masks', () => {
  assert.equal(sectionType('Pre-Chorus'), 'prechorus');
  assert.equal(sectionType('chorus 2'), 'chorus');
  assert.equal(sectionType('drop'), 'drop');
  assert.equal(sectionType('A'), 'verse');
  assert.equal(enterMask('in', 4), '<0 0 1 1>');
  assert.equal(enterMask('out', 4), '<1 1 0 0>');
  assert.equal(enterMask('alt', 8), '<1 1 0 0 1 1 0 0>');
  assert.equal(enterMask(null, 8), null);
});

test('labels: mute and solo spellings round-trip', () => {
  assert.deepEqual(parseLabel('_bass'), { muted: true, solo: false, base: 'bass' });
  assert.deepEqual(parseLabel('Sbass'), { muted: false, solo: true, base: 'bass' });
  assert.deepEqual(parseLabel('$'), { muted: false, solo: false, base: '$' });
  assert.equal(makeLabel({ base: 'bass', muted: true }), '_bass');
  assert.equal(makeLabel({ base: 'bass', solo: true }), 'Sbass');
  const rows = patternLines('setcpm(30)\ndrums: s("bd")\n_bass: note("c2")\nconst x = 1');
  assert.deepEqual(rows.map((r) => [r.line, r.base, r.muted]), [[1, 'drums', false], [2, 'bass', true]]);
});

test('scale names are repaired', () => {
  assert.equal(fixScaleString('C:minorpentatonic').fixed, 'C:minor:pentatonic');
  assert.equal(fixScaleString('A minor').fixed, 'A:minor');
  assert.deepEqual(fixScaleString('C:nonsensescale').unknown, ['C:nonsensescale']);
});

test('forms: sections parse, lists are searched by name', () => {
  assert.deepEqual(parseFormSections('intro 4, verse 8\nchorus: 4 bars'), [{ name: 'intro', bars: 4 }, { name: 'verse', bars: 8 }, { name: 'chorus', bars: 4 }]);
  assert.equal(formBars({ sections: 'intro 4, A 8, outro 4' }), 16);
  assert.equal(findIn(DEFAULT_FORMS, ' POP ').name, 'pop');
  assert.match(formsForRequest(DEFAULT_FORMS, 'lo-fi'), /build the song on this one \(set "form": "lo-fi"\); it's a guide/);
  assert.match(formsForRequest(DEFAULT_FORMS, 'auto'), /pick the one that fits/);
});

test('bands: instruments parse and are enforced by role', () => {
  const inst = parseInstruments('drums: RolandTR909 — four on the floor\nbass: gm_synth_bass_1\n+ fx: white — risers\nnot an instrument');
  assert.deepEqual(inst, [{ role: 'drums', sound: 'RolandTR909', desc: 'four on the floor', optional: false }, { role: 'bass', sound: 'gm_synth_bass_1', desc: '', optional: false },
    { role: 'fx', sound: 'white', desc: 'risers', optional: true }]);
  const band = { name: 'x', instruments: 'pad: gm_pad_warm\npad: gm_pad_halo\nbass: sine' };
  const parts = [{ role: 'pad', sound: 'sawtooth' }, { role: 'pad', sound: 'square' }, { role: 'bass', sound: 'SINE' }, { role: 'melody', sound: 'square' }];
  enforceBand(parts, band);
  assert.deepEqual(parts.map((p) => p.sound), ['gm_pad_warm', 'gm_pad_halo', 'SINE', 'square']);
  assert.match(bandsForRequest(DEFAULT_BANDS, 'techno rig'), /write the song for this band \(set "band": "techno rig" and "master": "techno"\)/);
  assert.match(bandsForRequest(DEFAULT_BANDS, 'techno rig'), /fx: white — noise risers and sweeps \(optional\)/);
  assert.deepEqual(parseTweaks('high 2.5, space 0.3'), { high: 2.5, space: 0.3 });
  for (const b of DEFAULT_BANDS) assert.ok(normStyle(b.master), `band ${b.name} has a known master style`);
});

const RAW = {
  title: 'Test', form: 'short', band: 'synthwave', bpm: 300, meter: '6/8', key: 'A minor', scale: 'A minorr',
  chords: { verse: 'Am F C G', chorus: ['Fmaj7', 'G', 'Am', 'Am'] },
  hook: '0 2 4 2 <script>',
  parts: [
    { name: 'Drums', role: 'drums', sound: 'sawtooth', variants: ['main', 'fill'] },
    { name: 'bass', role: 'bass', sound: 'sawtooth', variants: ['main', 'alt1'] },
    { name: 'lead', role: 'melody', sound: 'square' },
  ],
  sections: [
    { name: 'intro', bars: 30, chords: 'verse', play: ['bass', 'lead@in'] },
    { name: 'A', bars: 8, chords: 'verse', play: ['drums', 'bass.alt1'], shift: 9, bpm: 500 },
    { name: 'chorus', bars: 8, chords: 'chorus', play: ['drums', 'bass', 'lead', 'ghost'] },
    { name: 'A', bars: 8, chords: 'nope', play: [] },
    { name: 'outro', bars: 4, chords: 'verse', play: ['bass'] },
  ],
};
const ctx = { forms: DEFAULT_FORMS, bands: DEFAULT_BANDS };

test('normalizeSheet repairs and bounds what the AI writes', () => {
  const sh = normalizeSheet(structuredClone(RAW), 'auto', ctx);
  assert.equal(sh.bpm, 200);
  assert.equal(sh.meter, '6/8');
  assert.equal(sh.scale, 'A:minor');
  assert.equal(sh.chords.chorus, '<F^7 G Am Am>');
  assert.doesNotMatch(sh.hook, /script/);
  assert.deepEqual(sh.parts.map((p) => p.id), ['drums', 'bass', 'lead']);
  assert.deepEqual(sh.sections.map((x) => x.bars), [16, 8, 4, 8, 4], 'the form is a guide: lengths stay (up to 16 bars); choruses are 4 at most');
  assert.deepEqual(sh.sections[0].play, [{ part: 'bass', variant: 'main' }, { part: 'lead', variant: 'main', enter: 'in' }]);
  assert.equal(sh.sections[1].shift, 3);
  assert.equal(sh.sections[1].bpm, 216);
  assert.equal(sh.sections[2].play.length, 3, 'unknown parts are dropped');
  assert.deepEqual(sh.sections[3].play, sh.sections[2].play, 'an empty section repeats the one before');
  assert.equal(sh.sections[3].chords, 'verse', 'unknown chords → the first progression');
  // the band holds the sounds and gives the master style
  assert.equal(sh.band, 'synthwave');
  assert.equal(sh.master, 'synthwave');
  assert.equal(sh.parts.find((p) => p.id === 'drums').sound, 'LinnDrum');
  assert.equal(sh.parts.find((p) => p.id === 'lead').sound, 'gm_lead_2_sawtooth');
});

test('normalizeSheet: edits keep their bars and sounds; master tweaks are kept as a diff', () => {
  const sh = normalizeSheet({ ...structuredClone(RAW), master: 'lo-fi', masterParams: { space: 0.6, low: 2 } }, 'auto', { ...ctx, enforceForm: false });
  assert.equal(sh.sections[0].bars, 30);
  assert.equal(sh.sections[2].bars, 8, 'a chorus you lengthen stays long');
  assert.equal(sh.parts.find((p) => p.id === 'drums').sound, 'sawtooth');
  assert.equal(sh.master, 'lo-fi');
  assert.deepEqual(sh.masterParams, { space: 0.6 }, 'low 2 is already lo-fi\'s value');
  assert.throws(() => normalizeSheet({ chords: {}, parts: [], sections: [] }, 'auto', ctx), /no chord progressions/);
});

const LIB = [
  'setcpm(100/4)',
  'const drums_main = s("bd*4")',
  'const drums_fill = s("sd*8")',
  'const bass_main = (prog) => chord(prog).rootNotes(2).s("sawtooth")',
  'const bass_alt1 = (prog) => chord(prog).rootNotes(1).s("sawtooth")',
  'const lead_main = n("0 2 4").scale("A:minor").s("square")',
].join('\n');

test('library shape: the consts a sheet needs, functions of prog', () => {
  const sh = normalizeSheet(structuredClone(RAW), 'auto', ctx);
  assert.deepEqual(libraryIds(sh).sort(), ['bass_alt1', 'bass_main', 'drums_fill', 'drums_main', 'lead_main']);
  assert.equal(fillPart(sh).id, 'drums');
  assert.ok(isFnPart(LIB, 'bass_main'));
  assert.ok(!isFnPart(LIB, 'lead_main'));
  assert.equal(miniStrings('s("bd sd") // "x"\nn(\'0 1\')'), 's(mini("bd sd")) // "x"\nn(\'0 1\')');
});

test('arranging: section code, key shifts, tempo, fills', () => {
  const song = { title: 'Test', sheet: normalizeSheet(structuredClone(RAW), 'auto', ctx), library: LIB };
  const code = sectionCode(song, song.sheet.sections[1]);
  assert.ok(code.includes(LIB_START) && code.includes(SEC_START));
  assert.match(code, /setcpm\(216\/2\)/, 'the section tempo in 6/8');
  assert.match(code, /const sectionChords = "<Cm Ab Eb Bb>"/, 'chords moved +3');
  assert.match(code, /^drums: drums_main\.postgain/m, 'drums are never transposed');
  assert.match(code, /^bass: bass_alt1\(sectionChords\)\.postgain/m);
  const intro = sectionCode(song, song.sheet.sections[0]);
  assert.match(intro, /^lead: lead_main\.mask\("<(0 ){8}(1 ){7}1>"\)/m, 'comes in halfway through the 16-bar intro');
  const steps = arrangeSong(song);
  const fill = steps.find((s) => s.fillStep);
  assert.ok(fill && fill.bars === 1, 'a one-bar fill before the chorus');
  assert.equal(steps.reduce((a, s) => a + s.bars, 0), song.sheet.sections.reduce((a, s) => a + s.bars, 0));
});

test('carryLiveState keeps fader positions and mutes into the next section', () => {
  const song = { title: 'Test', sheet: normalizeSheet(structuredClone(RAW), 'auto', ctx), library: LIB };
  const prev = sectionCode(song, song.sheet.sections[1]).replace('drums: drums_main.postgain(slider(1,', '_drums: drums_main.postgain(slider(0.4,');
  const next = carryLiveState(prev, sectionCode(song, song.sheet.sections[2]));
  assert.match(next, /^_drums: drums_main\.postgain\(slider\(0\.4,/m);
});

test('utils', () => {
  assert.deepEqual(parseJSONLoose('Sure!\n```json\n{"a": 1,\n// a note\n"b": [2,],}\n```'), { a: 1, b: [2] });
  assert.equal(closest('rolandtr-909', ['rolandtr909', 'linndrum']).best, 'rolandtr909');
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});

test('master styles', () => {
  assert.equal(normStyle('Lo Fi'), 'lo-fi');
  assert.equal(normStyle('drum & bass'), 'dnb');
  assert.equal(normStyle('xy'), '');
  assert.deepEqual(diffParams(styleParams('dub', { echo: 0.5 }), 'dub'), { echo: 0.5 });
});

test('events: listeners, wildcard, unsubscribe, a failing listener does not stop the others', async () => {
  const { createEmitter, onceAFrame } = await import('../public/lib/events.js');
  const ev = createEmitter();
  const got = [];
  const off = ev.on('section', (d) => got.push(['section', d]));
  ev.on('section', () => { throw new Error('listener bug'); });
  ev.on('*', (e, d) => got.push(['*', e, d]));
  const err = console.error; console.error = () => {};
  ev.emit('section', 1);
  off();
  ev.emit('section', 2);
  console.error = err;
  assert.deepEqual(got, [['section', 1], ['*', 'section', 1], ['*', 'section', 2]]);
  let n = 0;
  const once = onceAFrame(() => n++);
  once(); once(); once();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(n, 1);
});

test('dynamics: section level, a solo section, the ending', () => {
  const raw = structuredClone(RAW);
  raw.ending = 'cut';
  raw.sections[0].level = 0.6;
  raw.sections[2].level = 5;
  raw.sections[3] = { name: 'solo', bars: 8, chords: 'verse', play: ['drums', 'bass'], solo: 'lead.solo' };
  raw.parts[2].variants = ['main', 'solo'];
  const sh = normalizeSheet(raw, 'auto', { ...ctx, enforceForm: false });
  assert.equal(sh.sections[0].level, 0.6);
  assert.equal(sh.sections[2].level, 1.3, 'the level is bounded');
  assert.equal(sh.sections[3].solo, 'lead');
  assert.deepEqual(sh.sections[3].play.find((x) => x.part === 'lead'), { part: 'lead', variant: 'solo' }, 'the soloist joins the section, on its solo variant');
  assert.equal(sh.ending, 'cut');
  assert.equal(normalizeSheet(structuredClone(RAW), 'auto', ctx).ending, 'fade', 'songs fade out unless they stop hard');
});

test('arranging: fills lead into choruses, drops and solos and take turns; a hard ending leaves a bar of silence', () => {
  const raw = structuredClone(RAW);
  raw.parts[0].variants = ['main', 'fill', 'fill2'];
  raw.sections = [
    { name: 'intro', bars: 4, chords: 'verse', play: ['drums', 'bass'] },
    { name: 'verse', bars: 8, chords: 'verse', play: ['drums', 'bass'] },
    { name: 'chorus', bars: 4, chords: 'chorus', play: ['drums', 'bass', 'lead'] },
    { name: 'bridge', bars: 8, chords: 'chorus', play: ['drums', 'lead'] },
    { name: 'solo', bars: 8, chords: 'verse', play: ['drums', 'bass'], solo: 'lead' },
    { name: 'chorus', bars: 4, chords: 'chorus', play: ['drums', 'bass', 'lead'] },
    { name: 'outro', bars: 4, chords: 'verse', play: ['drums', 'bass'] },
  ];
  raw.ending = 'cut';
  const song = { title: 'T', sheet: normalizeSheet(raw, 'auto', { ...ctx, enforceForm: false }), library: LIB + 'const drums_fill2 = s("hh*16")\nconst lead_solo = n("0 2 4 7")\n' };
  assert.deepEqual(libraryIds(song.sheet).filter((x) => x.startsWith('drums_fill')).sort(), ['drums_fill', 'drums_fill2']);
  const steps = arrangeSong(song);
  assert.deepEqual(steps.filter((s) => s.fillStep).map((s) => s.prompt), ['verse · fill', 'bridge · fill2', 'solo · fill'],
    'into the chorus, the solo and the last chorus — not into the bridge or the outro — and the fills take turns');
  assert.match(steps.find((s) => s.fillStep === 'fill2').code, /^drums: drums_fill2\.postgain/m);
  const last = steps[steps.length - 1];
  assert.ok(last.gap && last.bars === GAP_BARS && /silence/.test(last.code), 'a bar of silence after a hard ending');
});

test('planning: form and band from the genre (one of the close matches), meter and key they allow', () => {
  let r = 0;
  const rand = () => { r = (r + 0.37) % 1; return r; };
  for (let k = 0; k < 20; k++) {
    const p = planSong('dark warehouse techno with acid lines', { forms: DEFAULT_FORMS, bands: DEFAULT_BANDS, rand });
    assert.match(p.form.name, /techno/, `a techno form, not ${p.form.name}`);
    assert.ok(['techno rig', 'acid box'].includes(p.band.name), `a techno band, not ${p.band.name}`);
    assert.equal(p.meter, '4/4');
    assert.ok([...p.form.keys.split(', '), ...p.band.keys.split(', ')].includes(p.key), p.key);
  }
  const forms = new Set(Array.from({ length: 30 }, () => planSong('techno', { forms: DEFAULT_FORMS, bands: DEFAULT_BANDS, rand }).form.name));
  assert.ok(forms.size >= 2, 'songs of one genre get different forms');
  // your picks and the description win
  const mine = planSong('a jazz waltz in D dorian', { forms: DEFAULT_FORMS, bands: DEFAULT_BANDS, form: 'short', band: 'chip band', rand });
  assert.equal(mine.form.name, 'short');
  assert.equal(mine.band.name, 'chip band');
  assert.equal(mine.meter, '3/4');
  assert.equal(mine.key, 'D dorian');
  assert.match(planForRequest(mine), /meter: 3\/4 \(as the description says\)[\s\S]*key: D dorian \(scale "D:dorian"\)/);
  // nothing fits: the AI picks
  const none = planSong('field recordings of whales', { forms: DEFAULT_FORMS, bands: DEFAULT_BANDS, rand });
  assert.equal(none.band, null);
  assert.ok(genreScore('a drum & bass roller', 'drum & bass, jungle') >= 3);
  assert.equal(describedKey('lo-fi in F# minor'), 'F# minor');
  assert.equal(describedMeter('a 12/8 shuffle'), '12/8');
});

test('every built-in form and band has meters and keys that are real', () => {
  for (const x of [...DEFAULT_FORMS, ...DEFAULT_BANDS]) {
    for (const m of (x.meters || '').split(', ').filter(Boolean)) assert.equal(normMeter(m), m, `${x.name}: meter ${m}`);
    for (const k of (x.keys || '').split(', ').filter(Boolean)) assert.match(k, /^[A-G][#b]? (major|minor|dorian|phrygian|lydian|mixolydian)$/, `${x.name}: key ${k}`);
  }
});

test('genres: every genre has at least two forms and two bands; descriptions find their genre', () => {
  for (const g of Object.keys(GENRES)) {
    assert.ok(DEFAULT_FORMS.filter((x) => genresOf(x).includes(g)).length >= 2, `${g}: forms`);
    assert.ok(DEFAULT_BANDS.filter((x) => genresOf(x).includes(g)).length >= 2, `${g}: bands`);
  }
  assert.equal(detectGenre('uplifting trance: rolling offbeat bass, supersaw leads, euphoric minor keys'), 'trance');
  assert.equal(detectGenre('liquid drum & bass: fast breakbeats, deep reese bass'), 'dnb');
  assert.equal(detectGenre('Japanese jazz fusion and city pop instrumentals'), 'fusion');
  assert.equal(detectGenre('late-night lo-fi hip hop with jazzy Rhodes chords'), 'lofi');
  assert.equal(detectGenre('cosmic nu-disco with funky guitars'), 'funk');
  for (let k = 0; k < 20; k++) {
    const p = planSong('uplifting trance: rolling offbeat bass, supersaw leads', { forms: DEFAULT_FORMS, bands: DEFAULT_BANDS });
    assert.equal(p.genre, 'trance');
    assert.ok(genresOf(p.band).includes('trance') && genresOf(p.form).includes('trance'), `${p.form.name} / ${p.band.name}`);
  }
});

test('tunes: the hook and the main melody each get a part that plays them', () => {
  const sec = (name, type, play) => ({ name, type, bars: 8, chords: 'a', play: play.map((part) => ({ part, variant: 'main' })) });
  // named parts
  let parts = [{ id: 'drums', role: 'drums' }, { id: 'hook', role: 'melody', desc: '' }, { id: 'theme', role: 'melody', desc: '' }];
  assignTunes(parts, [sec('verse', 'verse', ['drums', 'theme']), sec('chorus', 'chorus', ['drums', 'hook'])], { melody: '0 2 4' });
  assert.deepEqual(parts.map((p) => p.tune || ''), ['', 'hook', 'melody']);
  // unnamed: the melody parts heard most in the choruses / verses
  parts = [{ id: 'sax', role: 'melody', desc: '' }, { id: 'flute', role: 'melody', desc: '' }];
  assignTunes(parts, [sec('verse', 'verse', ['flute']), sec('chorus', 'chorus', ['sax'])], { melody: '0 2 4' });
  assert.deepEqual(parts.map((p) => p.tune), ['hook', 'melody']);
  // nobody to carry the melody: a theme part joins the verses, on the band's melody instrument
  parts = [{ id: 'drums', role: 'drums' }, { id: 'hook', role: 'melody', desc: '', sound: 'square' }];
  const secs = [sec('verse', 'verse', ['drums']), sec('chorus', 'chorus', ['drums', 'hook'])];
  assignTunes(parts, secs, { melody: '0 2 4', band: { instruments: 'melody: gm_flute — the tune' } });
  const theme = parts.find((p) => p.tune === 'melody');
  assert.equal(theme.id, 'theme');
  assert.equal(theme.sound, 'gm_flute');
  assert.ok(secs[0].play.some((x) => x.part === 'theme') && !secs[1].play.some((x) => x.part === 'theme'), 'the theme plays in the verses');
});

test('acoustic: the genre, its bands and forms, recorded sounds, and a human feel', () => {
  assert.equal(detectGenre('a gentle acoustic folk song with fingerstyle guitar'), 'acoustic');
  assert.equal(detectGenre('an irish jig for a celtic session'), 'acoustic');
  // a genre's first word names it (a station's genre is passed on to its songs that way)
  for (const [id, g] of Object.entries(GENRES)) assert.equal(detectGenre(`a song (${g.words[0]})`), id, id);
  for (let k = 0; k < 20; k++) {
    const p = planSong('an unplugged acoustic song, campfire singalong', { forms: DEFAULT_FORMS, bands: DEFAULT_BANDS });
    assert.equal(p.genre, 'acoustic');
    assert.ok(genresOf(p.band).includes('acoustic') && genresOf(p.form).includes('acoustic'), `${p.form.name} / ${p.band.name}`);
  }
  assert.ok(MASTER_STYLES.acoustic && normStyle('acoustic') === 'acoustic');
  // the acoustic bands are played by recorded (🎙) instruments where there are some
  for (const b of DEFAULT_BANDS.filter((x) => x.master === 'acoustic')) {
    const rec = parseInstruments(b.instruments).filter((i) => /🎙/.test(SOUND_GUIDE[i.sound] || ''));
    assert.ok(rec.length >= 2, `${b.name}: recorded instruments`);
  }
  assert.ok(ACOUSTIC_PERC.every((k) => !/^gm_/.test(k)));
  assert.deepEqual(soundGuide(new Set(['cajon', 'piano'])).map((l) => l.split(':')[0]), ['piano', 'cajon']);
  // feel: the sheet's, else the band's, else the master style's (electronic styles stay tight)
  const raw = (extra) => ({ bpm: 90, key: 'G major', chords: { verse: 'G C D G' }, parts: [{ name: 'drums', role: 'drums', sound: 'cajon' }, { name: 'gtr', role: 'chords', sound: 'gm_acoustic_guitar_steel' }], sections: [{ name: 'verse', bars: 8, chords: 'verse', play: ['drums', 'gtr'] }, { name: 'chorus', bars: 4, chords: 'verse', play: ['drums', 'gtr'] }], ...extra });
  assert.equal(normalizeSheet(raw({ master: 'acoustic' })).feel, STYLE_FEEL.acoustic);
  assert.equal(normalizeSheet(raw({ master: 'techno' })).feel, 0);
  assert.equal(normalizeSheet(raw({ master: 'acoustic', feel: 0 })).feel, 0, 'an edit to 0 stays 0');
  assert.equal(normalizeSheet(raw({ master: 'techno', feel: 0.456 })).feel, 0.46);
  assert.equal(normFeel(7), 1);
  assert.equal(normFeel(''), null);
  // the feel in the code: softer/louder notes and a little late, drums steadier than the rest, each part its own stream
  assert.equal(feelCode(0, 'drums'), '');
  const d = feelCode(0.8, 'drums', 0), c = feelCode(0.8, 'chords', 1);
  assert.match(c, /^\.mul\(velocity\(rand\.late\([\d.]+\)\.range\(0\.76, 1\)\)\)\.nudge\(rand\.late\([\d.]+\)\.range\(0, 0\.018\)\)$/);
  assert.match(d, /range\(0, 0\.007\)/);
  assert.notEqual(d.match(/late\(([\d.]+)\)/)[1], c.match(/late\(([\d.]+)\)/)[1]);
  const sh = normalizeSheet(raw({ master: 'acoustic' }));
  const code = sectionCode({ title: 'T', sheet: sh, library: 'setcpm(90/4)\nconst drums_main = s("cajon")\nconst gtr_main = (prog) => chord(prog).voicing().s("gm_acoustic_guitar_steel")' }, sh.sections[0]);
  assert.match(code, /^drums: drums_main\.mul\(velocity\(.*\)\)\.nudge\(.*\)\.postgain/m);
  assert.match(code, /^gtr: gtr_main\(sectionChords\)\.mul\(velocity/m);
});

test('after an edit, the song goes on from the section playing — found by its place, not just its name', () => {
  const secs = (names) => names.split(' ').map((name) => ({ name }));
  // A, B, A: playing the second A (index 2) — the edit added two verses before the outro
  assert.equal(sectionAfterEdit(secs('intro A B A v3 v4 outro'), 'A', 3, 1), 3, 'not the first A');
  assert.equal(sectionAfterEdit(secs('intro A B A v3 v4 outro'), 'A', 3), 3, 'by its place, without the repeat count');
  assert.equal(sectionAfterEdit(secs('intro A B A outro'), 'A', 1, 0), 1);
  // a section added before it: still the 2nd A (by place alone it would be a tie)
  assert.equal(sectionAfterEdit(secs('intro new A B A outro'), 'A', 3, 1), 4);
  // one A taken out: the nearest A
  assert.equal(sectionAfterEdit(secs('intro B A outro'), 'A', 3, 1), 2);
  // renamed or deleted: the same place; no sections: -1
  assert.equal(sectionAfterEdit(secs('intro A B outro'), 'gone', 2), 2);
  assert.equal(sectionAfterEdit(secs('intro A'), 'gone', 5), 1);
  assert.equal(sectionAfterEdit([], 'A', 1), -1);
  assert.equal(sectionAfterEdit(secs('A B A'), 'A'), 0, 'no place known: the first');
  // every step knows its section's place (fills and the gap after a hard ending too)
  const song = { title: 'T', sheet: normalizeSheet(structuredClone(RAW), 'auto', ctx), library: LIB };
  song.sheet.ending = 'cut';
  const steps = arrangeSong(song);
  for (const st of steps) {
    assert.equal(st.secIndex, st.gap ? song.sheet.sections.length - 1 : song.sheet.sections.indexOf(st.section), st.prompt);
    assert.equal(st.secNth, song.sheet.sections.slice(0, st.secIndex).filter((x) => x.name === st.section.name).length, st.prompt);
  }
});
