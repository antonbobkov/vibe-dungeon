import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { Sim } from '../../src/sim/sim.js';
import { replayInputs, type Replay } from '../../tools/macro.js';
import { loadFloors } from '../../tools/run-replay.js';

/**
 * `npm run bench` — TESTING.md §6: run the full-game replay and time every tick.
 *
 * The budget is deliberately generous (2 ms p95 for a sim that only ever holds one small
 * room), because what this is really guarding against is an accidental O(n²) creeping into an
 * overlap check. A regression fails CI.
 */

const P95_BUDGET_MS = 2;
const REPLAY = 'tests/replay/fullgame.replay.json';

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index] ?? 0;
}

/** One run of the tape, returning how long each tick took in milliseconds. */
function timeReplay(replay: Replay, inputs: Uint8Array, measure: boolean): number[] {
  const sim = new Sim(loadFloors(), { floorIndex: 3 - 3, hp: replay.start.hp });
  sim.inventory.treasure = replay.start.treasure;
  sim.deaths = replay.start.deaths;

  const times: number[] = [];
  for (const input of inputs) {
    if (!measure) {
      sim.tick(input);
      continue;
    }
    const started = performance.now();
    sim.tick(input);
    times.push(performance.now() - started);
  }
  return times;
}

describe('sim tick cost across the whole game', () => {
  it(`stays under ${P95_BUDGET_MS} ms at p95`, () => {
    const replay = JSON.parse(readFileSync(REPLAY, 'utf8')) as Replay;
    const inputs = replayInputs(replay);

    timeReplay(replay, inputs, false); // warm the JIT on a whole playthrough first
    const times = timeReplay(replay, inputs, true);

    const sorted = [...times].sort((a, b) => a - b);
    const total = times.reduce((sum, ms) => sum + ms, 0);
    const report = {
      ticks: times.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      max: sorted[sorted.length - 1] ?? 0,
      totalMs: total,
    };
    console.log(
      `sim bench: ${report.ticks} ticks, ` +
        `p50 ${report.p50.toFixed(3)} ms, p95 ${report.p95.toFixed(3)} ms, ` +
        `p99 ${report.p99.toFixed(3)} ms, max ${report.max.toFixed(3)} ms, ` +
        `${report.totalMs.toFixed(0)} ms for the run`,
    );

    expect(report.ticks).toBe(9875); // the M5 full-game replay, unchanged
    expect(report.p95).toBeLessThanOrEqual(P95_BUDGET_MS);
  });

  it('replays the whole game in far less time than it would take to play it', () => {
    // 9875 ticks is 2 min 45 s of play; the sim should chew through it in well under a second
    // on any machine that can run the game at all.
    const replay = JSON.parse(readFileSync(REPLAY, 'utf8')) as Replay;
    const inputs = replayInputs(replay);

    const started = performance.now();
    timeReplay(replay, inputs, false);
    const elapsed = performance.now() - started;

    console.log(`sim bench: the full game replays in ${elapsed.toFixed(0)} ms`);
    expect(elapsed).toBeLessThan((inputs.length / 60) * 1000);
  });
});
