import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The sim must run in Node (IMPLEMENTATION_PLAN "Architecture"); unit tests never
    // need a DOM.
    environment: 'node',
    include: ['tests/unit/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/sim/**'],
      // TESTING.md §1: coverage floor 90% line coverage on src/sim/.
      thresholds: { lines: 90 },
    },
  },
});
