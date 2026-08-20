import { describe, expect, it } from 'vitest';

import { placeholderColour } from '../../src/assets/loader.js';
import { ANIMS, anim, frameDrawSize } from '../../src/assets/packA.js';
import { PALETTE } from '../../src/render/palette.js';
import {
  BLINK_TICKS,
  LUNGE_PX,
  enemySprite,
  pickupSprite,
  playerSprite,
  propSprite,
  telegraphSprite,
  trapSprite,
  walkBob,
} from '../../src/render/sprites.js';
import {
  CHEST_OPEN_TICKS,
  CRATE_DESTROY_TICKS,
  DYING_TICKS,
  ENEMY_DEATH_TICKS,
  ENEMY_HITSTUN,
  IFRAME_TICKS,
  RESISTANT_HITSTUN,
  SKEL_SWORD_WINDUP_TICKS,
  SPAWN_BLINK_TICKS,
  SPAWN_TELEGRAPH_TICKS,
  SWING_TICKS,
  TILE,
  TILE_SUBPX,
} from '../../src/sim/constants.js';
import { EnemyState, createEntity } from '../../src/sim/enemy.js';
import { LEFT, RIGHT } from '../../src/sim/input.js';
import type { PickupName } from '../../src/sim/level.js';
import { Facing, PlayerState, createPlayer } from '../../src/sim/player.js';
import { INVULN_TICKS } from '../../src/sim/pickups.js';
import { PropState, createProp } from '../../src/sim/prop.js';

/**
 * 02-entities §1.1 and §2.1's "animation & motion polish", as data. Every number here is a
 * tick boundary the spec states, so these are the tests that would notice if the bob, the
 * lunge, the flash or the blink drifted by one.
 */

const player = (over: Partial<ReturnType<typeof createPlayer>> = {}) =>
  Object.assign(createPlayer(0, 0, 6), over);

const view = (over: Partial<ReturnType<typeof createPlayer>> = {}, input = 0, tick = 0) => ({
  player: player(over),
  input,
  tick,
});

describe('the player', () => {
  it('plays the idle loop at 8 ticks a frame, and at 5 while walking (02 §1.1)', () => {
    expect(playerSprite(view({}, 0, 16)).frame).toBe(2);
    expect(playerSprite(view({}, RIGHT, 16)).frame).toBe(3);
  });

  it('bobs a pixel on ticks 4–7 of each cycle, only while moving', () => {
    expect([0, 1, 2, 3].map((t) => walkBob(t, true))).toEqual([0, 0, 0, 0]);
    expect([4, 5, 6, 7].map((t) => walkBob(t, true))).toEqual([-1, -1, -1, -1]);
    expect(walkBob(8, true)).toBe(0);
    expect(walkBob(5, false)).toBe(0);

    expect(playerSprite(view({}, RIGHT, 5)).dy).toBe(-1);
    expect(playerSprite(view({}, 0, 5)).dy).toBe(0); // standing still does not bob
  });

  it('faces left by flipping, and never flips for up or down', () => {
    expect(playerSprite(view({ facing: Facing.L }, LEFT)).flipX).toBe(true);
    expect(playerSprite(view({ facing: Facing.R }, RIGHT)).flipX).toBe(false);
    expect(playerSprite(view({ facing: Facing.U })).flipX).toBe(false);
    expect(playerSprite(view({ facing: Facing.D })).flipX).toBe(false);
  });

  it('lunges 2 px through the swing’s active window and nowhere else (01 §4.2)', () => {
    const swinging = (elapsed: number) =>
      playerSprite(
        view({
          state: PlayerState.SWING,
          stateTimer: SWING_TICKS - elapsed,
          facing: Facing.R,
        }),
      );

    expect(swinging(2).dx).toBe(0);
    expect(swinging(3).dx).toBe(LUNGE_PX);
    expect(swinging(9).dx).toBe(LUNGE_PX);
    expect(swinging(10).dx).toBe(0);

    expect(
      playerSprite(
        view({ state: PlayerState.SWING, stateTimer: SWING_TICKS - 5, facing: Facing.U }),
      ).dy,
    ).toBe(-LUNGE_PX);
  });

  it('flashes white for two ticks, then blinks 3 on 3 off for the i-frames (01 §5.1)', () => {
    const hurt = (elapsed: number) => playerSprite(view({ iframeTimer: IFRAME_TICKS - elapsed }));

    expect(hurt(0).tint).toBe('white');
    expect(hurt(1).tint).toBe('white');
    expect(hurt(2).tint).toBe('none');

    expect([0, 1, 2].map((t) => hurt(t).visible)).toEqual([true, true, true]);
    expect([3, 4, 5].map((t) => hurt(t).visible)).toEqual([false, false, false]);
    expect(hurt(BLINK_TICKS * 2).visible).toBe(true);
    expect(playerSprite(view({ iframeTimer: 0 })).visible).toBe(true);
  });

  it('tints its steel blue while a blue flask is running (01 §7)', () => {
    expect(playerSprite(view({ invulnTimer: INVULN_TICKS.blue_small })).tint).toBe('blue');
    // A hit during invulnerability cannot happen, but the flash still wins if it ever did.
    const both = playerSprite(view({ invulnTimer: 60, iframeTimer: IFRAME_TICKS }));
    expect(both.tint).toBe('white');
  });

  it('flips every 4 ticks and fades over the last 40 while dying (01 §6)', () => {
    const dying = (elapsed: number) =>
      playerSprite(view({ state: PlayerState.DYING, stateTimer: DYING_TICKS - elapsed }));

    expect(dying(0).flipX).toBe(false);
    expect(dying(4).flipX).toBe(true);
    expect(dying(8).flipX).toBe(false);

    expect(dying(0).alpha).toBe(1);
    expect(dying(20).alpha).toBe(1); // 40 ticks left: the fade starts here
    expect(dying(40).alpha).toBe(0.5);
    expect(dying(60).alpha).toBe(0);
  });
});

describe('an enemy', () => {
  const skeleton = () => createEntity(0, 'skel_sword', 4 * TILE_SUBPX, 4 * TILE_SUBPX, null);

  it('uses its own idle loop, and the walk rate while chasing', () => {
    const entity = skeleton();
    expect(enemySprite(entity, entity.x, 16).anim).toBe('skel_sword_idle');
    expect(enemySprite(entity, entity.x, 16).frame).toBe(2); // IDLE: 8 ticks a frame
    entity.state = EnemyState.CHASE;
    expect(enemySprite(entity, entity.x, 16).frame).toBe(3); // chasing: 5
    expect(enemySprite(entity, entity.x, 5).dy).toBe(-1); // and it bobs like the player
  });

  it('flips toward its target (02 §2.1)', () => {
    const entity = skeleton();
    expect(enemySprite(entity, entity.x - 100, 0).flipX).toBe(true);
    expect(enemySprite(entity, entity.x + 100, 0).flipX).toBe(false);
  });

  it('flashes white for the first two ticks of hitstun, both stun lengths (02 §2.2)', () => {
    const sword = skeleton();
    sword.hitstun = ENEMY_HITSTUN;
    expect(enemySprite(sword, sword.x, 0).tint).toBe('white');
    sword.hitstun = ENEMY_HITSTUN - 1;
    expect(enemySprite(sword, sword.x, 0).tint).toBe('white');
    sword.hitstun = ENEMY_HITSTUN - 2;
    expect(enemySprite(sword, sword.x, 0).tint).toBe('none');

    const axe = createEntity(1, 'skel_axe', 0, 0, null);
    axe.hitstun = RESISTANT_HITSTUN;
    expect(enemySprite(axe, axe.x, 0).tint).toBe('white');
    axe.hitstun = RESISTANT_HITSTUN - 2;
    expect(enemySprite(axe, axe.x, 0).tint).toBe('none');
  });

  it('shakes a pixel either way through a windup (02 §2.2)', () => {
    const entity = skeleton();
    entity.state = EnemyState.WINDUP;
    const shake = (elapsed: number) => {
      entity.stateTimer = SKEL_SWORD_WINDUP_TICKS - elapsed;
      return enemySprite(entity, entity.x, 0).dx;
    };
    expect([0, 1, 2, 3, 4].map(shake)).toEqual([1, 1, -1, -1, 1]);
  });

  it('flashes, then fades and drifts 2 px up as it dies (02 §2.1)', () => {
    const entity = skeleton();
    entity.state = EnemyState.DYING;
    const dying = (elapsed: number) => {
      entity.stateTimer = ENEMY_DEATH_TICKS - elapsed;
      return enemySprite(entity, entity.x, 0);
    };

    expect(dying(0).tint).toBe('white');
    expect(dying(1).tint).toBe('white');
    expect(dying(2).tint).toBe('none');
    expect(dying(2).alpha).toBe(1);
    expect(dying(7).alpha).toBe(0.5);
    expect(dying(7).dy).toBe(-1);
    expect(dying(12).alpha).toBe(0);
    expect(dying(12).dy).toBe(-2);
  });

  it('blinks in over its 12 spawn ticks, and is invisible for half of them (02 §2.3)', () => {
    const entity = skeleton();
    entity.state = EnemyState.SPAWNING;
    const blink = (elapsed: number) => {
      entity.stateTimer = SPAWN_BLINK_TICKS - elapsed;
      return enemySprite(entity, entity.x, 0).visible;
    };
    expect([0, 1, 2].map(blink)).toEqual([true, true, true]);
    expect([3, 4, 5].map(blink)).toEqual([false, false, false]);
    expect(blink(6)).toBe(true);
  });

  it('marks a spawn tile with the interface cursor while it telegraphs', () => {
    const draw = telegraphSprite(SPAWN_TELEGRAPH_TICKS, SPAWN_TELEGRAPH_TICKS);
    expect(draw.anim).toBe('spawn_cursor');
    expect(draw.frame).toBe(0);
    expect(telegraphSprite(SPAWN_TELEGRAPH_TICKS - 6, SPAWN_TELEGRAPH_TICKS).frame).toBe(1);
  });
});

describe('props', () => {
  const propOf = (kind: Parameters<typeof createProp>[0]['kind']) =>
    createProp({ at: [1, 1], kind, contents: [], drop: null });

  it('idles a chest, then plays its opening and holds the gold glow (02 §4.1)', () => {
    const chest = propOf('chest');
    expect(propSprite(chest, 0)!.anim).toBe('chest_idle');

    chest.state = PropState.OPENING;
    chest.timer = CHEST_OPEN_TICKS;
    expect(propSprite(chest, 0)!.anim).toBe('chest_open');
    expect(propSprite(chest, 0)!.frame).toBe(0);
    chest.timer = CHEST_OPEN_TICKS - 8;
    expect(propSprite(chest, 0)!.frame).toBe(2);

    chest.state = PropState.OPEN;
    expect(propSprite(chest, 0)!.frame).toBe(3); // held, whatever the timer says
  });

  it('draws crates as tiles until the sword starts them coming apart (02 §4.2)', () => {
    const crate = propOf('crate_wood');
    expect(propSprite(crate, 0)!.tile).toBe('crate_wood');

    crate.state = PropState.DESTROYING;
    crate.timer = CRATE_DESTROY_TICKS;
    expect(propSprite(crate, 0)!.anim).toBe('crate_wood_destroy');
    expect(propSprite(crate, 0)!.frame).toBe(0);
    crate.timer = CRATE_DESTROY_TICKS - 6;
    expect(propSprite(crate, 0)!.frame).toBe(2);

    expect(propSprite(propOf('crate_push'), 0)!.tile).toBe('crate_push');
  });

  it('swaps a torch’s unlit tile for the lit loop (02 §4.3)', () => {
    const torch = propOf('torch');
    expect(propSprite(torch, 0)!.tile).toBe('candlestick_a_unlit');
    torch.state = PropState.LIT;
    expect(propSprite(torch, 0)!.anim).toBe('candlestick_a_lit');
  });
});

describe('pickups and traps', () => {
  const PICKUPS: PickupName[] = [
    'coin',
    'silver_key',
    'gold_key',
    'red_small',
    'red_large',
    'blue_small',
    'blue_large',
  ];

  it.each(PICKUPS)('%s spins on a manifest loop (02 §5)', (kind) => {
    const draw = pickupSprite(kind, 0);
    expect(() => anim(draw.anim!)).not.toThrow();
    expect(anim(draw.anim!).loop).toBe(true);
  });

  it('gives every trap kind art, and reaches for the tile a left-hand jet fires into', () => {
    const trap = (kind: Parameters<typeof trapSprite>[0]['kind']) => ({
      at: [5, 5] as [number, number],
      kind,
      period: 120,
      offset: 0,
      alwaysOn: false,
      deadly: null,
    });

    expect(trapSprite(trap('spike'), 0).anim).toBe('spike');
    expect(trapSprite(trap('arrow'), 0).anim).toBe('arrow_launcher');
    expect(trapSprite(trap('flame_down'), 0).anim).toBe('flame_down');
    expect(trapSprite(trap('flame_right'), 0).flipX).toBe(false);

    const left = trapSprite(trap('flame_left'), 0);
    expect(left.anim).toBe('flame_side');
    expect(left.flipX).toBe(true);
    expect(left.dx).toBe(-16);
  });

  /**
   * 02 §3.2: the launcher is the emitter hole and nothing else. Its art used to reach a whole
   * tile into the lane with a baked-in bolt in it, drawn on the trap-FX layer *over* actors,
   * while the real bolt flew the same lane — the arrow bleed. Every frame of the shot, and
   * every phase of the cycle, must now stay inside the wall cell it is anchored in.
   */
  it('never draws the arrow launcher below its wall cell (02 §3.2)', () => {
    const launcher = {
      at: [5, 0] as [number, number],
      kind: 'arrow' as const,
      period: 120,
      offset: 0,
      alwaysOn: false,
      deadly: null,
    };

    const framesSeen = new Set<number>();
    for (let phase = 0; phase < launcher.period; phase++) {
      const spec = trapSprite(launcher, phase);
      const [w, h] = frameDrawSize(anim(spec.anim!));
      framesSeen.add(spec.frame);

      expect([spec.dx, spec.dy], `phase ${phase}`).toEqual([0, 0]);
      expect([w, h], `phase ${phase}`).toEqual([TILE, TILE]);
      // Both edges of the drawn sprite, relative to the wall cell's own top-left.
      expect(spec.dy + h, `phase ${phase}`).toBeLessThanOrEqual(TILE);
      expect(spec.dx + w, `phase ${phase}`).toBeLessThanOrEqual(TILE);
    }
    // All four frames of the shot were exercised, not just the idle one.
    expect([...framesSeen].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('placeholder art', () => {
  it('colours each manifest entry by what it is, so a synthesized room still reads', () => {
    expect(placeholderColour('wall_top_0')).toBe(PALETTE.brick);
    expect(placeholderColour('floor_plain_3')).toBe(PALETTE.floor);
    expect(placeholderColour('void_fill')).toBe(PALETTE.void);
    expect(placeholderColour('door_double_closed_left')).toBe(PALETTE.woodBright);
    expect(placeholderColour('player_idle')).toBe(PALETTE.steel);
    expect(placeholderColour('skel_sword_idle')).toBe(PALETTE.red);
    expect(placeholderColour('coin_spin')).toBe(PALETTE.gold);
    expect(placeholderColour('spike')).toBe(PALETTE.red);
  });

  it('has a colour for every id in the manifest', () => {
    for (const def of ANIMS) expect(placeholderColour(def.id), def.id).toMatch(/^#[0-9a-f]{6}$/);
  });
});
