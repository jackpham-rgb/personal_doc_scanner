// Document detection and clean-up on top of OpenCV.js. Takes the OpenCV
// module as an argument so the same code runs in the scanner's web worker and
// in Node for the unit tests.
import type { Quad } from '../types';
import { orderCorners, quadSize } from './geometry';

// OpenCV.js ships no usable types for the bindings used here.
export type Cv = any;

/** Raw RGBA pixels, the layout of a canvas `ImageData`. */
export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** A document must cover at least this share of the frame to count. */
const MIN_AREA_FRACTION = 0.12;

/**
 * A shape covering this much of the frame is the frame itself, not a page in
 * it: with no edges in view there is nothing to crop to.
 */
const MAX_AREA_FRACTION = 0.97;

/**
 * Finds the outline of a document in [img]: the largest four-cornered convex
 * shape. Meant for a downscaled frame (a few hundred pixels across) so it is
 * fast enough to run on every camera frame. Returns null if nothing in the
 * frame looks like a page.
 */
export function detectQuad(cv: Cv, img: RgbaImage): Quad | null {
  const frame = img.width * img.height;
  const minArea = frame * MIN_AREA_FRACTION;
  const maxArea = frame * MAX_AREA_FRACTION;
  const src = cv.matFromImageData(img);
  const gray = new cv.Mat();
  const binary = new cv.Mat();
  const small = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  const large = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

    // First by edges, which works whatever the page and desk colours are…
    cv.Canny(gray, binary, 40, 120);
    cv.dilate(binary, binary, small);
    let quad = largestQuad(cv, binary, minArea, maxArea, cv.RETR_LIST);

    // …then by brightness, which copes with a soft or broken outline as long
    // as the page is lighter than what it lies on.
    if (!quad) {
      cv.threshold(gray, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, large);
      quad = largestQuad(cv, binary, minArea, maxArea, cv.RETR_EXTERNAL);
    }
    return quad;
  } finally {
    for (const m of [src, gray, binary, small, large]) m.delete();
  }
}

function largestQuad(
  cv: Cv,
  binary: Cv,
  minArea: number,
  maxArea: number,
  mode: number,
): Quad | null {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let best: Quad | null = null;
  let bestArea = minArea;
  try {
    cv.findContours(binary, contours, hierarchy, mode, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const hull = new cv.Mat();
      const approx = new cv.Mat();
      try {
        if (cv.contourArea(contour) < minArea) continue;
        // The hull bridges notches left by a thumb or a curled corner.
        cv.convexHull(contour, hull);
        cv.approxPolyDP(hull, approx, 0.02 * cv.arcLength(hull, true), true);
        if (approx.rows !== 4) continue;
        const area = cv.contourArea(approx);
        if (area <= bestArea || area > maxArea) continue;
        bestArea = area;
        const p = approx.data32S;
        best = orderCorners([0, 1, 2, 3].map((k) => ({ x: p[k * 2], y: p[k * 2 + 1] })));
      } finally {
        for (const m of [contour, hull, approx]) m.delete();
      }
    }
    return best;
  } finally {
    contours.delete();
    hierarchy.delete();
  }
}

export interface FlattenOptions {
  /** Longest side of the result, in pixels. Larger pages are scaled down. */
  maxSide: number;
  /**
   * Shadow removal and whitening. `auto` applies it only to pages that look
   * like paper, leaving photos and coloured cards as they are.
   */
  enhance: 'auto' | 'on' | 'off';
}

export interface FlattenResult {
  image: RgbaImage;
  enhanced: boolean;
}

/**
 * Cuts [quad] out of [img] and straightens it into an upright rectangle, as
 * if the page had been photographed square-on.
 */
export function flatten(cv: Cv, img: RgbaImage, quad: Quad, options: FlattenOptions): FlattenResult {
  const size = quadSize(quad);
  const scale = Math.min(1, options.maxSide / Math.max(size.width, size.height));
  const w = Math.max(1, Math.round(size.width * scale));
  const h = Math.max(1, Math.round(size.height * scale));

  const src = cv.matFromImageData(img);
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap((p) => [p.x, p.y]));
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
  const transform = cv.getPerspectiveTransform(from, to);
  const flat = new cv.Mat();
  try {
    cv.warpPerspective(
      src,
      flat,
      transform,
      new cv.Size(w, h),
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE,
      new cv.Scalar(),
    );
    const enhanced =
      options.enhance === 'on' || (options.enhance === 'auto' && looksLikePaper(cv, flat));
    if (enhanced) removeShadows(cv, flat);
    return {
      image: { data: new Uint8ClampedArray(flat.data), width: w, height: h },
      enhanced,
    };
  } finally {
    for (const m of [src, from, to, transform, flat]) m.delete();
  }
}

/** True if most of the page is bright and colourless, like printed paper. */
function looksLikePaper(cv: Cv, rgba: Cv): boolean {
  const thumb = new cv.Mat();
  try {
    cv.resize(rgba, thumb, new cv.Size(64, 64), 0, 0, cv.INTER_AREA);
    const d = thumb.data;
    let paper = 0;
    for (let i = 0; i < d.length; i += 4) {
      const max = Math.max(d[i], d[i + 1], d[i + 2]);
      const min = Math.min(d[i], d[i + 1], d[i + 2]);
      if (max > 100 && max - min < max * 0.25) paper++;
    }
    return paper > (d.length / 4) * 0.55;
  } finally {
    thumb.delete();
  }
}

/**
 * Evens out lighting in place: estimates how bright the bare paper is at each
 * point (ignoring the ink), then scales every pixel so the paper comes out
 * white. All three colour channels get the same gain, so colours keep their
 * hue.
 */
function removeShadows(cv: Cv, rgba: Cv): void {
  const w = rgba.cols;
  const h = rgba.rows;
  const step = Math.max(1, Math.round(Math.max(w, h) / 320));
  const rgb = new cv.Mat();
  const paper = new cv.Mat();
  const paperFull = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(11, 11));
  try {
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, paper, cv.COLOR_RGB2GRAY);
    // Work on a small copy: lighting changes slowly across a page.
    cv.resize(
      paper,
      paper,
      new cv.Size(Math.max(1, Math.round(w / step)), Math.max(1, Math.round(h / step))),
      0,
      0,
      cv.INTER_AREA,
    );
    // Dilation paints over the dark strokes with the paper around them. The
    // kernel spans about 3% of the page: wider than headline type, narrower
    // than a shadow.
    cv.dilate(paper, paper, kernel);
    cv.medianBlur(paper, paper, 21);
    // Never brighten by more than about four times; beyond that it is a dark
    // region of the document, not a shadow, and the result would be noise.
    const p = paper.data;
    for (let i = 0; i < p.length; i++) if (p[i] < 60) p[i] = 60;
    cv.resize(paper, paperFull, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR);
    cv.cvtColor(paperFull, paperFull, cv.COLOR_GRAY2RGB);
    cv.divide(rgb, paperFull, rgb, 255, -1);
    // Push near-white paper texture to white and deepen the ink a little.
    rgb.convertTo(rgb, -1, 1.2, -30);
    cv.cvtColor(rgb, rgba, cv.COLOR_RGB2RGBA);
  } finally {
    for (const m of [rgb, paper, paperFull, kernel]) m.delete();
  }
}
