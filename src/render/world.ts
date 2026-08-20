/**
 * The room, drawn — ASSET_GUIDE §6.1's layer order over the live sim state.
 *
 * Void → floor → walls → wall decoration → floor props → actors → trap FX, with one
 * deliberate departure: spikes are drawn *under* actors rather than above them. AG puts trap
 * FX on top because flames and bolts overshoot their tile; spikes do not — they rise out of
 * the floor the player is standing on, and drawing them over the player reads as the player
 * standing behind the floor.
 *
 * Everything is a function of sim state, so the same tick always paints the same pixels.
 */

import type { Atlas, Sprite } from '../assets/loader.js';
import { anim } from '../assets/packA.js';
import { isSwingActive, playerCentre } from '../sim/combat.js';
import {
  CLEAR_COLOR,
  HUD_H,
  IFRAME_TICKS,
  PLAY_H,
  PLAY_W,
  PUSH_SLIDE_TICKS,
  SPAWN_TELEGRAPH_TICKS,
  SUBPX,
  SWING_ACTIVE_FIRST,
  SWING_ACTIVE_LAST,
  SWING_TICKS,
  TILE,
  TRANSITION_TICKS,
  VIEW_W,
} from '../sim/constants.js';
import type { Cell, LoadedRoom, PickupName } from '../sim/level.js';
import { doorFlag, pickupFlag, pitFlag, propFlag } from '../sim/persistence.js';
import { Facing } from '../sim/player.js';
import { PropState } from '../sim/prop.js';
import { TileClass, setTile, tileAt, type Room } from '../sim/room.js';
import type { Sim } from '../sim/sim.js';
import { autotileRoom, tileRefAt, type TileRef } from './autotile.js';
import {
  CHAIN_TILE,
  KEYHOLE_COLOURS,
  KEYHOLE_PIXELS,
  chainDraws,
  doorLeafDraws,
  keyholeDraws,
  sideDoorDraws,
} from './doors.js';
import { FLOAT_RISE_PX, PIT_DROP_PX, UNSHACKLE_DROP_PX, type Effect } from './effects.js';
import { frameIndex } from './anim.js';
import { roomOrigin, type Origin } from './layout.js';
import { PALETTE } from './palette.js';
import {
  enemySprite,
  pickupSprite,
  playerSprite,
  propSprite,
  telegraphSprite,
  trapSprite,
  type SpriteDraw,
} from './sprites.js';

/** 01 §5.1: six ticks of ±2 px screen shake when the player is hit. */
const SHAKE_TICKS = 6;
const SHAKE: readonly number[] = [2, -2, 2, -1, 1, -1];

/** 01 §4.2's arc: radius 14 px, −50° to +50° around the facing, 2 px thick. */
const ARC_RADIUS = 14;
const ARC_HALF_SWEEP = 50;
const ARC_THICKNESS = 2;
/** The band is plotted every 2°, which at radius 14 leaves no gaps between pixels. */
const ARC_STEP_DEGREES = 2;

const FACING_ANGLE: Readonly<Record<Facing, number>> = {
  [Facing.R]: 0,
  [Facing.D]: 90,
  [Facing.L]: 180,
  [Facing.U]: 270,
};

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

function blit(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  x: number,
  y: number,
  flipX = false,
  alpha = 1,
): void {
  if (alpha <= 0) return;
  const faded = alpha < 1;
  if (faded) ctx.globalAlpha = alpha;

  if (flipX) {
    ctx.save();
    ctx.translate(x + sprite.w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(sprite.image, 0, 0);
    ctx.restore();
  } else {
    ctx.drawImage(sprite.image, x, y);
  }

  if (faded) ctx.globalAlpha = 1;
}

/** One `SpriteDraw` at a sprite-cell position in screen pixels. */
function draw(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  spec: SpriteDraw,
  x: number,
  y: number,
): void {
  if (!spec.visible) return;
  const sprite = spec.anim
    ? atlas.frame(spec.anim, spec.frame, spec.tint)
    : atlas.tile(spec.tile!, spec.tint);
  blit(ctx, sprite, x + spec.dx, y + spec.dy, spec.flipX, spec.alpha);
}

const tilePos = (origin: Origin, cell: Cell): [number, number] => [
  origin.ox + cell[0] * TILE,
  origin.oy + cell[1] * TILE,
];

// ---------------------------------------------------------------------------
// Terrain and the things bolted to it
// ---------------------------------------------------------------------------

function drawTerrain(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  refs: TileRef[],
  room: { w: number; h: number },
  origin: Origin,
): void {
  for (let row = 0; row < room.h; row++) {
    for (let col = 0; col < room.w; col++) {
      const ref = tileRefAt(refs, room, col, row);
      blit(
        ctx,
        atlas.cell(ref.col, ref.row),
        origin.ox + col * TILE,
        origin.oy + row * TILE,
        ref.flipX,
      );
    }
  }
}

/**
 * Everything a door shows over its terrain tile (01 §8.1, §8.3): the leaf of an open one,
 * tucked ¾ into its doorway and standing 4 px proud of the wall; the edge-on slits or folded
 * half-leaves of a side-wall one; the keyhole plate of a closed keyed one; and the chains of
 * an event-locked one, over the top of all of it.
 *
 * The decisions all live in `doors.ts`, which knows nothing about a canvas; this is only the
 * blitting.
 */
function drawDoorArt(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  def: LoadedRoom,
  tiles: Room,
  origin: Origin,
  sealed: boolean,
): void {
  for (const leaf of [...doorLeafDraws(def, tiles), ...sideDoorDraws(def, tiles)]) {
    blit(ctx, atlas.tile(leaf.tile), origin.ox + leaf.x, origin.oy + leaf.y, leaf.flipX);
  }

  for (const keyhole of keyholeDraws(def, tiles)) {
    const colours = KEYHOLE_COLOURS[keyhole.metal];
    for (const [dx, dy, shade] of KEYHOLE_PIXELS) {
      ctx.fillStyle = colours[shade];
      ctx.fillRect(origin.ox + keyhole.x + dx, origin.oy + keyhole.y + dy, 1, 1);
    }
  }

  for (const chain of chainDraws(def, tiles, sealed)) {
    blit(ctx, atlas.tile(chain.tile), origin.ox + chain.x, origin.oy + chain.y, chain.flipX);
  }
}

/** Wall torches and banners (`t`, `w` in the 03 §1.2 legend) and the rooms' decor tiles. */
function drawWallDressing(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  def: LoadedRoom,
  origin: Origin,
  tick: number,
): void {
  for (const symbol of def.base.symbols) {
    if (symbol.role !== 'wall_prop') continue;
    const loop = anim(symbol.ch === 't' ? 'torch_wall' : 'banner');
    const [x, y] = tilePos(origin, [symbol.col, symbol.row]);
    blit(ctx, atlas.frame(loop.id, frameIndex(loop, tick)), x, y);
  }

  for (const item of def.decor) {
    const match = /^A\((\d+),(\d+)\)$/.exec(item.art);
    if (!match) continue; // the level lint has already rejected anything else
    const [x, y] = tilePos(origin, item.at);
    blit(ctx, atlas.cell(Number(match[1]), Number(match[2])), x, y);
  }
}

// ---------------------------------------------------------------------------
// The live room
// ---------------------------------------------------------------------------

/**
 * The sim's tile grid as the room should be *drawn*: a pit a crate is sliding into is still a
 * pit until the crate lands in it.
 *
 * 02 §4.2 has the slide claim its destination for the whole twelve ticks, which the sim does
 * by writing `PROP` over the tile (`sim.ts` `updatePushes`). That is the right answer for
 * collision and the wrong one for the auto-tiler, which has no `PROP` case and falls through
 * to floor art — so the moment a push charged, the trench's black hole snapped shut, twelve
 * ticks before the crate that fills it has moved a single pixel. Put the pit back for the
 * terrain layer (or the bridge, if the floor already remembers this pit as bridged — a crate
 * pushed onto an existing bridge is swallowed again, 02 §4.2).
 *
 * Returns the sim's own grid untouched when no crate is sliding into a pit, which is almost
 * always.
 */
export function drawnTiles(sim: Sim): Room {
  let out: Room | null = null;

  for (const prop of sim.props) {
    if (prop.state !== PropState.SLIDING || !prop.slideTo) continue;
    const [col, row] = prop.slideTo;
    if (tileAt(sim.roomDef.base, col, row) !== TileClass.PIT) continue;

    out ??= { ...sim.room, tiles: Uint8Array.from(sim.room.tiles) };
    const bridged = sim.persistence.has(pitFlag(sim.floor.id, sim.roomId, col, row));
    setTile(out, col, row, bridged ? TileClass.BRIDGED_PIT : TileClass.PIT);
  }

  return out ?? sim.room;
}

export function drawRoom(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  sim: Sim,
  origin: Origin,
  effects: readonly Effect[] = [],
): void {
  const def = sim.roomDef;
  const tick = sim.playTick;

  // 01 §8.3: while the seal is down every door in the room is drawn chained shut.
  const sealed = sim.seal === 1;

  drawTerrain(ctx, atlas, autotileRoom(def, drawnTiles(sim), sealed), def, origin);
  drawWallDressing(ctx, atlas, def, origin, tick);
  drawDoorArt(ctx, atlas, def, sim.room, origin, sealed);

  for (const pickup of sim.pickups) {
    const [x, y] = tilePos(origin, pickup.at);
    draw(ctx, atlas, pickupSprite(pickup.kind, tick), x, y);
  }

  for (const prop of sim.props) {
    const spec = propSprite(prop, tick);
    if (!spec) continue;
    const [x, y] = slidePosition(prop.at, prop.slideTo, prop.state, prop.timer, origin);
    draw(ctx, atlas, spec, x, y);
  }

  // Spikes belong to the floor, so they go under whatever is standing on them.
  for (const trap of sim.traps) {
    if (trap.def.kind !== 'spike') continue;
    const [x, y] = tilePos(origin, trap.def.at);
    draw(ctx, atlas, trapSprite(trap.def, trap.phase), x, y);
  }

  for (const telegraph of sim.telegraphs) {
    const [x, y] = tilePos(origin, telegraph.at);
    draw(ctx, atlas, telegraphSprite(telegraph.ticksLeft, SPAWN_TELEGRAPH_TICKS), x, y);
  }

  const centre = playerCentre(sim.player);
  for (const entity of sim.entities) {
    draw(
      ctx,
      atlas,
      enemySprite(entity, centre.x, tick),
      origin.ox + entity.x / SUBPX,
      origin.oy + entity.y / SUBPX,
    );
  }

  draw(
    ctx,
    atlas,
    playerSprite({ player: sim.player, input: sim.input, tick }),
    origin.ox + sim.player.x / SUBPX,
    origin.oy + sim.player.y / SUBPX,
  );

  drawSwordArc(ctx, sim, origin);

  // Trap FX last: flames and bolts overshoot their tiles and belong over everything (AG §6.1).
  for (const trap of sim.traps) {
    if (trap.def.kind === 'spike') continue;
    const [x, y] = tilePos(origin, trap.def.at);
    draw(ctx, atlas, trapSprite(trap.def, trap.phase), x, y);
  }
  for (const bolt of sim.bolts) {
    blit(ctx, atlas.frame('bolt', 0), origin.ox + bolt.x / SUBPX, origin.oy + bolt.y / SUBPX);
  }

  drawEffects(ctx, atlas, effects, origin);
}

/**
 * The flourishes of 02 §4 and 01 §8.3, over everything else in the room. Pack A has no smoke
 * sprite, so the puff is drawn from palette pixels; the rest reuse the art the things
 * themselves are drawn with.
 */
function drawEffects(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  effects: readonly Effect[],
  origin: Origin,
): void {
  for (const effect of effects) {
    if (effect.elapsed < 0) continue; // still waiting its turn in the stagger
    const [x, y] = tilePos(origin, effect.at);
    const done = effect.elapsed / effect.total;

    switch (effect.kind) {
      case 'float': {
        const spec = pickupSprite(effect.pickup!, effect.elapsed);
        const fade = Math.min(1, (1 - done) * 3); // holds, then goes out over the last third
        blit(
          ctx,
          atlas.frame(spec.anim!, spec.frame),
          x,
          y - Math.round(FLOAT_RISE_PX * done),
          false,
          fade,
        );
        break;
      }

      case 'pit_drop':
        // The tile underneath is already the bridged crate; this is the one that fell,
        // settling into it and fading against the pit's void.
        blit(ctx, atlas.tile('crate_push'), x, y + Math.round(PIT_DROP_PX * done), false, 1 - done);
        break;

      case 'unshackle':
        // 01 §8.3: the chain that was hanging here breaks off, drops away and fades out.
        blit(
          ctx,
          atlas.tile(CHAIN_TILE),
          x,
          y + Math.round(UNSHACKLE_DROP_PX * done),
          false,
          1 - done,
        );
        break;

      case 'puff': {
        ctx.fillStyle = PALETTE.steelDark;
        const rise = Math.round(4 * done);
        for (const [dx, dy] of PUFF_PIXELS) {
          ctx.fillRect(x + dx, y + dy - rise, 2, 2);
        }
        break;
      }
    }
  }
}

/** Three specks, spread across the tile, that drift up together (02 §4.3's smoke puff). */
const PUFF_PIXELS: readonly [number, number][] = [
  [5, 6],
  [9, 4],
  [7, 9],
];

/**
 * A pushed crate is between two tiles for the twelve ticks of its slide (02 §4.2).
 *
 * The twelve ticks are twelve *drawn* frames — timer 12 down to timer 1 — and the tick that
 * would make it 0 is the one that ends the slide, replacing the prop with either an idle crate
 * on the destination tile or, over a pit, bridged terrain. Both of those are already at the
 * full tile, so the interpolation has to reach 1 on the last frame it gets: dividing by twelve
 * instead of eleven leaves the crate 1.3 px short and hands over with a visible snap.
 */
export function slidePosition(
  at: Cell,
  slideTo: Cell | null,
  state: PropState,
  timer: number,
  origin: Origin,
): [number, number] {
  const [x, y] = tilePos(origin, at);
  if (state !== PropState.SLIDING || !slideTo) return [x, y];

  const done = (PUSH_SLIDE_TICKS - timer) / (PUSH_SLIDE_TICKS - 1);
  return [
    Math.round(x + (slideTo[0] - at[0]) * TILE * done),
    Math.round(y + (slideTo[1] - at[1]) * TILE * done),
  ];
}

export interface ArcPixel {
  x: number;
  y: number;
  /** The leading edge is a single pixel of white; the rest of the band is steel. */
  leading: boolean;
}

/**
 * The swing's arc (01 §4.2): a 2 px band of radius 14 sweeping from −50° to +50° around the
 * facing across the active window, its leading edge a pixel of white. Whole pixels rather
 * than a stroked path — the game is pixel art, and `ctx.arc` would antialias.
 *
 * Returned as a list so the geometry can be checked without a canvas: the band never leaves
 * its radius, the sweep grows with the swing, and exactly one pixel is the leading edge.
 */
export function arcPixels(facing: Facing, swept: number, cx: number, cy: number): ArcPixel[] {
  const from = FACING_ANGLE[facing] - ARC_HALF_SWEEP;
  const to = from + 2 * ARC_HALF_SWEEP * Math.max(0, Math.min(1, swept));

  const pixels: ArcPixel[] = [];
  for (let degrees = from; degrees <= to; degrees += ARC_STEP_DEGREES) {
    const radians = (degrees * Math.PI) / 180;
    for (let t = 0; t < ARC_THICKNESS; t++) {
      const r = ARC_RADIUS - t;
      pixels.push({
        x: Math.round(cx + Math.cos(radians) * r),
        y: Math.round(cy + Math.sin(radians) * r),
        leading: false,
      });
    }
  }

  const lead = (to * Math.PI) / 180;
  pixels.push({
    x: Math.round(cx + Math.cos(lead) * ARC_RADIUS),
    y: Math.round(cy + Math.sin(lead) * ARC_RADIUS),
    leading: true,
  });
  return pixels;
}

/** How far through its sweep a swing is, 0 at the first active tick and 1 at the last. */
export function arcSweep(stateTimer: number): number {
  const elapsed = SWING_TICKS - stateTimer;
  return (elapsed - SWING_ACTIVE_FIRST) / (SWING_ACTIVE_LAST - SWING_ACTIVE_FIRST);
}

function drawSwordArc(ctx: CanvasRenderingContext2D, sim: Sim, origin: Origin): void {
  const player = sim.player;
  if (!isSwingActive(player)) return;

  const cx = origin.ox + player.x / SUBPX + TILE / 2;
  const cy = origin.oy + player.y / SUBPX + TILE / 2;

  for (const pixel of arcPixels(player.facing, arcSweep(player.stateTimer), cx, cy)) {
    ctx.fillStyle = pixel.leading ? PALETTE.white : PALETTE.steel;
    ctx.fillRect(pixel.x, pixel.y, 1, 1);
  }
}

// ---------------------------------------------------------------------------
// The room the player is walking into, during the 24-tick slide (01 §8.2)
// ---------------------------------------------------------------------------

/** The target room's grid with everything the floor remembers already applied (01 §9). */
function previewTiles(sim: Sim, def: LoadedRoom): Room {
  const tiles = Uint8Array.from(def.base.tiles);
  const room: Room = {
    w: def.w,
    h: def.h,
    tiles,
    spawn: def.base.spawn,
    symbols: def.base.symbols,
  };
  const floorId = sim.floor.id;

  for (const [key, door] of def.doorCells) {
    const [col, row] = key.split(',').map(Number) as [number, number];
    const open = door.type === 'gap' || sim.persistence.has(doorFlag(floorId, door.doorId));
    setTile(room, col, row, open ? TileClass.DOOR_OPEN : TileClass.DOOR_CLOSED);
  }
  for (let row = 0; row < def.h; row++) {
    for (let col = 0; col < def.w; col++) {
      if (tileAt(room, col, row) !== TileClass.PIT) continue;
      if (sim.persistence.has(pitFlag(floorId, def.id, col, row))) {
        setTile(room, col, row, TileClass.BRIDGED_PIT);
      }
    }
  }
  return room;
}

/** Terrain, dressing and untouched contents of a room the sim has not entered yet. */
function drawPreview(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  sim: Sim,
  def: LoadedRoom,
  origin: Origin,
): void {
  const tiles = previewTiles(sim, def);
  const floorId = sim.floor.id;
  const tick = sim.playTick;

  // A room the player has not walked into yet is never the sealed one (01 §8.3).
  drawTerrain(ctx, atlas, autotileRoom(def, tiles), def, origin);
  drawWallDressing(ctx, atlas, def, origin, tick);
  drawDoorArt(ctx, atlas, def, tiles, origin, false);

  for (const pickup of def.pickups) {
    if (sim.persistence.has(pickupFlag(floorId, def.id, pickup.at[0], pickup.at[1]))) continue;
    const [x, y] = tilePos(origin, pickup.at);
    draw(ctx, atlas, pickupSprite(pickup.kind as PickupName, tick), x, y);
  }

  for (const prop of def.props) {
    if (sim.persistence.has(propFlag(floorId, def.id, prop.at[0], prop.at[1]))) continue;
    const [x, y] = tilePos(origin, prop.at);
    draw(
      ctx,
      atlas,
      propSprite(
        {
          ...prop,
          origin: prop.at,
          state: PropState.IDLE,
          timer: 0,
          slideTo: null,
          charge: 0,
          chargeDir: null,
        },
        tick,
      )!,
      x,
      y,
    );
  }
}

// ---------------------------------------------------------------------------
// The play area
// ---------------------------------------------------------------------------

/** How far the room is pushed off centre this tick: the damage shake of 01 §5.1. */
export function shakeOffset(iframeTimer: number): number {
  const elapsed = IFRAME_TICKS - iframeTimer;
  if (iframeTimer <= 0 || elapsed >= SHAKE_TICKS) return 0;
  return SHAKE[elapsed] ?? 0;
}

/**
 * The whole play area: the room, plus the room being slid in from during a transition, plus
 * the shake. The HUD and the screens are drawn over this by their own modules.
 */
export function drawWorld(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  sim: Sim,
  effects: readonly Effect[] = [],
): void {
  ctx.fillStyle = CLEAR_COLOR;
  ctx.fillRect(0, HUD_H, VIEW_W, PLAY_H);

  const shake = shakeOffset(sim.player.iframeTimer);
  const script = sim.script;

  if (script?.kind === 'transition') {
    const progress = (TRANSITION_TICKS - script.ticksLeft) / TRANSITION_TICKS;
    const from = slideVector(script.dir, progress);
    const to = slideVector(script.dir, progress - 1);

    const here = roomOrigin(sim.roomDef);
    drawRoom(ctx, atlas, sim, { ox: here.ox + from.dx, oy: here.oy + from.dy }, effects);

    const next = sim.floor.rooms[script.toRoom]!;
    const there = roomOrigin(next);
    drawPreview(ctx, atlas, sim, next, { ox: there.ox + to.dx, oy: there.oy + to.dy });
    return;
  }

  const origin = roomOrigin(sim.roomDef);
  drawRoom(ctx, atlas, sim, { ox: origin.ox + shake, oy: origin.oy }, effects);
}

/** Where a room sits at `progress` through a slide in `dir` (01 §8.2, linear). */
export function slideVector(
  dir: 'U' | 'D' | 'L' | 'R',
  progress: number,
): { dx: number; dy: number } {
  switch (dir) {
    case 'U':
      return { dx: 0, dy: Math.round(PLAY_H * progress) };
    case 'D':
      return { dx: 0, dy: -Math.round(PLAY_H * progress) };
    case 'L':
      return { dx: Math.round(PLAY_W * progress), dy: 0 };
    case 'R':
      return { dx: -Math.round(PLAY_W * progress), dy: 0 };
  }
}
