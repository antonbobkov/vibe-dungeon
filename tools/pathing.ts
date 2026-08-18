/**
 * Path and danger arithmetic for the route autopilot (`tools/route.ts`).
 *
 * Everything here is a pure function of a room, its traps and its bolts — no `Sim`, no I/O —
 * so `tests/unit/route.spec.ts` can pin it with hand-computed values. The autopilot uses it
 * to answer three questions, tick after tick: which way to the next tile, is that tile about
 * to become deadly, and is something falling down its lane.
 */

import { BOLT_SPEED, TILE_SUBPX, WALK_SPEED } from '../src/sim/constants.js';
import { rectsOverlap, tileRect } from '../src/sim/geometry.js';
import { ATTACK, DOWN, INTERACT, LEFT, RIGHT, UP } from '../src/sim/input.js';
import type { Cell } from '../src/sim/level.js';
import { isSolid, tileAt, type Room } from '../src/sim/room.js';
import {
  boltAt,
  boltBlocked,
  boltRect,
  isDeadly,
  trapPhase,
  type SimBolt,
} from '../src/sim/trap.js';
import type { SimTrap } from '../src/sim/trap.js';

/** Four neighbours, in a fixed order so a tie between equal paths always breaks the same way. */
const NEIGHBOURS: readonly Cell[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export const cellKey = (col: number, row: number): number => row * 1000 + col;

/** Where a walker may stand: 01 §3.1 solidity for the `ground` column. */
export function walkable(room: Room, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= room.w || row >= room.h) return false;
  return !isSolid(tileAt(room, col, row), 'ground');
}

export interface PathOptions {
  /**
   * Tiles to route around when a way round exists. The autopilot passes its trap tiles: a
   * corridor that never steps on a spike needs no timing at all.
   */
  avoid?: (col: number, row: number) => boolean;
}

/**
 * Breadth-first path between two tiles, as the list of tiles to walk *after* `from`.
 * `[]` means "already there"; `null` means the room has no way through.
 *
 * With `avoid`, the search runs twice: once treating avoided tiles as solid, and — only if
 * that fails — once without, so an unavoidable spike still gets crossed (with the caller
 * timing the crossing).
 */
export function findPath(
  room: Room,
  from: Cell,
  to: Cell,
  options: PathOptions = {},
): Cell[] | null {
  if (options.avoid) {
    const clean = search(room, from, to, options.avoid);
    if (clean) return clean;
  }
  return search(room, from, to, undefined);
}

function search(
  room: Room,
  from: Cell,
  to: Cell,
  avoid: ((col: number, row: number) => boolean) | undefined,
): Cell[] | null {
  const [fromCol, fromRow] = from;
  const [toCol, toRow] = to;
  if (!walkable(room, toCol, toRow)) return null;
  if (fromCol === toCol && fromRow === toRow) return [];

  const cameFrom = new Map<number, Cell | null>([[cellKey(fromCol, fromRow), null]]);
  const queue: Cell[] = [[fromCol, fromRow]];

  for (let head = 0; head < queue.length; head++) {
    const [col, row] = queue[head]!;
    for (const [dc, dr] of NEIGHBOURS) {
      const next: Cell = [col + dc, row + dr];
      const key = cellKey(next[0], next[1]);
      if (cameFrom.has(key)) continue;
      if (!walkable(room, next[0], next[1])) continue;
      // The goal is always allowed: standing on a spike is sometimes the whole point.
      if (avoid?.(next[0], next[1]) && !(next[0] === toCol && next[1] === toRow)) continue;

      cameFrom.set(key, [col, row]);
      if (next[0] === toCol && next[1] === toRow) return unwind(cameFrom, next);
      queue.push(next);
    }
  }
  return null;
}

function unwind(cameFrom: Map<number, Cell | null>, goal: Cell): Cell[] {
  const path: Cell[] = [];
  let at: Cell | null = goal;
  while (at) {
    path.push(at);
    at = cameFrom.get(cellKey(at[0], at[1])) ?? null;
  }
  path.pop(); // drop the start; the caller is standing on it
  return path.reverse();
}

/** The tiles a box of `w × h` subpixels at `(l,t)` overlaps. */
export function tilesOverlapped(l: number, t: number, w: number, h: number): Cell[] {
  const cells: Cell[] = [];
  const colStart = Math.floor(l / TILE_SUBPX);
  const colEnd = Math.floor((l + w - 1) / TILE_SUBPX);
  const rowStart = Math.floor(t / TILE_SUBPX);
  const rowEnd = Math.floor((t + h - 1) / TILE_SUBPX);
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) cells.push([col, row]);
  }
  return cells;
}

/**
 * Whether a trap makes `cell` deadly at any tick from now to `now + ticks` — the exact 02 §3
 * phase math, run forward. `roomTimer` is the sim's, and the traps are the room's.
 */
export function deadlySoon(
  traps: readonly SimTrap[],
  roomTimer: number,
  cell: Cell,
  ticks: number,
): boolean {
  for (const trap of traps) {
    const at = trap.def.deadly;
    if (!at || at[0] !== cell[0] || at[1] !== cell[1]) continue;
    for (let k = 0; k <= ticks; k++) {
      if (isDeadly(trap.def, trapPhase(trap.def, roomTimer + k))) return true;
    }
  }
  return false;
}

/**
 * Whether a bolt — one in flight now, or one a launcher will fire inside the window — passes
 * through `cell` in the next `ticks`. Flight is straight down at a fixed speed (02 §3.2), so
 * this is arithmetic rather than simulation; the only thing it has to respect is that walls
 * and crates stop a bolt.
 */
export function boltSoon(
  room: Room,
  bolts: readonly SimBolt[],
  traps: readonly SimTrap[],
  roomTimer: number,
  cell: Cell,
  ticks: number,
): boolean {
  const target = tileRect(cell[0], cell[1]);

  for (const bolt of bolts) {
    if (flies(room, { id: bolt.id, x: bolt.x, y: bolt.y }, 0, ticks, target)) return true;
  }

  for (const trap of traps) {
    if (trap.def.kind !== 'arrow') continue;
    for (let k = 0; k <= ticks; k++) {
      if (trapPhase(trap.def, roomTimer + k) !== 0) continue;
      if (flies(room, boltAt(-1, trap.def.at), k, ticks, target)) return true;
    }
  }
  return false;
}

/** Fly one bolt from `spawnTick` to `ticks`, reporting whether it crosses `target` first. */
function flies(
  room: Room,
  bolt: SimBolt,
  spawnTick: number,
  ticks: number,
  target: ReturnType<typeof tileRect>,
): boolean {
  for (let k = spawnTick; k <= ticks; k++) {
    const at: SimBolt = { id: bolt.id, x: bolt.x, y: bolt.y + BOLT_SPEED * (k - spawnTick) };
    if (boltBlocked(room, at)) return false;
    if (rectsOverlap(boltRect(at), target)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Macro text
// ---------------------------------------------------------------------------

/** A line to splice into the emitted macro at an exact tick (an assert, or a comment). */
export interface MacroMarker {
  tick: number;
  text: string;
}

const LETTER_BITS: readonly (readonly [string, number])[] = [
  ['U', UP],
  ['D', DOWN],
  ['L', LEFT],
  ['R', RIGHT],
  ['A', ATTACK],
  ['Z', INTERACT],
];

/** One input byte as macro letters: `W` for nothing held, `UR`, `AR`, and so on (05 §3.2). */
export function stepLetters(mask: number): string {
  const letters = LETTER_BITS.filter(([, bit]) => (mask & bit) !== 0)
    .map(([letter]) => letter)
    .join('');
  return letters === '' ? 'W' : letters;
}

/**
 * Run-length encode an input tape into macro lines, splicing each marker in at its tick.
 * A run is never allowed to span a marker, because `assert` in a macro checks the state at
 * the tick it is written on.
 */
export function encodeMacro(
  inputs: readonly number[],
  markers: readonly MacroMarker[] = [],
): string[] {
  const byTick = new Map<number, string[]>();
  for (const marker of markers) {
    byTick.set(marker.tick, [...(byTick.get(marker.tick) ?? []), marker.text]);
  }

  const lines: string[] = [];
  let start = 0;
  for (let tick = 0; tick <= inputs.length; tick++) {
    const breaks = tick === inputs.length || byTick.has(tick) || inputs[tick] !== inputs[start];
    if (!breaks) continue;

    if (tick > start) {
      const count = tick - start;
      const letters = stepLetters(inputs[start]!);
      lines.push(count === 1 ? letters : `${letters} ${count}`);
    }
    for (const text of byTick.get(tick) ?? []) lines.push(text);
    start = tick;
  }
  return lines;
}

/**
 * The input needed to close a gap on one axis: nothing once the remainder is smaller than a
 * tick of travel, since a step would overshoot it. The residue is under `WALK_SPEED`, and the
 * player box has 48 subpixels of slack either side of a tile, so it never leaves it.
 */
export function axisInput(delta: number, negative: number, positive: number): number {
  if (delta <= -WALK_SPEED) return negative;
  if (delta >= WALK_SPEED) return positive;
  return 0;
}

/**
 * The vertical twin of `axisInput`, biased upward. The box has 128 subpixels of slack above
 * it but sits flush with the bottom edge of its tile (`PLAYER_BOX` is 8 px tall at offset 8),
 * so a downward residue of even one subpixel leaves the player overhanging the row below —
 * into the pit, the spike or the crate that is waiting there. Undershooting costs nothing, so
 * the walker always stops a little high.
 */
export function verticalInput(delta: number, up: number, down: number): number {
  if (delta < 0) return up;
  if (delta >= WALK_SPEED) return down;
  return 0;
}
