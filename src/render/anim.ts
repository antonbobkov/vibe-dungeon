/**
 * Animation sequencing — which frame of a manifest animation is on screen.
 *
 * Pure arithmetic over `AnimDef` and a tick count, with no canvas and no state of its own:
 * every animation in the game is a function of sim state (`playTick`, `roomTimer`, an
 * entity's `stateTimer`, a trap's phase), which is what makes a paused frame freeze and a
 * golden screenshot reproducible.
 *
 * The numbers here are renderer-only (02-entities §1.1, §3 and AG §3.5); gameplay constants
 * stay in `src/sim/constants.ts`.
 */

import type { AnimDef } from '../assets/packA.js';
import { TRAP_DEADLY_DEN, TRAP_DEADLY_NUM } from '../sim/constants.js';

/** Idle loops run at 8 ticks/frame, and the same loop at 5 while moving (02 §1.1, §2.1). */
export const IDLE_FRAME_TICKS = 8;
export const MOVING_FRAME_TICKS = 5;

/** A trap tells the player it is about to fire for the 12 ticks before its window (02 §3). */
export const TELEGRAPH_TICKS = 12;

/**
 * The frame showing `ticks` after an animation began, with an optional rate override — the
 * walk cycle is the idle loop played faster, not a second animation (02 §1.1).
 *
 * Looping animations wrap; the rest clamp to their last frame. Whether holding that frame is
 * the point (a chest stays open) or whether the caller should have stopped drawing (a crate
 * has finished coming apart) is `AnimDef.hold`, and `finished` answers it.
 */
export function frameIndex(def: AnimDef, ticks: number, rate = def.frameTicks): number {
  const step = Math.floor(Math.max(0, ticks) / Math.max(1, rate));
  if (def.loop) return step % def.frames.length;
  return Math.min(step, def.frames.length - 1);
}

/** Whether a non-looping animation has run out. A looping one never does. */
export function finished(def: AnimDef, ticks: number, rate = def.frameTicks): boolean {
  if (def.loop) return false;
  return Math.floor(Math.max(0, ticks) / Math.max(1, rate)) >= def.frames.length;
}

/** The first phase of a trap's deadly window (02 §3), the same integer division the sim uses. */
export function deadlyStart(period: number): number {
  return Math.floor((TRAP_DEADLY_NUM * period) / TRAP_DEADLY_DEN);
}

/**
 * Spikes and flame jets share one shape: dormant, then a 12-tick telegraph that winds the
 * 4-frame sequence up, then held at full for the whole deadly window (02 §3, AG §3.5 play
 * orders). The two middle frames split the telegraph evenly.
 *
 * `alwaysOn` traps have no cycle at all — they sit at full extension.
 */
export function windowFrame(phase: number, period: number, alwaysOn = false): number {
  if (alwaysOn) return 3;

  const start = deadlyStart(period);
  if (phase >= start) return 3;

  const intoTelegraph = phase - (start - TELEGRAPH_TICKS);
  if (intoTelegraph < 0) return 0;
  return 1 + Math.min(1, Math.floor(intoTelegraph / (TELEGRAPH_TICKS / 2)));
}

/**
 * An arrow launcher fires at phase 0 and plays its 4 frames at 3 ticks each — the twelve
 * ticks after the shot — then sits on its idle frame until the next cycle (02 §3.2).
 */
export function launcherFrame(phase: number, rate = 3): number {
  const step = Math.floor(phase / rate);
  return step < 4 ? step : 0;
}
