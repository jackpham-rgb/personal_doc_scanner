import { beforeAll, describe, expect, test } from 'vitest';
import { type Cv, detectQuad, flatten } from '../src/scanner/cv-core';
import { fullQuad, orderCorners, quadArea, quadDrift, quadSize } from '../src/scanner/geometry';
import type { Quad } from '../src/types';
import { brightness, drawScene, loadCv } from './helpers';

// A page seen from the lower left: every side a different length.
const PAGE: Quad = [
  { x: 150, y: 60 },
  { x: 500, y: 90 },
  { x: 470, y: 430 },
  { x: 120, y: 400 },
];

let cv: Cv;
beforeAll(async () => {
  cv = await loadCv();
});

describe('geometry', () => {
  test('orders corners clockwise from the top left, whatever order they come in', () => {
    const [tl, tr, br, bl] = PAGE;
    for (const shuffled of [
      [br, tl, bl, tr],
      [bl, br, tr, tl],
      [tr, bl, tl, br],
    ]) {
      expect(orderCorners(shuffled)).toEqual(PAGE);
    }
  });

  test('size takes the longer of opposite edges', () => {
    const size = quadSize([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 80, y: 50 },
      { x: 20, y: 50 },
    ]);
    expect(size.width).toBe(100);
    expect(size.height).toBeCloseTo(Math.hypot(20, 50));
  });

  test('area and drift', () => {
    expect(quadArea(fullQuad(40, 30))).toBe(1200);
    expect(quadDrift(fullQuad(40, 30), fullQuad(43, 34))).toBe(5);
  });
});

describe('detectQuad', () => {
  test('finds the corners of a page lying at an angle', () => {
    const quad = detectQuad(cv, drawScene(PAGE));
    expect(quad).not.toBeNull();
    expect(quadDrift(quad!, PAGE)).toBeLessThan(6);
  });

  test('finds a page that is half in shadow', () => {
    const quad = detectQuad(cv, drawScene(PAGE, { paperLeft: 120, paperRight: 250 }));
    expect(quad).not.toBeNull();
    expect(quadDrift(quad!, PAGE)).toBeLessThan(8);
  });

  test('finds a white page on a light desk', () => {
    const quad = detectQuad(cv, drawScene(PAGE, { background: [185, 180, 170] }));
    expect(quad).not.toBeNull();
    expect(quadDrift(quad!, PAGE)).toBeLessThan(8);
  });

  test('reports nothing for an empty desk', () => {
    const empty = drawScene(PAGE, { paperLeft: 50, paperRight: 50, background: [50, 50, 50] });
    // Same grey everywhere except the "print" bar, which is far too small.
    expect(detectQuad(cv, empty)).toBeNull();
  });

  test('ignores a page too small to be the subject', () => {
    const tiny: Quad = [
      { x: 300, y: 200 },
      { x: 360, y: 200 },
      { x: 360, y: 280 },
      { x: 300, y: 280 },
    ];
    expect(detectQuad(cv, drawScene(tiny))).toBeNull();
  });
});

describe('flatten', () => {
  test('straightens the page into an upright rectangle', () => {
    const { image } = flatten(cv, drawScene(PAGE), PAGE, { maxSide: 2000, enhance: 'off' });
    const expected = quadSize(PAGE);
    expect(image.width).toBe(Math.round(expected.width));
    expect(image.height).toBe(Math.round(expected.height));

    // Paper right into the corners: no desk left in the picture.
    const { width: w, height: h } = image;
    for (const [x, y] of [
      [4, 4],
      [w - 5, 4],
      [w - 5, h - 5],
      [4, h - 5],
    ]) {
      expect(brightness(image, x, y)).toBeGreaterThan(200);
    }
    // The bar of "print" is now level: dark right across at 31% down,
    // paper just above and below it.
    for (const u of [0.25, 0.5, 0.75]) {
      expect(brightness(image, w * u, h * 0.31)).toBeLessThan(80);
      expect(brightness(image, w * u, h * 0.24)).toBeGreaterThan(200);
      expect(brightness(image, w * u, h * 0.38)).toBeGreaterThan(200);
    }
  });

  test('scales large pages down to maxSide', () => {
    const { image } = flatten(cv, drawScene(PAGE), PAGE, { maxSide: 170, enhance: 'off' });
    expect(Math.max(image.width, image.height)).toBe(170);
  });

  test('enhancement turns a shadowed page evenly white and keeps the print dark', () => {
    const scene = drawScene(PAGE, { paperLeft: 110, paperRight: 250 });
    const plain = flatten(cv, scene, PAGE, { maxSide: 2000, enhance: 'off' }).image;
    const result = flatten(cv, scene, PAGE, { maxSide: 2000, enhance: 'auto' });
    const { image } = result;
    const { width: w, height: h } = image;

    expect(result.enhanced).toBe(true);
    expect(brightness(plain, w * 0.1, h * 0.7)).toBeLessThan(180);
    expect(brightness(image, w * 0.1, h * 0.7)).toBeGreaterThan(240);
    expect(brightness(image, w * 0.9, h * 0.7)).toBeGreaterThan(240);
    expect(brightness(image, w * 0.5, h * 0.31)).toBeLessThan(80);
  });

  test('auto enhancement leaves a coloured card alone', () => {
    const scene = drawScene(PAGE, { paperTint: [0.2, 0.45, 0.9] });
    const plain = flatten(cv, scene, PAGE, { maxSide: 2000, enhance: 'off' });
    const auto = flatten(cv, scene, PAGE, { maxSide: 2000, enhance: 'auto' });
    expect(auto.enhanced).toBe(false);
    expect(auto.image.data).toEqual(plain.image.data);
  });
});
