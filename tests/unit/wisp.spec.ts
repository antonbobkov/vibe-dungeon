import { describe, expect, it } from 'vitest';

import { diagAxis } from '../../src/sim/collision.js';
import {
  SIN,
  TILE_SUBPX,
  WISP_WOBBLE_AMPLITUDE,
  WISP_WOBBLE_PERIOD,
  WISP_WOBBLE_SHIFT,
} from '../../src/sim/constants.js';
import { playerCentre } from '../../src/sim/combat.js';
import { EnemyState, createEntity, entityCentre, wispWobble } from '../../src/sim/enemy.js';
import { parseRoom } from '../../src/sim/room.js';
import { Sim } from '../../src/sim/sim.js';

/**
 * 02-entities §2.4. The wobble is `(12 * SIN[(roomTimer / 4) mod 16]) >> 6`, applied 90°
 * clockwise from the snapped chase direction. Everything below is computed from that
 * formula in the test itself and compared against the sim tick by tick.
 */

describe('the SIN table', () => {
  it('is the one the spec prints, verbatim', () => {
    expect([...SIN]).toEqual([0, 24, 45, 59, 64, 59, 45, 24, 0, -24, -45, -59, -64, -59, -45, -24]);
    expect(SIN).toHaveLength(16);
  });

  it('is a quarter-period apart at its peaks, and antisymmetric', () => {
    expect(SIN[4]).toBe(64);
    expect(SIN[12]).toBe(-64);
    // Stated as a sum, since -SIN[0] is -0 and Object.is(0, -0) is false.
    for (let i = 0; i < 8; i++) expect(SIN[i]! + SIN[i + 8]!).toBe(0);
  });
});

describe('the wobble', () => {
  /** The wobble speed the spec's formula gives for a tick. */
  const speedAt = (roomTimer: number): number =>
    (WISP_WOBBLE_AMPLITUDE * SIN[Math.floor(roomTimer / WISP_WOBBLE_PERIOD) % SIN.length]!) >>
    WISP_WOBBLE_SHIFT;

  it('steps through the table every 4 ticks', () => {
    expect(WISP_WOBBLE_PERIOD).toBe(4);
    expect([0, 1, 2, 3].map(speedAt)).toEqual([0, 0, 0, 0]); // SIN[0] = 0
    expect([4, 5, 6, 7].map(speedAt)).toEqual([4, 4, 4, 4]); // (12 * 24) >> 6 = 4
    expect(speedAt(16)).toBe(12); // (12 * 64) >> 6, the peak
  });

  it('is one subpixel stronger on the negative half, because >> floors', () => {
    // (12 * 24) >> 6 = 4, but (12 * -24) >> 6 = -5: the shift rounds toward −∞, and 02 §2.4
    // writes the shift explicitly rather than a magnitude-then-sign rule.
    expect(speedAt(4)).toBe(4); // SIN[1] = 24
    expect(speedAt(36)).toBe(-5); // SIN[9] = −24, and 4 would be the symmetric answer
    expect(speedAt(16)).toBe(12); // SIN[4] = 64
    expect(speedAt(48)).toBe(-12); // SIN[12] = −64, symmetric only because 64 divides evenly
    expect(speedAt(32)).toBe(0); // SIN[8] = 0
  });

  it('pushes perpendicular to the heading, 90° clockwise', () => {
    const room = parseRoom(['#########', '#.......#', '#.......#', '#.......#', '#########']);
    const wisp = createEntity(0, 'wisp', 6 * TILE_SUBPX, 2 * TILE_SUBPX, null);
    const centre = entityCentre(wisp);

    // Heading due left, so clockwise-perpendicular is up.
    const target = { x: centre.x - 1000, y: centre.y };
    expect(wispWobble(wisp, { room, target, roomTimer: 16 })).toEqual({ x: 0, y: -12 });

    // Heading due up: clockwise-perpendicular is right.
    const above = { x: centre.x, y: centre.y - 1000 };
    expect(wispWobble(wisp, { room, target: above, roomTimer: 16 })).toEqual({ x: 12, y: 0 });

    // Half a period later the same headings push the other way.
    expect(wispWobble(wisp, { room, target, roomTimer: 48 })).toEqual({ x: 0, y: 12 });
  });

  it('spreads a diagonal wobble across both axes at the 181/256 rate', () => {
    const room = parseRoom(['#########', '#.......#', '#.......#', '#.......#', '#########']);
    const wisp = createEntity(0, 'wisp', 4 * TILE_SUBPX, 2 * TILE_SUBPX, null);
    const centre = entityCentre(wisp);

    const target = { x: centre.x - 1000, y: centre.y - 1000 }; // heading up-left
    const wobble = wispWobble(wisp, { room, target, roomTimer: 16 });
    expect(wobble).toEqual({ x: diagAxis(12), y: -diagAxis(12) }); // up-right, 8 per axis
  });

  it('is still when the wisp is exactly on its target', () => {
    const room = parseRoom(['#####', '#...#', '#####']);
    const wisp = createEntity(0, 'wisp', TILE_SUBPX, TILE_SUBPX, null);
    expect(wispWobble(wisp, { room, target: entityCentre(wisp), roomTimer: 16 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});

// The M3 checklist: a wisp's path against a precomputed 60-tick trace.
describe('a 60-tick flight', () => {
  /**
   * Generated once and committed, so any change to the wisp's arithmetic shows up here.
   * The opening ticks were checked by hand against 02 §2.4 before it was pinned:
   *
   *   start   wisp centre (3200, 960), player centre (384, 960) — dy is exactly 0
   *   tick 1  SIN[0] = 0, so no wobble; chase is cardinal left at 16      → x 3056
   *   tick 4  step 1: (12 · 24) >> 6 = 4, clockwise from "left" is up     → y 828
   *   tick 7  dy has grown past the 8-subpx deadzone, so the chase turns
   *           diagonal at (16 · 181) >> 8 = 11 per axis                   → x 2965, y 827
   *   tick 36 step 9: (12 · −24) >> 6 = −5, not −4 — the shift floors      → y +5
   */
  const TRACE: [number, number][] = [
    [3056, 832],
    [3040, 832],
    [3024, 832],
    [3008, 828],
    [2992, 824],
    [2976, 820],
    [2965, 827],
    [2949, 819],
    [2938, 822],
    [2927, 825],
    [2911, 817],
    [2900, 817],
    [2889, 817],
    [2878, 817],
    [2867, 817],
    [2856, 816],
    [2845, 815],
    [2834, 814],
    [2823, 813],
    [2812, 813],
    [2801, 813],
    [2790, 813],
    [2779, 813],
    [2768, 816],
    [2757, 819],
    [2746, 822],
    [2735, 825],
    [2719, 821],
    [2708, 828],
    [2692, 824],
    [2676, 820],
    [2665, 831],
    [2649, 831],
    [2633, 831],
    [2617, 831],
    [2601, 836],
    [2585, 841],
    [2574, 835],
    [2558, 840],
    [2542, 849],
    [2531, 847],
    [2520, 845],
    [2509, 843],
    [2498, 844],
    [2487, 845],
    [2476, 846],
    [2465, 847],
    [2454, 848],
    [2443, 849],
    [2432, 850],
    [2421, 851],
    [2410, 852],
    [2399, 853],
    [2388, 854],
    [2377, 855],
    [2366, 853],
    [2355, 851],
    [2344, 849],
    [2333, 847],
    [2322, 841],
  ];

  it('follows the trace tick for tick', () => {
    // A wide open room with the player parked far to the left on the wisp's own row, so the
    // flight starts as a pure cardinal chase and the wobble is the only vertical force.
    const map = [
      '################',
      '#..............#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#..............#',
      '################',
    ];

    const sim = new Sim(parseRoom(map), { start: { x: 1 * TILE_SUBPX, y: 3 * TILE_SUBPX } });
    const wisp = createEntity(0, 'wisp', 12 * TILE_SUBPX, 3 * TILE_SUBPX, null);
    wisp.y += playerCentre(sim.player).y - entityCentre(wisp).y; // line the centres up
    wisp.state = EnemyState.CHASE;
    wisp.aggroed = true;
    sim.entities.push(wisp);

    expect([wisp.x, wisp.y]).toEqual([3072, 832]);

    const flown: [number, number][] = [];
    for (let tick = 1; tick <= TRACE.length; tick++) {
      sim.tick(0);
      flown.push([wisp.x, wisp.y]);
    }

    expect(flown).toEqual(TRACE);
  });

  it('would not follow it without the wobble', () => {
    // A sanity check on the trace itself: a straight chase would never leave row 832.
    expect(TRACE.some(([, y]) => y !== 832)).toBe(true);
  });
});
