/**
 * `npm run sim -- [options]` — run the game headless (TESTING.md §3).
 *
 *   --floor f1                       start on this floor (default f1)
 *   --macro tests/replay/f1.macro    compile a macro and run it
 *   --replay tests/replay/f1.replay.json   run a compiled replay
 *   --dump-state-every 30            print the compact state line every N ticks
 *   --ticks 600                      run N idle ticks when no macro/replay is given
 *   --verify [file]                  check determinism, and any stored hash stream
 *   --record                         write the hash stream back into the replay file
 *
 * The authoring loop: run with --dump-state-every, read the trace, fix the macro, repeat.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { Sim } from '../src/sim/sim.js';
import { compileMacro, type Replay } from './macro.js';
import {
  FLOOR_IDS,
  HASH_EVERY,
  hashSampleTick,
  loadFloors,
  runReplay,
  sampleHashes,
  stateLine,
} from './run-replay.js';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function has(args: string[], name: string): boolean {
  return args.includes(name);
}

function idleRun(floorId: string, ticks: number, dumpEvery: number): void {
  const floorIndex = FLOOR_IDS.indexOf(floorId as (typeof FLOOR_IDS)[number]);
  if (floorIndex < 0) throw new Error(`--floor takes one of ${FLOOR_IDS.join(', ')}`);

  const sim = new Sim(loadFloors(), { floorIndex });
  console.log(stateLine(sim));
  for (let i = 1; i <= ticks; i++) {
    sim.tick(0);
    if (dumpEvery > 0 && i % dumpEvery === 0) console.log(stateLine(sim));
  }
  console.log(stateLine(sim));
}

function main(): void {
  const args = process.argv.slice(2);
  const dumpEvery = Number(flag(args, '--dump-state-every') ?? 0);
  const macroPath = flag(args, '--macro');
  const replayPath = flag(args, '--replay');
  const verify = has(args, '--verify');
  const record = has(args, '--record');

  if (!macroPath && !replayPath) {
    idleRun(flag(args, '--floor') ?? 'f1', Number(flag(args, '--ticks') ?? 300), dumpEvery);
    return;
  }

  const source = macroPath ?? replayPath!;
  const replay: Replay = macroPath
    ? compileMacro(readFileSync(macroPath, 'utf8'))
    : (JSON.parse(readFileSync(replayPath!, 'utf8')) as Replay);

  const floors = loadFloors();
  const run = runReplay(replay, floors, { dumpEvery, hashEvery: 1 });
  console.log(stateLine(run.sim));

  let failed = run.failures.length > 0;
  for (const failure of run.failures) console.error(`ASSERT ${failure}`);

  // What a recording stores: every HASH_EVERY ticks, plus the final tick (`sampleHashes`).
  const sampled = sampleHashes(run.hashes, HASH_EVERY);

  if (verify) {
    // Determinism gate: the same inputs must reproduce the same hash stream.
    const again = runReplay(replay, floors, { hashEvery: 1, log: () => {} });
    if (JSON.stringify(again.hashes) !== JSON.stringify(run.hashes)) {
      console.error('VERIFY two runs of the same inputs produced different hash streams');
      failed = true;
    }
    if (replay.hashes) {
      if (replay.hashes.every !== HASH_EVERY) {
        console.error(
          `VERIFY stored hashes sample every ${replay.hashes.every}, expected ${HASH_EVERY}`,
        );
        failed = true;
      } else {
        const at = replay.hashes.values.findIndex((h, i) => h !== sampled[i]);
        if (at >= 0 || replay.hashes.values.length !== sampled.length) {
          console.error(
            at >= 0
              ? `VERIFY hash stream diverges from the stored one at tick ${hashSampleTick(at, HASH_EVERY, run.hashes.length)}`
              : 'VERIFY hash stream is a different length than the stored one',
          );
          failed = true;
        }
      }
    }
    if (!failed) console.log(`verify: ${sampled.length} sampled hashes match`);
  }

  if (record) {
    if (!replayPath) throw new Error('--record needs --replay (the file to write back)');
    const updated: Replay = { ...replay, hashes: { every: HASH_EVERY, values: sampled } };
    writeFileSync(replayPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
    console.log(`recorded ${sampled.length} hashes into ${replayPath}`);
  }

  console.log(
    failed
      ? `sim: ${source} FAILED (${run.failures.length} assert failure(s))`
      : `sim: ${source} ok — ${replay.asserts.length} assert(s) passed`,
  );
  if (failed) process.exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main();
}
