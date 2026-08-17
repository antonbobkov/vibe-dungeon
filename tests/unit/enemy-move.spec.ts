import { describe, expect, it } from 'vitest';

import { diagAxis } from '../../src/sim/collision.js';
import { playerCentre } from '../../src/sim/combat.js';
import { CHASE_DIAGONAL_DEADZONE, SEPARATION_PUSH, TILE_SUBPX } from '../../src/sim/constants.js';
import {
  EnemyState,
  chaseVelocity,
  createEntity,
  damageEnemy,
  entityCentre,
  hasLineOfSight,
  separateEnemies,
} from '../../src/sim/enemy.js';
import { Dir8, losSegments } from '../../src/sim/geometry.js';
import { parseRoom } from '../../src/sim/room.js';
import { Sim } from '../../src/sim/sim.js';

// 02-entities §2.1.
describe('chase steering', () => {
  const from = { x: 1000, y: 1000 };

  it('goes diagonal only when both axes clear the 8-subpixel deadzone', () => {
    expect(CHASE_DIAGONAL_DEADZONE).toBe(8);
    const per = diagAxis(12);

    expect(chaseVelocity(from, { x: 1100, y: 1100 }, 12)).toEqual({ x: per, y: per });
    // dy is inside the deadzone, so it walks straight along x at full speed.
    expect(chaseVelocity(from, { x: 1100, y: 1008 }, 12)).toEqual({ x: 12, y: 0 });
    // Exactly 8 is not "more than 8".
    expect(chaseVelocity(from, { x: 1100, y: 992 }, 12)).toEqual({ x: 12, y: 0 });
    expect(chaseVelocity(from, { x: 1100, y: 991 }, 12)).toEqual({ x: per, y: -per });
  });

  it('takes the longer axis, and breaks ties horizontally', () => {
    // Both inside the deadzone: the longer axis wins outright.
    expect(chaseVelocity(from, { x: 1004, y: 1006 }, 12)).toEqual({ x: 0, y: 12 });
    expect(chaseVelocity(from, { x: 1006, y: 1004 }, 12)).toEqual({ x: 12, y: 0 });
    // A dead-even tie goes horizontal (02 §2.1).
    expect(chaseVelocity(from, { x: 1006, y: 1006 }, 12)).toEqual({ x: 12, y: 0 });
    expect(chaseVelocity(from, { x: 994, y: 1006 }, 12)).toEqual({ x: -12, y: 0 });
  });

  it('stands still when the target is exactly underneath', () => {
    expect(chaseVelocity(from, from, 12)).toEqual({ x: 0, y: 0 });
  });

  it('never lets a diagonal outrun a cardinal', () => {
    const diagonal = chaseVelocity(from, { x: 2000, y: 2000 }, 12);
    expect(diagonal.x).toBe(diagAxis(12));
    expect(diagonal.x).toBeLessThan(12);
  });
});

describe('line of sight', () => {
  const room = parseRoom([
    '##########',
    '#........#',
    '#....#...#',
    '#....#...#',
    '#........#',
    '##########',
  ]);

  const centre = (col: number, row: number) => ({
    x: col * TILE_SUBPX + TILE_SUBPX / 2,
    y: row * TILE_SUBPX + TILE_SUBPX / 2,
  });

  it('sees straight down an open row', () => {
    expect(hasLineOfSight(room, centre(1, 1), centre(8, 1))).toBe(true);
  });

  it('is blocked by a wall between', () => {
    expect(hasLineOfSight(room, centre(1, 2), centre(8, 2))).toBe(false);
  });

  it('sees past the end of a wall', () => {
    expect(hasLineOfSight(room, centre(1, 4), centre(8, 4))).toBe(true);
  });

  it('samples one point per 8 px, and always at least one segment', () => {
    expect(losSegments(0)).toBe(1);
    // 8 px = 128 subpx: exactly one segment.
    expect(losSegments(128 * 128)).toBe(1);
    expect(losSegments(129 * 129)).toBe(2);
    expect(losSegments(256 * 256)).toBe(2); // 16 px
  });

  it('fails when either end is inside geometry', () => {
    expect(hasLineOfSight(room, centre(5, 2), centre(8, 1))).toBe(false); // starts in the wall
    expect(hasLineOfSight(room, centre(1, 1), centre(5, 3))).toBe(false); // ends in it
  });

  it('is blocked by a solid prop but not by a pit', () => {
    const withProp = parseRoom(['#######', '#..x..#', '#######']);
    expect(hasLineOfSight(withProp, centre(1, 1), centre(5, 1))).toBe(false);

    const withPit = parseRoom(['#######', '#.._..#', '#######']);
    expect(hasLineOfSight(withPit, centre(1, 1), centre(5, 1))).toBe(true);
  });
});

describe('separation', () => {
  const room = parseRoom(['##########', '#........#', '#........#', '#........#', '##########']);

  it('pushes two overlapping enemies apart along the axis they overlap least', () => {
    // Boxes are 192 × 160 subpx, so an x offset of 60 leaves 132 of horizontal overlap
    // against a full 160 of vertical — the shallower axis is x.
    const a = createEntity(0, 'skel_sword', 1000, 1000, null);
    const b = createEntity(1, 'skel_sword', 1060, 1000, null);
    separateEnemies([a, b]);
    expect(a.x).toBe(1000 - SEPARATION_PUSH);
    expect(b.x).toBe(1060 + SEPARATION_PUSH);
    expect(a.y).toBe(1000); // and not on the other axis
  });

  it('pushes vertically when that is the shallower overlap', () => {
    const a = createEntity(0, 'skel_sword', 1000, 1000, null);
    const b = createEntity(1, 'skel_sword', 1000, 1140, null);
    separateEnemies([a, b]);
    expect(a.y).toBe(1000 - SEPARATION_PUSH);
    expect(b.y).toBe(1140 + SEPARATION_PUSH);
    expect(a.x).toBe(1000);
  });

  it('leaves enemies that are not touching alone', () => {
    const a = createEntity(0, 'skel_sword', 1000, 1000, null);
    const b = createEntity(1, 'skel_sword', 2000, 1000, null);
    separateEnemies([a, b]);
    expect([a.x, b.x]).toEqual([1000, 2000]);
  });

  it('ignores the dying, who no longer collide (02 §2.1)', () => {
    const a = createEntity(0, 'skel_sword', 1000, 1000, null);
    const b = createEntity(1, 'skel_sword', 1060, 1000, null);
    b.hp = 0;
    b.state = EnemyState.DYING;
    separateEnemies([a, b]);
    expect(a.x).toBe(1000);
  });

  it('runs in the real room without letting two skeletons share a spot', () => {
    const sim = new Sim(room, { start: { x: 8 * TILE_SUBPX, y: 2 * TILE_SUBPX } });
    sim.entities.push(
      createEntity(0, 'skel_sword', 2 * TILE_SUBPX, 2 * TILE_SUBPX, null),
      createEntity(1, 'skel_sword', 2 * TILE_SUBPX, 2 * TILE_SUBPX, null),
    );
    for (let i = 0; i < 30; i++) sim.tick(0);

    const [a, b] = sim.entities as [(typeof sim.entities)[0], (typeof sim.entities)[0]];
    expect(a.x === b.x && a.y === b.y).toBe(false);
  });
});

describe('room bounds', () => {
  it('keeps a chasing enemy inside its room', () => {
    const room = parseRoom(['#######', '#.....#', '#.....#', '#.....#', '#######']);
    const sim = new Sim(room, { start: { x: 1 * TILE_SUBPX, y: 2 * TILE_SUBPX } });
    sim.entities.push(createEntity(0, 'skel_axe', 5 * TILE_SUBPX, 2 * TILE_SUBPX, null));

    for (let i = 0; i < 200; i++) sim.tick(0);
    const centre = entityCentre(sim.entities[0]!);
    expect(centre.x).toBeGreaterThan(TILE_SUBPX);
    expect(centre.x).toBeLessThan(6 * TILE_SUBPX);
  });

  it('lets a wisp fly over pits and props that stop a walker', () => {
    // A pit at column 3 and a crate at column 5, between the player and both enemies. Both
    // start already chasing: the crate blocks line of sight, and aggro is not what is under
    // test here (01 §3.1's three solidity columns are).
    const room = parseRoom(['#########', '#.._.x..#', '#########']);
    const start = { x: 7 * TILE_SUBPX, y: 1 * TILE_SUBPX };

    const chase = (sim: Sim): void => {
      sim.entities[0]!.state = EnemyState.CHASE;
      sim.entities[0]!.aggroed = true;
    };

    // The boxes are offset vertically, so both close diagonally — 11 subpx/tick for the
    // wisp — and 200 ticks is comfortably enough to cross the room.
    const flying = new Sim(room, { start: { x: 1 * TILE_SUBPX, y: 1 * TILE_SUBPX } });
    flying.entities.push(createEntity(0, 'wisp', start.x, start.y, null));
    chase(flying);
    for (let i = 0; i < 200; i++) flying.tick(0);
    expect(entityCentre(flying.entities[0]!).x).toBeLessThan(3 * TILE_SUBPX);

    const walking = new Sim(room, { start: { x: 1 * TILE_SUBPX, y: 1 * TILE_SUBPX } });
    walking.entities.push(createEntity(0, 'zombie', start.x, start.y, null));
    chase(walking);
    for (let i = 0; i < 200; i++) walking.tick(0);
    expect(entityCentre(walking.entities[0]!).x).toBeGreaterThan(5 * TILE_SUBPX);
  });
});

// The remaining two M3 scenarios, which need exact values rather than macro asserts.
describe('scenarios', () => {
  it('leaves a skel_axe standing after a hit, moved only 60 subpx (02 §2.2)', () => {
    const room = parseRoom(['#########', '#.......#', '#.......#', '#.......#', '#########']);
    const sim = new Sim(room, { start: { x: 1 * TILE_SUBPX, y: 2 * TILE_SUBPX } });
    const axe = createEntity(0, 'skel_axe', 6 * TILE_SUBPX, 2 * TILE_SUBPX, null);
    sim.entities.push(axe);

    damageEnemy(axe, 1, Dir8.R);
    expect(axe.knockMag).toBe(24); // not the 48 an ordinary enemy takes
    expect(axe.hp).toBe(3); // 4 HP, so it survives comfortably

    // 24 + 18 + 12 + 6 = 60 subpx, under four pixels, over four ticks.
    const startX = axe.x;
    for (let i = 0; i < 4; i++) sim.tick(0);
    expect(axe.x - startX).toBe(60);
    expect(axe.knockMag).toBe(0);
    expect(axe.state).not.toBe(EnemyState.DYING);
  });

  it('walks a zombie straight across a spike tile (02 §2.1 trap immunity)', () => {
    // No shipped room pairs a zombie with spikes, so the scene is built here. Spikes are
    // floor as far as movement goes (02 §3.1); their damage — which never touches an enemy —
    // lands in M4, and this is the half M3 can prove.
    const room = parseRoom(['#########', '#.......#', '#..s.s..#', '#.......#', '#########']);
    const sim = new Sim(room, { start: { x: 1 * TILE_SUBPX, y: 2 * TILE_SUBPX } });

    // Line the two hitbox centres up exactly, so the walk is a pure cardinal at full speed
    // rather than the diagonal 4 subpx/tick a 16-subpixel offset would produce.
    const zombie = createEntity(0, 'zombie', 7 * TILE_SUBPX, 2 * TILE_SUBPX, null);
    zombie.y += playerCentre(sim.player).y - entityCentre(zombie).y;
    sim.entities.push(zombie);

    const crossed = new Set<number>();
    for (let i = 0; i < 300; i++) {
      sim.tick(0);
      crossed.add(Math.floor(entityCentre(zombie).x / TILE_SUBPX));
    }

    expect(crossed.has(5)).toBe(true); // it walked over both spike tiles
    expect(crossed.has(3)).toBe(true);
    expect(zombie.hp).toBe(3); // and arrived with every hit point
    expect(sim.player.hp).toBeLessThan(6); // having reached the player
  });
});
