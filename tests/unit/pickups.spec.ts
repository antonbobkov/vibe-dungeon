import { describe, expect, it } from 'vitest';

import { MAX_HP } from '../../src/sim/constants.js';
import { DOWN, LEFT, RIGHT, UP } from '../../src/sim/input.js';
import { createPlayer } from '../../src/sim/player.js';
import { INVULN_TICKS, grantPickup, type Inventory } from '../../src/sim/pickups.js';
import { game, hold, runUntil } from './helpers.js';

const empty = (): Inventory => ({ treasure: 0, silverKeys: 0, goldKey: false });

// 01-mechanics §7, one case per row of the table.
describe('pickup effects', () => {
  it('counts a coin as treasure', () => {
    const inv = empty();
    grantPickup('coin', createPlayer(0, 0, 6), inv);
    expect(inv.treasure).toBe(1);
  });

  it('heals 2 from a small red flask, clamped at 6', () => {
    const player = createPlayer(0, 0, 3);
    grantPickup('red_small', player, empty());
    expect(player.hp).toBe(5);
    grantPickup('red_small', player, empty());
    expect(player.hp).toBe(MAX_HP); // 7 would overflow the hearts
  });

  it('fills HP from a large red flask', () => {
    const player = createPlayer(0, 0, 1);
    grantPickup('red_large', player, empty());
    expect(player.hp).toBe(MAX_HP);
  });

  it('is consumed with no effect at full HP', () => {
    const player = createPlayer(0, 0, MAX_HP);
    grantPickup('red_small', player, empty());
    expect(player.hp).toBe(MAX_HP);
  });

  it('grants 180 or 360 ticks of invulnerability from the blue flasks', () => {
    const player = createPlayer(0, 0, 6);
    grantPickup('blue_small', player, empty());
    expect(player.invulnTimer).toBe(INVULN_TICKS.blue_small);
    expect(player.invulnTimer).toBe(180);

    grantPickup('blue_large', player, empty());
    expect(player.invulnTimer).toBe(360);
  });

  it('replaces the remaining invulnerability rather than stacking it', () => {
    const player = createPlayer(0, 0, 6);
    grantPickup('blue_large', player, empty());
    grantPickup('blue_small', player, empty());
    expect(player.invulnTimer).toBe(180); // the new flask's full duration, not 540
  });

  it('counts silver keys and holds the single gold key', () => {
    const inv = empty();
    grantPickup('silver_key', createPlayer(0, 0, 6), inv);
    grantPickup('silver_key', createPlayer(0, 0, 6), inv);
    expect(inv.silverKeys).toBe(2);

    expect(inv.goldKey).toBe(false);
    grantPickup('gold_key', createPlayer(0, 0, 6), inv);
    expect(inv.goldKey).toBe(true);
  });
});

describe('collecting them in a room', () => {
  it('takes a coin the moment the hitbox overlaps its tile', () => {
    const s = game();
    expect(s.treasure).toBe(0);
    // The coins sit at (4,2)(5,2)(4,3)(5,3); the player walks up column 5 from (5,6).
    // Its hitbox top is y + 128, so it first touches row 3 (which ends at 1024) when
    // y < 896 — that is tick 33, at y = 876.
    const ticks = runUntil(s, UP, (sim) => sim.treasure === 1, 100);
    expect(ticks).toBe(33);
    expect(s.player.y).toBe(876);
    expect(s.pickups).toHaveLength(3);
  });

  it('never collects the same pickup twice', () => {
    const s = game();
    runUntil(s, UP, (sim) => sim.treasure === 2, 100);
    hold(s, DOWN, 20);
    hold(s, UP, 20);
    expect(s.treasure).toBe(2);
  });

  it('leaves pickups the player walks beside', () => {
    const s = game();
    hold(s, LEFT, 40); // away from the coin columns
    hold(s, UP, 60);
    expect(s.treasure).toBe(0);
    expect(s.pickups).toHaveLength(4);
  });

  it('picks up the silver key that f2 hides in its spike ring', () => {
    // f2 R6's key is at (5,3), ringed by spikes that do not exist as collision (02 §3.1).
    const s = game({ floorIndex: 1, roomId: 'R6', start: { x: 5 * 256, y: 5 * 256 } });
    expect(s.silverKeys).toBe(0);
    runUntil(s, UP, (sim) => sim.silverKeys === 1, 100);
    expect(s.pickups.some((p) => p.kind === 'silver_key')).toBe(false);
  });

  it('adds a flask to HP when walked over', () => {
    // f1 R4's small red flask is at (5,5).
    const s = game({ roomId: 'R4', start: { x: 5 * 256, y: 7 * 256 }, hp: 2 });
    runUntil(s, UP, (sim) => sim.player.hp > 2, 100);
    expect(s.player.hp).toBe(4);
  });

  it('keeps treasure across a floor change', () => {
    const s = game({ roomId: 'R6', start: { x: 3 * 256, y: 1 * 256 } });
    s.inventory.treasure = 20;
    runUntil(s, UP, (sim) => sim.floorIndex === 1, 200);
    expect(s.treasure).toBe(20);
  });

  it('collects along a diagonal walk too', () => {
    const s = game();
    hold(s, UP | RIGHT, 4);
    hold(s, UP, 40);
    expect(s.treasure).toBeGreaterThan(0);
  });
});
