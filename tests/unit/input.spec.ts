import { describe, expect, it } from 'vitest';

import {
  ATTACK,
  DOWN,
  INPUT_MASK,
  INTERACT,
  LEFT,
  RIGHT,
  UP,
  moveAxes,
  pressed,
} from '../../src/sim/input.js';

// 01-mechanics §2.
describe('input bitmask', () => {
  it('assigns the documented bit to each action', () => {
    expect([UP, DOWN, LEFT, RIGHT, ATTACK, INTERACT]).toEqual([1, 2, 4, 8, 16, 32]);
    expect(INPUT_MASK).toBe(0b111111);
  });

  it('reads one axis value per direction', () => {
    expect(moveAxes(RIGHT)).toEqual({ dx: 1, dy: 0 });
    expect(moveAxes(LEFT)).toEqual({ dx: -1, dy: 0 });
    expect(moveAxes(UP)).toEqual({ dx: 0, dy: -1 });
    expect(moveAxes(DOWN)).toEqual({ dx: 0, dy: 1 });
    expect(moveAxes(UP | RIGHT)).toEqual({ dx: 1, dy: -1 });
  });

  it('cancels opposing directions held together', () => {
    expect(moveAxes(LEFT | RIGHT)).toEqual({ dx: 0, dy: 0 });
    expect(moveAxes(UP | DOWN)).toEqual({ dx: 0, dy: 0 });
    // A cancelled axis leaves the other one alone.
    expect(moveAxes(LEFT | RIGHT | UP)).toEqual({ dx: 0, dy: -1 });
  });

  it('ignores bits outside the mask', () => {
    expect(moveAxes(0xff & ~INPUT_MASK)).toEqual({ dx: 0, dy: 0 });
  });

  it('edge-triggers ATTACK and INTERACT on press', () => {
    expect(pressed(ATTACK, 0, ATTACK)).toBe(true);
    expect(pressed(ATTACK, ATTACK, ATTACK)).toBe(false); // held, not pressed
    expect(pressed(0, ATTACK, ATTACK)).toBe(false); // released
    expect(pressed(ATTACK | INTERACT, ATTACK, INTERACT)).toBe(true);
  });
});
