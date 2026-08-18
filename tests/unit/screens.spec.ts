import { describe, expect, it } from 'vitest';

import type { Atlas, Sprite } from '../../src/assets/loader.js';
import { GLYPH_H, GLYPH_W, advance, centredX, glyphRows } from '../../src/render/font.js';
import { drawHud, heartStates } from '../../src/render/hud.js';
import { PALETTE } from '../../src/render/palette.js';
import { drawDeath, drawPause } from '../../src/render/screens.js';
import { HUD_H, VIEW_W } from '../../src/sim/constants.js';

/**
 * The drawing that has no pure decision to extract — text and bitmaps straight onto the
 * canvas — checked through a recording context rather than a real one. Vitest runs in Node
 * with no DOM (TESTING.md §1), and a stub is enough: these functions only ever set a colour
 * and fill rectangles.
 */

interface Fill {
  x: number;
  y: number;
  w: number;
  h: number;
  colour: string;
}

interface Recorder {
  ctx: CanvasRenderingContext2D;
  fills: Fill[];
  images: { x: number; y: number }[];
  /** Whether a 1×1 pixel of `colour` was filled at (x, y). */
  pixel(x: number, y: number, colour: string): boolean;
}

function recorder(): Recorder {
  const fills: Fill[] = [];
  const images: { x: number; y: number }[] = [];
  const state = { fillStyle: '' };

  const ctx = {
    get fillStyle(): string {
      return state.fillStyle;
    },
    set fillStyle(value: string) {
      state.fillStyle = value;
    },
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ x, y, w, h, colour: state.fillStyle });
    },
    drawImage(_image: unknown, x: number, y: number) {
      images.push({ x, y });
    },
  } as unknown as CanvasRenderingContext2D;

  return {
    ctx,
    fills,
    images,
    pixel: (x, y, colour) =>
      fills.some((f) => f.x === x && f.y === y && f.w === 1 && f.h === 1 && f.colour === colour),
  };
}

/** Whether `text` was drawn, glyph pixel by glyph pixel, at (x, y). */
function drewText(
  rec: Recorder,
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
        const hit = rec.fills.some(
          (f) =>
            f.x === pen + col * scale &&
            f.y === y + row * scale &&
            f.w === scale &&
            f.h === scale &&
            f.colour === colour,
        );
        if (!hit) return false;
      }
    }
    pen += advance(ch) * scale;
  }
  return true;
}

const stubAtlas: Atlas = {
  placeholder: true,
  tile: (): Sprite => ({ image: {} as CanvasImageSource, w: 16, h: 16 }),
  cell: (): Sprite => ({ image: {} as CanvasImageSource, w: 16, h: 16 }),
  frame: (): Sprite => ({ image: {} as CanvasImageSource, w: 16, h: 16 }),
};

describe('the death screen (04-ui §3.2)', () => {
  it('writes YOU FELL over the play area, in red at ×2', () => {
    const rec = recorder();
    drawDeath(rec.ctx);

    const text = 'YOU FELL';
    expect(drewText(rec, text, centredX(text, VIEW_W, 2), HUD_H + 88, PALETTE.red, 2)).toBe(true);
  });

  it('blacks out the play area and leaves the HUD alone', () => {
    const rec = recorder();
    drawDeath(rec.ctx);

    const curtain = rec.fills.find((f) => f.w === VIEW_W && f.colour === PALETTE.void);
    expect(curtain).toMatchObject({ x: 0, y: HUD_H });
  });
});

describe('the pause overlay (04-ui §3.4)', () => {
  it('dims every other row and nothing in between', () => {
    const rec = recorder();
    drawPause(rec.ctx);

    const rows = rec.fills.filter((f) => f.w === VIEW_W && f.h === 1).map((f) => f.y);
    expect(rows.slice(0, 4)).toEqual([0, 2, 4, 6]);
    expect(rows.every((y) => y % 2 === 0)).toBe(true);
  });

  it('writes PAUSED in gold at ×2', () => {
    const rec = recorder();
    drawPause(rec.ctx);
    expect(drewText(rec, 'PAUSED', centredX('PAUSED', VIEW_W, 2), 96, PALETTE.gold, 2)).toBe(true);
  });
});

describe('the HUD (04-ui §1)', () => {
  const hud = (hp: number, inventory: Parameters<typeof drawHud>[2]['inventory']) => {
    const rec = recorder();
    drawHud(rec.ctx, stubAtlas, { hp, inventory, floor: 2 });
    return rec;
  };

  it('draws three hearts at the x-positions the table gives', () => {
    const rec = hud(6, { treasure: 0, silverKeys: 0, goldKey: false });
    // The top-left pixel of each heart's second row is lit in every state (04-ui §2).
    for (const x of [4, 14, 24]) expect(rec.pixel(x, 5 + 1, PALETTE.void)).toBe(true);
  });

  it('paints hearts red only as far as the HP goes', () => {
    const full = hud(6, { treasure: 0, silverKeys: 0, goldKey: false });
    const hurt = hud(3, { treasure: 0, silverKeys: 0, goldKey: false });

    const reds = (rec: Recorder): number =>
      rec.fills.filter((f) => f.colour === PALETTE.red).length;
    expect(heartStates(6)).toEqual(['full', 'full', 'full']);
    expect(reds(full)).toBeGreaterThan(reds(hurt));

    // The third heart is empty at 3 HP, so nothing red is drawn in its columns.
    expect(hurt.fills.filter((f) => f.colour === PALETTE.red && f.x >= 24)).toEqual([]);
  });

  it('hides the silver key until one is held, and the gold key until it is', () => {
    const none = hud(6, { treasure: 0, silverKeys: 0, goldKey: false });
    expect(none.images.map((i) => i.x)).toEqual([96]); // the coin icon only

    const both = hud(6, { treasure: 7, silverKeys: 1, goldKey: true });
    expect(both.images.map((i) => i.x)).toEqual([40, 72, 96]); // silver, gold, coin
  });

  it('writes the counts and the floor where 04-ui §1 puts them', () => {
    const rec = hud(6, { treasure: 12, silverKeys: 2, goldKey: false });
    expect(drewText(rec, '2', 57, 6, PALETTE.steel)).toBe(true);
    expect(drewText(rec, '12', 113, 6, PALETTE.steel)).toBe(true);
    expect(drewText(rec, 'F2', 316 - 7, 6, PALETTE.gold)).toBe(true); // right-aligned to 316
  });
});
