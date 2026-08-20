/**
 * Auto-tiling — spec/03-levels.md §1.3.
 *
 * Turns a room's tile classes into Pack A tileset coordinates, deterministically: the same
 * map always yields the same picture, so visual goldens stay stable (TESTING.md §5). Pure
 * arithmetic with no DOM, which is why it can live outside `src/sim` and still be unit
 * tested (TESTING.md §1 lists the auto-tiler as a tested renderer part).
 *
 * This is the terrain layer only — walls, floors, doors, pits and the ladder. Props,
 * pickups, actors and trap FX are drawn above it in the layer order of AG §6.1 (M6).
 */

import { tile, type TileDef } from '../assets/packA.js';
import type { LoadedRoom } from '../sim/level.js';
import { TileClass, tileAt, type Room } from '../sim/room.js';
import { isChained } from './doors.js';

/** A Pack A tileset cell. */
export interface TileRef {
  col: number;
  row: number;
  /** Drawn mirrored: only 01 §8.3's symmetric chained doors set it. */
  flipX?: boolean;
}

const ref = (def: TileDef): TileRef => ({ col: def.col, row: def.row });

const WALL_CORNER_TL = ref(tile('wall_corner_tl'));
const WALL_CORNER_TR = ref(tile('wall_corner_tr'));
const WALL_CORNER_BL = ref(tile('wall_corner_bl'));
const WALL_CORNER_BR = ref(tile('wall_corner_br'));
const WALL_FACE_EVEN = ref(tile('wall_face_even'));
const WALL_FACE_ODD = ref(tile('wall_face_odd'));
const VOID_FILL = ref(tile('void_fill'));
const LADDER = ref(tile('ladder'));
const CRATE_PUSH = ref(tile('crate_push'));

/** `(1 + col mod 4, 0)` and `(1 + col mod 4, 4)` — the top and bottom wall runs. */
const topWall = (col: number): TileRef => ({ col: 1 + (col % 4), row: 0 });
const bottomWall = (col: number): TileRef => ({ col: 1 + (col % 4), row: 4 });
/** `(0, 1 + row mod 3)` and `(5, 1 + row mod 3)` — the left and right wall runs. */
const leftWall = (row: number): TileRef => ({ col: 0, row: 1 + (row % 3) });
const rightWall = (row: number): TileRef => ({ col: 5, row: 1 + (row % 3) });

/** Door art by type and position within the pair (01 §8.1, §8.3, AG §3.2). */
function doorArt(room: LoadedRoom, col: number, row: number, sealed: boolean): TileRef {
  const owner = room.doorCells.get(`${col},${row}`);
  if (!owner) return VOID_FILL;
  if (owner.type === 'silver') return ref(tile('door_single_closed'));

  // Two-cell doors: the left leaf is the one whose partner sits to its right.
  const partnerRight = room.doorCells.get(`${col + 1},${row}`)?.doorId === owner.doorId;
  const arched = owner.type === 'puzzle' || owner.type === 'gold';
  const left = ref(tile(arched ? 'door_arch_closed_left' : 'door_double_closed_left'));
  if (partnerRight) return left;

  // 01 §8.3: a chained door is drawn symmetrically — its right half is the left half
  // mirrored, rather than the tile that half would otherwise show. A 1-cell door has no
  // half to mirror and keeps its own.
  const partnerLeft = room.doorCells.get(`${col - 1},${row}`)?.doorId === owner.doorId;
  if (partnerLeft && isChained(owner.type, sealed)) return { ...left, flipX: true };

  return ref(tile(arched ? 'door_arch_closed_right' : 'door_double_closed_right'));
}

/**
 * Floor variant. A cell touching a wall or door on any side uses the shaded (1..4, 1..3)
 * block positionally; anything further in uses a plain variant chosen by position.
 */
function floorArt(room: Room, col: number, row: number): TileRef {
  const solidAt = (c: number, r: number): boolean => {
    const cls = tileAt(room, c, r);
    return cls === TileClass.WALL || cls === TileClass.DOOR_CLOSED || cls === TileClass.DOOR_OPEN;
  };

  const above = solidAt(col, row - 1);
  const below = solidAt(col, row + 1);
  const left = solidAt(col - 1, row);
  const right = solidAt(col + 1, row);

  if (above || below || left || right) {
    const rowIdx = above ? 1 : below ? 3 : 2;
    const colIdx = left ? 1 : right ? 4 : 2 + (col % 2);
    return { col: colIdx, row: rowIdx };
  }

  const v = (col * 3 + row * 5) % 12;
  return { col: 6 + (v % 4), row: Math.floor(v / 4) };
}

/** Is this perimeter cell part of a side gap (two `D` cells in a side wall)? */
function isSideGap(room: LoadedRoom, col: number, row: number): boolean {
  if (col !== 0 && col !== room.w - 1) return false;
  return room.doorCells.get(`${col},${row}`) !== undefined;
}

/** Wall art for a perimeter cell, including the caps a side gap punches into the run. */
function perimeterWall(room: LoadedRoom, col: number, row: number): TileRef {
  const lastCol = room.w - 1;
  const lastRow = room.h - 1;

  if (col === 0 && row === 0) return WALL_CORNER_TL;
  if (col === lastCol && row === 0) return WALL_CORNER_TR;
  if (col === 0 && row === lastRow) return WALL_CORNER_BL;
  if (col === lastCol && row === lastRow) return WALL_CORNER_BR;

  if (row === 0) return topWall(col);
  if (row === lastRow) return bottomWall(col);

  // 03 §1.3: the cell above a side gap caps the run from below, the cell below it starts a
  // fresh run from above.
  if (isSideGap(room, col, row + 1)) return col === 0 ? WALL_CORNER_BL : WALL_CORNER_BR;
  if (isSideGap(room, col, row - 1)) return col === 0 ? WALL_CORNER_TL : WALL_CORNER_TR;

  return col === 0 ? leftWall(row) : rightWall(row);
}

/** Interior free-standing wall blocks: coping on top, plain wall face below. */
function interiorWall(room: Room, col: number, row: number): TileRef {
  const above = tileAt(room, col, row - 1);
  const topOfBlock = above !== TileClass.WALL;
  if (topOfBlock) return bottomWall(col);
  return col % 2 === 0 ? WALL_FACE_EVEN : WALL_FACE_ODD;
}

/**
 * The terrain layer for a room, row-major, one Pack A tile per cell.
 *
 * `tiles` defaults to the room's map; pass the sim's live grid to see bridged pits and open
 * doors (the leaves themselves are prop-layer art, M6). `sealed` is the room's combat seal
 * (01 §8.3), which changes what a closed door shows.
 */
export function autotileRoom(room: LoadedRoom, tiles: Room = room.base, sealed = false): TileRef[] {
  const out: TileRef[] = [];

  for (let row = 0; row < room.h; row++) {
    for (let col = 0; col < room.w; col++) {
      const cls = tileAt(tiles, col, row);
      const perimeter = col === 0 || row === 0 || col === room.w - 1 || row === room.h - 1;

      if (room.ladder && room.ladder[0] === col && room.ladder[1] === row) {
        out.push(LADDER);
      } else if (cls === TileClass.DOOR_CLOSED || cls === TileClass.DOOR_OPEN) {
        // An open doorway shows the room behind it; a closed one shows its leaves.
        out.push(cls === TileClass.DOOR_OPEN ? VOID_FILL : doorArt(room, col, row, sealed));
      } else if (cls === TileClass.WALL) {
        out.push(perimeter ? perimeterWall(room, col, row) : interiorWall(tiles, col, row));
      } else if (cls === TileClass.PIT) {
        out.push(VOID_FILL);
      } else if (cls === TileClass.BRIDGED_PIT) {
        out.push(CRATE_PUSH);
      } else {
        out.push(floorArt(tiles, col, row));
      }
    }
  }

  return out;
}

/** Convenience for callers that index by cell. */
export function tileRefAt(refs: TileRef[], room: { w: number }, col: number, row: number): TileRef {
  return refs[row * room.w + col]!;
}
