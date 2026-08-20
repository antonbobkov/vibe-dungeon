# UNDERVAULT — Testing & Verification Strategy

How correctness is established without a human in the loop. The enabling design
decisions (made in the spec, relied on here): the sim is **headless** (runs in Node),
**deterministic** (00-overview determinism rules), free of randomness, and hashable
per tick (05-data-formats §4). Levels are data with a **lint** gate, and every level
ships with a machine-runnable **solution replay**.

## 1. Test pyramid and commands

| Layer | Tool | Command | Runs in CI |
|---|---|---|---|
| Static | tsc, ESLint (incl. sim-purity rules) | `npm run typecheck`, `npm run lint` | yes |
| Level lint | `tools/level-lint.ts` | `npm run lint:levels` | yes |
| Unit | Vitest on `src/sim/` (+ renderer pure parts: font, auto-tiler, anim sequencing) | `npm test` | yes |
| Replay | headless sim-cli over `tests/replay/` | `npm run test:replay` | yes |
| E2E | Playwright, `PLACEHOLDER_ART=1` | `npm run test:e2e` | yes |
| Visual goldens | Playwright screenshots vs committed hashes | `npm run test:visual` | **no** — local only (real art is not in the repo); auto-skips if `art_assets/` missing |
| Perf bench | Vitest bench | `npm run bench` | yes (sim only) |

CI (GitHub Actions) runs every "yes" row on push. A red row blocks the milestone.
Coverage floor: 90% line coverage on `src/sim/` (`npm test -- --coverage`).

## 2. Unit tests — what must be pinned by exact numbers

Every constant table in the spec becomes at least one test asserting exact values, not
inequalities. The non-obvious ones:

- Movement: 20/14 subpx per tick, wall-flush clamping, corner rule (M1 list in
  IMPLEMENTATION_PLAN).
- Combat: swing active window 3–9, once-per-swing, knockback decay sequences
  (48,42,36,… for enemies; 48,44,40,… for the player), i-frame boundary at tick 60,
  hit-stop freezes phases 3–9 of the loop.
- Enemy FSMs: one test per transition row in 02 §2.2; wisp trace vs the SIN table.
- Traps: deadly-window boundaries for all periods/offsets used in 03-levels (data-driven
  test iterating every trap placement in `levels/*.json`).
- Crates/pits/torches/wiring/seals/waves: the M4 list.
- Loader: symbol → tile-class goldens; map/table mismatch errors; auto-tiling formulas
  (spot-check specific cells against 03 §1.3 by hand-computed expectations).
- Persistence: every rule line of 01 §9 (parameterised test over the reset/persist
  matrix).

## 3. Replay tests

`tests/replay/` holds `.macro` sources (human/agent-authored, 05 §3.2) and compiled
`.replay.json`. `npm run test:replay`:

1. Recompiles every `.macro` and fails on drift with the committed `.replay.json`.
2. Runs each replay headless; every embedded assert must hold at its exact tick.
3. Runs everything twice and compares full hash streams (determinism gate).
4. Compares each run with the hash stream recorded in its `.replay.json` (05 §4) —
   the sim still doing what it did the day the replay was authored, and the tick where
   it stopped when it does not. Record with `npm run replay:record`; a recording is
   carried through a recompile of unchanged macro text and dropped as soon as the
   inputs change.
5. Holds `fullgame.macro` to a plausible length (`FULLGAME_TICKS`, currently
   8 000–60 000 ticks): a proof that the game can be finished is worth little if
   "finishing" takes two hundred ticks.

Required replays: `f1 f2 f3 f4` solution paths (asserts = the solution-path tables in
03-levels), `fullgame` (chained, ends with `victory=true, treasure=81`), the M5
softlock probes (`f3-r2-jam`, `f3-r5-jam`), and the M3/M4 scenario macros. When a
gameplay constant changes, recompile; if asserts fail, the change was not
behaviour-preserving — re-author the macro **in the same commit** or revert.

The four solution macros and `fullgame` are generated from `.route` sources by
`npm run route` (`tools/route.ts`), which plays a route against the real sim and records
the input byte it chose each tick — see the M5 section of IMPLEMENTATION_PLAN. The route
is the file to edit; the macro is the recording, and each floor's tape is byte-identical
to its segment of the chained run.

### Authoring loop for agents

```
npm run sim -- --floor f1 --macro tests/replay/f1.macro --dump-state-every 30
```

prints a compact state line (tick, room, player tile, hp, treasure, nearby-entity
summary) every 30 ticks plus on every assert/failure, so an agent can binary-search a
macro mistake without a screen. Determinism makes each iteration reproducible.
`--verify tests/replay/f1.replay.json` additionally checks the stored hash stream.

## 4. Level lint (`npm run lint:levels`)

Validates `levels/*.json` against the schema (05 §1) and the rules of 03 §1.7:
perimeter closure, symbol legality per position, door-endpoint/map agreement,
key/lock parity and key-before-lock reachability (BFS over floor tiles through
declared doors, traps passable, pits passable iff a pushable crate shares the room),
room-size bounds, seal-room constraints, marker/table bijection, coin totals vs the
03 §6 table, `@`/`V` placement. Also re-derivable-data drift: the lint recomputes 03 §6's
totals from the data and fails on mismatch, so the spec table and levels cannot diverge
silently. Fixture files with each violation class keep the linter itself tested.

## 5. E2E and visual

Playwright drives the real browser build with `PLACEHOLDER_ART=1` (deterministic
synthesized tiles — CI has no art, by repo policy). The M6 list is
`tests/e2e/play.spec.ts`: boots to the title, ATTACK starts floor 1, the f1 solution tape
injected through the real loop finishes the floor with the HUD reading F2, pause covers
and uncovers the game, no console errors or warnings anywhere. `boot.spec.ts` keeps the
integer-scaling assertion (canvas CSS size is an exact multiple of 320×208 at 3 window
sizes) and one room-drawn-correctly check.

Text on the canvas is asserted through the font table (`glyphRows`) rather than against a
screenshot, so a failure says which glyph is wrong. The game exposes `window.undervault`
for this — `state()`, `start()`, `toTitle()`, `injectReplay()`, and the `freeze()` /
`advance()` pair that puts it on an exact tick.

Visual goldens (local only, `npm run test:visual`, its own config and port): title screen
and F1R1 first frame with real art, each put on an exact tick first — a shot of "whenever
the display got there" would flicker with the title blink and every idle loop. Goldens are
stored as SHA-256 of the PNG bytes in `tests/visual/goldens.json` (text, committable)
beside the Chromium build they were recorded with, plus the PNG under
`asset_reference/goldens/` (gitignored, regenerable) so a failure can be looked at. The
suite skips itself wherever `art_assets/` is absent, CI included. Update path:
`npm run test:visual -- -u`, committing the new hashes with a note of what legitimately
changed.

## 6. Performance

`npm run bench`: runs the full-game replay headless and times every tick; p95 ≤ 2 ms on
the CI runner (generous — the sim is one small room at a time). A regression fails CI,
catching accidental O(n²) in overlap checks. On the machine this was written on the whole
9934-tick game replays in about 40 ms: p50 0.003 ms a tick, p95 0.009 ms.

The renderer bench is local, and rides with the visual goldens (`npm run test:visual`,
skipped without `art_assets/`): it drives M5's floor-4 tape to the tick the Arena's third
wave lands — the busiest frame in the game — and times one draw per animation frame, p95
≤ 4 ms. Per *animation frame* deliberately: a tight loop of back-to-back draws measures
Chromium's command-buffer flushes as much as it measures the renderer, and reads about ten
times worse than a frame the game actually produces (measured: p50 0.3 ms, p95 0.4 ms).

## 7. What is intentionally not automated

- Game *feel* (does hit-stop feel right?) — the M7 human playthrough.
- Real-art pixel correctness beyond the two goldens — the packs are pre-verified by
  ASSET_GUIDE, and the manifest test (M0) locks coordinates/play orders, which is
  where mistakes would actually occur.
- Audio output correctness — cue-trigger wiring is unit-tested (each cue fires exactly
  once per triggering event on a scripted run); the sound itself is by-construction
  from the 04 §5 table.
