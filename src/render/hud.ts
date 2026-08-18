/**
 * The HUD — spec/04-ui.md §1 and §2, position for position.
 *
 * A 16 px strip across the top of the screen: three hearts at half-heart granularity, the
 * keys the run is carrying, the coin count, and which floor this is. The layout table is
 * transcribed as constants and the heart bitmaps as pixel rows, so both can be checked
 * against the spec by eye.
 */

import type { Atlas } from '../assets/loader.js';
import { HUD_H, MAX_HP, VIEW_W } from '../sim/constants.js';
import type { Inventory } from '../sim/pickups.js';
import { drawText, textWidth } from './font.js';
import { PALETTE } from './palette.js';

/** 04-ui §1's table, left to right. */
const HEART_X = [4, 14, 24];
const HEART_Y = 5;
const SILVER_ICON = { x: 40, y: 0 };
const SILVER_COUNT = { x: 57, y: 6 };
const GOLD_ICON = { x: 72, y: 0 };
const COIN_ICON = { x: 96, y: 0 };
const COIN_COUNT = { x: 113, y: 6 };
/** The floor label is right-aligned to this x. */
const FLOOR_RIGHT = 316;
const FLOOR_Y = 6;
/** The 1 px separator that closes the strip off from the play area. */
const SEPARATOR_Y = 15;

/** 04-ui §2's 7×6 bitmaps. `.` transparent, `O` void, `R` red, `W` steel, `D` floor. */
const HEARTS = {
  full: ['.OO.OO.', 'OWRRRRO', 'ORRRRRO', '.ORRRO.', '..ORO..', '...O...'],
  half: ['.OO.OO.', 'OWRDDDO', 'ORRDDDO', '.ORDDO.', '..ORO..', '...O...'],
  empty: ['.OO.OO.', 'ODDDDDO', 'ODDDDDO', '.ODDDO.', '..ODO..', '...O...'],
} as const;

export type HeartState = keyof typeof HEARTS;

const HEART_COLOURS: Readonly<Record<string, string>> = {
  O: PALETTE.void,
  R: PALETTE.red,
  W: PALETTE.steel,
  D: PALETTE.floor,
};

/** Which heart shows what, at 2 HP each (04-ui §1: "HP 6..0, 2 HP per heart"). */
export function heartStates(hp: number): HeartState[] {
  return HEART_X.map((_, index) => {
    const remaining = hp - index * 2;
    if (remaining >= 2) return 'full';
    return remaining === 1 ? 'half' : 'empty';
  });
}

function drawHeart(ctx: CanvasRenderingContext2D, state: HeartState, x: number, y: number): void {
  const rows = HEARTS[state];
  for (const [row, line] of rows.entries()) {
    for (const [col, ch] of [...line].entries()) {
      const colour = HEART_COLOURS[ch];
      if (!colour) continue;
      ctx.fillStyle = colour;
      ctx.fillRect(x + col, y + row, 1, 1);
    }
  }
}

export interface HudState {
  hp: number;
  inventory: Inventory;
  /** 1-based, as the label shows it. */
  floor: number;
}

export function drawHud(ctx: CanvasRenderingContext2D, atlas: Atlas, state: HudState): void {
  ctx.fillStyle = PALETTE.void;
  ctx.fillRect(0, 0, VIEW_W, HUD_H);
  ctx.fillStyle = PALETTE.floor;
  ctx.fillRect(0, SEPARATOR_Y, VIEW_W, 1);

  for (const [index, heart] of heartStates(Math.min(state.hp, MAX_HP)).entries()) {
    drawHeart(ctx, heart, HEART_X[index]!, HEART_Y);
  }

  if (state.inventory.silverKeys > 0) {
    const icon = atlas.tile('pickup_key_silver');
    ctx.drawImage(icon.image, SILVER_ICON.x, SILVER_ICON.y);
    drawText(
      ctx,
      String(state.inventory.silverKeys),
      SILVER_COUNT.x,
      SILVER_COUNT.y,
      PALETTE.steel,
    );
  }

  if (state.inventory.goldKey) {
    const icon = atlas.tile('pickup_key_gold');
    ctx.drawImage(icon.image, GOLD_ICON.x, GOLD_ICON.y);
  }

  const coin = atlas.tile('pickup_coin');
  ctx.drawImage(coin.image, COIN_ICON.x, COIN_ICON.y);
  drawText(ctx, String(state.inventory.treasure), COIN_COUNT.x, COIN_COUNT.y, PALETTE.steel);

  const label = `F${state.floor}`;
  drawText(ctx, label, FLOOR_RIGHT - textWidth(label), FLOOR_Y, PALETTE.gold);
}

/** Where the floor label's glyphs land, so a test can read them without guessing. */
export function floorLabelOrigin(floor: number): { x: number; y: number } {
  return { x: FLOOR_RIGHT - textWidth(`F${floor}`), y: FLOOR_Y };
}
