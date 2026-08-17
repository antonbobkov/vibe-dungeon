/**
 * The sword and the damage rules — spec/01-mechanics.md §4.2 and §5.
 *
 * Hit detection happens in phase 7 of the tick (01 §1's "damage application"), after both the
 * player and the enemies have moved, so a swing lands against where things actually are.
 */

import { PLAYER_BOX, SUBPX, SWING_TICKS, SWORD_REACH_PX, TILE_SUBPX } from './constants.js';
import {
  IFRAME_TICKS,
  HURT_TICKS,
  PLAYER_KNOCKBACK,
  SWING_ACTIVE_FIRST,
  SWING_ACTIVE_LAST,
} from './constants.js';
import { Dir8, boxRect, rectCentre, snap8, type Rect } from './geometry.js';
import { Facing, PlayerState, type Player } from './player.js';

/** How far the sword box is displaced from the sprite cell, per facing (01 §4.2). */
const REACH = SWORD_REACH_PX * SUBPX;

/** Which way the player is looking, as a compass direction. */
export function facingDir(facing: Facing): Dir8 {
  switch (facing) {
    case Facing.U:
      return Dir8.U;
    case Facing.D:
      return Dir8.D;
    case Facing.L:
      return Dir8.L;
    case Facing.R:
      return Dir8.R;
  }
}

/**
 * The sword's 16 × 16 box: the player's sprite cell, shifted 14 px toward the facing
 * (01 §4.2). It overlaps the player's own cell by 2 px, which is what lets a swing connect
 * with something already touching them.
 */
export function swordRect(player: Player): Rect {
  let x = player.x;
  let y = player.y;
  switch (player.facing) {
    case Facing.U:
      y -= REACH;
      break;
    case Facing.D:
      y += REACH;
      break;
    case Facing.L:
      x -= REACH;
      break;
    case Facing.R:
      x += REACH;
      break;
  }
  return { l: x, t: y, r: x + TILE_SUBPX, b: y + TILE_SUBPX };
}

/** Ticks since the swing began: 0 on the tick ATTACK was pressed, 13 on its last (01 §4.1). */
export function swingElapsed(player: Player): number {
  return SWING_TICKS - player.stateTimer;
}

/** The blade only bites on ticks 3–9 of the swing (01 §4.2). */
export function isSwingActive(player: Player): boolean {
  if (player.state !== PlayerState.SWING) return false;
  const elapsed = swingElapsed(player);
  return elapsed >= SWING_ACTIVE_FIRST && elapsed <= SWING_ACTIVE_LAST;
}

/** i-frames and the blue flask both make the player untouchable (01 §5.1, §7). */
export function isInvulnerable(player: Player): boolean {
  return player.iframeTimer > 0 || player.invulnTimer > 0;
}

/** The player's hitbox centre — what every distance and direction in combat measures from. */
export function playerCentre(player: Player): { x: number; y: number } {
  return rectCentre(boxRect(PLAYER_BOX, player));
}

/**
 * Hurt the player (01 §5.1–5.2): HP down, 60 ticks of i-frames, HURT for 12, and knockback
 * away from the source. Returns false when the hit was refused, so callers know whether to
 * fire hit-stop.
 *
 * `sourceCentre` is the damage source's centre; if it coincides with the player's, 01 §5.2
 * sends them opposite their facing rather than nowhere.
 */
export function damagePlayer(
  player: Player,
  amount: number,
  sourceCentre: { x: number; y: number },
): boolean {
  if (isInvulnerable(player) || player.state === PlayerState.DYING) return false;

  player.hp -= amount;
  player.iframeTimer = IFRAME_TICKS;
  player.state = PlayerState.HURT;
  player.stateTimer = HURT_TICKS;

  const centre = playerCentre(player);
  const away = snap8(centre.x - sourceCentre.x, centre.y - sourceCentre.y);
  player.knockDir = away ?? opposite(facingDir(player.facing));
  player.knockMag = PLAYER_KNOCKBACK;

  return true;
}

/** The compass direction opposite `dir`. */
export function opposite(dir: Dir8): Dir8 {
  return ((dir + 4) % 8) as Dir8;
}
