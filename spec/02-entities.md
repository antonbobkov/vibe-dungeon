# UNDERVAULT — 02: Entities

Every entity type in the game: constants, behaviour (finite state machines), and art
source. Art references are Pack A per ASSET_GUIDE.md (`AG`). Movement uses the
axis-separated collision of 01-mechanics §3; knockback direction snapping is 01 §4.2.

## 1. Player

| Property | Value |
|---|---|
| Sprite | 16×16 knight. Idle/walk frames: `Character_animation/priests_idle/priest1/` **v1** (plain, no bracket — AG §3.4 gotcha: for priests, *v2* is bracketed) |
| Hitbox | 10 × 8 px at offset (3, 8) |
| HP / speed / states | 01-mechanics §3.3–§6 |

### 1.1 Animation & motion polish (renderer-only; no sim effect)

- Idle: 4-frame loop at 8 ticks/frame.
- Walking: same loop at 5 ticks/frame **plus walk bob**: sprite y-offset −1 px on ticks
  4–7 of each 8-tick bob cycle while moving.
- Facing left: draw horizontally flipped; right: unflipped; up/down: unflipped.
- SWING: lunge and code-drawn arc per 01 §4.2.
- Damage: all opaque sprite pixels drawn `#ffffff` for 2 ticks; then i-frame blink.
- Invulnerability (blue flask): steel pixels (`#adc1cf`, `#90919e`) tinted `#62abd4`.

## 2. Enemies

### 2.1 Common rules

| Rule | Value |
|---|---|
| Hitbox (grounded: skeletons, zombie) | 12 × 10 px at offset (2, 6) |
| Hitbox (wisp) | 10 × 10 px at offset (3, 3) |
| Contact damage | applied on player-hitbox overlap (01 §5); enemy is not interrupted |
| Trap immunity | enemies and bolts never damage enemies; traps never damage enemies |
| Facing/flip | sprite flipped horizontally when target/velocity points left |
| Damage reaction | flash `#ffffff` 2 ticks; knockback + hitstun per 01 §4.2 unless resistant (below) |
| Death | on HP ≤ 0: white flash 2 ticks, then fade-out + 2 px upward drift over 10 ticks (no collision, no damage during this); then spawn its `drop` (if any, from level data) at its current tile |
| Room bounds | enemies never leave their room; clamped to interior tiles |
| Walk anim | 4-frame idle loop; 8 ticks/frame idle, 5 ticks/frame moving, plus the same walk bob as the player |

**Chase steering** (used by all): let `(dx, dy)` = player hitbox centre − enemy hitbox
centre in subpx. If `|dx| > 8` and `|dy| > 8`: move diagonally, each axis at
`(speed*181)>>8` signed. Else move at full speed along the axis with the larger `|·|`
(ties: horizontal). No pathfinding; rooms are designed open enough.

**Enemy separation**: after movement, for each pair of overlapping enemy hitboxes, push
each 4 subpx along the axis of least overlap (processed in ascending spawn-id pair order).

**Line of sight (LOS)**: sample the segment between the two hitbox centres at
`N = max(1, ceil(dist_px / 8))` evenly spaced points (integer interpolation
`P_i = A + ((B−A)*i)/N`); LOS holds if no sampled point lies in a wall, closed-door, or
solid-prop tile.

### 2.2 Enemy types

#### skel_sword — Skeleton with sword

Sprite: `monsters_idle/skeleton1/` **v2** (plain). | HP **2** | speed **12** | contact damage **1**

| State | Behaviour | Transition |
|---|---|---|
| IDLE | stand, idle anim | player within 112 px (7 tiles) AND LOS → CHASE; takes damage → CHASE |
| CHASE | chase steering at speed 12 | distance ≤ 24 px → WINDUP |
| WINDUP | stand 24 ticks; renderer shakes sprite ±1 px per 2 ticks; lock target direction = 8-dir toward player at windup start | after 24 ticks → LUNGE |
| LUNGE | move in locked direction at 40 subpx/tick for 12 ticks (collides normally) | after 12 ticks → RECOVER |
| RECOVER | stand 18 ticks | → CHASE |

Damage taken in any state applies knockback + 8-tick hitstun (state timer pauses).

#### skel_axe — Skeleton with axe

Sprite: `monsters_idle/skeleton2/` **v2**. | HP **4** | speed **8** | contact damage **2**

| State | Behaviour | Transition |
|---|---|---|
| IDLE | stand | player within 144 px OR takes damage → CHASE |
| CHASE | chase steering at speed 8, never stops, no LOS needed once aggroed | — |

Knockback resistant: initial knockback 24 subpx/tick (decay −6), hitstun 4 ticks.

#### zombie — Robed shambler

Sprite: `monsters_idle/vampire/` **v2** (the robed zombie, AG §3.4). | HP **3** | speed **7** | contact damage **1**

Always in CHASE while the player is in the room (no aggro condition, no LOS). Knockback
resistant like skel_axe. Slow, inevitable; used as a pressure enemy in puzzle rooms.

#### wisp — Blue flaming skull

Sprite: `monsters_idle/skull/` **v2**. | HP **1** | speed **16** | contact damage **1**

Flies: ignores pits, props, and traps for movement; blocked only by walls and closed
doors. Movement each tick: chase-steering velocity toward the player **plus** a
perpendicular wobble: `v_perp = (12 * SIN[ (roomTimer / 4) mod 16 ]) >> 6` subpx/tick
(`roomTimer` = ticks since room entry, the same clock traps use, §3)
applied at 90° clockwise from the (8-dir snapped) chase direction, where
`SIN = [0,24,45,59,64,59,45,24,0,−24,−45,−59,−64,−59,−45,−24]`.
Dies to any hit (no knockback/hitstun needed). Aggro: same as skel_sword (112 px + LOS),
but once aggroed stays aggroed.

### 2.3 Wave spawning (arena rooms)

A room may define a `waves` table: an ordered list of waves, each a list of
`(enemy type, tile, drop?)`. Wave 1 spawns on room entry (after the combat seal closes).
Wave *n+1* spawns 30 ticks after the last enemy of wave *n* dies. Spawn sequence per
enemy: a **spawn telegraph** for 30 ticks — the `interface/square_up_down` cursor
animation looping on the spawn tile — then the enemy appears with 12 ticks of blink-in
during which it is inactive and unhittable. Waves count as "enemies present" for the
combat seal (01 §8.3).

## 3. Traps

All traps are tile-locked, damage the player only, and run off the **room timer**
(ticks since room entry) so their phase is deterministic on every entry. Per-placement
level data: `period` (default per type), `offset`, `always_on` (bool).

Phase = `(roomTimer + offset) mod period`. Deadly window = `phase ≥ (3*period)/5`
(integer division), i.e. the last 40% of the cycle. Telegraph = the 12 ticks before the
deadly window. `always_on` traps are permanently deadly (telegraph none).

| Type | Default period | Default deadly window |
|---|---|---|
| spike | 120 | 72–119 (48 ticks) |
| arrow launcher | 90 | fires at phase 0 (see below) |
| flame jet | 150 | 90–149 (60 ticks) |

### 3.1 Spike trap (`s`)

Occupies one floor tile; deadly area = its tile; damage 1. Art: `items and
trap_animation/peaks/`, play order retracted→extended `3 → 4 → 2 → 1` (AG §3.5):
safe phase = frame 3; telegraph = frame 4; deadly = frames 2 then 1 (switch at deadly
start + 6 ticks); the retraction plays the sequence backwards over the first 6 ticks of
the safe phase. Spike tiles are walkable at all times (damage, not collision).

### 3.2 Arrow launcher (`a`)

Sits in a **top-wall cell only** (the art fires downward, AG §3.5 — there is no
side-firing or up-firing variant, and levels must not ask for one). Emitter art:
`arrow/arrow_*` 16×32 frames anchored so the emitter hole is in the wall cell; fire
sequence idle→fire `2 → 3 → 4 → 1` played over the 12 ticks after firing.

At phase 0 it spawns a **bolt**: sprite `arrow/Just_arrow.png`, hitbox 4 × 10 px centred
horizontally in the lane, top edge starting at the top of the tile below the launcher;
velocity 40 subpx/tick straight down; damage 1. The bolt despawns on: hitting the player,
entering a wall/closed-door tile, entering a tile occupied by any crate (pushable or
destructible — this is the crate-shadow mechanic used by puzzles), or leaving the room.
Bolts pass over pits, pickups, spikes, and enemies.

### 3.3 Flame jet (`f`, `>`, `<`)

`f`: emitter in a top-wall cell, deadly area = the single tile directly below.
Art `flamethrower/flamethrower_1_*` (16×32, nozzle in the wall cell, flame over the tile
below). `>`: emitter in a left-wall cell, deadly tile to its right, art
`flamethrower_2_*` (32×16). `<`: same art horizontally flipped, emitter in a right-wall
cell, deadly tile to its left. Damage 1. Anim: off→full `4 → 3 → 1 → 2` (AG §3.5):
safe = frame 4 (empty), telegraph = frame 3 (sputter), deadly = frames 1↔2 alternating
every 4 ticks. Flame jets are exactly one tile long — never ask for longer.

## 4. Props

### 4.1 Chests

| | Large chest | Mini chest |
|---|---|---|
| Static closed art | `(4,8)` | `(5,8)` |
| Idle anim (closed) | `chest/chest_1..4` loop | `mini_chest/mini_chest_1..4` loop |
| Open anim | `chest/chest_open_1..4`, play once, hold frame 4 | `mini_chest/mini_chest_open_1..4` |

Solid; interactive (01 §4.3). On interact: state OPENING for 16 ticks (4 ticks/frame),
then grant the chest's `contents` list (level data) directly to the player — each item's
icon floats up 8 px over 30 ticks above the chest (renderer) as it is granted, in list
order, 10 ticks apart. Coins in contents increment treasure. Chests never re-close;
contents are granted exactly once (persists per 01 §9). The **Great Vault chest**
(floor 4) is a large chest whose wiring triggers victory (03-levels F4).

### 4.2 Crates

**Destructible** — wooden `x` (art `(0,8)`, destruction anim `box_2/`), steel `X`
(art `(1,8)`, anim `box_1/`). Solid; destroyed by one sword hit: DESTROYING 12 ticks
(3 ticks/frame), then removed (persists) and its `drop` (level data: coin / flask / none)
spawns on its tile. Blocks bolts (despawns them) while intact.

**Pushable** — `p` (art `(9,4)`, the stacked crates; no destruction — sword hits do
nothing). Solid to everything; blocks bolts. Push rule: while the player is in NORMAL
state, walking into the crate with a cardinal movement component toward it for
**6 consecutive contact ticks**, the crate slides exactly 1 tile in that direction over
**12 ticks** (solid throughout; the 6-tick charge resets if contact breaks). The
destination cell must be either:

- a plain floor tile containing no entity, prop, pickup, trap, or door — the crate
  simply moves; or
- a **pit** tile (`_`) — the crate slides in, drops 4 px and darkens over 10 ticks
  (renderer), and is consumed: the pit becomes a permanent **bridged** walkable tile
  with the crate art drawn as its floor (black-backed art against the pit's void reads
  correctly, AG §2.2). Bridging persists; the crate object is gone.

Otherwise the push is refused (no charge accumulation against unpushable directions).
Pushable crates that were not consumed reset to their map positions on every room entry
(01 §9), which cleanly undoes any jammed configuration.

### 4.3 Torches and lights

- Decor torch `t` (in a wall cell): `torch/torch_1..4` loop. Pure decoration + light.
- Puzzle torch `u` (on a floor tile): unlit candlestick, static art `(4,9)`; solid;
  interactive. On interact: becomes lit (`torch/candlestick_1_1..4` loop, art `(3,9)`
  static equivalent) and reports to its **torch group** (level data: member list, target
  wiring, optional `window` in ticks). Group logic: lighting the first torch starts the
  group timer; if `window` is set and expires before all members are lit, all members
  revert to unlit (renderer: small smoke puff, 6 ticks) and the timer clears. When all
  members are lit: the group's wiring effect fires (03-levels §1.6) and the torches stay
  lit permanently (persists). Lit puzzle torches cannot be un-lit by the player.

### 4.4 Decor (no collision, no logic)

Placed via each room's decor table (03-levels): banner `flag/flag_1..4` loop (wall cell);
bone decals `(4,6)`, `(5,6)`, `(8,6)`, `(7,7)`; wall shield `(4,7)`; shackle `(5,7)`.
Renderer must draw exactly what the decor table lists — nothing procedural — so visual
goldens stay stable.

### 4.5 Descent ladder (`V`)

Art `(9,3)` stacked ×2 in a top-wall cell (black-backed, reads against the wall/void).
Trigger behaviour: 01 §8.4.

## 5. Pickups

All are 16×16, collected on overlap (01 §7), drawn on the floor-props layer.

| Pickup | Static art | Animation |
|---|---|---|
| Coin | `(6,8)` | `coin/coin_1..4` loop |
| Red flask small | `(9,8)` | `flasks/flasks_1_*` loop |
| Red flask large | `(8,9)` | `flasks/flasks_4_*` loop |
| Blue flask small | `(7,8)` | `flasks/flasks_2_*` loop |
| Blue flask large | `(7,9)` | `flasks/flasks_3_*` loop |
| Silver key | `(8,8)` | `keys/keys_2_*` loop |
| Gold key | `(9,9)` | `keys/keys_1_*` loop |

Pickups granted from chests or enemy drops are identical objects spawned on a tile
(drops) or granted directly (chests, 02 §4.1).
