# Changes

TabVault's releases, newest first, written for the person who uses it. The
decision log with the details is `docs/HISTORY.md`.

## 1.7.0 — 2026-11-19 "Tidy"

Three ways for the browser to tidy itself, and nothing is ever lost.

- **Snooze a tab.** Select tabs and press Snooze (or the ⏾ on a group, or
  the palette): later, in 3 hours; tomorrow morning; next week; or a date
  and time you pick. The tabs close now and open again by themselves at
  that time, in their window if it is still open (else in a new one), with
  their group and pin. Until then they wait under **Snoozed**, below your
  windows, with Wake now, Reschedule and Cancel. A snooze survives a
  browser restart: if the time passed while Chrome was closed, the tab
  opens the next time Chrome starts. Snoozed tabs show up in the Alt+K
  search too.
- **Group rules.** ⋯ → Group rules: "pages of github.com go into the group
  Code, blue". New tabs, and tabs that go to a matching site, join that
  group by themselves. A rule never moves a pinned tab or a tab already in
  a group, and if you take a tab out of a group, TabVault leaves it alone
  until it goes to another site. "Run rules on open tabs now" shows what
  would move first, and Undo puts it all back. No rules, nothing happens.
  The rules travel inside the JSON export, and Import offers to add them.
- **Weekly tidy.** Once a week a quiet bar on the TabVault page says your
  tidy is ready (no pop-up; a notification only if you turn it on). The
  Tidy view lists tabs you have not visited for 14 days (you choose),
  duplicates, groups with one tab, and snoozed tabs that came back and you
  have not looked at. Tick what you are done with: **Close into the vault**
  puts them on a shelf named "Tidy" and the date, and **Restore** brings
  them back in one click; **Keep** leaves a page out of the tidy for 30
  days. The last line says what you tidied this week.
- One new permission, and only if you ask for it: turning on the tidy
  notification makes Chrome ask once. Nothing else changes in what
  TabVault may do; everything stays on your computer.

## 1.6.0 — 2026-11-17

- **Bookmarks, when you want them.** Settings, Bookmarks: turn it on and
  Chrome asks once to let TabVault read and change your bookmarks. Off (the
  default), TabVault never looks at them; turn it off again and the access is
  given back.
- **Find bookmarks in the palette.** Alt+K now also finds your bookmarks by
  title or address, marked with a star and their folder; type `b:` first for
  bookmarks only. Enter opens one, Shift+Enter in a new window. A folder opens
  as a window of its pages (it asks first above 50).
- **Save tabs as a bookmark folder.** The ☆ on a window card or a group, the
  Bookmark button for the selected tabs or a shelf: name the folder and it
  lands in Other bookmarks › TabVault.
- **Delete never deletes.** Removing a bookmark from TabVault (the × beside it
  in the palette, or Find duplicate bookmarks) moves it into a folder called
  Deleted in Other bookmarks, made when missing, and TabVault remembers where
  it was. Emptying Deleted is yours to do, in Chrome's bookmark manager.
- **Back up your bookmarks.** Bookmarks dialog (⋯ → Bookmarks): Back up now
  downloads every bookmark with its folders, order and dates, and TabVault
  keeps the last 5 copies itself (Settings sets how many). A copy is also
  taken by itself before any change to more than 10 bookmarks. Export as HTML
  gives the standard file every browser imports. Restoring from a backup
  comes in a later version.
- Everything stays on your computer; nothing is sent anywhere.

## 1.5.0 — 2026-11-17

- **The toolbar button can open the side panel.** Settings, "Toolbar button
  opens": Full page (as before, and still the default) or Side panel. With
  Side panel, one click on the TabVault icon opens TabVault beside the page
  you are on.
- **Both, whatever you pick.** Right-click the TabVault icon: "Open in side
  panel" and "Open full page" sit above "Focus this window". Alt+Shift+T
  still opens the full page.
- No new permission and no question at the update.

## 1.4.1 — 2026-11-09

- **The command palette opens again right after a command.** Running a
  command from the Alt+K palette (Snapshot now, for one) and pressing Alt+K
  at once could do nothing: the closed palette kept the keyboard and
  swallowed the keys. It now lets go as it closes.

## 1.4.0 — 2026-11-09

- **Focus mode.** Two windows open and you want to work in one: press
  Alt+Shift+F (or right-click the TabVault icon, Focus this window) and every
  other window is blurred and dimmed, with a pill on top: "Click to lift".
  The same keys lift it again; pressing them in another window moves the
  focus there. New tabs in the other windows are veiled too, the icon shows a
  dot while it is on, and the TabVault page shows a bar with Lift the focus.
- **One question the first time.** Drawing the veil needs Chrome's permission
  to touch your pages, asked once on the TabVault page; TabVault still reads
  nothing from them. Say no and Focus mode minimises the other windows
  instead. Pages Chrome keeps to itself (its own pages, the Web Store, PDFs)
  are not veiled; the page tells you how many.
- **Chrome 123 or later.** TabVault 1.4 needs Chrome (or Edge) 123 or newer, up
  from 120: Focus mode's toolbar menu uses a feature Chrome added in 123. A
  browser older than that keeps 1.3.0.
- **Behind the scenes.** The build tools were brought up to date (ESLint 10,
  Playwright 1.65 and the GitHub Actions steps), and every push now runs the
  lint, the tests and the package build on GitHub.

## 1.3.0 — 2026-11-08

- Shelf: idle rules per site (unload, shelve, never), shelves, compare a
  snapshot with now, search everything you saved, Markdown export and import.
