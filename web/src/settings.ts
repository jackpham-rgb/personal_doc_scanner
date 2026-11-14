import type { KeyValue } from './sync/drive';

const PREFIX = 'docscanner.';

/** Preferences and small bits of state, kept in the browser's localStorage. */
export class Settings implements KeyValue {
  constructor(private readonly storage: Storage = localStorage) {}

  get(key: string): string | null {
    return this.storage.getItem(PREFIX + key);
  }

  set(key: string, value: string): void {
    this.storage.setItem(PREFIX + key, value);
  }

  remove(key: string): void {
    this.storage.removeItem(PREFIX + key);
  }

  removeWithPrefix(prefix: string): void {
    for (const key of Object.keys(this.storage)) {
      if (key.startsWith(PREFIX + prefix)) this.storage.removeItem(key);
    }
  }

  /** Capture by itself once a document is held steady in view. */
  get autoCapture(): boolean {
    return this.get('autoCapture') !== 'false';
  }
  set autoCapture(on: boolean) {
    this.set('autoCapture', String(on));
  }

  /** OAuth client ID of the user's own Google Cloud project. */
  get driveClientId(): string {
    return this.get('drive.clientId') ?? '';
  }
  set driveClientId(id: string) {
    this.set('drive.clientId', id.trim());
  }

  /** Whether the user has connected Google Drive (and not disconnected it). */
  get driveEnabled(): boolean {
    return this.get('drive.enabled') === 'true';
  }
  set driveEnabled(on: boolean) {
    this.set('drive.enabled', String(on));
  }
}
