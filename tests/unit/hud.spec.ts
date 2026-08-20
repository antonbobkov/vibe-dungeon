import { describe, expect, it } from 'vitest';

import { textWidth } from '../../src/render/font.js';
import { floorLabelOrigin, heartStates } from '../../src/render/hud.js';
import {
  TREASURE_TOTAL,
  VICTORY_FADE_TICKS,
  VICTORY_HOLD_TICKS,
  formatTime,
  statLines,
} from '../../src/render/screens.js';
import { MAX_HP, TICK_RATE } from '../../src/sim/constants.js';

/** The parts of 04-ui the renderer decides rather than draws. */

describe('the hearts (04-ui §1, §2)', () => {
  it('shows three hearts at two HP each, halves included', () => {
    expect(heartStates(6)).toEqual(['full', 'full', 'full']);
    expect(heartStates(5)).toEqual(['full', 'full', 'half']);
    expect(heartStates(4)).toEqual(['full', 'full', 'empty']);
    expect(heartStates(3)).toEqual(['full', 'half', 'empty']);
    expect(heartStates(2)).toEqual(['full', 'empty', 'empty']);
    expect(heartStates(1)).toEqual(['half', 'empty', 'empty']);
    expect(heartStates(0)).toEqual(['empty', 'empty', 'empty']);
  });

  it('covers the whole HP range the player can be in', () => {
    expect(MAX_HP).toBe(6);
    for (let hp = 0; hp <= MAX_HP; hp++) expect(heartStates(hp)).toHaveLength(3);
  });
});

describe('the floor label', () => {
  it('is right-aligned to x=316 (04-ui §1)', () => {
    expect(floorLabelOrigin(1)).toEqual({ x: 316 - textWidth('F1'), y: 6 });
    expect(floorLabelOrigin(4).x + textWidth('F4')).toBe(316);
  });
});

describe('the victory stats (04-ui §3.3)', () => {
  it('formats play ticks as zero-padded MM:SS', () => {
    expect(formatTime(0)).toBe('TIME 00:00');
    expect(formatTime(TICK_RATE * 9)).toBe('TIME 00:09');
    expect(formatTime(TICK_RATE * 65)).toBe('TIME 01:05');
    expect(formatTime(9934)).toBe('TIME 02:45'); // the M5 full-game replay
  });

  it('reports deaths and treasure against the whole economy of 03 §6', () => {
    expect(TREASURE_TOTAL).toBe(83);
    expect(statLines({ playTicks: 9934, deaths: 0, treasure: 81 })).toEqual([
      'TIME 02:45',
      'DEATHS 0',
      'TREASURE 81/83',
    ]);
  });

  it('holds on the chest for a second before fading for a second', () => {
    expect(VICTORY_HOLD_TICKS).toBe(60);
    expect(VICTORY_FADE_TICKS).toBe(60);
  });
});
