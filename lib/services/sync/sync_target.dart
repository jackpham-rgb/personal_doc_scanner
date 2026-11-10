import 'dart:io';

import '../../models/document.dart';

/// A place finished PDFs are copied to: a folder on the phone, a cloud drive…
///
/// Destinations store files as `<category folder>/<title>.pdf`. To add
/// another service (OneDrive, Dropbox), implement this interface and register
/// it in `AppController`.
abstract class SyncTarget {
  /// Stable identifier, used as a database and settings key.
  String get id;

  /// Name shown in the UI.
  String get name;

  /// Whether uploads can run right now without showing any UI (signed in,
  /// supported on this device, …).
  Future<bool> isReady();

  /// Stores [pdf] for [doc] and returns an identifier for the stored copy.
  ///
  /// If [previousRemoteId] is given, the document was synced before and has
  /// since been renamed or re-filed: the old copy must be replaced, not
  /// duplicated.
  Future<String> push(DocumentRecord doc, File pdf, {String? previousRemoteId});

  /// Deletes a stored copy. Must succeed if the copy is already gone.
  Future<void> remove(String remoteId);
}
