/**
 * Input bitmask — 01-mechanics §2.
 *
 * One byte per tick, from the keyboard or from a replay; the sim never knows which.
 * Pause is deliberately absent: it halts the loop and is not recorded (01 §2, §10).
 */

export const UP = 1 << 0;
export const DOWN = 1 << 1;
export const LEFT = 1 << 2;
export const RIGHT = 1 << 3;
export const ATTACK = 1 << 4;
export const INTERACT = 1 << 5;

/** Every bit the sim reads; a replay byte outside this mask is malformed. */
export const INPUT_MASK = UP | DOWN | LEFT | RIGHT | ATTACK | INTERACT;

export interface Axes {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
}

/** Direction input as −1/0/+1 per axis. Opposing directions held together cancel (01 §2). */
export function moveAxes(input: number): Axes {
  const left = (input & LEFT) !== 0 ? 1 : 0;
  const right = (input & RIGHT) !== 0 ? 1 : 0;
  const up = (input & UP) !== 0 ? 1 : 0;
  const down = (input & DOWN) !== 0 ? 1 : 0;
  return { dx: (right - left) as Axes['dx'], dy: (down - up) as Axes['dy'] };
}

/** ATTACK and INTERACT act on press: set this tick, clear the previous tick (01 §2). */
export function pressed(input: number, prevInput: number, bit: number): boolean {
  return (input & bit) !== 0 && (prevInput & bit) === 0;
}
