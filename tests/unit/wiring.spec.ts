import { describe, expect, it } from 'vitest';

import { CHEST_OPEN_TICKS, TILE_SUBPX } from '../../src/sim/constants.js';
import { INTERACT, UP } from '../../src/sim/input.js';
import { wireFlag } from '../../src/sim/persistence.js';
import { Facing } from '../../src/sim/player.js';
import { TileClass, tileAt } from '../../src/sim/room.js';
import { Sim } from '../../src/sim/sim.js';
import { game, hold, runUntil } from './helpers.js';

/**
 * 03-levels §1.6. Three triggers — a torch group completing, a sealed room clearing, a chest
 * opening — driving three effects: opening a puzzle door, spawning a pickup, winning. Each
 * wire fires at most once, and the firing persists (01 §9).
 */

/** Light every torch of the room's only group, one after another. */
function lightAll(sim: Sim): void {
  for (const cell of sim.torchGroups[0]!.members) {
    sim.player.x = cell[0] * TILE_SUBPX;
    sim.player.y = (cell[1] + 1) * TILE_SUBPX;
    sim.player.facing = Facing.U;
    sim.tick(0);
    sim.tick(INTERACT);
  }
}

describe('torch_group → open_door', () => {
  it('opens f2’s puzzle door d4 when G1 is complete', () => {
    const s = game({
      floorIndex: 1,
      roomId: 'R4',
      start: { x: 2 * TILE_SUBPX, y: 3 * TILE_SUBPX },
    });
    expect(s.isDoorOpen('d4')).toBe(false);
    expect(tileAt(s.room, 4, 0)).toBe(TileClass.DOOR_CLOSED);

    lightAll(s);

    expect(s.isDoorOpen('d4')).toBe(true);
    expect(tileAt(s.room, 4, 0)).toBe(TileClass.DOOR_OPEN);
    expect(s.persistence.has(wireFlag('f2', 0))).toBe(true);
  });

  it('opens f4’s d3 the same way, inside its 600-tick window', () => {
    const s = game({
      floorIndex: 3,
      roomId: 'R3',
      start: { x: 1 * TILE_SUBPX, y: 3 * TILE_SUBPX },
    });
    lightAll(s);
    expect(s.isDoorOpen('d3')).toBe(true);
  });

  it('leaves the door open after the room is left and re-entered', () => {
    const s = game({
      floorIndex: 1,
      roomId: 'R4',
      start: { x: 2 * TILE_SUBPX, y: 3 * TILE_SUBPX },
    });
    lightAll(s);
    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);
    expect(s.isDoorOpen('d4')).toBe(true);
    expect(tileAt(s.room, 4, 0)).toBe(TileClass.DOOR_OPEN);
  });

  it('and lets the player walk through it', () => {
    const s = game({
      floorIndex: 1,
      roomId: 'R4',
      start: { x: 2 * TILE_SUBPX, y: 3 * TILE_SUBPX },
    });
    lightAll(s);

    s.player.x = 4 * TILE_SUBPX + 128;
    s.player.y = 1 * TILE_SUBPX;
    runUntil(s, UP, (sim) => sim.roomId === 'R5', 200);
    expect(s.roomId).toBe('R5');
  });
});

describe('chest_open → victory', () => {
  it('wins the game when the Great Vault chest opens (03-levels F4)', () => {
    const s = game({
      floorIndex: 3,
      roomId: 'R6',
      start: { x: 4 * TILE_SUBPX, y: 3 * TILE_SUBPX },
    });
    s.player.facing = Facing.U;
    expect(s.victory).toBe(false);

    s.tick(INTERACT);
    hold(s, 0, CHEST_OPEN_TICKS - 1);
    expect(s.victory).toBe(false);

    s.tick(0);
    expect(s.victory).toBe(true);
    expect(s.treasure).toBe(10); // the chest's ten coins, in the same instant
  });

  it('stops the sim where it stands (04-ui §3.3)', () => {
    const s = game({
      floorIndex: 3,
      roomId: 'R6',
      start: { x: 4 * TILE_SUBPX, y: 3 * TILE_SUBPX },
    });
    s.player.facing = Facing.U;
    runUntil(s, INTERACT, (sim) => sim.victory, 60);

    const frozen = { x: s.player.x, y: s.player.y, tick: s.playTick };
    hold(s, 0b1111, 60);
    expect(s.player.x).toBe(frozen.x);
    expect(s.player.y).toBe(frozen.y);
    expect(s.playTick).toBe(frozen.tick + 60); // play time runs; nothing else does
  });
});

describe('every wire in the shipped levels', () => {
  it('fires at most once, and is remembered when it does', () => {
    const s = game({
      floorIndex: 1,
      roomId: 'R4',
      start: { x: 2 * TILE_SUBPX, y: 3 * TILE_SUBPX },
    });
    lightAll(s);
    expect(s.persistence.has(wireFlag('f2', 0))).toBe(true);

    // Re-entering and re-lighting cannot fire it again: the flag short-circuits it.
    const before = s.persistence.sorted().length;
    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);
    hold(s, INTERACT, 40);
    expect(s.persistence.sorted().length).toBe(before);
  });

  it('names only triggers and effects the floors actually contain', () => {
    // The linter enforces this statically (03 §1.7); this is the runtime side of it.
    for (const floor of [0, 1, 2, 3]) {
      const s = game({ floorIndex: floor });
      for (const wire of s.floor.wiring) {
        if (wire.trigger.kind === 'torch_group') {
          const groups = s.floor.rooms.flatMap((r) => r.torchGroups.map((g) => g.id));
          expect(groups).toContain(wire.trigger.group);
        }
        for (const effect of wire.effects) {
          if (effect.kind === 'open_door') expect(() => s.isDoorOpen(effect.door)).not.toThrow();
          if (effect.kind === 'spawn') expect(s.floor.roomIndex.has(effect.room)).toBe(true);
        }
      }
    }
  });
});
