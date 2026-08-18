/**
 * `npm run replay:record` — write each replay's state-hash stream into its `.replay.json`.
 *
 * The stream is 05 §4's hash sampled every `HASH_EVERY` ticks. Running the replay twice and
 * comparing (which `npm run test:replay` also does) proves the sim is deterministic *today*;
 * a committed stream proves it still does the same thing as the day the replay was authored.
 * When a gameplay constant changes, the diff points at the exact sample where behaviour moved,
 * which is where the re-authoring has to start.
 *
 * A recording belongs to one exact tape: `macro-compile` carries it through a recompile of
 * unchanged macro text and drops it as soon as the inputs differ, so re-record after editing
 * a macro or a route.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { compileFile, formatReplay } from './macro-compile.js';
import type { Replay } from './macro.js';
import { HASH_EVERY, loadFloors, macroFiles, runReplay, sampleHashes } from './run-replay.js';

function main(): void {
  const dir = process.argv[2] ?? 'tests/replay';
  const macros = macroFiles(dir);
  if (macros.length === 0) {
    console.error(`replay:record: no .macro files in ${dir}`);
    process.exit(1);
  }

  const floors = loadFloors();
  let failed = 0;

  for (const name of macros) {
    const compiled = compileFile(join(dir, name));
    // Record against what the macro says now, not against a stale committed file.
    writeFileSync(compiled.replayPath, compiled.json, 'utf8');
    const replay = JSON.parse(readFileSync(compiled.replayPath, 'utf8')) as Replay;

    const run = runReplay(replay, floors, { hashEvery: 1, log: () => {} });
    if (run.failures.length > 0) {
      failed++;
      console.error(`FAIL ${name}: ${run.failures.length} assert failure(s) — not recorded`);
      for (const failure of run.failures) console.error(`  ${failure}`);
      continue;
    }

    const values = sampleHashes(run.hashes, HASH_EVERY);
    const updated: Replay = { ...replay, hashes: { every: HASH_EVERY, values } };
    writeFileSync(compiled.replayPath, formatReplay(updated), 'utf8');
    console.log(
      `recorded ${name} — ${run.hashes.length} ticks, ${values.length} hashes,` +
        ` final ${run.sim.hash().toString(16)}`,
    );
  }

  if (failed > 0) {
    console.error(`\nreplay:record: ${failed} replay(s) could not be recorded`);
    process.exit(1);
  }
}

main();
