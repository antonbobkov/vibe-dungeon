import { describe, expect, it } from 'vitest';

import { TILE_SUBPX } from '../../src/sim/constants.js';
import { INTERACT } from '../../src/sim/input.js';
import { groupFlag, torchFlag } from '../../src/sim/persistence.js';
import { Facing } from '../../src/sim/player.js';
import { PropState } from '../../src/sim/prop.js';
import { Sim } from '../../src/sim/sim.js';
import { game, hold } from './helpers.js';

/**
 * 02-entities §4.3. Lighting the first torch of a group starts its timer; if the group has a
 * window and it runs out first, every member goes back out. Completing one fires its wiring
 * and makes the whole group permanent.
 */

/** Light the torch at `cell` by standing under it and pressing INTERACT. */
function light(sim: Sim, cell: [number, number]): void {
  sim.player.x = cell[0] * TILE_SUBPX;
  sim.player.y = (cell[1] + 1) * TILE_SUBPX;
  sim.player.facing = Facing.U;
  sim.tick(0); // release, so the next press is a fresh edge
  sim.tick(INTERACT);
}

const torchStates = (sim: Sim): PropState[] =>
  sim.props.filter((p) => p.kind === 'torch').map((p) => p.state);

// f2 R4's group G1 has four torches and no window.
describe('a group with no window', () => {
  const shrine = () =>
    game({ floorIndex: 1, roomId: 'R4', start: { x: 2 * TILE_SUBPX, y: 3 * TILE_SUBPX } });

  it('lights one torch at a time and waits indefinitely', () => {
    const s = shrine();
    expect(s.torchGroups.map((g) => g.window)).toEqual([null]);

    light(s, [2, 2]);
    expect(torchStates(s).filter((state) => state === PropState.LIT)).toHaveLength(1);

    hold(s, 0, 900); // far longer than any window in the game
    expect(torchStates(s).filter((state) => state === PropState.LIT)).toHaveLength(1);
  });

  it('remembers each torch as it is lit, since only windowed groups reset (01 §9)', () => {
    const s = shrine();
    light(s, [2, 2]);
    expect(s.persistence.has(torchFlag('f2', 'R4', 2, 2))).toBe(true);

    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);
    expect(torchStates(s).filter((state) => state === PropState.LIT)).toHaveLength(1);
  });

  it('fires its wiring when the fourth one catches', () => {
    const s = shrine();
    for (const cell of [
      [2, 2],
      [8, 2],
      [2, 6],
    ] as [number, number][]) {
      light(s, cell);
    }
    expect(s.litGroups).toEqual([]);

    light(s, [8, 6]);
    expect(s.litGroups).toEqual(['G1']);
    expect(s.persistence.has(groupFlag('f2', 'G1'))).toBe(true);
    expect(torchStates(s)).toEqual([PropState.LIT, PropState.LIT, PropState.LIT, PropState.LIT]);
  });

  it('stays lit for good once complete', () => {
    const s = shrine();
    for (const cell of [
      [2, 2],
      [8, 2],
      [2, 6],
      [8, 6],
    ] as [number, number][]) {
      light(s, cell);
    }
    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);
    expect(torchStates(s).every((state) => state === PropState.LIT)).toBe(true);
  });
});

// f4 R3's group G2 has the same four corners and a 600-tick window.
describe('a group with a 600-tick window', () => {
  const antechamber = () =>
    game({ floorIndex: 3, roomId: 'R3', start: { x: 1 * TILE_SUBPX, y: 3 * TILE_SUBPX } });

  it('puts three lit torches back out when the window runs out', () => {
    const s = antechamber();
    expect(s.torchGroups[0]!.window).toBe(600);

    for (const cell of [
      [1, 1],
      [9, 1],
      [1, 7],
    ] as [number, number][]) {
      light(s, cell);
    }
    expect(torchStates(s).filter((state) => state === PropState.LIT)).toHaveLength(3);

    hold(s, 0, 601);
    expect(torchStates(s).every((state) => state === PropState.IDLE)).toBe(true);
    expect(s.torchGroups[0]!.timer).toBe(-1); // and the timer is clear again
  });

  it('keeps them lit right up to the deadline', () => {
    const s = antechamber();
    light(s, [1, 1]);
    const started = s.torchGroups[0]!.timer;
    expect(started).toBe(0);

    hold(s, 0, 500);
    expect(torchStates(s).filter((state) => state === PropState.LIT)).toHaveLength(1);
  });

  it('never persists a torch of an unfinished windowed group (01 §9)', () => {
    const s = antechamber();
    light(s, [1, 1]);
    expect(s.persistence.has(torchFlag('f4', 'R3', 1, 1))).toBe(false);

    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);
    expect(torchStates(s).every((state) => state === PropState.IDLE)).toBe(true);
  });

  it('completes inside the window and then stops caring about it', () => {
    const s = antechamber();
    for (const cell of [
      [1, 1],
      [9, 1],
      [1, 7],
      [9, 7],
    ] as [number, number][]) {
      light(s, cell);
    }
    expect(s.litGroups).toEqual(['G2']);

    hold(s, 0, 700); // long past the window
    expect(torchStates(s).every((state) => state === PropState.LIT)).toBe(true);
  });
});

describe('a torch stand', () => {
  it('is solid whether it is lit or not (02 §4.3)', () => {
    const s = game({
      floorIndex: 1,
      roomId: 'R4',
      start: { x: 2 * TILE_SUBPX, y: 3 * TILE_SUBPX },
    });
    hold(s, 0b0001, 40); // walk up into the torch at (2,2)
    expect(s.player.y).toBeGreaterThan(2 * TILE_SUBPX);
  });
});
