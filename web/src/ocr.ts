import { createWorker, OEM, type Worker } from 'tesseract.js';
import type { OcrLine, OcrPage } from './types';

let worker: Promise<Worker> | undefined;

/**
 * Starts the OCR engine (Tesseract compiled to WebAssembly) on first use.
 * Its files are served by this site, so recognition runs on the device and
 * works offline.
 */
function engine(): Promise<Worker> {
  if (!worker) {
    const base = new URL('vendor/tesseract/', document.baseURI).href;
    worker = createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${base}worker.min.js`,
      corePath: base.replace(/\/$/, ''),
      langPath: `${base}lang`,
      // The worker script is on our own origin; no need for a blob copy.
      workerBlobURL: false,
    });
    // Let a later scan try again if loading failed (e.g. offline first run).
    worker.catch(() => (worker = undefined));
  }
  return worker;
}

/** Downloads and compiles the engine ahead of the first scan. */
export const warmUpOcr = () => void engine().catch(() => {});

/** Reads the text on one page image. */
export async function recognize(page: Blob): Promise<OcrPage> {
  const { data } = await (await engine()).recognize(page, {}, { text: true, blocks: true });
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const words = line.words
          .filter((w) => w.text.trim())
          .map((w) => ({ text: w.text.trim(), ...w.bbox }));
        if (words.length) lines.push({ ...line.bbox, words });
      }
    }
  }
  return { text: data.text, lines };
}
