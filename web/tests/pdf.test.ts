import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, test } from 'vitest';
import { buildPdf } from '../src/pdf';
import type { OcrLine, OcrPage } from '../src/types';

// 600 × 800 px scan.
const jpeg = new Uint8Array(readFileSync(new URL('../../test/fixtures/page.jpg', import.meta.url)));

const line = (y0: number, y1: number, ...words: [string, number, number][]): OcrLine => ({
  x0: words[0][1],
  x1: words.at(-1)![2],
  y0,
  y1,
  words: words.map(([text, x0, x1]) => ({ text, x0, x1, y0, y1 })),
});

const page: OcrPage = {
  text: 'COSTCO WHOLESALE\nTOTAL 124.53',
  lines: [
    line(80, 100, ['COSTCO', 60, 150], ['WHOLESALE', 160, 300]),
    line(400, 420, ['TOTAL', 60, 130], ['124.53', 150, 220]),
  ],
};

async function read(bytes: Uint8Array) {
  const doc = await getDocument({ data: bytes.slice() }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const [, , width, height] = p.view;
    const items = (await p.getTextContent()).items.flatMap((it) =>
      'str' in it && it.str.trim()
        ? [{ text: it.str, x: it.transform[4], y: it.transform[5], width: it.width }]
        : [],
    );
    pages.push({ width, height, items });
  }
  return pages;
}

test('one PDF page per scan, sized to the scan and fitting A4', async () => {
  const pages = await read(await buildPdf([{ jpeg, ocr: page }, { jpeg, ocr: page }]));
  expect(pages).toHaveLength(2);
  expect(pages[0].width / pages[0].height).toBeCloseTo(600 / 800, 3);
  expect(pages[0].width).toBeLessThanOrEqual(595.01);
  expect(pages[0].height).toBeLessThanOrEqual(842.01);
});

test('every recognised word can be extracted, at its place on the page', async () => {
  const [p] = await read(await buildPdf([{ jpeg, ocr: page }]));
  expect(p.items.map((i) => i.text)).toEqual(['COSTCO', 'WHOLESALE', 'TOTAL', '124.53']);

  const scale = p.width / 600;
  const total = p.items[2];
  expect(total.x).toBeCloseTo(60 * scale, 1);
  expect(total.width).toBeCloseTo((130 - 60) * scale, 0);
  // PDF y runs upwards; the baseline lies inside the word's box.
  expect(total.y).toBeGreaterThan(p.height - 420 * scale);
  expect(total.y).toBeLessThan(p.height - 400 * scale);
});

test('characters the built-in font lacks do not break the document', async () => {
  const odd: OcrPage = {
    text: '',
    lines: [line(10, 30, ['“Café”', 10, 90], ['東京', 100, 160], ['✓', 170, 190], ['naïve…', 200, 280])],
  };
  const [p] = await read(await buildPdf([{ jpeg, ocr: odd }]));
  expect(p.items.map((i) => i.text)).toEqual(['"Café"', 'naïve...']);
});

test('a page with no text is still a valid page', async () => {
  const [p] = await read(await buildPdf([{ jpeg, ocr: { text: '', lines: [] } }]));
  expect(p.items).toEqual([]);
});
