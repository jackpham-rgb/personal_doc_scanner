import { makeThumb } from './image';
import { recognize } from './ocr';
import { editDocument, processScan, type Stage } from './pipeline';
import { searchDocs, type SearchHit } from './search';
import { Settings } from './settings';
import { DocStore } from './store';
import { DriveTarget } from './sync/drive';
import { GoogleAuth } from './sync/google-auth';
import { SyncManager } from './sync/manager';
import type { CategoryId, DocRecord } from './types';

const STAGE_TEXT: Record<Stage, (page: number, count: number) => string> = {
  reading: (page, count) => (count > 1 ? `Reading text (page ${page} of ${count})…` : 'Reading text…'),
  organizing: () => 'Naming and filing…',
  buildingPdf: () => 'Creating searchable PDF…',
  saving: () => 'Saving…',
};

/** Owns the services and the state the screens render. */
export class AppModel {
  docs: DocRecord[] = [];
  query = '';
  category: CategoryId | undefined;
  /** What the banner shows while a scan is being filed. */
  processing: string | undefined;
  /** The most recent thing worth telling the user, shown as a toast. */
  notice: { text: string; docId?: number } | undefined;

  private readonly listeners = new Set<() => void>();

  private constructor(
    readonly settings: Settings,
    readonly store: DocStore,
    readonly auth: GoogleAuth,
    readonly drive: DriveTarget,
    readonly sync: SyncManager,
  ) {}

  static async create(): Promise<AppModel> {
    const settings = new Settings();
    const store = await DocStore.open();
    const auth = new GoogleAuth(settings);
    const drive = new DriveTarget(auth, settings);
    const sync = new SyncManager(store, [drive], () => settings.driveEnabled);
    const model = new AppModel(settings, store, auth, drive, sync);

    sync.subscribe(() => void model.reload());
    // Retry anything still pending as soon as the network comes back.
    window.addEventListener('online', () => void sync.sync());
    await model.reload();
    void sync.sync();
    return model;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const l of this.listeners) l();
  }

  async reload(): Promise<void> {
    this.docs = await this.store.all();
    this.changed();
  }

  get hits(): SearchHit[] {
    return searchDocs(this.docs, this.query, this.category);
  }

  categoryCounts(): Map<CategoryId, number> {
    const counts = new Map<CategoryId, number>();
    for (const d of this.docs) counts.set(d.category, (counts.get(d.category) ?? 0) + 1);
    return counts;
  }

  setQuery(query: string): void {
    this.query = query;
    this.changed();
  }

  setCategory(category: CategoryId | undefined): void {
    this.category = category;
    this.changed();
  }

  dismissNotice(): void {
    this.notice = undefined;
    this.changed();
  }

  /**
   * Files the pages of one scan. Returns at once; progress shows in the
   * library banner and the outcome arrives as a notice.
   */
  saveScan(pages: Blob[]): void {
    void (async () => {
      this.processing = 'Starting…';
      this.changed();
      try {
        const doc = await processScan(
          pages,
          { store: this.store, recognize, makeThumb },
          (stage, page, count) => {
            this.processing = STAGE_TEXT[stage](page, count);
            this.changed();
          },
        );
        this.notice = { text: `Saved “${doc.title}”`, docId: doc.id };
        // Ask the browser not to evict the library when storage runs low.
        void navigator.storage?.persist?.();
        void this.sync.sync();
      } catch (e) {
        this.notice = { text: `Could not process the scan: ${e instanceof Error ? e.message : e}` };
      } finally {
        this.processing = undefined;
        await this.reload();
      }
    })();
  }

  async edit(doc: DocRecord, change: { title?: string; category?: CategoryId }): Promise<DocRecord> {
    const updated = await editDocument(this.store, doc, change);
    await this.reload();
    void this.sync.sync();
    return updated;
  }

  async remove(doc: DocRecord): Promise<void> {
    await this.store.remove(doc.id);
    await this.reload();
    void this.sync.sync();
  }

  // ---------------------------------------------------------- Google Drive

  /** Drive is switched on but the sign-in has run out. */
  get driveNeedsSignIn(): boolean {
    return this.settings.driveEnabled && !this.auth.signedIn;
  }

  /** Documents not yet in Drive. */
  get driveBacklog(): number {
    if (!this.settings.driveEnabled) return 0;
    return this.docs.filter((d) => d.sync[this.drive.id]?.status !== 'synced').length;
  }

  /** Signs in (from a tap) and uploads whatever is waiting. */
  async connectDrive(): Promise<void> {
    await this.auth.signIn();
    this.settings.driveEnabled = true;
    this.changed();
    void this.sync.sync();
  }

  async disconnectDrive(): Promise<void> {
    this.settings.driveEnabled = false;
    this.auth.signOut();
    this.drive.forgetFolders();
    this.settings.removeWithPrefix('drive.folder.');
    // Forget remote ids so reconnecting (perhaps to another account) uploads
    // everything again instead of updating files it cannot see.
    await this.store.clearTarget(this.drive.id);
    await this.reload();
  }
}
