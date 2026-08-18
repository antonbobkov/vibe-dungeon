import { expect, test, type Page } from '@playwright/test';

import { floorLabelOrigin } from '../../src/render/hud.js';
import { GLYPH_H, GLYPH_W, advance, centredX, glyphRows } from '../../src/render/font.js';
import { PALETTE } from '../../src/render/palette.js';

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
  treasure: number;
  replaying: boolean;
}

const state = (page: Page): Promise<AppState> =>
  page.evaluate(() =>
    (window as unknown as { undervault: { state(): AppState } }).undervault.state(),
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
