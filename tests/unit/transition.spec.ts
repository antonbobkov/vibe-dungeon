import { describe, expect, it } from 'vitest';

import { TRANSITION_TICKS } from '../../src/sim/constants.js';
import { UP } from '../../src/sim/input.js';
import { Facing } from '../../src/sim/player.js';
import { TileClass, tileAt } from '../../src/sim/room.js';
import { game, hold } from './helpers.js';

/**
 * The M2 crossing, tick by tick — floor 1 R1 → R2 through door d1.
 *
 * Every number below is computed from the spec, not observed: the player spawns on `@`(5,6)
 * so its sprite cell is (1280, 1536) and its hitbox centre is (1408, y + 192). d1 covers
 * cells (4,0) and (5,0), so its centre is (1280, 128) subpixels.
 */
describe('crossing f1 d1', () => {
  it('opens the door on tick 62, when the centre first comes within 24 px', () => {
    // 24 px = 384 subpx. dx is a fixed 128, so the door opens once dy ≤ √(384² − 128²) = 362.
    const s = game();
    expect([s.player.x, s.player.y]).toEqual([1280, 1536]);

    hold(s, UP, 61);
    expect(s.player.y).toBe(316); // dy = 380: still shut
    expect(tileAt(s.room, 5, 0)).toBe(TileClass.DOOR_CLOSED);

    s.tick(UP);
    expect(s.player.y).toBe(296); // dy = 360 ≤ 362
    expect(tileAt(s.room, 5, 0)).toBe(TileClass.DOOR_OPEN);
    expect(tileAt(s.room, 4, 0)).toBe(TileClass.DOOR_OPEN); // both leaves of the pair
  });

  it('starts the slide on tick 74, when the hitbox centre enters the door cell', () => {
    const s = game();
    hold(s, UP, 73);
    expect(s.player.y).toBe(76); // centre at row 1 — 268 subpx, one tile down
    expect(s.script).toBeNull();

    s.tick(UP);
    expect(s.player.y).toBe(56); // centre 248 < 256: inside row 0
    expect(s.script).toEqual({
      kind: 'transition',
      door: 'd1',
      toRoom: 1,
      dir: 'U',
      ticksLeft: TRANSITION_TICKS,
    });
    expect(s.roomId).toBe('R1'); // still in the old room while the camera slides
  });

  it('takes exactly 24 ticks and lands on the documented entry tile', () => {
    const s = game();
    hold(s, UP, 74); // trigger tick

    hold(s, UP, TRANSITION_TICKS - 1);
    expect(s.roomId).toBe('R1');
    expect([s.player.x, s.player.y]).toEqual([1280, 56]); // frozen mid-slide

    s.tick(UP);
    expect(s.roomId).toBe('R2');
    // 01 §8.2: the floor tile inside R2 next to (4,8)(5,8) — row h−2 = 7 — centred across
    // the pair, so x = 5·16 − 8 = 72 px.
    expect([s.player.x, s.player.y]).toEqual([1152, 1792]);
    expect(s.player.facing).toBe(Facing.U); // the direction of travel
    expect(s.playTick).toBe(74 + TRANSITION_TICKS);
  });

  it('lands clear of the door it came through, so rooms cannot ping-pong', () => {
    const s = game();
    hold(s, UP, 74 + TRANSITION_TICKS);
    expect(s.roomId).toBe('R2');

    // Standing still for a while must not send the player back to R1.
    hold(s, 0, 60);
    expect(s.roomId).toBe('R2');
    expect(s.script).toBeNull();
  });

  it('ignores input while the camera slides', () => {
    const s = game();
    hold(s, UP, 74);
    const frozen = { ...s.player };
    hold(s, 0b1111, TRANSITION_TICKS - 1); // every direction at once
    expect(s.player.x).toBe(frozen.x);
    expect(s.player.y).toBe(frozen.y);
  });

  it('resets the room clock and records a checkpoint on arrival', () => {
    const s = game();
    hold(s, UP, 74 + TRANSITION_TICKS);
    expect(s.roomTimer).toBe(0);
    expect(s.checkpoint).toEqual({ x: 1152, y: 1792, facing: Facing.U, hp: 6 });
  });
});

describe('entry placement across the four floors', () => {
  it('enters a side gap centred on the shared edge, one column in', () => {
    // f1 d2 is a gap: R2 east (12,4)(12,5) ↔ R3 west (0,3)(0,4). Coming from R2, the player
    // lands in column 1 of R3, centred across rows 3 and 4: y = 4·16 − 8 = 56 px.
    const s = game({ roomId: 'R2', start: { x: 11 * 256, y: 4 * 256 } });
    const arrived = (): boolean => s.roomId === 'R3';
    for (let i = 0; i < 200 && !arrived(); i++) s.tick(0b1000); // RIGHT
    expect(s.roomId).toBe('R3');
    expect([s.player.x, s.player.y]).toEqual([256, 896]);
    expect(s.player.facing).toBe(Facing.R);
  });

  it('enters a single-cell silver door aligned with the cell', () => {
    // f1 d3: R2 top (6,0) ↔ R4 bottom (5,8). One cell, so no centring — x = 5·16 px.
    const s = game({ roomId: 'R2', start: { x: 6 * 256, y: 1 * 256 } });
    s.inventory.silverKeys = 1;
    for (let i = 0; i < 200 && s.roomId !== 'R4'; i++) s.tick(UP);
    expect(s.roomId).toBe('R4');
    expect([s.player.x, s.player.y]).toEqual([1280, 1792]);
    expect(s.player.facing).toBe(Facing.U);
  });
});
