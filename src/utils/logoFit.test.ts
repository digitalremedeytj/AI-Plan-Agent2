import test from "node:test";
import assert from "node:assert/strict";
import { fitLogo, REFERENCE_ASPECT, trimBox } from "./logoFit";

const box = { width: 1000, height: 1000 };

test("logos of different shapes are given the same area, so a wide wordmark does not look bigger", () => {
  const resonate = fitLogo(6.9, 30, box);
  const census = fitLogo(2.55, 30, box);
  const area = (b: { width: number; height: number }) => b.width * b.height;
  assert.ok(Math.abs(area(resonate) - area(census)) / area(census) < 0.01);
  assert.ok(resonate.height < 30 && census.height > 30);
  assert.deepEqual(fitLogo(REFERENCE_ASPECT, 30, box), { width: 111, height: 30 });
});

test("a logo never outgrows the box it sits in, and keeps its shape when shrunk", () => {
  const fit = fitLogo(6.9, 30, { width: 100, height: 40 });
  assert.equal(fit.width, 100);
  assert.ok(Math.abs(fit.width / fit.height - 6.9) < 0.05);
  const tall = fitLogo(1, 40, { width: 200, height: 30 });
  assert.equal(tall.height, 30);
});

test("an unreadable aspect ratio falls back to a typical wordmark instead of breaking the layout", () => {
  assert.deepEqual(fitLogo(NaN, 30, box), fitLogo(REFERENCE_ASPECT, 30, box));
  assert.deepEqual(fitLogo(0, 30, box), fitLogo(REFERENCE_ASPECT, 30, box));
});

function image(width: number, height: number, background: number[], ink: Array<[number, number]>): number[] {
  const data: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    data.push(...(ink.some(([ix, iy]) => ix === x && iy === y) ? [10, 20, 30, 255] : background));
  }
  return data;
}

test("transparent margin around a logo is trimmed away", () => {
  const data = image(6, 5, [0, 0, 0, 0], [[2, 1], [4, 3]]);
  assert.deepEqual(trimBox(data, 6, 5), { x: 2, y: 1, width: 3, height: 3 });
});

test("a logo saved on a white background is trimmed to the logo, not the whole image", () => {
  const data = image(6, 5, [255, 255, 255, 255], [[1, 2], [3, 2]]);
  assert.deepEqual(trimBox(data, 6, 5), { x: 1, y: 2, width: 3, height: 1 });
});

test("an empty image has nothing to trim to", () => {
  assert.equal(trimBox(image(3, 3, [0, 0, 0, 0], []), 3, 3), null);
});
