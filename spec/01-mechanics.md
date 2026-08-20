# UNDERVAULT — 01: Core Mechanics

Units: ticks (1/60 s) and subpixels (subpx, 1/16 px) throughout. See 00-overview for
conventions. Entity-specific constants (enemy HP, trap cycles) are in 02-entities.md; this
file defines the player and all systems.

## 1. Simulation loop and update order

One tick executes these phases in exactly this order:

1. **Input latch** — read the current input bitmask (from device or replay).
2. **Global timers** — advance play-time counter; decrement hit-stop counter (if hit-stop
   is active, skip phases 3–9 this tick; renderer still draws).
3. **Player update** — state machine (§4.1), then movement + collision (§3).
4. **Enemy updates** — in ascending spawn-id order (spawn ids assigned by level loader in
   document order of the room's entity table).
5. **Projectile updates** — arrow bolts, in ascending spawn order.
6. **Trap updates** — advance phase counters; compute deadly sets.
7. **Overlap resolution** — pickups, damage application (§5), trigger zones (door proximity,
   ladder cells), in this order.
8. **Wiring evaluation** — check trigger conditions, fire effects (03-levels §1.6).
9. **Room bookkeeping** — combat-seal check, wave spawning, cleared flags.
10. **State hash** (only when a test/debug flag requests it).

Room transitions (§8) and death sequences (§6) suspend this loop with their own scripted
tick sequences; during them only the named animation timers advance.

## 2. Input

| Bit | Name | Default keys |
|---|---|---|
| 0 | UP | ArrowUp, W |
| 1 | DOWN | ArrowDown, S |
| 2 | LEFT | ArrowLeft, A |
| 3 | RIGHT | ArrowRight, D |
| 4 | ATTACK | X, J, Space, Backspace |
| 5 | INTERACT | Z, K, E |

Every bound key is `preventDefault`ed, which is also what stops Space scrolling the page and
Backspace navigating away.

Pause (Escape, P) is **not** a sim input: it halts the loop entirely and is not recorded in
replays. Opposing directions held together cancel (net 0 on that axis). ATTACK and INTERACT
act on **press** (edge-triggered: bit set this tick, clear previous tick).

## 3. Movement and collision

### 3.1 Solidity

Each tile in a room is one of (mapping from map symbols: 03-levels §1.2):

| Class | Solid to player/grounded enemies | Solid to wisp | Solid to bolts |
|---|---|---|---|
| floor | no | no | no |
| wall | yes | yes | yes (bolt despawns) |
| pit (`_`) | yes | no | no |
| bridged pit (crate consumed, §see 02 §4.2) | no | no | no |
| closed/locked/sealed door cell | yes | yes | yes |
| open door cell | no | no | no |
| prop (chest, crate, torch stand) | yes | no | yes for crates (despawn), no for others |
| pickup, decal | no | no | no |

Entities collide with tiles via their **hitbox** (an axis-aligned rectangle at a fixed
pixel offset from the entity's sprite-cell top-left; per-entity values in 02-entities).
Entities do not collide with each other for movement purposes except: enemy–enemy
separation (02-entities §2.2) and the pushable-crate rule (02-entities §4.2).

### 3.2 Axis-separated movement

Per tick, an entity with velocity `(vx, vy)` subpx:

1. Move X: `x += vx`. If the hitbox now overlaps any solid tile, clamp x so the hitbox is
   flush against the tile edge (zero the fractional subpx toward the wall).
2. Move Y: same for `y += vy`.

This yields wall sliding for free and enforces the corner rule: an entity cannot pass
diagonally between two solid tiles that touch at a corner.

### 3.3 Player walking

| Constant | Value |
|---|---|
| `WALK_SPEED` | 20 subpx/tick (= 1.25 px/tick = 75 px/s) |
| Diagonal per-axis speed | `(20 * 181) >> 8` = **14** subpx/tick |
| Player hitbox | 10 × 8 px at offset (3, 8) from sprite top-left ("feet box") |

Velocity is direction × speed; there is no acceleration or friction — movement stops the
tick input is released. **Facing** is one of U/D/L/R: when input includes a horizontal
component, facing becomes that horizontal direction; otherwise, if vertical input is held,
facing becomes that vertical direction; with no input, facing is unchanged.

## 4. Player state machine and combat

### 4.1 Player states

| State | Entered by | Duration | Movement | Exits to |
|---|---|---|---|---|
| NORMAL | default | — | free | ATTACK→SWING; damage→HURT; HP≤0→DYING |
| SWING | ATTACK press in NORMAL | 14 ticks | locked ticks 0–9, free 10–13 | NORMAL at tick 14 (ATTACK may re-trigger from tick 14) |
| HURT | taking damage | 12 ticks | knockback only (§5.2), input ignored ticks 0–5 | NORMAL (i-frames continue independently) |
| DYING | HP ≤ 0 | 60 ticks | none | respawn (§6) |
| SCRIPTED | transitions, chest-open, victory | varies | scripted | NORMAL |

### 4.2 Sword swing

| Constant | Value |
|---|---|
| Swing duration | 14 ticks |
| Active window | ticks 3–9 inclusive |
| Damage | 1 |
| Hitbox | 16 × 16 px, at sprite-cell offset by facing: R (+14,0), L (−14,0), U (0,−14), D (0,+14) |
| Hit targets | enemies, destructible crates (once each per swing) |
| Enemy knockback | initial 48 subpx/tick away from player centre, −6 subpx/tick decay |
| Enemy hitstun | 8 ticks |
| Hit-stop | 3 ticks of sim freeze when a swing connects with ≥1 enemy |

"Away from player centre" for all knockback in this game: the vector from attacker's hitbox
centre to victim's hitbox centre, snapped to the nearest of the 8 compass directions
(ties resolve clockwise starting from U); diagonal knockback uses the 181/256 per-axis rule.
Each swing damages any given target at most once. The swing cannot be cancelled.

Visual (renderer, for completeness — no sim effect): player sprite lunges 2 px toward
facing during ticks 3–9; a quarter-circle arc of radius 14 px centred on the sprite centre
sweeps from −50° to +50° around the facing direction across the active window, drawn 2 px
thick in `#adc1cf` with a 1 px `#ffffff` leading edge (colours from AG §2.4).

### 4.3 Interaction

On INTERACT press: compute the **target point** = player sprite centre + 16 px in facing
direction; the target tile is the tile containing that point. If that tile holds an
interactive object (chest, unlit puzzle torch — see 02-entities), trigger it. Otherwise
nothing happens. Range is exactly this one tile; no diagonal interaction.

## 5. Damage, i-frames, knockback

### 5.1 Player health

| Constant | Value |
|---|---|
| `MAX_HP` | 6 (HUD shows 3 hearts, half-heart granularity) |
| I-frames after any damage | 60 ticks (player cannot be damaged again; renderer blinks sprite 3 ticks on / 3 off) |
| Sources | enemy contact (dmg per enemy type), spike (1), bolt (1), flame (1) |

Damage applies when a damage source's hitbox/deadly area overlaps the player hitbox and the
player is not invulnerable (i-frames or blue-flask effect, §7). On damage: subtract HP,
start i-frames, enter HURT, apply knockback, trigger renderer effects (flash white 2 ticks,
screen shake 6 ticks ±2 px, hit-stop 3 ticks).

### 5.2 Player knockback

Initial velocity 48 subpx/tick away from the damage source (8-dir snapped; for traps, away
from the trap tile's centre; if centres coincide, direction = opposite of player facing),
decaying by 4 subpx/tick to 0 (12 ticks, ≈19 px total). Knockback velocity replaces walk
velocity while nonzero and collides normally (no passing through walls).

## 6. Death, checkpoints, respawn

**Checkpoint**: on every room entry, record `(entry position, facing)`. On death (DYING
completes): restore the player at the checkpoint position with
`HP = max(HP_at_room_entry, 4)`, reset the room (§9), increment the deaths counter, keep
all persistent state (§9). There is no game-over; deaths are unlimited.

DYING visual: sprite flips horizontally every 4 ticks while fading out over the last
40 ticks; sim otherwise frozen; then 30 ticks of black before respawn.

## 7. Pickups and inventory

Pickups are collected on overlap with the player hitbox (no attract radius). Each grants:

| Pickup | Effect |
|---|---|
| Coin | treasure +1 |
| Red flask, small | HP +2 (clamped to 6) |
| Red flask, large | HP = 6 |
| Blue flask, small | invulnerable 180 ticks |
| Blue flask, large | invulnerable 360 ticks |
| Silver key | silver keys +1 |
| Gold key | gold key = held (unique; at most one exists per run) |

Blue-flask invulnerability blocks all damage; renderer tints the player sprite's steel
pixels `#62abd4` while active; timers do not stack (new pickup replaces remaining time
with its full duration). Flasks always apply on pickup (even at full HP — a red flask at
6 HP is consumed with no effect; level design keeps this rare). Inventory (treasure, keys)
and HP persist across floors. Collected pickups never respawn (§9).

## 8. Rooms, doors, camera, transitions

### 8.1 Doors and gaps

Door objects connect two rooms; each endpoint occupies 1 cell (`L` steel single door,
AG tile `(8,3)`) or 2 cells (`DD` straight-lintel double `(6,3)+(7,3)`; `PP`/`GG` arched
double `(6,6)+(7,6)`) in a top or bottom wall. Types:

| Type | Symbol | Opens when |
|---|---|---|
| normal | `D`/`DD` | player hitbox centre is within 24 px of the door's centre (opens automatically; never re-closes except sealing) |
| silver-locked | `L` | player interacts (§4.3) or walks against it while `silver keys ≥ 1`; consumes 1 key; permanent |
| gold-locked | `GG` | same, requires the gold key; does not consume it; permanent |
| puzzle | `PP` | its wiring effect fires (03-levels §1.6); permanent |
| **gap** | `D` in a side wall, 2 cells tall | always open (no door art exists for side walls) |

Open/closed tile art per AG §3.2 ("Door open / closed states"): closed = door tiles,
open = doorway background + leaf sprites on the prop layer. A closed/locked/sealed door
cell is solid; an open door cell is walkable.

### 8.2 Room transition

When the player's hitbox centre enters a door cell or gap cell (door must be open), a
transition starts:

1. Sim suspends. Camera slides from the current room view to the next room view over
   **24 ticks** (linear, along the exit direction).
2. Player is placed at the target room's **entry tile**: the floor tile inside the target
   room adjacent to the target door/gap cell (for 2-cell doors/gaps, centred across the
   pair: position x or y = shared edge midpoint − 8 px). Facing = direction of travel.
3. Room-entry processing runs (§9), the checkpoint is recorded, sim resumes.

Enemies, traps, and projectiles in the departed room are discarded (recreated on
re-entry). Only the current room simulates.

### 8.3 Combat seal

Rooms flagged `combat_seal` (in level data): on room entry with ≥1 enemy present (or wave
table pending), all door endpoints in the room close and lock (sealed). When all enemies
are dead (and all waves exhausted, 02-entities §2.3), doors unseal (reopen if previously
open; locked doors return to locked), the room is flagged **cleared permanently**, and any
`on_clear` wiring fires. Cleared `combat_seal` rooms never respawn enemies. Authoring
constraint: `combat_seal` rooms must have no side gaps (gaps cannot seal — no art).

### 8.4 Ladders (floor exit)

The descent ladder `V` (AG tile `(9,3)`, stacked in a top-wall cell against void) is a
trigger: when the player's hitbox overlaps the tile directly below the ladder cell and
UP is held for 12 consecutive ticks, the floor ends: fade out 30 ticks, load the next
floor, spawn at its `@` tile, fade in 30 ticks. HP, treasure, and keys carry over;
silver keys do **not** carry over (each floor's keys equal its locks — enforced by level
lint) — set `silver keys = 0` on floor change. There is no way back up.

## 9. Room state and persistence

On **room entry** (including respawn after death):

- Reset: enemies (respawned at their map positions, full HP, IDLE), trap phase counters
  (to their per-placement offsets), projectiles (cleared), pushable crates (to map
  positions — except crates consumed by pits, which stay consumed; the pit stays bridged).
- Persist (per floor, forever): opened chests (stay open and empty), destroyed
  destructible crates, collected pickups, opened/unlocked doors, lit puzzle torches and
  fired wiring, bridged pits, `combat_seal` cleared flags.
- Persist (across floors): HP, treasure, deaths count, gold key, play time.

A cleared `combat_seal` room re-enters with no enemies. A non-seal room always respawns
its enemies on entry. Torch groups with a time window (02-entities §5.3) that were **not**
completed reset to unlit on room entry.

## 10. Pause

Pause (Escape/P) halts the sim loop and shows the pause overlay (04-ui §4.4). Unpausing
resumes exactly where the sim stopped. Pause is unavailable during room transitions and
the death/victory sequences. Pausing does not advance play time.
