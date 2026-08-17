/**
 * Macro compiler — spec/05-data-formats.md §3.2.
 *
 * Hand-writing per-tick input bytes is impractical, so replays are compiled from macro text:
 *
 *     floor f1                  # which floor to run (header)
 *     start hp=6 treasure=0     # state on floor entry (header, optional)
 *     R 40                      # hold RIGHT for 40 ticks
 *     UR 12                     # hold UP+RIGHT for 12
 *     W 30                      # wait
 *     A                         # tap ATTACK for 1 tick
 *     A R 14                    # hold ATTACK+RIGHT for 14
 *     Z                         # tap INTERACT
 *     assert room=R2 treasure=6 # check state at the current tick
 *     label fork1               # no-op marker for readability
 *
 * `floor` and `start` are this project's headers: 05 §3.1 requires both fields in the
 * replay file, and §3.2's grammar has no way to say them. Everything else is verbatim.
 *
 * The compiler is pure text → bytes: it never runs the sim, so recompiling can only drift
 * when the macro text or this compiler changes.
 */

import { ATTACK, DOWN, INTERACT, LEFT, RIGHT, UP } from '../src/sim/input.js';
import type { FloorId } from '../src/sim/level.js';

/** The assert vocabulary of 05 §3.1, plus `floor` because 03-levels' solution tables use it. */
export interface ReplayExpect {
  room?: string;
  floor?: number;
  hp?: number;
  treasure?: number;
  silverKeys?: number;
  goldKey?: boolean;
  deaths?: number;
  floorComplete?: boolean;
  victory?: boolean;
}

export interface Replay {
  floor: FloorId;
  start: { hp: number; treasure: number; deaths: number };
  /** Base64 of one input byte per tick (05 §3.1). */
  inputs: string;
  asserts: { tick: number; expect: ReplayExpect }[];
  /** Optional determinism record, sampled every `every` ticks; written by `sim-cli --record`. */
  hashes?: { every: number; values: number[] };
}

const LETTERS: Record<string, number> = {
  U: UP,
  D: DOWN,
  L: LEFT,
  R: RIGHT,
  A: ATTACK,
  Z: INTERACT,
  W: 0, // wait — no bits, but a legal token
};

const NUMERIC_KEYS = new Set(['floor', 'hp', 'treasure', 'silverKeys', 'deaths']);
const BOOLEAN_KEYS = new Set(['goldKey', 'floorComplete', 'victory']);
const STRING_KEYS = new Set(['room']);

export class MacroError extends Error {}

function parseExpect(tokens: string[], line: number): ReplayExpect {
  const expect: ReplayExpect = {};
  for (const token of tokens) {
    const eq = token.indexOf('=');
    if (eq < 0) throw new MacroError(`line ${line}: "${token}" is not key=value`);
    const key = token.slice(0, eq);
    const raw = token.slice(eq + 1);

    if (NUMERIC_KEYS.has(key)) {
      const value = Number(raw);
      if (!Number.isInteger(value)) throw new MacroError(`line ${line}: ${key} needs an integer`);
      Object.assign(expect, { [key]: value });
    } else if (BOOLEAN_KEYS.has(key)) {
      if (raw !== 'true' && raw !== 'false') {
        throw new MacroError(`line ${line}: ${key} needs true or false`);
      }
      Object.assign(expect, { [key]: raw === 'true' });
    } else if (STRING_KEYS.has(key)) {
      Object.assign(expect, { [key]: raw });
    } else {
      throw new MacroError(`line ${line}: unknown assert key "${key}"`);
    }
  }
  if (Object.keys(expect).length === 0)
    throw new MacroError(`line ${line}: assert with nothing to check`);
  return expect;
}

/** Compile macro text into a replay. */
export function compileMacro(text: string): Replay {
  const bytes: number[] = [];
  const asserts: Replay['asserts'] = [];
  let floor: FloorId | null = null;
  const start = { hp: 6, treasure: 0, deaths: 0 };

  const lines = text.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = index + 1;
    const stripped = rawLine.split('#')[0]!.trim();
    if (stripped === '') continue;

    const tokens = stripped.split(/\s+/);
    const head = tokens[0]!;

    if (head === 'label') continue;

    if (head === 'floor') {
      const id = tokens[1];
      if (!id || !/^f[1-4]$/.test(id)) throw new MacroError(`line ${line}: floor needs f1..f4`);
      floor = id as FloorId;
      continue;
    }

    if (head === 'start') {
      for (const token of tokens.slice(1)) {
        const [key, raw] = token.split('=');
        if (!key || raw === undefined || !(key in start)) {
          throw new MacroError(`line ${line}: start takes hp, treasure and deaths`);
        }
        const value = Number(raw);
        if (!Number.isInteger(value)) throw new MacroError(`line ${line}: ${key} needs an integer`);
        Object.assign(start, { [key]: value });
      }
      continue;
    }

    if (head === 'assert') {
      asserts.push({ tick: bytes.length, expect: parseExpect(tokens.slice(1), line) });
      continue;
    }

    // A step: letters combine into one mask, an optional number gives the tick count.
    let mask = 0;
    let count: number | null = null;
    for (const token of tokens) {
      if (/^\d+$/.test(token)) {
        if (count !== null) throw new MacroError(`line ${line}: two tick counts`);
        count = Number(token);
        continue;
      }
      for (const ch of token) {
        const bit = LETTERS[ch];
        if (bit === undefined) throw new MacroError(`line ${line}: unknown input letter "${ch}"`);
        mask |= bit;
      }
    }
    if (count === 0) throw new MacroError(`line ${line}: a step of 0 ticks does nothing`);
    for (let i = 0; i < (count ?? 1); i++) bytes.push(mask);
  }

  if (!floor) throw new MacroError('no "floor f1".."f4" header');

  return {
    floor,
    start,
    inputs: Buffer.from(Uint8Array.from(bytes)).toString('base64'),
    asserts,
  };
}

/** The per-tick input bytes of a replay. */
export function replayInputs(replay: Replay): Uint8Array {
  return new Uint8Array(Buffer.from(replay.inputs, 'base64'));
}
