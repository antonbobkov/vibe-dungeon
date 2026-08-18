import { expect, test, type Page } from '@playwright/test';

/**
 * The shell: the canvas is the right size at any window size (TESTING.md §5's integer-scaling
 * rule), and a started run draws floor 1 room 1 in Pack A art — placeholder art in CI, whose
 * colours are chosen per role so these assertions mean the same thing either way. The screens
 * and the full playthrough are `play.spec.ts`.
 */

/**
 * Chrome advises using `willReadFrequently` when a canvas is read back repeatedly. That is
 * this test reading pixels, not the game drawing them, so it is not a page problem.
 */
const INDUCED_BY_READBACK = /willReadFrequently/;

/** Collect real console errors and warnings, ignoring ones this test induces. */
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

/** Read one logical pixel of the canvas as #rrggbb. */
async function pixel(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(
    ([px, py]) => {
      const canvas = document.getElementById('game') as HTMLCanvasElement;
      const data = canvas.getContext('2d')!.getImageData(px!, py!, 1, 1).data;
      return `#${[data[0], data[1], data[2]].map((v) => v!.toString(16).padStart(2, '0')).join('')}`;
    },
    [x, y],
  );
}

test('boots to a 320×208 canvas scaled by an integer factor', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/');

  const canvas = page.locator('canvas#game');
  await expect(canvas).toBeVisible();

  // Logical resolution, in backing pixels.
  expect(await canvas.evaluate((el: HTMLCanvasElement) => [el.width, el.height])).toEqual([
    320, 208,
  ]);

  // Displayed size is an exact integer multiple of the logical size, at three window sizes.
  for (const size of [
    { width: 640, height: 480 },
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(size);
    const box = await canvas.boundingBox();
    expect(box, `no bounding box at ${size.width}×${size.height}`).not.toBeNull();
    const scale = box!.width / 320;
    expect(scale, `scale at ${size.width}×${size.height}`).toBe(Math.floor(scale));
    expect(scale).toBeGreaterThanOrEqual(1);
    expect(box!.height).toBe(208 * scale);
  }

  expect(problems).toEqual([]);
});

test('runs the sim and draws floor 1 room 1', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/');
  await page.waitForFunction(() => 'undervault' in window, undefined, { timeout: 20_000 });
  // Skip the title (04-ui §3.1); this test is about the room under it.
  await page.evaluate(() =>
    (window as unknown as { undervault: { start(): void } }).undervault.start(),
  );

  // f1 R1 is 11×8, so it is centred at ox = (320 − 176)/2 = 72, oy = 16 + (192 − 128)/2 = 48.
  await expect.poll(async () => pixel(page, 72 + 8, 48 + 8), { timeout: 5000 }).toBe('#6e4a48'); // the room's top-left wall
  expect(await pixel(page, 72 + 5 * 16 + 8, 48 + 5 * 16 + 8)).toBe('#3d253b'); // interior floor
  expect(await pixel(page, 72 + 4 * 16 + 8, 48 + 8)).toBe('#bf704d'); // d1, still closed
  expect(await pixel(page, 4, 180)).toBe('#25131a'); // void outside the room

  // The player starts on `@`(5,6), drawn as the knight — steel, in the placeholder palette.
  expect(await pixel(page, 72 + 5 * 16 + 8, 48 + 6 * 16 + 12)).toBe('#adc1cf');

  // Walking north opens d1 (01 §8.1) — proof the loop, the input and the sim are all live.
  await page.keyboard.down('ArrowUp');
  await expect
    .poll(async () => pixel(page, 72 + 4 * 16 + 8, 48 + 8), { timeout: 5000 })
    .not.toBe('#bf704d');
  await page.keyboard.up('ArrowUp');

  expect(problems).toEqual([]);
});
