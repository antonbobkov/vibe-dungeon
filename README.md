# Undervault

A four-floor top-down pixel-art dungeon crawl, built to a written specification: 26 rooms,
83 coins, one gold key and a vault at the bottom. Sword, spikes, flame jets, arrow launchers,
pushable crates, torch puzzles, a sealed arena and a ladder down.

It runs in a browser at 320 × 208, 60 ticks a second, on an integer-only deterministic
simulation — so the whole game can be played back from a recorded tape of button presses,
which is how it is tested.

```
npm install
npm run dev          # http://localhost:5173
```

**Controls**: arrows or WASD to move · `X`/`J` swing · `Z`/`K`/`E` use · `Escape`/`P` pause ·
`M` mute. `?debug=1` on the URL swaps the art for the collision view — hitboxes, deadly trap
windows, prop states and enemy state letters.

## The art

The game draws [Pack A of the *2D Pixel Dungeon Asset Pack*](https://pixel-poem.itch.io/),
which is licensed content and is **not in this repository** (the repo tracks text only — see
[CLAUDE.md](CLAUDE.md)). Put the pack in `art_assets/` so this path exists:

```
art_assets/2D Pixel Dungeon Asset Pack v2.0/2D Pixel Dungeon Asset Pack/
```

Without it the game still runs: the loader synthesizes a flat-colour stand-in for every tile
and animation in the manifest, chosen by what the entry is — brick walls, purple floors,
gold pickups, red traps. That is also what CI plays, since CI has no art either. Set
`PLACEHOLDER_ART=1` to force it with the packs installed.

`npm run dev` serves the packs from `art_assets/`; `npm run build` does not copy them into
`dist/`, so a built bundle draws the placeholder art until the folder is put beside it.

## What is where

| Path | |
|---|---|
| `spec/` | the specification the game is built to — mechanics, entities, levels, UI, data formats |
| `src/sim/` | the simulation: pure, headless, deterministic, no DOM (enforced by lint) |
| `src/render/` | the renderer: pure decision functions plus thin drawing |
| `src/audio/` | 04-ui §5's cue table and the WebAudio synth that plays it |
| `src/game/` | the event stream the presentation layer runs off |
| `levels/` | the four floors as data |
| `tools/` | the level linter, the macro compiler, the headless sim CLI, the route autopilot |
| `tests/` | unit, replay, e2e, bench and the local visual goldens |

## Commands

| | |
|---|---|
| `npm run dev` | play it |
| `npm run build` | production build into `dist/` |
| `npm run typecheck` · `npm run lint` · `npm run format` | static checks |
| `npm test` | unit tests (`-- --coverage` for the coverage floor) |
| `npm run lint:levels` | the level data against 03-levels' rules and totals |
| `npm run test:replay` | every recorded playthrough, asserts and state hashes |
| `npm run test:e2e` | Playwright, on the placeholder-art build |
| `npm run bench` | sim tick cost across the full-game replay |
| `npm run test:visual` | local only: screenshot goldens and the renderer bench (needs the art) |
| `npm run sim -- --macro <file>` | run a macro headless with a state trace |
| `npm run route -- <route>` | re-author a solution macro from its route |

[TESTING.md](TESTING.md) explains what each layer is for.

## How it is tested

The sim is deterministic and hashable, so a playthrough is a file: `tests/replay/*.macro`
compiles to a tape of one input byte per tick, and `npm run test:replay` runs all twelve
headless — the four floor solutions, the chained full game (9875 ticks, 2 min 45 s, ending on
`treasure=81, victory=true`), two softlock probes and the scenario macros — checking every
embedded assert, that two runs agree tick for tick, and that each run still matches the state
hashes recorded beside it.

The same tapes drive the browser: the e2e injects the full game through the real loop and
watches it reach the victory screen in about two and a half seconds.
