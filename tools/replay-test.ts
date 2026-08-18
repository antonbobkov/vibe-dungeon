/**
 * `npm run test:replay` — the replay gate of TESTING.md §3:
 *
 *   1. Recompile every `.macro` and fail on drift with the committed `.replay.json`.
 *   2. Run each replay headless; every embedded assert must hold at its exact tick.
 *   3. Run everything twice and compare full hash streams (the determinism gate).
 *   4. Compare each run against its committed hash stream (05 §4), which says the sim still
 *      does what it did the day the replay was authored — and points at the tick where it
 *      stopped, when it does not.
 *   5. Hold the chained full-game replay to a plausible length: M5's proof that the game can
 *      be finished is not much of a proof if "finishing" takes two hundred ticks.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { compileFile } from './macro-compile.js';
import type { Replay } from './macro.js';
import { hashSampleTick, loadFloors, macroFiles, runReplay, sampleHashes } from './run-replay.js';

const DIR = process.argv[2] ?? 'tests/replay';

/** The chained solution replay, and the band its length has to sit in. */
const FULLGAME = 'fullgame.macro';
const FULLGAME_TICKS = { min: 8000, max: 60000 };

function main(): void {
  const macros = macroFiles(DIR);
  if (macros.length === 0) {
    console.error(`test:replay: no .macro files in ${DIR}`);
    process.exit(1);
  }

  const floors = loadFloors();
  const problems: string[] = [];

  for (const name of macros) {
    const macroPath = join(DIR, name);

    // 1. Compilation must match what is committed.
    const compiled = compileFile(macroPath);
    if (compiled.drifted) {
      problems.push(`${name}: ${compiled.replayPath} is out of date — run npm run macro:compile`);
      continue;
    }

    const replay = JSON.parse(readFileSync(compiled.replayPath, 'utf8')) as Replay;

    // 2. Every assert holds at its exact tick.
    const first = runReplay(replay, floors, { hashEvery: 1, log: () => {} });
    for (const failure of first.failures) problems.push(`${name}: ${failure}`);

    // 3. The same inputs reproduce the same hash stream, tick for tick.
    const second = runReplay(replay, floors, { hashEvery: 1, log: () => {} });
    const diverged = first.hashes.findIndex((h, i) => h !== second.hashes[i]);
    if (diverged >= 0) {
      problems.push(`${name}: two runs diverged at tick ${diverged + 1}`);
    }

    // 4. …and the same stream as the recording committed beside it.
    const stale = recordingProblem(name, replay, first.hashes);
    if (stale) problems.push(stale);

    // 5. The full game is a playthrough, and takes about as long as one.
    if (name === FULLGAME) {
      const ticks = first.hashes.length;
      if (ticks < FULLGAME_TICKS.min || ticks > FULLGAME_TICKS.max) {
        problems.push(
          `${name}: ${ticks} ticks is outside the ${FULLGAME_TICKS.min}–${FULLGAME_TICKS.max} band`,
        );
      }
    }

    if (first.failures.length === 0 && diverged < 0 && !stale) {
      console.log(
        `ok ${name} — ${first.hashes.length} ticks, ${replay.asserts.length} assert(s), hash ${first.sim
          .hash()
          .toString(16)}`,
      );
    }
  }

  if (problems.length > 0) {
    console.error(`\ntest:replay: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`test:replay: ${macros.length} replay(s) passed`);
}

/**
 * Compare a run against the hash stream recorded in its replay file. `perTick` is this run's
 * hash after every tick, so the sample recorded for tick *n* is `perTick[n - 1]`.
 */
function recordingProblem(name: string, replay: Replay, perTick: readonly number[]): string | null {
  if (!replay.hashes) return `${name}: no recorded hashes — run npm run replay:record`;

  const { every, values } = replay.hashes;
  const expected = sampleHashes(perTick, every);
  if (values.length !== expected.length) {
    return `${name}: recorded ${values.length} hashes, this run samples ${expected.length} — re-record`;
  }

  for (const [index, recorded] of values.entries()) {
    const tick = hashSampleTick(index, every, perTick.length);
    const actual = expected[index];
    if (actual !== recorded) {
      return (
        `${name}: state hash at tick ${tick} is ${(actual ?? 0).toString(16)},` +
        ` recorded ${recorded.toString(16)} — behaviour changed since the replay was authored`
      );
    }
  }
  return null;
}

main();
