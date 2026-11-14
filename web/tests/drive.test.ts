import { beforeEach, expect, test } from 'vitest';
import { DriveTarget } from '../src/sync/drive';
import { NeedsSignIn } from '../src/sync/target';
import type { CategoryId, DocRecord } from '../src/types';

const FOLDER = 'application/vnd.google-apps.folder';

interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  content?: string;
}

/**
 * A minimal stand-in for the parts of the Drive v3 REST API the app uses,
 * following Google's documented request shapes.
 */
class FakeDrive {
  files = new Map<string, FakeFile>();
  requests: string[] = [];
  validToken = 'good';
  private next = 1;

  fetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    this.requests.push(`${method} ${url.pathname}`);
    const headers = init.headers as Record<string, string>;
    if (headers.Authorization !== `Bearer ${this.validToken}`) return json(401, { error: { message: 'Invalid Credentials' } });

    const upload = url.pathname.startsWith('/upload/drive/v3/files');
    const id = url.pathname.split('/files/')[1];
    const file = id ? this.files.get(id) : undefined;
    if (id && !file) return json(404, { error: { message: `File not found: ${id}.` } });

    if (method === 'GET' && file) return json(200, pick(file, url.searchParams.get('fields')!));
    if (method === 'GET') {
      const q = url.searchParams.get('q')!;
      const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)![1].replace(/\\(.)/g, '$1');
      const parent = /'([^']+)' in parents/.exec(q)![1];
      const files = [...this.files.values()].filter(
        (f) => f.name === name && f.mimeType === FOLDER && !f.trashed && f.parents.includes(parent),
      );
      return json(200, { files: files.map((f) => ({ id: f.id })) });
    }
    if (method === 'DELETE') {
      this.files.delete(id);
      return new Response(null, { status: 204 });
    }

    const { metadata, content } = upload
      ? await parseMultipart(init)
      : { metadata: JSON.parse(init.body as string), content: undefined };
    if (method === 'POST') {
      const created: FakeFile = {
        id: `f${this.next++}`,
        name: metadata.name,
        mimeType: metadata.mimeType ?? 'application/pdf',
        parents: metadata.parents ?? ['root'],
        trashed: false,
        content,
      };
      this.files.set(created.id, created);
      return json(200, { id: created.id });
    }
    if (method === 'PATCH' && file) {
      file.name = metadata.name ?? file.name;
      file.content = content ?? file.content;
      const remove = url.searchParams.get('removeParents')?.split(',') ?? [];
      const add = url.searchParams.get('addParents')?.split(',') ?? [];
      file.parents = [...file.parents.filter((p) => !remove.includes(p)), ...add];
      return json(200, { id: file.id });
    }
    return json(400, { error: { message: 'unsupported' } });
  };

  /** Paths of all non-folder files, e.g. "DocScanner/Receipts/A.pdf". */
  paths(): string[] {
    const path = (f: FakeFile): string =>
      f.parents[0] === 'root' ? f.name : `${path(this.files.get(f.parents[0])!)}/${f.name}`;
    return [...this.files.values()]
      .filter((f) => f.mimeType !== FOLDER && !f.trashed)
      .map(path)
      .sort();
  }

  folder(name: string): FakeFile {
    return [...this.files.values()].find((f) => f.name === name && f.mimeType === FOLDER && !f.trashed)!;
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const pick = (file: FakeFile, fields: string) =>
  Object.fromEntries(fields.split(',').map((f) => [f, file[f as keyof FakeFile]]));

async function parseMultipart(init: RequestInit) {
  const type = (init.headers as Record<string, string>)['Content-Type'];
  const boundary = /^multipart\/related; boundary=(.+)$/.exec(type)![1];
  const parts = (await (init.body as Blob).text()).split(`--${boundary}`).slice(1, -1);
  const body = (part: string) => part.slice(part.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
  return { metadata: JSON.parse(body(parts[0])), content: body(parts[1]) };
}

let nextId = 1;
const doc = (title: string, category: CategoryId = 'receipt'): DocRecord => ({
  id: nextId++,
  title,
  category,
  pageCount: 1,
  text: '',
  createdAt: 0,
  sync: {},
});
const pdf = (text = '%PDF') => new Blob([text], { type: 'application/pdf' });

let drive: FakeDrive;
let token: string | null;
let invalidated: string[];
let cache: Map<string, string>;
const target = () =>
  new DriveTarget(
    { token: async () => token, invalidate: (t) => invalidated.push(t) },
    { get: (k) => cache.get(k) ?? null, set: (k, v) => void cache.set(k, v) },
    drive.fetch,
  );

beforeEach(() => {
  drive = new FakeDrive();
  token = 'good';
  invalidated = [];
  cache = new Map();
});

test('uploads into DocScanner/<Category>, creating the folders once', async () => {
  const t = target();
  await t.push(doc('Costco Receipt Nov 2026'), pdf('%PDF costco'));
  await t.push(doc('Target Receipt Nov 2026'), pdf());
  await t.push(doc('Passport Copy', 'id'), pdf());

  expect(drive.paths()).toEqual([
    'DocScanner/IDs/Passport Copy.pdf',
    'DocScanner/Receipts/Costco Receipt Nov 2026.pdf',
    'DocScanner/Receipts/Target Receipt Nov 2026.pdf',
  ]);
  expect([...drive.files.values()].filter((f) => f.mimeType === FOLDER)).toHaveLength(3);
  expect([...drive.files.values()].find((f) => f.name.startsWith('Costco'))!.content).toBe('%PDF costco');
});

test('reuses folders that already exist, also in a later session', async () => {
  await target().push(doc('A'), pdf());
  cache.clear(); // e.g. browser storage was cleared
  await target().push(doc('B'), pdf());
  expect(drive.paths()).toEqual(['DocScanner/Receipts/A.pdf', 'DocScanner/Receipts/B.pdf']);
});

test('a rename and re-file updates the same file instead of adding one', async () => {
  const t = target();
  const d = doc('Scan');
  const id = await t.push(d, pdf('v1'));
  const again = await t.push({ ...d, title: 'W-2 2025', category: 'tax' }, pdf('v2'), id);
  expect(again).toBe(id);
  expect(drive.paths()).toEqual(['DocScanner/Taxes/W-2 2025.pdf']);
  expect(drive.files.get(id)!.content).toBe('v2');
});

test('uploads afresh if the previous copy was deleted or trashed in Drive', async () => {
  const t = target();
  const d = doc('Doc');
  const first = await t.push(d, pdf());
  drive.files.delete(first);
  const second = await t.push(d, pdf(), first);
  expect(second).not.toBe(first);

  drive.files.get(second)!.trashed = true;
  await t.push(d, pdf(), second);
  expect(drive.paths()).toEqual(['DocScanner/Receipts/Doc.pdf']);
});

test('recreates a folder the user deleted in Drive', async () => {
  await target().push(doc('A'), pdf());
  drive.folder('Receipts').trashed = true;
  // New session: the remembered folder id must be checked, not trusted.
  await target().push(doc('B'), pdf());
  expect(drive.paths()).toContain('DocScanner/Receipts/B.pdf');
  expect(drive.folder('Receipts').trashed).toBe(false);
});

test('remove deletes the file and tolerates it being gone already', async () => {
  const t = target();
  const id = await t.push(doc('Doc'), pdf());
  await t.remove(id);
  expect(drive.paths()).toEqual([]);
  await expect(t.remove(id)).resolves.toBeUndefined();
});

test('quotes in names survive the folder query', async () => {
  // Not a real category, but folder names are escaped the same way.
  const t = target();
  await t.push(doc("Trader Joe's Receipt"), pdf());
  expect(drive.paths()).toEqual(["DocScanner/Receipts/Trader Joe's Receipt.pdf"]);
});

test('not signed in: not ready, and pushing asks for sign-in', async () => {
  token = null;
  expect(await target().isReady()).toBe(false);
  await expect(target().push(doc('Doc'), pdf())).rejects.toBeInstanceOf(NeedsSignIn);
  expect(drive.requests).toEqual([]);
});

test('a rejected token is dropped and reported as needing sign-in', async () => {
  token = 'expired';
  await expect(target().push(doc('Doc'), pdf())).rejects.toBeInstanceOf(NeedsSignIn);
  expect(invalidated).toEqual(['expired']);
});

test('other Drive errors carry Google\'s message', async () => {
  const t = target();
  drive.fetch = async () => json(403, { error: { message: 'The user has exceeded their Drive storage quota' } });
  const failing = new DriveTarget(
    { token: async () => 'good', invalidate: () => {} },
    { get: () => null, set: () => {} },
    drive.fetch,
  );
  void t;
  await expect(failing.push(doc('Doc'), pdf())).rejects.toThrow(/storage quota/);
});
