import { describe, expect, it } from 'vitest';

import { DOWN, RIGHT } from '../../src/sim/input.js';
import { parseRoom } from '../../src/sim/room.js';
import { Sim } from '../../src/sim/sim.js';

/**
 * The corner rule (01-mechanics §3.2): two solids touching only at a corner must not be
 * slipped through diagonally. Here (3,2) and (2,3) meet at the point (768, 768) and the
 * player starts inside (2,2) heading down-right, straight at that corner.
 */
const PINCH = ['######', '#....#', '#..#.#', '#.#..#', '#....#', '######'];
/** The same room with only the horizontal blocker — the vertical path is open. */
const ONLY_RIGHT_BLOCKER = ['######', '#....#', '#..#.#', '#....#', '#....#', '######'];
/** …and with only the vertical blocker — the horizontal path is open. */
const ONLY_BELOW_BLOCKER = ['######', '#....#', '#....#', '#.#..#', '#....#', '######'];

const START = { x: 512, y: 512 }; // tile (2,2); hitbox 560..720 × 640..768

function run(map: string[], ticks = 60): Sim {
  const s = new Sim(parseRoom(map), { start: START });
  for (let i = 0; i < ticks; i++) s.tick(DOWN | RIGHT);
  return s;
}

describe('the corner rule', () => {
  it('pinches the player at the corner and never lets it through', () => {
    const s = run(PINCH);
    // X clamps flush against (3,2): 768 - 48 - 160 = 560.
    // Y clamps flush against (2,3): 768 - 128 - 128 = 512.
    expect([s.player.x, s.player.y]).toEqual([560, 512]);
  });

  it('is already pinched within five ticks and stays put', () => {
    expect([run(PINCH, 5).player.x, run(PINCH, 5).player.y]).toEqual([560, 512]);
    expect([run(PINCH, 600).player.x, run(PINCH, 600).player.y]).toEqual([560, 512]);
  });

  it('leaves the player in tile (2,2) — it never enters the far diagonal tile (3,3)', () => {
    const s = run(PINCH);
    const boxLeft = s.player.x + 48;
    const boxTop = s.player.y + 128;
    expect(Math.floor(boxLeft / 256)).toBe(2);
    expect(Math.floor(boxTop / 256)).toBe(2);
  });

  // Controls: with either blocker removed the same input gets through, so the test above
  // is proving the corner rule and not some unrelated stall.
  it('slides down past a lone blocker to its right, then carries on', () => {
    const s = run(ONLY_RIGHT_BLOCKER);
    // X stalls at 560 only until the descent clears row 2; then column 3 is free.
    expect([s.player.x, s.player.y]).toEqual([1072, 1024]); // both far walls
  });

  it('rounds a lone blocker below it and reaches the far side', () => {
    const s = run(ONLY_BELOW_BLOCKER);
    expect([s.player.x, s.player.y]).toEqual([1072, 1024]);
  });
});
