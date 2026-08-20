/**
 * Door art — the pure decisions behind 01-mechanics §8.1 (open leaves, keyholes) and §8.3
 * (the chains an event-locked door wears).
 *
 * Cells and tile classes in, a draw list out: no canvas, no atlas, no clock. Every tile id,
 * offset, flip and pixel below is therefore pinned by exact numbers in
 * tests/unit/door-art.spec.ts rather than eyeballed on a screenshot (TESTING.md §2).
 *
 * Coordinates are **room-local pixels** — the caller adds the room origin.
 */

import { TILE } from '../sim/constants.js';
import type { Cell, DoorType, LoadedRoom } from '../sim/level.js';
import { TileClass, tileAt, type Room } from '../sim/room.js';
import { PALETTE } from './palette.js';

/** One tile of door art at a room-local pixel position. */
export interface DoorTileDraw {
  /** A manifest tile id (packA.ts). */
  tile: string;
  x: number;
  y: number;
  flipX: boolean;
}

const cellKey = (col: number, row: number): string => `${col},${row}`;

const parseCell = (key: string): Cell => key.split(',').map(Number) as Cell;

/** Every door with a foot in this room, with its cells, in door-table order. */
function doorGroups(def: LoadedRoom): { doorId: string; type: DoorType; cells: Cell[] }[] {
  const groups = new Map<string, { doorId: string; type: DoorType; cells: Cell[] }>();
  for (const [key, owner] of def.doorCells) {
    let group = groups.get(owner.doorId);
    if (!group) {
      group = { doorId: owner.doorId, type: owner.type, cells: [] };
      groups.set(owner.doorId, group);
    }
    group.cells.push(parseCell(key));
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Open leaves (01 §8.1)
// ---------------------------------------------------------------------------

/**
 * How far an open leaf stands proud of the wall row it belongs to. The leaf is one 16×16
 * tile tucked ¾ into its doorway: 12 px overlap the door row, 4 px reach into the room.
 */
export const LEAF_PROTRUDE_PX = 4;

export type DoorSide = 'left' | 'right' | 'single';

/**
 * Where a door cell sits in its endpoint: the half of a pair whose partner is to its right is
 * the left one, the other is the right one, and a one-cell door (the steel `L`, or either
 * cell of a side gap, whose partner is stacked above or below) is a single.
 */
export function doorCellSide(def: LoadedRoom, col: number, row: number): DoorSide {
  const owner = def.doorCells.get(cellKey(col, row));
  if (!owner) return 'single';
  if (def.doorCells.get(cellKey(col + 1, row))?.doorId === owner.doorId) return 'left';
  if (def.doorCells.get(cellKey(col - 1, row))?.doorId === owner.doorId) return 'right';
  return 'single';
}

/**
 * Which leaf a cell hangs. The pair's halves hug their own jambs — `(7,4)` is inset left,
 * `(8,4)` inset right — so the 2-cell opening between them stays visually clear; a single
 * steel door hangs its one leaf on the left jamb.
 */
const LEAF_TILE: Readonly<Record<DoorSide, string>> = {
  left: 'door_leaf_left_top',
  right: 'door_leaf_right_top',
  single: 'door_leaf_left_top',
};

/** A top-wall leaf protrudes down into the room; a bottom-wall one protrudes up out of it. */
export const leafY = (row: number): number =>
  row === 0 ? row * TILE + LEAF_PROTRUDE_PX : row * TILE - LEAF_PROTRUDE_PX;

/** The open top/bottom-wall doors of a room, one leaf tile per door cell. */
export function doorLeafDraws(def: LoadedRoom, tiles: Room): DoorTileDraw[] {
  const out: DoorTileDraw[] = [];
  for (const [key, owner] of def.doorCells) {
    if (owner.type === 'gap') continue; // side gaps have no door art at all (01 §8.1)
    const [col, row] = parseCell(key);
    if (sideWallAt(def, col) !== null) continue; // side doors swing differently — below
    if (tileAt(tiles, col, row) !== TileClass.DOOR_OPEN) continue;
    out.push({
      tile: LEAF_TILE[doorCellSide(def, col, row)],
      x: col * TILE,
      y: leafY(row),
      flipX: false,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Side-wall doors (01 §8.1)
// ---------------------------------------------------------------------------

export type SideWall = 'left' | 'right';

/** Which side wall a column is, or `null` for a column inside the room. */
export function sideWallAt(def: LoadedRoom, col: number): SideWall | null {
  if (col === 0) return 'left';
  if (col === def.w - 1) return 'right';
  return null;
}

/** A side-wall door as its art needs it: which wall, which column, and its two stacked cells. */
export interface SideDoor {
  doorId: string;
  wall: SideWall;
  col: number;
  topRow: number;
  bottomRow: number;
}

/**
 * The side-wall doors with a foot in this room. Gaps are left out: an opening the level never
 * closes has no leaf to draw in either state (01 §8.1).
 */
export function sideDoors(def: LoadedRoom): SideDoor[] {
  const out: SideDoor[] = [];
  for (const group of doorGroups(def)) {
    if (group.type === 'gap') continue;
    const col = group.cells[0]![0];
    const wall = sideWallAt(def, col);
    if (wall === null) continue;
    const rows = group.cells.map(([, row]) => row);
    out.push({
      doorId: group.doorId,
      wall,
      col,
      topRow: Math.min(...rows),
      bottomRow: Math.max(...rows),
    });
  }
  return out;
}

/**
 * The edge-on leaf a **closed** side door shows, one tile over each of its two cells.
 *
 * A door seen from the side is a few pixels of board against the wall line, which is exactly
 * what the *inset* halves of the leaf tiles are: `(8,4)/(8,5)` carry their art on x10–15, so
 * they sit flush with a left wall's brick line, and `(7,4)/(7,5)` carry theirs on x0–5 for a
 * right wall. The cells underneath autotile as the open passage either way, so this overlay
 * is the whole difference between a shut side door and a gap.
 */
export const SIDE_SLIT_TILES: Readonly<Record<SideWall, readonly [string, string]>> = {
  left: ['door_leaf_right_top', 'door_leaf_right_bottom'],
  right: ['door_leaf_left_top', 'door_leaf_left_bottom'],
};

/**
 * The two front-view halves an **open** side door stands folded back against the wall as —
 * the same double-door tiles a top/bottom door is closed with, split across the cells above
 * and below the opening.
 */
export const SIDE_LEAF_TOP_TILE = 'door_double_closed_left';
export const SIDE_LEAF_BOTTOM_TILE = 'door_double_closed_right';

/**
 * A side door's art, closed or open (01 §8.1).
 *
 * Closed, it is the two edge-on slits over the opening itself. Open, the leaves cannot hang
 * in the doorway — there is no room for them edge-on and nothing to hang them from — so they
 * are anchored to the wall *beyond* the opening, in the room-side column (`1` at a left wall,
 * `w−2` at a right one): the top half in the cell beside the wall above the opening, the
 * bottom half beside the wall below it, mirrored so the pair reads as one door folded back.
 * A right-wall door mirrors the whole arrangement, which flips both halves again.
 */
export function sideDoorDraws(def: LoadedRoom, tiles: Room): DoorTileDraw[] {
  const out: DoorTileDraw[] = [];

  for (const door of sideDoors(def)) {
    const closed = tileAt(tiles, door.col, door.topRow) === TileClass.DOOR_CLOSED;
    if (closed) {
      const [top, bottom] = SIDE_SLIT_TILES[door.wall];
      out.push({ tile: top, x: door.col * TILE, y: door.topRow * TILE, flipX: false });
      out.push({ tile: bottom, x: door.col * TILE, y: door.bottomRow * TILE, flipX: false });
      continue;
    }

    const mirrored = door.wall === 'right';
    const x = (door.wall === 'left' ? 1 : def.w - 2) * TILE;
    out.push({
      tile: SIDE_LEAF_TOP_TILE,
      x,
      y: (door.topRow - 1) * TILE,
      flipX: mirrored,
    });
    out.push({
      tile: SIDE_LEAF_BOTTOM_TILE,
      x,
      y: (door.bottomRow + 1) * TILE,
      flipX: !mirrored,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Keyholes (01 §8.1)
// ---------------------------------------------------------------------------

export type KeyholeMetal = 'silver' | 'gold';
export type KeyholeShade = 'plate' | 'highlight' | 'dark';

export const KEYHOLE_W = 6;
export const KEYHOLE_H = 9;

/** Pack A's palette, by the part of the plate it paints (01 §8.1 fixes these). */
export const KEYHOLE_COLOURS: Readonly<
  Record<KeyholeMetal, Readonly<Record<KeyholeShade, string>>>
> = {
  silver: { plate: PALETTE.steelDark, highlight: PALETTE.steel, dark: PALETTE.void },
  gold: { plate: PALETTE.goldDark, highlight: PALETTE.gold, dark: PALETTE.void },
};

/**
 * The plate itself, drawn here rather than cut from the tileset — Pack A has no keyhole art.
 * An escutcheon lit from the top left, with a 2×2 ring over a 1×3 slot cut out of it:
 *
 * ```
 *   H H H H H D     H  highlight — the lit top and left edges
 *   H P P P P D     P  plate     — the metal itself
 *   H P K K P D     D  dark      — the shaded bottom and right edges
 *   H P K K P D     K  dark      — the keyhole: a 2×2 ring …
 *   H P K P P D
 *   H P K P P D
 *   H P K P P D                  … over a 1×3 slot
 *   H P P P P D
 *   D D D D D D
 * ```
 *
 * Nine rows rather than eight: the keyway is five tall, and an 8-row plate has only six rows
 * inside its two bevels, so one end of the keyway would touch the dark edge and stop reading
 * as a hole in the metal. The ninth row buys a pixel of plate above and below it.
 *
 * The ring straddles the plate's centre line, which is the door's centre line; the slot is
 * one pixel wide and so cannot be, and sits to its left.
 */
const KEYHOLE_ART: readonly string[] = [
  'HHHHHD',
  'HPPPPD',
  'HPKKPD',
  'HPKKPD',
  'HPKPPD',
  'HPKPPD',
  'HPKPPD',
  'HPPPPD',
  'DDDDDD',
];

const SHADE_OF: Readonly<Record<string, KeyholeShade>> = {
  H: 'highlight',
  P: 'plate',
  D: 'dark',
  K: 'dark',
};

/** The plate as a flat pixel list, in the style of `PUFF_PIXELS`: `[x, y, shade]`. */
export const KEYHOLE_PIXELS: readonly (readonly [number, number, KeyholeShade])[] =
  KEYHOLE_ART.flatMap((line, y) =>
    [...line].map((ch, x) => [x, y, SHADE_OF[ch]!] as readonly [number, number, KeyholeShade]),
  );

export interface KeyholeDraw {
  metal: KeyholeMetal;
  x: number;
  y: number;
}

/** Only the two keyed door types wear one. */
const KEYHOLE_METAL: Partial<Readonly<Record<DoorType, KeyholeMetal>>> = {
  silver: 'silver',
  gold: 'gold',
};

/**
 * The keyholes of a room: one per **closed** keyed door, centred on the door's whole span —
 * the middle of the single `L` tile, the seam of the `GG` pair. An open door has none, and
 * neither has a normal or a puzzle door, which have no keyway to show.
 */
export function keyholeDraws(def: LoadedRoom, tiles: Room): KeyholeDraw[] {
  const out: KeyholeDraw[] = [];
  for (const group of doorGroups(def)) {
    const metal = KEYHOLE_METAL[group.type];
    if (!metal) continue;
    if (!group.cells.every(([col, row]) => tileAt(tiles, col, row) === TileClass.DOOR_CLOSED)) {
      continue;
    }

    const cols = group.cells.map(([col]) => col);
    const minCol = Math.min(...cols);
    const span = Math.max(...cols) - minCol + 1;
    const row = Math.min(...group.cells.map(([, r]) => r));
    out.push({
      metal,
      x: minCol * TILE + Math.floor((span * TILE - KEYHOLE_W) / 2),
      y: row * TILE + Math.floor((TILE - KEYHOLE_H) / 2),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chains (01 §8.3)
// ---------------------------------------------------------------------------

/** The shackle prop of AG §3.1, tile `(5,7)` — one hung on each chained door cell. */
export const CHAIN_TILE = 'decor_shackle';

/**
 * Which closed doors are chained shut: puzzle doors, which no key opens, and every door in a
 * room a combat seal is holding. A key-locked door is not — a lock is not a chain.
 */
export const isChained = (type: DoorType, sealed: boolean): boolean => sealed || type === 'puzzle';

/**
 * The cells wearing a chain right now. The renderer draws one shackle on each, and the event
 * layer watches this same list: a chain that stops being drawn is a chain that broke off.
 *
 * A **side** door in a sealed room is chained by the same rule and needs no special case: its
 * cells are door cells like any other, so a shackle hangs centred on each of the two, over
 * the edge-on slits. (A side door is never `puzzle`, so a seal is the only thing that chains
 * one — lint, 03 §1.4.)
 */
export function chainedCells(def: LoadedRoom, tiles: Room, sealed: boolean): Cell[] {
  const out: Cell[] = [];
  for (const [key, owner] of def.doorCells) {
    if (!isChained(owner.type, sealed)) continue;
    const [col, row] = parseCell(key);
    if (tileAt(tiles, col, row) !== TileClass.DOOR_CLOSED) continue;
    out.push([col, row]);
  }
  return out;
}

/** Those cells as draws: the shackle covers its whole cell, so it is centred by construction. */
export function chainDraws(def: LoadedRoom, tiles: Room, sealed: boolean): DoorTileDraw[] {
  return chainedCells(def, tiles, sealed).map(([col, row]) => ({
    tile: CHAIN_TILE,
    x: col * TILE,
    y: row * TILE,
    flipX: false,
  }));
}
