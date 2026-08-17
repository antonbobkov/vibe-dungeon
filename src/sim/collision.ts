/**
 * Axis-separated movement and tile collision — 01-mechanics §3.2.
 *
 * The single implementation of the movement rule: the player (M1), enemies and knockback
 * (M3) and bolts (M4) all move through `moveAxisSeparated`, differing only in hitbox and
 * mover class. Moving each axis separately and clamping flush is what yields wall sliding
 * and the corner rule without either being special-cased.
 *
 * All positions are integer subpixels; boxes are half-open, so a box whose right edge sits
 * exactly on a tile boundary does not touch that tile.
 */

import { DIAG_NUM, DIAG_SHIFT, SUBPX, TILE_SUBPX } from './constants.js';
import { isSolid, tileAt, type Mover, type Room } from './room.js';

/** Hitbox in pixels, offset from the entity's 16×16 sprite-cell top-left (00-overview). */
export interface Box {
  offX: number;
  offY: number;
  w: number;
  h: number;
}

/** A position or velocity in subpixels. */
export interface Vec {
  x: number;
  y: number;
}

/**
 * Per-axis speed on a diagonal: `(v * 181) >> 8` (00-overview §Determinism rule 3).
 *
 * Takes a magnitude, never a signed velocity: `>>` floors toward −∞, so `(-20*181)>>8` is
 * −15 while `(20*181)>>8` is 14. Signing after the shift keeps every direction symmetric.
 */
export function diagAxis(speed: number): number {
  return (speed * DIAG_NUM) >> DIAG_SHIFT;
}

/** Centre of an entity's hitbox, in subpixels — the point 01 §8 measures door proximity from. */
export function boxCentre(box: Box, pos: Vec): Vec {
  return {
    x: pos.x + box.offX * SUBPX + (box.w * SUBPX) / 2,
    y: pos.y + box.offY * SUBPX + (box.h * SUBPX) / 2,
  };
}

/** Tile column/row containing a subpixel coordinate. */
function cellOf(sub: number): number {
  return Math.floor(sub / TILE_SUBPX);
}

/** True if column `col` blocks `mover` anywhere across the box's row span. */
function columnBlocked(room: Room, col: number, t: number, b: number, mover: Mover): boolean {
  for (let row = cellOf(t); row <= cellOf(b - 1); row++) {
    if (isSolid(tileAt(room, col, row), mover)) return true;
  }
  return false;
}

/** True if row `row` blocks `mover` anywhere across the box's column span. */
function rowBlocked(room: Room, row: number, l: number, r: number, mover: Mover): boolean {
  for (let col = cellOf(l); col <= cellOf(r - 1); col++) {
    if (isSolid(tileAt(room, col, row), mover)) return true;
  }
  return false;
}

/**
 * Move `pos` by `vel`, one axis at a time, clamping the hitbox flush against the first
 * solid tile in the direction of travel. Returns the new sprite-cell position in subpixels.
 */
export function moveAxisSeparated(room: Room, box: Box, pos: Vec, vel: Vec, mover: Mover): Vec {
  const offX = box.offX * SUBPX;
  const offY = box.offY * SUBPX;
  const bw = box.w * SUBPX;
  const bh = box.h * SUBPX;

  let x = pos.x;
  let y = pos.y;

  // 1. Move X, then clamp.
  if (vel.x !== 0) {
    x += vel.x;
    const top = y + offY;
    const bottom = top + bh;
    const left = x + offX;
    const right = left + bw;
    if (vel.x > 0) {
      for (let col = cellOf(left); col <= cellOf(right - 1); col++) {
        if (columnBlocked(room, col, top, bottom, mover)) {
          x = col * TILE_SUBPX - (offX + bw);
          break;
        }
      }
    } else {
      for (let col = cellOf(right - 1); col >= cellOf(left); col--) {
        if (columnBlocked(room, col, top, bottom, mover)) {
          x = (col + 1) * TILE_SUBPX - offX;
          break;
        }
      }
    }
  }

  // 2. Move Y, then clamp — against the already-resolved X.
  if (vel.y !== 0) {
    y += vel.y;
    const left = x + offX;
    const right = left + bw;
    const top = y + offY;
    const bottom = top + bh;
    if (vel.y > 0) {
      for (let row = cellOf(top); row <= cellOf(bottom - 1); row++) {
        if (rowBlocked(room, row, left, right, mover)) {
          y = row * TILE_SUBPX - (offY + bh);
          break;
        }
      }
    } else {
      for (let row = cellOf(bottom - 1); row >= cellOf(top); row--) {
        if (rowBlocked(room, row, left, right, mover)) {
          y = (row + 1) * TILE_SUBPX - offY;
          break;
        }
      }
    }
  }

  return { x, y };
}
