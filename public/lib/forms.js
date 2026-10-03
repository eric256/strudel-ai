// Song forms: the order and length of a song's sections.

export const DEFAULT_FORMS = [
  { name: 'pop', genres: 'pop, funk', meters: '4/4', keys: 'C major, G major, D major, A minor, E minor, F major', use: 'pop, synthwave, funk, disco, indie dance', sections: 'intro 4, verse 8, pre-chorus 4, chorus 4, verse 8, pre-chorus 4, chorus 4, bridge 8, chorus 4, outro 4' },
  { name: 'verse-chorus', genres: 'pop, rock, synthwave, fusion', meters: '4/4, 6/8', keys: 'C major, G major, E minor, A minor, D major', use: 'short pop songs, city pop, synth pop, rock', sections: 'intro 4, verse 8, chorus 4, verse 8, chorus 4, outro 4' },
  { name: 'edm', genres: 'edm, trance', meters: '4/4', keys: 'A minor, F minor, C minor, G minor, E minor', use: 'EDM, big room, future bass, dubstep, electro', sections: 'intro 8, build 8, drop 8, breakdown 8, build 4, drop 8, outro 4' },
  { name: 'house', genres: 'house, funk', meters: '4/4', keys: 'A minor, C minor, F minor, D dorian, G minor', use: 'house, deep house, tech house, afro house, nu-disco', sections: 'intro 8, groove 8, build 4, drop 8, break 8, build 4, drop 8, outro 8' },
  { name: 'techno', genres: 'techno', meters: '4/4', keys: 'A minor, F minor, D minor, C minor, E phrygian', use: 'techno, minimal, industrial, acid', sections: 'intro 8, groove 8, build 8, peak 8, break 8, peak 8, outro 8' },
  { name: 'trance', genres: 'trance', meters: '4/4', keys: 'A minor, F# minor, D minor, G minor, B minor', use: 'trance, progressive, psytrance, uplifting', sections: 'intro 8, build 8, breakdown 8, build 4, drop 8, breakdown 4, drop 8, outro 8' },
  { name: 'drum & bass', genres: 'dnb', meters: '4/4', keys: 'F minor, A minor, D minor, E minor, G minor', use: 'drum & bass, jungle, breakbeat, liquid', sections: 'intro 8, build 4, drop 8, breakdown 8, build 4, drop 8, outro 4' },
  { name: 'hip hop', genres: 'hiphop', meters: '4/4', keys: 'C minor, D minor, F minor, A minor, Eb major', use: 'hip hop, trap, boom bap, r&b', sections: 'intro 4, verse 8, hook 4, verse 8, hook 4, bridge 4, hook 4, outro 4' },
  { name: 'lo-fi', genres: 'lofi, downtempo', meters: '4/4', keys: 'D dorian, A minor, F major, E minor, G dorian', use: 'lo-fi, chillhop, jazz-hop, downtempo, chill', sections: 'intro 4, A 8, A 8, B 8, A 8, outro 4' },
  { name: 'jazz AABA', genres: 'jazz, latin', meters: '4/4, 3/4', keys: 'Bb major, F major, Eb major, C minor, D dorian', use: 'jazz, neo-soul, bossa nova, swing, lounge', sections: 'intro 4, A 8, A 8, B 8, A 8, solo 8, A 8, outro 4' },
  { name: 'jazz head & solos', genres: 'jazz', meters: '4/4, 3/4', keys: 'F major, Bb major, Eb major, C minor, D dorian', use: 'jazz, bebop, hard bop, swing, big band, jazz trio — the theme, solos, the theme again', sections: 'intro 4, head 8, head 8, solo 8, solo 8, solo 8, head 8, outro 4' },
  { name: 'fusion', genres: 'fusion', meters: '4/4, 7/8', keys: 'E major, D major, A major, F# minor, B minor', use: 'Japanese fusion, jazz-funk, city pop instrumentals, smooth jazz, prog fusion', sections: 'intro 4, theme 8, verse 8, chorus 4, theme 8, solo 8, break 4, chorus 4, theme 8, outro 4' },
  { name: 'pop anthem', genres: 'pop, rock', meters: '4/4', keys: 'C major, D major, G major, A minor, E major', use: 'modern pop, dance-pop, synth-pop, power pop — big choruses', sections: 'intro 4, verse 8, pre-chorus 4, chorus 4, post-chorus 4, verse 8, pre-chorus 4, chorus 4, bridge 8, chorus 4, chorus 4, outro 4' },
  { name: 'dub', genres: 'dub', meters: '4/4', keys: 'A minor, D minor, G minor, E minor', use: 'dub, reggae, dub techno, ska', sections: 'intro 8, riddim 8, dub 8, riddim 8, dub 8, outro 8' },
  { name: 'chiptune', genres: 'chiptune', meters: '4/4, 3/4', keys: 'C major, A minor, E minor, G major', use: 'chiptune, video game, 8-bit, arcade', sections: 'intro 4, A 8, B 8, A 8, C 8, A 8, outro 4' },
  { name: 'build & release', genres: 'cinematic, rock', meters: '4/4, 6/8', keys: 'D minor, E minor, B minor, C major', use: 'post-rock, cinematic builds, epic, anthems', sections: 'intro 4, build 8, build 8, peak 8, release 8, outro 4' },
  { name: 'ambient', genres: 'ambient, downtempo', meters: '4/4, 3/4, 6/8', keys: 'D lydian, C major, A minor, E minor, F lydian', use: 'ambient, drone, cinematic, meditation, soundscape', sections: 'intro 8, A 8, B 8, A 8, outro 8' },
  { name: 'short', genres: '', meters: '4/4, 3/4', keys: '', use: 'quick sketches, jingles, short pieces', sections: 'intro 4, A 8, B 8, A 8, outro 4' },
  // a few more per genre (forms are guides: the AI varies them)
  { name: 'techno journey', genres: 'techno, dub', meters: '4/4', keys: 'A minor, F minor, D minor, E phrygian', use: 'techno, deep techno, hypnotic, dub techno — long and evolving', sections: 'intro 16, groove 8, groove 12, break 4, peak 16, drift 8, peak 8, outro 8' },
  { name: 'techno tool', genres: 'techno', meters: '4/4', keys: 'A minor, F minor, C minor', use: 'techno, minimal, acid — short and driving', sections: 'intro 8, groove 16, break 4, groove 8, outro 4' },
  { name: 'house extended', genres: 'house', meters: '4/4', keys: 'A minor, C minor, D dorian, F minor', use: 'house, deep house, nu-disco, garage — the long mix', sections: 'intro 8, groove 8, verse 8, build 4, drop 8, break 8, build 4, drop 8, groove 8, outro 8' },
  { name: 'edm festival', genres: 'edm', meters: '4/4', keys: 'F minor, A minor, C minor, G minor', use: 'EDM, big room, festival, future bass — two big drops', sections: 'intro 8, verse 8, build 8, drop 8, verse 8, build 8, drop 8, outro 4' },
  { name: 'dnb roller', genres: 'dnb', meters: '4/4', keys: 'F minor, D minor, A minor', use: 'drum & bass, rollers, liquid, jungle — long rolling grooves', sections: 'intro 8, roll 16, build 4, drop 16, breakdown 8, drop 16, outro 8' },
  { name: 'beat tape', genres: 'hiphop, lofi', meters: '4/4', keys: 'C minor, F minor, D minor, Eb major', use: 'hip hop, boom bap, beat tapes, instrumental hip hop', sections: 'intro 4, loop 8, flip 8, loop 8, outro 4' },
  { name: 'lo-fi loop', genres: 'lofi', meters: '4/4, 3/4', keys: 'D dorian, F major, A minor', use: 'lo-fi, chillhop, study beats, jazz-hop — short loops', sections: 'intro 4, A 8, B 8, A 8, B 4, outro 4' },
  { name: 'jazz ballad', genres: 'jazz', meters: '4/4, 3/4, 12/8', keys: 'Eb major, Bb major, F major, Db major', use: 'jazz ballads, slow jazz, late-night jazz, torch songs', sections: 'intro 4, A 8, A 8, B 8, A 8, solo 8, A 8, outro 4' },
  { name: 'city pop', genres: 'fusion, pop', meters: '4/4', keys: 'E major, D major, F major, B minor', use: 'city pop, Japanese fusion, AOR, smooth jazz, jazz-funk', sections: 'intro 4, verse 8, pre-chorus 4, chorus 4, theme 8, solo 8, pre-chorus 4, chorus 4, chorus 4, outro 4' },
  // more forms, so every genre has a few to choose from
  { name: 'trance anthem', genres: 'trance', meters: '4/4', keys: 'A minor, F# minor, D minor, B minor', use: 'uplifting trance, anthem trance, euphoric', sections: 'intro 16, groove 8, build 8, breakdown 16, build 8, drop 16, outro 8' },
  { name: 'psy journey', genres: 'trance', meters: '4/4', keys: 'E phrygian, A minor, F# minor, D minor', use: 'psytrance, goa, progressive psy — rolling and hypnotic', sections: 'intro 8, groove 16, build 8, peak 16, break 8, peak 16, outro 8' },
  { name: 'synthwave night', genres: 'synthwave', meters: '4/4', keys: 'A minor, E minor, F# minor, C minor', use: 'synthwave, outrun, darkwave — a night drive with a solo', sections: 'intro 8, verse 8, chorus 4, verse 8, chorus 4, solo 8, chorus 4, outro 8' },
  { name: 'funk groove', genres: 'funk', meters: '4/4', keys: 'E minor, A dorian, D dorian, G mixolydian', use: 'funk, jazz-funk, soul — a groove with a solo', sections: 'intro 4, groove 8, verse 8, chorus 4, groove 8, solo 8, chorus 4, outro 4' },
  { name: 'disco', genres: 'funk, house', meters: '4/4', keys: 'A minor, D minor, F major, C major', use: 'disco, nu-disco, space disco, boogie', sections: 'intro 8, verse 8, chorus 4, break 8, verse 8, chorus 4, chorus 4, outro 8' },
  { name: 'rock song', genres: 'rock', meters: '4/4, 12/8', keys: 'E minor, A minor, D major, G major, E major', use: 'rock, indie, punk — with a guitar solo', sections: 'intro 4, verse 8, chorus 4, verse 8, chorus 4, solo 8, chorus 4, chorus 4, outro 4' },
  { name: 'cinematic suite', genres: 'cinematic', meters: '4/4, 3/4, 6/8', keys: 'D minor, C minor, E minor, F major', use: 'film score, orchestral, epic — a theme that grows', sections: 'intro 8, theme 8, build 8, climax 8, reflection 8, theme 8, outro 8' },
  { name: 'dub riddim', genres: 'dub', meters: '4/4', keys: 'A minor, D minor, G minor, E minor', use: 'reggae, roots, dub versions', sections: 'intro 4, riddim 8, version 8, riddim 8, dub 8, riddim 8, outro 4' },
  { name: 'chip quest', genres: 'chiptune', meters: '4/4, 3/4', keys: 'C major, A minor, E minor, D minor', use: 'video game, 8-bit adventure, arcade', sections: 'intro 4, A 8, A 8, B 8, A 8, boss 8, A 8, outro 4' },
  { name: 'downtempo', genres: 'downtempo', meters: '4/4', keys: 'D minor, A minor, F major, C minor', use: 'downtempo, trip hop, chillout, lounge', sections: 'intro 8, A 8, B 8, A 8, break 4, B 8, outro 8' },
  { name: 'bossa', genres: 'latin, jazz', meters: '4/4', keys: 'D minor, F major, A minor, G major', use: 'bossa nova, samba, latin jazz — gentle', sections: 'intro 4, A 8, A 8, B 8, A 8, outro 4' },
  { name: 'latin jam', genres: 'latin', meters: '4/4', keys: 'C minor, G minor, D minor, F major', use: 'salsa, afro-cuban, latin jazz, cumbia — a montuno and solos', sections: 'intro 4, A 8, B 8, A 8, montuno 8, solo 8, A 8, outro 4' },
  { name: 'hip hop cypher', genres: 'hiphop', meters: '4/4', keys: 'C minor, F minor, G minor, D minor', use: 'trap, hip hop, r&b — hook-heavy', sections: 'intro 4, hook 4, verse 8, hook 4, verse 8, bridge 4, hook 4, outro 4' },
  // long forms (about 4 minutes): every section changes something, so they keep moving
  { name: 'long ballad', genres: 'pop, rock', meters: '4/4, 6/8, 12/8', keys: 'C major, G major, Eb major, A minor', use: 'long ballads, power ballads, soul, gospel, slow builds — about 4 minutes', sections: "intro 4, verse 8, verse 8, pre-chorus 4, chorus 4, interlude 4, verse 8, pre-chorus 4, chorus 4, chorus 4, bridge 8, breakdown 4, chorus 4, chorus 4, outro 8" },
  { name: 'ambient journey', genres: 'ambient, cinematic', meters: '4/4, 3/4', keys: 'D lydian, F major, A minor, E dorian', use: 'long ambient, environmental, nature soundscapes, drone, generative, meditation — about 4 minutes', sections: "intro 8, drift 8, A 8, A' 8, swell 8, B 8, B' 8, still 8, return 8, outro 8" },
  // acoustic & folk
  { name: 'folk song', genres: 'acoustic', meters: '4/4, 3/4, 6/8', keys: 'G major, D major, C major, A major, E minor', use: 'folk, americana, singer-songwriter, country — verses and a sing-along chorus', sections: 'intro 4, verse 8, chorus 4, verse 8, chorus 4, instrumental 8, verse 8, chorus 4, outro 4' },
  { name: 'acoustic ballad', genres: 'acoustic, pop', meters: '4/4, 6/8, 3/4', keys: 'C major, G major, D major, A minor, Eb major', use: 'acoustic ballads, piano ballads, unplugged, coffeehouse — quiet start, a fuller last chorus', sections: 'intro 4, verse 8, verse 8, chorus 4, verse 8, chorus 4, bridge 4, chorus 4, outro 4' },
  { name: 'tune set', genres: 'acoustic', meters: '6/8, 4/4, 2/4', keys: 'D major, G major, A dorian, E dorian, A major', use: 'celtic, bluegrass, jigs, reels, fiddle tunes — the tune, a second part, solos, the tune again', sections: 'intro 4, A 8, A 8, B 8, B 8, solo 8, A 8, B 8, outro 4' },
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
