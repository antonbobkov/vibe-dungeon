/**
 * Room tiles and solidity — 01-mechanics §3.1.
 *
 * `parseRoom` reads the subset of the 03-levels §1.2 legend the sim needs today. M2's level
 * loader extends `LEGEND` with the rest of the legend (entities, traps, props, doors); it
 * does not replace this module.
 */

/** Tile classes, in the order of the 01 §3.1 solidity table. */
export enum TileClass {
  FLOOR = 0,
  WALL = 1,
  PIT = 2,
  BRIDGED_PIT = 3,
  DOOR_CLOSED = 4,
  DOOR_OPEN = 5,
  PROP = 6,
  DECAL = 7,
}

/** What is moving: the three columns of the 01 §3.1 table. */
export type Mover = 'ground' | 'fly' | 'bolt';

export interface Room {
  w: number;
  h: number;
  /** Row-major `TileClass` values, `w * h` long. */
  tiles: Uint8Array;
  /** The `@` cell (03 §1.2), or `null` in rooms that hold no floor entry point. */
  spawn: { col: number; row: number } | null;
}

/** Map symbol → tile class. M2 grows this table to the full 03 §1.2 legend. */
const LEGEND: Readonly<Record<string, TileClass>> = {
  '#': TileClass.WALL,
  '.': TileClass.FLOOR,
  _: TileClass.PIT,
  '@': TileClass.FLOOR, // player spawn — the cell itself is plain floor
};

/**
 * Solidity per 01 §3.1. Pits are solid to walkers, passable to the wisp and to bolts;
 * closed doors stop everything; crates stop bolts, other props do not (that distinction
 * arrives with the props themselves in M4 — `PROP` here is the solid-to-walkers case).
 */
export function isSolid(cls: TileClass, mover: Mover): boolean {
  switch (cls) {
    case TileClass.WALL:
    case TileClass.DOOR_CLOSED:
      return true;
    case TileClass.PIT:
      return mover === 'ground';
    case TileClass.PROP:
      return mover !== 'fly';
    case TileClass.FLOOR:
    case TileClass.BRIDGED_PIT:
    case TileClass.DOOR_OPEN:
    case TileClass.DECAL:
      return false;
  }
}

/** Tile class at a cell; outside the room is void, which is solid (00-overview §Global constants). */
export function tileAt(room: Room, col: number, row: number): TileClass {
  if (col < 0 || row < 0 || col >= room.w || row >= room.h) return TileClass.WALL;
  return room.tiles[row * room.w + col] as TileClass;
}

export function setTile(room: Room, col: number, row: number, cls: TileClass): void {
  if (col < 0 || row < 0 || col >= room.w || row >= room.h) {
    throw new Error(`setTile: (${col},${row}) is outside the ${room.w}×${room.h} room`);
  }
  room.tiles[row * room.w + col] = cls;
}

/** Build a room from ASCII rows, exactly as the maps are written in 03-levels. */
export function parseRoom(rows: readonly string[]): Room {
  if (rows.length === 0) throw new Error('parseRoom: no rows');
  const h = rows.length;
  const w = rows[0]!.length;

  const tiles = new Uint8Array(w * h);
  let spawn: Room['spawn'] = null;

  for (let row = 0; row < h; row++) {
    const line = rows[row]!;
    if (line.length !== w) {
      throw new Error(`parseRoom: row ${row} is ${line.length} cells, expected ${w}`);
    }
    for (let col = 0; col < w; col++) {
      const ch = line[col]!;
      const cls = LEGEND[ch];
      if (cls === undefined) {
        throw new Error(`parseRoom: unknown symbol "${ch}" at (${col},${row})`);
      }
      tiles[row * w + col] = cls;
      if (ch === '@') {
        if (spawn) throw new Error(`parseRoom: a second "@" at (${col},${row})`);
        spawn = { col, row };
      }
    }
  }

  return { w, h, tiles, spawn };
}
