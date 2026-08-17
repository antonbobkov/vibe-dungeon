import { describe, expect, it } from 'vitest';

import { diagAxis } from '../../src/sim/collision.js';
import { Dir8, dirVelocity, isDiagonal, pxSq, snap8 } from '../../src/sim/geometry.js';

/**
 * 01-mechanics §4.2: vectors snap to the *nearest* of eight directions, with ties resolved
 * clockwise from U. Nearest puts the boundaries at 22.5°, not at the 45° line.
 */
describe('snap8', () => {
  it('names the eight directions clockwise from U', () => {
    expect([Dir8.U, Dir8.UR, Dir8.R, Dir8.DR, Dir8.D, Dir8.DL, Dir8.L, Dir8.UL]).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('snaps the four cardinals', () => {
    expect(snap8(0, -100)).toBe(Dir8.U);
    expect(snap8(0, 100)).toBe(Dir8.D);
    expect(snap8(-100, 0)).toBe(Dir8.L);
    expect(snap8(100, 0)).toBe(Dir8.R);
  });

  it('snaps the four diagonals', () => {
    expect(snap8(100, -100)).toBe(Dir8.UR);
    expect(snap8(100, 100)).toBe(Dir8.DR);
    expect(snap8(-100, 100)).toBe(Dir8.DL);
    expect(snap8(-100, -100)).toBe(Dir8.UL);
  });

  it('keeps a shallow vector cardinal instead of rounding it to 45°', () => {
    // 20° from the x-axis: nearer R than DR, though |dy| is far from zero.
    expect(snap8(100, 36)).toBe(Dir8.R);
    // 25°: past the boundary, so it becomes the diagonal.
    expect(snap8(100, 47)).toBe(Dir8.DR);
  });

  it('puts the boundary at 22.5°, not 45°', () => {
    // tan(22.5°) = 0.414214, so at |dx| = 1000 the switch happens between 414 and 415.
    expect(snap8(1000, -414)).toBe(Dir8.R);
    expect(snap8(1000, -415)).toBe(Dir8.UR);
    expect(snap8(-414, 1000)).toBe(Dir8.D);
    expect(snap8(-415, 1000)).toBe(Dir8.DL);
  });

  it('breaks all eight exact ties clockwise from U', () => {
    // 5741/2378 is tan(67.5°), so these vectors sit exactly on a boundary. The winner is
    // always the direction that comes first going clockwise from U — which is sometimes the
    // cardinal and sometimes the diagonal, depending on the quadrant.
    expect(snap8(2378, -5741)).toBe(Dir8.U); // U(0) before UR(1)
    expect(snap8(5741, -2378)).toBe(Dir8.UR); // UR(1) before R(2)
    expect(snap8(5741, 2378)).toBe(Dir8.R); // R(2) before DR(3)
    expect(snap8(2378, 5741)).toBe(Dir8.DR); // DR(3) before D(4)
    expect(snap8(-2378, 5741)).toBe(Dir8.D); // D(4) before DL(5)
    expect(snap8(-5741, 2378)).toBe(Dir8.DL); // DL(5) before L(6)
    expect(snap8(-5741, -2378)).toBe(Dir8.L); // L(6) before UL(7)
    expect(snap8(-2378, -5741)).toBe(Dir8.U); // U(0) before UL(7)
  });

  it('scales the tie-breaks, since a boundary is a ray not a point', () => {
    expect(snap8(2378 * 3, -5741 * 3)).toBe(Dir8.U);
    expect(snap8(5741 * 7, 2378 * 7)).toBe(Dir8.R);
  });

  it('has nothing to say about a zero vector', () => {
    expect(snap8(0, 0)).toBeNull();
  });
});

describe('dirVelocity', () => {
  it('moves at full speed along a cardinal', () => {
    expect(dirVelocity(Dir8.R, 48)).toEqual({ x: 48, y: 0 });
    expect(dirVelocity(Dir8.U, 48)).toEqual({ x: 0, y: -48 });
  });

  it('applies the 181/256 factor per axis on a diagonal', () => {
    // (48 * 181) >> 8 = 33, so a diagonal covers the same ground per tick as a cardinal.
    expect(diagAxis(48)).toBe(33);
    expect(dirVelocity(Dir8.DR, 48)).toEqual({ x: 33, y: 33 });
    expect(dirVelocity(Dir8.UL, 48)).toEqual({ x: -33, y: -33 });
  });

  it('agrees with isDiagonal about which directions are which', () => {
    for (const dir of [Dir8.U, Dir8.D, Dir8.L, Dir8.R]) expect(isDiagonal(dir)).toBe(false);
    for (const dir of [Dir8.UR, Dir8.DR, Dir8.DL, Dir8.UL]) expect(isDiagonal(dir)).toBe(true);
  });
});

describe('pxSq', () => {
  it('converts a pixel threshold into the squared subpixel space distances live in', () => {
    expect(pxSq(24)).toBe(384 * 384);
    expect(pxSq(112)).toBe(1792 * 1792);
  });
});
