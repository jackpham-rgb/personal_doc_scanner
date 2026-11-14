import type { Point, Quad } from '../types';

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Orders four corners clockwise, starting from the top left. */
export function orderCorners(points: readonly Point[]): Quad {
  const cx = points.reduce((s, p) => s + p.x, 0) / 4;
  const cy = points.reduce((s, p) => s + p.y, 0) / 4;
  // With y pointing down, increasing atan2 walks clockwise on screen.
  const ring = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  let start = 0;
  for (let i = 1; i < 4; i++) {
    if (ring[i].x + ring[i].y < ring[start].x + ring[start].y) start = i;
  }
  return [0, 1, 2, 3].map((i) => ring[(start + i) % 4]) as Quad;
}

/** Quad covering a whole image. */
export const fullQuad = (width: number, height: number): Quad => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

export const scaleQuad = (q: Quad, sx: number, sy = sx): Quad =>
  q.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Quad;

/**
 * Size of the flattened page: the longer of each pair of opposite edges, so
 * the side that perspective made shorter is stretched back, not the reverse.
 */
export function quadSize([tl, tr, br, bl]: Quad): { width: number; height: number } {
  return {
    width: Math.max(dist(tl, tr), dist(bl, br)),
    height: Math.max(dist(tl, bl), dist(tr, br)),
  };
}

/** Largest distance any corner moved between two quads. */
export const quadDrift = (a: Quad, b: Quad) => Math.max(...a.map((p, i) => dist(p, b[i])));

export function quadArea(q: Quad): number {
  let twice = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/**
 * Moves every corner a little towards the middle. Detected outlines sit on
 * the boundary between page and desk; trimming by a sliver keeps the desk out
 * of the scan.
 */
export function insetQuad(q: Quad, fraction: number): Quad {
  const cx = q.reduce((s, p) => s + p.x, 0) / 4;
  const cy = q.reduce((s, p) => s + p.y, 0) / 4;
  return q.map((p) => ({ x: p.x + (cx - p.x) * fraction, y: p.y + (cy - p.y) * fraction })) as Quad;
}
