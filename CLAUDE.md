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
npm run screenshots  # re-captures docs/store/ screenshots + promo tile (port 8771)
```

## Store kit

Chrome Web Store submission is prepared in `docs/store/listing.md` (paste-ready
listing, permission justifications, checklists) and `PRIVACY.md` (policy; the
contact email is still the `<your contact email>` placeholder).

## Rules that are not obvious from the code

- Title changes are deliberately not a snapshot trigger (live titles would re-arm the debounce forever); URL, pinned, group and mute changes are; a max-wait cap (`pendingSince`) guarantees a snapshot within max(10 x debounce, 5 min).
- `stripVolatile` sorts windows by id so focus order never defeats snapshot dedup.
- Restore: if `chrome.windows.create` rejects for the first tab's URL, it retries without a URL and reports that tab as an error instead of dropping the window.
- The page pauses re-rendering while a group rename input or a `<select>` inside the grid/selection bar is focused; `state.renderPending` flushes on blur.
- `lazyRestore` (default on) controls whether restored tabs are discarded; the e2e harness turns it off for scenario I-a because `chrome.tabs.discard` crashes Playwright's Chromium.

- Pure logic lives in `lib/` with the UMD wrapper; everything that touches
  `chrome.*` goes through `lib/chrome-api.js` or the worker.
- Snapshots are event-driven (debounced), never on a timer; identical
  sessions are not stored twice; manual/pinned snapshots are never rotated out.
- Restore creates tabs inactive and discards them; nothing loads until clicked.
- No host permissions, no alarms, no downloads permission.
- Never use alert/confirm/prompt; confirmations are inline.
- Commit messages end with the attribution trailer used in sibling repos.

## Known follow-ups (as of 2026-09-17)

- background.js cap branch: if `chrome.storage.session.remove("pendingSince")` ever rejects, change snapshots stop for the session; add a `chrome.alarms.get(ALARM)` fallback in the cap branch.
- Rows/groups inside non-normal (popup) window columns still accept drops; the move fails with a toast. Skip row/group drop handlers when the column is `nodrop`.
- Confirm-close button lacks a `.catch`; the delegated `change` handler in wire() is a no-op (blur flushes pending renders); tabbing between grid selects drops focus to body.
- A window restored via the create-retry keeps an extra New Tab page; a group containing only that window's first tab throws into the per-step catch.
- Snapshots live under one storage key rewritten per write (`storageVersion: 1` recorded); split into an index plus per-snapshot keys in 1.1.
- Not verified by automation: Alt+Shift+T on Windows (may collide with Chrome's focus-toolbar shortcut), restore with file:// tabs, lazy restore (discard) inside a real restore in real Chrome (Playwright's Chromium crashes on chrome.tabs.discard; e2e I-b is LIMITED when that happens).
- Deferred minors are listed in docs/superpowers/ledgers/2026-09-17-tabvault/progress.md.
