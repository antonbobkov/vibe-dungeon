import { describe, expect, it } from 'vitest';

import {
  ENEMY_STATS,
  ENTRY_SAFE_RADIUS,
  MAX_HP,
  SPAWN_BLINK_TICKS,
  SPAWN_TELEGRAPH_TICKS,
  SUBPX,
  TILE_SUBPX,
} from '../../src/sim/constants.js';
import { EnemyState } from '../../src/sim/enemy.js';
import { ATTACK } from '../../src/sim/input.js';
import { loadFloor, type FloorFile, type LoadedFloor } from '../../src/sim/level.js';
import { Sim } from '../../src/sim/sim.js';
import { hold } from './helpers.js';

/**
 * 02-entities §2.1's spawn protection: a map enemy standing inside `ENTRY_SAFE_RADIUS` of
 * where the player lands is not created with the room. It goes through the wave machinery
 * instead — 30 ticks of telegraph, then 12 of blink-in — so nothing can touch the player
 * before they have had a chance to see it coming.
 *
 * The measurements are exact rather than approximate, so a radius that moves by a pixel
 * fails here. Everything below is on one synthetic room whose enemies sit at known
 * distances from a known entry point.
 */

/**
 * One 13×9 room entered at (6,4). The three markers are placed by hand against the entry
 * point's hitbox centre, which `PLAYER_BOX` puts at (104, 76) px:
 *
 * | marker | tile | tile centre | distance |
 * |---|---|---|---|
 * | `1` | (6,2) | (104, 40) px | 36 px — two tiles up, inside the radius |
 * | `2` | (10,4) | (168, 72) px | ~64 px — four tiles right, outside it |
 * | `3` | (6,4) | (104, 72) px | 4 px — the entry tile itself |
 */
const ROOM_MAP = [
  '#############',
  '#...........#',
  '#.....1.....#',
  '#...........#',
  '#.........2.#',
  '#...........#',
  '#...........#',
  '#...........#',
  '#############',
];

const ENTRY = { x: 6 * TILE_SUBPX, y: 4 * TILE_SUBPX };

function floorWith(map: string[], markers: string[]): LoadedFloor {
  const file: FloorFile = {
    id: 'f1',
    name: 'Spawn protection',
    rooms: [
      {
        id: 'R1',
        name: 'Room',
        map,
        enemies: markers.map((marker) => ({ marker, type: 'zombie' as const })),
      },
    ],
    doors: [],
    wiring: [],
  };
  return loadFloor(file);
}

const twoEnemies = (): Sim => new Sim([floorWith(ROOM_MAP, ['1', '2'])], { start: ENTRY });

/** The same room with a single enemy standing on the entry tile itself. */
const onTopOfThePlayer = (): Sim => {
  const map = [...ROOM_MAP];
  map[2] = '#...........#';
  map[4] = '#.....3.....#';
  return new Sim([floorWith(map, ['3'])], { start: ENTRY });
};

describe('the entry-safe radius (02 §2.1)', () => {
  it('is 48 px — three tiles', () => {
    expect(ENTRY_SAFE_RADIUS).toBe(48);
    expect(ENTRY_SAFE_RADIUS * SUBPX).toBe(3 * TILE_SUBPX);
  });

  it('holds back the enemy two tiles away and lets the one four tiles away stand', () => {
    const s = twoEnemies();

    // Only marker 2 is on the floor; marker 1 is a cursor on its tile.
    expect(s.entities).toHaveLength(1);
    expect(s.entities[0]!.x).toBe(10 * TILE_SUBPX);
    expect(s.entities[0]!.y).toBe(4 * TILE_SUBPX);
    expect(s.entities[0]!.state).toBe(EnemyState.IDLE);

    expect(s.telegraphs).toEqual([
      { at: [6, 2], kind: 'zombie', drop: null, ticksLeft: SPAWN_TELEGRAPH_TICKS },
    ]);
  });

  it('counts from the spawn tile centre to the hitbox centre, in subpixels', () => {
    // The two distances the map is built on, restated as the sim measures them.
    const centre = { x: ENTRY.x + 128, y: ENTRY.y + 192 };
    const near = { x: 6 * TILE_SUBPX + 128 - centre.x, y: 2 * TILE_SUBPX + 128 - centre.y };
    const far = { x: 10 * TILE_SUBPX + 128 - centre.x, y: 4 * TILE_SUBPX + 128 - centre.y };
    const radius = ENTRY_SAFE_RADIUS * SUBPX;

    expect(near.x * near.x + near.y * near.y).toBeLessThan(radius * radius);
    expect(far.x * far.x + far.y * far.y).toBeGreaterThanOrEqual(radius * radius);
  });

  it('counts down 30 ticks, then blinks the enemy in for 12', () => {
    const s = twoEnemies();

    for (let tick = 1; tick <= SPAWN_TELEGRAPH_TICKS - 1; tick++) {
      s.tick(0);
      expect(s.telegraphs.map((t) => t.ticksLeft)).toEqual([SPAWN_TELEGRAPH_TICKS - tick]);
      expect(s.entities).toHaveLength(1); // still only the far one
    }

    s.tick(0); // tick 30: the cursor is spent and the enemy takes its place
    expect(s.telegraphs).toEqual([]);
    expect(s.entities).toHaveLength(2);

    const arrived = s.entities[1]!;
    expect(arrived.id).toBe(1); // the far enemy took id 0 on entry
    expect(arrived.state).toBe(EnemyState.SPAWNING);
    expect(arrived.stateTimer).toBe(SPAWN_BLINK_TICKS);
    expect([arrived.x, arrived.y]).toEqual([6 * TILE_SUBPX, 2 * TILE_SUBPX]);

    hold(s, 0, SPAWN_BLINK_TICKS);
    expect(s.entities[1]!.state).toBe(EnemyState.IDLE);
  });

  it('is harmless and unhittable the whole way in, standing on the player (02 §2.3)', () => {
    const s = onTopOfThePlayer();
    const hp = ENEMY_STATS.zombie.hp;
    expect(s.entities).toEqual([]);

    // The telegraph: nothing exists yet, so nothing overlaps.
    hold(s, 0, SPAWN_TELEGRAPH_TICKS);
    expect(s.player.hp).toBe(MAX_HP);
    expect(s.entities[0]!.state).toBe(EnemyState.SPAWNING);

    // The blink-in: the two hitboxes are on the same tile and neither can reach the other,
    // for the eleven ticks before the twelfth wakes it. The swing on the first of them puts
    // its active window (01 §4.2) squarely inside the blink.
    s.tick(ATTACK);
    for (let tick = 2; tick <= SPAWN_BLINK_TICKS - 1; tick++) {
      s.tick(0);
      expect(s.player.hp, `blink tick ${tick}`).toBe(MAX_HP);
      expect(s.entities[0]!.hp, `blink tick ${tick}`).toBe(hp);
      expect(s.entities[0]!.state, `blink tick ${tick}`).toBe(EnemyState.SPAWNING);
    }

    // The twelfth tick is the one it wakes on, and it is a threat from that same tick.
    s.tick(0);
    expect(s.entities[0]!.state).toBe(EnemyState.IDLE);
    expect(s.player.hp).toBe(MAX_HP - ENEMY_STATS.zombie.contactDamage);

    // The sword that went straight through it now connects.
    let connected = false;
    for (let tick = 0; tick < 120 && !connected; tick++) {
      s.tick(tick % 20 === 0 ? ATTACK : 0);
      connected = s.entities[0]!.hp < hp;
    }
    expect(connected).toBe(true);
  });
});

describe('telegraphs in the state hash (05 §4)', () => {
  const stream = (s: Sim, ticks: number): number[] => {
    const out: number[] = [];
    for (let tick = 0; tick < ticks; tick++) {
      s.tick(0);
      out.push(s.hash());
    }
    return out;
  };

  it('gives two identical runs identical hash streams', () => {
    expect(stream(twoEnemies(), 60)).toEqual(stream(twoEnemies(), 60));
  });

  it('separates two runs that differ only in a telegraph', () => {
    const a = twoEnemies();
    const b = twoEnemies();
    expect(a.hash()).toBe(b.hash());

    b.telegraphs[0]!.ticksLeft--;
    expect(a.hash()).not.toBe(b.hash());

    b.telegraphs[0]!.ticksLeft++;
    expect(a.hash()).toBe(b.hash());

    b.telegraphs[0]!.at = [7, 2];
    expect(a.hash()).not.toBe(b.hash());
  });
});
