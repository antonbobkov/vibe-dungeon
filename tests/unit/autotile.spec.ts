import { describe, expect, it } from 'vitest';

import { autotileRoom, tileRefAt, type TileRef } from '../../src/render/autotile.js';
import { setTile, TileClass } from '../../src/sim/room.js';
import { floors } from './helpers.js';

/** Every expectation below is computed by hand from the formulas in 03-levels §1.3. */

const room = (floorIndex: number, id: string) => {
  const floor = floors()[floorIndex]!;
  return floor.rooms[floor.roomIndex.get(id)!]!;
};

const at = (refs: TileRef[], r: { w: number }, col: number, row: number): [number, number] => {
  const ref = tileRefAt(refs, r, col, row);
  return [ref.col, ref.row];
};

describe('perimeter walls', () => {
  const r1 = room(0, 'R1'); // f1 "Entry Hall", 11×8
  const refs = autotileRoom(r1);

  it('puts the four corners at the four corners', () => {
    expect(at(refs, r1, 0, 0)).toEqual([0, 0]);
    expect(at(refs, r1, 10, 0)).toEqual([5, 0]);
    expect(at(refs, r1, 0, 7)).toEqual([0, 4]);
    expect(at(refs, r1, 10, 7)).toEqual([5, 4]);
  });

  it('runs the top and bottom walls as (1 + col mod 4)', () => {
    expect(at(refs, r1, 1, 0)).toEqual([2, 0]); // 1 + 1 mod 4
    expect(at(refs, r1, 3, 0)).toEqual([4, 0]);
    expect(at(refs, r1, 9, 0)).toEqual([2, 0]); // 1 + 9 mod 4
    expect(at(refs, r1, 1, 7)).toEqual([2, 4]);
    expect(at(refs, r1, 8, 7)).toEqual([1, 4]);
  });

  it('runs the side walls as (0 | 5, 1 + row mod 3)', () => {
    expect(at(refs, r1, 0, 1)).toEqual([0, 2]);
    expect(at(refs, r1, 0, 3)).toEqual([0, 1]); // 1 + 3 mod 3
    expect(at(refs, r1, 10, 2)).toEqual([5, 3]);
    expect(at(refs, r1, 10, 6)).toEqual([5, 1]);
  });
});

describe('floors', () => {
  const r1 = room(0, 'R1');
  const refs = autotileRoom(r1);

  it('uses the shaded block against a wall, positionally', () => {
    expect(at(refs, r1, 1, 1)).toEqual([1, 1]); // wall above and left
    expect(at(refs, r1, 9, 1)).toEqual([4, 1]); // wall above and right
    expect(at(refs, r1, 1, 6)).toEqual([1, 3]); // wall below and left
    expect(at(refs, r1, 9, 6)).toEqual([4, 3]); // wall below and right
    expect(at(refs, r1, 1, 3)).toEqual([1, 2]); // wall only to the left
    expect(at(refs, r1, 5, 1)).toEqual([3, 1]); // wall only above: 2 + 5 mod 2
    expect(at(refs, r1, 4, 6)).toEqual([2, 3]); // wall only below: 2 + 4 mod 2
  });

  it('uses the plain variant away from every wall', () => {
    // v = (col*3 + row*5) mod 12 → (6 + v mod 4, v div 4)
    expect(at(refs, r1, 5, 3)).toEqual([8, 1]); // v = 30 mod 12 = 6
    expect(at(refs, r1, 4, 4)).toEqual([6, 2]); // v = 32 mod 12 = 8
    expect(at(refs, r1, 3, 2)).toEqual([9, 1]); // v = 19 mod 12 = 7 → (6+3, 1)
  });
});

describe('doors, gaps and the ladder', () => {
  it('draws a two-cell door as its left and right leaves', () => {
    const r1 = room(0, 'R1');
    const refs = autotileRoom(r1);
    expect(at(refs, r1, 4, 0)).toEqual([6, 3]); // straight-lintel double, left leaf
    expect(at(refs, r1, 5, 0)).toEqual([7, 3]); // right leaf
  });

  it('draws a silver door as the steel single door', () => {
    const r2 = room(0, 'R2');
    const refs = autotileRoom(r2);
    expect(at(refs, r2, 6, 0)).toEqual([8, 3]);
  });

  it('draws puzzle and gold doors as the arched pair', () => {
    const f4r5 = room(3, 'R5');
    const gold = autotileRoom(f4r5);
    expect(at(gold, f4r5, 4, 0)).toEqual([6, 6]);
    expect(at(gold, f4r5, 5, 0)).toEqual([7, 6]);

    // A puzzle door is chained, so its right half is the left half mirrored instead of
    // (7,6) — 01 §8.3, pinned in full by door-art.spec.ts.
    const f2r4 = room(1, 'R4');
    const puzzle = autotileRoom(f2r4);
    expect(at(puzzle, f2r4, 4, 0)).toEqual([6, 6]);
    expect(at(puzzle, f2r4, 5, 0)).toEqual([6, 6]);
  });

  it('caps the wall run above and below a side gap (03 §1.3)', () => {
    // f1 R2's gap is (12,4)(12,5) in the right wall.
    const r2 = room(0, 'R2');
    const refs = autotileRoom(r2);
    expect(at(refs, r2, 12, 3)).toEqual([5, 4]); // above the gap: bottom cap
    expect(at(refs, r2, 12, 6)).toEqual([5, 0]); // below it: a fresh top corner
    expect(at(refs, r2, 12, 2)).toEqual([5, 3]); // an ordinary run cell, unaffected
  });

  it('draws the descent ladder in its wall cell', () => {
    const r6 = room(0, 'R6');
    const refs = autotileRoom(r6);
    expect(at(refs, r6, 3, 0)).toEqual([9, 3]);
  });
});

describe('interior blocks and pits', () => {
  it('copes the top row of a free-standing block and faces the rest', () => {
    // f4 R4's pillars are 2×2 at (3,2)(4,2)(3,3)(4,3).
    const arena = room(3, 'R4');
    const refs = autotileRoom(arena);
    expect(at(refs, arena, 3, 2)).toEqual([4, 4]); // coping, 1 + 3 mod 4
    expect(at(refs, arena, 4, 2)).toEqual([1, 4]); // coping, 1 + 4 mod 4
    expect(at(refs, arena, 3, 3)).toEqual([2, 5]); // odd column → wall face variant 2
    expect(at(refs, arena, 4, 3)).toEqual([1, 5]); // even column → variant 1
  });

  it('draws an unbridged pit as void and a bridged one as the crate', () => {
    const gap = room(2, 'R2'); // f3 "The Gap", pit trench across row 2
    expect(at(autotileRoom(gap), gap, 6, 2)).toEqual([8, 7]);

    const live = { ...gap.base, tiles: Uint8Array.from(gap.base.tiles) };
    setTile(live, 6, 2, TileClass.BRIDGED_PIT);
    expect(at(autotileRoom(gap, live), gap, 6, 2)).toEqual([9, 4]);
  });

  it('opens a doorway to the room behind once the door is open', () => {
    const r1 = room(0, 'R1');
    const live = { ...r1.base, tiles: Uint8Array.from(r1.base.tiles) };
    setTile(live, 4, 0, TileClass.DOOR_OPEN);
    expect(at(autotileRoom(r1, live), r1, 4, 0)).toEqual([8, 7]); // void behind the leaf
  });
});

describe('every room', () => {
  it('auto-tiles to exactly one Pack A cell per map cell, all in range', () => {
    for (const floor of floors()) {
      for (const r of floor.rooms) {
        const refs = autotileRoom(r);
        expect(refs, `${floor.id}/${r.id}`).toHaveLength(r.w * r.h);
        for (const t of refs) {
          expect(t.col, `${floor.id}/${r.id}`).toBeGreaterThanOrEqual(0);
          expect(t.col).toBeLessThan(10);
          expect(t.row).toBeGreaterThanOrEqual(0);
          expect(t.row).toBeLessThan(10);
        }
      }
    }
  });
});
