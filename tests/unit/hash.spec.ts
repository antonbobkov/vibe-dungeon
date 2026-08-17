import { describe, expect, it } from 'vitest';

import { hashString, newHash, writeByte, writeInt32 } from '../../src/sim/hash.js';
import { DOWN, RIGHT } from '../../src/sim/input.js';
import { hashStream, runInputs } from '../../src/sim/replay.js';
import { parseRoom } from '../../src/sim/room.js';
import { Sim } from '../../src/sim/sim.js';

/** ROOM_MAX (20×12), all interior floor — long enough that a 120-tick run never hits a wall. */
const ROOM = [
  '####################',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '####################',
];

function sim(): Sim {
  return new Sim(parseRoom(ROOM), { start: { x: 256, y: 256 } });
}

/** 60 ticks right, then 60 down. */
function inputs(): Uint8Array {
  const bytes = new Uint8Array(120);
  bytes.fill(RIGHT, 0, 60);
  bytes.fill(DOWN, 60, 120);
  return bytes;
}

// 05-data-formats §4.
describe('FNV-1a', () => {
  it('matches an exact-arithmetic reference implementation', () => {
    // Independent reference in BigInt, where nothing can silently lose precision.
    const reference = (bytes: number[]): number => {
      let h = 2166136261n;
      for (const b of bytes) h = ((h ^ BigInt(b)) * 16777619n) & 0xffffffffn;
      return Number(h);
    };

    const bytes = [0x00, 0x01, 0x7f, 0x80, 0xff, 0x2a, 0xd3];
    let h = newHash();
    for (const b of bytes) h = writeByte(h, b);
    expect(h).toBe(reference(bytes));
  });

  it('would break under plain multiplication — the reason Math.imul is mandatory', () => {
    // h * 16777619 for a large h exceeds 2^53 and rounds; imul does not.
    const h = 0xdeadbeef;
    const naive = ((h ^ 0x42) * 16777619) >>> 0;
    expect(naive).not.toBe(writeByte(h, 0x42));
  });

  it('writes int32 values little-endian', () => {
    let byteWise = newHash();
    for (const b of [0x78, 0x56, 0x34, 0x12]) byteWise = writeByte(byteWise, b);
    expect(writeInt32(newHash(), 0x12345678)).toBe(byteWise);
  });

  it('handles negative values as two’s complement int32', () => {
    expect(writeInt32(newHash(), -1)).toBe(writeInt32(newHash(), 0xffffffff | 0));
  });

  it('hashes flag ids distinctly', () => {
    expect(hashString('f1:chest:R3')).not.toBe(hashString('f1:chest:R4'));
    expect(hashString('same')).toBe(hashString('same'));
  });
});

describe('state hash', () => {
  it('changes when the player moves', () => {
    const s = sim();
    const before = s.hash();
    s.tick(RIGHT);
    expect(s.hash()).not.toBe(before);
  });

  it('changes when only facing changes', () => {
    // Walk into the left wall so position is pinned, then face down: only `facing` differs.
    const a = sim();
    const b = sim();
    runInputs(a, new Uint8Array(30).fill(DOWN));
    runInputs(b, new Uint8Array(30).fill(DOWN));
    expect(a.hash()).toBe(b.hash());
    a.player.facing = 3;
    expect(a.hash()).not.toBe(b.hash());
  });
});

// The collection sections of 05 §4's canonical order. Entities and traps now come from
// level data; these tests pin the order and the flag sorting so filling the rest in M3–M4
// cannot reorder the stream.
describe('state hash — collection sections', () => {
  const entity = (x: number) => ({
    type: 1,
    x,
    y: 0,
    hp: 2,
    state: 0,
    stateTimer: 0,
    drop: null,
  });

  it('covers entities, traps, doors and persistent flags', () => {
    const s = sim();
    const empty = s.hash();

    s.entities.push(entity(100));
    const withEntity = s.hash();
    expect(withEntity).not.toBe(empty);

    s.traps.push({
      def: { at: [1, 1], kind: 'spike', period: 120, offset: 0, alwaysOn: false, deadly: [1, 1] },
      phase: 7,
    });
    const withTrap = s.hash();
    expect(withTrap).not.toBe(withEntity);

    s.doorOpen.push(true);
    const withDoor = s.hash();
    expect(withDoor).not.toBe(withTrap);

    s.persistence.set('f1/d3/open');
    expect(s.hash()).not.toBe(withDoor);
  });

  it('distinguishes entity order', () => {
    const a = sim();
    a.entities.push(entity(100), entity(200));
    const b = sim();
    b.entities.push(entity(200), entity(100));
    expect(a.hash()).not.toBe(b.hash());
  });

  it('hashes flags sorted, so insertion order cannot matter', () => {
    const a = sim();
    a.persistence.set('zeta');
    a.persistence.set('alpha');
    const b = sim();
    b.persistence.set('alpha');
    b.persistence.set('zeta');
    expect(a.hash()).toBe(b.hash());
  });

  it('covers the inventory fields', () => {
    const s = sim();
    const before = s.hash();
    s.inventory.goldKey = true;
    expect(s.hash()).not.toBe(before);
  });

  it('covers the trailing wave and seal fields', () => {
    const s = sim();
    const before = s.hash();
    s.pendingWave = 2;
    const withWave = s.hash();
    expect(withWave).not.toBe(before);
    s.seal = 1;
    expect(s.hash()).not.toBe(withWave);
  });
});

// The determinism gate of TESTING.md §3.
describe('determinism', () => {
  it('produces identical hash streams for two identical runs', () => {
    const a = hashStream(sim(), inputs());
    const b = hashStream(sim(), inputs());
    expect(a).toEqual(b);
    expect(new Set(a).size).toBeGreaterThan(1); // the stream is not a constant
  });

  it('diverges from a one-tick input difference and never re-converges', () => {
    const base = inputs();
    const altered = inputs();
    altered[40] = 0; // drop a single tick of RIGHT

    const a = hashStream(sim(), base);
    const b = hashStream(sim(), altered);

    for (let i = 0; i < 40; i++) expect(b[i], `tick ${i}`).toBe(a[i]);
    expect(b[40]).not.toBe(a[40]);
    expect(b[119]).not.toBe(a[119]);
    expect(b.at(-1)).not.toBe(a.at(-1));
  });

  it('runs the same in one pass as in two halves', () => {
    const all = inputs();
    const whole = sim();
    runInputs(whole, all);

    const split = sim();
    runInputs(split, all.slice(0, 45));
    runInputs(split, all.slice(45));

    expect(split.hash()).toBe(whole.hash());
  });
});
