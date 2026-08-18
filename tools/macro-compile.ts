/**
 * `tsx tools/macro-compile.ts [dir-or-file...]` — compiles `.macro` sources to
 * `.replay.json` (05 §3.2). With no arguments it compiles everything in `tests/replay/`.
 *
 * `--check` compiles without writing and fails on any drift from the committed file, which
 * is the first step of `npm run test:replay` (TESTING.md §3).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { compileMacro, type Replay } from './macro.js';
import { macroFiles } from './run-replay.js';

export const replayPathFor = (macroPath: string): string =>
  join(dirname(macroPath), `${basename(macroPath, '.macro')}.replay.json`);

/** Stable JSON so a recompile of unchanged text is byte-identical. */
export function formatReplay(replay: Replay): string {
  return `${JSON.stringify(replay, null, 2)}\n`;
}

export interface CompileResult {
  macro: string;
  replayPath: string;
  json: string;
  drifted: boolean;
}

export function compileFile(macroPath: string): CompileResult {
  const replay = compileMacro(readFileSync(macroPath, 'utf8'));
  const replayPath = replayPathFor(macroPath);

  let committed: string | null;
  try {
    committed = readFileSync(replayPath, 'utf8');
  } catch {
    committed = null; // never compiled before
  }

  // A recorded hash stream (05 §4) belongs to one exact tape. Carry it through a recompile of
  // unchanged macro text — otherwise every recompile would report drift against the recording
  // — and drop it the moment the inputs differ, so a stale stream can never outlive its run.
  if (committed !== null) {
    const previous = parse(committed);
    if (previous?.hashes && previous.inputs === replay.inputs) replay.hashes = previous.hashes;
  }

  const json = formatReplay(replay);
  return { macro: macroPath, replayPath, json, drifted: committed !== json };
}

function parse(json: string): Replay | null {
  try {
    return JSON.parse(json) as Replay;
  } catch {
    return null;
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const targets = args.filter((a) => !a.startsWith('--'));
  const macros =
    targets.length > 0
      ? expand(targets)
      : macroFiles('tests/replay').map((f) => join('tests/replay', f));

  if (macros.length === 0) {
    console.error('macro-compile: no .macro files found');
    process.exit(1);
  }

  let drift = 0;
  for (const macroPath of macros) {
    const result = compileFile(macroPath);
    if (check) {
      if (result.drifted) {
        drift++;
        console.error(`DRIFT ${result.replayPath} does not match a fresh compile of ${macroPath}`);
      }
      continue;
    }
    writeFileSync(result.replayPath, result.json, 'utf8');
    console.log(`compiled ${macroPath} -> ${result.replayPath}`);
  }

  if (drift > 0) {
    console.error(`\n${drift} replay file(s) out of date — run npm run macro:compile`);
    process.exit(1);
  }
  if (check) console.log(`macro-compile: ${macros.length} replay file(s) match their macros`);
}

function expand(targets: string[]): string[] {
  return targets.flatMap((target) =>
    target.endsWith('.macro') ? [target] : macroFiles(target).map((f) => join(target, f)),
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main();
}
