import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { lintFloorFile } from '../../tools/level-lint.js';
import type { FloorFile, RoomSpec } from '../../src/sim/level.js';

/**
 * One case per rule in 03-levels §1.7 and 05 §1, each a small mutation of the valid fixture.
 * A linter's uncovered branch is a rule that has never been shown to fire, so every message
 * the validator can produce is exercised here.
 */

const valid = (): FloorFile =>
  JSON.parse(readFileSync('tests/fixtures/levels/valid.json', 'utf8')) as FloorFile;

const problemsAfter = (mutate: (f: FloorFile) => void): string[] => {
  const file = valid();
  mutate(file);
  return lintFloorFile(file).problems;
};

/** A spare 7×6 room with a door cell in its bottom wall, for cases that need a third room. */
const spareRoom = (id: string, bottom = '###L###'): RoomSpec => ({
  id,
  name: id,
  map: ['#######', '#.....#', '#.....#', '#.....#', '#.....#', bottom],
});

describe('symbol positions (03 §1.2, 02 §3)', () => {
  it('rejects a wall symbol standing on the floor', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.map[2] = '#..t..#';
      }),
    ).toContain('f1/R1: "t" at (3,2) belongs in a wall cell');
  });

  it('rejects a floor symbol embedded in a wall', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.map[2] = 'c..@..#';
      }),
    ).toContain('f1/R1: "c" at (0,2) belongs inside the room, not in a wall');
  });

  it('rejects a downward flame jet outside the top wall row', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.map[5] = '##DDf##';
      }),
    ).toContain('f1/R1: "f" at (4,5) must sit in the top wall row');
  });

  it('rejects a leftward flame jet outside the rightmost column', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.map[2] = '<..@..#';
      }),
    ).toContain('f1/R1: "<" at (0,2) must sit in the rightmost column');
  });

  it('rejects a trap that fires into a wall', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.map[0] = '###f###';
        f.rooms[0]!.map[1] = '#..#..#'; // the tile the jet would cover is masonry
      }),
    ).toContain('f1/R1: flame_down at (3,0) fires into the wall at (3,1)');
  });
});

describe('doors (01 §8.1, 03 §1.4)', () => {
  it('rejects a gap in a top or bottom wall', () => {
    expect(
      problemsAfter((f) => {
        f.doors[0]!.type = 'gap';
      }),
    ).toContain('f1/R1: gap d1 is in the bottom wall; gaps are side-wall only');
  });

  it('rejects a normal door in a side wall', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.map[2] = '#..@..D';
        f.rooms[0]!.map[3] = '#.....D';
        f.rooms[1]!.map[5] = '##DD###';
        f.doors.push({
          id: 'd2',
          type: 'normal',
          a: {
            room: 'R1',
            cells: [
              [6, 2],
              [6, 3],
            ],
          },
          b: {
            room: 'R2',
            cells: [
              [2, 5],
              [3, 5],
            ],
          },
        });
      }),
    ).toContain('f1/R1: normal door d2 is in the right wall; doors are top/bottom only');
  });

  it('rejects a door with the wrong number of cells', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.map[5] = '##D####';
        f.doors[0]!.a.cells = [[2, 5]];
      }),
    ).toContain('f1/R1: normal door d1 has 1 cells here, expected 2');
  });

  it('rejects two door cells that are not adjacent', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.map[5] = '##D#D##';
        f.doors[0]!.a.cells = [
          [2, 5],
          [4, 5],
        ];
      }),
    ).toContain("f1/R1: d1's two cells here are not adjacent");
  });

  it('rejects a door that leads back into its own room', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.map[0] = '##DD###';
        f.doors[0]!.b = {
          room: 'R1',
          cells: [
            [2, 0],
            [3, 0],
          ],
        };
      }),
    ).toContain('f1: door d1 connects R1 to itself');
  });

  it('rejects the same cell being claimed by two doors', () => {
    expect(
      problemsAfter((f) => {
        f.doors.push({ ...f.doors[0]!, id: 'd2' });
      })[0],
    ).toMatch(/cell R1 \(2,5\) is claimed twice/);
  });

  it('rejects an endpoint that is not in a wall at all', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.map[2] = '#..D..#';
        f.doors[0]!.a.cells = [[3, 2]];
      })[0],
    ).toMatch(/endpoint in R1 at \(3,2\) is not in a wall/);
  });
});

describe('combat seals (01 §8.3)', () => {
  it('rejects a sealed room with a side gap', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[1]!.combatSeal = true;
        f.rooms[1]!.map = ['##DD#V#', '#.....D', '#.....D', '#.....#', '#.....#', '#######'];
        f.rooms.push(spareRoom('R3', '#######'));
        f.rooms[2]!.map[2] = 'D.....#';
        f.rooms[2]!.map[3] = 'D.....#';
        f.doors.push({
          id: 'd2',
          type: 'gap',
          a: {
            room: 'R2',
            cells: [
              [6, 1],
              [6, 2],
            ],
          },
          b: {
            room: 'R3',
            cells: [
              [0, 2],
              [0, 3],
            ],
          },
        });
      }),
    ).toContain('f1/R2: is a combat_seal room but has a side gap, which cannot seal');
  });

  it('rejects a sealed room with no door to seal', () => {
    expect(
      problemsAfter((f) => {
        const room = spareRoom('R3', '#######');
        room.combatSeal = true;
        f.rooms.push(room);
      }),
    ).toContain('f1/R3: is a combat_seal room with no door to seal');
  });

  it('rejects a wave table in a room that never seals (02 §2.3)', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.waves = [[{ type: 'wisp', at: [3, 3] }]];
      }),
    ).toContain('f1/R1: has a wave table but is not a combat_seal room (02 §2.3)');
  });

  it('rejects a wave that spawns somewhere other than floor', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.combatSeal = true;
        f.rooms[0]!.waves = [[{ type: 'wisp', at: [0, 0] }]];
      }),
    ).toContain('f1/R1: wave 1 spawns wisp at (0,0), which is not floor');
  });
});

describe('floor-wide markers (03 §1.7)', () => {
  it('rejects a floor with no spawn', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.map[2] = '#.....#';
      }),
    ).toContain('f1: has 0 "@" spawns, expected exactly 1');
  });

  it('rejects a spawn outside the first room', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.map[2] = '#.....#';
        f.rooms[1]!.map[2] = '#..@..#';
      }),
    ).toContain('f1: spawns in R2; "@" belongs in the floor\'s first room (R1)');
  });

  it('rejects a floor with no descent ladder', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[1]!.map[0] = '##DD###';
      }),
    ).toContain('f1: has 0 descent ladders, expected exactly 1');
  });

  it('rejects a ladder on floor 4, which ends at the vault', () => {
    expect(
      problemsAfter((f) => {
        f.id = 'f4';
      }),
    ).toContain('f4: has 1 descent ladders; floor 4 ends at the vault and must have none');
  });
});

describe('wiring (03 §1.6)', () => {
  it('rejects a trigger on an unknown torch group', () => {
    expect(
      problemsAfter((f) => {
        f.wiring = [
          { trigger: { kind: 'torch_group', group: 'G9' }, effects: [{ kind: 'victory' }] },
        ];
      }),
    ).toContain('f1: wiring triggers on unknown torch group "G9"');
  });

  it('rejects a trigger on an unknown room', () => {
    expect(
      problemsAfter((f) => {
        f.wiring = [{ trigger: { kind: 'room_clear', room: 'R9' }, effects: [] }];
      }),
    ).toContain('f1: wiring triggers on unknown room "R9"');
  });

  it('rejects room_clear on a room that never seals', () => {
    expect(
      problemsAfter((f) => {
        f.wiring = [{ trigger: { kind: 'room_clear', room: 'R1' }, effects: [] }];
      }),
    ).toContain('f1: wiring waits for room_clear(R1), which is not a combat_seal room');
  });

  it('rejects chest_open on a cell with no chest', () => {
    expect(
      problemsAfter((f) => {
        f.wiring = [
          {
            trigger: { kind: 'chest_open', room: 'R1', at: [3, 3] },
            effects: [{ kind: 'victory' }],
          },
        ];
      }),
    ).toContain('f1: wiring expects a chest at R1 (3,3), which has none');
  });

  it('rejects opening an unknown door, or one that is not a puzzle door', () => {
    expect(
      problemsAfter((f) => {
        f.wiring = [
          {
            trigger: { kind: 'chest_open', room: 'R1', at: [3, 3] },
            effects: [{ kind: 'open_door', door: 'd9' }],
          },
        ];
      }),
    ).toContain('f1: wiring opens unknown door "d9"');

    expect(
      problemsAfter((f) => {
        f.wiring = [
          {
            trigger: { kind: 'chest_open', room: 'R1', at: [3, 3] },
            effects: [{ kind: 'open_door', door: 'd1' }],
          },
        ];
      }),
    ).toContain('f1: wiring opens d1, which is a normal door, not a puzzle door');
  });

  it('rejects a spawn into an unknown room or onto a wall', () => {
    expect(
      problemsAfter((f) => {
        f.wiring = [
          {
            trigger: { kind: 'room_clear', room: 'R1' },
            effects: [{ kind: 'spawn', room: 'R9', at: [1, 1], pickup: 'coin' }],
          },
        ];
      }),
    ).toContain('f1: wiring spawns into unknown room "R9"');

    expect(
      problemsAfter((f) => {
        f.wiring = [
          {
            trigger: { kind: 'room_clear', room: 'R1' },
            effects: [{ kind: 'spawn', room: 'R1', at: [0, 0], pickup: 'coin' }],
          },
        ];
      }),
    ).toContain('f1: wiring spawns coin at R1 (0,0), which is not floor');
  });
});

describe('keys and locks (03 §1.7)', () => {
  /** R1 --silver door d2--> R3, with the silver key sitting behind the lock. */
  const keyBehindLock = (f: FloorFile): void => {
    f.rooms[0]!.map[0] = '###L###';
    const room = spareRoom('R3');
    room.map[2] = '#..k..#';
    f.rooms.push(room);
    f.doors.push({
      id: 'd2',
      type: 'silver',
      a: { room: 'R1', cells: [[3, 0]] },
      b: { room: 'R3', cells: [[3, 5]] },
    });
  };

  it('rejects a key that can only be had by opening its own lock', () => {
    expect(problemsAfter(keyBehindLock)).toContain(
      'f1: the silver key in R3 at (3,2) is not reachable before its lock',
    );
  });

  it('accepts the same key once it sits in front of the lock', () => {
    expect(
      problemsAfter((f) => {
        keyBehindLock(f);
        f.rooms[2]!.map[2] = '#.....#';
        f.rooms[0]!.map[3] = '#..k..#';
      }),
    ).toEqual([]);
  });

  it('counts a key inside a chest, the way f1 hides its silver key', () => {
    expect(
      problemsAfter((f) => {
        keyBehindLock(f);
        f.rooms[2]!.map[2] = '#.....#';
        f.rooms[0]!.map[3] = '#..m..#';
        f.rooms[0]!.props = [{ at: [3, 3], kind: 'mini_chest', contents: ['silver_key'] }];
      }),
    ).toEqual([]);
  });

  it('rejects a gold key with no gold door', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.map[3] = '#..K..#';
      }),
    ).toContain('f1: has 1 gold key(s) but 0 gold door(s)');
  });
});

describe('structural problems (05 §1)', () => {
  it('rejects duplicate room ids', () => {
    expect(
      problemsAfter((f) => {
        f.rooms.push({ ...f.rooms[0]! });
      }),
    ).toContain('f1/R1: duplicate room id');
  });

  it('rejects a floor with no rooms at all', () => {
    expect(
      problemsAfter((f) => {
        f.rooms = [];
      }),
    ).toContain('f1: has no rooms');
  });

  it('rejects the same marker used twice in one map', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.map[3] = '#.1.1.#';
        f.rooms[0]!.enemies = [{ marker: '1', type: 'wisp' }];
      }),
    ).toContain('f1/R1: marker "1" appears 2 times; each marker must be unique');
  });

  it('rejects a prop table entry pointing at empty floor, or at the wrong prop', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.props = [{ at: [3, 3], kind: 'crate_wood', drop: 'coin' }];
      }),
    ).toContain('f1/R1: prop table entry at (3,3) but the map has no prop there');

    expect(
      problemsAfter((f) => {
        f.rooms[0]!.map[3] = '#..x..#';
        f.rooms[0]!.props = [{ at: [3, 3], kind: 'crate_steel' }];
      }),
    ).toContain('f1/R1: prop at (3,3) is "x" (crate_wood) but the table says crate_steel');
  });

  it('rejects a torch claimed by two groups', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.map[3] = '#..u..#';
        f.rooms[0]!.torchGroups = [
          { id: 'G1', members: [[3, 3]] },
          { id: 'G2', members: [[3, 3]] },
        ];
      }),
    ).toContain('f1/R1: torch at (3,3) belongs to more than one group');
  });

  it('rejects decor placed outside the room', () => {
    expect(
      problemsAfter((f) => {
        f.rooms[0]!.decor = [{ at: [30, 30], art: 'A(4,6)' }];
      }),
    ).toContain('f1/R1: decor "A(4,6)" at (30,30) is outside the room');
  });

  it('rejects decor art that is in neither the tile nor the animation manifest', () => {
    const found = problemsAfter((f) => {
      f.rooms[0]!.decor = [
        { at: [3, 3], art: 'A(9,5)' }, // a real Pack A tile, but not one the game uses
        { at: [3, 4], art: 'not_a_thing' },
      ];
    });
    expect(found).toContain(
      'f1/R1: decor at (3,3) references Pack A tile (9,5), which is not in the manifest',
    );
    expect(found).toContain(
      'f1/R1: decor at (3,4) references "not_a_thing", which is neither a tile nor an animation',
    );
  });
});
