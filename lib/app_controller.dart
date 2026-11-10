import 'dart:async';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'models/document.dart';
import 'services/app_settings.dart';
import 'services/document_store.dart';
import 'services/library_files.dart';
import 'services/ocr_service.dart';
import 'services/scan_pipeline.dart';
import 'services/scanner_service.dart';
import 'services/sync/google_drive_target.dart';
import 'services/sync/local_folder_target.dart';
import 'services/sync/sync_manager.dart';
import 'services/sync/sync_target.dart';

/// What the processing banner shows while a scan is being filed.
class ProcessingStatus {
  const ProcessingStatus(this.message);
  final String message;
}

/// Owns the services and the state the screens render.
class AppController extends ChangeNotifier {
  AppController._({
    required this.settings,
    required this.store,
    required this.files,
    required this.pipeline,
    required this.sync,
    required this.localFolder,
    required this.googleDrive,
  });

  final AppSettings settings;
  final DocumentStore store;
  final LibraryFiles files;
  final ScanPipeline pipeline;
  final SyncManager sync;
  final LocalFolderTarget localFolder;
  final GoogleDriveTarget googleDrive;

  final _scanner = ScannerService();
  StreamSubscription<List<ConnectivityResult>>? _connectivity;

  List<DocumentRecord> documents = const [];
  Map<DocCategory, int> categoryCounts = const {};
  Set<int> syncedIds = const {};
  String query = '';
  DocCategory? category;
  ProcessingStatus? processing;
  bool localFolderSupported = false;
  bool driveConnected = false;

  static Future<AppController> create() async {
    final settings = await AppSettings.load();
    final support = await getApplicationSupportDirectory();
    final docs = await getApplicationDocumentsDirectory();
    final store = await DocumentStore.open(p.join(support.path, 'index.db'));
    final files = LibraryFiles(Directory(p.join(docs.path, 'library')));
    await files.root.create(recursive: true);
    await files.removeOrphans(await store.allDirs());

    final ocr = OcrService();
    final localFolder = LocalFolderTarget();
    final googleDrive = GoogleDriveTarget(settings);
    final controller = AppController._(
      settings: settings,
      store: store,
      files: files,
      pipeline: ScanPipeline(
        store: store,
        files: files,
        recognize: ocr.recognize,
      ),
      sync: SyncManager(
        store: store,
        files: files,
        targets: [localFolder, googleDrive],
        isEnabled: (t) =>
            settings.targetEnabled(t.id, fallback: t is LocalFolderTarget),
      ),
      localFolder: localFolder,
      googleDrive: googleDrive,
    );
    await controller._init();
    return controller;
  }

  Future<void> _init() async {
    sync.addListener(_onSyncChanged);
    localFolderSupported = await localFolder.isReady();
    await refresh();
    unawaited(_refreshDriveState().then((_) => sync.sync()));
    // Retry anything still pending as soon as the network comes back.
    _connectivity = Connectivity().onConnectivityChanged.listen((result) {
      if (!result.contains(ConnectivityResult.none)) sync.sync();
    });
  }

  bool isTargetEnabled(SyncTarget t) =>
      settings.targetEnabled(t.id, fallback: t is LocalFolderTarget);

  List<SyncTarget> get _activeTargets => [
    if (localFolderSupported && isTargetEnabled(localFolder)) localFolder,
    if (driveConnected && isTargetEnabled(googleDrive)) googleDrive,
  ];

  /// True if at least one destination is switched on and usable.
  bool get hasActiveTarget => _activeTargets.isNotEmpty;

  void _onSyncChanged() => unawaited(refresh());

  /// Reloads the list for the current search and filter.
  Future<void> refresh() async {
    final wantedQuery = query;
    final wantedCategory = category;
    final results = await store.search(
      query: wantedQuery,
      category: wantedCategory,
    );
    final counts = await store.categoryCounts();
    final synced = await store.syncedDocIds(_activeTargets.map((t) => t.id));
    // Typing fires overlapping searches; only the latest one may land.
    if (wantedQuery != query || wantedCategory != category) return;
    documents = results;
    categoryCounts = counts;
    syncedIds = synced;
    notifyListeners();
  }

  void setQuery(String value) {
    query = value;
    unawaited(refresh());
  }

  void setCategory(DocCategory? value) {
    category = value;
    unawaited(refresh());
  }

  /// Opens the camera and files whatever was scanned. Returns the new
  /// document, or null if the user backed out of the scanner.
  Future<DocumentRecord?> scan() async {
    if (processing != null) return null;
    final images = await _scanner.scan();
    if (images.isEmpty) return null;

    processing = const ProcessingStatus('Saving pages…');
    notifyListeners();
    try {
      final doc = await pipeline.process(
        images,
        onProgress: (stage, page, count) {
          processing = ProcessingStatus(switch (stage) {
            PipelineStage.saving => 'Saving pages…',
            PipelineStage.reading =>
              count > 1
                  ? 'Reading text (page $page of $count)…'
                  : 'Reading text…',
            PipelineStage.organizing => 'Naming and filing…',
            PipelineStage.buildingPdf => 'Creating searchable PDF…',
          });
          notifyListeners();
        },
      );
      unawaited(sync.sync());
      return doc;
    } finally {
      processing = null;
      await refresh();
    }
  }

  Future<DocumentRecord> edit(
    DocumentRecord doc, {
    String? title,
    DocCategory? category,
  }) async {
    final updated = await pipeline.edit(doc, title: title, category: category);
    await refresh();
    unawaited(sync.sync());
    return updated;
  }

  Future<void> delete(DocumentRecord doc) async {
    await pipeline.delete(doc);
    await refresh();
    unawaited(sync.sync());
  }

  Future<void> setTargetEnabled(SyncTarget target, bool enabled) async {
    await settings.setTargetEnabled(target.id, enabled);
    await refresh();
    if (enabled) unawaited(sync.sync());
  }

  Future<void> _refreshDriveState() async {
    driveConnected =
        isTargetEnabled(googleDrive) && await googleDrive.isReady();
    await refresh();
  }

  /// Shows Google's consent screen and, on success, starts uploading the
  /// whole library. Throws if the user declines or setup is incomplete.
  Future<void> connectDrive() async {
    await googleDrive.connect();
    await settings.setTargetEnabled(googleDrive.id, true);
    await _refreshDriveState();
    unawaited(sync.sync());
  }

  Future<void> disconnectDrive() async {
    await settings.setTargetEnabled(googleDrive.id, false);
    await googleDrive.disconnect();
    // Forget remote ids so reconnecting (perhaps to another account)
    // uploads everything again instead of updating files it cannot see.
    await store.clearTarget(googleDrive.id);
    await _refreshDriveState();
  }

  @override
  void dispose() {
    _connectivity?.cancel();
    sync.removeListener(_onSyncChanged);
    super.dispose();
  }
}
