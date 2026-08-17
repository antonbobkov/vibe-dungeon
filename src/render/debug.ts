/**
 * Debug renderer — flat rectangles per tile class, no art.
 *
 * This is the "for humans, not tested" view of milestone M2: enough to walk the 26 rooms
 * and see that doors, transitions and pickups are where the maps say. M6 replaces it with
 * the real Pack A renderer; the layout maths here (room centring, 03 §1.1) is the same.
 */

import { isSwingActive, swordRect } from '../sim/combat.js';
import { PLAYER_BOX, SUBPX, TILE, TILE_SUBPX, VIEW_W, HUD_H, PLAY_H } from '../sim/constants.js';
import { EnemyState, boxOf, type SimEntity } from '../sim/enemy.js';
import { TileClass, tileAt } from '../sim/room.js';
import type { Sim } from '../sim/sim.js';

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
const SWORD_COLOR = '#adc1cf';
const PLAYER_COLOR = '#adc1cf';
const TRAP_COLOR = '#78514f';
const TEXT_COLOR = '#adc1cf';

/** Rooms are centred in the play area, everything around them is void (03 §1.1). */
export function roomOrigin(room: { w: number; h: number }): { ox: number; oy: number } {
  return {
    ox: Math.floor((VIEW_W - room.w * TILE) / 2),
    oy: HUD_H + Math.floor((PLAY_H - room.h * TILE) / 2),
  };
}

export function drawDebug(ctx: CanvasRenderingContext2D, sim: Sim): void {
  const room = sim.room;
  const { ox, oy } = roomOrigin(room);

  for (let row = 0; row < room.h; row++) {
    for (let col = 0; col < room.w; col++) {
      ctx.fillStyle = COLORS[tileAt(room, col, row)];
      ctx.fillRect(ox + col * TILE, oy + row * TILE, TILE, TILE);
    }
  }

  // Traps mark the tile they make deadly (02 §3); harmless until M4, but worth seeing.
  ctx.fillStyle = TRAP_COLOR;
  for (const trap of sim.traps) {
    if (!trap.def.deadly) continue;
    const [col, row] = trap.def.deadly;
    ctx.fillRect(ox + col * TILE + 4, oy + row * TILE + 4, TILE - 8, TILE - 8);
  }

  ctx.fillStyle = PICKUP_COLOR;
  for (const pickup of sim.pickups) {
    ctx.fillRect(ox + pickup.at[0] * TILE + 5, oy + pickup.at[1] * TILE + 5, 6, 6);
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

/** Enemies show their hitbox, their state initial, and a white flash while stunned. */
function drawEnemy(ctx: CanvasRenderingContext2D, entity: SimEntity, ox: number, oy: number): void {
  const box = boxOf(entity.kind);
  const x = ox + entity.x / SUBPX + box.offX;
  const y = oy + entity.y / SUBPX + box.offY;

  ctx.fillStyle =
    entity.state === EnemyState.DYING
      ? ENEMY_DYING_COLOR
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
  ctx.fillText(
    `${sim.floor.id.toUpperCase()} ${sim.roomId} (${tile})  hp ${sim.player.hp}  $${sim.treasure}  keys ${keys}${foes}  t${sim.playTick}`,
    3,
    HUD_H / 2,
  );
}
