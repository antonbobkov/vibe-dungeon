/**
 * Level validation — spec/03-levels.md §1.7, the rules behind `npm run lint:levels`.
 *
 * `parseFloor` already rejects anything that cannot be loaded (unknown symbols, tables that
 * disagree with the map). This module adds the rules about whether a loadable floor is a
 * *playable* one: closed perimeters, symbols in legal positions, doors that agree with their
 * maps, and keys that can actually be reached before their locks.
 *
 * The art-facing checks (decor ids) and the cross-floor §6 totals live in
 * `tools/level-lint.ts`, which may read the asset manifest; sim code may not.
 */

import { cellKey, otherEnd, type Cell, type LoadedFloor, type LoadedRoom } from './level.js';
import { boxCentre } from './collision.js';
import {
  PLAYER_BOX,
  ROOM_MAX_H,
  ROOM_MAX_W,
  ROOM_MIN_H,
  ROOM_MIN_W,
  TILE_SUBPX,
} from './constants.js';
import { LEGEND, TileClass, isWallCell, tileAt } from './room.js';

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

/** The floor cell just inside a door cell, from the room that owns it. */
function insideOf(room: LoadedRoom, cell: Cell, wall: string): Cell {
  switch (wall) {
    case 'top':
      return [cell[0], 1];
    case 'bottom':
      return [cell[0], room.h - 2];
    case 'left':
      return [1, cell[1]];
    default:
      return [room.w - 2, cell[1]];
  }
}

/** Every 03 §1.7 rule that does not need the art manifest. */
export function validateFloor(floor: LoadedFloor): string[] {
  const problems: string[] = [];
  const say = (msg: string): void => {
    problems.push(`${floor.id}: ${msg}`);
  };
  const sayRoom = (room: LoadedRoom, msg: string): void => {
    problems.push(`${floor.id}/${room.id}: ${msg}`);
  };

  checkRooms(floor, sayRoom);
  checkDoors(floor, say, sayRoom);
  checkFloorMarkers(floor, say);
  checkWiring(floor, say);
  checkKeys(floor, say);

  return problems;
}

type RoomSay = (room: LoadedRoom, msg: string) => void;

function checkRooms(floor: LoadedFloor, sayRoom: RoomSay): void {
  for (const room of floor.rooms) {
    // Size bounds (00-overview, 03 §1.1).
    if (room.w < ROOM_MIN_W || room.h < ROOM_MIN_H || room.w > ROOM_MAX_W || room.h > ROOM_MAX_H) {
      sayRoom(
        room,
        `is ${room.w}×${room.h}, outside the ${ROOM_MIN_W}×${ROOM_MIN_H}..${ROOM_MAX_W}×${ROOM_MAX_H} bounds`,
      );
    }

    // Perimeter closure: every border cell is wall or door.
    for (let row = 0; row < room.h; row++) {
      for (let col = 0; col < room.w; col++) {
        if (!isWallCell(room, col, row)) continue;
        const cls = tileAt(room.base, col, row);
        if (
          cls !== TileClass.WALL &&
          cls !== TileClass.DOOR_CLOSED &&
          cls !== TileClass.DOOR_OPEN
        ) {
          sayRoom(
            room,
            `perimeter hole at (${col},${row}): "${room.spec.map[row]![col]}" is not a wall or door cell`,
          );
        }
      }
    }

    // Symbol legality per position (03 §1.2's "Placed in" column, 02 §3.2–§3.3).
    for (const s of room.base.symbols) {
      const def = LEGEND[s.ch]!;
      const onWall = isWallCell(room, s.col, s.row);
      if (def.where === 'wall' && !onWall) {
        sayRoom(room, `"${s.ch}" at (${s.col},${s.row}) belongs in a wall cell`);
      }
      if (def.where === 'floor' && onWall) {
        sayRoom(room, `"${s.ch}" at (${s.col},${s.row}) belongs inside the room, not in a wall`);
      }
      if ((s.ch === 'a' || s.ch === 'f' || s.ch === 'V') && s.row !== 0) {
        sayRoom(room, `"${s.ch}" at (${s.col},${s.row}) must sit in the top wall row`);
      }
      if (s.ch === '>' && s.col !== 0) {
        sayRoom(room, `">" at (${s.col},${s.row}) must sit in the leftmost column`);
      }
      if (s.ch === '<' && s.col !== room.w - 1) {
        sayRoom(room, `"<" at (${s.col},${s.row}) must sit in the rightmost column`);
      }
    }

    // Traps must have somewhere legal to fire (02 §3).
    for (const trap of room.traps) {
      if (!trap.deadly) continue;
      const [col, row] = trap.deadly;
      if (tileAt(room.base, col, row) === TileClass.WALL) {
        sayRoom(room, `${trap.kind} at (${trap.at}) fires into the wall at (${col},${row})`);
      }
    }

    // Wave spawns must be floor inside the room (02 §2.3).
    for (const [i, wave] of room.waves.entries()) {
      for (const e of wave) {
        const [col, row] = e.at;
        if (tileAt(room.base, col, row) !== TileClass.FLOOR) {
          sayRoom(room, `wave ${i + 1} spawns ${e.type} at (${col},${row}), which is not floor`);
        }
      }
    }
  }
}

function checkDoors(floor: LoadedFloor, say: (m: string) => void, sayRoom: RoomSay): void {
  for (const door of floor.doors) {
    for (const end of [door.a, door.b]) {
      const room = floor.rooms[end.roomIndex]!;
      const sideWall = end.wall === 'left' || end.wall === 'right';

      // 01 §8.1: locked and puzzle doors only exist in top/bottom walls; gaps only in side
      // walls, because no side-wall door art exists (00-overview asset gaps).
      if (door.type === 'gap' && !sideWall) {
        sayRoom(room, `gap ${door.id} is in the ${end.wall} wall; gaps are side-wall only`);
      }
      if (door.type !== 'gap' && sideWall) {
        sayRoom(
          room,
          `${door.type} door ${door.id} is in the ${end.wall} wall; doors are top/bottom only`,
        );
      }

      const want = door.type === 'silver' ? 1 : 2;
      if (end.cells.length !== want) {
        sayRoom(
          room,
          `${door.type} door ${door.id} has ${end.cells.length} cells here, expected ${want}`,
        );
        continue;
      }
      if (end.cells.length === 2) {
        const [[c0, r0], [c1, r1]] = end.cells as [Cell, Cell];
        const adjacent = sideWall
          ? c0 === c1 && Math.abs(r0 - r1) === 1
          : r0 === r1 && Math.abs(c0 - c1) === 1;
        if (!adjacent) {
          sayRoom(room, `${door.id}'s two cells here are not adjacent`);
        }
      }
    }

    if (door.a.room === door.b.room) {
      say(`door ${door.id} connects ${door.a.room} to itself`);
    }
  }

  // Combat seals need doors they can actually close (01 §8.3).
  for (const room of floor.rooms) {
    if (!room.combatSeal) continue;
    const ends = floor.doors.filter((d) => d.a.room === room.id || d.b.room === room.id);
    if (ends.some((d) => d.type === 'gap')) {
      sayRoom(room, 'is a combat_seal room but has a side gap, which cannot seal');
    }
    if (ends.length === 0) {
      sayRoom(room, 'is a combat_seal room with no door to seal');
    }
  }
}

function checkFloorMarkers(floor: LoadedFloor, say: (m: string) => void): void {
  const spawns = floor.rooms.filter((r) => r.spawn !== null);
  if (spawns.length !== 1) {
    say(`has ${spawns.length} "@" spawns, expected exactly 1`);
  } else if (spawns[0]!.id !== floor.rooms[0]!.id) {
    say(
      `spawns in ${spawns[0]!.id}; "@" belongs in the floor's first room (${floor.rooms[0]!.id})`,
    );
  }

  const ladders = floor.rooms.filter((r) => r.ladder !== null);
  const wantLadder = floor.id === 'f4' ? 0 : 1;
  if (ladders.length !== wantLadder) {
    say(
      floor.id === 'f4'
        ? `has ${ladders.length} descent ladders; floor 4 ends at the vault and must have none`
        : `has ${ladders.length} descent ladders, expected exactly 1`,
    );
  }
}

function checkWiring(floor: LoadedFloor, say: (m: string) => void): void {
  const groups = new Set(floor.rooms.flatMap((r) => r.torchGroups.map((g) => g.id)));

  for (const wire of floor.wiring) {
    const t = wire.trigger;
    if (t.kind === 'torch_group' && !groups.has(t.group)) {
      say(`wiring triggers on unknown torch group "${t.group}"`);
    }
    if ((t.kind === 'room_clear' || t.kind === 'chest_open') && !floor.roomIndex.has(t.room)) {
      say(`wiring triggers on unknown room "${t.room}"`);
    }
    if (t.kind === 'chest_open') {
      const room = floor.rooms[floor.roomIndex.get(t.room) ?? -1];
      const has = room?.props.some(
        (p) =>
          (p.kind === 'chest' || p.kind === 'mini_chest') &&
          p.at[0] === t.at[0] &&
          p.at[1] === t.at[1],
      );
      if (room && !has) say(`wiring expects a chest at ${t.room} (${t.at}), which has none`);
    }
    if (t.kind === 'room_clear') {
      const room = floor.rooms[floor.roomIndex.get(t.room) ?? -1];
      if (room && !room.combatSeal) {
        say(`wiring waits for room_clear(${t.room}), which is not a combat_seal room`);
      }
    }

    for (const effect of wire.effects) {
      if (effect.kind === 'open_door') {
        const door = floor.doors.find((d) => d.id === effect.door);
        if (!door) say(`wiring opens unknown door "${effect.door}"`);
        else if (door.type !== 'puzzle') {
          say(`wiring opens ${effect.door}, which is a ${door.type} door, not a puzzle door`);
        }
      }
      if (effect.kind === 'spawn') {
        const room = floor.rooms[floor.roomIndex.get(effect.room) ?? -1];
        if (!room) say(`wiring spawns into unknown room "${effect.room}"`);
        else if (tileAt(room.base, effect.at[0], effect.at[1]) !== TileClass.FLOOR) {
          say(
            `wiring spawns ${effect.pickup} at ${effect.room} (${effect.at}), which is not floor`,
          );
        }
      }
    }
  }
}

/** Every silver/gold key on the floor, wherever it comes from. */
function keySources(
  floor: LoadedFloor,
  kind: 'silver_key' | 'gold_key',
): { room: string; at: Cell }[] {
  const found: { room: string; at: Cell }[] = [];
  for (const room of floor.rooms) {
    for (const p of room.pickups) if (p.kind === kind) found.push({ room: room.id, at: p.at });
    for (const prop of room.props) {
      if (prop.contents.includes(kind)) found.push({ room: room.id, at: prop.at });
    }
  }
  for (const wire of floor.wiring) {
    for (const e of wire.effects) {
      if (e.kind === 'spawn' && e.pickup === kind) found.push({ room: e.room, at: e.at });
    }
  }
  return found;
}

function checkKeys(floor: LoadedFloor, say: (m: string) => void): void {
  for (const [kind, doorType] of [
    ['silver_key', 'silver'],
    ['gold_key', 'gold'],
  ] as const) {
    const keys = keySources(floor, kind);
    const locks = floor.doors.filter((d) => d.type === doorType);
    if (keys.length !== locks.length) {
      say(
        `has ${keys.length} ${kind === 'silver_key' ? 'silver' : 'gold'} key(s) but ${locks.length} ${doorType} door(s)`,
      );
      continue;
    }
    if (locks.length === 0) continue;

    // Every key must be reachable without going through a lock it is meant to open.
    const reachable = reachableCells(floor, doorType);
    for (const key of keys) {
      if (!touches(reachable, key.room, key.at)) {
        say(`the ${doorType} key in ${key.room} at (${key.at}) is not reachable before its lock`);
      }
    }
  }
}

/** True when the cell itself, or any 4-neighbour of it, was reached (a chest is entered from beside it). */
function touches(reached: Map<string, Set<string>>, room: string, at: Cell): boolean {
  const cells = reached.get(room);
  if (!cells) return false;
  const [col, row] = at;
  return (
    cells.has(cellKey(col, row)) ||
    cells.has(cellKey(col - 1, row)) ||
    cells.has(cellKey(col + 1, row)) ||
    cells.has(cellKey(col, row - 1)) ||
    cells.has(cellKey(col, row + 1))
  );
}

/**
 * Flood the floor from `@`, room to room through every door except those of `blockedType`.
 * Traps are passable (they are floor); pits are passable only where a pushable crate shares
 * the room, since that is the only way across (03 §1.7).
 */
function reachableCells(floor: LoadedFloor, blockedType: string): Map<string, Set<string>> {
  const reached = new Map<string, Set<string>>();
  const start = floor.rooms.find((r) => r.spawn !== null);
  if (!start) return reached;

  const queue: { room: LoadedRoom; cell: Cell }[] = [{ room: start, cell: start.spawn! }];
  // Seeds already queued, so a seed that turns out to be blocked is never re-queued.
  const queued = new Set<string>([`${start.id}:${cellKey(start.spawn![0], start.spawn![1])}`]);

  while (queue.length > 0) {
    const { room, cell } = queue.shift()!;
    let cells = reached.get(room.id);
    if (!cells) {
      cells = new Set();
      reached.set(room.id, cells);
    }

    // Flood this room outward from the seed.
    const canCrossPits = room.props.some((p) => p.kind === 'crate_push');
    const local: Cell[] = [cell];
    while (local.length > 0) {
      const [col, row] = local.pop()!;
      const key = cellKey(col, row);
      if (cells.has(key)) continue;
      if (col < 0 || row < 0 || col >= room.w || row >= room.h) continue;
      const cls = tileAt(room.base, col, row);
      const open =
        cls === TileClass.FLOOR ||
        cls === TileClass.BRIDGED_PIT ||
        cls === TileClass.DECAL ||
        (cls === TileClass.PIT && canCrossPits);
      if (!open) continue;
      cells.add(key);
      local.push([col - 1, row], [col + 1, row], [col, row - 1], [col, row + 1]);
    }

    // Step through any door whose inside cell we reached.
    for (const door of floor.doors) {
      if (door.type === blockedType) continue;
      for (const end of [door.a, door.b]) {
        if (end.room !== room.id) continue;
        const inside = end.cells.map((c) => insideOf(room, c, end.wall));
        if (!inside.some(([c, r]) => cells.has(cellKey(c, r)))) continue;

        const far = otherEnd(door, room.id);
        const target = floor.rooms[far.roomIndex]!;
        const tile = entryTile(entryPlacement(target, far.cells, far.wall));
        const seed = `${target.id}:${cellKey(tile[0], tile[1])}`;
        if (!queued.has(seed)) {
          queued.add(seed);
          queue.push({ room: target, cell: tile });
        }
      }
    }
  }

  return reached;
}
