# TabVault Privacy Policy

Effective date: 2026-11-08

TabVault is a browser extension that shows every window and tab you have open
in one page, and keeps local snapshots of your session so you can get it back.
This policy explains what the extension stores, where, and what it never does.

## What TabVault stores

TabVault stores, on your device only:

- **Your session** — for every open window: its type, position and size,
  whether it is incognito, and for every tab in it the title, URL, favicon
  address, position, pinned state, muted state, and which tab group it belongs
  to. For every tab group: its name, colour, and whether it is collapsed.
- **Snapshots** — past copies of exactly that session data, taken
  automatically after your tabs stop changing for a while, on browser startup,
  and whenever you click **Snapshot now**. Each snapshot records the time it
  was taken and why.
- **Recently closed tabs** — the title, URL, favicon address, window and
  group name of each tab you close while TabVault is installed (and, for a
  tab saved to a shelf before it closed, that shelf's name), kept only in
  your browser's local extension storage, at most the last 200, cleared with
  the **Clear** button, and not recorded at all when you turn off **Remember
  recently closed tabs** in Settings.
- **Shelves** — for each shelf you create: its name, and for every tab you
  or one of your idle rules saved to it, the tab's title, URL, favicon
  address, the name and colour of its tab group, the time it was saved and
  which rule saved it. Kept only in your browser's local extension storage
  until you remove the tab or delete the shelf; never rotated out.
- **Your settings** — appearance (theme), density, whether URLs are shown under titles, the
  snapshot debounce in seconds, how many snapshots to keep, whether duplicate
  finding ignores the URL `#hash`, whether restored tabs load lazily, what the
  icon badge counts, the idle-tab setting (on or off, the idle time, whether
  pinned tabs are spared) and your idle rules (for each: the site pattern you
  typed, the idle time, the action — unload, shelve to a named shelf, or
  never — whether it is on, and whether its dry run was shown).
- **Window names** — any names you type for your windows. They are kept until
  the browser next starts and are also saved inside snapshots and exports.

Tab titles and URLs can contain personal information, because they are
whatever the pages you have open happen to be.

## What TabVault does not store

- TabVault never reads the **content** of any web page. It declares no host
  permissions and injects no content scripts, so it can see the address,
  title and favicon of a tab, and nothing inside it.
- It never captures what you type, your cookies, your passwords, your
  bookmarks, or your browsing history. Only tabs that are open right now, the
  snapshots you have kept, the shelves, and the recently closed list above are
  recorded.
- It has no account, no login, and no identifier for you.
- **Unload idle tabs and the idle rules** (off until you turn them on) read
  only the tab details Chrome already gives a tab manager (when each tab was
  last used, whether it is active, playing sound or pinned, its group's name
  and its site's host name). A run keeps none of them for unloading: it
  records only when it last ran and how many tabs it unloaded, shelved, could
  not handle or left for the next run, in `chrome.storage.session`, which
  the browser clears when it closes. A shelving rule stores, on the shelf you
  chose, the title, address and favicon address of each tab it files there
  (see Shelves above), and only then closes the tab. It never reads a page
  and sends nothing anywhere. Nothing is closed unless a rule you wrote says
  so: a shelving rule stays off until you have run its dry run and turned it
  on. An unloaded tab keeps its address and title in its window.
- **Saved-tab search** in the command palette builds its index of your
  snapshots, shelves and recently closed tabs in the page's memory while the
  page is open, and stores nothing.

## Where the data is kept

All data is stored only on your device, in the browser's extension storage
(`chrome.storage.local`, which also holds your window names until the browser
next starts; `chrome.storage.session`, which the browser clears when it
closes, for short-lived values: the snapshot debounce timer, when the browser
session started, and when the idle-tab rule last ran and how many tabs it
unloaded; and the
extension page's own `localStorage`, for a copy of your Appearance choice).
TabVault has no
server. It sends nothing to any server of its own, contains no analytics or
telemetry, and never transmits, syncs, sells or shares your data with anyone,
including the developer. The only network activity is the browser fetching
each tab's favicon from that tab's own site to show it in the list, which
version 1.0 did too.

If you use **Export**, a JSON or Markdown file containing the session,
selection, snapshot or shelf you chose is written to the download location
you pick, or the same text is put on your clipboard when you click **Copy to
clipboard**. That file is yours and under your control. **Import** reads a
file you select, or text you paste, and nothing else; links that are not web
pages are skipped.

## How long the data is kept

- The current session is not "kept" at all: it is read from the browser every
  time you open the page.
- Automatic snapshots beyond the number you choose in Settings (20 by default)
  are deleted oldest first. Snapshots you mark **Keep** are never rotated out.
- Shelves are kept until you remove a tab from them or delete the shelf.
- You can delete data at any time: **Delete** on a snapshot removes that
  snapshot, × or **Open and remove** on a shelved tab removes it, **Delete**
  on a shelf removes the shelf, and uninstalling the extension removes all of
  its storage.

## Permissions

- **tabs**: to list every window and tab with its title, URL and favicon, and
  to move, pin, unpin, unload, focus and close tabs when you ask, and to
  close the tabs a shelving rule you wrote has saved to its shelf. This is what
  produces Chrome's "Read your browsing history" warning at install: it refers
  to the tabs you have open, which is the whole point of a tab manager.
- **tabGroups**: to show your native tab groups, and to create, rename,
  recolour, collapse and restore them.
- **storage**: to save your snapshots and settings on your device.
- **unlimitedStorage**: to lift the usual few-megabyte cap on extension
  storage, so a large session history does not silently start failing to save.
- **alarms**: to run the debounce timer that takes an automatic snapshot after
  your tabs have stopped changing. A Manifest V3 service worker cannot hold a
  timer on its own, so this is how the delay is measured. A second alarm,
  every 5 minutes, refreshes the tab count on the icon and runs your idle
  rules: only if you turned on **Unload idle tabs** or wrote a rule, it
  unloads tabs idle past your threshold, and a shelving rule you dry-ran and
  turned on saves the idle tabs of its site to your shelf and then closes
  them. Nothing is closed unless a rule you wrote says so.
- **sidePanel**: to show the same TabVault page in Chrome's side panel when
  you open it there. It grants no access to any website.

TabVault requests no access to websites (no host permissions) and no optional
permissions.

## Incognito

TabVault can only see incognito windows if you explicitly allow it to run in
incognito at `chrome://extensions`. If you do not, incognito windows are
skipped entirely. If you do, incognito tabs are treated like any other tab:
listed in the page and included in snapshots that are stored locally.

## Children

TabVault is not directed at children and does not knowingly collect
information from children.

## Changes

If this policy changes, the new version will be published at the same address
with an updated effective date.

## Contact

Questions about this policy: iyazee6+store@gmail.com
