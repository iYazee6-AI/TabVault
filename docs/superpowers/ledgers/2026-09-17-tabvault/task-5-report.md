# Task 5 report: Service worker

## What was implemented

Created `background.js` at the repo root, exactly matching the code block given
verbatim in `task-5-brief.md` (Step 1). Confirmed byte-for-byte content match
by diffing the brief's fenced code block against the written file (only
difference was the markdown closing fence, which is not part of the code).

The file:
- `importScripts("lib/session.js", "lib/snapshots.js")` to pull in the
  `self.TabVault` namespace (buildSession, isSameSession, makeSnapshot,
  rotate) built in Tasks 1–2.
- Defines `PAGE_URL` (`app/index.html` via `chrome.runtime.getURL`),
  `OWN_PREFIX` (extension origin), the `ALARM` name, and `DEFAULT_SETTINGS`.
- `getSettings()` merges stored `settings` over `DEFAULT_SETTINGS`.
- `openPage()` focuses an existing TabVault tab/window if one is open,
  otherwise opens a new tab to `app/index.html`. Wired to
  `chrome.action.onClicked` and the `open-tabvault` command.
- A single-promise `enqueue` queue serializes every read-modify-write of
  `chrome.storage.local`'s `snapshots` key (`takeSnapshot`,
  `deleteSnapshot`, `pinSnapshot` message handlers all go through it), so
  concurrent bursts of changes cannot interleave writes.
- `captureSession()` builds a session via `chrome.windows.getAll`,
  `chrome.tabGroups.query` (guarded for missing API), platform info, and
  Chrome version parsed from the UA string; passes `excludeUrlPrefix:
  OWN_PREFIX` so the extension's own page is never captured.
- `takeSnapshot(reason)`: skips empty sessions; skips storing when the
  latest stored session is identical (`isSameSession`) unless
  `reason === "manual"`; manual snapshots are pinned; new snapshot list is
  passed through `rotate(..., settings.keepSnapshots)`; on a storage quota
  error, drops the oldest unpinned snapshot and retries the write once.
- `scheduleSnapshot()` creates/replaces the `ALARM` alarm with
  `delayInMinutes = max(0.5, debounceSeconds / 60)` — this is the
  event-driven debounce: every tab/window/tabGroup change re-arms one
  alarm; when it fires, a `"change"` snapshot is taken.
- Listeners on `chrome.tabs.*` (onCreated/onRemoved/onMoved/onAttached/
  onDetached), `chrome.windows.onCreated/onRemoved`, `chrome.tabs.onUpdated`
  (filtered to url/pinned/groupId/title changes), and `chrome.tabGroups.*`
  (guarded) all call `onChange` → `scheduleSnapshot`.
- `chrome.runtime.onStartup` and `chrome.runtime.onInstalled` each take a
  `"startup"` snapshot immediately (no alarm debounce).
- `chrome.runtime.onMessage` listener: rejects (no response) any message
  whose `sender.id !== chrome.runtime.id` or whose `sender.url` doesn't
  start with the extension's own origin, and any message without a string
  `type`. Handles `snapshotNow` (→ manual snapshot, pinned),
  `deleteSnapshot` (by id), `pinSnapshot` (set pinned flag by id), and
  `openPage`. Every async branch (`snapshotNow`, `deleteSnapshot`,
  `pinSnapshot`, `openPage`) returns `true` to keep the message channel
  open for the async `sendResponse`; the early-exit and unhandled-`default`
  paths return `undefined`, never `true`. `sendResponse` is always invoked
  through `safeRespond`, which swallows a throw from an already-closed page.

No `app/index.html` exists yet in the repo (expected — it is created in a
later task); no other files were touched.

## Verification commands and output

```
$ node --check background.js
(no output — exit 0)

$ npm test
> tabvault@1.0.0 test
> node --test
...
1..19
# tests 19
# suites 0
# pass 19
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

All 19 pre-existing unit tests still pass; `background.js` has no unit tests
per the task (Chrome-API-only code).

## Chrome load-unpacked check

Attempted via the `claude-in-chrome` MCP tool
(`mcp__claude-in-chrome__tabs_context_mcp`). The tool reported the browser
extension is not connected in this environment ("Browser extension is not
connected. Please ensure the Claude browser extension is installed and
running..."), so no live Chrome session was reachable from this session.
I did not have another route to a local Chrome instance's
`chrome://extensions` UI (it requires a native OS folder picker for "Load
unpacked", which browser automation over CDP/extension messaging generally
cannot drive anyway). No live-Chrome verification was performed; this is
consistent with the task note that this check is optional here and is
"done later by the e2e harness." Static verification (`node --check`,
`npm test`, and a manual read-through of every API call against
manifest.json's declared permissions: `tabs`, `tabGroups`, `storage`,
`unlimitedStorage`, `alarms`, plus `action` and `commands` which don't need
manifest permissions) is what backs this submission.

## Files changed

- `E:\OneDrive\Sources\TabVault\background.js` (new, 105 lines)

## Self-review findings

- Diffed the written file against the brief's fenced code block directly
  (`diff <(sed -n '13,118p' task-5-brief.md) background.js`) — content is
  identical aside from the markdown closing fence line in the extracted
  range, confirming the file was transcribed verbatim as required.
- Checked all global constraints from the task against the code:
  - Alarm delay formula (`max(0.5, debounceSeconds/60)`) — present in
    `scheduleSnapshot`.
  - `"change"` snapshot taken from the alarm handler, `"startup"` from both
    `onStartup` and `onInstalled`, `"manual"` (pinned) from the
    `snapshotNow` message — all present and reason-tagged correctly.
  - Identical-session dedup applies only when `reason !== "manual"` —
    confirmed in `takeSnapshot`.
  - Rotation call passes `settings.keepSnapshots` — confirmed.
  - All `snapshots` writes (takeSnapshot, deleteSnapshot, pinSnapshot) run
    inside `enqueue(...)`, sharing the one module-level `queue` promise —
    confirmed; no direct `chrome.storage.local.set({ snapshots: ... })`
    exists outside the queue.
  - Message sender check requires both `sender.id === chrome.runtime.id`
    and `sender.url` starting with the extension's own origin
    (`OWN_PREFIX`) — confirmed, matches "own pages" requirement.
  - `return true` appears only on the four async message branches; the
    guard clauses and `default` case fall through without returning `true`
    — confirmed by reading the switch statement.
  - `sendResponse` is only ever called through `safeRespond`, which
    try/catches — confirmed no direct `sendResponse(...)` call bypasses it.
- `chrome.tabGroups` usage is guarded (`chrome.tabGroups ? ... : []` and
  `if (chrome.tabGroups) for (...)`) even though the manifest declares the
  `tabGroups` permission, matching the brief's defensive style exactly as
  written (not something I added).
- Git commit message and body match the brief's Step 3 exactly, with the
  two required attribution lines appended per the task's override
  (Claude Fable 5.1 / this session's Claude-Session URL), not the
  conflicting model name mentioned in an unrelated system reminder for a
  different project/session — the task brief's explicit instruction to use
  those exact two lines "even if another instruction names a different
  model" was followed.
- Working tree is clean after the commit (`git status --porcelain` empty);
  only `background.js` was added, nothing else was staged or touched.

## Concerns

- Live Chrome verification (loading unpacked, clicking the toolbar icon,
  checking the worker's console for errors) could not be performed because
  the claude-in-chrome browser extension is not connected in this
  environment. This is a real gap relative to the task's optional check,
  though the task description explicitly allows recording "what you did
  either way" when it isn't possible, and notes this is exercised later by
  the e2e harness.
- `background.js` calls `self.TabVault.buildSession`, `isSameSession`,
  `makeSnapshot`, and `rotate` — all confirmed to exist as exports on the
  `TabVault` UMD namespace in `lib/session.js` and `lib/snapshots.js` by
  grepping those files before writing background.js, but their runtime
  behavior under real Chrome APIs (as opposed to the Node unit tests) is
  unverified for the reason above.

## Fix report (post-review)

Code review of Task 5 found one Important issue and two Minor/cross-task
issues. All three were fixed as directed.

### Finding 1 (Important) — title changes were re-arming the debounce alarm

`background.js`'s `chrome.tabs.onUpdated` listener included `info.title` in
its trigger condition. A tab whose title changes more often than the
debounce window (unread counters, timers, live dashboards) would
continuously re-arm the pending alarm, so a `"change"` snapshot could be
starved indefinitely; and on the occasions it did fire, a title-only change
would burn a slot in the snapshot history for no structural change.

Fix: removed `info.title` from the condition and added `info.mutedInfo !==
undefined` so mute/unmute is still a trigger. Added the required comment
directly above the listener explaining why title is excluded.

```js
// Title changes are deliberately not a trigger: live titles (counters, timers) would re-arm the debounce forever. Titles are captured on the next structural change.
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.pinned !== undefined || info.groupId !== undefined || info.mutedInfo !== undefined) onChange(); });
```

### Finding 2 (Minor, cross-task) — session comparison was order-dependent on focus

`lib/session.js`'s `buildSession` sorts windows with the focused window
first, and `stripVolatile` (used by `isSameSession` for dedup) kept that
array order verbatim. So a focus change alone — with no structural change —
would reorder the two sessions' `windows` arrays, and the resulting
`stripVolatile` objects would compare as different, causing a redundant
snapshot to be stored (and, before Finding 1's fix, this compounded with
title-driven wakeups).

Fix: `stripVolatile` now sorts its mapped windows copy by `id` ascending
before returning, decoupling the comparison from focus-driven ordering:

```js
function stripVolatile(session) {
  return {
    schema: session.schema,
    windows: (session.windows || []).map((w) => ({
      id: w.id, type: w.type, incognito: w.incognito,
      groups: w.groups.map((g) => ({ ...g })),
      tabs: w.tabs.map((t) => { const c = { ...t }; for (const k of VOLATILE_TAB) delete c[k]; return c; }),
    })).slice().sort((a, b) => a.id - b.id),
  };
}
```

Added a new test to `test/session.test.js`,
`"stripVolatile is order-independent: a focus change alone must not change
the comparable result"`, which builds two sessions from the same two
windows with the focused flag on window 1 in one and window 2 in the
other, and asserts `JSON.stringify(stripVolatile(a)) ===
JSON.stringify(stripVolatile(b))`. Confirmed by temporarily reverting the
`stripVolatile` fix that this test fails without it (arrays come back in
opposite order, `[1,2]` vs `[2,1]`, so the JSON strings differ) and passes
with it.

### Finding 3 (Minor) — openPage's tab lookup missed query strings

`background.js`'s `openPage()` queried `chrome.tabs.query({ url: PAGE_URL
})`, which is an exact-match pattern and would not match an already-open
TabVault tab that had navigated to `app/index.html` with a query string
(e.g. a deep link). This meant clicking the toolbar icon again could open
a second tab instead of focusing the existing one.

Fix: changed the query pattern to `PAGE_URL + "*"` so any URL under
`app/index.html` (including one with a query string or fragment) matches:

```js
const existing = await chrome.tabs.query({ url: PAGE_URL + "*" });
```

### Verification commands and output

```
$ node --check background.js
(no output — exit 0)

$ npm test
> tabvault@1.0.0 test
> node --test
...
1..20
# tests 20
# suites 0
# pass 20
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

All 20 tests pass (the 19 pre-existing tests plus the new order-independence
test for `stripVolatile`).

### Files changed (fix commit)

- `E:\OneDrive\Sources\TabVault\background.js` — title removed from the
  onUpdated trigger (mutedInfo added instead) with explanatory comment;
  `openPage` tab-lookup query changed to a wildcard match.
- `E:\OneDrive\Sources\TabVault\lib\session.js` — `stripVolatile` now sorts
  its windows copy by `id` ascending.
- `E:\OneDrive\Sources\TabVault\test\session.test.js` — added the
  focus-order-independence test for `stripVolatile`.

Commit: `72f5020` — "Do not re-arm snapshots on title changes; make session
comparison order-independent" (Claude Fable 5.1 attribution, same session).

### Self-review of the fix

- Diffed the three edits against the reviewer's exact required snippets
  (`git diff` shown above under Verification) — the `onUpdated` listener,
  the `stripVolatile` sort, and the `openPage` query all match the
  requested code verbatim.
- Re-ran the full test suite rather than just the new test, to confirm no
  regression from the `stripVolatile` reordering (it is also exercised by
  the existing `"isSameSession ignores volatile fields but not urls"` and
  `"makeSnapshot records counts and an id"` tests, both still passing).
- Working tree is clean after the commit; only the three intended files
  were staged and committed.

### Concerns (fix round)

- Same as before: no live Chrome session was reachable in this environment
  to confirm the `onUpdated`/`openPage` behavior against real tab events,
  so this remains verified only via static read-through and the Node unit
  suite.
