// Canvas helpers for moving pixels between the camera, files and the scanner.

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

const context = (canvas: HTMLCanvasElement) =>
  canvas.getContext('2d', { willReadFrequently: true })!;

type Drawable = HTMLVideoElement | ImageBitmap | HTMLCanvasElement;

const sizeOf = (source: Drawable) =>
  source instanceof HTMLVideoElement
    ? { width: source.videoWidth, height: source.videoHeight }
    : { width: source.width, height: source.height };

/**
 * Draws [source] onto a new canvas, scaled down if needed so its longer side
 * is at most [maxSide].
 */
export function toCanvas(source: Drawable, maxSide = Infinity): HTMLCanvasElement {
  const { width, height } = sizeOf(source);
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = canvasOf(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  context(canvas).drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export const pixelsOf = (canvas: HTMLCanvasElement) =>
  context(canvas).getImageData(0, 0, canvas.width, canvas.height);

export function toJpeg(canvas: HTMLCanvasElement, quality = 0.88): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))),
      'image/jpeg',
      quality,
    ),
  );
}

/** Encodes raw pixels (as returned by the scanner worker) as a JPEG. */
export function pixelsToJpeg(
  image: { data: Uint8ClampedArray; width: number; height: number },
  quality?: number,
): Promise<Blob> {
  const canvas = canvasOf(image.width, image.height);
  context(canvas).putImageData(
    new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height),
    0,
    0,
  );
  return toJpeg(canvas, quality);
}

/** Decodes an image file, turned upright according to its EXIF orientation. */
export async function decode(blob: Blob, maxSide?: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    return toCanvas(bitmap, maxSide);
  } finally {
    bitmap.close();
  }
}

/** Small preview of a page for the library list. */
export async function makeThumb(page: Blob): Promise<Blob> {
  return toJpeg(await decode(page, 240), 0.7);
}
