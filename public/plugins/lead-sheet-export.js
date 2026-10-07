// 🧩 Example plugin: lead sheet export. A song's ⬇ Export menu gets "Lead sheet": the song on one page, as Markdown —
// key, tempo and meter, the form (sections, bars, chords, which parts play), a chord chart per section, the melody
// and the hook, and the parts with their sounds — to play it with a band, or to read along.
// (How plugins work: PLUGINS.md — this one uses api.addExporter.)

/** A progression ("<Am F [C G] G>") → its bars ("Am", "F", "C G", "G"). */
export const progressionBars = (prog) => {
  const inner = String(prog || '').trim().replace(/^<|>$/g, '').trim();
  return (inner.match(/\[[^\]]*\]|[^\s\[\]]+/g) || []).map((t) => t.replace(/^\[|\]$/g, '').trim());
};

/** The lead sheet as Markdown. */
export function leadSheet(song, tools) {
  const sh = song.sheet;
  const lines = [`# ${song.title}`, ''];
  if (song.desc) lines.push(`*${song.desc.replace(/\s+/g, ' ').trim()}*`, '');
  const facts = [`**Key** ${sh.key}`, `**Tempo** ${sh.bpm} bpm`, `**Meter** ${tools.normMeter(sh.meter)}`, sh.form && `**Form** ${sh.form}`, sh.band && `**Band** ${sh.band}`, `**Master** ${sh.master || 'clean'}`, `**Ending** ${sh.ending === 'cut' ? 'stop' : 'fade'}`];
  lines.push(facts.filter(Boolean).join(' · '), '');
  // the form
  lines.push('## Form', '', '| # | Section | Bars | Chords | Plays |', '|---|---|---|---|---|');
  sh.sections.forEach((s, k) => {
    const moves = [s.shift ? `key ${s.shift > 0 ? '+' : ''}${s.shift}` : '', s.bpm ? `${s.bpm} bpm` : '', s.level && s.level !== 1 ? `level ${s.level}` : '', s.solo ? `solo: ${s.solo}` : ''].filter(Boolean).join(', ');
    const play = s.play.map((x) => `${x.part}${x.variant !== 'main' ? `.${x.variant}` : ''}${x.enter ? ` (${{ in: 'comes in', out: 'drops out', alt: 'on and off' }[x.enter] || x.enter})` : ''}`).join(', ');
    lines.push(`| ${k + 1} | **${s.name}**${moves ? ` (${moves})` : ''} | ${s.bars} | ${s.chords} | ${play} |`);
  });
  lines.push('');
  // a chord chart per section (each name once, unless its chords or length differ)
  lines.push('## Chord chart', '');
  const seen = new Set();
  for (const s of sh.sections) {
    const prog = tools.transposeProgression(sh.chords[s.chords], s.shift || 0);
    const key = `${s.name}|${prog}|${s.bars}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bars = progressionBars(prog);
    lines.push(`**${s.name}** — ${s.bars} bars${s.shift ? ` (key ${s.shift > 0 ? '+' : ''}${s.shift})` : ''}`, '');
    for (let b = 0; b < s.bars; b += 4) {
      const row = [];
      for (let k = b; k < Math.min(s.bars, b + 4); k++) row.push(bars.length ? bars[k % bars.length] : '–');
      lines.push(`\`| ${row.map((c) => c.padEnd(6)).join(' | ')} |\``);
    }
    lines.push('');
  }
  // the tunes
  if (sh.melody || sh.hook) {
    lines.push(`## Melody and hook`, '', `In scale degrees of ${sh.scale} (0 = the tonic, 7 = an octave up, ~ = rest), one bar per step of \`<…>\`.`, '');
    if (sh.melody) lines.push(`- **Melody:** \`${sh.melody}\``);
    if (sh.hook) lines.push(`- **Hook:** \`${sh.hook}\``);
    lines.push('');
  }
  // the parts
  lines.push('## Parts', '');
  for (const p of sh.parts) {
    const extra = [p.tune && `plays the ${p.tune}`, p.voices?.length && `voices: ${p.voices.map((v) => v.replace(/_/g, ' ')).join(', ')}`, p.layers?.length && `layered with ${p.layers.join(', ')}`].filter(Boolean).join('; ');
    lines.push(`- **${p.id}** — ${p.role || 'part'}, ${p.sound || 'its own sounds'}${p.variants.length > 1 ? ` · variants: ${p.variants.join(', ')}` : ''}${p.desc ? ` — ${p.desc}` : ''}${extra ? ` (${extra})` : ''}`);
  }
  lines.push('', `*Exported from Strudel AI.*`, '');
  return lines.join('\n');
}

export default {
  id: 'lead-sheet-export',
  name: 'Lead sheet export',
  version: '1.0.0',
  description: 'Export a song as a lead sheet (Markdown): key, tempo, form, chord chart per section, melody, hook and parts.',
  setup(api) {
    api.addExporter({
      id: 'sheet', label: 'Lead sheet', icon: '📝', ext: 'md', mime: 'text/markdown', copy: true,
      title: 'The song on one page (Markdown): form, chord chart, melody, hook and parts',
      export: (song, tools) => leadSheet(song, tools),
    });
  },
};
