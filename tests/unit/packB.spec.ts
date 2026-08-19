import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { stripFrames } from '../../src/assets/loader.js';
import { ANIMS, TILES, anim, tile } from '../../src/assets/packA.js';
import {
  ANIM_OVERRIDES,
  NOT_MIGRATED,
  PACK_B_ROOT,
  PACK_E_ROOT,
  THEME_B_SHEETS,
  TILE_OVERRIDES,
  isStrip,
} from '../../src/assets/packB.js';

/**
 * Theme B's override table (`?theme=b`). It is keyed by Pack A ids, so the two things that
 * can silently go wrong are a typo'd id — which would just never apply — and a strip whose
 * frames do not line up with the file on disk. Both are checked here.
 */

const ART_DIR = join(process.cwd(), 'art_assets');
const HAVE_B = existsSync(join(ART_DIR, PACK_B_ROOT));
const HAVE_E = existsSync(join(ART_DIR, PACK_E_ROOT));

describe('every override names something that exists', () => {
  it.each(Object.keys(TILE_OVERRIDES))('tile %s is a Pack A tile id', (id) => {
    expect(() => tile(id)).not.toThrow();
  });

  it.each(Object.keys(ANIM_OVERRIDES))('animation %s is a Pack A animation id', (id) => {
    expect(() => anim(id)).not.toThrow();
  });

  it.each(Object.keys(NOT_MIGRATED))('%s is a real id, left on Pack A on purpose', (id) => {
    const known = TILES.some((t) => t.id === id) || ANIMS.some((a) => a.id === id);
    expect(known, `${id} is in neither manifest list`).toBe(true);
    expect(TILE_OVERRIDES[id], `${id} is both migrated and not`).toBeUndefined();
    expect(ANIM_OVERRIDES[id], `${id} is both migrated and not`).toBeUndefined();
  });
});

describe('what the partial migration covers', () => {
  it('re-skins the whole room frame, so the 03 §1.3 formulas need no changes', () => {
    for (const id of [
      'wall_corner_tl',
      'wall_corner_tr',
      'wall_corner_bl',
      'wall_corner_br',
      'wall_top_0',
      'wall_bottom_3',
      'wall_left_0',
      'wall_right_2',
      'wall_face_even',
      'wall_face_odd',
      'void_fill',
    ]) {
      expect(TILE_OVERRIDES[id], id).toBeDefined();
    }

    // …at the same cells for everything but the two interior faces, which Pack B lacks.
    for (const id of ['wall_corner_tl', 'wall_top_0', 'wall_left_0', 'wall_right_2']) {
      const packA = tile(id);
      expect(TILE_OVERRIDES[id]).toMatchObject({ col: packA.col, row: packA.row });
    }
  });

  it('covers all 24 floor variants, and never lands on a shadow-bordered patch tile', () => {
    for (let v = 0; v < 12; v++) expect(TILE_OVERRIDES[`floor_plain_${v}`], `v${v}`).toBeDefined();
    for (let row = 1; row <= 3; row++) {
      for (let col = 1; col <= 4; col++) {
        expect(TILE_OVERRIDES[`floor_shaded_c${col}_r${row}`]).toBeDefined();
      }
    }

    // AG §4.1: (8,0) (9,0) (8,1) (9,1) and the (6..9, 2..4) ring are bordered, not plain.
    const bordered = new Set([
      '8,0',
      '9,0',
      '8,1',
      '9,1',
      '6,2',
      '9,2',
      '6,3',
      '9,3',
      '6,4',
      '9,4',
    ]);
    for (let v = 0; v < 12; v++) {
      const cell = TILE_OVERRIDES[`floor_plain_${v}`]!;
      expect(bordered.has(`${cell.col},${cell.row}`), `floor_plain_${v}`).toBe(false);
    }
  });

  it('leaves every gap of the analysis on Pack A', () => {
    for (const id of [
      'player_idle',
      'wisp_idle',
      'door_single_closed',
      'door_leaf_left_top',
      'candlestick_a_lit',
      'crate_wood_destroy',
      'arrow_launcher',
      'bolt',
      'flame_down',
      'flame_side',
      'spawn_cursor',
    ]) {
      expect(TILE_OVERRIDES[id], id).toBeUndefined();
      expect(ANIM_OVERRIDES[id], id).toBeUndefined();
      expect(NOT_MIGRATED[id], `${id} should say why it stayed`).toBeTruthy();
    }
  });

  it('brings the three enemies Pack E animates, anchored onto the 16 px grid (AG §5)', () => {
    for (const id of ['skel_sword_idle', 'skel_axe_idle', 'zombie_idle']) {
      const swap = ANIM_OVERRIDES[id]!;
      expect(isStrip(swap)).toBe(true);
      if (!isStrip(swap)) return;
      expect(swap.frameSize).toEqual([32, 32]);
      expect(swap.drawOffset).toEqual([-7, -14]);
      expect(swap.frames).toBe(6);
    }
  });
});

describe('strip frames line up with the animations they stand in for', () => {
  it.each(Object.entries(ANIM_OVERRIDES).filter(([, s]) => isStrip(s)))(
    '%s picks frames inside its strip',
    (id, swap) => {
      if (!isStrip(swap)) return;
      const wanted = anim(id).frames.length;
      const indices = stripFrames(wanted, swap.frames, swap.pick);

      expect(indices).toHaveLength(wanted);
      for (const index of indices) {
        expect(index, `${id} frame index`).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(swap.frames);
      }
    },
  );

  it('spreads a longer strip across the frames the manifest declares', () => {
    expect(stripFrames(4, 8)).toEqual([0, 2, 4, 6]); // the 8-frame coin spin
    expect(stripFrames(4, 10)).toEqual([0, 3, 5, 8]); // the 10-frame banner
    expect(stripFrames(4, 4)).toEqual([0, 1, 2, 3]);
  });

  it('keeps the spike ramp exact, since the renderer maps it to 02 §3’s window', () => {
    const swap = ANIM_OVERRIDES['spike']!;
    if (!isStrip(swap)) throw new Error('spike should be a strip');
    // peaks.png is retracted → extended in order; frame 0 dormant, 1–2 telegraph, 3 deadly.
    expect(swap.pick).toEqual([0, 1, 3, 4]);
    expect(stripFrames(4, swap.frames, swap.pick)).toEqual([0, 1, 3, 4]);
  });

  it('refuses a pick that is not the length of the animation', () => {
    expect(() => stripFrames(4, 8, [0, 1])).toThrow(/pick has 2 frames/);
  });
});

// The packs are licensed content kept out of the repo (CLAUDE.md), so this skips in CI.
describe.skipIf(!HAVE_B || !HAVE_E)('the files themselves', () => {
  it('resolves both Pack B sheets', () => {
    for (const path of Object.values(THEME_B_SHEETS)) {
      expect(existsSync(join(ART_DIR, path)), path).toBe(true);
    }
  });

  it('resolves every strip an override names', () => {
    const missing = Object.entries(ANIM_OVERRIDES)
      .filter(([, swap]) => isStrip(swap))
      .map(([id, swap]) => [id, (swap as { file: string }).file] as const)
      .filter(([, file]) => !existsSync(join(ART_DIR, file)));
    expect(missing).toEqual([]);
  });
});
