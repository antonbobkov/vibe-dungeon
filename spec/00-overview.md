# UNDERVAULT — Game Specification: Overview

This is the root document of the specification set for **Undervault**, a small top-down
pixel-art dungeon action game. The spec is written so that an implementer (human or AI agent)
can build the complete game **without making design decisions**. Where a judgment call would
normally be needed, this spec makes the call.

## Document map

| File | Contents |
|---|---|
| [00-overview.md](00-overview.md) | This file — pitch, scope, global constants, determinism rules, asset gaps, glossary |
| [01-mechanics.md](01-mechanics.md) | Simulation loop, input, movement, collision, combat, damage, rooms, doors, checkpoints |
| [02-entities.md](02-entities.md) | Every entity type: player, enemies (FSMs), traps (timing tables), props, pickups |
| [03-levels.md](03-levels.md) | Level authoring rules, the ASCII map legend, all 4 floors, wiring, solution paths |
| [04-ui.md](04-ui.md) | HUD, screens, bitmap font and icon pixel data, audio synth table |
| [05-data-formats.md](05-data-formats.md) | JSON schemas: level files, replay/macro format, state hash |
| [../IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md) | Milestones M0–M7 with automated acceptance criteria |
| [../TESTING.md](../TESTING.md) | Test strategy: unit, replay, lint, e2e, determinism |
| [../ASSET_GUIDE.md](../ASSET_GUIDE.md) | Pixel-verified art asset reference (pre-existing; the *only* authority on art) |

Cross-reference convention: `AG §3.1` means ASSET_GUIDE.md section 3.1. All tile references
use ASSET_GUIDE's `(col,row)` convention, 0-based, origin top-left, and refer to **Pack A**
(`2D Pixel Dungeon Asset Pack v2.0`) unless stated otherwise. **This game uses Pack A only.**

## Pitch

A lone knight descends a four-floor dungeon to loot the Great Vault. Real-time top-down
action: walk, swing a sword, dodge timed traps, solve small object puzzles, collect keys and
treasure, and open the vault at the bottom.

- Genre: top-down action-adventure (Zelda-like), room-based.
- Session length: 15–20 minutes for a first playthrough, ~8 minutes for a repeat run.
- Difficulty: gentle ramp; unlimited respawns with room checkpoints; deaths cost time only.
- Design pillars, in priority order:
  1. **Readable** — every hazard telegraphs; every death is the player's fault.
  2. **Polished** — animation, game feel, and audio feedback on every interaction (see M7 checklist in IMPLEMENTATION_PLAN.md).
  3. **Small** — 4 floors, 26 rooms, 4 enemy types, 3 trap types. Nothing speculative.

## Content summary

| Floor | Name | Rooms | Teaches | New enemies |
|---|---|---|---|---|
| 1 | The Gatehouse | 6 | movement, sword, coins, chests, keys, locked doors | skeleton (sword) |
| 2 | The Vaults | 7 | spike timing, arrow lanes, torch puzzles | zombie, skeleton (axe) |
| 3 | The Furnace | 7 | flame jets, crate pushing / pit bridging | wisp |
| 4 | The Deep Vault | 6 | combined gauntlet, timed torches, wave arena | (waves) |

Win condition: open the Great Vault chest on floor 4. Lose condition: none (death respawns
at the current room's entrance).

## Global constants

Single source of truth for engine-wide values. Gameplay values (speeds, HP, damage) live in
[01-mechanics.md](01-mechanics.md) and [02-entities.md](02-entities.md).

| Constant | Value | Notes |
|---|---|---|
| `TICK_RATE` | 60 ticks/second | Fixed timestep. All timing in this spec is in **ticks**. |
| `TILE` | 16 px | Grid size, matches Pack A (AG §0) |
| `SUBPX` | 16 subpixels per pixel | All sim positions/velocities are **integers in subpixels**. 1 tile = 256 subpx. |
| `VIEW_W × VIEW_H` | 320 × 208 logical px | Canvas logical resolution |
| `HUD_H` | 16 px | HUD strip at the top of the viewport |
| `PLAY_W × PLAY_H` | 320 × 192 px | Play area below the HUD = 20 × 12 tiles |
| `ROOM_MAX` | 20 × 12 tiles | Maximum room size including walls |
| `ROOM_MIN` | 5 × 4 tiles | Minimum room size including walls |
| `CLEAR_COLOR` | `#25131a` | Universal void colour (AG §2.3); fills space around rooms smaller than the play area |
| Display scaling | integer only, nearest-neighbour | AG §7.10. Scale = `floor(min(winW/320, winH/208))`, min 1, centred with black bars. |

Rooms are always **centred** in the play area; the surrounding space is void colour.
The camera is room-locked (no scrolling within a room); see 01-mechanics §8 for transitions.

## Coordinate conventions

- **Tile coords** `(col,row)`: 0-based from the room's top-left corner, in tiles.
- **World coords**: pixels from the room's top-left corner. `px = col*16`, `py = row*16`.
- **Sim coords**: subpixels. `sx = px*16`. All entity positions are stored in subpixels as
  the **top-left corner of the entity's 16×16 sprite cell**. Hitboxes are offsets from this
  point (defined per entity in 02-entities.md).
- Y grows downward. Directions: `U`(0,-1) `D`(0,+1) `L`(-1,0) `R`(+1,0).

## Determinism rules (mandatory)

The simulation must be **bit-exact reproducible** from `(level set, floor, replay inputs)`.
This is the foundation of the whole test strategy (TESTING.md).

1. Fixed timestep: exactly one sim tick per 1/60 s of game time. The renderer may drop or
   duplicate *frames*, never ticks. No interpolation state feeds back into the sim.
2. **No randomness in the simulation.** All drops, chest contents, spawn positions, trap
   phases, and wave compositions are fixed in level data. Anything random (dust particles,
   flame flicker jitter, screen-shake offsets) lives in the renderer only, using a
   renderer-local RNG that the sim never reads.
3. Integer math only in the sim: positions, velocities, and timers are integers (subpixels
   and ticks). The only multiplication requiring care is the diagonal factor, defined
   exactly as `v_axis = (v * 181) >> 8` (see 01-mechanics §3).
4. No floating point in sim state. Angles never appear in sim state (facing is one of 4
   enumerated directions; the wisp's wobble uses an integer sine table, 02-entities §3.4).
5. Iteration order is fixed: entities update in the order defined in 01-mechanics §1.
6. Sim code (`src/sim/`) must not import DOM, Canvas, timers, `Math.random`, or `Date`.
   (Enforced by lint rule, see IMPLEMENTATION_PLAN M0.)
7. Every tick, the sim can produce a 32-bit FNV-1a **state hash** (05-data-formats §4) used
   by determinism and replay tests.

## Asset usage and asset gaps

All art comes from Pack A per ASSET_GUIDE.md. The renderer layer order is AG §6.1 and the
collision classes are AG §6.2. Every entity's sprite source is listed in its 02-entities.md
entry.

The following needs are **not covered** by the packs. Each is resolved in-spec with
code-drawn or spec-embedded pixel data — no external assets may be added:

| Gap | Resolution |
|---|---|
| Character walk/attack/death animations (Pack A has only 4-frame idle loops) | Code-driven motion: walk bob, horizontal flip, attack lunge, damage flash, death fade. Exact rules in 02-entities §1.3 and §2.1. |
| Sword swing sprite | Code-drawn arc in Pack A steel/white colours; geometry in 01-mechanics §4.3. |
| HUD heart icons | 7×6 px bitmaps embedded in 04-ui §2.2, drawn in Pack A palette colours. |
| Text font | 3×5 px bitmap font embedded in 04-ui §5. |
| Audio (no audio assets exist at all) | Small WebAudio synth cue table in 04-ui §6. |
| Side-wall door art (doors exist only front-facing) | A side exit is a 2-tile opening that may carry a **vertical door**, drawn from the front-facing art seen edge-on: the inset halves of the leaf tiles as closed slits on the opening, the double-door halves folded back against the wall beside it when open. No keyhole or arch reads at that angle, so `silver`/`gold`/`puzzle` remain top/bottom-wall only. (01-mechanics §8.1, 03-levels §1.4.) |

The mechanic set was chosen to fit the assets; nothing requires art that doesn't exist
(e.g., there are no pressure plates, no pushable-block art distinct from crates, no
side-firing arrow traps — see 02-entities for what each trap can do and why).

## Glossary

| Term | Meaning |
|---|---|
| tick | One fixed sim step, 1/60 s |
| subpx | 1/16 of a pixel; the sim position unit |
| room | One screen of play; a rectangular tile grid ≤ 20×12 |
| floor | A set of connected rooms; floors 1–4 are the whole game |
| door object | A logical connection between two rooms with a type (normal / silver / gold / puzzle) and open state |
| gap | A 2-tile opening in a side wall connecting two rooms, with no door object: always open |
| vertical door | A `normal` door filling a 2-tile side-wall opening; drawn edge-on when shut (01-mechanics §8.1) |
| seal | Temporary closing of all of a room's doors during combat (`combat_seal` rooms) |
| pit | A void tile inside a room's floor; impassable until bridged by a pushed crate |
| wiring | Level-data links from triggers (e.g., "all torches in group lit") to effects (e.g., "open door d4") |
| replay | A recorded per-tick input stream that reproduces a run exactly (05-data-formats §3) |
| AG | ASSET_GUIDE.md |
