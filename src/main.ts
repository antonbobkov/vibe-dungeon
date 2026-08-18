/**
 * Browser bootstrap: the canvas, the keyboard, and the fixed-timestep loop.
 *
 * Everything about *what* is on screen belongs to `App` (04-ui §3's screens) and the render
 * modules; this file owns only the wiring — the accumulator that keeps the sim at exactly
 * 60 Hz however fast the display refreshes (00-overview determinism rule 1), the 01 §2 key
 * bindings, and the integer scaling of AG §7.10.
 */

import { App } from './app.js';
import { loadAtlas } from './assets/loader.js';
import { CLEAR_COLOR, TICK_RATE, VIEW_H, VIEW_W } from './sim/constants.js';
import { ATTACK, DOWN, INTERACT, LEFT, RIGHT, UP } from './sim/input.js';
import { loadFloor, type FloorFile } from './sim/level.js';

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

const PAUSE_KEYS = new Set(['Escape', 'KeyP']);

/** What is physically down, and what has been down at any point since the last tick. */
let held = 0;
let latched = 0;
/** Set by the test hook: the loop keeps drawing but stops advancing time. */
let frozen = false;

/**
 * One tick's input latch. A tap shorter than a frame — which is what a synthetic key press
 * is, and what a fast human tap can be — would otherwise fall between two ticks and never be
 * seen at all, so a press survives in `latched` until exactly one tick has consumed it.
 */
function takeInput(): number {
  const input = latched;
  latched = held;
  return input;
}

// --- the fixed-timestep loop (00-overview §Determinism rule 1) --------------

const FRAME_MS = 1000 / TICK_RATE;
/** Never simulate more than this many ticks in one frame, so a stall cannot spiral. */
const MAX_CATCH_UP = 5;
/** A replay is not real time: drain it as fast as the browser will loop (TESTING.md §3). */
const REPLAY_TICKS_PER_FRAME = 600;

async function boot(): Promise<void> {
  const ids = ['f1', 'f2', 'f3', 'f4'] as const;
  const floors = await Promise.all(
    ids.map(async (id) => {
      const response = await fetch(`levels/${id}.json`);
      return loadFloor((await response.json()) as FloorFile);
    }),
  );

  const atlas = await loadAtlas({ onFallback: (why) => console.info(`main: ${why}`) });
  const app = new App(floors, atlas, new URLSearchParams(location.search).has('debug'));

  addEventListener('keydown', (event) => {
    if (PAUSE_KEYS.has(event.code)) {
      app.togglePause();
      event.preventDefault();
      return;
    }
    const bit = BINDINGS[event.code];
    if (bit === undefined) return;
    held |= bit;
    latched |= bit;
    event.preventDefault();
  });

  addEventListener('keyup', (event) => {
    const bit = BINDINGS[event.code];
    if (bit === undefined) return;
    held &= ~bit;
    event.preventDefault();
  });

  // The hook the tests drive the game with; harmless in a shipped build, and the only way to
  // run a whole floor through the real loop without a human at the keyboard. `freeze` and
  // `advance` are what make a screenshot golden reproducible: they put the game on an exact
  // tick instead of whichever one the display happened to land on.
  (window as unknown as { undervault: unknown }).undervault = {
    state: () => app.state(),
    start: () => {
      app.start();
    },
    toTitle: () => {
      app.toTitle();
    },
    injectReplay: (inputs: string, floorIndex = 0) => {
      app.injectReplay(inputs, floorIndex);
    },
    freeze: (value = true) => {
      frozen = value;
    },
    advance: (ticks: number) => {
      for (let i = 0; i < ticks; i++) app.tick(takeInput());
    },
  };

  let previous = performance.now();
  let accumulator = 0;

  const frame = (now: number): void => {
    accumulator += now - previous;
    previous = now;

    if (frozen) {
      accumulator = 0;
      app.draw(ctx);
      requestAnimationFrame(frame);
      return;
    }

    if (app.replaying) {
      for (let i = 0; i < REPLAY_TICKS_PER_FRAME && app.replaying; i++) app.tick(0);
      accumulator = 0;
    } else {
      let ticks = 0;
      while (accumulator >= FRAME_MS && ticks < MAX_CATCH_UP) {
        app.tick(takeInput());
        accumulator -= FRAME_MS;
        ticks++;
      }
      if (accumulator > FRAME_MS * MAX_CATCH_UP) accumulator = 0;
    }

    app.draw(ctx);
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

boot().catch((error: unknown) => {
  console.error('main: boot failed', error);
});
