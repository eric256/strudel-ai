// Small helpers with no DOM and no app state.

export const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const stripThinking = (t) => t.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim();

/** First JSON object in a reply, tolerating fences, comments and trailing commas. */
export function parseJSONLoose(text) {
  const t = stripThinking(text).replace(/```[a-z]*\n?|```/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON object in the reply');
  const body = t.slice(a, b + 1).replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(body); } catch (e) { throw new Error('invalid JSON: ' + e.message); }
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export const normName = (s) => s.toLowerCase().replace(/(^|\D)0+(\d)/g, '$1$2').replace(/[_\s-]/g, '');

export function closest(name, candidates) {
  const n = normName(name);
  const exact = candidates.find((c) => normName(c) === n);
  if (exact) return { best: exact, dist: 0, top: [exact] };
  const scored = candidates
    .map((c) => ({ c, d: levenshtein(name.toLowerCase(), c) }))
    .sort((x, y) => x.d - y.d);
  return { best: scored[0]?.c, dist: scored[0]?.d ?? 99, top: scored.slice(0, 4).map((x) => x.c) };
}

export const ident = (x) => {
  const t = String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(t) ? t : 'p_' + (t || 'part');
};

export const signed = (n) => (n > 0 ? `+${n}` : String(n));

export const oneLine = (code) => code.replace(/\s*\n\s*/g, ' ').trim();

/** Fader moves: compare code with the slider values blanked out. */
export const sliderless = (c) => (c || '').replace(/slider\(\s*[\d.]+/g, 'slider(');
