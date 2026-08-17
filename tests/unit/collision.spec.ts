import { describe, expect, it } from 'vitest';

import { PLAYER_BOX, SUBPX, TILE_SUBPX } from '../../src/sim/constants.js';
import { LEFT, RIGHT, UP } from '../../src/sim/input.js';
import { parseRoom } from '../../src/sim/room.js';
import { Sim } from '../../src/sim/sim.js';

const ROOM = ['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#######'];

const BOX_LEFT = PLAYER_BOX.offX * SUBPX; //  48 subpx
const BOX_W = PLAYER_BOX.w * SUBPX; // 160 subpx
const BOX_TOP = PLAYER_BOX.offY * SUBPX; // 128 subpx
const BOX_H = PLAYER_BOX.h * SUBPX; // 128 subpx

/** The right wall is column 6, so its left edge is at 1536 subpx. */
const WALL_X = 6 * TILE_SUBPX;
/** Flush against it: hitbox right edge exactly on the wall edge. */
const FLUSH_RIGHT_X = WALL_X - BOX_LEFT - BOX_W; // 1328

function sim(start = { x: 512, y: 512 }): Sim {
  return new Sim(parseRoom(ROOM), { start });
}

function hold(s: Sim, input: number, ticks: number): void {
  for (let i = 0; i < ticks; i++) s.tick(input);
}

// 01-mechanics §3.2.
describe('wall approach', () => {
  it('walks freely up to the last tick that fits', () => {
    const s = sim();
    hold(s, RIGHT, 40);
    expect(s.player.x).toBe(1312); // 512 + 40 * 20; hitbox right = 1520 < 1536
  });

  it('clamps flush on the tick that would overlap, zeroing the subpixels into the wall', () => {
    const s = sim();
    hold(s, RIGHT, 41); // 1332 unclamped — 4 subpx into the wall
    expect(s.player.x).toBe(FLUSH_RIGHT_X);
    expect(s.player.x + BOX_LEFT + BOX_W).toBe(WALL_X); // exactly flush
  });

  it('stays flush however long the direction is held', () => {
    const s = sim();
    hold(s, RIGHT, 200);
    expect(s.player.x).toBe(FLUSH_RIGHT_X);
  });

  it('clamps the same way against a wall on the other side', () => {
    const s = sim();
    hold(s, LEFT, 15);
    expect(s.player.x).toBe(212); // 512 - 15 * 20, still free
    hold(s, LEFT, 1);
    expect(s.player.x).toBe(TILE_SUBPX - BOX_LEFT); // 208 — hitbox left flush on the wall edge
  });

  it('clamps vertically against the top wall', () => {
    const s = sim();
    hold(s, UP, 60);
    expect(s.player.y).toBe(TILE_SUBPX - BOX_TOP); // 128 — hitbox top flush at 256
    expect(s.player.y + BOX_TOP).toBe(TILE_SUBPX);
  });
});

describe('wall sliding', () => {
  it('keeps moving on the free axis while the blocked one stays flush', () => {
    const s = sim({ x: FLUSH_RIGHT_X, y: 512 });
    hold(s, UP | RIGHT, 10);
    expect(s.player.x).toBe(FLUSH_RIGHT_X); // blocked, unchanged
    expect(s.player.y).toBe(372); // 512 - 10 * 14: the free axis still runs at the diagonal rate
  });

  it('slides along the top wall the same way', () => {
    const s = sim({ x: 512, y: TILE_SUBPX - BOX_TOP });
    hold(s, UP | RIGHT, 10);
    expect(s.player.y).toBe(TILE_SUBPX - BOX_TOP);
    expect(s.player.x).toBe(652); // 512 + 10 * 14
  });
});

describe('pits (01 §3.1: solid to walkers until bridged)', () => {
  it('stops the player exactly like a wall', () => {
    // The pit is column 4, so its left edge is 1024 subpx.
    const s = new Sim(parseRoom(['#######', '#..._.#', '#######']), {
      start: { x: 256, y: 256 },
    });
    hold(s, RIGHT, 200);
    expect(s.player.x).toBe(4 * TILE_SUBPX - BOX_LEFT - BOX_W); // 816
  });
});

describe('hitbox geometry (01 §3.3 — 10 × 8 px at offset (3,8))', () => {
  it('is the feet box, occupying the lower half of the sprite cell', () => {
    expect([BOX_LEFT, BOX_TOP, BOX_W, BOX_H]).toEqual([48, 128, 160, 128]);
    expect(BOX_TOP + BOX_H).toBe(TILE_SUBPX); // its bottom edge is the sprite cell's bottom
  });
});
