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

## Quality gates

Three commands, and they are the same three the release workflow runs:

```
npm run lint    # eslint 9 flat config: @eslint/js recommended + eslint-plugin-security
npm test        # node --test
npm run pack    # dist/tabvault-<version>.zip
```

CI also runs two scanners that need no local install beyond Docker:

```
docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:latest detect --source /repo --no-banner --redact
docker run --rm -v "$PWD:/repo" aquasec/trivy:latest fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed /repo
```

`npm run lint` is clean here (0 errors; the remaining
`security/detect-object-injection` and `detect-non-literal-fs-filename` output
is warnings, which never fail the run), so the CI lint step is a hard gate — a
new error breaks the release build. Keep it that way: there is no `innerHTML`
or `insertAdjacentHTML` anywhere in this repo, and the house rules in
`eslint.config.js` exist to keep it so. Do not silence a finding to make the
run green.

## Store kit

Chrome Web Store submission is prepared in `docs/store/listing.md` (paste-ready
listing, permission justifications, checklists) and `PRIVACY.md` (policy; the
contact email is still the `<your contact email>` placeholder).

## Rules that are not obvious from the code

- Title changes are deliberately not a snapshot trigger (live titles would re-arm the debounce forever); URL, pinned, group and mute changes are; a max-wait cap (`pendingSince`) guarantees a snapshot within max(10 x debounce, 5 min).
- `stripVolatile` sorts windows by id so focus order never defeats snapshot dedup.
- Restore: if `chrome.windows.create` rejects for the first tab's URL, it retries without a URL and reports that tab as an error instead of dropping the window.
- The page pauses re-rendering while a group or window rename input is open (`state.editing`) or a `<select>` inside the grid/selection bar is focused; `state.renderPending` flushes on blur.
- Window names live in `chrome.storage.local` under `windowNames` (`TabVault.WINDOW_NAMES_KEY`; window id to name), not `storage.session`, because Chrome also wipes session storage on an extension update or reload; the worker clears the key on `chrome.runtime.onStartup`, since window ids reset with the browser. `buildSession` copies them into sessions as the optional `windowName`; restore re-applies them through a `nameWindow` step; a rename schedules a snapshot.
- Appearance: `settings.theme` (system/light/dark) is mirrored to `localStorage["tabvault.theme"]` and stamped on `<html data-theme>` before first paint by `app/theme-boot.js` (MV3 forbids inline scripts). "System" is pure CSS.
- Keyboard shortcuts exist in one table, `lib/shortcuts.js`: the key handler, the hint strip and the `?` panel read it. Add a binding there and nowhere else.
- Styles are one inline `<style>` in `app/index.html`, split by `/* == section == */` markers; the tokens are the spec's table (`docs/superpowers/specs/2026-09-28-console-ui-design.md`).
- `tools/pack.js` refuses to build without the four IBM Plex woff2 files and `app/fonts/LICENSE.txt`.
- `lazyRestore` (default on) controls whether restored tabs are discarded; the e2e harness turns it off for scenario I-a because `chrome.tabs.discard` crashes Playwright's Chromium.
- Settings defaults live in one place, `lib/settings.js` (`withDefaults`), read by the page and the worker; `settings.autoDiscard` is merged one level deep.
- Snapshot storage is version 2 (1.2): `snapIndex` (metadata, newest first) plus `snap:<id>` per snapshot, through `lib/snapstore.js` only; the worker migrates a 1.x `snapshots` array once at start (`ready`) and every snapshot write goes through its `enqueue` queue. Read `snapIndex`, never `snapshots`.
- Every write to `recentlyClosed` goes through the worker (`recentWrite` queue; the page sends `recentRemove` / `recentClear`). The worker's tab cache is memory only; a tab closed while the worker slept is described from the latest snapshot of this browser session (`sessionStartedAt` in `storage.session`).
- Auto-discard: alarm `tabvault-idle` every 5 minutes also refreshes the badge; the rule is `lib/discard-rule.js` (never active, audible, `autoDiscardable === false`, own pages; 25 per run); `runAutoDiscard` and `planAutoDiscard` are worker globals the e2e harness calls. Nothing is ever closed by it.
- Save and close always confirms in the page (focus on Cancel) before the `saveAndClose` message; the worker closes only the tabs the snapshot saved (`lib/save-close.js`).
- The side panel is `app/index.html?panel=1` (`state.layout`, `data-layout="panel"`, CSS section `== panel ==`); `chrome.sidePanel.open` must be called inside the user gesture, never after an await. No `contextMenus`: the brief allows `sidePanel` only.
- `/` is Search; the palette is `Alt+K`, handled before the modifier bail-out in the keydown handler (matched on `e.code === "KeyK"`).

- Pure logic lives in `lib/` with the UMD wrapper; everything that touches
  `chrome.*` goes through the page (`app/`) or the worker.
- Snapshots are event-driven (debounced), never on a timer; identical
  sessions are not stored twice; manual/pinned snapshots are never rotated out.
- Restore creates tabs inactive and discards them; nothing loads until clicked.
- No host permissions, no downloads permission; `alarms` debounces the change-driven snapshots and runs the 5-minute idle/badge alarm.
- Never use alert/confirm/prompt; confirmations are inline.
- Commit messages end with the attribution trailer used in sibling repos.

## Known follow-ups (as of 2026-11-07)

- Closed in 1.2: the cap-branch alarm fallback, no drops in `nodrop` columns, the snapshot storage split.
- The delegated `change` handler in wire() is a no-op (blur flushes pending renders).
- A window restored via the create-retry keeps an extra New Tab page; a group containing only that window's first tab throws into the per-step catch.
- Recently closed: a tab opened and closed between two snapshots while the worker slept is not recorded; when the browser quits, its last windows may be recorded as closed batches if the worker still receives those events (not verified).
- Not verified by automation: Alt+Shift+T on Windows (may collide with Chrome's focus-toolbar shortcut), restore with file:// tabs, lazy restore (discard) inside a real restore and the auto-discard run in real Chrome (Playwright's Chromium crashes on chrome.tabs.discard; e2e I-b and Z are LIMITED when that happens), the side panel itself (Playwright cannot drive it; Y asserts the layout), the `open-side-panel` command.
- Deferred minors are listed in docs/superpowers/ledgers/2026-09-17-tabvault/progress.md.
