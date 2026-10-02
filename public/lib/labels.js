// Labelled pattern lines ("bass: …", "_bass:" muted, "Sbass:" solo) in Strudel code.

export const LABEL_LINE = /^([A-Za-z_$][\w$]*):(?!:)/;

export function parseLabel(label) {
  const muted = label.startsWith('_') || (label.endsWith('_') && label.length > 1);
  let base = label.replace(/^_+|_+$/g, '');
  const solo = !muted && base.length > 1 && base.startsWith('S');
  if (solo) base = base.slice(1);
  return { muted, solo, base: base || '$' };
}

export const makeLabel = ({ base, muted, solo }) => (muted ? '_' + base : solo ? 'S' + base : base);

/** Lines that hold a pattern label: [{ line (0-based), label, muted, solo, base }] */
export function patternLines(code) {
  return code.split('\n').flatMap((text, line) => {
    const m = text.match(LABEL_LINE);
    return m ? [{ line, label: m[1], ...parseLabel(m[1]) }] : [];
  });
}
