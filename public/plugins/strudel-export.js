// 🧩 Example plugin: Strudel REPL export. A song's ⬇ Export menu gets "Strudel REPL": the whole song as ONE Strudel
// program — the part library, then a line per part that plays its sections in order (arrange) — to paste into
// strudel.cc, or ↗ open there straight away (the code travels in the link). It plays like the app's arrangement:
// each section's chords, fills, key lifts, parts coming in and out, section levels. What the app does on top of the
// code (the master, 🔀 routing, tempo changes, crossfades) is listed at the top of the program.
// (How plugins work: PLUGINS.md — this one uses api.addExporter.)
export default {
  id: 'strudel-export',
  name: 'Strudel REPL export',
  version: '1.0.0',
  description: 'Export a song as one Strudel program: ⬇ Export → Strudel REPL (download, 📋 copy, or ↗ open it in strudel.cc).',
  setup(api) {
    api.addExporter({
      id: 'repl', label: 'Strudel REPL', icon: '🌀', ext: 'strudel.js', mime: 'text/javascript',
      title: 'The whole song as one Strudel program, to paste into strudel.cc',
      copy: true, open: true, openTitle: 'Open it in strudel.cc (the code goes in the link)',
      async export(song, tools) {
        // it must run: build the patterns and play a bar of each part silently
        const { patterns } = tools.songPatterns(song);
        for (const pat of Object.values(patterns)) pat.queryArc(0, 1);
        const code = tools.songProgramCode(tools.songProgram(song));
        return { text: code, url: tools.strudelLink(code) };
      },
    });
  },
};
