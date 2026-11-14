import { createRequire } from 'node:module';
import type { Cv, RgbaImage } from '../src/scanner/cv-core';
import type { Point, Quad } from '../src/types';

let cvPromise: Promise<Cv> | undefined;

/** OpenCV.js running in Node. */
export function loadCv(): Promise<Cv> {
  cvPromise ??= (async () => {
    const mod = createRequire(import.meta.url)('@techstark/opencv-js');
    // Some builds export a promise, others a module with a ready callback.
    if (typeof mod.then === 'function') return await mod;
    if (mod.Mat) return mod;
    await new Promise<void>((resolve) => (mod.onRuntimeInitialized = resolve));
    return mod;
  })();
  return cvPromise;
}

function inside(q: Quad, x: number, y: number): boolean {
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false;
  }
  return true;
}

/** Point at fraction (u, v) across the quad, bilinear between its corners. */
export function pointIn([tl, tr, br, bl]: Quad, u: number, v: number): Point {
  const top = { x: tl.x + (tr.x - tl.x) * u, y: tl.y + (tr.y - tl.y) * u };
  const bottom = { x: bl.x + (br.x - bl.x) * u, y: bl.y + (br.y - bl.y) * u };
  return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v };
}

export interface SceneOptions {
  width?: number;
  height?: number;
  /** Paper brightness at the left and right edge, to simulate a shadow. */
  paperLeft?: number;
  paperRight?: number;
  background?: [number, number, number];
  paperTint?: [number, number, number];
}

/**
 * Draws a sheet of paper lying on a desk, seen at an angle: a light quad on
 * a dark background, with a dark bar across the page at 30–32% of its height
 * to stand in for a line of print.
 */
export function drawScene(page: Quad, options: SceneOptions = {}): RgbaImage {
  const {
    width = 640,
    height = 480,
    paperLeft = 240,
    paperRight = 240,
    background = [45, 50, 58],
    paperTint = [1, 1, 1],
  } = options;
  const bar: Quad = [
    pointIn(page, 0.15, 0.3),
    pointIn(page, 0.85, 0.3),
    pointIn(page, 0.85, 0.32),
    pointIn(page, 0.15, 0.32),
  ];
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let rgb: number[] = background;
      if (inside(page, x, y)) {
        const level = paperLeft + ((paperRight - paperLeft) * x) / width;
        rgb = inside(bar, x, y) ? [30, 30, 30] : paperTint.map((t) => level * t);
      }
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Mean of the red, green and blue values at a pixel. */
export function brightness(img: RgbaImage, x: number, y: number): number {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
}
