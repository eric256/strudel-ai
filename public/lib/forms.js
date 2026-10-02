// Song forms: the order and length of a song's sections.

export const DEFAULT_FORMS = [
  { name: 'pop', use: 'pop, synthwave, funk, disco, indie dance', sections: 'intro 4, verse 8, pre-chorus 4, chorus 4, verse 8, pre-chorus 4, chorus 4, bridge 8, chorus 4, outro 4' },
  { name: 'verse-chorus', use: 'short pop songs, city pop, synth pop, rock', sections: 'intro 4, verse 8, chorus 4, verse 8, chorus 4, outro 4' },
  { name: 'edm', use: 'EDM, big room, future bass, dubstep, electro', sections: 'intro 8, build 8, drop 8, breakdown 8, build 4, drop 8, outro 4' },
  { name: 'house', use: 'house, deep house, tech house, afro house, nu-disco', sections: 'intro 8, groove 8, build 4, drop 8, break 8, build 4, drop 8, outro 8' },
  { name: 'techno', use: 'techno, minimal, industrial, acid', sections: 'intro 8, groove 8, build 8, peak 8, break 8, peak 8, outro 8' },
  { name: 'trance', use: 'trance, progressive, psytrance, uplifting', sections: 'intro 8, build 8, breakdown 8, build 4, drop 8, breakdown 4, drop 8, outro 8' },
  { name: 'drum & bass', use: 'drum & bass, jungle, breakbeat, liquid', sections: 'intro 8, build 4, drop 8, breakdown 8, build 4, drop 8, outro 4' },
  { name: 'hip hop', use: 'hip hop, trap, boom bap, r&b', sections: 'intro 4, verse 8, hook 4, verse 8, hook 4, bridge 4, hook 4, outro 4' },
  { name: 'lo-fi', use: 'lo-fi, chillhop, jazz-hop, downtempo, chill', sections: 'intro 4, A 8, A 8, B 8, A 8, outro 4' },
  { name: 'jazz AABA', use: 'jazz, neo-soul, bossa nova, swing, lounge', sections: 'intro 4, A 8, A 8, B 8, A 8, solo 8, A 8, outro 4' },
  { name: 'dub', use: 'dub, reggae, dub techno, ska', sections: 'intro 8, riddim 8, dub 8, riddim 8, dub 8, outro 8' },
  { name: 'chiptune', use: 'chiptune, video game, 8-bit, arcade', sections: 'intro 4, A 8, B 8, A 8, C 8, A 8, outro 4' },
  { name: 'build & release', use: 'post-rock, cinematic builds, epic, anthems', sections: 'intro 4, build 8, build 8, peak 8, release 8, outro 4' },
  { name: 'ambient', use: 'ambient, drone, cinematic, meditation, soundscape', sections: 'intro 8, A 8, B 8, A 8, outro 8' },
  { name: 'short', use: 'quick sketches, jingles, short pieces', sections: 'intro 4, A 8, B 8, A 8, outro 4' },
  // long forms (about 4 minutes): every section changes something, so they keep moving
  { name: 'long ballad', use: 'long ballads, power ballads, soul, gospel, slow builds — about 4 minutes', sections: "intro 4, verse 8, verse 8, pre-chorus 4, chorus 4, interlude 4, verse 8, pre-chorus 4, chorus 4, chorus 4, bridge 8, breakdown 4, chorus 4, chorus 4, outro 8" },
  { name: 'ambient journey', use: 'long ambient, environmental, nature soundscapes, drone, generative, meditation — about 4 minutes', sections: "intro 8, drift 8, A 8, A' 8, swell 8, B 8, B' 8, still 8, return 8, outro 8" },
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
  const line = (f) => `- "${f.name}"${f.use ? ` (for ${f.use})` : ''}: ${parseFormSections(f.sections).map((x) => `${x.name} ${x.bars}`).join(', ')}`;
  const fixed = choice && choice !== 'auto' ? findIn(forms, choice) : null;
  if (fixed) return `SONG FORM — use exactly this one (set "form": "${fixed.name}"):\n${line(fixed)}`;
  return `SONG FORMS — pick the one that fits this song's genre, and set "form" to its name:\n${forms.map(line).join('\n')}`;
}
