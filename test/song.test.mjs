// The song engine's pure logic (public/lib): music theory, labels, forms, bands, sheets, arranging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normChord, normProgression, transposeProgression, normMeter, meterBeats, meterSteps, tempoLine, sectionType, enterMask } from '../public/lib/music.js';
import { parseLabel, makeLabel, patternLines } from '../public/lib/labels.js';
import { setScales, fixScaleString } from '../public/lib/scales.js';
import { DEFAULT_FORMS, parseFormSections, formBars, findIn, formsForRequest } from '../public/lib/forms.js';
import { DEFAULT_BANDS, parseInstruments, enforceBand, bandsForRequest } from '../public/lib/bands.js';
import { normalizeSheet, libraryIds, fillPart, isFnPart, miniStrings } from '../public/lib/sheet.js';
import { sectionCode, arrangeSong, carryLiveState, LIB_START, SEC_START } from '../public/lib/arrange.js';
import { parseJSONLoose, closest, esc } from '../public/lib/util.js';
import { normStyle, styleParams, diffParams } from '../public/master.js';

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
  assert.match(formsForRequest(DEFAULT_FORMS, 'lo-fi'), /use exactly this one \(set "form": "lo-fi"\)/);
  assert.match(formsForRequest(DEFAULT_FORMS, 'auto'), /pick the one that fits/);
});

test('bands: instruments parse and are enforced by role', () => {
  const inst = parseInstruments('drums: RolandTR909 — four on the floor\nbass: gm_synth_bass_1\nnot an instrument');
  assert.deepEqual(inst, [{ role: 'drums', sound: 'RolandTR909', desc: 'four on the floor' }, { role: 'bass', sound: 'gm_synth_bass_1', desc: '' }]);
  const band = { name: 'x', instruments: 'pad: gm_pad_warm\npad: gm_pad_halo\nbass: sine' };
  const parts = [{ role: 'pad', sound: 'sawtooth' }, { role: 'pad', sound: 'square' }, { role: 'bass', sound: 'SINE' }, { role: 'melody', sound: 'square' }];
  enforceBand(parts, band);
  assert.deepEqual(parts.map((p) => p.sound), ['gm_pad_warm', 'gm_pad_halo', 'SINE', 'square']);
  assert.match(bandsForRequest(DEFAULT_BANDS, 'techno rig'), /exactly this band \(set "band": "techno rig" and "master": "techno"\)/);
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
  assert.deepEqual(sh.sections.map((x) => x.bars), [4, 8, 4, 8, 4], 'the "short" form decides the bars; choruses are 4 at most');
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
  assert.match(intro, /^lead: lead_main\.mask\("<0 0 1 1>"\)/m);
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
