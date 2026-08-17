/**
 * The simulation — one tick is the ten phases of 01-mechanics §1, in exactly that order.
 *
 * Headless and integer-only (00-overview §Determinism): given a room and a stream of input
 * bytes, every run produces the same state and the same hash stream, in Node or in the
 * browser. Phases whose systems do not exist yet are present as empty steps naming the
 * milestone that fills them — the order is the part that must never drift.
 */

import { MAX_HP, TILE_SUBPX } from './constants.js';
import { hashString, newHash, writeInt32 } from './hash.js';
import { INPUT_MASK } from './input.js';
import { createPlayer, updatePlayer, type Player } from './player.js';
import type { Room } from './room.js';

/** Enemies and bolts (M3/M4). Hashed as (type id, x, y, hp, state id, state timer) per 05 §4. */
export interface SimEntity {
  type: number;
  x: number;
  y: number;
  hp: number;
  state: number;
  stateTimer: number;
}

/** Traps (M4): only the phase counter is hashed (05 §4). */
export interface SimTrap {
  phase: number;
}

/** Doors (M2): only the open-state id is hashed (05 §4). */
export interface SimDoor {
  open: number;
}

export interface SimOptions {
  floorIndex?: number;
  roomIndex?: number;
  hp?: number;
  /** Sprite-cell top-left in subpixels; defaults to the room's `@` cell, else (0,0). */
  start?: { x: number; y: number };
}

export class Sim {
  readonly room: Room;

  /** Play-time ticks (01 §1 phase 2). Pause and transitions do not advance it (01 §10). */
  playTick = 0;
  /** Ticks since room entry — the clock traps and the wisp run off (02 §3). */
  roomTimer = 0;

  floorIndex: number;
  roomIndex: number;

  player: Player;
  treasure = 0;
  silverKeys = 0;
  goldKey = false;
  deaths = 0;

  entities: SimEntity[] = [];
  traps: SimTrap[] = [];
  doors: SimDoor[] = [];
  /** Persistent per-floor flags (01 §9); hashed sorted, by name (05 §4). */
  flags = new Set<string>();

  /** −1 while no wave table is pending (02 §2.3). */
  pendingWave = -1;
  /** Combat seal state (01 §8.3): 0 = open, 1 = sealed. */
  seal = 0;

  /** Sim freeze on a connecting swing (01 §1 phase 2, §4.2). Nothing sets it before M3. */
  hitStop = 0;

  input = 0;
  prevInput = 0;

  constructor(room: Room, options: SimOptions = {}) {
    this.room = room;
    this.floorIndex = options.floorIndex ?? 0;
    this.roomIndex = options.roomIndex ?? 0;

    const start =
      options.start ??
      (room.spawn
        ? { x: room.spawn.col * TILE_SUBPX, y: room.spawn.row * TILE_SUBPX }
        : { x: 0, y: 0 });
    this.player = createPlayer(start.x, start.y, options.hp ?? MAX_HP);
  }

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

    // 3. Player update: state machine, then movement + collision (01 §3, §4).
    updatePlayer(this.player, this.room, this.input);

    // 4. Enemy updates, ascending spawn id — M3.
    // 5. Projectile updates, ascending spawn order — M4.
    // 6. Trap updates: advance phase counters, compute deadly sets — M4.
    this.roomTimer++;
    // 7. Overlap resolution: pickups, damage, trigger zones — M2 (doors) / M3 (damage).
    // 8. Wiring evaluation — M4.
    // 9. Room bookkeeping: combat seal, waves, cleared flags — M4.
    // 10. State hash: on request only, via hash().
  }

  /**
   * 32-bit FNV-1a over the canonical field order of 05-data-formats §4. The empty
   * collections below contribute nothing today and are filled in by M2–M4 without the
   * order changing.
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

    h = writeInt32(h, this.treasure);
    h = writeInt32(h, this.silverKeys);
    h = writeInt32(h, this.goldKey ? 1 : 0);
    h = writeInt32(h, this.deaths);

    for (const e of this.entities) {
      h = writeInt32(h, e.type);
      h = writeInt32(h, e.x);
      h = writeInt32(h, e.y);
      h = writeInt32(h, e.hp);
      h = writeInt32(h, e.state);
      h = writeInt32(h, e.stateTimer);
    }
    for (const trap of this.traps) h = writeInt32(h, trap.phase);
    for (const door of this.doors) h = writeInt32(h, door.open);
    for (const flag of [...this.flags].sort()) h = writeInt32(h, hashString(flag));

    h = writeInt32(h, this.pendingWave);
    h = writeInt32(h, this.seal);

    return h;
  }
}
