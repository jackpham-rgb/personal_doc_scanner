import 'package:flutter/material.dart';

/// Broad document categories. Each one maps to a folder in the library and in
/// every sync destination.
enum DocCategory {
  receipt('Receipt', 'Receipts', Icons.receipt_long),
  invoice('Invoice', 'Invoices', Icons.request_quote),
  bill('Bill', 'Bills', Icons.bolt),
  bankStatement('Bank Statement', 'Bank Statements', Icons.account_balance),
  id('ID', 'IDs', Icons.badge),
  insurance('Insurance', 'Insurance', Icons.shield),
  tax('Tax Document', 'Taxes', Icons.calculate),
  medical('Medical Record', 'Medical', Icons.medical_services),
  contract('Contract', 'Contracts', Icons.gavel),
  letter('Letter', 'Letters', Icons.mail),
  other('Document', 'Other', Icons.description);

  const DocCategory(this.label, this.folder, this.icon);

  /// Singular name, used in generated titles ("Costco Receipt Nov 2026").
  final String label;

  /// Folder name, used on disk and in sync destinations.
  final String folder;

  final IconData icon;

  static DocCategory fromName(String? name) => DocCategory.values.firstWhere(
    (c) => c.name == name,
    orElse: () => DocCategory.other,
  );
}

/// One scanned document as stored in the index.
class DocumentRecord {
  const DocumentRecord({
    required this.id,
    required this.title,
    required this.category,
    required this.pageCount,
    required this.ocrText,
    required this.dir,
    required this.createdAt,
    this.vendor,
    this.docDate,
    this.amount,
    this.snippet,
  });

  final int id;

  /// Display name and PDF file name (without the `.pdf` extension).
  final String title;
  final DocCategory category;
  final String? vendor;

  /// Date printed on the document, if one was found.
  final DateTime? docDate;

  /// Total / amount due printed on the document, if one was found.
  final double? amount;
  final int pageCount;
  final String ocrText;

  /// Folder name of this document inside the app's private library folder.
  final String dir;

  /// When the document was scanned.
  final DateTime createdAt;

  /// Matching text excerpt; only set on search results.
  final String? snippet;

  String get pdfFileName => '$title.pdf';

  static String pageFileName(int index) => 'page_${index + 1}.jpg';

  DocumentRecord copyWith({String? title, DocCategory? category}) =>
      DocumentRecord(
        id: id,
        title: title ?? this.title,
        category: category ?? this.category,
        vendor: vendor,
        docDate: docDate,
        amount: amount,
        pageCount: pageCount,
        ocrText: ocrText,
        dir: dir,
        createdAt: createdAt,
        snippet: snippet,
      );

  factory DocumentRecord.fromRow(Map<String, Object?> row) => DocumentRecord(
    id: row['id']! as int,
    title: row['title']! as String,
    category: DocCategory.fromName(row['category'] as String?),
    vendor: row['vendor'] as String?,
    docDate: row['doc_date'] == null
        ? null
        : DateTime.tryParse(row['doc_date']! as String),
    amount: (row['amount'] as num?)?.toDouble(),
    pageCount: row['page_count']! as int,
    ocrText: row['ocr_text']! as String,
    dir: row['dir']! as String,
    createdAt: DateTime.fromMillisecondsSinceEpoch(row['created_at']! as int),
    snippet: row['snippet'] as String?,
  );
}

/// Replaces characters that are not allowed in file names on Android, Windows
/// or cloud drives, and trims the result to a sane length.
String sanitizeFileName(String name) {
  var out = name
      .replaceAll(RegExp(r'[\\/:*?"<>|\x00-\x1f]'), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  // Windows does not allow names that end in a dot.
  out = out.replaceAll(RegExp(r'[. ]+$'), '');
  if (out.length > 80) out = out.substring(0, 80).trim();
  return out.isEmpty ? 'Document' : out;
}
