// Feature module split out of app.js (see the section comments below).
import { definesId, fillPart, libraryIds, miniStrings, partExpr } from '../lib/sheet.js';
import { prepareCode, soundCatalog, soundRegistry } from './sound-check.js';
import { soundGuide } from '../sounds.js';
import { formChoice, formsForRequest } from './forms.js';
import { bandChoice, bandsForRequest, normalizeSheet } from './bands.js';
import { HARMONIC_ROLE, meterSteps, normMeter, tempoLine } from '../lib/music.js';
import { stylesForPrompt } from '../master.js';
import { extractCode, requestLLM, syntaxError } from './llm.js';
import { closest, parseJSONLoose, sleep, stripThinking } from '../lib/util.js';
import { scaleHelp } from '../lib/scales.js';
import { patternLines } from '../lib/labels.js';
import { wrapCode } from '../format.js';
import { arrangeSong, sectionCode } from '../lib/arrange.js';
import { songPads } from './song-pads.js';
import { songSel, songsChanged, updateSetButtons, setNowSong } from './song-lists.js';
import { mp3SongStep, mp3TakeEnd } from './mp3.js';
import { loadPads, padsState } from './pads.js';
import { currentStation } from './stations.js';
import { $, addMsg, appendSteps, clog, dropUpcomingSteps, dryRun, engine, jumpTo, logPlayed, parseSongs, player, queue, startSetlist, stopSetlist, warnUser } from '../app.js';
// ---------------------------------------------------------------------------
// ✍ Song writer: for every song of the set / station the AI writes a song sheet, then its part library; the app
// arranges the sections and feeds them to the engine ahead of time (the feed loop). A song that can't be written is
// marked failed (↻ Try again).
// ---------------------------------------------------------------------------
/**
 * Play the library silently (no editor, no scheduler): build every part with every
 * progression and query a few bars. Returns an Error or null.
 */
export function testLibrary(lib, sheet) {
  const ids = libraryIds(sheet);
  const body = miniStrings(lib.replace(/^\s*setcp[ms]\([^)]*\)\s*;?\s*$/gm, '')).replace(/\bslider\(/g, '__slider(') +
    `\nreturn (sectionChords) => stack(${ids.map((id) => partExpr(lib, id)).join(', ')});`;
  let make;
  try { make = new Function('__slider', '"use strict";\n' + body)((v) => v); }
  catch (e) { return e; }
  for (const prog of Object.values(sheet.chords)) {
    let pat;
    try { pat = make(globalThis.mini ? globalThis.mini(prog) : prog); } catch (e) { return e; }
    if (!pat || typeof pat.queryArc !== 'function') return new Error('the parts are not Strudel patterns');
    const err = dryRun(pat);
    if (err) return err;
  }
  return null;
}

/** The sounds for a song sheet: the full list plus the sound guide (what each sound is good for). */
async function sheetSounds() {
  const catalog = await soundCatalog().catch(() => '');
  const reg = await soundRegistry().catch(() => null);
  if (!reg) return catalog;
  const avail = new Set(Object.keys(reg));
  for (const k of Object.keys(reg)) { const i = k.lastIndexOf('_'); if (i > 0 && reg[k].data?.type === 'sample') avail.add(k.slice(0, i)); }
  const guide = soundGuide(avail);
  return guide.length ? `${catalog}\n\nSOUND GUIDE — what the most useful sounds are good for (role · character · genres); pick sounds that fit the genre and each other:\n${guide.join('\n')}` : catalog;
}
async function writeSongSheet(song, signal) {
  const choice = formChoice(), bandPick = bandChoice();
  const prev = queue.songs[queue.songs.indexOf(song) - 1]?.sheet;
  let msg = (song.autoTitle ? `SONG (no title yet — give it one in "title"): ${song.desc}\n` : `SONG: "${song.title}" — ${song.desc}\n`) +
    (prev ? `The previous song was ${prev.bpm} bpm, ${normMeter(prev.meter)}, in ${prev.key}; this one should flow from it (a related key or a nearby tempo is nice).\n` : '') +
    `\n${formsForRequest(choice)}\n\n${bandsForRequest(bandPick)}\n\nMASTER STYLES — set "master" to the one that fits (the band's, unless the description asks for another):\n${stylesForPrompt()}\n\nWrite the song sheet JSON.`;
  const sounds = await sheetSounds();
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    song.phase = 'writing the song sheet';
    const text = await requestLLM({ mode: 'sheet', messages: [{ role: 'user', content: msg }], signal, label: `“${song.title}” sheet`, sounds });
    try {
      const raw = parseJSONLoose(text);
      const sh = normalizeSheet(raw, choice, { band: bandPick });
      // a song created from a description gets its name from the songwriter
      if (song.autoTitle && typeof raw.title === 'string' && raw.title.trim()) { song.title = raw.title.trim().slice(0, 60); song.autoTitle = false; }
      clog('ok', `✓ “${song.title}” sheet: ${sh.form || 'form ?'}${sh.band ? ` · 🎸 ${sh.band}` : ''} · 🎛 ${sh.master} · ${sh.bpm} bpm · ${sh.key} · ${sh.sections.length} sections · parts ${sh.parts.map((p) => p.id).join(', ')}`);
      return sh;
    } catch (e) {
      lastErr = e;
      clog('warn', `✗ “${song.title}” sheet unusable: ${e.message}`);
      msg = msg.replace(/\n\nYOUR PREVIOUS REPLY[\s\S]*$/, '') +
        `\n\nYOUR PREVIOUS REPLY could not be used (${e.message}). Reply with ONLY the JSON object, exactly in the example's format.`;
    }
  }
  throw new Error(`no usable song sheet (${lastErr?.message})`);
}

/** The sounds a song's parts may use: the sheet's choices, their drum machines' drums, plus the basic synths. */
async function partsCatalog(sh) {
  const reg = await soundRegistry();
  if (!reg) return '';
  const keys = Object.keys(reg);
  const want = new Set(['sawtooth', 'square', 'triangle', 'sine', 'supersaw', 'white', 'pink', 'brown']);
  const lines = [];
  for (const p of sh.parts) {
    const snd = String(p.sound || '').trim();
    const key = snd.toLowerCase();
    const drums = keys.filter((k) => k.startsWith(key + '_') && reg[k].data?.type === 'sample').map((k) => k.slice(key.length + 1));
    if (drums.length) lines.push(`Drum machine ${snd}: s("…").bank("${snd}") with drums: ${drums.join(' ')}`);
    else if (reg[key]) want.add(key);
    else {
      const { best } = closest(snd || 'x', keys);
      if (best) want.add(best);
    }
  }
  // plain drum samples for parts without a bank
  for (const k of ['bd', 'sd', 'hh', 'oh', 'cp', 'rim', 'lt', 'mt', 'ht', 'cr', 'perc']) if (reg[k]) want.add(k);
  return `Sounds for this song: ${[...want].filter((k) => reg[k]).join(' ')}\n${lines.join('\n')}`;
}

/** Write (or repair) the part library. Returns checked, corrected library code. */
async function writeSongLibrary(song, signal, { fix = null, prev = null } = {}) {
  const sh = song.sheet;
  const fp = fillPart(sh);
  const need = libraryIds(sh).map((id) => {
    const p = sh.parts.find((q) => id.startsWith(q.id + '_'));
    const variant = id.slice(p.id.length + 1);
    const kind = HARMONIC_ROLE.test(p.role) ? 'function of prog' : 'plain pattern';
    const extra = p.role === 'melody' && /hook/.test(p.id + p.desc) ? ` — plays the hook: n("${sh.hook}").scale("${sh.scale}")` : '';
    const vdesc = variant === 'main' ? ''
      : variant === 'fill' && p === fp ? ' (ONE-bar fill leading into the next section)'
      : /^alt/.test(variant) ? ` (an ALTERNATE ${p.role || 'part'}: same sound and register as ${p.id}_main, but a clearly different line — new rhythm, contour or figure — that still fits the chords and the other parts; it gives the sections that use it their own character)`
      : /harm/.test(variant) ? ` (a HARMONY of ${p.id}_main: same rhythm, a third or sixth above — e.g. the same degrees .add(2) — softer gain)`
      : ` (${variant} version of ${p.id}_main)`;
    return `- ${id}  [${kind}]  ${p.role}, sound ${p.sound || '(your choice)'}: ${p.desc}${vdesc}${extra}`;
  });
  const base =
    `SONG: "${song.title}" — ${song.desc}\n` +
    `Tempo line: ${tempoLine(sh.bpm, sh.meter)}   Key / scale: ${sh.key} → .scale("${sh.scale}")\n` +
    `Meter: ${normMeter(sh.meter)} — one cycle is ONE BAR of ${meterSteps(sh.meter)} ${/\/8$/.test(normMeter(sh.meter)) ? 'eighth notes' : 'beats'}: ` +
    `write every rhythm with ${meterSteps(sh.meter)} (or ${meterSteps(sh.meter) * 2}) steps per bar${normMeter(sh.meter) === '4/4' ? '' : ' — NOT 4 or 8'}.\n` +
    `Chord progressions the sections use: ${Object.entries(sh.chords).map(([k, v]) => `${k} ${v}`).join(' · ')}\n` +
    `Hook (scale degrees): "${sh.hook}"\n\n` +
    `Write the part library. Define EXACTLY these consts:\n${need.join('\n')}`;
  let content = fix && prev
    ? `${base}\n\nTHE CURRENT LIBRARY:\n\`\`\`javascript\n${prev}\n\`\`\`\nIt failed when played: ${fix}${/scale/i.test(fix) ? '\n' + scaleHelp() : ''}\nReturn the corrected COMPLETE library.`
    : base;
  let lastErr;
  // the parts step only needs the sounds the sheet chose (a fraction of the full list → far fewer tokens)
  const sounds = await partsCatalog(sh);
  let partial = null; // a library that only lacked some consts: the next reply adds just those
  for (let attempt = 0; attempt < 3; attempt++) {
    song.phase = fix ? 'fixing the parts' : partial ? 'writing the missing parts' : 'writing the parts';
    const text = await requestLLM({ mode: 'library', messages: [{ role: 'user', content }], signal, sounds, label: `“${song.title}” parts${fix ? ' fix' : partial ? ' (missing)' : ''}` });
    let lib = extractCode(text);
    let err = null;
    if (!lib) err = 'no ```javascript code block in the reply';
    else {
      // parts written as labels ("bass_main: …") are meant as consts
      lib = lib.replace(/^([A-Za-z_$][\w$]*):(?!:)\s*/gm, (m, n) => (libraryIds(sh).includes(n) ? `const ${n} = ` : m));
      // the missing consts were asked for: add them to what we had (a repeated one keeps the first version)
      if (partial) {
        const extra = lib.split(/\n(?=\s*const\s)/).filter((d) => { const id = d.match(/^\s*const\s+([\w$]+)/)?.[1]; return !id || !definesId(partial, id); });
        lib = `${partial}\n${extra.join('\n')}`;
      }
      // the app owns the tempo line
      lib = `${tempoLine(sh.bpm, sh.meter)}\n` + lib.replace(/^\s*setcp[ms]\([^)]*\)\s*;?\s*$/gm, '').trim();
      const missing = libraryIds(sh).filter((id) => !definesId(lib, id));
      if (missing.length) err = `these consts are missing: ${missing.join(', ')}`;
      else if (patternLines(lib).length) err = 'the library must not contain labelled lines like "drums:" or "$:" — only const definitions';
      else err = syntaxError(lib);
      if (!err) {
        const prep = await prepareCode(lib, { quiet: true, library: true });
        lib = prep.code;
        err = prep.error || testLibrary(lib, sh)?.message || null;
      }
    }
    if (!err) { clog('ok', `✓ “${song.title}” parts checked and test-played`); return wrapCode(lib); }
    lastErr = err;
    clog('warn', `✗ “${song.title}” parts: ${err}`);
    // only some consts are missing: ask for just those (much shorter than the whole library again)
    const missing = lib ? libraryIds(sh).filter((id) => !definesId(lib, id)) : [];
    if (lib && missing.length && missing.length < libraryIds(sh).length && !syntaxError(lib)) {
      partial = lib;
      content = `${base}\n\nTHE LIBRARY SO FAR (keep it as it is):\n\`\`\`javascript\n${lib}\n\`\`\`\n` +
        `It is missing these consts: ${missing.join(', ')}. Reply with ONE \`\`\`javascript block that defines ONLY the missing consts, ` +
        'in the same style, sounds and key, fitting the parts above.';
      continue;
    }
    partial = null;
    content = `${base}\n\nYOUR PREVIOUS LIBRARY:\n\`\`\`javascript\n${lib || ''}\n\`\`\`\nIt can't be used: ${err}${/scale/i.test(err) ? '\n' + scaleHelp() : ''}\nReturn the corrected COMPLETE library.`;
  }
  throw new Error(`no usable part library (${lastErr})`);
}

/** A section failed when it was about to play: fix the library and re-arrange the song's unplayed sections. */
export function repairSong(song, err) {
  song.repairing ||= (async () => {
    clog('warn', `🔧 “${song.title}”: a section failed when test-played (${err}) — fixing the parts…`);
    song.library = await writeSongLibrary(song, queue.abort?.signal, { fix: err, prev: song.library });
    for (const st of song.blocks || []) {
      if (['playing', 'done', 'armed'].includes(st.status)) continue;
      st.code = sectionCode(song, st.section, { fill: !!st.fillStep });
      st.status = 'ready';
      st.error = null;
    }
  })().finally(() => { song.repairing = null; });
  return song.repairing;
}

/** Write (or reuse) a song's blocks and append them to the engine. */
/** Sheet → library → arranged steps; null when that fails (the song is then written block by block). */
/**
 * Sheet → library → arranged sections. When that fails, the song is started over once from a fresh sheet (the sheet
 * and the parts each already had 3 tries); a second failure throws: the song is marked failed (✗, with ↻ Try again)
 * and the set / station moves on. (Songs are no longer written block by block.)
 */
async function sheetSteps(song) {
  song.status = 'writing';
  for (let round = 1; ; round++) {
    try {
      song.sheet = await writeSongSheet(song, queue.abort.signal);
      song.library = await writeSongLibrary(song, queue.abort.signal);
      song.phase = null;
      const steps = arrangeSong(song);
      song.pads = songPads(song);
      return steps;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      song.sheet = null;
      song.library = null;
      if (round >= 2) { song.phase = null; throw new Error(`“${song.title}” couldn't be written: ${e.message}`); }
      clog('warn', `“${song.title}”: ${e.message} — starting the song over from a new sheet`);
    }
  }
}

async function appendSong(k) {
  const song = queue.songs[k];
  if (!song) return;
  let steps;
  if (song.blocks?.length) {
    // already written (loop / jump back): reuse blocks and their code
    steps = song.blocks.map((b) => ({ ...b, status: b.code ? 'ready' : 'waiting', startedAt: undefined, genPromise: undefined, error: null }));
  } else {
    // song sheet → part library → sections arranged by the app
    steps = await sheetSteps(song);
  }
  steps.forEach((st, j) => Object.assign(st, { song, songPos: j, songLen: steps.length, songStart: j === 0 }));
  song.blocks = steps;
  song.firstStep = steps[0];
  song.bars = steps.reduce((a, b) => a + b.bars, 0);
  if (song.status !== 'playing') song.status = 'ready';
  song.phase = null;
  appendSteps(steps);
  return steps;
}

async function stationMoreSongs() {
  const n = 3;
  const recent = queue.songs.slice(-12).map((sg) => `${sg.title} (${sg.desc.slice(0, 60)})`);
  const text = await requestLLM({
    mode: 'songs',
    messages: [{
      role: 'user',
      content: `STATION THEME: ${queue.station.theme}\n` +
        (recent.length ? `Already played or queued — do NOT repeat these, but keep a good flow from the last one:\n- ${recent.join('\n- ')}\n` : '') +
        `Write the next ${n} songs.`,
    }],
    signal: queue.abort.signal,
  });
  const songs = parseSongs(stripThinking(text).replace(/```[a-z]*\n?|```/g, '')).slice(0, n);
  if (!songs.length) throw new Error('the model did not return songs as "title | description" lines');
  queue.songs.push(...songs);
}

async function feedLoop() {
  let failures = 0;
  while (queue.running) {
    try {
      if (queue.forceJump !== null) {
        const k = queue.forceJump;
        queue.forceJump = null;
        queue.nextSong = k + 1;
        const steps = await appendSong(k);
        if (steps?.length && queue.running) jumpTo(engine.steps.indexOf(steps[0]));
        continue;
      }
      const ahead = queue.nextSong - 1 - queue.current; // songs written but not yet playing
      if (ahead < 1 && queue.nextSong < queue.songs.length) {
        await appendSong(queue.nextSong++);
        failures = 0;
        continue;
      }
      if (ahead < 1 && queue.mode === 'set' && $('setLoop').checked && !queue.single && queue.songs.length) {
        queue.nextSong = 0;
        continue;
      }
      if (queue.mode === 'station' && queue.songs.length - (queue.current + 1) < Number($('stationAhead').value)) {
        const before = queue.songs.length;
        queue.planning = true;
        try { await stationMoreSongs(); } finally { queue.planning = false; }
        if (queue.songs.length > before) failures = 0;
        continue;
      }
    } catch (e) {
      if (e.name === 'AbortError' || !queue.running) return;
      const sg = queue.songs[queue.nextSong - 1];
      if (sg && sg.status === 'writing') { sg.status = 'failed'; sg.error = e.message; sg.phase = null; songsChanged(); }
      clog('error', `${queue.mode === 'station' ? 'Station' : 'Set list'}: ${e.message} (try ${failures + 1}/5)`);
      failures++;
      if (failures >= 5) { warnUser(`${queue.mode === 'station' ? 'Station' : 'Set list'} stopped: the AI failed 5 times in a row (last: ${e.message})`); addMsg('info', `■ ${queue.mode === 'station' ? 'station' : 'set'} stopped — see ⚠ in the status bar`); stopSet(); return; }
      await sleep(3000 * failures);
    }
    await sleep(400);
  }
}

function makeFeeder() {
  return {
    label: queue.mode === 'station' ? `station “${queue.station.name || 'untitled'}”` : 'set list',
    active: () => queue.running && (queue.mode === 'station' || queue.nextSong < queue.songs.length || queue.forceJump !== null ||
      ($('setLoop').checked && !queue.single && queue.songs.length > 0) || queue.songs.some((sg) => sg.status === 'writing')),
    onStepStart: (step) => {
      if (!step.song) return;
      mp3SongStep(step);
      setNowSong(step.song); // 🎶 Now playing keeps showing it after it ends
      if (padsState.follow && step.song.pads && padsState.owner !== step.song) loadPads(step.song.pads, step.song);
      const k = queue.songs.indexOf(step.song);
      if (k < 0 || (k === queue.current && step.song.status === 'playing')) return;
      queue.songs.forEach((sg) => { if (sg.status === 'playing' && sg !== step.song) sg.status = 'done'; });
      step.song.status = 'playing';
      step.song.playedAt = Date.now();
      logPlayed(step.song, queue.mode === 'station' ? `station “${queue.station?.name || ''}”` : 'songs');
      queue.current = k;
      addMsg('info', `🎵 now playing: “${step.song.title}” — ${step.song.desc}`);
      player.emit('song', { song: step.song });
      if (queue.mode === 'station') document.title = `📻 ${step.song.title} · ${queue.station.name || 'Station'}`;
      // keep the station's memory bounded
      if (queue.mode === 'station' && queue.current > 30) {
        const cut = queue.current - 20;
        queue.songs.splice(0, cut);
        queue.current -= cut;
        queue.nextSong -= cut;
        if (songSel.station != null) songSel.station = songSel.station >= cut ? songSel.station - cut : null;
      }
    },
    onStop: () => stopSet(false),
  };
}

export function startSet(mode, { at = 0, keepSongs = false } = {}) {
  if (keepSongs && queue.mode === mode && queue.songs.length) {
    // resume with the songs we already have (their written blocks/code are reused)
    queue.songs.forEach((sg) => { sg.status = sg.blocks ? 'ready' : 'waiting'; sg.error = null; });
  } else if (mode === 'set') {
    if (queue.mode !== 'set' || !queue.songs.length) { addMsg('info', 'No songs yet — create one in 💬 Chat with 🎯 ✨ new song.'); return; }
    queue.songs.forEach((sg) => { sg.status = sg.blocks ? 'ready' : 'waiting'; sg.error = null; });
  } else {
    const st = currentStation();
    if (!st.theme.trim()) { addMsg('error', 'Give the station a theme first.'); return; }
    queue.station = { ...st };
    queue.songs = [];
  }
  stopSet(false);
  songSel[mode] = null; // follow the song that is playing
  Object.assign(queue, { running: true, mode, nextSong: at, current: at - 1, forceJump: null, abort: new AbortController(), textDirty: false, single: false });
  startSetlist({ steps: [], feeder: makeFeeder() });
  updateSetButtons();
  addMsg('info', mode === 'station'
    ? `📻 station “${queue.station.name || 'untitled'}” on air — planning songs…`
    : `▶ set started (${queue.songs.length} songs) — writing “${queue.songs[at].title}”…`);
  feedLoop();
}

export function stopSet(stopEngine = true) {
  if (!queue.running) return;
  queue.running = false;
  queue.abort?.abort();
  queue.songs.forEach((sg) => { if (sg.status === 'writing') sg.status = 'waiting'; });
  if (stopEngine) mp3TakeEnd(false); // stopped mid-song: drop the partial recording
  if (stopEngine && engine.feeder) stopSetlist();
  updateSetButtons();
  document.title = 'Strudel AI';
}

/** ↻ Try again: a song that couldn't be written is written from scratch and plays next. */
export function retrySong(sg) {
  const k = queue.songs.indexOf(sg);
  if (k < 0) return;
  Object.assign(sg, { status: 'waiting', error: null, phase: null, sheet: null, library: null, blocks: null, firstStep: null, autoTitle: sg.autoTitle });
  songsChanged();
  jumpToSong(k, queue.mode || 'set');
}
export function jumpToSong(k, from = 'set') {
  const mode = queue.running ? queue.mode : 'set';
  if (!queue.running) return startSet(from, { at: k, keepSongs: true });
  const song = queue.songs[k];
  if (!song) return;
  const i = song.firstStep ? engine.steps.indexOf(song.firstStep) : -1;
  if (i >= 0) { song.status = 'ready'; jumpTo(i); return; }
  // not written yet (or trimmed): drop upcoming blocks of other songs and write this one next
  dropUpcomingSteps();
  queue.songs.forEach((sg, j) => { if (j !== queue.current && sg.status === 'ready' && !engine.steps.includes(sg.firstStep)) sg.status = 'waiting'; });
  queue.forceJump = k;
  addMsg('info', `⏭ writing “${song.title}” — it will start on the next bar line when ready`);
  void mode;
}
