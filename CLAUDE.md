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
