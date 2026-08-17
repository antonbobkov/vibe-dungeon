/**
 * Enemies — spec/02-entities.md §2.
 *
 * The model and the damage they take live here; their state machines join them in the same
 * file. Every enemy shares the movement, separation and line-of-sight rules of §2.1 and
 * differs only in the table of §2.2.
 */

import { diagAxis, moveAxisSeparated, type Box, type Vec } from './collision.js';
import {
  CHASE_DIAGONAL_DEADZONE,
  ENEMY_BOX_GROUND,
  ENEMY_BOX_WISP,
  ENEMY_DEATH_TICKS,
  ENEMY_HITSTUN,
  ENEMY_KNOCKBACK,
  ENEMY_STATS,
  RESISTANT_HITSTUN,
  RESISTANT_KNOCKBACK,
  SEPARATION_PUSH,
  SIN,
  SKEL_AXE_AGGRO_PX,
  SKEL_SWORD_AGGRO_PX,
  SKEL_SWORD_LUNGE_SPEED,
  SKEL_SWORD_LUNGE_TICKS,
  SKEL_SWORD_RECOVER_TICKS,
  SKEL_SWORD_WINDUP_RANGE_PX,
  SKEL_SWORD_WINDUP_TICKS,
  SUBPX,
  TILE_SUBPX,
  WISP_AGGRO_PX,
  WISP_WOBBLE_AMPLITUDE,
  WISP_WOBBLE_PERIOD,
  WISP_WOBBLE_SHIFT,
} from './constants.js';
import {
  boxRect,
  dirVelocity,
  distSq,
  losSegments,
  pxSq,
  rectCentre,
  rectsOverlap,
  reverse,
  rotateClockwise,
  snap8,
  type Dir8,
} from './geometry.js';
import type { EnemyType, PickupName } from './level.js';
import { TileClass, tileAt, type Room } from './room.js';

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

// ---------------------------------------------------------------------------
// Movement, sight and separation — 02 §2.1
// ---------------------------------------------------------------------------

/** An enemy's hitbox centre, which every distance and direction measures from. */
export function entityCentre(entity: SimEntity): Vec {
  return rectCentre(boxRect(boxOf(entity.kind), entity));
}

/** What each enemy needs to know about the world on the tick it acts. */
export interface EnemyContext {
  room: Room;
  /** The player's hitbox centre, in subpixels. */
  target: Vec;
  /** Ticks since room entry — the wisp's wobble runs off it (02 §2.4). */
  roomTimer: number;
}

/**
 * Chase steering (02 §2.1): diagonal only when both axes are outside an 8-subpixel
 * deadzone, otherwise full speed along the longer axis, with ties going horizontal.
 */
export function chaseVelocity(from: Vec, to: Vec, speed: number): Vec {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.abs(dx) > CHASE_DIAGONAL_DEADZONE && Math.abs(dy) > CHASE_DIAGONAL_DEADZONE) {
    const per = diagAxis(speed);
    return { x: Math.sign(dx) * per, y: Math.sign(dy) * per };
  }
  if (Math.abs(dx) >= Math.abs(dy)) return { x: Math.sign(dx) * speed, y: 0 };
  return { x: 0, y: Math.sign(dy) * speed };
}

/** Tiles that stop a sightline (02 §2.1). A pit is see-through; a crate is not. */
function blocksSight(cls: TileClass): boolean {
  return cls === TileClass.WALL || cls === TileClass.DOOR_CLOSED || cls === TileClass.PROP;
}

/**
 * Line of sight between two hitbox centres (02 §2.1). Both endpoints are sampled, so a
 * sightline that begins or ends inside geometry fails rather than passing by luck.
 */
export function hasLineOfSight(room: Room, a: Vec, b: Vec): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const segments = losSegments(dx * dx + dy * dy);

  for (let i = 0; i <= segments; i++) {
    const x = a.x + Math.floor((dx * i) / segments);
    const y = a.y + Math.floor((dy * i) / segments);
    const cls = tileAt(room, Math.floor(x / TILE_SUBPX), Math.floor(y / TILE_SUBPX));
    if (blocksSight(cls)) return false;
  }
  return true;
}

/** Move an enemy, colliding as its kind does, and keep it inside its room (02 §2.1). */
function moveEntity(entity: SimEntity, room: Room, vel: Vec): void {
  if (vel.x === 0 && vel.y === 0) return;

  const box = boxOf(entity.kind);
  const moved = moveAxisSeparated(
    room,
    box,
    { x: entity.x, y: entity.y },
    vel,
    moverOf(entity.kind),
  );

  // Enemies never leave their room, whatever a doorway might allow.
  const maxX = (room.w - 1) * TILE_SUBPX - box.offX * SUBPX;
  const maxY = (room.h - 1) * TILE_SUBPX - box.offY * SUBPX;
  entity.x = Math.max(-box.offX * SUBPX, Math.min(maxX, moved.x));
  entity.y = Math.max(-box.offY * SUBPX, Math.min(maxY, moved.y));
}

/**
 * Push overlapping enemies apart along the axis they overlap least, 4 subpixels each, in
 * ascending spawn-id pair order (02 §2.1).
 */
export function separateEnemies(entities: SimEntity[]): void {
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i]!;
      const b = entities[j]!;
      if (!isActive(a) || !isActive(b)) continue;

      const ra = boxRect(boxOf(a.kind), a);
      const rb = boxRect(boxOf(b.kind), b);
      if (!rectsOverlap(ra, rb)) continue;

      const overlapX = Math.min(ra.r, rb.r) - Math.max(ra.l, rb.l);
      const overlapY = Math.min(ra.b, rb.b) - Math.max(ra.t, rb.t);

      if (overlapX <= overlapY) {
        const push = rectCentre(ra).x <= rectCentre(rb).x ? SEPARATION_PUSH : -SEPARATION_PUSH;
        a.x -= push;
        b.x += push;
      } else {
        const push = rectCentre(ra).y <= rectCentre(rb).y ? SEPARATION_PUSH : -SEPARATION_PUSH;
        a.y -= push;
        b.y += push;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The state machines — 02 §2.2
// ---------------------------------------------------------------------------

/**
 * `stateTimer` counts the ticks *after* this one, so entering a state with `duration - 1`
 * makes the entering tick the first of them. When it reaches zero the successor acts on the
 * very next tick, which is what makes WINDUP exactly 24 ticks and LUNGE exactly 12.
 */
function enterState(entity: SimEntity, state: EnemyState, duration: number): void {
  entity.state = state;
  entity.stateTimer = duration - 1;
}

function withinPx(from: Vec, to: Vec, px: number): boolean {
  return distSq(from.x, from.y, to.x, to.y) <= pxSq(px);
}

/** Phase 4 of the tick (01 §1). Hitstun pauses everything but the knockback carrying it. */
export function updateEnemy(entity: SimEntity, ctx: EnemyContext): void {
  if (entity.state === EnemyState.DYING || entity.hitstun > 0) return;

  switch (entity.kind) {
    case 'skel_sword':
      updateSkelSword(entity, ctx);
      return;
    case 'skel_axe':
      updateSkelAxe(entity, ctx);
      return;
    case 'zombie':
      updateZombie(entity, ctx);
      return;
    case 'wisp':
      updateWisp(entity, ctx);
      return;
  }
}

/** IDLE → CHASE → WINDUP → LUNGE → RECOVER → CHASE (02 §2.2). */
function updateSkelSword(entity: SimEntity, ctx: EnemyContext): void {
  // Timed states hand over the moment their time is up, and the successor acts this tick.
  if (entity.stateTimer === 0) {
    if (entity.state === EnemyState.WINDUP) {
      enterState(entity, EnemyState.LUNGE, SKEL_SWORD_LUNGE_TICKS);
    } else if (entity.state === EnemyState.LUNGE) {
      enterState(entity, EnemyState.RECOVER, SKEL_SWORD_RECOVER_TICKS);
    } else if (entity.state === EnemyState.RECOVER) {
      entity.state = EnemyState.CHASE;
    }
  } else {
    entity.stateTimer--;
  }

  const here = entityCentre(entity);

  switch (entity.state) {
    case EnemyState.IDLE:
      // Sight and range, or a hit already taken (02 §2.2).
      if (
        entity.aggroed ||
        (withinPx(here, ctx.target, SKEL_SWORD_AGGRO_PX) &&
          hasLineOfSight(ctx.room, here, ctx.target))
      ) {
        entity.state = EnemyState.CHASE;
        entity.aggroed = true;
      }
      return;

    case EnemyState.CHASE:
      if (withinPx(here, ctx.target, SKEL_SWORD_WINDUP_RANGE_PX)) {
        // The direction is locked now and never re-aimed (02 §2.2).
        entity.lungeDir = snap8(ctx.target.x - here.x, ctx.target.y - here.y);
        enterState(entity, EnemyState.WINDUP, SKEL_SWORD_WINDUP_TICKS);
        return;
      }
      moveEntity(entity, ctx.room, chaseVelocity(here, ctx.target, ENEMY_STATS.skel_sword.speed));
      return;

    case EnemyState.LUNGE:
      if (entity.lungeDir !== null) {
        moveEntity(entity, ctx.room, dirVelocity(entity.lungeDir, SKEL_SWORD_LUNGE_SPEED));
      }
      return;

    default: // WINDUP and RECOVER both stand still
      return;
  }
}

/** Aggroes wide and never lets go; no line of sight needed either way (02 §2.2). */
function updateSkelAxe(entity: SimEntity, ctx: EnemyContext): void {
  const here = entityCentre(entity);

  if (entity.state === EnemyState.IDLE) {
    if (!entity.aggroed && !withinPx(here, ctx.target, SKEL_AXE_AGGRO_PX)) return;
    entity.state = EnemyState.CHASE;
    entity.aggroed = true;
    return;
  }

  moveEntity(entity, ctx.room, chaseVelocity(here, ctx.target, ENEMY_STATS.skel_axe.speed));
}

/** Always coming, from the moment the player is in the room (02 §2.2). */
function updateZombie(entity: SimEntity, ctx: EnemyContext): void {
  if (entity.state === EnemyState.IDLE) {
    entity.state = EnemyState.CHASE;
    entity.aggroed = true;
    return;
  }
  const here = entityCentre(entity);
  moveEntity(entity, ctx.room, chaseVelocity(here, ctx.target, ENEMY_STATS.zombie.speed));
}

/**
 * Chase plus a perpendicular wobble (02 §2.4).
 *
 * `(12 * SIN[…]) >> 6` is applied exactly as written: the shift floors toward −∞, so the
 * negative half of the wave is a subpixel stronger than the positive half. The table carries
 * its own sign, so unlike the diagonal factor there is no magnitude-then-sign reading here.
 */
function updateWisp(entity: SimEntity, ctx: EnemyContext): void {
  const here = entityCentre(entity);

  if (entity.state === EnemyState.IDLE) {
    if (
      !entity.aggroed &&
      !(withinPx(here, ctx.target, WISP_AGGRO_PX) && hasLineOfSight(ctx.room, here, ctx.target))
    ) {
      return;
    }
    entity.state = EnemyState.CHASE;
    entity.aggroed = true;
    return;
  }

  const chase = chaseVelocity(here, ctx.target, ENEMY_STATS.wisp.speed);
  const wobble = wispWobble(entity, ctx);
  moveEntity(entity, ctx.room, { x: chase.x + wobble.x, y: chase.y + wobble.y });
}

/** The wobble on its own, so tests can trace the table without running a whole room. */
export function wispWobble(entity: SimEntity, ctx: EnemyContext): Vec {
  const here = entityCentre(entity);
  const heading = snap8(ctx.target.x - here.x, ctx.target.y - here.y);
  if (heading === null) return { x: 0, y: 0 };

  const step = Math.floor(ctx.roomTimer / WISP_WOBBLE_PERIOD) % SIN.length;
  const speed = (WISP_WOBBLE_AMPLITUDE * SIN[step]!) >> WISP_WOBBLE_SHIFT;
  if (speed === 0) return { x: 0, y: 0 };

  const perpendicular = rotateClockwise(heading);
  return speed > 0
    ? dirVelocity(perpendicular, speed)
    : dirVelocity(reverse(perpendicular), -speed);
}
