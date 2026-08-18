/**
 * What to draw for each thing in a room — the pure half of the renderer.
 *
 * Every function here turns sim state into a `SpriteDraw`: which manifest entry, which frame,
 * flipped or not, tinted or not, nudged by how many pixels. No canvas, no clock of its own,
 * so the whole of 02-entities §1.1 and §2.1's "animation & motion polish" can be pinned by
 * exact ticks in a unit test.
 */

import { anim } from '../assets/packA.js';
import {
  CHEST_OPEN_TICKS,
  CRATE_DESTROY_TICKS,
  DYING_TICKS,
  ENEMY_DEATH_FADE,
  ENEMY_DEATH_FLASH,
  ENEMY_DEATH_TICKS,
  ENEMY_HITSTUN,
  IFRAME_TICKS,
  RESISTANT_HITSTUN,
  SKEL_SWORD_WINDUP_TICKS,
  SPAWN_BLINK_TICKS,
  SWING_ACTIVE_FIRST,
  SWING_ACTIVE_LAST,
  SWING_TICKS,
} from '../sim/constants.js';
import { EnemyState, isKnockbackResistant, type SimEntity } from '../sim/enemy.js';
import { DOWN, LEFT, RIGHT, UP } from '../sim/input.js';
import type { EnemyType, LoadedTrap, PickupName } from '../sim/level.js';
import { Facing, PlayerState, type Player } from '../sim/player.js';
import { PropState, type SimProp } from '../sim/prop.js';
import {
  launcherFrame,
  windowFrame,
  IDLE_FRAME_TICKS,
  MOVING_FRAME_TICKS,
  frameIndex,
} from './anim.js';

/** Palette swaps the loader pre-bakes for every sprite (02 §1.3, 01 §7). */
export type Tint = 'none' | 'white' | 'blue';

export interface SpriteDraw {
  /** A manifest animation id, or a static tile id when the art does not move. */
  anim?: string;
  tile?: string;
  frame: number;
  flipX: boolean;
  tint: Tint;
  /** Whole-pixel nudge from the sprite cell: walk bob, lunge, windup shake, death drift. */
  dx: number;
  dy: number;
  /** 0…1, for the two fade-outs (player death, enemy death). */
  alpha: number;
  /** False on the off half of a blink — i-frames, and a wave enemy blinking in. */
  visible: boolean;
}

const base = (partial: Partial<SpriteDraw> & Pick<SpriteDraw, 'frame'>): SpriteDraw => ({
  flipX: false,
  tint: 'none',
  dx: 0,
  dy: 0,
  alpha: 1,
  visible: true,
  ...partial,
});

const DIRECTIONS = UP | DOWN | LEFT | RIGHT;

/** 01 §6: the fade is the last 40 of the 60 dying ticks. */
export const DEATH_FADE_TICKS = 40;
/** 02 §1.3 / §2.1: damage paints every opaque pixel white for two ticks. */
export const FLASH_TICKS = 2;
/** 01 §5.1: the i-frame blink is 3 ticks on, 3 off. */
export const BLINK_TICKS = 3;
/** 02 §2.2: the windup shake is ±1 px, changing every 2 ticks. */
export const WINDUP_SHAKE_TICKS = 2;
/** 01 §4.2's lunge: 2 px toward the facing across the swing's active window. */
export const LUNGE_PX = 2;

/** 02 §1.1: −1 px on ticks 4–7 of each 8-tick bob cycle, while moving. */
export function walkBob(tick: number, moving: boolean): number {
  return moving && tick % 8 >= 4 ? -1 : 0;
}

/** A blink that is on for `on` ticks and off for the same, counted from the start. */
const blinkOn = (elapsed: number, on: number): boolean => Math.floor(elapsed / on) % 2 === 0;

const lunge = (facing: Facing): { dx: number; dy: number } => ({
  dx: facing === Facing.L ? -LUNGE_PX : facing === Facing.R ? LUNGE_PX : 0,
  dy: facing === Facing.U ? -LUNGE_PX : facing === Facing.D ? LUNGE_PX : 0,
});

export interface PlayerView {
  player: Player;
  /** The input latch this tick, for "is walking" (the sim's own `input` field). */
  input: number;
  /** Play ticks, which every loop in the game runs off. */
  tick: number;
}

/**
 * The player (02 §1.1, 01 §4.2 §5.1 §6): idle loop, faster while walking, with the bob, the
 * left-flip, the swing lunge, the damage flash, the i-frame blink, the blue-flask tint and
 * the dying flip-and-fade.
 */
export function playerSprite({ player, input, tick }: PlayerView): SpriteDraw {
  const def = anim('player_idle');
  const moving = player.state === PlayerState.NORMAL && (input & DIRECTIONS) !== 0;
  const rate = moving ? MOVING_FRAME_TICKS : IDLE_FRAME_TICKS;

  const draw = base({
    anim: def.id,
    frame: frameIndex(def, tick, rate),
    flipX: player.facing === Facing.L,
    dy: walkBob(tick, moving),
  });

  if (player.state === PlayerState.SWING) {
    const elapsed = SWING_TICKS - player.stateTimer;
    if (elapsed >= SWING_ACTIVE_FIRST && elapsed <= SWING_ACTIVE_LAST) {
      const { dx, dy } = lunge(player.facing);
      draw.dx += dx;
      draw.dy += dy;
    }
  }

  if (player.state === PlayerState.DYING) {
    // 01 §6: flip every 4 ticks, fading out over the last 40.
    const elapsed = DYING_TICKS - player.stateTimer;
    draw.flipX = draw.flipX !== (Math.floor(elapsed / 4) % 2 === 1);
    draw.alpha = player.stateTimer < DEATH_FADE_TICKS ? player.stateTimer / DEATH_FADE_TICKS : 1;
    return draw;
  }

  if (player.iframeTimer > 0) {
    const elapsed = IFRAME_TICKS - player.iframeTimer;
    if (elapsed < FLASH_TICKS) draw.tint = 'white';
    else if (player.invulnTimer > 0) draw.tint = 'blue';
    draw.visible = blinkOn(elapsed, BLINK_TICKS);
  } else if (player.invulnTimer > 0) {
    draw.tint = 'blue';
  }

  return draw;
}

const ENEMY_ANIM: Readonly<Record<EnemyType, string>> = {
  skel_sword: 'skel_sword_idle',
  skel_axe: 'skel_axe_idle',
  zombie: 'zombie_idle',
  wisp: 'wisp_idle',
};

/**
 * An enemy (02 §2.1–2.2): the shared idle loop with the same walk bob, flipped toward its
 * target, shaking through a windup, flashing white when hit, and flashing-then-fading-and-
 * drifting on death.
 */
export function enemySprite(entity: SimEntity, targetX: number, tick: number): SpriteDraw {
  const def = anim(ENEMY_ANIM[entity.kind]);
  const moving = entity.state === EnemyState.CHASE || entity.state === EnemyState.LUNGE;

  const draw = base({
    anim: def.id,
    frame: frameIndex(def, tick, moving ? MOVING_FRAME_TICKS : IDLE_FRAME_TICKS),
    flipX: targetX < entity.x,
    dy: walkBob(tick, moving),
  });

  if (entity.state === EnemyState.SPAWNING) {
    const elapsed = SPAWN_BLINK_TICKS - entity.stateTimer;
    draw.visible = blinkOn(elapsed, BLINK_TICKS);
    return draw;
  }

  if (entity.state === EnemyState.DYING) {
    const elapsed = ENEMY_DEATH_TICKS - entity.stateTimer;
    if (elapsed < ENEMY_DEATH_FLASH) {
      draw.tint = 'white';
      return draw;
    }
    const fading = elapsed - ENEMY_DEATH_FLASH;
    draw.alpha = Math.max(0, 1 - fading / ENEMY_DEATH_FADE);
    draw.dy -= Math.round((2 * fading) / ENEMY_DEATH_FADE); // 2 px of upward drift
    return draw;
  }

  const stunTicks = isKnockbackResistant(entity.kind) ? RESISTANT_HITSTUN : ENEMY_HITSTUN;
  if (entity.hitstun > stunTicks - FLASH_TICKS) draw.tint = 'white';

  if (entity.state === EnemyState.WINDUP) {
    const elapsed = SKEL_SWORD_WINDUP_TICKS - entity.stateTimer;
    draw.dx += Math.floor(elapsed / WINDUP_SHAKE_TICKS) % 2 === 0 ? 1 : -1;
  }

  return draw;
}

/** Wave telegraphs are the interface cursor looping on the spawn tile (02 §2.3). */
export function telegraphSprite(ticksLeft: number, telegraphTicks: number): SpriteDraw {
  const def = anim('spawn_cursor');
  return base({ anim: def.id, frame: frameIndex(def, telegraphTicks - ticksLeft) });
}

const PICKUP_ANIM: Readonly<Record<PickupName, string>> = {
  coin: 'coin_spin',
  silver_key: 'key_silver_spin',
  gold_key: 'key_gold_spin',
  red_small: 'flask_red_small',
  red_large: 'flask_red_large',
  blue_small: 'flask_blue_small',
  blue_large: 'flask_blue_large',
};

/** Every pickup shimmers on a 4-frame loop (02 §5). */
export function pickupSprite(kind: PickupName, tick: number): SpriteDraw {
  const def = anim(PICKUP_ANIM[kind]);
  return base({ anim: def.id, frame: frameIndex(def, tick) });
}

/**
 * A prop (02 §4). Chests idle and then open on a one-shot that holds its last frame; crates
 * are static art until the sword starts them coming apart; a torch swaps its unlit tile for
 * the lit candlestick loop.
 */
export function propSprite(prop: SimProp, tick: number): SpriteDraw | null {
  switch (prop.kind) {
    case 'chest':
    case 'mini_chest': {
      const prefix = prop.kind === 'chest' ? 'chest' : 'mini_chest';
      if (prop.state === PropState.IDLE) {
        const def = anim(`${prefix}_idle`);
        return base({ anim: def.id, frame: frameIndex(def, tick) });
      }
      const def = anim(`${prefix}_open`);
      const elapsed =
        prop.state === PropState.OPEN ? CHEST_OPEN_TICKS : CHEST_OPEN_TICKS - prop.timer;
      return base({ anim: def.id, frame: frameIndex(def, elapsed) });
    }

    case 'crate_wood':
    case 'crate_steel': {
      if (prop.state !== PropState.DESTROYING) return base({ tile: prop.kind, frame: 0 });
      const def = anim(`${prop.kind}_destroy`);
      return base({ anim: def.id, frame: frameIndex(def, CRATE_DESTROY_TICKS - prop.timer) });
    }

    case 'crate_push':
      return base({ tile: 'crate_push', frame: 0 });

    case 'torch': {
      if (prop.state !== PropState.LIT) return base({ tile: 'candlestick_a_unlit', frame: 0 });
      const def = anim('candlestick_a_lit');
      return base({ anim: def.id, frame: frameIndex(def, tick) });
    }
  }
}

/**
 * A trap's art (02 §3, AG §3.5). Spikes and flame jets wind up through the 12-tick telegraph
 * and hold at full through the deadly window; a launcher plays its shot and returns to idle.
 * `dx`/`dy` are the whole-tile offsets of the oversized frames: a flame or a launcher covers
 * its own cell and the one it fires into.
 */
export function trapSprite(trap: LoadedTrap, phase: number): SpriteDraw {
  switch (trap.kind) {
    case 'spike':
      return base({ anim: 'spike', frame: windowFrame(phase, trap.period, trap.alwaysOn) });
    case 'arrow':
      return base({ anim: 'arrow_launcher', frame: launcherFrame(phase) });
    case 'flame_down':
      return base({ anim: 'flame_down', frame: windowFrame(phase, trap.period, trap.alwaysOn) });
    case 'flame_right':
      return base({ anim: 'flame_side', frame: windowFrame(phase, trap.period, trap.alwaysOn) });
    case 'flame_left':
      // The art fires right, so a left-firing jet is flipped and reaches back one tile.
      return base({
        anim: 'flame_side',
        frame: windowFrame(phase, trap.period, trap.alwaysOn),
        flipX: true,
        dx: -16,
      });
  }
}
