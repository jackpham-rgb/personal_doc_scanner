import 'package:sqflite/sqflite.dart';

import '../models/document.dart';

/// Sync state of one document for one sync destination.
class SyncEntry {
  const SyncEntry({
    required this.docId,
    required this.target,
    required this.status,
    this.remoteId,
    this.error,
  });

  final int docId;
  final String target;
  final SyncStatus status;
  final String? remoteId;
  final String? error;
}

enum SyncStatus { pending, synced, error }

/// A remote copy that still has to be removed because its document was
/// deleted on the phone.
class Tombstone {
  const Tombstone(this.id, this.target, this.remoteId);
  final int id;
  final String target;
  final String remoteId;
}

/// The local index: document metadata, a full-text index over the OCR text,
/// and per-destination sync bookkeeping.
class DocumentStore {
  DocumentStore._(this._db);

  final Database _db;

  static const _schemaVersion = 1;

  /// Opens (and if needed creates) the index at [path]. [factory] lets tests
  /// supply an in-memory FFI database.
  static Future<DocumentStore> open(
    String path, {
    DatabaseFactory? factory,
  }) async {
    final db = await (factory ?? databaseFactory).openDatabase(
      path,
      options: OpenDatabaseOptions(
        version: _schemaVersion,
        onConfigure: (db) => db.execute('PRAGMA foreign_keys = ON'),
        onCreate: (db, _) => _create(db),
      ),
    );
    return DocumentStore._(db);
  }

  static Future<void> _create(Database db) async {
    await db.execute('''
      CREATE TABLE documents(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        vendor TEXT,
        doc_date TEXT,
        amount REAL,
        page_count INTEGER NOT NULL,
        ocr_text TEXT NOT NULL,
        dir TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )''');
    // FTS4 rather than FTS5: it is present in the SQLite build of every
    // Android version this app supports.
    await db.execute('''
      CREATE VIRTUAL TABLE documents_fts USING fts4(
        title, vendor, category, body, tokenize=unicode61
      )''');
    await db.execute('''
      CREATE TABLE sync_state(
        doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        target TEXT NOT NULL,
        status TEXT NOT NULL,
        remote_id TEXT,
        error TEXT,
        PRIMARY KEY(doc_id, target)
      )''');
    await db.execute('''
      CREATE TABLE sync_tombstones(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target TEXT NOT NULL,
        remote_id TEXT NOT NULL
      )''');
  }

  Future<void> close() => _db.close();

  // ------------------------------------------------------------- documents

  Future<DocumentRecord> insert({
    required String title,
    required DocCategory category,
    required int pageCount,
    required String ocrText,
    required String dir,
    required DateTime createdAt,
    String? vendor,
    DateTime? docDate,
    double? amount,
  }) async {
    final id = await _db.transaction((txn) async {
      final id = await txn.insert('documents', {
        'title': title,
        'category': category.name,
        'vendor': vendor,
        'doc_date': docDate?.toIso8601String().substring(0, 10),
        'amount': amount,
        'page_count': pageCount,
        'ocr_text': ocrText,
        'dir': dir,
        'created_at': createdAt.millisecondsSinceEpoch,
      });
      await _writeFts(txn, id, title, vendor, category, ocrText);
      return id;
    });
    return (await get(id))!;
  }

  Future<DocumentRecord?> get(int id) async {
    final rows = await _db.query('documents', where: 'id = ?', whereArgs: [id]);
    return rows.isEmpty ? null : DocumentRecord.fromRow(rows.first);
  }

  /// Renames and/or re-files a document and marks it for re-sync so every
  /// destination picks up the new name and folder.
  Future<DocumentRecord> update(
    DocumentRecord doc, {
    String? title,
    DocCategory? category,
  }) async {
    final updated = doc.copyWith(title: title, category: category);
    await _db.transaction((txn) async {
      await txn.update(
        'documents',
        {'title': updated.title, 'category': updated.category.name},
        where: 'id = ?',
        whereArgs: [doc.id],
      );
      await _writeFts(
        txn,
        doc.id,
        updated.title,
        updated.vendor,
        updated.category,
        updated.ocrText,
      );
      await txn.update(
        'sync_state',
        {'status': SyncStatus.pending.name, 'error': null},
        where: 'doc_id = ?',
        whereArgs: [doc.id],
      );
    });
    return updated;
  }

  /// Deletes a document from the index. Remote copies that were already
  /// uploaded are recorded as tombstones so the sync manager can remove them.
  Future<void> delete(int id) async {
    await _db.transaction((txn) async {
      final synced = await txn.query(
        'sync_state',
        where: 'doc_id = ? AND remote_id IS NOT NULL',
        whereArgs: [id],
      );
      for (final row in synced) {
        await txn.insert('sync_tombstones', {
          'target': row['target'],
          'remote_id': row['remote_id'],
        });
      }
      await txn.delete('documents_fts', where: 'docid = ?', whereArgs: [id]);
      await txn.delete('sync_state', where: 'doc_id = ?', whereArgs: [id]);
      await txn.delete('documents', where: 'id = ?', whereArgs: [id]);
    });
  }

  static Future<void> _writeFts(
    Transaction txn,
    int id,
    String title,
    String? vendor,
    DocCategory category,
    String body,
  ) async {
    await txn.delete('documents_fts', where: 'docid = ?', whereArgs: [id]);
    await txn.insert('documents_fts', {
      'docid': id,
      'title': title,
      'vendor': vendor ?? '',
      // Index both forms so "receipt" and "receipts" each find the document.
      'category': '${category.label} ${category.folder}',
      'body': body,
    });
  }

  Future<bool> titleExists(String title, {int? exceptId}) async {
    final rows = await _db.query(
      'documents',
      columns: ['id'],
      where: 'title = ? COLLATE NOCASE AND id != ?',
      whereArgs: [title, exceptId ?? -1],
      limit: 1,
    );
    return rows.isNotEmpty;
  }

  /// Returns [wanted], or "[wanted] (2)", "(3)"… if that name is taken, so two
  /// documents never fight over one file name in a sync destination.
  Future<String> uniqueTitle(String wanted, {int? exceptId}) async {
    var candidate = wanted;
    for (var n = 2; await titleExists(candidate, exceptId: exceptId); n++) {
      candidate = '$wanted ($n)';
    }
    return candidate;
  }

  Future<Set<String>> allDirs() async {
    final rows = await _db.query('documents', columns: ['dir']);
    return {for (final r in rows) r['dir']! as String};
  }

  Future<Map<DocCategory, int>> categoryCounts() async {
    final rows = await _db.rawQuery(
      'SELECT category, COUNT(*) AS n FROM documents GROUP BY category',
    );
    return {
      for (final r in rows)
        DocCategory.fromName(r['category'] as String?): r['n']! as int,
    };
  }

  // ---------------------------------------------------------------- search

  /// Lists documents, newest first. With a [query], returns only documents
  /// whose title, vendor, category or OCR text contain every word of it
  /// (matching on word prefixes, so "insur" finds "insurance").
  Future<List<DocumentRecord>> search({
    String query = '',
    DocCategory? category,
  }) async {
    final match = ftsQuery(query);
    final categoryClause = category == null ? '' : 'AND d.category = ?';
    final categoryArgs = [if (category != null) category.name];

    if (match == null) {
      final rows = await _db.rawQuery(
        'SELECT d.* FROM documents d WHERE 1=1 $categoryClause '
        'ORDER BY d.created_at DESC',
        categoryArgs,
      );
      return rows.map(DocumentRecord.fromRow).toList();
    }

    final rows = await _db.rawQuery(
      'SELECT d.*, '
      "snippet(documents_fts, '', '', '…', 3, 12) AS snippet "
      'FROM documents_fts f JOIN documents d ON d.id = f.docid '
      'WHERE documents_fts MATCH ? $categoryClause '
      'ORDER BY d.created_at DESC',
      [match, ...categoryArgs],
    );
    if (rows.isNotEmpty) return rows.map(DocumentRecord.fromRow).toList();

    // OCR sometimes glues words together or drops a leading character, which
    // prefix matching cannot recover from. Fall back to a substring scan.
    final like = '%${query.trim().replaceAll(RegExp(r'[%_]'), ' ')}%';
    final fallback = await _db.rawQuery(
      'SELECT d.* FROM documents d '
      'WHERE (d.ocr_text LIKE ? OR d.title LIKE ?) $categoryClause '
      'ORDER BY d.created_at DESC',
      [like, like, ...categoryArgs],
    );
    return fallback.map(DocumentRecord.fromRow).toList();
  }

  /// Turns free text into an FTS MATCH expression: every word becomes a
  /// quoted prefix term, all of which must match. Returns null if the query
  /// has no searchable characters.
  static String? ftsQuery(String query) {
    final terms = query
        .toLowerCase()
        .split(RegExp(r'[^\p{L}\p{N}]+', unicode: true))
        .where((t) => t.isNotEmpty)
        .map((t) => '"$t"*')
        .toList();
    return terms.isEmpty ? null : terms.join(' ');
  }

  // ------------------------------------------------------------------ sync

  /// Documents that [target] does not have an up-to-date copy of.
  Future<List<DocumentRecord>> pendingFor(String target) async {
    final rows = await _db.rawQuery(
      'SELECT d.* FROM documents d '
      'LEFT JOIN sync_state s ON s.doc_id = d.id AND s.target = ? '
      "WHERE s.status IS NULL OR s.status != 'synced' "
      'ORDER BY d.created_at',
      [target],
    );
    return rows.map(DocumentRecord.fromRow).toList();
  }

  Future<SyncEntry?> syncEntry(int docId, String target) async {
    final rows = await _db.query(
      'sync_state',
      where: 'doc_id = ? AND target = ?',
      whereArgs: [docId, target],
    );
    return rows.isEmpty ? null : _entry(rows.first);
  }

  Future<List<SyncEntry>> syncEntriesFor(int docId) async {
    final rows = await _db.query(
      'sync_state',
      where: 'doc_id = ?',
      whereArgs: [docId],
    );
    return rows.map(_entry).toList();
  }

  /// Ids of documents with a current copy in every one of [targets].
  Future<Set<int>> syncedDocIds(Iterable<String> targets) async {
    final list = targets.toList();
    if (list.isEmpty) return {};
    final rows = await _db.rawQuery(
      'SELECT doc_id FROM sync_state '
      "WHERE status = 'synced' AND target IN (${list.map((_) => '?').join(',')}) "
      'GROUP BY doc_id HAVING COUNT(*) = ?',
      [...list, list.length],
    );
    return {for (final r in rows) r['doc_id']! as int};
  }

  Future<void> setSyncState(
    int docId,
    String target,
    SyncStatus status, {
    String? remoteId,
    String? error,
  }) async {
    final existing = await syncEntry(docId, target);
    await _db.insert('sync_state', {
      'doc_id': docId,
      'target': target,
      'status': status.name,
      // A failed attempt must not forget where the last good copy lives.
      'remote_id': remoteId ?? existing?.remoteId,
      'error': error,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  /// Forgets everything known about [target], e.g. after disconnecting it.
  Future<void> clearTarget(String target) async {
    await _db.delete('sync_state', where: 'target = ?', whereArgs: [target]);
    await _db.delete(
      'sync_tombstones',
      where: 'target = ?',
      whereArgs: [target],
    );
  }

  Future<List<Tombstone>> tombstonesFor(String target) async {
    final rows = await _db.query(
      'sync_tombstones',
      where: 'target = ?',
      whereArgs: [target],
    );
    return [
      for (final r in rows)
        Tombstone(r['id']! as int, target, r['remote_id']! as String),
    ];
  }

  Future<void> removeTombstone(int id) =>
      _db.delete('sync_tombstones', where: 'id = ?', whereArgs: [id]);

  static SyncEntry _entry(Map<String, Object?> row) => SyncEntry(
    docId: row['doc_id']! as int,
    target: row['target']! as String,
    status: SyncStatus.values.firstWhere(
      (s) => s.name == row['status'],
      orElse: () => SyncStatus.pending,
    ),
    remoteId: row['remote_id'] as String?,
    error: row['error'] as String?,
  );
}
