// Feature module split out of app.js (see the section comments below).
import { DEFAULT_FORMS, OLD_DEFAULT_FORMS, OLD_FORM_SECTIONS, findIn, formBars, formsForRequest as formsRequest, parseFormSections } from '../lib/forms.js';
import { openSettings } from './settings.js';
import { $, load, save } from '../app.js';
import { render, renderOptions } from '../html.js';
import { T } from '../templates/index.js';
export let songForms;
// ---------------------------------------------------------------------------
// Song forms: the order and length of a song's sections. Users can edit and add
// forms (saved in the browser); the song-sheet request lists them for the AI, and
// the chosen form's bar counts are enforced on the sheet that comes back.
// ---------------------------------------------------------------------------
/** Add built-in items the user hasn't seen yet (deleted built-ins stay deleted). */
export function addNewDefaults(list, defaults, kind, oldNames) {
  const st = load();
  save({ defaultsSeen: { ...(st.defaultsSeen || {}), [kind]: defaults.map((d) => d.name) } });
  if (!list) return defaults.map((d) => ({ ...d }));
  const seen = new Set(st.defaultsSeen?.[kind] || oldNames);
  const out = [...list];
  for (const d of defaults) if (!seen.has(d.name) && !out.some((x) => x.name === d.name)) out.push({ ...d });
  return out;
}
let formIdx = 0;

const findForm = (name) => findIn(songForms, name);
export const formsForRequest = (choice) => formsRequest(songForms, choice);

/** The form for a song: the 📻 Station's for its songs, the 🎵 Songs one for the others. */
export const formChoice = (song) => $(song?.from === 'station' ? 'stationForm' : 'setForm')?.value || 'auto';

function renderFormSelects() {
  for (const id of ['setForm', 'stationForm']) {
    const el = $(id);
    const keep = el.value || load()[id] || 'auto';
    renderOptions(el, [{ value: 'auto', label: 'auto (fits the genre)' }, ...songForms.map((f) => ({ value: f.name, label: `${f.name} · ${formBars(f)} bars` }))],
      keep === 'auto' || findForm(keep) ? keep : 'auto');
  }
}
function saveForms() { save({ songForms }); renderFormSelects(); }
/** Add a 🧩 plugin's song forms to yours, once (forms you delete stay deleted). */
export function mergeForms(items, key) {
  songForms = addNewDefaults(songForms, items.map((f) => ({ name: String(f.name), use: String(f.use || ''), sections: String(f.sections || '') })), key, []);
  saveForms();
}
export function renderFormsEditor() {
  formIdx = Math.max(0, Math.min(formIdx, songForms.length - 1));
  renderOptions($('formSelect'), songForms.map((f, i) => ({ value: i, label: f.name || 'untitled' })), formIdx);
  const f = songForms[formIdx] || { name: '', use: '', sections: '' };
  $('formName').value = f.name;
  $('formUse').value = f.use;
  $('formSections').value = f.sections;
  $('formMeters').value = f.meters || '';
  $('formKeys').value = f.keys || '';
  renderFormPreview();
}
function renderFormPreview() {
  const secs = parseFormSections($('formSections').value);
  render(T.formPreview({ sections: secs.map((x) => ({ name: x.name, bars: x.bars })), bars: formBars({ sections: $('formSections').value }) }), $('formPreview'));
}

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  songForms = addNewDefaults(load().songForms, DEFAULT_FORMS, 'forms', OLD_DEFAULT_FORMS);
  for (const f of songForms) {
    const d = DEFAULT_FORMS.find((x) => x.name === f.name);
    if (d && OLD_FORM_SECTIONS[f.name] === f.sections) f.sections = d.sections;
  }
  // forms saved before they had meters and keys: take the built-in one's
  for (const f of songForms) {
    const d = DEFAULT_FORMS.find((x) => x.name === f.name);
    if (d && f.meters === undefined) Object.assign(f, { meters: d.meters, keys: d.keys });
  }
  save({ songForms });
  for (const id of ['formName', 'formUse', 'formSections', 'formMeters', 'formKeys']) {
    $(id).oninput = () => {
      const f = songForms[formIdx];
      if (!f) return;
      f.name = $('formName').value.trim();
      f.use = $('formUse').value.trim();
      f.sections = $('formSections').value;
      f.meters = $('formMeters').value.trim();
      f.keys = $('formKeys').value.trim();
      if (id === 'formName') renderOptions($('formSelect'), songForms.map((x, i) => ({ value: i, label: x.name || 'untitled' })), formIdx);
      if (id === 'formSections') renderFormPreview();
      saveForms();
    };
  }
  $('formSelect').onchange = () => { formIdx = Number($('formSelect').value); renderFormsEditor(); };
  $('formNew').onclick = () => {
    songForms.push({ name: 'my form', use: '', sections: 'intro 4, A 8, B 8, A 8, outro 4' });
    formIdx = songForms.length - 1;
    saveForms(); renderFormsEditor(); $('formName').select();
  };
  $('formDelete').onclick = () => {
    if (!songForms[formIdx] || !confirm(`Delete the form “${songForms[formIdx].name}”?`)) return;
    songForms.splice(formIdx, 1);
    if (!songForms.length) songForms = DEFAULT_FORMS.map((f) => ({ ...f }));
    saveForms(); renderFormsEditor();
  };
  $('formReset').onclick = () => {
    for (const d of DEFAULT_FORMS) {
      const f = findForm(d.name);
      if (f) Object.assign(f, d); else songForms.push({ ...d });
    }
    saveForms(); renderFormsEditor();
  };
  for (const b of document.querySelectorAll('.forms-edit')) b.onclick = () => openSettings('setForms');
  for (const id of ['setForm', 'stationForm']) $(id).onchange = () => save({ [id]: $(id).value });
  renderFormSelects();
}
