import type { DocRecord } from '../types';

/**
 * A place finished PDFs are copied to. Destinations store files as
 * `<category folder>/<title>.pdf`. To add another service (OneDrive,
 * Dropbox), implement this interface and pass it to the `SyncManager`.
 */
export interface SyncTarget {
  /** Stable identifier, used as a key in each document's sync state. */
  readonly id: string;
  /** Name shown in the UI. */
  readonly name: string;

  /** Whether uploads can run right now without asking the user anything. */
  isReady(): Promise<boolean>;

  /**
   * Stores [pdf] for [doc] and returns an identifier for the stored copy.
   *
   * If [previousRemoteId] is given, the document was synced before and has
   * since been renamed or re-filed: the old copy must be replaced, not
   * duplicated.
   */
  push(doc: DocRecord, pdf: Blob, previousRemoteId?: string): Promise<string>;

  /** Deletes a stored copy. Must succeed if the copy is already gone. */
  remove(remoteId: string): Promise<void>;
}

/** Thrown by a target when the user has to sign in again before it can sync. */
export class NeedsSignIn extends Error {
  constructor(message = 'Sign in again to continue syncing') {
    super(message);
  }
}
