/**
 * The player entity — 01-mechanics §3.3 (walking, facing), §4.1 (states).
 *
 * M1 implements NORMAL: walk, face, collide. The other states exist as numbered values with
 * their timers so the state hash (05 §4) is complete from the start; their transitions land
 * with combat in M3.
 */

import { moveAxisSeparated, diagAxis, type Vec } from './collision.js';
import { PLAYER_BOX, WALK_SPEED } from './constants.js';
import { moveAxes } from './input.js';
import type { Room } from './room.js';

/** 00-overview §Coordinate conventions direction order. Values are part of the state hash. */
export enum Facing {
  U = 0,
  D = 1,
  L = 2,
  R = 3,
}

/** 01 §4.1 table order. Values are part of the state hash. */
export enum PlayerState {
  NORMAL = 0,
  SWING = 1,
  HURT = 2,
  DYING = 3,
  SCRIPTED = 4,
}

export interface Player {
  /** Sprite-cell top-left, in subpixels. */
  x: number;
  y: number;
  hp: number;
  facing: Facing;
  state: PlayerState;
  stateTimer: number;
  iframeTimer: number;
  invulnTimer: number;
  knockVx: number;
  knockVy: number;
}

export function createPlayer(x: number, y: number, hp: number, facing = Facing.D): Player {
  return {
    x,
    y,
    hp,
    facing,
    state: PlayerState.NORMAL,
    stateTimer: 0,
    iframeTimer: 0,
    invulnTimer: 0,
    knockVx: 0,
    knockVy: 0,
  };
}

/**
 * Facing follows input, not motion: a horizontal component wins; otherwise a vertical one;
 * with no input facing is unchanged (01 §3.3). "Component" means the *net* axis, so LEFT and
 * RIGHT held together leave facing alone.
 */
function facingFrom(dx: number, dy: number, current: Facing): Facing {
  if (dx > 0) return Facing.R;
  if (dx < 0) return Facing.L;
  if (dy > 0) return Facing.D;
  if (dy < 0) return Facing.U;
  return current;
}

/** Walk velocity: full speed on one axis, the 181/256 factor on both when moving diagonally. */
export function walkVelocity(dx: number, dy: number): Vec {
  if (dx !== 0 && dy !== 0) {
    const v = diagAxis(WALK_SPEED);
    return { x: dx * v, y: dy * v };
  }
  return { x: dx * WALK_SPEED, y: dy * WALK_SPEED };
}

/** Phase 3 of the tick (01 §1): player state machine, then movement + collision. */
export function updatePlayer(player: Player, room: Room, input: number): void {
  if (player.state !== PlayerState.NORMAL) {
    // SWING / HURT / DYING / SCRIPTED movement rules arrive with M3–M4 (01 §4.1).
    return;
  }

  const { dx, dy } = moveAxes(input);
  player.facing = facingFrom(dx, dy, player.facing);

  // No acceleration, no friction: movement stops the tick input is released (01 §3.3).
  const vel = walkVelocity(dx, dy);
  if (vel.x === 0 && vel.y === 0) return;

  const moved = moveAxisSeparated(room, PLAYER_BOX, { x: player.x, y: player.y }, vel, 'ground');
  player.x = moved.x;
  player.y = moved.y;
}
