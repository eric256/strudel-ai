// Song forms: the order and length of a song's sections.

export const DEFAULT_FORMS = [
  { name: 'pop', meters: '4/4', keys: 'C major, G major, D major, A minor, E minor, F major', use: 'pop, synthwave, funk, disco, indie dance', sections: 'intro 4, verse 8, pre-chorus 4, chorus 4, verse 8, pre-chorus 4, chorus 4, bridge 8, chorus 4, outro 4' },
  { name: 'verse-chorus', meters: '4/4, 6/8', keys: 'C major, G major, E minor, A minor, D major', use: 'short pop songs, city pop, synth pop, rock', sections: 'intro 4, verse 8, chorus 4, verse 8, chorus 4, outro 4' },
  { name: 'edm', meters: '4/4', keys: 'A minor, F minor, C minor, G minor, E minor', use: 'EDM, big room, future bass, dubstep, electro', sections: 'intro 8, build 8, drop 8, breakdown 8, build 4, drop 8, outro 4' },
  { name: 'house', meters: '4/4', keys: 'A minor, C minor, F minor, D dorian, G minor', use: 'house, deep house, tech house, afro house, nu-disco', sections: 'intro 8, groove 8, build 4, drop 8, break 8, build 4, drop 8, outro 8' },
  { name: 'techno', meters: '4/4', keys: 'A minor, F minor, D minor, C minor, E phrygian', use: 'techno, minimal, industrial, acid', sections: 'intro 8, groove 8, build 8, peak 8, break 8, peak 8, outro 8' },
  { name: 'trance', meters: '4/4', keys: 'A minor, F# minor, D minor, G minor, B minor', use: 'trance, progressive, psytrance, uplifting', sections: 'intro 8, build 8, breakdown 8, build 4, drop 8, breakdown 4, drop 8, outro 8' },
  { name: 'drum & bass', meters: '4/4', keys: 'F minor, A minor, D minor, E minor, G minor', use: 'drum & bass, jungle, breakbeat, liquid', sections: 'intro 8, build 4, drop 8, breakdown 8, build 4, drop 8, outro 4' },
  { name: 'hip hop', meters: '4/4', keys: 'C minor, D minor, F minor, A minor, Eb major', use: 'hip hop, trap, boom bap, r&b', sections: 'intro 4, verse 8, hook 4, verse 8, hook 4, bridge 4, hook 4, outro 4' },
  { name: 'lo-fi', meters: '4/4', keys: 'D dorian, A minor, F major, E minor, G dorian', use: 'lo-fi, chillhop, jazz-hop, downtempo, chill', sections: 'intro 4, A 8, A 8, B 8, A 8, outro 4' },
  { name: 'jazz AABA', meters: '4/4, 3/4', keys: 'Bb major, F major, Eb major, C minor, D dorian', use: 'jazz, neo-soul, bossa nova, swing, lounge', sections: 'intro 4, A 8, A 8, B 8, A 8, solo 8, A 8, outro 4' },
  { name: 'jazz head & solos', meters: '4/4, 3/4', keys: 'F major, Bb major, Eb major, C minor, D dorian', use: 'jazz, bebop, hard bop, swing, big band, jazz trio — the theme, solos, the theme again', sections: 'intro 4, head 8, head 8, solo 8, solo 8, solo 8, head 8, outro 4' },
  { name: 'fusion', meters: '4/4, 7/8', keys: 'E major, D major, A major, F# minor, B minor', use: 'Japanese fusion, jazz-funk, city pop instrumentals, smooth jazz, prog fusion', sections: 'intro 4, theme 8, verse 8, chorus 4, theme 8, solo 8, break 4, chorus 4, theme 8, outro 4' },
  { name: 'pop anthem', meters: '4/4', keys: 'C major, D major, G major, A minor, E major', use: 'modern pop, dance-pop, synth-pop, power pop — big choruses', sections: 'intro 4, verse 8, pre-chorus 4, chorus 4, post-chorus 4, verse 8, pre-chorus 4, chorus 4, bridge 8, chorus 4, chorus 4, outro 4' },
  { name: 'dub', meters: '4/4', keys: 'A minor, D minor, G minor, E minor', use: 'dub, reggae, dub techno, ska', sections: 'intro 8, riddim 8, dub 8, riddim 8, dub 8, outro 8' },
  { name: 'chiptune', meters: '4/4, 3/4', keys: 'C major, A minor, E minor, G major', use: 'chiptune, video game, 8-bit, arcade', sections: 'intro 4, A 8, B 8, A 8, C 8, A 8, outro 4' },
  { name: 'build & release', meters: '4/4, 6/8', keys: 'D minor, E minor, B minor, C major', use: 'post-rock, cinematic builds, epic, anthems', sections: 'intro 4, build 8, build 8, peak 8, release 8, outro 4' },
  { name: 'ambient', meters: '4/4, 3/4, 6/8', keys: 'D lydian, C major, A minor, E minor, F lydian', use: 'ambient, drone, cinematic, meditation, soundscape', sections: 'intro 8, A 8, B 8, A 8, outro 8' },
  { name: 'short', meters: '4/4, 3/4', keys: '', use: 'quick sketches, jingles, short pieces', sections: 'intro 4, A 8, B 8, A 8, outro 4' },
  // a few more per genre (forms are guides: the AI varies them)
  { name: 'techno journey', meters: '4/4', keys: 'A minor, F minor, D minor, E phrygian', use: 'techno, deep techno, hypnotic, dub techno — long and evolving', sections: 'intro 16, groove 8, groove 12, break 4, peak 16, drift 8, peak 8, outro 8' },
  { name: 'techno tool', meters: '4/4', keys: 'A minor, F minor, C minor', use: 'techno, minimal, acid — short and driving', sections: 'intro 8, groove 16, break 4, groove 8, outro 4' },
  { name: 'house extended', meters: '4/4', keys: 'A minor, C minor, D dorian, F minor', use: 'house, deep house, nu-disco, garage — the long mix', sections: 'intro 8, groove 8, verse 8, build 4, drop 8, break 8, build 4, drop 8, groove 8, outro 8' },
  { name: 'edm festival', meters: '4/4', keys: 'F minor, A minor, C minor, G minor', use: 'EDM, big room, festival, future bass — two big drops', sections: 'intro 8, verse 8, build 8, drop 8, verse 8, build 8, drop 8, outro 4' },
  { name: 'dnb roller', meters: '4/4', keys: 'F minor, D minor, A minor', use: 'drum & bass, rollers, liquid, jungle — long rolling grooves', sections: 'intro 8, roll 16, build 4, drop 16, breakdown 8, drop 16, outro 8' },
  { name: 'beat tape', meters: '4/4', keys: 'C minor, F minor, D minor, Eb major', use: 'hip hop, boom bap, beat tapes, instrumental hip hop', sections: 'intro 4, loop 8, flip 8, loop 8, outro 4' },
  { name: 'lo-fi loop', meters: '4/4, 3/4', keys: 'D dorian, F major, A minor', use: 'lo-fi, chillhop, study beats, jazz-hop — short loops', sections: 'intro 4, A 8, B 8, A 8, B 4, outro 4' },
  { name: 'jazz ballad', meters: '4/4, 3/4, 12/8', keys: 'Eb major, Bb major, F major, Db major', use: 'jazz ballads, slow jazz, late-night jazz, torch songs', sections: 'intro 4, A 8, A 8, B 8, A 8, solo 8, A 8, outro 4' },
  { name: 'city pop', meters: '4/4', keys: 'E major, D major, F major, B minor', use: 'city pop, Japanese fusion, AOR, smooth jazz, jazz-funk', sections: 'intro 4, verse 8, pre-chorus 4, chorus 4, theme 8, solo 8, pre-chorus 4, chorus 4, chorus 4, outro 4' },
  // long forms (about 4 minutes): every section changes something, so they keep moving
  { name: 'long ballad', meters: '4/4, 6/8, 12/8', keys: 'C major, G major, Eb major, A minor', use: 'long ballads, power ballads, soul, gospel, slow builds — about 4 minutes', sections: "intro 4, verse 8, verse 8, pre-chorus 4, chorus 4, interlude 4, verse 8, pre-chorus 4, chorus 4, chorus 4, bridge 8, breakdown 4, chorus 4, chorus 4, outro 8" },
  { name: 'ambient journey', meters: '4/4, 3/4', keys: 'D lydian, F major, A minor, E dorian', use: 'long ambient, environmental, nature soundscapes, drone, generative, meditation — about 4 minutes', sections: "intro 8, drift 8, A 8, A' 8, swell 8, B 8, B' 8, still 8, return 8, outro 8" },
];

// built-ins before v1.19 — anything else new is added for people who already have their own list
export const OLD_DEFAULT_FORMS = ['pop', 'edm', 'drum & bass', 'hip hop', 'lo-fi', 'ambient', 'short'];

// built-in forms whose choruses used to be 8 bars: update them unless the user changed them
export const OLD_FORM_SECTIONS = { 'pop': 'intro 4, verse 8, pre-chorus 4, chorus 8, verse 8, pre-chorus 4, chorus 8, bridge 8, chorus 8, outro 4', 'verse-chorus': 'intro 4, verse 8, chorus 8, verse 8, chorus 8, outro 4', 'hip hop': 'intro 4, verse 8, hook 8, verse 8, hook 8, bridge 4, hook 8, outro 4' };

/** "intro 4, verse 8 …" → [{ name, bars }] */
export function parseFormSections(text) {
  return String(text || '')
    .split(/[,\n|→]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const m = t.match(/^(.*?)[\s:x×]*(\d+)\s*(?:bars?)?$/i);
      const name = (m ? m[1] : t).trim() || 'section';
      return { name, bars: Math.max(1, Math.min(32, m ? Number(m[2]) : 8)) };
    });
}

export const formBars = (f) => parseFormSections(f.sections).reduce((a, x) => a + x.bars, 0);

/** The forms part of a song-sheet request: one fixed form, or all of them to choose from. */
/** A form by name (case-insensitive) in a list of forms or bands. */
export const findIn = (list, name) => list.find((f) => f.name.toLowerCase() === String(name || '').trim().toLowerCase());

/** The forms part of a song-sheet request: one fixed form, or all of them to choose from. */
export function formsForRequest(forms, choice) {
  const line = (f) => `- "${f.name}"${f.use ? ` (for ${f.use})` : ''}: ${parseFormSections(f.sections).map((x) => `${x.name} ${x.bars}`).join(', ')}${f.meters ? ` · meters ${f.meters}` : ''}`;
  const fixed = choice && choice !== 'auto' ? findIn(forms, choice) : null;
  if (fixed) return `SONG FORM — build the song on this one (set "form": "${fixed.name}"); it's a guide, not a template — keep its shape, vary the details:\n${line(fixed)}`;
  return `SONG FORMS — pick the one that fits this song's genre, set "form" to its name, and use it as a guide (keep its shape, vary the details):\n${forms.map(line).join('\n')}`;
}
