import { defineConfig } from 'vite';

// The art packs live outside src/ and are never committed (CLAUDE.md); allow the dev
// server to serve them so the M6 asset loader can fetch real art locally.
export default defineConfig({
  root: '.',
  // GitHub Pages serves a project site under /<repo>/, so the published build needs its URLs
  // rewritten. `npm run build:site` sets this; dev, e2e and the visual goldens all stay at /.
  base: process.env['BASE_PATH'] ?? '/',
  // TESTING.md §5: the e2e runs the real build with synthesized art, because CI has no
  // packs. The loader reads this at boot; without it, it falls back on its own if the
  // tileset is missing.
  define: { __PLACEHOLDER_ART__: JSON.stringify(process.env['PLACEHOLDER_ART'] === '1') },
  build: { target: 'esnext', outDir: 'dist' },
  server: { fs: { allow: ['.', './art_assets'] } },
});
