import { describe, expect, it } from 'vitest';

import {
  ATTACK_MS,
  CUE_NAMES,
  MASTER_GAIN,
  MUTE_KEY,
  cueLength,
  notesFor,
  type CueName,
  type Note,
} from '../../src/audio/cues.js';
import type { EventName } from '../../src/game/events.js';

/**
 * spec/04-ui.md §5's cue table, row for row. No audio assets exist for this project, so the
 * table *is* the sound design: if a number here drifts, the game stops sounding like the
 * spec and nothing else would notice.
 */

const notes = (cue: CueName): Note[] => [...notesFor(cue)!];

/** A compact way to state the spec's rows: voice, from→to Hz, start ms, length ms. */
const shape = (cue: CueName): string[] =>
  notes(cue).map(
    (n) =>
      `${n.voice} ${n.from}${n.to === n.from ? '' : `→${n.to}`} @${round(n.start)}+${round(n.ms)}`,
  );

const round = (value: number): number => Math.round(value * 100) / 100;

describe('the cue table (04-ui §5)', () => {
  it('has all eighteen cues, and nothing else', () => {
    expect(CUE_NAMES).toHaveLength(18);
    expect([...CUE_NAMES].sort()).toEqual(
      [
        'chest',
        'coin',
        'crate',
        'death',
        'descend',
        'door',
        'enemy_die',
        'flask',
        'hit',
        'hurt',
        'key',
        'locked',
        'push',
        'seal',
        'sword',
        'torch',
        'victory',
        'wave',
      ].sort(),
    );
  });

  it('plays each row exactly as the table states it', () => {
    expect(shape('sword')).toEqual(['square 180→90 @0+70']);
    expect(shape('hit')).toEqual(['square 110 @0+60', 'noise 0 @0+40']);
    expect(shape('hurt')).toEqual(['sawtooth 140→70 @0+150']);
    expect(shape('coin')).toEqual(['square 880 @0+40', 'square 1320 @40+60']);
    expect(shape('flask')).toEqual(['triangle 520→780 @0+120']);
    expect(shape('door')).toEqual(['square 220 @0+100', 'square 110 @100+100']);
    expect(shape('locked')).toEqual(['square 98 @0+80']);
    expect(shape('crate')).toEqual(['noise 0 @0+80']);
    expect(shape('push')).toEqual(['triangle 90 @0+100']);
    expect(shape('torch')).toEqual(['triangle 700 @0+60']);
    expect(shape('seal')).toEqual(['square 98 @0+200']);
    expect(shape('wave')).toEqual(['triangle 440 @0+80']);
    expect(shape('enemy_die')).toEqual(['square 260→65 @0+180']);
    expect(shape('death')).toEqual(['sawtooth 220→55 @0+500']);
    expect(shape('descend')).toEqual(['triangle 330→165 @0+300']);
  });

  it('splits an arp into equal notes filling the stated total', () => {
    expect(shape('key')).toEqual([
      'triangle 660 @0+50',
      'triangle 880 @50+50',
      'triangle 1100 @100+50',
    ]);
    expect(shape('chest')).toEqual([
      'triangle 523 @0+66.67',
      'triangle 659 @66.67+66.67',
      'triangle 784 @133.33+66.67',
    ]);
    expect(shape('victory')).toEqual([
      'square 523 @0+125',
      'square 659 @125+125',
      'square 784 @250+125',
      'square 1046 @375+125',
    ]);
  });

  it('lasts exactly as long as the table says', () => {
    const lengths: Record<string, number> = {
      sword: 70,
      hit: 60,
      hurt: 150,
      coin: 100,
      key: 150,
      flask: 120,
      door: 200,
      locked: 80,
      chest: 200,
      crate: 80,
      push: 100,
      torch: 60,
      seal: 200,
      wave: 80,
      enemy_die: 180,
      death: 500,
      descend: 300,
      victory: 500,
    };
    for (const cue of CUE_NAMES) expect(round(cueLength(cue)), cue).toBe(lengths[cue]);
  });

  it('keeps the master gain and attack the spec sets', () => {
    expect(MASTER_GAIN).toBe(0.2);
    expect(ATTACK_MS).toBe(5);
    expect(MUTE_KEY).toBe('undervault.muted');
  });
});

describe('events that make no sound', () => {
  const silent: EventName[] = ['torch_reset', 'unshackle'];

  it('leaves the torch-group reset silent — it is a puff, not a cue (02 §4.3)', () => {
    expect(notesFor('torch_reset')).toBeNull();
  });

  it('leaves the chains silent too — `door` and `seal` already speak for it (01 §8.3)', () => {
    expect(notesFor('unshackle')).toBeNull();
  });

  it('has a cue for every other event the game raises', () => {
    const everyEvent: EventName[] = [...CUE_NAMES, ...silent];
    for (const event of everyEvent) {
      if (silent.includes(event)) continue;
      expect(notesFor(event), event).not.toBeNull();
      expect(notesFor(event)!.length, event).toBeGreaterThan(0);
    }
  });
});
