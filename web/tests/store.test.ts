import { beforeEach, describe, expect, test } from 'vitest';
import { editDocument, processScan } from '../src/pipeline';
import { type DocStore, pageKey, pdfKey, thumbKey } from '../src/store';
import { searchDocs } from '../src/search';
import type { OcrPage } from '../src/types';
import { addDoc, openStore, pageJpeg } from './support';

const RECEIPT = 'COSTCO WHOLESALE\nKS PAPER TOWEL 21.99\nSUBTOTAL 114.25\nTOTAL 124.53\nCHANGE DUE 0.00\n11/05/2026';

let store: DocStore;
beforeEach(async () => {
  store = await openStore();
});

describe('store', () => {
  test('keeps a document together with its files', async () => {
    const doc = await addDoc(store, 'Costco Receipt Nov 2026');
    expect(await store.get(doc.id)).toEqual(doc);
    expect(await (await store.file(pdfKey(doc.id)))!.text()).toBe('%PDF Costco Receipt Nov 2026');
    expect((await store.file(pdfKey(doc.id)))!.type).toBe('application/pdf');
    expect(await store.file(pageKey(doc.id, 0))).toBeDefined();
    expect(await store.file(thumbKey(doc.id))).toBeDefined();
  });

  test('deleting removes the files of that document only', async () => {
    const a = await addDoc(store, 'A');
    // Ids 1 and 10 share a prefix as strings; deleting 1 must not touch 10.
    let other = a;
    while (other.id < 10) other = await addDoc(store, `filler ${other.id}`);
    await store.remove(a.id);
    expect(await store.get(a.id)).toBeUndefined();
    expect(await store.file(pdfKey(a.id))).toBeUndefined();
    expect(await store.file(pageKey(a.id, 0))).toBeUndefined();
    expect(await store.file(pdfKey(other.id))).toBeDefined();
  });

  test('uniqueTitle numbers duplicates, ignoring case', async () => {
    expect(await store.uniqueTitle('Scan')).toBe('Scan');
    const first = await addDoc(store, 'Scan');
    await addDoc(store, 'Scan (2)');
    expect(await store.uniqueTitle('scan')).toBe('scan (3)');
    expect(await store.uniqueTitle('Scan', first.id)).toBe('Scan');
  });

  test('editing marks synced copies pending but remembers where they are', async () => {
    const doc = await addDoc(store, 'Doc');
    await store.setSync(doc.id, 'drive', { status: 'synced', remoteId: 'x' });
    const edited = await store.edit(doc.id, { category: 'tax' });
    expect(edited.sync.drive).toEqual({ status: 'pending', remoteId: 'x' });
  });

  test('a failed attempt keeps the last known remote id', async () => {
    const doc = await addDoc(store, 'Doc');
    await store.setSync(doc.id, 'drive', { status: 'synced', remoteId: 'x' });
    const failed = await store.setSync(doc.id, 'drive', { status: 'error', error: 'boom' });
    expect(failed!.sync.drive).toEqual({ status: 'error', error: 'boom', remoteId: 'x' });
  });

  test('deleting leaves tombstones only for copies that exist', async () => {
    const doc = await addDoc(store, 'Doc');
    await store.setSync(doc.id, 'drive', { status: 'synced', remoteId: 'x' });
    await store.setSync(doc.id, 'other', { status: 'error', error: 'e' });
    await store.remove(doc.id);
    expect((await store.tombstones('drive')).map((t) => t.remoteId)).toEqual(['x']);
    expect(await store.tombstones('other')).toEqual([]);
    expect(await store.setSync(doc.id, 'drive', { status: 'synced' })).toBeUndefined();
  });

  test('clearTarget forgets one destination and leaves the others', async () => {
    const doc = await addDoc(store, 'Doc');
    await store.setSync(doc.id, 'drive', { status: 'synced', remoteId: 'x' });
    await store.setSync(doc.id, 'other', { status: 'synced', remoteId: 'y' });
    const gone = await addDoc(store, 'Gone');
    await store.setSync(gone.id, 'drive', { status: 'synced', remoteId: 'z' });
    await store.remove(gone.id);

    await store.clearTarget('drive');
    expect((await store.get(doc.id))!.sync).toEqual({ other: { status: 'synced', remoteId: 'y' } });
    expect(await store.tombstones('drive')).toEqual([]);
  });
});

describe('pipeline', () => {
  const now = new Date(2026, 10, 10, 9, 30);
  let textByPage: string[];
  const deps = () => {
    let n = 0;
    return {
      store,
      recognize: async (): Promise<OcrPage> => ({ text: textByPage[n++] ?? '', lines: [] }),
      makeThumb: async (page: Blob) => page,
    };
  };
  beforeEach(() => {
    textByPage = [RECEIPT];
  });

  test('a scan becomes a named, filed, searchable document with a PDF', async () => {
    const stages: string[] = [];
    const doc = await processScan([pageJpeg()], deps(), (s) => stages.push(s), now);

    expect(doc).toMatchObject({
      title: 'Costco Receipt Nov 2026',
      category: 'receipt',
      vendor: 'Costco',
      amount: 124.53,
      docDate: '2026-11-05',
      pageCount: 1,
      createdAt: now.getTime(),
    });
    expect(stages).toEqual(['reading', 'organizing', 'buildingPdf', 'saving']);
    const pdf = (await store.file(pdfKey(doc.id)))!;
    expect(await pdf.slice(0, 5).text()).toBe('%PDF-');
    expect(searchDocs(await store.all(), 'change due').map((h) => h.doc.id)).toEqual([doc.id]);
  });

  test('pages keep their order and all contribute to search', async () => {
    textByPage = ['Lease Agreement\nLandlord and Tenant', 'Appendix: parking stall 14'];
    const doc = await processScan([pageJpeg(), pageJpeg()], deps(), undefined, now);
    expect(doc.pageCount).toBe(2);
    expect(doc.text.indexOf('Landlord')).toBeLessThan(doc.text.indexOf('parking'));
    expect(await store.file(pageKey(doc.id, 1))).toBeDefined();
    expect(searchDocs(await store.all(), 'parking')).toHaveLength(1);
  });

  test('scanning the same thing twice gives distinct names', async () => {
    const a = await processScan([pageJpeg()], deps(), undefined, now);
    const b = await processScan([pageJpeg()], deps(), undefined, now);
    expect([a.title, b.title]).toEqual(['Costco Receipt Nov 2026', 'Costco Receipt Nov 2026 (2)']);
  });

  test('a failure leaves no half-made document', async () => {
    const failing = { ...deps(), recognize: () => Promise.reject(new Error('ocr unavailable')) };
    await expect(processScan([pageJpeg()], failing, undefined, now)).rejects.toThrow('ocr unavailable');
    expect(await store.all()).toEqual([]);
  });

  test('renaming cleans the name and keeps it unique', async () => {
    const a = await processScan([pageJpeg()], deps(), undefined, now);
    const b = await processScan([pageJpeg()], deps(), undefined, now);
    expect((await editDocument(store, b, { title: 'Costco: paper towels?' })).title).toBe(
      'Costco paper towels',
    );
    expect((await editDocument(store, b, { title: a.title })).title).toBe(`${a.title} (2)`);
  });

  test('re-filing changes the category and nothing else', async () => {
    const doc = await processScan([pageJpeg()], deps(), undefined, now);
    const moved = await editDocument(store, doc, { category: 'tax' });
    expect(moved).toMatchObject({ category: 'tax', title: doc.title });
  });
});
