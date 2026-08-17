import { describe, expect, it } from 'vitest';

import {
  ENEMY_DEATH_TICKS,
  HIT_STOP_TICKS,
  SWING_ACTIVE_FIRST,
  SWING_ACTIVE_LAST,
  SWING_TICKS,
  SWORD_REACH_PX,
  TILE_SUBPX,
} from '../../src/sim/constants.js';
import { isSwingActive, swingElapsed, swordRect } from '../../src/sim/combat.js';
import { EnemyState, createEntity } from '../../src/sim/enemy.js';
import { ATTACK, LEFT, RIGHT, UP } from '../../src/sim/input.js';
import { Facing, PlayerState, createPlayer } from '../../src/sim/player.js';
import { parseRoom } from '../../src/sim/room.js';
import { Sim } from '../../src/sim/sim.js';

const ROOM = [
  '#########',
  '#.......#',
  '#.......#',
  '#.......#',
  '#.......#',
  '#.......#',
  '#########',
];

/** The player on tile (2,2), facing right, with room to swing. */
function sim(): Sim {
  const s = new Sim(parseRoom(ROOM), { start: { x: 2 * TILE_SUBPX, y: 2 * TILE_SUBPX } });
  s.player.facing = Facing.R;
  return s;
}

/** A still enemy the player can reach, one tile to the right. */
function targetAt(s: Sim, col: number, row: number): void {
  s.entities.push(createEntity(0, 'skel_sword', col * TILE_SUBPX, row * TILE_SUBPX, null));
}

function hold(s: Sim, input: number, ticks: number): void {
  for (let i = 0; i < ticks; i++) s.tick(input);
}

// 01-mechanics §4.2.
describe('the sword box', () => {
  it('is a 16 × 16 cell offset 14 px toward the facing', () => {
    const player = createPlayer(1000, 2000, 6);
    const reach = SWORD_REACH_PX * 16;
    expect(SWORD_REACH_PX).toBe(14);

    player.facing = Facing.R;
    expect(swordRect(player)).toEqual({
      l: 1000 + reach,
      t: 2000,
      r: 1000 + reach + TILE_SUBPX,
      b: 2000 + TILE_SUBPX,
    });

    player.facing = Facing.L;
    expect(swordRect(player).l).toBe(1000 - reach);
    player.facing = Facing.U;
    expect(swordRect(player).t).toBe(2000 - reach);
    player.facing = Facing.D;
    expect(swordRect(player).t).toBe(2000 + reach);
  });

  it('overlaps the player’s own cell by 2 px, so a touching enemy is reachable', () => {
    const player = createPlayer(0, 0, 6);
    player.facing = Facing.R;
    // The cell spans 0..256; the blade starts at 224, two pixels inside it.
    expect(swordRect(player).l).toBe(TILE_SUBPX - 2 * 16);
  });
});

describe('the swing', () => {
  it('lasts 14 ticks and starts on the press', () => {
    const s = sim();
    expect(s.player.state).toBe(PlayerState.NORMAL);

    s.tick(ATTACK);
    expect(s.player.state).toBe(PlayerState.SWING);
    expect(swingElapsed(s.player)).toBe(0);

    hold(s, 0, SWING_TICKS - 1);
    expect(s.player.state).toBe(PlayerState.SWING);
    expect(swingElapsed(s.player)).toBe(SWING_TICKS - 1);

    hold(s, 0, 1);
    expect(s.player.state).toBe(PlayerState.NORMAL); // NORMAL at tick 14
  });

  it('is only active on ticks 3–9', () => {
    const s = sim();
    const seen: number[] = [];
    s.tick(ATTACK);
    for (let tick = 0; tick < SWING_TICKS; tick++) {
      if (isSwingActive(s.player)) seen.push(swingElapsed(s.player));
      s.tick(0);
    }
    expect(seen).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect([SWING_ACTIVE_FIRST, SWING_ACTIVE_LAST]).toEqual([3, 9]);
  });

  it('cannot be cancelled, and cannot re-trigger before it ends', () => {
    const s = sim();
    s.tick(ATTACK); // swing tick 0
    hold(s, 0, 5); // ticks 1–5
    s.tick(ATTACK); // a second press, mid-swing
    expect(swingElapsed(s.player)).toBe(6); // the same swing, still running

    hold(s, 0, SWING_TICKS - 6); // out to tick 14
    expect(s.player.state).toBe(PlayerState.NORMAL);
    s.tick(ATTACK);
    expect(swingElapsed(s.player)).toBe(0); // now it re-triggers
  });

  it('acts on the press, not the hold', () => {
    const s = sim();
    hold(s, ATTACK, SWING_TICKS + 1); // held throughout
    expect(s.player.state).toBe(PlayerState.NORMAL); // one swing, no repeat
    s.tick(ATTACK);
    expect(s.player.state).toBe(PlayerState.NORMAL); // still held: not a fresh press
  });

  it('locks movement for ticks 0–9 and frees it for 10–13', () => {
    const s = sim();
    const start = s.player.x;
    s.tick(ATTACK);
    hold(s, RIGHT, 9);
    expect(s.player.x).toBe(start);

    hold(s, RIGHT, 4); // ticks 10–13
    expect(s.player.x).toBe(start + 4 * 20);
  });
});

describe('connecting', () => {
  it('damages an enemy in the box once per swing', () => {
    const s = sim();
    targetAt(s, 3, 2);
    const enemy = s.entities[0]!;
    expect(enemy.hp).toBe(2);

    hold(s, ATTACK, 1);
    hold(s, 0, 3); // through the whole active window
    expect(enemy.hp).toBe(1);

    hold(s, 0, 10);
    expect(enemy.hp).toBe(1); // the same swing never hits twice
  });

  it('kills a skel_sword with two swings, walking back into reach between them', () => {
    // 02 §2.2 gives it 2 HP, and 01 §4.2's knockback shoves it out of range after the first
    // hit — so landing the second means closing the distance again.
    const s = sim();
    targetAt(s, 3, 2);
    const enemy = s.entities[0]!;

    hold(s, ATTACK, 1);
    hold(s, 0, SWING_TICKS + HIT_STOP_TICKS);
    expect(enemy.hp).toBe(1);
    expect(enemy.x).toBeGreaterThan(3 * TILE_SUBPX); // knocked away

    for (let i = 0; i < 40 && enemy.hp > 0; i++) {
      hold(s, RIGHT, 4);
      hold(s, ATTACK, 1);
      hold(s, 0, SWING_TICKS + HIT_STOP_TICKS);
    }

    expect(enemy.hp).toBeLessThanOrEqual(0);
    expect(enemy.state).toBe(EnemyState.DYING);
  });

  it('takes 12 ticks to die, then leaves the room (02 §2.1)', () => {
    const s = sim();
    targetAt(s, 3, 2);
    const enemy = s.entities[0]!;
    enemy.hp = 1; // one hit from death

    hold(s, ATTACK, 1);
    hold(s, 0, 3);
    expect(enemy.state).toBe(EnemyState.DYING);
    expect(enemy.stateTimer).toBe(ENEMY_DEATH_TICKS);

    // The killing blow also fired hit-stop, and a frozen tick is not a dying tick.
    hold(s, 0, HIT_STOP_TICKS);
    expect(enemy.stateTimer).toBe(ENEMY_DEATH_TICKS);

    hold(s, 0, ENEMY_DEATH_TICKS - 1);
    expect(s.entities).toHaveLength(1); // still fading
    hold(s, 0, 1);
    expect(s.entities).toEqual([]);
  });

  it('misses an enemy outside the box', () => {
    const s = sim();
    targetAt(s, 5, 2); // three tiles away
    hold(s, ATTACK, 1);
    hold(s, 0, SWING_TICKS);
    expect(s.entities[0]!.hp).toBe(2);
  });

  it('misses an enemy behind the player', () => {
    const s = sim();
    targetAt(s, 1, 2);
    s.player.facing = Facing.R;
    hold(s, ATTACK, 1);
    hold(s, 0, SWING_TICKS);
    expect(s.entities[0]!.hp).toBe(2);
  });

  it('reaches in whichever direction the player faces', () => {
    for (const [input, col, row] of [
      [UP, 2, 1],
      [LEFT, 1, 2],
    ] as const) {
      const s = sim();
      s.tick(input); // turn first
      targetAt(s, col, row);
      hold(s, ATTACK, 1);
      hold(s, 0, SWING_TICKS);
      expect(s.entities[0]!.hp, `facing ${input}`).toBe(1);
    }
  });

  it('freezes the sim for 3 ticks when it connects (01 §4.2)', () => {
    const s = sim();
    targetAt(s, 3, 2);
    hold(s, ATTACK, 1);
    hold(s, 0, 2); // reach the active window

    expect(s.hitStop).toBe(0);
    s.tick(0); // the connecting tick
    expect(s.hitStop).toBe(HIT_STOP_TICKS);

    const frozen = swingElapsed(s.player);
    hold(s, 0, HIT_STOP_TICKS);
    expect(swingElapsed(s.player)).toBe(frozen); // phases 3–9 skipped throughout
    s.tick(0);
    expect(swingElapsed(s.player)).toBe(frozen + 1); // and resumed after
  });

  it('does not freeze on a miss', () => {
    const s = sim();
    hold(s, ATTACK, 1);
    hold(s, 0, SWING_TICKS);
    expect(s.hitStop).toBe(0);
  });

  it('catches two enemies with one swing, but freezes only once', () => {
    const s = sim();
    targetAt(s, 3, 2);
    s.entities.push(createEntity(1, 'skel_sword', 3 * TILE_SUBPX, 2 * TILE_SUBPX - 64, null));
    hold(s, ATTACK, 1);
    hold(s, 0, 3);
    expect(s.entities.map((e) => e.hp)).toEqual([1, 1]);
    expect(s.hitStop).toBe(HIT_STOP_TICKS);
  });
});
