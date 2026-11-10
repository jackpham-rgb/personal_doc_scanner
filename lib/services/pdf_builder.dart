import 'dart:io';
import 'dart:isolate';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:pdf/pdf.dart';

/// One line of recognised text and where it sits on the page image, in image
/// pixels with the origin at the top left.
class OcrLine {
  const OcrLine({
    required this.text,
    required this.left,
    required this.top,
    required this.right,
    required this.bottom,
  });

  final String text;
  final double left;
  final double top;
  final double right;
  final double bottom;
}

/// OCR result for one page image.
class OcrPage {
  const OcrPage({required this.text, required this.lines});

  final String text;
  final List<OcrLine> lines;
}

/// Builds a searchable PDF: each page is the scanned image with the
/// recognised text laid invisibly on top of it, so the file can be searched
/// and copied from in any PDF viewer and is indexed by desktop and cloud
/// search.
class PdfBuilder {
  const PdfBuilder();

  /// Writes the PDF to [outputPath]. Runs on a background isolate because
  /// encoding several multi-megabyte pages would otherwise freeze the UI.
  Future<void> build({
    required List<String> imagePaths,
    required List<OcrPage> pages,
    required String outputPath,
    String? title,
  }) {
    assert(imagePaths.length == pages.length);
    return Isolate.run(() async {
      final bytes = await buildBytes(
        images: [for (final p in imagePaths) await File(p).readAsBytes()],
        pages: pages,
        title: title,
      );
      await File(outputPath).writeAsBytes(bytes, flush: true);
    });
  }

  /// A4 in PDF points; pages are scaled to fit inside it so that a letter
  /// page prints at full size and a narrow receipt keeps its shape.
  static const _maxShort = 595.0;
  static const _maxLong = 842.0;

  static Future<List<int>> buildBytes({
    required List<List<int>> images,
    required List<OcrPage> pages,
    String? title,
    bool compress = true,
  }) async {
    final doc = PdfDocument(compress: compress);
    PdfInfo(doc, title: title, creator: 'Doc Scanner', producer: 'Doc Scanner');
    final font = PdfFont.helvetica(doc);

    for (var i = 0; i < images.length; i++) {
      final image = PdfImage.jpeg(
        doc,
        image: images[i] is Uint8List
            ? images[i] as Uint8List
            : Uint8List.fromList(images[i]),
      );
      final w = image.width.toDouble();
      final h = image.height.toDouble();
      final portrait = h >= w;
      final scale = math.min(
        (portrait ? _maxShort : _maxLong) / w,
        (portrait ? _maxLong : _maxShort) / h,
      );
      final pageW = w * scale;
      final pageH = h * scale;

      final page = PdfPage(doc, pageFormat: PdfPageFormat(pageW, pageH));
      final g = page.getGraphics();
      g.drawImage(image, 0, 0, pageW, pageH);

      for (final line in pages[i].lines) {
        final text = _encodable(line.text);
        if (text.isEmpty) continue;
        final boxW = (line.right - line.left) * scale;
        final boxH = (line.bottom - line.top) * scale;
        if (boxW <= 0 || boxH <= 0) continue;

        final fontSize = boxH * 0.8;
        final naturalW = font.stringMetrics(text).width * fontSize;
        if (naturalW <= 0) continue;
        g.drawString(
          font,
          fontSize,
          text,
          line.left * scale,
          // PDF's origin is bottom-left; sit the baseline a little above the
          // bottom of the box, where the descenders would be.
          pageH - line.bottom * scale + boxH * 0.2,
          // Stretch the text to the width of the printed line so selections
          // in a viewer line up with the image underneath.
          scale: boxW / naturalW,
          mode: PdfTextRenderingMode.invisible,
        );
      }
    }
    return doc.save();
  }

  static const _replacements = {
    0x2018: "'",
    0x2019: "'",
    0x201C: '"',
    0x201D: '"',
    0x2013: '-',
    0x2014: '-',
    0x2022: '*',
    0x2026: '...',
    0x20AC: 'EUR',
  };

  /// The built-in PDF fonts only cover Latin-1. Map common typographic
  /// characters to plain equivalents and drop anything else rather than fail
  /// the whole document over one glyph.
  static String _encodable(String text) {
    final out = StringBuffer();
    for (final rune in text.runes) {
      if (rune >= 0x20 && rune <= 0xff && (rune < 0x7f || rune > 0x9f)) {
        out.writeCharCode(rune);
      } else if (_replacements.containsKey(rune)) {
        out.write(_replacements[rune]);
      }
    }
    return out.toString().trim();
  }
}
