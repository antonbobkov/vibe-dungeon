/**
 * What just happened — the one place the presentation layer asks it.
 *
 * The sim reports state, not events. Rather than thread callbacks through it, this module
 * takes a cheap snapshot either side of a tick and works out what changed: a swing started, a
 * blade connected, a coin was taken, a seal came down. Audio (04-ui §5) plays the result and
 * the renderer's transient effects (02-entities §4) are spawned from it, so both are driven by
 * one description of the tick rather than two sets of guesses.
 *
 * Pure: two plain objects in, a list out. No canvas, no WebAudio, no sim mutation.
 */

import { EnemyState } from '../sim/enemy.js';
import type { Cell, PickupName, PropKind } from '../sim/level.js';
import { PlayerState } from '../sim/player.js';
import { PropState } from '../sim/prop.js';
import type { Script, Sim } from '../sim/sim.js';

/** 04-ui §5's cue names, plus the two events that are visual only. */
export type EventName =
  | 'sword'
  | 'hit'
  | 'hurt'
  | 'coin'
  | 'key'
  | 'flask'
  | 'door'
  | 'locked'
  | 'chest'
  | 'crate'
  | 'push'
  | 'torch'
  | 'seal'
  | 'wave'
  | 'enemy_die'
  | 'death'
  | 'descend'
  | 'victory'
  /** A windowed torch group timing out — a smoke puff, and no sound (02 §4.3). */
  | 'torch_reset';

export interface GameEvent {
  name: EventName;
  /** Where it happened, for the effects that need a tile. */
  at?: Cell;
  /** A chest's contents, for the float-up of 02 §4.1. */
  contents?: PickupName[];
  /** Every member of a torch group that reverted. */
  cells?: Cell[];
  /** The pit-drop flavour of `crate` (02 §4.2) rather than the sword one. */
  pit?: boolean;
}

interface EntitySnapshot {
  id: number;
  hp: number;
  state: EnemyState;
}

interface PropSnapshot {
  at: Cell;
  /** The map cell — a prop's identity, since a pushed crate's `at` moves under it. */
  origin: Cell;
  kind: PropKind;
  state: PropState;
  slideTo: Cell | null;
  contents: PickupName[];
}

export interface Snapshot {
  floorIndex: number;
  roomIndex: number;
  hp: number;
  playerState: PlayerState;
  victory: boolean;
  seal: number;
  telegraphs: number;
  script: Script['kind'] | null;
  doorOpen: boolean[];
  /** How many of each pickup kind are still on the floor of this room. */
  pickups: Partial<Record<PickupName, number>>;
  entities: EntitySnapshot[];
  props: PropSnapshot[];
  /** The sim's own per-tick trigger queues, which already say exactly what happened. */
  openedChests: Cell[];
  lockedBumps: string[];
}

export function snapshot(sim: Sim): Snapshot {
  const pickups: Partial<Record<PickupName, number>> = {};
  for (const pickup of sim.pickups) pickups[pickup.kind] = (pickups[pickup.kind] ?? 0) + 1;

  return {
    floorIndex: sim.floorIndex,
    roomIndex: sim.roomIndex,
    hp: sim.player.hp,
    playerState: sim.player.state,
    victory: sim.victory,
    seal: sim.seal,
    telegraphs: sim.telegraphs.length,
    script: sim.script?.kind ?? null,
    doorOpen: [...sim.doorOpen],
    pickups,
    entities: sim.entities.map((e) => ({ id: e.id, hp: e.hp, state: e.state })),
    props: sim.props.map((p) => ({
      at: p.at,
      origin: p.origin,
      kind: p.kind,
      state: p.state,
      slideTo: p.slideTo,
      contents: p.contents,
    })),
    openedChests: [...sim.openedChests],
    lockedBumps: [...sim.lockedBumps],
  };
}

const PICKUP_CUE: Readonly<Record<PickupName, EventName>> = {
  coin: 'coin',
  silver_key: 'key',
  gold_key: 'key',
  red_small: 'flask',
  red_large: 'flask',
  blue_small: 'flask',
  blue_large: 'flask',
};

/**
 * Everything that happened between two snapshots, in a fixed order so the same tick always
 * produces the same list.
 *
 * Room-scoped collections — pickups, props, enemies — are only compared when the player is
 * still in the same room: on a transition they all change at once, and none of it is an
 * event.
 */
export function detect(before: Snapshot, after: Snapshot): GameEvent[] {
  const events: GameEvent[] = [];
  const sameRoom = before.floorIndex === after.floorIndex && before.roomIndex === after.roomIndex;

  // --- the player ---------------------------------------------------------
  if (before.playerState !== PlayerState.SWING && after.playerState === PlayerState.SWING) {
    events.push({ name: 'sword' });
  }
  if (after.hp < before.hp) events.push({ name: 'hurt' });
  if (before.playerState !== PlayerState.DYING && after.playerState === PlayerState.DYING) {
    events.push({ name: 'death' });
  }

  // --- what the blade reached ---------------------------------------------
  if (sameRoom) {
    const was = new Map(before.entities.map((e) => [e.id, e]));
    let connected = false;
    for (const entity of after.entities) {
      const previous = was.get(entity.id);
      if (!previous) continue;
      // Only the sword damages an enemy (02 §2.1), so a drop in HP is a connect.
      if (entity.hp < previous.hp) connected = true;
      if (previous.state !== EnemyState.DYING && entity.state === EnemyState.DYING) {
        events.push({ name: 'enemy_die' });
      }
    }
    if (connected) events.push({ name: 'hit' });
  }

  // --- pickups ------------------------------------------------------------
  if (sameRoom) {
    for (const [kind, count] of Object.entries(before.pickups) as [PickupName, number][]) {
      const left = after.pickups[kind] ?? 0;
      if (left < count) events.push({ name: PICKUP_CUE[kind] });
    }
  }

  // --- props --------------------------------------------------------------
  if (sameRoom) {
    // Keyed by origin: a crate that finished a push is the same crate on a different tile.
    const key = (cell: Cell): string => `${cell[0]},${cell[1]}`;
    const was = new Map(before.props.map((p) => [key(p.origin), p]));
    const now = new Map(after.props.map((p) => [key(p.origin), p]));

    for (const prop of after.props) {
      const previous = was.get(key(prop.origin));
      if (!previous) continue;
      if (previous.state !== PropState.SLIDING && prop.state === PropState.SLIDING) {
        events.push({ name: 'push', at: prop.at });
      }
      if (previous.state !== PropState.LIT && prop.state === PropState.LIT) {
        events.push({ name: 'torch', at: prop.at });
      }
    }

    // A prop that is simply gone: a crate the sword finished, or one a pit swallowed.
    const reverted: Cell[] = [];
    for (const prop of before.props) {
      if (prop.state === PropState.LIT && now.get(key(prop.origin))?.state === PropState.IDLE) {
        reverted.push(prop.at);
      }
      if (now.has(key(prop.origin))) continue;
      if (prop.state === PropState.DESTROYING) events.push({ name: 'crate', at: prop.at });
      if (prop.state === PropState.SLIDING) {
        events.push({ name: 'crate', at: prop.slideTo ?? prop.at, pit: true });
      }
    }
    if (reverted.length > 0) events.push({ name: 'torch_reset', cells: reverted });
  }

  // --- the room's own bookkeeping ------------------------------------------
  for (const at of after.openedChests) {
    const chest = before.props.find((p) => p.at[0] === at[0] && p.at[1] === at[1]);
    events.push({ name: 'chest', at, contents: chest?.contents ?? [] });
  }
  if (after.lockedBumps.length > 0) events.push({ name: 'locked' });

  if (before.floorIndex === after.floorIndex) {
    for (const [index, open] of after.doorOpen.entries()) {
      if (open && before.doorOpen[index] === false) events.push({ name: 'door' });
    }
  }

  if (before.seal === 0 && after.seal === 1) events.push({ name: 'seal' });
  if (before.telegraphs === 0 && after.telegraphs > 0) events.push({ name: 'wave' });
  if (before.script !== 'descend' && after.script === 'descend') events.push({ name: 'descend' });
  if (!before.victory && after.victory) events.push({ name: 'victory' });

  return events;
}
