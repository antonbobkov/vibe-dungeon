import { describe, expect, it } from 'vitest';

import { TileClass, isSolid, parseRoom, setTile, tileAt } from '../../src/sim/room.js';

describe('parseRoom (the 03-levels §1.2 legend subset M1 needs)', () => {
  const room = parseRoom(['#####', '#.@.#', '#._.#', '#####']);

  it('reads dimensions and tile classes', () => {
    expect([room.w, room.h]).toEqual([5, 4]);
    expect(tileAt(room, 0, 0)).toBe(TileClass.WALL);
    expect(tileAt(room, 1, 1)).toBe(TileClass.FLOOR);
    expect(tileAt(room, 2, 2)).toBe(TileClass.PIT);
  });

  it('records the spawn cell and leaves it plain floor', () => {
    expect(room.spawn).toEqual({ col: 2, row: 1 });
    expect(tileAt(room, 2, 1)).toBe(TileClass.FLOOR);
  });

  it('treats everything outside the room as solid void', () => {
    expect(tileAt(room, -1, 0)).toBe(TileClass.WALL);
    expect(tileAt(room, 0, -1)).toBe(TileClass.WALL);
    expect(tileAt(room, room.w, 0)).toBe(TileClass.WALL);
    expect(tileAt(room, 0, room.h)).toBe(TileClass.WALL);
  });

  it('rejects malformed maps', () => {
    expect(() => parseRoom([])).toThrow(/no rows/);
    expect(() => parseRoom(['###', '##'])).toThrow(/row 1 is 2 cells/);
    expect(() => parseRoom(['#q#'])).toThrow(/unknown symbol "q"/);
    expect(() => parseRoom(['@@'])).toThrow(/second "@"/);
  });

  it('rejects writes outside the room', () => {
    expect(() => setTile(room, 9, 9, TileClass.FLOOR)).toThrow(/outside/);
  });

  it('bridges a pit in place (02 §4.2 — the crate is consumed, the tile stays walkable)', () => {
    const r = parseRoom(['###', '#_#', '###']);
    expect(isSolid(tileAt(r, 1, 1), 'ground')).toBe(true);
    setTile(r, 1, 1, TileClass.BRIDGED_PIT);
    expect(isSolid(tileAt(r, 1, 1), 'ground')).toBe(false);
  });
});

// 01-mechanics §3.1, all three columns.
describe('solidity table', () => {
  const CASES: [TileClass, boolean, boolean, boolean][] = [
    // class, solid to ground, to the flying wisp, to bolts
    [TileClass.FLOOR, false, false, false],
    [TileClass.WALL, true, true, true],
    [TileClass.PIT, true, false, false],
    [TileClass.BRIDGED_PIT, false, false, false],
    [TileClass.DOOR_CLOSED, true, true, true],
    [TileClass.DOOR_OPEN, false, false, false],
    [TileClass.PROP, true, false, true],
    [TileClass.DECAL, false, false, false],
  ];

  it.each(CASES)('class %i blocks ground=%s fly=%s bolt=%s', (cls, ground, fly, bolt) => {
    expect(isSolid(cls, 'ground')).toBe(ground);
    expect(isSolid(cls, 'fly')).toBe(fly);
    expect(isSolid(cls, 'bolt')).toBe(bolt);
  });
});
