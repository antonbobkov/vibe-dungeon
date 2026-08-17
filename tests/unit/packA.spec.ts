import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ANIMS, ART_ROOT, TILES, anim, tile } from '../../src/assets/packA.js';

const ART_DIR = join(process.cwd(), 'art_assets');
const HAVE_ART = existsSync(join(ART_DIR, ART_ROOT));

describe('trap animation play orders (AG §3.5 — frame numbers are not play order)', () => {
  it('spikes retract→extend as 3, 4, 2, 1', () => {
    expect(anim('spike').frames).toEqual([
      'peaks_3.png',
      'peaks_4.png',
      'peaks_2.png',
      'peaks_1.png',
    ]);
  });

  it('the arrow launcher goes idle→fire as 2, 3, 4, 1', () => {
    expect(anim('arrow_launcher').frames).toEqual([
      'arrow_2.png',
      'arrow_3.png',
      'arrow_4.png',
      'arrow_1.png',
    ]);
  });

  it('both flame jets go off→full as 4, 3, 1, 2', () => {
    expect(anim('flame_down').frames).toEqual([
      'flamethrower_1_4.png',
      'flamethrower_1_3.png',
      'flamethrower_1_1.png',
      'flamethrower_1_2.png',
    ]);
    expect(anim('flame_side').frames).toEqual([
      'flamethrower_2_4.png',
      'flamethrower_2_3.png',
      'flamethrower_2_1.png',
      'flamethrower_2_2.png',
    ]);
  });

  it('the standalone bolt sprite is a single frame', () => {
    expect(anim('bolt').frames).toEqual(['Just_arrow.png']);
  });
});

describe('frame sizes (AG §7 gotcha 8 — the non-16×16 assets)', () => {
  it('names the three oversized trap animations and nothing else', () => {
    const oversized = ANIMS.filter((a) => a.frameSize !== undefined).map((a) => [
      a.id,
      a.frameSize,
    ]);
    expect(oversized).toEqual([
      ['arrow_launcher', [16, 32]],
      ['flame_down', [16, 32]],
      ['flame_side', [32, 16]],
    ]);
  });
});

describe('the v1/v2 inversion (AG §3.4 gotcha)', () => {
  it('gives the player the plain priest variant, which is v1', () => {
    expect(anim('player_idle').dir.endsWith('/priests_idle/priest1/v1')).toBe(true);
    expect(anim('player_idle').frames[0]).toBe('priest1_v1_1.png');
  });

  it('gives every enemy the plain monster variant, which is v2', () => {
    for (const id of ['skel_sword_idle', 'skel_axe_idle', 'zombie_idle', 'wisp_idle']) {
      const def = anim(id);
      expect(def.dir, id).toContain('/monsters_idle/');
      expect(def.dir.endsWith('/v2'), id).toBe(true);
      for (const frame of def.frames) expect(frame, id).toContain('_v2_');
    }
  });
});

describe('manifest coverage (02-entities is the checklist)', () => {
  // Every animation 02-entities names, by the entity that needs it.
  const REQUIRED_ANIMS = [
    'player_idle', // §1 player
    'skel_sword_idle', // §2.2
    'skel_axe_idle',
    'zombie_idle',
    'wisp_idle',
    'spawn_cursor', // §2.3 wave telegraph
    'spike', // §3.1
    'arrow_launcher', // §3.2 emitter
    'bolt', // §3.2 projectile
    'flame_down', // §3.3 `f`
    'flame_side', // §3.3 `>` / `<` (flipped by the renderer)
    'chest_idle', // §4.1
    'chest_open',
    'mini_chest_idle',
    'mini_chest_open',
    'crate_wood_destroy', // §4.2 `x`
    'crate_steel_destroy', // §4.2 `X`
    'torch_wall', // §4.3 decor torch `t`
    'candlestick_a_lit', // §4.3 puzzle torch `u`, lit
    'banner', // §4.4 decor banner `w`
    'coin_spin', // §5 pickups
    'flask_red_small',
    'flask_red_large',
    'flask_blue_small',
    'flask_blue_large',
    'key_silver_spin',
    'key_gold_spin',
  ] as const;

  // Every static tile the spec places by (col,row).
  const REQUIRED_TILES = [
    'void_fill', // 03 §1.2 `_` pit, AG §2.3
    'ladder', // 03 §1.2 `V`, 02 §4.5
    'door_double_closed_left', // 01 §8.1 `DD`
    'door_double_closed_right',
    'door_single_closed', // `L`
    'door_arch_closed_left', // `PP` / `GG`
    'door_arch_closed_right',
    'door_leaf_center_top', // AG §3.2 open states
    'door_leaf_left_top',
    'door_leaf_right_top',
    'crate_push', // 02 §4.2 `p`, and the bridged-pit floor
    'crate_wood',
    'crate_steel',
    'chest_large', // 02 §4.1 `M`
    'chest_mini', // `m`
    'candlestick_a_unlit', // 02 §4.3 `u` before lighting
    'candlestick_a_lit',
    'torch_wall_lit',
    'pickup_coin', // 02 §5 / 04 §1 HUD
    'pickup_key_silver',
    'pickup_key_gold',
    'pickup_flask_red_small',
    'pickup_flask_red_large',
    'pickup_flask_blue_small',
    'pickup_flask_blue_large',
    'decor_bones', // 02 §4.4 — the decor 03-levels actually places
    'decor_shield',
    'decor_shackle',
    'decor_bones_crossed',
    'decor_bone_fragment',
    'decor_skull_bone',
  ] as const;

  it.each(REQUIRED_ANIMS)('defines the %s animation', (id) => {
    expect(() => anim(id)).not.toThrow();
  });

  it.each(REQUIRED_TILES)('defines the %s tile', (id) => {
    expect(() => tile(id)).not.toThrow();
  });

  it('covers the 03 §1.3 auto-tiling outputs: 20 wall, 12 shaded floor, 12 plain floor', () => {
    const ids = TILES.map((def) => def.id);
    for (const i of [0, 1, 2, 3]) {
      expect(ids).toContain(`wall_top_${i}`);
      expect(ids).toContain(`wall_bottom_${i}`);
    }
    for (const i of [0, 1, 2]) {
      expect(ids).toContain(`wall_left_${i}`);
      expect(ids).toContain(`wall_right_${i}`);
    }
    for (let row = 1; row <= 3; row++) {
      for (let col = 1; col <= 4; col++) expect(ids).toContain(`floor_shaded_c${col}_r${row}`);
    }
    for (let v = 0; v < 12; v++) expect(ids).toContain(`floor_plain_${v}`);
  });

  it('maps plain floor variant v to (6 + v mod 4, v div 4)', () => {
    for (let v = 0; v < 12; v++) {
      const def = tile(`floor_plain_${v}`);
      expect([def.col, def.row]).toEqual([6 + (v % 4), Math.floor(v / 4)]);
    }
  });
});

describe('structural invariants', () => {
  it('has unique tile ids and unique animation ids', () => {
    expect(new Set(TILES.map((d) => d.id)).size).toBe(TILES.length);
    expect(new Set(ANIMS.map((d) => d.id)).size).toBe(ANIMS.length);
  });

  it('keeps every tile inside the 10×10 sheet (AG §2.1)', () => {
    for (const def of TILES) {
      expect(def.col, def.id).toBeGreaterThanOrEqual(0);
      expect(def.col, def.id).toBeLessThan(10);
      expect(def.row, def.id).toBeGreaterThanOrEqual(0);
      expect(def.row, def.id).toBeLessThan(10);
    }
  });

  it('never places two tiles on the same cell', () => {
    const cells = TILES.map((d) => `${d.col},${d.row}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('gives every animation frames, a positive rate, and only sane hold flags', () => {
    for (const def of ANIMS) {
      expect(def.frames.length, def.id).toBeGreaterThan(0);
      expect(def.frameTicks, def.id).toBeGreaterThan(0);
      for (const frame of def.frames) expect(frame, def.id).toMatch(/\.png$/);
      // `hold` only means anything for a one-shot: a loop never reaches an end to hold.
      if (def.loop) expect(def.hold, def.id).toBeUndefined();
    }
  });

  it('holds the last frame of the chest openings (AG §3.5 "play once, hold 4")', () => {
    for (const id of ['chest_open', 'mini_chest_open']) {
      expect(anim(id).loop, id).toBe(false);
      expect(anim(id).hold, id).toBe(true);
      // 02 §4.1: OPENING lasts 16 ticks at 4 ticks/frame.
      expect(anim(id).frameTicks * anim(id).frames.length, id).toBe(16);
    }
  });

  it('runs crate destruction for the 12 ticks 02 §4.2 specifies, then ends', () => {
    for (const id of ['crate_wood_destroy', 'crate_steel_destroy']) {
      expect(anim(id).loop, id).toBe(false);
      expect(anim(id).hold, id).toBeUndefined();
      expect(anim(id).frameTicks * anim(id).frames.length, id).toBe(12);
    }
  });
});

// Catches typos in the hand-transcribed paths. CI has no art (repo policy), so this skips
// there — the same convention TESTING.md §1 uses for visual goldens.
describe.skipIf(!HAVE_ART)('animation files exist on disk', () => {
  it('resolves every frame of every animation', () => {
    const missing: string[] = [];
    for (const def of ANIMS) {
      for (const frame of def.frames) {
        const path = join(ART_DIR, def.dir, frame);
        if (!existsSync(path)) missing.push(`${def.id}: ${def.dir}/${frame}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('resolves the tileset both tile groups are sliced from', () => {
    expect(
      existsSync(join(ART_DIR, ART_ROOT, 'character and tileset', 'Dungeon_Tileset.png')),
    ).toBe(true);
  });
});
