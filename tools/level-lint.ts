/**
 * `npm run lint:levels` — validates `levels/*.json` against spec/03-levels.md §1.7 and the
 * §6 item-economy table (TESTING.md §4).
 *
 * Most rules live in `src/sim/level-rules.ts` so unit tests can call them directly. This
 * tool adds the two checks that need things sim code may not touch: the cross-floor §6
 * totals, and decor art ids resolved against the Pack A manifest.
 *
 * Usage: `tsx tools/level-lint.ts [levels-dir]`
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { ANIMS, TILES } from '../src/assets/packA.js';
import { parseFloor, type FloorFile, type LoadedFloor } from '../src/sim/level.js';
import { validateFloor } from '../src/sim/level-rules.js';

/**
 * The 03 §6 table, which is a cross-total of the maps and prop tables rather than a source
 * of truth. The lint recomputes both sides and fails on any drift, so the spec table and the
 * level data cannot diverge silently.
 */
const ECONOMY: Record<string, { floorCoins: number; containerCoins: number; total: number }> = {
  f1: { floorCoins: 12, containerCoins: 8, total: 20 },
  f2: { floorCoins: 20, containerCoins: 0, total: 20 },
  f3: { floorCoins: 14, containerCoins: 4, total: 18 },
  f4: { floorCoins: 15, containerCoins: 10, total: 25 },
};
const GAME_TOTAL = 83;

/** Decor art is either a Pack A tile reference `A(col,row)` or an animation id (05 §1). */
function checkDecorArt(floor: LoadedFloor): string[] {
  const problems: string[] = [];
  for (const room of floor.rooms) {
    for (const d of room.decor) {
      const tileRef = /^A\((\d+),(\d+)\)$/.exec(d.art);
      if (tileRef) {
        const col = Number(tileRef[1]);
        const row = Number(tileRef[2]);
        if (!TILES.some((t) => t.col === col && t.row === row)) {
          problems.push(
            `${floor.id}/${room.id}: decor at (${d.at}) references Pack A tile (${col},${row}), which is not in the manifest`,
          );
        }
      } else if (!ANIMS.some((a) => a.id === d.art)) {
        problems.push(
          `${floor.id}/${room.id}: decor at (${d.at}) references "${d.art}", which is neither a tile nor an animation`,
        );
      }
    }
  }
  return problems;
}

/** Coins on the floor vs coins inside chests and crates, against the 03 §6 table. */
function checkEconomy(floor: LoadedFloor): string[] {
  const problems: string[] = [];
  const want = ECONOMY[floor.id];
  if (!want) return [`${floor.id}: no entry in the 03 §6 economy table`];

  let floorCoins = 0;
  let containerCoins = 0;
  for (const room of floor.rooms) {
    for (const p of room.pickups) if (p.kind === 'coin') floorCoins++;
    for (const prop of room.props) {
      containerCoins += prop.contents.filter((c) => c === 'coin').length;
      if (prop.drop === 'coin') containerCoins++;
    }
  }

  if (floorCoins !== want.floorCoins) {
    problems.push(`${floor.id}: ${floorCoins} coins on the floor, 03 §6 says ${want.floorCoins}`);
  }
  if (containerCoins !== want.containerCoins) {
    problems.push(
      `${floor.id}: ${containerCoins} coins in chests/crates, 03 §6 says ${want.containerCoins}`,
    );
  }
  if (floorCoins + containerCoins !== want.total) {
    problems.push(
      `${floor.id}: ${floorCoins + containerCoins} coins in total, 03 §6 says ${want.total}`,
    );
  }
  return problems;
}

export interface LintResult {
  problems: string[];
  floors: LoadedFloor[];
}

/**
 * Lint one floor file's parsed JSON — everything except the 03 §6 economy, which only makes
 * sense for the four real floors and is applied by `lintDirectory`.
 */
export function lintFloorFile(file: FloorFile): { problems: string[]; floor: LoadedFloor | null } {
  const { floor, problems } = parseFloor(file);
  if (!floor) return { problems, floor: null };
  return { problems: [...problems, ...validateFloor(floor), ...checkDecorArt(floor)], floor };
}

/** Lint every `*.json` in a directory, plus the cross-floor totals. */
export function lintDirectory(dir: string): LintResult {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const problems: string[] = [];
  const floors: LoadedFloor[] = [];

  for (const name of files) {
    let parsed: FloorFile;
    try {
      parsed = JSON.parse(readFileSync(join(dir, name), 'utf8')) as FloorFile;
    } catch (err) {
      problems.push(`${name}: not valid JSON — ${(err as Error).message}`);
      continue;
    }
    const result = lintFloorFile(parsed);
    problems.push(...result.problems);
    if (result.floor) {
      problems.push(...checkEconomy(result.floor));
      floors.push(result.floor);
    }
  }

  if (files.length === 0) problems.push(`${dir}: no level files found`);

  // Cross-floor: the whole-game coin total of 03 §6.
  if (floors.length === Object.keys(ECONOMY).length) {
    const total = floors.reduce((sum, floor) => {
      const perFloor = ECONOMY[floor.id];
      return sum + (perFloor?.total ?? 0);
    }, 0);
    if (total !== GAME_TOTAL) {
      problems.push(`the four floors total ${total} coins, 03 §6 says ${GAME_TOTAL}`);
    }
  }

  return { problems, floors };
}

function main(): void {
  const dir = process.argv[2] ?? 'levels';
  const { problems, floors } = lintDirectory(dir);

  if (problems.length > 0) {
    console.error(`level-lint: ${problems.length} problem(s) in ${dir}\n`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }

  const rooms = floors.reduce((n, f) => n + f.rooms.length, 0);
  console.log(`level-lint: ${floors.length} floors, ${rooms} rooms — all checks passed`);
}

// Only run when invoked directly, so tests can import the functions above.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main();
}
