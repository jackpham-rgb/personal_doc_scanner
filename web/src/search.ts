import { CATEGORIES, type CategoryId, type DocRecord } from './types';

export interface SearchHit {
  doc: DocRecord;
  /** Excerpt of the document text around the first match, if any. */
  snippet?: string;
}

const SPLIT = /[^\p{L}\p{N}]+/u;

/** Lower-cased words of a query or document. */
export const tokenize = (s: string) => s.toLowerCase().split(SPLIT).filter(Boolean);

// Documents are immutable objects (edits create new ones), so their word
// lists can be cached by identity.
const wordCache = new WeakMap<DocRecord, string[]>();

function wordsOf(doc: DocRecord): string[] {
  let words = wordCache.get(doc);
  if (!words) {
    const c = CATEGORIES[doc.category];
    // Both forms of the category, so "receipt" and "receipts" each match.
    words = tokenize(`${doc.title} ${doc.vendor ?? ''} ${c.label} ${c.folder} ${doc.text}`);
    wordCache.set(doc, words);
  }
  return words;
}

function snippetAround(text: string, needle: string): string | undefined {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(needle);
  if (at < 0) return undefined;
  const start = Math.max(0, flat.lastIndexOf(' ', Math.max(0, at - 30)));
  const end = Math.min(flat.length, at + needle.length + 60);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}

/**
 * Lists documents, newest first. With a query, keeps only documents whose
 * title, vendor, category or text contain every word of it, matching on word
 * prefixes so "insur" finds "insurance".
 */
export function searchDocs(
  docs: readonly DocRecord[],
  query = '',
  category?: CategoryId,
): SearchHit[] {
  const pool = docs
    .filter((d) => !category || d.category === category)
    .sort((a, b) => b.createdAt - a.createdAt);
  const terms = tokenize(query);
  if (terms.length === 0) return pool.map((doc) => ({ doc }));

  const hits = pool
    .filter((doc) => {
      const words = wordsOf(doc);
      return terms.every((t) => words.some((w) => w.startsWith(t)));
    })
    .map((doc) => ({ doc, snippet: snippetAround(doc.text, terms[0]) }));
  if (hits.length > 0) return hits;

  // OCR sometimes glues words together or drops a leading character, which
  // prefix matching cannot recover from. Fall back to a substring scan.
  const needle = query.trim().toLowerCase();
  return pool
    .filter((d) => d.text.toLowerCase().includes(needle) || d.title.toLowerCase().includes(needle))
    .map((doc) => ({ doc, snippet: snippetAround(doc.text, needle) }));
}
