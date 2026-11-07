# TabVault 1.2.0 "Keeper" — design

Date: 2026-11-07 (night). Status: the owner's word of the same night ("expand on TabVault, plan the next version and develop and test it"); the choices below are Wakeel's from the 2026-11-01 competitor survey (vault `reports/2026-11-01-tabvault-competitor-survey.md`, ranked: auto-discard, badge, side panel, recently closed, palette, send-to-save) and the parked follow-ups in `CLAUDE.md`; the Assumptions section lists what the owner may overturn.

## Why

1.1.1 is a good console for the tabs that are open. The listing now promises "unload tabs you pick", and the survey's top competitor features are about the tabs you do not pick: idle tabs eating memory, tabs you closed and want back, and a one-click "put all this away". 1.2 is the version that keeps things: it unloads idle tabs by rule, counts them on the icon, remembers what closed, lives in the side panel, and saves-and-closes a window on one command, all without a new host permission and without ever losing a tab silently (OneTab's one-star theme).

## Scope

In: six features below, the three parked follow-ups that touch them, tests at both levels, the store listing text and screenshots for 1.2.0, the version bump to 1.2.0 (the 1.1.1 rename is kept and goes out inside 1.2.0; the 1.1.1 zip is superseded).

Out: page-content search (breaks the privacy promise), cross-device sync, share-as-link, a Firefox port, a memory meter (chrome.processes is Dev only), the Node bridge for the assistant (the vault's "Chrome from the assistant" item, its own decision).

## Features

### 1. Auto-discard idle tabs (the memory claim made honest)

- Off by default. Settings: on/off, idle threshold (15, 30, 60, 120 minutes, 4 hours; default 60), never discard: pinned (default on), audible (always, not a setting), the active tab of every window (always), tabs in a group named with a leading pin emoji or on the host allowlist (a list of hosts with wildcard subdomains, one per line), tabs with unsaved form state when Chrome exposes `autoDiscardable === false` (respect it).
- Mechanism: one `chrome.alarms` alarm every 5 minutes (MV3 workers cannot hold timers; the alarm minimum is 30 s, 5 minutes is enough), `chrome.tabs.query({discarded: false, active: false, audible: false})`, `tab.lastAccessed` (Chrome 121+; when absent for a tab, skip it rather than guess), `chrome.tabs.discard(id)` one by one with a per-tab catch; a run never touches more than 25 tabs (the rest wait for the next alarm) so a wake after sleep does not discard a hundred at once.
- Reliability (the Auto Tab Discard complaint): the worker records each run in `chrome.storage.session` (`autoDiscard.lastRun`, counts) and the page shows "last run 12:40, 7 unloaded" under the setting; a tab discarded by rule gets the `zz` flag like a manual one; nothing is ever closed.
- Settings live in `chrome.storage.local` under `settings.autoDiscard` beside `lazyRestore`; the worker reads them at each alarm (no restart needed).

### 2. The icon badge

- `chrome.action.setBadgeText` with one of: total tab count (default), unloaded count, or off; colour from the console amber on light, the muted ink on dark (badge colour is static: pick one that reads on both, the amber). Updated from the worker on `tabs.onCreated`, `onRemoved`, `onUpdated` (discarded change), `onAttached`/`onDetached`, debounced through a 2 s alarm-free throttle inside one event turn (a simple timestamp gate, no timers held across the worker's life; a missed update is corrected by the next event and by the 5-minute alarm).

### 3. Side panel

- `sidePanel` permission; the same `app/index.html` loaded in the panel with a `?panel=1` query: one column, compact rows, no window grid (the panel shows the current window's tabs first, the others collapsed), the search box pinned at the top, the bulk bar at the bottom. The toolbar click still opens the full page; the panel opens from the action's context menu entry "Open in side panel" and from the palette. `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })`.
- The page detects `panel=1` and sets `data-layout="panel"`; CSS does the rest; no second app.

### 4. Recently closed

- No `sessions` permission: derived from the snapshot history TabVault already keeps. The worker, on `tabs.onRemoved` (when the window is not closing) and `windows.onRemoved`, appends `{url, title, favIconUrl, windowId, groupTitle, closedAt}` to `recentlyClosed` in `chrome.storage.local` (cap 200, newest first; URLs of `chrome://` and the extension itself skipped). The page gets a "Recently closed" section (collapsed by default, count in the heading) with reopen (one tab, in the current window) and reopen-all-of-a-window; a cleared list on the Clear button; a setting to turn the recording off (default on; the listing's data disclosure stays "Web history", already declared).

### 5. Command palette

- `Alt+K` (and `/` when no field has focus) opens a palette over the page: typing filters actions (every entry of `lib/shortcuts.js` by name, plus "Snapshot now", "Save and close this window", "Open side panel", "Discard idle tabs now", "Export", "Settings") and tabs (title, domain; the existing `lib/search.js` scoring); Enter runs or activates; arrow keys move; Esc closes; the first row shows the key for the action when one exists. No new permission.

### 6. Save and close (send to TabVault)

- A command "Save and close this window" (palette, the window card menu, a shortcut `Shift+S` on the card): takes a snapshot named with the window's name and the time, confirms with the count ("Save 23 tabs and close them? The snapshot is kept and can be restored from Snapshots."), then closes the tabs; the window itself is kept open with one New Tab when it is the only window (Chrome would quit otherwise). The confirmation is never skipped (the OneTab complaint). "Save and close all windows" exists only in the palette with the same confirmation.

### Parked follow-ups folded in

- Snapshot storage split: an index key plus one key per snapshot (`storageVersion: 2`), with a one-time migration at worker start and a test that a 1.x store migrates and a 2 store is left alone; the recently-closed list and the auto-discard settings use their own keys from the start.
- The cap branch in `background.js`: `chrome.alarms.get(ALARM)` fallback when `storage.session.remove` rejects.
- Rows and groups inside `nodrop` (popup) columns skip the drop handlers.

## Tests

- Unit (`node --test`, 36 now): the idle rule (threshold, pinned, audible, active, allowlist with wildcard, autoDiscardable, the 25 cap, a tab without lastAccessed skipped), the badge text per mode, the recently-closed append and cap and the skipped URLs, the palette filter and ranking, the storage migration, the save-and-close plan (the only-window case).
- e2e (`e2e/run.js`, 21 scenarios now): the badge after opening and closing tabs; the recently-closed section after closing a fixture tab and reopening it; the palette opening, filtering and running an action; save-and-close with the confirmation; the side panel layout under `?panel=1` (the panel API itself is not drivable in Playwright: assert the layout, not the panel); auto-discard asserted on its plan and on the `zz` flag where `chrome.tabs.discard` is allowed, LIMITED where Playwright's Chromium crashes (the known quirk, documented in `CLAUDE.md`).
- Lint 0 errors; `npm run pack` produces `dist/tabvault-1.2.0.zip` with the fonts.

## Store

- `manifest.json` version 1.2.0, `package.json` too; permissions gain `sidePanel` only; the listing (`docs/store/listing.md`) gets a 1.2.0 What's new and the permission justification for sidePanel; the summary keeps the rename; `tools/screenshots.js` regenerates the five screenshots in the console look with the new sections (1280x800, 24-bit, no alpha); `docs/HISTORY.md` gets the 1.2.0 section; `README.md` the feature list; `PRIVACY.md` one sentence on the recently-closed list (local, cap 200, off switch).

## Assumptions (the owner may overturn any)

1. Auto-discard is off by default and the threshold defaults to 60 minutes.
2. Recently closed is derived locally, cap 200, no `sessions` permission.
3. The badge shows the total tab count by default.
4. The side panel is a layout of the same page, not a second app.
5. Save and close always confirms; there is no "do not ask again".
6. 1.1.1 is superseded: the owner uploads 1.2.0 when it is ready instead of 1.1.1 (the rename is inside it).
