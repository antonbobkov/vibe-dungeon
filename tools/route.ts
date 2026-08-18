/**
 * `npm run route -- tests/replay/f1.route` — the route autopilot that authors macros.
 *
 * Hand-writing fifteen thousand ticks of input is impractical even with the macro format, so
 * the solution replays are authored one level up again: a **route** says what to do
 * ("goto 5,3", "light the four torches", "clear the room", "take the ladder") and this tool
 * plays it, choosing an input byte per tick against the real `Sim`, recording every byte, and
 * writing it out as ordinary macro text.
 *
 * The pipeline stays honest because this tool sits *outside* it. What ships is the emitted
 * `.macro`; `npm run test:replay` compiles that to `.replay.json` with the pure text→bytes
 * compiler and re-runs it against the sim. If the autopilot were wrong about anything, the
 * asserts written into the macro would fail there.
 *
 *     npx tsx tools/route.ts tests/replay/f1.route
 *     npx tsx tools/route.ts --chain tests/replay/f{1,2,3,4}.route -o tests/replay/fullgame.macro
 *
 * `--chain` runs several routes on one `Sim`, which is how the full-game replay crosses the
 * floor seams; it prints the state at each seam so the per-floor routes' `start` headers can
 * be set from the real run rather than guessed.
 */

import { basename, dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

import { PLAYER_BOX, TILE_SUBPX, WALK_SPEED } from '../src/sim/constants.js';
import { boxRect, rectCentre, rectsOverlap } from '../src/sim/geometry.js';
import { ATTACK, DOWN, INTERACT, LEFT, RIGHT, UP } from '../src/sim/input.js';
import type { Cell, FloorId, LoadedDoor } from '../src/sim/level.js';
import { boxOf, EnemyState, type SimEntity } from '../src/sim/enemy.js';
import { Facing, PlayerState } from '../src/sim/player.js';
import { PropState, type SimProp } from '../src/sim/prop.js';
import { TileClass, tileAt } from '../src/sim/room.js';
import { Sim } from '../src/sim/sim.js';
import {
  axisInput,
  boltSoon,
  deadlySoon,
  encodeMacro,
  findPath,
  tilesOverlapped,
  verticalInput,
  type MacroMarker,
} from './pathing.js';
import { loadFloors, stateLine } from './run-replay.js';

/**
 * How far ahead the walker checks a tile for danger. A tile takes ~13 ticks to walk into and
 * another ~13 to walk out of, so a window that opens inside 26 ticks would still catch the
 * player standing there; 32 covers the crossing with room to spare, and every deadly window
 * in the game leaves at least 72 safe ticks to fit it in.
 */
const LOOKAHEAD = 32;
/** Bolts are quicker and rarer: looking too far ahead would freeze the walker in a lane. */
const BOLT_LOOKAHEAD = 20;
/** Ticks a single step may take before the route is declared stuck. */
const STEP_BUDGET = 1200;
/** One swing, tip to tail (01 §4.1). */
const SWING_TICKS = 14;

const DIR_BITS: Readonly<Record<string, number>> = { U: UP, D: DOWN, L: LEFT, R: RIGHT };
const DIR_FACING: Readonly<Record<string, Facing>> = {
  U: Facing.U,
  D: Facing.D,
  L: Facing.L,
  R: Facing.R,
};
const DIR_STEP: Readonly<Record<string, Cell>> = {
  U: [0, -1],
  D: [0, 1],
  L: [-1, 0],
  R: [1, 0],
};

export class RouteError extends Error {}

// ---------------------------------------------------------------------------
// The route file
// ---------------------------------------------------------------------------

export interface RouteStep {
  line: number;
  head: string;
  args: string[];
}

export interface Route {
  name: string;
  floor: FloorId;
  room?: string;
  at?: Cell;
  start: { hp: number; treasure: number; deaths: number };
  steps: RouteStep[];
}

export function parseRoute(text: string, name: string): Route {
  let floor: FloorId | null = null;
  let room: string | undefined;
  let at: Cell | undefined;
  const start = { hp: 6, treasure: 0, deaths: 0 };
  const steps: RouteStep[] = [];

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = index + 1;
    // `say` keeps its text verbatim, comment marker and all; every other step is stripped.
    const stripped = rawLine.trim().startsWith('say ')
      ? rawLine.trim()
      : rawLine.split('#')[0]!.trim();
    if (stripped === '') continue;

    const tokens = stripped.split(/\s+/);
    const head = tokens[0]!;
    const args = tokens.slice(1);

    if (head === 'floor') {
      const id = args[0];
      if (!id || !/^f[1-4]$/.test(id)) throw new RouteError(`${name}:${line}: floor needs f1..f4`);
      floor = id as FloorId;
      continue;
    }
    if (head === 'room') {
      if (!args[0]) throw new RouteError(`${name}:${line}: room needs an id`);
      room = args[0];
      continue;
    }
    if (head === 'at') {
      at = parseCell(args[0], `${name}:${line}`);
      continue;
    }
    if (head === 'start') {
      for (const token of args) {
        const [key, raw] = token.split('=');
        if (!key || raw === undefined || !(key in start)) {
          throw new RouteError(`${name}:${line}: start takes hp, treasure and deaths`);
        }
        const value = Number(raw);
        if (!Number.isInteger(value)) throw new RouteError(`${name}:${line}: ${key} needs an int`);
        Object.assign(start, { [key]: value });
      }
      continue;
    }

    steps.push({ line, head, args });
  }

  if (!floor) throw new RouteError(`${name}: no "floor f1".."f4" header`);
  return {
    name,
    floor,
    ...(room === undefined ? {} : { room }),
    ...(at === undefined ? {} : { at }),
    start,
    steps,
  };
}

function parseCell(token: string | undefined, where: string): Cell {
  const match = /^(\d+),(\d+)$/.exec(token ?? '');
  if (!match) throw new RouteError(`${where}: expected a col,row cell, got "${token ?? ''}"`);
  return [Number(match[1]), Number(match[2])];
}

// ---------------------------------------------------------------------------
// The autopilot
// ---------------------------------------------------------------------------

export class Pilot {
  readonly inputs: number[] = [];
  readonly markers: MacroMarker[] = [];
  private verbose: boolean;

  constructor(
    readonly sim: Sim,
    options: { verbose?: boolean } = {},
  ) {
    this.verbose = options.verbose ?? false;
  }

  // --- the tape -------------------------------------------------------------

  press(mask: number): void {
    const before = this.sim.player.hp;
    this.sim.tick(mask);
    this.inputs.push(mask);
    // Every heart lost is worth seeing while authoring: it says which tile, at which tick.
    if (this.sim.player.hp < before && this.verbose) {
      console.log(
        `    ouch t=${this.tick} ${this.sim.roomId} tile=${this.tile().join(',')} ` +
          `hp=${before}->${this.sim.player.hp} roomTimer=${this.sim.roomTimer}`,
      );
    }
  }

  get tick(): number {
    return this.inputs.length;
  }

  private get lastMask(): number {
    return this.inputs[this.inputs.length - 1] ?? 0;
  }

  mark(text: string): void {
    this.markers.push({ tick: this.tick, text });
  }

  // --- what the pilot can see ----------------------------------------------

  private centre(): { x: number; y: number } {
    return rectCentre(boxRect(PLAYER_BOX, this.sim.player));
  }

  tile(): Cell {
    const c = this.centre();
    return [Math.floor(c.x / TILE_SUBPX), Math.floor(c.y / TILE_SUBPX)];
  }

  /** Tiles a trap can make deadly, which the walker routes around when it can. */
  private trapCell = (col: number, row: number): boolean =>
    this.sim.traps.some((t) => t.def.deadly && t.def.deadly[0] === col && t.def.deadly[1] === row);

  private unsafe(cell: Cell): boolean {
    const { sim } = this;
    return (
      deadlySoon(sim.traps, sim.roomTimer, cell, LOOKAHEAD) ||
      boltSoon(sim.room, sim.bolts, sim.traps, sim.roomTimer, cell, BOLT_LOOKAHEAD)
    );
  }

  /** The tiles the player's box is touching right now. */
  private touching(): Cell[] {
    const box = boxRect(PLAYER_BOX, this.sim.player);
    return tilesOverlapped(box.l, box.t, box.r - box.l, box.b - box.t);
  }

  /**
   * Walking a lane leaves the box up to a tick's travel off centre, which is enough to
   * overhang the next lane by a few pixels — and a few pixels inside a spike is a whole
   * heart. When the overhang is into a tile that is about to arm, this returns the press
   * that squares the player back up, away from it. Zero when there is nothing to flee, or
   * when the tile underfoot is itself the danger and the route has to walk out of it.
   */
  private escapeMask(here: Cell): number {
    for (const cell of this.touching()) {
      if (cell[0] === here[0] && cell[1] === here[1]) continue;
      if (!this.unsafe(cell)) continue;
      if (cell[1] > here[1]) return UP;
      if (cell[1] < here[1]) return DOWN;
      return cell[0] > here[0] ? LEFT : RIGHT;
    }
    return 0;
  }

  /**
   * Whether pressing `mask` would put part of the player into a tile that is about to hurt.
   * The box is checked whole, not just the tile the walk is aimed at.
   */
  private wouldEnterDanger(mask: number): boolean {
    const box = boxRect(PLAYER_BOX, this.sim.player);
    const dx = (mask & RIGHT) !== 0 ? WALK_SPEED : (mask & LEFT) !== 0 ? -WALK_SPEED : 0;
    const dy = (mask & DOWN) !== 0 ? WALK_SPEED : (mask & UP) !== 0 ? -WALK_SPEED : 0;

    if (this.touching().some((cell) => this.unsafe(cell))) return false; // underfoot: go
    const after = tilesOverlapped(box.l + dx, box.t + dy, box.r - box.l, box.b - box.t);
    return after.some((cell) => this.unsafe(cell));
  }

  private live(): SimEntity[] {
    return this.sim.entities.filter(
      (e) => e.state !== EnemyState.DYING && e.state !== EnemyState.SPAWNING,
    );
  }

  private stuck(step: RouteStep, why: string): never {
    throw new RouteError(
      `${step.head} ${step.args.join(' ')} (route line ${step.line}): ${why}\n  ${stateLine(this.sim)} tile=${this.tile().join(',')}`,
    );
  }

  log(step: RouteStep): void {
    if (!this.verbose) return;
    console.log(
      `  t=${String(this.tick).padStart(6)} ${step.head} ${step.args.join(' ')} -> ${stateLine(this.sim).trim()}`,
    );
  }

  // --- steps ----------------------------------------------------------------

  /** Ride out a transition, a respawn or a descent, where input is ignored anyway. */
  private settle(): void {
    while (this.sim.script !== null) this.press(0);
  }

  /**
   * Walk to a tile. Re-plans every tick — rooms change under the player as crates slide and
   * doors open — and holds position rather than stepping into a tile a trap is about to claim.
   */
  goto(step: RouteStep, target: Cell): void {
    const startRoom = this.sim.roomId;
    for (let budget = STEP_BUDGET; budget > 0; budget--) {
      this.settle();
      // Walking into a doorway ends the walk: the room the target belonged to is gone.
      if (this.sim.roomId !== startRoom) return;
      const here = this.tile();
      const offX = axisInput(target[0] * TILE_SUBPX - this.sim.player.x, 1, 1);
      const offY = verticalInput(target[1] * TILE_SUBPX - this.sim.player.y, 1, 1);
      if (here[0] === target[0] && here[1] === target[1] && offX === 0 && offY === 0) return;

      const path = findPath(this.sim.room, here, target, { avoid: this.trapCell });
      if (!path) this.stuck(step, `no path to ${target.join(',')}`);
      const next = path[0] ?? target;

      // Align, then step — never both at once. A diagonal step spreads the box over four
      // tiles, and the two it only clips at the corner are exactly the ones a spike row is
      // waiting in; worse, a box left straddling two columns catches on the prop in the
      // column it is only overhanging. Squaring up on the perpendicular axis first keeps the
      // box inside one lane for the whole crossing.
      const alongX = next[0] !== here[0];
      const dx = axisInput(next[0] * TILE_SUBPX - this.sim.player.x, LEFT, RIGHT);
      const dy = verticalInput(next[1] * TILE_SUBPX - this.sim.player.y, UP, DOWN);
      const square = alongX ? dy : dx;
      const mask = square !== 0 ? square : alongX ? dx : dy;

      // Danger, in three cases: the box is already clipping a tile that is about to hurt
      // (square up away from it), the next step would put it in one (wait), or the tile
      // underfoot is the one arming (walk on and take the path out).
      const escape = this.escapeMask(here);
      if (escape !== 0) {
        this.press(escape);
        continue;
      }
      this.press(mask !== 0 && this.wouldEnterDanger(mask) ? 0 : mask);
    }
    this.stuck(step, `did not reach ${target.join(',')}`);
  }

  /** Turn on the spot. Used beside solid props, where the press cannot move the player. */
  face(step: RouteStep, dir: string): void {
    const want = DIR_FACING[dir];
    if (want === undefined) this.stuck(step, `"${dir}" is not one of U D L R`);
    for (let budget = 8; budget > 0; budget--) {
      if (this.sim.player.facing === want && this.sim.player.state === PlayerState.NORMAL) return;
      this.press(DIR_BITS[dir]!);
    }
    this.stuck(step, `could not turn to face ${dir}`);
  }

  /** INTERACT is edge-triggered (01 §4.3), so the tape must show a release first. */
  interact(): void {
    if ((this.lastMask & INTERACT) !== 0) this.press(0);
    this.press(INTERACT);
    this.press(0);
  }

  attack(count: number): void {
    for (let i = 0; i < count; i++) {
      if ((this.lastMask & ATTACK) !== 0) this.press(0);
      this.press(ATTACK);
      for (let t = 1; t < SWING_TICKS; t++) this.press(0);
    }
  }

  wait(ticks: number): void {
    for (let t = 0; t < ticks; t++) this.press(0);
  }

  /**
   * Fight until nothing in the room is a threat — which in a wave room means through every
   * wave and its telegraphs (02 §2.3), since the seal only lifts when all of them are done.
   */
  clear(step: RouteStep, maxTicks: number): void {
    for (let budget = maxTicks; budget > 0; budget--) {
      this.settle();
      const live = this.live();
      const threatened =
        this.sim.entities.length > 0 ||
        this.sim.telegraphs.length > 0 ||
        this.sim.pendingWave >= 0 ||
        this.sim.waveGap >= 0;
      if (!threatened) return;

      if (live.length === 0 || this.sim.player.state !== PlayerState.NORMAL) {
        this.press(0);
        continue;
      }
      this.press(this.combatInput(live));
    }
    this.stuck(step, 'the room would not clear');
  }

  /** Close on the nearest enemy, turn to it, and swing when the blade would reach it. */
  private combatInput(live: SimEntity[]): number {
    const me = this.centre();
    let target = live[0]!;
    let best = Infinity;
    for (const entity of live) {
      const box = boxOf(entity.kind);
      const c = rectCentre(boxRect(box, entity));
      const d = Math.abs(c.x - me.x) + Math.abs(c.y - me.y);
      if (d < best) {
        best = d;
        target = entity;
      }
    }

    const box = boxRect(boxOf(target.kind), target);
    const c = rectCentre(box);
    const dx = c.x - me.x;
    const dy = c.y - me.y;
    const dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'R' : 'L') : dy >= 0 ? 'D' : 'U';

    // Would a swing from here, facing that way, connect? `swordRect` is pure in position and
    // facing, so the answer is exact without starting the swing.
    const facing = DIR_FACING[dir]!;
    const blade = bladeRect(this.sim.player.x, this.sim.player.y, facing);
    if (rectsOverlap(blade, box)) {
      if (this.sim.player.facing !== facing) return DIR_BITS[dir]!;
      return (this.lastMask & ATTACK) !== 0 ? 0 : ATTACK;
    }

    return axisInput(dx, LEFT, RIGHT) | axisInput(dy, UP, DOWN) || DIR_BITS[dir]!;
  }

  /** Hold into a crate until it has been shoved `count` tiles (02 §4.2: 6 ticks, then 12). */
  push(step: RouteStep, dir: string, count: number): void {
    const bit = DIR_BITS[dir];
    if (bit === undefined) this.stuck(step, `"${dir}" is not one of U D L R`);
    const delta = DIR_STEP[dir]!;

    for (let moved = 0; moved < count; moved++) {
      const here = this.tile();
      const at: Cell = [here[0] + delta[0], here[1] + delta[1]];
      const crate = this.propAt(at);
      if (!crate) this.stuck(step, `no crate at ${at.join(',')} to push`);

      for (let budget = 200; budget > 0; budget--) {
        this.press(bit);
        const gone = !this.sim.props.includes(crate);
        if (gone || crate.at[0] !== at[0] || crate.at[1] !== at[1]) break;
        if (budget === 1) this.stuck(step, `the crate at ${at.join(',')} would not move`);
      }
      // Follow it into the vacated tile so the next push starts flush against it.
      if (moved + 1 < count) this.goto(step, at);
    }
  }

  /**
   * Cut a destructible crate down and pocket what it held. The sword hits crates as well as
   * enemies (01 §4.2), and the drop appears on the crate's own tile (02 §4.2).
   */
  breakProp(step: RouteStep, cell: Cell): void {
    const prop = this.propAt(cell);
    if (prop) {
      const side = this.approachSide(step, cell);
      this.goto(step, side.from);
      this.face(step, side.dir);

      for (let swings = 6; swings > 0; swings--) {
        this.attack(1);
        while (this.sim.props.includes(prop) && prop.state === PropState.DESTROYING) this.press(0);
        if (!this.sim.props.includes(prop)) break;
        if (swings === 1) this.stuck(step, `the crate at ${cell.join(',')} would not break`);
      }
    }
    if (this.sim.pickups.some((p) => p.at[0] === cell[0] && p.at[1] === cell[1])) {
      this.goto(step, cell);
    }
  }

  private propAt(cell: Cell): SimProp | undefined {
    return this.sim.props.find((p) => p.at[0] === cell[0] && p.at[1] === cell[1]);
  }

  /** Stand beside a chest or torch, face it, and press INTERACT until it responds. */
  useProp(step: RouteStep, cell: Cell, done: (prop: SimProp) => boolean): void {
    const prop = this.propAt(cell);
    if (!prop) this.stuck(step, `no prop at ${cell.join(',')}`);
    if (done(prop)) return;

    const side = this.approachSide(step, cell);
    this.goto(step, side.from);
    this.face(step, side.dir);
    this.interact();

    for (let budget = 120; budget > 0; budget--) {
      if (done(prop)) return;
      this.press(0);
    }
    this.stuck(step, `the prop at ${cell.join(',')} did not respond`);
  }

  /** The reachable tile to stand on to use a prop, and which way to look from it. */
  private approachSide(step: RouteStep, cell: Cell): { from: Cell; dir: string } {
    const here = this.tile();
    const options: { from: Cell; dir: string }[] = [
      { from: [cell[0], cell[1] + 1], dir: 'U' },
      { from: [cell[0] - 1, cell[1]], dir: 'R' },
      { from: [cell[0] + 1, cell[1]], dir: 'L' },
      { from: [cell[0], cell[1] - 1], dir: 'D' },
    ];
    for (const option of options) {
      if (findPath(this.sim.room, here, option.from)) return option;
    }
    return this.stuck(step, `nothing beside ${cell.join(',')} can be stood on`);
  }

  /** Walk through a door of this room, unlocking it on the way in if it is still shut. */
  door(step: RouteStep, id: string): void {
    const door = this.sim.floor.doors.find((d) => d.id === id);
    if (!door) this.stuck(step, `floor ${this.sim.floor.id} has no door "${id}"`);
    const cells = endIn(door, this.sim.roomId);
    if (!cells) this.stuck(step, `door ${id} does not open into ${this.sim.roomId}`);

    const from = this.sim.roomId;
    const target = cells[0]!;
    const inward = inwardOf(this.sim.room, target);
    const approach: Cell = [target[0] + inward[0], target[1] + inward[1]];

    this.goto(step, approach);

    // A normal door opens as the player nears it; a locked one wants to be walked into with
    // the key in hand (01 §8.1). Both are "press toward it until the way is clear".
    const towards = stepDir(inward);
    for (
      let budget = 200;
      tileAt(this.sim.room, target[0], target[1]) !== TileClass.DOOR_OPEN;
      budget--
    ) {
      if (budget <= 0) this.stuck(step, `door ${id} would not open`);
      this.press(DIR_BITS[towards]!);
    }

    this.goto(step, target);
    for (let budget = 120; this.sim.roomId === from; budget--) {
      if (budget <= 0) this.stuck(step, `walked into door ${id} but stayed in ${from}`);
      this.press(0);
    }
    this.settle();
  }

  /** Hold UP under the `V` until the floor ends, then ride out the descent (01 §8.4). */
  ladder(step: RouteStep): void {
    const ladder = this.sim.roomDef.ladder;
    if (!ladder) this.stuck(step, `${this.sim.roomId} has no ladder`);
    const floorIndex = this.sim.floorIndex;

    this.goto(step, [ladder[0], ladder[1] + 1]);
    for (let budget = 60; !this.sim.floorComplete; budget--) {
      if (budget <= 0) this.stuck(step, 'the ladder would not take');
      this.press(UP);
    }
    for (let budget = 200; this.sim.floorIndex === floorIndex && !this.sim.victory; budget--) {
      if (budget <= 0) this.stuck(step, 'the descent never finished');
      this.press(0);
    }
    this.settle();
  }

  run(route: Route): void {
    for (const step of route.steps) {
      switch (step.head) {
        case 'goto':
          this.goto(step, parseCell(step.args[0], `${route.name}:${step.line}`));
          break;
        case 'collect':
          for (const token of step.args) {
            this.goto(step, parseCell(token, `${route.name}:${step.line}`));
          }
          break;
        case 'face':
          this.face(step, step.args[0] ?? '');
          break;
        case 'interact':
          this.interact();
          break;
        case 'attack':
          this.attack(count(step, 1));
          break;
        case 'wait':
          this.wait(count(step, 30));
          break;
        case 'clear':
          this.clear(step, count(step, 3000));
          break;
        case 'push':
          this.push(step, step.args[0] ?? '', Number(step.args[1] ?? 1));
          break;
        case 'break':
          this.breakProp(step, parseCell(step.args[0], `${route.name}:${step.line}`));
          break;
        case 'open':
          this.useProp(
            step,
            parseCell(step.args[0], `${route.name}:${step.line}`),
            (p) => p.state === PropState.OPEN,
          );
          break;
        case 'light':
          this.useProp(
            step,
            parseCell(step.args[0], `${route.name}:${step.line}`),
            (p) => p.state === PropState.LIT,
          );
          break;
        case 'door':
          this.door(step, step.args[0] ?? '');
          break;
        case 'ladder':
          this.ladder(step);
          break;
        case 'assert':
          this.mark(`assert ${step.args.join(' ')}`);
          break;
        case 'say':
          this.mark(`# ${step.args.join(' ')}`);
          break;
        default:
          throw new RouteError(`${route.name}:${step.line}: unknown step "${step.head}"`);
      }
      this.log(step);
    }
  }
}

const count = (step: RouteStep, fallback: number): number =>
  step.args[0] === undefined ? fallback : Number(step.args[0]);

/** `swordRect` without a `Player`: the sprite cell shifted 14 px toward the facing. */
function bladeRect(x: number, y: number, facing: Facing): ReturnType<typeof boxRect> {
  const reach = 14 * 16;
  const dx = facing === Facing.L ? -reach : facing === Facing.R ? reach : 0;
  const dy = facing === Facing.U ? -reach : facing === Facing.D ? reach : 0;
  return { l: x + dx, t: y + dy, r: x + dx + TILE_SUBPX, b: y + dy + TILE_SUBPX };
}

function endIn(door: LoadedDoor, roomId: string): Cell[] | null {
  if (door.a.room === roomId) return door.a.cells;
  if (door.b.room === roomId) return door.b.cells;
  return null;
}

/** Which way the room interior lies from a door cell sitting in its perimeter. */
function inwardOf(room: { w: number; h: number }, cell: Cell): Cell {
  if (cell[1] === 0) return [0, 1];
  if (cell[1] === room.h - 1) return [0, -1];
  if (cell[0] === 0) return [1, 0];
  return [-1, 0];
}

const stepDir = (inward: Cell): string =>
  inward[0] === 1 ? 'L' : inward[0] === -1 ? 'R' : inward[1] === 1 ? 'U' : 'D';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function macroText(routes: Route[], pilot: Pilot): string {
  const first = routes[0]!;
  const sources = routes.map((r) => basename(r.name)).join(', ');
  const header = [
    `# Generated by tools/route.ts from ${sources} — edit the route, not this file.`,
    '#',
    `# ${pilot.inputs.length} ticks. Recompile with npm run macro:compile after regenerating.`,
    '',
    `floor ${first.floor}`,
    ...(first.room === undefined ? [] : [`room ${first.room}`]),
    ...(first.at === undefined ? [] : [`at ${first.at.join(',')}`]),
    `start hp=${first.start.hp} treasure=${first.start.treasure} deaths=${first.start.deaths}`,
    '',
  ];
  return `${[...header, ...encodeMacro(pilot.inputs, pilot.markers)].join('\n')}\n`;
}

function main(): void {
  const args = process.argv.slice(2);
  const chain = args.includes('--chain');
  const quiet = args.includes('--quiet');
  const outIndex = args.indexOf('-o');
  const out = outIndex >= 0 ? args[outIndex + 1] : undefined;
  const paths = args.filter((a, i) => !a.startsWith('-') && !(outIndex >= 0 && i === outIndex + 1));

  if (paths.length === 0) {
    console.error('usage: tsx tools/route.ts [--chain] [-o out.macro] <route>...');
    process.exit(1);
  }

  const routes = paths.map((path) => parseRoute(readFileSync(path, 'utf8'), path));
  const floors = loadFloors();

  if (!chain) {
    for (const route of routes) {
      const sim = seed(route, floors);
      const pilot = new Pilot(sim, { verbose: !quiet });
      console.log(`route ${route.name}: ${route.floor} from ${sim.roomId}`);
      pilot.run(route);
      const target = out ?? join(dirname(route.name), `${basename(route.name, '.route')}.macro`);
      writeFileSync(target, macroText([route], pilot), 'utf8');
      console.log(`  wrote ${target} — ${pilot.inputs.length} ticks, ${stateLine(sim).trim()}`);
    }
    return;
  }

  const first = routes[0]!;
  const sim = seed(first, floors);
  const pilot = new Pilot(sim, { verbose: !quiet });
  for (const route of routes) {
    if (sim.floor.id !== route.floor) {
      throw new RouteError(
        `${route.name}: expects ${route.floor} but the chained run is on ${sim.floor.id}`,
      );
    }
    console.log(
      `route ${route.name}: entering ${route.floor} at t=${pilot.tick} — ` +
        `hp=${sim.player.hp} treasure=${sim.treasure} deaths=${sim.deaths}`,
    );
    pilot.run(route);
  }

  const target = out ?? 'tests/replay/fullgame.macro';
  writeFileSync(target, macroText(routes, pilot), 'utf8');
  console.log(`wrote ${target} — ${pilot.inputs.length} ticks, ${stateLine(sim).trim()}`);
}

function seed(route: Route, floors: ReturnType<typeof loadFloors>): Sim {
  const floorIndex = ['f1', 'f2', 'f3', 'f4'].indexOf(route.floor);
  const sim = new Sim(floors, {
    floorIndex,
    hp: route.start.hp,
    ...(route.room === undefined ? {} : { roomId: route.room }),
    ...(route.at === undefined
      ? {}
      : { start: { x: route.at[0] * TILE_SUBPX, y: route.at[1] * TILE_SUBPX } }),
  });
  sim.inventory.treasure = route.start.treasure;
  sim.deaths = route.start.deaths;
  return sim;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main();
}
