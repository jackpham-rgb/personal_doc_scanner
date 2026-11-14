/** Broad document categories. Each maps to a folder in sync destinations. */
export const CATEGORIES = {
  receipt: { label: 'Receipt', folder: 'Receipts', icon: '🧾' },
  invoice: { label: 'Invoice', folder: 'Invoices', icon: '📑' },
  bill: { label: 'Bill', folder: 'Bills', icon: '💡' },
  bankStatement: { label: 'Bank Statement', folder: 'Bank Statements', icon: '🏦' },
  id: { label: 'ID', folder: 'IDs', icon: '🪪' },
  insurance: { label: 'Insurance', folder: 'Insurance', icon: '🛡️' },
  tax: { label: 'Tax Document', folder: 'Taxes', icon: '🧮' },
  medical: { label: 'Medical Record', folder: 'Medical', icon: '🩺' },
  contract: { label: 'Contract', folder: 'Contracts', icon: '✍️' },
  letter: { label: 'Letter', folder: 'Letters', icon: '✉️' },
  other: { label: 'Document', folder: 'Other', icon: '📄' },
} as const;

export type CategoryId = keyof typeof CATEGORIES;
export const CATEGORY_IDS = Object.keys(CATEGORIES) as CategoryId[];

export type SyncStatus = 'pending' | 'synced' | 'error';

export interface SyncState {
  status: SyncStatus;
  /** Identifier of the copy in the destination, once one exists. */
  remoteId?: string;
  error?: string;
}

/** One scanned document as stored in the index. */
export interface DocRecord {
  id: number;
  /** Display name and PDF file name, without the `.pdf` extension. */
  title: string;
  category: CategoryId;
  vendor?: string;
  /** Date printed on the document, `yyyy-mm-dd`. */
  docDate?: string;
  /** Total or amount due printed on the document. */
  amount?: number;
  pageCount: number;
  /** All recognised text, pages separated by a blank line. */
  text: string;
  /** When it was scanned, epoch milliseconds. */
  createdAt: number;
  /** Sync state per destination id. A missing entry means "not uploaded". */
  sync: Record<string, SyncState>;
}

/** A box in pixels of the page image, origin at the top left. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord extends Box {
  text: string;
}

export interface OcrLine extends Box {
  words: OcrWord[];
}

/** Text recognised on one page and where each word sits. */
export interface OcrPage {
  text: string;
  lines: OcrLine[];
}

export interface Point {
  x: number;
  y: number;
}

/** Corners of a document, clockwise from the top left. */
export type Quad = [Point, Point, Point, Point];

/**
 * Replaces characters that are not allowed in file names on Windows, Android
 * or cloud drives, and trims the result to a sane length.
 */
export function sanitizeFileName(name: string): string {
  let out = name
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Windows does not allow names that end in a dot.
    .replace(/[. ]+$/, '');
  if (out.length > 80) out = out.slice(0, 80).trim();
  return out || 'Document';
}
