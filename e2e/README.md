# End-to-end harness

Runs the real extension in Playwright's Chromium against the pages in `test-pages/`.

    npm install
    npx playwright install chromium   # once
    npm run e2e

Notes
- Installed Google Chrome refuses `--load-extension`, so the harness uses Playwright's own Chromium (`chromium.launchPersistentContext`), which honors the unpacked-extension flags normally. This is not `channel: "chrome"`.
- The extension is copied to `e2e/.tmp/ext` before each run. TabVault needs no host permissions, so unlike some extensions the manifest copy needs no changes.
- The app page is opened directly at `chrome-extension://<id>/app/index.html` as a second tab in the harness's own (first) browser window, opened *before* any fixture window (fixture windows default to `focused: true`, which would otherwise steal a later `context.newPage()`'s tab placement); `chrome.windows.getAll` inside that page sees every window in the Playwright context, including that first window.
- Fixture windows, tab groups, and read-back assertions go through a `worker()` helper (`(await worker()).evaluate(...)`) rather than a single captured service-worker handle: `worker()` re-acquires `context.serviceWorkers()[0]` (waiting for the `"serviceworker"` event if none is listed yet) every time it's called, so a respawned or newly-relaunched worker is picked up automatically instead of throwing against a stale handle. It also re-attaches the console/`pageerror` listeners (tracked in a `WeakSet` so each worker instance is only wired up once) so console errors are still captured after a relaunch.
- Scenario K (the change-driven, alarm-based snapshot) waits a real 40 seconds for the 30-second-minimum alarm to fire. It runs last in the script (after L) so a failure in an earlier scenario surfaces quickly; the report still lists results in scenario order A–H, I-a, I-b, J–L.
- Screenshots (`main-page.png`, `snapshots-dialog.png`) and the JSON/markdown report land in `e2e/.tmp/`, which is git-ignored.
- The harness runs headed (`headless: false`) — expect real browser windows to pop up while it runs.

## Statuses: PASS, FAIL, LIMITED, NOT RUN

Every scenario in `ORDER` is seeded as `NOT RUN` before anything runs, so a crash partway through the script still produces a report listing which scenarios never got a chance to run, instead of silently omitting them.

A scenario's final status is one of:
- **PASS** — its assertions ran against real, live browser state and all of them held.
- **FAIL** — an assertion failed, an unexpected error was thrown, or (specifically for I-b, see below) a console error appeared during a part that would otherwise have been marked LIMITED.
- **LIMITED** — used only by scenario I-b: the environment crash described below happened before its assertions could run, so instead of a live result it reports the *same* `chrome.tabs.discard()` call verified in isolation, as supporting evidence. This is not a silent pass — the report table shows `LIMITED` distinctly from `PASS`, and the run summary counts it separately ("N passed, N failed, N environment-limited").
- **NOT RUN** — the harness never reached this scenario (an earlier fatal error, a timeout that killed the process, etc.).

The process exit code is non-zero if and only if at least one scenario is `FAIL` or `NOT RUN`. A `LIMITED` result alone does not fail the run — it is an honest report of an environment limitation, not a defect being swept under the rug.

## Scenario I: real restore verification, split by the `lazyRestore` setting

TabVault's Settings dialog has a "Load restored tabs only when opened (lazy)" checkbox (`settings.lazyRestore`, default on) that controls whether Import/Restore calls `chrome.tabs.discard()` on non-first tabs at all (`lib/restore-plan.js`'s `planRestore(..., { discard })` option; `discard: false` emits no `discardTab` steps). This gives the harness a way to test the *rest* of Import/Restore for real, without ever hitting the crash described below:

- **I-a (lazy loading OFF, must PASS)** — Settings → untick lazy loading → Save. Import the exported file, choose all windows, click **Restore selected windows**. Since no `chrome.tabs.discard()` call is made at all in this mode, the browser doesn't crash, so the outcome is verified for real and live: the restored window exists with the expected tab URLs *in order*, pinned state, the recreated group's title and color, zero discarded tabs, the result dialog's reported counts (and that it does *not* claim "tabs load when you open them", since lazy loading was off), and zero new console errors between the click and the outcome. Any failure here is a real `FAIL` — there is no fallback.
- **I-b (lazy loading back ON, PASS or LIMITED)** — re-enables lazy loading, imports the same file again, clicks Restore, then immediately tries to read `discarded === true` off the non-first tabs of the newly restored window(s) via the worker. If the browser survives long enough to answer, the same live-assertion standard as I-a applies: the read must show `discarded === true` for every non-first tab, or the part is `FAIL` (not `LIMITED` — surviving and then failing is a real failure). If the browser disconnects instead (`!context.browser()?.isConnected()`, or the read throws a "target closed"/"destroyed"/"crashed"/"disconnected"-shaped error) — the outcome actually observed on every run so far more often than not — the part is `LIMITED`, and the isolated discard check (below) is run as supporting evidence before the browser is relaunched so J, K and L can continue. Console errors observed between the click and the outcome force `FAIL` regardless of which of the above would otherwise apply — a console error is a real problem, not an environment artifact.

**What remains unverified when I-b comes back LIMITED**: the isolated check proves `chrome.tabs.discard()` itself works (see below), and I-a proves the rest of the real Restore flow works end to end. What *isn't* verified in that case is `chrome.tabs.discard()` specifically as the tail end of a real, UI-driven, multi-step `restoreSession()` run (after window creation, tab creation, and grouping) — i.e. genuine end-to-end coverage of lazy-loaded restore inside this harness. It is the identical `chrome.tabs.discard(id).catch(() => {})` call in both cases, and `test/restore-plan.test.js` covers the step-planning logic that puts `discardTab` at the right point in the sequence, but nothing here can watch that specific call succeed inside the full flow when the environment crash wins the race.

## Environment limitation: `chrome.tabs.discard()` crashes this Chromium build

Scenario I-b exercises `restoreSession()` in `app/dialogs.js`, which calls `chrome.tabs.discard()` on every non-first tab of a restored window when lazy loading is on (so only the first tab loads immediately). In this specific combination — Playwright's bundled Chromium (`chromium-1243`), launched via `launchPersistentContext` with `--remote-debugging-pipe`, on this machine — calling `chrome.tabs.discard()` on *any* real tab reliably kills the entire browser process tree, not just the debugged tab or its target.

This was isolated with several standalone scripts, each just a handful of lines with no TabVault code involved at all:

- Discarding the active tab of a plain `context.newPage()` page.
- Discarding a background tab created purely via `chrome.tabs.create` (no Playwright `Page` object for it at all).
- Discarding a tab that's a member of a `chrome.tabs.group`.

All three crash identically, so it isn't specific to TabVault's code, to tab grouping, or to Playwright tracking a `Page` for the discarded tab. Checking with `tasklist`/`Get-CimInstance Win32_Process` immediately after confirms every `chrome.exe` process from that launch (main process and every child) is gone within about 1-2 seconds — this is a real OS-level process crash, not a Playwright/CDP session hiccup, an MV3 service-worker idle recycle (idling the same worker for 35s with no discard call causes no problem at all — the old handle keeps working), or a "target closed" false positive.

The crash typically finishes within ~150-250ms of the `discard()` call resolving. That is faster than:
- A sequential poll loop from Node (one worker `.evaluate()` round trip at a time).
- An 80-wide *concurrent* burst of reads fired the instant a click's `page.click()` promise resolves.
- A `MutationObserver` running entirely in-page (same renderer, no Node round trip) that reads `chrome.*` state itself and stores the result for Node to fetch afterward.
- Even a completely isolated `chrome.tabs.discard(id)` immediately followed by a *separate* `chrome.tabs.get(id)` call in the very same script — this failed 5/5 in a row, and failed even when the follow-up call was delayed a full 1.5 real seconds.

The one thing that *is* reliably observable (8/8 in a standalone sweep) is the `Tab` object `chrome.tabs.discard()` itself resolves with — i.e. reading `discarded` off the promise's own return value, with no second `chrome.*` call afterward to lose the race. When scenario I-b's live read loses the race, it falls back to exactly that: `chrome.tabs.discard(id).catch(() => {})` (the same call `restoreSession()` makes) run on a fresh real tab, in isolation, reading the result the one way proven to survive. The browser is relaunched against the same profile directory (so `chrome.storage.local` — settings and snapshots — survives) after both a crashed real Restore click and after the isolated check, so J, K and L still run normally afterward.

This is a Playwright/Chromium environment defect, not a bug in TabVault: real, non-automated Chrome (the actual shipped product) discards tabs constantly (memory saver, natural backgrounding) without incident; it is specifically calling `chrome.tabs.discard()` while this build of Chromium is CDP-debugged that crashes. In practice, across repeated runs while developing this harness, scenario I-b has come back as a genuine live `PASS` about as often as `LIMITED` — the crash is common but not universal, and the harness reports honestly whichever actually happened rather than assuming one or the other.
