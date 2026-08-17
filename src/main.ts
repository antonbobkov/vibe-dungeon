/**
 * Browser bootstrap.
 *
 * At M0 this only sets up the display surface: the 320×208 logical canvas and the integer
 * scaling rule from spec/00-overview.md §Global constants. The fixed-timestep loop, input
 * and renderer arrive with M1/M6.
 */

import { CLEAR_COLOR, VIEW_H, VIEW_W } from './sim/constants.js';

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

function paint(): void {
  ctx.fillStyle = CLEAR_COLOR;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

addEventListener('resize', fitToWindow);
fitToWindow();
paint();
