import { describe, expect, it } from 'vitest';

import {
  CLEAR_COLOR,
  HUD_H,
  PLAY_H,
  PLAY_W,
  ROOM_MAX_H,
  ROOM_MAX_W,
  ROOM_MIN_H,
  ROOM_MIN_W,
  SUBPX,
  TICK_RATE,
  TILE,
  TILE_SUBPX,
  VIEW_H,
  VIEW_W,
} from '../../src/sim/constants.js';

// TESTING.md §2: every constant table in the spec becomes a test asserting exact values.
// This one pins 00-overview §Global constants.
describe('global constants (00-overview §Global constants)', () => {
  it('pins the table', () => {
    expect(TICK_RATE).toBe(60);
    expect(TILE).toBe(16);
    expect(SUBPX).toBe(16);
    expect(VIEW_W).toBe(320);
    expect(VIEW_H).toBe(208);
    expect(HUD_H).toBe(16);
    expect(PLAY_W).toBe(320);
    expect(PLAY_H).toBe(192);
    expect(ROOM_MAX_W).toBe(20);
    expect(ROOM_MAX_H).toBe(12);
    expect(ROOM_MIN_W).toBe(5);
    expect(ROOM_MIN_H).toBe(4);
    expect(CLEAR_COLOR).toBe('#25131a');
  });

  it('keeps the derived values consistent', () => {
    // 1 tile = 256 subpx (00-overview §Coordinate conventions).
    expect(TILE_SUBPX).toBe(256);
    // The play area is the viewport below the HUD, and exactly ROOM_MAX tiles.
    expect(PLAY_H).toBe(VIEW_H - HUD_H);
    expect(PLAY_W).toBe(ROOM_MAX_W * TILE);
    expect(PLAY_H).toBe(ROOM_MAX_H * TILE);
  });
});
