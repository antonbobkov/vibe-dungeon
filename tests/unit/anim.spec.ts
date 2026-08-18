import { describe, expect, it } from 'vitest';

import { ANIMS, anim, type AnimDef } from '../../src/assets/packA.js';
import {
  IDLE_FRAME_TICKS,
  MOVING_FRAME_TICKS,
  TELEGRAPH_TICKS,
  deadlyStart,
  finished,
  frameIndex,
  launcherFrame,
  windowFrame,
} from '../../src/render/anim.js';

/**
 * Animation sequencing (AG §3.5 play orders, 02-entities §1.1 and §3 rates). The M6 checklist
 * asks for every animation id in the manifest to be stepped through its sequence, so the
 * first block is driven straight off `ANIMS` — a new entry joins it by existing.
 */

/** The frame indices an animation shows, tick by tick, for `ticks` ticks. */
function walk(def: AnimDef, ticks: number, rate = def.frameTicks): number[] {
  return Array.from({ length: ticks }, (_, t) => frameIndex(def, t, rate));
}

describe('every animation in the manifest', () => {
  it.each(ANIMS.map((def) => [def.id, def] as const))('%s steps its own frames', (_id, def) => {
    const n = def.frames.length;
    const seen = walk(def, n * def.frameTicks);

    // Each frame is held for exactly frameTicks, in order, from the first tick.
    for (let index = 0; index < n; index++) {
      const held = seen.slice(index * def.frameTicks, (index + 1) * def.frameTicks);
      expect(held, `${def.id} frame ${index}`).toEqual(Array<number>(def.frameTicks).fill(index));
    }

    // …and then it either wraps or stops, which is the whole of loop/hold.
    const past = frameIndex(def, n * def.frameTicks);
    if (def.loop) {
      expect(past, `${def.id} loops`).toBe(0);
      expect(finished(def, n * def.frameTicks * 10)).toBe(false);
    } else {
      expect(past, `${def.id} holds its last frame`).toBe(n - 1);
      expect(finished(def, n * def.frameTicks), `${def.id} is over`).toBe(true);
      expect(finished(def, n * def.frameTicks - 1)).toBe(false);
    }
  });

  it('covers the whole manifest, so a new animation cannot arrive untested', () => {
    // The block above is driven off ANIMS, so this is the tripwire for the manifest itself:
    // 27 animations, every id distinct.
    expect(ANIMS.length).toBe(27);
    expect(new Set(ANIMS.map((d) => d.id)).size).toBe(27);
  });
});

describe('the walk cycle', () => {
  it('is the idle loop played faster, not a second animation (02 §1.1)', () => {
    const def = anim('player_idle');
    expect(def.frameTicks).toBe(IDLE_FRAME_TICKS);

    expect(walk(def, 16, IDLE_FRAME_TICKS).at(-1)).toBe(1); // tick 15: still frame 1
    expect(frameIndex(def, 16, IDLE_FRAME_TICKS)).toBe(2);
    expect(frameIndex(def, 16, MOVING_FRAME_TICKS)).toBe(3); // 16 / 5 = frame 3
    expect(frameIndex(def, 20, MOVING_FRAME_TICKS)).toBe(0); // and wrapped by 20
  });

  it('treats a negative or zero clock as the first frame', () => {
    const def = anim('coin_spin');
    expect(frameIndex(def, 0)).toBe(0);
    expect(frameIndex(def, -5)).toBe(0);
  });
});

describe('spikes and flame jets (02 §3)', () => {
  // Every period the four floors use.
  const periods = [90, 120, 150, 180];

  it.each(periods)('period %i: dormant, 12 ticks of telegraph, then held at full', (period) => {
    const start = deadlyStart(period);

    expect(windowFrame(0, period)).toBe(0);
    expect(windowFrame(start - TELEGRAPH_TICKS - 1, period)).toBe(0);
    expect(windowFrame(start - TELEGRAPH_TICKS, period)).toBe(1);
    expect(windowFrame(start - TELEGRAPH_TICKS + 5, period)).toBe(1);
    expect(windowFrame(start - TELEGRAPH_TICKS + 6, period)).toBe(2);
    expect(windowFrame(start - 1, period)).toBe(2);
    expect(windowFrame(start, period)).toBe(3);
    expect(windowFrame(period - 1, period)).toBe(3);
  });

  it('holds an always_on trap at full extension', () => {
    expect(windowFrame(0, 120, true)).toBe(3);
    expect(windowFrame(119, 120, true)).toBe(3);
  });

  it('agrees with the sim about where the window opens', () => {
    expect(deadlyStart(90)).toBe(54);
    expect(deadlyStart(120)).toBe(72);
    expect(deadlyStart(150)).toBe(90);
    expect(deadlyStart(180)).toBe(108);
  });
});

describe('the arrow launcher (02 §3.2)', () => {
  it('plays its shot over the twelve ticks after firing, then sits idle', () => {
    const seen = Array.from({ length: 15 }, (_, phase) => launcherFrame(phase));
    expect(seen).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0, 0, 0]);
  });

  it('has four frames to play, in the corrected AG §3.5 order', () => {
    expect(anim('arrow_launcher').frames).toHaveLength(4);
    expect(anim('arrow_launcher').frames[0]).toBe('arrow_2.png');
  });
});
