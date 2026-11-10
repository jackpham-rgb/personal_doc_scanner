import 'dart:io';

import 'package:doc_scanner/models/document.dart';
import 'package:doc_scanner/services/document_store.dart';
import 'package:doc_scanner/services/sync/sync_target.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

Future<DocumentStore> openTestStore() {
  sqfliteFfiInit();
  return DocumentStore.open(
    inMemoryDatabasePath,
    // A fresh factory per store keeps in-memory databases from being shared
    // between tests.
    factory: createDatabaseFactoryFfi(noIsolate: true),
  );
}

Future<DocumentRecord> addDoc(
  DocumentStore store, {
  String title = 'Doc',
  DocCategory category = DocCategory.other,
  String text = '',
  String? vendor,
  String? dir,
  DateTime? createdAt,
}) => store.insert(
  title: title,
  category: category,
  vendor: vendor,
  pageCount: 1,
  ocrText: text,
  dir: dir ?? 'dir_$title',
  createdAt: createdAt ?? DateTime(2026, 1, 1),
);

/// In-memory destination that records what it was asked to do.
class FakeTarget implements SyncTarget {
  FakeTarget({this.id = 'fake'});

  @override
  final String id;

  @override
  String get name => 'Fake';

  bool ready = true;
  Object? failWith;
  int _next = 1;

  /// remote id → `folder/file name`
  final Map<String, String> stored = {};
  final List<String> log = [];

  /// Runs in the middle of every push, to simulate edits during an upload.
  Future<void> Function(DocumentRecord doc)? duringPush;

  @override
  Future<bool> isReady() async => ready;

  @override
  Future<String> push(
    DocumentRecord doc,
    File pdf, {
    String? previousRemoteId,
  }) async {
    if (failWith != null) throw failWith!;
    await duringPush?.call(doc);
    final path = '${doc.category.folder}/${doc.pdfFileName}';
    if (previousRemoteId != null && stored.containsKey(previousRemoteId)) {
      stored[previousRemoteId] = path;
      log.add('replace $path');
      return previousRemoteId;
    }
    final remoteId = 'r${_next++}';
    stored[remoteId] = path;
    log.add('create $path');
    return remoteId;
  }

  @override
  Future<void> remove(String remoteId) async {
    if (failWith != null) throw failWith!;
    stored.remove(remoteId);
    log.add('remove $remoteId');
  }
}
