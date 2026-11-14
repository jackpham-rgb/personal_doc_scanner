import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { DocStore } from '../src/store';
import type { SyncTarget } from '../src/sync/target';
import { CATEGORIES, type CategoryId, type DocRecord } from '../src/types';

let dbCount = 0;

/** A fresh, empty library. */
export const openStore = () => DocStore.open(`test-${dbCount++}`);

export const pageJpeg = () =>
  new Blob([readFileSync(new URL('../../test/fixtures/page.jpg', import.meta.url))], {
    type: 'image/jpeg',
  });

const blob = (text: string, type = 'application/pdf') => new Blob([text], { type });

export function addDoc(
  store: DocStore,
  title: string,
  category: CategoryId = 'receipt',
  createdAt = Date.now(),
): Promise<DocRecord> {
  return store.add(
    { title, category, pageCount: 1, text: `text of ${title}`, createdAt },
    { pdf: blob(`%PDF ${title}`), pages: [blob('page', 'image/jpeg')], thumb: blob('thumb', 'image/jpeg') },
  );
}

/** In-memory destination that records what it was asked to do. */
export class FakeTarget implements SyncTarget {
  readonly name = 'Fake';
  ready = true;
  failWith: unknown;
  /** remote id → "<folder>/<file name>" */
  readonly stored = new Map<string, string>();
  readonly log: string[] = [];
  /** Runs in the middle of every push, to simulate edits during an upload. */
  duringPush?: (doc: DocRecord) => Promise<unknown>;
  private next = 1;

  constructor(readonly id = 'fake') {}

  async isReady() {
    return this.ready;
  }

  async push(doc: DocRecord, _pdf: Blob, previousRemoteId?: string) {
    if (this.failWith) throw this.failWith;
    await this.duringPush?.(doc);
    const path = `${CATEGORIES[doc.category].folder}/${doc.title}.pdf`;
    if (previousRemoteId && this.stored.has(previousRemoteId)) {
      this.stored.set(previousRemoteId, path);
      this.log.push(`replace ${path}`);
      return previousRemoteId;
    }
    const id = `r${this.next++}`;
    this.stored.set(id, path);
    this.log.push(`create ${path}`);
    return id;
  }

  async remove(remoteId: string) {
    if (this.failWith) throw this.failWith;
    this.stored.delete(remoteId);
    this.log.push(`remove ${remoteId}`);
  }
}
