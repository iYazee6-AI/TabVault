# TabVault 1.1 — "Console": the UI/UX rebuild

**Date:** 2026-09-28
**Status:** approved by the owner in the command-centre session (chose direction A of three mockups: "I liked the first one it looked amazing"). Plan: `docs/superpowers/plans/2026-09-28-console-ui.md`.
**Requires:** 1.0.0 as shipped to the Chrome Web Store (main 67025f5).

## Why

The owner tried the store build and said it needs better UI/UX. The 1.0 page works but reads as a settings page: every control the same grey pill, glyph buttons with no names, native selects for group colour, no mark on the current window or tab, letter badges where favicons belong, no dark theme, no keyboard hints, an empty page below the cards.

## Direction: Console

Dense and keyboard-first, for someone with two hundred tabs. Monospace for names and counts, one amber for the thing to press, tight rows, shortcuts always visible. Light and dark, following Chrome's colour scheme with a Settings override.

### Tokens (`app/index.html` `:root`, then `[data-theme="dark"]` and the `prefers-color-scheme` block guarded by `:not([data-theme="light"])`)

| Token | Light | Dark | Role |
|---|---|---|---|
| `--g` | `#F7F7F5` | `#131518` | page ground |
| `--g2` | `#FFFFFF` | `#1B1E23` | cards, search, buttons |
| `--g3` | `#F0F0EC` | `#22262C` | group headers, hover |
| `--t` | `#17191C` | `#EDEFF2` | text; also the bulk bar's fill |
| `--t2` | `#6B6F76` | `#9AA1AB` | secondary text (≥ 4.5:1 on `--g2` in both) |
| `--l` | `#E1E2DD` | `#2C3138` | hairlines |
| `--p` | `#B7791F` | `#F2B84B` | the primary action, the current-window ring, the active-tab bar |
| `--pInk` | `#FFFFFF` | `#1A1200` | text on `--p` |
| `--pSoft` | `#FBEBCC` | `#3A2E12` | selected rows |
| `--pText` | `#7A4E0A` | `#F2B84B` | "CURRENT" tag text on `--pSoft` |
| `--danger` | `#C0392B` | `#F0645A` | Close in the bulk bar, "dup" flags |

Chrome's eight group colours keep their own hues (grey, blue, red, yellow, green, pink, purple, cyan) as 12 px dots; the group header's left edge carries the colour as a 3 px bar.

### Type

IBM Plex Sans (400/500/600) for text, IBM Plex Mono (500) for the brand, window names, counts, domains and keyboard keys. Both bundled under `app/fonts/` (OFL 1.1, licence file included) and declared with `@font-face`; no web requests (the extension's CSP forbids them anyway). Sizes: page 12.5 px, tab rows 12.5 px, window names 13 px semibold, counts 11 px mono, hints 11 px.

### Layout

- **Header**: brand, the search field with a `/` key hint, the count `3 win · 27 tabs · 4 sel` in mono, then `Find duplicates` as the one primary button, `Snapshots`, and a `⋯` menu holding Export, Import, Settings, Help.
- **Windows** as cards in a responsive grid (3 columns ≥ 1100 px, 2 ≥ 720, else 1). The window that hosts TabVault's own tab is marked `CURRENT` (tag) with a `--p` ring; window names are editable inline (pencil, Enter/Escape), stored per window id in `chrome.storage.local` under `windowNames`, cleared by the worker on `chrome.runtime.onStartup` (amended in Task 3: `chrome.storage.session` is also wiped on an extension update or reload while the windows stay open, and window ids only reset with the browser), and carried into snapshots and exports as `windowName` (import restores it as the label; the existing schema stays valid without it).
- **Groups** inside windows: colour dot, name, count, the eight-dot colour picker (replaces the select), collapse chevron. Tabs inside groups keep the 1.0 indentation.
- **Tab rows**: checkbox, favicon (`favIconUrl` when present, else a letter badge coloured from the domain hash), title, domain in mono, flags on the right: `📌` pinned, `🔊` audible, `zz` discarded, `dup` in `--danger` when the duplicate finder would flag it (same rule as 1.0's `lib/dedupe.js`). The active tab of each window carries a 3 px `--p` bar on the left. Selected rows fill `--pSoft`.
- **Bulk bar**: appears only when something is selected; sticky at the bottom, `--t` fill with `--g` text, rounded 12 px, shadow; `N selected`, Move to ▾ (a menu, not a native select), Group, Pin, Discard, Close (`--danger`), and "Esc to clear" at the right. Replaces the 1.0 band.
- **Hint strip** at the very bottom: `/ search · j k move · x select · g group · d duplicates · ? all shortcuts`. `?` opens a shortcuts panel (a dialog in `dialogs.js`) listing every binding that already exists in `app.js` plus the new ones (`j`/`k`, `x`, `g`, `d`, `Esc`).
- **Empty states**: no windows (only TabVault's own tab): a line and the Import/Snapshots links; no search results: "Nothing matches" with the query.
- **Every icon button** has `title` and `aria-label`; focus rings are visible (`--p` outline); the whole page works from the keyboard.

### What does not change

Data model, snapshots, export/import format (only the optional `windowName` is added), duplicate rules, restore, permissions, the manifest's single purpose. No new permissions. No `innerHTML`.

## Verification

- `npm run lint` clean (0 errors), `npm test` (23 → more: window-name plumbing in `lib/session.js`/`exporters.js`, the favicon fallback colour function, the shortcut table), `npm run pack` includes `app/fonts/**`.
- Playwright e2e (`npm run e2e`): the 13 scenarios stay green; add: dark theme via the Settings override; the current window tag; the bulk bar appears on selection and closes with Esc; the colour dots change a group's colour; the `?` panel opens; window rename round-trips through export.
- `npm run screenshots` regenerates the five store screenshots (1280×800, 24-bit, no alpha) in the new look, light theme.
- Version 1.1.0 in `manifest.json` and `package.json`; `docs/HISTORY.md` entry; `docs/store/listing.md` "What's new" text for the store update.

## Out of scope

Side panel mode, tab search across history, sync between devices, drag-and-drop between windows beyond what 1.0 has.
