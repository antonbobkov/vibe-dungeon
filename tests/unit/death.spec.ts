import { describe, expect, it } from 'vitest';

import { DEATH_BLACK_TICKS, DYING_TICKS, RESPAWN_MIN_HP } from '../../src/sim/constants.js';
import { RIGHT, UP } from '../../src/sim/input.js';
import { Facing, PlayerState } from '../../src/sim/player.js';
import { game, hold, runUntil } from './helpers.js';

/**
 * 01-mechanics §6. Nothing damages the player until M3, so these drive the sequence by
 * zeroing HP directly — the "scripted death" of the M2 checklist.
 */
describe('death and respawn', () => {
  it('runs 60 ticks of DYING then 30 of black, and respawns on the 90th', () => {
    const s = game();
    hold(s, RIGHT, 20); // walk away from the spawn so the restore is visible
    const away = s.player.x;
    s.player.hp = 0;

    s.tick(0);
    expect(s.player.state).toBe(PlayerState.DYING);
    expect(s.player.stateTimer).toBe(DYING_TICKS - 1);

    hold(s, 0, DYING_TICKS - 1);
    expect(s.script).toEqual({ kind: 'respawn', ticksLeft: DEATH_BLACK_TICKS });
    expect(s.player.x).toBe(away); // still lying where it fell
    expect(s.deaths).toBe(0);

    hold(s, 0, DEATH_BLACK_TICKS - 1);
    expect(s.script).not.toBeNull();

    s.tick(0);
    expect(s.script).toBeNull();
    expect(s.player.state).toBe(PlayerState.NORMAL);
    expect(s.deaths).toBe(1);
  });

  it('restores the checkpoint recorded on room entry', () => {
    const s = game();
    const spawn = { x: s.player.x, y: s.player.y };
    hold(s, RIGHT, 20);
    s.player.hp = 0;
    hold(s, 0, DYING_TICKS + DEATH_BLACK_TICKS);

    expect([s.player.x, s.player.y]).toEqual([spawn.x, spawn.y]);
    expect(s.player.facing).toBe(Facing.D);
  });

  it('restores max(HP at room entry, 4)', () => {
    const s = game({ hp: 2 });
    expect(s.checkpoint.hp).toBe(2);
    s.player.hp = 0;
    hold(s, 0, DYING_TICKS + DEATH_BLACK_TICKS);
    expect(s.player.hp).toBe(RESPAWN_MIN_HP); // 2 was worse than the floor of 4

    // A healthier entry is restored as-is.
    const healthy = game({ hp: 6 });
    healthy.player.hp = 0;
    hold(healthy, 0, DYING_TICKS + DEATH_BLACK_TICKS);
    expect(healthy.player.hp).toBe(6);
  });

  it('takes the checkpoint from the room entered, not the floor start', () => {
    const s = game();
    runUntil(s, UP, (sim) => sim.roomId === 'R2', 200);
    expect(s.checkpoint).toMatchObject({ x: 1152, y: 1792 });

    hold(s, RIGHT, 30);
    s.player.hp = 0;
    hold(s, 0, DYING_TICKS + DEATH_BLACK_TICKS);
    expect(s.roomId).toBe('R2');
    expect([s.player.x, s.player.y]).toEqual([1152, 1792]);
  });

  it('ignores input while dying', () => {
    const s = game();
    s.player.hp = 0;
    s.tick(0);
    const spot = s.player.x;
    hold(s, RIGHT, DYING_TICKS - 2);
    expect(s.player.x).toBe(spot);
  });

  it('rebuilds the room but keeps every persistent flag (01 §6, §9)', () => {
    const s = game();
    runUntil(s, UP, (sim) => sim.treasure === 2, 100); // pocket two coins on the way north
    runUntil(s, UP, (sim) => sim.isDoorOpen('d1'), 100); // and open d1, stopping short of it
    expect(s.pickups).toHaveLength(2);
    expect(s.roomId).toBe('R1');

    s.player.hp = 0;
    hold(s, 0, DYING_TICKS + DEATH_BLACK_TICKS);

    expect(s.treasure).toBe(2); // treasure persists across floors, let alone deaths
    expect(s.pickups).toHaveLength(2); // and the collected coins stay collected
    expect(s.isDoorOpen('d1')).toBe(true); // as does the door opened on the way
    expect(s.roomTimer).toBe(0); // but the room clock restarts
  });

  it('counts every death', () => {
    const s = game();
    for (let i = 1; i <= 3; i++) {
      s.player.hp = 0;
      hold(s, 0, DYING_TICKS + DEATH_BLACK_TICKS);
      expect(s.deaths).toBe(i);
    }
  });
});
