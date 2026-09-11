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

import { ANIMS, ART_ROOT, TILES, frameDrawSize, type AnimDef, type TileDef } from './packA.js';
import { PALETTE } from '../render/palette.js';
import type { Tint } from '../render/sprites.js';
import { TILE } from '../sim/constants.js';

/** Set by Vite's `define` from the `PLACEHOLDER_ART` env var; absent outside the browser build. */
declare const __PLACEHOLDER_ART__: boolean | undefined;

export interface Sprite {
  image: CanvasImageSource;
  w: number;
  h: number;
}

export interface Atlas {
  /** True when the art is synthesized rather than loaded. */
  readonly placeholder: boolean;
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

/**
 * Art lives beside the page, not at the server root: a GitHub Pages project site is served
 * from /<repo>/, and `BASE_URL` is whatever the build was told that prefix is.
 */
const artUrl = (path: string): string => `${import.meta.env.BASE_URL}art_assets/${encodeURI(path)}`;

async function loadImage(path: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = artUrl(path);
  await image.decode();
  return image;
}

function sliceTile(sheet: HTMLImageElement, def: TileDef): HTMLCanvasElement {
  const canvas = makeCanvas(TILE, TILE);
  context2d(canvas).drawImage(sheet, def.col * TILE, def.row * TILE, TILE, TILE, 0, 0, TILE, TILE);
  return canvas;
}

/**
 * One animation frame file, taken at its drawn size: the whole image for almost everything,
 * and the top-left `crop` for the arrow launcher, whose lower tile holds a baked-in bolt the
 * game flies for real (packA `TRAP_ANIMS`). The source rectangle is written out rather than
 * left to the canvas to clip, so the crop is visible where it happens.
 */
function copyFrame(image: HTMLImageElement, def: AnimDef): HTMLCanvasElement {
  const [w, h] = frameDrawSize(def);
  const canvas = makeCanvas(w, h);
  context2d(canvas).drawImage(image, 0, 0, w, h, 0, 0, w, h);
  return canvas;
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
}

const bake = (source: HTMLCanvasElement): Variants => ({
  none: source,
  white: retint(source, 'white'),
  blue: retint(source, 'blue'),
});

const spriteOf = (variants: Variants, tint: Tint): Sprite => {
  const image = variants[tint];
  return { image, w: image.width, h: image.height };
};

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface LoadOptions {
  /** Force placeholder art; defaults to the build flag, then to whether the art is there. */
  placeholder?: boolean;
  /** Told once, when real art was asked for and is not present. */
  onFallback?: (reason: string) => void;
}

export async function loadAtlas(options: LoadOptions = {}): Promise<Atlas> {
  const flagged =
    options.placeholder ?? (typeof __PLACEHOLDER_ART__ !== 'undefined' && __PLACEHOLDER_ART__);

  let sheets: { tileset: HTMLImageElement; character: HTMLImageElement } | null = null;
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

  const tiles = new Map<string, Variants>();
  const cells = new Map<string, Variants>();
  const frames = new Map<string, Variants[]>();

  for (const def of TILES) {
    const variants = bake(
      sheets ? sliceTile(sheets[def.sheet], def) : synthesize(def.id, 0, TILE, TILE),
    );
    tiles.set(def.id, variants);
    if (def.sheet === 'tileset') cells.set(`${def.col},${def.row}`, variants);
  }

  for (const def of ANIMS) {
    // Placeholder art is synthesized at the same drawn size, so a cropped animation has the
    // same shape in both modes and the e2e can assert exact pixels.
    const [w, h] = frameDrawSize(def);
    const baked = await Promise.all(
      def.frames.map(async (file, index) => {
        if (!sheets) return bake(synthesize(def.id, index, w, h));
        return bake(copyFrame(await loadImage(`${def.dir}/${file}`), def));
      }),
    );
    frames.set(def.id, baked);
  }

  return {
    placeholder: sheets === null,

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
