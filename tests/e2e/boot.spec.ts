import { expect, test } from '@playwright/test';

/**
 * M0 smoke test: the page boots and the display surface obeys the integer-scaling rule
 * (00-overview §Global constants, asserted per TESTING.md §5). Gameplay e2e lands at M6.
 */
test('boots to a 320×208 canvas scaled by an integer factor', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') problems.push(msg.text());
  });
  page.on('pageerror', (err) => problems.push(err.message));

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
