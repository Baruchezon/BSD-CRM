// RTL summary PDF. pdf-lib + an embedded Hebrew font. BSD colours.
import { PDFDocument, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import { visualLine, wrapLogical } from './visual.mjs';

// Noto Sans Hebrew (SIL OFL), vendored as font.ts. The PDF embeds this face.
// Runtime loads the same pinned file (17220 bytes) so the bundle does not depend on a binary upload.
const FONT_URL = 'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-hebrew@5.2.8/hebrew-400-normal.ttf';
const FONT_BYTES = 17220;

async function fontBytes(): Promise<Uint8Array> {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error('hebrew_font ' + res.status);
  const fetched = new Uint8Array(await res.arrayBuffer());
  if (fetched.byteLength !== FONT_BYTES) throw new Error('hebrew_font_size ' + fetched.byteLength);
  return fetched;
}

const NAVY = rgb(0x0B / 255, 0x1B / 255, 0x3A / 255);
const ORANGE = rgb(0xF2 / 255, 0x6B / 255, 0x1D / 255);
const CREAM = rgb(0xFA / 255, 0xF5 / 255, 0xEC / 255);
const INK = rgb(0x1A / 255, 0x1A / 255, 0x1A / 255);

export async function buildSummaryPdf(title: string, points: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await fontBytes(), { subset: true });
  const latin = await doc.embedFont(StandardFonts.Helvetica);
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 48;
  const maxWidth = pageWidth - margin * 2;

  let page = doc.addPage([pageWidth, pageHeight]);
  const paintPage = () => {
    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: CREAM });
    page.drawRectangle({ x: 0, y: pageHeight - 78, width: pageWidth, height: 78, color: NAVY });
    page.drawRectangle({ x: 0, y: pageHeight - 84, width: pageWidth, height: 6, color: ORANGE });
  };
  paintPage();

  // The Hebrew subset has no Latin, digits, or ASCII punctuation. Those runs use Helvetica.
  const runsOf = (visual: string) => (visual.match(/[\u0590-\u05FF]+|[^\u0590-\u05FF]+/g) || []).map(text => ({
    text,
    font: /[\u0590-\u05FF]/.test(text) ? font : latin,
  }));
  const widthOf = (visual: string, size: number) => runsOf(visual)
    .reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, size), 0);
  const draw = (logical: string, size: number, y: number, color: ReturnType<typeof rgb>) => {
    const runs = runsOf(visualLine(logical));
    let x = pageWidth - margin - widthOf(visualLine(logical), size);
    for (const run of runs) {
      page.drawText(run.text, { x, y, size, font: run.font, color });
      x += run.font.widthOfTextAtSize(run.text, size);
    }
  };

  draw(title, 16, pageHeight - 40, rgb(1, 1, 1));
  draw('BSD Business Brokers Israel', 9, pageHeight - 62, ORANGE);

  let y = pageHeight - 116;
  const body = points.length ? points : ['לא נמצאו עיקרי דברים בתמלול.'];
  for (const point of body) {
    const lines = wrapLogical(point, maxWidth - 18, v => widthOf(v, 12));
    for (let i = 0; i < lines.length; i++) {
      if (y < 56) {
        page = doc.addPage([pageWidth, pageHeight]);
        paintPage();
        y = pageHeight - 116;
      }
      const logical = (i === 0 ? '– ' : '  ') + lines[i];
      draw(logical, 12, y, INK);
      y -= 20;
    }
    y -= 6;
  }
  return doc.save();
}
