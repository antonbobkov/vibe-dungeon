/**
 * `npm run test:replay` — the replay gate of TESTING.md §3:
 *
 *   1. Recompile every `.macro` and fail on drift with the committed `.replay.json`.
 *   2. Run each replay headless; every embedded assert must hold at its exact tick.
 *   3. Run everything twice and compare full hash streams (the determinism gate).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { compileFile } from './macro-compile.js';
import type { Replay } from './macro.js';
import { loadFloors, macroFiles, runReplay } from './run-replay.js';

const DIR = process.argv[2] ?? 'tests/replay';

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

    if (first.failures.length === 0 && diverged < 0) {
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

main();
