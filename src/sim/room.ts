/**
 * Room tiles, the map legend and solidity — 01-mechanics §3.1, 03-levels §1.2.
 *
 * `parseRoom` turns an ASCII map into the tile grid the collision code walks, plus the list
 * of non-terrain symbols it found. Interpreting those symbols against the room's tables
 * (which enemy, which trap period, which chest contents) is `level.ts`'s job — this module
 * only knows the legend.
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

/**
 * What a symbol means beyond its tile class. `level.ts` groups the parsed symbols by role;
 * the linter checks each role sits in a legal position (03 §1.2's "Placed in" column).
 */
export type SymbolRole =
  | 'terrain' // # . _
  | 'spawn' // @
  | 'ladder' // V
  | 'door' // D L P G
  | 'wall_prop' // t w  (decoration mounted in a wall cell)
  | 'trap' // s a f > <
  | 'pickup' // c h H b B k K
  | 'prop' // m M x X p u
  | 'enemy'; // 1-9

export interface SymbolDef {
  cls: TileClass;
  role: SymbolRole;
  /** Legal positions: 'wall' = a perimeter wall cell, 'floor' = anywhere inside. */
  where: 'wall' | 'floor';
}

/**
 * The full 03 §1.2 legend.
 *
 * `u` (puzzle torch) is defined by 02 §4.3 — "on a floor tile; solid; interactive" — and is
 * used by f2 R4 and f4 R3, but 03 §1.2's table has no row for it. Treated here as the solid
 * floor prop 02 §4.3 describes.
 */
export const LEGEND: Readonly<Record<string, SymbolDef>> = {
  '#': { cls: TileClass.WALL, role: 'terrain', where: 'wall' },
  '.': { cls: TileClass.FLOOR, role: 'terrain', where: 'floor' },
  _: { cls: TileClass.PIT, role: 'terrain', where: 'floor' },
  '@': { cls: TileClass.FLOOR, role: 'spawn', where: 'floor' },

  V: { cls: TileClass.WALL, role: 'ladder', where: 'wall' },

  // Door cells load closed; the level loader opens gaps and anything already unlocked.
  D: { cls: TileClass.DOOR_CLOSED, role: 'door', where: 'wall' },
  L: { cls: TileClass.DOOR_CLOSED, role: 'door', where: 'wall' },
  P: { cls: TileClass.DOOR_CLOSED, role: 'door', where: 'wall' },
  G: { cls: TileClass.DOOR_CLOSED, role: 'door', where: 'wall' },

  t: { cls: TileClass.WALL, role: 'wall_prop', where: 'wall' },
  w: { cls: TileClass.WALL, role: 'wall_prop', where: 'wall' },

  // Emitters sit in wall cells; only the tile they fire at is dangerous (02 §3).
  a: { cls: TileClass.WALL, role: 'trap', where: 'wall' },
  f: { cls: TileClass.WALL, role: 'trap', where: 'wall' },
  '>': { cls: TileClass.WALL, role: 'trap', where: 'wall' },
  '<': { cls: TileClass.WALL, role: 'trap', where: 'wall' },
  // Spikes damage but never block (02 §3.1).
  s: { cls: TileClass.FLOOR, role: 'trap', where: 'floor' },

  c: { cls: TileClass.FLOOR, role: 'pickup', where: 'floor' },
  h: { cls: TileClass.FLOOR, role: 'pickup', where: 'floor' },
  H: { cls: TileClass.FLOOR, role: 'pickup', where: 'floor' },
  b: { cls: TileClass.FLOOR, role: 'pickup', where: 'floor' },
  B: { cls: TileClass.FLOOR, role: 'pickup', where: 'floor' },
  k: { cls: TileClass.FLOOR, role: 'pickup', where: 'floor' },
  K: { cls: TileClass.FLOOR, role: 'pickup', where: 'floor' },

  m: { cls: TileClass.PROP, role: 'prop', where: 'floor' },
  M: { cls: TileClass.PROP, role: 'prop', where: 'floor' },
  x: { cls: TileClass.PROP, role: 'prop', where: 'floor' },
  X: { cls: TileClass.PROP, role: 'prop', where: 'floor' },
  p: { cls: TileClass.PROP, role: 'prop', where: 'floor' },
  u: { cls: TileClass.PROP, role: 'prop', where: 'floor' },

  '1': { cls: TileClass.FLOOR, role: 'enemy', where: 'floor' },
  '2': { cls: TileClass.FLOOR, role: 'enemy', where: 'floor' },
  '3': { cls: TileClass.FLOOR, role: 'enemy', where: 'floor' },
  '4': { cls: TileClass.FLOOR, role: 'enemy', where: 'floor' },
  '5': { cls: TileClass.FLOOR, role: 'enemy', where: 'floor' },
  '6': { cls: TileClass.FLOOR, role: 'enemy', where: 'floor' },
  '7': { cls: TileClass.FLOOR, role: 'enemy', where: 'floor' },
  '8': { cls: TileClass.FLOOR, role: 'enemy', where: 'floor' },
  '9': { cls: TileClass.FLOOR, role: 'enemy', where: 'floor' },
};

/** A non-terrain symbol found in a map, with the cell it occupies. */
export interface SymbolCell {
  ch: string;
  col: number;
  row: number;
  role: SymbolRole;
}

export interface Room {
  w: number;
  h: number;
  /** Row-major `TileClass` values, `w * h` long. */
  tiles: Uint8Array;
  /** The `@` cell (03 §1.2), or `null` in rooms that hold no floor entry point. */
  spawn: { col: number; row: number } | null;
  /** Every symbol other than `#` and `.`, in row-major order. */
  symbols: SymbolCell[];
}

/**
 * Solidity per 01 §3.1. Pits are solid to walkers, passable to the wisp and to bolts;
 * closed doors stop everything; props stop walkers and bolts (crates despawn bolts — 02 §3.2)
 * but never the flying wisp.
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

/** True for the perimeter cells — the ones 03 §1.2 calls wall cells. */
export function isWallCell(room: { w: number; h: number }, col: number, row: number): boolean {
  return col === 0 || row === 0 || col === room.w - 1 || row === room.h - 1;
}

/** Build a room from ASCII rows, exactly as the maps are written in 03-levels. */
export function parseRoom(rows: readonly string[]): Room {
  if (rows.length === 0) throw new Error('parseRoom: no rows');
  const h = rows.length;
  const w = rows[0]!.length;

  const tiles = new Uint8Array(w * h);
  const symbols: SymbolCell[] = [];
  let spawn: Room['spawn'] = null;

  for (let row = 0; row < h; row++) {
    const line = rows[row]!;
    if (line.length !== w) {
      throw new Error(`parseRoom: row ${row} is ${line.length} cells, expected ${w}`);
    }
    for (let col = 0; col < w; col++) {
      const ch = line[col]!;
      const def = LEGEND[ch];
      if (def === undefined) {
        throw new Error(`parseRoom: unknown symbol "${ch}" at (${col},${row})`);
      }
      tiles[row * w + col] = def.cls;
      if (ch !== '#' && ch !== '.') symbols.push({ ch, col, row, role: def.role });
      if (ch === '@') {
        if (spawn) throw new Error(`parseRoom: a second "@" at (${col},${row})`);
        spawn = { col, row };
      }
    }
  }

  return { w, h, tiles, spawn, symbols };
}
