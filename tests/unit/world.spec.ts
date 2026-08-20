import { describe, expect, it } from 'vitest';

import { promptVisible, TITLE_BLINK_TICKS } from '../../src/render/screens.js';
import { arcPixels, arcSweep, shakeOffset, slideVector } from '../../src/render/world.js';
import {
  IFRAME_TICKS,
  PLAY_H,
  PLAY_W,
  SWING_ACTIVE_FIRST,
  SWING_ACTIVE_LAST,
  SWING_TICKS,
} from '../../src/sim/constants.js';
import { Facing } from '../../src/sim/player.js';

/**
 * The renderer's decisions that the M7 game-feel checklist asks to be provable rather than
 * eyeballed: the sword arc's geometry, the damage shake, the transition slide, and the title
 * blink. Door art has a file of its own — tests/unit/door-art.spec.ts.
 */

describe('the sword arc (01 §4.2)', () => {
  it('sweeps from nothing to the full 100° across the active window', () => {
    expect(arcSweep(SWING_TICKS - SWING_ACTIVE_FIRST)).toBe(0);
    expect(arcSweep(SWING_TICKS - SWING_ACTIVE_LAST)).toBe(1);
    expect(arcSweep(SWING_TICKS - 6)).toBe(0.5);
  });

  it('stays on a radius of 14 px around the sprite centre', () => {
    for (const facing of [Facing.U, Facing.D, Facing.L, Facing.R]) {
      for (const pixel of arcPixels(facing, 1, 100, 100)) {
        const r = Math.hypot(pixel.x - 100, pixel.y - 100);
        expect(r, `${Facing[facing]} at (${pixel.x},${pixel.y})`).toBeGreaterThan(12);
        expect(r).toBeLessThan(15.5);
      }
    }
  });

  it('leads with exactly one white pixel, wherever it has swept to', () => {
    for (const swept of [0, 0.25, 0.5, 1]) {
      const pixels = arcPixels(Facing.R, swept, 100, 100);
      expect(pixels.filter((p) => p.leading)).toHaveLength(1);
      expect(pixels.at(-1)!.leading).toBe(true);
    }
  });

  it('grows as the swing goes on, and points where the player is facing', () => {
    const early = arcPixels(Facing.R, 0.1, 100, 100).length;
    const late = arcPixels(Facing.R, 1, 100, 100).length;
    expect(late).toBeGreaterThan(early);

    // Facing right, the band sits to the right of the centre; facing up, above it.
    expect(arcPixels(Facing.R, 1, 100, 100).every((p) => p.x >= 100)).toBe(true);
    expect(arcPixels(Facing.U, 1, 100, 100).every((p) => p.y <= 100)).toBe(true);
    expect(arcPixels(Facing.L, 1, 100, 100).every((p) => p.x <= 100)).toBe(true);
    expect(arcPixels(Facing.D, 1, 100, 100).every((p) => p.y >= 100)).toBe(true);
  });
});

describe('the damage shake (01 §5.1)', () => {
  it('runs for six ticks after a hit and nothing after that', () => {
    const offsets = Array.from({ length: 8 }, (_, elapsed) => shakeOffset(IFRAME_TICKS - elapsed));
    expect(offsets).toEqual([2, -2, 2, -1, 1, -1, 0, 0]);
  });

  it('is still when the player is not in i-frames at all', () => {
    expect(shakeOffset(0)).toBe(0);
  });

  it('never leaves the ±2 px 01 §5.1 asks for', () => {
    for (let timer = 0; timer <= IFRAME_TICKS; timer++) {
      expect(Math.abs(shakeOffset(timer))).toBeLessThanOrEqual(2);
    }
  });
});

describe('the transition slide (01 §8.2)', () => {
  it('carries a room exactly one play area, linearly, in the exit direction', () => {
    expect(slideVector('U', 0)).toEqual({ dx: 0, dy: 0 });
    expect(slideVector('U', 1)).toEqual({ dx: 0, dy: PLAY_H });
    expect(slideVector('D', 1)).toEqual({ dx: 0, dy: -PLAY_H });
    expect(slideVector('L', 1)).toEqual({ dx: PLAY_W, dy: 0 });
    expect(slideVector('R', 1)).toEqual({ dx: -PLAY_W, dy: 0 });
  });

  it('puts the incoming room exactly one screen away at the start', () => {
    // The arriving room is drawn at `progress − 1`, so it starts off-screen and lands on 0.
    expect(slideVector('U', 0 - 1)).toEqual({ dx: 0, dy: -PLAY_H });
    expect(slideVector('U', 1 - 1)).toEqual({ dx: 0, dy: 0 });
  });

  it('is a whole number of pixels at every step of the 24 ticks', () => {
    for (let tick = 0; tick <= 24; tick++) {
      const { dx, dy } = slideVector('L', tick / 24);
      expect(Number.isInteger(dx) && Number.isInteger(dy)).toBe(true);
    }
  });
});

describe('the title blink (04-ui §3.1)', () => {
  it('is on for thirty ticks and off for thirty', () => {
    expect(promptVisible(0)).toBe(true);
    expect(promptVisible(TITLE_BLINK_TICKS - 1)).toBe(true);
    expect(promptVisible(TITLE_BLINK_TICKS)).toBe(false);
    expect(promptVisible(2 * TITLE_BLINK_TICKS - 1)).toBe(false);
    expect(promptVisible(2 * TITLE_BLINK_TICKS)).toBe(true);
  });
});
