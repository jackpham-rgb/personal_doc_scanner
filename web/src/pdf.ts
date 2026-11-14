import {
  beginText,
  endText,
  PDFDocument,
  type PDFFont,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  StandardFonts,
  TextRenderingMode,
} from 'pdf-lib';
import type { OcrPage } from './types';

export interface PdfPageInput {
  /** The flattened scan. */
  jpeg: Uint8Array;
  ocr: OcrPage;
}

// A4 in PDF points. Pages are scaled to fit inside it, so a letter page
// prints at full size and a narrow receipt keeps its shape.
const MAX_SHORT = 595;
const MAX_LONG = 842;

const REPLACEMENTS: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '•': '*',
  '…': '...',
};

/**
 * Builds a searchable PDF: each page is the scanned image with the
 * recognised words laid invisibly on top of it, so the file can be searched
 * and copied from in any viewer and is indexed by desktop and cloud search.
 */
export async function buildPdf(pages: PdfPageInput[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setCreator('Doc Scanner');
  pdf.setProducer('Doc Scanner');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const supported = new Set(font.getCharacterSet());

  // The built-in PDF fonts only cover Western European characters. Map
  // common typographic ones to plain equivalents and drop the rest rather
  // than fail the whole document over one glyph.
  const encodable = (text: string) =>
    [...text]
      .map((ch) => REPLACEMENTS[ch] ?? ch)
      .join('')
      .split('')
      .filter((ch) => ch > ' ' && supported.has(ch.codePointAt(0)!))
      .join('');

  for (const { jpeg, ocr } of pages) {
    const image = await pdf.embedJpg(jpeg);
    const portrait = image.height >= image.width;
    const scale = Math.min(
      (portrait ? MAX_SHORT : MAX_LONG) / image.width,
      (portrait ? MAX_LONG : MAX_SHORT) / image.height,
    );
    const pageW = image.width * scale;
    const pageH = image.height * scale;
    const page = pdf.addPage([pageW, pageH]);
    page.drawImage(image, { x: 0, y: 0, width: pageW, height: pageH });

    const fontKey = page.node.newFontDictionary(font.name, font.ref);
    const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
    for (const line of ocr.lines) {
      const lineH = (line.y1 - line.y0) * scale;
      if (lineH <= 0) continue;
      // One size and baseline per line, so viewers select it as a line. PDF's
      // origin is bottom-left; the baseline sits a little above the bottom
      // of the box, where the descenders would be.
      const size = lineH * 0.75;
      const baseline = pageH - line.y1 * scale + lineH * 0.22;
      ops.push(setFontAndSize(fontKey, size));
      for (const word of line.words) {
        const text = encodable(word.text);
        const boxW = (word.x1 - word.x0) * scale;
        if (!text || boxW <= 0) continue;
        const natural = widthAt(font, text, size);
        if (natural <= 0) continue;
        ops.push(
          // Stretch the word to the width it has in the scan, so selections
          // and search highlights line up with the image underneath.
          setCharacterSqueeze((boxW / natural) * 100),
          setTextMatrix(1, 0, 0, 1, word.x0 * scale, baseline),
          showText(font.encodeText(text)),
        );
      }
    }
    ops.push(endText(), popGraphicsState());
    page.pushOperators(...ops);
  }
  return pdf.save();
}

/**
 * Width of [text] as the PDF will draw it. Measured one character at a time
 * because pdf-lib's own measurement applies kerning between letter pairs,
 * which a viewer does not do for text written this way.
 */
function widthAt(font: PDFFont, text: string, size: number): number {
  let width = 0;
  for (const ch of text) width += font.widthOfTextAtSize(ch, size);
  return width;
}
