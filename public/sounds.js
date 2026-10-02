// ---------------------------------------------------------------------------
// Sound guide: what the commonly useful sounds are good for, so the AI picks sounds that fit a song (and each
// other) instead of guessing from names. Format: name → "role · character · genres". Only sounds that exist in the
// loaded registry are given to the AI (see soundGuide), so a wrong name here is harmless.
// Drum machines are keyed by their bank name in lower case.
// ---------------------------------------------------------------------------

export const SOUND_GUIDE = {
  // synths (oscillators — shape them with lpf, attack/decay/sustain/release, detune)
  sine: 'sub bass, soft lead, bells · pure, round · any',
  triangle: 'soft lead, pluck, flute-like · mellow, hollow · lo-fi, chiptune, ambient',
  square: 'lead, bass, chip arps · hollow, buzzy · chiptune, synthwave, techno',
  sawtooth: 'bass, lead, pads, stabs · bright, rich · synthwave, techno, house, trance',
  supersaw: 'big pads, anthem leads, chords · wide, lush, detuned · trance, EDM, synthwave',
  pulse: 'lead, bass · nasal, thin · chiptune, synth-pop',
  white: 'risers, hats, wind, noise sweeps · hissy · EDM, ambient, techno',
  pink: 'risers, rain, texture · softer noise · ambient, lo-fi',
  brown: 'rumble, ocean, wind · dark noise · ambient, drone',

  // keys & piano
  gm_piano: 'chords, melody · acoustic grand · ballad, jazz, pop, cinematic',
  gm_epiano1: 'chords, comping · warm Rhodes · lo-fi, neo-soul, jazz, chillhop',
  gm_epiano2: 'chords · glassy FM electric piano · city pop, 80s, R&B',
  gm_clavinet: 'funky rhythm chords · percussive, bright · funk, disco',
  gm_harpsichord: 'arpeggios · plucked, baroque · cinematic, chamber',
  gm_drawbar_organ: 'chords, pads · warm Hammond · gospel, soul, rock, dub',
  gm_rock_organ: 'chords · gritty organ · rock, blues',
  gm_church_organ: 'pads, chords · huge, sacred · cinematic, ambient',
  gm_percussive_organ: 'stabs · clicky organ · house, garage, reggae',
  gm_vibraphone: 'melody, chords · soft mallets · jazz, lo-fi, bossa nova',
  gm_marimba: 'melody, arps · woody mallets · tropical, world, ambient',
  gm_xylophone: 'melody · bright wooden · playful, cinematic',
  gm_kalimba: 'melody, arps · thumb piano, gentle · ambient, lo-fi, world',
  gm_music_box: 'melody · delicate, nostalgic · lullaby, ambient, lo-fi',
  gm_celesta: 'melody · sparkly bells · cinematic, holiday, ambient',
  gm_glockenspiel: 'melody accents · bright bells · pop, cinematic',
  gm_tubular_bells: 'accents · church bells · cinematic, ambient',
  gm_steel_drums: 'melody · Caribbean steel pan · tropical house, world',

  // bass
  gm_acoustic_bass: 'bass · upright, woody · jazz, lo-fi, bossa nova',
  gm_electric_bass_finger: 'bass · round electric · funk, pop, soul, rock',
  gm_electric_bass_pick: 'bass · punchy picked · rock, punk',
  gm_fretless_bass: 'bass · smooth, singing · jazz fusion, ambient, R&B',
  gm_slap_bass_1: 'bass · slap, percussive · funk, disco',
  gm_synth_bass_1: 'bass · classic analog synth bass · synthwave, house, 80s',
  gm_synth_bass_2: 'bass · rubbery synth bass · electro, funk, techno',
  gm_lead_8_bass_lead: 'bass or lead · aggressive saw bass · EDM, DnB',
  gm_contrabass: 'bass · bowed orchestral · cinematic',

  // guitars
  gm_acoustic_guitar_nylon: 'chords, melody · nylon, gentle · bossa nova, folk, lo-fi',
  gm_acoustic_guitar_steel: 'strummed chords · bright steel · folk, pop, country',
  gm_electric_guitar_clean: 'chords, licks · clean electric · indie, city pop, funk',
  gm_electric_guitar_jazz: 'chords, licks · warm hollow-body · jazz, neo-soul',
  gm_electric_guitar_muted: 'rhythmic riffs · palm-muted, plucky · funk, disco, house',
  gm_overdriven_guitar: 'riffs, chords · crunchy · rock, blues',
  gm_distortion_guitar: 'power chords · heavy · rock, metal, punk',
  gm_banjo: 'picked rhythm · twangy · bluegrass, folk',
  gm_sitar: 'melody · droning, Indian · world, psychedelic',
  gm_koto: 'melody · plucked Japanese zither · world, ambient',

  // strings, brass, winds
  gm_string_ensemble_1: 'pads, chords · lush orchestral strings · cinematic, ballad, disco',
  gm_string_ensemble_2: 'pads · slow, soft strings · ambient, cinematic',
  gm_synth_strings_1: 'pads · 80s string machine · synthwave, disco, 80s pop',
  gm_tremolo_strings: 'tension pads · tremolo · cinematic, thriller',
  gm_pizzicato_strings: 'plucked ostinato · light · cinematic, playful',
  gm_violin: 'melody · expressive · ballad, folk, cinematic',
  gm_cello: 'melody, bass line · warm, deep · ballad, cinematic',
  gm_orchestral_harp: 'arps, glissandi · harp · cinematic, ambient, ballad',
  gm_brass_section: 'stabs, chords · bold brass · funk, soul, cinematic',
  gm_synth_brass_1: 'stabs, chords · 80s synth brass · synthwave, 80s pop',
  gm_trumpet: 'melody · bright brass · jazz, Latin, ska',
  gm_muted_trumpet: 'melody · soft, smoky · jazz, lo-fi, noir',
  gm_french_horn: 'melody, swells · noble · cinematic, epic',
  gm_trombone: 'melody, stabs · brassy · ska, jazz, funk',
  gm_tenor_sax: 'melody, solos · smoky · jazz, soul, 80s ballads',
  gm_alto_sax: 'melody · bright sax · jazz, funk, city pop',
  gm_flute: 'melody · airy · jazz, world, lo-fi, cinematic',
  gm_pan_flute: 'melody · breathy, ethnic · world, ambient, new age',
  gm_shakuhachi: 'melody · breathy bamboo flute · ambient, zen, world',
  gm_clarinet: 'melody · woody · jazz, chamber, cinematic',
  gm_oboe: 'melody · reedy, plaintive · cinematic, chamber',
  gm_harmonica: 'licks · bluesy · blues, folk, country',
  gm_accordion: 'chords, melody · reedy · folk, tango, French',

  // leads
  gm_lead_1_square: 'lead · square synth · chiptune, synthwave',
  gm_lead_2_sawtooth: 'lead · bright saw synth · synthwave, trance, electro',
  gm_lead_3_calliope: 'lead · breathy, flute-like synth · synth-pop, lo-fi',
  gm_lead_4_chiff: 'lead · chiffy, airy synth · new age, ambient',
  gm_lead_5_charang: 'lead · distorted guitar-like synth · rock, electro',
  gm_lead_6_voice: 'lead, pad · vocal synth · ambient, synth-pop',
  gm_lead_7_fifths: 'lead · power fifths · EDM, 80s',

  // pads & choirs
  gm_pad_warm: 'pads · warm, soft · ambient, lo-fi, ballad',
  gm_pad_poly: 'pads, chords · polysynth · synthwave, 80s, house',
  gm_pad_new_age: 'pads · shimmering · ambient, new age',
  gm_pad_halo: 'pads · airy, angelic · ambient, cinematic',
  gm_pad_sweep: 'pads · filter-swept · trance, ambient, synthwave',
  gm_pad_choir: 'pads · synthetic choir · ambient, cinematic',
  gm_pad_bowed: 'pads · bowed glass · ambient, drone',
  gm_pad_metallic: 'pads · metallic shimmer · ambient, sci-fi',
  gm_choir_aahs: 'pads, swells · human choir · cinematic, gospel, ambient',
  gm_voice_oohs: 'pads · soft voices · R&B, ambient, lo-fi',
  gm_synth_choir: 'pads · 80s vocal pad · synthwave, synth-pop',

  // fx & textures
  gm_fx_rain: 'texture · rain-like shimmer · ambient, lo-fi',
  gm_fx_atmosphere: 'texture, pads · evolving · ambient, cinematic',
  gm_fx_crystal: 'accents · glassy bells · ambient, new age',
  gm_fx_echoes: 'texture · echoing · ambient, dub',
  gm_fx_sci_fi: 'fx · sci-fi bleeps · sci-fi, electro',
  gm_fx_soundtrack: 'pads · cinematic swell · cinematic, ambient',
  gm_seashore: 'texture · waves · ambient, chill',
  gm_bird_tweet: 'texture · birds · ambient, nature',
  gm_reverse_cymbal: 'risers into a downbeat · swoosh · EDM, pop',
  gm_orchestra_hit: 'stabs · 80s orchestra hit · hip hop, 80s, house',
  gm_timpani: 'drums, builds · orchestral · cinematic, epic',
  gm_taiko_drum: 'drums · huge, tribal · cinematic, epic',

  // drum machines (bank names, lower case)
  rolandtr808: 'drums · deep boomy kick, snappy snare, crisp hats · hip hop, trap, R&B, electro, synthwave',
  rolandtr909: 'drums · punchy kick, bright hats, claps · house, techno, trance',
  rolandtr707: 'drums · clean 80s · Italo, synth-pop, freestyle',
  rolandtr606: 'drums · thin, ticky · acid, minimal, electro',
  rolandcr78: 'drums · vintage preset rhythm · lo-fi, post-punk, ambient',
  rolandtr626: 'drums · late-80s digital · house, freestyle',
  linndrum: 'drums · classic 80s pop kit · 80s pop, synthwave, funk',
  linnlm1: 'drums · early 80s funk kit · funk, synth-pop',
  akaimpc60: 'drums · gritty sampled breaks · boom bap, lo-fi hip hop',
  akailinn: 'drums · punchy MPC/Linn · hip hop, R&B',
  emusp12: 'drums · crunchy 12-bit · boom bap, lo-fi',
  oberheimdmx: 'drums · fat 80s · electro, hip hop, 80s pop',
  korgminipops: 'drums · lo-fi vintage preset · lo-fi, psych, indie',
  bossdr110: 'drums · small, dry · lo-fi, indie, minimal',
  yamahary30: 'drums · clean 90s · pop, R&B',
  alesishr16: 'drums · 90s rock/pop kit · rock, pop',
  casiorz1: 'drums · grainy 12-bit · lo-fi, house',
  sequentialcircuitstom: 'drums · 80s analog · electro, synth-pop',
  rolandcompurhythm1000: 'drums · vintage · lo-fi, ambient',
  viscospacedrum: 'drums · spacey analog · electro, experimental',
};

/**
 * The guide lines for the sounds that exist: registry keys (lower case) and drum-machine banks.
 * @param {Set<string>} available  sound names and bank names, lower case
 */
export function soundGuide(available) {
  const lines = [];
  for (const [name, desc] of Object.entries(SOUND_GUIDE)) {
    if (available.has(name.toLowerCase())) lines.push(`${name}: ${desc}`);
  }
  return lines;
}
