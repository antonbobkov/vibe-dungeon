/**
 * Replay runner — one input byte per tick (05-data-formats §3.1).
 *
 * M1 takes raw bytes; M2's `.replay.json` loader and macro compiler feed this same runner,
 * and `--verify` compares the hash stream it produces (TESTING.md §3).
 */

import type { Sim } from './sim.js';

/** Feed every byte as one tick's input latch. */
export function runInputs(sim: Sim, inputs: Uint8Array): void {
  for (const byte of inputs) sim.tick(byte);
}

/** Run and sample the state hash after each tick — the determinism gate's raw material. */
export function hashStream(sim: Sim, inputs: Uint8Array): Uint32Array {
  const hashes = new Uint32Array(inputs.length);
  for (let i = 0; i < inputs.length; i++) {
    sim.tick(inputs[i]!);
    hashes[i] = sim.hash();
  }
  return hashes;
}
