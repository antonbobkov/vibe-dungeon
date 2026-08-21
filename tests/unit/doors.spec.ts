import { describe, expect, it } from 'vitest';

import { moveAxisSeparated } from '../../src/sim/collision.js';
import { DOOR_OPEN_RADIUS_PX, ENEMY_STATS, SUBPX, TILE_SUBPX } from '../../src/sim/constants.js';
import { boxOf, moverOf } from '../../src/sim/enemy.js';
import { INTERACT, RIGHT, UP } from '../../src/sim/input.js';
import { loadFloor, type FloorFile, type LoadedFloor } from '../../src/sim/level.js';
import { Facing } from '../../src/sim/player.js';
import { TileClass, parseRoom, setTile, tileAt, type Room } from '../../src/sim/room.js';
import { Sim } from '../../src/sim/sim.js';
import { boltBlocked } from '../../src/sim/trap.js';
import { game, hold, runUntil } from './helpers.js';

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

describe('puzzle doors', () => {
  it('leaves a puzzle door shut however close the player stands (03 §1.6 opens it)', () => {
    // f2 d4 is the puzzle door in R4's top wall at (4,0)(5,0).
    const s = game({ floorIndex: 1, roomId: 'R4', start: { x: 4 * 256 + 128, y: 1 * 256 } });
    hold(s, UP, 60);
    expect(tileAt(s.room, 4, 0)).toBe(TileClass.DOOR_CLOSED);
    expect(s.roomId).toBe('R4');
  });
});

/**
 * 01 §8.1's side-wall doors. Where a side opening used to be a permanent gap it is now a
 * `normal` door: shut on entry, solid to everything while it is, and swinging open on the
 * same 24 px proximity rule a top-wall door uses.
 */
describe('side-wall doors', () => {
  // f1 d5: R5's right wall (10,3)(10,4) ↔ R6's left wall (0,3)(0,4). R5 holds no enemies,
  // so nothing walks into the measurement.
  const atSideDoor = () => game({ roomId: 'R5', start: { x: 5 * TILE_SUBPX, y: 3 * TILE_SUBPX } });

  it('starts closed, where a gap was always open', () => {
    const s = atSideDoor();
    expect(s.isDoorOpen('d5')).toBe(false);
    expect(tileAt(s.room, 10, 3)).toBe(TileClass.DOOR_CLOSED);
    expect(tileAt(s.room, 10, 4)).toBe(TileClass.DOOR_CLOSED);
  });

  it('opens on the same 24 px proximity rule as any normal door', () => {
    // d5's centre is (2688, 1024) subpx; the player's hitbox centre is (x + 128, y + 192),
    // so the 46th step right is the first inside the radius.
    const radius = DOOR_OPEN_RADIUS_PX * SUBPX;
    const s = atSideDoor();

    hold(s, RIGHT, 45);
    const dx = 2688 - (s.player.x + 128);
    const dy = 1024 - (s.player.y + 192);
    expect(dx * dx + dy * dy).toBeGreaterThan(radius * radius);
    expect(s.isDoorOpen('d5')).toBe(false);

    s.tick(RIGHT);
    const dx2 = 2688 - (s.player.x + 128);
    expect(dx2 * dx2 + dy * dy).toBeLessThanOrEqual(radius * radius);
    expect(s.isDoorOpen('d5')).toBe(true);
    expect(tileAt(s.room, 10, 3)).toBe(TileClass.DOOR_OPEN);
    expect(tileAt(s.room, 10, 4)).toBe(TileClass.DOOR_OPEN);
  });

  it('carries the player through into the next room (01 §8.2)', () => {
    const s = atSideDoor();
    hold(s, RIGHT, 100);
    expect(s.roomId).toBe('R6');
    expect(s.player.facing).toBe(Facing.R);
  });

  /**
   * While it is shut it is a `DOOR_CLOSED` cell like any other, which is the whole of its
   * collision behaviour (01 §3.1). Held shut here by a room with no door table at all — the
   * proximity rule would otherwise open a real one before anything could touch it.
   */
  const shutSideDoor = (): Room =>
    parseRoom([
      '#########',
      '#.......#',
      '#.......#',
      '#.......D',
      '#.......D',
      '#.......#',
      '#########',
    ]);

  it('stops the player at the wall line', () => {
    const room = shutSideDoor();
    const s = new Sim(room, { start: { x: 4 * TILE_SUBPX, y: 3 * TILE_SUBPX } });
    hold(s, RIGHT, 60);
    // Flush against column 8: 8*256 − (offX + w)*16 = 2048 − 208.
    expect(s.player.x).toBe(1840);
    expect(tileAt(s.room, 8, 3)).toBe(TileClass.DOOR_CLOSED);
  });

  it('stops the wisp, which flies over everything else in the room (02 §2.4)', () => {
    const room = shutSideDoor();
    let flown = { x: 6 * TILE_SUBPX, y: 3 * TILE_SUBPX };
    for (let tick = 0; tick < 40; tick++) {
      flown = moveAxisSeparated(
        room,
        boxOf('wisp'),
        flown,
        { x: ENEMY_STATS.wisp.speed, y: 0 },
        moverOf('wisp'),
      );
    }
    expect(flown.x).toBe(1840); // 2048 − (3 + 10)*16, the same wall line
  });

  it('stops a bolt, and lets one through once it is open (02 §3.2)', () => {
    const room = shutSideDoor();
    const bolt = { id: 0, x: 8 * TILE_SUBPX, y: 3 * TILE_SUBPX };
    expect(boltBlocked(room, bolt)).toBe(true);

    setTile(room, 8, 3, TileClass.DOOR_OPEN);
    expect(boltBlocked(room, bolt)).toBe(false);
  });
});

/**
 * 01 §8.3: an active combat seal holds *every* door endpoint in the room shut, which has to
 * include the §8.1 proximity rule. A `normal` door the player had not opened before the seal
 * came down is the only kind the seal holds against the door's own state, and is therefore
 * exactly the kind the 24 px rule would otherwise swing open mid-fight.
 *
 * The synthetic floor below puts one of each shape in a single sealed room — a double door in
 * the top wall, a stacked pair in the right wall, a silver door with no key in hand — so the
 * measurements are exact rather than borrowed from whatever the real levels happen to place.
 *
 * ```
 *   ##L##DD####     d3 silver (2,0); d1 normal (5,0)(6,0)
 *   #.........#
 *   #.........#
 *   #.........#
 *   #.........D     d2 normal, right wall (10,4)(10,5)
 *   #.........D
 *   #.........#
 *   #1........#     one zombie, far enough away that 02 §2.1 lets it simply stand
 *   ###########
 * ```
 */
const SEAL_ROOM: FloorFile = {
  id: 'f1',
  name: 'Sealed doors',
  rooms: [
    {
      id: 'R1',
      name: 'The seal',
      combatSeal: true,
      map: [
        '##L##DD####',
        '#.........#',
        '#.........#',
        '#.........#',
        '#.........D',
        '#.........D',
        '#.........#',
        '#1........#',
        '###########',
      ],
      enemies: [{ marker: '1', type: 'zombie' }],
    },
    { id: 'R2', name: 'North', map: ['###########', '#.........#', '#####DD####'] },
    { id: 'R3', name: 'East', map: ['#####', 'D....', 'D....', '#####'] },
    { id: 'R4', name: 'Vault', map: ['#####', '#...#', '##L##'] },
  ],
  doors: [
    {
      id: 'd1',
      type: 'normal',
      a: {
        room: 'R1',
        cells: [
          [5, 0],
          [6, 0],
        ],
      },
      b: {
        room: 'R2',
        cells: [
          [5, 2],
          [6, 2],
        ],
      },
    },
    {
      id: 'd2',
      type: 'normal',
      a: {
        room: 'R1',
        cells: [
          [10, 4],
          [10, 5],
        ],
      },
      b: {
        room: 'R3',
        cells: [
          [0, 1],
          [0, 2],
        ],
      },
    },
    {
      id: 'd3',
      type: 'silver',
      a: { room: 'R1', cells: [[2, 0]] },
      b: { room: 'R4', cells: [[2, 2]] },
    },
  ],
  wiring: [],
};

let sealFloor: LoadedFloor | null = null;

/** The sealed room, with the player parked wherever the case needs them. */
function sealed(x: number, y: number): Sim {
  sealFloor ??= loadFloor(SEAL_ROOM);
  return new Sim([sealFloor], { start: { x, y } });
}

describe('doors under a combat seal (01 §8.3)', () => {
  // d1's centre is (1536, 128) subpx, d2's is (2688, 1280); the player's is (x + 128, y + 192).
  const inRadius = (s: Sim, cx: number, cy: number): boolean => {
    const dx = s.player.x + 128 - cx;
    const dy = s.player.y + 192 - cy;
    return dx * dx + dy * dy <= (DOOR_OPEN_RADIUS_PX * SUBPX) ** 2;
  };

  it('holds a top-wall normal door shut with the player standing inside the 24 px', () => {
    const s = sealed(5 * TILE_SUBPX + 128, 1 * TILE_SUBPX);
    expect(s.seal).toBe(1);
    expect(inRadius(s, 1536, 128)).toBe(true);

    hold(s, 0, 20);
    expect(s.isDoorOpen('d1')).toBe(false);
    expect(tileAt(s.room, 5, 0)).toBe(TileClass.DOOR_CLOSED);
    expect(tileAt(s.room, 6, 0)).toBe(TileClass.DOOR_CLOSED);
    expect(s.roomId).toBe('R1');
  });

  it('holds a side-wall normal door shut the same way (01 §8.1)', () => {
    const s = sealed(9 * TILE_SUBPX, 4 * TILE_SUBPX);
    expect(s.seal).toBe(1);
    expect(inRadius(s, 2688, 1280)).toBe(true);

    hold(s, 0, 20);
    expect(s.isDoorOpen('d2')).toBe(false);
    expect(tileAt(s.room, 10, 4)).toBe(TileClass.DOOR_CLOSED);
    expect(tileAt(s.room, 10, 5)).toBe(TileClass.DOOR_CLOSED);
    expect(s.roomId).toBe('R1');
  });

  it('opens it on the very next proximity check once the seal lets go', () => {
    const s = sealed(5 * TILE_SUBPX + 128, 1 * TILE_SUBPX);

    // The room clears: phase 9 releases the seal on this tick, phase 7 has already run.
    s.entities = [];
    s.tick(0);
    expect(s.seal).toBe(0);
    expect(s.isDoorOpen('d1')).toBe(false);
    expect(tileAt(s.room, 5, 0)).toBe(TileClass.DOOR_CLOSED);

    // The next tick's phase 7 finds the same player at the same distance and opens it.
    s.tick(0);
    expect(s.isDoorOpen('d1')).toBe(true);
    expect(tileAt(s.room, 5, 0)).toBe(TileClass.DOOR_OPEN);
    expect(tileAt(s.room, 6, 0)).toBe(TileClass.DOOR_OPEN);

    // And is a door out, not just an open tile: nobody is stuck in a cleared room.
    runUntil(s, UP, (sim) => sim.roomId === 'R2', 120);
  });

  it('still refuses a keyless silver door, and still reports the bump (01 §8.1)', () => {
    const s = sealed(2 * TILE_SUBPX, 1 * TILE_SUBPX);
    expect(s.seal).toBe(1);

    const bumped = runUntil(s, UP, (sim) => sim.lockedBumps.length > 0, 30);
    expect(bumped).toBe(6); // the tick the player first leans on it, key or no key
    expect(s.lockedBumps).toEqual(['d3']);
    expect(s.isDoorOpen('d3')).toBe(false);
    expect(tileAt(s.room, 2, 0)).toBe(TileClass.DOOR_CLOSED);
  });
});

/**
 * The same rule on the level it was found on: f4 R4, the Arena. Its north door `d4` is a
 * `normal` door the player has never been through when the seal comes down — the one place in
 * the game where 01 §8.1 and §8.3 disagreed, and walking out mid-fight was possible.
 */
describe('the Arena’s north door (01 §8.3)', () => {
  // d4 spans (6,0)(7,0): centre (1792, 128) subpx. One tile below it is inside the 24 px.
  const atTheArenaDoor = (): Sim =>
    game({ floorIndex: 3, roomId: 'R4', start: { x: 1664, y: 1 * TILE_SUBPX } });

  it('stays shut against the 24 px rule while the waves are pending', () => {
    const s = atTheArenaDoor();
    expect(s.seal).toBe(1);

    const dy = s.player.y + 192 - 128;
    expect(s.player.x + 128).toBe(1792);
    expect(dy * dy).toBeLessThanOrEqual((DOOR_OPEN_RADIUS_PX * SUBPX) ** 2);

    hold(s, 0, 20); // wave 1 telegraphs for 30, so nothing is on the floor to interfere
    expect(s.isDoorOpen('d4')).toBe(false);
    expect(tileAt(s.room, 6, 0)).toBe(TileClass.DOOR_CLOSED);
    expect(tileAt(s.room, 7, 0)).toBe(TileClass.DOOR_CLOSED);
    expect(s.roomId).toBe('R4');
  });

  it('opens once the room is cleared, and lets the player through to R5', () => {
    const s = atTheArenaDoor();
    s.pendingWave = -1;
    s.telegraphs = [];
    s.entities = [];
    s.tick(0);
    expect(s.seal).toBe(0);
    expect(s.isDoorOpen('d4')).toBe(false);

    s.tick(0);
    expect(s.isDoorOpen('d4')).toBe(true);
    runUntil(s, UP, (sim) => sim.roomId === 'R5', 120);
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
