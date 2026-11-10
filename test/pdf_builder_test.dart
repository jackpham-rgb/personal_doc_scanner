import 'dart:convert';
import 'dart:io';

import 'package:doc_scanner/services/pdf_builder.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final jpeg = File('test/fixtures/page.jpg').readAsBytesSync(); // 600x800

  const page = OcrPage(
    text: 'COSTCO WHOLESALE\nTOTAL 124.53',
    lines: [
      OcrLine(
        text: 'COSTCO WHOLESALE',
        left: 60,
        top: 80,
        right: 300,
        bottom: 100,
      ),
      OcrLine(
        text: 'TOTAL 124.53',
        left: 60,
        top: 400,
        right: 220,
        bottom: 420,
      ),
    ],
  );

  Future<String> build(List<OcrPage> pages) async => latin1.decode(
    await PdfBuilder.buildBytes(
      images: [for (final _ in pages) jpeg],
      pages: pages,
      title: 'Costco Receipt Nov 2026',
      compress: false,
    ),
  );

  test('embeds one page per image with the recognised text', () async {
    final pdf = await build([page, page]);
    expect(pdf, startsWith('%PDF-'));
    expect(RegExp(r'/Type\s*/Page\b').allMatches(pdf), hasLength(2));
    expect(RegExp(r'/DCTDecode').allMatches(pdf), hasLength(2));
    expect(pdf, contains('(COSTCO WHOLESALE)'));
    expect(pdf, contains('(TOTAL 124.53)'));
    expect(pdf, contains('Costco Receipt Nov 2026'));
  });

  test('text layer is invisible so only the scan shows', () async {
    final pdf = await build([page]);
    // "3 Tr" selects PDF text rendering mode 3: neither fill nor stroke.
    expect(RegExp(r'\b3 Tr\b').allMatches(pdf), hasLength(2));
  });

  test('page keeps the aspect ratio of the scan and fits A4', () async {
    final pdf = await build([page]);
    final box = RegExp(r'/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]')
        .firstMatch(pdf)!;
    final w = double.parse(box[1]!), h = double.parse(box[2]!);
    expect(w / h, closeTo(600 / 800, 0.001));
    expect(w, lessThanOrEqualTo(595.01));
    expect(h, lessThanOrEqualTo(842.01));
  });

  test('characters outside Latin-1 do not break the document', () async {
    final pdf = await build([
      const OcrPage(
        text: '',
        lines: [
          OcrLine(
            text: '“Café” — 東京 ✓',
            left: 10,
            top: 10,
            right: 200,
            bottom: 30,
          ),
          OcrLine(text: '東京', left: 10, top: 40, right: 200, bottom: 60),
          OcrLine(text: 'zero size', left: 10, top: 70, right: 10, bottom: 70),
        ],
      ),
    ]);
    expect(pdf, contains('"Caf'));
    expect(RegExp(r'\b3 Tr\b').allMatches(pdf), hasLength(1));
  });

  test('build() writes the file from a background isolate', () async {
    final dir = await Directory.systemTemp.createTemp('pdf_test');
    addTearDown(() => dir.delete(recursive: true));
    final out = '${dir.path}/out.pdf';
    await const PdfBuilder().build(
      imagePaths: ['test/fixtures/page.jpg'],
      pages: [page],
      outputPath: out,
    );
    expect(latin1.decode(await File(out).readAsBytes()), startsWith('%PDF-'));
  });
}
