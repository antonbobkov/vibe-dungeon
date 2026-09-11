/**
 * `npm run build:site` — assemble a complete, self-contained site in `dist/`.
 *
 * `vite build` alone emits only `index.html` and the bundle: the levels are fetched at
 * runtime from `levels/`, and the art from `art_assets/`, neither of which Vite copies
 * (they are not in `public/`). A deploy of that is a black screen — the level fetch 404s
 * before the first frame.
 *
 * So this script builds, then copies in exactly what the game asks the server for:
 *
 *   - `levels/f1..f4.json`, the four floors;
 *   - the art files the Pack A manifest names, and nothing else. Not the packs — the two
 *     sheets and the ~120 animation frames [packA.ts](../src/assets/packA.ts) lists, which is
 *     what shipping a game means, as opposed to redistributing an asset pack. CLAUDE.md's
 *     rule stands either way: none of it is ever committed to the source tree.
 *
 * `--base vibe-dungeon` rewrites the bundle's URLs for a GitHub Pages project site, which is
 * served from a subdirectory rather than the server root. Give it the bare repo name: a
 * leading slash is what Git Bash rewrites into a Windows path behind your back.
 */

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { ANIMS, ART_ROOT } from '../src/assets/packA.js';

const DIST = 'dist';
const ART_DIR = 'art_assets';
const LEVELS = ['f1', 'f2', 'f3', 'f4'];

/** The two sheets the loader always fetches, whatever the levels contain. */
const SHEETS = [
  `${ART_ROOT}/character and tileset/Dungeon_Tileset.png`,
  `${ART_ROOT}/character and tileset/Dungeon_Character.png`,
];

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * `vibe-dungeon` → `/vibe-dungeon/`. Also undoes MSYS path conversion, which turns a
 * `--base /vibe-dungeon/` typed in Git Bash into `C:/Program Files/Git/vibe-dungeon/` — a
 * base that builds without complaint and 404s everywhere once deployed.
 */
export function normaliseBase(raw: string): string {
  const name = raw.replace(/^[A-Za-z]:[\/].*?([^\/]+)[\/]?$/, '$1').replace(/^\/+|\/+$/g, '');
  return name === '' ? '/' : `/${name}/`;
}

/** Every art path the game will ask for, in manifest order. */
export function artManifest(): string[] {
  const frames = ANIMS.flatMap((def) => def.frames.map((file) => `${def.dir}/${file}`));
  return [...SHEETS, ...new Set(frames)];
}

function copyInto(from: string, to: string): number {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  return statSync(to).size;
}

function main(): void {
  const base = normaliseBase(flag('--base') ?? '/');

  rmSync(DIST, { recursive: true, force: true });

  const build = spawnSync('npx', ['vite', 'build'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, BASE_PATH: base },
  });
  if (build.status !== 0) process.exit(build.status ?? 1);

  // The levels, which the sim loads before the first tick.
  for (const id of LEVELS)
    copyInto(join('levels', `${id}.json`), join(DIST, 'levels', `${id}.json`));

  // The art, if this machine has the packs. Without them the loader draws its placeholder
  // tiles, which is a working game and exactly what CI publishes.
  const wanted = artManifest();
  let bytes = 0;
  const missing: string[] = [];
  for (const path of wanted) {
    const from = join(ART_DIR, path);
    if (!existsSync(from)) {
      missing.push(path);
      continue;
    }
    bytes += copyInto(from, join(DIST, ART_DIR, path));
  }

  // Pages runs Jekyll otherwise, which drops anything beginning with an underscore.
  writeFileSync(join(DIST, '.nojekyll'), '');

  const copied = wanted.length - missing.length;
  console.log(`\nbuild:site: base ${base}`);
  console.log(`  levels   ${LEVELS.length} files`);
  console.log(
    missing.length === 0
      ? `  art      ${copied} files, ${(bytes / 1024).toFixed(0)} kB`
      : `  art      ${copied}/${wanted.length} files — ${missing.length} missing, the site will draw placeholder art`,
  );
  if (missing.length > 0 && missing.length < wanted.length) {
    console.warn(`  first missing: ${missing[0]}`);
  }
  console.log(`  total    ${(dirSize(DIST) / 1024).toFixed(0)} kB in ${DIST}/`);
}

function dirSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(path) : statSync(path).size;
  }
  return total;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main();
}
