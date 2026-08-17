/**
 * Traps — spec/02-entities.md §3.
 *
 * Every trap is tile-locked and runs off the room timer, so its phase is the same on every
 * entry (01 §9) and a replay can be authored against it. Traps damage the player only:
 * 02 §2.1 makes enemies and bolts immune to them, and bolts pass over enemies.
 */

import { BOLT_BOX, BOLT_SPEED, TILE_SUBPX, TRAP_DEADLY_DEN, TRAP_DEADLY_NUM } from './constants.js';
import { boxRect, type Rect } from './geometry.js';
import type { Cell, LoadedTrap } from './level.js';
import { TileClass, tileAt, type Room } from './room.js';

/** A trap placement in the current room; only its phase is hashed (05 §4). */
export interface SimTrap {
  def: LoadedTrap;
  phase: number;
}

/** A bolt in flight (02 §3.2). */
export interface SimBolt {
  /** Spawn order within the room, which is the order 01 §1 phase 5 updates them in. */
  id: number;
  /** Sprite-cell top-left, in subpixels. */
  x: number;
  y: number;
}

/**
 * The first phase of the deadly window: `(3 * period) / 5`, integer division (02 §3) — the
 * last 40% of the cycle. 72 of 120, 90 of 150, 108 of 180. Phase 0 is always safe.
 */
export function deadlyStart(period: number): number {
  return Math.floor((TRAP_DEADLY_NUM * period) / TRAP_DEADLY_DEN);
}

/** Phase of a trap at a given room tick: `(roomTimer + offset) mod period` (02 §3). */
export function trapPhase(trap: LoadedTrap, roomTimer: number): number {
  return (roomTimer + trap.offset) % trap.period;
}

/**
 * Whether a trap's tile is deadly this tick. `always_on` traps never leave the window, and
 * arrow launchers have none — they fire a bolt at phase 0 instead (02 §3.2).
 */
export function isDeadly(trap: LoadedTrap, phase: number): boolean {
  if (trap.kind === 'arrow') return false;
  if (trap.alwaysOn) return true;
  return phase >= deadlyStart(trap.period);
}

/** Whether a launcher fires this tick (02 §3.2). */
export function isFiring(trap: LoadedTrap, phase: number): boolean {
  return trap.kind === 'arrow' && phase === 0;
}

/** The tiles that hurt to stand on this tick. */
export function deadlyTiles(traps: readonly SimTrap[]): Cell[] {
  const tiles: Cell[] = [];
  for (const trap of traps) {
    if (trap.def.deadly && isDeadly(trap.def, trap.phase)) tiles.push(trap.def.deadly);
  }
  return tiles;
}

/**
 * A bolt leaving a launcher: 4 × 10 px centred in the lane, its top edge on the top edge of
 * the tile below the launcher (02 §3.2). `BOLT_BOX` carries the centring, so the sprite cell
 * simply sits on the launcher's column.
 */
export function boltAt(id: number, launcher: Cell): SimBolt {
  const [col, row] = launcher;
  return { id, x: col * TILE_SUBPX, y: (row + 1) * TILE_SUBPX };
}

/** A bolt's hitbox in world space. */
export function boltRect(bolt: SimBolt): Rect {
  return boxRect(BOLT_BOX, bolt);
}

/** One tick of flight: straight down at 40 subpx/tick (02 §3.2). */
export function advanceBolt(bolt: SimBolt): void {
  bolt.y += BOLT_SPEED;
}

/**
 * Whether a bolt is stopped by the room: a wall, a closed door, or any crate — the
 * crate-shadow the puzzles use. It passes over pits, pickups, spikes and enemies (02 §3.2).
 */
export function boltBlocked(room: Room, bolt: SimBolt): boolean {
  const rect = boltRect(bolt);
  const colStart = Math.floor(rect.l / TILE_SUBPX);
  const colEnd = Math.floor((rect.r - 1) / TILE_SUBPX);
  const rowStart = Math.floor(rect.t / TILE_SUBPX);
  const rowEnd = Math.floor((rect.b - 1) / TILE_SUBPX);

  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      if (row >= room.h || col >= room.w || row < 0 || col < 0) return true; // left the room
      const cls = tileAt(room, col, row);
      if (cls === TileClass.WALL || cls === TileClass.DOOR_CLOSED || cls === TileClass.PROP) {
        return true;
      }
    }
  }
  return false;
}
