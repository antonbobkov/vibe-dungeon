import { describe, expect, it } from 'vitest';

import {
  SPAWN_BLINK_TICKS,
  SPAWN_TELEGRAPH_TICKS,
  TILE_SUBPX,
  WAVE_GAP_TICKS,
} from '../../src/sim/constants.js';
import { EnemyState } from '../../src/sim/enemy.js';
import { clearedFlag } from '../../src/sim/persistence.js';
import { TileClass, tileAt } from '../../src/sim/room.js';
import { Sim } from '../../src/sim/sim.js';
import { game, hold, runUntil } from './helpers.js';

/**
 * 02-entities §2.3 and 01-mechanics §8.3. f4 R4 "The Arena" is the only wave room in the
 * game: three waves, a combat seal, and a gold key waiting on the other side of them.
 */
function arena(): Sim {
  // Well clear of every wave spawn and of (7,5)/(8,5), where clearing the room leaves the
  // gold key and the flask — standing there would pocket them the instant they appear.
  return game({ floorIndex: 3, roomId: 'R4', start: { x: 1 * TILE_SUBPX, y: 5 * TILE_SUBPX } });
}

/** Kill everything standing, the way the tests care about: straight to zero HP. */
function wipe(sim: Sim): void {
  for (const entity of sim.entities) {
    if (entity.state === EnemyState.SPAWNING) continue;
    entity.hp = 0;
    entity.state = EnemyState.DYING;
    entity.stateTimer = 1;
  }
}

describe('the seal', () => {
  it('shuts the moment the room is entered, before a single tick', () => {
    const s = arena();
    expect(s.seal).toBe(1);
    // d3 is the puzzle door in the bottom wall, d4 the normal one at the top.
    expect(tileAt(s.room, 5, 10)).toBe(TileClass.DOOR_CLOSED);
    expect(tileAt(s.room, 6, 0)).toBe(TileClass.DOOR_CLOSED);
  });

  it('holds while a wave is still telegraphing, not just while enemies stand', () => {
    const s = arena();
    expect(s.entities).toEqual([]); // nothing has appeared yet
    expect(s.telegraphs).toHaveLength(3);
    expect(s.seal).toBe(1);
  });

  it('opens again when the last wave is gone, and stays open (01 §8.3)', () => {
    const s = arena();

    // Three waves, each cleared the moment it has finished appearing.
    for (let wave = 0; wave < 3; wave++) {
      runUntil(s, 0, (sim) => sim.entities.length > 0, 400);
      hold(s, 0, SPAWN_BLINK_TICKS);
      expect(s.seal).toBe(1); // still shut with a wave on the floor
      wipe(s);
      hold(s, 0, 4);
    }
    runUntil(s, 0, (sim) => sim.seal === 0, 200);

    expect(s.persistence.has(clearedFlag('f4', 'R4'))).toBe(true);
    expect(s.entities).toEqual([]);
    expect(s.pendingWave).toBe(-1);
  });

  it('never comes back once cleared (01 §9)', () => {
    const s = arena();
    s.persistence.set(clearedFlag('f4', 'R4'));
    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);

    expect(s.seal).toBe(0);
    expect(s.entities).toEqual([]);
    expect(s.telegraphs).toEqual([]);
    expect(s.pendingWave).toBe(-1);
  });
});

describe('the waves', () => {
  it('telegraphs each spawn for 30 ticks, then blinks it in for 12', () => {
    const s = arena();
    expect(s.telegraphs.map((t) => t.ticksLeft)).toEqual([
      SPAWN_TELEGRAPH_TICKS,
      SPAWN_TELEGRAPH_TICKS,
      SPAWN_TELEGRAPH_TICKS,
    ]);

    hold(s, 0, SPAWN_TELEGRAPH_TICKS - 1);
    expect(s.entities).toEqual([]);

    s.tick(0);
    expect(s.telegraphs).toEqual([]);
    expect(s.entities).toHaveLength(3);
    expect(s.entities.every((e) => e.state === EnemyState.SPAWNING)).toBe(true);

    hold(s, 0, SPAWN_BLINK_TICKS - 1);
    expect(s.entities.every((e) => e.state === EnemyState.SPAWNING)).toBe(true);
    s.tick(0);
    expect(s.entities.every((e) => e.state === EnemyState.IDLE)).toBe(true);
  });

  it('cannot be hit or hurt while blinking in (02 §2.3)', () => {
    const s = arena();
    hold(s, 0, SPAWN_TELEGRAPH_TICKS);
    const spawning = s.entities[0]!;
    expect(spawning.state).toBe(EnemyState.SPAWNING);

    // Park the player on top of it: no contact damage in either direction.
    s.player.x = spawning.x;
    s.player.y = spawning.y;
    hold(s, 0, 4);
    expect(s.player.hp).toBe(6);
    expect(spawning.hp).toBeGreaterThan(0);
  });

  it('sends the three waves 03-levels lists, in order', () => {
    const s = arena();
    const seen: string[][] = [];

    for (let wave = 0; wave < 3; wave++) {
      runUntil(s, 0, (sim) => sim.entities.length > 0, 300);
      hold(s, 0, SPAWN_BLINK_TICKS);
      seen.push(s.entities.map((e) => e.kind).sort());
      wipe(s);
      hold(s, 0, 4);
    }

    expect(seen).toEqual([
      ['skel_sword', 'skel_sword', 'skel_sword'],
      ['skel_axe', 'skel_axe', 'wisp'],
      ['skel_sword', 'skel_sword', 'wisp', 'zombie'],
    ]);
  });

  it('waits 30 ticks after the last of a wave dies before the next telegraphs', () => {
    const s = arena();
    runUntil(s, 0, (sim) => sim.entities.length === 3, 300);
    hold(s, 0, SPAWN_BLINK_TICKS);
    wipe(s);
    runUntil(s, 0, (sim) => sim.entities.length === 0, 30);

    // The gap starts on the tick the room empties, and nothing telegraphs until it is up.
    hold(s, 0, WAVE_GAP_TICKS - 1);
    expect(s.telegraphs).toEqual([]);
    s.tick(0);
    expect(s.telegraphs).toHaveLength(3);
  });
});

describe('clearing the arena', () => {
  it('fires room_clear, which leaves the gold key and a large red flask (03-levels F4)', () => {
    const s = arena();

    for (let wave = 0; wave < 3; wave++) {
      runUntil(s, 0, (sim) => sim.entities.length > 0, 400);
      hold(s, 0, SPAWN_BLINK_TICKS);
      wipe(s);
      hold(s, 0, 4);
    }
    runUntil(s, 0, (sim) => sim.seal === 0, 200);

    expect(s.pickups.map((p) => p.kind).sort()).toEqual(['gold_key', 'red_large']);
    expect(s.pickups.map((p) => p.at)).toEqual([
      [7, 5],
      [8, 5],
    ]);
  });

  it('leaves those pickups there if the player walks out and comes back', () => {
    const s = arena();
    for (let wave = 0; wave < 3; wave++) {
      runUntil(s, 0, (sim) => sim.entities.length > 0, 400);
      hold(s, 0, SPAWN_BLINK_TICKS);
      wipe(s);
      hold(s, 0, 4);
    }
    runUntil(s, 0, (sim) => sim.seal === 0, 200);

    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);
    expect(s.pickups.map((p) => p.kind).sort()).toEqual(['gold_key', 'red_large']);
  });
});
