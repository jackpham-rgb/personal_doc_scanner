import { analyze, toIsoDay } from './analyzer';
import { buildPdf } from './pdf';
import type { DocStore } from './store';
import { type CategoryId, type DocRecord, type OcrPage, sanitizeFileName } from './types';

export type Stage = 'reading' | 'organizing' | 'buildingPdf' | 'saving';

export interface PipelineDeps {
  store: DocStore;
  /** Text recognition for one page image. */
  recognize(page: Blob): Promise<OcrPage>;
  /** Small preview of a page image for the library list. */
  makeThumb(page: Blob): Promise<Blob>;
}

/**
 * Turns the flattened page images from one scan into a filed, named,
 * searchable document: OCR → classify and name → searchable PDF → index.
 */
export async function processScan(
  pages: Blob[],
  deps: PipelineDeps,
  onProgress?: (stage: Stage, page: number, pageCount: number) => void,
  now = new Date(),
): Promise<DocRecord> {
  const count = pages.length;
  const ocr: OcrPage[] = [];
  for (let i = 0; i < count; i++) {
    onProgress?.('reading', i + 1, count);
    ocr.push(await deps.recognize(pages[i]));
  }
  const text = ocr
    .map((p) => p.text.trim())
    .join('\n\n')
    .trim();

  onProgress?.('organizing', 0, count);
  const analysis = analyze(text, now);

  onProgress?.('buildingPdf', 0, count);
  const pdf = await buildPdf(
    await Promise.all(
      pages.map(async (page, i) => ({
        jpeg: new Uint8Array(await page.arrayBuffer()),
        ocr: ocr[i],
      })),
    ),
  );
  const thumb = await deps.makeThumb(pages[0]);

  onProgress?.('saving', 0, count);
  return deps.store.add(
    {
      title: await deps.store.uniqueTitle(analysis.title),
      category: analysis.category,
      vendor: analysis.vendor,
      docDate: analysis.date && toIsoDay(analysis.date),
      amount: analysis.amount,
      pageCount: count,
      text,
      createdAt: now.getTime(),
    },
    { pdf: new Blob([pdf as BlobPart], { type: 'application/pdf' }), pages, thumb },
  );
}

/** Renames and/or re-files a document, keeping titles unique. */
export async function editDocument(
  store: DocStore,
  doc: DocRecord,
  change: { title?: string; category?: CategoryId },
): Promise<DocRecord> {
  let title = doc.title;
  if (change.title !== undefined && sanitizeFileName(change.title) !== doc.title) {
    title = await store.uniqueTitle(sanitizeFileName(change.title), doc.id);
  }
  return store.edit(doc.id, { title, category: change.category ?? doc.category });
}
