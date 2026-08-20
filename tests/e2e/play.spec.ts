import { expect, test, type Page } from '@playwright/test';

import { floorLabelOrigin } from '../../src/render/hud.js';
import { GLYPH_H, GLYPH_W, advance, centredX, glyphRows } from '../../src/render/font.js';
import { PALETTE } from '../../src/render/palette.js';
import { PlayerState } from '../../src/sim/player.js';

/**
 * The M6 checklist, in the browser with `PLACEHOLDER_ART=1`: boots to the title, ATTACK
 * starts floor 1, the f1 solution replay run through the real loop finishes the floor with
 * the HUD reading F2, and pause covers and uncovers the game — with no console noise.
 */

/** Chrome's advice about repeated readback; induced by this test, not by the page. */
const INDUCED_BY_READBACK = /willReadFrequently/;

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    const type = msg.type();
    if (type !== 'error' && type !== 'warning') return;
    if (INDUCED_BY_READBACK.test(msg.text())) return;
    problems.push(msg.text());
  });
  page.on('pageerror', (err) => problems.push(err.message));
  return problems;
}

interface AppState {
  screen: string;
  floor: number;
  room: string;
  playerState: number;
  treasure: number;
  replaying: boolean;
}

const state = (page: Page): Promise<AppState> =>
  page.evaluate(() =>
    (window as unknown as { undervault: { state(): AppState } }).undervault.state(),
  );

/** Stop the loop advancing time, so a test can put the game on an exact tick (TESTING.md §5). */
const freeze = (page: Page): Promise<void> =>
  page.evaluate(() =>
    (window as unknown as { undervault: { freeze(v?: boolean): void } }).undervault.freeze(),
  );

const advanceTicks = (page: Page, ticks: number): Promise<void> =>
  page.evaluate(
    (n) =>
      (window as unknown as { undervault: { advance(n: number): void } }).undervault.advance(n),
    ticks,
  );

/** The hook appears once the atlas has finished loading, which is the game's "ready". */
async function waitForBoot(page: Page): Promise<void> {
  await page.waitForFunction(() => 'undervault' in window, undefined, { timeout: 20_000 });
}

/** The canvas as one flat array of #rrggbb, read once and sampled many times. */
async function screen(page: Page): Promise<(x: number, y: number) => string> {
  const pixels = await page.evaluate(() => {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    return [...ctx.getImageData(0, 0, canvas.width, canvas.height).data];
  });
  return (x, y) => {
    const i = (y * 320 + x) * 4;
    return `#${[pixels[i], pixels[i + 1], pixels[i + 2]]
      .map((v) => (v ?? 0).toString(16).padStart(2, '0'))
      .join('')}`;
  };
}

/** Whether the glyphs of `text` are lit in `colour` at (x, y) — the font table, on screen. */
function readsAs(
  at: (x: number, y: number) => string,
  text: string,
  x: number,
  y: number,
  colour: string,
  scale = 1,
): boolean {
  let pen = x;
  for (const ch of text) {
    if (ch === ' ') {
      pen += advance(ch) * scale;
      continue;
    }
    const rows = glyphRows(ch);
    for (let row = 0; row < GLYPH_H; row++) {
      for (let col = 0; col < GLYPH_W; col++) {
        if (rows[row]![col] !== '#') continue;
        if (at(pen + col * scale, y + row * scale) !== colour) return false;
      }
    }
    pen += advance(ch) * scale;
  }
  return true;
}

test('boots to the title screen (04-ui §3.1)', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/');
  await waitForBoot(page);

  await expect.poll(async () => (await state(page)).screen, { timeout: 10_000 }).toBe('title');

  const at = await screen(page);
  // 04-ui §3.1: the logo at ×3 in gold on y=48, and the controls line at ×1 in grey on y=172.
  expect(readsAs(at, 'UNDERVAULT', centredX('UNDERVAULT', 320, 3), 48, PALETTE.gold, 3)).toBe(true);
  const controls = 'ARROWS OR WASD TO MOVE   X SWING   Z USE';
  expect(readsAs(at, controls, centredX(controls, 320), 172, PALETTE.steelDark)).toBe(true);

  expect(problems).toEqual([]);
});

test('ATTACK starts floor 1, and the HUD says so', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/');
  await waitForBoot(page);
  await expect.poll(async () => (await state(page)).screen, { timeout: 10_000 }).toBe('title');

  await page.keyboard.press('KeyX');
  await expect.poll(async () => (await state(page)).screen, { timeout: 10_000 }).toBe('playing');
  await expect.poll(async () => (await state(page)).room).toBe('R1');

  // Wait out the 30-tick fade-in before reading pixels.
  await page.waitForTimeout(1000);
  const at = await screen(page);
  const label = floorLabelOrigin(1);
  expect(readsAs(at, 'F1', label.x, label.y, PALETTE.gold)).toBe(true);

  expect(problems).toEqual([]);
});

/**
 * 01 §2: `Space` and `Backspace` are ATTACK alongside `X` and `J`. Both are keys the browser
 * has its own plans for — scrolling the page and going back a page — so this also stands as
 * the check that the bindings' `preventDefault` is doing its job: a page that navigated away
 * would have no `undervault` hook left to ask.
 */
for (const key of ['Space', 'Backspace'] as const) {
  test(`${key} swings the sword (01 §2)`, async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto('/');
    await waitForBoot(page);
    await expect.poll(async () => (await state(page)).screen, { timeout: 10_000 }).toBe('title');

    // ATTACK on the title starts the run, which is the first thing either key has to do.
    await page.keyboard.press(key);
    await expect.poll(async () => (await state(page)).screen, { timeout: 10_000 }).toBe('playing');
    await expect
      .poll(async () => (await state(page)).playerState, { timeout: 10_000 })
      .toBe(PlayerState.NORMAL);

    // Then the same key has to reach the sword. The swing is 12 ticks — 200 ms, less than a
    // poll's round trip — so the loop is frozen and stepped by exactly the one tick that
    // consumes the press (01 §2's latch), instead of racing it.
    await freeze(page);
    await page.keyboard.press(key);
    await advanceTicks(page, 1);
    expect((await state(page)).playerState).toBe(PlayerState.SWING);

    // Backspace did not walk the history stack and Space did not scroll the page away: the
    // hook answered, and the document is still the one that was loaded.
    expect(await page.evaluate(() => scrollY)).toBe(0);
    expect(problems).toEqual([]);
  });
}

test('the f1 solution replay finishes the floor through the browser loop', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/');
  await waitForBoot(page);
  await expect.poll(async () => (await state(page)).screen, { timeout: 10_000 }).toBe('title');

  // The same tape npm run test:replay runs headless, fed a byte per tick by the real loop.
  const replay = await page.evaluate(async () => {
    const response = await fetch('/tests/replay/f1.replay.json');
    return (await response.json()) as { inputs: string };
  });

  await page.evaluate((inputs) => {
    (
      window as unknown as { undervault: { injectReplay(i: string): void } }
    ).undervault.injectReplay(inputs);
  }, replay.inputs);

  await expect.poll(async () => (await state(page)).replaying, { timeout: 30_000 }).toBe(false);

  const finished = await state(page);
  expect(finished.floor).toBe(2); // 03-levels' floor 1 path ends on the ladder
  expect(finished.treasure).toBe(20);

  const at = await screen(page);
  const label = floorLabelOrigin(2);
  expect(readsAs(at, 'F2', label.x, label.y, PALETTE.gold)).toBe(true);

  expect(problems).toEqual([]);
});

test('the full-game replay ends on the victory screen (04-ui §3.3)', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/');
  await waitForBoot(page);

  // M5's chained solution: 9875 ticks, all four floors, through this same loop.
  const replay = await page.evaluate(async () => {
    const response = await fetch('/tests/replay/fullgame.replay.json');
    return (await response.json()) as { inputs: string };
  });
  await page.evaluate((inputs) => {
    (
      window as unknown as { undervault: { injectReplay(i: string): void } }
    ).undervault.injectReplay(inputs);
  }, replay.inputs);

  await expect.poll(async () => (await state(page)).replaying, { timeout: 60_000 }).toBe(false);
  // Then 04-ui §3.3's hold and fade before the screen itself.
  await expect.poll(async () => (await state(page)).screen, { timeout: 20_000 }).toBe('victory');

  const finished = await state(page);
  expect(finished.floor).toBe(4);
  expect(finished.treasure).toBe(81);

  const at = await screen(page);
  const heading = 'THE VAULT IS YOURS';
  expect(readsAs(at, heading, centredX(heading, 320, 2), 56, PALETTE.gold, 2)).toBe(true);
  expect(readsAs(at, 'TREASURE 81/83', centredX('TREASURE 81/83', 320), 140, PALETTE.steel)).toBe(
    true,
  );

  expect(problems).toEqual([]);
});

test('sounds its cues once the player has touched a key, and M silences them (04-ui §5)', async ({
  page,
}) => {
  const problems = watchConsole(page);

  // Count what the synth builds, without needing to hear anything.
  await page.addInitScript(() => {
    const counts = { oscillators: 0, noise: 0 };
    (window as unknown as { audioNodes: typeof counts }).audioNodes = counts;
    const Original = window.AudioContext;
    class Counting extends Original {
      override createOscillator(): OscillatorNode {
        counts.oscillators++;
        return super.createOscillator();
      }
      override createBufferSource(): AudioBufferSourceNode {
        counts.noise++;
        return super.createBufferSource();
      }
    }
    window.AudioContext = Counting as unknown as typeof AudioContext;
  });

  await page.goto('/');
  await waitForBoot(page);
  const nodes = (): Promise<{ oscillators: number }> =>
    page.evaluate(() => (window as unknown as { audioNodes: { oscillators: number } }).audioNodes);

  expect((await nodes()).oscillators).toBe(0); // nothing before a gesture

  await page.keyboard.press('KeyX'); // starts the run, and lets the browser start audio
  await expect.poll(async () => (await state(page)).screen, { timeout: 10_000 }).toBe('playing');

  // Walking north over f1 R1's coins: each one is a cue.
  await page.keyboard.down('ArrowUp');
  await expect
    .poll(async () => (await state(page)).treasure, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await page.keyboard.up('ArrowUp');
  expect((await nodes()).oscillators).toBeGreaterThan(0);

  // M mutes, and is remembered for the next run (04-ui §5).
  await page.keyboard.press('KeyM');
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (window as unknown as { undervault: { muted(): boolean } }).undervault.muted(),
      ),
    )
    .toBe(true);
  await page.reload();
  await waitForBoot(page);
  expect(
    await page.evaluate(() =>
      (window as unknown as { undervault: { muted(): boolean } }).undervault.muted(),
    ),
  ).toBe(true);

  expect(problems).toEqual([]);
});

test('pause covers the game and gives it back (01 §10, 04-ui §3.4)', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/');
  await waitForBoot(page);
  await expect.poll(async () => (await state(page)).screen, { timeout: 10_000 }).toBe('title');

  await page.keyboard.press('KeyX');
  await expect.poll(async () => (await state(page)).screen, { timeout: 10_000 }).toBe('playing');
  await page.waitForTimeout(1000);

  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).screen).toBe('paused');

  await page.waitForTimeout(200);
  const paused = await screen(page);
  // "PAUSED" at ×2 in gold, centred on y=96.
  expect(
    readsAs(paused, 'PAUSED', centredX('PAUSED', 320, 2), 96, PALETTE.gold, 2),
    'the pause overlay',
  ).toBe(true);

  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).screen).toBe('playing');

  expect(problems).toEqual([]);
});
