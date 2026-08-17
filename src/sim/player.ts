/**
 * The player entity — 01-mechanics §3.3 (walking, facing), §4.1 (states), §5.2 (knockback).
 *
 * DYING and SCRIPTED are driven by the sim, which owns the sequences they belong to (01 §6,
 * §8.2); NORMAL, SWING and HURT are driven here.
 */

import { moveAxisSeparated, diagAxis, type Vec } from './collision.js';
import {
  HURT_INPUT_LOCK,
  HURT_TICKS,
  PLAYER_BOX,
  PLAYER_KNOCKBACK_DECAY,
  SWING_LOCKED_UNTIL,
  SWING_TICKS,
  WALK_SPEED,
} from './constants.js';
import { dirVelocity, type Dir8 } from './geometry.js';
import { ATTACK, moveAxes, pressed } from './input.js';
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
  /** Derived from the knockback below each tick, and hashed as such (05 §4). */
  knockVx: number;
  knockVy: number;
  /** Knockback as magnitude + direction, so a diagonal keeps its line as it decays (01 §5.2). */
  knockMag: number;
  knockDir: Dir8 | null;
  /** Ids of the enemies this swing has already hit — each target at most once (01 §4.2). */
  swingHits: number[];
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
    knockMag: 0,
    knockDir: null,
    swingHits: [],
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

/**
 * Whether input moves the player this tick (01 §4.1): free in NORMAL, locked for the first
 * ten ticks of a swing, and ignored for the first six of HURT.
 */
export function acceptsInput(player: Player): boolean {
  switch (player.state) {
    case PlayerState.NORMAL:
      return true;
    case PlayerState.SWING:
      return SWING_TICKS - player.stateTimer > SWING_LOCKED_UNTIL;
    case PlayerState.HURT:
      return HURT_TICKS - player.stateTimer >= HURT_INPUT_LOCK;
    default:
      return false;
  }
}

/** Phase 3 of the tick (01 §1): player state machine, then movement + collision. */
export function updatePlayer(player: Player, room: Room, input: number, prevInput: number): void {
  if (player.iframeTimer > 0) player.iframeTimer--;
  if (player.invulnTimer > 0) player.invulnTimer--;

  // Timers advance first, so `stateTimer` reads the same in every later phase of this tick:
  // `SWING_TICKS - stateTimer` is the swing tick 01 §4.1–4.2 number their windows by, and it
  // is 0 on the tick ATTACK was pressed. Ending a swing here is also what lets ATTACK
  // re-trigger on tick 14 exactly, as §4.1 says it may.
  if (player.state === PlayerState.SWING || player.state === PlayerState.HURT) {
    player.stateTimer--;
    if (player.stateTimer <= 0) {
      player.state = PlayerState.NORMAL;
      player.stateTimer = 0;
    }
  }

  // A swing starts on the press and cannot be cancelled (01 §4.2).
  if (player.state === PlayerState.NORMAL && pressed(input, prevInput, ATTACK)) {
    player.state = PlayerState.SWING;
    player.stateTimer = SWING_TICKS;
    player.swingHits.length = 0;
  }

  const listening = acceptsInput(player);
  const { dx, dy } = listening ? moveAxes(input) : { dx: 0, dy: 0 };
  if (listening) player.facing = facingFrom(dx, dy, player.facing);

  // 01 §5.2: knockback replaces walk velocity while nonzero, and collides normally.
  const knocked = player.knockMag > 0 && player.knockDir !== null;
  const vel = knocked
    ? dirVelocity(player.knockDir!, player.knockMag)
    : // No acceleration, no friction: movement stops the tick input is released (01 §3.3).
      walkVelocity(dx, dy);

  player.knockVx = knocked ? vel.x : 0;
  player.knockVy = knocked ? vel.y : 0;

  if (vel.x !== 0 || vel.y !== 0) {
    const moved = moveAxisSeparated(room, PLAYER_BOX, { x: player.x, y: player.y }, vel, 'ground');
    player.x = moved.x;
    player.y = moved.y;
  }

  if (knocked) {
    player.knockMag = Math.max(0, player.knockMag - PLAYER_KNOCKBACK_DECAY);
    if (player.knockMag === 0) player.knockDir = null;
  }
}
