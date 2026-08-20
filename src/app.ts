/**
 * The game shell: which screen is on, and what a tick means on it.
 *
 * 04-ui §3's screens (title → play → victory, with pause over the top and the death sequence
 * inside a run) as one small state machine, driven at the fixed 60 Hz step `main.ts` owns.
 * Everything the player sees is a function of this object's state plus the sim's, so a frame
 * can be drawn at any time without side effects.
 *
 * It also carries the replay hook the Playwright suite drives the game with — the same input
 * tape `npm run test:replay` runs headless, fed through the browser loop a byte per tick.
 */

import type { Atlas } from './assets/loader.js';
import { detect, snapshot, type GameEvent } from './game/events.js';
import { Effects } from './render/effects.js';
import { drawHud } from './render/hud.js';
import {
  TITLE_FADE_TICKS,
  VICTORY_FADE_TICKS,
  VICTORY_HOLD_TICKS,
  drawDeath,
  drawFade,
  drawPause,
  drawTitle,
  drawVictory,
} from './render/screens.js';
import { drawWorld } from './render/world.js';
import { drawDebug } from './render/debug.js';
import { CLEAR_COLOR, FLOOR_FADE_TICKS, VIEW_H, VIEW_W } from './sim/constants.js';
import { ATTACK } from './sim/input.js';
import type { LoadedFloor } from './sim/level.js';
import { PlayerState } from './sim/player.js';
import { Sim } from './sim/sim.js';

export type ScreenName = 'title' | 'playing' | 'paused' | 'victory';

export interface AppState {
  screen: ScreenName;
  floor: number;
  room: string;
  /** The 01 §4's `PlayerState`, so the e2e can see a key actually reach the sword. */
  playerState: PlayerState;
  hp: number;
  treasure: number;
  silverKeys: number;
  goldKey: boolean;
  deaths: number;
  victory: boolean;
  playTick: number;
  replaying: boolean;
}

interface Fade {
  /** `out` darkens toward black, `in` clears back to the game. */
  dir: 'out' | 'in';
  ticksLeft: number;
  total: number;
  /** What to do when an `out` finishes. */
  then?: 'start';
}

export class App {
  private screen: ScreenName = 'title';
  private sim: Sim | null = null;
  /** Ticks on the current screen — the title blink and the victory sequence run off this. */
  private screenTick = 0;
  private fade: Fade | null = null;
  private tape: { bytes: Uint8Array; index: number } | null = null;
  private previous = 0;
  /** Ticks since the sim reported victory, for 04-ui §3.3's hold-then-fade. */
  private victoryTick = -1;
  /** The flourishes of 02 §4 that outlive the state that caused them. */
  private readonly effects = new Effects();
  /** What the last tick did, for whoever wants to hear about it. */
  private lastEvents: GameEvent[] = [];

  constructor(
    private readonly floors: LoadedFloor[],
    private readonly atlas: Atlas,
    private readonly debug = false,
  ) {}

  // --- state ----------------------------------------------------------------

  get replaying(): boolean {
    return this.tape !== null;
  }

  state(): AppState {
    const sim = this.sim;
    return {
      screen: this.screen,
      floor: sim ? sim.floorIndex + 1 : 0,
      room: sim ? sim.roomId : '',
      playerState: sim ? sim.player.state : PlayerState.NORMAL,
      hp: sim ? sim.player.hp : 0,
      treasure: sim ? sim.treasure : 0,
      silverKeys: sim ? sim.silverKeys : 0,
      goldKey: sim ? sim.goldKey : false,
      deaths: sim ? sim.deaths : 0,
      victory: sim ? sim.victory : false,
      playTick: sim ? sim.playTick : 0,
      replaying: this.replaying,
    };
  }

  /** Everything the last tick did — the shell hands it to audio (04-ui §5). */
  get events(): readonly GameEvent[] {
    return this.lastEvents;
  }

  /** Begin a run at the top of floor 1, with no title fade — the tests' way in. */
  start(): void {
    this.sim = new Sim(this.floors);
    this.screen = 'playing';
    this.screenTick = 0;
    this.victoryTick = -1;
    this.fade = null;
    this.effects.clear();
    this.lastEvents = [];
  }

  /**
   * Play a compiled replay's input tape through the loop, from a fresh floor — the same
   * conditions `tools/run-replay.ts` gives it, so the two runs agree tick for tick.
   */
  injectReplay(inputsBase64: string, floorIndex = 0): void {
    const binary = atob(inputsBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    this.sim = new Sim(this.floors, { floorIndex });
    this.screen = 'playing';
    this.screenTick = 0;
    this.victoryTick = -1;
    this.fade = null;
    this.effects.clear();
    this.lastEvents = [];
    this.tape = { bytes, index: 0 };
  }

  // --- input ----------------------------------------------------------------

  /** Escape/P, per 01 §10 — never during a transition or a death/victory sequence. */
  togglePause(): void {
    if (this.screen === 'paused') {
      this.screen = 'playing';
      return;
    }
    if (this.screen !== 'playing' || !this.sim) return;
    if (this.sim.script !== null || this.sim.victory) return;
    if (this.sim.player.state === PlayerState.DYING) return;
    this.screen = 'paused';
  }

  // --- the tick -------------------------------------------------------------

  tick(held: number): void {
    const pressed = held & ~this.previous;
    this.previous = held;
    this.screenTick++;
    this.lastEvents = [];
    this.effects.advance();

    if (this.fade) {
      this.fade.ticksLeft--;
      if (this.fade.ticksLeft <= 0) {
        const then = this.fade.then;
        this.fade = null;
        if (then === 'start') {
          this.start();
          this.fade = { dir: 'in', ticksLeft: TITLE_FADE_TICKS, total: TITLE_FADE_TICKS };
        }
      }
      // A fade is a held frame: nothing else moves under it.
      if (this.fade?.dir === 'out') return;
    }

    switch (this.screen) {
      case 'title':
        if ((pressed & ATTACK) !== 0) {
          this.fade = {
            dir: 'out',
            ticksLeft: TITLE_FADE_TICKS,
            total: TITLE_FADE_TICKS,
            then: 'start',
          };
        }
        return;

      case 'paused':
        return;

      case 'victory':
        if ((pressed & ATTACK) !== 0) this.toTitle();
        return;

      case 'playing': {
        const sim = this.sim;
        if (!sim) return;

        if (sim.victory) {
          this.victoryTick++;
          if (this.victoryTick >= VICTORY_HOLD_TICKS + VICTORY_FADE_TICKS) {
            this.screen = 'victory';
            this.screenTick = 0;
          }
          return;
        }

        const before = snapshot(sim);
        sim.tick(this.nextInput(held));
        const after = snapshot(sim);

        // A room is a clean slate: nothing that was floating over the last one follows.
        if (after.roomIndex !== before.roomIndex || after.floorIndex !== before.floorIndex) {
          this.effects.clear();
        }
        this.lastEvents = detect(before, after);
        this.effects.spawn(this.lastEvents);
        if (sim.victory) this.victoryTick = 0;
        return;
      }
    }
  }

  /** The tape's byte while a replay is running, otherwise what the keyboard says. */
  private nextInput(held: number): number {
    const tape = this.tape;
    if (!tape) return held;
    const byte = tape.bytes[tape.index++] ?? 0;
    if (tape.index >= tape.bytes.length) this.tape = null;
    return byte;
  }

  /** Back to a fresh title screen at tick zero — 04-ui §3.3's "full state reset". */
  toTitle(): void {
    this.screen = 'title';
    this.sim = null;
    this.screenTick = 0;
    this.victoryTick = -1;
    this.tape = null;
    this.effects.clear();
    this.lastEvents = [];
  }

  // --- drawing --------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = CLEAR_COLOR;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    if (this.screen === 'title') {
      drawTitle(ctx, this.atlas, this.screenTick);
      drawFade(ctx, this.fadeAlpha());
      return;
    }

    const sim = this.sim;
    if (!sim) return;

    if (this.screen === 'victory') {
      drawVictory(
        ctx,
        this.atlas,
        { playTicks: sim.playTick, deaths: sim.deaths, treasure: sim.treasure },
        this.screenTick,
      );
      return;
    }

    if (this.debug) drawDebug(ctx, sim);
    else {
      drawWorld(ctx, this.atlas, sim, this.effects.live);
      drawHud(ctx, this.atlas, {
        hp: sim.player.hp,
        inventory: sim.inventory,
        floor: sim.floorIndex + 1,
      });
    }

    // The death sequence's black is part of the run, not a screen of its own (01 §6).
    if (sim.script?.kind === 'respawn') drawDeath(ctx);
    if (this.screen === 'paused') drawPause(ctx);

    drawFade(ctx, Math.max(this.fadeAlpha(), this.scriptFade(sim), this.victoryFade()));
  }

  private fadeAlpha(): number {
    const fade = this.fade;
    if (!fade) return 0;
    const done = (fade.total - fade.ticksLeft) / fade.total;
    return fade.dir === 'out' ? done : 1 - done;
  }

  /** The floor change fades out over 30 ticks and back in over 30 (01 §8.4). */
  private scriptFade(sim: Sim): number {
    const script = sim.script;
    if (script?.kind !== 'descend') return 0;
    const half = FLOOR_FADE_TICKS;
    return script.ticksLeft > half ? (half * 2 - script.ticksLeft) / half : script.ticksLeft / half;
  }

  /** 04-ui §3.3: hold on the open chest, then fade to the victory screen. */
  private victoryFade(): number {
    if (this.victoryTick < VICTORY_HOLD_TICKS) return 0;
    return (this.victoryTick - VICTORY_HOLD_TICKS) / VICTORY_FADE_TICKS;
  }
}
