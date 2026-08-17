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

// ---------------------------------------------------------------------------
// Player — 01-mechanics §3.3 (movement), §4.1 (states), §5.1 (health)
// ---------------------------------------------------------------------------

/** 20 subpx/tick = 1.25 px/tick = 75 px/s. (01 §3.3) */
export const WALK_SPEED = 20;

/**
 * Diagonal factor: `v_axis = (v * 181) >> 8` (00-overview §Determinism rule 3).
 * Applied to the magnitude — `>>` floors toward −∞, so signing first would make left and
 * up faster than right and down. See `diagAxis()` in movement code.
 */
export const DIAG_NUM = 181;
export const DIAG_SHIFT = 8;

/** Player "feet box": 10 × 8 px at offset (3, 8) from the sprite cell's top-left. (01 §3.3) */
export const PLAYER_BOX = { offX: 3, offY: 8, w: 10, h: 8 } as const;

/** HUD shows 3 hearts at half-heart granularity. (01 §5.1) */
export const MAX_HP = 6;

/** Invulnerability after any damage. (01 §5.1) */
export const IFRAME_TICKS = 60;

/** Player state durations. (01 §4.1) — the transitions themselves land with combat, M3. */
export const SWING_TICKS = 14;
export const HURT_TICKS = 12;
export const DYING_TICKS = 60;

/** Sim freeze when a swing connects; skips phases 3–9. (01 §1, §4.2) */
export const HIT_STOP_TICKS = 3;

// ---------------------------------------------------------------------------
// Rooms, doors, transitions — 01-mechanics §6, §8
// ---------------------------------------------------------------------------

/** Camera slide between rooms; the sim is suspended throughout. (01 §8.2) */
export const TRANSITION_TICKS = 24;

/** A normal door opens when the player's hitbox centre is this close to its centre. (01 §8.1) */
export const DOOR_OPEN_RADIUS_PX = 24;

/** UP must be held this long on the tile below a ladder to end the floor. (01 §8.4) */
export const LADDER_HOLD_TICKS = 12;

/** Fade out, then in, around a floor change. (01 §8.4) */
export const FLOOR_FADE_TICKS = 30;

/** Black screen between the death animation and the respawn. (01 §6) */
export const DEATH_BLACK_TICKS = 30;

/** Respawning restores at least this much HP. (01 §6) */
export const RESPAWN_MIN_HP = 4;

// ---------------------------------------------------------------------------
// Enemies — 02-entities §2.2
// ---------------------------------------------------------------------------

/**
 * Per-type stats. M2 only needs `hp`, so inert enemies carry real health into the state
 * hash; the behaviour that uses `speed` and `contactDamage` arrives with M3.
 */
export const ENEMY_STATS = {
  skel_sword: { hp: 2, speed: 12, contactDamage: 1 },
  skel_axe: { hp: 4, speed: 8, contactDamage: 2 },
  zombie: { hp: 3, speed: 7, contactDamage: 1 },
  wisp: { hp: 1, speed: 16, contactDamage: 1 },
} as const;
