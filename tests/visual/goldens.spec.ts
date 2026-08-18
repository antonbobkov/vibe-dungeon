import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { ART_ROOT } from '../../src/assets/packA.js';

/**
 * Visual goldens — TESTING.md §5. Local only: they are shots of the real Pack A art, which is
 * licensed content kept out of the repo (CLAUDE.md), so the suite skips itself wherever the
 * packs are missing. What *is* committed is text — the SHA-256 of each PNG's bytes, beside the
 * Chromium build they were taken with, since a screenshot hash is only meaningful against a
 * known renderer.
 *
 *     npm run test:visual         check
 *     npm run test:visual -- -u   re-record, in a reviewed commit
 *
 * The PNGs themselves are written to `asset_reference/goldens/` (gitignored, regenerable) so
 * a failure can be looked at rather than guessed at.
 */

const ART_DIR = join(process.cwd(), 'art_assets');
const HAVE_ART = existsSync(join(ART_DIR, ART_ROOT));

const GOLDENS = join(process.cwd(), 'tests', 'visual', 'goldens.json');
const PNG_DIR = join(process.cwd(), 'asset_reference', 'goldens');

interface Goldens {
  /** The browser the hashes were recorded with; a different one may draw different pixels. */
  chromium: string;
  shots: Record<string, string>;
}

const readGoldens = (): Goldens =>
  existsSync(GOLDENS)
    ? (JSON.parse(readFileSync(GOLDENS, 'utf8')) as Goldens)
    : { chromium: '', shots: {} };

function writeGoldens(goldens: Goldens): void {
  const shots = Object.fromEntries(Object.entries(goldens.shots).sort());
  writeFileSync(GOLDENS, `${JSON.stringify({ ...goldens, shots }, null, 2)}\n`, 'utf8');
}

/** Boot, then put the game on an exact tick — a golden of "whenever the display got there"
 * would flicker with the title's blink and every idle loop. */
async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => 'undervault' in window, undefined, { timeout: 30_000 });
  await page.evaluate(() => {
    const app = (window as unknown as { undervault: { freeze(v?: boolean): void } }).undervault;
    app.freeze(true);
  });
}

async function shoot(page: Page, name: string): Promise<void> {
  const png = await page.locator('canvas#game').screenshot();
  const hash = createHash('sha256').update(png).digest('hex');

  mkdirSync(PNG_DIR, { recursive: true });
  writeFileSync(join(PNG_DIR, `${name}.png`), png);

  const updating = test.info().config.updateSnapshots === 'all';
  const goldens = readGoldens();

  if (updating || goldens.shots[name] === undefined) {
    goldens.shots[name] = hash;
    goldens.chromium = page.context().browser()?.version() ?? 'unknown';
    writeGoldens(goldens);
    test.info().annotations.push({ type: 'golden', description: `recorded ${name} = ${hash}` });
    return;
  }

  expect(hash, `${name}.png differs from its golden (see ${PNG_DIR})`).toBe(goldens.shots[name]);
}

test.describe.configure({ mode: 'serial' });

test.skip(!HAVE_ART, 'art_assets/ is not present — visual goldens are local-only');

test('the title screen', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const app = (window as unknown as { undervault: { toTitle(): void; advance(n: number): void } })
      .undervault;
    app.toTitle();
    app.advance(1); // tick 1: the prompt is in the lit half of its blink
  });
  await shoot(page, 'title');
});

test('floor 1 room 1, first frame', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const app = (window as unknown as { undervault: { start(): void } }).undervault;
    app.start(); // a fresh run: play tick 0, the player on `@`, nothing moved yet
  });
  await shoot(page, 'f1r1');
});
