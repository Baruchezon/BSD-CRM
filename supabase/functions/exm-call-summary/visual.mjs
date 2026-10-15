// Proper bidi (UAX #9 via bidi-js) for an RTL paragraph, plus run splitting.
// pdf-lib + fontkit lays out Hebrew-script runs right-to-left by itself, so a
// Hebrew run is handed over in logical order; everything else goes in visual order.
import bidiFactory from 'npm:bidi-js@1.0.3';
const bidi = bidiFactory();
const HEB = /[\u0590-\u05FF\uFB1D-\uFB4F\u20AA]/;

export function visualChars(input) {
  const text = String(input ?? '').replace(/[\u200e\u200f]/g, '');
  if (!text) return [];
  const levels = bidi.getEmbeddingLevels(text, 'rtl');
  const chars = [...text];
  // bidi-js works on UTF-16 indices; Hebrew/Latin here are all BMP.
  // bidi-js getMirroredCharactersMap returns nothing here, so mirror RTL-level chars directly.
  chars.forEach((ch, i) => {
    if (levels.levels[i] & 1) { const m = bidi.getMirroredCharacter(ch); if (m) chars[i] = m; }
  });
  const order = chars.map((_, i) => i);
  for (const [start, end] of bidi.getReorderSegments(text, levels)) {
    const seg = order.slice(start, end + 1).reverse();
    order.splice(start, seg.length, ...seg);
  }
  return order.map(i => chars[i]);
}

// Returns runs left-to-right on the page: { text, hebrew }.
export function visualRuns(input) {
  const vis = visualChars(input);
  const runs = [];
  for (const ch of vis) {
    const h = HEB.test(ch) || (ch === ' ' && runs.length && runs[runs.length - 1].hebrew);
    const last = runs[runs.length - 1];
    if (last && last.hebrew === h) last.chars.push(ch); else runs.push({ hebrew: h, chars: [ch] });
  }
  return runs.map(r => ({ hebrew: r.hebrew, text: (r.hebrew ? [...r.chars].reverse() : r.chars).join('') }));
}

export function wrapLogical(text, maxWidth, widthOf) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? cur + ' ' + word : word;
    if (cur && widthOf(next) > maxWidth) { lines.push(cur); cur = word; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}
