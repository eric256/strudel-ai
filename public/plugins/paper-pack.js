// 🧩 Example plugin: a content pack. It adds a theme, a band, a song form and a station, and asks the AI to label
// the parts it writes. Bands, forms and stations join your own lists once (then they're yours to edit or delete);
// the theme and the AI instruction last while the plugin is on. (How plugins work: PLUGINS.md.)
export default {
  id: 'paper-pack',
  name: 'Paper pack',
  version: '1.0.0',
  description: 'A warm “Paper” light theme, a chamber-pop band, a short song form, a station, and an AI instruction to comment each new part.',

  setup(api) {
    api.addTheme('paper', {
      name: 'Paper', editor: 'solarizedLight', scheme: 'light',
      colors: { bg: '#f3eee3', panel: '#fbf8f1', 'panel-2': '#f1ebdd', raised: '#f7f2e7', sunken: '#ebe4d4', canvas: '#f6f1e6', border: '#d9cfbb', line: '#e6decd',
        text: '#2d2a24', muted: '#6d6557', faint: '#aba08b', accent: '#b4532a', 'accent-2': '#3f7d5a', danger: '#c0392b', warn: '#b7791f',
        'on-accent': '#ffffff', 'on-warn': '#ffffff', shadow: 'rgba(60, 45, 20, .15)' },
    });
    api.addBands({
      name: 'Paper Strings', use: 'chamber pop, folk, cinematic, gentle songs',
      master: 'warm',
      instruments: 'drums: YamahaRY30 — soft kit, brushes feel\nbass: gm_acoustic_bass — round, simple roots\nchords: gm_acoustic_guitar_nylon — picked chords\npad: gm_string_ensemble_1 — long string pads\nmelody: gm_flute — lyrical lead\ncounter: gm_clarinet — warm answers',
    });
    api.addForms({ name: 'vignette', use: 'short, intimate pieces', sections: 'intro 4, theme 8, variation 8, outro 4' });
    api.addStations({ name: 'Paper Lanterns', theme: 'gentle chamber pop and modern folk: nylon guitar, strings, flute, soft brushes, 80–100 bpm, warm major and mixolydian keys' });
    api.addPromptHint('code', 'When you add a new part, put a short comment above it saying what it plays.');
  },
};
