// Copies the large runtime assets (OpenCV and Tesseract WebAssembly builds,
// OCR language data) from node_modules into public/vendor so the app serves
// them itself and works offline, instead of pulling them from a CDN.
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'vendor');

const files = [
  ['@techstark/opencv-js/dist/opencv.js', 'opencv.js'],
  ['tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
  // The worker picks the fastest build the browser supports.
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract/tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract/tesseract-core-simd-lstm.wasm.js'],
  [
    'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
    'tesseract/tesseract-core-relaxedsimd-lstm.wasm.js',
  ],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'tesseract/lang/eng.traineddata.gz'],
];

for (const [from, to] of files) {
  await mkdir(dirname(join(out, to)), { recursive: true });
  await cp(join(nm, from), join(out, to));
}
console.log(`Copied ${files.length} vendor files to public/vendor`);
