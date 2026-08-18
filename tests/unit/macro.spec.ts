import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ATTACK, DOWN, INTERACT, LEFT, RIGHT, UP } from '../../src/sim/input.js';
import { MacroError, compileMacro, replayInputs, type Replay } from '../../tools/macro.js';
import { compileFile, formatReplay, replayPathFor } from '../../tools/macro-compile.js';
import { HASH_EVERY, runReplay } from '../../tools/run-replay.js';
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

  it('round-trips through the compiler, recording and all (05 §4)', () => {
    const bare = compileMacro(readFileSync(macroPath, 'utf8'));
    const committed = JSON.parse(readFileSync(replayPathFor(macroPath), 'utf8')) as Replay;

    // The compiler itself never runs the sim, so it produces no hashes; the recording beside
    // the macro is carried through a recompile, and belongs to exactly this tape.
    expect(bare.hashes).toBeUndefined();
    expect(committed.inputs).toBe(bare.inputs);
    const hashes = committed.hashes!;
    expect(hashes.every).toBe(HASH_EVERY);
    expect(formatReplay({ ...bare, hashes })).toBe(readFileSync(replayPathFor(macroPath), 'utf8'));
  });

  it('drops a recording that no longer belongs to the tape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'undervault-'));
    const macro = join(dir, 'probe.macro');
    writeFileSync(macro, 'floor f1\nR 4\n', 'utf8');

    const recorded: Replay = {
      ...compileMacro('floor f1\nR 4\n'),
      hashes: { every: HASH_EVERY, values: [123] },
    };
    writeFileSync(replayPathFor(macro), formatReplay(recorded), 'utf8');
    expect(compileFile(macro).drifted).toBe(false); // same inputs: the recording stands

    writeFileSync(macro, 'floor f1\nR 5\n', 'utf8'); // one tick longer
    const changed = compileFile(macro);
    expect(changed.drifted).toBe(true);
    expect((JSON.parse(changed.json) as Replay).hashes).toBeUndefined();

    rmSync(dir, { recursive: true, force: true });
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

describe('scenario headers (this project’s extension to 05 §3.2)', () => {
  it('reads a room and a starting tile', () => {
    const replay = compileMacro('floor f1\nroom R2\nat 6,6\nW 1');
    expect(replay.room).toBe('R2');
    expect(replay.at).toEqual([6, 6]);
  });

  it('leaves both out when the macro does not set a scene', () => {
    const replay = compileMacro('floor f1\nW 1');
    expect(replay.room).toBeUndefined();
    expect(replay.at).toBeUndefined();
  });

  it('rejects a malformed scene', () => {
    expect(() => compileMacro('floor f1\nroom')).toThrow(/line 2: room needs a room id/);
    expect(() => compileMacro('floor f1\nat 6')).toThrow(/line 2: at needs a col,row cell/);
    expect(() => compileMacro('floor f1\nat x,y')).toThrow(/line 2: at needs a col,row cell/);
  });

  it('counts the enemies still standing', () => {
    const replay = compileMacro('floor f1\nassert enemies=0');
    expect(replay.asserts[0]!.expect).toEqual({ enemies: 0 });
  });
});

describe('the committed combat scenarios', () => {
  const scenarios = ['f1-skel-sword-kill', 'f2-zombie-chase'] as const;

  it.each(scenarios)('%s is exactly what a fresh compile produces', (name) => {
    expect(compileFile(`tests/replay/${name}.macro`).drifted, 'run npm run macro:compile').toBe(
      false,
    );
  });

  it('kills the skeleton in two swings, unharmed', () => {
    const replay = compileMacro(readFileSync('tests/replay/f1-skel-sword-kill.macro', 'utf8'));
    const run = runReplay(replay, floors(), { log: () => {} });
    expect(run.failures).toEqual([]);
    expect(run.sim.entities).toEqual([]);
    expect(run.sim.player.hp).toBe(6);
  });

  it('lets the zombie land two hits exactly 63 ticks apart', () => {
    // 60 ticks of i-frames (01 §5.1) plus the 3 ticks of hit-stop the first hit froze.
    const replay = compileMacro(readFileSync('tests/replay/f2-zombie-chase.macro', 'utf8'));
    const run = runReplay(replay, floors(), { log: () => {} });
    expect(run.failures).toEqual([]);
    expect(run.sim.player.hp).toBe(4);
    expect(run.sim.playTick).toBe(151);
  });
});
