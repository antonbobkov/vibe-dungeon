import { describe, expect, it } from 'vitest';

import { damagePlayer, isInvulnerable } from '../../src/sim/combat.js';
import {
  ENEMY_KNOCKBACK,
  ENEMY_KNOCKBACK_DECAY,
  ENEMY_STATS,
  HIT_STOP_TICKS,
  HURT_INPUT_LOCK,
  HURT_TICKS,
  IFRAME_TICKS,
  MAX_HP,
  PLAYER_KNOCKBACK,
  PLAYER_KNOCKBACK_DECAY,
  RESISTANT_HITSTUN,
  RESISTANT_KNOCKBACK,
  ENEMY_HITSTUN,
  TILE_SUBPX,
} from '../../src/sim/constants.js';
import { EnemyState, createEntity, damageEnemy } from '../../src/sim/enemy.js';
import { Dir8 } from '../../src/sim/geometry.js';
import { LEFT, RIGHT } from '../../src/sim/input.js';
import { Facing, PlayerState, acceptsInput, createPlayer } from '../../src/sim/player.js';
import { parseRoom } from '../../src/sim/room.js';
import { Sim } from '../../src/sim/sim.js';

const ROOM = [
  '###########',
  '#.........#',
  '#.........#',
  '#.........#',
  '#.........#',
  '#.........#',
  '###########',
];

function sim(): Sim {
  return new Sim(parseRoom(ROOM), { start: { x: 3 * TILE_SUBPX, y: 3 * TILE_SUBPX } });
}

function hold(s: Sim, input: number, ticks: number): void {
  for (let i = 0; i < ticks; i++) s.tick(input);
}

/** An enemy sitting exactly on top of the player, so contact lands every tick. */
function touching(s: Sim, kind: Parameters<typeof createEntity>[1] = 'skel_sword'): void {
  s.entities.push(createEntity(0, kind, s.player.x, s.player.y, null));
}

/**
 * Tick while keeping the enemy on top of the player. Knockback would otherwise carry the
 * player clear of a stationary enemy — these tests are about the damage rules, not pursuit,
 * which arrives with the state machines.
 */
function tickInContact(s: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    const enemy = s.entities[0];
    if (enemy) {
      enemy.x = s.player.x;
      enemy.y = s.player.y;
    }
    s.tick(0);
  }
}

// 01-mechanics §5.1 — the milestone's headline case.
describe('i-frames', () => {
  it('refuse a second hit at tick 59 and admit it at tick 60', () => {
    const s = sim();
    touching(s); // an enemy on top of the player, trying again every tick
    s.tick(0);
    expect(s.player.hp).toBe(MAX_HP - 1);
    expect(s.player.iframeTimer).toBe(IFRAME_TICKS);

    // A hit also freezes the sim for 3 ticks (01 §5.1), and a frozen tick is not an i-frame
    // tick — phases 3–9 do not run, so the timer holds.
    tickInContact(s, HIT_STOP_TICKS);
    expect(s.player.iframeTimer).toBe(IFRAME_TICKS);

    tickInContact(s, IFRAME_TICKS - 1); // i-frame ticks 1–59
    expect(s.player.iframeTimer).toBe(1);
    expect(s.player.hp).toBe(MAX_HP - 1); // still refused at 59

    tickInContact(s, 1); // tick 60: the window has run out
    expect(s.player.hp).toBe(MAX_HP - 2);
  });

  it('last exactly 60 ticks', () => {
    expect(IFRAME_TICKS).toBe(60);
    const player = createPlayer(0, 0, MAX_HP);
    damagePlayer(player, 1, { x: 0, y: 0 });
    expect(isInvulnerable(player)).toBe(true);
    player.iframeTimer = 0;
    expect(isInvulnerable(player)).toBe(false);
  });

  it('are not the same thing as the blue flask, but either one refuses a hit', () => {
    const player = createPlayer(0, 0, MAX_HP);
    player.invulnTimer = 180;
    expect(damagePlayer(player, 1, { x: 100, y: 0 })).toBe(false);
    expect(player.hp).toBe(MAX_HP);
  });
});

describe('taking a hit', () => {
  it('subtracts HP, starts HURT, and freezes the sim briefly (01 §5.1)', () => {
    const s = sim();
    touching(s);
    s.tick(0);
    expect(s.player.state).toBe(PlayerState.HURT);
    expect(s.player.stateTimer).toBe(HURT_TICKS);
    expect(s.hitStop).toBe(HIT_STOP_TICKS);
  });

  it('deals the attacker’s contact damage (02 §2.2)', () => {
    for (const [kind, damage] of [
      ['skel_sword', 1],
      ['skel_axe', 2],
      ['zombie', 1],
      ['wisp', 1],
    ] as const) {
      const s = sim();
      touching(s, kind);
      s.tick(0);
      expect(s.player.hp, kind).toBe(MAX_HP - damage);
      expect(ENEMY_STATS[kind].contactDamage).toBe(damage);
    }
  });

  it('ignores input for the first six ticks of HURT, then listens again', () => {
    const s = sim();
    touching(s);
    s.tick(0);
    s.entities = []; // clear the attacker so only the HURT rules matter
    hold(s, 0, HIT_STOP_TICKS); // and let the freeze pass

    const listening: boolean[] = [];
    for (let i = 0; i < HURT_TICKS; i++) {
      listening.push(acceptsInput(s.player));
      s.tick(RIGHT);
    }
    expect(listening).toEqual([
      false,
      false,
      false,
      false,
      false,
      false, // ticks 0–5
      true,
      true,
      true,
      true,
      true,
      true, // ticks 6–11
    ]);
    expect(HURT_INPUT_LOCK).toBe(6);
  });

  it('returns to NORMAL after 12 ticks, while i-frames run on', () => {
    const s = sim();
    touching(s);
    s.tick(0);
    s.entities = [];

    hold(s, 0, HIT_STOP_TICKS + HURT_TICKS - 1);
    expect(s.player.state).toBe(PlayerState.HURT);
    s.tick(0);
    expect(s.player.state).toBe(PlayerState.NORMAL);
    expect(s.player.iframeTimer).toBeGreaterThan(0); // independent of the state
  });
});

// 01 §5.2 and §4.2 — knockback is a decaying magnitude along a snapped direction.
describe('knockback', () => {
  it('sends the player 48, 44, 40 … over 12 ticks, 312 subpx in all', () => {
    const player = createPlayer(0, 0, MAX_HP);
    damagePlayer(player, 1, { x: -1000, y: 0 }); // struck from the left
    expect(player.knockDir).toBe(Dir8.R);

    const speeds: number[] = [];
    let total = 0;
    for (let mag = player.knockMag; mag > 0; mag -= PLAYER_KNOCKBACK_DECAY) {
      speeds.push(mag);
      total += mag;
    }
    expect(speeds.slice(0, 3)).toEqual([48, 44, 40]);
    expect(speeds).toHaveLength(12);
    expect(total).toBe(312); // ≈19 px, as 01 §5.2 says
    expect(PLAYER_KNOCKBACK).toBe(48);
  });

  it('actually moves the player, and stops after 12 ticks', () => {
    const s = sim();
    const start = { x: s.player.x, y: s.player.y };
    touching(s);
    s.tick(0);
    s.entities = [];

    // The enemy's box sits slightly higher than the player's, so it shoves them downward.
    expect(s.player.knockDir).toBe(Dir8.D);

    hold(s, 0, HIT_STOP_TICKS + 12);
    expect(s.player.y - start.y).toBe(312); // the full 01 §5.2 budget
    expect(s.player.x).toBe(start.x);
    expect(s.player.knockMag).toBe(0);
    expect(s.player.knockVy).toBe(4); // the last step's velocity, still on the books

    s.tick(0);
    expect(s.player.knockVy).toBe(0); // and cleared the tick after it is spent

    const settled = s.player.y;
    hold(s, 0, 10);
    expect(s.player.y).toBe(settled); // no drift once it has run out
  });

  it('sends an enemy 48, 42, 36 … and stuns it for 8 ticks', () => {
    const enemy = createEntity(0, 'skel_sword', 0, 0, null);
    damageEnemy(enemy, 1, Dir8.R);
    expect(enemy.knockMag).toBe(ENEMY_KNOCKBACK);
    expect(enemy.hitstun).toBe(ENEMY_HITSTUN);

    const speeds: number[] = [];
    let total = 0;
    for (let mag = enemy.knockMag; mag > 0; mag -= ENEMY_KNOCKBACK_DECAY) {
      speeds.push(mag);
      total += mag;
    }
    expect(speeds).toEqual([48, 42, 36, 30, 24, 18, 12, 6]);
    expect(total).toBe(216);
  });

  it('barely moves a resistant enemy: 24 subpx and 4 ticks of stun (02 §2.2)', () => {
    for (const kind of ['skel_axe', 'zombie'] as const) {
      const enemy = createEntity(0, kind, 0, 0, null);
      damageEnemy(enemy, 1, Dir8.R);
      expect(enemy.knockMag, kind).toBe(RESISTANT_KNOCKBACK);
      expect(enemy.knockMag, kind).toBe(24);
      expect(enemy.hitstun, kind).toBe(RESISTANT_HITSTUN);
      expect(enemy.hp, kind).toBe(ENEMY_STATS[kind].hp - 1); // and survives it
    }
  });

  it('does not bother knocking back a wisp, which dies to any hit', () => {
    const wisp = createEntity(0, 'wisp', 0, 0, null);
    damageEnemy(wisp, 1, Dir8.R);
    expect(wisp.state).toBe(EnemyState.DYING);
    expect(wisp.knockMag).toBe(0);
    expect(wisp.hitstun).toBe(0);
  });

  it('keeps a diagonal knockback on its line, at the 181/256 rate', () => {
    const s = sim();
    const player = s.player;
    damagePlayer(player, 1, { x: player.x - 500, y: player.y - 500 });
    expect(player.knockDir).toBe(Dir8.DR);

    const before = { x: player.x, y: player.y };
    s.tick(0);
    // 48 → 33 per axis, and both axes move together.
    expect(player.x - before.x).toBe(33);
    expect(player.y - before.y).toBe(33);
  });

  it('sends the player opposite their facing when the centres coincide (01 §5.2)', () => {
    const player = createPlayer(0, 0, MAX_HP);
    player.facing = Facing.R;
    const centre = { x: player.x + 128, y: player.y + 192 };
    damagePlayer(player, 1, centre);
    expect(player.knockDir).toBe(Dir8.L);
  });

  it('collides with walls instead of pushing through them', () => {
    // Against the left wall, knocked further left: it simply stays flush.
    const s = new Sim(parseRoom(ROOM), { start: { x: 1 * TILE_SUBPX, y: 3 * TILE_SUBPX } });
    hold(s, LEFT, 20);
    const flush = s.player.x;
    damagePlayer(s.player, 1, { x: 9999, y: s.player.y });
    expect(s.player.knockDir).toBe(Dir8.L);
    hold(s, 0, 12);
    expect(s.player.x).toBe(flush);
  });
});

describe('a dying enemy', () => {
  it('stops dealing contact damage while it fades (02 §2.1)', () => {
    const s = sim();
    touching(s);
    const enemy = s.entities[0]!;
    enemy.state = EnemyState.DYING;
    enemy.stateTimer = 12;

    hold(s, 0, 5);
    expect(s.player.hp).toBe(MAX_HP);
  });
});
