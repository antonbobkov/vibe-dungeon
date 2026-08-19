/**
 * The asset loader — turns the [manifest](packA.ts) into drawable sprites.
 *
 * Two modes, one interface:
 *
 * - **Real art**: `Dungeon_Tileset.png` is fetched once and sliced into the 16×16 cells the
 *   manifest names; every animation frame is fetched as its own file. The art packs are
 *   licensed content and live outside the repo (CLAUDE.md), served from `/art_assets/` by the
 *   dev server.
 * - **Placeholder** (`PLACEHOLDER_ART=1`, and automatically when the tileset is not there —
 *   CI has no art, and neither does a fresh clone): every entry is synthesized as a flat Pack
 *   A palette colour chosen by what the entry *is*, with a moving mark so animations still
 *   visibly animate. Deterministic, so the e2e can assert exact pixels.
 *
 * Both modes pre-bake the two palette swaps 02 §1.3 and 01 §7 ask for — every opaque pixel
 * white for a damage flash, steel recoloured for blue-flask invulnerability — so drawing a
 * frame never touches pixel data.
 */

import { ANIMS, ART_ROOT, TILES, type AnimDef, type TileDef } from './packA.js';
import {
  ANIM_OVERRIDES,
  TILE_OVERRIDES,
  THEME_B_SHEETS,
  isStrip,
  type AnimSource,
  type CellSource,
  type SheetB,
} from './packB.js';
import { PALETTE } from '../render/palette.js';
import type { Tint } from '../render/sprites.js';
import { TILE } from '../sim/constants.js';

/**
 * Which art the run draws. `a` is Pack A, the game's own theme; `b` re-skins whatever Pack B
 * and Pack E have an equivalent for and leaves the rest on Pack A (see packB.ts).
 */
export type Theme = 'a' | 'b';

/** Set by Vite's `define` from the `PLACEHOLDER_ART` env var; absent outside the browser build. */
declare const __PLACEHOLDER_ART__: boolean | undefined;

export interface Sprite {
  image: CanvasImageSource;
  w: number;
  h: number;
  /** Whole-pixel nudge for art that overshoots its tile — Pack E's 32×32 bodies, Pack B's
   * 28 px torch. Zero for everything that fits its cell. */
  offX: number;
  offY: number;
}

export interface Atlas {
  /** True when the art is synthesized rather than loaded. */
  readonly placeholder: boolean;
  /** The theme actually drawn, which is `a` whenever theme B's sheets were unavailable. */
  readonly theme: Theme;
  tile(id: string, tint?: Tint): Sprite;
  /** By tileset cell — what the auto-tiler and the levels' decor references speak (AG §2.1). */
  cell(col: number, row: number, tint?: Tint): Sprite;
  frame(animId: string, index: number, tint?: Tint): Sprite;
}

const TILESET = `${ART_ROOT}/character and tileset/Dungeon_Tileset.png`;
const CHARACTER_SHEET = `${ART_ROOT}/character and tileset/Dungeon_Character.png`;

/** Steel, the two shades of it, and what invulnerability turns them into (01 §7). */
const STEEL = [
  [0xad, 0xc1, 0xcf],
  [0x90, 0x91, 0x9e],
] as const;

// ---------------------------------------------------------------------------
// Placeholder art (pure enough to test: the colour choice has no canvas in it)
// ---------------------------------------------------------------------------

/**
 * The flat colour standing in for one manifest entry. Chosen by what the entry is rather
 * than by a hash, so a placeholder screenshot still reads as a dungeon: brick walls, purple
 * floor, wooden crates, gold pickups, red traps, steel actors.
 */
export function placeholderColour(id: string): string {
  const rules: [RegExp, string][] = [
    [/^void_fill$/, PALETTE.void],
    [/^wall_/, PALETTE.brick],
    [/^floor_/, PALETTE.floor],
    [/^door_leaf_/, PALETTE.wood],
    [/^door_/, PALETTE.woodBright],
    [/^ladder$/, PALETTE.steelDark],
    [/^(crate|chest)_/, PALETTE.wood],
    [/^pickup_/, PALETTE.gold],
    [/^(torch|candlestick)/, PALETTE.gold],
    [/^decor_/, PALETTE.brickShadow],
    [/^player_/, PALETTE.steel],
    [/_idle$/, PALETTE.red], // the four enemy loops
    [/^(coin|key|flask)/, PALETTE.gold],
    [/^banner$/, PALETTE.red],
    [/^(spike|arrow_launcher|bolt|flame_)/, PALETTE.red],
    [/^spawn_cursor$/, PALETTE.blue],
  ];
  for (const [pattern, colour] of rules) {
    if (pattern.test(id)) return colour;
  }
  return PALETTE.steelDark;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('loader: 2D canvas context unavailable');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** A flat swatch with a 2 px mark that walks with the frame index, so loops read as loops. */
function synthesize(id: string, frame: number, w: number, h: number): HTMLCanvasElement {
  const canvas = makeCanvas(w, h);
  const ctx = context2d(canvas);
  ctx.fillStyle = placeholderColour(id);
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = PALETTE.void;
  ctx.fillRect(1 + ((frame * 4) % Math.max(1, w - 3)), 1, 2, 2);
  return canvas;
}

// ---------------------------------------------------------------------------
// Real art
// ---------------------------------------------------------------------------

const artUrl = (path: string): string => `/art_assets/${encodeURI(path)}`;

async function loadImage(path: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = artUrl(path);
  await image.decode();
  return image;
}

/** One 16×16 cell of a sheet (AG §2.1: `pixel = col * 16, row * 16`). */
function sliceCell(sheet: HTMLImageElement, col: number, row: number): HTMLCanvasElement {
  const canvas = makeCanvas(TILE, TILE);
  context2d(canvas).drawImage(sheet, col * TILE, row * TILE, TILE, TILE, 0, 0, TILE, TILE);
  return canvas;
}

const sliceTile = (sheet: HTMLImageElement, def: TileDef): HTMLCanvasElement =>
  sliceCell(sheet, def.col, def.row);

function copyFrame(image: HTMLImageElement, def: AnimDef): HTMLCanvasElement {
  const [w, h] = def.frameSize ?? [TILE, TILE];
  const canvas = makeCanvas(w, h);
  context2d(canvas).drawImage(image, 0, 0);
  return canvas;
}

/** One frame out of a horizontal strip — how Pack B and Pack E ship animations. */
function sliceStrip(
  strip: HTMLImageElement,
  index: number,
  w: number,
  h: number,
): HTMLCanvasElement {
  const canvas = makeCanvas(w, h);
  context2d(canvas).drawImage(strip, index * w, 0, w, h, 0, 0, w, h);
  return canvas;
}

/**
 * Which strip frames stand in for an animation's frames. `pick` says so outright — for the
 * spike ramp, where the mapping to 02 §3's dormant / telegraph / deadly window has to be
 * exact — and otherwise they are spread evenly, so a longer strip still plays a whole cycle
 * in the number of frames the manifest declares.
 */
export function stripFrames(wanted: number, available: number, pick?: readonly number[]): number[] {
  if (pick) {
    if (pick.length !== wanted) {
      throw new Error(`theme: pick has ${pick.length} frames, the animation has ${wanted}`);
    }
    return [...pick];
  }
  return Array.from({ length: wanted }, (_, i) =>
    Math.min(available - 1, Math.round((i * available) / wanted)),
  );
}

// ---------------------------------------------------------------------------
// Tints
// ---------------------------------------------------------------------------

/** Every opaque pixel white (02 §1.3), or every steel pixel selection-blue (01 §7). */
function retint(source: HTMLCanvasElement, tint: Exclude<Tint, 'none'>): HTMLCanvasElement {
  const canvas = makeCanvas(source.width, source.height);
  const ctx = context2d(canvas);
  ctx.drawImage(source, 0, 0);

  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    if (tint === 'white') {
      data[i] = 0xff;
      data[i + 1] = 0xff;
      data[i + 2] = 0xff;
      continue;
    }
    const steel = STEEL.some(
      ([r, g, b]) => data[i] === r && data[i + 1] === g && data[i + 2] === b,
    );
    if (steel) {
      data[i] = 0x62;
      data[i + 1] = 0xab;
      data[i + 2] = 0xd4;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

interface Variants {
  none: HTMLCanvasElement;
  white: HTMLCanvasElement;
  blue: HTMLCanvasElement;
  offX: number;
  offY: number;
}

const bake = (source: HTMLCanvasElement, offset: [number, number] = [0, 0]): Variants => ({
  none: source,
  white: retint(source, 'white'),
  blue: retint(source, 'blue'),
  offX: offset[0],
  offY: offset[1],
});

const spriteOf = (variants: Variants, tint: Tint): Sprite => {
  const image = variants[tint];
  return { image, w: image.width, h: image.height, offX: variants.offX, offY: variants.offY };
};

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * A themed animation, built to the *manifest's* frame count so every timing in the game is
 * unchanged: a still repeated when the theme has only one image, otherwise `stripFrames`'
 * choice of frames out of the strip.
 */
async function themedFrames(
  def: AnimDef,
  swap: AnimSource,
  sheets: Record<string, HTMLImageElement | undefined>,
): Promise<Variants[]> {
  const wanted = def.frames.length;

  if (!isStrip(swap)) {
    const cell = swap as CellSource;
    const still = sliceCell(sheets[cell.sheet]!, cell.col, cell.row);
    return Array.from({ length: wanted }, () => bake(still));
  }

  const strip = await loadImage(swap.file);
  const [w, h] = swap.frameSize ?? [TILE, TILE];
  const indices = stripFrames(wanted, swap.frames, swap.pick);
  return indices.map((index) => bake(sliceStrip(strip, index, w, h), swap.drawOffset ?? [0, 0]));
}

export interface LoadOptions {
  /** Force placeholder art; defaults to the build flag, then to whether the art is there. */
  placeholder?: boolean;
  /** Which art to draw (see packB.ts). Defaults to Pack A. */
  theme?: Theme;
  /** Told once, when art that was asked for is not present. */
  onFallback?: (reason: string) => void;
}

type Sheets = Record<'tileset' | 'character', HTMLImageElement> &
  Partial<Record<SheetB, HTMLImageElement>>;

export async function loadAtlas(options: LoadOptions = {}): Promise<Atlas> {
  const flagged =
    options.placeholder ?? (typeof __PLACEHOLDER_ART__ !== 'undefined' && __PLACEHOLDER_ART__);

  let sheets: Sheets | null = null;
  if (!flagged) {
    try {
      const [tileset, character] = await Promise.all([
        loadImage(TILESET),
        loadImage(CHARACTER_SHEET),
      ]);
      sheets = { tileset, character };
    } catch {
      options.onFallback?.('art_assets/ is not available — drawing placeholder art');
    }
  }

  // Theme B re-skins what Pack B and Pack E cover and leaves the rest on Pack A. If its
  // sheets are missing, the whole theme steps aside rather than the game half-loading.
  let theme: Theme = sheets && options.theme === 'b' ? 'b' : 'a';
  if (theme === 'b' && sheets) {
    try {
      const entries = Object.entries(THEME_B_SHEETS) as [SheetB, string][];
      const loaded = await Promise.all(entries.map(async ([, path]) => loadImage(path)));
      entries.forEach(([name], index) => {
        sheets![name] = loaded[index]!;
      });
    } catch {
      theme = 'a';
      options.onFallback?.('theme b: Pack B is not in art_assets/ — drawing Pack A');
    }
  }

  const tiles = new Map<string, Variants>();
  const cells = new Map<string, Variants>();
  const frames = new Map<string, Variants[]>();

  for (const def of TILES) {
    const swap = theme === 'b' ? TILE_OVERRIDES[def.id] : undefined;
    const variants = bake(
      !sheets
        ? synthesize(def.id, 0, TILE, TILE)
        : swap
          ? sliceCell(sheets[swap.sheet]!, swap.col, swap.row)
          : sliceTile(sheets[def.sheet], def),
    );
    tiles.set(def.id, variants);
    if (def.sheet === 'tileset') cells.set(`${def.col},${def.row}`, variants);
  }

  for (const def of ANIMS) {
    const [w, h] = def.frameSize ?? [TILE, TILE];
    const swap = theme === 'b' ? ANIM_OVERRIDES[def.id] : undefined;

    const baked =
      sheets && swap
        ? await themedFrames(def, swap, sheets)
        : await Promise.all(
            def.frames.map(async (file, index) => {
              if (!sheets) return bake(synthesize(def.id, index, w, h));
              return bake(copyFrame(await loadImage(`${def.dir}/${file}`), def));
            }),
          );

    frames.set(def.id, baked);
  }

  return {
    placeholder: sheets === null,
    theme,

    tile(id, tint = 'none') {
      const variants = tiles.get(id);
      if (!variants) throw new Error(`atlas: no tile "${id}"`);
      return spriteOf(variants, tint);
    },

    cell(col, row, tint = 'none') {
      const variants = cells.get(`${col},${row}`);
      if (!variants) throw new Error(`atlas: the manifest has no tile at (${col},${row})`);
      return spriteOf(variants, tint);
    },

    frame(animId, index, tint = 'none') {
      const variants = frames.get(animId);
      if (!variants) throw new Error(`atlas: no animation "${animId}"`);
      const picked = variants[index];
      if (!picked) throw new Error(`atlas: animation "${animId}" has no frame ${index}`);
      return spriteOf(picked, tint);
    },
  };
}
