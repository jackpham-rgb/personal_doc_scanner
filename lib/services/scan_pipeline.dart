import 'dart:io';

import 'package:path/path.dart' as p;

import '../models/document.dart';
import 'document_analyzer.dart';
import 'document_store.dart';
import 'library_files.dart';
import 'pdf_builder.dart';

enum PipelineStage { saving, reading, organizing, buildingPdf }

typedef OcrFunction = Future<OcrPage> Function(String imagePath);

/// Turns the page images from one scan into a filed, named, searchable
/// document: copy → OCR → classify and name → searchable PDF → index.
class ScanPipeline {
  ScanPipeline({
    required this.store,
    required this.files,
    required this.recognize,
    this.analyzer = const DocumentAnalyzer(),
    this.pdfBuilder = const PdfBuilder(),
  });

  final DocumentStore store;
  final LibraryFiles files;
  final OcrFunction recognize;
  final DocumentAnalyzer analyzer;
  final PdfBuilder pdfBuilder;

  Future<DocumentRecord> process(
    List<String> scannedImages, {
    void Function(PipelineStage stage, int page, int pageCount)? onProgress,
    DateTime? now,
  }) async {
    final scannedAt = now ?? DateTime.now();
    final count = scannedImages.length;
    final dir = await files.createDir(scannedAt);
    try {
      // Move the pages out of the scanner's cache, which Android may clear.
      onProgress?.call(PipelineStage.saving, 0, count);
      final pagePaths = <String>[];
      for (var i = 0; i < count; i++) {
        final dest = p.join(
          files.dirFor(dir).path,
          DocumentRecord.pageFileName(i),
        );
        await File(scannedImages[i]).copy(dest);
        pagePaths.add(dest);
      }

      final pages = <OcrPage>[];
      for (var i = 0; i < count; i++) {
        onProgress?.call(PipelineStage.reading, i + 1, count);
        pages.add(await recognize(pagePaths[i]));
      }
      final text = pages.map((pg) => pg.text.trim()).join('\n\n').trim();

      onProgress?.call(PipelineStage.organizing, 0, count);
      final analysis = analyzer.analyze(text, scannedAt: scannedAt);
      final title = await store.uniqueTitle(analysis.title);

      onProgress?.call(PipelineStage.buildingPdf, 0, count);
      await pdfBuilder.build(
        imagePaths: pagePaths,
        pages: pages,
        outputPath: p.join(files.dirFor(dir).path, '$title.pdf'),
        title: title,
      );

      final doc = await store.insert(
        title: title,
        category: analysis.category,
        vendor: analysis.vendor,
        docDate: analysis.date,
        amount: analysis.amount,
        pageCount: count,
        ocrText: text,
        dir: dir,
        createdAt: scannedAt,
      );

      for (final src in scannedImages) {
        try {
          await File(src).delete();
        } on FileSystemException {
          // Only a cache file; Android will reclaim it.
        }
      }
      return doc;
    } catch (_) {
      await files.deleteDir(dir);
      rethrow;
    }
  }

  /// Renames and/or re-files [doc], keeping the PDF's file name in step with
  /// the title.
  Future<DocumentRecord> edit(
    DocumentRecord doc, {
    String? title,
    DocCategory? category,
  }) async {
    var newTitle = doc.title;
    if (title != null && sanitizeFileName(title) != doc.title) {
      newTitle = await store.uniqueTitle(
        sanitizeFileName(title),
        exceptId: doc.id,
      );
      await files
          .pdf(doc)
          .rename(files.pdf(doc.copyWith(title: newTitle)).path);
    }
    return store.update(doc, title: newTitle, category: category);
  }

  Future<void> delete(DocumentRecord doc) async {
    await store.delete(doc.id);
    await files.deleteDir(doc.dir);
  }
}
