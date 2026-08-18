import { defineConfig } from 'vitest/config';

/**
 * `npm run bench` — TESTING.md §6. Kept out of the unit run because it is a measurement, not
 * an assertion about behaviour: it takes seconds rather than milliseconds and it is the one
 * suite whose result depends on the machine it runs on.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/bench/**/*.bench.ts'],
    // One replay of the whole game, timed tick by tick.
    testTimeout: 120_000,
  },
});
