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
      blit(ctx, atlas.cell(ref.col, ref.row), origin.ox + col * TILE, origin.oy + row * TILE);
    }
  }
}

/**
 * The leaves of an open door, folded back against their jambs (AG §3.2). The leaf art is two
 * tiles tall and hangs off the wall row into the room, so a door in the bottom wall draws
 * upward from its cell and one in the top wall draws downward.
 */
function drawDoorLeaves(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  def: LoadedRoom,
  tiles: Room,
  origin: Origin,
): void {
  for (const [key, owner] of def.doorCells) {
    if (owner.type === 'gap') continue; // side gaps have no door art at all (01 §8.1)
    const [col, row] = key.split(',').map(Number) as [number, number];
    if (tileAt(tiles, col, row) !== TileClass.DOOR_OPEN) continue;

    const partnerRight = def.doorCells.get(`${col + 1},${row}`)?.doorId === owner.doorId;
    const partnerLeft = def.doorCells.get(`${col - 1},${row}`)?.doorId === owner.doorId;
    const side = partnerRight ? 'left' : partnerLeft ? 'right' : 'center';

    const top = row === 0 ? row : row - 1;
    blit(ctx, atlas.tile(`door_leaf_${side}_top`), origin.ox + col * TILE, origin.oy + top * TILE);
    blit(
      ctx,
      atlas.tile(`door_leaf_${side}_bottom`),
      origin.ox + col * TILE,
      origin.oy + (top + 1) * TILE,
    );
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

export function drawRoom(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  sim: Sim,
  origin: Origin,
): void {
  const def = sim.roomDef;
  const tick = sim.playTick;

  drawTerrain(ctx, atlas, autotileRoom(def, sim.room), def, origin);
  drawWallDressing(ctx, atlas, def, origin, tick);
  drawDoorLeaves(ctx, atlas, def, sim.room, origin);

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
}

/** A pushed crate is between two tiles for the twelve ticks of its slide (02 §4.2). */
function slidePosition(
  at: Cell,
  slideTo: Cell | null,
  state: PropState,
  timer: number,
  origin: Origin,
): [number, number] {
  const [x, y] = tilePos(origin, at);
  if (state !== PropState.SLIDING || !slideTo) return [x, y];

  const done = (PUSH_SLIDE_TICKS - timer) / PUSH_SLIDE_TICKS;
  return [
    Math.round(x + (slideTo[0] - at[0]) * TILE * done),
    Math.round(y + (slideTo[1] - at[1]) * TILE * done),
  ];
}

/**
 * The swing's arc (01 §4.2): a 2 px band of radius 14 sweeping from −50° to +50° around the
 * facing across the active window, its leading edge a pixel of white. Drawn as whole pixels
 * rather than a stroked path — the game is pixel art, and `ctx.arc` would antialias.
 */
function drawSwordArc(ctx: CanvasRenderingContext2D, sim: Sim, origin: Origin): void {
  const player = sim.player;
  if (!isSwingActive(player)) return;

  const elapsed = SWING_TICKS - player.stateTimer;
  const swept = (elapsed - SWING_ACTIVE_FIRST) / (SWING_ACTIVE_LAST - SWING_ACTIVE_FIRST);
  const facing = FACING_ANGLE[player.facing];
  const from = facing - ARC_HALF_SWEEP;
  const to = from + 2 * ARC_HALF_SWEEP * swept;

  const cx = origin.ox + player.x / SUBPX + TILE / 2;
  const cy = origin.oy + player.y / SUBPX + TILE / 2;

  ctx.fillStyle = PALETTE.steel;
  for (let degrees = from; degrees <= to; degrees += 2) {
    const radians = (degrees * Math.PI) / 180;
    for (let t = 0; t < ARC_THICKNESS; t++) {
      const r = ARC_RADIUS - t;
      ctx.fillRect(
        Math.round(cx + Math.cos(radians) * r),
        Math.round(cy + Math.sin(radians) * r),
        1,
        1,
      );
    }
  }

  const lead = (to * Math.PI) / 180;
  ctx.fillStyle = PALETTE.white;
  ctx.fillRect(
    Math.round(cx + Math.cos(lead) * ARC_RADIUS),
    Math.round(cy + Math.sin(lead) * ARC_RADIUS),
    1,
    1,
  );
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

  drawTerrain(ctx, atlas, autotileRoom(def, tiles), def, origin);
  drawWallDressing(ctx, atlas, def, origin, tick);
  drawDoorLeaves(ctx, atlas, def, tiles, origin);

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
export function drawWorld(ctx: CanvasRenderingContext2D, atlas: Atlas, sim: Sim): void {
  ctx.fillStyle = CLEAR_COLOR;
  ctx.fillRect(0, HUD_H, VIEW_W, PLAY_H);

  const shake = shakeOffset(sim.player.iframeTimer);
  const script = sim.script;

  if (script?.kind === 'transition') {
    const progress = (TRANSITION_TICKS - script.ticksLeft) / TRANSITION_TICKS;
    const from = slideVector(script.dir, progress);
    const to = slideVector(script.dir, progress - 1);

    const here = roomOrigin(sim.roomDef);
    drawRoom(ctx, atlas, sim, { ox: here.ox + from.dx, oy: here.oy + from.dy });

    const next = sim.floor.rooms[script.toRoom]!;
    const there = roomOrigin(next);
    drawPreview(ctx, atlas, sim, next, { ox: there.ox + to.dx, oy: there.oy + to.dy });
    return;
  }

  const origin = roomOrigin(sim.roomDef);
  drawRoom(ctx, atlas, sim, { ox: origin.ox + shake, oy: origin.oy });
}

/** Where a room sits at `progress` through a slide in `dir` (01 §8.2, linear). */
function slideVector(dir: 'U' | 'D' | 'L' | 'R', progress: number): { dx: number; dy: number } {
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
