/**
 * Debug renderer — flat rectangles per tile class, no art.
 *
 * This is the "for humans, not tested" view of milestone M2: enough to walk the 26 rooms
 * and see that doors, transitions and pickups are where the maps say. M6 replaces it with
 * the real Pack A renderer; the layout maths here (room centring, 03 §1.1) is the same.
 *
 * M4 added the parts of a room that move on their own: the deadly window of a trap, a bolt
 * falling down its lane, a spawn telegraph counting in, and each prop's state.
 */

import { isSwingActive, swordRect } from '../sim/combat.js';
import { BOLT_BOX, PLAYER_BOX, SUBPX, TILE, TILE_SUBPX, VIEW_W, HUD_H } from '../sim/constants.js';
import { EnemyState, boxOf, type SimEntity } from '../sim/enemy.js';
import { PropState, type SimProp } from '../sim/prop.js';
import { TileClass, tileAt } from '../sim/room.js';
import type { Sim } from '../sim/sim.js';
import { roomOrigin } from './layout.js';

/** Flat colours, Pack A palette (AG §2.4) so the debug view is at least in key. */
const COLORS: Record<TileClass, string> = {
  [TileClass.FLOOR]: '#3d253b',
  [TileClass.WALL]: '#6e4a48',
  [TileClass.PIT]: '#25131a',
  [TileClass.BRIDGED_PIT]: '#895a45',
  [TileClass.DOOR_CLOSED]: '#bf704d',
  [TileClass.DOOR_OPEN]: '#543740',
  [TileClass.PROP]: '#90919e',
  [TileClass.DECAL]: '#362030',
};

const PICKUP_COLOR = '#ffd569';
const ENEMY_COLOR = '#bc4c51';
const ENEMY_STUNNED_COLOR = '#ffffff';
const ENEMY_DYING_COLOR = '#543740';
const ENEMY_SPAWNING_COLOR = '#8c5c8a';
const SWORD_COLOR = '#adc1cf';
const PLAYER_COLOR = '#adc1cf';
const TRAP_COLOR = '#78514f';
const DEADLY_COLOR = '#e34f4f';
const BOLT_COLOR = '#d9c8a9';
const TELEGRAPH_COLOR = '#bc4c51';
const LIT_COLOR = '#ffb347';
const SLIDE_COLOR = '#c9a06a';
const TEXT_COLOR = '#adc1cf';

export function drawDebug(ctx: CanvasRenderingContext2D, sim: Sim): void {
  const room = sim.room;
  const { ox, oy } = roomOrigin(room);

  for (let row = 0; row < room.h; row++) {
    for (let col = 0; col < room.w; col++) {
      ctx.fillStyle = COLORS[tileAt(room, col, row)];
      ctx.fillRect(ox + col * TILE, oy + row * TILE, TILE, TILE);
    }
  }

  // Traps mark the tile they make deadly (02 §3), armed or not.
  ctx.fillStyle = TRAP_COLOR;
  for (const trap of sim.traps) {
    if (!trap.def.deadly) continue;
    const [col, row] = trap.def.deadly;
    ctx.fillRect(ox + col * TILE + 4, oy + row * TILE + 4, TILE - 8, TILE - 8);
  }

  // ...and light up while the window is open, which is the only time they hurt (02 §3.1).
  ctx.fillStyle = DEADLY_COLOR;
  for (const [col, row] of sim.deadly) {
    ctx.fillRect(ox + col * TILE + 2, oy + row * TILE + 2, TILE - 4, TILE - 4);
  }

  ctx.fillStyle = BOLT_COLOR;
  for (const bolt of sim.bolts) {
    ctx.fillRect(
      ox + bolt.x / SUBPX + BOLT_BOX.offX,
      oy + bolt.y / SUBPX + BOLT_BOX.offY,
      BOLT_BOX.w,
      BOLT_BOX.h,
    );
  }

  for (const prop of sim.props) {
    drawProp(ctx, prop, ox, oy);
  }

  ctx.fillStyle = PICKUP_COLOR;
  for (const pickup of sim.pickups) {
    ctx.fillRect(ox + pickup.at[0] * TILE + 5, oy + pickup.at[1] * TILE + 5, 6, 6);
  }

  // A wave's spawn tiles, counting down before anything stands on them (02 §2.3).
  ctx.strokeStyle = TELEGRAPH_COLOR;
  for (const telegraph of sim.telegraphs) {
    ctx.strokeRect(
      ox + telegraph.at[0] * TILE + 1.5,
      oy + telegraph.at[1] * TILE + 1.5,
      TILE - 3,
      TILE - 3,
    );
  }

  for (const entity of sim.entities) {
    drawEnemy(ctx, entity, ox, oy);
  }

  // The sword's reach, only while it can actually connect (01 §4.2).
  if (isSwingActive(sim.player)) {
    const blade = swordRect(sim.player);
    ctx.fillStyle = SWORD_COLOR;
    ctx.fillRect(ox + blade.l / SUBPX, oy + blade.t / SUBPX, TILE, TILE);
  }

  // The player's feet box, which is what actually collides (01 §3.3).
  ctx.fillStyle = PLAYER_COLOR;
  ctx.fillRect(
    ox + sim.player.x / SUBPX + PLAYER_BOX.offX,
    oy + sim.player.y / SUBPX + PLAYER_BOX.offY,
    PLAYER_BOX.w,
    PLAYER_BOX.h,
  );

  drawStatus(ctx, sim);
}

/** Props are already PROP tiles; this is the state the grid cannot show (02 §4). */
function drawProp(ctx: CanvasRenderingContext2D, prop: SimProp, ox: number, oy: number): void {
  const x = ox + prop.at[0] * TILE;
  const y = oy + prop.at[1] * TILE;

  switch (prop.state) {
    case PropState.LIT:
      ctx.fillStyle = LIT_COLOR;
      ctx.fillRect(x + 5, y + 3, 6, 6);
      return;
    case PropState.OPENING:
    case PropState.DESTROYING:
      // Shrinking inner square: how much of the timer is left.
      ctx.fillStyle = SLIDE_COLOR;
      ctx.fillRect(x + 3, y + 3, TILE - 6, Math.max(1, Math.min(TILE - 6, prop.timer)));
      return;
    case PropState.OPEN:
      ctx.fillStyle = '#25131a';
      ctx.fillRect(x + 4, y + 6, TILE - 8, TILE - 10);
      return;
    case PropState.SLIDING:
      // Both tiles stay solid for the whole slide; the destination is the outlined one.
      ctx.strokeStyle = SLIDE_COLOR;
      if (prop.slideTo) {
        ctx.strokeRect(
          ox + prop.slideTo[0] * TILE + 1.5,
          oy + prop.slideTo[1] * TILE + 1.5,
          TILE - 3,
          TILE - 3,
        );
      }
      return;
    default:
      // IDLE: the PROP tile underneath already says everything.
      return;
  }
}

/** Enemies show their hitbox, their state initial, and a white flash while stunned. */
function drawEnemy(ctx: CanvasRenderingContext2D, entity: SimEntity, ox: number, oy: number): void {
  const box = boxOf(entity.kind);
  const x = ox + entity.x / SUBPX + box.offX;
  const y = oy + entity.y / SUBPX + box.offY;

  ctx.fillStyle =
    entity.state === EnemyState.DYING
      ? ENEMY_DYING_COLOR
      : entity.state === EnemyState.SPAWNING
        ? ENEMY_SPAWNING_COLOR
        : entity.hitstun > 0
          ? ENEMY_STUNNED_COLOR
          : ENEMY_COLOR;
  ctx.fillRect(x, y, box.w, box.h);

  ctx.fillStyle = '#25131a';
  ctx.font = '6px monospace';
  ctx.textBaseline = 'top';
  ctx.fillText(EnemyState[entity.state]?.[0] ?? '?', x + 1, y + 1);
  ctx.textBaseline = 'middle';
}

/** A one-line status strip where the HUD will go (04-ui §1, M6). */
function drawStatus(ctx: CanvasRenderingContext2D, sim: Sim): void {
  ctx.fillStyle = '#25131a';
  ctx.fillRect(0, 0, VIEW_W, HUD_H);
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = '8px monospace';
  ctx.textBaseline = 'middle';

  const tile = `${Math.floor(sim.player.x / TILE_SUBPX)},${Math.floor(sim.player.y / TILE_SUBPX)}`;
  const keys = `${sim.silverKeys}${sim.goldKey ? '+G' : ''}`;
  const foes = sim.entities.length > 0 ? `  foes ${sim.entities.length}` : '';
  const seal = sim.seal === 1 ? '  SEALED' : '';
  const win = sim.victory ? '  VICTORY' : '';
  ctx.fillText(
    `${sim.floor.id.toUpperCase()} ${sim.roomId} (${tile})  hp ${sim.player.hp}  $${sim.treasure}  keys ${keys}${foes}${seal}${win}  t${sim.playTick}`,
    3,
    HUD_H / 2,
  );
}
