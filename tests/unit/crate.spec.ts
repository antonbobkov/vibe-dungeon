import { describe, expect, it } from 'vitest';

import { ATTACK, DOWN, LEFT, RIGHT, UP } from '../../src/sim/input.js';
import {
  CRATE_DESTROY_TICKS,
  PUSH_CHARGE_TICKS,
  PUSH_SLIDE_TICKS,
  TILE_SUBPX,
} from '../../src/sim/constants.js';
import { createEntity } from '../../src/sim/enemy.js';
import { pitFlag, propFlag } from '../../src/sim/persistence.js';
import { Dir8 } from '../../src/sim/geometry.js';
import { PropState, slideTarget } from '../../src/sim/prop.js';
import { TileClass, parseRoom, tileAt } from '../../src/sim/room.js';
import { Sim } from '../../src/sim/sim.js';
import { game, hold, runUntil } from './helpers.js';

/** A room with a pushable crate at (4,2) and space either side of it. */
const YARD = ['#########', '#.......#', '#...p...#', '#.......#', '#.......#', '#########'];

/**
 * The player flush against the crate's left face, so tick 1 is already a contact tick. The
 * player's box is 160 wide at offset 48, so flush against a tile starting at 1024 is x = 816.
 */
const FLUSH_LEFT_OF_CRATE = { x: 4 * TILE_SUBPX - 208, y: 2 * TILE_SUBPX };

function yard(map = YARD, start = FLUSH_LEFT_OF_CRATE): Sim {
  return new Sim(parseRoom(map), { start });
}

const crateOf = (sim: Sim) => sim.props.find((p) => p.kind === 'crate_push')!;

// 02-entities §4.2.
describe('charging a push', () => {
  it('takes exactly six consecutive contact ticks', () => {
    const s = yard();
    const crate = crateOf(s);

    hold(s, RIGHT, PUSH_CHARGE_TICKS - 1);
    expect(crate.charge).toBe(5);
    expect(crate.state).toBe(PropState.IDLE);

    s.tick(RIGHT);
    expect(crate.state).toBe(PropState.SLIDING);
    expect(PUSH_CHARGE_TICKS).toBe(6);
  });

  it('resets the moment contact breaks', () => {
    const s = yard();
    const crate = crateOf(s);

    hold(s, RIGHT, 4);
    expect(crate.charge).toBe(4);

    s.tick(0); // let go for a single tick
    expect(crate.charge).toBe(0);

    hold(s, RIGHT, 5);
    expect(crate.state).toBe(PropState.IDLE); // the count started again
    s.tick(RIGHT);
    expect(crate.state).toBe(PropState.SLIDING);
  });

  it('resets when the direction changes', () => {
    // Approach from the left, then from above: neither run reaches six.
    const s = yard();
    const crate = crateOf(s);
    hold(s, RIGHT, 4);
    expect(crate.chargeDir).not.toBeNull();

    hold(s, UP, 4);
    expect(crate.charge).toBeLessThan(PUSH_CHARGE_TICKS);
    expect(crate.state).toBe(PropState.IDLE);
  });

  it('does not charge while the player is swinging (02 §4.2 wants NORMAL)', () => {
    const s = yard();
    const crate = crateOf(s);
    s.tick(ATTACK); // locked into SWING for 14 ticks
    hold(s, RIGHT, 8);
    expect(crate.state).toBe(PropState.IDLE);
  });
});

describe('the slide', () => {
  it('takes exactly twelve ticks and moves exactly one tile', () => {
    const s = yard();
    const crate = crateOf(s);
    hold(s, RIGHT, PUSH_CHARGE_TICKS);
    expect(crate.state).toBe(PropState.SLIDING);
    expect(crate.at).toEqual([4, 2]);

    hold(s, RIGHT, PUSH_SLIDE_TICKS - 1);
    expect(crate.state).toBe(PropState.SLIDING);
    expect(crate.at).toEqual([4, 2]); // still nominally where it started

    s.tick(RIGHT);
    expect(crate.state).toBe(PropState.IDLE);
    expect(crate.at).toEqual([5, 2]);
    expect(PUSH_SLIDE_TICKS).toBe(12);
  });

  it('keeps both tiles solid while it runs', () => {
    const s = yard();
    hold(s, RIGHT, PUSH_CHARGE_TICKS);
    expect(tileAt(s.room, 4, 2)).toBe(TileClass.PROP);
    expect(tileAt(s.room, 5, 2)).toBe(TileClass.PROP);

    hold(s, RIGHT, PUSH_SLIDE_TICKS);
    expect(tileAt(s.room, 4, 2)).toBe(TileClass.FLOOR);
    expect(tileAt(s.room, 5, 2)).toBe(TileClass.PROP);
  });

  it('never lets the player walk through the crate', () => {
    const s = yard();
    hold(s, RIGHT, PUSH_CHARGE_TICKS + PUSH_SLIDE_TICKS);
    // The crate is at (5,2) now; the player is still on its left, not past it.
    expect(s.player.x).toBeLessThan(5 * TILE_SUBPX);
  });
});

describe('refusing a push', () => {
  const refuses = (map: string[], start: { x: number; y: number }, input: number): void => {
    const s = yard(map, start);
    const crate = crateOf(s);
    hold(s, input, PUSH_CHARGE_TICKS + 4);
    expect(crate.state).toBe(PropState.IDLE);
    expect(crate.charge).toBe(0); // and never accumulated at all
  };

  it('into a wall', () => {
    refuses(
      ['#########', '#.......#', '#......p#', '#.......#', '#########'],
      { x: 7 * TILE_SUBPX - 208, y: 2 * TILE_SUBPX },
      RIGHT,
    );
  });

  it('into a trap', () => {
    refuses(
      ['#########', '#.......#', '#...ps..#', '#.......#', '#########'],
      FLUSH_LEFT_OF_CRATE,
      RIGHT,
    );
  });

  it('onto a pickup', () => {
    refuses(
      ['#########', '#.......#', '#...pc..#', '#.......#', '#########'],
      FLUSH_LEFT_OF_CRATE,
      RIGHT,
    );
  });

  it('into a second crate', () => {
    refuses(
      ['#########', '#.......#', '#...pp..#', '#.......#', '#########'],
      FLUSH_LEFT_OF_CRATE,
      RIGHT,
    );
  });

  it('into a door', () => {
    const map = ['####DD###', '#.......#', '#.......#', '#.......#', '#########'];
    const s = new Sim(parseRoom(map), { start: { x: 4 * TILE_SUBPX, y: 2 * TILE_SUBPX } });
    // Put a crate directly under the doorway and push it up into the door cell.
    s.props = [
      {
        at: [4, 1],
        origin: [4, 1],
        kind: 'crate_push',
        state: PropState.IDLE,
        timer: 0,
        contents: [],
        drop: null,
        slideTo: null,
        charge: 0,
        chargeDir: null,
      },
    ];
    hold(s, UP, PUSH_CHARGE_TICKS + 4);
    expect(s.props[0]!.state).toBe(PropState.IDLE);
  });

  it('onto an enemy', () => {
    const s = yard();
    s.entities.push(createEntity(0, 'zombie', 5 * TILE_SUBPX, 2 * TILE_SUBPX, null));
    const crate = crateOf(s);
    hold(s, RIGHT, PUSH_CHARGE_TICKS + 2);
    expect(crate.state).toBe(PropState.IDLE);
  });
});

describe('bridging a pit', () => {
  const TRENCH = ['#########', '#.......#', '#...p_..#', '#.......#', '#########'];

  it('consumes the crate and leaves a walkable bridge', () => {
    const s = yard(TRENCH);
    expect(tileAt(s.room, 5, 2)).toBe(TileClass.PIT);

    hold(s, RIGHT, PUSH_CHARGE_TICKS + PUSH_SLIDE_TICKS);
    expect(s.props.filter((p) => p.kind === 'crate_push')).toEqual([]);
    expect(tileAt(s.room, 5, 2)).toBe(TileClass.BRIDGED_PIT);

    // And the player can now walk over it.
    hold(s, RIGHT, 40);
    expect(s.player.x).toBeGreaterThan(5 * TILE_SUBPX);
  });

  it('stays bridged for good, and the crate does not come back (01 §9)', () => {
    const s = yard(TRENCH);
    hold(s, RIGHT, PUSH_CHARGE_TICKS + PUSH_SLIDE_TICKS);
    expect(s.persistence.has(pitFlag('f1', 'R1', 5, 2))).toBe(true);

    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);
    expect(tileAt(s.room, 5, 2)).toBe(TileClass.BRIDGED_PIT);
    expect(s.props.filter((p) => p.kind === 'crate_push')).toEqual([]);
  });
});

describe('a crate that was only moved', () => {
  it('goes back to its map position on re-entry, which unjams a corner', () => {
    // Shove it into the corner, where no further push is legal — the jam 02 §4.2 describes.
    const s = yard();
    runUntil(s, RIGHT, (sim) => crateOf(sim).at[0] === 5, 60);
    runUntil(s, RIGHT, (sim) => crateOf(sim).at[0] === 6, 60);
    runUntil(s, RIGHT, (sim) => crateOf(sim).at[0] === 7, 60);
    expect(crateOf(s).at).toEqual([7, 2]);

    hold(s, RIGHT, 40); // hard against the wall now: nothing more happens
    expect(crateOf(s).at).toEqual([7, 2]);

    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);
    expect(crateOf(s).at).toEqual([4, 2]); // back where the map puts it
    expect(tileAt(s.room, 7, 2)).toBe(TileClass.FLOOR);
  });
});

describe('destructible crates', () => {
  const SHED = ['#########', '#.......#', '#...x...#', '#.......#', '#########'];

  it('come apart in twelve ticks and leave their drop', () => {
    const s = new Sim(parseRoom(SHED), { start: { x: 3 * TILE_SUBPX, y: 2 * TILE_SUBPX } });
    s.props[0]!.drop = 'coin';
    s.tick(RIGHT); // face the crate
    const crate = s.props[0]!;

    hold(s, ATTACK, 1);
    hold(s, 0, 3); // into the swing's active window
    expect(crate.state).toBe(PropState.DESTROYING);
    expect(crate.timer).toBe(CRATE_DESTROY_TICKS);

    hold(s, 0, CRATE_DESTROY_TICKS - 1);
    expect(s.props).toHaveLength(1);
    s.tick(0);

    expect(s.props).toEqual([]);
    expect(tileAt(s.room, 4, 2)).toBe(TileClass.FLOOR);
    expect(s.pickups.map((p) => p.kind)).toEqual(['coin']);
  });

  it('stay broken (01 §9), and a pushable crate ignores the sword entirely', () => {
    const s = new Sim(parseRoom(SHED), { start: { x: 3 * TILE_SUBPX, y: 2 * TILE_SUBPX } });
    s.tick(RIGHT);
    runUntil(s, ATTACK, (sim) => sim.props.length === 0, 60);
    expect(s.persistence.has(propFlag('f1', 'R1', 4, 2))).toBe(true);

    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);
    expect(s.props).toEqual([]);

    const push = yard();
    push.tick(RIGHT);
    hold(push, ATTACK, 1);
    hold(push, 0, 20);
    expect(crateOf(push).state).toBe(PropState.IDLE); // no destruction for `p`
  });
});

describe('in the real levels', () => {
  it('bridges f3 R2’s trench, which is the room’s whole lesson', () => {
    // The crate sits at (6,4); the pit trench runs along row 2, so it needs two pushes north.
    const s = game({
      floorIndex: 2,
      roomId: 'R2',
      start: { x: 6 * TILE_SUBPX, y: 5 * TILE_SUBPX },
    });
    expect(crateOf(s).at).toEqual([6, 4]);

    runUntil(s, UP, (sim) => crateOf(sim).at[1] === 3, 120);
    runUntil(s, UP, (sim) => sim.props.every((p) => p.kind !== 'crate_push'), 120);

    expect(tileAt(s.room, 6, 2)).toBe(TileClass.BRIDGED_PIT);
    runUntil(s, UP, (sim) => sim.player.y < 2 * TILE_SUBPX, 200); // and over it
  });

  it('resets f3 R5’s crate if it is pushed somewhere useless', () => {
    // The crate is at (6,6); standing above it and pushing down shoves it away from the key.
    const s = game({
      floorIndex: 2,
      roomId: 'R5',
      start: { x: 6 * TILE_SUBPX, y: 5 * TILE_SUBPX },
    });
    expect(crateOf(s).at).toEqual([6, 6]);

    runUntil(s, DOWN, (sim) => crateOf(sim).at[1] === 7, 200);
    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);
    expect(crateOf(s).at).toEqual([6, 6]);
  });
});

// 02-entities §4.2: "one tile in the push direction" — and only ever a cardinal one.
describe('which way a crate goes', () => {
  /** Each face of the crate at (4,2), with the player flush against it. */
  const faces: [string, number, { x: number; y: number }, [number, number]][] = [
    ['from the west', RIGHT, FLUSH_LEFT_OF_CRATE, [5, 2]],
    ['from the east', LEFT, { x: 5 * TILE_SUBPX - 48, y: 2 * TILE_SUBPX }, [3, 2]],
    ['from the north', DOWN, { x: 4 * TILE_SUBPX, y: 1 * TILE_SUBPX }, [4, 3]],
    ['from the south', UP, { x: 4 * TILE_SUBPX, y: 3 * TILE_SUBPX - 128 }, [4, 1]],
  ];

  for (const [name, input, start, destination] of faces) {
    it(`pushes ${name} to ${destination.join(',')}`, () => {
      const s = yard(YARD, start);
      const crate = crateOf(s);

      hold(s, input, PUSH_CHARGE_TICKS);
      expect(crate.state).toBe(PropState.SLIDING);
      expect(crate.slideTo).toEqual(destination);

      hold(s, input, PUSH_SLIDE_TICKS);
      expect(crate.at).toEqual(destination);
      expect(tileAt(s.room, destination[0], destination[1])).toBe(TileClass.PROP);
      expect(tileAt(s.room, 4, 2)).toBe(
        destination[0] === 4 && destination[1] === 2 ? TileClass.PROP : TileClass.FLOOR,
      );
    });
  }

  it('never slides diagonally', () => {
    for (const dir of [Dir8.UL, Dir8.UR, Dir8.DL, Dir8.DR]) {
      expect(slideTarget([4, 2], dir)).toBeNull();
    }
  });
});
