import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type { CategoryId, DocRecord, SyncState } from './types';

/** A remote copy still to be removed because its document was deleted. */
export interface Tombstone {
  id: number;
  target: string;
  remoteId: string;
}

// Blobs are stored as plain buffers: some browsers lose Blob objects kept in
// IndexedDB.
interface StoredFile {
  type: string;
  data: ArrayBuffer;
}

interface Schema extends DBSchema {
  docs: { key: number; value: DocRecord };
  files: { key: string; value: StoredFile };
  tombstones: { key: number; value: Omit<Tombstone, 'id'> & { id?: number } };
}

export interface DocFiles {
  pdf: Blob;
  pages: Blob[];
  thumb: Blob;
}

export const pdfKey = (docId: number) => `${docId}/pdf`;
export const pageKey = (docId: number, index: number) => `${docId}/page/${index}`;
export const thumbKey = (docId: number) => `${docId}/thumb`;

const toStored = async (blob: Blob): Promise<StoredFile> => ({
  type: blob.type,
  data: await blob.arrayBuffer(),
});

/**
 * The library on this device: document records, their files (PDF, page
 * images, thumbnail) and per-destination sync bookkeeping, in IndexedDB.
 */
export class DocStore {
  private constructor(private readonly db: IDBPDatabase<Schema>) {}

  static async open(name = 'doc-scanner'): Promise<DocStore> {
    const db = await openDB<Schema>(name, 1, {
      upgrade(db) {
        db.createObjectStore('docs', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('files');
        db.createObjectStore('tombstones', { keyPath: 'id', autoIncrement: true });
      },
    });
    return new DocStore(db);
  }

  close(): void {
    this.db.close();
  }

  all(): Promise<DocRecord[]> {
    return this.db.getAll('docs');
  }

  get(id: number): Promise<DocRecord | undefined> {
    return this.db.get('docs', id);
  }

  async add(doc: Omit<DocRecord, 'id' | 'sync'>, files: DocFiles): Promise<DocRecord> {
    // Read the blobs first: an IndexedDB transaction closes itself as soon
    // as it is left waiting on anything else.
    const pdf = await toStored(files.pdf);
    const thumb = await toStored(files.thumb);
    const pages = await Promise.all(files.pages.map(toStored));

    const tx = this.db.transaction(['docs', 'files'], 'readwrite');
    const record = { ...doc, sync: {} } as DocRecord;
    const id = await tx.objectStore('docs').add(record);
    record.id = id;
    const store = tx.objectStore('files');
    await store.put(pdf, pdfKey(id));
    await store.put(thumb, thumbKey(id));
    await Promise.all(pages.map((p, i) => store.put(p, pageKey(id, i))));
    await tx.done;
    return record;
  }

  /**
   * Renames and/or re-files a document and marks it for re-sync so every
   * destination picks up the new name and folder.
   */
  async edit(id: number, change: { title?: string; category?: CategoryId }): Promise<DocRecord> {
    return this.mutate(id, (doc) => ({
      ...doc,
      ...change,
      sync: Object.fromEntries(
        Object.entries(doc.sync).map(([target, s]) => [
          target,
          { status: 'pending', remoteId: s.remoteId } satisfies SyncState,
        ]),
      ),
    }));
  }

  /**
   * Deletes a document and its files. Remote copies that were already
   * uploaded are recorded as tombstones so the sync manager can remove them.
   */
  async remove(id: number): Promise<void> {
    const tx = this.db.transaction(['docs', 'files', 'tombstones'], 'readwrite');
    const doc = await tx.objectStore('docs').get(id);
    if (doc) {
      for (const [target, state] of Object.entries(doc.sync)) {
        if (state.remoteId) {
          await tx.objectStore('tombstones').add({ target, remoteId: state.remoteId });
        }
      }
      await tx.objectStore('docs').delete(id);
      await tx.objectStore('files').delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`));
    }
    await tx.done;
  }

  async file(key: string): Promise<Blob | undefined> {
    const stored = await this.db.get('files', key);
    return stored && new Blob([stored.data], { type: stored.type });
  }

  /**
   * Returns [wanted], or "[wanted] (2)", "(3)"… if that name is taken, so two
   * documents never fight over one file name in a sync destination.
   */
  async uniqueTitle(wanted: string, exceptId?: number): Promise<string> {
    const taken = new Set(
      (await this.all()).filter((d) => d.id !== exceptId).map((d) => d.title.toLowerCase()),
    );
    let candidate = wanted;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${wanted} (${n})`;
    return candidate;
  }

  // ------------------------------------------------------------------ sync

  /**
   * Records the outcome of a sync attempt. A failed attempt keeps the id of
   * the last good remote copy. Returns undefined if the document has been
   * deleted in the meantime.
   */
  async setSync(
    id: number,
    target: string,
    state: SyncState,
  ): Promise<DocRecord | undefined> {
    try {
      return await this.mutate(id, (doc) => ({
        ...doc,
        sync: {
          ...doc.sync,
          [target]: { ...state, remoteId: state.remoteId ?? doc.sync[target]?.remoteId },
        },
      }));
    } catch (e) {
      if (e instanceof DocumentGone) return undefined;
      throw e;
    }
  }

  /** Forgets everything known about [target], e.g. after disconnecting it. */
  async clearTarget(target: string): Promise<void> {
    const tx = this.db.transaction(['docs', 'tombstones'], 'readwrite');
    for (const doc of await tx.objectStore('docs').getAll()) {
      if (target in doc.sync) {
        const { [target]: _, ...rest } = doc.sync;
        await tx.objectStore('docs').put({ ...doc, sync: rest });
      }
    }
    for (const t of await tx.objectStore('tombstones').getAll()) {
      if (t.target === target) await tx.objectStore('tombstones').delete(t.id!);
    }
    await tx.done;
  }

  async tombstones(target: string): Promise<Tombstone[]> {
    const all = (await this.db.getAll('tombstones')) as Tombstone[];
    return all.filter((t) => t.target === target);
  }

  async removeTombstone(id: number): Promise<void> {
    await this.db.delete('tombstones', id);
  }

  private async mutate(id: number, change: (doc: DocRecord) => DocRecord): Promise<DocRecord> {
    const tx = this.db.transaction('docs', 'readwrite');
    const doc = await tx.store.get(id);
    if (!doc) throw new DocumentGone(id);
    const updated = change(doc);
    await tx.store.put(updated);
    await tx.done;
    return updated;
  }
}

export class DocumentGone extends Error {
  constructor(id: number) {
    super(`Document ${id} no longer exists`);
  }
}
