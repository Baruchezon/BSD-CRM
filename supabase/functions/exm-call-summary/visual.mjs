// Visual order for pdf-lib, which draws left to right and does not shape Hebrew.
// A Hebrew run is reversed, and the runs of an RTL line are reversed.
// Digits and Latin stay in their own order.

export function visualLine(input) {
  const text = String(input ?? '').replace(/[\u200e\u200f]/g, '');
  const tokens = text.match(/[\u0590-\u05FF]+|\s+|[^\u0590-\u05FF\s]+/g) || [];
  if (!tokens.some(t => /[\u0590-\u05FF]/.test(t))) return text;
  return tokens.reverse().map(t => /[\u0590-\u05FF]/.test(t) ? [...t].reverse().join('') : t).join('');
}

// word-wrap in logical order, then each line is drawn with visualLine.
export function wrapLogical(text, maxWidth, widthOf) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? cur + ' ' + word : word;
    if (cur && widthOf(visualLine(next)) > maxWidth) {
      lines.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
