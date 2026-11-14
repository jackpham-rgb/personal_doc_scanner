import { CATEGORIES, type DocRecord } from '../types';
import { NeedsSignIn, type SyncTarget } from './target';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** The only permission the app asks for: files it created itself. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_ROOT_FOLDER = 'DocScanner';

export interface DriveAuth {
  /** A valid access token, or null if the user has to sign in first. */
  token(): Promise<string | null>;
  /** Called when Google rejects a token, so it is not offered again. */
  invalidate(token: string): void;
}

/** Remembers folder ids between sessions (localStorage in the browser). */
export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

interface DriveFile {
  id: string;
  parents?: string[];
  trashed?: boolean;
}

class DriveError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Uploads PDFs to `DocScanner/<Category>/` in the user's Google Drive, from
 * where Google Drive for desktop makes them appear on a laptop.
 */
export class DriveTarget implements SyncTarget {
  readonly id = 'google_drive';
  readonly name = 'Google Drive';

  /** Folder ids already checked against Drive in this session. */
  private readonly verified = new Map<string, string>();

  constructor(
    private readonly auth: DriveAuth,
    private readonly cache: KeyValue,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  async isReady(): Promise<boolean> {
    return (await this.auth.token()) !== null;
  }

  async push(doc: DocRecord, pdf: Blob, previousRemoteId?: string): Promise<string> {
    const root = await this.folder(DRIVE_ROOT_FOLDER);
    const folderId = await this.folder(CATEGORIES[doc.category].folder, root);
    const name = `${doc.title}.pdf`;

    if (previousRemoteId) {
      try {
        const current = await this.json<DriveFile>(
          `${API}/files/${previousRemoteId}?fields=id,parents,trashed`,
        );
        if (!current.trashed) {
          const oldParents = current.parents ?? [];
          const params = new URLSearchParams({ uploadType: 'multipart', fields: 'id' });
          if (!oldParents.includes(folderId)) {
            params.set('addParents', folderId);
            if (oldParents.length) params.set('removeParents', oldParents.join(','));
          }
          const updated = await this.json<DriveFile>(
            `${UPLOAD}/files/${previousRemoteId}?${params}`,
            { method: 'PATCH', ...multipart({ name }, pdf) },
          );
          return updated.id;
        }
      } catch (e) {
        // The old copy was deleted in Drive; fall through and upload afresh.
        if (!(e instanceof DriveError && e.status === 404)) throw e;
      }
    }

    const created = await this.json<DriveFile>(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      ...multipart({ name, parents: [folderId] }, pdf),
    });
    return created.id;
  }

  async remove(remoteId: string): Promise<void> {
    try {
      await this.request(`${API}/files/${remoteId}`, { method: 'DELETE' });
    } catch (e) {
      if (!(e instanceof DriveError && e.status === 404)) throw e;
    }
  }

  /** Forgets remembered folders, e.g. when switching to another account. */
  forgetFolders(): void {
    this.verified.clear();
  }

  /** Finds or creates the folder [name] under [parent] (My Drive if absent). */
  private async folder(name: string, parent?: string): Promise<string> {
    const key = `drive.folder.${parent ?? 'root'}/${name}`;
    const verified = this.verified.get(key);
    if (verified) return verified;

    // A remembered id is only trusted after checking the folder still
    // exists: the user may have deleted it in Drive since the last visit.
    const remembered = this.cache.get(key);
    if (remembered && (await this.folderExists(remembered))) {
      this.verified.set(key, remembered);
      return remembered;
    }

    const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q =
      `name = '${escaped}' and mimeType = '${FOLDER_MIME}' and trashed = false ` +
      `and '${parent ?? 'root'}' in parents`;
    const found = await this.json<{ files: DriveFile[] }>(
      `${API}/files?${new URLSearchParams({ q, spaces: 'drive', pageSize: '1', fields: 'files(id)' })}`,
    );
    let id = found.files[0]?.id;
    if (!id) {
      const created = await this.json<DriveFile>(`${API}/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: parent ? [parent] : undefined }),
      });
      id = created.id;
    }
    this.cache.set(key, id);
    this.verified.set(key, id);
    return id;
  }

  private async folderExists(id: string): Promise<boolean> {
    try {
      const f = await this.json<DriveFile>(`${API}/files/${id}?fields=id,trashed`);
      return !f.trashed;
    } catch (e) {
      if (e instanceof DriveError && e.status === 404) return false;
      throw e;
    }
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    return (await this.request(url, init)).json() as Promise<T>;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.auth.token();
    if (!token) throw new NeedsSignIn('Google Drive is not connected');
    const response = await this.fetchFn(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      this.auth.invalidate(token);
      throw new NeedsSignIn('Google Drive needs you to sign in again');
    }
    if (!response.ok) {
      let detail = response.statusText;
      try {
        detail = (await response.json()).error?.message ?? detail;
      } catch {
        // Not a JSON error body; the status text will do.
      }
      throw new DriveError(response.status, `Google Drive: ${detail || response.status}`);
    }
    return response;
  }
}

/** A `multipart/related` body: JSON metadata followed by the file content. */
function multipart(metadata: object, content: Blob): Pick<RequestInit, 'headers' | 'body'> {
  const boundary = `docscanner${Math.random().toString(36).slice(2)}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${content.type || 'application/octet-stream'}\r\n\r\n`,
    content,
    `\r\n--${boundary}--`,
  ]);
  return { headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body };
}
