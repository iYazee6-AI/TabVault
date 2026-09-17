# TabVault 1.0 — final review fix wave

Branch: `feature/tabvault-1.0`. All work done directly in
`E:\OneDrive\Sources\TabVault`, one commit per group, `npm test` run before
each commit, `npm run e2e` run once at the end (after commit 4, before
commit 5).

## Commit 1 — restore robustness

**Commit:** `d149f5f` — "Restore robustness: finite bounds, window-create retry, discard summary"

### Item 1 — `fitBounds` requires `Number.isFinite`

- `lib/restore-plan.js:8` — added a guard rejecting non-finite
  `left`/`top`/`width`/`height` before the existing zero/oversized checks,
  returning `null`.
- Test added: `test/restore-plan.test.js:52` —
  `"fitBounds requires finite left/top/width/height: non-finite values produce null bounds"`,
  using `bounds: { left: "abc", top: 0, width: 800, height: 600 }` with
  `state: "normal"` and asserting `steps[0].bounds === null`.

### Item 2 — `windows.create` retry without `url`

- `app/dialogs.js:72-95` (the `createWindow` case in `restoreSession`) — on
  the first `chrome.windows.create(opts)` rejection, the original error
  message is captured, then a `retryOpts` copy with `url` deleted (bounds/
  state/incognito/focused untouched) is retried once:
  - Retry succeeds: `ids.set(step.ref, w.id)` (`app/dialogs.js:89`);
    `firstTabRef` is deliberately **not** mapped; one error line
    `` `tab ${step.firstTabRef}: ${message}` `` is pushed
    (`app/dialogs.js:90`); `result.windows++` and `onProgress(...)` run
    (`app/dialogs.js:91-92`); the switch `break`s so the remaining
    `createTab`/`updateTab`/`groupTabs` steps for that window still run
    (their existing `ids.get(...) === undefined` guards skip anything keyed
    to the unmapped `firstTabRef`).
  - Retry also fails: `failedWindows.add(step.ref)` and one error line
    `` `window ${step.ref}: ${message}` `` (`app/dialogs.js:83-86`), same as
    before.
- No new unit test was added for this path — `lib/restore-plan.js` (the
  pure module under `test/`) is unchanged by item 2; the retry lives in
  `app/dialogs.js`, which calls the real `chrome.*` APIs and has no fake
  chrome harness in `test/`. Covered instead by e2e scenario I-a/I-b (real
  `chrome.windows.create` succeeding, so the retry path itself is
  untested against a live browser in this run — no code path exists in the
  harness to force a `windows.create` rejection).

### Item 3 — `discardTab` failures counted, one summary line

- `app/dialogs.js:65` — `let discardFailures = 0;` declared before the
  step loop.
- `app/dialogs.js:126` — `discardTab` case now does
  `chrome.tabs.discard(ids.get(step.ref)).catch(() => { discardFailures++; })`
  instead of swallowing silently.
- `app/dialogs.js:134` — after the loop,
  `if (discardFailures) result.errors.push(\`${discardFailures} tab(s) could not be unloaded\`);`
  adds exactly one summary line regardless of how many tabs failed to
  unload.

**Tests:** `npm test` → 22/22 pass (21 baseline + 1 new).
`node --check lib/restore-plan.js app/dialogs.js` → both OK.

## Commit 2 — page stability

**Commit:** `072fca4` — "Page stability: re-render-safe close confirm, pending refresh, error toasts"

### Item 4 — close-window confirmation survives re-renders

- `app/app.js:17-18` — added `confirmClose: null` and `renderPending: false`
  to `state`.
- `app/app.js:153-166` (`windowColumn`) — when `state.confirmClose === w.id`,
  the header renders confirm/cancel buttons instead of the normal header
  buttons, using `full.tabs.length` from `state.session.windows.find(...)`
  (unfiltered tab count, not the filtered/search view). Confirm calls
  `chrome.windows.remove(w.id)` and clears `state.confirmClose` (no
  explicit `render()` — the subsequent `chrome.windows.onRemoved` event
  drives `scheduleRefresh()` → `refresh()` → `render()`). Cancel clears
  `state.confirmClose` and calls `render()` directly. The old DOM-replacing
  `closeWindow()` function was removed.
- `app/app.js:347` — the document `Escape` handler now also clears
  `state.confirmClose = null`.

### Item 5 — `renderSelbar` rebuilds `#move-target` only on change

- `app/app.js:215` — module-scope `let lastMoveTargetKey = null;`.
- `app/app.js:220-223` — computes
  `state.session.windows.map((w) => \`${w.id}:${w.tabs.length}\`).join("|")`,
  returns early (skipping the `replaceChildren` rebuild) when it equals the
  stored key, otherwise updates the stored key and rebuilds.

### Item 6 — `render()` defers instead of clobbering an open `<select>`

- `app/app.js:188-194` — added a check: if `document.activeElement` is a
  `<select>` whose `closest("#grid")` or `closest("#selbar")` matches, set
  `state.renderPending = true` and return before touching the grid;
  otherwise `state.renderPending = false` and render proceeds as before.
- `app/app.js:397-400` (in `wire()`) — delegated listeners added once, on
  both `#grid` and `#selbar`: `change` (bubbling) and `blur` (registered
  with `capture: true`, since `blur` does not bubble), each calling
  `render()` only `if (state.renderPending)`.

### Item 7 — fire-and-forget `chrome.*` calls toast on failure

Added `.catch((e) => toast(...))` to:
- Row close button — `app/app.js:86` (`chrome.tabs.remove(t.id)`).
- Group collapse — `app/app.js:108` (`chrome.tabGroups.update(..., { collapsed })`).
- Group color select — `app/app.js:112` (`chrome.tabGroups.update(..., { color })`).
- Group ungroup button — `app/app.js:113` (`chrome.tabs.ungroup(...)`).
- Delete-key close — `app/app.js:356` (`chrome.tabs.remove(selection())`).
- Selection-bar Ungroup button — `app/app.js:374` (`chrome.tabs.ungroup(selection())`).
- Selection-bar bulk Close button — `app/app.js:378` (`chrome.tabs.remove(selection())`).

`sel-pin`/`sel-unpin`/`sel-discard` were left untouched — they already go
through `forEachSelected`, which has its own failure counting/toast.

### Item 8 — move targets/drops respect window type and incognito

- `app/app.js:152, 178-182` (`windowColumn`) — windows with `type !== "normal"`
  get class `nodrop` and skip registering `dragover`/`dragleave`/`drop`
  listeners on the column entirely.
- `app/app.js:224` (`renderSelbar`) — `#move-target` options are built from
  `state.session.windows.filter((w) => w.type === "normal")`.
- `app/app.js:249-264` (`moveTabs`) — added `windowForTab(id)` helper
  (`app/app.js:249-251`) that looks up a tab's window in `state.session`.
  `moveTabs` now:
  - Collects the `incognito` flag of every selected tab's source window
    into a `Set`; if it has more than one member, toasts
    `"Cannot move incognito and normal tabs together"` and returns `false`
    without calling any `chrome.*` API.
  - When creating a new window (`windowId === "new"`), passes
    `incognito: sourceIncognito` to `chrome.windows.create`.
  - When moving to an existing window, looks it up in `state.session` and,
    if its `incognito` differs from the source, toasts
    `"Cannot move tabs between incognito and normal windows"` and returns
    `false`.
  - Returns `true` on an actual move.
- `moveTabs` now returns a boolean so its two callers don't show a
  contradictory "Moved" toast after a refusal: `dropTabs`
  (`app/app.js:270-271`) returns early (no grouping, no "Moved" toast) when
  `moveTabs` returns `false`; the `#move-target` `change` handler
  (`app/app.js:365-368`) only toasts `"Moved"` when it returns `true`. This
  wasn't spelled out as a separate line item, but was necessary to make the
  new refusal toasts from item 8 actually visible instead of being
  immediately overwritten — no other behavior was changed.

### Item 9 — 50 MB import size cap

- `app/app.js:385-391` (`#import-file` `change` handler) — if
  `f.size > 50 * 1024 * 1024`, toasts
  `"File is too large to import (limit 50 MB)"` and returns before calling
  `f.text()`.

**Tests:** `npm test` → 22/22 pass (unchanged from commit 1; no new unit
tests apply to `app/app.js`, which has no fake-chrome harness in `test/`).
`node --check app/app.js` → OK.

## Commit 3 — worker

**Commit:** `767ea91` — "Worker: cap the change-snapshot debounce, add storage versioning and favicon trimming"

### Item 10 — max-wait cap for change snapshots

- `background.js:69-82` (`scheduleSnapshot`) — reads
  `{ pendingSince } = await chrome.storage.session.get("pendingSince")`:
  - If absent, stores `Date.now()` as `pendingSince`.
  - If present and `Date.now() - pendingSince > Math.max(10 * debounceSeconds * 1000, 300000)`,
    returns without re-creating the alarm, letting the already-pending one
    fire.
  - Otherwise (or after storing), creates/re-creates the alarm as before.
- `background.js:93-98` (`chrome.alarms.onAlarm` listener) — now clears
  `chrome.storage.session` `pendingSince` (`.remove("pendingSince")`) before
  calling `takeSnapshot("change")`, so the next change after a snapshot
  starts a fresh debounce window.
- No dedicated unit test: `background.js` is the service-worker entry
  point and isn't required by `test/` (no fake-`chrome.storage.session`
  harness exists there); covered indirectly by e2e scenario K, which
  exercises the alarm-driven snapshot end to end in a real browser
  (`K: snapshot count N -> N+1 after ... waiting 40s`).

### Item 11 — `storageVersion` and favicon trimming

- `background.js:99-103` (`chrome.runtime.onInstalled`) — reads
  `storageVersion` from `chrome.storage.local`; if `undefined`, sets it to
  `1`.
- `lib/session.js:13-18` — added `trimFavicon(url)`: for a `data:` URL
  longer than 2048 characters, returns `""`; otherwise returns the URL
  (or `""` for a falsy input). `mapTab` (`lib/session.js:26`) now calls
  `favIconUrl: trimFavicon(t.favIconUrl)` instead of `t.favIconUrl || ""`.
- Test added: `test/session.test.js:52` —
  `"buildSession trims oversized data: favicons but keeps short ones and non-data urls"`,
  covering a 2071-char `data:` URL (trimmed to `""`), a short `data:` URL
  (kept), and a normal `https://` favicon URL (kept, regardless of length).

**Tests:** `npm test` → 23/23 pass (22 + 1 new).
`node --check background.js lib/session.js` → both OK.

## Commit 4 — docs

**Commit:** `9206166` — "Docs: reconcile spec and README with the implementation"

### Item 12 — spec updates

`docs/superpowers/specs/2026-09-17-tabvault-design.md`:
- Line 121: `"5 to 600"` → `"30 to 600"` (matches the code's actual
  `min="30"` in the settings dialog and `DEFAULT_SETTINGS`/manifest).
- Permissions block: `"permissions"` array now lists `"alarms"`
  (matching `manifest.json`, which already declared it); the "No `alarms`"
  sentence replaced with
  `` `alarms` is used only to debounce change snapshots. ``
- Architecture tree: removed the `lib/chrome-api.js` line — that module
  was never built; nothing in `lib/`, `app/`, or `background.js` imports
  or requires it.
- Added five bullets to "Deviations recorded during implementation"
  (lines 246-263): title changes are deliberately not a snapshot trigger;
  the `lazyRestore` setting and what it controls; the max-wait debounce
  cap via `chrome.storage.session`'s `pendingSince`; `storageVersion` plus
  favicon trimming; the `windows.create` retry without `url` on restore.

### Item 13 — README updates

- `README.md:39` — Import bullet now says
  `"pick a previously exported (or snapshot-exported) JSON file (up to 50 MB)"`.
  The `lazyRestore` setting was already documented in both "How to use"
  and "Settings" (not missing), so nothing further was added there.
- `README.md:109-114` — new `### Manual checks before release` section
  under Testing, listing: `Alt+Shift+T` on Windows (possible collision
  with Chrome's focus-toolbar shortcut), restore with `file://` tabs, and
  lazy restore in real (non-Playwright) Chrome.
- `e2e/README.md:14` — `"A–L"` → `"A–H, I-a, I-b, J–L"`.

**Tests:** `npm test` → 23/23 pass (docs-only commit, no code touched).

## Commit 5 — none (per instructions); final e2e run recorded below

## Commands run

- `npm test` before each of commits 1-4: 21 → 22 → 22 → 23 → 23 passing,
  0 failing each time (see per-commit sections above for the count change).
- `node --check` on every changed browser-loaded `.js` file
  (`lib/restore-plan.js`, `app/dialogs.js`, `app/app.js`, `background.js`,
  `lib/session.js`): all OK.
- `npm run e2e`, run in the foreground (no backgrounding), full 13-scenario
  Playwright harness:
  - **First run:** 12 passed, 1 failed (`J`, `page.waitForSelector:
    Timeout 30000ms exceeded ... waiting for locator('#dialog h2')`).
    `J` runs immediately after scenario I-b's real Restore click, which
    (as documented in `e2e/README.md`) crashes/relaunches the browser
    more often than not; this run's log shows
    `"Browser disconnected after scenario I-b; relaunching."` right before
    `J` started, and `J` is the very next scenario to touch the page
    (`#btn-snapshots` click) after that relaunch — a timing race between
    the relaunch's fresh page finishing its `loadSettings().then(refresh)
    .then(wire)` chain and the harness's first click on it, not a defect
    introduced by any item in this fix wave (no item in commits 1-4
    touches `openDialog`/`closeDialog`, `#btn-snapshots`'s listener, or
    the harness's relaunch logic).
  - **Second run (repeated to confirm the above before accepting it as
    environment flakiness rather than a regression):** all 13 scenarios
    passed clean, including I-b as a live `PASS` (not `LIMITED`) both
    times.
  - **Final recorded result (used as the official summary):**
    `13 scenarios, 13 passed, 0 failed, 0 environment-limited.` A: PASS,
    B: PASS, C: PASS, D: PASS, E: PASS, F: PASS, G: PASS, H: PASS,
    I-a: PASS, I-b: PASS, J: PASS, K: PASS, L: PASS. Zero new console
    errors (worker and app both empty). Full evidence:
    `E:\OneDrive\Sources\TabVault\e2e\.tmp\report.md`.

## Concerns / notes for the record

- The `J` failure on the first e2e run is judged to be pre-existing
  environment flakiness tied to the documented I-b browser
  crash/relaunch race (see `e2e/README.md`'s "Environment limitation"
  section), not a regression from this fix wave — reproduced clean on an
  immediate re-run with identical code, and no item in commits 1-4 touches
  any code on the path between the relaunch and scenario J's first click.
- Item 2's retry-without-`url` path in `app/dialogs.js` has no automated
  coverage (no fake-`chrome.windows.create`-rejection harness exists in
  `test/` or `e2e/`); it was verified by reading and `node --check` only.
- Item 8's `moveTabs` boolean return (and the two callers checking it
  before toasting "Moved") is a small addition beyond the literal item
  text, made to avoid an immediately-overwritten toast when a move is
  refused; flagged here per the "no behavior beyond the items above" rule
  for visibility even though it doesn't change any other behavior.
