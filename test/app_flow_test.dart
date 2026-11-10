import 'dart:io';
import 'dart:ui' as ui;

import 'package:doc_scanner/app_controller.dart';
import 'package:doc_scanner/services/app_settings.dart';
import 'package:doc_scanner/services/library_files.dart';
import 'package:doc_scanner/services/pdf_builder.dart';
import 'package:doc_scanner/services/scan_pipeline.dart';
import 'package:doc_scanner/services/scanner_service.dart';
import 'package:doc_scanner/services/sync/google_drive_target.dart';
import 'package:doc_scanner/services/sync/local_folder_target.dart';
import 'package:doc_scanner/services/sync/sync_manager.dart';
import 'package:doc_scanner/ui/home_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';

import 'support.dart';

const _receipt = '''
COSTCO WHOLESALE
KS PAPER TOWEL 21.99
SUBTOTAL 114.25
TOTAL 124.53
CHANGE DUE 0.00
11/05/2026''';

class _FakeScanner extends ScannerService {
  _FakeScanner(this.cacheDir);

  final Directory cacheDir;
  int _n = 0;

  @override
  Future<List<String>> scan() async => [
    (await File('test/fixtures/page.jpg')
            .copy(p.join(cacheDir.path, 'scan_${_n++}.jpg')))
        .path,
  ];
}

/// Set SCREENSHOT_DIR to save a PNG of each screen this test walks through.
final _screenshotDir = Platform.environment['SCREENSHOT_DIR'];
final _appKey = GlobalKey();

Future<void> _loadRealFonts() async {
  final fonts = Directory(
    p.join(
      p.dirname(Platform.resolvedExecutable),
      '..',
      '..',
      'material_fonts',
    ),
  );
  Future<void> load(String family, List<String> files) async {
    final loader = FontLoader(family);
    for (final f in files) {
      final bytes = await File(p.join(fonts.path, f)).readAsBytes();
      loader.addFont(Future.value(ByteData.sublistView(bytes)));
    }
    await loader.load();
  }

  await load('Roboto', ['Roboto-Regular.ttf', 'Roboto-Medium.ttf']);
  await load('MaterialIcons', ['MaterialIcons-Regular.otf']);
}

Future<void> _screenshot(WidgetTester tester, String name) async {
  if (_screenshotDir == null) return;
  await tester.runAsync(() async {
    final boundary =
        _appKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final image = await boundary.toImage(pixelRatio: 2);
    final png = await image.toByteData(format: ui.ImageByteFormat.png);
    await File(p.join(_screenshotDir!, '$name.png'))
        .writeAsBytes(png!.buffer.asUint8List());
  });
}

/// Lets real I/O (database, files, the PDF isolate) make progress, then
/// rebuilds, until [done] holds.
Future<void> _waitFor(WidgetTester tester, bool Function() done) async {
  for (var i = 0; i < 200 && !done(); i++) {
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 20)),
    );
    await tester.pump(const Duration(milliseconds: 50));
  }
  expect(done(), isTrue, reason: 'timed out waiting for the app');
  await tester.pump(const Duration(milliseconds: 400));
}

void main() {
  testWidgets('scan, find by a word on the page, open, settings', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(412, 892);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    SharedPreferences.setMockInitialValues({});

    late Directory tmp;
    late AppController controller;
    await tester.runAsync(() async {
      if (_screenshotDir != null) await _loadRealFonts();
      tmp = await Directory.systemTemp.createTemp('app_flow');
      final cache = await Directory(p.join(tmp.path, 'cache')).create();
      final settings = await AppSettings.load();
      final store = await openTestStore();
      final files = LibraryFiles(Directory(p.join(tmp.path, 'library')));
      await files.root.create();
      final localFolder = LocalFolderTarget();
      final googleDrive = GoogleDriveTarget(settings);
      controller = AppController(
        settings: settings,
        store: store,
        files: files,
        pipeline: ScanPipeline(
          store: store,
          files: files,
          recognize: (_) async => const OcrPage(text: _receipt, lines: []),
        ),
        sync: SyncManager(
          store: store,
          files: files,
          targets: [localFolder, googleDrive],
          isEnabled: (_) => false,
        ),
        localFolder: localFolder,
        googleDrive: googleDrive,
        scanner: _FakeScanner(cache),
      );
      await controller.start();
    });
    addTearDown(() => tmp.delete(recursive: true));

    await tester.pumpWidget(
      RepaintBoundary(
        key: _appKey,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: ThemeData(
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xFF1F6FEB),
            ),
            fontFamily: _screenshotDir == null ? null : 'Roboto',
          ),
          home: HomeScreen(controller: controller),
        ),
      ),
    );
    expect(find.text('No documents yet'), findsOneWidget);
    await _screenshot(tester, '1_empty');

    // Scan: one tap, and the document is named and filed without questions.
    await tester.tap(find.text('Scan'));
    await _waitFor(tester, () => controller.documents.isNotEmpty);
    expect(find.text('Costco Receipt Nov 2026'), findsOneWidget);
    expect(
      find.text('Saved “Costco Receipt Nov 2026” in Receipts'),
      findsOneWidget,
    );
    expect(find.textContaining(r'$124.53'), findsOneWidget);
    await _screenshot(tester, '2_after_scan');

    // Search by a word that appears only inside the document.
    await tester.enterText(find.byType(TextField), 'towel');
    await _waitFor(
      tester,
      () => controller.documents.any((d) => d.snippet != null),
    );
    expect(find.textContaining('PAPER TOWEL'), findsOneWidget);
    await _screenshot(tester, '3_search');

    await tester.enterText(find.byType(TextField), 'mortgage');
    await _waitFor(tester, () => controller.documents.isEmpty);
    expect(find.text('No documents match'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'costco');
    await _waitFor(tester, () => controller.documents.isNotEmpty);

    // Open the document.
    await tester.tap(find.text('Costco Receipt Nov 2026'));
    await tester.pumpAndSettle();
    expect(find.text('Open PDF'), findsOneWidget);
    expect(find.text('Costco'), findsOneWidget);
    expect(find.text('Nov 5, 2026'), findsOneWidget);
    expect(find.text(r'$124.53'), findsOneWidget);
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 200)),
    );
    await tester.pump();
    await _screenshot(tester, '4_document');

    await tester.tap(find.text('View text'));
    await tester.pumpAndSettle();
    expect(find.textContaining('KS PAPER TOWEL'), findsOneWidget);
    await _screenshot(tester, '5_text');
    await tester.tapAt(const Offset(200, 40));
    await tester.pumpAndSettle();

    await tester.pageBack();
    await tester.pumpAndSettle();

    // Settings.
    await tester.tap(find.byTooltip('Settings'));
    await tester.pumpAndSettle();
    expect(find.text('Save to phone folder'), findsOneWidget);
    expect(find.text('Google Drive'), findsOneWidget);
    expect(find.text('Connect'), findsOneWidget);
    await _screenshot(tester, '6_settings');

    await tester.tap(find.text('Open the camera when the app starts'));
    await tester.pump();
    expect(controller.settings.scanOnLaunch, isTrue);
  });
}
