import 'package:flutter/services.dart';
import 'package:google_mlkit_document_scanner/google_mlkit_document_scanner.dart';

/// Wraps Google's on-device document scanner. It shows the camera, finds the
/// page edges, captures automatically, straightens the perspective and cleans
/// up shadows, then hands back one flattened JPEG per page.
class ScannerService {
  /// Opens the scanner and returns the paths of the captured page images, or
  /// an empty list if the user backed out.
  Future<List<String>> scan() async {
    final scanner = DocumentScanner(
      options: DocumentScannerOptions(
        documentFormats: const {DocumentFormat.jpeg},
        mode: ScannerMode.full,
        pageLimit: 30,
        isGalleryImport: true,
      ),
    );
    try {
      final result = await scanner.scanDocument();
      return result.images ?? const [];
    } on PlatformException catch (e) {
      // The plugin reports "back" as an error; that is not a failure.
      if ((e.message ?? '').toLowerCase().contains('cancel')) return const [];
      rethrow;
    } finally {
      await scanner.close();
    }
  }
}
