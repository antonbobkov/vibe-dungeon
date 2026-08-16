# UNDERVAULT — 03: Levels

The four floors, room by room, in a form precise enough to transcribe mechanically into
level data (05-data-formats.md). Read §1 (authoring rules) first; §2–§5 are the floors;
§6 is the item economy summary.

## 1. Authoring rules

### 1.1 Rooms and maps

A room is a rectangle of cells, one character each, between `ROOM_MIN` 5×4 and
`ROOM_MAX` 20×12 (00-overview). Row 0 is the top wall row. The ASCII maps below are the
**authoritative level source** — the level JSON embeds these exact strings and the loader
parses them against the legend (§1.2). Coordinates `(col,row)` are room-local, 0-based.

Rooms are centred in the play area: pixel offset `ox = (320 − W*16) / 2` (integer
division), `oy = 16 + (192 − H*16) / 2`. Everything outside the room is `#25131a`.

### 1.2 Map legend

| Char | Meaning | Placed in | Solid | Notes |
|---|---|---|---|---|
| `#` | wall | — | yes | auto-tiled, §1.3 |
| `.` | floor | — | no | auto-tiled, §1.3 |
| `_` | pit (void in floor) | floor area | yes until bridged | render as void `(8,7)`; bridged: crate art `(9,4)` as floor |
| `@` | player spawn (floor entry point) | floor | — | exactly one per floor, in room R1 |
| `V` | descent ladder | top wall | wall | art `(9,3)`; trigger per 01 §8.4 |
| `D` | door/gap cell, normal | top/bottom wall (with a second `D` beside it) or side wall (2 vertically) | until open | double door `(6,3)+(7,3)` when in top/bottom wall; side = open gap |
| `L` | silver-locked door | top/bottom wall, 1 cell | until unlocked | steel door `(8,3)` |
| `P` | puzzle door | top/bottom wall, 2 cells `PP` | until wired open | arched door `(6,6)+(7,6)` |
| `G` | gold-locked door | top/bottom wall, 2 cells `GG` | until unlocked | arched door `(6,6)+(7,6)` |
| `t` | decor torch | wall cell | wall | 02 §4.3 |
| `w` | decor banner | wall cell | wall | `flag/` anim |
| `a` | arrow launcher | top wall cell | wall | 02 §3.2; params in room's trap table |
| `f` | flame jet, downward | top wall cell | wall | 02 §3.3 |
| `>` / `<` | flame jet, right / left | left / right wall cell | wall | 02 §3.3 |
| `s` | spike trap | floor | no (damage only) | 02 §3.1; params in trap table |
| `c` | coin | floor | no | |
| `h` / `H` | red flask small / large | floor | no | `H` appears only via chests/wiring in this game |
| `b` / `B` | blue flask small / large | floor | no | `B` appears only via chests |
| `k` / `K` | silver / gold key | floor | no | `K` appears only via wiring (F4 arena) |
| `m` / `M` | mini chest / large chest | floor | yes | contents in room's prop table |
| `x` / `X` | destructible crate, wooden / steel | floor | yes | drop in prop table |
| `p` | pushable crate | floor | yes | 02 §4.2 |
| `1`–`9` | enemy spawn marker | floor | — | type per room's enemy table |

Every non-`#` symbol in a wall row must itself be in the wall (`V D L P G t w a f`) —
lint enforces. `> <` occupy the leftmost/rightmost column. Every marker symbol used in a
map must have a table entry and vice versa (lint).

### 1.3 Auto-tiling (deterministic — no randomness)

Perimeter walls follow the AG §3.2 room recipe with fixed variant formulas:

| Wall cell | Tile |
|---|---|
| top-left / top-right corner | `(0,0)` / `(5,0)` |
| bottom-left / bottom-right corner | `(0,4)` / `(5,4)` |
| top wall | `(1 + (col mod 4), 0)` |
| bottom wall | `(1 + (col mod 4), 4)` |
| left / right wall | `(0, 1 + (row mod 3))` / `(5, 1 + (row mod 3))` |

Side gaps: the wall cell directly **above** a side gap becomes the bottom-cap corner
(`(0,4)` left wall / `(5,4)` right wall); the cell directly **below** it becomes the top
corner (`(0,0)` / `(5,0)`). Interior free-standing `#` blocks: top row of the block =
coping `(1 + (col mod 4), 4)`; other rows = wall face, `(1,5)` for even cols, `(2,5)`
for odd.

Floor cells: if adjacent (4-neighbour) to a wall/door cell, use the shaded block —
row index: 1 if wall above, 3 if wall below, else 2; col index: 1 if wall left, 4 if
wall right, else 2 + (col mod 2) — giving tile `(colIdx, rowIdx)` from the `(1..4,1..3)`
block. Otherwise use plain floor variant `v = (col*3 + row*5) mod 12`, tile
`(6 + (v mod 4), v div 4)`.

### 1.4 Doors

Door objects are declared per floor (tables below) with two endpoints
`room:(cells)` and a type (01 §8.1). Side gaps are two vertically adjacent `D` cells in
a side wall and are always type *gap*. Locked/puzzle doors appear only in top/bottom
walls. Endpoint cell coordinates in the door tables must match the map symbols (lint).

### 1.5 Room tables

Each room lists: **Enemies** (marker → type, drop), **Traps** (coords → period, offset,
always_on), **Props** (chest contents, crate drops), **Decor** (art tile → wall/floor
cell). Omitted tables are empty. Drops/contents use pickup names from 01 §7.

### 1.6 Wiring

Level data contains `wiring` entries: `trigger → effect`.

| Trigger | Fires when |
|---|---|
| `torch_group(id)` | all torches in the group are lit (02 §4.3) |
| `room_clear(room)` | a `combat_seal` room's enemies+waves are exhausted (01 §8.3) |
| `chest_open(room, cell)` | that chest's OPENING completes |

| Effect | Does |
|---|---|
| `open_door(id)` | opens a puzzle door permanently |
| `spawn(room, cell, pickup)` | spawns a pickup on a floor tile |
| `victory` | starts the victory sequence (04-ui §4.3) |

All wiring is per-floor and fires at most once (persists, 01 §9).

### 1.7 Validation (level lint — see TESTING.md)

Perimeter closed except declared doors/gaps; all symbols legal for their position; door
endpoints match maps; every floor's silver keys = silver locks and every key is
statically reachable before its lock (reachability over floor tiles, treating traps as
passable, pits as passable iff the room contains a pushable crate); room sizes within
bounds; `combat_seal` rooms have no side gaps and at least one wall door; coin/marker
counts match the totals in §6; exactly one `@` on floor 1..4's first room; every floor
has exactly one `V` except floor 4 (none — the game ends at the vault).

---

## 2. Floor 1 — The Gatehouse

Teaches: movement, sword, coins, crates, chests, keys, locked doors, descent.
Target first-run time: 3–4 minutes. Enemies: skeleton (sword) only.

Connections: R1─d1─R2 · R2─d2(gap)─R3 · R2─d3(silver)─R4 · R4─d4─R5 · R5─d5(gap)─R6(ladder).

| Door | Type | Endpoint A | Endpoint B |
|---|---|---|---|
| d1 | normal | R1 top `(4,0)(5,0)` | R2 bottom `(4,8)(5,8)` |
| d2 | gap | R2 east `(12,4)(12,5)` | R3 west `(0,3)(0,4)` |
| d3 | silver | R2 top `(6,0)` | R4 bottom `(5,8)` |
| d4 | normal | R4 top `(4,0)(5,0)` | R5 bottom `(4,6)(5,6)` |
| d5 | gap | R5 east `(10,3)(10,4)` | R6 west `(0,3)(0,4)` |

### R1 "Entry Hall" — 11×8

```
##t#DD#t###
#.........#
#...cc....#
#...cc....#
#.........#
#.........#
#....@....#
###########
```

Props: none. 4 coins. The player wakes here; walking is the only requirement.

### R2 "Broken Hall" — 13×9. *First fight.*

```
######L######
#...........#
#.x.......x.#
#...........#
#.....1.....D
#...........D
#.....c.....#
#...........#
####DD#######
```

| Enemies | Props |
|---|---|
| `1`(6,4) skel_sword, drop: none | `x`(1,2) drop: coin · `x`(10,2) drop: none |

Decor: bones `(4,6)` at floor (3,6); wall shield `(4,7)` at wall cell (9,0).

### R3 "Collapsed Store" — 9×7. *Key room.*

```
#########
#..x....#
#....c..#
D....1..#
D..c....#
#.c...m.#
#########
```

| Enemies | Props |
|---|---|
| `1`(5,3) skel_sword, drop: none | `m`(6,5) contents: [silver key] · `x`(3,1) drop: coin |

### R4 "Guard Room" — 11×9. *Behind silver door d3.*

```
#t##DD###t#
#.........#
#..1...2..#
#.........#
#.........#
#....h....#
#....c....#
#.........#
#####L#####
```

| Enemies |
|---|
| `1`(3,2) skel_sword · `2`(7,2) skel_sword, drops: none |

### R5 "Old Treasury" — 11×7

```
#t#######t#
#....M....#
#.x.....X.#
#.........D
#.........D
#.........#
####DD#####
```

| Props |
|---|
| `M`(5,1) contents: [coin ×5, red flask small] · `x`(2,2) drop: coin · `X`(8,2) drop: none |

### R6 "Descent" — 7×7

```
###V#w#
#.....#
#.c.c.#
D..c..#
D.....#
#.....#
#######
```

Decor: `w`(5,0) is a banner (`flag/` anim) on the wall beside the ladder.

### Floor 1 solution path (basis of replay `f1.replay`)

| # | Where | Action | Assert after |
|---|---|---|---|
| 1 | R1 | collect 4 coins, exit north (d1) | room=R2, treasure=4 |
| 2 | R2 | kill skeleton, break both crates, collect 2 coins | treasure=6 |
| 3 | R2→R3 | east gap; kill skeleton; collect 4 coins (one in crate); open mini chest | treasure=10, silver keys=1 |
| 4 | R3→R2 | back; unlock d3 (key consumed), north | room=R4, silver keys=0 |
| 5 | R4 | kill 2 skeletons; take flask+coin; exit north | room=R5, treasure=11 |
| 6 | R5 | open chest (5 coins + flask), break crates (+1 coin) | treasure=17 |
| 7 | R5→R6 | east gap; collect 3 coins; hold UP under ladder | floor=2, treasure=20 |

---

## 3. Floor 2 — The Vaults

Teaches: spike timing, arrow lanes, torch puzzle. New enemies: zombie, skeleton (axe).
Target: 4–5 minutes.

Connections: R1─d1─R2 · R2─d2(gap)─R3 · R3─d3─R4 · R4─d4(puzzle)─R5 · R5─d5(gap)─R6 ·
R6─d6─R2 (shortcut back) · R2─d7(silver)─R7(ladder).

| Door | Type | Endpoint A | Endpoint B |
|---|---|---|---|
| d1 | normal | R1 top `(3,0)(4,0)` | R2 bottom `(4,6)(5,6)` |
| d2 | gap | R2 east `(14,3)(14,4)` | R3 west `(0,3)(0,4)` |
| d3 | normal | R3 top `(10,0)(11,0)` | R4 bottom `(4,8)(5,8)` |
| d4 | puzzle | R4 top `(4,0)(5,0)` | R5 bottom `(5,6)(6,6)` |
| d5 | gap | R5 west `(0,3)(0,4)` | R6 east `(10,4)(10,5)` |
| d6 | normal | R6 bottom `(4,8)(5,8)` | R2 top `(10,0)(11,0)` |
| d7 | silver | R2 top `(3,0)` | R7 bottom `(3,5)` |

### R1 "Landing" — 9×7

```
###DD####
#..cc...#
#.......#
#..ss...#
#.......#
#...@...#
#########
```

| Traps |
|---|
| `s`(3,3) period 120 offset 0 · `s`(4,3) period 120 offset 60 |

The spikes sit off the direct path — a safe demonstration.

### R2 "Spike Gallery" — 15×7

```
###L######DD###
#.............#
#..s.s.s.s....#
#......c......D
#...s.s.s.s...D
#..cc.........#
####DD#########
```

| Traps |
|---|
| row 2 spikes (3,2)(5,2)(7,2)(9,2): period 120 offset 0 · row 4 spikes (4,4)(6,4)(8,4)(10,4): period 120 offset 60 |

3 coins. Anti-phased rows: when one row is deadly the other is safe.

### R3 "Arrow Gallery" — 13×8

```
##a##a##a#DD#
#...........#
#..c..c..c..#
D...........#
D...........#
#..c..c..c..#
#...........#
#############
```

| Traps |
|---|
| `a`(2,0) period 90 offset 0 · `a`(5,0) period 90 offset 30 · `a`(8,0) period 90 offset 60 |

6 coins in the lanes. Rolling volley left→right.

### R4 "Torch Shrine" — 11×9. *Puzzle: light all 4 torches.*

```
####PP#####
#.........#
#.u.....u.#
#.........#
#....1....#
#..c...c..#
#.u.....u.#
#....2....#
####DD#####
```

| Enemies | Props | Wiring |
|---|---|---|
| `1`(5,4) zombie · `2`(5,7) zombie, drops: none | torch group **G1** = {(2,2),(8,2),(2,6),(8,6)}, no window | `torch_group(G1)` → `open_door(d4)` |

### R5 "Guard Hall" — 13×7. *Axe skeleton introduction.*

```
#t#########t#
#...........#
#.....1.....#
D...........#
D...........#
#.....h.....#
#####PP######
```

| Enemies |
|---|
| `1`(6,2) skel_axe, drop: none |

### R6 "Key Vault" — 11×9. *Timed grab.*

```
###########
#c.......c#
#...sss...#
#...sks...#
#...sss...D
#.........D
#.........#
#c.......c#
####DD#####
```

| Traps | Pickups |
|---|---|
| all 8 ring spikes (4,2)(5,2)(6,2)(4,3)(6,3)(4,4)(5,4)(6,4): period 180 offset 0 | `k`(5,3) silver key · 4 corner coins |

108 safe ticks per cycle; entering, grabbing, and leaving takes ≈52.

### R7 "Descent" — 7×6

```
###V###
#.....#
#.c.c.#
#..c..#
#.....#
###L###
```

### Floor 2 solution path (`f2.replay`)

| # | Where | Action | Assert |
|---|---|---|---|
| 1 | R1→R2 | north; weave the anti-phased spike rows; +3 coins | room=R2, treasure=23 |
| 2 | R2→R3 | east gap; collect 6 coins between volleys; exit north | room=R4, treasure=29 |
| 3 | R4 | kill/avoid zombies, light 4 torches, +2 coins; d4 opens; north | room=R5, treasure=31 |
| 4 | R5 | kill axe skeleton (kite it — slow), take flask; west gap | room=R6 |
| 5 | R6 | +4 coins; time the ring, grab key | silver keys=1, treasure=35 |
| 6 | R6→R2 | south door d6 (shortcut back) | room=R2 |
| 7 | R2→R7 | unlock d7; +3 coins; ladder | floor=3, treasure=38, silver keys=0 |

---

## 4. Floor 3 — The Furnace

Teaches: flame jets, crate pushing / pit bridging. New enemy: wisp. Target: 4–5 minutes.

R1─d1─R2; R2─d2─R3; R3─d3(gap)─R4; R4─d4─R5; R3─d5─R6 (sealed side room);
R3─d6(silver)─R7.

| Door | Type | Endpoint A | Endpoint B |
|---|---|---|---|
| d1 | normal | R1 top `(5,0)(6,0)` | R2 bottom `(4,7)(5,7)` |
| d2 | normal | R2 top `(6,0)(7,0)` | R3 bottom `(6,7)(7,7)` |
| d3 | gap | R3 east `(12,3)(12,4)` | R4 west `(0,3)(0,4)` |
| d4 | normal | R4 top `(12,0)(13,0)` | R5 bottom `(5,8)(6,8)` |
| d5 | normal | R6 bottom `(4,7)(5,7)` | R3 top `(8,0)(9,0)` |
| d6 | silver | R3 top `(3,0)` | R7 bottom `(3,5)` |

### R1 "Scalded Landing" — 9×8

```
##f##DD##
#.......#
#..c....#
#.......#
#.......#
#...@...#
#.......#
#########
```

| Traps |
|---|
| `f`(2,0) period 150 offset 0 — deadly tile (2,1) |

A flame the player can simply watch; the coin tempts a closer look.

### R2 "The Gap" — 13×8. *Crate-bridge lesson.*

```
######DD#####
#..cc.......#
#___________#
#...........#
#.....p.....#
#...........#
#...........#
####DD#######
```

| Props |
|---|
| `p`(6,4) pushable crate |

The pit trench spans the room. Push the crate north into any pit cell to bridge it,
cross, take the 2 coins, exit north. (Jammed crates reset on re-entry, 02 §4.2.)

### R3 "Wisp Den" — 13×8

```
###L####DD###
#...........#
#.1...c...2.#
#...........D
#...........D
#.....3.....#
#...........#
######DD#####
```

| Enemies |
|---|
| `1`(2,2) wisp · `2`(10,2) wisp · `3`(6,5) zombie, drops: none |

Hub room of the floor: south to R2, east gap to R4, north-right door to R6 (treasure),
north-left silver door to R7 (descent).

### R4 "Flame Walk" — 15×7. *Timing gauntlet.*

```
#f###f###f##DD#
#h............#
#..s..s..s..c.#
D.............#
D...s..s..s...#
#..c.......c..#
###############
```

| Traps | Pickups |
|---|---|
| `f`(1,0) offset 0 · `f`(5,0) offset 50 · `f`(9,0) offset 100 (period 150) — deadly tiles (1,1)(5,1)(9,1) · `s`(3,2)(6,2)(9,2) offsets 0/40/80 · `s`(4,4)(7,4)(10,4) offsets 20/60/100 (period 120) | `h`(1,1) — **on** the first flame's deadly tile: grab it in a safe window · coins (12,2)(3,5)(11,5) |

### R5 "Kiln Vault" — 13×9. *Key island puzzle.*

```
#############
#c.........c#
#....._.....#
#...._k_....#
#....._.....#
#...........#
#.....p.....#
#...........#
#####DD######
```

| Props | Pickups |
|---|---|
| `p`(6,6) pushable crate | `k`(6,3) silver key · coins (1,1)(11,1) |

The key is walled off by 4 pit cells (corner-cut rule blocks diagonal entry, 01 §3.2).
Push the crate into any pit cell to bridge a path. Every pit cell is adjacent to the
key, so any bridge works.

### R6 "Ash Hoard" — 11×8. *Sealed ambush; optional treasure.* `combat_seal`

```
#t#######t#
#....M....#
#.1.....2.#
#....3....#
#.c.....c.#
#.........#
#.........#
####DD#####
```

| Enemies | Props |
|---|---|
| `1`(2,2) skel_sword · `2`(8,2) skel_sword · `3`(5,3) wisp, drops: none | `M`(5,1) contents: [blue flask large, coin ×4] |

### R7 "Descent" — 7×6

```
###V###
#.....#
#.c.c.#
#..c..#
#.....#
###L###
```

### Floor 3 solution path (`f3.replay`)

| # | Where | Action | Assert |
|---|---|---|---|
| 1 | R1 | +1 coin (time the flame), north | room=R2, treasure=39 |
| 2 | R2 | push crate into trench, cross, +2 coins, north | room=R3, pit bridged, treasure=41 |
| 3 | R3 | kill wisps/zombie (or run), +1 coin; east gap | room=R4 |
| 4 | R4 | run the gauntlet; +3 coins, +flask (optional); north | room=R5, treasure=45 |
| 5 | R5 | push crate into a pit cell, grab key, +2 coins; south, back west | room=R3, silver keys=1, treasure=47 |
| 6 | R3→R6 | north-right door; seal closes; clear 3 enemies; open chest; +2 floor coins | treasure=53, has blue flask large |
| 7 | R3→R7 | unlock d6, +3 coins, ladder | floor=4, treasure=56, silver keys=0 |

---

## 5. Floor 4 — The Deep Vault

Everything combined, then the arena, then the vault. Target: 4–6 minutes. Linear:
R1─d1─R2─d2─R3─d3(puzzle)─R4─d4─R5─d5(gold)─R6.

| Door | Type | Endpoint A | Endpoint B |
|---|---|---|---|
| d1 | normal | R1 top `(5,0)(6,0)` | R2 bottom `(7,8)(8,8)` |
| d2 | normal | R2 top `(8,0)(9,0)` | R3 bottom `(4,8)(5,8)` |
| d3 | puzzle | R3 top `(4,0)(5,0)` | R4 bottom `(5,10)(6,10)` |
| d4 | normal | R4 top `(6,0)(7,0)` | R5 bottom `(4,6)(5,6)` |
| d5 | gold | R5 top `(4,0)(5,0)` | R6 bottom `(4,7)(5,7)` |

### R1 "Threshold" — 9×8

```
##f##DD##
#.......#
#..s.s..#
#.......#
#.s.s.c.#
#.......#
#...@...#
#########
```

| Traps |
|---|
| `f`(2,0) period 150 offset 0 · `s`(3,2) offset 0 · `s`(5,2) offset 60 · `s`(2,4) offset 30 · `s`(4,4) offset 90 (period 120) |

### R2 "Gauntlet of the Deep" — 17×9

```
###a####DD###a###
#...............#
#..s.s.s.s.s.s..#
#...............#
#.p...s.s.s....b<
#...............#
#..s.s.s.s.s.s..#
#...c.......c...#
#######DD########
```

| Traps | Props / pickups |
|---|---|
| `a`(3,0) period 45 offset 0 · `a`(13,0) period 45 offset 22 · row-2 spikes (3,2)(5,2)(7,2)(9,2)(11,2)(13,2) offsets 0/20/40/60/80/100 · row-4 spikes (6,4)(8,4)(10,4) offsets 30/70/110 · row-6 spikes (3,6)(5,6)(7,6)(9,6)(11,6)(13,6) offsets 100/80/60/40/20/0 (all period 120) · `<`(16,4) period 150 offset 0 — deadly tile (15,4) | `p`(2,4) pushable crate — push it east into lane col 3 to shadow the left arrow lane (optional) · `b`(15,4) blue flask small, guarded by the flame · coins (4,7)(12,7) |

### R3 "Antechamber of Flame" — 11×9. *Timed torch puzzle.*

```
####PP#####
#u.......u#
#.........#
#.........#
#....1....#
#.........#
#.........#
#u.......u#
####DD#####
```

| Enemies | Wiring |
|---|---|
| `1`(5,4) zombie, drop: none | torch group **G2** = {(1,1),(9,1),(1,7),(9,7)}, **window 600 ticks** → `open_door(d3)`. Incomplete groups reset to unlit on re-entry (01 §9). |

### R4 "The Arena" — 15×11. `combat_seal`, wave table.

```
######DD#######
#.............#
#..##.....##..#
#..##.....##..#
#.............#
#.............#
#.............#
#..##.....##..#
#..##.....##..#
#.............#
#####PP########
```

| Waves (02 §2.3) |
|---|
| W1: skel_sword (7,2) · skel_sword (3,5) · skel_sword (11,5) |
| W2: skel_axe (4,5) · skel_axe (10,5) · wisp (7,6) |
| W3: zombie (7,2) · skel_sword (3,5) · skel_sword (11,5) · wisp (7,8) |

Wiring: `room_clear(R4)` → `spawn(R4,(7,5), gold key)` + `spawn(R4,(8,5), red flask large)`.
The four 2×2 pillar blocks are interior walls (§1.3) — cover from lunges and wisps.

### R5 "Vault Approach" — 11×7

```
#w##GG###w#
#.........#
#..c.c.c..#
#.........#
#..c.c.c..#
#.........#
####DD#####
```

6 coins. Decor banners flank the gold door.

### R6 "The Great Vault" — 9×8

```
#t#####t#
#ccc.ccc#
#...M...#
#.......#
#.......#
#.......#
#.......#
####GG###
```

| Props | Wiring |
|---|---|
| `M`(4,2) **Great Vault chest**, contents: [coin ×10] | `chest_open(R6,(4,2))` → `victory` |

### Floor 4 solution path (`f4.replay`)

| # | Where | Action | Assert |
|---|---|---|---|
| 1 | R1 | thread spikes past the flame; +1 coin; north | room=R2, treasure=57 |
| 2 | R2 | cross the ripple rows; (optional: push crate into lane 3; grab flame-guarded blue flask) +2 coins; north | room=R3, treasure=59 |
| 3 | R3 | avoid zombie; light all 4 torches within 600 ticks; north | room=R4, d3 open |
| 4 | R4 | survive 3 waves; take gold key + red flask | gold key held |
| 5 | R5 | +6 coins; open gold door | room=R6, treasure=65 |
| 6 | R6 | +6 coins; open the Great Vault chest | treasure=81 → **victory** (see §6 note) |

---

## 6. Item economy summary (lint-checked totals)

| Floor | Coins on floor | Coins in chests/crates | Total | Silver keys / locks | Flasks |
|---|---|---|---|---|---|
| 1 | 12 (R1×4, R2×1, R3×3, R4×1, R6×3) | 8 (M:5, crates R2+R3+R5: 3) | 20 | 1 / 1 (d3) | red-S ×2 (R4 floor, R5 chest) |
| 2 | 20 (R1×2, R2×3, R3×6, R4×2, R6×4, R7×3) | 0 | 20 | 1 / 1 (d7) | red-S ×1 (R5) |
| 3 | 14 (R1×1, R2×2, R3×1, R4×3, R5×2, R6×2, R7×3) | 4 (M in R6) | 18 | 1 / 1 (d6) | red-S ×1 (R4), blue-L ×1 (R6 chest) |
| 4 | 15 (R1×1, R2×2, R5×6, R6×6) | 10 (Great Vault) | 25 | 0 / 0 | blue-S ×1 (R2), red-L ×1 (arena) |
| **Game** | 61 | 22 | **83** | gold: 1 / 1 (d5) | |

The maps + prop tables are authoritative; this table is the lint-checked cross-total.
The solution paths collect 81 of 83 — they skip the 2 coins in floor 2's Landing room
(R1), which sit behind the player's starting position. Victory screen shows
`TREASURE n/83`.

Max-HP note: the game has no HP upgrades; red flasks are the only healing. Difficulty
is tuned assuming ~half of coins and all flasks on the path are taken.
