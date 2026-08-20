/**
 * Transient visuals — the three flourishes 02-entities specifies that outlive the sim state
 * that caused them, which is why they need a list of their own rather than a look at the
 * room:
 *
 * - a chest's contents floating up as they are granted (§4.1) — the chest is `OPEN` with a
 *   zeroed timer by then;
 * - a pushed crate settling into the pit that swallowed it (§4.2) — the sim has already
 *   deleted the prop and bridged the tile;
 * - a puff on each torch of a windowed group that timed out (§4.3) — the props are back to
 *   `IDLE` the moment it happens;
 * - the chains of an event-locked door breaking off as it opens (01 §8.3) — by the time the
 *   effect runs the door is `DOOR_OPEN` and nothing draws a shackle on it any more.
 *
 * Spawning is a pure function of a `GameEvent`, so the timing tables below are testable; the
 * list itself is advanced one tick at a time by the shell.
 */

import type { GameEvent } from '../game/events.js';
import type { Cell, PickupName } from '../sim/level.js';

/** 02 §4.1: each icon rises 8 px over 30 ticks, in list order, 10 ticks apart. */
export const FLOAT_TICKS = 30;
export const FLOAT_RISE_PX = 8;
export const FLOAT_STAGGER = 10;
/** 02 §4.2: the crate drops 4 px and darkens over 10 ticks. */
export const PIT_DROP_TICKS = 10;
export const PIT_DROP_PX = 4;
/** 02 §4.3: a small smoke puff, 6 ticks. */
export const PUFF_TICKS = 6;
/** 01 §8.3: a broken chain falls away exactly as a swallowed crate does — 4 px over 10 ticks. */
export const UNSHACKLE_TICKS = PIT_DROP_TICKS;
export const UNSHACKLE_DROP_PX = PIT_DROP_PX;

export type EffectKind = 'float' | 'pit_drop' | 'puff' | 'unshackle';

export interface Effect {
  kind: EffectKind;
  at: Cell;
  /** Ticks since the effect began; negative while it is still waiting its turn. */
  elapsed: number;
  total: number;
  /** `float` only: which pickup icon is rising. */
  pickup?: PickupName;
}

/** The effects one event starts. Everything else in the game makes none. */
export function effectsFor(event: GameEvent): Effect[] {
  switch (event.name) {
    case 'chest':
      return (event.contents ?? []).map((pickup, index) => ({
        kind: 'float' as const,
        at: event.at ?? [0, 0],
        elapsed: 0 - index * FLOAT_STAGGER,
        total: FLOAT_TICKS,
        pickup,
      }));

    case 'crate':
      if (!event.pit) return [];
      return [{ kind: 'pit_drop', at: event.at ?? [0, 0], elapsed: 0, total: PIT_DROP_TICKS }];

    case 'torch_reset':
      return (event.cells ?? []).map((at) => ({
        kind: 'puff' as const,
        at,
        elapsed: 0,
        total: PUFF_TICKS,
      }));

    case 'unshackle':
      // 01 §8.3: every chain the door was wearing drops away, each with a puff where it hung.
      return (event.cells ?? []).flatMap((at) => [
        { kind: 'unshackle' as const, at, elapsed: 0, total: UNSHACKLE_TICKS },
        { kind: 'puff' as const, at, elapsed: 0, total: PUFF_TICKS },
      ]);

    default:
      return [];
  }
}

/** Whether an effect has run its course and should be dropped. */
export const expired = (effect: Effect): boolean => effect.elapsed >= effect.total;

/** The live list, advanced by the shell one tick at a time. */
export class Effects {
  private effects: Effect[] = [];

  get live(): readonly Effect[] {
    return this.effects;
  }

  spawn(events: readonly GameEvent[]): void {
    for (const event of events) this.effects.push(...effectsFor(event));
  }

  advance(): void {
    for (const effect of this.effects) effect.elapsed++;
    this.effects = this.effects.filter((effect) => !expired(effect));
  }

  /** A new run, a new floor, a new room: nothing carries over. */
  clear(): void {
    this.effects = [];
  }
}
