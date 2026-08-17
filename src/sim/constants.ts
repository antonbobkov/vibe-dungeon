/**
 * Engine-wide constants — the single source of truth, transcribed from
 * spec/00-overview.md §Global constants.
 *
 * Gameplay numbers (speeds, HP, damage, timings) live beside them in this directory as
 * later milestones add them; every one of them must cite its spec section the same way.
 */

/** Fixed timestep: all timing in the spec is in ticks. (00-overview §Global constants) */
export const TICK_RATE = 60;

/** Grid size in pixels; matches Pack A. (00-overview §Global constants, AG §0) */
export const TILE = 16;

/** Subpixels per pixel. All sim positions/velocities are integers in subpixels. */
export const SUBPX = 16;

/** 1 tile = 256 subpx. (00-overview §Coordinate conventions) */
export const TILE_SUBPX = TILE * SUBPX;

/** Canvas logical resolution. (00-overview §Global constants) */
export const VIEW_W = 320;
export const VIEW_H = 208;

/** HUD strip at the top of the viewport. (04-ui §1) */
export const HUD_H = 16;

/** Play area below the HUD = 20 × 12 tiles. */
export const PLAY_W = 320;
export const PLAY_H = 192;

/** Room size bounds in tiles, including walls. (00-overview, 03-levels §1.1) */
export const ROOM_MAX_W = 20;
export const ROOM_MAX_H = 12;
export const ROOM_MIN_W = 5;
export const ROOM_MIN_H = 4;

/** Universal void colour; fills space around rooms smaller than the play area. (AG §2.3) */
export const CLEAR_COLOR = '#25131a';
