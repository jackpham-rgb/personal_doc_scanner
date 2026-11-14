import { describe, expect, test } from 'vitest';
import { searchDocs } from '../src/search';
import type { CategoryId, DocRecord } from '../src/types';

let nextId = 1;
const doc = (
  title: string,
  category: CategoryId,
  text: string,
  createdAt: number,
  vendor?: string,
): DocRecord => ({ id: nextId++, title, category, text, createdAt, vendor, pageCount: 1, sync: {} });

const docs = [
  doc(
    'GEICO Car Insurance Jun 2026',
    'insurance',
    'Automobile insurance policy declarations\nPolicy 4321',
    2,
    'GEICO',
  ),
  doc(
    'Costco Receipt Nov 2025',
    'receipt',
    'COSTCO WHOLESALE\nKS PAPER TOWEL 21.99\nTOTAL 124.53',
    1,
    'Costco',
  ),
  doc('Passport Copy', 'id', 'PASSPORT\nUnited States of America\nSurname DOE', 3),
];
const titles = (query?: string, category?: CategoryId) =>
  searchDocs(docs, query, category).map((h) => h.doc.title);

describe('search', () => {
  test('empty query lists everything, newest scan first', () => {
    expect(titles()).toEqual([
      'Passport Copy',
      'GEICO Car Insurance Jun 2026',
      'Costco Receipt Nov 2025',
    ]);
  });

  test('finds documents by words in the title', () => {
    expect(titles('Car Insurance')).toEqual(['GEICO Car Insurance Jun 2026']);
  });

  test('finds documents by words that only appear in the scan', () => {
    expect(titles('paper towel')).toEqual(['Costco Receipt Nov 2025']);
    expect(titles('surname')).toEqual(['Passport Copy']);
  });

  test('is case-insensitive and matches word prefixes', () => {
    expect(titles('COSTCO')).toEqual(['Costco Receipt Nov 2025']);
    expect(titles('insur')).toEqual(['GEICO Car Insurance Jun 2026']);
  });

  test('requires every word to match', () => {
    expect(titles('costco passport')).toEqual([]);
  });

  test('finds by category name, singular or plural', () => {
    expect(titles('receipts')).toEqual(['Costco Receipt Nov 2025']);
    expect(titles('ids')).toEqual(['Passport Copy']);
  });

  test('falls back to substring match inside a word', () => {
    expect(titles('holesale')).toEqual(['Costco Receipt Nov 2025']);
  });

  test('returns an excerpt of the matching text', () => {
    expect(searchDocs(docs, 'towel')[0].snippet).toContain('PAPER TOWEL');
  });

  test('combines with the category filter', () => {
    expect(titles('costco', 'id')).toEqual([]);
    expect(titles('', 'id')).toEqual(['Passport Copy']);
  });

  test('punctuation in the query is harmless', () => {
    expect(titles('"( * -')).toHaveLength(3);
    expect(titles('.*')).toHaveLength(3);
  });
});
