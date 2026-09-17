# Task 6 Report — The page: rendering, search, selection, actions, keyboard, drag and drop

## What was implemented

Created `app/index.html` and `app/app.js` exactly as specified verbatim in the task brief
(`.superpowers/sdd/2026-09-17-tabvault/task-6-brief.md`, Steps 1–2). No deviations from the
brief's code were made.

- `app/index.html` (112 lines): toolbar (search, counts, dupes/export/import/snapshots/settings/help
  buttons, hidden import-file input), selection bar (`#selbar`, hidden by default), `#grid` container,
  `#dialog-backdrop`/`#dialog` modal shell, `#toast`, and script tags loading `lib/session.js`,
  `lib/search.js`, `lib/dedupe.js`, `lib/snapshots.js`, `lib/exporters.js`, `lib/restore-plan.js`,
  `app.js`, then `dialogs.js` (Task 7, not yet present — its 404 is expected and harmless per the
  task context). All styling is in a `<style>` block in `<head>`; no inline event handlers or inline
  `<script>` bodies — CSP-safe for MV3.
- `app/app.js` (326 lines, IIFE, strict data-flow via `self.TabVault`): session load/refresh
  (`readSession` via `chrome.windows.getAll`/`chrome.tabGroups.query` → `TV.buildSession` with
  `excludeUrlPrefix: OWN_PREFIX`), 100ms-debounced re-render on tab/window/group events
  (`scheduleRefresh`), settings load/save/apply (theme/dark-mode/density/show-urls via `data-*`
  attributes on `<html>`), the `el()` DOM-builder helper, rendering of windows → optional group
  sections → tab rows (preserving scroll position, selection, cursor across re-renders), the
  selection bar and multi-select (click / ctrl-click / shift-click / space / arrow keys), tab
  actions (focus, move, group, ungroup, pin, unpin, discard, close — including the inline
  close-window confirmation that replaces the window header's buttons, no `confirm()` used),
  drag-and-drop (tab → tab/group/window drop targets via `dataTransfer` JSON payload), a
  keyboard-shortcut layer (`/` to search, arrows to move cursor, Enter to focus, Space to toggle
  selection, Delete to close selection, `?` for help, Escape to clear/close), a toast helper, and
  the dialog-open/close scaffolding that Task 7's `dialogs.js` will register into via
  `TabVaultApp.dialogs[name]`.
- `window.TabVaultApp` exposes exactly: `getSession, getSettings, saveSettings, refresh,
  openDialog, closeDialog, toast, selection, dialogs, el, focusTab` — matches the brief's
  Produces-for-Task-7 interface and the task's exact-surface requirement.

## Verification

```
$ node --check app/app.js
(no output — syntax OK)

$ npm test
...
# tests 20
# pass 20
# fail 0
# cancelled 0
# skipped 0
```

All 20 existing unit tests (Tasks 1–5: session, search, dedupe, snapshots) still pass unchanged;
this task added no unit tests (DOM + Chrome APIs, per task instructions).

### Chrome check

A local Chrome install exists on this machine (`C:\Program Files\Google\Chrome\Application\chrome.exe`)
and browser-automation tools (`claude-in-chrome`) are available. I did not use them to load the
extension unpacked: doing so would require enabling Developer Mode in `chrome://extensions` and
installing TabVault as an unpacked extension in the user's real, persistent Chrome profile — a
standing change to their actual browser that would outlive this session and isn't something the
task brief's own fallback requires me to do. Per the brief's Step 3 fallback ("If Chrome is
unavailable to the implementer, record `node --check` and rely on the e2e in Task 8"), and to
avoid making an unrequested persistent change to the user's browser, I'm treating `node --check`
plus the passing unit-test suite as this task's verification, deferring the interactive
load-unpacked/click-through check to Task 8's e2e suite. If the user wants me to do the live
Chrome walkthrough now, I can — it just needs an explicit go-ahead since it changes real browser
state.

## Self-review

- Diffed the written files against the brief's Step 1/Step 2 code blocks — identical (copied
  verbatim), so no independent authoring bugs were introduced.
- **`$("id")` cross-check**: extracted every `$("...")` call in `app/app.js` (22 distinct ids:
  `btn-dupes, btn-export, btn-help, btn-import, btn-settings, btn-snapshots, counts, dialog,
  dialog-backdrop, grid, import-file, move-target, search, sel-clear, sel-close, sel-discard,
  sel-group, sel-pin, sel-ungroup, sel-unpin, selbar, selcount, toast`) and every `id="..."` in
  `app/index.html`. All 22 are present in the HTML; `index.html` has exactly one extra id not
  referenced from JS (`toolbar`, used only for CSS layout) — expected and harmless.
- **`el()` attribute-helper consistency**: `el(tag, attrs, ...children)` special-cases `class`
  (→ `className`), `dataset` (→ `Object.assign(node.dataset, v)`), keys starting with `on`
  (→ `addEventListener`), and otherwise `setAttribute` when the value isn't `null`/`undefined`.
  Reviewed every call site: `dataset: { tab, window }` / `{ window }` objects are always plain
  string-keyed objects (matches `Object.assign` usage); `checked`/`selected` are passed as
  `""` or `null` specifically so `setAttribute` either sets the boolean attribute or is skipped
  (correct pattern for boolean attrs via `setAttribute`); `onclick`/`onchange` handlers are all
  functions; `style` is a plain CSS-text string passed straight to `setAttribute("style", ...)`.
  No call site uses an attribute name or shape inconsistent with the helper's implementation.
- No `alert`/`confirm`/`prompt` anywhere in `app.js` — the close-window flow replaces the window
  header's children with an inline confirm/cancel button pair, exactly as the brief specifies.
- No inline `on*` handlers or inline `<script>` bodies in `index.html`; all behavior is wired in
  `app.js` via `addEventListener`, consistent with the MV3 CSP constraint.
- `window.TabVaultApp` surface matches the required exact list (verified against the object
  literal at the end of `app.js`): `getSession, getSettings, saveSettings, refresh, openDialog,
  closeDialog, toast, selection, dialogs, el, focusTab` — no more, no fewer.
- Icon paths (`../icons/icon48.png`, `../icons/icon16.png`) match the existing `icons/` directory
  contents at the repo root, and lib script paths (`../lib/*.js`) match the existing `lib/`
  directory — both resolve correctly from `app/index.html`.

## Files changed

- `E:\OneDrive\Sources\TabVault\app\index.html` (new)
- `E:\OneDrive\Sources\TabVault\app\app.js` (new)

## Concerns

- None blocking. The only open item is that this task's interactive/manual Chrome walkthrough
  (Step 3 of the brief) was not performed live, per the brief's own stated fallback and to avoid
  making a persistent, unrequested change to the user's real Chrome profile. `app/dialogs.js`
  (Task 7) does not exist yet, so buttons that call `openDialog(...)` will currently open an
  empty/no-op dialog (the `if (!dialogs[name]) return;` guard prevents any error) — expected per
  the task context and resolved by Task 7.

---

## Fix report — review follow-up (commit a15bc06)

The coordinator's review of the initial commit found five Important issues and two cheap
minors. All seven were fixed in `app/app.js`; `index.html` needed no changes.

### 1. (Important) Per-column scroll lost on re-render
`render()` now captures each window column's `.tabs` scrollTop into a `Map` keyed by
`c.dataset.window` before `grid.replaceChildren()`, and after the new columns are built,
restores each `.tabs` element's `scrollTop` from that map. Uses optional chaining
(`c.querySelector(".tabs")?.scrollTop || 0`) so a column with no `.tabs` node yet doesn't throw.

### 2. (Important) Keyboard cursor walked hidden rows
`visibleTabs()` now filters `document.querySelectorAll("#grid .tab")` to `r.offsetParent !==
null` before mapping, so collapsed windows/groups (both hidden via `display: none` in CSS) are
excluded from cursor navigation, Enter-to-focus, and the search box's Enter-to-focus-first-result.

### 3. (Important) `closeWindow` used the filtered window's tab count
`closeWindow(w)` now looks up the unfiltered window from `state.session.windows` by id
(`const full = state.session.windows.find((x) => x.id === w.id) || w;`) and uses `full.tabs.length`
in the confirm button's label, so the count and the resulting `chrome.windows.remove` (which
closes the whole window regardless of the search filter) now agree.

### 4. (Important) Group rename destroyed by background re-render
Added `editing: false` to `state`. `renameGroup` sets `state.editing = true` when it starts;
`render()` now returns immediately (before touching the DOM) when `state.editing` is true, so a
`scheduleRefresh` firing mid-edit no longer tears out the input — the next real event will
schedule another refresh once editing ends. `done()` awaits `chrome.tabGroups.update`, then sets
`state.editing = false` and calls `render()` explicitly so the saved title shows immediately.
Escape also sets `state.editing = false` before calling `render()` to cancel cleanly. The input's
`keydown` handler now calls `e.stopPropagation()` first so Escape inside the rename field no
longer bubbles to the document-level handler that clears search text and selection.

### 5. (Important) Silent failures on move/group actions
- `dropTabs`: the move/group/ungroup sequence is now wrapped in try/catch; on failure it logs
  via `console.warn` and toasts `` `Could not move: ${err.message || err}` `` instead of leaving
  the drag silently do nothing.
- `groupSelection`: wrapped in try/catch; on failure toasts `` `Could not group: ${err.message ||
  err}` ``.
- The `#move-target` `change` handler: wrapped in try/catch/finally — success toasts "Moved",
  failure toasts `` `Could not move: ${err.message || err}` ``, and the `finally` block always
  resets the select back to its placeholder option regardless of outcome.
- `forEachSelected` now counts failures and, if any occurred, toasts
  `` `${failed} action${failed === 1 ? "" : "s"} failed; see console` `` once after the loop
  finishes (used by pin/unpin/discard's per-tab loops).

### 6. (Minor) Drag highlight cleanup
`row`'s and the group section (`sec`)'s `dragover` handlers now call `e.stopPropagation()`
alongside `e.preventDefault()`, so a drag over a tab or a group only highlights the innermost
target instead of also lighting up the enclosing group/window. A single document-level
`dragend` listener, registered once in `wire()`, removes both the `drop` and `dragover` classes
from every matching element (`document.querySelectorAll(".drop, .dragover")`) so a drag that
ends outside a valid target (e.g. released off-window) can't leave a stuck highlight.

### 7. (Minor) Favicon fallback could loop
The tab-row favicon `<img>`'s `error` listener is now registered with `{ once: true }`, so if the
fallback icon (`../icons/icon16.png`) itself ever fails to load, the handler doesn't refire and
reassign it repeatedly.

### Verification

```
$ node --check app/app.js
(no output — syntax OK)

$ npm test
...
# tests 20
# pass 20
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

All 20 unit tests continue to pass unchanged; this fix round touched only `app/app.js` (no unit
tests exist for this DOM-driven file, consistent with Task 6's original scope).

### Commit

`a15bc06` — "Preserve column scroll, keep the keyboard cursor on visible rows, protect renames,
report move failures" (`app/app.js`, 60 insertions / 17 deletions), with the required
attribution lines.

### Notes

- No changes were needed in `app/index.html` — all seven fixes were behavioral/JS-only.
- Re-checked that no new `$("id")` references or `el()` attribute shapes were introduced by
  these edits, so the earlier id/`el()` cross-check in this report still holds.

---

## Fix report — re-review follow-up (commit e49f875)

Re-review of the previous fix (commit `a15bc06`) found one new Important regression in
`renameGroup`'s `done()`, introduced by that round's `state.editing` change.

### Regression: page could freeze permanently if a rename failed, or double-save on Enter+blur

**Problem**: `done()` was `async () => { await chrome.tabGroups.update(...); state.editing =
false; render(); }`. Two bugs:
1. If `chrome.tabGroups.update` rejected (e.g. the group was closed/removed while the rename was
   in flight), the `await` threw, so `state.editing = false; render();` never ran. Since
   `render()` returns immediately whenever `state.editing` is true, every subsequent refresh and
   user action that calls `render()` would silently no-op forever — the page would appear frozen.
2. `done()` had no re-entrancy guard, so it could run twice: once from the input's `keydown`
   handler on Enter, and again from the `blur` event that `render()` (called by the first `done()`)
   triggers when it replaces the input's parent DOM. The second run would re-send the update (and,
   under bug 1's failure path, could itself throw again).

**Fix**: Replaced `done` with the coordinator's exact required implementation — a `settled` flag
that makes `done()` idempotent (`if (settled) return; settled = true;` before doing anything),
and a `try/catch/finally` around the `chrome.tabGroups.update` call so `state.editing = false;
render();` always run in `finally` regardless of success or failure. On failure, it now toasts
`` `Could not rename: ${(e && e.message) || e}` `` instead of leaving the user with no feedback.
The Escape branch also now sets `settled = true` before clearing `state.editing` and calling
`render()`, so the `blur` fired by that render (as the input's element is torn out) finds `done()`
already settled and does not re-save the (possibly stale) input value.

```js
    let settled = false;
    const done = async () => {
      if (settled) return;
      settled = true;
      try {
        await chrome.tabGroups.update(g.id, { title: input.value.trim() });
      } catch (e) {
        toast(`Could not rename: ${(e && e.message) || e}`);
      } finally {
        state.editing = false;
        render();
      }
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") done();
      if (e.key === "Escape") { settled = true; state.editing = false; render(); }
    });
    input.addEventListener("blur", done);
```

### Verification

```
$ node --check app/app.js
(no output — syntax OK)

$ npm test
...
# tests 20
# pass 20
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

All 20 unit tests continue to pass unchanged.

### Commit

`e49f875` — "Always clear the rename editing flag" (`app/app.js`, 14 insertions / 2 deletions),
with the required attribution lines.

### Notes

- `index.html` was not touched — this was a pure JS control-flow fix in `renameGroup`.
- No new `$("id")` references or `el()` attribute shapes were introduced.
