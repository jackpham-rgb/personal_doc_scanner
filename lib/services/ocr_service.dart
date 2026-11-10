import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';

import 'pdf_builder.dart';

/// On-device text recognition (Google ML Kit). Works offline; nothing leaves
/// the phone.
class OcrService {
  final _recognizer = TextRecognizer(script: TextRecognitionScript.latin);

  Future<OcrPage> recognize(String imagePath) async {
    final result = await _recognizer.processImage(
      InputImage.fromFilePath(imagePath),
    );
    return OcrPage(
      text: result.text,
      lines: [
        for (final block in result.blocks)
          for (final line in block.lines)
            OcrLine(
              text: line.text,
              left: line.boundingBox.left,
              top: line.boundingBox.top,
              right: line.boundingBox.right,
              bottom: line.boundingBox.bottom,
            ),
      ],
    );
  }

  Future<void> dispose() => _recognizer.close();
}
