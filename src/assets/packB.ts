/**
 * Theme B — a partial re-skin from Pack B (*2D Dungeon Asset Pack v5.2*) and Pack E
 * (*Enemy_Animations_Set*), behind the `?theme=b` flag.
 *
 * This is **not** a second manifest. It is a table of overrides keyed by the Pack A ids in
 * [packA.ts](packA.ts): where an id appears here the loader draws Pack B's art for it, and
 * where it does not the game keeps Pack A's. Nothing downstream knows the difference — the
 * auto-tiler, the sprite chooser and the HUD all still speak in the same ids — so turning the
 * theme off is one URL parameter and deleting this file would leave the game intact.
 *
 * ## What is deliberately not here
 *
 * Pack B has no doors, no hero, no floor candlestick, no arrow or flame trap, no crate
 * destruction and no cursor set; Pack E has no wisp. Those ids are absent below and keep
 * their Pack A art, which is the whole reason this is a *partial* migration: a themed run
 * mixes the two palettes (AG §2.4 puts A ∩ B at three colours), and that is expected until
 * the gaps are filled.
 *
 * ## Frame counts
 *
 * Pack A ships one file per frame; B and E ship horizontal strips, often with more frames
 * than the manifest declares. The loader always builds exactly as many frames as the Pack A
 * `AnimDef` has — `pick` when the order matters, otherwise spread evenly across the strip —
 * so every timing in the game is untouched by the theme.
 */

/** Roots under `art_assets/`, both nested one level deeper than their zip name suggests. */
export const PACK_B_ROOT = '2D Dungeon Asset Pack_v5.2/2D Dungeon Asset Pack_v5.2';
export const PACK_E_ROOT = 'Enemy_Animations_Set/Enemy_Animations_Set';

const TILESET_B = `${PACK_B_ROOT}/character and tileset/Dungeon_Tileset_v2.png`;
const PROPS_B = `${PACK_B_ROOT}/character and tileset/Dungeon_item_props_v2.png`;
const ITEMS_B = `${PACK_B_ROOT}/items_animation`;

export const THEME_B_SHEETS = { tilesetB: TILESET_B, propsB: PROPS_B } as const;
export type SheetB = keyof typeof THEME_B_SHEETS;

/** One 16×16 cell of a Pack B sheet. */
export interface CellSource {
  sheet: SheetB;
  col: number;
  row: number;
}

/** A horizontal strip of frames — how Pack B and Pack E ship every animation. */
export interface StripSource {
  file: string;
  /** Frames in the strip, for slicing and for checking the file is what we think. */
  frames: number;
  /** When the frame is not 16×16. */
  frameSize?: [number, number];
  /** Which strip frames to use, in play order. Without it the frames are spread evenly. */
  pick?: number[];
  /** Whole-pixel nudge, for art that overshoots its tile. */
  drawOffset?: [number, number];
}

export type AnimSource = StripSource | CellSource;

export const isStrip = (source: AnimSource): source is StripSource => 'file' in source;

const b = (col: number, row: number): CellSource => ({ sheet: 'tilesetB', col, row });
const p = (col: number, row: number): CellSource => ({ sheet: 'propsB', col, row });

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

/**
 * Pack B's room frame sits on exactly the cells Pack A's does (AG §4.1: "identical structure
 * to Pack A"), so the 03 §1.3 auto-tiling formulas need no changes at all — the walls and the
 * shaded interior block are a straight swap.
 */
const FRAME: Record<string, CellSource> = {
  wall_corner_tl: b(0, 0),
  wall_corner_tr: b(5, 0),
  wall_corner_bl: b(0, 4),
  wall_corner_br: b(5, 4),
  wall_top_0: b(1, 0),
  wall_top_1: b(2, 0),
  wall_top_2: b(3, 0),
  wall_top_3: b(4, 0),
  wall_bottom_0: b(1, 4),
  wall_bottom_1: b(2, 4),
  wall_bottom_2: b(3, 4),
  wall_bottom_3: b(4, 4),
  wall_left_0: b(0, 1),
  wall_left_1: b(0, 2),
  wall_left_2: b(0, 3),
  wall_right_0: b(5, 1),
  wall_right_1: b(5, 2),
  wall_right_2: b(5, 3),
  // Pack A's plain interior faces have no Pack B twin; row 5's stained faces are the closest,
  // and being a matched left/right pair they read as one wall rather than as two accidents.
  wall_face_even: b(0, 5),
  wall_face_odd: b(1, 5),

  void_fill: b(4, 6),
  floor_flat: b(8, 3),
};

/** The shaded 4×3 interior block, same cells in both packs. */
const SHADED_FLOOR: Record<string, CellSource> = Object.fromEntries(
  [1, 2, 3].flatMap((row) =>
    [1, 2, 3, 4].map((col) => [`floor_shaded_c${col}_r${row}`, b(col, row)]),
  ),
);

/**
 * Plain floor. Pack A's twelve variants are a formula over cells (6..9, 0..2); in Pack B four
 * of those are the shadow-bordered patch, which would draw a hard edge in the middle of a
 * room. These are Pack B's ten genuinely plain floors plus the clean centre of its bordered
 * ring (AG §4.1 recommends exactly those two for large areas), in the same variant order.
 */
const PLAIN_FLOOR_CELLS: [number, number][] = [
  [6, 0],
  [7, 0],
  [6, 1],
  [7, 1],
  [7, 5],
  [8, 5],
  [9, 5],
  [7, 6],
  [8, 6],
  [9, 6],
  [7, 3],
  [8, 3],
];

const PLAIN_FLOOR: Record<string, CellSource> = Object.fromEntries(
  PLAIN_FLOOR_CELLS.map(([col, row], v) => [`floor_plain_${v}`, b(col, row)]),
);

/** Props and pickups, all from the 12×5 prop sheet (AG §4.2). */
const PROPS: Record<string, CellSource> = {
  ladder: p(0, 4),
  // Pack B has no steel crate; the barrel is its other breakable-looking container.
  crate_push: p(7, 2),
  crate_wood: p(4, 2),
  crate_steel: p(4, 4),
  chest_large: p(6, 2),
  chest_mini: p(5, 2),

  pickup_coin: p(3, 3),
  pickup_key_silver: p(8, 4),
  pickup_key_gold: p(9, 4),
  pickup_flask_red_small: p(8, 3),
  pickup_flask_red_large: p(9, 3),
  pickup_flask_blue_small: p(8, 2),
  pickup_flask_blue_large: p(9, 2),

  decor_bones: p(2, 4),
  decor_bone_fragment: p(2, 4),
  decor_bones_crossed: p(2, 3),
  decor_skull_bone: p(2, 3),
  decor_shield: p(1, 3),

  // The lit wall torch's still frame; its unlit bracket and both candlesticks have no Pack B
  // equivalent and stay on Pack A.
  torch_wall_lit: b(3, 8),
};

export const TILE_OVERRIDES: Readonly<Record<string, CellSource>> = {
  ...FRAME,
  ...SHADED_FLOOR,
  ...PLAIN_FLOOR,
  ...PROPS,
};

// ---------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------

/** Pack E bodies sit at x7..x23, y14..y29 inside their 32×32 frame (AG §5). */
const ENEMY_FRAME: [number, number] = [32, 32];
const ENEMY_OFFSET: [number, number] = [-7, -14];

const enemy = (file: string, frames: number): StripSource => ({
  file: `${PACK_E_ROOT}/${file}`,
  frames,
  frameSize: ENEMY_FRAME,
  drawOffset: ENEMY_OFFSET,
});

export const ANIM_OVERRIDES: Readonly<Record<string, AnimSource>> = {
  // Items — Pack B's strips are longer than Pack A's loops, so they are spread evenly.
  coin_spin: { file: `${ITEMS_B}/coin.png`, frames: 8 },
  key_gold_spin: { file: `${ITEMS_B}/keys_g.png`, frames: 8 },
  key_silver_spin: { file: `${ITEMS_B}/keys_m.png`, frames: 8 },
  banner: { file: `${ITEMS_B}/flag_r.png`, frames: 10 },

  // Chests: Pack B animates the opening but has no closed-idle shimmer, so the idle holds the
  // strip's first frame — a still, closed chest.
  chest_open: { file: `${ITEMS_B}/chest_1.png`, frames: 4 },
  mini_chest_open: { file: `${ITEMS_B}/chest_2.png`, frames: 4 },
  chest_idle: { file: `${ITEMS_B}/chest_1.png`, frames: 4, pick: [0, 0, 0, 0] },
  mini_chest_idle: { file: `${ITEMS_B}/chest_2.png`, frames: 4, pick: [0, 0, 0, 0] },

  // Spikes: five frames, retracted → extended, already in play order (unlike Pack A's, AG
  // §3.5). Four of them keep the renderer's dormant / telegraph ×2 / deadly mapping exact.
  spike: { file: `${ITEMS_B}/peaks.png`, frames: 5, pick: [0, 1, 3, 4] },

  // The wall torch's flame overshoots its tile: 28 px tall, anchored by its bowl.
  torch_wall: {
    file: `${ITEMS_B}/torch.png`,
    frames: 6,
    frameSize: [16, 28],
    drawOffset: [0, -12],
  },

  // Flasks have no Pack B animation; their prop-sheet stills stand in, so they stop
  // shimmering under this theme.
  flask_red_small: p(8, 3),
  flask_red_large: p(9, 3),
  flask_blue_small: p(8, 2),
  flask_blue_large: p(9, 2),

  // Pack E — the three enemies it animates. The wisp has none, and keeps Pack A's skull.
  skel_sword_idle: enemy('enemies-skeleton1_idle.png', 6),
  skel_axe_idle: enemy('enemies-skeleton2_idle.png', 6),
  zombie_idle: enemy('enemies-vampire_idle.png', 6),
};

/** Ids left on Pack A on purpose, with the reason — the checklist for finishing the job. */
export const NOT_MIGRATED: Readonly<Record<string, string>> = {
  player_idle: 'neither pack has a hero sprite',
  wisp_idle: 'Pack E animates three enemies; the flaming skull is not one of them',
  door_double_closed_left: 'Pack B has no door art at all (gate.png is the candidate)',
  door_double_closed_right: 'Pack B has no door art at all',
  door_arch_closed_left: 'Pack B has no door art at all',
  door_arch_closed_right: 'Pack B has no door art at all',
  door_single_closed: 'Pack B has no door art at all',
  door_leaf_center_top: 'Pack B has no door leaves',
  door_leaf_center_bottom: 'Pack B has no door leaves',
  door_leaf_left_top: 'Pack B has no door leaves',
  door_leaf_left_bottom: 'Pack B has no door leaves',
  door_leaf_right_top: 'Pack B has no door leaves',
  door_leaf_right_bottom: 'Pack B has no door leaves',
  candlestick_a_lit: 'no floor candlestick in Pack B, lit or unlit',
  candlestick_a_unlit: 'no floor candlestick in Pack B, lit or unlit',
  torch_bracket_unlit: 'Pack B draws only lit torches',
  decor_shackle: 'no equivalent worth forcing',
  crate_wood_destroy: 'Pack B has no crate destruction animation',
  crate_steel_destroy: 'Pack B has no crate destruction animation',
  arrow_launcher: 'no arrow trap in Pack B or E',
  bolt: 'no projectile art in Pack B or E',
  flame_down: 'no flame trap in Pack B or E',
  flame_side: 'no flame trap in Pack B or E',
  spawn_cursor: 'Pack B ships no interface cursors',
};
