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
