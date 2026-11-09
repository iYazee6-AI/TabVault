# TabVault 1.2.0 "Keeper" Implementation Plan

**Goal:** everything in `docs/superpowers/specs/2026-11-07-tabvault-1-2-keeper-design.md`: auto-discard idle tabs, the icon badge, the side panel layout, recently closed, the command palette, save and close, the three parked follow-ups, the store kit for 1.2.0.

**Architecture:** unchanged shape. Pure logic in `lib/` (UMD, `node --test`), `chrome.*` in `background.js` and `app/`. New modules: `lib/settings.js` (one defaults table for the page and the worker), `lib/snapstore.js` (snapshot index plus one key per snapshot, migration), `lib/badge.js`, `lib/discard-rule.js`, `lib/recent.js`, `lib/palette.js`, `lib/save-close.js`. The worker owns every write to snapshots and to the recently-closed list (message queue, as in 1.1).

**Branch:** `feature/1.2-keeper` from `main` (b00ada5). Not merged here: Naqid reviews first.

## Global constraints

- Permissions gain `sidePanel` only. No content scripts, host permissions or network calls. No `innerHTML`; nodes through `el()`.
- Never close a tab without the inline confirmation (save and close); never discard the active, audible or `autoDiscardable === false` tab.
- Gates per task: `npm run lint` 0 errors, `npm test` all pass; `npm run e2e` and `npm run pack` at the end (Task 8). No literal backslash added.
- Commits by pathspec; the three untracked `ChatGPT Image ....png` files stay untracked.

## Baseline (HEAD b00ada5)

Lint 0 errors / 33 warnings; 36 unit tests; 21 e2e scenarios (I-b PASS or LIMITED).

## Tasks

### 1. Storage split, cap-branch fallback, nodrop rows
- `lib/settings.js`: `DEFAULT_SETTINGS` (adds `badge`, `recordClosed`, `autoDiscard {enabled, minutes, keepPinned, allowlist}`), `withDefaults()` (deep for `autoDiscard`). Page and worker read it.
- `lib/snapstore.js`: keys `snapIndex` (metadata, newest first) and `snap:<id>`; `migrate(area)` (a 1.x `snapshots` array to version 2, a version-2 store left alone, a fresh store stamped 2), `listSnapshots`, `getSnapshot`, `addSnapshot(area, snap, keep)` (rotation removes the dropped keys; a quota error drops the oldest unpinned and retries once), `deleteSnapshot`, `pinSnapshot`, `latestSnapshot`.
- `lib/snapshots.js`: `makeSnapshot(..., name)` optional name; `scheduleDecision()` pure (start / rearm / wait, with the alarm-gone fallback).
- `background.js`: migration at worker start, every snapshot operation awaits it; the cap branch asks `chrome.alarms.get(ALARM)` and re-arms when the alarm is gone.
- `app/app.js`: row and group drop handlers only in `normal` windows. `app/dialogs.js`: the Snapshots dialog reads the index and fetches the session on Restore and Export.
- e2e J and K, `tools/screenshots.js` seeding: read and write through the new keys.
- Tests: `test/snapstore.test.js` (migration from 1.x, version 2 left alone, fresh store, add and rotate remove keys, delete and pin), `test/settings.test.js`, `scheduleDecision` cases in `test/snapshots.test.js`.

### 2. Badge
- `lib/badge.js`: `badgeText(mode, {total, unloaded})` (`""` for off, `999+` cap), `countForBadge(tabs, ownPrefix)`.
- Worker: `refreshBadge()` behind a 2 s timestamp gate plus one trailing update; amber background; on tab create, remove, update (discarded, url), attach, detach, a settings change, worker start and the 5-minute alarm.
- Settings dialog: Badge (Tab count / Unloaded tabs / Off). Tests: `test/badge.test.js`. e2e U.

### 3. Auto-discard
- `lib/discard-rule.js`: `parseAllowlist`, `hostAllowed`, `planDiscard(tabs, {settings, now, groups, ownPrefix, cap: 25})`, oldest first.
- Worker: alarm `tabvault-idle` every 5 minutes (created when missing), `runAutoDiscard({now, force})` one tab at a time with a per-tab catch, `autoDiscard.lastRun` in `storage.session`; message `discardIdleNow`.
- Settings dialog: on/off, threshold, keep pinned, allowlist, the "last run 12:40, 7 unloaded" line. Tests: `test/discard-rule.test.js`. e2e Z (the plan PASS; the discard itself PASS or LIMITED).

### 4. Recently closed
- `lib/recent.js`: `shouldRecord(url, ownPrefix)`, `closedEntry()`, `appendClosed(list, entries, cap 200)`, `removeEntries`, `batches()` (a window close grouped).
- Worker: a tab cache (memory, seeded by `tabs.query`, kept by events), with the latest snapshot as the fallback for a tab the cache never saw; `tabs.onRemoved` (not window-closing) appends one entry, window-closing tabs are buffered and appended on `windows.onRemoved` as one batch; messages `recentRemove`, `recentClear`; nothing recorded when `recordClosed` is off.
- Page: "Recently closed (N)" section under the grid, collapsed by default; Reopen (current window), Reopen all (a window batch, in a new window), Clear. Tests: `test/recent.test.js`. e2e V.

### 5. Palette
- `lib/palette.js`: `paletteActions(shortcuts, extras)`, `filterPalette(query, actions, tabs, {limit})`, ranked (prefix, word start, substring; actions before tabs on an equal score).
- Page: `Alt+K` overlay (`#palette`), arrows, Enter, Esc; key caps per row; ⋯ menu entry "Command palette". Tests: `test/palette.test.js`. e2e W.

### 6. Save and close
- `lib/save-close.js`: `planSaveClose({windows, targetIds})` (tab ids, the window kept open with one New Tab when nothing else would remain), `snapshotName(label, now)`.
- Worker message `saveAndClose {windowIds, name}`: a kept snapshot (reason `save-close`, named), then the plan. Page: confirmation dialog with the count (never skipped), a window-card button, `Shift+S` on the card (shortcut table), palette entries for this window and for all windows. Tests: `test/save-close.test.js`. e2e X.

### 7. Side panel
- `manifest.json`: `sidePanel` permission, `side_panel.default_path` `app/index.html?panel=1`; worker `setPanelBehavior({openPanelOnActionClick: false})`; a browser command `open-side-panel` (no default key).
- Page: `?panel=1` sets `data-layout="panel"`: one column, the panel's window first and expanded, the others collapsed, search pinned, bulk bar at the bottom, compact rows; ⋯ menu and palette "Open in side panel" (hidden inside the panel). e2e Y (the layout, not the panel API).

### 8. Store kit and gates
- Version 1.2.0 (manifest, package.json); listing What's new, the sidePanel justification, the memory line made true; the PRIVACY.md sentence; README; HISTORY.md; CLAUDE.md rules and follow-ups; screenshots regenerated (1280x800, RGB) with the new sections; `npm run pack` to `dist/tabvault-1.2.0.zip`; the full e2e run.

## Deviations

1. **No action context menu.** An entry in the toolbar icon's context menu needs the `contextMenus` permission, and the brief allows `sidePanel` only. The panel opens from the ⋯ menu ("Open in side panel"), the palette, and a browser command `open-side-panel` the user can bind at `chrome://extensions/shortcuts`.
2. **`/` stays Search.** `/` has been the search shortcut since 1.0 (the hint strip the 1.1 spec fixes, the search box's key cap, scenario Q); the palette opens on `Alt+K` (matched on the `KeyK` code, so any keyboard layout works).
3. **The badge throttle keeps one trailing update.** The 2 s timestamp gate alone would leave a stale count after a burst (closing ten tabs), so a gated call schedules one 2 s trailing refresh (it finishes within the worker's idle lifetime); the 5-minute alarm still corrects anything missed.
4. **Recently closed uses a tab cache.** `tabs.onRemoved` carries no URL, so the worker keeps a memory cache of open tabs and falls back to the latest snapshot for a tab closed while the worker was asleep; a tab opened and closed between two snapshots while the worker slept is not recorded.
5. **Settings layout.** The auto-discard settings sit inside `settings` as `settings.autoDiscard` (the spec's first section); the recently-closed list (`recentlyClosed`), the snapshot index and the last run (`storage.session` `autoDiscard.lastRun`) have their own keys.
6. **Screenshots.** Five is the store's limit, so 02-search and 03-selection gave way to 02-command-palette (which also searches tabs) and 03-unload-idle-tabs; 01 shows Recently closed opened under the windows and 05 a named save-and-close snapshot. The "last run" line in 03 reads a run record the script writes, because a real run's `chrome.tabs.discard` crashes Playwright's Chromium.
7. **Discard idle tabs now** runs the rule even when the schedule is off (it is the user's explicit request), with the same never-discard rules and the 25 cap.

## Result (2026-11-07)

Ten commits on `feature/1.2-keeper`; lint 0 errors (43 warnings, all `security/*`); 66 unit tests; e2e 27 scenarios, 25 PASS, I-b and Z LIMITED (the discard crash; Z's settings and plan parts ran live), no console errors; `dist/tabvault-1.2.0.zip`.

## Review round (Naqid, 2026-11-07)

Fix first on 1 and 2, with 3 and 4 in the same round, each with a test: (1) the migration merges an existing index (union by id, the keep cap, dropped keys removed), stamps `storageVersion` last, and save and close refuses until it has completed; (2) no unsaved-form promise anywhere (Wakeel's ruling; the note says "tabs an extension marked as not discardable"); (3) the quota retry frees the dropped key before writing again; (4) Alt+K leaves Option+K to text fields other than the search box (`opensPalette`). Screenshots regenerated for the new note.

After the round: lint 0 errors (46 warnings, all `security/*`); 70 unit tests; e2e 27 scenarios, 25 PASS, I-b and Z LIMITED (the discard crash), no console errors; `dist/tabvault-1.2.0.zip` rebuilt.

**For the owner's hands before upload:** the side panel itself (⋯ → Open in side panel, the palette entry), the `open-side-panel` command once bound at chrome://extensions/shortcuts, and auto-discard in real Chrome (on at 15 minutes, `zz` on the idle tabs, the "last run" line). Playwright can drive none of the three.
