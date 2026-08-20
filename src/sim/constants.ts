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

// ---------------------------------------------------------------------------
// Combat — 01-mechanics §4.2, §5; 02-entities §2
// ---------------------------------------------------------------------------

/** The swing's active window, in ticks elapsed since it began (01 §4.2). */
export const SWING_ACTIVE_FIRST = 3;
export const SWING_ACTIVE_LAST = 9;
/** Movement is locked for the first ten ticks of a swing, free for the last four (01 §4.1). */
export const SWING_LOCKED_UNTIL = 9;

/** Sword hitbox: 16 × 16 px, offset from the sprite cell by facing (01 §4.2). */
export const SWORD_BOX = { offX: 0, offY: 0, w: TILE, h: TILE } as const;
export const SWORD_REACH_PX = 14;
export const SWORD_DAMAGE = 1;

/** Knockback the sword deals, and the hitstun that comes with it (01 §4.2). */
export const ENEMY_KNOCKBACK = 48;
export const ENEMY_KNOCKBACK_DECAY = 6;
export const ENEMY_HITSTUN = 8;

/** Resistant enemies — skel_axe and zombie — barely flinch (02 §2.2). */
export const RESISTANT_KNOCKBACK = 24;
export const RESISTANT_HITSTUN = 4;

/** Player knockback: 48 decaying by 4 is 12 ticks and 312 subpx ≈ 19 px (01 §5.2). */
export const PLAYER_KNOCKBACK = 48;
export const PLAYER_KNOCKBACK_DECAY = 4;

/** Input is ignored for the first six ticks of HURT's twelve (01 §4.1). */
export const HURT_INPUT_LOCK = 6;

/** An enemy's death: 2 ticks of white flash, then 10 of fade (02 §2.1). */
export const ENEMY_DEATH_FLASH = 2;
export const ENEMY_DEATH_FADE = 10;
export const ENEMY_DEATH_TICKS = ENEMY_DEATH_FLASH + ENEMY_DEATH_FADE;

/** Enemy hitboxes (02 §2.1). Grounded means both skeletons and the zombie. */
export const ENEMY_BOX_GROUND = { offX: 2, offY: 6, w: 12, h: 10 } as const;
export const ENEMY_BOX_WISP = { offX: 3, offY: 3, w: 10, h: 10 } as const;

/** Chase steering only goes diagonal when both axes exceed this deadzone (02 §2.1). */
export const CHASE_DIAGONAL_DEADZONE = 8;

/** Enemy separation pushes overlapping pairs apart by this much per tick (02 §2.1). */
export const SEPARATION_PUSH = 4;

/** LOS samples one point per this many pixels of distance (02 §2.1). */
export const LOS_SAMPLE_PX = 8;

/** skel_sword's attack cycle (02 §2.2). */
export const SKEL_SWORD_AGGRO_PX = 112;
export const SKEL_SWORD_WINDUP_RANGE_PX = 24;
export const SKEL_SWORD_WINDUP_TICKS = 24;
export const SKEL_SWORD_LUNGE_TICKS = 12;
export const SKEL_SWORD_LUNGE_SPEED = 40;
export const SKEL_SWORD_RECOVER_TICKS = 18;

/** skel_axe aggroes further out and never needs line of sight (02 §2.2). */
export const SKEL_AXE_AGGRO_PX = 144;

/** The wisp's perpendicular wobble (02 §2.4). */
export const WISP_AGGRO_PX = 112;
export const WISP_WOBBLE_AMPLITUDE = 12;
export const WISP_WOBBLE_SHIFT = 6;
/** Ticks per step through the SIN table. */
export const WISP_WOBBLE_PERIOD = 4;
/** The integer sine table of 02 §2.4, verbatim. */
export const SIN = [0, 24, 45, 59, 64, 59, 45, 24, 0, -24, -45, -59, -64, -59, -45, -24] as const;

// ---------------------------------------------------------------------------
// Traps — 02-entities §3
// ---------------------------------------------------------------------------

/** The deadly window is the last two fifths of the cycle: `phase >= (3 * period) / 5`. */
export const TRAP_DEADLY_NUM = 3;
export const TRAP_DEADLY_DEN = 5;

/** Every trap deals one point of damage (01 §5.1). */
export const TRAP_DAMAGE = 1;

/** A bolt: 4 × 10 px centred in its 16-wide lane, falling 40 subpx/tick (02 §3.2). */
export const BOLT_BOX = { offX: 6, offY: 0, w: 4, h: 10 } as const;
export const BOLT_SPEED = 40;

// ---------------------------------------------------------------------------
// Props — 02-entities §4
// ---------------------------------------------------------------------------

/** A chest takes 16 ticks to open, then hands over its contents (02 §4.1). */
export const CHEST_OPEN_TICKS = 16;

/** A crate takes 12 ticks to come apart, then leaves its drop (02 §4.2). */
export const CRATE_DESTROY_TICKS = 12;

/** Six consecutive contact ticks charge a push; the slide itself takes twelve (02 §4.2). */
export const PUSH_CHARGE_TICKS = 6;
export const PUSH_SLIDE_TICKS = 12;

// ---------------------------------------------------------------------------
// Waves and seals — 02-entities §2.3, 01-mechanics §8.3
// ---------------------------------------------------------------------------

/**
 * Spawn protection (02 §2.1): a map enemy whose spawn-tile centre is closer than this to
 * where the player's hitbox centre lands on room entry does not appear at once — it goes
 * through the telegraph + blink-in of 02 §2.3 instead. 48 px is three tiles.
 */
export const ENTRY_SAFE_RADIUS = 48;

/** A spawn cursor blinks on the tile for 30 ticks before anything appears (02 §2.3). */
export const SPAWN_TELEGRAPH_TICKS = 30;
/** Then the enemy blinks in for 12, inactive and unhittable. */
export const SPAWN_BLINK_TICKS = 12;
/** The next wave follows 30 ticks after the last of the previous one dies. */
export const WAVE_GAP_TICKS = 30;
