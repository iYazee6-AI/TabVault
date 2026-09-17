# TabVault design

Date: 2026-09-17

TabVault is a Chrome extension (Manifest V3) that shows every window, tab
group, and tab in one page, lets the user search, move, group, and close
them, and keeps the whole session safe: automatic local snapshots taken
whenever the session changes, lossless JSON export, and restore from any
export or snapshot. Modeled on Tab Manager v2 (MIT, React/MobX) but built in
the same style as SiteQR and FormKeeper: plain HTML and vanilla JavaScript,
no build step, no runtime dependencies, MIT license.

## Goals

- One page that shows all windows, groups, and tabs, always current.
- Find any tab by title or URL and jump to it.
- Move tabs between windows and groups, in bulk or by drag and drop; close
  in bulk; find and close duplicates.
- Manage native tab groups: create, rename, recolor, collapse, ungroup.
- Never lose a session: snapshots on every change, export to a file,
  restore from a file or a snapshot, with lazy-loaded tabs.
- Everything stays on the device.

## Non-goals (this version)

- Markdown, HTML-bookmark, or CSV export (JSON only; the exporter module is
  designed to add them).
- Browser history search.
- Cloud sync or sharing.
- Firefox or Safari support (Chromium APIs only; Edge works unchanged).
- Automatic file backups to disk (snapshots live in extension storage; the
  user exports when they want a file).

## User-facing behaviour

### Opening

Clicking the toolbar icon opens the TabVault page in its own tab, or
focuses it if one is already open. Keyboard shortcut `Alt+Shift+T` does the
same (declared in `commands`, user-changeable).

### The page

- **Windows** are columns in a horizontally scrolling grid, in the browser's
  window order, the focused window first. A column header shows the active
  tab's title, the tab count, an incognito badge, and buttons: Focus,
  Collapse, Close window.
- **Groups** appear inside a window as a colored section with the group
  title, a collapse toggle, and a menu: Rename, Recolor, Ungroup.
- **Tabs** are rows: favicon (or a generic icon), title, badges for pinned,
  audible, muted, discarded; the URL shows on hover and in search results.
  Clicking a tab focuses it and its window. A close button appears on hover.
- **Selection:** checkbox on each row; Ctrl-click toggles; Shift-click
  selects a range within a window; "Select all in window" in the header.
  The toolbar shows the count and the bulk actions.
- **Bulk actions:** Move to window (dropdown of windows plus "New window"),
  Close, Group (into a new group or an existing one in the same window),
  Ungroup, Pin/Unpin, Discard.
- **Drag and drop:** drag a tab row (or the current selection) onto another
  window column, into a group section, or between rows to reorder.
- **Search:** a box in the toolbar, focused by `/`. Filters tabs live by
  substring match on title and URL (case-insensitive); windows with no
  matches collapse; the match count is shown; Enter focuses the first
  match; Escape clears.
- **Duplicates:** "Find duplicates" lists groups of tabs with the same
  normalized URL (hash ignored by default, toggle to include it), keeping
  the most recently accessed tab in each group marked "keep"; the user can
  change which to keep, then "Close N duplicates".
- **Keyboard:** Up/Down move the cursor, Left/Right move between windows,
  Enter focuses the tab, Space toggles selection, Delete closes the
  selection, `/` searches, `?` shows the shortcut list, Escape clears
  selection and search.
- **Live updates:** the page re-renders on `chrome.tabs`, `chrome.windows`,
  and `chrome.tabGroups` events, debounced 100 ms, preserving selection,
  scroll position, and search.

### Snapshots

- The service worker listens to tab, window, and group events. Any change
  starts a 30-second debounce; when it fires, the worker captures the
  session and stores a snapshot with `reason: "change"`. A snapshot is also
  taken on browser startup (`reason: "startup"`) and when the user clicks
  "Snapshot now" (`reason: "manual"`).
- A snapshot is skipped if its session is identical to the most recent
  stored snapshot (compared after removing volatile fields: `lastAccessed`,
  `active`, `focused`, `discarded`, `audible`).
- The last 20 snapshots are kept (setting: 5 to 200). Older ones are
  deleted oldest-first. Manual snapshots are never auto-deleted.
- The Snapshots panel lists them newest-first with time, reason, window and
  tab counts, and actions: Restore, Export, Delete, and "Keep" (marks a
  snapshot as manual so it is not rotated out).

### Export

"Export" downloads the current session as
`tabvault-YYYY-MM-DD-HHMM.json` through an anchor download (no downloads
permission). Any snapshot exports the same way with its own timestamp.

### Import and restore

"Import" opens a file picker. The file is validated (schema version, shape).
A dialog lists the windows it contains with a checkbox each, tab and group
counts, and an incognito marker. Restore of the chosen windows:

1. Create the window with its first non-pinned tab (or first tab), using the
   saved state and bounds when they fit the current screen.
2. Add the remaining tabs with `active: false`, then `chrome.tabs.discard`
   each so they load only when clicked.
3. Apply `pinned` and `mutedInfo` after creation.
4. Recreate groups: `chrome.tabs.group` with the tab ids, then
   `chrome.tabGroups.update` with title, color, collapsed.
5. Incognito windows are restored only when the extension is allowed in
   incognito (`chrome.extension.isAllowedIncognitoAccess`); otherwise they
   are listed as skipped with the reason.

Progress is shown per window; errors are per tab and do not stop the
restore. The result dialog reports windows and tabs restored and skipped.

### Settings

Debounce seconds (default 30, 5 to 600), snapshots to keep (default 20),
ignore hash in duplicate detection (default on), theme (system, light,
dark), show URLs under titles (default off), tab row density.

## Architecture

```
manifest.json
background.js          service worker: toolbar click / command opens the page,
                       change listeners + debounce, startup snapshot, storage
                       writes for snapshots
app/index.html         the page
app/app.js             state, rendering, event wiring, drag and drop, keyboard
app/dialogs.js         import, duplicates, snapshots, settings, shortcut help
lib/session.js         buildSession(windows, groups, tabs) -> Session (pure)
lib/exporters.js       toJsonFile(session) -> { filename, text }
lib/restore-plan.js    planRestore(session, options) -> ordered steps (pure)
lib/search.js          filter(session, query) (pure)
lib/dedupe.js          findDuplicates(session, { ignoreHash }) (pure)
lib/snapshots.js       shouldSkip(prev, next), rotate(list, keep) (pure)
lib/chrome-api.js      thin promise wrappers around chrome.* used by page and worker
test/                  node --test with a fake chrome API
test-pages/            simple pages the e2e opens as tabs
e2e/                   Playwright harness, npm run e2e
```

Pure modules use the same UMD wrapper as FormKeeper (attach to a `TabVault`
global in the browser, `module.exports` in Node). The page loads them with
plain `<script>` tags; the worker with `importScripts`.

### Permissions

```
"permissions": ["tabs", "tabGroups", "storage", "unlimitedStorage"]
```

No host permissions. `tabs` shows the "read your browsing history" warning
at install; it is required to read titles and URLs. No `alarms` (snapshots
are event-driven). No `downloads` (anchor download).

### Data model

**Session (schema 1):**

```js
{
  schema: 1,
  capturedAt: 1758100000000,
  browser: { name: "Chrome", version: "151.0" },
  windows: [{
    id: 12, type: "normal", state: "normal", focused: true, incognito: false,
    bounds: { left: 0, top: 0, width: 1440, height: 900 },
    groups: [{ id: 3, title: "Work", color: "blue", collapsed: false }],
    tabs: [{
      id: 101, index: 0, title: "…", url: "https://…", favIconUrl: "…",
      pinned: false, muted: false, audible: false, active: true,
      discarded: false, groupId: 3, lastAccessed: 1758099990000, openerTabId: null
    }]
  }]
}
```

**Export file:** `{ ...session, exportedAt, app: { name: "TabVault", version } }`.

**Storage (`chrome.storage.local`):**

```js
{
  settings: { debounceSeconds: 30, keepSnapshots: 20, ignoreHash: true,
              theme: "system", showUrls: false, density: "comfortable" },
  snapshots: [{ id, takenAt, reason: "change"|"startup"|"manual", pinned: false,
                windows: n, tabs: n, session }]
}
```

Snapshots are stored under one key for simplicity; writes go through a
single promise queue in the worker.

### Restore planner

`planRestore(session, { selectedWindowIds, allowIncognito, screen })`
returns steps such as `createWindow`, `createTab`, `discardTab`, `updateTab`,
`groupTabs`, `updateGroup`, `skipWindow`, with the saved ids mapped to
placeholders the executor replaces with real ids as they are created. The
planner is pure and fully unit-tested; the executor in `app/app.js` walks
the steps and reports progress.

## Error handling

- API calls that fail on one tab (closed meanwhile, restricted URL) are
  logged in the result dialog and do not abort the operation.
- Import rejects files with a different `schema` or missing `windows`,
  showing the reason.
- Storage quota errors on snapshot write drop the oldest non-pinned
  snapshot and retry once.
- The page shows an empty state when the browser has no other windows.

## Testing

- Unit (`node --test`, fake chrome API): `buildSession` from API shapes,
  export filename and content, `planRestore` order and id mapping including
  groups and incognito skips, search matching, duplicate grouping with and
  without hash, snapshot skip and rotation with pinned snapshots.
- e2e (Playwright, extension loaded in Chromium): create two windows with
  several tabs and a group from the harness; open the page; assert
  rendering; search; move a tab between windows through the UI; close
  selected tabs; export and check the file; import it into a fresh profile
  and assert windows and discarded tabs; trigger changes and confirm a
  snapshot appears after the debounce (set to 2 s in the harness via
  settings).

## Security and privacy

- Titles and URLs of all tabs are read; they are stored only in local
  extension storage as snapshots and written to files only when the user
  exports.
- No network requests, no host permissions, no telemetry.
- Restore creates tabs discarded, so restored pages do not load or run until
  the user opens them.
