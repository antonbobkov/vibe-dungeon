/**
 * Level files — spec/05-data-formats.md §1, spec/03-levels.md §1.
 *
 * `loadFloor` turns a floor's JSON into the runtime model the sim walks: one parsed tile grid
 * per room plus typed object lists. Positions always come from the ASCII map; parameters
 * (trap periods, chest contents, crate drops) come from the room's tables, and any
 * disagreement between the two is an error (05 §1's redundancy rule).
 *
 * Rule checking beyond "can this be loaded at all" lives in `level-rules.ts`.
 */

import { boxCentre } from './collision.js';
import { PLAYER_BOX, TILE_SUBPX } from './constants.js';
import { LEGEND, parseRoom, type Room, type SymbolCell } from './room.js';

export type FloorId = 'f1' | 'f2' | 'f3' | 'f4';

export type PickupName =
  'coin' | 'red_small' | 'red_large' | 'blue_small' | 'blue_large' | 'silver_key' | 'gold_key';

export type EnemyType = 'skel_sword' | 'skel_axe' | 'zombie' | 'wisp';

export type TrapKind = 'spike' | 'arrow' | 'flame_down' | 'flame_right' | 'flame_left';

/** Props that carry table parameters (05 §1), plus the two that never do. */
export type PropKind =
  'chest' | 'mini_chest' | 'crate_wood' | 'crate_steel' | 'crate_push' | 'torch';

export type DoorType = 'normal' | 'gap' | 'silver' | 'gold' | 'puzzle';

export type Cell = [number, number];

// ---------------------------------------------------------------------------
// The JSON shapes (05 §1)
// ---------------------------------------------------------------------------

export interface RoomSpec {
  id: string;
  name: string;
  map: string[];
  combatSeal?: boolean;
  enemies?: { marker: string; type: EnemyType; drop?: PickupName }[];
  traps?: {
    at: Cell;
    kind: TrapKind;
    period?: number;
    offset?: number;
    alwaysOn?: boolean;
  }[];
  props?: {
    at: Cell;
    kind: 'chest' | 'mini_chest' | 'crate_wood' | 'crate_steel';
    contents?: PickupName[];
    drop?: PickupName;
  }[];
  torchGroups?: { id: string; members: Cell[]; window?: number }[];
  waves?: { type: EnemyType; at: Cell; drop?: PickupName }[][];
  decor?: { at: Cell; art: string }[];
}

export interface DoorSpec {
  id: string;
  type: DoorType;
  a: { room: string; cells: Cell[] };
  b: { room: string; cells: Cell[] };
}

export interface WireSpec {
  trigger:
    | { kind: 'torch_group'; group: string }
    | { kind: 'room_clear'; room: string }
    | { kind: 'chest_open'; room: string; at: Cell };
  effects: (
    | { kind: 'open_door'; door: string }
    | { kind: 'spawn'; room: string; at: Cell; pickup: PickupName }
    | { kind: 'victory' }
  )[];
}

export interface FloorFile {
  id: FloorId;
  name: string;
  rooms: RoomSpec[];
  doors: DoorSpec[];
  wiring: WireSpec[];
}

// ---------------------------------------------------------------------------
// Symbol tables
// ---------------------------------------------------------------------------

/** Map symbol → pickup, 03 §1.2. */
export const PICKUP_SYMBOLS: Readonly<Record<string, PickupName>> = {
  c: 'coin',
  h: 'red_small',
  H: 'red_large',
  b: 'blue_small',
  B: 'blue_large',
  k: 'silver_key',
  K: 'gold_key',
};

/** Map symbol → trap kind, 02 §3. */
export const TRAP_SYMBOLS: Readonly<Record<string, TrapKind>> = {
  s: 'spike',
  a: 'arrow',
  f: 'flame_down',
  '>': 'flame_right',
  '<': 'flame_left',
};

/** Map symbol → prop kind, 02 §4. */
export const PROP_SYMBOLS: Readonly<Record<string, PropKind>> = {
  M: 'chest',
  m: 'mini_chest',
  x: 'crate_wood',
  X: 'crate_steel',
  p: 'crate_push',
  u: 'torch',
};

/** Default trap periods, 02 §3. */
export const TRAP_DEFAULT_PERIOD: Readonly<Record<TrapKind, number>> = {
  spike: 120,
  arrow: 90,
  flame_down: 150,
  flame_right: 150,
  flame_left: 150,
};

/** Door symbol per type, 03 §1.2. */
export const DOOR_SYMBOL: Readonly<Record<DoorType, string>> = {
  normal: 'D',
  gap: 'D',
  silver: 'L',
  puzzle: 'P',
  gold: 'G',
};

// ---------------------------------------------------------------------------
// The runtime model
// ---------------------------------------------------------------------------

export interface LoadedEnemy {
  marker: string;
  type: EnemyType;
  at: Cell;
  drop: PickupName | null;
}

export interface LoadedTrap {
  at: Cell;
  kind: TrapKind;
  period: number;
  offset: number;
  alwaysOn: boolean;
  /** The tile this trap makes deadly; `null` for the arrow launcher, which fires a bolt. */
  deadly: Cell | null;
}

export interface LoadedPickup {
  at: Cell;
  kind: PickupName;
}

export interface LoadedProp {
  at: Cell;
  kind: PropKind;
  contents: PickupName[];
  drop: PickupName | null;
}

export interface LoadedTorchGroup {
  id: string;
  members: Cell[];
  window: number | null;
}

export interface LoadedRoom {
  id: string;
  name: string;
  spec: RoomSpec;
  /** The tile grid straight from the map: doors closed, nothing persisted applied yet. */
  base: Room;
  w: number;
  h: number;
  combatSeal: boolean;
  spawn: Cell | null;
  /** The `V` cell, if this room holds the descent ladder (01 §8.4). */
  ladder: Cell | null;
  enemies: LoadedEnemy[];
  traps: LoadedTrap[];
  pickups: LoadedPickup[];
  props: LoadedProp[];
  torchGroups: LoadedTorchGroup[];
  waves: { type: EnemyType; at: Cell; drop: PickupName | null }[][];
  decor: { at: Cell; art: string }[];
  /** Which door owns each door cell — filled once the door table is cross-linked. */
  doorCells: Map<string, { doorId: string; type: DoorType }>;
}

export interface LoadedDoorEnd {
  room: string;
  roomIndex: number;
  cells: Cell[];
  /** Which wall the cells sit in, from the destination room's point of view. */
  wall: 'top' | 'bottom' | 'left' | 'right';
}

export interface LoadedDoor {
  id: string;
  type: DoorType;
  a: LoadedDoorEnd;
  b: LoadedDoorEnd;
}

export interface LoadedFloor {
  id: FloorId;
  name: string;
  rooms: LoadedRoom[];
  roomIndex: ReadonlyMap<string, number>;
  doors: LoadedDoor[];
  doorIndex: ReadonlyMap<string, number>;
  wiring: WireSpec[];
}

export class LevelError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('\n'));
    this.name = 'LevelError';
  }
}

export const cellKey = (col: number, row: number): string => `${col},${row}`;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Parse a floor file. Returns the model plus every problem found; `floor` is `null` only when
 * a map could not be parsed at all. Callers that need a usable floor use `loadFloor`.
 */
export function parseFloor(file: FloorFile): { floor: LoadedFloor | null; problems: string[] } {
  const problems: string[] = [];
  const at = (roomId: string, msg: string): void => {
    problems.push(`${file.id}/${roomId}: ${msg}`);
  };

  const rooms: LoadedRoom[] = [];
  const roomIndex = new Map<string, number>();

  for (const spec of file.rooms) {
    if (roomIndex.has(spec.id)) {
      at(spec.id, 'duplicate room id');
      continue;
    }
    let base: Room;
    try {
      base = parseRoom(spec.map);
    } catch (err) {
      at(spec.id, (err as Error).message.replace(/^parseRoom: /, 'bad map: '));
      continue;
    }
    roomIndex.set(spec.id, rooms.length);
    rooms.push(buildRoom(file, spec, base, problems));
  }

  if (rooms.length === 0) {
    problems.push(`${file.id}: has no rooms`);
    return { floor: null, problems };
  }

  const doors = linkDoors(file, rooms, roomIndex, problems);
  const doorIndex = new Map(doors.map((d, i) => [d.id, i]));

  return {
    floor: {
      id: file.id,
      name: file.name,
      rooms,
      roomIndex,
      doors,
      doorIndex,
      wiring: file.wiring,
    },
    problems,
  };
}

/** Load a floor, throwing `LevelError` if anything is wrong with it. */
export function loadFloor(file: FloorFile): LoadedFloor {
  const { floor, problems } = parseFloor(file);
  if (!floor || problems.length > 0) throw new LevelError(problems);
  return floor;
}

function buildRoom(file: FloorFile, spec: RoomSpec, base: Room, problems: string[]): LoadedRoom {
  const at = (msg: string): void => {
    problems.push(`${file.id}/${spec.id}: ${msg}`);
  };
  const byCell = new Map<string, SymbolCell>();
  for (const s of base.symbols) byCell.set(cellKey(s.col, s.row), s);

  const room: LoadedRoom = {
    id: spec.id,
    name: spec.name,
    spec,
    base,
    w: base.w,
    h: base.h,
    combatSeal: spec.combatSeal === true,
    spawn: base.spawn ? [base.spawn.col, base.spawn.row] : null,
    ladder: null,
    enemies: [],
    traps: [],
    pickups: [],
    props: [],
    torchGroups: [],
    waves: [],
    decor: spec.decor ?? [],
    doorCells: new Map(),
  };

  // --- objects that come straight from the map -----------------------------
  for (const s of base.symbols) {
    if (s.ch === 'V') room.ladder = [s.col, s.row];
    if (s.role === 'pickup') {
      room.pickups.push({ at: [s.col, s.row], kind: PICKUP_SYMBOLS[s.ch]! });
    }
  }

  // --- enemies: markers in the map, types in the table ---------------------
  const markerCells = new Map<string, SymbolCell[]>();
  for (const s of base.symbols) {
    if (s.role !== 'enemy') continue;
    const list = markerCells.get(s.ch) ?? [];
    list.push(s);
    markerCells.set(s.ch, list);
  }
  const enemyEntries = spec.enemies ?? [];
  for (const entry of enemyEntries) {
    const cells = markerCells.get(entry.marker);
    if (!cells) {
      at(`enemy table lists marker "${entry.marker}", which the map does not use`);
      continue;
    }
    if (cells.length > 1) {
      at(`marker "${entry.marker}" appears ${cells.length} times; each marker must be unique`);
    }
    const cell = cells[0]!;
    room.enemies.push({
      marker: entry.marker,
      type: entry.type,
      at: [cell.col, cell.row],
      drop: entry.drop ?? null,
    });
  }
  for (const marker of markerCells.keys()) {
    if (!enemyEntries.some((e) => e.marker === marker)) {
      const cell = markerCells.get(marker)![0]!;
      at(`marker "${marker}" at (${cell.col},${cell.row}) has no enemy table entry`);
    }
  }

  // --- traps: symbols in the map, parameters in the table ------------------
  const trapEntries = spec.traps ?? [];
  for (const entry of trapEntries) {
    const [col, row] = entry.at;
    const sym = byCell.get(cellKey(col, row));
    const kindHere = sym ? TRAP_SYMBOLS[sym.ch] : undefined;
    if (kindHere === undefined) {
      at(`trap table entry at (${col},${row}) but the map has no trap there`);
      continue;
    }
    if (kindHere !== entry.kind) {
      at(`trap at (${col},${row}) is "${sym!.ch}" (${kindHere}) but the table says ${entry.kind}`);
      continue;
    }
  }
  for (const s of base.symbols) {
    const kind = TRAP_SYMBOLS[s.ch];
    if (kind === undefined) continue;
    const entry = trapEntries.find((e) => e.at[0] === s.col && e.at[1] === s.row);
    room.traps.push({
      at: [s.col, s.row],
      kind,
      period: entry?.period ?? TRAP_DEFAULT_PERIOD[kind],
      offset: entry?.offset ?? 0,
      alwaysOn: entry?.alwaysOn === true,
      deadly: deadlyCell(kind, s.col, s.row),
    });
  }

  // --- props: symbols in the map, contents/drops in the table --------------
  const propEntries = spec.props ?? [];
  for (const entry of propEntries) {
    const [col, row] = entry.at;
    const sym = byCell.get(cellKey(col, row));
    const kindHere = sym ? PROP_SYMBOLS[sym.ch] : undefined;
    if (kindHere === undefined) {
      at(`prop table entry at (${col},${row}) but the map has no prop there`);
      continue;
    }
    if (kindHere !== entry.kind) {
      at(`prop at (${col},${row}) is "${sym!.ch}" (${kindHere}) but the table says ${entry.kind}`);
    }
  }
  for (const s of base.symbols) {
    const kind = PROP_SYMBOLS[s.ch];
    if (kind === undefined) continue;
    const entry = propEntries.find((e) => e.at[0] === s.col && e.at[1] === s.row);
    if ((kind === 'chest' || kind === 'mini_chest') && !entry?.contents) {
      at(`chest at (${s.col},${s.row}) has no contents in the prop table`);
    }
    room.props.push({
      at: [s.col, s.row],
      kind,
      contents: entry?.contents ?? [],
      drop: entry?.drop ?? null,
    });
  }

  // --- torch groups --------------------------------------------------------
  const grouped = new Set<string>();
  for (const group of spec.torchGroups ?? []) {
    for (const [col, row] of group.members) {
      const sym = byCell.get(cellKey(col, row));
      if (sym?.ch !== 'u') {
        at(`torch group ${group.id} lists (${col},${row}), which holds no "u" torch`);
        continue;
      }
      if (grouped.has(cellKey(col, row))) {
        at(`torch at (${col},${row}) belongs to more than one group`);
      }
      grouped.add(cellKey(col, row));
    }
    room.torchGroups.push({
      id: group.id,
      members: group.members,
      window: group.window ?? null,
    });
  }
  for (const s of base.symbols) {
    if (s.ch === 'u' && !grouped.has(cellKey(s.col, s.row))) {
      at(`puzzle torch at (${s.col},${s.row}) belongs to no torch group`);
    }
  }

  // --- waves ---------------------------------------------------------------
  for (const wave of spec.waves ?? []) {
    room.waves.push(wave.map((e) => ({ type: e.type, at: e.at, drop: e.drop ?? null })));
  }
  if (room.waves.length > 0 && !room.combatSeal) {
    at('has a wave table but is not a combat_seal room (02 §2.3)');
  }

  // --- decor ---------------------------------------------------------------
  for (const d of room.decor) {
    const [col, row] = d.at;
    if (col < 0 || row < 0 || col >= base.w || row >= base.h) {
      at(`decor "${d.art}" at (${col},${row}) is outside the room`);
    }
  }

  return room;
}

/** The tile a trap makes deadly (02 §3). Arrow launchers fire a bolt instead. */
function deadlyCell(kind: TrapKind, col: number, row: number): Cell | null {
  switch (kind) {
    case 'spike':
      return [col, row];
    case 'flame_down':
      return [col, row + 1];
    case 'flame_right':
      return [col + 1, row];
    case 'flame_left':
      return [col - 1, row];
    case 'arrow':
      return null;
  }
}

function wallOf(room: LoadedRoom, cells: Cell[]): LoadedDoorEnd['wall'] | null {
  const [col, row] = cells[0]!;
  if (row === 0) return 'top';
  if (row === room.h - 1) return 'bottom';
  if (col === 0) return 'left';
  if (col === room.w - 1) return 'right';
  return null;
}

function linkDoors(
  file: FloorFile,
  rooms: LoadedRoom[],
  roomIndex: Map<string, number>,
  problems: string[],
): LoadedDoor[] {
  const doors: LoadedDoor[] = [];
  const seen = new Set<string>();

  for (const spec of file.doors) {
    const ends: LoadedDoorEnd[] = [];
    let ok = true;

    for (const end of [spec.a, spec.b]) {
      const idx = roomIndex.get(end.room);
      if (idx === undefined) {
        problems.push(`${file.id}/${spec.id}: endpoint names unknown room "${end.room}"`);
        ok = false;
        continue;
      }
      const room = rooms[idx]!;
      const wall = wallOf(room, end.cells);
      if (wall === null) {
        problems.push(
          `${file.id}/${spec.id}: endpoint in ${end.room} at (${end.cells[0]}) is not in a wall`,
        );
        ok = false;
        continue;
      }
      for (const [col, row] of end.cells) {
        const key = cellKey(col, row);
        const ch = spec.type === 'gap' ? 'D' : DOOR_SYMBOL[spec.type];
        const sym = room.base.symbols.find((s) => s.col === col && s.row === row);
        if (sym?.ch !== ch) {
          problems.push(
            `${file.id}/${spec.id}: endpoint ${end.room} (${col},${row}) should hold "${ch}" but the map has "${sym?.ch ?? '#'}"`,
          );
          ok = false;
          continue;
        }
        const claim = `${end.room}:${key}`;
        if (seen.has(claim)) {
          problems.push(`${file.id}/${spec.id}: cell ${end.room} (${col},${row}) is claimed twice`);
        }
        seen.add(claim);
        room.doorCells.set(key, { doorId: spec.id, type: spec.type });
      }
      ends.push({ room: end.room, roomIndex: idx, cells: end.cells, wall });
    }

    if (ok && ends.length === 2) {
      doors.push({ id: spec.id, type: spec.type, a: ends[0]!, b: ends[1]! });
    }
  }

  // Every door symbol in every map must belong to a declared door.
  for (const room of rooms) {
    for (const s of room.base.symbols) {
      if (LEGEND[s.ch]?.role !== 'door') continue;
      if (!room.doorCells.has(cellKey(s.col, s.row))) {
        problems.push(
          `${file.id}/${room.id}: door cell "${s.ch}" at (${s.col},${s.row}) is not part of any declared door`,
        );
      }
    }
  }

  return doors;
}

/** Where the player stands after coming through a door, and which way they face (01 §8.2). */
export interface EntryPlacement {
  /** Sprite-cell top-left, in subpixels. */
  x: number;
  y: number;
  dir: 'U' | 'D' | 'L' | 'R';
}

/**
 * The floor tile inside the destination room next to its door cells, centred across a
 * two-cell pair: `x` (or `y`) = shared edge midpoint − 8 px. Direction of travel is whatever
 * carries you inward from that wall.
 */
export function entryPlacement(room: LoadedRoom, cells: Cell[], wall: string): EntryPlacement {
  const cols = cells.map((c) => c[0]);
  const rows = cells.map((c) => c[1]);
  const minCol = Math.min(...cols);
  const minRow = Math.min(...rows);
  const pair = cells.length === 2;

  switch (wall) {
    case 'top':
      return {
        x: pair ? (minCol + 1) * TILE_SUBPX - TILE_SUBPX / 2 : minCol * TILE_SUBPX,
        y: 1 * TILE_SUBPX,
        dir: 'D',
      };
    case 'bottom':
      return {
        x: pair ? (minCol + 1) * TILE_SUBPX - TILE_SUBPX / 2 : minCol * TILE_SUBPX,
        y: (room.h - 2) * TILE_SUBPX,
        dir: 'U',
      };
    case 'left':
      return {
        x: 1 * TILE_SUBPX,
        y: pair ? (minRow + 1) * TILE_SUBPX - TILE_SUBPX / 2 : minRow * TILE_SUBPX,
        dir: 'R',
      };
    default:
      return {
        x: (room.w - 2) * TILE_SUBPX,
        y: pair ? (minRow + 1) * TILE_SUBPX - TILE_SUBPX / 2 : minRow * TILE_SUBPX,
        dir: 'L',
      };
  }
}

/** The tile the player's hitbox centre lands on after `entryPlacement`. */
export function entryTile(place: EntryPlacement): Cell {
  const centre = boxCentre(PLAYER_BOX, { x: place.x, y: place.y });
  return [Math.floor(centre.x / TILE_SUBPX), Math.floor(centre.y / TILE_SUBPX)];
}

/** The end of a door you arrive at, given the room you are leaving. */
export function otherEnd(door: LoadedDoor, fromRoom: string): LoadedDoorEnd {
  return door.a.room === fromRoom ? door.b : door.a;
}
