/**
 * Headless replay runner — the engine behind `npm run sim` and `npm run test:replay`.
 *
 * Feeds byte *t* as the input latch of tick *t* (05 §3.1) and checks every assert at its
 * exact tick. Determinism makes each run reproducible, which is what lets an agent
 * binary-search a macro mistake from the state trace alone (TESTING.md §3).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { loadFloor, type FloorFile, type LoadedFloor } from '../src/sim/level.js';
import { TILE_SUBPX } from '../src/sim/constants.js';
import { Sim } from '../src/sim/sim.js';
import { replayInputs, type Replay, type ReplayExpect } from './macro.js';

export const FLOOR_IDS = ['f1', 'f2', 'f3', 'f4'] as const;

export function loadFloors(dir = 'levels'): LoadedFloor[] {
  return FLOOR_IDS.map((id) =>
    loadFloor(JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')) as FloorFile),
  );
}

export function macroFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.macro'))
    .sort();
}

/** What the sim currently shows for each assert key. */
export function currentState(sim: Sim): Required<ReplayExpect> {
  return {
    room: sim.roomId,
    floor: sim.floorIndex + 1,
    hp: sim.player.hp,
    treasure: sim.treasure,
    silverKeys: sim.silverKeys,
    goldKey: sim.goldKey,
    deaths: sim.deaths,
    enemies: sim.entities.length,
    floorComplete: sim.floorComplete,
    victory: sim.victory,
  };
}

/** The compact state line of TESTING.md §3. */
export function stateLine(sim: Sim): string {
  const col = Math.floor(sim.player.x / TILE_SUBPX);
  const row = Math.floor(sim.player.y / TILE_SUBPX);
  const near = sim.entities.length > 0 ? ` enemies=${sim.entities.length}` : '';
  const pickups = sim.pickups.length > 0 ? ` pickups=${sim.pickups.length}` : '';
  return (
    `t=${String(sim.playTick).padStart(6)} ${sim.floor.id}/${sim.roomId}` +
    ` tile=(${col},${row}) hp=${sim.player.hp} treasure=${sim.treasure}` +
    ` keys=${sim.silverKeys}${sim.goldKey ? '+gold' : ''}${near}${pickups}`
  );
}

export interface RunOptions {
  dumpEvery?: number;
  /** Sample the state hash every N ticks; 0 disables. */
  hashEvery?: number;
  log?: (line: string) => void;
}

export interface RunResult {
  sim: Sim;
  failures: string[];
  hashes: number[];
}

/** Run a replay to its end, checking asserts as they come due. */
export function runReplay(
  replay: Replay,
  floors: LoadedFloor[],
  options: RunOptions = {},
): RunResult {
  const { dumpEvery = 0, hashEvery = 0, log = console.log } = options;

  const floorIndex = FLOOR_IDS.indexOf(replay.floor);
  if (floorIndex < 0) throw new Error(`unknown floor "${replay.floor}"`);

  const sim = new Sim(floors, {
    floorIndex,
    hp: replay.start.hp,
    ...(replay.room === undefined ? {} : { roomId: replay.room }),
    ...(replay.at === undefined
      ? {}
      : { start: { x: replay.at[0] * TILE_SUBPX, y: replay.at[1] * TILE_SUBPX } }),
  });
  sim.inventory.treasure = replay.start.treasure;
  sim.deaths = replay.start.deaths;

  const failures: string[] = [];
  const hashes: number[] = [];
  const byTick = new Map<number, ReplayExpect[]>();
  for (const a of replay.asserts) {
    byTick.set(a.tick, [...(byTick.get(a.tick) ?? []), a.expect]);
  }

  const check = (tick: number): void => {
    for (const expect of byTick.get(tick) ?? []) {
      const actual = currentState(sim);
      for (const [key, want] of Object.entries(expect)) {
        const got = actual[key as keyof ReplayExpect];
        if (got !== want) {
          failures.push(`tick ${tick}: expected ${key}=${String(want)}, got ${String(got)}`);
          log(`  FAIL ${stateLine(sim)}`);
        }
      }
    }
  };

  check(0);
  const inputs = replayInputs(replay);
  for (let i = 0; i < inputs.length; i++) {
    sim.tick(inputs[i]!);
    const tick = i + 1;
    if (hashEvery > 0 && tick % hashEvery === 0) hashes.push(sim.hash());
    if (dumpEvery > 0 && tick % dumpEvery === 0) log(stateLine(sim));
    check(tick);
  }

  return { sim, failures, hashes };
}
