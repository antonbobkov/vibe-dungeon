import { describe, expect, it } from 'vitest';

import { TILE_SUBPX, TRAP_DAMAGE } from '../../src/sim/constants.js';
import { createEntity } from '../../src/sim/enemy.js';
import type { LoadedTrap, TrapKind } from '../../src/sim/level.js';
import { parseRoom } from '../../src/sim/room.js';
import { Sim } from '../../src/sim/sim.js';
import { deadlyStart, isDeadly, isFiring, trapPhase } from '../../src/sim/trap.js';
import { floors, game, hold } from './helpers.js';

const trap = (kind: TrapKind, period: number, offset = 0, alwaysOn = false): LoadedTrap => ({
  at: [1, 1],
  kind,
  period,
  offset,
  alwaysOn,
  deadly: kind === 'arrow' ? null : [1, 1],
});

/**
 * 02-entities §3: `phase = (roomTimer + offset) mod period`, deadly for the last two fifths
 * of the cycle — `phase >= (3 * period) / 5`, integer division.
 */
describe('the deadly window', () => {
  it('starts where the spec says for every period the game uses', () => {
    expect(deadlyStart(120)).toBe(72); // spikes: 72–119, 48 ticks
    expect(deadlyStart(150)).toBe(90); // flame jets: 90–149, 60 ticks
    expect(deadlyStart(180)).toBe(108); // f2 R6's ring: 108–179, 72 ticks
    expect(deadlyStart(90)).toBe(54);
    expect(deadlyStart(45)).toBe(27);
  });

  it.each([90, 120, 150, 180])('is safe at start−1 and deadly at start, period %i', (period) => {
    const spike = trap('spike', period);
    const start = deadlyStart(period);

    expect(isDeadly(spike, start - 1)).toBe(false);
    expect(isDeadly(spike, start)).toBe(true);
    expect(isDeadly(spike, period - 1)).toBe(true); // deadly right up to the wrap
    expect(isDeadly(spike, period % period)).toBe(false); // and safe again at phase 0
  });

  it.each([90, 120, 150, 180])('is deadly for exactly two fifths of period %i', (period) => {
    const spike = trap('spike', period);
    let deadly = 0;
    for (let phase = 0; phase < period; phase++) if (isDeadly(spike, phase)) deadly++;
    expect(deadly).toBe(period - deadlyStart(period));
    expect(deadly / period).toBeCloseTo(0.4, 2);
  });

  it('shifts the whole window by the offset', () => {
    const plain = trap('spike', 120, 0);
    const late = trap('spike', 120, 60);

    // At room tick 72 the unoffset spike has just become deadly; the offset one is at phase
    // 12, long past its own window.
    expect(trapPhase(plain, 72)).toBe(72);
    expect(trapPhase(late, 72)).toBe(12);
    expect(isDeadly(plain, trapPhase(plain, 72))).toBe(true);
    expect(isDeadly(late, trapPhase(late, 72))).toBe(false);

    // And the offset one is deadly where the plain one is safe.
    expect(isDeadly(late, trapPhase(late, 12))).toBe(true);
    expect(isDeadly(plain, trapPhase(plain, 12))).toBe(false);
  });

  it('never lets an always_on trap be safe', () => {
    const always = trap('spike', 120, 0, true);
    for (const phase of [0, 1, 71, 72, 119]) expect(isDeadly(always, phase)).toBe(true);
  });

  it('gives an arrow launcher no window at all — it fires at phase 0 instead', () => {
    const launcher = trap('arrow', 90);
    for (const phase of [0, 45, 54, 89]) expect(isDeadly(launcher, phase)).toBe(false);
    expect(isFiring(launcher, 0)).toBe(true);
    expect(isFiring(launcher, 1)).toBe(false);
    expect(isFiring(trap('spike', 120), 0)).toBe(false);
  });
});

// 03-levels claims f2 R2's two spike rows are anti-phased; the arithmetic has to agree.
describe('f2 R2’s anti-phased rows', () => {
  it('never has both rows deadly at once, and leaves gaps where neither is', () => {
    const row2 = trap('spike', 120, 0);
    const row4 = trap('spike', 120, 60);

    let both = 0;
    let neither = 0;
    for (let t = 0; t < 120; t++) {
      const a = isDeadly(row2, trapPhase(row2, t));
      const b = isDeadly(row4, trapPhase(row4, t));
      if (a && b) both++;
      if (!a && !b) neither++;
    }
    expect(both).toBe(0);
    expect(neither).toBe(24); // 120 − 48 − 48
  });
});

describe('every trap in the shipped levels', () => {
  it('has a window inside its own period, and a deadly tile that is not a wall', () => {
    for (const floor of floors()) {
      for (const room of floor.rooms) {
        for (const t of room.traps) {
          const where = `${floor.id}/${room.id} ${t.kind} at (${t.at})`;
          expect(t.period, where).toBeGreaterThan(0);
          expect(t.offset, where).toBeGreaterThanOrEqual(0);
          expect(t.offset, where).toBeLessThan(t.period);
          expect(deadlyStart(t.period), where).toBeLessThan(t.period);
          if (t.kind === 'arrow') expect(t.deadly, where).toBeNull();
          else expect(t.deadly, where).not.toBeNull();
        }
      }
    }
  });

  it('starts each room’s traps at their offsets, as 01 §9 requires', () => {
    const s = game({ floorIndex: 1 }); // f2 R1: spikes at offsets 0 and 60
    expect(s.traps.map((t) => t.phase)).toEqual([0, 60]);
  });
});

describe('standing in it', () => {
  const ROOM = ['#######', '#.....#', '#..s..#', '#.....#', '#######'];

  /** The player on the spike tile, with the trap's phase under the test's control. */
  function onSpike(offset: number): Sim {
    const sim = new Sim(parseRoom(ROOM), { start: { x: 3 * TILE_SUBPX, y: 2 * TILE_SUBPX } });
    sim.traps = [{ def: trap('spike', 120, offset), phase: offset }];
    sim.traps[0]!.def.at = [3, 2];
    sim.traps[0]!.def.deadly = [3, 2];
    return sim;
  }

  it('costs a heart the tick the window opens, and not before', () => {
    // Offset 71, so room tick 1 lands on phase 72 — the first deadly tick.
    const early = onSpike(70);
    early.tick(0); // phase 71: still safe
    expect(early.player.hp).toBe(6);
    early.tick(0); // phase 72
    expect(early.player.hp).toBe(5);
    expect(TRAP_DAMAGE).toBe(1);
  });

  it('cannot hurt the same player twice inside the i-frame window', () => {
    const s = onSpike(70);
    hold(s, 0, 40); // deep inside the deadly window
    expect(s.player.hp).toBe(5); // one hit, not forty
  });

  it('leaves enemies alone, however long they stand on it (02 §2.1)', () => {
    const s = onSpike(70);
    const zombie = createEntity(0, 'zombie', 3 * TILE_SUBPX, 2 * TILE_SUBPX, null);
    s.entities.push(zombie);
    hold(s, 0, 200);
    expect(zombie.hp).toBe(3);
  });

  it('is walkable — spikes damage, they do not block (02 §3.1)', () => {
    const s = new Sim(parseRoom(ROOM), { start: { x: 1 * TILE_SUBPX, y: 2 * TILE_SUBPX } });
    hold(s, 0b1000, 40); // walk right across the spike tile
    expect(s.player.x).toBeGreaterThan(3 * TILE_SUBPX);
  });
});
