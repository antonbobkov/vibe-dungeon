import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ATTACK, DOWN, INTERACT, LEFT, RIGHT, UP } from '../../src/sim/input.js';
import { MacroError, compileMacro, replayInputs } from '../../tools/macro.js';
import { compileFile, formatReplay, replayPathFor } from '../../tools/macro-compile.js';
import { runReplay } from '../../tools/run-replay.js';
import { floors } from './helpers.js';

const bytes = (text: string): number[] => [...replayInputs(compileMacro(`floor f1\n${text}`))];

// 05-data-formats §3.2.
describe('macro syntax', () => {
  it('holds a direction for a tick count', () => {
    expect(bytes('R 4')).toEqual([RIGHT, RIGHT, RIGHT, RIGHT]);
  });

  it('combines letters written together', () => {
    expect(bytes('UR 2')).toEqual([UP | RIGHT, UP | RIGHT]);
  });

  it('combines letters written apart, with the count last', () => {
    expect(bytes('A R 3')).toEqual([ATTACK | RIGHT, ATTACK | RIGHT, ATTACK | RIGHT]);
  });

  it('defaults to a single tick, so a bare letter is a tap', () => {
    expect(bytes('A')).toEqual([ATTACK]);
    expect(bytes('Z')).toEqual([INTERACT]);
  });

  it('waits with W', () => {
    expect(bytes('W 3')).toEqual([0, 0, 0]);
  });

  it('ignores comments, blank lines and labels', () => {
    expect(bytes('# a comment\n\nlabel fork1\nD 2 # trailing comment\n')).toEqual([DOWN, DOWN]);
  });

  it('reads every direction letter', () => {
    expect(bytes('U\nD\nL\nR')).toEqual([UP, DOWN, LEFT, RIGHT]);
  });
});

describe('macro headers and asserts', () => {
  it('requires a floor header', () => {
    expect(() => compileMacro('R 4')).toThrow(MacroError);
    expect(() => compileMacro('floor f9\nR 4')).toThrow(/floor needs f1..f4/);
  });

  it('reads the start state of 05 §3.1', () => {
    const replay = compileMacro('floor f3\nstart hp=4 treasure=38 deaths=2\nR 1');
    expect(replay.floor).toBe('f3');
    expect(replay.start).toEqual({ hp: 4, treasure: 38, deaths: 2 });
  });

  it('defaults the start to a fresh run', () => {
    expect(compileMacro('floor f1\nR 1').start).toEqual({ hp: 6, treasure: 0, deaths: 0 });
  });

  it('emits an assert at the current tick', () => {
    const replay = compileMacro(
      ['floor f1', 'assert room=R1', 'R 40', 'assert room=R2 treasure=6', 'W 10'].join('\n'),
    );
    expect(replay.asserts).toEqual([
      { tick: 0, expect: { room: 'R1' } },
      { tick: 40, expect: { room: 'R2', treasure: 6 } },
    ]);
  });

  it('reads booleans and the floor number', () => {
    const replay = compileMacro('floor f4\nassert goldKey=true victory=false floor=4');
    expect(replay.asserts[0]!.expect).toEqual({ goldKey: true, victory: false, floor: 4 });
  });

  it('points at the line when the text is wrong', () => {
    expect(() => compileMacro('floor f1\nR 4\nQ 2')).toThrow(/line 3: unknown input letter "Q"/);
    expect(() => compileMacro('floor f1\nassert room')).toThrow(/line 2: "room" is not key=value/);
    expect(() => compileMacro('floor f1\nassert hp=x')).toThrow(/line 2: hp needs an integer/);
    expect(() => compileMacro('floor f1\nassert goldKey=1')).toThrow(
      /line 2: goldKey needs true or false/,
    );
    expect(() => compileMacro('floor f1\nassert nope=1')).toThrow(
      /line 2: unknown assert key "nope"/,
    );
    expect(() => compileMacro('floor f1\nassert')).toThrow(/line 2: assert with nothing to check/);
    expect(() => compileMacro('floor f1\nR 4 5')).toThrow(/line 2: two tick counts/);
    expect(() => compileMacro('floor f1\nR 0')).toThrow(/line 2: a step of 0 ticks does nothing/);
    expect(() => compileMacro('floor f1\nstart lives=3')).toThrow(/line 2: start takes hp/);
  });
});

describe('the committed f1-d1 replay', () => {
  const macroPath = 'tests/replay/f1-d1.macro';

  it('is exactly what a fresh compile produces', () => {
    const result = compileFile(macroPath);
    expect(result.drifted, 'run npm run macro:compile').toBe(false);
  });

  it('round-trips through the compiler unchanged', () => {
    const replay = compileMacro(readFileSync(macroPath, 'utf8'));
    expect(formatReplay(replay)).toBe(readFileSync(replayPathFor(macroPath), 'utf8'));
  });

  it('runs headless with every assert holding', () => {
    const replay = compileMacro(readFileSync(macroPath, 'utf8'));
    const run = runReplay(replay, floors(), { log: () => {} });
    expect(run.failures).toEqual([]);
    expect(run.sim.roomId).toBe('R2'); // the M2 checklist's "assert room=R2"
    expect(run.sim.playTick).toBe(98);
  });

  it('reports a failing assert with its tick and both values', () => {
    const replay = compileMacro(readFileSync(macroPath, 'utf8'));
    replay.asserts.push({ tick: 98, expect: { room: 'R6' } });
    const run = runReplay(replay, floors(), { log: () => {} });
    expect(run.failures).toEqual(['tick 98: expected room=R6, got R2']);
  });
});
