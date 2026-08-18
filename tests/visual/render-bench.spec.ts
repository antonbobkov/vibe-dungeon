import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { ART_ROOT } from '../../src/assets/packA.js';

/**
 * The renderer half of TESTING.md §6, and the local half: a draw of the busiest frame in the
 * game has to fit inside 4 ms at p95, which is a quarter of a 60 Hz frame.
 *
 * "Busiest" is f4 R4 — the Arena — with its third wave on the floor: four enemies, the
 * biggest room in the game at 15×11, a combat seal, and the HUD over it. The state is reached
 * by feeding M5's floor-4 solution tape through the real loop and stopping on the tick the
 * wave lands, so the bench measures a frame the game actually produces.
 */

const HAVE_ART = existsSync(join(process.cwd(), 'art_assets', ART_ROOT));

/** The tick of `f4.replay.json` at which wave 3's four enemies are all standing. */
const WAVE_THREE_TICK = 1429;
const FRAMES = 180;
const P95_BUDGET_MS = 4;

interface Hook {
  freeze(value?: boolean): void;
  advance(ticks: number): void;
  injectReplay(inputs: string, floorIndex?: number): void;
  bench(frames: number): Promise<number[]>;
  state(): { room: string; floor: number };
}

const hook = (page: Page): Promise<Hook> =>
  page.evaluate(() => (window as unknown as { undervault: Hook }).undervault) as Promise<Hook>;

test.skip(!HAVE_ART, 'art_assets/ is not present — the renderer bench is local-only');

test('the busiest frame in the game draws inside its budget', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => 'undervault' in window, undefined, { timeout: 30_000 });
  await hook(page); // fails loudly if the hook is not the shape this bench expects

  const inputs = await page.evaluate(async () => {
    const response = await fetch('/tests/replay/f4.replay.json');
    return ((await response.json()) as { inputs: string }).inputs;
  });

  const state = await page.evaluate(
    ({ tape, tick }) => {
      const app = (window as unknown as { undervault: Hook }).undervault;
      app.freeze(true);
      app.injectReplay(tape, 3);
      app.advance(tick);
      return app.state();
    },
    { tape: inputs, tick: WAVE_THREE_TICK },
  );
  expect(state, 'the tape should stop in the Arena').toMatchObject({ floor: 4, room: 'R4' });

  const times = await page.evaluate(
    async (frames) => (window as unknown as { undervault: Hook }).undervault.bench(frames),
    FRAMES,
  );

  const sorted = [...times].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)]!;
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  console.log(
    `render bench: ${times.length} draws of f4 R4 wave 3 — ` +
      `p50 ${p50.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, max ${sorted.at(-1)!.toFixed(3)} ms`,
  );

  expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS);
});
