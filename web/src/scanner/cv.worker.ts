// Runs OpenCV off the main thread, so the camera preview stays smooth while
// frames are analysed and pages are straightened.
import { type Cv, detectQuad, flatten, type FlattenOptions, type RgbaImage } from './cv-core';
import type { Quad } from '../types';

export type CvRequest =
  | { id: number; type: 'init'; opencvUrl: string }
  | { id: number; type: 'detect'; image: RgbaImage }
  | { id: number; type: 'flatten'; image: RgbaImage; quad: Quad; options: FlattenOptions };

export type CvResponse = { id: number; result: unknown } | { id: number; error: string };

let cv: Promise<Cv> | undefined;

/**
 * OpenCV.js is a classic script, not an ES module, so it cannot be imported
 * here. Evaluate it with a CommonJS-style `module` in scope instead, which
 * makes it hand back its exports.
 */
async function loadOpenCv(url: string): Promise<Cv> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the scanner engine (${response.status})`);
  const source = await response.text();
  const module = { exports: {} as Cv };
  new Function('module', 'exports', source)(module, module.exports);
  const loaded = module.exports;
  // Depending on the build this is a promise, a ready module, or a module
  // that calls back once its WebAssembly has compiled.
  if (typeof loaded.then === 'function') return await loaded;
  if (loaded.Mat) return loaded;
  await new Promise<void>((resolve) => (loaded.onRuntimeInitialized = resolve));
  return loaded;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<CvRequest>) => void) | null;
  postMessage(message: CvResponse, transfer?: Transferable[]): void;
};

scope.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      cv = loadOpenCv(data.opencvUrl);
      await cv;
      scope.postMessage({ id: data.id, result: null });
      return;
    }
    if (!cv) throw new Error('Scanner engine used before it was loaded');
    const engine = await cv;
    if (data.type === 'detect') {
      scope.postMessage({ id: data.id, result: detectQuad(engine, data.image) });
    } else {
      const result = flatten(engine, data.image, data.quad, data.options);
      scope.postMessage({ id: data.id, result }, [result.image.data.buffer]);
    }
  } catch (e) {
    scope.postMessage({ id: data.id, error: e instanceof Error ? e.message : String(e) });
  }
};
