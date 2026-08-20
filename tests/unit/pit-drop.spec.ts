import { describe, expect, it } from 'vitest';

import { tile } from '../../src/assets/packA.js';
import { detect, snapshot } from '../../src/game/events.js';
import { autotileRoom, tileRefAt, type TileRef } from '../../src/render/autotile.js';
import { Effects, PIT_DROP_PX, PIT_DROP_TICKS } from '../../src/render/effects.js';
import { drawnTiles, slidePosition } from '../../src/render/world.js';
import { PUSH_SLIDE_TICKS, TILE, TILE_SUBPX } from '../../src/sim/constants.js';
import { UP } from '../../src/sim/input.js';
import { PropState } from '../../src/sim/prop.js';
import type { Sim } from '../../src/sim/sim.js';
import { game } from './helpers.js';

/**
 * The moment a pushed crate is swallowed by a pit (02 §4.2), composed frame by frame.
 *
 * Three separate pieces of the renderer hand the crate off to each other inside two ticks —
 * the sliding prop's interpolation, the bridged tile the auto-tiler starts drawing, and the
 * `pit_drop` overlay that settles on top — and each of them is a pure function, so the whole
 * sequence can be assembled without a canvas and checked for the flicker that used to be in
 * it: the pit's black hole snapping shut the instant a push charged, twelve ticks before the
 * crate reached it, and the crate arriving 1.3 px short of the tile it hands over to.
 *
 * F3 R2 "The Trench": the crate at (6,4) is pushed north twice, the second push into the pit
 * at (6,2), which becomes a permanent bridge (03-levels).
 */

const CRATE_PUSH = tile('crate_push');
const VOID_FILL = tile('void_fill');
const PIT: [number, number] = [6, 2];
const ORIGIN = { ox: 0, oy: 0 };

const same = (a: TileRef, b: { col: number; row: number }): boolean =>
  a.col === b.col && a.row === b.row;

/** One tick of the composed picture: everything crate-shaped, and what the pit cell shows. */
interface Frame {
  tick: number;
  /** Top-left of every crate drawn this tick, opaque prop/terrain ones first. */
  crates: { x: number; y: number; alpha: number; layer: 'prop' | 'terrain' | 'overlay' }[];
  pitCell: TileRef;
  /** The `pit_drop` overlay's `elapsed`, or −1 while there is none. */
  elapsed: number;
}

function compose(sim: Sim, effects: Effects, tick: number): Frame {
  const refs = autotileRoom(sim.roomDef, drawnTiles(sim));
  const frame: Frame = {
    tick,
    crates: [],
    pitCell: tileRefAt(refs, sim.roomDef, PIT[0], PIT[1]),
    elapsed: -1,
  };

  for (let row = 0; row < sim.roomDef.h; row++) {
    for (let col = 0; col < sim.roomDef.w; col++) {
      if (!same(tileRefAt(refs, sim.roomDef, col, row), CRATE_PUSH)) continue;
      frame.crates.push({ x: col * TILE, y: row * TILE, alpha: 1, layer: 'terrain' });
    }
  }

  for (const prop of sim.props) {
    if (prop.kind !== 'crate_push') continue;
    const [x, y] = slidePosition(prop.at, prop.slideTo, prop.state, prop.timer, ORIGIN);
    frame.crates.push({ x, y, alpha: 1, layer: 'prop' });
  }

  for (const effect of effects.live) {
    if (effect.kind !== 'pit_drop') continue;
    const done = effect.elapsed / effect.total;
    frame.elapsed = effect.elapsed;
    frame.crates.push({
      x: effect.at[0] * TILE,
      y: effect.at[1] * TILE + Math.round(PIT_DROP_PX * done),
      alpha: 1 - done,
      layer: 'overlay',
    });
  }

  return frame;
}

/**
 * Walk into the crate holding UP until the pit has been bridged and the drop has faded out,
 * composing every tick on the way.
 *
 * The tick order is `App.tick`'s, and deliberately so: `effects.advance()` runs *before* the
 * sim tick and `spawn` after it, which is what puts the overlay's first draw at `elapsed = 0`.
 */
function run(ticks: number): Frame[] {
  // Standing on (6,5), directly south of the crate — the f3-pit-bridge replay's start.
  const sim = game({
    floorIndex: 2,
    roomId: 'R2',
    start: { x: 6 * TILE_SUBPX, y: 5 * TILE_SUBPX },
  });
  const effects = new Effects();
  const frames: Frame[] = [];

  for (let tick = 1; tick <= ticks; tick++) {
    effects.advance();
    const before = snapshot(sim);
    sim.tick(UP);
    effects.spawn(detect(before, snapshot(sim)));
    frames.push(compose(sim, effects, tick));
  }
  return frames;
}

const FRAMES = run(70);
/** The first tick with no sliding crate left after one has been sliding: the landing. */
const LANDED = FRAMES.findIndex((f, i) => i > 0 && f.elapsed === 0);

describe('a crate sliding into a pit (02 §4.2)', () => {
  it('lands on the tick the twelve-tick slide runs out, and bridges the pit there', () => {
    expect(LANDED).toBeGreaterThan(0);
    const landing = FRAMES[LANDED]!;
    expect(landing.pitCell).toEqual({ col: CRATE_PUSH.col, row: CRATE_PUSH.row });
    // Twelve drawn slide frames precede it, the last of them already on the pit cell.
    const slide = FRAMES.slice(LANDED - PUSH_SLIDE_TICKS, LANDED);
    expect(slide).toHaveLength(PUSH_SLIDE_TICKS);
    expect(slide.every((f) => f.crates.some((c) => c.layer === 'prop'))).toBe(true);
  });

  it('keeps the pit black under the crate for the whole slide', () => {
    // The sim claims the destination tile as `PROP` the moment the push charges (02 §4.2), so
    // this is the frame that used to pop from the void to floor art twelve ticks early.
    for (const frame of FRAMES.slice(0, LANDED)) {
      expect(frame.pitCell, `tick ${frame.tick}`).toEqual({
        col: VOID_FILL.col,
        row: VOID_FILL.row,
      });
    }
    for (const frame of FRAMES.slice(LANDED)) {
      expect(frame.pitCell, `tick ${frame.tick}`).toEqual({
        col: CRATE_PUSH.col,
        row: CRATE_PUSH.row,
      });
    }
  });

  it('slides the whole 16 px across its twelve frames, ≤ 2 px a tick', () => {
    const ys = FRAMES.slice(LANDED - PUSH_SLIDE_TICKS, LANDED).map(
      (f) => f.crates.find((c) => c.layer === 'prop')!.y,
    );
    // (6,3) → (6,2): 48 down to 32, reaching the destination on the last drawn frame.
    expect(ys).toEqual([48, 47, 45, 44, 42, 41, 39, 38, 36, 35, 33, 32]);
    for (let i = 1; i < ys.length; i++)
      expect(Math.abs(ys[i]! - ys[i - 1]!)).toBeLessThanOrEqual(2);
  });

  it('hands the crate over to the bridged tile without moving it a pixel', () => {
    const last = FRAMES[LANDED - 1]!.crates.find((c) => c.layer === 'prop')!;
    const bridged = FRAMES[LANDED]!.crates.find((c) => c.layer === 'terrain')!;
    expect([bridged.x, bridged.y]).toEqual([last.x, last.y]);
    expect([bridged.x, bridged.y]).toEqual([PIT[0] * TILE, PIT[1] * TILE]);
  });

  it('never leaves the pit cell without an opaque crate once the slide has reached it', () => {
    const arrived = FRAMES.findIndex(
      (f) => f.crates.some((c) => c.x === PIT[0] * TILE && c.y === PIT[1] * TILE && c.alpha === 1),
      // ^ the last slide frame; every later frame must keep one there too.
    );
    expect(arrived).toBe(LANDED - 1);
    for (const frame of FRAMES.slice(arrived)) {
      const covered = frame.crates.some(
        (c) => c.x === PIT[0] * TILE && c.y === PIT[1] * TILE && c.alpha === 1,
      );
      expect(covered, `tick ${frame.tick}`).toBe(true);
    }
  });
});

describe('the pit_drop overlay (02 §4.2)', () => {
  const overlay = () =>
    FRAMES.filter((f) => f.elapsed >= 0).map((f) => ({
      elapsed: f.elapsed,
      ...f.crates.find((c) => c.layer === 'overlay')!,
    }));

  it('draws its first frame at elapsed 0, on the tile the crate just filled', () => {
    const first = overlay()[0]!;
    expect(first.elapsed).toBe(0);
    expect([first.x, first.y]).toEqual([PIT[0] * TILE, PIT[1] * TILE]);
    expect(first.alpha).toBe(1);
  });

  it('runs elapsed 0…9 and then stops — ten ticks of drop, none of them redundant', () => {
    expect(overlay().map((o) => o.elapsed)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(overlay()).toHaveLength(PIT_DROP_TICKS);
  });

  it('drops exactly 4 px, monotonically, a pixel at a time', () => {
    const ys = overlay().map((o) => o.y - PIT[1] * TILE);
    expect(ys).toEqual([0, 0, 1, 1, 2, 2, 2, 3, 3, 4]);
    expect(ys[ys.length - 1]).toBe(PIT_DROP_PX);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]!).toBeGreaterThanOrEqual(ys[i - 1]!);
      expect(ys[i]! - ys[i - 1]!).toBeLessThanOrEqual(1);
    }
  });

  it('fades out monotonically from full', () => {
    const alphas = overlay().map((o) => Number(o.alpha.toFixed(2)));
    expect(alphas).toEqual([1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1]);
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]!).toBeLessThan(alphas[i - 1]!);
  });
});

describe('the slide interpolation on its own', () => {
  it('is 0 at the first drawn frame and exactly 1 at the last', () => {
    const at: [number, number] = [3, 4];
    const to: [number, number] = [4, 4];
    const x = (timer: number) => slidePosition(at, to, PropState.SLIDING, timer, ORIGIN)[0];
    expect(x(PUSH_SLIDE_TICKS)).toBe(3 * TILE);
    expect(x(1)).toBe(4 * TILE);
  });

  it('leaves a prop that is not sliding on its own tile', () => {
    expect(slidePosition([3, 4], null, PropState.IDLE, 0, ORIGIN)).toEqual([3 * TILE, 4 * TILE]);
    expect(slidePosition([3, 4], [4, 4], PropState.IDLE, 0, ORIGIN)).toEqual([3 * TILE, 4 * TILE]);
  });
});
