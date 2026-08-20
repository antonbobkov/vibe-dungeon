# UNDERVAULT — Tweaks Round 1: Work Plan

Post-release polish batch: input additions, spawn-proximity protection, two render bug
fixes, keyholes, event-door chains, and a door-animation rework that adds **vertical
(side-wall) doors**. Four milestones, W1–W4, sized for delegation: an agent given one
milestone section plus this repo can execute it without further design input. Every
design decision below was confirmed by the project owner against pixel mockups built
from the real Pack A tiles — do not re-litigate them; implement exactly what is written.

Standing rules (as everywhere in this repo): all suites green for the milestone's scope
before it lands; commit + push per milestone (CLAUDE.md); gameplay constants live in
`src/sim/constants.ts` named as specced with a spec-section comment (render-only numbers
live in their render module); no `Math.random`/DOM in `src/sim/`; replays are re-recorded
only in W4 unless a milestone itself broke them. When a milestone changes behaviour, it
also updates the spec section named for it — spec and code must not drift.

## Confirmed design decisions

### Door open-state rework (all door leaves become 1 tile)

The current renderer hangs 2-tile-tall leaves from both jambs into the room
(`drawDoorLeaves` / `doorLeafSide` / `leafTopRow`, `src/render/world.ts:144–186`).
Replace with:

- **Placement rule ("¾ tile tucked")**: an open leaf is one 16×16 leaf tile drawn in its
  own door column, vertically tucked into the doorway so **12 px overlap the door row
  and 4 px protrude into the room**. Constant `LEAF_PROTRUDE_PX = 4` (renderer).
  - Top-wall door: leaf `y = doorRow*16 + LEAF_PROTRUDE_PX` (protrudes downward).
  - Bottom-wall door: leaf `y = doorRow*16 − LEAF_PROTRUDE_PX` (protrudes upward).
- **Double doors** (`DD`, `PP`, `GG` when open): left cell draws leaf tile `(7,4)`
  (left-inset art, hugs the left jamb), right cell draws `(8,4)` (right-inset, right
  jamb). The 2-tile opening stays visually clear.
- **Single steel doors** (`L`): one leaf, tile `(7,4)` (left-aligned), same vertical rule.
- The `door_leaf_*_bottom` tiles and the `door_leaf_center_*` tiles are no longer used by
  horizontal doors (center tiles become unused entirely; bottom tiles are reused by
  vertical doors below — keep them in the manifest).

### Vertical doors (new feature)

Doors may now exist in side walls, where today only open 2-cell gaps exist.

- **Type restriction**: side-wall doors are type `normal` only. `silver`/`gold`/`puzzle`
  stay top/bottom-wall only (a 6 px slit has no room for a keyhole; lint enforces).
  The `gap` type remains supported. `combat_seal` rooms may have side *doors* (they seal
  like any door) but still no side *gaps* (nothing to close) — lint updated accordingly.
- **Closed art** (drawn as overlay on the gap cells, which autotile exactly as gaps do
  today — caps + floor):
  - Left wall: `(8,4)` in the upper gap cell, `(8,5)` in the lower (right-inset slit art
    lands on x10–15, flush with the left wall's brick line).
  - Right wall: `(7,4)` + `(7,5)` (left-inset, flush with the right wall's bricks).
- **Open art**: two front-view half-leaves anchored to the wall beyond the gap, in the
  room-side column (`col 1` for a left-wall door, `col w−2` for a right-wall door):
  - Top half: tile `(6,3)` in the cell beside the wall cell **above** the gap
    (row `gapTopRow − 1`).
  - Bottom half: tile `(7,3)` drawn **horizontally flipped**, beside the wall cell
    **below** the gap (row `gapBottomRow + 1`).
  - Right-wall doors mirror the whole arrangement: both tiles additionally flipX.
- **Sim**: nothing new — closed side-door cells use the existing `DOOR_CLOSED` tile class
  (solid, blocks bolts/enemies/wisp), normal doors auto-open at 24 px (01 §8.1), and
  `entryPlacement`/transitions already handle left/right walls (`src/sim/level.ts:577`).
- **Content**: every existing side gap in `levels/f1.json`–`f3.json` becomes a `normal`
  door (change the door-table `type` from `gap` to `normal`; ASCII maps are unchanged —
  the `D` symbols stay). f4 has no side gaps.

### Event-locked doors: chains

Closed **puzzle** doors and **combat-sealed** doors (any type while sealed) get a
"chained shut" look; key-locked and plain closed doors do not.

- **Symmetric closed art**: for a 2-cell event-locked door, draw the left cell's normal
  door tile, and draw the **right cell as the left tile horizontally mirrored** (instead
  of its own tile). 1-cell sealed doors keep their tile.
- **Chains**: shackle prop tile `(5,7)` drawn centred on **each** door cell — two chains
  on a 2-cell door, one on a 1-cell door. Drawn over the door art on the wall-dressing
  layer.
- **Unshackle effect**: when the door opens by event (puzzle wiring fires; seal
  releases), each chain breaks off: a new `unshackle` effect per chain cell — the
  shackle sprite drops 4 px and fades over 10 ticks (same numbers as `pit_drop`), plus
  the existing 3-pixel smoke puff on the same cell. Hooked from `GameEvent`s in
  `src/game/events.ts` — the `door` and `seal` events exist; add a field only if an
  unseal/puzzle-open cannot be distinguished from a key unlock today.

### Keyholes on keyed doors

Procedural pixel overlay (a coordinate list in the renderer, in the style of
`PUFF_PIXELS`, `src/render/world.ts:337`) drawn over **closed** keyed doors:

- Silver keyhole centred on the `L` single door tile; gold keyhole at the seam of the
  `GG` pair (centred on the 2-tile span).
- Shape: metal plate ≈6×8 px with a dark keyhole (2×2 ring + 1×3 slot). Colors:
  silver plate `#90919e` highlight `#adc1cf`; gold plate `#c09344` highlight `#ffd569`;
  hole/outline `#25131a`. Exact pixel lists are the implementer's to draw once and pin
  with a unit test; the palette and anchors above are fixed.

### Spawn protection (sim change)

On room entry (`enterRoom`, `src/sim/sim.ts` ~line 537), an enemy whose spawn-tile
centre is within **`ENTRY_SAFE_RADIUS = 48 px`** (3 tiles, straight-line distance in
subpixels to the player's hitbox centre at the entry position) is not created
immediately. Instead it spawns through the existing wave machinery: a 30-tick
`SimTelegraph` on its tile, then the enemy appears with the 12-tick `SPAWNING` blink-in
(harmless and unhittable, 02 §2.3). Enemies at or beyond the radius spawn instantly as
today. Applies to map enemies on every entry (including respawn-after-death); wave
tables are unchanged (they already telegraph).

### Input additions

`Space` and `Backspace` → ATTACK (`event.code` values `'Space'`, `'Backspace'` in
`BINDINGS`, `src/main.ts:46`). `KeyE` → INTERACT **already exists** — verify, don't add.
The existing preventDefault on bound keys also stops page scroll (Space) and
back-navigation (Backspace).

## Established root causes (skip re-derivation)

- **Arrow bleed**: the launcher's 16×32 art frames (`arrow_2→3→4→1`) contain a
  *baked-in bolt* traveling through the tile below the emitter; they are drawn for 12
  ticks after firing on the trap-FX layer (over actors) while the real bolt projectile
  also flies — two arrows smearing across tiles. Fix in the **loader**: crop each
  `arrow_launcher` frame to its **top 16×16** (the emitter hole; frame `arrow_3`'s
  bolt-head peeking out of the hole is the muzzle flash). Placeholder-art mode must
  produce the same 16×16 shape. The real bolt (`Just_arrow`) becomes the only arrow in
  the lane. No sim change; `launcherFrame` (`src/render/anim.ts:70`) is unchanged.
- **Pit-drop flicker**: one bad frame at the moment a pushed crate is consumed by a pit.
  Reproduce first — `window.undervault.freeze()` / `advance(1)` stepping around a
  crate-into-pit completion in F3R2. Known suspects, in order: (1) `slidePosition`
  (`src/render/world.ts:344`) never renders `done = 1` — the last sliding frame is at
  11/12 (~1.3 px short), then the prop is deleted and the bridged terrain appears at the
  full position; (2) the same-tick handoff prop → `BRIDGED_PIT` terrain → `pit_drop`
  overlay (`src/sim/sim.ts` `finishSlide` ~757, `src/render/effects.ts`, and the
  `src/app.ts` tick order: `effects.advance()` runs before the sim tick and `spawn`
  after, so the overlay's first draw is at `elapsed = 0`). Fix so the composed sequence
  is pixel-continuous; both halves are pure functions, so the fix is unit-testable
  without a canvas.

## Milestones

### W1 — Input + the two render bug fixes

No sim changes; replays and goldens untouched (goldens contain no launchers or pits).

Scope: the input additions; the arrow-bleed loader crop; the pit-flicker repro + fix.

Done when:
- Unit: every `arrow_launcher` frame sprite is 16×16 and the arrow `trapSprite` draw
  never extends below the wall cell; the manifest play-order test stays green.
- Unit (pure): stepping ticks across a crate-into-pit completion, the composed crate
  draw list (slide interpolation + bridged-tile state + `pit_drop` overlay math) shows a
  crate at the pit cell every tick, per-tick movement ≤ 2 px, alpha monotonic.
- E2E: a dispatched `Space` keydown puts the player in the SWING state (via
  `window.undervault.state()`); same for `Backspace`.
- Spec/docs: key table in `spec/01-mechanics.md` §2 + README controls; launcher-art note
  in `spec/02-entities.md` §3.2.
- `npm run typecheck && npm run lint && npm test && npm run test:e2e` green; commit+push.

**Outcome — `7e3817b`.** Landed as written. `Space`/`Backspace` joined `BINDINGS`; `KeyE`
was already there. Every `arrow_launcher` frame is cropped to its top 16×16 in the loader
(placeholder art too), so the baked-in bolt is gone and `Just_arrow` is the only arrow in
the lane. The pit flicker turned out to be the *tile*, not the interpolation: the fix is in
the drawn-tile bookkeeping plus the `slidePosition` divisor, and it is pinned by a pure
per-tick draw-list test. No sim change, so replays and goldens were untouched.

### W2 — Door visuals rework (horizontal doors, keyholes, chains)

Renderer + effects only; replays untouched; **visual goldens change by design** —
regenerate locally (`npm run test:visual -- -u`) with a commit note.

Scope: the 1-tile leaf redesign (replace `drawDoorLeaves`/`doorLeafSide`/`leafTopRow`);
keyhole overlays; event-door mirrored tiles + chains + `unshackle` effect.

Done when:
- Unit: door-leaf tests pin exact (tile id, x, y, flip) per door type and wall, including
  `LEAF_PROTRUDE_PX` in both directions.
- Unit: keyhole pixel lists and anchors pinned per door type; closed **normal** doors
  and open doors draw no keyhole.
- Unit: sealed/puzzle closed doors emit the mirrored-right-tile + per-cell shackle draw
  list; key-locked and normal doors don't; `effectsFor` maps the unlock event to one
  `unshackle` effect per chain cell with the 4 px / 10-tick / puff numbers.
- Spec: `spec/01-mechanics.md` §8.1 open/closed art description rewritten (current text
  describes the 2-tile jamb leaves); §8.3 notes the seal chains.
- Full local gate incl. `npm run test:visual`; commit+push.

**Outcome — `b621a76`.** Landed as written, in `src/render/doors.ts`. **One deviation**:
the keyhole plate is **6×9**, not the 6×8 this plan sketched — the keyway is five rows
tall, and eight rows leave only six inside the two bevels, so one end of the keyway touched
the dark edge and stopped reading as a hole. Confirmed against mockups from the real Pack A
door tiles before it was written; 01 §8.1 says 6×9. Telling an event open from a key turning
needed no sim change: chains only ever hang on puzzle doors and on what a seal holds, so
`unshackle` fires on a cell leaving `chainedCells`, the renderer's own set. Visual goldens
did **not** change after all (F1R1's only door is a closed normal double, which none of this
touches), so nothing was regenerated.

### W3 — Sim changes: spawn protection + vertical doors

Replays affected (hash streams at minimum). Land after W2.

Scope: `ENTRY_SAFE_RADIUS` telegraph rule; side-wall `normal` doors end-to-end (lint,
loader validation, renderer closed/open art, gap→door conversion in `levels/f1–f3.json`).

Done when:
- Unit: an enemy 2 tiles from the entry point telegraphs (30 ticks, then 12-tick
  blink-in, harmless and unhittable throughout); an enemy 4 tiles away spawns instantly;
  two identical runs hash identically — extend `sim.hash()` (~line 1403) if telegraph
  state isn't covered.
- Unit/lint fixtures: side `normal` door accepted; side `silver` door rejected with a
  pointed message; `combat_seal` room with a side door accepted, with a side gap
  rejected.
- Unit: closed side door blocks player/bolts/wisp and auto-opens at 24 px; renderer
  tests pin the closed slit tiles and open half-leaf (tile, cell, flip) for both walls.
- `npm run lint:levels` green on the converted floors; door tables in
  `spec/03-levels.md` updated (types only — maps unchanged); vertical-door rules added
  to `spec/01-mechanics.md` §8.1 and `spec/03-levels.md` §1.2/§1.4; spawn rule added to
  `spec/02-entities.md` §2.1 and the reset list in `spec/01-mechanics.md` §9.
- `npm test` and `npm run lint:levels` green (replays may be red here — see W4);
  commit+push.

**Outcome — `7ef1227`.** Landed as written. `ENTRY_SAFE_RADIUS = 48` holds back any map
enemy inside three tiles of the entry point and runs it through the wave machinery instead;
`sim.hash()` grew the telegraph list, which it had to, since telegraphs used to exist only
in wave rooms. All five side gaps in f1–f3 became `normal` doors (door-table `type` only —
the ASCII maps are untouched); f4 had none. Replays went red by design, as scoped, and W4
reconciled them.

**Known, out of scope (pre-existing, tracked separately).** A `combat_seal` room can be
walked out of: `openNearbyDoors` (`src/sim/sim.ts`) opens any *normal* door whose centre is
within 24 px, without consulting `seal`, and `openDoor` writes the `DOOR_OPEN` tile
straight away — so a not-yet-opened normal door in a sealed room (F4 R4's `d4` on the
solution path) unseals itself on approach. This predates the tweaks batch; W3's gap→door
conversion neither caused it nor widened it (no converted door sits in a seal room), and
W4 deliberately did not fix it — a sim change there would have moved the very replays W4
exists to pin down.

### W4 — Reconciliation

Scope: re-record replays via the route autopilot (`npm run route`, then
`npm run replay:record`) — routes should survive unchanged (auto-opening side doors
don't need inputs; telegraphed spawns only delay fights — adjust route timing where a
fight now starts later); regenerate visual goldens if W3 changed any; spec-drift sweep
over every section named above; run everything.

Done when:
- `npm run typecheck && npm run lint && npm test && npm run lint:levels &&
  npm run test:replay && npm run test:e2e && npm run bench` all green, plus local
  `npm run test:visual`.
- The fullgame replay still reaches victory with `TREASURE 81` and a plausible length
  (the `FULLGAME_TICKS` window widens only if the telegraph delays justify it — say so
  in the commit).
- Commit+push.

**Outcome.** Every route survived unchanged — no `goto`, `clear` or `wait` needed retiming,
because `clear` waits on telegraphs as well as enemies and the auto-opening side doors need
no inputs. `f1.macro` and `f4.macro`'s tapes came back byte-identical; `f2` lost 24 ticks
(2612 → 2588) and `f3` gained 83 (3098 → 3181), and the chained game went 9875 → 9934 ticks
— still `treasure=81, victory=true`, and comfortably inside the existing 8 000–60 000
`FULLGAME_TICKS` band, which therefore did **not** need widening. Every assert *value* is
unchanged and still matches the solution-path tables of 03 §2–§5; only the ticks they sit on
moved. One route header did change: the chained run now hands floor 4 **four** hearts rather
than five (spawn protection costs the autopilot one heart re-clearing F3 R3), so `f4.route`'s
`start hp=` follows it, as that file's own rule says it should — the tape is unaffected and
still byte-identical to the chained run's f4 segment. Visual goldens passed untouched. The
spec sweep found the tweak sections accurate; what it did fix was tick counts that had gone
stale (README, TESTING §6, the bench's pinned `9875`, `hud.spec`'s example), a dead
`doorLeafSide` reference in IMPLEMENTATION_PLAN, ASSET_GUIDE §3.2 still describing only the
pack's 2-tile leaf recipe, 02 §4.4 reading as though the shackle were decor-table-only, and
four wrong cross-references in 00-overview's asset-gaps table.

## Manual spot-check list (for the project owner, after W4)

- Space and Backspace swing the sword; E opens a chest.
- Enter F1R2 (first skeleton) repeatedly from each door: never take contact damage
  before a nearby skeleton's telegraph + blink-in completes.
- Watch F2R3 (arrow gallery): exactly one clean bolt per shot, no smear across tiles,
  launcher animates only within its wall tile.
- Push the F3R2 crate into the trench watching the landing closely — no flicker frame
  (also step it with `undervault.freeze()`/`advance(1)`).
- Silver door (F1R2→R4): keyhole visible while closed. Gold vault door (F4R5): gold
  keyhole at the seam.
- F2R4 puzzle door and F3R6 seal: chains visible while locked; chains break off with a
  puff at the moment of unlock; sealed door shows mirrored symmetric art.
- F1R2→R3 side door: closed slit on the wall line, auto-opens on approach into two
  anchored half-leaves (bottom one mirrored).
- Double doors and single doors: open leaves are one tile, tucked ¾ into the doorway,
  4 px proud into the room, hugging their jambs.
