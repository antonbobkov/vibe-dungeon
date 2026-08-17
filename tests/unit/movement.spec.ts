import { describe, expect, it } from 'vitest';

import { diagAxis } from '../../src/sim/collision.js';
import { WALK_SPEED } from '../../src/sim/constants.js';
import { DOWN, LEFT, RIGHT, UP } from '../../src/sim/input.js';
import { Facing, PlayerState } from '../../src/sim/player.js';
import { parseRoom } from '../../src/sim/room.js';
import { Sim } from '../../src/sim/sim.js';

// An open room with interior cols 1..5 and rows 1..4, so a short walk never reaches a wall.
const ROOM = ['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#######'];

/** Start on tile (2,2): sprite-cell top-left = (2*256, 2*256). */
function sim(): Sim {
  return new Sim(parseRoom(ROOM), { start: { x: 512, y: 512 } });
}

function hold(s: Sim, input: number, ticks: number): void {
  for (let i = 0; i < ticks; i++) s.tick(input);
}

// 01-mechanics §3.3.
describe('walk speed', () => {
  it('is 20 subpx/tick on a cardinal and 14 on each diagonal axis', () => {
    expect(WALK_SPEED).toBe(20);
    expect(diagAxis(WALK_SPEED)).toBe(14);
  });

  it('applies the 181/256 factor to the magnitude, so every direction is symmetric', () => {
    // The trap: (-20 * 181) >> 8 is -15, because >> floors toward -Infinity.
    expect((-WALK_SPEED * 181) >> 8).toBe(-15);

    const right = sim();
    hold(right, RIGHT | DOWN, 10);
    const left = sim();
    hold(left, LEFT | UP, 10);
    expect(right.player.x - 512).toBe(140);
    expect(512 - left.player.x).toBe(140);
    expect(right.player.y - 512).toBe(140);
    expect(512 - left.player.y).toBe(140);
  });
});

describe('cardinal walking', () => {
  it('moves 20 subpx per tick horizontally', () => {
    const s = sim();
    hold(s, RIGHT, 10);
    expect(s.player.x).toBe(712); // 512 + 10 * 20
    expect(s.player.y).toBe(512);
  });

  it('moves 20 subpx per tick vertically', () => {
    const s = sim();
    hold(s, UP, 7);
    expect(s.player.y).toBe(372); // 512 - 7 * 20
    expect(s.player.x).toBe(512);
  });

  it('stops the tick input is released — no acceleration, no friction', () => {
    const s = sim();
    hold(s, RIGHT, 5);
    expect(s.player.x).toBe(612);
    hold(s, 0, 20);
    expect(s.player.x).toBe(612);
  });
});

describe('diagonal walking', () => {
  it('moves 14 subpx per tick on each axis', () => {
    const s = sim();
    hold(s, UP | RIGHT, 10);
    expect([s.player.x, s.player.y]).toEqual([652, 372]); // 512 ± 10 * 14
  });

  it('walks at the full 20 when one axis cancels itself out', () => {
    const s = sim();
    hold(s, LEFT | RIGHT | UP, 5);
    expect([s.player.x, s.player.y]).toEqual([512, 412]); // 512 - 5 * 20
  });

  it('does not move at all when both axes cancel', () => {
    const s = sim();
    hold(s, LEFT | RIGHT | UP | DOWN, 30);
    expect([s.player.x, s.player.y]).toEqual([512, 512]);
  });
});

// 01 §3.3: horizontal input wins; else vertical; else unchanged.
describe('facing', () => {
  it('follows a horizontal component even when a vertical one is held', () => {
    const s = sim();
    hold(s, UP | RIGHT, 1);
    expect(s.player.facing).toBe(Facing.R);
    hold(s, DOWN | LEFT, 1);
    expect(s.player.facing).toBe(Facing.L);
  });

  it('falls back to the vertical direction', () => {
    const s = sim();
    hold(s, UP, 1);
    expect(s.player.facing).toBe(Facing.U);
    hold(s, DOWN, 1);
    expect(s.player.facing).toBe(Facing.D);
  });

  it('is unchanged with no input, and by an axis that cancels itself', () => {
    const s = sim();
    hold(s, RIGHT, 1);
    expect(s.player.facing).toBe(Facing.R);
    hold(s, 0, 10);
    expect(s.player.facing).toBe(Facing.R);
    hold(s, LEFT | RIGHT, 10);
    expect(s.player.facing).toBe(Facing.R);
  });
});

describe('the tick loop', () => {
  it('advances play time every tick, including under hit-stop', () => {
    const s = sim();
    hold(s, 0, 3);
    expect(s.playTick).toBe(3);
  });

  it('freezes phases 3–9 while hit-stop runs (01 §1 phase 2)', () => {
    const s = sim();
    s.hitStop = 3;
    hold(s, RIGHT, 3);
    expect(s.player.x).toBe(512); // frozen
    expect(s.playTick).toBe(3); // but play time still advances
    expect(s.roomTimer).toBe(0); // and trap clocks do not
    hold(s, RIGHT, 1);
    expect(s.player.x).toBe(532); // resumed
  });

  it('ignores walk input outside NORMAL (01 §4.1 — SWING locks movement)', () => {
    const s = sim();
    s.player.state = PlayerState.SWING;
    hold(s, RIGHT, 10);
    expect(s.player.x).toBe(512);
    s.player.state = PlayerState.NORMAL;
    hold(s, RIGHT, 1);
    expect(s.player.x).toBe(532);
  });

  it('spawns on the map’s @ cell when no start is given', () => {
    const s = new Sim(parseRoom(['#####', '#...#', '#.@.#', '#####']));
    expect([s.player.x, s.player.y]).toEqual([512, 512]);
  });

  it('falls back to the first walkable tile in a room with no entry point', () => {
    // Rooms other than a floor's first have no `@`; the debug renderer and tests start in
    // them anyway, so the fallback has to be somewhere the player can stand.
    const s = new Sim(parseRoom(['#####', '#...#', '#####']));
    expect([s.player.x, s.player.y]).toEqual([256, 256]);
  });
});
