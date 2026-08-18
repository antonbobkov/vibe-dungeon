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
  PUSH_CHARGE_TICKS,
  SPAWN_BLINK_TICKS,
  SPAWN_TELEGRAPH_TICKS,
  WAVE_GAP_TICKS,
  ENEMY_KNOCKBACK_DECAY,
  TRAP_DAMAGE,
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
  separateEnemies,
  updateEnemy,
  type SimEntity,
} from './enemy.js';
import {
  Dir8,
  boxRect,
  dirVelocity,
  rectCentre,
  rectsOverlap,
  snap8,
  tileRect,
} from './geometry.js';
import { hashString, newHash, writeInt32 } from './hash.js';
import { INPUT_MASK, UP, moveAxes, pressed, INTERACT } from './input.js';
import {
  adHocRoom,
  cellKey,
  entryPlacement,
  otherEnd,
  type Cell,
  type LoadedDoor,
  type LoadedFloor,
  type EnemyType,
  type LoadedRoom,
  type PickupName,
  type WireSpec,
} from './level.js';
import { grantPickup, type Inventory } from './pickups.js';
import {
  Persistence,
  clearedFlag,
  doorFlag,
  groupFlag,
  pickupFlag,
  pitFlag,
  propFlag,
  torchFlag,
  wireFlag,
} from './persistence.js';
import {
  PropState,
  breakCrate,
  createProp,
  createTorchGroup,
  groupHas,
  isBreakable,
  isChest,
  openChest,
  slideTarget,
  startSlide,
  type SimProp,
  type SimTorchGroup,
} from './prop.js';
import {
  Facing,
  PlayerState,
  createPlayer,
  updatePlayer,
  walkVelocity,
  type Player,
} from './player.js';
import { TileClass, isSolid, setTile, tileAt, type Room } from './room.js';
import {
  advanceBolt,
  boltAt,
  boltBlocked,
  boltRect,
  deadlyTiles,
  isFiring,
  trapPhase,
  type SimBolt,
  type SimTrap,
} from './trap.js';

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

/** A spawn cursor blinking on its tile before a wave enemy appears (02 §2.3). */
export interface SimTelegraph {
  at: Cell;
  kind: EnemyType;
  drop: PickupName | null;
  ticksLeft: number;
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

/**
 * Which cardinal a walk is pressing a crate along, or null. Horizontal is tried first, the
 * same tie-break 02 §2.1's steering uses, so a diagonal into a corner pushes sideways.
 */
function pushDirection(
  box: { l: number; t: number; r: number; b: number },
  vel: { x: number; y: number },
  at: Cell,
): Dir8 | null {
  const cell = tileRect(at[0], at[1]);
  const reaches = (ox: number, oy: number): boolean =>
    rectsOverlap({ l: box.l + ox, t: box.t + oy, r: box.r + ox, b: box.b + oy }, cell);

  if (vel.x > 0 && reaches(vel.x, 0)) return Dir8.R;
  if (vel.x < 0 && reaches(vel.x, 0)) return Dir8.L;
  if (vel.y > 0 && reaches(0, vel.y)) return Dir8.D;
  if (vel.y < 0 && reaches(0, vel.y)) return Dir8.U;
  return null;
}

/** Wrap a bare tile grid as a one-room floor, so ad-hoc test rooms take the same code path. */
function syntheticFloor(room: Room): LoadedFloor {
  const loaded = adHocRoom(room);
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
  /** Bolts in flight, in spawn order — 01 §1 phase 5 (02 §3.2). */
  bolts: SimBolt[] = [];
  pickups: SimPickup[] = [];
  props: SimProp[] = [];
  torchGroups: SimTorchGroup[] = [];
  /** Tiles a trap makes deadly this tick, recomputed in phase 6. */
  deadly: Cell[] = [];
  /** Triggers raised this tick, for the wiring phase to read (03 §1.6). */
  openedChests: Cell[] = [];
  /**
   * Locked doors the player leant on this tick without the key. Nothing in the sim reads it —
   * it exists so the presentation layer can sound 04-ui §5's "locked" without re-deriving
   * 01 §8.1's contact rule. Not hashed: it changes nothing that plays.
   */
  lockedBumps: string[] = [];
  litGroups: string[] = [];
  clearedRooms: string[] = [];
  /** Spawn cursors counting down on their tiles (02 §2.3). */
  telegraphs: SimTelegraph[] = [];
  /** Ticks until the next wave, or −1 when nothing is waiting. */
  waveGap = -1;
  private nextEntityId = 0;
  private nextBoltId = 0;

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

    // 04-ui §3.3: victory stops the sim where it stands.
    if (this.victory) return;

    // Transitions and death sequences suspend the loop with their own scripted ticks (01 §1).
    if (this.script) {
      this.advanceScript();
      return;
    }

    // The room clock advances once, here, so every system that reads it sees the same value
    // on the same tick: the traps of 02 §3 and the wisp's wobble of 02 §2.4, which the spec
    // says share this clock. A frozen or suspended tick is not a room tick.
    this.roomTimer++;

    // 3. Player update: state machine, then movement + collision (01 §3, §4).
    this.updatePlayerPhase();
    if (this.script) return;

    // 4. Enemy updates, ascending spawn id (02 §2).
    this.updateEnemies();
    this.openedChests = [];
    this.litGroups = [];
    this.clearedRooms = [];
    this.lockedBumps = [];

    // 5. Projectile updates, ascending spawn order (02 §3.2).
    this.updateBolts();

    // 6. Trap updates: advance phase counters, compute deadly sets (02 §3).
    for (const trap of this.traps) {
      trap.phase = trapPhase(trap.def, this.roomTimer);
      if (isFiring(trap.def, trap.phase)) {
        this.bolts.push(boltAt(this.nextBoltId++, trap.def.at));
      }
    }
    this.deadly = deadlyTiles(this.traps);

    // 01 §1 has no phase of its own for props, so their timers run here: after the world has
    // moved and before the overlaps and wiring that read them (02 §4).
    this.updateProps();

    // 7. Overlap resolution: pickups, damage, then trigger zones (01 §1).
    this.collectPickups();
    this.resolveSwordHits();
    this.resolveContactDamage();
    this.resolveTrapDamage();
    this.openNearbyDoors();
    this.unlockDoors();
    this.interactWithProps();
    this.updatePushes();
    this.checkLadder();
    this.checkTransition();

    // 8. Wiring evaluation: triggers raised above, effects applied here (03 §1.6).
    this.evaluateWiring();

    // 9. Room bookkeeping: waves, then the seal they hold shut (02 §2.3, 01 §8.3).
    this.updateWaves();
    this.updateSeal();
    this.evaluateWiring(); // a room cleared just now fires its wire on the same tick
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
    // Props, with what the floor remembers about them applied (01 §9). Pushable crates are
    // simply rebuilt from the map, which is what undoes a jammed configuration (02 §4.2).
    this.torchGroups = def.torchGroups.map(createTorchGroup);
    this.props = [];
    for (const spec of def.props) {
      const remembered = this.persistence.has(propFlag(floorId, def.id, spec.at[0], spec.at[1]));
      if (remembered && (isBreakable(spec.kind) || spec.kind === 'crate_push')) {
        // A destroyed crate, or one swallowed by a pit, leaves the floor clear.
        setTile(this.room, spec.at[0], spec.at[1], TileClass.FLOOR);
        continue;
      }

      const prop = createProp(spec);
      if (remembered && isChest(spec.kind)) prop.state = PropState.OPEN;
      if (spec.kind === 'torch' && this.torchIsLit(def, spec.at)) prop.state = PropState.LIT;
      this.props.push(prop);
    }

    // Pickups: everything not already collected.
    this.pickups = def.pickups
      .filter((p) => !this.persistence.has(pickupFlag(floorId, def.id, p.at[0], p.at[1])))
      .map((p) => ({ at: p.at, kind: p.kind, fromMap: true }));

    // Enemies: respawned at their map positions, full HP (01 §9). A cleared combat_seal room
    // never respawns them.
    const cleared = this.persistence.has(clearedFlag(floorId, def.id));
    this.nextEntityId = 0;
    this.entities =
      def.combatSeal && cleared
        ? []
        : def.enemies.map((e) =>
            createEntity(
              this.nextEntityId++,
              e.type,
              e.at[0] * TILE_SUBPX,
              e.at[1] * TILE_SUBPX,
              e.drop,
            ),
          );

    // Trap phase counters reset to their per-placement offsets, and nothing is in flight
    // (01 §9).
    this.traps = def.traps.map((trap) => ({ def: trap, phase: trapPhase(trap, 0) }));
    this.deadly = deadlyTiles(this.traps);
    this.bolts = [];
    this.nextBoltId = 0;

    this.restoreWiredPickups(def);

    // Waves start over on entry unless the room is done with (01 §9). Wave 1 telegraphs
    // immediately — 02 §2.3 puts it on room entry, not a tick later — which is also what
    // makes the seal shut before the player has moved.
    this.telegraphs = [];
    this.waveGap = -1;
    this.pendingWave = def.waves.length > 0 && !cleared ? 0 : -1;
    if (this.pendingWave === 0) this.beginWave();
    this.seal = 0;

    this.player.x = x;
    this.player.y = y;
    this.player.facing = facing;
    this.checkpoint = { x, y, facing, hp: this.player.hp };

    // A combat seal shuts before the player has taken a step (01 §8.3).
    this.updateSeal();
  }

  /**
   * Whether a puzzle torch comes back lit (01 §9, 02 §4.3). A completed group is lit for
   * good; an unfinished *windowed* group resets, while an unfinished windowless one keeps
   * whatever was lit.
   */
  private torchIsLit(def: LoadedRoom, at: Cell): boolean {
    const floorId = this.floor.id;
    const group = def.torchGroups.find((g) => groupHas({ ...g, timer: -1 }, at));
    if (group && this.persistence.has(groupFlag(floorId, group.id))) return true;
    if (group?.window != null) return false;
    return this.persistence.has(torchFlag(floorId, def.id, at[0], at[1]));
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
      updateEnemy(entity, {
        room: this.room,
        target: playerCentre(this.player),
        roomTimer: this.roomTimer,
      });
    }

    // Overlapping enemies shoulder each other apart once everyone has moved (02 §2.1).
    separateEnemies(this.entities);

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
  // Props — 02 §4
  // -------------------------------------------------------------------------

  /** Advance every prop's timer, and the torch-group windows with them. */
  private updateProps(): void {
    const survivors: SimProp[] = [];

    for (const prop of this.props) {
      switch (prop.state) {
        case PropState.OPENING:
          prop.timer--;
          if (prop.timer <= 0) this.finishOpening(prop);
          break;

        case PropState.DESTROYING:
          prop.timer--;
          if (prop.timer <= 0) {
            this.finishDestroying(prop);
            continue; // the crate is gone
          }
          break;

        case PropState.SLIDING:
          prop.timer--;
          if (prop.timer <= 0 && !this.finishSlide(prop)) continue; // consumed by a pit
          break;

        default:
          break;
      }
      survivors.push(prop);
    }

    this.props = survivors;
    this.updateTorchWindows();
  }

  /** A chest hands over everything at once, exactly once (02 §4.1). */
  private finishOpening(prop: SimProp): void {
    prop.state = PropState.OPEN;
    prop.timer = 0;
    for (const item of prop.contents) grantPickup(item, this.player, this.inventory);
    this.persistence.set(propFlag(this.floor.id, this.roomId, prop.at[0], prop.at[1]));
    this.openedChests.push(prop.at);
  }

  /** A broken crate leaves the floor clear and its drop behind (02 §4.2). */
  private finishDestroying(prop: SimProp): void {
    setTile(this.room, prop.at[0], prop.at[1], TileClass.FLOOR);
    this.persistence.set(propFlag(this.floor.id, this.roomId, prop.at[0], prop.at[1]));
    if (prop.drop) this.pickups.push({ at: prop.at, kind: prop.drop, fromMap: false });
  }

  /**
   * A slide that has run its 12 ticks. Returns false when the crate was consumed bridging a
   * pit, which is permanent (02 §4.2).
   */
  private finishSlide(prop: SimProp): boolean {
    const to = prop.slideTo!;
    const from = prop.at;
    setTile(this.room, from[0], from[1], TileClass.FLOOR);

    if (tileAt(this.roomDef.base, to[0], to[1]) === TileClass.PIT) {
      setTile(this.room, to[0], to[1], TileClass.BRIDGED_PIT);
      this.persistence.set(pitFlag(this.floor.id, this.roomId, to[0], to[1]));
      // The crate object is gone for good, so it must not be rebuilt from the map either
      // (02 §4.2) — remembered against the cell the map put it in.
      this.persistence.set(propFlag(this.floor.id, this.roomId, prop.origin[0], prop.origin[1]));
      return false;
    }

    prop.at = to;
    prop.state = PropState.IDLE;
    prop.slideTo = null;
    setTile(this.room, to[0], to[1], TileClass.PROP);
    return true;
  }

  /** INTERACT opens a chest or lights a torch on the 01 §4.3 target tile. */
  private interactWithProps(): void {
    if (!pressed(this.input, this.prevInput, INTERACT)) return;
    const [col, row] = this.interactTile();
    const prop = this.props.find((p) => p.at[0] === col && p.at[1] === row);
    if (!prop) return;

    if (isChest(prop.kind)) {
      openChest(prop);
      return;
    }
    if (prop.kind === 'torch' && prop.state === PropState.IDLE) this.lightTorch(prop);
  }

  /**
   * Light one torch and see where that leaves its group (02 §4.3). The first light starts the
   * window; the last one fires the wiring and makes the whole group permanent.
   */
  private lightTorch(prop: SimProp): void {
    prop.state = PropState.LIT;

    const group = this.torchGroups.find((g) => groupHas(g, prop.at));
    if (!group) return;
    if (group.timer < 0) group.timer = 0;

    const complete = group.members.every(([col, row]) =>
      this.props.some(
        (p) =>
          p.kind === 'torch' && p.at[0] === col && p.at[1] === row && p.state === PropState.LIT,
      ),
    );

    if (!complete) {
      // A windowless group keeps each torch on its own; a windowed one is all or nothing
      // until it completes (01 §9).
      if (group.window === null) {
        this.persistence.set(torchFlag(this.floor.id, this.roomId, prop.at[0], prop.at[1]));
      }
      return;
    }

    group.timer = -1;
    this.persistence.set(groupFlag(this.floor.id, group.id));
    for (const [col, row] of group.members) {
      this.persistence.set(torchFlag(this.floor.id, this.roomId, col, row));
    }
    this.litGroups.push(group.id);
  }

  /** A window that runs out puts every torch in the group back out (02 §4.3). */
  private updateTorchWindows(): void {
    for (const group of this.torchGroups) {
      if (group.timer < 0 || group.window === null) continue;

      group.timer++;
      if (group.timer < group.window) continue;

      group.timer = -1;
      for (const [col, row] of group.members) {
        const torch = this.props.find((p) => p.at[0] === col && p.at[1] === row);
        if (torch) torch.state = PropState.IDLE;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Pushing (02 §4.2)
  // -------------------------------------------------------------------------

  /**
   * Six consecutive contact ticks in one direction start a slide. Contact is the same test
   * walking into a locked door uses: the hitbox translated by this tick's walk velocity
   * reaching the crate's tile. An illegal destination never charges at all.
   */
  private updatePushes(): void {
    const pushing = this.player.state === PlayerState.NORMAL;
    const { dx, dy } = moveAxes(this.input);
    const vel = walkVelocity(dx, dy);
    const box = this.hitbox();

    for (const prop of this.props) {
      if (!pushing || prop.kind !== 'crate_push' || prop.state !== PropState.IDLE) {
        prop.charge = 0;
        prop.chargeDir = null;
        continue;
      }

      const dir = pushDirection(box, vel, prop.at);
      const to = dir === null ? null : slideTarget(prop.at, dir);
      if (dir === null || to === null || !this.canSlideInto(to)) {
        prop.charge = 0;
        prop.chargeDir = null;
        continue;
      }

      prop.charge = prop.chargeDir === dir ? prop.charge + 1 : 1;
      prop.chargeDir = dir;

      if (prop.charge >= PUSH_CHARGE_TICKS) {
        startSlide(prop, to);
        // Solid throughout: the destination is claimed for the whole slide.
        setTile(this.room, to[0], to[1], TileClass.PROP);
      }
    }
  }

  /**
   * 02 §4.2: the destination must be a plain floor tile holding no entity, prop, pickup,
   * trap or door — or a pit, which swallows the crate and becomes a bridge.
   */
  private canSlideInto(to: Cell): boolean {
    const [col, row] = to;
    if (col < 0 || row < 0 || col >= this.room.w || row >= this.room.h) return false;

    const cls = tileAt(this.room, col, row);
    if (cls === TileClass.PIT) return true;
    if (cls !== TileClass.FLOOR && cls !== TileClass.BRIDGED_PIT) return false;

    if (this.roomDef.doorCells.has(cellKey(col, row))) return false;
    if (this.pickups.some((p) => p.at[0] === col && p.at[1] === row)) return false;
    if (this.props.some((p) => p.at[0] === col && p.at[1] === row)) return false;

    for (const trap of this.traps) {
      if (trap.def.at[0] === col && trap.def.at[1] === row) return false;
      if (trap.def.deadly && trap.def.deadly[0] === col && trap.def.deadly[1] === row) return false;
    }

    const cell = tileRect(col, row);
    return !this.entities.some((e) => isActive(e) && rectsOverlap(cell, boxRect(boxOf(e.kind), e)));
  }

  // -------------------------------------------------------------------------
  // Phase 5 — projectiles (02 §3.2)
  // -------------------------------------------------------------------------

  /**
   * Bolts fall 40 subpx a tick and stop for a wall, a closed door, any crate, the player, or
   * the edge of the room. They pass over pits, pickups, spikes and enemies.
   */
  private updateBolts(): void {
    if (this.bolts.length === 0) return;

    const hurtBox = boxRect(PLAYER_BOX, this.player);
    const flying: SimBolt[] = [];

    for (const bolt of this.bolts) {
      advanceBolt(bolt);

      const rect = boltRect(bolt);
      if (rectsOverlap(rect, hurtBox)) {
        if (damagePlayer(this.player, TRAP_DAMAGE, rectCentre(rect))) {
          this.hitStop = HIT_STOP_TICKS;
        }
        continue; // spent, whether it landed or the player was already invulnerable
      }
      if (boltBlocked(this.room, bolt)) continue;

      flying.push(bolt);
    }

    this.bolts = flying;
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

    // 01 §4.2 lists destructible crates alongside enemies. A crate leaves IDLE the moment it
    // is hit, so "once each per swing" needs no bookkeeping — and only enemies stop the sim.
    for (const prop of this.props) {
      if (!isBreakable(prop.kind) || prop.state !== PropState.IDLE) continue;
      if (rectsOverlap(blade, tileRect(prop.at[0], prop.at[1]))) breakCrate(prop);
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

  /**
   * Standing on a deadly tile costs a heart (01 §5.1). The knockback comes from the trap
   * tile's centre, per 01 §5.2, and enemies are immune to all of it (02 §2.1).
   */
  private resolveTrapDamage(): void {
    if (this.deadly.length === 0) return;
    const hurtBox = boxRect(PLAYER_BOX, this.player);

    for (const [col, row] of this.deadly) {
      const tile = {
        l: col * TILE_SUBPX,
        t: row * TILE_SUBPX,
        r: (col + 1) * TILE_SUBPX,
        b: (row + 1) * TILE_SUBPX,
      };
      if (!rectsOverlap(hurtBox, tile)) continue;
      if (damagePlayer(this.player, TRAP_DAMAGE, rectCentre(tile))) this.hitStop = HIT_STOP_TICKS;
      return; // one source of damage per tick; i-frames would refuse the rest
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
   *
   * The key check comes *after* the contact test rather than before it, so that a door met
   * without its key can be recorded in `lockedBumps` — the presentation layer's cue for
   * 04-ui §5's "locked" (M7). Which doors open, and when, is unchanged.
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

      const keyed =
        door.type === 'silver' ? this.inventory.silverKeys >= 1 : this.inventory.goldKey;
      if (!keyed) {
        this.lockedBumps.push(door.id);
        continue;
      }

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
  // Phase 8 — wiring (03 §1.6)
  // -------------------------------------------------------------------------

  /** Every wire fires at most once, ever, and its firing is remembered per floor (01 §9). */
  private evaluateWiring(): void {
    const floorId = this.floor.id;

    for (const [index, wire] of this.floor.wiring.entries()) {
      if (this.persistence.has(wireFlag(floorId, index))) continue;
      if (!this.triggerFired(wire.trigger)) continue;

      this.persistence.set(wireFlag(floorId, index));
      for (const effect of wire.effects) this.applyEffect(effect);
    }
  }

  private triggerFired(trigger: WireSpec['trigger']): boolean {
    switch (trigger.kind) {
      case 'torch_group':
        return this.litGroups.includes(trigger.group);
      case 'room_clear':
        return this.clearedRooms.includes(trigger.room);
      case 'chest_open':
        return (
          this.roomId === trigger.room &&
          this.openedChests.some(([col, row]) => col === trigger.at[0] && row === trigger.at[1])
        );
    }
  }

  private applyEffect(effect: WireSpec['effects'][number]): void {
    switch (effect.kind) {
      case 'open_door': {
        const door = this.floor.doors.find((d) => d.id === effect.door);
        if (door) this.openDoor(door);
        return;
      }
      case 'spawn':
        this.spawnWiredPickup(effect.room, effect.at, effect.pickup);
        return;
      case 'victory':
        // 04-ui §3.3's hold and fade are the renderer's (M6); the sim stops here.
        this.victory = true;
        return;
    }
  }

  /**
   * A wired pickup appears when its room is the one being played, and is rebuilt on entry
   * for as long as it has not been collected — so a key spawned behind the player is still
   * there when they come back for it.
   */
  private spawnWiredPickup(roomId: string, at: Cell, kind: PickupName): void {
    if (roomId !== this.roomId) return;
    if (this.persistence.has(pickupFlag(this.floor.id, roomId, at[0], at[1]))) return;
    if (this.pickups.some((p) => p.at[0] === at[0] && p.at[1] === at[1])) return;
    this.pickups.push({ at, kind, fromMap: true });
  }

  /** Pickups that fired wires have already left in this room (03 §1.6). */
  private restoreWiredPickups(def: LoadedRoom): void {
    const floorId = this.floor.id;

    for (const [index, wire] of this.floor.wiring.entries()) {
      if (!this.persistence.has(wireFlag(floorId, index))) continue;
      for (const effect of wire.effects) {
        if (effect.kind !== 'spawn' || effect.room !== def.id) continue;
        if (this.persistence.has(pickupFlag(floorId, def.id, effect.at[0], effect.at[1]))) continue;
        this.pickups.push({ at: effect.at, kind: effect.pickup, fromMap: true });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Phase 9 — seals and waves (01 §8.3, 02 §2.3)
  // -------------------------------------------------------------------------

  /** Whether anything in this room still counts as a threat holding the seal shut. */
  private roomIsThreatened(): boolean {
    return this.entities.length > 0 || this.telegraphs.length > 0 || this.pendingWave >= 0;
  }

  /**
   * A combat_seal room shuts its doors on entry with anything left to fight, and opens them
   * again the moment the room is empty — permanently cleared (01 §8.3).
   */
  private updateSeal(): void {
    const def = this.roomDef;
    if (!def.combatSeal) return;
    if (this.persistence.has(clearedFlag(this.floor.id, def.id))) return;

    if (this.seal === 0) {
      if (this.roomIsThreatened()) {
        this.seal = 1;
        this.applyDoorTiles(true);
      }
      return;
    }

    if (this.roomIsThreatened()) return;

    this.seal = 0;
    this.persistence.set(clearedFlag(this.floor.id, def.id));
    this.clearedRooms.push(def.id);
    // Doors go back to whatever they were: open stays open, locked stays locked.
    this.applyDoorTiles(false);
  }

  /** Point every door cell in this room at the door's state, or hold them all shut. */
  private applyDoorTiles(sealed: boolean): void {
    const floorId = this.floor.id;
    for (const [key, owner] of this.roomDef.doorCells) {
      const [col, row] = key.split(',').map(Number) as [number, number];
      const open =
        !sealed && (owner.type === 'gap' || this.persistence.has(doorFlag(floorId, owner.doorId)));
      setTile(this.room, col, row, open ? TileClass.DOOR_OPEN : TileClass.DOOR_CLOSED);
    }
  }

  /**
   * Wave 1 lands on entry once the seal is shut, and each later wave 30 ticks after the last
   * of the previous one dies. Every spawn telegraphs for 30 ticks first (02 §2.3).
   */
  private updateWaves(): void {
    for (const telegraph of this.telegraphs) telegraph.ticksLeft--;

    const arriving = this.telegraphs.filter((t) => t.ticksLeft <= 0);
    if (arriving.length > 0) {
      this.telegraphs = this.telegraphs.filter((t) => t.ticksLeft > 0);
      for (const spawn of arriving) {
        const entity = createEntity(
          this.nextEntityId++,
          spawn.kind,
          spawn.at[0] * TILE_SUBPX,
          spawn.at[1] * TILE_SUBPX,
          spawn.drop,
        );
        entity.state = EnemyState.SPAWNING;
        entity.stateTimer = SPAWN_BLINK_TICKS;
        this.entities.push(entity);
      }
    }

    if (this.waveGap > 0) {
      // Counted down from the tick the room emptied, so the next wave telegraphs exactly
      // 30 ticks after the last enemy of the previous one died (02 §2.3).
      this.waveGap--;
      if (this.waveGap === 0) {
        this.waveGap = -1;
        this.beginWave();
      }
      return;
    }

    // Nothing left standing and another wave to come: count down to it.
    if (this.pendingWave >= 0 && this.entities.length === 0 && this.telegraphs.length === 0) {
      this.waveGap = WAVE_GAP_TICKS;
    }
  }

  /** Put the next wave's telegraphs on their tiles (02 §2.3). */
  private beginWave(): void {
    const waves = this.roomDef.waves;
    if (this.pendingWave < 0 || this.pendingWave >= waves.length) {
      this.pendingWave = -1;
      return;
    }

    for (const spawn of waves[this.pendingWave]!) {
      this.telegraphs.push({
        at: spawn.at,
        kind: spawn.type,
        drop: spawn.drop,
        ticksLeft: SPAWN_TELEGRAPH_TICKS,
      });
    }

    this.pendingWave = this.pendingWave + 1 < waves.length ? this.pendingWave + 1 : -1;
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
    // Bolts are not in 05 §4's field list — it predates them having state — so they hash
    // here, right after the entities they fly among, before the traps that fired them.
    for (const bolt of this.bolts) {
      h = writeInt32(h, bolt.x);
      h = writeInt32(h, bolt.y);
    }
    for (const trap of this.traps) h = writeInt32(h, trap.phase);
    for (const open of this.doorOpen) h = writeInt32(h, open ? 1 : 0);
    for (const flag of this.persistence.sorted()) h = writeInt32(h, hashString(flag));

    h = writeInt32(h, this.pendingWave);
    h = writeInt32(h, this.seal);

    return h;
  }
}
