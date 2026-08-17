import { describe, expect, it } from 'vitest';

import { DOOR_OPEN_RADIUS_PX, SUBPX } from '../../src/sim/constants.js';
import { INTERACT, UP } from '../../src/sim/input.js';
import { Facing } from '../../src/sim/player.js';
import { TileClass, tileAt } from '../../src/sim/room.js';
import { game, hold } from './helpers.js';

// 01-mechanics §8.1.
describe('normal doors', () => {
  it('open on proximity and stay open', () => {
    const s = game();
    hold(s, UP, 62);
    expect(tileAt(s.room, 5, 0)).toBe(TileClass.DOOR_OPEN);

    // Walking away does not close it (§8.1: "never re-closes except sealing").
    hold(s, 0b0010, 40); // DOWN
    expect(tileAt(s.room, 5, 0)).toBe(TileClass.DOOR_OPEN);
  });

  it('measures 24 px from the door centre to the hitbox centre', () => {
    // d1's centre is (1280, 128) subpx; the player's is (x + 128, y + 192).
    const radius = DOOR_OPEN_RADIUS_PX * SUBPX;
    const s = game();
    hold(s, UP, 61);
    const dx = s.player.x + 128 - 1280;
    const dy = s.player.y + 192 - 128;
    expect(dx * dx + dy * dy).toBeGreaterThan(radius * radius);

    s.tick(UP);
    const dx2 = s.player.x + 128 - 1280;
    const dy2 = s.player.y + 192 - 128;
    expect(dx2 * dx2 + dy2 * dy2).toBeLessThanOrEqual(radius * radius);
  });

  it('stays shut for a player who never comes close', () => {
    const s = game();
    hold(s, 0b1000, 40); // walk right along the bottom of the room
    expect(tileAt(s.room, 5, 0)).toBe(TileClass.DOOR_CLOSED);
  });
});

// f1 d3 is the silver door: R2 top (6,0) ↔ R4 bottom (5,8).
describe('silver doors', () => {
  const atSilverDoor = () => game({ roomId: 'R2', start: { x: 6 * 256, y: 1 * 256 } });

  it('stays solid without a key, however hard the player pushes', () => {
    const s = atSilverDoor();
    hold(s, UP, 60);
    expect(tileAt(s.room, 6, 0)).toBe(TileClass.DOOR_CLOSED);
    expect(s.player.y).toBe(128); // flush against it
    expect(s.roomId).toBe('R2');
  });

  it('opens when walked against with a key, consuming exactly one', () => {
    const s = atSilverDoor();
    s.inventory.silverKeys = 2;

    hold(s, UP, 5);
    expect(s.isDoorOpen('d3')).toBe(false); // not yet flush against it
    s.tick(UP);
    expect(s.isDoorOpen('d3')).toBe(true);
    expect(tileAt(s.room, 6, 0)).toBe(TileClass.DOOR_OPEN);
    expect(s.silverKeys).toBe(1);

    // Holding UP then simply walks through the door that was just unlocked.
    hold(s, UP, 60);
    expect(s.roomId).toBe('R4');
    expect(s.silverKeys).toBe(1); // and does not charge a second key on the way
  });

  it('opens on INTERACT at the tile the player faces (01 §4.3)', () => {
    const s = atSilverDoor();
    s.inventory.silverKeys = 1;
    s.player.facing = Facing.U;
    expect(s.interactTile()).toEqual([6, 0]);

    s.tick(INTERACT);
    expect(tileAt(s.room, 6, 0)).toBe(TileClass.DOOR_OPEN);
    expect(s.silverKeys).toBe(0);
  });

  it('acts on the press, not the hold', () => {
    const s = atSilverDoor();
    s.player.facing = Facing.U;
    s.tick(INTERACT); // no key yet: nothing happens
    s.inventory.silverKeys = 1;
    s.tick(INTERACT); // still held from the previous tick, so not a fresh press
    expect(tileAt(s.room, 6, 0)).toBe(TileClass.DOOR_CLOSED);
    s.tick(0);
    s.tick(INTERACT);
    expect(tileAt(s.room, 6, 0)).toBe(TileClass.DOOR_OPEN);
  });
});

// f4 d5 is the gold door: R5 top (4,0)(5,0) ↔ R6 bottom (4,7)(5,7).
describe('the gold door', () => {
  const atGoldDoor = () =>
    game({ floorIndex: 3, roomId: 'R5', start: { x: 4 * 256 + 128, y: 1 * 256 } });

  it('needs the gold key', () => {
    const s = atGoldDoor();
    hold(s, UP, 40);
    expect(s.isDoorOpen('d5')).toBe(false);
    expect(tileAt(s.room, 4, 0)).toBe(TileClass.DOOR_CLOSED);
    expect(s.roomId).toBe('R5');
  });

  it('opens with the gold key and does not consume it (01 §8.1)', () => {
    const s = atGoldDoor();
    s.inventory.goldKey = true;
    hold(s, UP, 40);
    expect(s.isDoorOpen('d5')).toBe(true);
    expect(s.goldKey).toBe(true);
    expect(s.roomId).toBe('R6'); // straight into the Great Vault
  });
});

describe('puzzle doors and gaps', () => {
  it('leaves a puzzle door shut however close the player stands (03 §1.6 opens it)', () => {
    // f2 d4 is the puzzle door in R4's top wall at (4,0)(5,0).
    const s = game({ floorIndex: 1, roomId: 'R4', start: { x: 4 * 256 + 128, y: 1 * 256 } });
    hold(s, UP, 60);
    expect(tileAt(s.room, 4, 0)).toBe(TileClass.DOOR_CLOSED);
    expect(s.roomId).toBe('R4');
  });

  it('treats a side gap as open from the start (no door art exists for side walls)', () => {
    const s = game({ roomId: 'R2' });
    expect(tileAt(s.room, 12, 4)).toBe(TileClass.DOOR_OPEN);
    expect(tileAt(s.room, 12, 5)).toBe(TileClass.DOOR_OPEN);
  });
});

describe('the interact target (01 §4.3)', () => {
  it('is the tile one step ahead in each facing', () => {
    const s = game({ roomId: 'R2', start: { x: 6 * 256, y: 4 * 256 } }); // sprite centre (6.5, 4.5)
    s.player.facing = Facing.U;
    expect(s.interactTile()).toEqual([6, 3]);
    s.player.facing = Facing.D;
    expect(s.interactTile()).toEqual([6, 5]);
    s.player.facing = Facing.L;
    expect(s.interactTile()).toEqual([5, 4]);
    s.player.facing = Facing.R;
    expect(s.interactTile()).toEqual([7, 4]);
  });
});

describe('door lookups', () => {
  it('rejects an unknown door id rather than reporting it closed', () => {
    const s = game();
    expect(() => s.isDoorOpen('d99')).toThrow(/no door "d99" on floor f1/);
  });
});
