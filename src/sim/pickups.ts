/**
 * Pickups and inventory — 01-mechanics §7.
 *
 * Collected on overlap with the player hitbox, no attract radius. The blue-flask timer is
 * set here but nothing reads it until damage exists (M3); the flasks' healing is already
 * live because respawn HP and the checkpoint depend on it.
 */

import { MAX_HP } from './constants.js';
import type { PickupName } from './level.js';
import type { Player } from './player.js';

/** Invulnerability granted by the blue flasks, in ticks (01 §7). */
export const INVULN_TICKS: Readonly<Record<'blue_small' | 'blue_large', number>> = {
  blue_small: 180,
  blue_large: 360,
};

/** What a run carries between rooms and floors (01 §7, §9). */
export interface Inventory {
  treasure: number;
  silverKeys: number;
  goldKey: boolean;
}

/**
 * Apply one pickup. Flasks always apply, even at full HP — a red flask at 6 HP is consumed
 * with no effect (01 §7). Invulnerability replaces any remaining time rather than stacking.
 */
export function grantPickup(kind: PickupName, player: Player, inventory: Inventory): void {
  switch (kind) {
    case 'coin':
      inventory.treasure++;
      return;
    case 'silver_key':
      inventory.silverKeys++;
      return;
    case 'gold_key':
      inventory.goldKey = true;
      return;
    case 'red_small':
      player.hp = Math.min(MAX_HP, player.hp + 2);
      return;
    case 'red_large':
      player.hp = MAX_HP;
      return;
    case 'blue_small':
      player.invulnTimer = INVULN_TICKS.blue_small;
      return;
    case 'blue_large':
      player.invulnTimer = INVULN_TICKS.blue_large;
      return;
  }
}
