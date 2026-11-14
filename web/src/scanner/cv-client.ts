import type { Quad } from '../types';
import type { FlattenOptions, FlattenResult } from './cv-core';
import type { CvRequest, CvResponse } from './cv.worker';

// Omit that keeps the members of a union apart.
type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Talks to the OpenCV worker. One instance serves the whole app. */
export class CvClient {
  private readonly worker: Worker;
  private readonly waiting = new Map<
    number,
    { resolve: (value: never) => void; reject: (reason: Error) => void }
  >();
  private nextId = 1;

  /** Settles once the engine has been downloaded and compiled. */
  readonly ready: Promise<void>;

  constructor() {
    this.worker = new Worker(new URL('./cv.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }: MessageEvent<CvResponse>) => {
      const pending = this.waiting.get(data.id);
      this.waiting.delete(data.id);
      if ('error' in data) pending?.reject(new Error(data.error));
      else pending?.resolve(data.result as never);
    };
    this.worker.onerror = (e) => {
      for (const p of this.waiting.values()) p.reject(new Error(e.message || 'Scanner engine crashed'));
      this.waiting.clear();
    };
    this.ready = this.call({
      type: 'init',
      opencvUrl: new URL('vendor/opencv.js', document.baseURI).href,
    });
    // Callers await `ready` when they need it; do not report it twice.
    this.ready.catch(() => {});
  }

  /** Finds the page outline in a small frame; coordinates are in its pixels. */
  detect(image: ImageData): Promise<Quad | null> {
    return this.call({ type: 'detect', image: plain(image) }, [image.data.buffer]);
  }

  /** Cuts out and straightens a page. Consumes [image]. */
  async flatten(image: ImageData, quad: Quad, options: FlattenOptions): Promise<FlattenResult> {
    return this.call({ type: 'flatten', image: plain(image), quad, options }, [image.data.buffer]);
  }

  private call<T>(request: Without<CvRequest, 'id'>, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...request }, transfer);
    });
  }
}

// ImageData itself cannot be posted with its buffer transferred in every
// browser; a plain object with the same fields can.
const plain = (image: ImageData) => ({
  data: image.data,
  width: image.width,
  height: image.height,
});
