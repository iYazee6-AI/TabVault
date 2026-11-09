# TabVault: Open-Source Tab Manager

<!-- TODO: add the Chrome Web Store badge and listing link here once the listing URL is known (not yet pasted by the owner; do not guess it). -->

TabVault is a source-available tab manager for Chrome and Edge (Manifest V3) that puts every window and tab into one page: search across all of them, select and move tabs between windows, group and rename, clean up duplicates, unload the tabs you select (or, when you turn it on, the tabs you have left idle) to free their memory, file idle tabs onto shelves by rules you write, reopen recently closed tabs, search everything you saved, and keep your session safe with automatic snapshots plus JSON and Markdown export/import. It's a from-scratch reimplementation inspired by [Tab Manager v2](https://github.com/xcv58/Tab-Manager-v2), written in plain JavaScript with no build step and no runtime dependencies. Licensed under the [MIT License](LICENSE).

## Features

- Every window as a card in a responsive grid, every tab as a row with its favicon (or a coloured letter), site and flags, native tab groups shown inline; the window TabVault is open in is marked CURRENT
- Name windows inline (the pencil on each card); names last until the browser restarts and are kept in snapshots and exports
- Instant search across tab titles and URLs (`/` to focus)
- Multi-select with checkboxes, click, Ctrl/Cmd-click and Shift-click ranges
- Move selected tabs to another window (or a new one) via drag-and-drop or the "Move to…" menu
- Group, ungroup, rename and recolor tab groups
- Pin, unpin, discard (unload) or close selected tabs in bulk
- Find and close duplicate tabs (optionally ignoring the URL `#hash`)
- Automatic snapshots: taken after your tabs stop changing for a while (debounced), and on browser startup — not on a fixed timer
- Manual "Snapshot now", with the option to keep a snapshot so it's never rotated out
- Export the current session, the selected tabs, a snapshot or a shelf as JSON or Markdown (download or copy to the clipboard); import a JSON, Markdown or text file, or paste links, and restore the windows you pick; links that are not web pages are skipped and counted
- Restored tabs load lazily by default: only the first tab of each window loads immediately, the rest open discarded and load when you click them (configurable in Settings)
- Light and dark themes that follow Chrome, an Appearance override (System/Light/Dark), compact density, and an option to show URLs under titles; IBM Plex fonts bundled
- Unload idle tabs (1.2, off by default): every 5 minutes, tabs not used for 15 minutes to 4 hours are unloaded, at most 25 a run; never the active tab, a tab playing sound, a tab an extension marked as not discardable, pinned tabs (unless you allow it) or a group whose name starts with 📌; Settings shows the last run
- Idle rules (1.3): per site (`news.example.com`, or `*.example.com` for its subdomains), after 15 minutes to a day, unload the tab, shelve it, or never touch it; the first matching rule wins, and tabs no rule matches follow the setting above. Nothing is closed unless a rule you wrote says so: a shelving rule is created off and its switch unlocks only after its dry run (which lists the tabs it would shelve now, and asks again above 50); each tab is written to the shelf and read back before it closes; at most 25 tabs a run, unloads first; never the active tab or an incognito tab; `*.com` and `*.co.uk` are refused
- Shelves (1.3): named lists of saved tabs that are never rotated out, below the windows; Move to shelf from the selection bar or the palette; Open (into its group, recreated if gone), Open and remove, Remove, Open all, Export
- Search everything saved (1.3): the palette also finds tabs in your snapshots, shelves and recently closed list (one row per URL, "+N older"), highlighted; `s:` saved only, `t:` tabs, `a:` actions; Enter opens, Shift+Enter in a new window, "Open all" in one new window
- Compare a snapshot with now (1.3): missing, new since and moved, with Reopen missing and Select all new
- The toolbar icon counts your tabs (or the unloaded ones, or nothing)
- Recently closed tabs, kept locally (the last 200): reopen one in the current window, or a whole closed window at once; Clear and an off switch
- Command palette (`Alt+K`): every action by name and every tab, ranked as you type
- Save and close: a kept, named snapshot of a window, then its tabs close, always after a confirmation with the count
- Side panel: the same page in one column in Chrome's side panel (⋯ → Open in side panel, the palette, or a shortcut you assign)
- Focus mode (1.4): one command from any page (`Alt+Shift+F`, or right-click the toolbar icon → Focus this window) keeps the window you are in sharp and veils every tab of every other window with a blur and a "Click to lift" pill; the same command lifts it (see [Focus mode](#focus-mode))

## Installing (load unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions` (or `edge://extensions` in Edge).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the repository's root folder (the one containing `manifest.json`).
5. Click the TabVault icon in the toolbar, or press **Alt+Shift+T**, to open it.

To load the extension from a distributable zip instead, see [Publishing](#publishing) below and unzip it somewhere first — Chrome and Edge load unpacked extensions from a folder, not a zip file directly.

## How to use

- **Search** — type in the search box at the top, or press `/` to focus it. Matching tabs stay visible; everything else is hidden. Press `Esc` to clear the search (and the selection).
- **Selection** — click a tab's checkbox, or click the row (Ctrl/Cmd-click to toggle one tab, Shift-click to select a range within a window). The floating selection bar at the bottom shows a count and the bulk actions.
- **Move** — drag a tab row onto another window's card (or onto a group, to move it into that group), or select tabs and choose a window from **Move to ▾** in the floating selection bar. "New window" opens the selection in a fresh window.
- **Groups** — select tabs and click **Group** to create a native tab group; click a group's ✎ to rename it, pick one of its eight colour dots to recolor it, and **⊟** to ungroup. Click a group's header to collapse/expand it.
- **Duplicates** — click **Find duplicates** to see tabs that share a URL (optionally ignoring `#hash`), and choose which copy to keep and which extra copies to close, row by row: each copy has a **Keep** radio (the most recently used copy is picked by default and marked "kept"), every other copy has a close checkbox (all ticked by default, with **Select all** / **Select none**), and **Close N selected** closes only the ticked rows.
- **Snapshots** — click **Snapshots** to browse automatic and manual snapshots, restore one (into new windows), export it to a file, keep it so it's never rotated away, or delete it. **Snapshot now** takes one immediately.
- **Recently closed** — below the windows, collapsed by default with the count in its heading. **Reopen** puts one tab back in the window TabVault is in; a closed window is listed as one block with **Reopen all**, which brings its tabs back in a new window. **Clear** forgets the list.
- **Command palette** — press `Alt+K` (or ⋯ → Command palette) and type: actions show their keys, tabs show their window and site, and saved tabs (snapshots, shelves, recently closed) follow under Saved with where they are; `s:`, `t:` or `a:` first narrows it to saved tabs, open tabs or actions; arrows move, `Enter` runs or opens, `Shift+Enter` opens a saved tab in a new window, `Esc` closes.
- **Shelves** — select tabs and choose **Move to shelf ▾** (or write an idle rule that shelves); the Shelves section under Recently closed lists each shelf with its count and the rules that fill it; open a tab again (it stays on the shelf), open and remove it, remove it, open them all, export the shelf, or delete it (asked first with the count).
- **Compare** — **Compare** on a snapshot (or "Compare latest snapshot with now" in the palette) lists what is missing, new and moved since; reopen the missing tabs in a new window or into their windows, or select the new ones.
- **Save and close** — the ⤓ on a window card, `Shift+S` with a row of that window focused, or the palette ("Save and close this window", "Save and close all windows"). TabVault asks first ("Save 23 tabs and close them?"), keeps a named snapshot, then closes the tabs; if that would close the last window, one New Tab keeps it open.
- **Side panel** — ⋯ → **Open in side panel** (or the palette, or the "Open TabVault in the side panel" shortcut you set at `chrome://extensions/shortcuts`). The panel shows its own window first and the others collapsed; the toolbar icon still opens the full page.
- **Export** — ⋯ → **Export**: choose what (this session, the selected tabs, a snapshot, a shelf) and the format (JSON with every detail, or Markdown: `## Window`, `### Group`, `- [title](url)`), then **Download** or **Copy to clipboard**.
- **Import** — ⋯ → **Import**: choose a file (a JSON export, or a `.md` or `.txt` list of links; up to 50 MB) or paste links (`## Name` starts a window, `### Name` a group, no headings means one window); the preview counts windows, tabs, groups and the links skipped because they are not web pages; choose which windows to restore and click **Restore selected windows** (above 100 tabs it asks again). Each window reopens with the same tabs, groups and pinned state; with the **Settings** → "Load restored tabs only when opened (lazy)" option on (the default), only the first tab in each window loads right away and the rest load the next time you click them.

## Focus mode

Two windows open and you want to work in one: press `Alt+Shift+F` in it (change the keys at `chrome://extensions/shortcuts`), right-click the TabVault toolbar icon and choose **Focus this window**, or use ⋯ → **Focus this window** (or the palette) on the TabVault page for the window that page is in.

- Every tab of every other window gets a veil: the page blurred and dimmed, with a pill at the top, "TabVault focus is on this other window. Click to lift.", which lifts the focus everywhere. Tabs opened, loaded or moved into another window while the focus is on get the veil too; a tab moved into the focused window loses it.
- The same command in the focused window lifts the focus; in another window it moves the focus there. The toolbar icon shows a dot while the focus is on, and the TabVault page shows a bar with **Lift the focus**. The state is kept in `chrome.storage.session`, so it survives the service worker sleeping and ends when the browser closes.
- Drawing on pages needs a permission TabVault does not otherwise ask for: the first time, the TabVault page explains why ("Focus mode draws a veil over your other windows, which needs permission to touch those pages; TabVault still reads nothing from them") and Chrome asks you. Say no, or choose **Minimise the other windows instead**, and Focus mode minimises the other windows instead of veiling them (and lifting puts them back); the shortcut remembers that choice, and ⋯ → Focus this window asks again.
- Pages Chrome does not let an extension draw on (`chrome://` pages, the New Tab page, the Chrome Web Store, the PDF viewer, other extensions' pages) are skipped and counted: the TabVault page shows "N tabs could not be veiled". An unloaded tab is veiled when it loads.
- The veil reads nothing from the page and stores nothing about it; it is a shadow-DOM overlay drawn on top, removed when the focus is lifted.

## Settings

Available from **Settings** in the **⋯** menu (which also holds Export, Import, Help and **About**: the version, the repository, the issue tracker and the privacy policy): the snapshot debounce (how many seconds of no tab changes before an automatic snapshot is taken) and how many snapshots to keep; whether duplicate-finding ignores the URL `#hash`; Appearance (System/Light/Dark) and density (comfortable/compact); whether URLs are shown under titles; and **"Load restored tabs only when opened (lazy)"**, which controls whether Import/Restore loads only the first tab of each restored window immediately (the rest open discarded, loading on click) or loads every restored tab right away. It's on by default. Since 1.2 also: **Icon badge** (tab count, unloaded tabs, or off), **Remember recently closed tabs** (on by default), and **Unload idle tabs** (off by default: the idle time, whether pinned tabs are spared, the "last run" line). Since 1.3 the **Idle tabs** block also holds the **rules** (first match wins: + Add rule, the inline editor with Dry run, the On switch, ↑ ↓, Delete) and **Run idle rules now**; the 1.2 site list became `never` rules on the first start of 1.3.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `/` | Search |
| `j` `↓` / `k` `↑` | Next / previous tab |
| `←` `→` | Previous / next window |
| `Enter` | Go to the focused tab |
| `x` or `Space` | Select / unselect the focused tab |
| `g` | Group the selected tabs (Ungroup when all are grouped) |
| `d` | Find duplicates |
| `Delete` | Close selected tabs |
| `Shift+S` | Save and close the focused tab's window (asks first) |
| `Alt+K` | Command palette |
| `Ctrl`/`Cmd`+click | Toggle a tab's selection |
| `Shift`+click | Select a range of tabs |
| `Esc` | Close a menu; otherwise clear search and selection |
| `?` | All shortcuts |
| `Alt+Shift+T` | Open TabVault (browser-level shortcut, configurable at `chrome://extensions/shortcuts`) |
| `Alt+Shift+F` | Focus this window: veil every other window; again to lift (browser-level, configurable there too) |

The list lives in one place, `lib/shortcuts.js`; the page's key handler, the hint strip and the `?` panel all read it.

## Files

| Path | Purpose |
|---|---|
| `manifest.json` | Extension manifest (Manifest V3) |
| `background.js` | Service worker: opens the app page, takes snapshots, the badge, the idle-tab alarm, recently closed, save and close, handles messages from the page |
| `app/index.html` | The full-page UI (and, with `?panel=1`, the side panel layout) |
| `app/app.js` | Rendering, selection, drag-and-drop, keyboard handling |
| `app/dialogs.js` | Duplicates, export, import/restore, snapshots, compare, move to shelf, settings (with the idle rules), help and about dialogs |
| `app/theme-boot.js` | Applies an explicit Light/Dark choice before first paint |
| `app/fonts/` | IBM Plex Sans (400/500/600) and Plex Mono (500), OFL 1.1 (`LICENSE.txt`) |
| `lib/ui.js` | Header counter text, tab domain, favicon fallback colour, duplicate flags |
| `lib/shortcuts.js` | The keyboard shortcut table |
| `lib/session.js` | Builds a normalized session snapshot from `chrome.windows`/`chrome.tabGroups` |
| `lib/search.js` | Tab search/filtering |
| `lib/dedupe.js` | Duplicate-tab detection |
| `lib/snapshots.js` | Snapshot creation, comparison and rotation; the change-debounce decision |
| `lib/snapstore.js` | Snapshot storage (an index plus one key per snapshot) and the migration from 1.x |
| `lib/settings.js` | The settings defaults, shared by the page and the worker |
| `lib/badge.js` | The toolbar badge text |
| `lib/discard-rule.js` | Which idle tabs a run unloads or shelves (`planIdle`, first match wins), the dry run, the pattern check and its two-level suffix list |
| `lib/shelves.js` | Shelf storage (an index plus chunks of 200), shelf items, and the save-then-close executor |
| `lib/diff.js` | Compare a snapshot with now |
| `lib/saved-index.js` | The in-memory index of saved tabs the palette searches |
| `lib/recent.js` | The recently closed list |
| `lib/palette.js` | Command palette entries and ranking |
| `lib/save-close.js` | Which tabs save and close closes, and the window kept open |
| `lib/focus.js` | Focus mode: which tabs get the veil, the toggle, the minimise fallback, the page's line |
| `app/focus-veil.js` | The veil Focus mode injects into the tabs of the other windows (a blur and the lift pill) |
| `lib/exporters.js` | JSON and Markdown export, import parsing and the scheme filter |
| `lib/restore-plan.js` | Turns a session into an ordered list of `chrome.*` restore steps |
| `icons/` | Toolbar and store icons |
| `tools/pack.js` | Builds a distributable zip (see [Publishing](#publishing)) |
| `tools/make-icons.js` | Regenerates `icons/` |
| `test/` | Unit tests for `lib/` (`npm test`) |
| `test-pages/` | Minimal static pages used only by the e2e harness |
| `e2e/` | Playwright-based end-to-end harness (see [Testing](#testing)) |

## How data is stored

Everything lives in `chrome.storage.local` (the `unlimitedStorage` permission removes the usual ~10 MB cap, since sessions with many tabs and snapshots can grow):

- **`settings`** — theme, density, whether URLs are shown, the snapshot debounce (seconds) and how many snapshots to keep, whether duplicate-finding ignores `#hash`, whether restored tabs load lazily, the badge mode, whether closed tabs are remembered, `autoDiscard` (on/off, minutes, keep pinned; the 1.2 host list is kept one release for a downgrade) and `idleRules` (pattern, idle minutes, action, shelf, on, the dry-run key). A few hundred bytes.
- **`snapIndex`** and **`snap:<id>`** (storage version 2, since 1.2) — the index lists every snapshot's metadata newest first; each snapshot's full window/tab/group session lives under its own key, so a new snapshot no longer rewrites the whole history. Automatic snapshots beyond the configured "keep" count are rotated out oldest-first; snapshots you've explicitly kept (and save-and-close snapshots) are never rotated out. Typical size is a few KB per snapshot for a normal session. A 1.x store (one `snapshots` array) is moved over once when the 1.2 worker first starts.
- **`recentlyClosed`** — the last 200 closed tabs (title, URL, favicon, window, group name, time, and the shelf when one was saved there first), newest first; a window close shares one batch id.
- **`shelfIndex`** and **`shelf:<id>:<n>`** (1.3) — each shelf's name and chunk count; its items (title, URL, favicon, group title and colour, time, rule) in chunks of 200, the newest last. The item count is derived from the chunks.
- **`windowNames`** — the names you give windows, keyed by window id. The worker clears it when the browser starts, because window ids change with every browser session; the names also travel inside snapshots and exports.

A few things live elsewhere: the page keeps a copy of your Appearance choice in its own `localStorage` so the right theme paints first, and `chrome.storage.session` (cleared when the browser closes) holds the snapshot debounce timer, when the browser session started, and the idle-tab rule's last run (`autoDiscard.lastRun`). There is no server, account or sync involved (see [Privacy](#privacy)).

## Limitations

- **Incognito** — TabVault can only see and restore incognito windows if it's explicitly allowed to run in incognito (`chrome://extensions` → TabVault → **Allow in Incognito**). Without that, incognito windows are skipped on export/import.
- **Restored tabs** — with lazy loading on (the default; **Settings** → "Load restored tabs only when opened (lazy)"), restored tabs load when opened: only the first tab in each restored window loads immediately, and the rest are created discarded and load the next time you click them, to avoid restoring dozens of tabs' worth of network traffic and memory at once. Turning the option off loads every restored tab immediately instead.
- **Chrome and Edge only** — TabVault uses `chrome.tabGroups` and other Chromium-only APIs; it does not run on Firefox or Safari.
- **No history search** — TabVault only shows tabs that are currently open (and the ones it saw close). It does not search browser history or bookmarks.
- **Idle time needs Chrome 121+** — the idle rule reads each tab's `lastAccessed`, which Chrome added in 121; on Chrome 120 (the minimum) a tab without it is skipped, never guessed.
- **Focus mode cannot veil every page** — Chrome does not let an extension draw on its own pages, the Web Store, the PDF viewer or other extensions' pages; those tabs are counted, not veiled. Incognito windows are veiled only when TabVault is allowed in incognito.

## Testing

```
npm install
npm test          # unit tests for lib/ (node's built-in test runner)
npm run e2e        # end-to-end tests against a real, unpacked build of the extension
```

`npm run e2e` needs Playwright's own bundled Chromium (`npx playwright install chromium` once) — the machine's installed Chrome refuses to honor `--load-extension`. See `e2e/README.md` for how the harness is put together and a documented environment limitation around `chrome.tabs.discard()` under that Chromium build.

### Manual checks before release

A few things the automated tests can't (fully) cover, worth checking by hand in real Chrome before shipping:

- `Alt+Shift+T` actually opens TabVault — it may collide with Chrome's own focus-the-toolbar shortcut on Windows, so confirm at `chrome://extensions/shortcuts` and rebind if needed.
- Restore with `file://` tabs in the exported/imported session (these need "Allow access to file URLs" in `chrome://extensions` to reopen correctly).
- The 1.3 real-install checks: Copy to clipboard from the Export dialog (no `clipboardWrite`), a shelving rule at 15 minutes on a test site (dry run, unlock, shelved with the group and closed, the active tab kept), and opening a shelved item whose group is gone (recreated with its title and colour).
- Unload idle tabs in real Chrome (turn it on at 15 minutes, wait, and confirm `zz` on the idle tabs and the "last run" line), and the side panel itself (⋯ → Open in side panel): Playwright can neither run `chrome.tabs.discard()` (below) nor drive the panel.
- Focus mode in real Chrome (1.4): `Alt+Shift+F` is free and bound at `chrome://extensions/shortcuts`; right-click the toolbar icon → Focus this window; Chrome's permission prompt appears after Allow, and declining it falls back to minimising; a PDF tab and a `chrome://` tab in another window are counted, not veiled.
- Lazy restore (Settings → "Load restored tabs only when opened (lazy)") in real, non-automated Chrome, since `npm run e2e`'s `chrome.tabs.discard()` coverage is limited by a Playwright/Chromium environment defect (see `e2e/README.md`).

## Privacy

Chrome shows a permission warning for this extension because of the `tabs` permission: it means TabVault can read the URL, title and favicon of every tab in every window, and open, close, move or modify them — which is exactly what a tab manager needs to do. Focus mode (1.4) adds an optional permission to touch your pages, asked for only when you first turn Focus mode on and used only to draw the veil on top of them; nothing is read from any page. TabVault sends nothing to any server of its own, does not include any analytics or telemetry, and does not send tab data anywhere (the only network activity is the browser fetching each tab's favicon from that tab's own site, which 1.0 did too): everything it reads and writes stays in `chrome.storage.local` on your machine (see [How data is stored](#how-data-is-stored)). Export and import are manual, local file operations you initiate.

## License

TabVault is free for personal and non-commercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE); commercial use needs the author's written permission. Versions up to 1.3.0 were released under the MIT licence and stay MIT for those who have them.

The bundled IBM Plex Sans and Plex Mono fonts (`app/fonts/`) keep their own licence, the SIL Open Font License 1.1 (`app/fonts/LICENSE.txt`).

## Publishing

```
npm run pack
```

Writes `dist/tabvault-<version>.zip`, containing exactly the runtime files needed to load the extension (`manifest.json`, `background.js`, `app/`, `lib/`, `icons/` — no docs, tests or tooling), built by a small dependency-free zip writer in `tools/pack.js`.
