# Dungeon Pixel-Art Asset Guide

A complete, pixel-verified map of every image in `art_assets/`, written so that levels can be
authored from this document alone — no image inspection required.

Everything below was derived by reading the actual pixels (dimensions, alpha masks, per-tile
bounding boxes, colour histograms) and by matching each pack's `demonstration.png` back to its
source tileset to recover the artist's intended usage.

## Companion images — `asset_reference/`

Coordinate-labelled blow-ups of every sheet, generated alongside this document. Every `(col,row)`
reference in the tables below can be read straight off these. Transparency is drawn as a green
chequerboard.

| File | Shows |
|---|---|
| `packA_tileset_grid.png` | `Dungeon_Tileset.png` at 8x with `(col,row)` axes |
| `packA_characters_grid.png` | `Dungeon_Character.png` at 14x |
| `packA_doors_open_closed.png` | All three Pack A doors, closed front view next to their open edge-on leaves |
| `packA_items_containers.png` | Chests, crates, coins, flags, keys, spikes, arrows — every frame labelled |
| `packA_items_traps_lights.png` | Flamethrowers, flasks, torches, candlesticks — every frame labelled |
| `packA_idle_animations.png` | All 14 idle loops from `Character_animation/` |
| `packA_interface_cursors.png` | All 24 selection-cursor frames |
| `packB_tileset_grid.png` | `Dungeon_Tileset_v2.png` at 8x with `(col,row)` axes |
| `packB_props_grid.png` | `Dungeon_item_props_v2.png` at 12x |
| `packB_enemies_grid.png` | `Dungeon_Enemy_v2.png` at 20x |
| `packB_animations_items.png` | Chest / coin / key / spike / banner strips, frames numbered |
| `packB_animations_torch_gate.png` | Torch, torch-with-light and gate strips, frames numbered |
| `packE_enemy_animations.png` | Representative 32x32 enemy strips, frames numbered |
| `example_room_packA.png` | A room built purely from the §3.2 recipe |
| `example_room_packB.png` | The same recipe applied to Pack B, with a pillared bay and barred window |

---

## 0. TL;DR for level builders

* **Grid is 16 x 16 px** everywhere except the standalone `Enemy_Animations_Set` (32 x 32).
* There are **two mutually exclusive art sets** (Pack A "warm brown", Pack B "cool grey"). They
  share only 3 colours — **do not mix them in one scene**.
* Each tileset's **top-left 6 x 6 block is a complete 9-slice room frame**. Build every room from it.
* In Pack A, everything from tile row 6 downward is **props with alpha** — composite them *on top
  of* floor. In Pack B, the tileset is 100 % opaque and all alpha props live on a separate sheet.
* A handful of tiles are **flat solid colours** used as fills (void / floor / wall). They are the
  cheapest way to fill large areas.

---

## 1. Inventory

| Path | Contents | Grid |
|---|---|---|
| `art_assets/2D Pixel Dungeon Asset Pack v2.0/2D Pixel Dungeon Asset Pack/` | **Pack A** — "Pixel_Poem Dungeon Tileset" | 16 px |
| `art_assets/2D Dungeon Asset Pack_v5.2/2D Dungeon Asset Pack_v5.2/` | **Pack B** — "Pixel_Poem Dungeon Tileset II" (v5.2) | 16 px |
| `art_assets/Enemy_Animations_Set/Enemy_Animations_Set/` | **Pack E** — full enemy animation set | 32 px |

217 files total. Author credit reads `PIXEL_POEM` in both packs' title art.

### Files that are *not* usable assets

| File | What it actually is |
|---|---|
| `Pack A/Dungeon_Tileset_at.png` (512x512) | Promo/title art (title text + a sample scene) |
| `Pack A/Dungeon_Character_at.png` (512x512) | Promo art showing `Dungeon_Character.png` |
| `Pack A/Dungeon_gif.gif` (768x768, 4 frames) | Promo animation |
| `Pack B/Dungeon_Tileset_art.png` (560x500) | Promo/title art ("BIG UPDATE 5 years") |
| `Pack A/.../demonstration.png`, `Pack B/.../demonstration.png` (256x256) | Sample levels — **useful as reference**, not as tilesets |
| `Pack E/enemies.aseprite` | Aseprite source file; the PNGs are the exported result |

---

## 2. Global conventions

### 2.1 Coordinates and tile IDs

Throughout this document a tile is written `(col,row)`, **0-based, origin top-left**.

For a tileset that is `W` tiles wide, the row-major index (the numbering Tiled and most engines use)
is:

```
index   = row * W + col      # W = 10 for both tilesets, 12 for Pack B's prop sheet
pixel_x = col * 16
pixel_y = row * 16
```

Both `Dungeon_Tileset.png` and `Dungeon_Tileset_v2.png` are 160x160 => **10 x 10 = 100 tiles**,
indices 0..99, with **zero margin and zero spacing**.

### 2.2 The three kinds of tile

1. **Opaque terrain** — 100 % alpha, covers the whole cell. Walls and floors. Draw on the base layer.
2. **Alpha props** — partial coverage, transparent background. Chests, bones, torches, shields.
   Draw on an overlay layer above the floor.
3. **Black-backed props** — fully opaque but *not* terrain: the artwork is drawn onto the void
   colour `#25131a`. These read correctly only when placed against darkness (in a wall, in a
   recess), never floating on a floor. In Pack A this is the ladder `(9,3)`; in Pack B it is the
   bookshelves, tables and the ladder on the prop sheet.

### 2.3 The universal void colour

`#25131a` is the outline / shadow / "outside the map" colour. It is the **only** colour shared by
all three packs. Use it as your level background clear colour so that partially covered wall tiles
blend seamlessly.

Handy flat-fill tiles:

| Tile | Colour | Use |
|---|---|---|
| Pack A `(8,7)` | solid `#25131a` | Void / pit / out-of-bounds fill |
| Pack A `(9,7)` | solid `#3d253b` | Flat floor fill (no detail) |
| Pack A `(9,6)` | solid `#6e4a48` | Flat wall-brick fill |
| Pack B `(4,6)`, `(6,6)` | solid `#25131a` | Void fill |

### 2.4 Palettes

| Pack | Unique colours | Character |
|---|---|---|
| A | 53 | Warm — purple-brown floor `#3d253b`, brick `#6e4a48`, orange/steel accents |
| B | 104 | Cool — slate floor `#39334a`, limestone `#9e8e88`, blue/red heraldry |
| E | 28 | Cool, matches Pack B |

Key Pack A colours: `#25131a` outline/void · `#3d253b` floor · `#362030` floor detail ·
`#6e4a48` / `#78514f` brick highlight · `#543740` / `#4c2f49` brick shadow ·
`#adc1cf` / `#90919e` steel · `#895a45` / `#bf704d` wood · `#62abd4` selection-blue ·
`#bc4c51` selection-red · `#c09344` / `#ffd569` gold.

**Compatibility:** A ∩ B = 3 colours. B ∩ E = 19 colours. A ∩ E = 2 colours.
=> **`Enemy_Animations_Set` belongs with Pack B.** Its skeletons and its red-eyed "vampire"
are the same designs as `Dungeon_Enemy_v2.png`. Using Pack E sprites inside a Pack A level will
look off-palette (a stylistic clash, not a technical one).

---

## 3. PACK A — `2D Pixel Dungeon Asset Pack v2.0`

```
2D Pixel Dungeon Asset Pack/
├── character and tileset/
│   ├── Dungeon_Tileset.png       160x160  10x10 tiles   <- the main tileset
│   ├── Dungeon_Character.png     112x64   7x4 tiles
│   ├── Dungeon_Character_2.png   112x32   7x2 tiles
│   └── demonstration.png         256x256  sample level
├── Character_animation/          14 x 4-frame 16x16 idle loops
├── items and trap_animation/     4-frame loops for chests, coins, traps, lights
└── interface/                    24 x 16x16 selection-cursor frames
```

### 3.1 `Dungeon_Tileset.png` — complete tile map

Legend for the **Kind** column: `#` = opaque terrain, `~` = alpha prop, `▓` = opaque, black-backed.

#### Rows 0-5, columns 0-5 — THE ROOM FRAME (9-slice)

This 6 x 6 block is a single coherent construction kit. The wall graphics are **inset** inside their
cells: the left wall is drawn in pixels `x10..x14` of its cell, the right wall in `x1..x5`. That is
deliberate — it makes walls read as thin (≈7 px) while still occupying a full tile, so a room's
*walkable* floor is exactly the interior tiles.

| Tile | idx | Kind | What it is |
|---|---|---|---|
| (0,0) | 0 | `#` | **Corner ┌** — left wall column + its top cap. Brick at `x10-14`, rest void. |
| (1,0) | 1 | `#` | Top wall face, variant 1 (full width) |
| (2,0) | 2 | `#` | Top wall face, variant 2 |
| (3,0) | 3 | `#` | Top wall face, variant 3 (small chipped-stone detail) |
| (4,0) | 4 | `#` | Top wall face, variant 4 |
| (5,0) | 5 | `#` | **Corner ┐** — right wall column + top cap. Brick at `x1-5`. |
| (0,1) (0,2) (0,3) | 10 20 30 | `#` | **Left wall**, 3 interchangeable variants. Brick `x10-14`, full height. |
| (5,1) (5,2) (5,3) | 15 25 35 | `#` | **Right wall**, 3 interchangeable variants. Brick `x1-5`, full height. |
| (1,1)(2,1)(3,1)(4,1) | 11-14 | `#` | Interior floor, **top row** — 1 px inner shadow along the top edge; `(1,1)` also shadows left, `(4,1)` also shadows right |
| (1,2)(2,2)(3,2)(4,2) | 21-24 | `#` | Interior floor, **middle row** — `(1,2)` shadows left, `(4,2)` shadows right, `(2,2)`/`(3,2)` are clean |
| (1,3)(2,3)(3,3)(4,3) | 31-34 | `#` | Interior floor, **bottom row** — shadow along the bottom edge; `(1,3)` also left, `(4,3)` also right |
| (0,4) | 40 | `#` | **Corner └** — bottom cap of a *left* wall. Coping bricks at `x10-14`, `y1-5`; darkness below. |
| (1,4)(2,4)(3,4)(4,4) | 41-44 | `#` | **Bottom wall** — full-width coping stones on top, darkness below (you are looking down at the wall's top surface) |
| (5,4) | 45 | `#` | **Corner ┘** — bottom cap of a *right* wall. Coping at `x1-5`. |
| (0,5) | 50 | `#` | Wall face + **full-height pillar, left-inset** (`x1-5`) |
| (1,5) | 51 | `#` | Wall face, plain (one wide block) |
| (2,5) | 52 | `#` | Wall face, plain (two blocks) |
| (3,5) | 53 | `#` | Wall face + **full-height pillar, right-inset** (`x10-14`) |
| (4,5) | 54 | `#` | Wall face + **full-height pillar, left-inset** (`x1-6`) |
| (5,5) | 55 | `#` | Wall face + **full-height pillar, right-inset** (`x9-14`) |

**Why row 5 exists.** Row 4 caps a wall that simply ends. Row 5 caps a wall that **turns downward**:
the full-height pillar in `(0,5)`/`(4,5)` (left-inset) and `(3,5)`/`(5,5)` (right-inset) lines up
with the wall column of the frame's right/left edges respectively, so a vertical wall can descend
out of a horizontal wall run. Use them at T-junctions and where two rooms share a wall.
`(1,5)`/`(2,5)` are plain wall-face fill you can sprinkle into long horizontal runs for variety.

#### Columns 6-9 and rows 6-9 — floors, doors, props

| Tile | idx | Kind | What it is |
|---|---|---|---|
| (6,0)…(9,0) | 6-9 | `#` | Plain floor variants 1-4 (no baked shadow) |
| (6,1)…(9,1) | 16-19 | `#` | Plain floor variants 5-8 |
| (6,2)…(9,2) | 26-29 | `#` | Plain floor variants 9-12 |
| **(6,3)+(7,3)** | 36,37 | `#` | **Closed double door, straight lintel** — 2 tiles wide, 1 tall. `(6,3)` = left leaf (hinges on the left), `(7,3)` = right leaf (hinges on the right, ring pull at the seam). Orange brick lintel across the top. |
| (8,3) | 38 | `#` | **Steel-framed single door / hatch** — 1 tile, silver arch frame over planks. Good as a vault door, level exit or locked door. |
| (9,3) | 39 | `▓` | **Ladder, 16 px wide** — two rails, orange rungs with steel bolts, on an opaque black backing. **Tiles seamlessly when stacked vertically.** |
| (6,4)+(6,5) | 46,56 | `~` | **Door leaf, swung OPEN** — the edge-on view of a door. 6 px wide x 32 px tall, steel hardware band at the midpoint. *Centred* in the cell (`x5-10`) — use with the single door `(8,3)`. |
| (7,4)+(7,5) | 47,57 | `~` | Same open leaf, **left-inset** (`x0-5`) — the **left** leaf of a double door, swung back against its jamb |
| (8,4)+(8,5) | 48,58 | `~` | Same open leaf, **right-inset** (`x10-15`) — the **right** leaf of a double door, swung back against its jamb |
| (9,4) | 49 | `~` | Prop: two stacked dark wooden crates (`x0-14 y3-14`) |
| (9,5) | 59 | `~` | Prop: small crate + loose plank (`x1-12 y2-13`) |
| (0,6)…(3,6) | 60-63 | `#` | Plain floor variants 13-16 (faint shadow line along the top edge) |
| (0,7)…(3,7) | 70-73 | `#` | Plain floor variants 17-20 (completely clean) |
| (4,6) | 64 | `~` | **Skeletal remains** — ribcage + arm bones (`x0-12 y0-14`) |
| (5,6) | 65 | `~` | Bone fragment, sits in the **top-right corner** (`x9-15 y0-8`). Designed to abut `(4,6)` on its right to make a 2-tile corpse. |
| **(6,6)+(7,6)** | 66,67 | `#` | **Closed double door, arched** — 2 wide x 1 tall, brick arch over planks, hinges on the outer edges, ring pull at the seam. The grander of the two doors. |
| (8,6) | 68 | `~` | Two crossed bones (`x2-13 y2-13`) |
| (9,6) | 69 | `#` | **Solid `#6e4a48`** — flat brick fill |
| (4,7) | 74 | `~` | **Heraldic wall shield** — red field, gold border, steel rail (`x1-14 y3-15`) |
| (5,7) | 75 | `~` | Hanging shackle / chain ring (`x5-11 y4-12`) |
| (6,7) | 76 | `~` | Wall ring on a mounting plate (`x5-11 y4-13`) |
| (7,7) | 77 | `~` | Skull + bone (`x1-13 y1-14`) |
| (8,7) | 78 | `#` | **Solid `#25131a`** — void fill |
| (9,7) | 79 | `#` | **Solid `#3d253b`** — flat floor fill |
| (0,8) | 80 | `~` | Small **open wooden crate** (shelved) |
| (1,8) | 81 | `~` | Small **open steel crate** |
| (2,8) | 82 | `~` | **Steel-framed chest**, closed, tall |
| (3,8) | 83 | `~` | **Wooden chest**, closed |
| (4,8) | 84 | `~` | **Large steel chest**, closed (the "hero" treasure chest) |
| (5,8) | 85 | `~` | **Mini chest**, closed |
| (6,8) | 86 | `~` | **Gold coin** |
| (7,8) | 87 | `~` | **Blue flask**, small |
| (8,8) | 88 | `~` | **Silver key** |
| (9,8) | 89 | `~` | **Red flask**, round |
| (0,9) | 90 | `~` | **Wall torch, lit** — bracket + flame, centred (`x4-11 y2-14`) |
| (1,9) | 91 | `~` | **Side torch, lit** — left-inset (`x0-5 y2-14`), for mounting flush to a left-hand wall |
| (2,9) | 92 | `~` | **Torch bracket, unlit** (`x4-11 y7-14`) |
| (3,9) | 93 | `~` | **Candlestick A, lit** — full cell height (`x4-12 y0-15`) |
| (4,9) | 94 | `~` | **Candlestick A, unlit** — stand only (`x4-12 y6-15`) |
| (5,9) | 95 | `~` | **Candlestick B, lit** (`x4-12 y2-15`) |
| (6,9) | 96 | `~` | **Candlestick B, unlit** — base only (`x4-12 y8-15`) |
| (7,9) | 97 | `~` | **Blue flask**, large |
| (8,9) | 98 | `~` | **Red flask**, large |
| (9,9) | 99 | `~` | **Gold key** |

### 3.2 Recipe: build a room in Pack A

For a room whose **walkable floor** is the tile rectangle `x0..x1, y0..y1` (inclusive), paint the
base layer like this:

```
                    col = x0-1        col x0 .. x1            col = x1+1
      row = y0-1     (0,0)            (1..4, 0)  random        (5,0)
      row y0..y1     (0, 1|2|3)       interior floor           (5, 1|2|3)
      row = y1+1     (0,4)            (1..4, 4)  random        (5,4)
```

* Interior floor: for a small room use the shaded 4 x 3 block `(1..4, 1..3)` positionally
  (top row → tileset row 1, bottom row → row 3, left column → col 1, right column → col 4) so the
  inner shadow lands correctly. For a large room, fill the middle with the unshaded variants
  `(6..9, 0..2)` and `(0..3, 6..7)` and use the shaded block only along the edges.
* Everything outside the room stays `#25131a` (or tile `(8,7)`).
* Verified: this is exactly how `demonstration.png` is built — matching its tiles back to the sheet
  yields `(0,0)(1,0)…(5,0)` on the top wall row, `(0,1)/(0,2)/(0,3)` down the left edge and
  `(0,4)(1,4)(2,4)…(5,4)` along the bottom row.

**Doorway:** replace two adjacent tiles of the *bottom* wall row with `(6,3)+(7,3)` (straight
lintel) or `(6,6)+(7,6)` (arched). For a single-tile door use `(8,3)`.

**Door open / closed states.** Each door has a closed front view *and* an open edge-on view, so a
door is a two-state (or two-keyframe) object, not a static tile:

| Door | Closed | Open |
|---|---|---|
| Double door, straight lintel | `(6,3)` + `(7,3)` | left leaf `(7,4)+(7,5)`, right leaf `(8,4)+(8,5)` |
| Double door, arched | `(6,6)` + `(7,6)` | left leaf `(7,4)+(7,5)`, right leaf `(8,4)+(8,5)` |
| Single steel-framed door | `(8,3)` | `(6,4)+(6,5)` (centred leaf) |

When the door opens, swap the closed tile(s) out for the doorway's background (floor or void) and
draw the leaf sprite(s) on the prop layer. The leaf is **2 tiles tall**, so it occupies the wall row
*and* the tile below it — anchor its bottom to the walkable tile in front of the doorway. The
insets are what sell the swing: the left leaf hugs `x0-5` and the right leaf hugs `x10-15`, so a
double door reads as both leaves folded back flat against their jambs, leaving the 2-tile opening
clear to walk through.

Confirmed by palette: the leaf uses exactly `#895a45` (door plank), `#523b40` (plank seam),
`#90919e` (steel hardware) and `#25131a` (outline) — a strict subset of the door tiles' colours,
missing only the orange lintel brick `#bf704d` and the frame highlight `#adc1cf`.

**Vertical shaft between floors:** stack `(9,3)` repeatedly in a column of void.

**Corridor:** a 1-tile-tall corridor is just a floor row with `(1..4,0)` above it and `(1..4,4)`
below it; cap the ends with the corner tiles or run it into a room's wall row.

### 3.3 `Dungeon_Character.png` — 112 x 64, 7 x 4 tiles

Two identical casts, once **with** a selection bracket and once **without**:

| Row | Contents |
|---|---|
| 0 | 7 **heroes**, each with a **blue** corner bracket (`#62abd4`) drawn into the cell corners |
| 1 | 7 **monsters**, each with a **red** corner bracket (`#bc4c51`) |
| 2 | The same 7 heroes, **plain** |
| 3 | The same 7 monsters, **plain** |

Heroes, columns 0-6 (rows 0 and 2):
`0` knight, closed helm, sword at side · `1` grey-haired man, coat, knife · `2` brown-haired man in
a coat · `3` man in a wide-brim hat · `4` man in a wide-brim hat, knife drawn · `5` knight, sword
raised · `6` knight, sword lowered.

Monsters, columns 0-6 (rows 1 and 3):
`0` blue flame wisp · `1` blue flaming skull · `2` black-haired zombie in robes ·
`3` grey zombie in robes · `4` skeleton with sword · `5` skeleton, sword raised ·
`6` skeleton with axe.

`Dungeon_Character_2.png` (112 x 32) is the same 7 + 7 cast, **plain only**, with the hero columns in
a different order (`0` grey-haired man, `1` bald man, `2` hat, `3` hat + knife, `4`-`6` knights).
The monster row order is unchanged. Prefer `Dungeon_Character_2.png` when you don't want brackets.

### 3.4 `Character_animation/` — 16 x 16 idle loops, 4 frames each

Each leaf folder holds `*_1.png … *_4.png`. Play at roughly 6-8 fps as a straight loop.

| Folder | Character | `v1` | `v2` |
|---|---|---|---|
| `monsters_idle/skeleton1/` | Skeleton with sword | **red bracket** | plain |
| `monsters_idle/skeleton2/` | Skeleton with axe | **red bracket** | plain |
| `monsters_idle/skull/` | Blue flaming skull | **red bracket** | plain |
| `monsters_idle/vampire/` | Robed zombie / vampire | **red bracket** | plain |
| `priests_idle/priest1/` | Helmeted knight A | plain | **blue bracket** |
| `priests_idle/priest2/` | Helmeted knight B | plain | **blue bracket** |
| `priests_idle/priest3/` | Helmeted knight C | plain | **blue bracket** |

> **Gotcha:** the `v1`/`v2` meaning is **inverted** between the two folders. For monsters `v1` is the
> bracketed version; for priests it's `v2`. Verified by scanning corner pixels for `#bc4c51` (red)
> and `#62abd4` (blue). Apart from the bracket the frames are pixel-identical.

"Priests" are the same helmeted knights that appear as heroes in `Dungeon_Character.png` columns
5-6 — the folder name is misleading.

### 3.5 `items and trap_animation/` — 4-frame loops

All frames are 16 x 16 unless noted.

| Folder / prefix | Frame size | Frames | Meaning | Play order |
|---|---|---|---|---|
| `chest/chest_1..4` | 16x16 | 4 | Large steel chest, **closed idle** (subtle shimmer) | 1→2→3→4 loop |
| `chest/chest_open_1..4` | 16x16 | 4 | Large chest **opening**, ends with a gold glow | play once, hold 4 |
| `mini_chest/mini_chest_1..4` | 16x16 | 4 | Mini chest, closed idle | loop |
| `mini_chest/mini_chest_open_1..4` | 16x16 | 4 | Mini chest opening, ends with a gold glow | play once, hold 4 |
| `box_1/box_1_1..4` | 16x16 | 4 | Steel crate **being destroyed** (collapses / flattens) | play once |
| `box_2/box_2_1..4` | 16x16 | 4 | Wooden crate being destroyed | play once |
| `mini_box_1/…`, `mini_box_2/…` | 16x16 | 4 | Small steel / small wooden crate destroyed | play once |
| `coin/coin_1..4` | 16x16 | 4 | Gold coin spin | loop |
| `flag/flag_1..4` | 16x16 | 4 | Red heraldic banner waving | loop |
| `keys/keys_1_1..4` | 16x16 | 4 | **Gold** key spin | loop |
| `keys/keys_2_1..4` | 16x16 | 4 | **Silver** key spin | loop |
| `flasks/flasks_1_1..4` | 16x16 | 4 | Red flask, small — liquid shimmer | loop |
| `flasks/flasks_2_1..4` | 16x16 | 4 | Blue flask, small | loop |
| `flasks/flasks_3_1..4` | 16x16 | 4 | Blue flask, large | loop |
| `flasks/flasks_4_1..4` | 16x16 | 4 | Red flask, large | loop |
| `torch/torch_1..4` | 16x16 | 4 | Wall torch, flickering flame (centred) | loop |
| `torch/side_torch_1..4` | 16x16 | 4 | Torch mounted flush to a **left-hand** wall | loop |
| `torch/candlestick_1_1..4` | 16x16 | 4 | Candlestick A, lit | loop |
| `torch/candlestick_2_1..4` | 16x16 | 4 | Candlestick B, lit | loop |
| `peaks/peaks_1..4` | 16x16 | 4 | **Spike trap** — 4 spikes per tile, rising from the floor | retracted→extended = `3 → 4 → 2 → 1` |
| `arrow/arrow_1..4` | **16x32** | 4 | **Arrow trap** — emitter hole in the top 16 px, bolt travels *down* | idle→fire = `2 → 3 → 4 → 1` |
| `arrow/Just_arrow.png` | 16x16 | 1 | Standalone arrow projectile (red fletching, pointing down) | — |
| `flamethrower/flamethrower_1_1..4` | **16x32** | 4 | **Vertical flame jet**, two nozzles at the top firing **down** | off→full = `4 → 3 → 1 → 2` |
| `flamethrower/flamethrower_2_1..4` | **32x16** | 4 | **Horizontal flame jet**, firing **right** | off→full = `4 → 3 → 1 → 2` |

> Frame numbering in this pack is *not* animation order for the traps. The sequences above were read
> off the actual sprites (`peaks_3` is the fully retracted frame; `flamethrower_*_4` is empty).

**Static ↔ animated cross-reference.** The tileset carries a still frame of most of these, so you can
place a static version at design time and swap in the loop at runtime:

| Static tile | Animated folder |
|---|---|
| `(4,8)` large steel chest | `chest/` |
| `(5,8)` mini chest | `mini_chest/` |
| `(6,8)` coin | `coin/` |
| `(8,8)` silver key | `keys/keys_2_*` |
| `(9,9)` gold key | `keys/keys_1_*` |
| `(7,8)` `(9,8)` `(7,9)` `(8,9)` flasks | `flasks/` |
| `(0,9)` wall torch | `torch/torch_*` |
| `(1,9)` side torch | `torch/side_torch_*` |
| `(3,9)` / `(5,9)` candlesticks | `torch/candlestick_1_*` / `candlestick_2_*` |
| `(0,8)` / `(1,8)` crates | `box_*` / `mini_box_*` destruction |

### 3.6 `interface/` — selection cursors, 16 x 16, 4 frames each

Pale-blue (`#adc1cf` / `#62abd4`) grid cursors for a tactics-style game. All six sets are 4-frame
loops in which frame `4` is corner-brackets-only (the inner marker has faded out).

| Set | Meaning |
|---|---|
| `arrow_1..4` | A downward chevron that bobs — "this unit is selected" marker |
| `square_left_1..4` | Cell highlight with an inner marker travelling **left** |
| `square_left_2_1..4` | Same, second style |
| `square_right_1..4` | Inner marker travelling **right** |
| `square_right_2_1..4` | Same, second style |
| `square_up_down_1..4` | Inner marker travelling **vertically** |

The corner brackets are the same graphic that is baked into `Dungeon_Character.png` rows 0-1, so a
cursor drawn over a plain character sprite matches the bracketed sheet exactly.

---

## 4. PACK B — `2D Dungeon Asset Pack_v5.2` ("Dungeon Tileset II")

```
2D Dungeon Asset Pack_v5.2/
├── character and tileset/
│   ├── Dungeon_Tileset_v2.png     160x160  10x10 tiles
│   ├── Dungeon_item_props_v2.png  192x80   12x5 tiles
│   ├── Dungeon_Enemy_v2.png       64x16    4x1 tiles
│   └── demonstration.png          256x256  sample level
└── items_animation/               10 animation strips
```

Pack B is a **complete second theme**: same 16 px grid, same 6 x 6 frame layout in the top-left, but a
cool limestone-and-slate palette, much richer wall decoration (banners, pillars, bookshelves,
hearths) and a large separate prop sheet. Note that **all 100 tiles of `Dungeon_Tileset_v2.png` are
fully opaque** — there are no alpha props in the tileset.

### 4.1 `Dungeon_Tileset_v2.png` — tile map

#### Rows 0-4, columns 0-5 — THE ROOM FRAME (identical structure to Pack A)

| Tile | idx | What it is |
|---|---|---|
| (0,0) / (5,0) | 0 / 5 | Corners ┌ / ┐ (left / right wall column + top cap) |
| (1,0)…(4,0) | 1-4 | Top wall face, 4 variants |
| (0,1)(0,2)(0,3) | 10 20 30 | Left wall, 3 variants |
| (5,1)(5,2)(5,3) | 15 25 35 | Right wall, 3 variants |
| (1..4, 1..3) | 11-14, 21-24, 31-34 | Interior floor, 4 x 3, with baked inner shadow — use positionally |
| (0,4) / (5,4) | 40 / 45 | Corners └ / ┘ |
| (1,4)…(4,4) | 41-44 | Bottom wall (coping stones + darkness) |

Verified against Pack B's `demonstration.png`, which resolves to the same
`(0,0)(1,0)…(5,0)` / `(0,1..3)…(5,1..3)` / `(0,4)…(5,4)` pattern. The §3.2 room recipe applies
unchanged.

#### Row 5 — decorated wall faces

| Tile | idx | What it is |
|---|---|---|
| (0,5) | 50 | Wall face, **blue** stain / moss on the left |
| (1,5) | 51 | Wall face, **blue** stain on the right |
| (2,5) | 52 | Wall face, **red** stain on the left |
| (3,5) | 53 | Wall face, **red** stain on the right |
| (4,5) | 54 | Wall face, blue spill on the right — **left flank of the barred window** |
| (5,5) | 55 | **Glowing blue barred window / magic gate** (bright cyan bars) |
| (6,5) | 56 | Wall face, blue spill on the left — **right flank of the barred window** |
| (7,5)(8,5)(9,5) | 57-59 | Plain floor |

`(4,5)+(5,5)+(6,5)` is a 3-tile-wide feature: the glow spills onto the neighbouring wall tiles.
This is exactly how it appears in `demonstration.png`.

#### Rows 6-7, columns 0-3 — pillared wall bays

Each of these tiles is a wall face with a **stone pillar occupying 5 px at one edge**:

| Tile | Pillar position | Pennant |
|---|---|---|
| (0,6) (0,7) | `x1-5` — **left** edge | blue |
| (1,6) (1,7) | `x11-15` — **right** edge | blue |
| (2,6) (2,7) | `x11-15` — **right** edge | red |
| (3,6) (3,7) | `x1-5` — **left** edge | red |

Combine them into **2-tile-wide bays framed by pillars at both ends**:

* Blue bay: `(0,6) (1,6)` over `(0,7) (1,7)` — a 2 x 2 wall panel with a pillar at each end.
* Red bay: `(3,6) (2,6)` over `(3,7) (2,7)`.

Rows 6 and 7 are *not* pixel-identical (different masonry detail), so use row 6 as the upper course
and row 7 as the lower course of a 2-tile-tall wall.

> These bays are darker than the row-0 wall face. Dropping row 6 on its own into a normal 1-tile
> wall row therefore reads as a **recessed alcove** rather than as flush wall — often a nice effect,
> but use the full 2 x 2 bay when you want a proper pillared wall. See
> `asset_reference/example_room_packB.png`, top-left, for what the single-row version looks like.

#### Rows 6-9, remaining tiles

| Tile | idx | What it is |
|---|---|---|
| (4,6) | 64 | **Solid `#25131a`** void fill |
| (5,6) | 65 | Blue hanging crystals / icicle light fixture on a dark wall |
| (6,6) | 66 | **Solid `#25131a`** void fill |
| (7,6)(8,6)(9,6) | 67-69 | Plain floor |
| (4,7)(5,7) | 74 75 | **Bookshelf with blue books**, 2 variants |
| (6,7)(7,7) | 76 77 | **Bookshelf with red books**, 2 variants |
| (8,7) | 78 | **Empty shelving unit** |
| (9,7) | 79 | Solid `#25131a` |
| (0,8)(1,8)(2,8) | 80-82 | **Wall lantern** (steel bracket, red housing, yellow flame) on a blood-stained wall — 3 variants |
| (3,8) | 83 | **Wall torch**, large orange flame in a steel sconce |
| (0,9)(1,9)(2,9) | 90-92 | **Floor glow beneath the lantern** — place directly under the matching `(x,8)` tile |
| (3,9) | 93 | Red magic circle / blood glow on the floor (pairs under `(3,8)`) |
| (4,8)+(4,9) | 84 94 | **Tall bookshelf**, 2 tiles high (cream / grey books) |
| (5,8) | 85 | Bookshelf with blue books, 1 tile |
| (6,8)…(9,8), (5,9)…(9,9) | — | Solid `#25131a` filler |

> Index note: the `(col,row)` pair is always authoritative — recompute `index = row * 10 + col`
> if you ever doubt a number in these tables.

#### Columns 6-9, rows 0-4 — the floor blocks

| Region | What it is |
|---|---|
| `(6,0) (7,0) (6,1) (7,1)` | Plain floor, 4 variants (rubble detail, no baked shadow) |
| `(8,0) (9,0) (8,1) (9,1)` | 2 x 2 floor patch with a **full baked shadow border** — `(8,0)`=TL, `(9,0)`=TR, `(8,1)`=BL, `(9,1)`=BR |
| `(6..9, 2..4)` | 4 x 3 floor patch with a **full baked shadow border** — a ready-made 9-slice inner floor: `(6,2)`=TL, `(7,2)(8,2)`=T, `(9,2)`=TR, `(6,3)`=L, `(7,3)(8,3)`=clean centre, `(9,3)`=R, `(6,4)`=BL, `(7,4)(8,4)`=B, `(9,4)`=BR |

Use `(7,3)` / `(8,3)` as your plain large-area floor; use the bordered ring when you want a floor
that reads as recessed without drawing walls around it.

### 4.2 `Dungeon_item_props_v2.png` — 192 x 80, 12 x 5 tiles

Index = `row * 12 + col`. Most tiles have alpha; the ones marked **BLACK-BACKED** are drawn onto
`#25131a` and must sit against darkness.

| Tile | What it is |
|---|---|
| (0,0)+(0,1) | **Winged trophy statue, blue pennant** — 2 tiles tall (wings on top, pedestal below) |
| (1,0)+(1,1) | Winged trophy statue, **red** pennant |
| (2,0) | Small wall lantern (steel + red housing, lit) |
| (3,0)…(11,0) | **Solid `#25131a` padding** — unused filler, never place these |
| (2,1) | **Spider** (dark body, red abdomen) |
| (3,1) | Blue gem, diamond cut |
| (4,1) | Blue gem, square cut |
| (5,1) | Blue gem, rectangular cut |
| (6,1) | Blue crystal shard / ingot |
| (7,1) | Red-orange gem, diamond cut |
| (8,1) | Orange gem, square cut |
| (9,1) | Red gem, rectangular cut |
| (10,1) | Orange crystal shard / ingot |
| (11,1) | Solid `#25131a` padding |
| (0,2) | **Wooden table / desk**, wide — BLACK-BACKED |
| (1,2) | Wooden nightstand / small table |
| (2,2) (3,2) | **Stone altar / bench**, 2 variants — BLACK-BACKED |
| (4,2) | Small wooden crate |
| (5,2) | Small wood-and-steel chest, closed, low |
| (6,2) | Wood-and-steel chest, closed, tall |
| (7,2) | Large wooden crate (planks) |
| (8,2) | Blue potion, round flask |
| (9,2) | Blue potion, tall vial |
| (10,2) | Red apple |
| (11,2) | Closed book (brown, visible pages) |
| (0,3) | Small hanging lamp / ceiling light |
| (1,3) | **Heraldic wall shield, red** |
| (2,3) | Skull + bone |
| (3,3) | Gold coin |
| (4,3) | Leather sack / coin pouch |
| (5,3)+(6,3) | **Bookshelf, 2 tiles wide** — BLACK-BACKED |
| (7,3) | Steel-framed chest / locker, closed — BLACK-BACKED |
| (8,3) | Red potion, round flask |
| (9,3) | Red potion, tall vial |
| (10,3) | Yellow pear |
| (11,3) | Unrolled scroll |
| (0,4) | **Ladder** (rails + rungs) — BLACK-BACKED, stacks vertically |
| (1,4) | **Heraldic wall shield, blue** |
| (2,4) | Two loose bones |
| (3,4) | Gold coin, alternate |
| (4,4) | **Barrel** |
| (5,4) | **Open chest, large** (steel-bound) |
| (6,4) | **Open chest, small** |
| (7,4) | **Wooden signpost** |
| (8,4) | **Silver key** |
| (9,4) | **Gold key** |
| (10,4) | Golden goblet / chalice |
| (11,4) | Rolled scroll with a red ribbon |

### 4.3 `Dungeon_Enemy_v2.png` — 64 x 16, 4 tiles

| Tile | Enemy |
|---|---|
| (0,0) | **Wraith / dark knight** — helmeted, red glowing eyes, brown robe, gold clasp |
| (1,0) | **Skeleton with sword** |
| (2,0) | **Blue flaming skull** (ice wisp) |
| (3,0) | **Skeleton with axe** |

These are the same four designs animated in `Enemy_Animations_Set` (where the wraith is filed under
the name "vampire").

### 4.4 `items_animation/` — animation strips

Horizontal strips; slice at the stated frame width.

| File | Sheet | Frame | Frames | Meaning |
|---|---|---|---|---|
| `chest_1.png` | 64x16 | 16x16 | 4 | **Large chest opening** — closed → lid lifting → open → open with gold |
| `chest_2.png` | 64x16 | 16x16 | 4 | **Small chest opening**, same progression |
| `coin.png` | 128x16 | 16x16 | 8 | Gold coin spin (full rotation) |
| `keys_g.png` | 128x16 | 16x16 | 8 | **Gold key** spin |
| `keys_m.png` | 128x16 | 16x16 | 8 | **Silver key** spin |
| `peaks.png` | 80x16 | 16x16 | 5 | **Spike trap**: frame 0 = fully retracted → frame 4 = fully extended. Play forward to arm, backward to disarm. |
| `flag_b.png` | 160x16 | 16x16 | 10 | **Blue banner** waving, seamless loop |
| `flag_r.png` | 160x16 | 16x16 | 10 | **Red banner** waving, seamless loop |
| `torch.png` | 96x28 | **16x28** | 6 | **Wall torch**, flickering. The frame is 28 px tall so the flame overshoots the tile — align the torch bowl to the tile and let the flame overflow upward. |
| `torch_light.png` | 96x28 | **16x28** | 6 | The same torch **with a warm light halo** painted on the wall behind it |
| `gate.png` | 80x32 | **16x32** | 5 | **Blue energy portcullis opening.** Top 16 px = the gate itself, bottom 16 px = its glow reflected on the floor. Frame 0 = closed, frame 4 = open. |

---

## 5. PACK E — `Enemy_Animations_Set`

Sixteen strips, **32 x 32 frames**, one row each. Palette matches **Pack B**.

| Enemy | Animation | File | Frames |
|---|---|---|---|
| Skeleton 1 (sword) | idle | `enemies-skeleton1_idle.png` | 6 |
| | movement | `enemies-skeleton1_movement.png` | 10 |
| | attack | `enemies-skeleton1_attack.png` | 9 |
| | take damage | `enemies-skeleton1_take_damage.png` | 5 |
| | death | `enemies-skeleton1_death.png` | 17 |
| Skeleton 2 (axe) | idle | `enemies-skeleton2_idle.png` | 6 |
| | movement | `enemies-skeleton2_movemen.png` *(sic — no trailing `t`)* | 10 |
| | attack | `enemies-skeleton2_attack.png` | 15 |
| | take damage | `enemies-skeleton2_take_damage.png` | 5 |
| | death | `enemies-skeleton2_death.png` | 15 |
| | death, alternate | `enemies-skeleton2_death2.png` | 15 |
| Vampire / wraith | idle | `enemies-vampire_idle.png` | 6 |
| | movement | `enemies-vampire_movement.png` | 8 |
| | attack | `enemies-vampire_attack.png` | 16 |
| | take damage | `enemies-vampire_take_damage.png` | 5 |
| | death | `enemies-vampire_death.png` | 14 |

### Anchoring 32 x 32 enemies onto the 16 px grid

Measured across every strip, the character body occupies roughly `x7..x23`, `y14..y29` inside the
32 x 32 frame; the extra room exists so weapon swings (skeleton 1 frames 6-8, vampire frames 9-12)
can overshoot the body.

To place an enemy so its body exactly fills tile `(tx, ty)`:

```
draw_x = tx * 16 - 7
draw_y = ty * 16 - 14
```

Equivalently: **centre the frame horizontally on the tile and put the frame's pixel row 29 on the
tile's bottom pixel row.** The ground/feet baseline is `y = 29` (occasionally 30 on death frames).

All sprites **face right**; mirror horizontally for leftward movement.

---

## 6. Recommended engine setup

### 6.1 Layers (back to front)

1. **Void** — clear colour `#25131a`.
2. **Floor** — opaque floor tiles.
3. **Walls** — the frame tiles (rows 0, 4, 5 and columns 0, 5).
4. **Wall decoration** — shields, banners, lanterns, bookshelves, barred windows. In Pack B many of
   these *are* wall tiles, so they belong on layer 3 instead.
5. **Floor props** — chests, crates, bones, barrels, coins.
6. **Actors** — player, enemies, NPCs.
7. **Trap FX** — flame jets, arrows. These overshoot their tile, so they must be above actors.
8. **UI** — `interface/` cursors.

### 6.2 Suggested collision table (Pack A)

| Class | Tiles | Collision |
|---|---|---|
| Walls | `(0..5, 0)`, `(0, 1..3)`, `(5, 1..3)`, `(0..5, 4)`, `(0..5, 5)`, `(9,6)` | solid |
| Void | `(8,7)` | solid / out of bounds |
| Floor | `(1..4, 1..3)`, `(6..9, 0..2)`, `(0..3, 6..7)`, `(9,7)` | walkable |
| Doors, closed | `(6,3)+(7,3)`, `(8,3)`, `(6,6)+(7,6)` | solid |
| Doors, open (leaves) | `(6..8, 4..5)` | walkable — the leaf is folded against the jamb and the opening is clear |
| Ladder | `(9,3)` | climbable |
| Containers | `(0..5, 8)` | solid, interactive |
| Pickups | `(6..9, 8)`, `(7..9, 9)` | trigger |
| Lights | `(0..6, 9)` | decorative, emit light |
| Decals | `(4,6)`, `(5,6)`, `(8,6)`, `(4,7)`…`(7,7)` | none |

### 6.3 Data you'll want to author

For each tileset the minimum metadata is `index`, `name`, `collision`, `layer`, and optionally
`animation` (pointing at the matching folder in §3.5 / §4.4). The tables in §3.1, §4.1 and §4.2 map
one-to-one onto such a file.

---

## 7. Gotchas checklist

1. **Don't mix Pack A and Pack B tiles in one room.** They share 3 colours out of 53 / 104.
2. **`v1`/`v2` means the opposite thing** in `monsters_idle/` versus `priests_idle/` (§3.4).
3. **`enemies-skeleton2_movemen.png` is misspelled** — no trailing `t`.
4. **Trap frame numbers are not play order** — see the play-order column in §3.5.
5. **Black-backed props** (Pack A `(9,3)`; Pack B prop sheet `(0,2)`, `(2,2)`, `(3,2)`, `(5,3)`,
   `(6,3)`, `(7,3)`, `(0,4)`) punch a black rectangle through your floor. Place them against void or
   against a wall.
6. **Pack B prop-sheet tiles `(3,0)…(11,0)` and `(11,1)` are pure black padding**, not art.
7. **Pack B's tileset has no alpha at all** — every prop with transparency lives on the prop sheet.
8. **Non-16 px frames:** Pack A `arrow` and `flamethrower_1` are 16 x 32; `flamethrower_2` is
   32 x 16; Pack B `torch` / `torch_light` are 16 x 28; Pack B `gate` is 16 x 32; all of Pack E is
   32 x 32.
9. **Wall art is inset inside its cell** (about 7 px of brick, 9 px of void). A wall tile drawn in
   isolation on a light background looks broken; it only reads correctly against `#25131a`.
10. **Use nearest-neighbour filtering and integer scaling.** Every asset is hand-placed pixel art
    with hard 1 px outlines; bilinear filtering destroys it.
