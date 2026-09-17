# End-to-end harness

Runs the real extension in Playwright's Chromium against the pages in `test-pages/`.

    npm install
    npx playwright install chromium   # once
    npm run e2e

Notes
- Installed Google Chrome refuses `--load-extension`, so the harness uses Playwright's own Chromium (`chromium.launchPersistentContext`), which honors the unpacked-extension flags normally. This is not `channel: "chrome"`.
- The extension is copied to `e2e/.tmp/ext` before each run. TabVault needs no host permissions, so unlike some extensions the manifest copy needs no changes.
- The app page is opened directly at `chrome-extension://<id>/app/index.html` as a second tab in the harness's own (first) browser window, opened *before* any fixture window (fixture windows default to `focused: true`, which would otherwise steal a later `context.newPage()`'s tab placement); `chrome.windows.getAll` inside that page sees every window in the Playwright context, including that first window.
- Fixture windows, tab groups, and read-back assertions are done through `sw.evaluate(...)` against the extension's service worker (`chrome.windows.create`, `chrome.tabs.group`, `chrome.tabGroups.update`, `chrome.tabs.query`, ...).
- Scenario K (the change-driven, alarm-based snapshot) waits a real 40 seconds for the 30-second-minimum alarm to fire. It runs last in the script (after L) so a failure in an earlier scenario surfaces quickly; the report still lists results in scenario order A–L.
- Screenshots (`main-page.png`, `snapshots-dialog.png`) and the JSON/markdown report land in `e2e/.tmp/`, which is git-ignored.
- The harness runs headed (`headless: false`) — expect real browser windows to pop up while it runs.

## Environment limitation: `chrome.tabs.discard()` crashes this Chromium build

Scenario I (Import/Restore) exercises `restoreSession()` in `app/dialogs.js`, which calls `chrome.tabs.discard()` on every non-first tab of each restored window (so only the first tab loads immediately). In this specific combination — Playwright's bundled Chromium (`chromium-1243`), launched via `launchPersistentContext` with `--remote-debugging-pipe`, on this machine — calling `chrome.tabs.discard()` on *any* real tab reliably kills the entire browser process tree, not just the debugged tab or its target.

This was isolated with several standalone scripts, each just a handful of lines with no TabVault code involved at all:

- Discarding the active tab of a plain `context.newPage()` page.
- Discarding a background tab created purely via `chrome.tabs.create` (no Playwright `Page` object for it at all).
- Discarding a tab that's a member of a `chrome.tabs.group`.

All three crash identically, so it isn't specific to TabVault's code, to tab grouping, or to Playwright tracking a `Page` for the discarded tab. Checking with `tasklist`/`Get-CimInstance Win32_Process` immediately after confirms every `chrome.exe` process from that launch (main process and every child) is gone within about 1-2 seconds — this is a real OS-level process crash, not a Playwright/CDP session hiccup, an MV3 service-worker idle recycle (idling the same worker for 35s with no discard call causes no problem at all — the old handle keeps working), or a "target closed" false positive.

The crash typically finishes within ~150-250ms of the `discard()` call resolving. That is faster than:
- A sequential poll loop from Node (one `sw.evaluate()` round trip at a time).
- An 80-wide *concurrent* burst of reads fired the instant a click's `page.click()` promise resolves.
- A `MutationObserver` running entirely in-page (same renderer, no Node round trip) that reads `chrome.*` state itself and stores the result for Node to fetch afterward.
- Even a completely isolated `chrome.tabs.discard(id)` immediately followed by a *separate* `chrome.tabs.get(id)` call in the very same script — this failed 5/5 in a row, and failed even when the follow-up call was delayed a full 1.5 real seconds.

The one thing that *is* reliably observable (8/8 in a standalone sweep) is the `Tab` object `chrome.tabs.discard()` itself resolves with — i.e. reading `discarded` off the promise's own return value, with no second `chrome.*` call afterward to lose the race. Scenario I uses exactly that: it drives the real Import UI (file picked via `#import-file`, the "choose windows to restore" screen, clicking "Restore selected windows") up to the click, then — since the outcome of that click can't be observed live — separately verifies `chrome.tabs.discard()`'s exact behavior (`chrome.tabs.discard(id).catch(() => {})`, the same call `restoreSession()` makes) in isolation on a fresh real tab, reading it back the one way proven to survive. `main()` relaunches the browser against the same profile directory (so `chrome.storage.local` — settings and snapshots — survives) both after the real Import click and after the isolated check, so scenarios J, K and L still run normally afterward.

The full step-by-step plan generation for a window shaped like the one in scenario I (a non-first tab in a group) — `createWindow`, `createTab`, `groupTabs`, `updateGroup`, `discardTab` in order — is covered independently by the already-passing unit test `test/restore-plan.test.js`, which does not touch a real browser at all.

This is a Playwright/Chromium environment defect, not a bug in TabVault: real, non-automated Chrome (the actual shipped product) discards tabs constantly (memory saver, natural backgrounding) without incident; it is specifically calling `chrome.tabs.discard()` while this build of Chromium is CDP-debugged that crashes.
