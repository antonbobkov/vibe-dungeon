import { describe, expect, it } from 'vitest';

import { CHEST_OPEN_TICKS, MAX_HP, TILE_SUBPX } from '../../src/sim/constants.js';
import { INTERACT, UP } from '../../src/sim/input.js';
import { propFlag } from '../../src/sim/persistence.js';
import { PropState } from '../../src/sim/prop.js';
import { Facing } from '../../src/sim/player.js';
import { game, hold, runUntil } from './helpers.js';

/**
 * 02-entities §4.1. A chest is solid and interactive: INTERACT starts a 16-tick OPENING, and
 * when that finishes it hands over its whole contents, once and for all.
 */

/** f1 R3's mini chest at (6,5) holds the floor's silver key. */
function atMiniChest(): ReturnType<typeof game> {
  const s = game({ roomId: 'R3', start: { x: 6 * TILE_SUBPX, y: 6 * TILE_SUBPX } });
  s.player.facing = Facing.U;
  return s;
}

describe('opening one', () => {
  it('takes 16 ticks from the press', () => {
    const s = atMiniChest();
    const chest = s.props.find((p) => p.kind === 'mini_chest')!;
    expect(s.interactTile()).toEqual([6, 5]);

    s.tick(INTERACT);
    expect(chest.state).toBe(PropState.OPENING);
    expect(chest.timer).toBe(CHEST_OPEN_TICKS);

    hold(s, 0, CHEST_OPEN_TICKS - 1);
    expect(chest.state).toBe(PropState.OPENING);
    expect(s.silverKeys).toBe(0);

    s.tick(0);
    expect(chest.state).toBe(PropState.OPEN);
    expect(s.silverKeys).toBe(1);
  });

  it('needs the player to be facing it', () => {
    const s = atMiniChest();
    s.player.facing = Facing.D; // the chest is above
    hold(s, INTERACT, 40);
    expect(s.props.find((p) => p.kind === 'mini_chest')!.state).toBe(PropState.IDLE);
  });

  it('stays solid, opened or not', () => {
    const s = atMiniChest();
    runUntil(s, INTERACT, (sim) => sim.silverKeys === 1, 60);
    hold(s, UP, 40);
    // The chest still blocks the way north, exactly as the closed one did.
    expect(s.player.y).toBeGreaterThanOrEqual(6 * TILE_SUBPX - 20 * 40);
    expect(s.roomId).toBe('R3');
  });
});

describe('its contents', () => {
  it('arrive together the tick opening ends (02 §4.1)', () => {
    // f1 R5's chest holds five coins and a small red flask.
    const s = game({ roomId: 'R5', start: { x: 5 * TILE_SUBPX, y: 2 * TILE_SUBPX }, hp: 2 });
    s.player.facing = Facing.U;
    expect(s.props.find((p) => p.kind === 'chest')!.contents).toEqual([
      'coin',
      'coin',
      'coin',
      'coin',
      'coin',
      'red_small',
    ]);

    s.tick(INTERACT);
    hold(s, 0, CHEST_OPEN_TICKS - 1);
    expect(s.treasure).toBe(0);

    s.tick(0);
    expect(s.treasure).toBe(5);
    expect(s.player.hp).toBe(4); // the flask, in the same instant
  });

  it('are granted exactly once, and never again (01 §9)', () => {
    const s = atMiniChest();
    runUntil(s, INTERACT, (sim) => sim.silverKeys === 1, 60);
    expect(s.persistence.has(propFlag('f1', 'R3', 6, 5))).toBe(true);

    hold(s, 0, 5);
    hold(s, INTERACT, 60);
    expect(s.silverKeys).toBe(1); // pressing again does nothing

    s.enterRoom(s.roomIndex, s.player.x, s.player.y, s.player.facing);
    expect(s.props.find((p) => p.kind === 'mini_chest')!.state).toBe(PropState.OPEN);
    hold(s, INTERACT, 60);
    expect(s.silverKeys).toBe(1); // and it is still empty after re-entering
  });

  it('raises the chest_open trigger the wiring waits on (03 §1.6)', () => {
    const s = atMiniChest();
    const openedOn = runUntil(s, INTERACT, (sim) => sim.openedChests.length > 0, 60);
    expect(openedOn).toBe(CHEST_OPEN_TICKS + 1); // the press tick, then sixteen
    expect(s.openedChests).toEqual([[6, 5]]);

    s.tick(0);
    expect(s.openedChests).toEqual([]); // and the queue is per-tick
  });

  it('fills the player up from the Great Vault (03 §6: ten coins)', () => {
    const s = game({
      floorIndex: 3,
      roomId: 'R6',
      start: { x: 4 * TILE_SUBPX, y: 3 * TILE_SUBPX },
    });
    s.player.facing = Facing.U;
    runUntil(s, INTERACT, (sim) => sim.treasure > 0, 60);
    expect(s.treasure).toBe(10);
    expect(s.player.hp).toBe(MAX_HP);
  });
});
