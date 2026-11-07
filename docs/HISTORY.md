# TabVault decision log

## 2026-09-17 — Design

- Request: a tab manager like Tab Manager v2 (https://github.com/xcv58/Tab-Manager-v2)
  with export of all windows and tabs with full details.
- Decisions: build our own in plain JS rather than fork (no React/MobX
  toolchain); JSON export only for v1; restore from JSON with lazy-loaded
  tabs; full-page UI in its own tab; features: all windows/tabs view with
  search, bulk move/close, native tab groups, duplicate cleanup; automatic
  snapshots taken on change (debounced), not on a timer.
- Spec: `docs/superpowers/specs/2026-09-17-tabvault-design.md`.

## 2026-09-17 — 1.0 build

Eight tasks, subagent-driven, a review per task. Rulings that changed the plan:

- Change debounce uses a re-armed `chrome.alarms` alarm (MV3 workers cannot hold a 30 s timeout); 30 s minimum.
- Title changes are not a snapshot trigger (starvation by live titles); mute changes are; `stripVolatile` sorts windows by id.
- Page: column scroll preserved, keyboard cursor skips hidden rows, close-window label uses the unfiltered count, group rename survives re-renders (editing flag, always cleared), move/drop/group failures toast.
- Restore executor skips every step of a window whose creation failed instead of acting on the current window.
- e2e scenario I was found to be scored PASS on indirect evidence because `chrome.tabs.discard` crashes Playwright's Chromium; ruled: add a real `lazyRestore` setting, split I into I-a (full restore verified with lazy off) and I-b (PASS or LIMITED), statuses LIMITED/NOT RUN, worker handle re-acquired.
- Final review (with fixes): finite-bounds check, windows.create retry without URL, discard-failure summary, state-held close confirmation, stable move-target options, select-open render guard, error toasts, non-normal windows excluded from move targets, incognito move guards, 50 MB import cap, max-wait cap for change snapshots, `storageVersion` and favicon trimming, doc reconciliation.
- Parked at merge: see CLAUDE.md follow-ups.

Result: 23 unit tests, 13 e2e scenarios (I-b PASS or LIMITED depending on the environment crash).

## 2026-09-19 — Chrome Web Store submission kit

- Added `docs/store/listing.md`, `PRIVACY.md`, five 1280x800 screenshots and the
  440x280 promo tile, all captured from the real extension by
  `tools/screenshots.js` (fixture server on port 8771, mapped to
  `*.example.com`; 8765 stays e2e's).
- Shipped-code change, required by the store: the manifest `description` was
  135 characters, over the 132-character limit the dashboard enforces on the
  listing summary. Trimmed to 126 ("... with snapshots and export.").
- Data disclosure decided as "Web history" only: tab URLs and titles are stored
  locally; no host permissions and no content scripts, so page content is never
  readable and "Website content" is not ticked.

## 2026-09-28 — 1.1 "Console" UI

- Request: the owner tried the 1.0 store build and asked for better UI/UX. Three mockups; direction A, "Console", chosen (dense, keyboard-first, mono for names and counts, one amber for the thing to press). Spec: `docs/superpowers/specs/2026-09-28-console-ui-design.md`; plan: `docs/superpowers/plans/2026-09-28-console-ui.md`.
- Tokens exactly as the spec's table, light and dark, following Chrome's scheme with an Appearance override (System/Light/Dark). IBM Plex Sans 400/500/600 and Plex Mono 500 bundled in `app/fonts/` with the OFL 1.1 licence; `tools/pack.js` refuses to build without them. TabVault sends nothing to any server of its own and has no analytics; the only network activity is the browser fetching each tab's favicon from that tab's own site, which 1.0 did too (the whole-branch review's M3 corrected an earlier "no network requests" claim here, in the listing, PRIVACY.md and the README).
- Window cards in a responsive grid (3/2/1 columns), the window hosting TabVault marked CURRENT, window names editable inline, kept in `chrome.storage.local` under `windowNames` and cleared by the worker on `chrome.runtime.onStartup` (the spec said `chrome.storage.session`; Task 2's review found Chrome also wipes session storage on an extension update or reload, while window ids only reset with the browser), and carried into snapshots and exports as the optional `windowName` (schema stays 1; restore re-applies names with a `nameWindow` step).
- Groups: colour dot, 3 px bar, eight-dot picker. Tab rows: favicon or a letter badge coloured from the domain (`lib/ui.js`), domain in mono, flags (pinned, audible, muted, `zz`, `dup`), the active-tab bar.
- Floating bulk bar with a Move-to menu; Esc closes a menu first, then clears. One shortcut table (`lib/shortcuts.js`) drives the key handler, the hint strip and the `?` panel; new keys `j` `k` `x` `g` `d`.
- Rulings made in the plan: an explicit Light/Dark choice is mirrored to `localStorage` and applied by `app/theme-boot.js` before first paint (MV3 forbids inline scripts; "System" needs no script); window names use Plex Mono Medium because only 500 is bundled; Pin and Group read Unpin and Ungroup when every selected tab already is, so 1.0's Unpin and Ungroup survive; the picker offers the spec's eight colours and an existing orange group still renders orange; unnamed windows show the active tab's title; `dup` uses the whole session and the `ignoreHash` setting; the muted flag stays; the page scrolls instead of each card.
- Store screenshots regenerated in the new look (light theme, RGB without alpha, written by `tools/screenshots.js` itself).
- Pre-upload additions (branch `feature/about-and-dup-choice`): the duplicates dialog now closes only the extra copies you tick (a Keep radio per copy as in 1.0, defaulting to the `lib/dedupe.js` pick, which is unchanged; a close checkbox on every other copy, all ticked on each draw including after toggling Ignore #hash; changing Keep moves the kept marker and gives the previously kept copy a ticked checkbox; Select all / Select none; a `Close N selected` button disabled at 0); an About dialog in the ⋯ menu (version from the manifest, repository, issues and privacy links, font credits, nothing fetched) and `homepage_url` in the manifest. e2e scenarios S (About) and T (per-row duplicates) added; G now uses the new button label.
- Result: 36 unit tests, 21 e2e scenarios (I-b PASS or LIMITED as before).

## 2026-11-02 — 1.1.1: store title "TabVault: Open-Source Tab Manager"

- The owner chose the title from the 2026-11-01 competitor survey (word `tabvault rename open-source`): at least 18 store items are named TabVault, and the earlier draft title was 54 characters. The store title is read from the manifest, so `name` changed to the 33-character title and the version moved to 1.1.1; the `description` (store summary) now names the manual unload.
- The memory claim stays out of the title and reads, in the listing, that TabVault unloads only the tabs you select (Discard and lazy restore); there is no automatic unloading. No code changed.

## 2026-11-07 — 1.2.0 "Keeper"

- Request: the owner's word of the night ("expand on TabVault, plan the next version and develop and test it"). The six features are Wakeel's picks from the 2026-11-01 competitor survey (auto-discard, badge, side panel, recently closed, palette, send-to-save) plus the three parked follow-ups. Spec: `docs/superpowers/specs/2026-11-07-tabvault-1-2-keeper-design.md`; plan with its Deviations section: `docs/superpowers/plans/2026-11-07-tabvault-1-2-keeper.md`. Branch `feature/1.2-keeper`, built on Opus, reviewed by Naqid before any merge.
- Unload idle tabs (off by default): a 5-minute alarm, the rule in `lib/discard-rule.js` (threshold 15 min to 4 h, default 1 h; never the active, audible, `autoDiscardable === false` or TabVault tab; pinned spared by default; a group named with a leading 📌 and the host allowlist spared; a tab without `lastAccessed`, Chrome 120, is skipped; at most 25 a run, oldest first). Each run is recorded in `storage.session` and shown under the setting; "Unload idle tabs now" runs it at once. Nothing is closed. The listing's memory line now says so; it had said nothing was unloaded automatically.
- Badge: tab count by default (or unloaded, or off), amber, updated on tab events behind a 2 s gate with one trailing update (deviation 3) and by the 5-minute alarm.
- Recently closed without the `sessions` permission: a memory tab cache in the worker, the latest snapshot of this browser session as the fallback (deviation 4); single closes one entry each, a window close one batch; 200 cap; `chrome://` and TabVault pages skipped; Reopen (current window), Reopen all (new window), Clear, and an off switch in Settings.
- Command palette on `Alt+K` (matched on `KeyK`): every bound shortcut by name plus Snapshot now, Discard idle tabs now, Export, Snapshots, Settings, Save and close all windows, Open side panel; tabs ranked with them. `/` stays Search (deviation 2).
- Save and close: always confirms with the count (focus on Cancel); the worker takes a kept snapshot named "<window> · <time>" (reason `save-close`) and closes only the tabs it saved; if no window would remain, one New Tab keeps the last one open. From the card's ⤓, `Shift+S`, and the palette.
- Side panel: `sidePanel` is the only new permission; the same page with `?panel=1` (`data-layout="panel"`: one column, its own window first, the others collapsed, compact rows, the search pinned, the bulk bar along the bottom, no hint strip). The toolbar click still opens the full page. The spec's "Open in side panel" entry on the toolbar icon's context menu would need `contextMenus`, so it opens from ⋯, the palette and an unbound command `open-side-panel` instead (deviation 1).
- Parked follow-ups closed: snapshot storage version 2 (`snapIndex` plus `snap:<id>`, a one-time migration at worker start, version 2 left alone; `lib/snapstore.js`); the cap-branch fallback (`scheduleDecision` re-arms when the capped alarm is gone); rows and groups of popup (`nodrop`) windows take no drops. `lib/settings.js` is now the one defaults table for the page and the worker.
- Store: version 1.2.0 supersedes the 1.1.1 package (the rename goes out inside it); summary "Every window and tab in one page or the side panel. Search, group, dedupe, unload idle tabs, reopen closed tabs, keep snapshots." (128); listing What's new 1.2, the `sidePanel` and widened `alarms` and `storage` justifications, the Web history disclosure names the recently closed list; PRIVACY.md (effective 2026-11-07) the recently closed list, the idle rule, `sidePanel`. Screenshots: 02-search and 03-selection retired for 02-command-palette and 03-unload-idle-tabs; 01 shows Recently closed, 05 a named save-and-close snapshot.
- Naqid's review (fix first, the same night), each fixed with a test: (1) a failed migration was swallowed and the next start replaced `snapIndex` with the 1.x list, losing the snapshots taken in between; `migrate` now merges (union by id, the keep cap, dropped keys removed), stamps `storageVersion` last, and save and close refuses until the migration has completed. (2) Wakeel's ruling: no promise about unsaved forms (only `autoDiscardable` can be checked; Chrome's own form check does not apply to `chrome.tabs.discard`); the note says "tabs an extension marked as not discardable". (3) The quota retry removes the rotated-out key before it writes again. (4) Alt+K no longer eats Option+K in text fields other than the search box.
- For the owner's hands before upload (no automation covers them): the side panel itself (⋯ → Open in side panel, and the palette entry), the `open-side-panel` command once bound at chrome://extensions/shortcuts, and auto-discard in real Chrome (on at 15 minutes, `zz` on the idle tabs, the "last run" line; the active, playing and pinned tabs untouched).
- Result: 70 unit tests; 27 e2e scenarios (U badge, V recently closed, W palette, X save and close, Y panel layout, Z auto-discard added; I-b and Z PASS or LIMITED: `chrome.tabs.discard` crashes Playwright's Chromium, Z's plan part always runs live).
