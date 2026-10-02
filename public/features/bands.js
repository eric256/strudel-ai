// Feature module split out of app.js (see the section comments below).
import { addNewDefaults, songForms } from './forms.js';
import { BAND_ROLES, DEFAULT_BANDS, bandsForRequest as bandsRequest, parseInstruments } from '../lib/bands.js';
import { findIn } from '../lib/forms.js';
import { normalizeSheet as normalizeSheetWith } from '../lib/sheet.js';
import { MASTER_STYLES, STYLE_NAMES, normStyle } from '../master.js';
import { soundRegistry } from './sound-check.js';
import { openSettings } from './settings.js';
import { $, load, save } from '../app.js';
import { html, render, renderOptions } from '../html.js';
export let bands;

let bandIdx = 0;
const findBand = (name) => findIn(bands, name);
export const bandsForRequest = (choice) => bandsRequest(bands, choice);
/** Check and repair a song sheet against the user's forms and bands (lib/sheet.js). */
export const normalizeSheet = (raw, choice = 'auto', opts = {}) => normalizeSheetWith(raw, choice, { ...opts, forms: songForms, bands });
/** A song's master style: its own, else its band's, else one that fits its form, else clean. */
export const songStyle = (sg) => normStyle(sg?.sheet?.master) || normStyle(findBand(sg?.sheet?.band)?.master) || normStyle(sg?.sheet?.form) || 'clean';
/** The band for a song: the 📻 Station's for its songs, the 🎵 Songs one for the others. */
export const bandChoice = (song) => $(song?.from === 'station' ? 'stationBand' : 'setBand')?.value || 'auto';
function renderBandSelects() {
  for (const id of ['setBand', 'stationBand']) {
    const el = $(id);
    const keep = el.value || load()[id] || 'auto';
    renderOptions(el, [{ value: 'auto', label: 'auto (fits the genre)' }, ...bands.map((b) => ({ value: b.name, label: `${b.name} · ${normStyle(b.master) || 'clean'}` }))],
      keep === 'auto' || findBand(keep) ? keep : 'auto');
  }
}
function saveBands() { save({ bands }); renderBandSelects(); }
/** Add a 🧩 plugin's bands to yours, once (bands you delete stay deleted). key: what remembers which were added. */
export function mergeBands(items, key) {
  bands = addNewDefaults(bands, items.map((b) => ({ name: String(b.name), use: String(b.use || ''), master: normStyle(b.master) || 'clean', instruments: String(b.instruments || '') })), key, []);
  saveBands();
}
export function renderBandsEditor() {
  bandIdx = Math.max(0, Math.min(bandIdx, bands.length - 1));
  renderOptions($('bandSelect'), bands.map((b, i) => ({ value: i, label: b.name || 'untitled' })), bandIdx);
  renderOptions($('bandMaster'), STYLE_NAMES.map((n) => ({ value: n, label: `${n} — ${MASTER_STYLES[n].desc}` })), null);
  const b = bands[bandIdx] || { name: '', use: '', master: 'clean', instruments: '' };
  $('bandName').value = b.name;
  $('bandUse').value = b.use;
  $('bandMaster').value = normStyle(b.master) || 'clean';
  $('bandInstruments').value = b.instruments;
  renderBandPreview();
}
async function renderBandPreview() {
  const inst = parseInstruments($('bandInstruments').value);
  const reg = await soundRegistry().catch(() => null);
  const known = (snd) => !reg || reg[snd.toLowerCase()] || Object.keys(reg).some((k) => k.startsWith(snd.toLowerCase() + '_'));
  render(inst.length
    ? html`${inst.map((i) => html`<span class="chip${BAND_ROLES.includes(i.role) && known(i.sound) ? '' : ' bad'}" title="${i.desc}${known(i.sound) ? '' : ' — this sound is not loaded'}${BAND_ROLES.includes(i.role) ? '' : ' — unknown role'}"><b>${i.role}</b> ${i.sound}</span>`)}
      <div class="muted small">${inst.length} instruments · master ${$('bandMaster').value}</div>`
    : html`<span class="muted small">no instruments yet</span>`, $('bandPreview'));
}

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  // ---------------------------------------------------------------------------
  // Bands: a line-up of instruments (role, sound, what it plays) and a master style. A song is written for a band:
  // the song-sheet request gives the AI the band's instruments, and the sheet that comes back is held to them (each
  // part takes the band's sound for its role). Auto: the AI picks the band that fits the genre. Editable in ⚙ Settings.
  // ---------------------------------------------------------------------------
  bands = addNewDefaults(load().bands, DEFAULT_BANDS, 'bands', []);
  save({ bands });
  for (const id of ['bandName', 'bandUse', 'bandInstruments', 'bandMaster']) {
    $(id)[id === 'bandMaster' ? 'onchange' : 'oninput'] = () => {
      const b = bands[bandIdx];
      if (!b) return;
      b.name = $('bandName').value.trim();
      b.use = $('bandUse').value.trim();
      b.master = $('bandMaster').value;
      b.instruments = $('bandInstruments').value;
      if (id === 'bandName') renderOptions($('bandSelect'), bands.map((x, i) => ({ value: i, label: x.name || 'untitled' })), bandIdx);
      if (id === 'bandInstruments' || id === 'bandMaster') renderBandPreview();
      saveBands();
    };
  }
  $('bandSelect').onchange = () => { bandIdx = Number($('bandSelect').value); renderBandsEditor(); };
  $('bandNew').onclick = () => {
    bands.push({ name: 'my band', use: '', master: 'clean', instruments: 'drums: RolandTR909 — the beat\nbass: gm_synth_bass_1 — the low end\nchords: gm_epiano1 — the harmony\nmelody: gm_lead_2_sawtooth — the hook' });
    bandIdx = bands.length - 1;
    saveBands(); renderBandsEditor(); $('bandName').select();
  };
  $('bandDelete').onclick = () => {
    if (!bands[bandIdx] || !confirm(`Delete the band “${bands[bandIdx].name}”?`)) return;
    bands.splice(bandIdx, 1);
    if (!bands.length) bands = DEFAULT_BANDS.map((b) => ({ ...b }));
    saveBands(); renderBandsEditor();
  };
  $('bandReset').onclick = () => {
    for (const d of DEFAULT_BANDS) {
      const b = findBand(d.name);
      if (b) Object.assign(b, d); else bands.push({ ...d });
    }
    saveBands(); renderBandsEditor();
  };
  for (const b of document.querySelectorAll('.bands-edit')) b.onclick = () => openSettings('setBands');
  for (const id of ['setBand', 'stationBand']) $(id).onchange = () => save({ [id]: $(id).value });
  renderBandSelects();
}
