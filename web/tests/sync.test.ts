import { beforeEach, expect, test } from 'vitest';
import { type DocStore, pdfKey } from '../src/store';
import { SyncManager } from '../src/sync/manager';
import { NeedsSignIn, type SyncTarget } from '../src/sync/target';
import { addDoc, FakeTarget, openStore } from './support';

let store: DocStore;
let target: FakeTarget;
let disabled: Set<string>;
const manager = (targets: SyncTarget[] = [target]) =>
  new SyncManager(store, targets, (t) => !disabled.has(t.id));
const stored = () => [...target.stored.values()].sort();

beforeEach(async () => {
  store = await openStore();
  target = new FakeTarget();
  disabled = new Set();
});

test('uploads new documents into their category folder, once', async () => {
  const doc = await addDoc(store, 'Costco Receipt Nov 2026');
  const sync = manager();
  await sync.sync();
  await sync.sync();
  expect(target.log).toEqual(['create Receipts/Costco Receipt Nov 2026.pdf']);
  expect((await store.get(doc.id))!.sync.fake.status).toBe('synced');
});

test('a rename or re-file replaces the remote copy', async () => {
  const doc = await addDoc(store, 'Scan');
  const sync = manager();
  await sync.sync();
  await store.edit(doc.id, { title: 'W-2 2025', category: 'tax' });
  await sync.sync();
  expect(stored()).toEqual(['Taxes/W-2 2025.pdf']);
  expect(target.log.at(-1)).toBe('replace Taxes/W-2 2025.pdf');
});

test('deleting a document removes its remote copy', async () => {
  const doc = await addDoc(store, 'Old');
  const sync = manager();
  await sync.sync();
  await store.remove(doc.id);
  await sync.sync();
  expect(stored()).toEqual([]);
  expect(await store.tombstones('fake')).toEqual([]);
});

test('does nothing for a disabled or not-ready target', async () => {
  await addDoc(store, 'Doc');
  disabled = new Set(['fake']);
  await manager().sync();
  disabled = new Set();
  target.ready = false;
  await manager().sync();
  expect(target.log).toEqual([]);
});

test('offline: nothing is marked failed and the next pass catches up', async () => {
  const a = await addDoc(store, 'A');
  await addDoc(store, 'B');
  const sync = manager();
  target.failWith = new TypeError('Failed to fetch');
  await sync.sync();
  expect(sync.lastErrors.fake).toBe('No internet connection');
  expect((await store.get(a.id))!.sync.fake).toBeUndefined();

  target.failWith = undefined;
  await sync.sync();
  expect(stored()).toEqual(['Receipts/A.pdf', 'Receipts/B.pdf']);
  expect(sync.lastErrors).toEqual({});
});

test('signed out: documents wait instead of being marked failed', async () => {
  const doc = await addDoc(store, 'Doc');
  const sync = manager();
  target.failWith = new NeedsSignIn();
  await sync.sync();
  expect(sync.lastErrors.fake).toMatch(/sign in/i);
  expect((await store.get(doc.id))!.sync.fake).toBeUndefined();
});

test('one bad document does not block the others', async () => {
  const bad = await addDoc(store, 'Bad');
  await addDoc(store, 'Good');
  // Simulate a lost PDF.
  const db = (store as unknown as { db: IDBDatabase & { delete(s: string, k: string): Promise<void> } }).db;
  await db.delete('files', pdfKey(bad.id));
  await manager().sync();
  expect(stored()).toEqual(['Receipts/Good.pdf']);
  expect((await store.get(bad.id))!.sync.fake).toMatchObject({ status: 'error' });
});

test('a target error is recorded on the document and retried later', async () => {
  const doc = await addDoc(store, 'Doc');
  target.failWith = new Error('quota exceeded');
  const sync = manager();
  await sync.sync();
  expect(sync.lastErrors.fake).toBe('quota exceeded');
  expect((await store.get(doc.id))!.sync.fake).toEqual({ status: 'error', error: 'quota exceeded' });

  target.failWith = undefined;
  await sync.sync();
  expect(stored()).toEqual(['Receipts/Doc.pdf']);
});

test('each target is tracked separately', async () => {
  const doc = await addDoc(store, 'Doc');
  const other = new FakeTarget('other');
  other.failWith = new Error('down');
  await manager([target, other]).sync();
  const { sync } = (await store.get(doc.id))!;
  expect(sync.fake.status).toBe('synced');
  expect(sync.other.status).toBe('error');
});

test('a rename during upload is not lost', async () => {
  const doc = await addDoc(store, 'Before');
  let renamed = false;
  target.duringPush = async () => {
    if (renamed) return;
    renamed = true;
    await store.edit(doc.id, { title: 'After' });
  };
  await manager().sync();
  expect(stored()).toEqual(['Receipts/After.pdf']);
  expect((await store.get(doc.id))!.sync.fake.status).toBe('synced');
});

test('a delete during upload does not leave a remote copy behind', async () => {
  const doc = await addDoc(store, 'Doomed');
  target.duringPush = () => store.remove(doc.id);
  await manager().sync();
  expect(stored()).toEqual([]);
});

test('overlapping calls are coalesced into a follow-up pass', async () => {
  await addDoc(store, 'First', 'receipt', 1);
  const sync = manager();
  const states: boolean[] = [];
  sync.subscribe(() => states.push(sync.isSyncing));
  target.duringPush = async (doc) => {
    if (doc.title === 'First') {
      await addDoc(store, 'Second', 'receipt', 2);
      await sync.sync(); // returns at once: a pass is already running
    }
  };
  await sync.sync();
  expect(stored()).toEqual(['Receipts/First.pdf', 'Receipts/Second.pdf']);
  expect(states[0]).toBe(true);
  expect(states.at(-1)).toBe(false);
});
