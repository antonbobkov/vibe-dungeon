import { describe, expect, it } from 'vitest';

import { playerCentre } from '../../src/sim/combat.js';
import {
  ENEMY_STATS,
  SKEL_AXE_AGGRO_PX,
  SKEL_SWORD_AGGRO_PX,
  SKEL_SWORD_LUNGE_SPEED,
  SKEL_SWORD_LUNGE_TICKS,
  SKEL_SWORD_RECOVER_TICKS,
  SKEL_SWORD_WINDUP_TICKS,
  SUBPX,
  TILE_SUBPX,
  WISP_AGGRO_PX,
} from '../../src/sim/constants.js';
import {
  EnemyState,
  createEntity,
  entityCentre,
  damageEnemy,
  type SimEntity,
} from '../../src/sim/enemy.js';
import { Dir8 } from '../../src/sim/geometry.js';
import type { EnemyType } from '../../src/sim/level.js';
import { parseRoom } from '../../src/sim/room.js';
import { Sim } from '../../src/sim/sim.js';

/** A wide open room — 20 × 12, the maximum — so aggro ranges have somewhere to happen. */
const OPEN = [
  '####################',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '####################',
];

/**
 * The same room with a wall column at x = 7 — between the player at column 4 and every
 * enemy placed to their right, so sightlines are genuinely broken.
 */
const DIVIDED = OPEN.map((row, i) =>
  i === 0 || i === OPEN.length - 1 ? row : `${row.slice(0, 7)}#${row.slice(8)}`,
);

/** Far enough to be out of every aggro range, but still inside a 20-wide room. */
const OUT_OF_RANGE_PX = 200;

interface Setup {
  sim: Sim;
  enemy: SimEntity;
}

/**
 * Put the player at (4,5) and an enemy `px` pixels to its right, measured centre to centre,
 * so aggro ranges can be tested at exactly their boundary. Column 4 leaves room on the left
 * for a full 12-tick lunge without meeting a wall.
 */
function facingOff(kind: EnemyType, px: number, map = OPEN): Setup {
  const sim = new Sim(parseRoom(map), { start: { x: 4 * TILE_SUBPX, y: 5 * TILE_SUBPX } });
  const target = playerCentre(sim.player);

  // Place the enemy, then shift it so the centres are exactly `px` apart.
  const enemy = createEntity(0, kind, 0, 5 * TILE_SUBPX, null);
  enemy.x = 0;
  const centre = entityCentre(enemy);
  enemy.x = target.x + px * SUBPX - centre.x;
  enemy.y = 5 * TILE_SUBPX + (target.y - entityCentre(enemy).y);

  sim.entities.push(enemy);
  return { sim, enemy };
}

function hold(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick(0);
}

/**
 * Bring a skeleton to the tick its lunge begins, with the player dodging clear once the
 * direction is locked. Without the dodge the lunge lands a contact hit, and its 3 ticks of
 * hit-stop would silently shorten the very windows these tests measure.
 */
function lungeAbout(px = 24): Setup {
  const setup = facingOff('skel_sword', px);
  setup.sim.tick(0); // aggro
  setup.sim.tick(0); // windup tick 1, direction locked
  expect(setup.enemy.state).toBe(EnemyState.WINDUP);

  setup.sim.player.y -= 3 * TILE_SUBPX; // step out of the charge
  hold(setup.sim, SKEL_SWORD_WINDUP_TICKS - 1); // out to windup tick 24
  return setup;
}

// 02-entities §2.2, one case per row of the skeleton's table.
describe('skel_sword', () => {
  it('aggroes at exactly 112 px with line of sight, and not at 113', () => {
    expect(SKEL_SWORD_AGGRO_PX).toBe(112); // 7 tiles

    const near = facingOff('skel_sword', SKEL_SWORD_AGGRO_PX);
    near.sim.tick(0);
    expect(near.enemy.state).toBe(EnemyState.CHASE);

    const far = facingOff('skel_sword', SKEL_SWORD_AGGRO_PX + 1);
    far.sim.tick(0);
    expect(far.enemy.state).toBe(EnemyState.IDLE);
  });

  it('stays idle in range without line of sight', () => {
    const { sim, enemy } = facingOff('skel_sword', 100, DIVIDED);
    hold(sim, 10);
    expect(enemy.state).toBe(EnemyState.IDLE);
  });

  it('aggroes on being hit, wherever it was standing', () => {
    const { sim, enemy } = facingOff('skel_sword', OUT_OF_RANGE_PX, DIVIDED); // unseen, out of range
    damageEnemy(enemy, 1, Dir8.R);
    enemy.hitstun = 0; // the stun itself is tested in damage.spec
    sim.tick(0);
    expect(enemy.state).toBe(EnemyState.CHASE);
  });

  it('chases at speed 12 and closes to windup range', () => {
    expect(ENEMY_STATS.skel_sword.speed).toBe(12);
    const { sim, enemy } = facingOff('skel_sword', 100);
    const startX = enemy.x;

    sim.tick(0); // the aggro tick: it turns to chase but does not move yet
    expect(enemy.x).toBe(startX);

    sim.tick(0);
    expect(startX - enemy.x).toBe(ENEMY_STATS.skel_sword.speed); // straight at the player
  });

  it('winds up for exactly 24 ticks, then lunges for exactly 12', () => {
    const { sim, enemy } = facingOff('skel_sword', 24);
    sim.tick(0); // aggro
    sim.tick(0); // in range already: this is windup tick 1

    expect(enemy.state).toBe(EnemyState.WINDUP);
    expect(enemy.lungeDir).toBe(Dir8.L); // locked toward the player, and never re-aimed

    const frozenX = enemy.x;
    hold(sim, SKEL_SWORD_WINDUP_TICKS - 1); // out to windup tick 24
    expect(enemy.state).toBe(EnemyState.WINDUP);
    expect(enemy.x).toBe(frozenX); // it stands still throughout

    sim.tick(0); // the first lunge tick
    expect(enemy.state).toBe(EnemyState.LUNGE);
    expect(frozenX - enemy.x).toBe(SKEL_SWORD_LUNGE_SPEED);
  });

  it('covers 40 subpx per lunge tick — 480 in all', () => {
    const { sim, enemy } = lungeAbout();

    const before = enemy.x;
    hold(sim, SKEL_SWORD_LUNGE_TICKS);
    expect(before - enemy.x).toBe(SKEL_SWORD_LUNGE_SPEED * SKEL_SWORD_LUNGE_TICKS);
    expect(before - enemy.x).toBe(480);
  });

  it('recovers for 18 ticks and then chases again', () => {
    const { sim, enemy } = lungeAbout();
    hold(sim, SKEL_SWORD_LUNGE_TICKS); // the 12 lunge ticks themselves
    expect(enemy.state).toBe(EnemyState.LUNGE);

    sim.tick(0); // recover tick 1 — the successor always acts on the next tick
    expect(enemy.state).toBe(EnemyState.RECOVER);

    const still = enemy.x;
    hold(sim, SKEL_SWORD_RECOVER_TICKS - 1); // out to recover tick 18
    expect(enemy.state).toBe(EnemyState.RECOVER);
    expect(enemy.x).toBe(still); // standing throughout

    sim.tick(0);
    expect(enemy.state).toBe(EnemyState.CHASE);
  });

  it('keeps its locked direction even if the player steps aside', () => {
    const { sim, enemy } = lungeAbout();
    expect(enemy.lungeDir).toBe(Dir8.L);

    const y = enemy.y;
    hold(sim, SKEL_SWORD_LUNGE_TICKS);
    expect(enemy.y).toBe(y); // straight along the locked line, not curving after them
  });
});

describe('skel_axe', () => {
  it('aggroes at 144 px without needing line of sight', () => {
    expect(SKEL_AXE_AGGRO_PX).toBe(144);
    const { sim, enemy } = facingOff('skel_axe', SKEL_AXE_AGGRO_PX, DIVIDED);
    sim.tick(0);
    expect(enemy.state).toBe(EnemyState.CHASE);
  });

  it('ignores a player beyond 144 px', () => {
    const { sim, enemy } = facingOff('skel_axe', SKEL_AXE_AGGRO_PX + 1);
    sim.tick(0);
    expect(enemy.state).toBe(EnemyState.IDLE);
  });

  it('never stops once aggroed, and has no attack states', () => {
    const { sim, enemy } = facingOff('skel_axe', 100);
    hold(sim, 40);
    expect(enemy.state).toBe(EnemyState.CHASE);
    expect(ENEMY_STATS.skel_axe.speed).toBe(8);
  });

  it('chases at speed 8', () => {
    const { sim, enemy } = facingOff('skel_axe', 100);
    sim.tick(0);
    const x = enemy.x;
    sim.tick(0);
    expect(x - enemy.x).toBe(8);
  });
});

describe('zombie', () => {
  it('chases from the first tick, with no aggro condition at all', () => {
    const { sim, enemy } = facingOff('zombie', OUT_OF_RANGE_PX, DIVIDED); // far away, out of sight
    sim.tick(0);
    expect(enemy.state).toBe(EnemyState.CHASE);
  });

  it('shambles at speed 7', () => {
    const { sim, enemy } = facingOff('zombie', 100);
    sim.tick(0);
    const x = enemy.x;
    sim.tick(0);
    expect(x - enemy.x).toBe(ENEMY_STATS.zombie.speed);
    expect(ENEMY_STATS.zombie.speed).toBe(7);
  });
});

describe('wisp', () => {
  it('aggroes like a skel_sword: 112 px with line of sight', () => {
    expect(WISP_AGGRO_PX).toBe(SKEL_SWORD_AGGRO_PX);

    const seen = facingOff('wisp', WISP_AGGRO_PX);
    seen.sim.tick(0);
    expect(seen.enemy.state).toBe(EnemyState.CHASE);

    const blind = facingOff('wisp', 100, DIVIDED);
    blind.sim.tick(0);
    expect(blind.enemy.state).toBe(EnemyState.IDLE);
  });

  it('stays aggroed once it has seen the player (02 §2.4)', () => {
    const { sim, enemy } = facingOff('wisp', WISP_AGGRO_PX);
    sim.tick(0);
    expect(enemy.state).toBe(EnemyState.CHASE);

    sim.player.x = 17 * TILE_SUBPX; // flee to the far side of the room
    hold(sim, 5);
    expect(enemy.state).toBe(EnemyState.CHASE);
  });

  it('has 1 HP and dies to any hit', () => {
    expect(ENEMY_STATS.wisp.hp).toBe(1);
    const { enemy } = facingOff('wisp', 50);
    damageEnemy(enemy, 1, Dir8.L);
    expect(enemy.state).toBe(EnemyState.DYING);
  });
});

describe('hitstun', () => {
  it('pauses the state machine without pausing the knockback', () => {
    const { sim, enemy } = facingOff('skel_sword', 24);
    sim.tick(0);
    sim.tick(0);
    expect(enemy.state).toBe(EnemyState.WINDUP);
    const timer = enemy.stateTimer;

    damageEnemy(enemy, 1, Dir8.R);
    const x = enemy.x;
    sim.tick(0);

    expect(enemy.stateTimer).toBe(timer); // the windup is on hold
    expect(enemy.x).toBeGreaterThan(x); // but it is being shoved away
  });
});
