import { describe, expect, it } from 'vitest';

import { autotileRoom, tileRefAt, type TileRef } from '../../src/render/autotile.js';
import {
  CHAIN_TILE,
  KEYHOLE_COLOURS,
  KEYHOLE_H,
  KEYHOLE_PIXELS,
  KEYHOLE_W,
  LEAF_PROTRUDE_PX,
  chainDraws,
  chainedCells,
  doorCellSide,
  doorLeafDraws,
  keyholeDraws,
  type KeyholeShade,
} from '../../src/render/doors.js';
import { tile } from '../../src/assets/packA.js';
import type { Cell, LoadedRoom } from '../../src/sim/level.js';
import { TileClass, setTile, type Room } from '../../src/sim/room.js';
import { floors } from './helpers.js';

/**
 * The door art of 01-mechanics §8.1 and §8.3, pinned by exact numbers: which tile, at which
 * pixel, mirrored or not. None of it needs a canvas — `src/render/doors.ts` decides and
 * `world.ts` only blits — so a leaf that moves 4 px fails here rather than in a screenshot.
 */

const room = (floorIndex: number, id: string): LoadedRoom => {
  const floor = floors()[floorIndex]!;
  return floor.rooms[floor.roomIndex.get(id)!]!;
};

/** The room's map with the listed cells forced to a tile class — the live grid, in effect. */
const grid = (def: LoadedRoom, ...opened: Cell[]): Room => {
  const tiles: Room = { ...def.base, tiles: Uint8Array.from(def.base.tiles) };
  for (const [col, row] of opened) setTile(tiles, col, row, TileClass.DOOR_OPEN);
  return tiles;
};

const cellAt = (refs: TileRef[], def: LoadedRoom, col: number, row: number): TileRef =>
  tileRefAt(refs, def, col, row);

// ---------------------------------------------------------------------------

describe('open door leaves (01 §8.1)', () => {
  it('is one 16×16 tile per door cell, four pixels proud of the wall', () => {
    expect(LEAF_PROTRUDE_PX).toBe(4);
  });

  it('hangs a top-wall double door on both jambs, protruding down into the room', () => {
    // f1 d1 fills (4,0)(5,0) of R1's top wall.
    const r1 = room(0, 'R1');
    expect(doorLeafDraws(r1, grid(r1, [4, 0], [5, 0]))).toEqual([
      { tile: 'door_leaf_left_top', x: 64, y: 4, flipX: false },
      { tile: 'door_leaf_right_top', x: 80, y: 4, flipX: false },
    ]);
  });

  it('hangs a bottom-wall double door the same way, protruding up out of it', () => {
    // The same door's other end: (4,8)(5,8) of f1 R2's bottom wall.
    const r2 = room(0, 'R2');
    expect(doorLeafDraws(r2, grid(r2, [4, 8], [5, 8]))).toEqual([
      { tile: 'door_leaf_left_top', x: 64, y: 8 * 16 - LEAF_PROTRUDE_PX, flipX: false },
      { tile: 'door_leaf_right_top', x: 80, y: 124, flipX: false },
    ]);
  });

  it('gives a single steel door one left-aligned leaf, in either wall', () => {
    // f1 d3 is one cell: (6,0) in R2's top wall, (5,8) in R4's bottom wall.
    const r2 = room(0, 'R2');
    expect(doorLeafDraws(r2, grid(r2, [6, 0]))).toEqual([
      { tile: 'door_leaf_left_top', x: 96, y: 4, flipX: false },
    ]);

    const r4 = room(0, 'R4');
    expect(doorLeafDraws(r4, grid(r4, [5, 8]))).toEqual([
      { tile: 'door_leaf_left_top', x: 80, y: 124, flipX: false },
    ]);
  });

  it('uses the same two tiles for an arched pair — leaves do not vary by door type', () => {
    // f4 d5, the gold vault door at (4,0)(5,0) of R5.
    const r5 = room(3, 'R5');
    expect(doorLeafDraws(r5, grid(r5, [4, 0], [5, 0])).map((d) => d.tile)).toEqual([
      'door_leaf_left_top',
      'door_leaf_right_top',
    ]);
    expect(tile('door_leaf_left_top')).toMatchObject({ col: 7, row: 4 });
    expect(tile('door_leaf_right_top')).toMatchObject({ col: 8, row: 4 });
  });

  it('draws no leaf for a closed door, and none at all for a side gap', () => {
    const r1 = room(0, 'R1');
    expect(doorLeafDraws(r1, r1.base)).toEqual([]);

    // f1 d2 is the R2↔R3 gap at (12,4)(12,5): open from the start, and never door art.
    const r2 = room(0, 'R2');
    expect(doorLeafDraws(r2, grid(r2, [12, 4], [12, 5]))).toEqual([]);
  });

  it('knows which half of a pair a cell is, and that a lone cell is neither', () => {
    const r1 = room(0, 'R1');
    expect(doorCellSide(r1, 4, 0)).toBe('left');
    expect(doorCellSide(r1, 5, 0)).toBe('right');

    const r2 = room(0, 'R2');
    expect(doorCellSide(r2, 6, 0)).toBe('single'); // the silver door d3
    expect(doorCellSide(r2, 12, 4)).toBe('single'); // a gap's cells are stacked, not paired
    expect(doorCellSide(r2, 1, 1)).toBe('single'); // not a door cell at all
  });
});

// ---------------------------------------------------------------------------

describe('keyholes (01 §8.1)', () => {
  const shades = KEYHOLE_PIXELS.map(([, , shade]) => shade);
  const count = (shade: KeyholeShade): number => shades.filter((s) => s === shade).length;

  it('is a 6×9 plate of 54 pixels with nothing outside it and nothing drawn twice', () => {
    expect([KEYHOLE_W, KEYHOLE_H]).toEqual([6, 9]);
    expect(KEYHOLE_PIXELS).toHaveLength(KEYHOLE_W * KEYHOLE_H);

    const seen = new Set<string>();
    for (const [x, y] of KEYHOLE_PIXELS) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(KEYHOLE_W);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(KEYHOLE_H);
      seen.add(`${x},${y}`);
    }
    expect(seen.size).toBe(54);
  });

  it('is lit from the top left, shaded bottom right, with the keyway cut out of the middle', () => {
    const shadeAt = (x: number, y: number): KeyholeShade =>
      KEYHOLE_PIXELS.find(([px, py]) => px === x && py === y)![2];

    // Edges: highlight along the top and left, dark down the right and along the bottom.
    expect(shadeAt(0, 0)).toBe('highlight');
    expect(shadeAt(4, 0)).toBe('highlight');
    expect(shadeAt(0, 7)).toBe('highlight');
    expect(shadeAt(5, 0)).toBe('dark');
    expect(shadeAt(5, 8)).toBe('dark');
    expect(shadeAt(0, 8)).toBe('dark');

    // The 2×2 ring, straddling the plate's centre line, over the 1×3 slot beside it.
    expect([shadeAt(2, 2), shadeAt(3, 2), shadeAt(2, 3), shadeAt(3, 3)]).toEqual([
      'dark',
      'dark',
      'dark',
      'dark',
    ]);
    expect([shadeAt(2, 4), shadeAt(2, 5), shadeAt(2, 6)]).toEqual(['dark', 'dark', 'dark']);
    expect([shadeAt(3, 4), shadeAt(3, 5), shadeAt(3, 6)]).toEqual(['plate', 'plate', 'plate']);

    // The keyway floats: a row of plate above the ring and below the slot, so neither end
    // runs into a bevel and stops reading as a hole.
    expect(shadeAt(2, 1)).toBe('plate');
    expect(shadeAt(2, 7)).toBe('plate');

    expect(count('highlight')).toBe(12);
    expect(count('plate')).toBe(21);
    expect(count('dark')).toBe(21); // 14 of edge, and the 7 of the keyway
  });

  it('paints each metal from the palette 01 §8.1 fixes', () => {
    expect(KEYHOLE_COLOURS.silver).toEqual({
      plate: '#90919e',
      highlight: '#adc1cf',
      dark: '#25131a',
    });
    expect(KEYHOLE_COLOURS.gold).toEqual({
      plate: '#c09344',
      highlight: '#ffd569',
      dark: '#25131a',
    });
  });

  it('centres a silver plate on the single `L` tile, in either wall', () => {
    // f1 d3: (6,0) of R2 and (5,8) of R4. x = col*16 + ⌊(16−6)/2⌋, y = row*16 + ⌊(16−9)/2⌋.
    const r2 = room(0, 'R2');
    expect(keyholeDraws(r2, r2.base)).toEqual([{ metal: 'silver', x: 101, y: 3 }]);

    const r4 = room(0, 'R4');
    expect(keyholeDraws(r4, r4.base)).toEqual([{ metal: 'silver', x: 85, y: 131 }]);
  });

  it('centres a gold plate on the seam of the `GG` pair', () => {
    // f4 d5: (4,0)(5,0) of R5 and (4,7)(5,7) of R6. x = 4*16 + ⌊(32−6)/2⌋ = 77, so the seam
    // at 80 falls through the ring in the middle of the plate.
    const r5 = room(3, 'R5');
    expect(keyholeDraws(r5, r5.base)).toEqual([{ metal: 'gold', x: 77, y: 3 }]);

    const r6 = room(3, 'R6');
    expect(keyholeDraws(r6, r6.base)).toEqual([{ metal: 'gold', x: 77, y: 115 }]);
  });

  it('draws none on an open keyed door, nor on any normal or puzzle door', () => {
    const r2 = room(0, 'R2');
    expect(keyholeDraws(r2, grid(r2, [6, 0]))).toEqual([]);

    const r1 = room(0, 'R1'); // f1 d1, normal
    expect(keyholeDraws(r1, r1.base)).toEqual([]);

    const f2r4 = room(1, 'R4'); // f2 d4, puzzle — and d3, normal
    expect(keyholeDraws(f2r4, f2r4.base)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('chains on event-locked doors (01 §8.3)', () => {
  it('hangs a shackle on each cell of a closed puzzle door', () => {
    // f2 d4 is the puzzle door at (4,0)(5,0) of R4; d3, in the same room, is normal.
    const f2r4 = room(1, 'R4');
    expect(chainedCells(f2r4, f2r4.base, false)).toEqual([
      [4, 0],
      [5, 0],
    ]);
    expect(chainDraws(f2r4, f2r4.base, false)).toEqual([
      { tile: CHAIN_TILE, x: 64, y: 0, flipX: false },
      { tile: CHAIN_TILE, x: 80, y: 0, flipX: false },
    ]);
    expect(tile(CHAIN_TILE)).toMatchObject({ col: 5, row: 7 });
  });

  it('hangs one on every door in a room a seal is holding, of whatever type', () => {
    // f4 R4 is a combat_seal room with d3 (puzzle, (5,10)(6,10)) and d4 (normal, (6,0)(7,0)).
    const f4r4 = room(3, 'R4');
    expect(chainedCells(f4r4, f4r4.base, true)).toEqual([
      [5, 10],
      [6, 10],
      [6, 0],
      [7, 0],
    ]);
    // Unsealed, only the puzzle door keeps its chains.
    expect(chainedCells(f4r4, f4r4.base, false)).toEqual([
      [5, 10],
      [6, 10],
    ]);
  });

  it('hangs none on a key-locked or a plain closed door', () => {
    const r1 = room(0, 'R1'); // normal
    expect(chainedCells(r1, r1.base, false)).toEqual([]);

    const r2 = room(0, 'R2'); // silver d3, normal d1, gap d2
    expect(chainedCells(r2, r2.base, false)).toEqual([]);

    const f4r5 = room(3, 'R5'); // gold d5
    expect(chainedCells(f4r5, f4r5.base, false)).toEqual([]);
  });

  it('hangs none on an open door, even under a seal', () => {
    const f2r4 = room(1, 'R4');
    const open = grid(f2r4, [4, 0], [5, 0]);
    expect(chainedCells(f2r4, open, false)).toEqual([]);

    // Sealed, the room's *other* door — closed, normal — takes them up instead; the door
    // that is already open stays bare, since there is nothing to chain shut.
    expect(chainedCells(f2r4, open, true)).toEqual([
      [4, 8],
      [5, 8],
    ]);
  });

  it('draws a chained pair symmetrically: the right cell is the left one mirrored', () => {
    const f2r4 = room(1, 'R4');
    const refs = autotileRoom(f2r4, f2r4.base);
    expect(cellAt(refs, f2r4, 4, 0)).toEqual({ col: 6, row: 6 }); // arch, left half
    expect(cellAt(refs, f2r4, 5, 0)).toEqual({ col: 6, row: 6, flipX: true });

    // The normal door in the same room is unchanged: its own right tile, unmirrored.
    expect(cellAt(refs, f2r4, 4, 8)).toEqual({ col: 6, row: 3 });
    expect(cellAt(refs, f2r4, 5, 8)).toEqual({ col: 7, row: 3 });
  });

  it('mirrors a sealed door of any type, and leaves a 1-cell door its own tile', () => {
    const f4r4 = room(3, 'R4');
    const sealed = autotileRoom(f4r4, f4r4.base, true);
    expect(cellAt(sealed, f4r4, 6, 0)).toEqual({ col: 6, row: 3 });
    expect(cellAt(sealed, f4r4, 7, 0)).toEqual({ col: 6, row: 3, flipX: true });

    const open = autotileRoom(f4r4, f4r4.base, false);
    expect(cellAt(open, f4r4, 7, 0)).toEqual({ col: 7, row: 3 }); // unsealed: its own tile

    // A silver door is one cell; there is no half to mirror even under a seal.
    const r2 = room(0, 'R2');
    expect(cellAt(autotileRoom(r2, r2.base, true), r2, 6, 0)).toEqual({ col: 8, row: 3 });
  });
});
