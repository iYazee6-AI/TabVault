# TabVault

TabVault is a Manifest V3 Chrome extension that puts every window and tab into one page: search across all of them, select and move tabs between windows, group and rename, clean up duplicates, and keep your session safe with automatic snapshots plus manual JSON export/import. It's a from-scratch reimplementation inspired by [Tab Manager v2](https://github.com/xcv58/Tab-Manager-v2), written in plain JavaScript with no build step and no runtime dependencies. Licensed under the [MIT License](LICENSE).

## Features

- Every window as a column, every tab as a row, with native tab groups shown inline
- Instant search across tab titles and URLs (`/` to focus)
- Multi-select with checkboxes, click, Ctrl/Cmd-click and Shift-click ranges
- Move selected tabs to another window (or a new one) via drag-and-drop or the "Move to…" menu
- Group, ungroup, rename and recolor tab groups
- Pin, unpin, discard (unload) or close selected tabs in bulk
- Find and close duplicate tabs (optionally ignoring the URL `#hash`)
- Automatic snapshots: taken after your tabs stop changing for a while (debounced), and on browser startup — not on a fixed timer
- Manual "Snapshot now", with the option to keep a snapshot so it's never rotated out
- Export the current session, or any snapshot, to a JSON file; import and restore selected windows from a file
- Restored tabs load lazily by default: only the first tab of each window loads immediately, the rest open discarded and load when you click them (configurable in Settings)
- Light/dark/system theme, compact density, and an option to show URLs under titles

## Installing (load unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions` (or `edge://extensions` in Edge).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the repository's root folder (the one containing `manifest.json`).
5. Click the TabVault icon in the toolbar, or press **Alt+Shift+T**, to open it.

To load the extension from a distributable zip instead, see [Publishing](#publishing) below and unzip it somewhere first — Chrome and Edge load unpacked extensions from a folder, not a zip file directly.

## How to use

- **Search** — type in the search box at the top, or press `/` to focus it. Matching tabs stay visible; everything else is hidden. Press `Esc` to clear the search (and the selection).
- **Selection** — click a tab's checkbox, or click the row (Ctrl/Cmd-click to toggle one tab, Shift-click to select a range within a window). The selection bar at the top shows a count and the bulk actions.
- **Move** — drag a tab row onto another window's column (or onto a group, to move it into that group), or select tabs and choose a window from the "Move to…" menu in the selection bar. "New window" opens the selection in a fresh window.
- **Groups** — select tabs and click **Group** to create a native tab group; click a group's ✎ to rename it, use the color dropdown to recolor it, and **⊟** to ungroup. Click a group's header to collapse/expand it.
- **Duplicates** — click **Find duplicates** to see tabs that share a URL (optionally ignoring `#hash`), pick which copy of each to keep, and close the rest with one click.
- **Snapshots** — click **Snapshots** to browse automatic and manual snapshots, restore one (into new windows), export it to a file, keep it so it's never rotated away, or delete it. **Snapshot now** takes one immediately.
- **Export** — click **Export** to download the current session (all windows, tabs, groups, pinned state and positions) as a JSON file.
- **Import** — click **Import**, pick a previously exported (or snapshot-exported) JSON file, choose which of its windows to restore, and click **Restore selected windows**. Each window reopens with the same tabs, groups and pinned state; with the **Settings** → "Load restored tabs only when opened (lazy)" option on (the default), only the first tab in each window loads right away and the rest load the next time you click them.

## Settings

Available from the **Settings** button: the snapshot debounce (how many seconds of no tab changes before an automatic snapshot is taken) and how many snapshots to keep; whether duplicate-finding ignores the URL `#hash`; theme (system/light/dark) and density (comfortable/compact); whether URLs are shown under titles; and **"Load restored tabs only when opened (lazy)"**, which controls whether Import/Restore loads only the first tab of each restored window immediately (the rest open discarded, loading on click) or loads every restored tab right away. It's on by default.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `/` | Search |
| `↑` `↓` | Move between tabs |
| `←` `→` | Move between windows |
| `Enter` | Go to the highlighted tab |
| `Space` | Select / unselect the highlighted tab |
| `Delete` | Close selected tabs |
| `Ctrl`/`Cmd`+click | Toggle a tab's selection |
| `Shift`+click | Select a range of tabs |
| `Esc` | Clear search and selection |
| `?` | Show this help |
| `Alt+Shift+T` | Open TabVault (browser-level shortcut, configurable at `chrome://extensions/shortcuts`) |

## Files

| Path | Purpose |
|---|---|
| `manifest.json` | Extension manifest (Manifest V3) |
| `background.js` | Service worker: opens the app page, takes snapshots, handles messages from the page |
| `app/index.html` | The full-page UI |
| `app/app.js` | Rendering, selection, drag-and-drop, keyboard handling |
| `app/dialogs.js` | Duplicates, export, import/restore, snapshots, settings and help dialogs |
| `lib/session.js` | Builds a normalized session snapshot from `chrome.windows`/`chrome.tabGroups` |
| `lib/search.js` | Tab search/filtering |
| `lib/dedupe.js` | Duplicate-tab detection |
| `lib/snapshots.js` | Snapshot creation, comparison and rotation |
| `lib/exporters.js` | Export-to-JSON and import-file parsing |
| `lib/restore-plan.js` | Turns a session into an ordered list of `chrome.*` restore steps |
| `icons/` | Toolbar and store icons |
| `tools/pack.js` | Builds a distributable zip (see [Publishing](#publishing)) |
| `tools/make-icons.js` | Regenerates `icons/` |
| `test/` | Unit tests for `lib/` (`npm test`) |
| `test-pages/` | Minimal static pages used only by the e2e harness |
| `e2e/` | Playwright-based end-to-end harness (see [Testing](#testing)) |

## How data is stored

Everything lives in `chrome.storage.local` (the `unlimitedStorage` permission removes the usual ~10 MB cap, since sessions with many tabs and snapshots can grow):

- **`settings`** — theme, density, whether URLs are shown, the snapshot debounce (seconds) and how many snapshots to keep, whether duplicate-finding ignores `#hash`, and whether restored tabs load lazily. A few hundred bytes.
- **`snapshots`** — an array of past sessions, newest first, each with its own full window/tab/group snapshot. Automatic snapshots beyond the configured "keep" count are rotated out oldest-first; snapshots you've explicitly kept are never rotated out. Typical size is a few KB per snapshot for a normal session, so tens to low hundreds of KB for a full history.

Nothing is written outside of `chrome.storage.local`; there is no server, account or sync involved (see [Privacy](#privacy)).

## Limitations

- **Incognito** — TabVault can only see and restore incognito windows if it's explicitly allowed to run in incognito (`chrome://extensions` → TabVault → **Allow in Incognito**). Without that, incognito windows are skipped on export/import.
- **Restored tabs** — with lazy loading on (the default; **Settings** → "Load restored tabs only when opened (lazy)"), restored tabs load when opened: only the first tab in each restored window loads immediately, and the rest are created discarded and load the next time you click them, to avoid restoring dozens of tabs' worth of network traffic and memory at once. Turning the option off loads every restored tab immediately instead.
- **Chrome and Edge only** — TabVault uses `chrome.tabGroups` and other Chromium-only APIs; it does not run on Firefox or Safari.
- **No history search** — TabVault only shows tabs that are currently open. It does not search browser history or bookmarks.

## Testing

```
npm install
npm test          # unit tests for lib/ (node's built-in test runner)
npm run e2e        # end-to-end tests against a real, unpacked build of the extension
```

`npm run e2e` needs Playwright's own bundled Chromium (`npx playwright install chromium` once) — the machine's installed Chrome refuses to honor `--load-extension`. See `e2e/README.md` for how the harness is put together and a documented environment limitation around `chrome.tabs.discard()` under that Chromium build.

## Privacy

Chrome shows a permission warning for this extension because of the `tabs` permission: it means TabVault can read the URL, title and favicon of every tab in every window, and open, close, move or modify them — which is exactly what a tab manager needs to do. TabVault does not make network requests of its own, does not include any analytics or telemetry, and does not send tab data anywhere: everything it reads and writes stays in `chrome.storage.local` on your machine (see [How data is stored](#how-data-is-stored)). Export and import are manual, local file operations you initiate.

## Publishing

```
npm run pack
```

Writes `dist/tabvault-<version>.zip`, containing exactly the runtime files needed to load the extension (`manifest.json`, `background.js`, `app/`, `lib/`, `icons/` — no docs, tests or tooling), built by a small dependency-free zip writer in `tools/pack.js`.
