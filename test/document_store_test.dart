import 'package:doc_scanner/models/document.dart';
import 'package:doc_scanner/services/document_store.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support.dart';

void main() {
  late DocumentStore store;

  setUp(() async => store = await openTestStore());
  tearDown(() => store.close());

  List<String> titles(List<DocumentRecord> docs) =>
      docs.map((d) => d.title).toList();

  group('search', () {
    setUp(() async {
      await addDoc(
        store,
        title: 'GEICO Car Insurance Jun 2026',
        category: DocCategory.insurance,
        vendor: 'GEICO',
        text: 'Automobile insurance policy declarations\nPolicy 4321',
        createdAt: DateTime(2026, 3, 1),
      );
      await addDoc(
        store,
        title: 'Costco Receipt Nov 2025',
        category: DocCategory.receipt,
        vendor: 'Costco',
        text: 'COSTCO WHOLESALE\nKS PAPER TOWEL 21.99\nTOTAL 124.53',
        createdAt: DateTime(2025, 11, 5),
      );
      await addDoc(
        store,
        title: 'Passport Copy',
        category: DocCategory.id,
        text: 'PASSPORT\nUnited States of America\nSurname DOE',
        createdAt: DateTime(2026, 6, 1),
      );
    });

    test('empty query lists everything, newest scan first', () async {
      expect(titles(await store.search()), [
        'Passport Copy',
        'GEICO Car Insurance Jun 2026',
        'Costco Receipt Nov 2025',
      ]);
    });

    test('finds documents by words in the title', () async {
      expect(titles(await store.search(query: 'Car Insurance')), [
        'GEICO Car Insurance Jun 2026',
      ]);
    });

    test('finds documents by words that only appear in the scan', () async {
      expect(titles(await store.search(query: 'paper towel')), [
        'Costco Receipt Nov 2025',
      ]);
      expect(titles(await store.search(query: 'surname')), ['Passport Copy']);
    });

    test('is case-insensitive and matches word prefixes', () async {
      expect(titles(await store.search(query: 'COSTCO')), [
        'Costco Receipt Nov 2025',
      ]);
      expect(titles(await store.search(query: 'insur')), [
        'GEICO Car Insurance Jun 2026',
      ]);
    });

    test('requires every word to match', () async {
      expect(await store.search(query: 'costco passport'), isEmpty);
    });

    test('finds by category name, singular or plural', () async {
      expect(titles(await store.search(query: 'receipts')), [
        'Costco Receipt Nov 2025',
      ]);
      expect(titles(await store.search(query: 'ids')), ['Passport Copy']);
    });

    test('falls back to substring match inside a word', () async {
      expect(titles(await store.search(query: 'holesale')), [
        'Costco Receipt Nov 2025',
      ]);
    });

    test('returns an excerpt of the matching text', () async {
      final hit = (await store.search(query: 'towel')).single;
      expect(hit.snippet, contains('PAPER TOWEL'));
    });

    test('combines with the category filter', () async {
      expect(
        await store.search(query: 'costco', category: DocCategory.id),
        isEmpty,
      );
      expect(titles(await store.search(category: DocCategory.id)), [
        'Passport Copy',
      ]);
    });

    test('punctuation and operators in the query are harmless', () async {
      expect(await store.search(query: '"AND OR NOT ( * -'), isEmpty);
      expect(await store.search(query: '%'), hasLength(3));
      expect(titles(await store.search(query: "costco's")), isEmpty);
    });

    test('follows renames and deletions', () async {
      final doc = (await store.search(query: 'passport')).single;
      await store.update(doc, title: 'Jane Travel Document');
      expect(titles(await store.search(query: 'travel')), [
        'Jane Travel Document',
      ]);
      await store.delete(doc.id);
      expect(await store.search(query: 'travel'), isEmpty);
      expect(await store.search(query: 'surname'), isEmpty);
    });
  });

  test('uniqueTitle numbers duplicates, ignoring case', () async {
    expect(await store.uniqueTitle('Scan'), 'Scan');
    final first = await addDoc(store, title: 'Scan');
    await addDoc(store, title: 'Scan (2)');
    expect(await store.uniqueTitle('scan'), 'scan (3)');
    expect(await store.uniqueTitle('Scan', exceptId: first.id), 'Scan');
  });

  test('categoryCounts', () async {
    await addDoc(store, title: 'a', category: DocCategory.receipt);
    await addDoc(store, title: 'b', category: DocCategory.receipt);
    await addDoc(store, title: 'c', category: DocCategory.id);
    expect(await store.categoryCounts(), {
      DocCategory.receipt: 2,
      DocCategory.id: 1,
    });
  });

  group('sync bookkeeping', () {
    test('new documents are pending for every target', () async {
      final doc = await addDoc(store);
      expect((await store.pendingFor('drive')).single.id, doc.id);
      await store.setSyncState(
        doc.id,
        'drive',
        SyncStatus.synced,
        remoteId: 'x',
      );
      expect(await store.pendingFor('drive'), isEmpty);
      expect((await store.pendingFor('folder')).single.id, doc.id);
    });

    test(
      'editing marks a synced document pending but keeps its remote id',
      () async {
        final doc = await addDoc(store);
        await store.setSyncState(
          doc.id,
          'drive',
          SyncStatus.synced,
          remoteId: 'x',
        );
        await store.update(doc, category: DocCategory.receipt);
        expect(await store.pendingFor('drive'), hasLength(1));
        expect((await store.syncEntry(doc.id, 'drive'))!.remoteId, 'x');
      },
    );

    test('a failed attempt keeps the last known remote id', () async {
      final doc = await addDoc(store);
      await store.setSyncState(
        doc.id,
        'drive',
        SyncStatus.synced,
        remoteId: 'x',
      );
      await store.setSyncState(
        doc.id,
        'drive',
        SyncStatus.error,
        error: 'boom',
      );
      final entry = (await store.syncEntry(doc.id, 'drive'))!;
      expect(entry.status, SyncStatus.error);
      expect(entry.remoteId, 'x');
      expect(entry.error, 'boom');
    });

    test('deleting leaves tombstones only for copies that exist', () async {
      final doc = await addDoc(store);
      await store.setSyncState(
        doc.id,
        'drive',
        SyncStatus.synced,
        remoteId: 'x',
      );
      await store.setSyncState(doc.id, 'folder', SyncStatus.error, error: 'e');
      await store.delete(doc.id);
      expect((await store.tombstonesFor('drive')).single.remoteId, 'x');
      expect(await store.tombstonesFor('folder'), isEmpty);
      expect(await store.syncEntriesFor(doc.id), isEmpty);
    });

    test('syncedDocIds needs every active target', () async {
      final a = await addDoc(store, title: 'a');
      final b = await addDoc(store, title: 'b');
      await store.setSyncState(a.id, 'drive', SyncStatus.synced, remoteId: '1');
      await store.setSyncState(
        a.id,
        'folder',
        SyncStatus.synced,
        remoteId: '2',
      );
      await store.setSyncState(b.id, 'drive', SyncStatus.synced, remoteId: '3');
      expect(await store.syncedDocIds(['drive', 'folder']), {a.id});
      expect(await store.syncedDocIds(['drive']), {a.id, b.id});
      expect(await store.syncedDocIds([]), isEmpty);
    });
  });
}
