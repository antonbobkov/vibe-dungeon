/**
 * Enemies — spec/02-entities.md §2.
 *
 * The model and the damage they take live here; their state machines join them in the same
 * file. Every enemy shares the movement, separation and line-of-sight rules of §2.1 and
 * differs only in the table of §2.2.
 */

import type { Box } from './collision.js';
import {
  ENEMY_BOX_GROUND,
  ENEMY_BOX_WISP,
  ENEMY_DEATH_TICKS,
  ENEMY_HITSTUN,
  ENEMY_KNOCKBACK,
  ENEMY_STATS,
  RESISTANT_HITSTUN,
  RESISTANT_KNOCKBACK,
} from './constants.js';
import type { Dir8 } from './geometry.js';
import type { EnemyType, PickupName } from './level.js';

/** Enemy type ids, fixed for the state hash (05 §4). Order follows 02 §2.2. */
export const ENEMY_TYPE_ID: Readonly<Record<EnemyType, number>> = {
  skel_sword: 0,
  skel_axe: 1,
  zombie: 2,
  wisp: 3,
};

/** 02 §2.2's states, in table order. Values are part of the state hash. */
export enum EnemyState {
  IDLE = 0,
  CHASE = 1,
  WINDUP = 2,
  LUNGE = 3,
  RECOVER = 4,
  DYING = 5,
}

export interface SimEntity {
  /** Spawn id: the room's document order, which 01 §1 and 05 §4 both iterate in. */
  id: number;
  kind: EnemyType;
  /** Sprite-cell top-left, in subpixels. */
  x: number;
  y: number;
  hp: number;
  state: EnemyState;
  stateTimer: number;
  /** Ticks of hitstun left; the state timer is paused while this runs (02 §2.2). */
  hitstun: number;
  /** Knockback as a magnitude along a direction, so a diagonal keeps its line (01 §5.2). */
  knockMag: number;
  knockDir: Dir8 | null;
  /** Aggro, once gained, is never lost (02 §2.2 has no CHASE→IDLE row). */
  aggroed: boolean;
  /** The direction a skel_sword locked in at the start of its windup. */
  lungeDir: Dir8 | null;
  drop: PickupName | null;
}

/** The wisp flies; everything else walks (01 §3.1's three solidity columns). */
export function moverOf(kind: EnemyType): 'ground' | 'fly' {
  return kind === 'wisp' ? 'fly' : 'ground';
}

export function boxOf(kind: EnemyType): Box {
  return kind === 'wisp' ? ENEMY_BOX_WISP : ENEMY_BOX_GROUND;
}

/** skel_axe and the zombie shrug most of a hit off (02 §2.2). */
export function isKnockbackResistant(kind: EnemyType): boolean {
  return kind === 'skel_axe' || kind === 'zombie';
}

/** A DYING enemy neither collides nor damages (02 §2.1). */
export function isActive(entity: SimEntity): boolean {
  return entity.state !== EnemyState.DYING;
}

export function createEntity(
  id: number,
  kind: EnemyType,
  x: number,
  y: number,
  drop: PickupName | null,
): SimEntity {
  return {
    id,
    kind,
    x,
    y,
    hp: ENEMY_STATS[kind].hp,
    // 01 §9: enemies come back at their map positions, full HP, IDLE.
    state: EnemyState.IDLE,
    stateTimer: 0,
    hitstun: 0,
    knockMag: 0,
    knockDir: null,
    aggroed: false,
    lungeDir: null,
    drop,
  };
}

/**
 * Apply a hit (01 §4.2, 02 §2.1–2.2). The enemy is knocked back along `from`, stunned, and
 * aggroed if it was not already. The wisp dies to any hit, so it never needs either.
 */
export function damageEnemy(entity: SimEntity, amount: number, from: Dir8 | null): void {
  if (!isActive(entity)) return;

  entity.hp -= amount;
  entity.aggroed = true;

  if (entity.hp <= 0) {
    entity.state = EnemyState.DYING;
    entity.stateTimer = ENEMY_DEATH_TICKS;
    entity.hitstun = 0;
    entity.knockMag = 0;
    entity.knockDir = null;
    return;
  }

  const resistant = isKnockbackResistant(entity.kind);
  entity.knockMag = resistant ? RESISTANT_KNOCKBACK : ENEMY_KNOCKBACK;
  entity.knockDir = from;
  entity.hitstun = resistant ? RESISTANT_HITSTUN : ENEMY_HITSTUN;
}
