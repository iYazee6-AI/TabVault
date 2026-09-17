# TabVault — project guide for Claude Code

Read this first. `docs/HISTORY.md` is the decision log; `docs/superpowers/`
holds the spec, plan, and build ledgers. The method is described in
`E:\OneDrive\Sources\Yazeed AGI\SYSTEM.md`.

## What this is

A Manifest V3 Chrome extension: one page showing every window, tab group and
tab; search, bulk move/close, native groups, duplicate cleanup; automatic
local snapshots on change; lossless JSON export; restore with lazy-loaded
tabs. Plain HTML/JS, no build step, no runtime dependencies, MIT. Modeled on
Tab Manager v2 (MIT) but written from scratch.

## Commands

```
npm test        # node --test over lib/ with a fake chrome API
npm run e2e     # Playwright harness, real extension in Chromium
npm run pack    # dist/tabvault-<version>.zip
```

## Rules that are not obvious from the code

- Pure logic lives in `lib/` with the UMD wrapper; everything that touches
  `chrome.*` goes through `lib/chrome-api.js` or the worker.
- Snapshots are event-driven (debounced), never on a timer; identical
  sessions are not stored twice; manual/pinned snapshots are never rotated out.
- Restore creates tabs inactive and discards them; nothing loads until clicked.
- No host permissions, no alarms, no downloads permission.
- Never use alert/confirm/prompt; confirmations are inline.
- Commit messages end with the attribution trailer used in sibling repos.

## Known follow-ups

(none yet)
