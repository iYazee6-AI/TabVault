# TabVault Privacy Policy

Effective date: 2026-09-19

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
- **Your settings** — theme, density, whether URLs are shown under titles, the
  snapshot debounce in seconds, how many snapshots to keep, whether duplicate
  finding ignores the URL `#hash`, and whether restored tabs load lazily.

Tab titles and URLs can contain personal information, because they are
whatever the pages you have open happen to be.

## What TabVault does not store

- TabVault never reads the **content** of any web page. It declares no host
  permissions and injects no content scripts, so it can see the address,
  title and favicon of a tab, and nothing inside it.
- It never captures what you type, your cookies, your passwords, your
  bookmarks, or your browsing history. Only tabs that are open right now (and
  the snapshots you have kept) are recorded.
- It has no account, no login, and no identifier for you.

## Where the data is kept

All data is stored only on your device, in the browser's extension storage
(`chrome.storage.local`, plus a single short-lived value in
`chrome.storage.session` used to time the snapshot debounce). TabVault has no
server. It makes no network requests of its own, contains no analytics or
telemetry, and never transmits, syncs, sells or shares your data with anyone,
including the developer.

If you use **Export**, a JSON file containing the session you chose is written
to the download location you pick. That file is yours and under your control.
**Import** reads a file you select and nothing else.

## How long the data is kept

- The current session is not "kept" at all: it is read from the browser every
  time you open the page.
- Automatic snapshots beyond the number you choose in Settings (20 by default)
  are deleted oldest first. Snapshots you mark **Keep** are never rotated out.
- You can delete data at any time: **Delete** on a snapshot removes that
  snapshot, and uninstalling the extension removes all of its storage.

## Permissions

- **tabs**: to list every window and tab with its title, URL and favicon, and
  to move, pin, unpin, unload, focus and close tabs when you ask. This is what
  produces Chrome's "Read your browsing history" warning at install: it refers
  to the tabs you have open, which is the whole point of a tab manager.
- **tabGroups**: to show your native tab groups, and to create, rename,
  recolour, collapse and restore them.
- **storage**: to save your snapshots and settings on your device.
- **unlimitedStorage**: to lift the usual few-megabyte cap on extension
  storage, so a large session history does not silently start failing to save.
- **alarms**: to run the debounce timer that takes an automatic snapshot after
  your tabs have stopped changing. A Manifest V3 service worker cannot hold a
  timer on its own, so this is how the delay is measured.

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
