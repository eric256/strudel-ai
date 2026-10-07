// 🧩 Example plugin: MIDI export. A song's ⬇ Export menu gets "MIDI file": every note the song plays, a track per part
// (its General MIDI instrument, drums on channel 10), with the song's tempo and meter — to take into a DAW, a notation
// program or a hardware synth. The notes are read from the song's own patterns (the whole-song program), so they're
// exactly what the app plays: chords, fills, key lifts, voices, the feel's dynamics.
// (How plugins work: PLUGINS.md — this one uses api.addExporter.)

const vlq = (n) => { const out = [n & 0x7f]; while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80); return out; };
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const text = (s) => [...new TextEncoder().encode(String(s).slice(0, 120))];
const chunk = (id, bytes) => [...text(id), ...u32(bytes.length), ...bytes];

/**
 * A Standard MIDI File (format 1): { title, quarterBpm, meter: '6/8', ppq, tracks: [{ name, channel (0–15), program
 * (1–128 | null), notes: [{ tick, dur, midi, vel (1–127) }] }] } → bytes.
 */
export function writeMidi({ title = 'song', quarterBpm = 120, meter = '4/4', ppq = 480, tracks = [] }) {
  const [num, den] = meter.split('/').map(Number);
  const tempo = Math.round(60e6 / quarterBpm);
  const head = [0, 0xff, 0x03, ...vlq(text(title).length), ...text(title),
    0, 0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255,
    0, 0xff, 0x58, 0x04, num, Math.round(Math.log2(den)), 24, 8,
    0, 0xff, 0x2f, 0x00];
  const body = tracks.map((t) => {
    const ev = [];
    for (const n of t.notes) {
      ev.push({ tick: n.tick, on: true, midi: n.midi, vel: n.vel });
      ev.push({ tick: n.tick + Math.max(1, n.dur), on: false, midi: n.midi });
    }
    // offs before ons at the same tick (a repeated note sounds again)
    ev.sort((a, b) => a.tick - b.tick || (a.on === b.on ? 0 : a.on ? 1 : -1));
    const bytes = [0, 0xff, 0x03, ...vlq(text(t.name).length), ...text(t.name)];
    if (t.program) bytes.push(0, 0xc0 | t.channel, (t.program - 1) & 0x7f);
    let at = 0;
    for (const e of ev) {
      bytes.push(...vlq(e.tick - at), (e.on ? 0x90 : 0x80) | t.channel, e.midi & 0x7f, e.on ? Math.max(1, Math.min(127, e.vel)) : 0);
      at = e.tick;
    }
    bytes.push(0, 0xff, 0x2f, 0x00);
    return chunk('MTrk', bytes);
  });
  return new Uint8Array([...chunk('MThd', [0, 1, 0, tracks.length + 1, (ppq >> 8) & 255, ppq & 255]), ...chunk('MTrk', head), ...body.flat()]);
}

/** The song's notes (tools.songNotes) → writeMidi's tracks: drums on channel 10, the rest on their own channels. */
export function midiTracks(info, tools, ppq = 480) {
  let ch = 0;
  const nextChannel = () => { const c = ch === 9 ? ++ch : ch; ch = (ch + 1) % 16; return c % 16; };
  return info.parts.filter((p) => p.notes.length).map((p) => {
    const drums = p.notes.every((n) => n.drum);
    const channel = drums ? 9 : nextChannel();
    const tick = (bars) => Math.round(bars * info.quartersPerBar * ppq);
    return {
      name: p.id, channel, program: drums ? null : tools.gmProgram(p.sound) || 1,
      notes: p.notes.map((n) => ({ tick: tick(n.begin), dur: Math.max(1, tick(n.end) - tick(n.begin)), midi: n.drum ? tools.drumNote(n.drum) : n.midi, vel: Math.round(n.velocity * 100) }))
        .filter((n) => n.midi != null && n.midi >= 0 && n.midi <= 127),
    };
  });
}

export default {
  id: 'midi-export',
  name: 'MIDI export',
  version: '1.0.0',
  description: 'Export a song as a MIDI file: ⬇ Export → MIDI file (a track per part, drums on channel 10, its tempo and meter).',
  setup(api) {
    api.addExporter({
      id: 'midi', label: 'MIDI file', icon: '🎹', ext: 'mid', mime: 'audio/midi',
      title: 'Every note of the song, a track per part (General MIDI instruments, drums on channel 10)',
      async export(song, tools) {
        const info = tools.songNotes(song);
        const tracks = midiTracks(info, tools);
        if (!tracks.length) throw new Error('the song has no notes to write');
        return { bytes: writeMidi({ title: song.title, quarterBpm: info.quarterBpm, meter: info.meter, tracks }) };
      },
    });
  },
};
