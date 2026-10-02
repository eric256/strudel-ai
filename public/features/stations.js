// Feature module split out of app.js (see the section comments below).
import { addNewDefaults } from './forms.js';
import { startStation, stopStation } from './song-writer.js';
import { updateSetButtons } from './song-lists.js';
import { $, load, save, saved } from '../app.js';
import { renderOptions } from '../html.js';
let stations, stationIdx;
// --- saved stations
const DEFAULT_STATIONS = [
  { name: 'Late Night Lo-fi', theme: 'late-night lo-fi hip hop with jazzy Rhodes chords, dusty drums and soft bass, 70–90 bpm, rainy city mood' },
  { name: 'Neon Highway', theme: 'synthwave and outrun: driving basslines, gated pads, arpeggios, 95–118 bpm, minor keys, nostalgic 80s night drive' },
  { name: 'Deep Focus', theme: 'minimal ambient techno for concentration: steady soft kick, evolving pads, subtle percussion, 110–122 bpm, no harsh sounds' },
  { name: 'Sunrise House', theme: 'warm deep house at sunrise: soulful chords, rolling basslines, shuffled hats, 118–124 bpm, uplifting major and dorian keys' },
  { name: 'Warehouse Techno', theme: 'dark driving techno: pounding kick, rumbling sub, hypnotic synth loops, acid lines, 128–136 bpm, minor keys, little melody' },
  { name: 'Liquid Drum & Bass', theme: 'liquid drum & bass: fast breakbeats, deep reese and sub bass, lush pads and soft keys, 170–174 bpm, emotional minor-key chords' },
  { name: 'Ambient Drift', theme: 'slow ambient soundscapes: long evolving pads, soft bells and drones, gentle textures, almost no drums, 60–80 bpm' },
  { name: 'Boom Bap Café', theme: 'jazzy boom bap instrumentals: swung drums, upright-style bass, vibraphone and piano samples feel, 84–94 bpm' },
  { name: 'Trance Horizons', theme: 'uplifting trance: rolling offbeat bass, supersaw leads, big breakdowns and builds, 136–140 bpm, euphoric minor keys' },
  { name: 'Arcade Chiptune', theme: 'retro video-game chiptune: square and triangle leads, fast arpeggios, punchy 8-bit drums, 120–150 bpm, catchy hooks' },
  { name: 'Space Disco', theme: 'cosmic nu-disco: four-on-the-floor, octave basslines, funky guitars and strings, sparkling synths, 110–122 bpm' },
  { name: 'Dub Station', theme: 'deep dub and dub techno: skanking chords with long echoes, heavy sub bass, one-drop and steppers rhythms, 70–85 bpm (or 120 dub techno)' },
];
export const currentStation = () => ({ name: stations[stationIdx]?.name || '', theme: stations[stationIdx]?.theme || '' });
export function renderStations() {
  const opts = stations.map((st, i) => ({ value: i, label: st.name || 'untitled' }));
  for (const id of ['stationSelect', 'stationEditSelect']) renderOptions($(id), opts, stationIdx);
  $('stationName').value = stations[stationIdx]?.name || '';
  $('stationTheme').value = stations[stationIdx]?.theme || '';
  $('stationThemeView').textContent = stations[stationIdx]?.theme || 'No theme yet — ✎ edit stations to write one.';
}
function saveStations() { save({ stations, stationIdx }); }

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  stations = addNewDefaults(load().stations, DEFAULT_STATIONS, 'stations', ['Late Night Lo-fi', 'Neon Highway', 'Deep Focus']);
  save({ stations });
  stationIdx = Math.min(load().stationIdx ?? 0, stations.length - 1);
  renderStations();
  for (const id of ['stationSelect', 'stationEditSelect']) $(id).onchange = () => { stationIdx = Number($(id).value); saveStations(); renderStations(); updateSetButtons(); };
  for (const id of ['stationName', 'stationTheme']) {
    $(id).oninput = () => {
      stations[stationIdx] = { name: $('stationName').value.trim(), theme: $('stationTheme').value.trim() };
      saveStations();
      const name = $('stationName').value || 'untitled';
      const opts = stations.map((st, i) => ({ value: i, label: (i === stationIdx ? name : st.name) || 'untitled' }));
      for (const sel of ['stationSelect', 'stationEditSelect']) renderOptions($(sel), opts, stationIdx);
      $('stationThemeView').textContent = $('stationTheme').value || 'No theme yet — ✎ edit stations to write one.';
    };
  }
  $('stationNew').onclick = () => { stations.push({ name: 'New station', theme: '' }); stationIdx = stations.length - 1; saveStations(); renderStations(); $('stationTheme').focus({ preventScroll: true }); };
  $('stationDelete').onclick = () => {
    if (!confirm(`Delete station “${stations[stationIdx]?.name}”?`)) return;
    stations.splice(stationIdx, 1);
    if (!stations.length) stations = [{ name: 'New station', theme: '' }];
    stationIdx = Math.max(0, stationIdx - 1);
    saveStations(); renderStations();
  };
  if (saved.stationAhead) $('stationAhead').value = saved.stationAhead;
  $('stationAhead').onchange = () => save({ stationAhead: $('stationAhead').value });
  $('stationStart').onclick = () => startStation(currentStation());
  $('stationStop').onclick = () => stopStation();
}
