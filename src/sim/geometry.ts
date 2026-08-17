/**
 * Integer geometry shared by combat, enemies and (from M4) traps and bolts.
 *
 * Everything here is exact in int32 at the magnitudes the game uses — a room is at most
 * 20×12 tiles, so no coordinate exceeds 5120 subpixels.
 */

import { diagAxis, type Box, type Vec } from './collision.js';
import { SUBPX, TILE_SUBPX } from './constants.js';

/** The eight compass directions, clockwise from U — the order 01 §4.2 breaks ties in. */
export enum Dir8 {
  U = 0,
  UR = 1,
  R = 2,
  DR = 3,
  D = 4,
  DL = 5,
  L = 6,
  UL = 7,
}

/** Unit steps per direction, y down (00-overview §Coordinate conventions). */
const STEPS: Readonly<Record<Dir8, { x: -1 | 0 | 1; y: -1 | 0 | 1 }>> = {
  [Dir8.U]: { x: 0, y: -1 },
  [Dir8.UR]: { x: 1, y: -1 },
  [Dir8.R]: { x: 1, y: 0 },
  [Dir8.DR]: { x: 1, y: 1 },
  [Dir8.D]: { x: 0, y: 1 },
  [Dir8.DL]: { x: -1, y: 1 },
  [Dir8.L]: { x: -1, y: 0 },
  [Dir8.UL]: { x: -1, y: -1 },
};

/**
 * Numerator and denominator of tan(67.5°) = 1 + √2 = 2.414213562…, as the convergent
 * 5741/2378 (accurate to 8 decimal places). The 22.5° boundaries between the eight
 * directions are where one axis is this many times the other.
 */
const TAN_675_NUM = 5741;
const TAN_675_DEN = 2378;

/**
 * Snap a vector to the nearest of the eight compass directions (01 §4.2).
 *
 * "Nearest" puts the boundaries at 22.5°, not at the 45° line a naive `|dx| > |dy|` would
 * use. Exactly on a boundary two directions are equally near, and 01 §4.2 breaks the tie
 * "clockwise starting from U" — which is what `Math.min` over the `Dir8` values says, since
 * they are numbered in that order. Whether the tie favours the diagonal or the cardinal
 * depends on the quadrant (U beats UR, but DR beats D), so it is resolved by index rather
 * than by leaning the comparisons one way.
 *
 * Returns `null` for the zero vector — callers decide what a coincident pair means (01 §5.2
 * sends the player opposite their facing).
 */
export function snap8(dx: number, dy: number): Dir8 | null {
  if (dx === 0 && dy === 0) return null;

  const ax = Math.abs(dx);
  const ay = Math.abs(dy);

  const vertical = dy < 0 ? Dir8.U : Dir8.D;
  const horizontal = dx < 0 ? Dir8.L : Dir8.R;
  const diagonal = dx > 0 ? (dy < 0 ? Dir8.UR : Dir8.DR) : dy < 0 ? Dir8.UL : Dir8.DL;

  const steep = ay * TAN_675_DEN - ax * TAN_675_NUM; // > 0 nearer the vertical
  if (steep > 0) return vertical;
  if (steep === 0) return Math.min(vertical, diagonal) as Dir8;

  const shallow = ax * TAN_675_DEN - ay * TAN_675_NUM; // > 0 nearer the horizontal
  if (shallow > 0) return horizontal;
  if (shallow === 0) return Math.min(horizontal, diagonal) as Dir8;

  return diagonal;
}

/** True for the four diagonals, which take the 181/256 per-axis factor. */
export function isDiagonal(dir: Dir8): boolean {
  const step = STEPS[dir];
  return step.x !== 0 && step.y !== 0;
}

/**
 * Velocity of `speed` subpx/tick along `dir`, with the diagonal factor applied per axis
 * (00-overview §Determinism rule 3), so a diagonal never outruns a cardinal.
 */
export function dirVelocity(dir: Dir8, speed: number): Vec {
  const step = STEPS[dir];
  const per = isDiagonal(dir) ? diagAxis(speed) : speed;
  return { x: step.x * per, y: step.y * per };
}

/** Squared distance, in subpixels — compared against squared thresholds to stay integer. */
export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** A squared pixel threshold in subpixel units, for `distSq` comparisons. */
export function pxSq(px: number): number {
  return px * SUBPX * (px * SUBPX);
}

/** An axis-aligned rectangle in subpixels, half-open like every box in the sim. */
export interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** The world-space rectangle of a hitbox at a position. */
export function boxRect(box: Box, pos: Vec): Rect {
  const l = pos.x + box.offX * SUBPX;
  const t = pos.y + box.offY * SUBPX;
  return { l, t, r: l + box.w * SUBPX, b: t + box.h * SUBPX };
}

/** The rectangle covering one tile. */
export function tileRect(col: number, row: number): Rect {
  const l = col * TILE_SUBPX;
  const t = row * TILE_SUBPX;
  return { l, t, r: l + TILE_SUBPX, b: t + TILE_SUBPX };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
}

/**
 * Centre of a rectangle, exactly. Every hitbox in the game is an even number of subpixels
 * wide and tall (the player is 160×128, grounded enemies 192×160, the wisp 160×160, a tile
 * 256), so the halving never loses a subpixel.
 */
export function rectCentre(rect: Rect): Vec {
  return { x: (rect.l + rect.r) >> 1, y: (rect.t + rect.b) >> 1 };
}
