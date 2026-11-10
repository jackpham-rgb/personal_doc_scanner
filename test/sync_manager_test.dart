import 'dart:io';

import 'package:doc_scanner/models/document.dart';
import 'package:doc_scanner/services/document_store.dart';
import 'package:doc_scanner/services/library_files.dart';
import 'package:doc_scanner/services/sync/sync_manager.dart';
import 'package:doc_scanner/services/sync/sync_target.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support.dart';

void main() {
  late Directory tmp;
  late DocumentStore store;
  late LibraryFiles files;
  late FakeTarget target;
  late Set<String> disabled;

  SyncManager manager([List<SyncTarget>? targets]) => SyncManager(
    store: store,
    files: files,
    targets: targets ?? [target],
    isEnabled: (t) => !disabled.contains(t.id),
  );

  /// Adds a document together with a PDF file on disk.
  Future<DocumentRecord> scanned(
    String title, {
    DocCategory category = DocCategory.receipt,
  }) async {
    final doc = await addDoc(store, title: title, category: category);
    await files.dirFor(doc.dir).create(recursive: true);
    await files.pdf(doc).writeAsString('%PDF');
    return doc;
  }

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('sync_test');
    store = await openTestStore();
    files = LibraryFiles(tmp);
    target = FakeTarget();
    disabled = {};
  });

  tearDown(() async {
    await store.close();
    await tmp.delete(recursive: true);
  });

  test('uploads new documents into their category folder, once', () async {
    final doc = await scanned('Costco Receipt Nov 2026');
    final sync = manager();
    await sync.sync();
    await sync.sync();
    expect(target.log, ['create Receipts/Costco Receipt Nov 2026.pdf']);
    expect((await store.syncEntry(doc.id, 'fake'))!.status, SyncStatus.synced);
  });

  test('a rename or re-file replaces the remote copy', () async {
    final doc = await scanned('Scan');
    final sync = manager();
    await sync.sync();
    final renamed = await store.update(
      doc,
      title: 'W-2 2025',
      category: DocCategory.tax,
    );
    await files.pdf(doc).rename(files.pdf(renamed).path);
    await sync.sync();
    expect(target.stored.values, ['Taxes/W-2 2025.pdf']);
    expect(target.log.last, 'replace Taxes/W-2 2025.pdf');
  });

  test('deleting a document removes its remote copy', () async {
    final doc = await scanned('Old');
    final sync = manager();
    await sync.sync();
    await store.delete(doc.id);
    await sync.sync();
    expect(target.stored, isEmpty);
    expect(await store.tombstonesFor('fake'), isEmpty);
  });

  test('does nothing for a disabled or not-ready target', () async {
    await scanned('Doc');
    disabled = {'fake'};
    await manager().sync();
    expect(target.log, isEmpty);

    disabled = {};
    target.ready = false;
    await manager().sync();
    expect(target.log, isEmpty);
    expect(await store.pendingFor('fake'), hasLength(1));
  });

  test(
    'offline: nothing is marked failed and the next pass catches up',
    () async {
      final a = await scanned('A');
      await scanned('B');
      final sync = manager();
      target.failWith = const SocketException('no route');
      await sync.sync();
      expect(sync.lastErrors['fake'], 'No internet connection');
      expect(await store.syncEntry(a.id, 'fake'), isNull);

      target.failWith = null;
      await sync.sync();
      expect(
        target.stored.values,
        unorderedEquals(['Receipts/A.pdf', 'Receipts/B.pdf']),
      );
      expect(sync.lastErrors, isEmpty);
    },
  );

  test('one bad document does not block the others and is retried', () async {
    final bad = await scanned('Bad');
    await scanned('Good');
    await files.pdf(bad).delete();
    final sync = manager();
    await sync.sync();
    expect(target.stored.values, ['Receipts/Good.pdf']);
    final entry = (await store.syncEntry(bad.id, 'fake'))!;
    expect(entry.status, SyncStatus.error);
    expect(entry.error, contains('missing'));

    await files.pdf(bad).writeAsString('%PDF');
    await sync.sync();
    expect(target.stored.values, contains('Receipts/Bad.pdf'));
  });

  test('a target error is recorded on the document and shown', () async {
    final doc = await scanned('Doc');
    target.failWith = StateError('quota exceeded');
    final sync = manager();
    await sync.sync();
    expect(sync.lastErrors['fake'], contains('quota exceeded'));
    expect((await store.syncEntry(doc.id, 'fake'))!.status, SyncStatus.error);
  });

  test('each target is tracked separately', () async {
    await scanned('Doc');
    final other = FakeTarget(id: 'other')..failWith = StateError('down');
    await manager([target, other]).sync();
    expect(target.stored.values, ['Receipts/Doc.pdf']);
    expect(await store.pendingFor('fake'), isEmpty);
    expect(await store.pendingFor('other'), hasLength(1));
  });

  test('a rename during upload is not lost', () async {
    final doc = await scanned('Before');
    var renamed = false;
    target.duringPush = (_) async {
      if (renamed) return;
      renamed = true;
      final updated = await store.update(doc, title: 'After');
      await files.pdf(doc).rename(files.pdf(updated).path);
    };
    await manager().sync();
    expect(target.stored.values, ['Receipts/After.pdf']);
    expect(await store.pendingFor('fake'), isEmpty);
  });

  test('a delete during upload does not leave a remote copy behind', () async {
    final doc = await scanned('Doomed');
    target.duringPush = (_) => store.delete(doc.id);
    await manager().sync();
    expect(target.stored, isEmpty);
    expect(await store.syncEntriesFor(doc.id), isEmpty);
  });

  test('overlapping calls are coalesced into a follow-up pass', () async {
    await scanned('First');
    final sync = manager();
    target.duringPush = (doc) async {
      if (doc.title == 'First') {
        await scanned('Second');
        await sync.sync(); // returns at once: a pass is already running
      }
    };
    await sync.sync();
    expect(
      target.stored.values,
      unorderedEquals(['Receipts/First.pdf', 'Receipts/Second.pdf']),
    );
    expect(sync.isSyncing, isFalse);
  });
}
