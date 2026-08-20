/**
 * Pack A tile & animation manifest — hand-transcribed from ASSET_GUIDE.md §3.1 / §3.5.
 *
 * Types are the normative ones from spec/05-data-formats.md §2, with one documented
 * addition: `AnimDef.hold`, distinguishing "play once and hold the last frame" (chest
 * opening) from "play once, then the entity is gone" (crate destruction). AG §3.5 states
 * the distinction; 05 §2's type could not express it.
 *
 * Scope: exactly what the spec references — 02-entities is the checklist, plus the
 * 03-levels §1.2 legend / §1.3 auto-tiling tables, 01-mechanics §8 doors and 04-ui §1 HUD
 * icons. Unreferenced pack content (mini_box_*, candlestick_2_*, side_torch_*, Packs B
 * and E) is deliberately absent: this game uses Pack A only (00-overview).
 *
 * IMPORTANT (AG §3.5, §7 gotcha 4): trap frame *numbers* are not play order. The `frames`
 * arrays below are in PLAY order; tests/unit/packA.spec.ts locks them.
 */

import { TILE } from '../sim/constants.js';

export interface TileDef {
  id: string;
  sheet: 'tileset' | 'character';
  col: number;
  row: number;
  kind: 'terrain' | 'alpha_prop' | 'black_backed';
}

export interface AnimDef {
  id: string;
  /** Folder under `art_assets/`. */
  dir: string;
  /** File names, in PLAY order. */
  frames: string[];
  frameTicks: number;
  loop: boolean;
  /** Present only when the source files are not 16×16. */
  frameSize?: [number, number];
  /**
   * The top-left region of an oversized source file that is actually drawn, when the rest of
   * the art is not wanted. Only the arrow launcher uses it — see `TRAP_ANIMS`.
   */
  crop?: [number, number];
  /** Non-looping animations that hold their last frame instead of ending. */
  hold?: boolean;
}

/** Root of Pack A inside `art_assets/`. */
export const ART_ROOT = '2D Pixel Dungeon Asset Pack v2.0/2D Pixel Dungeon Asset Pack';

const CHARS = `${ART_ROOT}/Character_animation`;
const ITEMS = `${ART_ROOT}/items and trap_animation`;
const UI = `${ART_ROOT}/interface`;

/** `seq('peaks_', [3, 4, 2, 1])` → `['peaks_3.png', ...]` — play order stays visible. */
function seq(prefix: string, order: readonly number[]): string[] {
  return order.map((n) => `${prefix}${n}.png`);
}

const t = (id: string, col: number, row: number, kind: TileDef['kind'] = 'terrain'): TileDef => ({
  id,
  sheet: 'tileset',
  col,
  row,
  kind,
});

// ---------------------------------------------------------------------------
// Tiles — Dungeon_Tileset.png (AG §3.1)
// ---------------------------------------------------------------------------

/** Perimeter wall frame. Auto-tiling formulas: 03-levels §1.3. */
const WALL_TILES: TileDef[] = [
  t('wall_corner_tl', 0, 0),
  t('wall_top_0', 1, 0),
  t('wall_top_1', 2, 0),
  t('wall_top_2', 3, 0),
  t('wall_top_3', 4, 0),
  t('wall_corner_tr', 5, 0),
  t('wall_left_0', 0, 1),
  t('wall_left_1', 0, 2),
  t('wall_left_2', 0, 3),
  t('wall_right_0', 5, 1),
  t('wall_right_1', 5, 2),
  t('wall_right_2', 5, 3),
  t('wall_corner_bl', 0, 4),
  t('wall_bottom_0', 1, 4),
  t('wall_bottom_1', 2, 4),
  t('wall_bottom_2', 3, 4),
  t('wall_bottom_3', 4, 4),
  t('wall_corner_br', 5, 4),
  // Interior free-standing wall blocks: (1,5) for even cols, (2,5) for odd (03 §1.3).
  t('wall_face_even', 1, 5),
  t('wall_face_odd', 2, 5),
];

/**
 * Shaded interior floor, the (1..4, 1..3) block. Used positionally by 03 §1.3: row 1 if a
 * wall is above, 3 if below, else 2; col 1 if a wall is left, 4 if right, else 2 + col mod 2.
 */
const FLOOR_SHADED_TILES: TileDef[] = [1, 2, 3].flatMap((row) =>
  [1, 2, 3, 4].map((col) => t(`floor_shaded_c${col}_r${row}`, col, row)),
);

/** Plain floor variants 0–11: `v = (col*3 + row*5) mod 12` → tile `(6 + v mod 4, v div 4)` (03 §1.3). */
const FLOOR_PLAIN_TILES: TileDef[] = Array.from({ length: 12 }, (_, v) =>
  t(`floor_plain_${v}`, 6 + (v % 4), Math.floor(v / 4)),
);

/** Flat fills (AG §2.3). `void_fill` also renders unbridged pits (03 §1.2 `_`). */
const FILL_TILES: TileDef[] = [t('void_fill', 8, 7), t('floor_flat', 9, 7)];

/**
 * Doors (01-mechanics §8.1, 03 §1.2). Closed leaves are terrain; the open leaves are
 * 2-tile-tall alpha props folded against their jambs (AG §3.2).
 */
const DOOR_TILES: TileDef[] = [
  t('door_double_closed_left', 6, 3),
  t('door_double_closed_right', 7, 3),
  t('door_arch_closed_left', 6, 6),
  t('door_arch_closed_right', 7, 6),
  t('door_single_closed', 8, 3),
  t('door_leaf_center_top', 6, 4, 'alpha_prop'),
  t('door_leaf_center_bottom', 6, 5, 'alpha_prop'),
  t('door_leaf_left_top', 7, 4, 'alpha_prop'),
  t('door_leaf_left_bottom', 7, 5, 'alpha_prop'),
  t('door_leaf_right_top', 8, 4, 'alpha_prop'),
  t('door_leaf_right_bottom', 8, 5, 'alpha_prop'),
];

/** Props: ladder (02 §4.5), crates (02 §4.2), chests (02 §4.1). */
const PROP_TILES: TileDef[] = [
  t('ladder', 9, 3, 'black_backed'),
  // Pushable crate — and the same art drawn as floor once it has bridged a pit (02 §4.2).
  t('crate_push', 9, 4, 'alpha_prop'),
  t('crate_wood', 0, 8, 'alpha_prop'),
  t('crate_steel', 1, 8, 'alpha_prop'),
  t('chest_large', 4, 8, 'alpha_prop'),
  t('chest_mini', 5, 8, 'alpha_prop'),
];

/** Pickups (02 §5); coin / silver key / gold key double as HUD icons (04-ui §1). */
const PICKUP_TILES: TileDef[] = [
  t('pickup_coin', 6, 8, 'alpha_prop'),
  t('pickup_flask_blue_small', 7, 8, 'alpha_prop'),
  t('pickup_key_silver', 8, 8, 'alpha_prop'),
  t('pickup_flask_red_small', 9, 8, 'alpha_prop'),
  t('pickup_flask_blue_large', 7, 9, 'alpha_prop'),
  t('pickup_flask_red_large', 8, 9, 'alpha_prop'),
  t('pickup_key_gold', 9, 9, 'alpha_prop'),
];

/** Lights (02 §4.3). Candlestick A is the puzzle torch `u`: unlit (4,9) → lit (3,9). */
const LIGHT_TILES: TileDef[] = [
  t('torch_wall_lit', 0, 9, 'alpha_prop'),
  t('torch_bracket_unlit', 2, 9, 'alpha_prop'),
  t('candlestick_a_lit', 3, 9, 'alpha_prop'),
  t('candlestick_a_unlit', 4, 9, 'alpha_prop'),
];

/** Decor (02 §4.4) — no collision, no logic; rooms list exactly what they place. */
const DECOR_TILES: TileDef[] = [
  t('decor_bones', 4, 6, 'alpha_prop'),
  t('decor_bone_fragment', 5, 6, 'alpha_prop'),
  t('decor_bones_crossed', 8, 6, 'alpha_prop'),
  t('decor_shield', 4, 7, 'alpha_prop'),
  t('decor_shackle', 5, 7, 'alpha_prop'),
  t('decor_skull_bone', 7, 7, 'alpha_prop'),
];

export const TILES: readonly TileDef[] = [
  ...WALL_TILES,
  ...FLOOR_SHADED_TILES,
  ...FLOOR_PLAIN_TILES,
  ...FILL_TILES,
  ...DOOR_TILES,
  ...PROP_TILES,
  ...PICKUP_TILES,
  ...LIGHT_TILES,
  ...DECOR_TILES,
];

// ---------------------------------------------------------------------------
// Animations — Character_animation/, items and trap_animation/, interface/ (AG §3.4–§3.6)
// ---------------------------------------------------------------------------

/**
 * Idle loops, 8 ticks/frame. While moving, the renderer plays the same loop at 5
 * ticks/frame (02 §1.1, §2.1) — a rate override, not a second animation.
 *
 * AG §3.4 gotcha: `v1`/`v2` mean opposite things in the two folders. The plain
 * (unbracketed) variant is `v1` for priests and `v2` for monsters. The game always wants
 * plain.
 */
const IDLE_ANIMS: AnimDef[] = [
  {
    id: 'player_idle',
    dir: `${CHARS}/priests_idle/priest1/v1`,
    frames: seq('priest1_v1_', [1, 2, 3, 4]),
    frameTicks: 8,
    loop: true,
  },
  {
    id: 'skel_sword_idle',
    dir: `${CHARS}/monsters_idle/skeleton1/v2`,
    frames: seq('skeleton_v2_', [1, 2, 3, 4]),
    frameTicks: 8,
    loop: true,
  },
  {
    id: 'skel_axe_idle',
    dir: `${CHARS}/monsters_idle/skeleton2/v2`,
    frames: seq('skeleton2_v2_', [1, 2, 3, 4]),
    frameTicks: 8,
    loop: true,
  },
  {
    id: 'zombie_idle',
    dir: `${CHARS}/monsters_idle/vampire/v2`,
    frames: seq('vampire_v2_', [1, 2, 3, 4]),
    frameTicks: 8,
    loop: true,
  },
  {
    id: 'wisp_idle',
    dir: `${CHARS}/monsters_idle/skull/v2`,
    frames: seq('skull_v2_', [1, 2, 3, 4]),
    frameTicks: 8,
    loop: true,
  },
];

/** Chests (02 §4.1): OPENING lasts 16 ticks = 4 frames × 4 ticks, then holds frame 4. */
const CHEST_ANIMS: AnimDef[] = [
  {
    id: 'chest_idle',
    dir: `${ITEMS}/chest`,
    frames: seq('chest_', [1, 2, 3, 4]),
    frameTicks: 8,
    loop: true,
  },
  {
    id: 'chest_open',
    dir: `${ITEMS}/chest`,
    frames: seq('chest_open_', [1, 2, 3, 4]),
    frameTicks: 4,
    loop: false,
    hold: true,
  },
  {
    id: 'mini_chest_idle',
    dir: `${ITEMS}/mini_chest`,
    frames: seq('mini_chest_', [1, 2, 3, 4]),
    frameTicks: 8,
    loop: true,
  },
  {
    id: 'mini_chest_open',
    dir: `${ITEMS}/mini_chest`,
    frames: seq('mini_chest_open_', [1, 2, 3, 4]),
    frameTicks: 4,
    loop: false,
    hold: true,
  },
];

/** Destructible crates (02 §4.2): DESTROYING lasts 12 ticks = 4 frames × 3 ticks, then removed. */
const CRATE_ANIMS: AnimDef[] = [
  {
    id: 'crate_wood_destroy',
    dir: `${ITEMS}/box_2`,
    frames: seq('box_2_', [1, 2, 3, 4]),
    frameTicks: 3,
    loop: false,
  },
  {
    id: 'crate_steel_destroy',
    dir: `${ITEMS}/box_1`,
    frames: seq('box_1_', [1, 2, 3, 4]),
    frameTicks: 3,
    loop: false,
  },
];

/** Pickup spins and shimmer (02 §5), plus the decor banner `w` (02 §4.4). */
const PICKUP_ANIMS: AnimDef[] = [
  {
    id: 'coin_spin',
    dir: `${ITEMS}/coin`,
    frames: seq('coin_', [1, 2, 3, 4]),
    frameTicks: 8,
    loop: true,
  },
  {
    id: 'key_gold_spin',
    dir: `${ITEMS}/keys`,
    frames: seq('keys_1_', [1, 2, 3, 4]),
    frameTicks: 8,
    loop: true,
  },
  {
    id: 'key_silver_spin',
    dir: `${ITEMS}/keys`,
    frames: seq('keys_2_', [1, 2, 3, 4]),
    frameTicks: 8,
    loop: true,
  },
  {
    id: 'flask_red_small',
    dir: `${ITEMS}/flasks`,
    frames: seq('flasks_1_', [1, 2, 3, 4]),
    frameTicks: 8,
    loop: true,
  },
  {
    id: 'flask_blue_small',
    dir: `${ITEMS}/flasks`,
    frames: seq('flasks_2_', [1, 2, 3, 4]),
    frameTicks: 8,
    loop: true,
  },
  {
    id: 'flask_blue_large',
    dir: `${ITEMS}/flasks`,
    frames: seq('flasks_3_', [1, 2, 3, 4]),
    frameTicks: 8,
    loop: true,
  },
  {
    id: 'flask_red_large',
    dir: `${ITEMS}/flasks`,
    frames: seq('flasks_4_', [1, 2, 3, 4]),
    frameTicks: 8,
    loop: true,
  },
  {
    id: 'banner',
    dir: `${ITEMS}/flag`,
    frames: seq('flag_', [1, 2, 3, 4]),
    frameTicks: 8,
    loop: true,
  },
];

/** Lights (02 §4.3): decor torch `t`, and the lit state of puzzle torch `u`. */
const LIGHT_ANIMS: AnimDef[] = [
  {
    id: 'torch_wall',
    dir: `${ITEMS}/torch`,
    frames: seq('torch_', [1, 2, 3, 4]),
    frameTicks: 8,
    loop: true,
  },
  {
    id: 'candlestick_a_lit',
    dir: `${ITEMS}/torch`,
    frames: seq('candlestick_1_', [1, 2, 3, 4]),
    frameTicks: 8,
    loop: true,
  },
];

/**
 * Traps (02 §3). Frame numbers are NOT play order (AG §3.5) — these arrays are corrected:
 *   peaks         retracted→extended   3 → 4 → 2 → 1
 *   arrow         idle→fire            2 → 3 → 4 → 1   (16×32, emitter hole in the wall cell)
 *   flamethrower  off→full             4 → 3 → 1 → 2   (the empty frame is 4)
 *
 * The sim drives which frame shows from the trap phase (02 §3); `frameTicks` is the rate
 * for the one-shot sequences — the arrow's 4 × 3 = the 12 ticks after firing.
 *
 * The arrow launcher is `crop`ped to its top 16×16 (02 §3.2). Its 16×32 source frames carry a
 * *baked-in* bolt travelling through the tile below the emitter, and the sim already flies the
 * real bolt (`Just_arrow`) down that lane — drawing both put two arrows in the lane, twelve
 * ticks of them smearing over whatever stood there. Only the emitter hole is wanted; the
 * bolt-head peeking out of it on frame `arrow_3` is the muzzle flash.
 */
const TRAP_ANIMS: AnimDef[] = [
  {
    id: 'spike',
    dir: `${ITEMS}/peaks`,
    frames: seq('peaks_', [3, 4, 2, 1]),
    frameTicks: 6,
    loop: false,
    hold: true,
  },
  {
    id: 'arrow_launcher',
    dir: `${ITEMS}/arrow`,
    frames: seq('arrow_', [2, 3, 4, 1]),
    frameTicks: 3,
    loop: false,
    frameSize: [16, 32],
    crop: [16, 16],
  },
  {
    id: 'bolt',
    dir: `${ITEMS}/arrow`,
    frames: ['Just_arrow.png'],
    frameTicks: 1,
    loop: false,
    hold: true,
  },
  {
    id: 'flame_down',
    dir: `${ITEMS}/flamethrower`,
    frames: seq('flamethrower_1_', [4, 3, 1, 2]),
    frameTicks: 4,
    loop: false,
    hold: true,
    frameSize: [16, 32],
  },
  {
    id: 'flame_side',
    dir: `${ITEMS}/flamethrower`,
    frames: seq('flamethrower_2_', [4, 3, 1, 2]),
    frameTicks: 4,
    loop: false,
    hold: true,
    frameSize: [32, 16],
  },
];

/** Wave spawn telegraph: the square_up_down cursor loops on the spawn tile for 30 ticks (02 §2.3). */
const UI_ANIMS: AnimDef[] = [
  {
    id: 'spawn_cursor',
    dir: UI,
    frames: seq('square_up_down_', [1, 2, 3, 4]),
    frameTicks: 6,
    loop: true,
  },
];

export const ANIMS: readonly AnimDef[] = [
  ...IDLE_ANIMS,
  ...CHEST_ANIMS,
  ...CRATE_ANIMS,
  ...PICKUP_ANIMS,
  ...LIGHT_ANIMS,
  ...TRAP_ANIMS,
  ...UI_ANIMS,
];

const TILES_BY_ID = new Map(TILES.map((def) => [def.id, def]));
const ANIMS_BY_ID = new Map(ANIMS.map((def) => [def.id, def]));

export function tile(id: string): TileDef {
  const found = TILES_BY_ID.get(id);
  if (!found) throw new Error(`packA: unknown tile id "${id}"`);
  return found;
}

export function anim(id: string): AnimDef {
  const found = ANIMS_BY_ID.get(id);
  if (!found) throw new Error(`packA: unknown animation id "${id}"`);
  return found;
}

/**
 * How big one frame of an animation is once loaded — the `crop` if there is one, otherwise the
 * source size, otherwise a tile. Both loader modes size their canvas by this, so real art and
 * placeholder art always produce the same shape (loader.ts).
 */
export function frameDrawSize(def: AnimDef): [number, number] {
  return def.crop ?? def.frameSize ?? [TILE, TILE];
}
