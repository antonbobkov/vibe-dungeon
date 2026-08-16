# Project rules

## Always commit and push after making changes

After any change to the working tree — editing a file, adding a file, deleting a file —
**stage it, commit it with a descriptive message, and push to `origin`.** Do not leave work
uncommitted at the end of a turn.

```bash
git add -A && git commit -m "<what changed and why>" && git push
```

Notes:

- Never use `git add .` blindly on new binary output; check `git status` first and confirm the
  `.gitignore` is doing its job (see below).
- If the push is rejected because the remote has moved on, pull with rebase and push again rather
  than force-pushing.

## Only text files go in the repo

This repository tracks **text only**. Images and other binary assets live locally and are excluded
by `.gitignore`:

- `art_assets/` — the third-party pixel-art packs. Licensed content, never committed.
- `asset_reference/` — coordinate-labelled blow-ups generated from `art_assets/`. Regenerable,
  never committed.

The ignore rules are extension-based, so a text file placed inside either directory *will* still be
tracked. If you add a new kind of binary output, add its extension to `.gitignore` in the same
commit.

## Repository layout

| Path | Tracked | Contents |
|---|---|---|
| `ASSET_GUIDE.md` | yes | Full pixel-verified map of every art asset — tile tables, animation frame counts, room-building recipes |
| `CLAUDE.md` | yes | This file |
| `.gitignore` | yes | Binary exclusion rules |
| `spec/` | yes | Game specification for **Undervault** (00-overview through 05-data-formats) — start at `spec/00-overview.md` |
| `IMPLEMENTATION_PLAN.md` | yes | Build milestones M0–M7 with machine-checkable acceptance criteria |
| `TESTING.md` | yes | Test/verification strategy (headless deterministic sim, replays, level lint, e2e) |
| `art_assets/` | **no** | Source art packs (PNG / GIF / Aseprite) |
| `asset_reference/` | **no** | Generated annotated reference images |

`ASSET_GUIDE.md` references files under `asset_reference/` by name. Those links resolve only in a
local checkout that has the images; that is expected.
