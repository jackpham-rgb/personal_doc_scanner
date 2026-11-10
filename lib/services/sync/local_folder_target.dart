import 'dart:io';

import 'package:flutter/services.dart';

import '../../models/document.dart';
import 'sync_target.dart';

/// Copies PDFs into the phone's shared `Documents/DocScanner/<Category>`
/// folder, where the Files app and any folder-sync app (OneDrive/Dropbox
/// sync tools, Syncthing, …) can see them.
///
/// Uses Android's MediaStore through a small platform channel implemented in
/// `MainActivity.kt`, so no storage permission is needed.
class LocalFolderTarget implements SyncTarget {
  static const _channel = MethodChannel('doc_scanner/public_folder');
  static const rootFolder = 'Documents/DocScanner';

  @override
  String get id => 'local_folder';

  @override
  String get name => 'Phone folder';

  /// Scoped MediaStore writes need Android 10 or newer.
  @override
  Future<bool> isReady() async {
    if (!Platform.isAndroid) return false;
    try {
      return await _channel.invokeMethod<bool>('isSupported') ?? false;
    } on MissingPluginException {
      return false;
    }
  }

  @override
  Future<String> push(
    DocumentRecord doc,
    File pdf, {
    String? previousRemoteId,
  }) async {
    // Write the new copy before removing the old one so a failure half-way
    // never leaves the folder without the document.
    final uri = await _channel.invokeMethod<String>('save', {
      'source': pdf.path,
      'relativeDir': '$rootFolder/${doc.category.folder}',
      'name': doc.pdfFileName,
    });
    if (previousRemoteId != null) await remove(previousRemoteId);
    return uri!;
  }

  @override
  Future<void> remove(String remoteId) =>
      _channel.invokeMethod<void>('delete', {'uri': remoteId});
}
