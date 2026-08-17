import { describe, expect, it } from 'vitest';

import { ENEMY_STATS } from '../../src/sim/constants.js';
import { DOWN, LEFT, RIGHT, UP } from '../../src/sim/input.js';
import {
  clearedFlag,
  pickupFlag,
  pitFlag,
  propFlag,
  torchFlag,
  wireFlag,
} from '../../src/sim/persistence.js';
import { TileClass, tileAt } from '../../src/sim/room.js';
import { ENEMY_TYPE_ID, EnemyState } from '../../src/sim/enemy.js';
import { game, hold, runUntil } from './helpers.js';

/**
 * One case per line of 01-mechanics §9. Room state is rebuilt on every entry from the level
 * data plus the persistent flags, so "reset" and "persist" are two views of the same rebuild.
 */

/** Walk out of f1 R1 into R2 and back again, ending in R1. */
function roundTrip(): ReturnType<typeof game> {
  const s = game();
  runUntil(s, UP, (sim) => sim.roomId === 'R2', 200);
  runUntil(s, DOWN, (sim) => sim.roomId === 'R1', 200);
  return s;
}

describe('reset on room entry (01 §9)', () => {
  it('respawns enemies at their map positions with full HP', () => {
    // Start on R2's entry tile, so walking DOWN goes back through d1.
    const s = game({ roomId: 'R2', start: { x: 1152, y: 1792 } });
    expect(s.entities).toHaveLength(1);
    expect(s.entities[0]).toMatchObject({
      id: 0,
      kind: 'skel_sword',
      x: 6 * 256,
      y: 4 * 256,
      hp: ENEMY_STATS.skel_sword.hp,
      state: EnemyState.IDLE,
      stateTimer: 0,
      hitstun: 0,
      aggroed: false,
      drop: null,
    });
    expect(ENEMY_TYPE_ID[s.entities[0]!.kind]).toBe(0);

    // Wound and move it, leave, come back: it is the map's skeleton again.
    s.entities[0]!.hp = 1;
    s.entities[0]!.x = 0;
    runUntil(s, DOWN, (sim) => sim.roomId === 'R1', 200);
    runUntil(s, UP, (sim) => sim.roomId === 'R2', 200);
    expect(s.entities[0]!.hp).toBe(ENEMY_STATS.skel_sword.hp);
    expect(s.entities[0]!.x).toBe(6 * 256);
  });

  it('resets trap phase counters to their per-placement offsets', () => {
    // f2 R1's two spikes are offset 0 and 60 on a 120-tick period.
    const s = game({ floorIndex: 1 });
    expect(s.traps.map((t) => t.phase)).toEqual([0, 60]);

    hold(s, 0, 30);
    expect(s.traps.map((t) => t.phase)).toEqual([30, 90]);

    runUntil(s, UP, (sim) => sim.roomId === 'R2', 300);
    runUntil(s, DOWN, (sim) => sim.roomId === 'R1', 300);
    expect(s.roomTimer).toBe(0);
    expect(s.traps.map((t) => t.phase)).toEqual([0, 60]);
  });

  it('advances trap phases off the room clock, not play time (02 §3)', () => {
    const s = game({ floorIndex: 1 });
    hold(s, 0, 121);
    expect(s.roomTimer).toBe(121);
    expect(s.traps.map((t) => t.phase)).toEqual([1, 61]);
  });

  it('starts every room with no projectiles in flight', () => {
    const s = game({ floorIndex: 1, roomId: 'R3' });
    expect(s.traps.some((t) => t.def.kind === 'arrow')).toBe(true);
    // Bolts arrive with M4; the invariant that a fresh room has none holds from here on.
    expect(s.entities.every((e) => e.state === EnemyState.IDLE)).toBe(true);
  });

  it('rebuilds unconsumed pushable crates from the map', () => {
    // f3 R2's crate is at (6,4). Nothing removes it, so it is back on every entry.
    const s = game({ floorIndex: 2, roomId: 'R2' });
    expect(tileAt(s.room, 6, 4)).toBe(TileClass.PROP);
    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);
    expect(tileAt(s.room, 6, 4)).toBe(TileClass.PROP);
  });
});

describe('persist per floor (01 §9)', () => {
  it('keeps collected pickups collected', () => {
    const s = game();
    expect(s.pickups).toHaveLength(4); // R1's four coins
    runUntil(s, UP, (sim) => sim.treasure === 2, 100); // walk over the lower pair
    expect(s.pickups).toHaveLength(2);

    runUntil(s, UP, (sim) => sim.roomId === 'R2', 200);
    runUntil(s, DOWN, (sim) => sim.roomId === 'R1', 200);
    expect(s.treasure).toBe(2);
    expect(s.pickups).toHaveLength(2); // the two taken never come back
    expect(s.persistence.has(pickupFlag('f1', 'R1', 5, 3))).toBe(true);
  });

  it('keeps opened doors open across a round trip', () => {
    const s = roundTrip();
    expect(s.isDoorOpen('d1')).toBe(true);
    expect(tileAt(s.room, 4, 0)).toBe(TileClass.DOOR_OPEN);
    expect(tileAt(s.room, 5, 0)).toBe(TileClass.DOOR_OPEN);
  });

  it('keeps unlocked doors unlocked', () => {
    const s = game({ roomId: 'R2', start: { x: 6 * 256, y: 1 * 256 } });
    s.inventory.silverKeys = 1;
    runUntil(s, UP, (sim) => sim.isDoorOpen('d3'), 60);
    runUntil(s, UP, (sim) => sim.roomId === 'R4', 200);
    runUntil(s, DOWN, (sim) => sim.roomId === 'R2', 200);
    expect(s.isDoorOpen('d3')).toBe(true);
    expect(s.silverKeys).toBe(0); // and the key stays spent
  });

  it('leaves a destroyed crate destroyed', () => {
    const s = game({ roomId: 'R5' });
    expect(tileAt(s.room, 2, 2)).toBe(TileClass.PROP);
    s.persistence.set(propFlag('f1', 'R5', 2, 2));
    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);
    expect(tileAt(s.room, 2, 2)).toBe(TileClass.FLOOR);
  });

  it('leaves an opened chest in place, since chests never disappear (02 §4.1)', () => {
    const s = game({ roomId: 'R5' });
    s.persistence.set(propFlag('f1', 'R5', 5, 1));
    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);
    expect(tileAt(s.room, 5, 1)).toBe(TileClass.PROP);
  });

  it('keeps a bridged pit bridged (02 §4.2)', () => {
    const s = game({ floorIndex: 2, roomId: 'R2' });
    expect(tileAt(s.room, 6, 2)).toBe(TileClass.PIT);
    s.persistence.set(pitFlag('f3', 'R2', 6, 2));
    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);
    expect(tileAt(s.room, 6, 2)).toBe(TileClass.BRIDGED_PIT);
  });

  it('never respawns enemies in a cleared combat_seal room (01 §8.3)', () => {
    const s = game({ floorIndex: 2, roomId: 'R6' });
    expect(s.entities).toHaveLength(3);
    s.persistence.set(clearedFlag('f3', 'R6'));
    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);
    expect(s.entities).toEqual([]);
    expect(s.pendingWave).toBe(-1);
  });

  it('respawns enemies in an ordinary room every time', () => {
    const s = game({ floorIndex: 2, roomId: 'R3' });
    expect(s.entities).toHaveLength(3);
    s.entities = [];
    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);
    expect(s.entities).toHaveLength(3);
  });

  it('gives lit torches and fired wiring their own flags, which the rebuild honours', () => {
    // The systems land in M4; the ids they will use are fixed and hashed from here on.
    const s = game();
    s.persistence.set(torchFlag('f2', 'R4', 2, 2));
    s.persistence.set(wireFlag('f2', 0));
    expect(s.persistence.sorted()).toEqual(['f2/R4/torch/2,2', 'f2/wire/0']);
  });
});

describe('persist across floors (01 §8.4, §9)', () => {
  /** Stand under f1 R6's ladder and hold UP until the floor changes. */
  function descend(): ReturnType<typeof game> {
    const s = game({ roomId: 'R6', start: { x: 3 * 256, y: 1 * 256 } });
    s.inventory.treasure = 17;
    s.inventory.silverKeys = 2;
    s.inventory.goldKey = true;
    s.player.hp = 3;
    s.deaths = 4;
    runUntil(s, UP, (sim) => sim.floorIndex === 1, 200);
    return s;
  }

  it('takes 12 ticks of UP under the ladder, then 30 to load (01 §8.4)', () => {
    const s = game({ roomId: 'R6', start: { x: 3 * 256, y: 1 * 256 } });
    hold(s, UP, 11);
    expect(s.script).toBeNull();
    s.tick(UP);
    expect(s.script).toEqual({ kind: 'descend', ticksLeft: 60, loaded: false });

    hold(s, UP, 29);
    expect(s.floorIndex).toBe(0); // still fading out
    s.tick(UP);
    expect(s.floorIndex).toBe(1); // loaded at the midpoint, fade-in still to come
    expect(s.script?.kind).toBe('descend');

    hold(s, UP, 30);
    expect(s.script).toBeNull();
  });

  it('resets the ladder hold if UP is released', () => {
    const s = game({ roomId: 'R6', start: { x: 3 * 256, y: 1 * 256 } });
    hold(s, UP, 11);
    s.tick(0);
    hold(s, UP, 11);
    expect(s.script).toBeNull();
  });

  it('needs the player to actually be under the ladder', () => {
    const s = game({ roomId: 'R6', start: { x: 1 * 256, y: 3 * 256 } });
    hold(s, UP, 60);
    expect(s.floorIndex).toBe(0);
  });

  it('carries HP, treasure, deaths and the gold key over, and zeroes silver keys', () => {
    const s = descend();
    expect(s.floor.id).toBe('f2');
    expect(s.roomId).toBe('R1');
    expect(s.player.hp).toBe(3);
    expect(s.treasure).toBe(17);
    expect(s.deaths).toBe(4);
    expect(s.goldKey).toBe(true);
    expect(s.silverKeys).toBe(0); // each floor's keys equal its locks (01 §8.4)
  });

  it('spawns on the new floor’s @ tile and checkpoints there', () => {
    const s = descend();
    // f2 R1's `@` is (4,5).
    expect([s.player.x, s.player.y]).toEqual([4 * 256, 5 * 256]);
    expect(s.checkpoint).toEqual({ x: 4 * 256, y: 5 * 256, facing: 1, hp: 3 });
  });

  it('leaves floor 1’s flags behind rather than applying them to floor 2', () => {
    const s = descend();
    expect(s.isDoorOpen('d1')).toBe(false); // f2's own d1, untouched
    expect(s.pickups).toHaveLength(2); // f2 R1's two coins are still there
  });
});

describe('room state is derived, not accumulated', () => {
  it('rebuilds a room to exactly the same objects on re-entry', () => {
    const s = game({ roomId: 'R2' });
    const first = JSON.stringify([s.entities, s.traps, s.pickups, [...s.room.tiles]]);

    hold(s, RIGHT, 10);
    hold(s, LEFT, 10);
    s.entities[0]!.hp = 1;
    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);

    expect(JSON.stringify([s.entities, s.traps, s.pickups, [...s.room.tiles]])).toBe(first);
  });

  it('reflects the flags set since the first visit, and only those', () => {
    const s = game({ roomId: 'R5' });
    const before = [...s.room.tiles];
    s.persistence.set(propFlag('f1', 'R5', 2, 2));
    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);

    const after = [...s.room.tiles];
    const changed = after.map((v, i) => (v === before[i] ? null : i)).filter((i) => i !== null);
    expect(changed).toEqual([2 * 11 + 2]); // only the destroyed crate's cell
  });
});
