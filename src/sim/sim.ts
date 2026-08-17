/**
 * The simulation — one tick is the ten phases of 01-mechanics §1, in exactly that order.
 *
 * Headless and integer-only (00-overview §Determinism): given a level set and a stream of
 * input bytes, every run produces the same state and the same hash stream, in Node or in the
 * browser. Phases whose systems do not exist yet are present as empty steps naming the
 * milestone that fills them — the order is the part that must never drift.
 *
 * Room state is never mutated in place across an entry: `enterRoom` rebuilds it from the
 * level data and the persistent flags (01 §9), so everything §9 lists as "reset" simply
 * comes back and everything it lists as "persist" is a flag.
 */

import { boxCentre, moveAxisSeparated } from './collision.js';
import { damagePlayer, isSwingActive, playerCentre, swordRect } from './combat.js';
import {
  DEATH_BLACK_TICKS,
  DOOR_OPEN_RADIUS_PX,
  DYING_TICKS,
  ENEMY_KNOCKBACK_DECAY,
  ENEMY_STATS,
  HIT_STOP_TICKS,
  SWORD_DAMAGE,
  FLOOR_FADE_TICKS,
  LADDER_HOLD_TICKS,
  MAX_HP,
  PLAYER_BOX,
  RESPAWN_MIN_HP,
  SUBPX,
  TILE_SUBPX,
  TRANSITION_TICKS,
} from './constants.js';
import {
  ENEMY_TYPE_ID,
  EnemyState,
  boxOf,
  createEntity,
  damageEnemy,
  isActive,
  moverOf,
  type SimEntity,
} from './enemy.js';
import { boxRect, dirVelocity, rectCentre, rectsOverlap, snap8 } from './geometry.js';
import { hashString, newHash, writeInt32 } from './hash.js';
import { INPUT_MASK, UP, moveAxes, pressed, INTERACT } from './input.js';
import {
  cellKey,
  entryPlacement,
  otherEnd,
  type Cell,
  type LoadedDoor,
  type LoadedFloor,
  type LoadedRoom,
  type LoadedTrap,
  type PickupName,
} from './level.js';
import { grantPickup, type Inventory } from './pickups.js';
import {
  Persistence,
  clearedFlag,
  doorFlag,
  pickupFlag,
  pitFlag,
  propFlag,
} from './persistence.js';
import {
  Facing,
  PlayerState,
  createPlayer,
  updatePlayer,
  walkVelocity,
  type Player,
} from './player.js';
import { TileClass, isSolid, setTile, tileAt, type Room } from './room.js';

/** A trap placement in the current room; only its phase is hashed (05 §4). */
export interface SimTrap {
  def: LoadedTrap;
  phase: number;
}

/**
 * A pickup still lying in the current room. Map pickups persist once collected (01 §9);
 * enemy drops are transient, so collecting one must never flag the cell it happened to land
 * on — a map coin there would vanish on re-entry.
 */
export interface SimPickup {
  at: Cell;
  kind: PickupName;
  fromMap: boolean;
}

/** Where the player respawns after a death (01 §6). */
export interface Checkpoint {
  x: number;
  y: number;
  facing: Facing;
  hp: number;
}

/**
 * A scripted sequence that suspends the tick loop (01 §1): the camera slide of §8.2, the
 * black screen before a respawn (§6), and the fade around a floor change (§8.4).
 */
export type Script =
  | {
      kind: 'transition';
      door: string;
      toRoom: number;
      dir: 'U' | 'D' | 'L' | 'R';
      ticksLeft: number;
    }
  | { kind: 'respawn'; ticksLeft: number }
  | { kind: 'descend'; ticksLeft: number; loaded: boolean };

export interface SimOptions {
  floorIndex?: number;
  /** Room to start in; defaults to the floor's first room. */
  roomId?: string;
  hp?: number;
  /** Sprite-cell top-left in subpixels; defaults to the room's `@`, else (0,0). */
  start?: { x: number; y: number };
}

const DIR_FACING: Record<'U' | 'D' | 'L' | 'R', Facing> = {
  U: Facing.U,
  D: Facing.D,
  L: Facing.L,
  R: Facing.R,
};

/** Wrap a bare tile grid as a one-room floor, so ad-hoc test rooms take the same code path. */
function syntheticFloor(room: Room): LoadedFloor {
  const loaded: LoadedRoom = {
    id: 'R1',
    name: 'room',
    spec: { id: 'R1', name: 'room', map: [] },
    base: room,
    w: room.w,
    h: room.h,
    combatSeal: false,
    spawn: room.spawn ? [room.spawn.col, room.spawn.row] : null,
    ladder: null,
    enemies: [],
    traps: [],
    pickups: [],
    props: [],
    torchGroups: [],
    waves: [],
    decor: [],
    doorCells: new Map(),
  };
  return {
    id: 'f1',
    name: 'room',
    rooms: [loaded],
    roomIndex: new Map([['R1', 0]]),
    doors: [],
    doorIndex: new Map(),
    wiring: [],
  };
}

/**
 * Where to put the player when no start position is given: the room's `@` cell, or — for
 * rooms that have none — the first walkable tile, row-major. The game itself always enters
 * through `@` or a door; this is for the debug renderer and for tests that start mid-floor.
 */
function defaultStart(room: LoadedRoom): { x: number; y: number } {
  if (room.spawn) return { x: room.spawn[0] * TILE_SUBPX, y: room.spawn[1] * TILE_SUBPX };
  for (let row = 0; row < room.h; row++) {
    for (let col = 0; col < room.w; col++) {
      if (!isSolid(tileAt(room.base, col, row), 'ground')) {
        return { x: col * TILE_SUBPX, y: row * TILE_SUBPX };
      }
    }
  }
  return { x: 0, y: 0 };
}

export class Sim {
  readonly floors: LoadedFloor[];

  floorIndex: number;
  roomIndex = 0;

  /** The live tile grid, rebuilt on every room entry from the map plus persistent flags. */
  room!: Room;
  entities: SimEntity[] = [];
  traps: SimTrap[] = [];
  pickups: SimPickup[] = [];

  /** Play-time ticks (01 §1 phase 2). Pause does not advance it (01 §10). */
  playTick = 0;
  /** Ticks since room entry — the clock traps and the wisp run off (02 §3). */
  roomTimer = 0;

  player: Player;
  inventory: Inventory = { treasure: 0, silverKeys: 0, goldKey: false };
  deaths = 0;

  readonly persistence = new Persistence();
  /** Open state per door of the current floor, in document order (05 §4). */
  doorOpen: boolean[] = [];

  checkpoint: Checkpoint;
  script: Script | null = null;
  /** True from taking a floor exit until the next floor is entered; `victory` keeps it set. */
  floorComplete = false;
  victory = false;

  /** −1 while no wave table is pending (02 §2.3). */
  pendingWave = -1;
  /** Combat seal state (01 §8.3): 0 = open, 1 = sealed. */
  seal = 0;

  /** Sim freeze on a connecting swing (01 §1 phase 2, §4.2). Nothing sets it before M3. */
  hitStop = 0;

  input = 0;
  prevInput = 0;

  private ladderHold = 0;

  constructor(world: Room | LoadedFloor[], options: SimOptions = {}) {
    this.floors = Array.isArray(world) ? world : [syntheticFloor(world)];
    this.floorIndex = options.floorIndex ?? 0;

    const floor = this.floor;
    const index = options.roomId ? (floor.roomIndex.get(options.roomId) ?? 0) : 0;
    const room = floor.rooms[index]!;

    this.player = createPlayer(0, 0, options.hp ?? MAX_HP);
    this.checkpoint = { x: 0, y: 0, facing: Facing.D, hp: this.player.hp };

    this.syncDoors();
    const start = options.start ?? defaultStart(room);
    this.enterRoom(index, start.x, start.y, this.player.facing);
  }

  get floor(): LoadedFloor {
    return this.floors[this.floorIndex]!;
  }

  get roomDef(): LoadedRoom {
    return this.floor.rooms[this.roomIndex]!;
  }

  get roomId(): string {
    return this.roomDef.id;
  }

  get treasure(): number {
    return this.inventory.treasure;
  }

  get silverKeys(): number {
    return this.inventory.silverKeys;
  }

  get goldKey(): boolean {
    return this.inventory.goldKey;
  }

  // -------------------------------------------------------------------------
  // The tick
  // -------------------------------------------------------------------------

  /** One tick. `input` is the bitmask of 01 §2 — from the keyboard or from a replay. */
  tick(input: number): void {
    // 1. Input latch.
    this.prevInput = this.input;
    this.input = input & INPUT_MASK;

    // 2. Global timers. Hit-stop skips phases 3–9; the renderer still draws.
    this.playTick++;
    if (this.hitStop > 0) {
      this.hitStop--;
      return;
    }

    // Transitions and death sequences suspend the loop with their own scripted ticks (01 §1).
    if (this.script) {
      this.advanceScript();
      return;
    }

    // 3. Player update: state machine, then movement + collision (01 §3, §4).
    this.updatePlayerPhase();
    if (this.script) return;

    // 4. Enemy updates, ascending spawn id (02 §2).
    this.updateEnemies();
    // 5. Projectile updates, ascending spawn order — M4.
    // 6. Trap updates: advance phase counters, compute deadly sets (02 §3; damage is M4).
    this.roomTimer++;
    for (const trap of this.traps) {
      trap.phase = (this.roomTimer + trap.def.offset) % trap.def.period;
    }

    // 7. Overlap resolution: pickups, damage, then trigger zones (01 §1).
    this.collectPickups();
    this.resolveSwordHits();
    this.resolveContactDamage();
    this.openNearbyDoors();
    this.unlockDoors();
    this.checkLadder();
    this.checkTransition();

    // 8. Wiring evaluation — M4.
    // 9. Room bookkeeping: combat seal, waves, cleared flags — M4.
    // 10. State hash: on request only, via hash().
  }

  private updatePlayerPhase(): void {
    const p = this.player;

    // 01 §6: at 0 HP the death sequence takes over and the sim is otherwise frozen. DYING
    // lasts 60 ticks counting the one it starts on, then 30 ticks of black before respawn.
    if (p.hp <= 0 && p.state !== PlayerState.DYING) {
      p.state = PlayerState.DYING;
      p.stateTimer = DYING_TICKS;
    }
    if (p.state === PlayerState.DYING) {
      p.stateTimer--;
      if (p.stateTimer <= 0) this.script = { kind: 'respawn', ticksLeft: DEATH_BLACK_TICKS };
      return;
    }

    updatePlayer(p, this.room, this.input, this.prevInput);
  }

  private advanceScript(): void {
    const script = this.script!;
    script.ticksLeft--;

    if (script.kind === 'descend' && !script.loaded && script.ticksLeft <= FLOOR_FADE_TICKS) {
      // Halfway: the old floor is gone, the new one is entered, and the fade-in plays over it.
      this.loadNextFloor();
      script.loaded = true;
      return;
    }
    if (script.ticksLeft > 0) return;

    this.script = null;
    switch (script.kind) {
      case 'transition': {
        const door = this.floor.doors.find((d) => d.id === script.door)!;
        const end = otherEnd(door, this.roomId);
        const target = this.floor.rooms[end.roomIndex]!;
        const place = entryPlacement(target, end.cells, end.wall);
        this.player.state = PlayerState.NORMAL;
        this.enterRoom(end.roomIndex, place.x, place.y, DIR_FACING[place.dir]);
        return;
      }
      case 'respawn': {
        // 01 §6: restore at the checkpoint, reset the room, keep every persistent flag.
        this.deaths++;
        this.player.hp = Math.max(this.checkpoint.hp, RESPAWN_MIN_HP);
        this.player.state = PlayerState.NORMAL;
        this.player.stateTimer = 0;
        this.enterRoom(
          this.roomIndex,
          this.checkpoint.x,
          this.checkpoint.y,
          this.checkpoint.facing,
        );
        return;
      }
      case 'descend':
        this.player.state = PlayerState.NORMAL;
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Rooms (01 §8.2, §9)
  // -------------------------------------------------------------------------

  /**
   * Enter a room: rebuild its state from the level data and the persistent flags, place the
   * player, and record the checkpoint (01 §6, §9).
   */
  enterRoom(index: number, x: number, y: number, facing: Facing): void {
    this.roomIndex = index;
    this.roomTimer = 0;
    this.ladderHold = 0;

    const def = this.roomDef;
    const floorId = this.floor.id;

    // Tiles: the map, with persistent changes applied.
    const tiles = Uint8Array.from(def.base.tiles);
    this.room = { w: def.w, h: def.h, tiles, spawn: def.base.spawn, symbols: def.base.symbols };

    for (const [key, door] of def.doorCells) {
      const [col, row] = key.split(',').map(Number) as [number, number];
      const open = door.type === 'gap' || this.persistence.has(doorFlag(floorId, door.doorId));
      setTile(this.room, col, row, open ? TileClass.DOOR_OPEN : TileClass.DOOR_CLOSED);
    }
    for (let row = 0; row < def.h; row++) {
      for (let col = 0; col < def.w; col++) {
        if (tileAt(this.room, col, row) !== TileClass.PIT) continue;
        if (this.persistence.has(pitFlag(floorId, def.id, col, row))) {
          setTile(this.room, col, row, TileClass.BRIDGED_PIT);
        }
      }
    }
    for (const prop of def.props) {
      // Destroyed crates leave the floor clear; opened chests stay put, empty (01 §9).
      const gone = this.persistence.has(propFlag(floorId, def.id, prop.at[0], prop.at[1]));
      if (gone && (prop.kind === 'crate_wood' || prop.kind === 'crate_steel')) {
        setTile(this.room, prop.at[0], prop.at[1], TileClass.FLOOR);
      }
    }

    // Pickups: everything not already collected.
    this.pickups = def.pickups
      .filter((p) => !this.persistence.has(pickupFlag(floorId, def.id, p.at[0], p.at[1])))
      .map((p) => ({ at: p.at, kind: p.kind, fromMap: true }));

    // Enemies: respawned at their map positions, full HP (01 §9). A cleared combat_seal room
    // never respawns them.
    const cleared = this.persistence.has(clearedFlag(floorId, def.id));
    this.entities =
      def.combatSeal && cleared
        ? []
        : def.enemies.map((e, index) =>
            createEntity(index, e.type, e.at[0] * TILE_SUBPX, e.at[1] * TILE_SUBPX, e.drop),
          );

    // Trap phase counters reset to their per-placement offsets (01 §9).
    this.traps = def.traps.map((def_) => ({ def: def_, phase: def_.offset % def_.period }));

    this.pendingWave = def.waves.length > 0 && !cleared ? 0 : -1;
    this.seal = 0;

    this.player.x = x;
    this.player.y = y;
    this.player.facing = facing;
    this.checkpoint = { x, y, facing, hp: this.player.hp };
  }

  /** Door open states for the current floor, rebuilt from persistence (05 §4 hashes these). */
  private syncDoors(): void {
    const floorId = this.floor.id;
    this.doorOpen = this.floor.doors.map(
      (d) => d.type === 'gap' || this.persistence.has(doorFlag(floorId, d.id)),
    );
  }

  private openDoor(door: LoadedDoor): void {
    this.persistence.set(doorFlag(this.floor.id, door.id));
    this.syncDoors();
    for (const [key, owner] of this.roomDef.doorCells) {
      if (owner.doorId !== door.id) continue;
      const [col, row] = key.split(',').map(Number) as [number, number];
      setTile(this.room, col, row, TileClass.DOOR_OPEN);
    }
  }

  private isOpen(door: LoadedDoor): boolean {
    return this.doorOpen[this.floor.doorIndex.get(door.id)!] === true;
  }

  /** Open state by door id, independent of which room the player is standing in. */
  isDoorOpen(id: string): boolean {
    const index = this.floor.doorIndex.get(id);
    if (index === undefined)
      throw new Error(`isDoorOpen: no door "${id}" on floor ${this.floor.id}`);
    return this.doorOpen[index] === true;
  }

  /** Doors with an endpoint in the current room. */
  private doorsHere(): LoadedDoor[] {
    return this.floor.doors.filter((d) => d.a.room === this.roomId || d.b.room === this.roomId);
  }

  private cellsHere(door: LoadedDoor): Cell[] {
    return door.a.room === this.roomId ? door.a.cells : door.b.cells;
  }

  // -------------------------------------------------------------------------
  // Phase 4 — enemies (02 §2)
  // -------------------------------------------------------------------------

  /** Enemies act in ascending spawn id (01 §1 phase 4). */
  private updateEnemies(): void {
    let died = false;

    for (const entity of this.entities) {
      if (entity.state === EnemyState.DYING) {
        // 02 §2.1: 2 ticks of white flash, 10 of fade, then the drop.
        entity.stateTimer--;
        if (entity.stateTimer <= 0) died = true;
        continue;
      }

      // Hitstun pauses the state machine but not the knockback carrying it away (02 §2.2).
      if (entity.hitstun > 0) entity.hitstun--;
      this.applyEnemyKnockback(entity);
    }

    if (died) this.buryTheDead();
  }

  /** Knockback moves an enemy even while stunned, colliding normally (01 §4.2, §5.2). */
  private applyEnemyKnockback(entity: SimEntity): void {
    if (entity.knockMag <= 0 || entity.knockDir === null) return;

    const vel = dirVelocity(entity.knockDir, entity.knockMag);
    const moved = moveAxisSeparated(
      this.room,
      boxOf(entity.kind),
      { x: entity.x, y: entity.y },
      vel,
      moverOf(entity.kind),
    );
    entity.x = moved.x;
    entity.y = moved.y;

    entity.knockMag = Math.max(0, entity.knockMag - ENEMY_KNOCKBACK_DECAY);
    if (entity.knockMag === 0) entity.knockDir = null;
  }

  /** Remove finished corpses and leave their drops on the tile they fell on (02 §2.1). */
  private buryTheDead(): void {
    const survivors: SimEntity[] = [];
    for (const entity of this.entities) {
      if (entity.state === EnemyState.DYING && entity.stateTimer <= 0) {
        if (entity.drop) {
          this.pickups.push({
            at: [Math.floor(entity.x / TILE_SUBPX), Math.floor(entity.y / TILE_SUBPX)],
            kind: entity.drop,
            fromMap: false,
          });
        }
        continue;
      }
      survivors.push(entity);
    }
    this.entities = survivors;
  }

  // -------------------------------------------------------------------------
  // Phase 7 — overlaps and trigger zones
  // -------------------------------------------------------------------------

  private hitbox(): { l: number; t: number; r: number; b: number } {
    const l = this.player.x + PLAYER_BOX.offX * SUBPX;
    const t = this.player.y + PLAYER_BOX.offY * SUBPX;
    return { l, t, r: l + PLAYER_BOX.w * SUBPX, b: t + PLAYER_BOX.h * SUBPX };
  }

  /** True when the player's hitbox overlaps the given tile (01 §7 uses the hitbox, not the sprite). */
  private overlapsTile(col: number, row: number): boolean {
    const box = this.hitbox();
    const l = col * TILE_SUBPX;
    const t = row * TILE_SUBPX;
    return box.l < l + TILE_SUBPX && box.r > l && box.t < t + TILE_SUBPX && box.b > t;
  }

  private collectPickups(): void {
    if (this.pickups.length === 0) return;
    const kept: SimPickup[] = [];
    for (const pickup of this.pickups) {
      if (!this.overlapsTile(pickup.at[0], pickup.at[1])) {
        kept.push(pickup);
        continue;
      }
      grantPickup(pickup.kind, this.player, this.inventory);
      // Only the map's own pickups are remembered; enemy drops are transient (01 §9).
      if (pickup.fromMap) {
        this.persistence.set(pickupFlag(this.floor.id, this.roomId, pickup.at[0], pickup.at[1]));
      }
    }
    this.pickups = kept;
  }

  /**
   * The swing's active window against every enemy it has not already hit (01 §4.2). One
   * connection freezes the sim for 3 ticks, however many enemies it caught.
   */
  private resolveSwordHits(): void {
    const player = this.player;
    if (!isSwingActive(player)) return;

    const blade = swordRect(player);
    const from = playerCentre(player);
    let connected = false;

    for (const entity of this.entities) {
      if (!isActive(entity) || player.swingHits.includes(entity.id)) continue;
      const box = boxRect(boxOf(entity.kind), entity);
      if (!rectsOverlap(blade, box)) continue;

      const centre = rectCentre(box);
      damageEnemy(entity, SWORD_DAMAGE, snap8(centre.x - from.x, centre.y - from.y));
      player.swingHits.push(entity.id);
      connected = true;
    }

    if (connected) this.hitStop = HIT_STOP_TICKS;
  }

  /** Touching an enemy hurts; the enemy is not interrupted by it (02 §2.1). */
  private resolveContactDamage(): void {
    const hurtBox = boxRect(PLAYER_BOX, this.player);

    for (const entity of this.entities) {
      if (!isActive(entity)) continue;
      const box = boxRect(boxOf(entity.kind), entity);
      if (!rectsOverlap(hurtBox, box)) continue;

      if (damagePlayer(this.player, ENEMY_STATS[entity.kind].contactDamage, rectCentre(box))) {
        this.hitStop = HIT_STOP_TICKS;
      }
      return; // one source of damage per tick; i-frames would refuse the rest anyway
    }
  }

  /** Normal doors open on proximity: hitbox centre within 24 px of the door's centre (01 §8.1). */
  private openNearbyDoors(): void {
    const centre = boxCentre(PLAYER_BOX, this.player);
    const radius = DOOR_OPEN_RADIUS_PX * SUBPX;

    for (const door of this.doorsHere()) {
      if (door.type !== 'normal' || this.isOpen(door)) continue;
      const cells = this.cellsHere(door);
      const cols = cells.map((c) => c[0]);
      const rows = cells.map((c) => c[1]);
      const cx = ((Math.min(...cols) + Math.max(...cols) + 1) * TILE_SUBPX) / 2;
      const cy = ((Math.min(...rows) + Math.max(...rows) + 1) * TILE_SUBPX) / 2;
      const dx = centre.x - cx;
      const dy = centre.y - cy;
      if (dx * dx + dy * dy <= radius * radius) this.openDoor(door);
    }
  }

  /**
   * Locked doors open on INTERACT at the §4.3 target tile, or by walking against them, and
   * a silver door consumes a key (01 §8.1).
   */
  private unlockDoors(): void {
    const interacting = pressed(this.input, this.prevInput, INTERACT);
    const target = interacting ? this.interactTile() : null;

    // "Walks against it": where this tick's input would have put the hitbox, unclamped.
    const { dx, dy } = moveAxes(this.input);
    const vel = walkVelocity(dx, dy);
    const box = this.hitbox();

    for (const door of this.doorsHere()) {
      if (this.isOpen(door)) continue;
      if (door.type !== 'silver' && door.type !== 'gold') continue;
      if (door.type === 'silver' && this.inventory.silverKeys < 1) continue;
      if (door.type === 'gold' && !this.inventory.goldKey) continue;

      const cells = this.cellsHere(door);
      const pushing = cells.some(([col, row]) => {
        const l = col * TILE_SUBPX;
        const t = row * TILE_SUBPX;
        return (
          box.l + vel.x < l + TILE_SUBPX &&
          box.r + vel.x > l &&
          box.t + vel.y < t + TILE_SUBPX &&
          box.b + vel.y > t
        );
      });
      const interacted =
        target !== null && cells.some(([c, r]) => c === target[0] && r === target[1]);
      if (!pushing && !interacted) continue;

      if (door.type === 'silver') this.inventory.silverKeys--;
      this.openDoor(door);
    }
  }

  /** 01 §4.3: the tile holding the point 16 px in front of the player's sprite centre. */
  interactTile(): Cell {
    const half = TILE_SUBPX / 2;
    let x = this.player.x + half;
    let y = this.player.y + half;
    switch (this.player.facing) {
      case Facing.U:
        y -= TILE_SUBPX;
        break;
      case Facing.D:
        y += TILE_SUBPX;
        break;
      case Facing.L:
        x -= TILE_SUBPX;
        break;
      case Facing.R:
        x += TILE_SUBPX;
        break;
    }
    return [Math.floor(x / TILE_SUBPX), Math.floor(y / TILE_SUBPX)];
  }

  /** 01 §8.4: UP held 12 ticks on the tile below the ladder ends the floor. */
  private checkLadder(): void {
    const ladder = this.roomDef.ladder;
    if (!ladder) return;
    const holding = (this.input & UP) !== 0 && this.overlapsTile(ladder[0], ladder[1] + 1);
    this.ladderHold = holding ? this.ladderHold + 1 : 0;
    if (this.ladderHold < LADDER_HOLD_TICKS) return;

    this.ladderHold = 0;
    this.floorComplete = true;
    this.player.state = PlayerState.SCRIPTED;
    this.script = { kind: 'descend', ticksLeft: FLOOR_FADE_TICKS * 2, loaded: false };
  }

  private loadNextFloor(): void {
    // HP, treasure, deaths and the gold key carry over; silver keys do not (01 §8.4).
    this.floorIndex++;
    this.inventory.silverKeys = 0;
    this.floorComplete = false;
    this.syncDoors();

    const room = this.floor.rooms[0]!;
    const spawn = room.spawn ?? [0, 0];
    this.enterRoom(0, spawn[0] * TILE_SUBPX, spawn[1] * TILE_SUBPX, Facing.D);
  }

  /** 01 §8.2: the hitbox centre entering an open door cell starts the 24-tick slide. */
  private checkTransition(): void {
    const centre = boxCentre(PLAYER_BOX, this.player);
    const col = Math.floor(centre.x / TILE_SUBPX);
    const row = Math.floor(centre.y / TILE_SUBPX);
    const owner = this.roomDef.doorCells.get(cellKey(col, row));
    if (!owner) return;

    const door = this.floor.doors[this.floor.doorIndex.get(owner.doorId)!]!;
    if (!this.isOpen(door)) return;

    const end = otherEnd(door, this.roomId);
    const target = this.floor.rooms[end.roomIndex]!;
    this.player.state = PlayerState.SCRIPTED;
    this.script = {
      kind: 'transition',
      door: door.id,
      toRoom: end.roomIndex,
      dir: entryPlacement(target, end.cells, end.wall).dir,
      ticksLeft: TRANSITION_TICKS,
    };
  }

  // -------------------------------------------------------------------------
  // State hash — 05-data-formats §4
  // -------------------------------------------------------------------------

  /**
   * 32-bit FNV-1a over the canonical field order of 05 §4. Collections that are still empty
   * (projectiles, waves) are filled by M3–M4 without the order changing.
   */
  hash(): number {
    let h = newHash();

    h = writeInt32(h, this.playTick);
    h = writeInt32(h, this.floorIndex);
    h = writeInt32(h, this.roomIndex);

    const p = this.player;
    h = writeInt32(h, p.x);
    h = writeInt32(h, p.y);
    h = writeInt32(h, p.hp);
    h = writeInt32(h, p.facing);
    h = writeInt32(h, p.state);
    h = writeInt32(h, p.stateTimer);
    h = writeInt32(h, p.iframeTimer);
    h = writeInt32(h, p.invulnTimer);
    h = writeInt32(h, p.knockVx);
    h = writeInt32(h, p.knockVy);

    h = writeInt32(h, this.inventory.treasure);
    h = writeInt32(h, this.inventory.silverKeys);
    h = writeInt32(h, this.inventory.goldKey ? 1 : 0);
    h = writeInt32(h, this.deaths);

    for (const e of this.entities) {
      h = writeInt32(h, ENEMY_TYPE_ID[e.kind]);
      h = writeInt32(h, e.x);
      h = writeInt32(h, e.y);
      h = writeInt32(h, e.hp);
      h = writeInt32(h, e.state);
      h = writeInt32(h, e.stateTimer);
    }
    for (const trap of this.traps) h = writeInt32(h, trap.phase);
    for (const open of this.doorOpen) h = writeInt32(h, open ? 1 : 0);
    for (const flag of this.persistence.sorted()) h = writeInt32(h, hashString(flag));

    h = writeInt32(h, this.pendingWave);
    h = writeInt32(h, this.seal);

    return h;
  }
}
