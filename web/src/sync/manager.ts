import { type DocStore, pdfKey } from '../store';
import { NeedsSignIn, type SyncTarget } from './target';

/**
 * Keeps every enabled destination up to date with the library.
 *
 * Work is derived from the stored state each run (documents without a
 * current copy, plus tombstones for deleted ones), so anything that fails —
 * no network, tab closed mid-upload — is simply picked up by the next run.
 */
export class SyncManager {
  private running = false;
  private rerun = false;
  private readonly listeners = new Set<() => void>();

  /** Message of the most recent failure per destination id, for display. */
  readonly lastErrors: Record<string, string> = {};

  constructor(
    private readonly store: DocStore,
    readonly targets: SyncTarget[],
    /** Whether the user has switched a destination on. */
    private readonly isEnabled: (target: SyncTarget) => boolean,
  ) {}

  get isSyncing(): boolean {
    return this.running;
  }

  /** Calls [listener] whenever sync state changes. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  /**
   * Runs a sync pass. Calls made while a pass is in progress are coalesced
   * into one follow-up pass, so callers can fire this freely.
   */
  async sync(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    this.notify();
    try {
      do {
        this.rerun = false;
        for (const target of this.targets) {
          if (this.isEnabled(target)) await this.syncTarget(target);
        }
      } while (this.rerun);
    } finally {
      this.running = false;
      this.notify();
    }
  }

  private async syncTarget(target: SyncTarget): Promise<void> {
    try {
      if (!(await target.isReady())) return;
      delete this.lastErrors[target.id];

      for (const tombstone of await this.store.tombstones(target.id)) {
        await target.remove(tombstone.remoteId);
        await this.store.removeTombstone(tombstone.id);
      }

      const pending = (await this.store.all())
        .filter((d) => d.sync[target.id]?.status !== 'synced')
        .sort((a, b) => a.createdAt - b.createdAt);
      for (const doc of pending) {
        const pdf = await this.store.file(pdfKey(doc.id));
        if (!pdf) {
          await this.store.setSync(doc.id, target.id, {
            status: 'error',
            error: 'PDF file is missing',
          });
          continue;
        }
        try {
          const remoteId = await target.push(doc, pdf, doc.sync[target.id]?.remoteId);
          const saved = await this.store.setSync(doc.id, target.id, {
            status: 'synced',
            remoteId,
          });
          if (!saved) {
            // Deleted while it was uploading: remove the copy just made.
            await target.remove(remoteId);
          } else if (saved.title !== doc.title || saved.category !== doc.category) {
            // Renamed while it was uploading: the copy has the old name.
            await this.store.setSync(doc.id, target.id, { status: 'pending' });
            this.rerun = true;
          }
          this.notify();
        } catch (e) {
          if (isOffline(e) || e instanceof NeedsSignIn) throw e;
          const error = messageOf(e);
          await this.store.setSync(doc.id, target.id, { status: 'error', error });
          this.lastErrors[target.id] = error;
        }
      }
    } catch (e) {
      // Offline, signed out, or the destination itself is failing: stop this
      // pass for this destination; everything stays pending for the next.
      this.lastErrors[target.id] = isOffline(e) ? 'No internet connection' : messageOf(e);
    }
  }
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

// `fetch` reports a dropped connection as a TypeError.
const isOffline = (e: unknown) => e instanceof TypeError;
