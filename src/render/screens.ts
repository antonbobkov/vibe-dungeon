/**
 * The screens — spec/04-ui.md §3: title, death, victory and the pause overlay.
 *
 * Each is a function of one number (a tick) and, where it needs one, the finished run's
 * numbers. Nothing here keeps state; the shell in `src/app.ts` decides which to draw.
 */

import type { Atlas } from '../assets/loader.js';
import { anim } from '../assets/packA.js';
import { HUD_H, PLAY_H, TICK_RATE, TILE, VIEW_H, VIEW_W } from '../sim/constants.js';
import { frameIndex } from './anim.js';
import { centredX, drawText } from './font.js';
import { PALETTE } from './palette.js';

/** 04-ui §3.1: the prompt is on for 30 ticks and off for 30. */
export const TITLE_BLINK_TICKS = 30;
/** 04-ui §3.1: ATTACK fades to black over 30 ticks before floor 1 fades in. */
export const TITLE_FADE_TICKS = 30;
/** 04-ui §3.3: the victory sequence holds 60 ticks on the chest, then fades over 60. */
export const VICTORY_HOLD_TICKS = 60;
export const VICTORY_FADE_TICKS = 60;

/** The whole coin economy (03 §6), which the victory screen reports the run against. */
export const TREASURE_TOTAL = 83;

const TITLE_TEXT = 'UNDERVAULT';
const TITLE_PROMPT = 'PRESS X TO BEGIN';
const TITLE_CONTROLS = 'ARROWS OR WASD TO MOVE   X SWING   Z USE';

function scaled(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
): void {
  ctx.drawImage(image, x, y, w * scale, h * scale);
}

/** 04-ui §3.1. The knight idles between two lit wall torches. */
export function drawTitle(ctx: CanvasRenderingContext2D, atlas: Atlas, tick: number): void {
  ctx.fillStyle = PALETTE.void;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  drawText(ctx, TITLE_TEXT, centredX(TITLE_TEXT, VIEW_W, 3), 48, PALETTE.gold, 3);

  const knight = anim('player_idle');
  scaled(
    ctx,
    atlas.frame(knight.id, frameIndex(knight, tick)).image,
    Math.floor((VIEW_W - TILE * 2) / 2),
    92,
    TILE,
    TILE,
    2,
  );

  const torch = anim('torch_wall');
  const frame = atlas.frame(torch.id, frameIndex(torch, tick));
  ctx.drawImage(frame.image, 124, 92);
  ctx.drawImage(frame.image, 180, 92);

  if (Math.floor(tick / TITLE_BLINK_TICKS) % 2 === 0) {
    drawText(ctx, TITLE_PROMPT, centredX(TITLE_PROMPT, VIEW_W), 150, PALETTE.steel);
  }
  drawText(ctx, TITLE_CONTROLS, centredX(TITLE_CONTROLS, VIEW_W), 172, PALETTE.steelDark);
}

/** 04-ui §3.2: shown over the 30 ticks of black the respawn takes (01 §6). */
export function drawDeath(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = PALETTE.void;
  ctx.fillRect(0, HUD_H, VIEW_W, PLAY_H);
  const text = 'YOU FELL';
  drawText(ctx, text, centredX(text, VIEW_W, 2), HUD_H + 88, PALETTE.red, 2);
}

export interface RunStats {
  playTicks: number;
  deaths: number;
  treasure: number;
}

/** `TIME MM:SS` from play ticks (04-ui §3.3: ticks ÷ 60 → seconds, zero-padded). */
export function formatTime(playTicks: number): string {
  const seconds = Math.floor(playTicks / TICK_RATE);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `TIME ${mm}:${ss}`;
}

export function statLines(stats: RunStats): string[] {
  return [
    formatTime(stats.playTicks),
    `DEATHS ${stats.deaths}`,
    `TREASURE ${stats.treasure}/${TREASURE_TOTAL}`,
  ];
}

/** 04-ui §3.3, after the hold and the fade. */
export function drawVictory(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  stats: RunStats,
  tick: number,
): void {
  ctx.fillStyle = PALETTE.void;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const heading = 'THE VAULT IS YOURS';
  drawText(ctx, heading, centredX(heading, VIEW_W, 2), 56, PALETTE.gold, 2);

  const knight = anim('player_idle');
  scaled(
    ctx,
    atlas.frame(knight.id, frameIndex(knight, tick)).image,
    Math.floor((VIEW_W - TILE * 2) / 2),
    84,
    TILE,
    TILE,
    2,
  );

  const key = anim('key_gold_spin');
  ctx.drawImage(atlas.frame(key.id, frameIndex(key, tick)).image, Math.floor(VIEW_W / 2) + 24, 92);

  for (const [index, line] of statLines(stats).entries()) {
    drawText(ctx, line, centredX(line, VIEW_W), 116 + index * 12, PALETTE.steel);
  }

  const thanks = 'THANKS FOR PLAYING';
  drawText(ctx, thanks, centredX(thanks, VIEW_W), 168, PALETTE.steelDark);
}

/**
 * 04-ui §3.4: the frozen frame with every other pixel row darkened, and `PAUSED` over it.
 * Dimming rows rather than the whole screen keeps the art readable underneath.
 */
export function drawPause(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(37, 19, 26, 0.6)';
  for (let y = 0; y < VIEW_H; y += 2) ctx.fillRect(0, y, VIEW_W, 1);

  const text = 'PAUSED';
  drawText(ctx, text, centredX(text, VIEW_W, 2), 96, PALETTE.gold, 2);
}

/** A black curtain at `alpha`, for the title, floor and victory fades. */
export function drawFade(ctx: CanvasRenderingContext2D, alpha: number): void {
  if (alpha <= 0) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.fillStyle = PALETTE.void;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.globalAlpha = 1;
}
