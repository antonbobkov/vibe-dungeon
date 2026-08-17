import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { lintDirectory, lintFloorFile } from '../../tools/level-lint.js';
import type { FloorFile } from '../../src/sim/level.js';

const fixture = (name: string): FloorFile =>
  JSON.parse(readFileSync(`tests/fixtures/levels/${name}.json`, 'utf8')) as FloorFile;

const problems = (name: string): string[] => lintFloorFile(fixture(name)).problems;

describe('lint:levels on the real floors', () => {
  it('passes on all four', () => {
    const { problems: found, floors } = lintDirectory('levels');
    expect(found).toEqual([]);
    expect(floors.map((f) => f.id)).toEqual(['f1', 'f2', 'f3', 'f4']);
  });
});

// TESTING.md §4: a fixture per violation class keeps the linter itself honest.
describe('lint:levels on broken fixtures', () => {
  it('passes the control fixture, so the others fail for their own reason', () => {
    expect(problems('valid')).toEqual([]);
  });

  it('catches a hole in the perimeter', () => {
    expect(problems('hole-in-wall')).toContain(
      'f1/R1: perimeter hole at (0,3): "." is not a wall or door cell',
    );
  });

  it('catches a key/lock imbalance', () => {
    expect(problems('key-lock-imbalance')).toContain(
      'f1: has 0 silver key(s) but 1 silver door(s)',
    );
  });

  it('catches an enemy marker with no table entry', () => {
    expect(problems('unmatched-marker')).toContain(
      'f1/R1: marker "1" at (3,3) has no enemy table entry',
    );
  });

  it('catches a door endpoint that disagrees with the map', () => {
    expect(problems('door-endpoint-mismatch')).toContain(
      'f1/d1: endpoint R2 (1,0) should hold "D" but the map has "#"',
    );
  });

  it('catches a room outside the size bounds', () => {
    expect(problems('room-too-small')).toContain('f1/R3: is 4×3, outside the 5×4..20×12 bounds');
  });

  it('catches a rightward flame jet outside the leftmost column', () => {
    expect(problems('flame-wrong-column')).toContain(
      'f1/R1: ">" at (6,2) must sit in the leftmost column',
    );
  });

  it('reports each fixture as broken, not merely different', () => {
    for (const name of [
      'hole-in-wall',
      'key-lock-imbalance',
      'unmatched-marker',
      'door-endpoint-mismatch',
      'room-too-small',
      'flame-wrong-column',
    ]) {
      expect(problems(name).length, name).toBeGreaterThan(0);
    }
  });
});
