// Exports: the whole song as one program (lib/song-program.js), and the example exporters' pure parts — the MIDI
// file writer and the lead sheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { musicXmlToSong } from '../public/plugins/musicxml-import.js';
import { IMPORT_TOOLS } from '../public/features/importers.js';
import { normalizeSheet, miniStrings } from '../public/lib/sheet.js';
import { songProgram, songProgramCode, songProgramJS } from '../public/lib/song-program.js';
import { sectionCode } from '../public/lib/arrange.js';
import { writeMidi, midiTracks } from '../public/plugins/midi-export.js';
import { leadSheet, progressionBars } from '../public/plugins/lead-sheet-export.js';
import { normMeter, transposeProgression } from '../public/lib/music.js';

const fromScore = () => {
  const j = musicXmlToSong(fs.readFileSync(new URL('./fixtures/little-tune.musicxml', import.meta.url), 'utf8'), IMPORT_TOOLS);
  return { title: j.title, desc: j.desc, sheet: normalizeSheet(j.sheet, 'auto', { enforceForm: false }), library: j.library };
};
/** A written song: verse → chorus (lifted, louder) with a fill into it, a part coming in, a hard ending. */
const written = () => ({
  title: 'Test Song', desc: 'a test',
  library: 'setcpm(100/4)\nconst drums_main = s("bd sd")\nconst drums_fill = s("sd*8")\nconst bass_main = (prog) => chord(prog).rootNotes(2).s("sawtooth")\nconst hook_main = n("0 2 4 2").scale("A:minor").s("square")',
  sheet: normalizeSheet({
    bpm: 100, key: 'A minor', scale: 'A:minor', chords: { verse: 'Am F C G', chorus: 'F G Am Am' }, hook: '0 2 4 2', ending: 'cut',
    parts: [{ name: 'drums', role: 'drums', sound: 'RolandTR909', variants: ['main', 'fill'] }, { name: 'bass', role: 'bass', sound: 'sawtooth' }, { name: 'hook', role: 'melody', sound: 'square' }],
    sections: [{ name: 'verse', bars: 8, chords: 'verse', play: ['drums', 'bass', 'hook@in'] }, { name: 'chorus', bars: 4, chords: 'chorus', play: ['drums', 'bass', 'hook'], shift: 2, level: 1.1 }],
  }, 'auto', { enforceForm: false }),
});

test('the whole song as one program: an arrange per part, in the app\'s order — fills, key lifts, parts coming in, levels, the ending', () => {
  const prog = songProgram(written());
  assert.equal(prog.bars, 13, '8 + 4 + a bar of silence after a hard ending');
  assert.deepEqual(prog.sections.map((s) => [s.name, s.start, s.bars]), [['verse', 0, 8], ['chorus', 8, 4]]);
  const drums = prog.parts.find((p) => p.id === 'drums').segments;
  assert.deepEqual(drums.map(([b, e]) => [b, e.split('.')[0]]), [[7, 'drums_main'], [1, 'drums_fill'], [4, 'drums_main'], [1, 'silence']]);
  const bass = prog.parts.find((p) => p.id === 'bass').segments;
  assert.match(bass[0][1], /^bass_main\(chords_verse\)$/);
  assert.match(bass[2][1], /^bass_main\(chords_chorus_up2\)\.postgain\(1\.1\)$/, 'the lifted chorus: moved chords, louder');
  const hook = prog.parts.find((p) => p.id === 'hook').segments;
  assert.match(hook[0][1], /^hook_main\.mask\("<0 0 0 0 1 1 1 1>"\)$/, 'comes in halfway');
  assert.match(hook[2][1], /^hook_main\.transpose\(2\)/, 'the tune moves with the key');
  assert.deepEqual(prog.chords, [{ name: 'chords_verse', prog: '<Am F C G>' }, { name: 'chords_chorus_up2', prog: transposeProgression('<F G Am Am>', 2) }]);
  // the same part code as the app plays in each section
  const app = sectionCode(written(), written().sheet.sections[1]);
  assert.ok(app.includes(`bass: ${bass[2][1].replace('chords_chorus_up2', 'sectionChords').replace('.postgain(1.1)', '')}.postgain(slider(1`));
});

test('the program as REPL code, and as JavaScript that returns the parts', () => {
  const prog = songProgram(written());
  const code = songProgramCode(prog);
  assert.match(code, /^\/\/ "Test Song" — a test/);
  assert.match(code, /Not carried over:\n\/\/ {3}· the master/);
  assert.match(code, /^setcpm\(100\/4\)$/m);
  assert.match(code, /^const chords_verse = "<Am F C G>"$/m);
  assert.match(code, /^drums: arrange\(\n {2}\[7, drums_main\],\n {2}\[1, drums_fill\],/m);
  assert.ok(!/setcpm\(100\/4\)\nconst drums_main[\s\S]*setcpm/.test(code), 'one tempo line');
  const js = songProgramJS(prog, miniStrings);
  assert.match(js, /return \{\n {2}drums: arrange\(\[7, drums_main\]/);
  assert.match(js, /const chords_verse = mini\("<Am F C G>"\)/);
  assert.doesNotThrow(() => new Function('__slider', js), 'it parses');
});

test('an imported score exports too (no fills, sections in score order)', () => {
  const prog = songProgram(fromScore());
  assert.equal(prog.bars, 5);
  assert.deepEqual(prog.parts.map((p) => p.id), ['piano_rh', 'piano_lh', 'drum_set', 'chords']);
  assert.deepEqual(prog.parts.find((p) => p.id === 'drum_set').segments.map(([b, e]) => [b, e]), [[1, 'drum_set_main'], [4, 'silence']]);
  assert.throws(() => songProgram({ title: 'x', blocks: [] }), /written from a sheet/);
});

test('the MIDI file: header, tempo and meter, a track per part, note on / off in time order', () => {
  const bytes = writeMidi({ title: 'T', quarterBpm: 120, meter: '6/8', ppq: 480, tracks: [
    { name: 'lead', channel: 0, program: 81, notes: [{ tick: 0, dur: 480, midi: 60, vel: 100 }, { tick: 480, dur: 480, midi: 60, vel: 90 }] },
    { name: 'drums', channel: 9, program: null, notes: [{ tick: 0, dur: 120, midi: 36, vel: 127 }] },
  ] });
  const b = Buffer.from(bytes);
  assert.equal(b.toString('latin1', 0, 4), 'MThd');
  assert.deepEqual([b.readUInt32BE(4), b.readUInt16BE(8), b.readUInt16BE(10), b.readUInt16BE(12)], [6, 1, 3, 480]);
  const tracks = [];
  for (let i = 14; i < b.length;) { assert.equal(b.toString('latin1', i, i + 4), 'MTrk'); const len = b.readUInt32BE(i + 4); tracks.push(b.subarray(i + 8, i + 8 + len)); i += 8 + len; }
  assert.equal(tracks.length, 3);
  const t0 = tracks[0];
  const tempoAt = t0.indexOf(Buffer.from([0xff, 0x51, 0x03]));
  assert.equal(t0.readUIntBE(tempoAt + 3, 3), 500000, '120 bpm');
  const tsAt = t0.indexOf(Buffer.from([0xff, 0x58, 0x04]));
  assert.deepEqual([...t0.subarray(tsAt + 3, tsAt + 5)], [6, 3], '6/8');
  const lead = [...tracks[1]];
  assert.ok(Buffer.from(lead).includes(Buffer.from([0x00, 0xc0, 80])), 'program 81 (0-based 80) on channel 1');
  // the repeated note: off at 480 comes before the next on at 480
  const onOff = Buffer.from(lead).toString('hex');
  assert.ok(onOff.startsWith('00ff0304') && onOff.includes('00903c64'), 'the first note on at tick 0, velocity 100');
  assert.ok(onOff.indexOf('803c00') < onOff.lastIndexOf('903c5a'), 'note off before the next note on');
  assert.ok(lead.slice(-3).join() === [0xff, 0x2f, 0x00].join(), 'end of track');
  assert.ok(Buffer.from([...tracks[2]]).includes(Buffer.from([0x99, 36, 127])), 'drums on channel 10');
});

test('the song\'s notes → MIDI tracks: drums on channel 10, instruments by General MIDI program, ticks from bars', () => {
  const tools = { gmProgram: (s) => ({ gm_piano: 1, gm_violin: 41 })[s] ?? null, drumNote: (s) => ({ bd: 36, hh: 42 })[s] ?? null };
  const tracks = midiTracks({ quartersPerBar: 3, parts: [
    { id: 'drums', sound: 'bd', notes: [{ begin: 0, end: 0.25, drum: 'bd', velocity: 1 }, { begin: 0.5, end: 0.75, drum: 'hh', velocity: 0.5 }] },
    { id: 'fiddle', sound: 'gm_violin', notes: [{ begin: 1, end: 2, midi: 67, velocity: 0.8 }] },
    { id: 'empty', sound: 'gm_piano', notes: [] },
  ] }, tools, 480);
  assert.deepEqual(tracks.map((t) => [t.name, t.channel, t.program]), [['drums', 9, null], ['fiddle', 0, 41]]);
  assert.deepEqual(tracks[0].notes.map((n) => [n.tick, n.midi, n.vel]), [[0, 36, 100], [720, 42, 50]]);
  assert.deepEqual(tracks[1].notes[0], { tick: 1440, dur: 1440, midi: 67, vel: 80 }, 'a bar of 3/4 is 3 quarters');
});

test('the lead sheet: facts, form, a chord chart per section (bars cycling the progression), tunes, parts', () => {
  assert.deepEqual(progressionBars('<Am F [C G] G>'), ['Am', 'F', 'C G', 'G']);
  const song = written();
  const md = leadSheet(song, { normMeter, transposeProgression });
  assert.match(md, /^# Test Song\n\n\*a test\*/);
  assert.match(md, /\*\*Key\*\* A minor · \*\*Tempo\*\* 100 bpm · \*\*Meter\*\* 4\/4/);
  assert.match(md, /\| 1 \| \*\*verse\*\* \| 8 \| verse \| drums, bass, hook \(comes in\) \|/);
  assert.match(md, /\| 2 \| \*\*chorus\*\* \(key \+2, level 1\.1\) \| 4 \| chorus \|/);
  assert.match(md, /\*\*verse\*\* — 8 bars\n\n`\| Am {5}\| F {6}\| C {6}\| G {6}\|`\n`\| Am/);
  assert.match(md, /\*\*chorus\*\* — 4 bars \(key \+2\)\n\n`\| G /, 'the lifted chorus is charted in its new key');
  assert.match(md, /- \*\*Hook:\*\* `0 2 4 2`/);
  assert.match(md, /- \*\*drums\*\* — drums, RolandTR909 · variants: main, fill/);
});
