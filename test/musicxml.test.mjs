// MusicXML import (the example plugin) and the pieces it rests on: the zip reader (.mxl) and the importer registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import plugin, { parseXML, playOrder, guessChord, musicXmlToSong } from '../public/plugins/musicxml-import.js';
import { IMPORT_TOOLS, addImporter, importerFor, acceptList, runImporter, gmSound } from '../public/features/importers.js';
import { unzip, zipText } from '../public/lib/zip.js';
import { normalizeSheet } from '../public/lib/sheet.js';
import { arrangeSong } from '../public/lib/arrange.js';

const XML = fs.readFileSync(new URL('./fixtures/little-tune.musicxml', import.meta.url), 'utf8');

test('the XML reader: elements, attributes, text, entities; comments, doctype and declarations skipped', () => {
  const r = parseXML('<?xml version="1.0"?><!DOCTYPE x><!-- hi --><a k="1 &amp; 2"><b>Tom &amp; Jerry</b><c/><b x=\'y\'>2</b></a>');
  assert.equal(r.name, 'a');
  assert.equal(r.attrs.k, '1 & 2');
  assert.deepEqual(r.children.map((c) => c.name), ['b', 'c', 'b']);
  assert.equal(r.children[0].text, 'Tom & Jerry');
  assert.equal(r.children[2].attrs.x, 'y');
});

test('repeats are played out: a repeat with 1st and 2nd endings, a repeat played 3 times', () => {
  const m = (o = {}) => ({ ...o });
  assert.deepEqual(playOrder([m(), m({ repeatForward: true }), m({ ending: [1], repeatBackward: 2 }), m({ ending: [2] })]), [0, 1, 2, 1, 3]);
  assert.deepEqual(playOrder([m(), m({ repeatBackward: 3 }), m()]), [0, 1, 0, 1, 0, 1, 2]);
  assert.deepEqual(playOrder([m(), m()]), [0, 1]);
});

test('a chord from a bar\'s notes', () => {
  const w = (pcs) => { const a = new Array(12).fill(0); for (const p of pcs) a[p] += 1; return a; };
  assert.equal(guessChord(w([0, 4, 7])), 'C');
  assert.equal(guessChord(w([9, 0, 4])), 'Am');
  assert.equal(guessChord(w([2, 5, 9, 2])), 'Dm');
  assert.equal(guessChord(new Array(12).fill(0)), null);
});

test('a score becomes a song: tempo, meter, key, parts per staff, voices, drums, chord symbols, repeats, sections', () => {
  const j = musicXmlToSong(XML, IMPORT_TOOLS, { fileName: 'little-tune.musicxml' });
  const sh = j.sheet;
  assert.equal(j.title, 'Little Tune');
  assert.match(j.desc, /A\. Tester/);
  assert.equal(sh.bpm, 96);
  assert.equal(sh.meter, '4/4');
  assert.equal(sh.scale, 'F:major');
  assert.deepEqual(sh.parts.map((p) => [p.name, p.role, p.sound]), [['piano_rh', 'melody', 'gm_piano'], ['piano_lh', 'bass', 'gm_piano'], ['drum_set', 'drums', 'bd'], ['chords', 'chords', 'gm_epiano1']]);
  // 1 · |: 2 · [1. 3 :| · [2. 4  →  1 2 3 2 4; the repeated bar is the same section (same name, same parts)
  assert.deepEqual(sh.sections.map((s) => s.name), ['A', 'B', 'C', 'B', 'D']);
  assert.deepEqual(sh.sections[1].play, sh.sections[3].play);
  assert.deepEqual(Object.values(sh.chords), ['<F>', '<Bb>', '<C7>']);
  assert.equal(sh.chords[sh.sections[2].chords], '<C7>');
  const lib = j.library;
  assert.match(lib, /^setcpm\(96\/4\)/);
  assert.match(lib, /const piano_rh_main = note\("f4 a4 c5@2"\)\.s\("gm_piano"\)/, 'notes on the beat, a half note held');
  assert.match(lib, /const piano_rh_v2 = note\("bb4 d5 ~ ~"\)/, 'flats in a flat key, rests');
  assert.match(lib, /const piano_lh_main = note\("\[f2,c3\]"\)/, 'a chord');
  assert.match(lib, /const drum_set_main = stack\(s\("bd sd"\), s\("hh hh hh hh"\)\)/, 'percussion: GM drums, two voices stacked');
  assert.match(lib, /const chords_main = \(prog\) => chord\(prog\)\.voicing\(\)/);
});

test('the song plays in the app: its sheet checks out and every section arranges', () => {
  const j = musicXmlToSong(XML, IMPORT_TOOLS);
  const sheet = normalizeSheet(j.sheet, 'auto', { enforceForm: false });
  assert.equal(sheet.sections.length, 5);
  const steps = arrangeSong({ title: j.title, sheet, library: j.library });
  assert.ok(steps.length >= 5);
  assert.ok(steps.every((s) => /piano_rh: piano_rh_(main|v\d)/.test(s.code) && /chords: chords_main\(sectionChords\)/.test(s.code)));
});

test('scores it can\'t read say why', () => {
  assert.throws(() => musicXmlToSong('<score-timewise/>', IMPORT_TOOLS), /timewise/);
  assert.throws(() => musicXmlToSong('<html></html>', IMPORT_TOOLS), /not a MusicXML score/);
  assert.throws(() => musicXmlToSong('<score-partwise><part-list/></score-partwise>', IMPORT_TOOLS), /no parts/);
});

/** A zip with these files (deflated), as an .mxl is. */
function makeZip(files) {
  const locals = [], centrals = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), comp = zlib.deflateRawSync(data), nm = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, comp); centrals.push(ch, nm);
    off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

test('the zip reader: deflated files, by name', async () => {
  const files = await unzip(makeZip({ 'a.txt': 'hello', 'dir/b.xml': '<x/>' }));
  assert.equal(zipText(files, 'a.txt'), 'hello');
  assert.equal(zipText(files, 'dir/b.xml'), '<x/>');
  await assert.rejects(unzip(new Uint8Array([1, 2, 3])), /not a zip/);
});

test('the importer registry, and the plugin reading .musicxml and .mxl files', async () => {
  const added = [];
  const api = { addImporter: (def) => added.push(addImporter(def)) };
  plugin.setup(api);
  try {
    assert.match(acceptList(), /\.musicxml.*\.mxl.*\.xml/);
    assert.equal(importerFor({ name: 'song.json' }), null, 'the app\'s own JSON stays the app\'s');
    const imp = importerFor({ name: 'Little Tune.MXL' });
    assert.equal(imp?.id, 'musicxml');
    const file = (name, bytes) => ({ name, text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    const [plain] = await runImporter(imp, file('little-tune.musicxml', new TextEncoder().encode(XML)));
    assert.equal(plain.title, 'Little Tune');
    const mxl = makeZip({ 'META-INF/container.xml': '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>', 'score.xml': XML });
    const [zipped] = await runImporter(imp, file('little-tune.mxl', mxl));
    assert.equal(zipped.library, plain.library);
  } finally { for (const off of added) off(); }
  assert.equal(importerFor({ name: 'x.musicxml' }), null, 'gone when the plugin is off');
  assert.equal(gmSound(1), 'gm_piano');
  assert.equal(gmSound(41), 'gm_violin');
  assert.equal(gmSound(3), 'gm_piano');
  assert.equal(gmSound(57), 'gm_trumpet');
  assert.equal(gmSound(128), 'gm_gunshot');
  assert.equal(gmSound(129), null);
});
