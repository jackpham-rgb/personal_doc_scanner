import 'dart:io';

import 'package:google_sign_in/google_sign_in.dart';
import 'package:googleapis/drive/v3.dart' as drive;
import 'package:http/http.dart' as http;

import '../../models/document.dart';
import '../app_settings.dart';
import 'sync_target.dart';

/// Uploads PDFs to `DocScanner/<Category>/` in the user's Google Drive, from
/// where Google Drive for desktop makes them appear on a laptop.
///
/// Uses the `drive.file` scope: the app can only see and change files it
/// created itself, never the rest of the Drive.
///
/// Needs a one-time Google Cloud OAuth client for this app's package name and
/// signing key — see "Google Drive setup" in the README.
class GoogleDriveTarget implements SyncTarget {
  GoogleDriveTarget(this._settings);

  final AppSettings _settings;

  static const rootFolder = 'DocScanner';
  static const _scopes = [drive.DriveApi.driveFileScope];
  static const _folderMime = 'application/vnd.google-apps.folder';
  static const _folderKeyPrefix = 'drive.folder.';

  bool _initialized = false;

  /// Folder ids already checked against Drive in this app session.
  final Map<String, String> _verifiedFolders = {};

  @override
  String get id => 'google_drive';

  @override
  String get name => 'Google Drive';

  Future<GoogleSignInAuthorizationClient> _auth() async {
    if (!_initialized) {
      await GoogleSignIn.instance.initialize();
      _initialized = true;
    }
    return GoogleSignIn.instance.authorizationClient;
  }

  /// Shows Google's consent screen. Call from a button press.
  Future<void> connect() async {
    await (await _auth()).authorizeScopes(_scopes);
  }

  /// Signs out and forgets cached folder ids. Files already in Drive stay.
  Future<void> disconnect() async {
    await _auth();
    await GoogleSignIn.instance.signOut();
    _verifiedFolders.clear();
    await _settings.removeWithPrefix(_folderKeyPrefix);
  }

  @override
  Future<bool> isReady() async {
    try {
      return await (await _auth()).authorizationForScopes(_scopes) != null;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<String> push(
    DocumentRecord doc,
    File pdf, {
    String? previousRemoteId,
  }) => _withApi((api) async {
    final folderId = await _folder(
      api,
      doc.category.folder,
      parent: await _folder(api, rootFolder),
    );
    final length = await pdf.length();
    drive.Media media() =>
        drive.Media(pdf.openRead(), length, contentType: 'application/pdf');

    if (previousRemoteId != null) {
      try {
        final current = await api.files.get(
          previousRemoteId,
          $fields: 'id,parents,trashed',
        ) as drive.File;
        if (current.trashed != true) {
          final oldParents = current.parents ?? const <String>[];
          final move = !oldParents.contains(folderId);
          final updated = await api.files.update(
            drive.File()..name = doc.pdfFileName,
            previousRemoteId,
            addParents: move ? folderId : null,
            removeParents: move && oldParents.isNotEmpty
                ? oldParents.join(',')
                : null,
            uploadMedia: media(),
            $fields: 'id',
          );
          return updated.id!;
        }
      } on drive.DetailedApiRequestError catch (e) {
        // The old copy was deleted in Drive; fall through and upload afresh.
        if (e.status != 404) rethrow;
      }
    }

    final created = await api.files.create(
      drive.File()
        ..name = doc.pdfFileName
        ..parents = [folderId],
      uploadMedia: media(),
      $fields: 'id',
    );
    return created.id!;
  });

  @override
  Future<void> remove(String remoteId) => _withApi((api) async {
    try {
      await api.files.delete(remoteId);
    } on drive.DetailedApiRequestError catch (e) {
      if (e.status != 404) rethrow;
    }
  });

  /// Runs [body] with an authorised Drive client. If Drive rejects the access
  /// token (it can be revoked or expire early), drops it and retries once
  /// with a fresh one.
  Future<T> _withApi<T>(Future<T> Function(drive.DriveApi api) body) async {
    final auth = await _auth();
    for (var attempt = 0; ; attempt++) {
      final authz = await auth.authorizationForScopes(_scopes);
      if (authz == null) {
        throw const DriveNotConnected();
      }
      final client = _BearerClient(authz.accessToken);
      try {
        return await body(drive.DriveApi(client));
      } on drive.DetailedApiRequestError catch (e) {
        if (e.status != 401 || attempt > 0) rethrow;
        await auth.clearAuthorizationToken(accessToken: authz.accessToken);
      } finally {
        client.close();
      }
    }
  }

  /// Finds or creates the folder [name] under [parent] (My Drive if null).
  Future<String> _folder(
    drive.DriveApi api,
    String name, {
    String? parent,
  }) async {
    final key = '$_folderKeyPrefix${parent ?? 'root'}/$name';
    final verified = _verifiedFolders[key];
    if (verified != null) return verified;

    // A remembered id is only trusted after checking the folder still
    // exists: the user may have deleted it in Drive since the last run.
    final remembered = _settings.getString(key);
    if (remembered != null && await _folderExists(api, remembered)) {
      return _verifiedFolders[key] = remembered;
    }

    final escaped = name.replaceAll(r'\', r'\\').replaceAll("'", r"\'");
    final found = await api.files.list(
      q:
          "name = '$escaped' and mimeType = '$_folderMime' and trashed = false "
          "and '${parent ?? 'root'}' in parents",
      spaces: 'drive',
      pageSize: 1,
      $fields: 'files(id)',
    );
    var folderId = found.files?.firstOrNull?.id;
    if (folderId == null) {
      final created = await api.files.create(
        drive.File()
          ..name = name
          ..mimeType = _folderMime
          ..parents = parent == null ? null : [parent],
        $fields: 'id',
      );
      folderId = created.id!;
    }
    await _settings.setString(key, folderId);
    return _verifiedFolders[key] = folderId;
  }

  Future<bool> _folderExists(drive.DriveApi api, String folderId) async {
    try {
      final f =
          await api.files.get(folderId, $fields: 'id,trashed') as drive.File;
      return f.trashed != true;
    } on drive.DetailedApiRequestError catch (e) {
      if (e.status == 404) return false;
      rethrow;
    }
  }
}

class DriveNotConnected implements Exception {
  const DriveNotConnected();

  @override
  String toString() => 'Google Drive is not connected';
}

class _BearerClient extends http.BaseClient {
  _BearerClient(this._token);

  final String _token;
  final http.Client _inner = http.Client();

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    request.headers['Authorization'] = 'Bearer $_token';
    return _inner.send(request);
  }

  @override
  void close() => _inner.close();
}
