import { describe, expect, it } from 'vitest';

import { detect, snapshot, type GameEvent } from '../../src/game/events.js';
import {
  Effects,
  FLOAT_STAGGER,
  FLOAT_TICKS,
  PIT_DROP_TICKS,
  PUFF_TICKS,
  UNSHACKLE_DROP_PX,
  UNSHACKLE_TICKS,
  effectsFor,
} from '../../src/render/effects.js';
import { CHEST_OPEN_TICKS, TILE_SUBPX } from '../../src/sim/constants.js';
import { ATTACK, INTERACT, LEFT, RIGHT, UP } from '../../src/sim/input.js';
import { Facing } from '../../src/sim/player.js';
import type { Sim } from '../../src/sim/sim.js';
import { game, hold, runUntil } from './helpers.js';

/**
 * The event stream the presentation layer runs off (04-ui §5's cues, 02-entities §4's
 * flourishes). Each case drives the real sim to the moment in question and asks what the
 * tick reported, so these are also a second opinion on the sim's own behaviour.
 */

/** Run one tick and report what it did. */
function step(sim: Sim, input = 0): GameEvent[] {
  const before = snapshot(sim);
  sim.tick(input);
  return detect(before, snapshot(sim));
}

const names = (events: GameEvent[]): string[] => events.map((e) => e.name);

/**
 * Tick until an event turns up, and return the tick's whole list. ATTACK and INTERACT are
 * released every other tick so a held button keeps producing fresh presses (01 §4.1).
 */
function until(sim: Sim, input: number, name: string, budget = 400): GameEvent[] {
  for (let i = 0; i < budget; i++) {
    const events = step(sim, i % 2 === 0 ? input : input & ~(ATTACK | INTERACT));
    if (events.some((e) => e.name === name)) return events;
  }
  throw new Error(`no "${name}" event within ${budget} ticks`);
}

describe('the player', () => {
  it('reports a swing starting, and only on the tick it starts', () => {
    const s = game();
    expect(names(step(s, ATTACK))).toEqual(['sword']);
    expect(names(step(s, ATTACK))).toEqual([]); // still swinging, not a new swing
  });

  it('reports a hit when the blade takes an enemy’s HP, and the kill after it', () => {
    // f1 R2's skeleton, with the player set up beside it facing its way.
    const s = game({ roomId: 'R2', start: { x: 5 * TILE_SUBPX, y: 4 * TILE_SUBPX } });
    s.player.facing = Facing.R;

    const first = until(s, ATTACK, 'hit');
    expect(first).toContainEqual({ name: 'hit' });

    // Two HP: the second connect kills it.
    const killed = until(s, ATTACK, 'enemy_die');
    expect(names(killed)).toContain('enemy_die');
  });

  it('reports being hurt, and dying', () => {
    const s = game({ roomId: 'R2', start: { x: 6 * TILE_SUBPX, y: 4 * TILE_SUBPX }, hp: 1 });
    const hurt = until(s, 0, 'hurt', 200);
    expect(names(hurt)).toContain('hurt');
    // 01 §6: the death sequence takes over in a later player phase — the three ticks of
    // hit-stop the damage itself caused (01 §5.1) come first.
    expect(names(until(s, 0, 'death', 10))).toContain('death');
  });
});

describe('pickups', () => {
  it('tells a coin from a key from a flask (04-ui §5 has one cue for each)', () => {
    // f1 R1's coins sit at (4,2)(5,2)(4,3)(5,3); the player starts on (5,6).
    const s = game();
    expect(names(until(s, UP, 'coin', 200))).toEqual(['coin']);

    // f1 R4's flask at (5,5), and the mini chest's silver key in R3.
    const flask = game({ roomId: 'R4', start: { x: 5 * TILE_SUBPX, y: 6 * TILE_SUBPX }, hp: 2 });
    expect(names(until(flask, UP, 'flask', 200))).toContain('flask');
  });

  it('says nothing when a pickup appears rather than leaves', () => {
    const s = game({ roomId: 'R2', start: { x: 1 * TILE_SUBPX, y: 6 * TILE_SUBPX } });
    // Breaking a crate spawns its drop; that is not a collection.
    const before = snapshot(s);
    s.pickups.push({ at: [1, 1], kind: 'coin', fromMap: false });
    expect(names(detect(before, snapshot(s)))).toEqual([]);
  });
});

describe('props and doors', () => {
  it('reports a chest opening, with what was inside it (02 §4.1)', () => {
    const s = game({ roomId: 'R3', start: { x: 6 * TILE_SUBPX, y: 6 * TILE_SUBPX } });
    s.player.facing = Facing.U;

    const opened = until(s, INTERACT, 'chest', CHEST_OPEN_TICKS + 10);
    const chest = opened.find((e) => e.name === 'chest')!;
    expect(chest.at).toEqual([6, 5]);
    expect(chest.contents).toEqual(['silver_key']);
  });

  it('reports a crate coming apart, and one the pit swallowed (02 §4.2)', () => {
    const crate = game({ roomId: 'R2', start: { x: 2 * TILE_SUBPX, y: 3 * TILE_SUBPX } });
    crate.player.facing = Facing.U;
    const broken = until(crate, ATTACK, 'crate', 120);
    expect(broken.find((e) => e.name === 'crate')!.pit).toBeUndefined();

    // f3 R2: two shoves north put the crate in the trench.
    const pit = game({
      floorIndex: 2,
      roomId: 'R2',
      start: { x: 6 * TILE_SUBPX, y: 5 * TILE_SUBPX },
    });
    const swallowed = until(pit, UP, 'crate', 200);
    const event = swallowed.find((e) => e.name === 'crate')!;
    expect(event.pit).toBe(true);
    expect(event.at).toEqual([6, 2]);
  });

  it('reports a push starting and a torch catching', () => {
    const pit = game({
      floorIndex: 2,
      roomId: 'R2',
      start: { x: 6 * TILE_SUBPX, y: 5 * TILE_SUBPX },
    });
    expect(names(until(pit, UP, 'push', 60))).toContain('push');

    const shrine = game({
      floorIndex: 1,
      roomId: 'R4',
      start: { x: 2 * TILE_SUBPX, y: 3 * TILE_SUBPX },
    });
    shrine.player.facing = Facing.U;
    expect(names(until(shrine, INTERACT, 'torch', 60))).toContain('torch');
  });

  it('reports a windowed group going out again, with every member (02 §4.3)', () => {
    const s = game({
      floorIndex: 3,
      roomId: 'R3',
      start: { x: 1 * TILE_SUBPX, y: 3 * TILE_SUBPX },
    });
    s.player.y = 2 * TILE_SUBPX;
    s.player.facing = Facing.U;
    runUntil(
      s,
      INTERACT,
      (sim) => sim.litGroups.length > 0 || sim.props.some((p) => p.state === 5),
      60,
    );

    const reset = until(s, 0, 'torch_reset', 700);
    expect(reset.find((e) => e.name === 'torch_reset')!.cells).toEqual([[1, 1]]);
  });

  it('reports a door opening once, and a locked one being leant on', () => {
    const s = game();
    expect(names(until(s, UP, 'door', 200))).toContain('door');

    // f1 R2's silver door d3, with no key in hand.
    const locked = game({ roomId: 'R2', start: { x: 6 * TILE_SUBPX, y: 1 * TILE_SUBPX } });
    expect(names(until(locked, UP, 'locked', 60))).toContain('locked');
    expect(locked.isDoorOpen('d3')).toBe(false);
  });
});

/**
 * 01 §8.3. Chains hang on puzzle doors and on whatever a seal is holding — never on a keyed
 * door in an open room — so "the chains came off" is exactly "the door opened by event", and
 * needs no extra flag from the sim to tell it from a key turning.
 */
describe('chains coming off (01 §8.3)', () => {
  it('breaks both chains off a puzzle door on the tick its wiring fires', () => {
    // f2's G1: four torches in R4, which open the puzzle door d4 at (4,0)(5,0).
    const s = game({
      floorIndex: 1,
      roomId: 'R4',
      start: { x: 2 * TILE_SUBPX, y: 3 * TILE_SUBPX },
    });
    const seen: GameEvent[] = [];

    for (const [col, row] of s.torchGroups[0]!.members) {
      s.player.x = col * TILE_SUBPX;
      s.player.y = (row + 1) * TILE_SUBPX;
      s.player.facing = Facing.U;
      seen.push(...step(s, 0), ...step(s, INTERACT));
    }

    expect(s.isDoorOpen('d4')).toBe(true);
    const chains = seen.filter((e) => e.name === 'unshackle');
    expect(chains).toHaveLength(1);
    expect(chains[0]!.cells).toEqual([
      [4, 0],
      [5, 0],
    ]);
  });

  it('breaks them off every door in the room when a seal releases', () => {
    // f3 R6 seals on entry against three enemies, holding its one door d5 at (4,7)(5,7).
    const s = game({
      floorIndex: 2,
      roomId: 'R6',
      start: { x: 5 * TILE_SUBPX, y: 3 * TILE_SUBPX },
    });
    expect(s.seal).toBe(1);
    expect(snapshot(s).chained).toEqual([
      [4, 7],
      [5, 7],
    ]);

    s.entities = []; // the room is suddenly clear; the next tick lets the seal go
    const events = step(s, 0);
    expect(s.seal).toBe(0);

    const chains = events.filter((e) => e.name === 'unshackle');
    expect(chains).toHaveLength(1);
    expect(chains[0]!.cells).toEqual([
      [4, 7],
      [5, 7],
    ]);
  });

  it('breaks none when a key opens a door, and none for a normal door swinging open', () => {
    // The silver door d3, unlocked with a key in hand: a `door` event and nothing else.
    const silver = game({ roomId: 'R2', start: { x: 6 * TILE_SUBPX, y: 1 * TILE_SUBPX } });
    silver.inventory.silverKeys = 1;
    const unlocked = until(silver, UP, 'door', 60);
    expect(names(unlocked)).toContain('door');
    expect(names(unlocked)).not.toContain('unshackle');

    const normal = game();
    expect(names(until(normal, UP, 'door', 200))).not.toContain('unshackle');
  });

  it('says nothing when the player simply leaves a room full of chains', () => {
    const s = game({
      floorIndex: 1,
      roomId: 'R4',
      start: { x: 2 * TILE_SUBPX, y: 3 * TILE_SUBPX },
    });
    const before = snapshot(s);
    expect(before.chained).toEqual([
      [4, 0],
      [5, 0],
    ]);

    // R3 has no chains at all, so every one of them is gone from the drawn set — and none of
    // it is an unshackling.
    s.enterRoom(s.floor.roomIndex.get('R3')!, s.player.x, s.player.y, s.player.facing);
    expect(snapshot(s).chained).toEqual([]);
    expect(names(detect(before, snapshot(s)))).not.toContain('unshackle');
  });
});

describe('the room and the run', () => {
  it('reports a seal coming down and a wave telegraphing (01 §8.3, 02 §2.3)', () => {
    const s = game({
      floorIndex: 3,
      roomId: 'R4',
      start: { x: 1 * TILE_SUBPX, y: 5 * TILE_SUBPX },
    });
    // Both are already true on entry, so they show up as the first tick's changes.
    const before = { ...snapshot(s), seal: 0, telegraphs: 0 };
    expect(names(detect(before, snapshot(s)))).toEqual(['seal', 'wave']);
  });

  it('reports the descent and the victory', () => {
    const ladder = game({ roomId: 'R6', start: { x: 3 * TILE_SUBPX, y: 1 * TILE_SUBPX } });
    expect(names(until(ladder, UP, 'descend', 120))).toContain('descend');

    const vault = game({
      floorIndex: 3,
      roomId: 'R6',
      start: { x: 4 * TILE_SUBPX, y: 3 * TILE_SUBPX },
    });
    vault.player.facing = Facing.U;
    expect(names(until(vault, INTERACT, 'victory', 60))).toContain('victory');
  });

  it('says nothing about a room’s contents on the tick the player changes rooms', () => {
    const s = game();
    const events = until(s, UP, 'door', 200);
    expect(events.filter((e) => e.name === 'crate' || e.name === 'chest')).toEqual([]);

    // Walk on through: the new room's props and pickups are not events either.
    for (let i = 0; i < 60; i++) {
      const tickEvents = step(s, UP);
      expect(tickEvents.filter((e) => e.name === 'chest' || e.name === 'crate')).toEqual([]);
    }
    expect(s.roomId).toBe('R2');
  });
});

describe('the flourishes those events start (02 §4)', () => {
  it('floats a chest’s contents up in list order, ten ticks apart', () => {
    const effects = effectsFor({
      name: 'chest',
      at: [6, 5],
      contents: ['coin', 'coin', 'red_small'],
    });

    expect(effects).toHaveLength(3);
    expect(effects.map((e) => e.elapsed)).toEqual([0, -FLOAT_STAGGER, -2 * FLOAT_STAGGER]);
    expect(effects.map((e) => e.pickup)).toEqual(['coin', 'coin', 'red_small']);
    for (const effect of effects) {
      expect(effect.kind).toBe('float');
      expect(effect.total).toBe(FLOAT_TICKS);
      expect(effect.at).toEqual([6, 5]);
    }
  });

  it('drops a crate into the pit that took it, and puffs each reverted torch', () => {
    const drop = effectsFor({ name: 'crate', at: [6, 2], pit: true });
    expect(drop).toEqual([{ kind: 'pit_drop', at: [6, 2], elapsed: 0, total: PIT_DROP_TICKS }]);

    // A crate the sword broke has its own animation already; no effect.
    expect(effectsFor({ name: 'crate', at: [2, 2] })).toEqual([]);

    const puffs = effectsFor({
      name: 'torch_reset',
      cells: [
        [1, 1],
        [9, 1],
      ],
    });
    expect(puffs.map((p) => p.at)).toEqual([
      [1, 1],
      [9, 1],
    ]);
    expect(puffs.every((p) => p.kind === 'puff' && p.total === PUFF_TICKS)).toBe(true);
  });

  it('breaks each chain off with a drop and a puff on its own cell (01 §8.3)', () => {
    expect([UNSHACKLE_TICKS, UNSHACKLE_DROP_PX]).toEqual([10, 4]); // the pit-drop numbers

    const effects = effectsFor({
      name: 'unshackle',
      cells: [
        [4, 0],
        [5, 0],
      ],
    });
    expect(effects).toEqual([
      { kind: 'unshackle', at: [4, 0], elapsed: 0, total: UNSHACKLE_TICKS },
      { kind: 'puff', at: [4, 0], elapsed: 0, total: PUFF_TICKS },
      { kind: 'unshackle', at: [5, 0], elapsed: 0, total: UNSHACKLE_TICKS },
      { kind: 'puff', at: [5, 0], elapsed: 0, total: PUFF_TICKS },
    ]);
  });

  it('makes nothing of the events that are only sounds', () => {
    for (const name of ['sword', 'hit', 'hurt', 'coin', 'door', 'locked', 'seal'] as const) {
      expect(effectsFor({ name })).toEqual([]);
    }
  });

  it('retires each effect on the tick it runs out', () => {
    const effects = new Effects();
    effects.spawn([{ name: 'torch_reset', cells: [[1, 1]] }]);
    expect(effects.live).toHaveLength(1);

    for (let i = 0; i < PUFF_TICKS - 1; i++) effects.advance();
    expect(effects.live).toHaveLength(1);
    effects.advance();
    expect(effects.live).toHaveLength(0);
  });

  it('waits out a stagger before a float starts counting', () => {
    const effects = new Effects();
    effects.spawn([{ name: 'chest', at: [0, 0], contents: ['coin', 'coin'] }]);
    expect(effects.live.map((e) => e.elapsed)).toEqual([0, -FLOAT_STAGGER]);

    for (let i = 0; i < FLOAT_STAGGER; i++) effects.advance();
    expect(effects.live.map((e) => e.elapsed)).toEqual([FLOAT_STAGGER, 0]);
  });

  it('drops everything when the room changes', () => {
    const effects = new Effects();
    effects.spawn([{ name: 'chest', at: [0, 0], contents: ['coin'] }]);
    effects.clear();
    expect(effects.live).toEqual([]);
  });
});

describe('a quiet tick', () => {
  it('reports nothing at all', () => {
    const s = game();
    hold(s, 0, 5);
    expect(names(step(s, 0))).toEqual([]);
    expect(names(step(s, LEFT))).toEqual([]);
    expect(names(step(s, RIGHT))).toEqual([]);
  });
});
