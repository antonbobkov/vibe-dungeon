import { describe, expect, it } from 'vitest';

import { TILE_SUBPX, WALK_SPEED } from '../../src/sim/constants.js';
import { ATTACK, DOWN, INTERACT, LEFT, RIGHT, UP } from '../../src/sim/input.js';
import type { LoadedTrap } from '../../src/sim/level.js';
import { parseRoom } from '../../src/sim/room.js';
import type { SimTrap } from '../../src/sim/trap.js';
import {
  axisInput,
  boltSoon,
  deadlySoon,
  encodeMacro,
  findPath,
  stepLetters,
  tilesOverlapped,
  verticalInput,
  walkable,
} from '../../tools/pathing.js';
import { parseRoute, RouteError } from '../../tools/route.js';

/**
 * The pure half of the route autopilot (`tools/route.ts`): pathing, danger arithmetic and
 * macro text. The other half — that a route actually solves a floor — is proved by the
 * replays it emits, which `npm run test:replay` runs against the sim.
 */

// A yard with a wall stub, a pit and a spike, small enough to reason about by eye.
const YARD = ['#########', '#.......#', '#.##....#', '#..._...#', '#.......#', '#########'];
const yard = () => parseRoom(YARD);

const trap = (at: [number, number], period: number, offset: number): SimTrap => ({
  def: {
    at,
    kind: 'spike',
    period,
    offset,
    alwaysOn: false,
    deadly: at,
  } satisfies LoadedTrap,
  phase: offset,
});

describe('walkable ground', () => {
  it('is the 01 §3.1 solidity table for a walker', () => {
    const room = yard();
    expect(walkable(room, 1, 1)).toBe(true);
    expect(walkable(room, 2, 2)).toBe(false); // wall
    expect(walkable(room, 4, 3)).toBe(false); // pits are solid to the walker
    expect(walkable(room, 0, 0)).toBe(false); // perimeter
    expect(walkable(room, 9, 1)).toBe(false); // outside is void
  });
});

describe('findPath', () => {
  it('returns the tiles after the start, and nothing when already there', () => {
    const room = yard();
    expect(findPath(room, [1, 1], [1, 1])).toEqual([]);
    expect(findPath(room, [1, 1], [4, 1])).toEqual([
      [2, 1],
      [3, 1],
      [4, 1],
    ]);
  });

  it('goes round a wall rather than through it', () => {
    // (1,3) is below the wall stub at (2,2)-(3,2); the way there is down and along.
    expect(findPath(yard(), [1, 1], [3, 3])).toEqual([
      [1, 2],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('has no path to a solid tile, or into a sealed room', () => {
    expect(findPath(yard(), [1, 1], [2, 2])).toBeNull();
    expect(findPath(parseRoom(['###', '#.#', '###']), [1, 1], [2, 1])).toBeNull();
  });

  it('avoids the tiles it is told to when it can, and steps on them when it cannot', () => {
    const room = parseRoom(['#####', '#...#', '#.s.#', '#...#', '#####']);
    const avoid = (col: number, row: number): boolean => col === 2 && row === 2;

    // Round the spike…
    expect(findPath(room, [1, 2], [3, 2], { avoid })).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
      [3, 2],
    ]);
    // …but onto it when it is the destination.
    expect(findPath(room, [1, 2], [2, 2], { avoid })).toEqual([[2, 2]]);
  });
});

describe('deadlySoon', () => {
  // Period 120 opens its window at ⌊3·120/5⌋ = 72 (02 §3).
  const traps = [trap([3, 2], 120, 0)];

  it('is the exact phase boundary, looked forward from the room timer', () => {
    expect(deadlySoon(traps, 40, [3, 2], 31)).toBe(false); // 40 + 31 = 71
    expect(deadlySoon(traps, 40, [3, 2], 32)).toBe(true); // 40 + 32 = 72
  });

  it('only speaks for the tile it was asked about', () => {
    expect(deadlySoon(traps, 100, [4, 2], 32)).toBe(false);
  });

  it('follows the offset', () => {
    const shifted = [trap([3, 2], 120, 60)];
    expect(deadlySoon(shifted, 0, [3, 2], 11)).toBe(false); // phase 71 at k=11
    expect(deadlySoon(shifted, 0, [3, 2], 12)).toBe(true); // phase 72 at k=12
  });
});

describe('boltSoon', () => {
  // A launcher over an open lane: it fires at phase 0 and the bolt falls 40 subpx a tick,
  // starting with its top edge on row 1 (02 §3.2).
  const room = parseRoom(['##a######', '#.......#', '#.......#', '#.......#', '#########']);
  const launcher: SimTrap = {
    def: { at: [2, 0], kind: 'arrow', period: 90, offset: 0, alwaysOn: false, deadly: null },
    phase: 0,
  };

  it('sees a volley coming down the lane, and knows when it arrives', () => {
    // Row 2 starts at 512; the bolt is 160 subpx tall with its top at 256 + 40k, so its
    // bottom edge crosses the line on the third tick of flight.
    expect(boltSoon(room, [], [launcher], 0, [2, 2], 2)).toBe(false);
    expect(boltSoon(room, [], [launcher], 0, [2, 2], 3)).toBe(true);
  });

  it('leaves the lanes either side alone', () => {
    expect(boltSoon(room, [], [launcher], 0, [1, 2], 40)).toBe(false);
    expect(boltSoon(room, [], [launcher], 0, [3, 2], 40)).toBe(false);
  });

  it('tracks a bolt already in flight', () => {
    expect(boltSoon(room, [{ id: 0, x: 2 * TILE_SUBPX, y: 256 }], [], 0, [2, 2], 3)).toBe(true);
    expect(boltSoon(room, [{ id: 0, x: 2 * TILE_SUBPX, y: 256 }], [], 0, [2, 2], 2)).toBe(false);
  });

  it('says nothing when the next volley is still a launcher cycle away', () => {
    expect(boltSoon(room, [], [launcher], 1, [2, 2], 20)).toBe(false);
  });
});

describe('closing a gap', () => {
  it('stops within one tick of travel of the target', () => {
    expect(axisInput(-WALK_SPEED, LEFT, RIGHT)).toBe(LEFT);
    expect(axisInput(-WALK_SPEED + 1, LEFT, RIGHT)).toBe(0);
    expect(axisInput(WALK_SPEED - 1, LEFT, RIGHT)).toBe(0);
    expect(axisInput(WALK_SPEED, LEFT, RIGHT)).toBe(RIGHT);
  });

  it('stops a little high vertically, since the box sits on its tile’s bottom edge', () => {
    expect(verticalInput(-1, UP, DOWN)).toBe(UP); // below the line: come back up
    expect(verticalInput(0, UP, DOWN)).toBe(0);
    expect(verticalInput(WALK_SPEED - 1, UP, DOWN)).toBe(0); // short is safe
    expect(verticalInput(WALK_SPEED, UP, DOWN)).toBe(DOWN);
  });

  it('is what keeps the player box inside one tile', () => {
    // 10 × 8 px at offset (3,8): 48 subpx of slack either side, none below.
    expect(tilesOverlapped(1 * TILE_SUBPX + 48, 1 * TILE_SUBPX + 128, 160, 128)).toEqual([[1, 1]]);
    expect(tilesOverlapped(1 * TILE_SUBPX + 48, 1 * TILE_SUBPX + 129, 160, 128)).toEqual([
      [1, 1],
      [1, 2],
    ]);
  });
});

describe('macro text', () => {
  it('names each input byte the way 05 §3.2 writes it', () => {
    expect(stepLetters(0)).toBe('W');
    expect(stepLetters(UP)).toBe('U');
    expect(stepLetters(UP | RIGHT)).toBe('UR');
    expect(stepLetters(ATTACK | RIGHT)).toBe('RA');
    expect(stepLetters(INTERACT)).toBe('Z');
    expect(stepLetters(UP | DOWN | LEFT | RIGHT | ATTACK | INTERACT)).toBe('UDLRAZ');
  });

  it('run-length encodes a tape, leaving single ticks bare', () => {
    expect(encodeMacro([UP, UP, UP, 0, 0, ATTACK])).toEqual(['U 3', 'W 2', 'A']);
    expect(encodeMacro([])).toEqual([]);
  });

  it('breaks a run at a marker so the assert lands on its own tick', () => {
    expect(
      encodeMacro(
        [UP, UP, UP, UP],
        [
          { tick: 0, text: '# start' },
          { tick: 2, text: 'assert treasure=1' },
          { tick: 4, text: 'assert room=R2' },
        ],
      ),
    ).toEqual(['# start', 'U 2', 'assert treasure=1', 'U 2', 'assert room=R2']);
  });
});

describe('parsing a route', () => {
  it('reads the headers and keeps the steps in order', () => {
    const route = parseRoute(
      [
        '# a comment',
        'floor f2',
        'room R6',
        'at 9,4',
        'start hp=4 treasure=31',
        '',
        'goto 5,3',
        'push U 2',
        'assert silverKeys=1',
      ].join('\n'),
      'x.route',
    );
    expect(route.floor).toBe('f2');
    expect(route.room).toBe('R6');
    expect(route.at).toEqual([9, 4]);
    expect(route.start).toEqual({ hp: 4, treasure: 31, deaths: 0 });
    expect(route.steps.map((s) => s.head)).toEqual(['goto', 'push', 'assert']);
    expect(route.steps[2]!.args).toEqual(['silverKeys=1']);
  });

  it('keeps a say line whole, hash marks and all', () => {
    const route = parseRoute('floor f1\nsay R1: the four coins # not a comment', 'x.route');
    expect(route.steps[0]!.args.join(' ')).toBe('R1: the four coins # not a comment');
  });

  it('refuses a route with no floor, and an unreadable cell', () => {
    expect(() => parseRoute('goto 1,1', 'x.route')).toThrow(RouteError);
    expect(() => parseRoute('floor f1\nat nowhere', 'x.route')).toThrow(RouteError);
  });
});
