import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../document_store.dart';
import '../library_files.dart';
import 'sync_target.dart';

/// Keeps every enabled destination up to date with the library.
///
/// Work is derived from the database each run (documents without a current
/// copy, plus tombstones for deleted ones), so anything that fails — no
/// network, app closed mid-upload — is simply picked up by the next run.
class SyncManager extends ChangeNotifier {
  SyncManager({
    required this.store,
    required this.files,
    required this.targets,
    required this.isEnabled,
  });

  final DocumentStore store;
  final LibraryFiles files;
  final List<SyncTarget> targets;

  /// Whether the user has switched a destination on.
  final bool Function(SyncTarget target) isEnabled;

  bool _running = false;
  bool _rerun = false;

  bool get isSyncing => _running;

  /// Message of the most recent failure per destination id, for display.
  final Map<String, String> lastErrors = {};

  /// Runs a sync pass. Calls made while a pass is in progress are coalesced
  /// into one follow-up pass, so callers can fire this freely.
  Future<void> sync() async {
    if (_running) {
      _rerun = true;
      return;
    }
    _running = true;
    notifyListeners();
    try {
      do {
        _rerun = false;
        for (final target in targets) {
          if (!isEnabled(target)) continue;
          await _syncTarget(target);
        }
      } while (_rerun);
    } finally {
      _running = false;
      notifyListeners();
    }
  }

  Future<void> _syncTarget(SyncTarget target) async {
    try {
      if (!await target.isReady()) return;
      lastErrors.remove(target.id);

      for (final tombstone in await store.tombstonesFor(target.id)) {
        await target.remove(tombstone.remoteId);
        await store.removeTombstone(tombstone.id);
      }

      for (final doc in await store.pendingFor(target.id)) {
        final pdf = files.pdf(doc);
        if (!await pdf.exists()) {
          await store.setSyncState(
            doc.id,
            target.id,
            SyncStatus.error,
            error: 'PDF file is missing',
          );
          continue;
        }
        final previous = await store.syncEntry(doc.id, target.id);
        try {
          final remoteId = await target.push(
            doc,
            pdf,
            previousRemoteId: previous?.remoteId,
          );
          // The document may have been deleted while it was uploading; do
          // not resurrect its sync row, clean up the copy just made.
          if (await store.get(doc.id) == null) {
            await target.remove(remoteId);
            continue;
          }
          await store.setSyncState(
            doc.id,
            target.id,
            SyncStatus.synced,
            remoteId: remoteId,
          );
          // It may also have been renamed mid-upload, which marked it
          // pending before the line above overwrote that. Check again.
          final latest = await store.get(doc.id);
          if (latest != null &&
              (latest.title != doc.title || latest.category != doc.category)) {
            await store.setSyncState(doc.id, target.id, SyncStatus.pending);
            _rerun = true;
          }
          notifyListeners();
        } catch (e) {
          if (_isOffline(e)) rethrow;
          await store.setSyncState(
            doc.id,
            target.id,
            SyncStatus.error,
            error: '$e',
          );
          lastErrors[target.id] = '$e';
        }
      }
    } catch (e) {
      // Offline or the destination itself is failing: stop this pass for
      // this destination; everything stays pending for the next one.
      lastErrors[target.id] = _isOffline(e) ? 'No internet connection' : '$e';
    }
  }

  static bool _isOffline(Object e) =>
      e is SocketException ||
      e is TimeoutException ||
      e is http.ClientException;
}
