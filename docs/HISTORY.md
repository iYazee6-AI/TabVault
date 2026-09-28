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
