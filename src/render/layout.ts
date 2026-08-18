/**
 * Where things sit on the 320×208 screen — 00-overview's global constants, as arithmetic.
 *
 * The HUD owns the top 16 px; the play area below it is exactly 20×12 tiles, and every room
 * is centred in it with void around the edges. Nothing here draws.
 */

import { HUD_H, PLAY_H, TILE, VIEW_W } from '../sim/constants.js';

export interface Origin {
  ox: number;
  oy: number;
}

/** Top-left of a room's tile grid on screen (00-overview: rooms are always centred). */
export function roomOrigin(room: { w: number; h: number }): Origin {
  return {
    ox: Math.floor((VIEW_W - room.w * TILE) / 2),
    oy: HUD_H + Math.floor((PLAY_H - room.h * TILE) / 2),
  };
}
