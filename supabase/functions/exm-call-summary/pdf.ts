// RTL summary PDF. pdf-lib + Noto Sans Hebrew (Hebrew + Latin/digits subsets), BSD colours.
import { PDFDocument, rgb } from 'npm:pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import { visualRuns, wrapLogical } from './visual.mjs';

const BASE = 'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-hebrew@5.2.8/';
const FONTS: Record<string, number> = {
  'hebrew-400-normal.ttf': 17220, 'hebrew-700-normal.ttf': 17216,
  'latin-400-normal.ttf': 21544, 'latin-700-normal.ttf': 21452,
};
async function fontBytes(name: string): Promise<Uint8Array> {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error('font ' + name + ' ' + res.status);
  const b = new Uint8Array(await res.arrayBuffer());
  if (b.byteLength !== FONTS[name]) throw new Error('font_size ' + name + ' ' + b.byteLength);
  return b;
}

const NAVY = rgb(0x0B / 255, 0x1B / 255, 0x3A / 255);
const AMBER = rgb(0xF2 / 255, 0x6B / 255, 0x1D / 255);
const CREAM = rgb(0xFA / 255, 0xF7 / 255, 0xF2 / 255);
const WHITE = rgb(1, 1, 1);

export async function buildSummaryPdf(title: string, points: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [h4, h7, l4, l7] = await Promise.all(['hebrew-400', 'hebrew-700', 'latin-400', 'latin-700']
    .map(async n => doc.embedFont(await fontBytes(n + '-normal.ttf'), { subset: true })));
  doc.setTitle(title);
  doc.setAuthor('BSD Business Brokers Israel');
  doc.setLanguage('he-IL');
  const W = 595.28, H = 841.89, M = 50;
  const BULLET_GAP = 16;
  const maxWidth = W - M * 2 - BULLET_GAP;

  // deno-lint-ignore no-explicit-any
  const runsWithFont = (s: string, bold: boolean) => visualRuns(s).map((r: any) => ({
    text: r.text, font: r.hebrew ? (bold ? h7 : h4) : (bold ? l7 : l4),
  }));
  // deno-lint-ignore no-explicit-any
  const widthOf = (s: string, size: number, bold = false) => runsWithFont(s, bold).reduce((t: number, r: any) => t + r.font.widthOfTextAtSize(r.text, size), 0);

  let page = doc.addPage([W, H]);
  const paint = () => {
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: CREAM });
    page.drawRectangle({ x: 0, y: H - 86, width: W, height: 86, color: NAVY });
    page.drawRectangle({ x: 0, y: H - 92, width: W, height: 6, color: AMBER });
    page.drawRectangle({ x: 0, y: 0, width: W, height: 4, color: AMBER });
  };
  // draw text whose right edge is at xRight
  const draw = (s: string, size: number, xRight: number, y: number, color: ReturnType<typeof rgb>, bold = false) => {
    let x = xRight - widthOf(s, size, bold);
    for (const r of runsWithFont(s, bold)) {
      page.drawText(r.text, { x, y, size, font: r.font, color });
      x += r.font.widthOfTextAtSize(r.text, size);
    }
  };
  paint();
  draw(title, 18, W - M, H - 44, WHITE, true);
  draw('BSD Business Brokers Israel', 10, W - M, H - 68, AMBER, true);

  let y = H - 132;
  draw('עיקרי השיחה', 14, W - M, y, NAVY, true);
  page.drawRectangle({ x: W - M - widthOf('עיקרי השיחה', 14, true), y: y - 7, width: widthOf('עיקרי השיחה', 14, true), height: 1.5, color: AMBER });
  y -= 32;
  const body = points.length ? points : ['לא נמצאו עיקרי דברים בתמלול.'];
  for (const point of body) {
    const lines = wrapLogical(point, maxWidth, (s: string) => widthOf(s, 12));
    for (let i = 0; i < lines.length; i++) {
      if (y < 60) { page = doc.addPage([W, H]); paint(); y = H - 132; }
      if (i === 0) page.drawCircle({ x: W - M - 4, y: y + 4, size: 2.8, color: AMBER });
      draw(lines[i], 12, W - M - BULLET_GAP, y, NAVY);
      y -= 19;
    }
    y -= 9;
  }
  return doc.save();
}
