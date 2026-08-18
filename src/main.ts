/**
 * Browser bootstrap.
 *
 * At M2 this runs the sim at a fixed timestep and draws the debug view, so the 26 rooms can
 * be walked and checked by eye. M6 replaces the renderer with real Pack A art and adds the
 * HUD, screens and replay injection hook; the loop and the input mapping stay.
 */

import { loadAtlas } from './assets/loader.js';
import { drawDebug } from './render/debug.js';
import { drawWorld } from './render/world.js';
import { CLEAR_COLOR, TICK_RATE, VIEW_H, VIEW_W } from './sim/constants.js';
import { ATTACK, DOWN, INTERACT, LEFT, RIGHT, UP } from './sim/input.js';
import { loadFloor, type FloorFile } from './sim/level.js';
import { Sim } from './sim/sim.js';

const element = document.getElementById('game');
if (!(element instanceof HTMLCanvasElement)) {
  throw new Error('main: #game canvas is missing from index.html');
}
const canvas: HTMLCanvasElement = element;

canvas.width = VIEW_W;
canvas.height = VIEW_H;

const context = canvas.getContext('2d');
if (!context) throw new Error('main: 2D canvas context unavailable');
const ctx: CanvasRenderingContext2D = context;
ctx.imageSmoothingEnabled = false;

/** `scale = floor(min(winW/320, winH/208))`, min 1, centred with black bars (00-overview). */
function fitToWindow(): void {
  const scale = Math.max(1, Math.floor(Math.min(innerWidth / VIEW_W, innerHeight / VIEW_H)));
  canvas.style.width = `${VIEW_W * scale}px`;
  canvas.style.height = `${VIEW_H * scale}px`;
}

addEventListener('resize', fitToWindow);
fitToWindow();

ctx.fillStyle = CLEAR_COLOR;
ctx.fillRect(0, 0, VIEW_W, VIEW_H);

// --- input (01 §2) ---------------------------------------------------------

const BINDINGS: Record<string, number> = {
  ArrowUp: UP,
  KeyW: UP,
  ArrowDown: DOWN,
  KeyS: DOWN,
  ArrowLeft: LEFT,
  KeyA: LEFT,
  ArrowRight: RIGHT,
  KeyD: RIGHT,
  KeyX: ATTACK,
  KeyJ: ATTACK,
  KeyZ: INTERACT,
  KeyK: INTERACT,
  KeyE: INTERACT,
};

let held = 0;

addEventListener('keydown', (event) => {
  const bit = BINDINGS[event.code];
  if (bit === undefined) return;
  held |= bit;
  event.preventDefault();
});

addEventListener('keyup', (event) => {
  const bit = BINDINGS[event.code];
  if (bit === undefined) return;
  held &= ~bit;
  event.preventDefault();
});

// --- the fixed-timestep loop (00-overview §Determinism rule 1) --------------

const FRAME_MS = 1000 / TICK_RATE;
/** Never simulate more than this many ticks in one frame, so a stall cannot spiral. */
const MAX_CATCH_UP = 5;

async function boot(): Promise<void> {
  const ids = ['f1', 'f2', 'f3', 'f4'] as const;
  const floors = await Promise.all(
    ids.map(async (id) => {
      const response = await fetch(`levels/${id}.json`);
      return loadFloor((await response.json()) as FloorFile);
    }),
  );

  const atlas = await loadAtlas({ onFallback: (why) => console.info(`main: ${why}`) });
  const debug = new URLSearchParams(location.search).has('debug');

  const sim = new Sim(floors);
  let previous = performance.now();
  let accumulator = 0;

  const frame = (now: number): void => {
    accumulator += now - previous;
    previous = now;

    let ticks = 0;
    while (accumulator >= FRAME_MS && ticks < MAX_CATCH_UP) {
      sim.tick(held);
      accumulator -= FRAME_MS;
      ticks++;
    }
    if (accumulator > FRAME_MS * MAX_CATCH_UP) accumulator = 0;

    ctx.fillStyle = CLEAR_COLOR;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (debug) drawDebug(ctx, sim);
    else drawWorld(ctx, atlas, sim);

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

boot().catch((error: unknown) => {
  console.error('main: boot failed', error);
});
