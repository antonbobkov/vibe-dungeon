import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { loadFloor, parseFloor, type FloorFile } from '../../src/sim/level.js';
import { TileClass, tileAt } from '../../src/sim/room.js';

const floorFile = (id: string): FloorFile =>
  JSON.parse(readFileSync(`levels/${id}.json`, 'utf8')) as FloorFile;

const FLOORS = ['f1', 'f2', 'f3', 'f4'] as const;

describe('the four floors', () => {
  it.each(FLOORS)('%s loads with no problems', (id) => {
    expect(parseFloor(floorFile(id)).problems).toEqual([]);
  });

  it('has the room counts 00-overview promises', () => {
    const counts = FLOORS.map((id) => loadFloor(floorFile(id)).rooms.length);
    expect(counts).toEqual([6, 7, 7, 6]);
    expect(counts.reduce((a, b) => a + b)).toBe(26);
  });

  it('connects every door to two different rooms that both know the cells', () => {
    for (const id of FLOORS) {
      const floor = loadFloor(floorFile(id));
      for (const door of floor.doors) {
        expect(door.a.room, `${id}/${door.id}`).not.toBe(door.b.room);
        for (const end of [door.a, door.b]) {
          const room = floor.rooms[end.roomIndex]!;
          for (const [col, row] of end.cells) {
            expect(room.doorCells.get(`${col},${row}`)?.doorId, `${id}/${door.id}`).toBe(door.id);
          }
        }
      }
    }
  });
});

// The M2 golden: f1 R1 parsed to its exact tile-class grid.
describe('f1 R1 "Entry Hall" tile-class golden', () => {
  const room = loadFloor(floorFile('f1')).rooms[0]!;

  it('is 11×8 with the documented spawn', () => {
    expect([room.w, room.h]).toEqual([11, 8]);
    expect(room.spawn).toEqual([5, 6]);
  });

  it('parses to the exact grid', () => {
    // W wall · F floor · D closed door. The two `t` decor torches are wall cells; the `c`
    // coins and the `@` spawn are plain floor with objects listed separately.
    const expected = [
      'WWWWDDWWWWW',
      'WFFFFFFFFFW',
      'WFFFFFFFFFW',
      'WFFFFFFFFFW',
      'WFFFFFFFFFW',
      'WFFFFFFFFFW',
      'WFFFFFFFFFW',
      'WWWWWWWWWWW',
    ];
    const letter: Partial<Record<TileClass, string>> = {
      [TileClass.WALL]: 'W',
      [TileClass.FLOOR]: 'F',
      [TileClass.DOOR_CLOSED]: 'D',
      [TileClass.PIT]: '_',
      [TileClass.PROP]: 'P',
    };
    const actual = Array.from({ length: room.h }, (_, row) =>
      Array.from({ length: room.w }, (_, col) => letter[tileAt(room.base, col, row)] ?? '?').join(
        '',
      ),
    );
    expect(actual).toEqual(expected);
  });

  it('lists the four coins as objects, not as tiles', () => {
    expect(room.pickups.map((p) => p.at)).toEqual([
      [4, 2],
      [5, 2],
      [4, 3],
      [5, 3],
    ]);
    expect(room.pickups.every((p) => p.kind === 'coin')).toBe(true);
  });
});

describe('object tables', () => {
  const f1 = loadFloor(floorFile('f1'));
  const f4 = loadFloor(floorFile('f4'));

  it('takes enemy positions from the map and types from the table', () => {
    const r2 = f1.rooms[1]!;
    expect(r2.enemies).toEqual([{ marker: '1', type: 'skel_sword', at: [6, 4], drop: null }]);
  });

  it('fills trap defaults from 02 §3 and keeps declared parameters', () => {
    const spikes = loadFloor(floorFile('f2')).rooms[0]!.traps;
    expect(spikes).toEqual([
      { at: [3, 3], kind: 'spike', period: 120, offset: 0, alwaysOn: false, deadly: [3, 3] },
      { at: [4, 3], kind: 'spike', period: 120, offset: 60, alwaysOn: false, deadly: [4, 3] },
    ]);
  });

  it('points each trap at the tile it makes deadly (02 §3)', () => {
    const r2 = f4.rooms[1]!;
    const flame = r2.traps.find((t) => t.kind === 'flame_left')!;
    expect(flame.at).toEqual([16, 4]);
    expect(flame.deadly).toEqual([15, 4]); // one tile to its left
    expect(r2.traps.find((t) => t.kind === 'arrow')!.deadly).toBeNull(); // fires a bolt instead
  });

  it('reads chest contents and crate drops from the prop table', () => {
    const treasury = f1.rooms[4]!;
    const chest = treasury.props.find((p) => p.kind === 'chest')!;
    expect(chest.contents).toEqual(['coin', 'coin', 'coin', 'coin', 'coin', 'red_small']);
    expect(treasury.props.find((p) => p.at[0] === 2)!.drop).toBe('coin');
    expect(treasury.props.find((p) => p.at[0] === 8)!.drop).toBeNull();
  });

  it('keeps the wave table in order (02 §2.3)', () => {
    const arena = f4.rooms[3]!;
    expect(arena.combatSeal).toBe(true);
    expect(arena.waves.map((w) => w.map((e) => e.type))).toEqual([
      ['skel_sword', 'skel_sword', 'skel_sword'],
      ['skel_axe', 'skel_axe', 'wisp'],
      ['zombie', 'skel_sword', 'skel_sword', 'wisp'],
    ]);
  });

  it('reads torch groups and their window', () => {
    expect(f4.rooms[2]!.torchGroups).toEqual([
      {
        id: 'G2',
        members: [
          [1, 1],
          [9, 1],
          [1, 7],
          [9, 7],
        ],
        window: 600,
      },
    ]);
    expect(loadFloor(floorFile('f2')).rooms[3]!.torchGroups[0]!.window).toBeNull();
  });
});

// 05 §1: positions come from the map, parameters from the tables, and the loader errors on
// any disagreement between the two.
describe('map/table mismatches', () => {
  const minimal = (): FloorFile =>
    JSON.parse(readFileSync('tests/fixtures/levels/valid.json', 'utf8')) as FloorFile;

  const problemsWith = (mutate: (f: FloorFile) => void): string[] => {
    const file = minimal();
    mutate(file);
    return parseFloor(file).problems;
  };

  it('rejects a trap table entry with no trap on the map', () => {
    expect(
      problemsWith((f) => {
        f.rooms[0]!.traps = [{ at: [3, 3], kind: 'spike' }];
      }),
    ).toContain('f1/R1: trap table entry at (3,3) but the map has no trap there');
  });

  it('rejects a table entry whose kind disagrees with the symbol', () => {
    expect(
      problemsWith((f) => {
        f.rooms[0]!.map[3] = '#..s..#';
        f.rooms[0]!.traps = [{ at: [3, 3], kind: 'arrow' }];
      })[0],
    ).toMatch(/is "s" \(spike\) but the table says arrow/);
  });

  it('rejects a chest with no contents', () => {
    expect(
      problemsWith((f) => {
        f.rooms[0]!.map[3] = '#..M..#';
      }),
    ).toContain('f1/R1: chest at (3,3) has no contents in the prop table');
  });

  it('rejects an enemy entry for a marker the map never uses', () => {
    expect(
      problemsWith((f) => {
        f.rooms[0]!.enemies = [{ marker: '4', type: 'wisp' }];
      }),
    ).toContain('f1/R1: enemy table lists marker "4", which the map does not use');
  });

  it('rejects a torch that belongs to no group, and a group naming an empty cell', () => {
    expect(
      problemsWith((f) => {
        f.rooms[0]!.map[3] = '#..u..#';
      }),
    ).toContain('f1/R1: puzzle torch at (3,3) belongs to no torch group');

    expect(
      problemsWith((f) => {
        f.rooms[0]!.torchGroups = [{ id: 'G9', members: [[3, 3]] }];
      }),
    ).toContain('f1/R1: torch group G9 lists (3,3), which holds no "u" torch');
  });

  it('rejects a door cell that belongs to no declared door', () => {
    expect(
      problemsWith((f) => {
        f.rooms[1]!.map[0] = '#DDD#V#';
      }),
    ).toContain('f1/R2: door cell "D" at (1,0) is not part of any declared door');
  });

  it('rejects an unknown symbol and a ragged map', () => {
    expect(
      problemsWith((f) => {
        f.rooms[0]!.map[2] = '#..q..#';
      })[0],
    ).toMatch(/bad map: unknown symbol "q"/);
    expect(
      problemsWith((f) => {
        f.rooms[0]!.map[2] = '#..@..';
      })[0],
    ).toMatch(/bad map: row 2 is 6 cells, expected 7/);
  });

  it('throws from loadFloor rather than returning a broken floor', () => {
    const file = minimal();
    file.rooms[0]!.enemies = [{ marker: '4', type: 'wisp' }];
    expect(() => loadFloor(file)).toThrow(/marker "4"/);
  });
});
