# Changes

TabVault's releases, newest first, written for the person who uses it. The
decision log with the details is `docs/HISTORY.md`.

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
- **New licence.** TabVault is now free for personal and non-commercial use
  under the PolyForm Noncommercial License 1.0.0; commercial use needs the
  author's written permission. Versions up to 1.3.0 stay MIT for those who
  have them. The bundled IBM Plex fonts keep their own licence (OFL 1.1).
- **Chrome 123 or later.** TabVault 1.4 needs Chrome (or Edge) 123 or newer, up
  from 120: Focus mode's toolbar menu uses a feature Chrome added in 123. A
  browser older than that keeps 1.3.0.
- **Behind the scenes.** The build tools were brought up to date (ESLint 10,
  Playwright 1.65 and the GitHub Actions steps), and every push now runs the
  lint, the tests and the package build on GitHub.

## 1.3.0 — 2026-11-08

- Shelf: idle rules per site (unload, shelve, never), shelves, compare a
  snapshot with now, search everything you saved, Markdown export and import.
