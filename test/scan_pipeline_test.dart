import 'dart:io';

import 'package:doc_scanner/models/document.dart';
import 'package:doc_scanner/services/document_store.dart';
import 'package:doc_scanner/services/library_files.dart';
import 'package:doc_scanner/services/pdf_builder.dart';
import 'package:doc_scanner/services/scan_pipeline.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;

import 'support.dart';

const _receiptText = '''
COSTCO WHOLESALE
SUBTOTAL 114.25
TOTAL 124.53
CHANGE DUE 0.00
11/05/2026''';

void main() {
  late Directory tmp;
  late DocumentStore store;
  late LibraryFiles files;
  late ScanPipeline pipeline;
  late Map<int, String> textByPage;
  Object? ocrFailure;
  final now = DateTime(2026, 11, 10, 9, 30);

  /// Copies the fixture into a fake scanner cache and returns the paths.
  Future<List<String>> scannerOutput(int pages) async {
    final cache = await Directory(p.join(tmp.path, 'cache')).create();
    return [
      for (var i = 0; i < pages; i++)
        (await File('test/fixtures/page.jpg')
                .copy(p.join(cache.path, 'scan_$i.jpg')))
            .path,
    ];
  }

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('pipeline_test');
    store = await openTestStore();
    files = LibraryFiles(Directory(p.join(tmp.path, 'library')));
    await files.root.create();
    textByPage = {1: _receiptText};
    ocrFailure = null;
    pipeline = ScanPipeline(
      store: store,
      files: files,
      recognize: (path) async {
        if (ocrFailure != null) throw ocrFailure!;
        final n = int.parse(RegExp(r'page_(\d+)').firstMatch(path)![1]!);
        final text = textByPage[n] ?? '';
        return OcrPage(
          text: text,
          lines: [
            OcrLine(
              text: text.split('\n').first,
              left: 10,
              top: 10,
              right: 300,
              bottom: 40,
            ),
          ],
        );
      },
    );
  });

  tearDown(() async {
    await store.close();
    await tmp.delete(recursive: true);
  });

  test('a scan becomes a named, filed, searchable document', () async {
    final stages = <PipelineStage>[];
    final doc = await pipeline.process(
      await scannerOutput(1),
      now: now,
      onProgress: (stage, _, _) => stages.add(stage),
    );

    expect(doc.title, 'Costco Receipt Nov 2026');
    expect(doc.category, DocCategory.receipt);
    expect(doc.vendor, 'Costco');
    expect(doc.amount, 124.53);
    expect(doc.docDate, DateTime(2026, 11, 5));
    expect(doc.createdAt, now);
    expect(stages, PipelineStage.values);

    expect(p.basename(files.pdf(doc).path), 'Costco Receipt Nov 2026.pdf');
    expect(await files.pdf(doc).exists(), isTrue);
    expect(await files.page(doc, 0).exists(), isTrue);

    expect((await store.search(query: 'change due')).single.id, doc.id);
  });

  test('pages keep their order and all contribute to search', () async {
    textByPage = {
      1: 'Lease Agreement\nLandlord and Tenant',
      2: 'Appendix: parking stall 14',
    };
    final doc = await pipeline.process(await scannerOutput(2), now: now);
    expect(doc.pageCount, 2);
    expect(
      doc.ocrText.indexOf('Landlord'),
      lessThan(doc.ocrText.indexOf('parking')),
    );
    expect(await files.page(doc, 1).exists(), isTrue);
    expect(await store.search(query: 'parking'), hasLength(1));
  });

  test('scanning the same thing twice gives distinct names', () async {
    final a = await pipeline.process(await scannerOutput(1), now: now);
    final b = await pipeline.process(
      await scannerOutput(1),
      now: now.add(const Duration(minutes: 1)),
    );
    expect(a.title, 'Costco Receipt Nov 2026');
    expect(b.title, 'Costco Receipt Nov 2026 (2)');
    expect(await files.pdf(a).exists(), isTrue);
    expect(await files.pdf(b).exists(), isTrue);
  });

  test('scanner cache files are removed once the document is safe', () async {
    final scans = await scannerOutput(1);
    await pipeline.process(scans, now: now);
    expect(await File(scans.single).exists(), isFalse);
  });

  test('a failure leaves no half-made document and keeps the scan', () async {
    ocrFailure = StateError('ocr unavailable');
    final scans = await scannerOutput(1);
    await expectLater(pipeline.process(scans, now: now), throwsStateError);
    expect(await store.search(), isEmpty);
    expect(await files.root.list().toList(), isEmpty);
    expect(await File(scans.single).exists(), isTrue);
  });

  test('renaming moves the PDF and updates search', () async {
    final doc = await pipeline.process(await scannerOutput(1), now: now);
    final renamed = await pipeline.edit(doc, title: 'Costco: paper towels?');
    expect(renamed.title, 'Costco paper towels');
    expect(await files.pdf(doc).exists(), isFalse);
    expect(await files.pdf(renamed).exists(), isTrue);
    expect((await store.search(query: 'towels')).single.title, renamed.title);
  });

  test('renaming to a taken name is made unique, not overwritten', () async {
    final a = await pipeline.process(await scannerOutput(1), now: now);
    final b = await pipeline.process(await scannerOutput(1), now: now);
    final renamed = await pipeline.edit(b, title: a.title);
    expect(renamed.title, '${a.title} (2)');
    expect(await files.pdf(a).exists(), isTrue);
  });

  test('re-filing changes the category but not the file', () async {
    final doc = await pipeline.process(await scannerOutput(1), now: now);
    final moved = await pipeline.edit(doc, category: DocCategory.tax);
    expect(moved.category, DocCategory.tax);
    expect(moved.title, doc.title);
    expect(await files.pdf(moved).exists(), isTrue);
    expect(await store.search(category: DocCategory.receipt), isEmpty);
  });

  test('deleting removes the files and the index entry', () async {
    final doc = await pipeline.process(await scannerOutput(1), now: now);
    await pipeline.delete(doc);
    expect(await files.dirFor(doc.dir).exists(), isFalse);
    expect(await store.search(), isEmpty);
  });

  test('removeOrphans clears folders the index does not know', () async {
    final doc = await pipeline.process(await scannerOutput(1), now: now);
    await files.dirFor('doc_interrupted').create();
    await files.removeOrphans(await store.allDirs());
    expect(await files.dirFor('doc_interrupted').exists(), isFalse);
    expect(await files.pdf(doc).exists(), isTrue);
  });
}
