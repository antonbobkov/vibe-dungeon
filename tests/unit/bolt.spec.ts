import { describe, expect, it } from 'vitest';

import { BOLT_BOX, BOLT_SPEED, MAX_HP, TILE_SUBPX } from '../../src/sim/constants.js';
import { createEntity } from '../../src/sim/enemy.js';
import { parseRoom } from '../../src/sim/room.js';
import { Sim } from '../../src/sim/sim.js';
import { boltAt, boltRect } from '../../src/sim/trap.js';
import { game, hold } from './helpers.js';

/**
 * 02-entities §3.2. A launcher fires at phase 0; the bolt is 4 × 10 px, centred in the lane,
 * starting on the top edge of the tile below, and falls 40 subpx a tick until something
 * stops it.
 */

/** A tall room with a launcher in the top wall over column 3. */
const LANE = ['#########', '#.......#', '#.......#', '#.......#', '#.......#', '#########'];

/**
 * `roomTimer` is 1 on a room's first tick, so a launcher fires there only if its offset
 * carries the phase to 0 — 89 of 90. The alternative is waiting 90 ticks for every case.
 */
const FIRES_IMMEDIATELY = 89;

function laneSim(map = LANE, start = { x: 7 * TILE_SUBPX, y: 4 * TILE_SUBPX }): Sim {
  const sim = new Sim(parseRoom(map), { start });
  sim.traps = [
    {
      def: {
        at: [3, 0],
        kind: 'arrow',
        period: 90,
        offset: FIRES_IMMEDIATELY,
        alwaysOn: false,
        deadly: null,
      },
      phase: FIRES_IMMEDIATELY,
    },
  ];
  return sim;
}

describe('a bolt', () => {
  it('is 4 × 10 px centred in the lane it falls down', () => {
    expect(BOLT_BOX).toEqual({ offX: 6, offY: 0, w: 4, h: 10 });
    const rect = boltRect(boltAt(0, [3, 0]));
    // The lane spans 768..1024 subpx; the bolt's 64-wide box sits in the middle of it.
    expect(rect.l - 3 * TILE_SUBPX).toBe(96);
    expect(rect.r - rect.l).toBe(4 * 16);
    expect(rect.b - rect.t).toBe(10 * 16);
  });

  it('starts on the top edge of the tile below the launcher', () => {
    expect(boltRect(boltAt(0, [3, 0])).t).toBe(1 * TILE_SUBPX);
    expect(boltRect(boltAt(0, [3, 4])).t).toBe(5 * TILE_SUBPX);
  });

  it('travels 40 subpx a tick', () => {
    const sim = laneSim();
    sim.tick(0);
    expect(sim.bolts).toHaveLength(1);
    const first = sim.bolts[0]!.y;

    sim.tick(0);
    expect(sim.bolts[0]!.y - first).toBe(BOLT_SPEED);
    expect(BOLT_SPEED).toBe(40);
  });

  it('is fired once per period, and never twice in a row', () => {
    const sim = laneSim();
    const fired: number[] = [];
    for (let tick = 1; tick <= 181; tick++) {
      const before = sim.bolts.length;
      sim.tick(0);
      if (sim.bolts.length > before) fired.push(tick);
    }
    expect(fired).toEqual([1, 91, 181]); // exactly one per 90-tick period
  });
});

describe('what stops it', () => {
  it('the floor at the bottom of the room', () => {
    const sim = laneSim();
    hold(sim, 0, 40);
    expect(sim.bolts).toEqual([]);
  });

  it('a wall in the lane', () => {
    // A wall block at (3,2), two rows down.
    const map = ['#########', '#.......#', '#..#....#', '#.......#', '#.......#', '#########'];
    const sim = laneSim(map);

    sim.tick(0);
    expect(sim.bolts).toHaveLength(1);
    hold(sim, 0, 20);
    expect(sim.bolts).toEqual([]);
  });

  it('a crate in the lane — the shadow the puzzles use', () => {
    const map = ['#########', '#.......#', '#..x....#', '#.......#', '#.......#', '#########'];
    const sim = laneSim(map);
    sim.tick(0);
    const before = sim.bolts[0]!.y;

    hold(sim, 0, 6);
    expect(sim.bolts).toEqual([]);
    // It stopped at the crate, not at the floor two rows further down.
    expect(before).toBeLessThan(3 * TILE_SUBPX);
  });

  it('the player, for one point of damage', () => {
    // Bolts move in phase 5 and are fired in phase 6, so the spawning tick is not a moving
    // tick: a bolt's box top is 256 + 40·(tick − 1). The player's box starts at y = 896, and
    // boxes are half-open, so the foot at exactly 896 on tick 13 still misses.
    const sim = laneSim(LANE, { x: 3 * TILE_SUBPX, y: 3 * TILE_SUBPX });
    hold(sim, 0, 13);
    expect(sim.player.hp).toBe(MAX_HP);

    sim.tick(0);
    expect(sim.player.hp).toBe(MAX_HP - 1);
    expect(sim.bolts).toEqual([]);
  });

  it('but not a pit, a pickup, a spike or an enemy', () => {
    const map = ['#########', '#..s....#', '#.._....#', '#..c....#', '#.......#', '#########'];
    const sim = laneSim(map, { x: 7 * TILE_SUBPX, y: 4 * TILE_SUBPX });
    sim.entities.push(createEntity(0, 'skel_sword', 3 * TILE_SUBPX, 3 * TILE_SUBPX, null));

    sim.tick(0);
    expect(sim.bolts).toHaveLength(1);

    // Rows of hazards and a skeleton, and it is still falling past all of them.
    hold(sim, 0, 13);
    expect(sim.bolts).toHaveLength(1);
    expect(sim.bolts[0]!.y).toBeGreaterThan(3 * TILE_SUBPX);
    expect(sim.entities[0]!.hp).toBe(2); // and never touched the skeleton
  });
});

describe('in the real levels', () => {
  it('f2’s Arrow Gallery fires three staggered lanes', () => {
    // 03-levels f2 R3: launchers at (2,0), (5,0) and (8,0), period 90, offsets 0/30/60.
    const s = game({
      floorIndex: 1,
      roomId: 'R3',
      start: { x: 1 * TILE_SUBPX, y: 6 * TILE_SUBPX },
    });
    expect(s.traps.map((t) => t.def.at[0])).toEqual([2, 5, 8]);
    expect(s.traps.map((t) => t.def.offset)).toEqual([0, 30, 60]);

    const firedAt: number[] = [];
    for (let tick = 1; tick <= 90; tick++) {
      const before = s.bolts.length;
      s.tick(0);
      if (s.bolts.length > before) firedAt.push(tick);
    }
    // Phase 0 comes round for each lane once, 30 ticks apart: 30, 60, 90.
    expect(firedAt).toEqual([30, 60, 90]);
  });

  it('clears bolts in flight when the room is re-entered (01 §9)', () => {
    const s = laneSim();
    s.tick(0);
    expect(s.bolts).toHaveLength(1);

    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);
    expect(s.bolts).toEqual([]);
  });
});
