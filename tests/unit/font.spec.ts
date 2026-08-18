import { describe, expect, it } from 'vitest';

import {
  GLYPH_CHARS,
  GLYPH_H,
  GLYPH_W,
  LETTER_SPACING,
  SPACE_ADVANCE,
  advance,
  centredX,
  glyphRows,
  hasGlyph,
  textWidth,
} from '../../src/render/font.js';
import { VIEW_W } from '../../src/sim/constants.js';

/** 04-ui §4: a 3×5 bitmap font, capitals and digits, 1 px letter spacing. */

const EVERY_CHARACTER_IN_THE_SPEC = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...'0123456789', ...'.:/-!'];

describe('the glyph table', () => {
  it('has exactly the characters 04-ui §4 lists, and no others', () => {
    expect([...GLYPH_CHARS].sort()).toEqual([...EVERY_CHARACTER_IN_THE_SPEC].sort());
  });

  it.each(EVERY_CHARACTER_IN_THE_SPEC)('draws "%s" as 5 rows of 3', (ch) => {
    const rows = glyphRows(ch);
    expect(rows).toHaveLength(GLYPH_H);
    for (const row of rows) {
      expect(row).toHaveLength(GLYPH_W);
      expect(row).toMatch(/^[.#]{3}$/);
    }
  });

  it('reproduces a few glyphs pixel for pixel', () => {
    expect(glyphRows('A')).toEqual(['.#.', '#.#', '###', '#.#', '#.#']);
    expect(glyphRows('1')).toEqual(['.#.', '##.', '.#.', '.#.', '###']);
    expect(glyphRows('2')).toEqual(['###', '..#', '###', '#..', '###']);
    expect(glyphRows(':')).toEqual(['...', '.#.', '...', '.#.', '...']);
  });

  it('is a hard error on a character it does not have', () => {
    expect(hasGlyph('a')).toBe(false);
    expect(() => glyphRows('a')).toThrow(/no glyph/);
    expect(() => glyphRows('%')).toThrow(/no glyph/);
  });

  it('tells F1 from F2 on their top-right pixel, which the e2e reads', () => {
    // The HUD floor label is the only place the game draws a digit that changes on its own.
    expect(glyphRows('1')[0]).toBe('.#.');
    expect(glyphRows('2')[0]).toBe('###');
  });
});

describe('measuring text', () => {
  it('advances 3 px plus a pixel of spacing per glyph, and 3 px for a space', () => {
    expect(advance('A')).toBe(GLYPH_W + LETTER_SPACING);
    expect(advance(' ')).toBe(SPACE_ADVANCE);
  });

  it('measures a line as the pen travel, less the trailing spacing', () => {
    expect(textWidth('')).toBe(0);
    expect(textWidth('A')).toBe(3);
    expect(textWidth('AB')).toBe(7);
    expect(textWidth('A B')).toBe(10);
    expect(textWidth('UNDERVAULT')).toBe(39); // 10 glyphs: 10×4 − 1
  });

  it('scales by whole pixels', () => {
    expect(textWidth('UNDERVAULT', 3)).toBe(117);
    expect(textWidth('A', 2)).toBe(6);
  });

  it('centres a line in the 320 px screen (04-ui §3)', () => {
    expect(centredX('UNDERVAULT', VIEW_W, 3)).toBe(Math.floor((320 - 117) / 2));
    expect(centredX('PAUSED', VIEW_W, 2)).toBe(Math.floor((320 - textWidth('PAUSED', 2)) / 2));
  });
});
