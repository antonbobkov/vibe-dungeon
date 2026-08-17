/**
 * Props — spec/02-entities.md §4: chests, crates and puzzle torches.
 *
 * Props stay tile-locked. The room's tile grid remains what collision reads, and these
 * objects carry the state the grid cannot: how far a chest has opened, how long a crate has
 * been coming apart, which tile a pushed crate is sliding toward.
 */

import { CHEST_OPEN_TICKS, CRATE_DESTROY_TICKS, PUSH_SLIDE_TICKS } from './constants.js';
import type { Cell, LoadedProp, LoadedTorchGroup, PickupName, PropKind } from './level.js';
import { Dir8 } from './geometry.js';

/** 02 §4's prop states. Chests open, crates break or slide, torches light. */
export enum PropState {
  IDLE = 0,
  OPENING = 1,
  OPEN = 2,
  DESTROYING = 3,
  SLIDING = 4,
  LIT = 5,
}

export interface SimProp {
  /** The tile it occupies; a sliding crate keeps this until the slide finishes. */
  at: Cell;
  /** Where the map put it. A pushed crate moves; what the floor remembers is keyed here. */
  origin: Cell;
  kind: PropKind;
  state: PropState;
  /** Ticks left in a timed state (opening, breaking, sliding). */
  timer: number;
  contents: PickupName[];
  drop: PickupName | null;
  /** Where a pushed crate is going. Both tiles stay solid until it arrives (02 §4.2). */
  slideTo: Cell | null;
  /** Consecutive contact ticks in `chargeDir`, toward the 6 a push needs. */
  charge: number;
  chargeDir: Dir8 | null;
}

/** Torch-group progress for the current room (02 §4.3). */
export interface SimTorchGroup {
  id: string;
  members: Cell[];
  window: number | null;
  /** Ticks since the first member was lit; −1 while none is. */
  timer: number;
}

export const isChest = (kind: PropKind): boolean => kind === 'chest' || kind === 'mini_chest';
export const isBreakable = (kind: PropKind): boolean =>
  kind === 'crate_wood' || kind === 'crate_steel';

/** Everything 02 §4 calls a prop is solid, including the unlit torch stand. */
export const isSolidProp = (prop: SimProp): boolean => prop.state !== PropState.DESTROYING;

export function createProp(def: LoadedProp): SimProp {
  return {
    at: def.at,
    origin: def.at,
    kind: def.kind,
    state: PropState.IDLE,
    timer: 0,
    contents: def.contents,
    drop: def.drop,
    slideTo: null,
    charge: 0,
    chargeDir: null,
  };
}

export function createTorchGroup(def: LoadedTorchGroup): SimTorchGroup {
  return { id: def.id, members: def.members, window: def.window, timer: -1 };
}

/** A chest the player has interacted with (02 §4.1). */
export function openChest(prop: SimProp): void {
  if (!isChest(prop.kind) || prop.state !== PropState.IDLE) return;
  prop.state = PropState.OPENING;
  prop.timer = CHEST_OPEN_TICKS;
}

/** A crate the sword has connected with (02 §4.2). Pushable crates ignore it. */
export function breakCrate(prop: SimProp): boolean {
  if (!isBreakable(prop.kind) || prop.state !== PropState.IDLE) return false;
  prop.state = PropState.DESTROYING;
  prop.timer = CRATE_DESTROY_TICKS;
  return true;
}

/** A push that has charged its six ticks (02 §4.2). */
export function startSlide(prop: SimProp, to: Cell): void {
  prop.state = PropState.SLIDING;
  prop.timer = PUSH_SLIDE_TICKS;
  prop.slideTo = to;
  prop.charge = 0;
  prop.chargeDir = null;
}

/** True when a torch belongs to this group. */
export function groupHas(group: SimTorchGroup, at: Cell): boolean {
  return group.members.some(([col, row]) => col === at[0] && row === at[1]);
}

/**
 * Where a push would take a crate. Only cardinal directions push (02 §4.2), so a diagonal
 * walk pushes along whichever component actually meets the crate.
 */
export function slideTarget(at: Cell, dir: Dir8): Cell | null {
  switch (dir) {
    case Dir8.L:
      return [at[0] - 1, at[1]];
    case Dir8.R:
      return [at[0] + 1, at[1]];
    case Dir8.U:
      return [at[0], at[1] - 1];
    case Dir8.D:
      return [at[0], at[1] + 1];
    default:
      return null; // diagonals never push
  }
}
