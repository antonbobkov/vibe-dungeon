import { readFileSync } from 'node:fs';

import { loadFloor, type FloorFile, type LoadedFloor } from '../../src/sim/level.js';
import { Sim, type SimOptions } from '../../src/sim/sim.js';

/** The four real floors, loaded once and shared — they are read-only after loading. */
let cached: LoadedFloor[] | null = null;

export function floors(): LoadedFloor[] {
  cached ??= (['f1', 'f2', 'f3', 'f4'] as const).map((id) =>
    loadFloor(JSON.parse(readFileSync(`levels/${id}.json`, 'utf8')) as FloorFile),
  );
  return cached;
}

/** A sim over the real game, starting wherever `options` says (floor 1 R1 by default). */
export function game(options: SimOptions = {}): Sim {
  return new Sim(floors(), options);
}

/** Feed the same input for `ticks` ticks. */
export function hold(sim: Sim, input: number, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick(input);
}

/** Run until `done` is true, or fail after `limit` ticks — keeps runaway loops out of tests. */
export function runUntil(sim: Sim, input: number, done: (s: Sim) => boolean, limit = 600): number {
  for (let i = 1; i <= limit; i++) {
    sim.tick(input);
    if (done(sim)) return i;
  }
  throw new Error(`runUntil: condition still false after ${limit} ticks`);
}
