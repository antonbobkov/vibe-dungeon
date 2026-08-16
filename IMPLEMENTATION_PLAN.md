# UNDERVAULT — Implementation Plan

How to build the game specified in [spec/](spec/00-overview.md), as a sequence of
milestones sized for AI-agent implementation. Each milestone has a **Definition of Done**
that is machine-checkable; nothing is "done" on visual inspection alone. Read
[TESTING.md](TESTING.md) together with this file.

## Ground rules

- **Stack**: TypeScript (strict), Vite, HTML5 Canvas 2D. No game engine, no runtime
  dependencies beyond dev tooling. Test stack: Vitest (unit/replay), Playwright (e2e).
- **Architecture**: `src/sim/` is a pure, headless, deterministic module — no DOM, no
  Canvas, no `Math.random`, no `Date`, no timers (enforced by an ESLint
  `no-restricted-imports`/`no-restricted-globals` rule set). `src/render/` draws sim
  state; `src/main.ts` wires browser input, the fixed-timestep loop
  (accumulator pattern), and the renderer. The sim must run in Node for tests.
- **Repo layout**:

```
src/sim/        core simulation (entities, rooms, combat, traps, wiring)
src/render/     canvas renderer, animations, HUD, screens, font
src/assets/     packA.ts tile/anim manifest; loader (real art + placeholder mode)
src/main.ts     browser bootstrap
levels/         f1.json … f4.json (transcribed from spec/03-levels.md)
tools/          level-lint.ts, macro-compile.ts, sim-cli.ts
tests/unit/     Vitest specs
tests/replay/   *.macro sources + compiled *.replay.json
tests/e2e/      Playwright specs
```

- **Art**: `art_assets/` exists only locally and is never committed (repo policy —
  see CLAUDE.md). The asset loader has two modes: real art (dev machines) and
  `PLACEHOLDER_ART=1` (CI): the loader synthesizes deterministic flat-colour 16×16
  tiles per manifest entry so every test except real-art visual goldens runs in CI.
- **Constants discipline**: every gameplay number lives in `src/sim/constants.ts`,
  named exactly as in the spec tables, with a comment pointing at its spec section.
  If a constant changes during tuning (M7 only), the affected `.macro` replays must be
  re-verified/re-authored in the same commit.
- **Workflow**: after each milestone (at minimum), commit and push per CLAUDE.md.
  Never merge a milestone with failing or skipped tests (CI-skipped visual goldens
  excepted).

## Milestones

### M0 — Scaffold and asset manifest

Scope: Vite + TS strict + Vitest + Playwright + ESLint/Prettier; folder layout above;
CI workflow (GitHub Actions: typecheck, lint, unit, level-lint, replay, e2e with
`PLACEHOLDER_ART=1`); `src/assets/packA.ts` manifest hand-transcribed from
ASSET_GUIDE §3.1/§3.5 for every tile/animation the spec references (02-entities is the
checklist); sim-purity lint rule.

Done when:
- `npm run typecheck && npm run lint && npm test` all green.
- Unit test locks the trap animation play orders in the manifest (peaks `3,4,2,1`,
  flamethrower `4,3,1,2`, arrow `2,3,4,1` — AG §3.5).
- A deliberate `Math.random` in `src/sim/` fails `npm run lint` (test the rule once,
  then remove).

### M1 — Deterministic sim core: player movement

Scope: tick loop with the 01-mechanics §1 phase order (phases stubbed where systems
don't exist yet); input bitmask latch; a hard-coded test room; player entity with
walking, facing, diagonal factor, axis-separated collision, corner rule (01 §3);
state hash (05 §4); replay runner accepting raw input byte arrays.

Done when unit tests prove, with exact expected numbers:
- Position after N ticks of cardinal and diagonal walking (20 and 14 subpx/tick).
- Wall approach clamps flush (subpx zeroed against the wall) and slides on the free axis.
- The corner rule blocks diagonal slip between two corner-touching solids.
- Two identical runs produce identical hash sequences; a 1-tick input difference
  produces a different final hash.

### M2 — Rooms, doors, camera, level pipeline

Scope: level loader (full 03 §1.2 legend, §1.3 auto-tiling table output, map/table
mismatch errors per 05 §1); all four floors transcribed to `levels/*.json` (entities
beyond the player parse but stay inert); door objects incl. locked/puzzle states
(unlock logic only — keys exist as inventory numbers); room transitions with 24-tick
slide; checkpoints, death/respawn, persistence rules (01 §6, §9); ladder descent;
`tools/level-lint.ts` (03 §1.7); `tools/macro-compile.ts` (05 §3.2);
`tools/sim-cli.ts` (headless run: `--floor --replay --dump-state-every N --verify`);
debug renderer (flat rects from tile classes — for humans, not tested).

Done when:
- `npm run lint:levels` passes on all four floors (and a fixture with a hole in a wall,
  a key/lock imbalance, and an unmatched marker each fail with a pointed message).
- Loader golden test: f1 R1 parses to the exact expected tile-class grid.
- Transition test: crossing d1 takes exactly 24 ticks and places the player on the
  documented entry tile; checkpoint restores on scripted death; persistence unit tests
  for every rule in 01 §9.
- A macro `R 40 / assert room=R2` (through f1's d1) compiles, runs, and passes headless.

### M3 — Combat and enemies

Scope: sword swing (geometry, active window, once-per-swing), damage/i-frames/knockback
/hit-stop (01 §4–5), HURT/DYING states; all four enemy types with their FSMs, chase
steering, separation, LOS, drops, death sequence (02 §2); contact damage.

Done when:
- FSM unit tests cover every transition row in 02 §2.2's tables (e.g. skel_sword
  IDLE→CHASE at exactly 112 px with LOS, WINDUP duration 24, LUNGE displacement).
- Scenario macros: player kills a skel_sword in two swings; skel_axe survives
  knockback with 24-subpx initial velocity; wisp path with the SIN table matches a
  precomputed 60-tick trace; zombie chases through a spike (immune).
- Damage tests: i-frame window blocks a second hit at tick 59, admits it at tick 60.

### M4 — Traps, props, puzzles

Scope: spikes, arrow launchers + bolts, flame jets (02 §3, phase math shared); pickups;
chests; destructible crates; pushable crates + pit bridging; torch groups incl. window
reset; wiring engine (03 §1.6); combat seals; wave spawner (02 §2.3).

Done when unit tests prove:
- Deadly-window boundaries exact for periods 90/120/150/180 (safe at `start−1`, deadly
  at `start`, safe at `period mod period`); offsets shift correctly; `always_on` works.
- A bolt despawns on wall, on crate, on player hit (with damage), and travels 40
  subpx/tick.
- Push charge takes exactly 6 contact ticks, slide 12; refusal cases (wall, trap,
  pickup, second crate, door); pit consumption bridges permanently; non-consumed
  crates reset on re-entry; jammed-corner scenario recovers via re-entry.
- Torch group without window opens its door; with window 600, lighting 3 then waiting
  601 ticks resets all; chest grants contents once; seal closes/opens; three-wave
  table spawns with 30-tick telegraphs and gates the seal.

### M5 — Content complete, solvable, verified

Scope: author the four floor solution macros following 03-levels' solution-path tables
(same asserts, same order); a chained full-game replay (title→f1→f2→f3→f4→victory) in
the sim-cli; fix any level-data transcription bugs found; record final replay hashes.

Done when:
- `npm run test:replay` runs f1–f4 solution replays and the chained full-game replay
  headless, all asserts green, `--verify` hash-stable across two runs.
- Full-game replay reaches victory with `TREASURE 81` (03 §6) and duration between
  15 000 and 60 000 play ticks.
- `npm run lint:levels` totals check matches 03 §6 (83 coins, key/lock parity).
- Softlock probes: macros that jam the F3R2 and F3R5 crates, leave, re-enter, and
  still complete.

### M6 — Real renderer, UI, e2e

Scope: real asset loading/slicing per manifest; layer order AG §6.1; auto-tiling
renderer per 03 §1.3; all animations (02's per-entity anim specs, AG play orders);
walk bob/flip/lunge/flash polish (02 §1.3); sword arc; HUD, bitmap font, hearts,
screens, pause (04-ui); placeholder-art mode parity; browser bootstrap with fixed-step
accumulator and replay injection hook for tests.

Done when:
- Playwright (`PLACEHOLDER_ART=1`): boots to title; ATTACK starts floor 1; injecting
  the f1 replay through the browser loop completes the floor (HUD shows F2); pause
  overlay appears and resumes; no console errors.
- Local-only (`npm run test:visual`, auto-skipped when `art_assets/` is missing):
  screenshot goldens of title screen and floor-1-room-1 first frame match; goldens
  regenerated only via `npm run test:visual -- --update` in a reviewed commit.
- Every animation id in the manifest is exercised by a renderer unit test that steps
  its frame sequence (play order + loop/hold behaviour).

### M7 — Polish, audio, performance, release

Scope: audio synth cues (04 §5) + mute; remaining game-feel items; perf; final tuning
pass (if any constant changes: update spec table, constants.ts, and re-record affected
macros in the same commit); README with run instructions.

Game-feel checklist (each item verified implemented; renderer items by targeted unit
test or e2e assertion where feasible, otherwise by explicit code-review checklist in
the PR/commit description):
- [ ] hit-stop 3 ticks on sword connect · [ ] screen shake on player damage
- [ ] white damage flashes (player + enemies) · [ ] i-frame blink 3/3
- [ ] walk bob + facing flip (player + enemies) · [ ] attack lunge + drawn arc
- [ ] door auto-open at 24 px + leaf art swap · [ ] spawn telegraph cursors
- [ ] chest item float-up · [ ] crate pit-drop animation · [ ] torch smoke-puff on reset
- [ ] death spin/fade + YOU FELL · [ ] victory sequence per 04 §3.3
- [ ] title blink · [ ] all 19 audio cues wired + M mute
- [ ] transition slide smooth at 60 fps

Done when:
- All suites green (`typecheck`, `lint`, `test`, `lint:levels`, `test:replay`,
  `test:e2e`; local `test:visual`).
- Perf bench (Vitest, CI machine): p95 sim tick ≤ 2 ms across the chained full-game
  replay; renderer draw of the busiest room (F4R4 wave 3) ≤ 4 ms p95 in a canvas
  bench (local).
- Checklist above fully checked in this file (edit it to `[x]` as items land).
- A human (the project owner) has played start to finish once — the only manual gate,
  for feel, not correctness.

## Milestone dependencies

Strictly sequential M0→M1→M2→M3→M4→M5; M6 depends on M2 (and uses M5's replays for
e2e); M7 last. If two agents work in parallel, the only safe split is M6 renderer work
alongside M3–M5 sim work, coordinating on sim state shape.
