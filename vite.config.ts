import { defineConfig } from 'vite';

// The art packs live outside src/ and are never committed (CLAUDE.md); allow the dev
// server to serve them so the M6 asset loader can fetch real art locally.
export default defineConfig({
  root: '.',
  build: { target: 'esnext', outDir: 'dist' },
  server: { fs: { allow: ['.', './art_assets'] } },
});
