import 'dart:io';

import 'package:path/path.dart' as p;

import '../models/document.dart';

/// Where a document's files live inside the app's private storage:
/// `<root>/<doc.dir>/page_N.jpg` plus `<title>.pdf`.
class LibraryFiles {
  LibraryFiles(this.root);

  final Directory root;

  Directory dirFor(String dir) => Directory(p.join(root.path, dir));

  File pdf(DocumentRecord doc) =>
      File(p.join(root.path, doc.dir, doc.pdfFileName));

  File page(DocumentRecord doc, int index) =>
      File(p.join(root.path, doc.dir, DocumentRecord.pageFileName(index)));

  /// Creates an empty folder for a new document and returns its name.
  Future<String> createDir(DateTime now) async {
    final name = 'doc_${now.microsecondsSinceEpoch}';
    await dirFor(name).create(recursive: true);
    return name;
  }

  Future<void> deleteDir(String dir) async {
    final d = dirFor(dir);
    if (await d.exists()) await d.delete(recursive: true);
  }

  /// Removes folders that no document points at — the leftovers of a scan
  /// that was interrupted before it reached the index.
  Future<void> removeOrphans(Set<String> knownDirs) async {
    if (!await root.exists()) return;
    await for (final entry in root.list()) {
      if (entry is Directory && !knownDirs.contains(p.basename(entry.path))) {
        await entry.delete(recursive: true);
      }
    }
  }
}
