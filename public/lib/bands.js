// Bands: a line-up of instruments (role, sound, what it plays) and a master style.
import { findIn } from './forms.js';
import { normStyle } from '../master.js';

export const DEFAULT_BANDS = [
  { name: 'lo-fi trio', use: 'lo-fi, chillhop, jazz-hop, study beats', master: 'lo-fi', instruments: 'drums: AkaiMPC60 — dusty, laid-back boom-bap kit\nbass: gm_acoustic_bass — round upright bass\nchords: gm_epiano1 — warm Rhodes chords\nmelody: gm_vibraphone — soft mallet hook\ncounter: gm_muted_trumpet — smoky answers to the hook\npad: gm_pad_warm — a soft bed under the chords\nfx: gm_fx_rain — rain-like texture' },
  { name: 'house crew', use: 'house, deep house, tech house, nu-disco, garage', master: 'house', instruments: 'drums: RolandTR909 — four-on-the-floor kick, open hats, claps\nbass: gm_synth_bass_1 — rolling analog bass\nchords: gm_percussive_organ — offbeat organ stabs\npad: gm_string_ensemble_1 — disco strings\nmelody: gm_epiano2 — glassy hook\ncounter: gm_electric_guitar_muted — funky muted riff' },
  { name: 'techno rig', use: 'techno, minimal, industrial, acid', master: 'techno', instruments: 'drums: RolandTR909 — driving kick, rides, claps\nperc: RolandTR606 — ticky percussion and toms\nbass: sawtooth — acid bass, filtered\narp: square — hypnotic sequence\npad: gm_pad_sweep — dark filter-swept pad\nfx: white — noise risers and sweeps' },
  { name: 'synthwave', use: 'synthwave, retrowave, outrun, 80s pop, Italo disco', master: 'synthwave', instruments: 'drums: LinnDrum — big 80s kit\nbass: gm_synth_bass_1 — pulsing eighth-note bass\nchords: gm_pad_poly — polysynth chords\narp: sawtooth — bright arpeggio\nmelody: gm_lead_2_sawtooth — soaring saw lead\ncounter: gm_synth_brass_1 — synth brass answers\npad: gm_synth_strings_1 — string machine' },
  { name: 'jazz combo', use: 'jazz, swing, bossa nova, neo-soul, lounge', master: 'warm', instruments: 'drums: YamahaRY30 — light kit, brushes feel, ride\nbass: gm_acoustic_bass — walking upright bass\nchords: gm_piano — comping piano\nmelody: gm_tenor_sax — the tune\ncounter: gm_vibraphone — vibes answering the sax\npad: gm_electric_guitar_jazz — soft hollow-body chords' },
  { name: 'hip hop producer', use: 'hip hop, trap, boom bap, R&B', master: 'hiphop', instruments: 'drums: RolandTR808 — booming kick, snappy snare, rolling hats\nbass: sine — deep 808-style sub\nchords: gm_epiano1 — mellow keys\nmelody: gm_celesta — bell hook\ncounter: gm_pizzicato_strings — plucked answers\npad: gm_string_ensemble_2 — slow strings' },
  { name: 'drum & bass unit', use: 'drum & bass, jungle, liquid, breakbeat', master: 'dnb', instruments: 'drums: AkaiMPC60 — fast breakbeat kit\nbass: gm_lead_8_bass_lead — heavy reese-style bass\nchords: gm_epiano2 — liquid chords\npad: gm_pad_new_age — shimmering pad\nmelody: gm_lead_6_voice — airy vocal-like lead\nfx: white — risers' },
  { name: 'pop band', use: 'pop, synth-pop, city pop, funk, disco, indie', master: 'pop', instruments: 'drums: LinnDrum — punchy pop kit\nbass: gm_electric_bass_finger — round electric bass\nchords: gm_electric_guitar_clean — clean rhythm guitar\nmelody: gm_lead_1_square — catchy synth hook\ncounter: gm_glockenspiel — sparkly answers\npad: gm_synth_strings_1 — string pad' },
  { name: 'rock band', use: 'rock, indie rock, punk, metal, grunge', master: 'rock', instruments: 'drums: AlesisHR16 — rock kit, crashes\nbass: gm_electric_bass_pick — punchy picked bass\nchords: gm_overdriven_guitar — crunchy rhythm guitar\nmelody: gm_distortion_guitar — lead guitar\npad: gm_rock_organ — organ swell' },
  { name: 'ambient ensemble', use: 'ambient, drone, new age, soundscapes, meditation', master: 'ambient', instruments: 'pad: gm_pad_halo — airy pad\npad: gm_pad_bowed — bowed glass drone\nbass: sine — soft sub\nmelody: gm_kalimba — sparse thumb-piano figure\ncounter: gm_shakuhachi — breathy long notes\nfx: gm_fx_atmosphere — evolving texture\nperc: gm_marimba — soft, sparse wooden hits' },
  { name: 'cinematic orchestra', use: 'cinematic, film score, epic, orchestral, post-rock', master: 'cinematic', instruments: 'perc: gm_taiko_drum — big drums\nbass: gm_contrabass — low strings\nchords: gm_string_ensemble_1 — orchestral strings\nmelody: gm_french_horn — the theme\ncounter: gm_violin — soaring counter-line\narp: gm_orchestral_harp — harp arpeggios\npad: gm_choir_aahs — choir' },
  { name: 'dub sound system', use: 'dub, reggae, dub techno, ska', master: 'dub', instruments: 'drums: RolandTR808 — one-drop kit, rimshots\nbass: gm_electric_bass_finger — deep, heavy bass\nchords: gm_drawbar_organ — offbeat skank\nmelody: gm_trombone — the riddim melody\nfx: gm_fx_echoes — echo texture' },
  { name: 'chip band', use: 'chiptune, 8-bit, video game, arcade', master: 'chiptune', instruments: 'perc: white — noise drums\nbass: triangle — chip bass\narp: square — fast chord arpeggios\nmelody: pulse — chip lead\ncounter: square — second channel' },
];

export const BAND_ROLES = ['drums', 'perc', 'bass', 'chords', 'pad', 'arp', 'melody', 'counter', 'fx'];

/** "drums: RolandTR909 — four on the floor" lines → [{ role, sound, desc }] */
export function parseInstruments(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^([a-z]+)\s*:\s*([A-Za-z0-9_]+)\s*(?:[—–-]+\s*(.*))?$/i);
    return m ? { role: m[1].toLowerCase(), sound: m[2], desc: (m[3] || '').trim() } : null;
  }).filter(Boolean);
}

/** Hold a sheet's parts to its band: a part whose sound isn't the band's for its role gets the band's sound. */
export function enforceBand(parts, band) {
  const inst = parseInstruments(band.instruments);
  const used = new Map();
  for (const p of parts) {
    const cands = inst.filter((i) => i.role === p.role);
    if (!cands.length || cands.some((i) => i.sound.toLowerCase() === p.sound.toLowerCase())) continue;
    const n = used.get(p.role) || 0;
    used.set(p.role, n + 1);
    p.sound = cands[n % cands.length].sound;
  }
}

/** The bands part of a song-sheet request: one fixed band, or all of them to choose from. */
export function bandsForRequest(bands, choice) {
  const line = (b) => `- "${b.name}"${b.use ? ` (for ${b.use})` : ''} — master "${normStyle(b.master) || 'clean'}":\n${parseInstruments(b.instruments).map((i) => `    ${i.role}: ${i.sound}${i.desc ? ` — ${i.desc}` : ''}`).join('\n')}`;
  const fixed = choice && choice !== 'auto' ? findIn(bands, choice) : null;
  if (fixed) return `BAND — write the song for exactly this band (set "band": "${fixed.name}" and "master": "${normStyle(fixed.master) || 'clean'}"); every part uses one of its instruments, with the role given:\n${line(fixed)}`;
  return `BANDS — if one fits this song's genre, write for it: set "band" to its name, take its master style, and give every part one of its instruments (with the role given). If none fits, set "band": "none" and choose the sounds yourself from the sound guide:\n${bands.map(line).join('\n')}`;
}
