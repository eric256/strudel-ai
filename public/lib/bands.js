// Bands: a line-up of instruments (role, sound, what it plays) and a master style.
import { findIn } from './forms.js';
import { normStyle } from '../master.js';

export const DEFAULT_BANDS = [
  { name: 'lo-fi trio', meters: '4/4', keys: 'D dorian, F major, A minor, E minor', tweaks: 'vinyl 0.2', use: 'lo-fi, chillhop, jazz-hop, study beats', master: 'lo-fi', instruments: 'drums: AkaiMPC60 — dusty, laid-back boom-bap kit\nbass: gm_acoustic_bass — round upright bass\nchords: gm_epiano1 — warm Rhodes chords\nmelody: gm_vibraphone — soft mallet hook\ncounter: gm_muted_trumpet — smoky answers to the hook\npad: gm_pad_warm — a soft bed under the chords\n+ fx: gm_fx_rain — rain-like texture' },
  { name: 'house crew', meters: '4/4', keys: 'A minor, C minor, F minor, D dorian', tweaks: 'width 1.2', use: 'house, deep house, tech house, nu-disco, garage', master: 'house', instruments: 'drums: RolandTR909 — four-on-the-floor kick, open hats, claps\nbass: gm_synth_bass_1 — rolling analog bass\nchords: gm_percussive_organ — offbeat organ stabs\npad: gm_string_ensemble_1 — disco strings\nmelody: gm_epiano2 — glassy hook\n+ counter: gm_electric_guitar_muted — funky muted riff' },
  { name: 'techno rig', meters: '4/4', keys: 'A minor, F minor, D minor, E phrygian', use: 'techno, minimal, industrial, acid', master: 'techno', instruments: 'drums: RolandTR909 — driving kick, rides, claps\nperc: RolandTR606 — ticky percussion and toms\nbass: sawtooth — acid bass, filtered\narp: square — hypnotic sequence\npad: gm_pad_sweep — dark filter-swept pad\n+ fx: white — noise risers and sweeps' },
  { name: 'synthwave', meters: '4/4', keys: 'A minor, E minor, F# minor, C minor', tweaks: 'echo 0.18', use: 'synthwave, retrowave, outrun, 80s pop, Italo disco', master: 'synthwave', instruments: 'drums: LinnDrum — big 80s kit\nbass: gm_synth_bass_1 — pulsing eighth-note bass\nchords: gm_pad_poly — polysynth chords\narp: sawtooth — bright arpeggio\nmelody: gm_lead_2_sawtooth — soaring saw lead\n+ counter: gm_synth_brass_1 — synth brass answers\npad: gm_synth_strings_1 — string machine' },
  { name: 'jazz combo', meters: '4/4, 3/4', keys: 'Bb major, F major, Eb major, C minor, D dorian', tweaks: 'space 0.25', use: 'jazz, swing, bossa nova, neo-soul, lounge', master: 'warm', instruments: 'drums: YamahaRY30 — light kit, brushes feel, ride\nbass: gm_acoustic_bass — walking upright bass\nchords: gm_piano — comping piano\nmelody: gm_tenor_sax — the tune\ncounter: gm_vibraphone — vibes answering the sax\npad: gm_electric_guitar_jazz — soft hollow-body chords' },
  { name: 'hip hop producer', meters: '4/4', keys: 'C minor, F minor, D minor, A minor', use: 'hip hop, trap, boom bap, R&B', master: 'hiphop', instruments: 'drums: RolandTR808 — booming kick, snappy snare, rolling hats\nbass: sine — deep 808-style sub\nchords: gm_epiano1 — mellow keys\nmelody: gm_celesta — bell hook\ncounter: gm_pizzicato_strings — plucked answers\npad: gm_string_ensemble_2 — slow strings' },
  { name: 'drum & bass unit', meters: '4/4', keys: 'F minor, D minor, A minor, E minor', use: 'drum & bass, jungle, liquid, breakbeat', master: 'dnb', instruments: 'drums: AkaiMPC60 — fast breakbeat kit\nbass: gm_lead_8_bass_lead — heavy reese-style bass\nchords: gm_epiano2 — liquid chords\npad: gm_pad_new_age — shimmering pad\nmelody: gm_lead_6_voice — airy vocal-like lead\n+ fx: white — risers' },
  { name: 'pop band', meters: '4/4, 6/8', keys: 'C major, G major, D major, A minor, E minor', use: 'pop, synth-pop, city pop, funk, disco, indie', master: 'pop', instruments: 'drums: LinnDrum — punchy pop kit\nbass: gm_electric_bass_finger — round electric bass\nchords: gm_electric_guitar_clean — clean rhythm guitar\nmelody: gm_lead_1_square — catchy synth hook\n+ counter: gm_glockenspiel — sparkly answers\npad: gm_synth_strings_1 — string pad' },
  { name: 'rock band', meters: '4/4, 6/8, 12/8', keys: 'E minor, A minor, D major, G major, E major', tweaks: 'drive 0.4', use: 'rock, indie rock, punk, metal, grunge', master: 'rock', instruments: 'drums: AlesisHR16 — rock kit, crashes\nbass: gm_electric_bass_pick — punchy picked bass\nchords: gm_overdriven_guitar — crunchy rhythm guitar\nmelody: gm_distortion_guitar — lead guitar\n+ pad: gm_rock_organ — organ swell' },
  { name: 'ambient ensemble', meters: '4/4, 3/4, 6/8', keys: 'D lydian, C major, E minor, A minor', use: 'ambient, drone, new age, soundscapes, meditation', master: 'ambient', instruments: 'pad: gm_pad_halo — airy pad\npad: gm_pad_bowed — bowed glass drone\nbass: sine — soft sub\nmelody: gm_kalimba — sparse thumb-piano figure\ncounter: gm_shakuhachi — breathy long notes\nfx: gm_fx_atmosphere — evolving texture\nperc: gm_marimba — soft, sparse wooden hits' },
  { name: 'cinematic orchestra', meters: '4/4, 3/4, 6/8', keys: 'D minor, C minor, E minor, F major', use: 'cinematic, film score, epic, orchestral, post-rock', master: 'cinematic', instruments: 'perc: gm_taiko_drum — big drums\nbass: gm_contrabass — low strings\nchords: gm_string_ensemble_1 — orchestral strings\nmelody: gm_french_horn — the theme\ncounter: gm_violin — soaring counter-line\narp: gm_orchestral_harp — harp arpeggios\npad: gm_choir_aahs — choir' },
  { name: 'dub sound system', meters: '4/4', keys: 'A minor, D minor, G minor, E minor', use: 'dub, reggae, dub techno, ska', master: 'dub', instruments: 'drums: RolandTR808 — one-drop kit, rimshots\nbass: gm_electric_bass_finger — deep, heavy bass\nchords: gm_drawbar_organ — offbeat skank\nmelody: gm_trombone — the riddim melody\nfx: gm_fx_echoes — echo texture' },
  { name: 'fusion band', meters: '4/4, 7/8', keys: 'E major, D major, A major, F# minor, B minor', tweaks: 'high 2.5, width 1.3', use: 'Japanese jazz fusion, city pop instrumentals, jazz-funk, smooth jazz, 80s fusion', master: 'pop', instruments: 'drums: YamahaRY30 — tight, funky kit with ghost notes\nbass: gm_slap_bass_1 — slap bass, busy and syncopated\nchords: gm_epiano2 — bright FM electric piano, major-7th and 9th chords\nmelody: gm_soprano_sax — the theme, like a lyricon or soprano sax\ncounter: gm_synth_brass_1 — brass hits and answers\narp: gm_electric_guitar_clean — cutting rhythm guitar\npad: gm_pad_poly — polysynth pad' },
  { name: 'big band', meters: '4/4, 3/4', keys: 'Bb major, F major, Eb major, C minor', tweaks: 'space 0.3, size 0.6', use: 'swing, big band, jazz orchestra, bebop, hard bop', master: 'warm', instruments: 'drums: YamahaRY30 — swing ride, hi-hat on 2 and 4, kicks under the brass\nbass: gm_acoustic_bass — walking upright bass\nchords: gm_piano — comping piano\nmelody: gm_trumpet — the lead trumpet\ncounter: gm_alto_sax — the sax section answering\npad: gm_trombone — trombone pads and swells\nperc: gm_vibraphone — vibes colour' },
  { name: 'jazz trio', meters: '4/4, 3/4', keys: 'F major, Bb major, D dorian, C minor, Eb major', tweaks: 'space 0.25', use: 'piano trio, cool jazz, ballads, modal jazz, late-night jazz', master: 'warm', instruments: 'drums: YamahaRY30 — brushes feel, soft ride\nbass: gm_acoustic_bass — walking and two-feel bass\nchords: gm_piano — piano voicings\nmelody: gm_piano — the piano plays the head and the solos\ncounter: gm_vibraphone — vibes answering' },
  { name: 'pop studio', meters: '4/4', keys: 'C major, A minor, G major, D major, F major', tweaks: 'loud 2.5, high 3.5', use: 'modern pop, synth-pop, dance-pop, chart pop', master: 'pop', instruments: 'drums: RolandTR808 — punchy pop kit, claps\nbass: gm_synth_bass_2 — round sub bass\nchords: gm_piano — bright piano chords\npad: gm_synth_strings_1 — wide synth strings\nmelody: gm_lead_6_voice — a vocal-like lead for the hook\narp: gm_pizzicato_strings — plucky arpeggios\ncounter: gm_lead_1_square — a synth answer' },
  { name: 'acid box', meters: '4/4', keys: 'A minor, F minor, E phrygian', use: 'acid techno, acid house, rave, warehouse', master: 'techno', instruments: 'drums: RolandTR909 — pounding kick, open hats, claps\nbass: sawtooth — squelchy acid line, filter moving\nperc: RolandTR808 — cowbell and rim accents\n+ pad: gm_pad_sweep — dark filtered pad\n+ fx: white — noise sweeps' },
  { name: 'deep house quartet', meters: '4/4', keys: 'C minor, F minor, D dorian, A minor', tweaks: 'low 3, space 0.15', use: 'deep house, soulful house, lounge, late-night house', master: 'house', instruments: 'drums: RolandTR909 — soft kick, shuffled hats, rim shots\nbass: gm_synth_bass_2 — deep round bass\nchords: gm_epiano1 — soulful Rhodes chords\npad: gm_pad_warm — warm pad\n+ melody: gm_vibraphone — sparse vibes hook' },
  { name: 'chillhop crew', meters: '4/4, 3/4', keys: 'F major, D dorian, A minor, G dorian', tweaks: 'vinyl 0.3, high -2', use: 'chillhop, lo-fi, jazz-hop, study beats, coffee shop', master: 'lo-fi', instruments: 'drums: AkaiMPC60 — lazy swung kit\nbass: gm_electric_bass_finger — warm fingered bass\nchords: gm_piano — soft piano chords\nmelody: gm_muted_trumpet — a laid-back hook\n+ counter: gm_electric_guitar_jazz — jazz guitar licks\n+ fx: gm_fx_atmosphere — tape and room noise' },
  { name: 'boom bap crate', meters: '4/4', keys: 'C minor, F minor, D minor, Bb major', use: 'boom bap, golden-era hip hop, beat tapes, jazz rap', master: 'hiphop', instruments: 'drums: AkaiMPC60 — hard-swung boom bap kit\nbass: gm_acoustic_bass — dusty upright bass\nchords: gm_epiano1 — sampled-sounding keys\nmelody: gm_alto_sax — a short sax loop\n+ counter: gm_vibraphone — vibes chops\n+ perc: RolandTR808 — shakers and rims' },
  { name: 'darkwave rig', meters: '4/4', keys: 'E minor, A minor, D minor, F# minor', tweaks: 'space 0.35, echo 0.2', use: 'darkwave, coldwave, post-punk synth, dark synthwave', master: 'synthwave', instruments: 'drums: LinnDrum — cold, gated kit\nbass: gm_synth_bass_1 — driving eighth-note bass\nchords: gm_pad_choir — icy choir pad\nmelody: gm_lead_2_sawtooth — a melancholy lead\n+ arp: square — cold arpeggio\n+ counter: gm_electric_guitar_clean — chorus-y guitar line' },
  { name: 'jungle crew', meters: '4/4', keys: 'F minor, D minor, G minor, A minor', use: 'jungle, breakbeat, ragga jungle, old-school drum & bass', master: 'dnb', instruments: 'drums: AkaiMPC60 — chopped amen-style breaks\nbass: sine — deep rolling sub\npad: gm_pad_new_age — airy pad\nmelody: gm_lead_6_voice — a vocal-like stab hook\n+ perc: RolandTR808 — timbales and cowbell\n+ fx: white — sirens and risers' },
  { name: 'chip band', meters: '4/4, 3/4', keys: 'C major, A minor, E minor, G major', use: 'chiptune, 8-bit, video game, arcade', master: 'chiptune', instruments: 'perc: white — noise drums\nbass: triangle — chip bass\narp: square — fast chord arpeggios\nmelody: pulse — chip lead\ncounter: square — second channel' },
];

export const BAND_ROLES = ['drums', 'perc', 'bass', 'chords', 'pad', 'arp', 'melody', 'counter', 'fx'];

/**
 * "drums: RolandTR909 — four on the floor" lines → [{ role, sound, desc, optional }]. A line starting with "+" is an
 * optional instrument: the band's songs use it when it suits them (the others are its core).
 */
export function parseInstruments(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(\+\s*)?([a-z]+)\s*:\s*([A-Za-z0-9_]+)\s*(?:[—–-]+\s*(.*))?$/i);
    return m ? { role: m[2].toLowerCase(), sound: m[3], desc: (m[4] || '').trim(), optional: !!m[1] } : null;
  }).filter(Boolean);
}

/** "high 2.5, space 0.3" (a band's own tweaks of its master style) → { high: 2.5, space: 0.3 }. */
export function parseTweaks(text) {
  const out = {};
  for (const m of String(text || '').matchAll(/([a-z]+)\s*[:=]?\s*(-?[\d.]+)/gi)) out[m[1].toLowerCase()] = Number(m[2]);
  return out;
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
  const line = (b) => `- "${b.name}"${b.use ? ` (for ${b.use})` : ''} — master "${normStyle(b.master) || 'clean'}":\n${parseInstruments(b.instruments).map((i) => `    ${i.role}: ${i.sound}${i.desc ? ` — ${i.desc}` : ''}${i.optional ? ' (optional)' : ''}`).join('\n')}`;
  const fixed = choice && choice !== 'auto' ? findIn(bands, choice) : null;
  if (fixed) return `BAND — write the song for this band (set "band": "${fixed.name}" and "master": "${normStyle(fixed.master) || 'clean'}"). Its core instruments are the heart of its sound: use them, each with the role given. Use an (optional) one when it suits this song. To make the song its own you may add 1–2 parts of your own with roles the band doesn't have (a different colour: a counter-melody, a percussion layer, an fx):\n${line(fixed)}`;
  return `BANDS — if one fits this song's genre, write for it: set "band" to its name, take its master style, and give every part one of its instruments (with the role given). If none fits, set "band": "none" and choose the sounds yourself from the sound guide:\n${bands.map(line).join('\n')}`;
}
