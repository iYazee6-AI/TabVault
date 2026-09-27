# TabVault 1.1 "Console" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild TabVault's page as the "Console" design: design tokens with light and dark themes, bundled IBM Plex fonts, window cards with a CURRENT mark and editable names, colour-dot groups, richer tab rows, a floating bulk bar, one keyboard table behind the key handler, the hint strip and the `?` panel. Ship as 1.1.0.

**Architecture:** Same shape as 1.0. Pure logic stays in `lib/` (UMD, unit-tested with `node --test`): window-name plumbing goes into `lib/session.js`, `lib/exporters.js` and `lib/restore-plan.js`; two new modules, `lib/ui.js` (counter text, domain, favicon fallback colour, duplicate flags) and `lib/shortcuts.js` (the one shortcut table). `app/index.html` carries the tokens and every style in one inline `<style>` split into marked sections; `app/app.js` renders with `document.createElement`/`textContent` only; `app/dialogs.js` holds the dialogs, including the `?` panel. `app/theme-boot.js` applies a stored Light/Dark override before first paint.

**Tech Stack:** Manifest V3, vanilla JS, Node 22 `node --test`, ESLint 9 flat config, Playwright (devDependency, `e2e/` and `tools/screenshots.js`).

**Spec:** `docs/superpowers/specs/2026-09-28-console-ui-design.md` (binding: tokens, type, layout, what does not change, verification, version 1.1.0).

## Global Constraints

- No runtime dependencies, no build step, no new permissions. `manifest.json` permissions stay exactly `["tabs", "tabGroups", "storage", "unlimitedStorage", "alarms"]`.
- No `innerHTML`, no `insertAdjacentHTML`, no inline scripts or inline event handlers in extension pages (MV3 CSP). Build nodes with the `el()` helper in `app/app.js`.
- Never `alert`/`confirm`/`prompt`; confirmations stay inline.
- Session schema stays 1. The only data addition is the optional `windowName` string on a window; every reader accepts its absence.
- Token names and hex values are exactly the spec's table. Chrome's group colours keep the 1.0 hex values in `GROUP_COLORS`.
- Fonts are bundled under `app/fonts/`; the extension never makes a network request, for fonts or anything else. The only download in this whole plan is the implementer fetching the font files once in Task 1.
- Gates at the end of every task, all three from the repo root: `npm run lint` (0 errors; warnings allowed, never silenced), `npm test` (all pass, count stated per task), `npm run pack`.
- `npm run e2e` runs in the foreground with the longest timeout the shell allows (600000 ms), never in the background. It opens real Chromium windows. The repo lives under OneDrive, so the harness's copy of the extension and its profile directory are slow to write: a full run takes several minutes (scenario K alone waits 40 s). Scenario I-b may report `LIMITED` (documented environment crash); everything else must be `PASS`.
- Write no literal backslash character in any line this plan adds: build newlines with `String.fromCharCode(10)`, use character classes such as `[0-9]` instead of escapes (the code below already does). Before each commit, stage the task's files (`git add <paths>`) and run `git diff --cached -U0 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const nl=String.fromCharCode(10);const bad=s.split(nl).filter(l=>l.startsWith('+')&&!l.startsWith('+++')&&l.includes(String.fromCharCode(92)));console.log(bad.length?bad.join(nl):'no backslash added')})"`; it must print `no backslash added`.
- Commit only the files the task names, by pathspec (`git commit <paths>`), never `git commit -a`. `docs/store/screenshots/` holds three untracked `ChatGPT Image ....png` files: never add them.
- Every commit message ends with these two trailer paragraphs (the commit commands below already carry them):
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UNR1Jj1F1e65B68YPwVuUj
  ```

## Baselines observed while writing this plan (HEAD 9fc7cbc)

- `npm run lint`: 0 errors, 19 warnings (all `security/*`).
- `npm test`: 23 tests, 23 pass.
- Expected unit-test counts after each task: Task 1: 23; Task 2: 29; Task 3: 32; Task 4: 32; Task 5: 35; Task 6: 35; Task 7: 35.
- e2e: 13 scenarios (A-H, I-a, I-b, J, K, L). After Task 6: 19 (adds M-R).

## Decisions the spec left open (made here, deliberately)

1. **First-paint theme.** `chrome.storage` is asynchronous, and MV3 forbids inline scripts, so the page cannot read the setting before first paint. The default ("System") needs no script at all: the `prefers-color-scheme` block in the stylesheet applies the dark tokens by itself. Only an explicit Light or Dark override could flash, so `applySettings()` mirrors `settings.theme` into `localStorage` under `tabvault.theme`, and a tiny external script `app/theme-boot.js`, loaded synchronously in `<head>` before the `<style>`, stamps `data-theme` from that mirror. `chrome.storage.local` stays the source of truth; the mirror only affects the first frame. `localStorage` is per extension origin, local, and never synced.
2. **Window names in mono are Medium (500), not SemiBold.** The spec bundles IBM Plex Mono in weight 500 only and also asks for "window names 13 px semibold" in mono. Requesting 600 from a 500-only family makes Chrome synthesise a smeared faux bold, so window names use Plex Mono Medium at 13 px (`font-synthesis: none`). No fifth font file is added.
3. **Unpin and Ungroup survive in the bulk bar.** The spec's bar lists Move to, Group, Pin, Discard, Close. 1.0's bar also had Unpin and Ungroup; to keep those features without widening the bar, **Pin reads "Unpin" when every selected tab is pinned** and **Group reads "Ungroup" when every selected tab is already in a group**. "Clear selection" becomes the "Esc to clear" hint, which is a button (id `sel-clear`) so a mouse user can still clear.
4. **The picker shows the spec's eight colours.** Chrome also has `orange`; a group that is already orange still shows its orange dot and bar (the colour stays in `GROUP_COLORS`), it just is not offered in the picker.
5. **An unnamed window shows its active tab's title** (1.0's heading) in `--t2` sans; a named one shows the name in mono. This keeps unnamed windows distinguishable, including in the Move-to menu.
6. **The `dup` flag uses the whole session**, not the filtered view, with the `ignoreHash` setting, through `findDuplicates` itself, so it is exactly the set Find duplicates would close.
7. **The muted flag `🔇` stays** next to the spec's four flags (1.0 showed it; removing it would drop information).
8. **Window cards do not scroll individually.** The page (`#main`) scrolls; its scroll position is preserved across re-renders instead of 1.0's per-column scroll.

## File structure

| Path | Change |
|---|---|
| `app/fonts/IBMPlexSans-Regular.woff2`, `IBMPlexSans-Medium.woff2`, `IBMPlexSans-SemiBold.woff2`, `IBMPlexMono-Medium.woff2`, `LICENSE.txt` | New (Task 1): the four bundled faces and the OFL 1.1 licence |
| `app/theme-boot.js` | New (Task 1): applies the mirrored Light/Dark override before first paint |
| `app/index.html` | Tokens, fonts, sectioned styles (Task 1); header, `#main` (Task 2); bulk bar (Task 4); hint strip, `lib/shortcuts.js` (Task 5) |
| `app/app.js` | Theme mirror (1); cards, CURRENT, names, menus, counter, empty states (2); groups and rows (3); bulk bar (4); keyboard table, focus, hints (5) |
| `app/dialogs.js` | Appearance (1); restore re-applies window names (2); `?` panel from the table (5) |
| `lib/session.js` | `buildSession({ windowNames })`, `setWindowName`, `stripVolatile` keeps names (2) |
| `lib/exporters.js` | `parseImport` normalises optional `windowName` (2) |
| `lib/restore-plan.js` | `nameWindow` step (2) |
| `lib/ui.js` | New: `formatCounts` (2); `domainOf`, `faviconColor`, `faviconLetter`, `FAVICON_COLORS`, `duplicateIds` (3) |
| `lib/shortcuts.js` | New (5): `SHORTCUTS`, `HINTS`, `findShortcut`, `hintText` |
| `background.js` | Snapshots carry window names; a rename schedules a snapshot (2) |
| `test/session.test.js`, `test/exporters.test.js`, `test/restore-plan.test.js` | Window-name tests (2) |
| `test/ui.test.js` | New (2, extended 3) |
| `test/shortcuts.test.js` | New (5) |
| `tools/pack.js` | Refuses to build without the fonts and licence (1) |
| `e2e/run.js`, `e2e/README.md` | Selector updates (2, 3, 4); scenarios M-R (6) |
| `tools/screenshots.js` | Light scheme, window names, RGB (no alpha) PNG output (7) |
| `manifest.json`, `package.json`, `package-lock.json` | 1.1.0 (7) |
| `docs/HISTORY.md`, `docs/store/listing.md`, `README.md`, `PRIVACY.md`, `CLAUDE.md`, `docs/store/screenshots/0[1-5]-*.png`, `docs/store/promo-tile-440x280.png` | Release docs and store images (7) |

## Stylesheet sections

From Task 1 on, the `<style>` in `app/index.html` is divided by marker comments, one per line, in this order:

```
/* == tokens == */
/* == legacy aliases (removed in Task 5) == */
/* == fonts == */
/* == base == */
/* == header == */
/* == selection == */
/* == windows == */
/* == groups == */
/* == tabs == */
/* == hints == */
/* == dialogs == */
/* == end == */
```

"Replace section X" means: replace every line after the `/* == X == */` marker line up to (not including) the next marker line. The markers themselves stay.

---

## Task 1 — Tokens, bundled fonts, Appearance setting

**Files:**
- Create: `app/fonts/IBMPlexSans-Regular.woff2`, `app/fonts/IBMPlexSans-Medium.woff2`, `app/fonts/IBMPlexSans-SemiBold.woff2`, `app/fonts/IBMPlexMono-Medium.woff2`, `app/fonts/LICENSE.txt`, `app/theme-boot.js`
- Modify: `app/index.html`, `app/app.js`, `app/dialogs.js`, `tools/pack.js`

**Interfaces:**
- Produces: the CSS custom properties `--g --g2 --g3 --t --t2 --l --p --pInk --pSoft --pText --danger --sans --mono --row` on `:root`; font families `"IBM Plex Sans"` (400/500/600) and `"IBM Plex Mono"` (500); `html[data-theme]` is `system`, `light` or `dark`; `localStorage["tabvault.theme"]` mirrors `settings.theme`; utility classes `.mono`, `button.icon`, `button.primary`, `button.danger`; the global rule that `[hidden]` always hides.
- Consumes: `settings.theme` (`"system" | "light" | "dark"`, already in 1.0's `DEFAULT_SETTINGS`).
- No behaviour changes besides theming. The Settings dialog's first `<select>` stays the theme select (e2e L relies on density being `select` number 1).

- [ ] **Step 1: Download the fonts (the only network fetch in this plan)**

The IBM Plex repository publishes each family as its own GitHub release (`https://github.com/IBM/plex/releases`, tags like `@ibm/plex-sans@<version>` and `@ibm/plex-mono@<version>`), each with a zip asset (`ibm-plex-sans.zip`, `ibm-plex-mono.zip`) that contains `fonts/complete/woff2/` and `LICENSE.txt`. Take the latest release of each. Work in a scratch directory outside the repo:

```bash
gh release list --repo IBM/plex --limit 40
gh release view "@ibm/plex-sans@<latest version from the list>" --repo IBM/plex
gh release view "@ibm/plex-mono@<latest version from the list>" --repo IBM/plex
```

Download the two zip assets named in those views (with `gh release download "<tag>" --repo IBM/plex --pattern "*.zip" --dir <scratch>` or the browser), extract them in the scratch directory, and copy exactly these five files into `app/fonts/` (create the folder):

| Source inside the extracted zips | Destination |
|---|---|
| `ibm-plex-sans/fonts/complete/woff2/IBMPlexSans-Regular.woff2` | `app/fonts/IBMPlexSans-Regular.woff2` |
| `ibm-plex-sans/fonts/complete/woff2/IBMPlexSans-Medium.woff2` | `app/fonts/IBMPlexSans-Medium.woff2` |
| `ibm-plex-sans/fonts/complete/woff2/IBMPlexSans-SemiBold.woff2` | `app/fonts/IBMPlexSans-SemiBold.woff2` |
| `ibm-plex-mono/fonts/complete/woff2/IBMPlexMono-Medium.woff2` | `app/fonts/IBMPlexMono-Medium.woff2` |
| `ibm-plex-sans/LICENSE.txt` | `app/fonts/LICENSE.txt` |

If a zip nests one level deeper or splits `complete/woff2` into hinted/unhinted folders, take the `complete` woff2 of those weights; the destination names above are fixed. Compare the two packages' `LICENSE.txt`: both are the SIL Open Font License 1.1 for IBM Plex; if the mono one differs in anything but whitespace, stop and report it rather than guessing. Keep nothing else (no `.woff`, `.ttf`, `.otf`, other weights or italics). Delete the scratch directory afterwards.

- [ ] **Step 2: Verify the font files**

```bash
node -e "const fs=require('fs');for(const f of ['IBMPlexSans-Regular','IBMPlexSans-Medium','IBMPlexSans-SemiBold','IBMPlexMono-Medium']){const b=fs.readFileSync('app/fonts/'+f+'.woff2');console.log(f,b.length,b.subarray(0,4).toString('latin1'))}"
node -e "const t=require('fs').readFileSync('app/fonts/LICENSE.txt','utf8');console.log(t.includes('SIL OPEN FONT LICENSE Version 1.1'), t.includes('Plex'))"
ls app/fonts
```

Expected: each line ends in `wOF2` with a size in the tens to low hundreds of KB; the licence line prints `true true`; `ls` lists exactly the five files.

- [ ] **Step 3: `app/theme-boot.js`**

```js
// Loaded synchronously from <head>, before the stylesheet: an explicit Light or Dark
// choice (Settings > Appearance) is mirrored into localStorage by app.js, so the first
// paint already uses it. "System" needs no script: the prefers-color-scheme block in
// index.html applies the dark tokens by itself. MV3 extension pages cannot run inline
// scripts, hence a file.
(() => {
  let theme = null;
  try {
    theme = localStorage.getItem("tabvault.theme");
  } catch {
    /* storage unavailable: app.js applies the theme once settings load */
  }
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
})();
```

- [ ] **Step 4: `app/index.html` head and stylesheet**

In `<head>`, insert this line directly after `<title>TabVault</title>`:

```html
  <script src="theme-boot.js"></script>
```

Then replace everything between `<style>` and `</style>` (1.0 lines 7-73) with the following. The header, selection, windows, groups and tabs sections are the 1.0 rules unchanged; they keep working through the legacy aliases until Tasks 2-4 rewrite them, and Task 5 deletes the aliases.

```css
    /* == tokens == */
    :root {
      --g: #F7F7F5; --g2: #FFFFFF; --g3: #F0F0EC; --t: #17191C; --t2: #6B6F76; --l: #E1E2DD;
      --p: #B7791F; --pInk: #FFFFFF; --pSoft: #FBEBCC; --pText: #7A4E0A; --danger: #C0392B;
      --sans: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
      --mono: "IBM Plex Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;
      --row: 28px;
      color-scheme: light;
    }
    :root[data-theme="dark"] {
      --g: #131518; --g2: #1B1E23; --g3: #22262C; --t: #EDEFF2; --t2: #9AA1AB; --l: #2C3138;
      --p: #F2B84B; --pInk: #1A1200; --pSoft: #3A2E12; --pText: #F2B84B; --danger: #F0645A;
      color-scheme: dark;
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        --g: #131518; --g2: #1B1E23; --g3: #22262C; --t: #EDEFF2; --t2: #9AA1AB; --l: #2C3138;
        --p: #F2B84B; --pInk: #1A1200; --pSoft: #3A2E12; --pText: #F2B84B; --danger: #F0645A;
        color-scheme: dark;
      }
    }
    :root[data-density="compact"] { --row: 24px; }
    /* == legacy aliases (removed in Task 5) == */
    :root { --bg: var(--g); --surface: var(--g2); --surface-2: var(--g3); --ink: var(--t); --ink-2: var(--t2); --line: var(--l); --accent: var(--p); --accent-ink: var(--pInk); --accent-soft: var(--pSoft); }
    /* == fonts == */
    @font-face { font-family: "IBM Plex Sans"; font-style: normal; font-weight: 400; font-display: block; src: url("fonts/IBMPlexSans-Regular.woff2") format("woff2"); }
    @font-face { font-family: "IBM Plex Sans"; font-style: normal; font-weight: 500; font-display: block; src: url("fonts/IBMPlexSans-Medium.woff2") format("woff2"); }
    @font-face { font-family: "IBM Plex Sans"; font-style: normal; font-weight: 600; font-display: block; src: url("fonts/IBMPlexSans-SemiBold.woff2") format("woff2"); }
    @font-face { font-family: "IBM Plex Mono"; font-style: normal; font-weight: 500; font-display: block; src: url("fonts/IBMPlexMono-Medium.woff2") format("woff2"); }
    /* == base == */
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    html, body { height: 100%; }
    body { margin: 0; background: var(--g); color: var(--t); font: 400 12.5px/1.45 var(--sans); display: flex; flex-direction: column; overflow: hidden; }
    button { font: inherit; color: inherit; background: var(--g2); border: 1px solid var(--l); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
    button:hover { background: var(--g3); }
    button.primary { background: var(--p); color: var(--pInk); border-color: var(--p); font-weight: 500; }
    button.primary:hover { background: var(--p); filter: brightness(1.06); }
    button.danger { color: var(--danger); }
    button:disabled { opacity: .5; cursor: default; }
    button.icon { padding: 2px 6px; line-height: 1.2; background: transparent; border-color: transparent; color: var(--t2); }
    button.icon:hover { background: var(--g3); color: var(--t); }
    button.icon.danger { color: var(--danger); }
    input[type=text], input[type=search], input[type=number], select { font: inherit; color: inherit; background: var(--g2); border: 1px solid var(--l); border-radius: 6px; padding: 4px 8px; }
    input[type=checkbox], input[type=radio] { accent-color: var(--p); }
    :focus-visible { outline: 2px solid var(--p); outline-offset: 1px; }
    input:focus-visible, select:focus-visible { outline-offset: 0; }
    .mono { font-family: var(--mono); font-weight: 500; font-synthesis: none; }
    kbd { font: 500 11px/1.3 var(--mono); font-synthesis: none; color: var(--t); background: var(--g2); border: 1px solid var(--l); border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; }
    /* == header == */
    #toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--surface); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
    #toolbar .brand { font-weight: 600; display: flex; align-items: center; gap: 6px; }
    #toolbar .brand img { width: 18px; height: 18px; }
    #search { flex: 1; min-width: 200px; }
    #counts { color: var(--ink-2); white-space: nowrap; }
    /* == selection == */
    #selbar { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: var(--accent-soft); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
    /* == windows == */
    #grid { flex: 1; display: flex; gap: 12px; padding: 12px; overflow: auto; align-items: flex-start; }
    .window { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; width: 320px; flex: 0 0 320px; display: flex; flex-direction: column; max-height: 100%; }
    .window.drop { outline: 2px solid var(--accent); }
    .window.incognito .whead { background: #3b3b52; color: #fff; }
    .whead { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--line); border-radius: 10px 10px 0 0; background: var(--surface-2); }
    .whead .title { flex: 1; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .whead .count { color: var(--ink-2); font-variant-numeric: tabular-nums; }
    .whead button { padding: 2px 6px; }
    .tabs { overflow: auto; padding: 4px 0; }
    .window.collapsed .tabs { display: none; }
    #empty { margin: auto; color: var(--ink-2); text-align: center; }
    /* == groups == */
    .group { margin: 4px 6px; border-left: 4px solid var(--gcolor, #999); border-radius: 4px; background: color-mix(in srgb, var(--gcolor, #999) 10%, var(--surface)); }
    .group.drop { outline: 2px solid var(--accent); }
    .ghead { display: flex; align-items: center; gap: 6px; padding: 3px 6px; font-weight: 600; font-size: 12px; }
    .ghead .gtitle { flex: 1; }
    .group.collapsed .tab { display: none; }
    /* == tabs == */
    .tab { display: flex; align-items: center; gap: 6px; height: var(--row); padding: 0 8px; cursor: pointer; border-radius: 4px; margin: 0 4px; }
    .tab:hover { background: var(--surface-2); }
    .tab.selected { background: var(--accent-soft); }
    .tab.cursor { outline: 1px solid var(--accent); }
    .tab.active .ttitle { font-weight: 600; }
    .tab.discarded .ttitle { color: var(--ink-2); font-style: italic; }
    .tab img { width: 16px; height: 16px; flex: none; }
    .tab .ttitle { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tab .turl { display: none; color: var(--ink-2); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    :root[data-show-urls="true"] .tab { height: auto; padding: 3px 8px; } :root[data-show-urls="true"] .tab .text { display: flex; flex-direction: column; min-width: 0; flex: 1; } :root[data-show-urls="true"] .tab .turl { display: block; }
    .tab .badge { font-size: 10px; color: var(--ink-2); }
    .tab .close { visibility: hidden; padding: 0 5px; line-height: 1; }
    .tab:hover .close { visibility: visible; }
    .tab.dragover { box-shadow: inset 0 2px 0 var(--accent); }
    /* == hints == */
    /* == dialogs == */
    #dialog-backdrop { position: fixed; inset: 0; z-index: 20; background: rgba(10, 12, 14, .45); display: flex; align-items: center; justify-content: center; }
    #dialog { background: var(--g2); color: var(--t); border: 1px solid var(--l); border-radius: 12px; box-shadow: 0 20px 60px rgba(0, 0, 0, .3); width: min(720px, 92vw); max-height: 88vh; overflow: auto; padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; }
    #dialog h2 { margin: 0; font: 600 15px var(--sans); }
    #dialog table { border-collapse: collapse; width: 100%; }
    #dialog td, #dialog th { text-align: left; padding: 5px 6px; border-bottom: 1px solid var(--l); vertical-align: top; }
    #dialog th { font-weight: 500; color: var(--t2); }
    #dialog .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    #dialog .muted { color: var(--t2); }
    #dialog .list { max-height: 50vh; overflow: auto; }
    #toast { position: fixed; bottom: 96px; left: 50%; transform: translateX(-50%); z-index: 30; background: var(--t); color: var(--g); padding: 8px 14px; border-radius: 8px; opacity: 0; transition: opacity .2s; pointer-events: none; }
    #toast.on { opacity: 1; }
    /* == end == */
```

- [ ] **Step 5: `app/app.js` — mirror the theme, drop the `.dark` class**

Directly after the `DEFAULT_SETTINGS` line add:

```js
  const THEME_MIRROR = "tabvault.theme"; // read by app/theme-boot.js before first paint
```

Replace the whole `applySettings` function with:

```js
  function applySettings() {
    const root = document.documentElement;
    const theme = state.settings.theme === "light" || state.settings.theme === "dark" ? state.settings.theme : "system";
    root.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_MIRROR, theme);
    } catch {
      /* storage unavailable: the theme still applies, one frame later on the next load */
    }
    root.dataset.showUrls = String(Boolean(state.settings.showUrls));
    root.dataset.density = state.settings.density;
  }
```

In `wire()`, delete this line (the stylesheet now follows the OS scheme on its own):

```js
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applySettings);
```

- [ ] **Step 6: `app/dialogs.js` — Appearance: System / Light / Dark**

In `App.dialogs.settings`, replace the `const theme = ...` line with:

```js
    const theme = el("select", { "aria-label": "Appearance" }, ...[["system", "System"], ["light", "Light"], ["dark", "Dark"]].map(([value, label]) => el("option", { value, selected: value === s.theme ? "" : null }, label)));
```

and replace `el("label", { class: "row" }, "Theme ", theme),` with:

```js
      el("label", { class: "row" }, "Appearance ", theme),
```

The Save handler already stores `theme: theme.value`; keep it.

- [ ] **Step 7: `tools/pack.js` — refuse to build without the fonts**

Directly after `const rootDir = path.join(__dirname, "..");` add:

```js
// The page's @font-face rules point here; a package without them would fall back to
// system fonts silently, so the build fails instead.
const REQUIRED = [
  "app/fonts/IBMPlexSans-Regular.woff2",
  "app/fonts/IBMPlexSans-Medium.woff2",
  "app/fonts/IBMPlexSans-SemiBold.woff2",
  "app/fonts/IBMPlexMono-Medium.woff2",
  "app/fonts/LICENSE.txt",
];
```

In `main()`, directly after `const entries = collectEntries();` add:

```js
  const missing = REQUIRED.filter((f) => !entries.includes(f));
  if (missing.length) {
    console.error(`Missing from the package: ${missing.join(", ")}`);
    process.exit(1);
  }
```

`collectEntries()` already walks all of `app/`, so `app/fonts/**` and `app/theme-boot.js` are packed; nothing under `docs/`, `tools/`, `test/`, `e2e/` or `node_modules/` is.

- [ ] **Step 8: Check there is no remote URL in the page**

```bash
grep -n "url(" app/index.html
grep -n -i "http" app/index.html app/theme-boot.js
```

Expected: `url(` appears only in the four `@font-face` lines, each `fonts/...woff2`; the second command prints nothing.

- [ ] **Step 9: Gates**

```bash
npm run lint
npm test
npm run pack
```

Expected: lint 0 errors; 23 tests pass; pack lists the five `app/fonts/` entries and `app/theme-boot.js` and writes `dist/tabvault-1.0.0.zip`. Temporarily rename `app/fonts/LICENSE.txt`, run `npm run pack`, confirm it exits non-zero with `Missing from the package: app/fonts/LICENSE.txt`, and rename it back.

- [ ] **Step 10: Look at it** — load `E:/OneDrive/Sources/TabVault` unpacked in Chrome (`chrome://extensions`, Developer mode, Load unpacked; if it is already loaded, press its reload button) and open TabVault. The page uses the warm grey ground and amber Find duplicates is not yet primary (that is Task 2); text is IBM Plex Sans (DevTools, Elements, select a tab title, Computed, "Rendered Fonts" shows IBM Plex Sans). Settings, Appearance: Dark turns the page dark; reload the page and it opens dark with no light frame; System follows the OS. If no Chrome is available to the implementer, say so in the report; e2e scenario M (Task 6) covers this.

- [ ] **Step 11: Commit**

```bash
git add app/fonts/IBMPlexSans-Regular.woff2 app/fonts/IBMPlexSans-Medium.woff2 app/fonts/IBMPlexSans-SemiBold.woff2 app/fonts/IBMPlexMono-Medium.woff2 app/fonts/LICENSE.txt app/theme-boot.js app/index.html app/app.js app/dialogs.js tools/pack.js && git commit app/fonts/IBMPlexSans-Regular.woff2 app/fonts/IBMPlexSans-Medium.woff2 app/fonts/IBMPlexSans-SemiBold.woff2 app/fonts/IBMPlexMono-Medium.woff2 app/fonts/LICENSE.txt app/theme-boot.js app/index.html app/app.js app/dialogs.js tools/pack.js -m "Console tokens, bundled IBM Plex fonts and the Appearance setting" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UNR1Jj1F1e65B68YPwVuUj"
```

---

## Task 2 — Header, window cards, CURRENT mark, window names

**Files:**
- Create: `lib/ui.js`, `test/ui.test.js`
- Modify: `lib/session.js`, `lib/exporters.js`, `lib/restore-plan.js`, `background.js`, `app/index.html`, `app/app.js`, `app/dialogs.js`, `test/session.test.js`, `test/exporters.test.js`, `test/restore-plan.test.js`, `e2e/run.js`

**Interfaces:**
- Produces: `TabVault.buildSession({ ..., windowNames })` where `windowNames` is `{ [windowId: string]: string }` and each window gains `windowName` only when its name is non-blank; `TabVault.setWindowName(names, windowId, name, liveIds?) -> names`; `stripVolatile` keeps `windowName`; `parseImport` keeps a non-blank string `windowName` (trimmed, at most 60 characters) and deletes any other value; `planRestore` emits `{ op: "nameWindow", windowRef, name }` right after a named window's `createWindow`; `TabVault.formatCounts({ windows, tabs, shown, selected }) -> string`.
- Storage: `chrome.storage.session` key `windowNames`, the map above. Chrome clears session storage when the browser closes, which is right because window ids do not survive a restart either.
- DOM: `header#toolbar` with `.brand`, `.search-wrap > #search + kbd`, `#counts`, `#btn-dupes.primary`, `#btn-snapshots`, `.menu-wrap > #btn-more + #more-menu.menu` holding `#btn-export`, `#btn-import`, `#btn-settings`, `#btn-help`; `main#main > #grid`; cards are `section.window[data-window]` (`.current` on the window that holds TabVault's own tab) with `.whead > .wname`, `.tag-current`, `.count`, and icon buttons titled "Rename window", "Select all in window", "Focus window", "Close window"; `#empty` for the two empty states.
- App helpers used by later tasks: `iconButton(glyph, label, onclick, extraClass)`, `windowLabel(w)`, `closeMenus(refocus) -> boolean`, `toggleMenu(menuId, fill)`, `clearSearch()`, `state.currentWindowId`.

- [ ] **Step 1: Failing tests — window names in `lib/session.js`**

Append to `test/session.test.js`:

```js
test("buildSession carries a trimmed window name from windowNames and omits blank or missing ones", () => {
  const s = S.buildSession({
    windows: [win({ id: 1, tabs: [tab({ id: 1 })] }), win({ id: 2, tabs: [tab({ id: 2 })] }), win({ id: 3, tabs: [tab({ id: 3 })] })],
    groups: [],
    windowNames: { 1: "  Research  ", 2: "   " },
  });
  assert.equal(s.windows[0].windowName, "Research");
  assert.equal("windowName" in s.windows[1], false);
  assert.equal("windowName" in s.windows[2], false);
});

test("setWindowName sets, clears, caps at 60 characters and drops names of closed windows", () => {
  const names = S.setWindowName({ 1: "Old", 9: "Gone" }, 2, " Work ", [1, 2]);
  assert.deepEqual(names, { 1: "Old", 2: "Work" });
  assert.deepEqual(S.setWindowName(names, 1, "  ", [1, 2]), { 2: "Work" });
  assert.equal(S.setWindowName({}, 3, "x".repeat(80))["3"].length, 60);
  assert.deepEqual(names, { 1: "Old", 2: "Work" }, "input untouched");
});

test("stripVolatile keeps a window name, so a rename is a real change, and adds nothing when unnamed", () => {
  const w = win({ id: 1, tabs: [tab({ id: 1 })] });
  const plain = S.stripVolatile(S.buildSession({ windows: [w], groups: [] }));
  const named = S.stripVolatile(S.buildSession({ windows: [w], groups: [], windowNames: { 1: "Work" } }));
  assert.deepEqual(Object.keys(plain.windows[0]), ["id", "type", "incognito", "groups", "tabs"]);
  assert.equal(named.windows[0].windowName, "Work");
  assert.notEqual(JSON.stringify(plain), JSON.stringify(named));
});
```

Run `npm test`: these three fail (`setWindowName` is not a function, `windowName` undefined).

- [ ] **Step 2: Implement in `lib/session.js`**

After the `mapGroup` function add:

```js
  const MAX_NAME = 60;
  function cleanName(name) {
    return typeof name === "string" ? name.trim().slice(0, MAX_NAME) : "";
  }

  // names: { [windowId]: name } as kept in chrome.storage.session. Returns a new map with
  // `name` set for `windowId` (removed when blank); with liveIds, names of windows that are
  // no longer open are dropped so the map cannot grow without bound.
  function setWindowName(names, windowId, name, liveIds = null) {
    const keep = liveIds ? new Set(liveIds.map(String)) : null;
    const out = {};
    for (const [key, value] of Object.entries(names || {})) {
      if (keep && !keep.has(key)) continue;
      const clean = cleanName(value);
      if (clean) out[key] = clean;
    }
    const key = String(windowId);
    const clean = cleanName(name);
    if (clean) out[key] = clean;
    else delete out[key];
    return out;
  }
```

Change the `buildSession` signature to:

```js
  function buildSession({ windows = [], groups = [], now = Date.now(), browser = null, excludeUrlPrefix = "", windowNames = {} } = {}) {
```

and replace its `out.push({ ... });` statement with:

```js
      const entry = {
        id: w.id,
        type: w.type || "normal",
        state: w.state || "normal",
        focused: Boolean(w.focused),
        incognito: Boolean(w.incognito),
        bounds: { left: w.left ?? 0, top: w.top ?? 0, width: w.width ?? 0, height: w.height ?? 0 },
        groups: (groupsByWindow.get(w.id) || []).filter((g) => usedGroups.has(g.id)),
        tabs,
      };
      const nameKey = String(w.id);
      const name = windowNames && Object.hasOwn(windowNames, nameKey) ? cleanName(windowNames[nameKey]) : "";
      if (name) entry.windowName = name;
      out.push(entry);
```

Replace the `windows:` mapping inside `stripVolatile` so it reads:

```js
      windows: (session.windows || []).map((w) => {
        const c = {
          id: w.id, type: w.type, incognito: w.incognito,
          groups: w.groups.map((g) => ({ ...g })),
          tabs: w.tabs.map((t) => { const x = { ...t }; for (const k of VOLATILE_TAB) delete x[k]; return x; }),
        };
        if (w.windowName) c.windowName = w.windowName;
        return c;
      }).slice().sort((a, b) => a.id - b.id),
```

Change the return line to `return { buildSession, countTabs, stripVolatile, setWindowName };`. Run `npm test`: 26 pass.

- [ ] **Step 3: Failing test — `windowName` through export and import**

Append to `test/exporters.test.js`:

```js
test("windowName is optional: kept through export and import, dropped when blank or not a string", () => {
  const s = buildSession({ windows: [win({ id: 1, tabs: [tab({ id: 1 })] }), win({ id: 2, tabs: [tab({ id: 2 })] })], groups: [], windowNames: { 1: "Research" } });
  const back = parseImport(toJsonFile(s, { now: 1, version: "1.1.0" }).text);
  assert.equal(back.windows[0].windowName, "Research");
  assert.equal("windowName" in back.windows[1], false);
  const odd = parseImport(JSON.stringify({ schema: 1, windows: [
    { windowName: 42, tabs: [{ url: "https://a.com/" }] },
    { windowName: "   ", tabs: [{ url: "https://b.com/" }] },
    { windowName: ` ${"y".repeat(70)} `, tabs: [{ url: "https://c.com/" }] },
  ] }));
  assert.equal("windowName" in odd.windows[0], false);
  assert.equal("windowName" in odd.windows[1], false);
  assert.equal(odd.windows[2].windowName, "y".repeat(60));
});
```

Run `npm test`: fails on `odd.windows[0]`.

- [ ] **Step 4: Implement in `lib/exporters.js`**

In `parseImport`, directly after `if (!Array.isArray(w.groups)) w.groups = [];` add:

```js
      if ("windowName" in w) {
        const name = typeof w.windowName === "string" ? w.windowName.trim().slice(0, 60) : "";
        if (name) w.windowName = name;
        else delete w.windowName;
      }
```

`toJsonFile` needs no change: the session it is given already carries `windowName`. Run `npm test`: 27 pass.

- [ ] **Step 5: Failing test — restore re-applies names**

Append to `test/restore-plan.test.js`:

```js
test("a named window gets a nameWindow step right after createWindow; unnamed windows get none", () => {
  const named = { schema: 1, windows: [{ ...session.windows[0], windowName: "Work" }] };
  const { steps } = planRestore(named, { selectedWindowIds: [1], allowIncognito: false, screen: { width: 1920, height: 1080 } });
  assert.equal(steps[0].op, "createWindow");
  assert.deepEqual(steps[1], { op: "nameWindow", windowRef: "w1", name: "Work" });
  const plain = planRestore(session, { selectedWindowIds: [1], allowIncognito: false, screen: { width: 1920, height: 1080 } });
  assert.ok(!plain.steps.some((s) => s.op === "nameWindow"));
});
```

Run `npm test`: fails.

- [ ] **Step 6: Implement in `lib/restore-plan.js`**

Directly after the `steps.push({ op: "createWindow", ... });` line add:

```js
      const name = typeof w.windowName === "string" ? w.windowName.trim() : "";
      if (name) steps.push({ op: "nameWindow", windowRef: wref, name });
```

Run `npm test`: 28 pass.

- [ ] **Step 7: `lib/ui.js` and its test (the header counter)**

Create `test/ui.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { formatCounts } = require("../lib/ui.js");

test("formatCounts: windows and tabs; a search shows matched of total; a selection is appended", () => {
  assert.equal(formatCounts({ windows: 3, tabs: 27 }), "3 win · 27 tabs");
  assert.equal(formatCounts({ windows: 3, tabs: 27, selected: 4 }), "3 win · 27 tabs · 4 sel");
  assert.equal(formatCounts({ windows: 3, tabs: 27, shown: 4 }), "3 win · 4 of 27 tabs");
  assert.equal(formatCounts({ windows: 3, tabs: 27, shown: 0, selected: 2 }), "3 win · 0 of 27 tabs · 2 sel");
  assert.equal(formatCounts({ windows: 1, tabs: 1 }), "1 win · 1 tab");
});
```

Create `lib/ui.js`:

```js
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  // Header counter: "3 win · 27 tabs · 4 sel"; while searching, "3 win · 4 of 27 tabs".
  // shown is null when no search is active.
  function formatCounts({ windows = 0, tabs = 0, shown = null, selected = 0 } = {}) {
    const noun = tabs === 1 ? "tab" : "tabs";
    const parts = [`${windows} win`, shown === null ? `${tabs} ${noun}` : `${shown} of ${tabs} ${noun}`];
    if (selected > 0) parts.push(`${selected} sel`);
    return parts.join(" · ");
  }

  return { formatCounts };
});
```

Run `npm test`: 29 pass.

- [ ] **Step 8: `background.js` — snapshots carry names; a rename is a change**

Replace the `return self.TabVault.buildSession(...)` line in `captureSession` with:

```js
  const { windowNames = {} } = await chrome.storage.session.get("windowNames").catch(() => ({}));
  return self.TabVault.buildSession({ windows, groups, now: Date.now(), browser: { name: "Chrome", version, os: info && info.os }, excludeUrlPrefix: OWN_PREFIX, windowNames });
```

Directly after the `if (chrome.tabGroups) for (...) ev.addListener(onChange);` line add:

```js
// A window rename is a user change, like a group rename: schedule a snapshot for it.
chrome.storage.onChanged.addListener((changes, area) => { if (area === "session" && changes.windowNames) onChange(); });
```

- [ ] **Step 9: `app/index.html` — header and main**

Replace the whole `<div id="toolbar">...</div>` block (1.0 lines 77-88) with:

```html
  <header id="toolbar">
    <span class="brand"><img src="../icons/icon48.png" alt="">TabVault</span>
    <div class="search-wrap">
      <input type="search" id="search" placeholder="Search tabs" aria-label="Search tabs" autocomplete="off" />
      <kbd aria-hidden="true">/</kbd>
    </div>
    <span id="counts" aria-live="polite"></span>
    <button id="btn-dupes" type="button" class="primary">Find duplicates</button>
    <button id="btn-snapshots" type="button">Snapshots</button>
    <div class="menu-wrap">
      <button id="btn-more" type="button" class="icon" title="More: export, import, settings, help" aria-label="More: export, import, settings, help" aria-haspopup="menu" aria-expanded="false" aria-controls="more-menu">⋯</button>
      <div id="more-menu" class="menu" role="menu" hidden>
        <button id="btn-export" type="button" role="menuitem">Export</button>
        <button id="btn-import" type="button" role="menuitem">Import</button>
        <button id="btn-settings" type="button" role="menuitem">Settings</button>
        <button id="btn-help" type="button" role="menuitem">Help</button>
      </div>
    </div>
    <input type="file" id="import-file" accept="application/json,.json" hidden />
  </header>
```

Replace `<div id="grid"></div>` with:

```html
  <main id="main"><div id="grid"></div></main>
```

(`#selbar` stays where it is until Task 4.) Add `<script src="../lib/ui.js"></script>` directly after the `restore-plan.js` script tag.

Replace section `header` with:

```css
    #toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: var(--g2); border-bottom: 1px solid var(--l); flex-wrap: wrap; position: relative; z-index: 3; }
    #toolbar .brand { display: flex; align-items: center; gap: 6px; margin-right: 6px; font: 500 13px var(--mono); font-synthesis: none; letter-spacing: .02em; }
    #toolbar .brand img { width: 18px; height: 18px; }
    .search-wrap { position: relative; flex: 1; min-width: 220px; max-width: 560px; display: flex; }
    #search { flex: 1; padding-right: 30px; background: var(--g); }
    .search-wrap kbd { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--t2); }
    #counts { margin-right: auto; font: 500 11px var(--mono); font-synthesis: none; color: var(--t2); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .menu-wrap { position: relative; }
    .menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 10; min-width: 180px; display: flex; flex-direction: column; padding: 4px; color: var(--t); background: var(--g2); border: 1px solid var(--l); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, .16); }
    .menu button { text-align: left; background: transparent; border: 0; border-radius: 5px; padding: 6px 10px; white-space: nowrap; }
    .menu button:hover, .menu button:focus-visible { background: var(--g3); }
```

Replace section `windows` with:

```css
    #main { flex: 1; min-height: 0; overflow: auto; padding: 16px; display: flex; flex-direction: column; }
    #grid { flex: 1 0 auto; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start; align-content: start; }
    @media (min-width: 720px) { #grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (min-width: 1100px) { #grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    .window { min-width: 0; display: flex; flex-direction: column; background: var(--g2); border: 1px solid var(--l); border-radius: 10px; }
    .window.current { border-color: var(--p); box-shadow: 0 0 0 1px var(--p); }
    .window.drop { outline: 2px dashed var(--p); outline-offset: 2px; }
    .window.incognito .whead { background: #2A2B3D; color: #EDEFF2; border-radius: 10px 10px 0 0; }
    .whead { display: flex; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--l); }
    .whead .wname { flex: 1; min-width: 0; font: 500 13px var(--mono); font-synthesis: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .whead .wname.unnamed { font: 400 12.5px var(--sans); color: var(--t2); }
    .whead input.wname-edit { flex: 1; min-width: 0; padding: 2px 6px; font: 500 13px var(--mono); font-synthesis: none; }
    .whead .count { font: 500 11px var(--mono); font-synthesis: none; color: var(--t2); font-variant-numeric: tabular-nums; padding: 0 2px; }
    .tag-current { flex: none; padding: 1px 5px; border-radius: 4px; font: 500 10px var(--mono); font-synthesis: none; letter-spacing: .06em; color: var(--pText); background: var(--pSoft); }
    .tabs { padding: 4px 0; }
    .window.collapsed .tabs { display: none; }
    #empty { grid-column: 1 / -1; margin: 64px auto; display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--t2); text-align: center; }
    #empty p { margin: 0; }
    #empty .links { display: flex; gap: 8px; }
```

- [ ] **Step 10: `app/app.js` — state, session, helpers**

In `state`, after `renderPending: false,` add `currentWindowId: null,`.

Replace everything from `async function readSession() {` through the closing `}` of `refresh` (this span includes the `let refreshTimer = null;` line between them) with:

```js
  async function readSession() {
    const windows = await chrome.windows.getAll({ populate: true });
    const groups = chrome.tabGroups ? await chrome.tabGroups.query({}) : [];
    const { windowNames = {} } = await chrome.storage.session.get("windowNames").catch(() => ({}));
    return TV.buildSession({ windows, groups, now: Date.now(), excludeUrlPrefix: OWN_PREFIX, windowNames });
  }

  let refreshTimer = null;
  async function refresh() {
    const [session, own] = await Promise.all([readSession(), chrome.tabs.getCurrent().catch(() => null)]);
    state.session = session;
    state.currentWindowId = own ? own.windowId : null;
    const live = new Set(state.session.windows.flatMap((w) => w.tabs.map((t) => t.id)));
    for (const id of state.selected) if (!live.has(id)) state.selected.delete(id);
    if (state.cursor !== null && !live.has(state.cursor)) state.cursor = null;
    render();
  }
```

(The `scheduleRefresh` line that follows `refresh` stays as it is.)

Directly after the `el` function add:

```js
  // Every glyph-only button gets the same text as its tooltip and its accessible name.
  function iconButton(glyph, label, onclick, extraClass = "") {
    return el("button", { type: "button", class: extraClass ? `icon ${extraClass}` : "icon", title: label, "aria-label": label, onclick }, glyph);
  }
```

Directly after the `windowTitle` function add:

```js
  function windowLabel(w) {
    return w.windowName || windowTitle(w);
  }
```

- [ ] **Step 11: `app/app.js` — window cards, CURRENT, rename**

Replace the whole `windowColumn` function with:

```js
  function windowColumn(w) {
    const dropTarget = w.type === "normal";
    const collapsed = state.collapsedWindows.has(w.id);
    const current = w.id === state.currentWindowId;
    const col = el("section", {
      class: `window${w.incognito ? " incognito" : ""}${collapsed ? " collapsed" : ""}${dropTarget ? "" : " nodrop"}${current ? " current" : ""}`,
      "aria-label": `Window ${windowLabel(w)}`,
      dataset: { window: String(w.id) },
    });
    let head;
    if (state.confirmClose === w.id) {
      const full = state.session.windows.find((x) => x.id === w.id) || w;
      const confirmBtn = el("button", { type: "button", class: "danger", onclick: () => { chrome.windows.remove(w.id).catch((e) => toast(`Could not close: ${e.message || e}`)); state.confirmClose = null; } }, `Close ${full.tabs.length} tabs`);
      const cancel = el("button", { type: "button", onclick: () => { state.confirmClose = null; render(); } }, "Cancel");
      head = el("div", { class: "whead" }, confirmBtn, cancel);
    } else {
      const name = el("span", { class: w.windowName ? "wname" : "wname unnamed", title: windowTitle(w) }, (w.incognito ? "🕶 " : "") + windowLabel(w));
      head = el("div", { class: "whead" },
        iconButton(collapsed ? "▸" : "▾", collapsed ? "Expand window" : "Collapse window", () => { collapsed ? state.collapsedWindows.delete(w.id) : state.collapsedWindows.add(w.id); render(); }),
        name,
        current ? el("span", { class: "tag-current", title: "TabVault is open in this window" }, "CURRENT") : null,
        el("span", { class: "count", title: `${w.tabs.length} tabs` }, String(w.tabs.length)),
        iconButton("✎", "Rename window", () => renameWindow(w, name)),
        iconButton("☑", "Select all in window", () => { for (const t of w.tabs) state.selected.add(t.id); render(); }),
        iconButton("⤴", "Focus window", () => chrome.windows.update(w.id, { focused: true }).catch((e) => toast(`Could not focus: ${e.message || e}`))),
        iconButton("×", "Close window", () => { state.confirmClose = w.id; render(); }, "danger"));
    }
    const body = el("div", { class: "tabs" });
    // Render in index order, wrapping consecutive tabs of a group in a section.
    let i = 0;
    while (i < w.tabs.length) {
      const t = w.tabs[i];
      if (t.groupId === null) { body.append(tabRow(w, t)); i++; continue; }
      const g = w.groups.find((x) => x.id === t.groupId) || { id: t.groupId, title: "", color: "grey", collapsed: false };
      const members = [];
      while (i < w.tabs.length && w.tabs[i].groupId === t.groupId) members.push(w.tabs[i++]);
      body.append(groupSection(w, g, members));
    }
    col.append(head, body);
    if (dropTarget) {
      col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drop"); });
      col.addEventListener("dragleave", () => col.classList.remove("drop"));
      col.addEventListener("drop", (e) => { e.preventDefault(); col.classList.remove("drop"); dropTabs(e, { windowId: w.id, index: -1, groupId: null }); });
    }
    return col;
  }
```

Directly after the `renameGroup` function add:

```js
  // Inline rename: Enter or blur saves, Escape cancels. The name lives in
  // chrome.storage.session (see saveWindowName); storage.onChanged refreshes the page.
  function renameWindow(w, nameEl) {
    state.editing = true;
    const input = el("input", { type: "text", class: "wname-edit", value: w.windowName || "", placeholder: windowTitle(w), maxlength: "60", "aria-label": "Window name" });
    let settled = false;
    const finish = async (save) => {
      if (settled) return;
      settled = true;
      try {
        if (save) await saveWindowName(w.id, input.value);
      } catch (e) {
        toast(`Could not rename: ${(e && e.message) || e}`);
      } finally {
        state.editing = false;
        await refresh().catch(console.error);
      }
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    nameEl.replaceWith(input);
    input.focus(); input.select();
  }

  async function saveWindowName(windowId, name) {
    const { windowNames = {} } = await chrome.storage.session.get("windowNames");
    const live = state.session.windows.map((x) => x.id);
    await chrome.storage.session.set({ windowNames: TV.setWindowName(windowNames, windowId, name, live) });
  }
```

- [ ] **Step 12: `app/app.js` — render, counter, empty states**

Replace the whole `render` function with:

```js
  function render() {
    if (state.editing) return;
    const active = document.activeElement;
    if (active && active.tagName === "SELECT" && (active.closest("#grid") || active.closest("#selbar"))) {
      state.renderPending = true;
      return;
    }
    state.renderPending = false;
    const main = $("main");
    const scrollTop = main.scrollTop;
    const filtered = TV.filterSession(state.session, state.query);
    const grid = $("grid");
    grid.replaceChildren();
    if (filtered.windows.length === 0) grid.append(emptyState());
    else for (const w of filtered.windows) grid.append(windowColumn(w));
    main.scrollTop = scrollTop;
    $("counts").textContent = TV.formatCounts({
      windows: state.session.windows.length,
      tabs: TV.countTabs(state.session),
      shown: state.query.trim() ? filtered.count : null,
      selected: state.selected.size,
    });
    renderSelbar();
  }

  function clearSearch() {
    state.query = "";
    $("search").value = "";
    render();
  }

  function emptyState() {
    const q = state.query.trim();
    if (q) {
      return el("div", { id: "empty" },
        el("p", {}, "Nothing matches ", el("span", { class: "mono" }, `“${q}”`)),
        el("button", { type: "button", onclick: clearSearch }, "Clear search"));
    }
    return el("div", { id: "empty" },
      el("p", {}, "No other windows are open. TabVault lists every tab except its own."),
      el("div", { class: "links" },
        el("button", { type: "button", onclick: () => openDialog("snapshots") }, "Snapshots"),
        el("button", { type: "button", onclick: () => $("import-file").click() }, "Import")));
  }
```

In `renderSelbar`, change `${windowTitle(w).slice(0, 40)}` to `${windowLabel(w).slice(0, 40)}` (the 1.0 select stays until Task 4).

- [ ] **Step 13: `app/app.js` — menus**

Directly after the `toast` function add:

```js
  // ---- menus ---------------------------------------------------------------------
  // A menu is a `.menu` element; its trigger button names it with aria-controls.
  function menuButton(menu) {
    return document.querySelector(`[aria-controls="${menu.id}"]`);
  }
  // Closes every open menu; returns whether one was open (Escape uses this).
  function closeMenus(refocus = false) {
    let wasOpen = false;
    for (const menu of document.querySelectorAll(".menu")) {
      if (menu.hidden) continue;
      wasOpen = true;
      menu.hidden = true;
      const button = menuButton(menu);
      if (button) {
        button.setAttribute("aria-expanded", "false");
        if (refocus) button.focus();
      }
    }
    return wasOpen;
  }
  function toggleMenu(menuId, fill) {
    const menu = $(menuId);
    const opening = menu.hidden;
    closeMenus();
    if (!opening) return;
    if (fill) fill(menu);
    menu.hidden = false;
    const button = menuButton(menu);
    if (button) button.setAttribute("aria-expanded", "true");
    const first = menu.querySelector("button");
    if (first) first.focus();
  }
```

At the very top of the `keydown` listener body (before `const inField = ...`) add:

```js
    if (e.key === "Escape" && closeMenus(true)) { e.preventDefault(); return; }
```

In `wire()`, directly after the `$("btn-help")` listener line add:

```js
    $("btn-more").addEventListener("click", (e) => { e.stopPropagation(); toggleMenu("more-menu"); });
    $("more-menu").addEventListener("click", () => closeMenus());
    document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) closeMenus(); });
    chrome.storage.onChanged.addListener((changes, area) => { if (area === "session" && changes.windowNames) scheduleRefresh(); });
```

- [ ] **Step 14: `app/dialogs.js` — restore re-applies names; the import list shows them**

In `restoreSession`, directly after `let discardFailures = 0;` add `const names = {};`. Add this case before `default: break;` in the `switch`:

```js
          case "nameWindow":
            if (failedWindows.has(step.windowRef) || ids.get(step.windowRef) === undefined) break;
            names[ids.get(step.windowRef)] = step.name;
            break;
```

Directly after the `for (const step of steps) { ... }` loop (before `if (discardFailures) ...`) add:

```js
    if (Object.keys(names).length) {
      try {
        const { windowNames = {} } = await chrome.storage.session.get("windowNames");
        await chrome.storage.session.set({ windowNames: { ...windowNames, ...names } });
      } catch (e) {
        result.errors.push(`window names: ${(e && e.message) || e}`);
      }
    }
```

In `showRestore`, replace the row label expression `` `${w.incognito ? "🕶 " : ""}${(w.tabs[0] && (w.tabs[0].title || w.tabs[0].url)) || "(empty)"}` `` with:

```js
      el("span", {}, `${w.incognito ? "🕶 " : ""}${w.windowName || (w.tabs[0] && (w.tabs[0].title || w.tabs[0].url)) || "(empty)"}`),
```

(replacing that whole `el("span", {}, ...)` argument line).

- [ ] **Step 15: `e2e/run.js` — the counter's new wording and the ⋯ menu**

Directly after the `clearSelection` helper function add:

```js
    // Export, Import, Settings and Help live in the header's "⋯" menu since 1.1.
    async function openMenuItem(selector) {
      await appPage.click("#btn-more");
      await appPage.click(selector);
    }
```

Scenario A: change `` countsText === `${expected.winCount} windows · ${expected.tabCount} tabs`, `` to `` countsText === `${expected.winCount} win · ${expected.tabCount} tabs`, ``.

Scenario B: replace the two lines

```js
      const countsText = await waitForTextContains(appPage, "#counts", "of");
      assert(countsText === `1 of ${expected.tabCount} tabs`, `counts text after search = "${countsText}"`);
```

with

```js
      const countsText = await waitForTextContains(appPage, "#counts", " of ");
      assert(countsText === `${expected.winCount} win · 1 of ${expected.tabCount} tabs`, `counts text after search = "${countsText}"`);
```

and change `` assert(countsAfter === `${expected.winCount} windows · ${expected.tabCount} tabs`, `` to `` assert(countsAfter === `${expected.winCount} win · ${expected.tabCount} tabs`, ``.

Scenario H: `await appPage.click("#btn-export");` becomes `await openMenuItem("#btn-export");`. Both occurrences of `await appPage.click("#btn-settings");` (in `setLazyRestore` and scenario L) become `await openMenuItem("#btn-settings");`.

- [ ] **Step 16: Gates and e2e**

```bash
npm run lint
npm test
npm run pack
npm run e2e
```

Expected: 0 lint errors; 29 tests pass; pack succeeds; e2e 13 scenarios, all PASS except I-b PASS or LIMITED (foreground, 600000 ms timeout, several minutes under OneDrive).

- [ ] **Step 17: Look at it** — reload the unpacked extension. The header shows the brand in mono, the search field with a `/` key cap, `N win · N tabs`, amber Find duplicates, Snapshots and `⋯` (Export, Import, Settings, Help). Windows are cards, three per row on a wide screen, two at 720-1099 px, one below. The window holding TabVault (give it a second tab) has an amber ring and `CURRENT`. Pencil, type a name, Enter: the name shows in mono and survives a page reload; Escape cancels; clearing the text removes it. Export a file and confirm `windowName` on that window.

- [ ] **Step 18: Commit**

```bash
git add lib/ui.js test/ui.test.js lib/session.js lib/exporters.js lib/restore-plan.js background.js app/index.html app/app.js app/dialogs.js test/session.test.js test/exporters.test.js test/restore-plan.test.js e2e/run.js && git commit lib/ui.js test/ui.test.js lib/session.js lib/exporters.js lib/restore-plan.js background.js app/index.html app/app.js app/dialogs.js test/session.test.js test/exporters.test.js test/restore-plan.test.js e2e/run.js -m "Console header, window cards, CURRENT mark and window names" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UNR1Jj1F1e65B68YPwVuUj"
```

---

## Task 3 — Groups (colour dots) and tab rows (favicon fallback, domain, flags, active bar)

**Files:**
- Modify: `lib/ui.js`, `test/ui.test.js`, `app/index.html`, `app/app.js`, `e2e/run.js`

**Interfaces:**
- Produces: `TabVault.domainOf(url) -> string`, `TabVault.faviconColor(domain) -> one of FAVICON_COLORS`, `TabVault.faviconLetter(domain) -> string`, `TabVault.FAVICON_COLORS` (eight hex strings), `TabVault.duplicateIds(findDuplicatesResult) -> Set<tabId>`.
- DOM: `.group[data-group]` with `.ghead` (`--gcolor` custom property, 3 px left bar) holding `button.gdot`, `.gtitle`, `.gcount`, icon buttons "Rename group", "Ungroup", "Collapse group"/"Expand group"; while picking, `.swatches` with eight `button.swatch[data-color]` in the order grey, blue, red, yellow, green, pink, purple, cyan. Tab rows `.tab[data-tab][data-window][tabindex="-1"]` hold a checkbox, `.fav` (an `img`, or a `span.fav.letter` badge), `.text > .ttitle + .turl`, `.domain`, `.flags`, `button.close`; `.tab.active` draws the 3 px `--p` bar.
- State: `state.colorPickerFor` (group id or null), `state.dupes` (Set, recomputed every render).

- [ ] **Step 1: Failing tests — replace `test/ui.test.js` with**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { tab, win } = require("./fake-data.js");
const { buildSession } = require("../lib/session.js");
const { findDuplicates } = require("../lib/dedupe.js");
const { formatCounts, domainOf, faviconColor, faviconLetter, FAVICON_COLORS, duplicateIds } = require("../lib/ui.js");

test("formatCounts: windows and tabs; a search shows matched of total; a selection is appended", () => {
  assert.equal(formatCounts({ windows: 3, tabs: 27 }), "3 win · 27 tabs");
  assert.equal(formatCounts({ windows: 3, tabs: 27, selected: 4 }), "3 win · 27 tabs · 4 sel");
  assert.equal(formatCounts({ windows: 3, tabs: 27, shown: 4 }), "3 win · 4 of 27 tabs");
  assert.equal(formatCounts({ windows: 3, tabs: 27, shown: 0, selected: 2 }), "3 win · 0 of 27 tabs · 2 sel");
  assert.equal(formatCounts({ windows: 1, tabs: 1 }), "1 win · 1 tab");
});

test("domainOf: bare host for web pages, scheme and host for browser pages, scheme alone otherwise", () => {
  assert.equal(domainOf("https://www.Example.com/a?b#c"), "example.com");
  assert.equal(domainOf("http://docs.example.com:8080/x"), "docs.example.com");
  assert.equal(domainOf("chrome://extensions/"), "chrome://extensions");
  assert.equal(domainOf("file:///C:/notes.txt"), "file");
  assert.equal(domainOf("about:blank"), "about");
  assert.equal(domainOf("not a url"), "");
});

test("faviconColor maps a domain to one of eight fixed colours, stably and case-insensitively", () => {
  assert.equal(FAVICON_COLORS.length, 8);
  const letters = ["a", "b", "c", "d", "e", "f", "g", "h"].map(faviconColor);
  assert.deepEqual([...new Set(letters)].sort(), [...FAVICON_COLORS].sort(), "a-h cover all eight colours");
  assert.equal(faviconColor("example.com"), "#475569");
  assert.equal(faviconColor("github.com"), "#C2410C");
  assert.equal(faviconColor("GitHub.COM"), faviconColor("github.com"));
  assert.equal(faviconLetter("docs.example.com"), "D");
  assert.equal(faviconLetter("chrome://extensions"), "C");
  assert.equal(faviconLetter(""), "?");
});

test("duplicateIds flags every copy the duplicate finder would close, never the kept one", () => {
  const s = buildSession({ windows: [
    win({ id: 1, tabs: [tab({ id: 1, url: "https://a.com/x#1", lastAccessed: 10 }), tab({ id: 2, url: "https://a.com/x#2", lastAccessed: 30 }), tab({ id: 3, url: "https://b.com/" })] }),
    win({ id: 2, tabs: [tab({ id: 4, url: "https://A.com/x/", lastAccessed: 20 })] }),
  ], groups: [] });
  assert.deepEqual([...duplicateIds(findDuplicates(s, { ignoreHash: true }))].sort((a, b) => a - b), [1, 4]);
  assert.equal(duplicateIds(findDuplicates(s, { ignoreHash: false })).size, 0);
  assert.equal(duplicateIds([]).size, 0);
});
```

Run `npm test`: the three new tests fail.

- [ ] **Step 2: Replace `lib/ui.js` with**

```js
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  // Header counter: "3 win · 27 tabs · 4 sel"; while searching, "3 win · 4 of 27 tabs".
  // shown is null when no search is active.
  function formatCounts({ windows = 0, tabs = 0, shown = null, selected = 0 } = {}) {
    const noun = tabs === 1 ? "tab" : "tabs";
    const parts = [`${windows} win`, shown === null ? `${tabs} ${noun}` : `${shown} of ${tabs} ${noun}`];
    if (selected > 0) parts.push(`${selected} sel`);
    return parts.join(" · ");
  }

  // What a tab row shows in mono on the right: "example.com" for web pages (no "www."),
  // "chrome://extensions" for browser pages, "file" / "about" / "data" otherwise.
  function domainOf(url) {
    let u;
    try { u = new URL(url); } catch { return ""; }
    const host = u.hostname.toLowerCase();
    if (u.protocol === "http:" || u.protocol === "https:") return host.startsWith("www.") ? host.slice(4) : host;
    if (host) return `${u.protocol}//${host}`;
    return u.protocol.slice(0, -1);
  }

  // Letter-badge colours for tabs without a favicon. Each has at least 4.5:1 contrast
  // with the white letter drawn on it, in both themes.
  const FAVICON_COLORS = ["#2F6FDE", "#C2410C", "#0F766E", "#7C3AED", "#BE185D", "#15803D", "#475569", "#A16207"];

  // FNV-1a over the lower-cased domain: the same site always gets the same colour.
  function faviconColor(domain) {
    const s = String(domain || "").toLowerCase();
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return FAVICON_COLORS[h % FAVICON_COLORS.length];
  }

  function faviconLetter(domain) {
    const m = String(domain || "").match(/[a-z0-9]/i);
    return m ? m[0].toUpperCase() : "?";
  }

  // groups: the result of findDuplicates(). The ids are every copy it would close,
  // that is every tab of a duplicated URL except the one it keeps.
  function duplicateIds(groups) {
    const out = new Set();
    for (const g of groups || []) for (const x of g.tabs) if (x.tab.id !== g.keepId) out.add(x.tab.id);
    return out;
  }

  return { formatCounts, domainOf, FAVICON_COLORS, faviconColor, faviconLetter, duplicateIds };
});
```

Run `npm test`: 32 pass.

- [ ] **Step 3: Styles — replace section `groups` with**

```css
    .group { margin: 4px 4px 2px; border-radius: 6px; }
    .group.drop { outline: 2px dashed var(--p); outline-offset: 1px; }
    .ghead { display: flex; align-items: center; gap: 6px; padding: 3px 4px 3px 8px; background: var(--g3); border-left: 3px solid var(--gcolor); border-radius: 5px; font-weight: 500; }
    .ghead .gtitle { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ghead input[type=text] { flex: 1; min-width: 0; padding: 1px 6px; }
    .gcount { font-size: 11px; color: var(--t2); font-variant-numeric: tabular-nums; }
    .ghead .gdot, .ghead .gdot:hover { flex: none; width: 12px; height: 12px; padding: 0; border: 0; border-radius: 50%; background: var(--gcolor); }
    .swatches { display: flex; flex-wrap: wrap; gap: 8px; padding: 7px 10px 7px 14px; }
    .swatches .swatch, .swatches .swatch:hover { width: 12px; height: 12px; padding: 0; border: 0; border-radius: 50%; background: var(--sw); }
    .swatches .swatch.on { box-shadow: 0 0 0 2px var(--g2), 0 0 0 4px var(--sw); }
    .ghead .gdot:hover, .swatches .swatch:hover { transform: scale(1.2); }
    .group .tab { margin-left: 12px; }
    .group.collapsed .tab { display: none; }
```

Replace section `tabs` with:

```css
    .tab { position: relative; display: flex; align-items: center; gap: 8px; height: var(--row); padding: 0 6px 0 10px; margin: 0 4px; border-radius: 5px; cursor: pointer; }
    .tab:hover { background: var(--g3); }
    .tab.selected { background: var(--pSoft); }
    .tab.cursor { outline: 1px solid var(--p); outline-offset: -1px; }
    .tab:focus-visible { outline: 2px solid var(--p); outline-offset: -2px; }
    .tab.active::before { content: ""; position: absolute; left: 0; top: 4px; bottom: 4px; width: 3px; border-radius: 2px; background: var(--p); }
    .tab.active .ttitle { font-weight: 500; }
    .tab.discarded .ttitle { color: var(--t2); }
    .tab input[type=checkbox] { margin: 0; flex: none; }
    .fav { flex: none; width: 16px; height: 16px; border-radius: 3px; }
    .fav.letter { display: inline-flex; align-items: center; justify-content: center; background: var(--fav); color: #FFFFFF; font: 600 10px/1 var(--sans); }
    .tab .text { flex: 1; min-width: 0; }
    .tab .ttitle { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tab .turl { display: none; color: var(--t2); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    :root[data-show-urls="true"] .tab { height: auto; padding-block: 3px; }
    :root[data-show-urls="true"] .tab .turl { display: block; }
    .tab .domain { flex: none; max-width: 38%; font-size: 11px; color: var(--t2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .flags { flex: none; display: flex; align-items: center; gap: 4px; font-size: 11px; }
    .flags:empty { display: none; }
    .flag.mono { font-size: 10px; color: var(--t2); }
    .flag.dup { color: var(--danger); }
    .tab .close { visibility: hidden; }
    .tab:hover .close, .tab:focus-within .close, .tab.cursor .close { visibility: visible; }
    .tab.dragover { box-shadow: inset 0 2px 0 var(--p); }
```

- [ ] **Step 4: `app/app.js` — state and constants**

In `state`, after `currentWindowId: null,` add:

```js
    colorPickerFor: null,
    dupes: new Set(),
```

Directly after the `GROUP_COLORS` line add:

```js
  // The picker offers the spec's eight; an existing orange group still renders orange.
  const PICKER_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan"];
```

In `render()`, directly after the `const filtered = TV.filterSession(state.session, state.query);` line add:

```js
    state.dupes = TV.duplicateIds(TV.findDuplicates(state.session, { ignoreHash: state.settings.ignoreHash !== false }));
```

- [ ] **Step 5: `app/app.js` — tab rows**

Replace the whole `tabRow` function with:

```js
  function favicon(t, domain) {
    const badge = el("span", { class: "fav letter", style: `--fav:${TV.faviconColor(domain)}`, "aria-hidden": "true" }, TV.faviconLetter(domain));
    if (!t.favIconUrl) return badge;
    const img = el("img", { class: "fav", src: t.favIconUrl, alt: "" });
    img.addEventListener("error", () => img.replaceWith(badge), { once: true });
    return img;
  }

  function tabRow(w, t) {
    const selected = state.selected.has(t.id);
    const domain = TV.domainOf(t.url);
    const row = el("div", {
      class: `tab${selected ? " selected" : ""}${state.cursor === t.id ? " cursor" : ""}${t.active ? " active" : ""}${t.discarded ? " discarded" : ""}`,
      draggable: "true", tabindex: "-1", title: t.url, dataset: { tab: String(t.id), window: String(w.id) },
    });
    const text = el("div", { class: "text" }, el("span", { class: "ttitle" }, t.title || t.url), el("span", { class: "turl" }, t.url));
    const flags = el("span", { class: "flags" });
    if (t.pinned) flags.append(el("span", { class: "flag", title: "Pinned" }, "📌"));
    if (t.audible && !t.muted) flags.append(el("span", { class: "flag", title: "Playing audio" }, "🔊"));
    if (t.muted) flags.append(el("span", { class: "flag", title: "Muted" }, "🔇"));
    if (t.discarded) flags.append(el("span", { class: "flag mono", title: "Unloaded: loads when you open it" }, "zz"));
    if (state.dupes.has(t.id)) flags.append(el("span", { class: "flag mono dup", title: "Duplicate: Find duplicates would close this copy" }, "dup"));
    const check = el("input", { type: "checkbox", "aria-label": `Select ${t.title || t.url}`, checked: selected ? "" : null, onclick: (e) => { e.stopPropagation(); toggleSelect(t.id, e.shiftKey, w); } });
    const close = iconButton("×", "Close tab", (e) => { e.stopPropagation(); chrome.tabs.remove(t.id).catch((err) => toast(`Could not close: ${err.message || err}`)); }, "close");
    row.append(check, favicon(t, domain), text, el("span", { class: "domain mono" }, domain), flags, close);
    row.addEventListener("click", (e) => {
      if (e.ctrlKey || e.metaKey) { toggleSelect(t.id, false, w); return; }
      if (e.shiftKey) { toggleSelect(t.id, true, w); return; }
      focusTab(t.id, w.id);
    });
    row.addEventListener("dragstart", (e) => {
      const ids = state.selected.has(t.id) ? [...state.selected] : [t.id];
      e.dataTransfer.setData("text/plain", JSON.stringify({ tabIds: ids }));
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); row.classList.add("dragover"); });
    row.addEventListener("dragleave", () => row.classList.remove("dragover"));
    row.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); row.classList.remove("dragover"); dropTabs(e, { windowId: w.id, index: t.index, groupId: t.groupId }); });
    return row;
  }
```

- [ ] **Step 6: `app/app.js` — groups and the colour dots**

Replace the whole `groupSection` function with:

```js
  function groupSection(w, g, tabs) {
    const picking = state.colorPickerFor === g.id;
    const sec = el("div", { class: `group${g.collapsed ? " collapsed" : ""}`, style: `--gcolor:${GROUP_COLORS[g.color] || GROUP_COLORS.grey}`, dataset: { group: String(g.id) } });
    const title = el("span", { class: "gtitle" }, g.title || "(unnamed group)");
    const dot = el("button", {
      type: "button", class: "gdot", title: `Colour: ${g.color}. Click to change`, "aria-label": `Group colour ${g.color}, change`, "aria-expanded": String(picking),
      onclick: () => { state.colorPickerFor = picking ? null : g.id; render(); },
    });
    const head = el("div", { class: "ghead" },
      dot,
      title,
      el("span", { class: "gcount mono", title: `${tabs.length} tabs` }, String(tabs.length)),
      iconButton("✎", "Rename group", () => renameGroup(g, title)),
      iconButton("⊟", "Ungroup", () => chrome.tabs.ungroup(tabs.map((t) => t.id)).catch((e) => toast(`Could not ungroup: ${e.message || e}`))),
      iconButton(g.collapsed ? "▸" : "▾", g.collapsed ? "Expand group" : "Collapse group", () => chrome.tabGroups.update(g.id, { collapsed: !g.collapsed }).catch((e) => toast(`Could not collapse: ${e.message || e}`))));
    sec.append(head);
    if (picking) sec.append(colorPicker(g));
    sec.append(...tabs.map((t) => tabRow(w, t)));
    sec.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); sec.classList.add("drop"); });
    sec.addEventListener("dragleave", () => sec.classList.remove("drop"));
    sec.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); sec.classList.remove("drop"); dropTabs(e, { windowId: w.id, index: -1, groupId: g.id }); });
    return sec;
  }

  function colorPicker(g) {
    return el("div", { class: "swatches", role: "group", "aria-label": "Group colour" },
      ...PICKER_COLORS.map((c) => el("button", {
        type: "button", class: c === g.color ? "swatch on" : "swatch", style: `--sw:${GROUP_COLORS[c]}`,
        title: c, "aria-label": `Colour ${c}`, "aria-pressed": String(c === g.color), dataset: { color: c },
        onclick: () => {
          state.colorPickerFor = null;
          chrome.tabGroups.update(g.id, { color: c }).catch((err) => toast(`Could not recolor: ${err.message || err}`));
          render();
        },
      })));
  }
```

- [ ] **Step 7: `e2e/run.js` — scenario F uses the dots**

In scenario F replace

```js
      await appPage.click('.group .ghead button[title="Rename"]');
```

with

```js
      await appPage.click('.group .ghead button[title="Rename group"]');
```

and replace everything from `await appPage.selectOption('.group select[title="Color"]', "blue");` through the `record("F", "PASS", ...)` line with:

```js
      const before = (await (await worker()).evaluate(() => chrome.tabGroups.query({ title: "Renamed" })))[0];
      const target = before.color === "purple" ? "cyan" : "purple";
      await appPage.click(".group .ghead .gdot");
      await appPage.click(`.group .swatches button[data-color="${target}"]`);

      const groups = await waitFor(async () => {
        const gs = await (await worker()).evaluate(() => chrome.tabGroups.query({ title: "Renamed" }));
        return gs.length === 1 && gs[0].color === target ? gs : null;
      });
      record("F", "PASS", `grouped tabs ${tabsC.map((t) => t.id).join(",")}, renamed to "Renamed", colour ${before.color} -> ${target} via the colour dots; chrome.tabGroups.query confirms ${JSON.stringify(groups)}`);
```

- [ ] **Step 8: Gates and e2e**

```bash
npm run lint
npm test
npm run pack
npm run e2e
```

Expected: 0 lint errors; 32 tests pass; pack succeeds; e2e 13 scenarios, all PASS except I-b PASS or LIMITED.

- [ ] **Step 9: Look at it** — reload the extension. Group headers show a coloured 12 px dot and a 3 px bar in the group's colour; clicking the dot opens eight dots, clicking one recolours the group in Chrome's tab strip too. Rows show the favicon or a coloured letter, the title, the domain in mono and flags on the right; open the same URL twice and one copy shows `dup` in red; the active tab of each window has the amber bar. Dark theme: all of this stays legible.

- [ ] **Step 10: Commit**

```bash
git add lib/ui.js test/ui.test.js app/index.html app/app.js e2e/run.js && git commit lib/ui.js test/ui.test.js app/index.html app/app.js e2e/run.js -m "Console groups with colour dots, tab rows with favicon fallback, domain and flags" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UNR1Jj1F1e65B68YPwVuUj"
```

---

## Task 4 — Selection mode: the floating bulk bar

**Files:**
- Modify: `app/index.html`, `app/app.js`, `e2e/run.js`

**Interfaces:**
- DOM: `#selbar` (role `toolbar`) now lives inside `#main`, after `#grid`, sticky at the bottom; it holds `#selcount`, `.menu-wrap.up > #move-btn + #move-menu.menu` (items `button[data-target]`, `"new"` or a window id), `#sel-group` (label Group or Ungroup), `#sel-pin` (Pin or Unpin), `#sel-discard`, `#sel-close`, `#sel-clear` ("Esc to clear"). `#move-target`, `#sel-ungroup` and `#sel-unpin` are gone.
- App functions: `selectedTabs()`, `fillMoveMenu(menu)`, `groupOrUngroupSelection()`, `togglePinSelection()` (Task 5's `g` key calls `groupOrUngroupSelection`).

- [ ] **Step 1: Markup**

Delete the whole 1.0 `<div id="selbar" hidden>...</div>` block, and replace `<main id="main"><div id="grid"></div></main>` with:

```html
  <main id="main">
    <div id="grid"></div>
    <div id="selbar" role="toolbar" aria-label="Selected tabs" hidden>
      <span id="selcount" class="mono"></span>
      <div class="menu-wrap up">
        <button id="move-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="move-menu">Move to ▾</button>
        <div id="move-menu" class="menu" role="menu" hidden></div>
      </div>
      <button id="sel-group" type="button">Group</button>
      <button id="sel-pin" type="button">Pin</button>
      <button id="sel-discard" type="button">Discard</button>
      <button id="sel-close" type="button">Close</button>
      <button id="sel-clear" type="button" class="esc" title="Clear selection (Esc)" aria-label="Clear selection (Esc)"><kbd>Esc</kbd> to clear</button>
    </div>
  </main>
```

- [ ] **Step 2: Styles — replace section `selection` with**

```css
    #selbar { position: sticky; bottom: 12px; z-index: 5; align-self: center; width: fit-content; max-width: 100%; margin-top: 16px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 8px 10px 8px 14px; background: var(--t); color: var(--g); border-radius: 12px; box-shadow: 0 10px 30px rgba(0, 0, 0, .28); }
    #selcount { font-size: 11px; margin-right: 6px; white-space: nowrap; }
    #selbar button { background: transparent; color: var(--g); border-color: color-mix(in srgb, var(--g) 30%, transparent); }
    #selbar button:hover { background: color-mix(in srgb, var(--g) 14%, transparent); }
    #selbar #sel-close { background: var(--danger); border-color: var(--danger); color: var(--g); font-weight: 500; }
    #selbar #sel-close:hover { filter: brightness(1.08); }
    #selbar .esc { border-color: transparent; margin-left: 6px; color: color-mix(in srgb, var(--g) 72%, transparent); }
    #selbar kbd { color: inherit; background: transparent; border-color: color-mix(in srgb, var(--g) 40%, transparent); }
    .menu-wrap.up .menu { top: auto; bottom: calc(100% + 6px); left: 0; right: auto; max-height: 50vh; overflow: auto; }
    #selbar .menu button { color: var(--t); border: 0; }
    #selbar .menu button:hover, #selbar .menu button:focus-visible { background: var(--g3); }
```

- [ ] **Step 3: `app/app.js` — the bar**

Delete the line `let lastMoveTargetKey = null;` and replace the whole `renderSelbar` function with:

```js
  function selectedTabs() {
    return state.session.windows.flatMap((w) => w.tabs).filter((t) => state.selected.has(t.id));
  }

  function renderSelbar() {
    const tabs = selectedTabs();
    const n = state.selected.size;
    $("selbar").hidden = n === 0;
    if (n === 0) {
      $("move-menu").hidden = true;
      $("move-btn").setAttribute("aria-expanded", "false");
      return;
    }
    $("selcount").textContent = `${n} selected`;
    $("sel-pin").textContent = tabs.length && tabs.every((t) => t.pinned) ? "Unpin" : "Pin";
    $("sel-group").textContent = tabs.length && tabs.every((t) => t.groupId !== null) ? "Ungroup" : "Group";
  }

  // Built when the menu opens, so the targets stay put while it is open.
  function fillMoveMenu(menu) {
    const targets = [{ value: "new", label: "New window" }, ...state.session.windows.filter((w) => w.type === "normal").map((w) => ({ value: String(w.id), label: `${windowLabel(w).slice(0, 40)} · ${w.tabs.length}` }))];
    menu.replaceChildren(...targets.map((t) => el("button", { type: "button", role: "menuitem", dataset: { target: t.value } }, t.label)));
  }
```

Directly after the `groupSelection` function add:

```js
  // Group reads "Ungroup" when every selected tab is already grouped (renderSelbar).
  function groupOrUngroupSelection() {
    const tabs = selectedTabs();
    if (!tabs.length) return Promise.resolve();
    if (tabs.every((t) => t.groupId !== null)) {
      return chrome.tabs.ungroup(tabs.map((t) => t.id)).then(() => toast("Ungrouped"), (e) => toast(`Could not ungroup: ${e.message || e}`));
    }
    return groupSelection();
  }

  // Pin reads "Unpin" when every selected tab is pinned (renderSelbar).
  function togglePinSelection() {
    const tabs = selectedTabs();
    const pin = !(tabs.length && tabs.every((t) => t.pinned));
    return forEachSelected((id) => chrome.tabs.update(id, { pinned: pin }));
  }
```

In `wire()`, replace the whole `$("move-target").addEventListener("change", ...)` block and the seven `$("sel-...")` listener lines (`sel-group`, `sel-ungroup`, `sel-pin`, `sel-unpin`, `sel-discard`, `sel-close`, `sel-clear`) with:

```js
    $("move-btn").addEventListener("click", (e) => { e.stopPropagation(); toggleMenu("move-menu", fillMoveMenu); });
    $("move-menu").addEventListener("click", async (e) => {
      const item = e.target.closest("button[data-target]");
      if (!item) return;
      closeMenus();
      try {
        const moved = await moveTabs(selection(), item.dataset.target);
        if (moved) toast("Moved");
      } catch (err) {
        console.warn("TabVault move failed", err);
        toast(`Could not move: ${err.message || err}`);
      }
    });
    $("sel-group").addEventListener("click", () => groupOrUngroupSelection());
    $("sel-pin").addEventListener("click", () => togglePinSelection());
    $("sel-discard").addEventListener("click", () => forEachSelected((id) => chrome.tabs.discard(id)));
    $("sel-close").addEventListener("click", () => chrome.tabs.remove(selection()).catch((e) => toast(`Could not close: ${e.message || e}`)));
    $("sel-clear").addEventListener("click", clearSelection);
```

`moveTabs` already accepts `"new"` or a window id string. The existing Escape handling already clears the selection, which hides the bar; an open Move-to menu closes first (Task 2's `closeMenus(true)` line), so the first Escape closes the menu and the second clears.

- [ ] **Step 4: `e2e/run.js` — scenario C uses the menu**

Replace `await appPage.selectOption("#move-target", String(winC.id));` with:

```js
      await appPage.click("#move-btn");
      await appPage.click(`#move-menu button[data-target="${winC.id}"]`);
```

- [ ] **Step 5: Gates and e2e**

```bash
npm run lint
npm test
npm run pack
npm run e2e
```

Expected: 0 lint errors; 32 tests pass; pack succeeds; e2e 13 scenarios, all PASS except I-b PASS or LIMITED.

- [ ] **Step 6: Look at it** — select two tabs: a dark rounded bar floats at the bottom of the page (light in the dark theme), `2 selected`, Move to ▾ opens a menu upward listing New window and every normal window by name, Group, Pin, Discard, red Close, and "Esc to clear". Select two pinned tabs: Pin reads Unpin. Escape with the menu open closes the menu only; Escape again clears the selection and the bar disappears. The last row of a long window is never hidden behind the bar when scrolled to the end.

- [ ] **Step 7: Commit**

```bash
git add app/index.html app/app.js e2e/run.js && git commit app/index.html app/app.js e2e/run.js -m "Console bulk bar: floating, Move-to menu, Pin and Group toggles, Esc to clear" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UNR1Jj1F1e65B68YPwVuUj"
```

---

## Task 5 — One shortcut table, the hint strip, the `?` panel, keyboard focus

**Files:**
- Create: `lib/shortcuts.js`, `test/shortcuts.test.js`
- Modify: `app/index.html`, `app/app.js`, `app/dialogs.js`, `e2e/run.js` (no assertion changes; run only)

**Interfaces:**
- Produces: `TabVault.SHORTCUTS` (array of `{ action, keys, display, label }`: `keys` are `KeyboardEvent.key` values the page handles, `display` is an array of key caps for the panel, `action` is null for documentation-only rows), `TabVault.HINTS` (array of `[keys, label]`), `TabVault.findShortcut(key) -> entry | null`, `TabVault.hintText() -> string`.
- The keydown handler, the hint strip (`footer#hints`) and the `?` panel (`App.dialogs.help`) all read this table; nothing else lists shortcuts.
- Keyboard: every 1.0 binding stays (`/`, arrows, Enter, Space, Delete, Esc, `?`); new: `j`/`k` next/previous row (same as the arrows), `x` toggles the focused row (same as Space), `g` groups the selection (Ungroup when all are grouped, as the bar's button), `d` opens Find duplicates. The cursor row takes real DOM focus (`tabindex="-1"`, amber ring). In an open menu, ArrowUp/ArrowDown move between items. ArrowDown in the search field moves to the first row.
- Dialogs: opening one focuses its first control; closing returns focus where it was.

- [ ] **Step 1: Failing test — `test/shortcuts.test.js`**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { SHORTCUTS, HINTS, findShortcut, hintText } = require("../lib/shortcuts.js");

test("every shortcut has key caps and a label; no key or action is bound twice", () => {
  for (const s of SHORTCUTS) {
    assert.ok(Array.isArray(s.display) && s.display.length > 0 && s.display.every((k) => typeof k === "string" && k.trim()), `bad display in ${JSON.stringify(s)}`);
    assert.ok(typeof s.label === "string" && s.label.trim(), `missing label in ${JSON.stringify(s)}`);
    assert.ok(Array.isArray(s.keys), `keys must be an array in ${JSON.stringify(s)}`);
    if (s.action) assert.ok(s.keys.length > 0, `action ${s.action} has no key`);
  }
  const keys = SHORTCUTS.flatMap((s) => s.keys);
  assert.equal(new Set(keys).size, keys.length, `a key is bound twice: ${JSON.stringify(keys)}`);
  const actions = SHORTCUTS.filter((s) => s.action).map((s) => s.action);
  assert.equal(new Set(actions).size, actions.length, `an action appears twice: ${JSON.stringify(actions)}`);
});

test("every 1.0 binding is still in the table, plus j k x g d", () => {
  for (const key of ["/", "ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Enter", " ", "Delete", "Escape", "?", "j", "k", "x", "g", "d"]) {
    assert.ok(findShortcut(key), `no shortcut for ${JSON.stringify(key)}`);
  }
  assert.equal(findShortcut("j").action, findShortcut("ArrowDown").action);
  assert.equal(findShortcut("k").action, findShortcut("ArrowUp").action);
  assert.equal(findShortcut("x").action, findShortcut(" ").action);
  assert.equal(findShortcut("q"), null);
});

test("the hint strip reads exactly as the spec says and names only bound keys", () => {
  assert.equal(hintText(), "/ search · j k move · x select · g group · d duplicates · ? all shortcuts");
  for (const [keys] of HINTS) for (const k of keys.split(" ")) assert.ok(findShortcut(k), `hint key ${k} is not bound`);
});
```

Run `npm test`: fails (module missing).

- [ ] **Step 2: `lib/shortcuts.js`**

```js
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  // The one list of shortcuts. app/app.js dispatches keydown through findShortcut(),
  // the hint strip renders HINTS, and the "?" panel in app/dialogs.js renders SHORTCUTS,
  // so the three cannot drift. keys are KeyboardEvent.key values; display is what the
  // panel shows; rows with action null are documentation only (mouse, browser).
  const SHORTCUTS = [
    { action: "search", keys: ["/"], display: ["/"], label: "Search tabs" },
    { action: "next", keys: ["j", "ArrowDown"], display: ["j", "↓"], label: "Next tab" },
    { action: "prev", keys: ["k", "ArrowUp"], display: ["k", "↑"], label: "Previous tab" },
    { action: "nextWindow", keys: ["ArrowRight"], display: ["→"], label: "Next window" },
    { action: "prevWindow", keys: ["ArrowLeft"], display: ["←"], label: "Previous window" },
    { action: "open", keys: ["Enter"], display: ["Enter"], label: "Go to the focused tab" },
    { action: "toggle", keys: ["x", " "], display: ["x", "Space"], label: "Select or unselect the focused tab" },
    { action: "group", keys: ["g"], display: ["g"], label: "Group the selected tabs (Ungroup when all are grouped)" },
    { action: "dupes", keys: ["d"], display: ["d"], label: "Find duplicates" },
    { action: "close", keys: ["Delete"], display: ["Delete"], label: "Close the selected tabs" },
    { action: "escape", keys: ["Escape"], display: ["Esc"], label: "Close a menu; otherwise clear search and selection" },
    { action: "help", keys: ["?"], display: ["?"], label: "All shortcuts (this panel)" },
    { action: null, keys: [], display: ["Ctrl+click"], label: "Toggle a tab's selection (Cmd+click on macOS)" },
    { action: null, keys: [], display: ["Shift+click"], label: "Select a range of tabs" },
    { action: null, keys: [], display: ["Alt+Shift+T"], label: "Open TabVault (browser shortcut, chrome://extensions/shortcuts)" },
  ];

  // The strip at the bottom of the page, in this order.
  const HINTS = [["/", "search"], ["j k", "move"], ["x", "select"], ["g", "group"], ["d", "duplicates"], ["?", "all shortcuts"]];

  function findShortcut(key) {
    return SHORTCUTS.find((s) => s.keys.includes(key)) || null;
  }

  function hintText() {
    return HINTS.map(([keys, label]) => `${keys} ${label}`).join(" · ");
  }

  return { SHORTCUTS, HINTS, findShortcut, hintText };
});
```

Run `npm test`: 35 pass.

- [ ] **Step 3: Markup and styles**

Add `<script src="../lib/shortcuts.js"></script>` directly after the `ui.js` script tag. Directly after `</main>` add:

```html
  <footer id="hints" aria-label="Keyboard shortcuts"></footer>
```

Replace section `hints` (empty until now) with:

```css
    #hints { flex: none; padding: 6px 16px; background: var(--g2); border-top: 1px solid var(--l); color: var(--t2); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #hints kbd { font-size: 10.5px; }
    #hints button.link { padding: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
    #hints button.link:hover { color: var(--t); background: transparent; }
    #dialog table.shortcuts td:first-child { width: 1%; white-space: nowrap; padding-right: 18px; }
    #dialog table.shortcuts kbd + kbd { margin-left: 4px; }
```

Delete section `legacy aliases (removed in Task 5)`'s content line and its marker line together (every style now uses the spec's tokens). Then:

```bash
grep -n -E "var[(]--(bg|surface|surface-2|ink|ink-2|line|accent|accent-ink|accent-soft)[)]" app/index.html
```

must print nothing.

- [ ] **Step 4: `app/app.js` — render keeps row focus; the cursor takes focus**

In `render()`, directly after `state.renderPending = false;` add:

```js
    const rowHadFocus = Boolean(active && active.classList && active.classList.contains("tab"));
```

and directly after `main.scrollTop = scrollTop;` add:

```js
    if (rowHadFocus) focusCursorRow(false);
```

Directly after the `render` function add:

```js
  function focusCursorRow(scroll = true) {
    const row = state.cursor === null ? null : document.querySelector(`.tab[data-tab="${state.cursor}"]`);
    if (!row) return;
    row.focus({ preventScroll: true });
    if (scroll) row.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
```

In `moveCursor`, replace the last two lines (`const row = document.querySelector(...)` and `if (row) row.scrollIntoView(...)`) with `focusCursorRow();`. In `moveCursorWindow`, replace `if (first) { state.cursor = first.id; render(); }` with `if (first) { state.cursor = first.id; render(); focusCursorRow(); }`.

- [ ] **Step 5: `app/app.js` — dialogs focus in and back**

Replace `openDialog` and `closeDialog` with:

```js
  let dialogReturnFocus = null;
  async function openDialog(name, arg) {
    const box = $("dialog");
    box.replaceChildren();
    if (!dialogs[name]) return;
    closeMenus();
    dialogReturnFocus = document.activeElement;
    $("dialog-backdrop").hidden = false;
    await dialogs[name](box, arg);
    const first = box.querySelector("input, select, button");
    if (first && !box.contains(document.activeElement)) first.focus();
  }
  function closeDialog() {
    $("dialog-backdrop").hidden = true;
    $("dialog").replaceChildren();
    const back = dialogReturnFocus;
    dialogReturnFocus = null;
    if (back && back.isConnected && typeof back.focus === "function") back.focus();
  }
```

- [ ] **Step 6: `app/app.js` — the key handler reads the table**

Replace the whole `document.addEventListener("keydown", (e) => { ... });` block with:

```js
  function toggleCursorSelection() {
    if (state.cursor === null) return;
    state.selected.has(state.cursor) ? state.selected.delete(state.cursor) : state.selected.add(state.cursor);
    state.lastClicked = state.cursor;
    render();
  }

  const ACTIONS = {
    search: () => { $("search").focus(); $("search").select(); },
    next: () => moveCursor(1),
    prev: () => moveCursor(-1),
    nextWindow: () => moveCursorWindow(1),
    prevWindow: () => moveCursorWindow(-1),
    open: () => {
      if (state.cursor === null) return;
      const r = visibleTabs().find((x) => x.id === state.cursor);
      if (r) focusTab(r.id, r.windowId);
    },
    toggle: toggleCursorSelection,
    group: () => { if (state.selected.size) groupOrUngroupSelection(); },
    dupes: () => openDialog("duplicates"),
    close: () => { if (state.selected.size) chrome.tabs.remove(selection()).catch((err) => toast(`Could not close: ${err.message || err}`)); },
    escape: (e) => {
      if (e.target.matches("input, select, textarea")) e.target.blur();
      if (state.colorPickerFor !== null) { state.colorPickerFor = null; render(); return; }
      state.query = "";
      $("search").value = "";
      state.selected.clear();
      state.confirmClose = null;
      render();
    },
    help: () => openDialog("help"),
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && closeMenus(true)) { e.preventDefault(); return; }
    const openMenu = document.querySelector(".menu:not([hidden])");
    if (openMenu) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...openMenu.querySelectorAll("button")];
        const i = items.indexOf(document.activeElement);
        const next = items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
        if (next) next.focus();
      }
      return; // Enter and Space activate the focused item natively
    }
    if (!$("dialog-backdrop").hidden) { if (e.key === "Escape") closeDialog(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const s = TV.findShortcut(e.key);
    if (!s || !s.action) return;
    const inField = e.target.matches("input, select, textarea");
    if (inField && s.action !== "escape") return; // typing, including "/" in the search field
    if ((s.action === "open" || s.action === "toggle") && e.target.closest("button")) return; // let the focused button take Enter/Space
    e.preventDefault();
    ACTIONS[s.action](e);
  });
```

In `wire()`, replace the search `keydown` listener line with:

```js
    $("search").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { const r = visibleTabs()[0]; if (r) focusTab(r.id, r.windowId); }
      if (e.key === "ArrowDown") { e.preventDefault(); $("search").blur(); moveCursor(1); }
    });
```

- [ ] **Step 7: `app/app.js` — the hint strip**

Directly after the `emptyState` function add:

```js
  // Rendered once from the shortcut table; its text reads exactly TV.hintText().
  function renderHints() {
    const parts = [];
    TV.HINTS.forEach(([keys, label], i) => {
      if (i) parts.push(" · ");
      const caps = keys.split(" ").flatMap((k, j) => (j ? [" ", el("kbd", {}, k)] : [el("kbd", {}, k)]));
      if (keys === "?") parts.push(el("button", { type: "button", class: "link", title: "All shortcuts", onclick: () => openDialog("help") }, ...caps, ` ${label}`));
      else parts.push(el("span", {}, ...caps, ` ${label}`));
    });
    $("hints").replaceChildren(...parts);
  }
```

At the start of `wire()` add `renderHints();`.

- [ ] **Step 8: `app/dialogs.js` — the `?` panel from the table**

Replace the whole `App.dialogs.help = ...` function with:

```js
  App.dialogs.help = (box) => {
    const rows = TV.SHORTCUTS.map((s) => el("tr", {},
      el("td", {}, ...s.display.map((k) => el("kbd", {}, k))),
      el("td", {}, s.label)));
    box.replaceChildren(
      el("h2", {}, "Keyboard shortcuts"),
      el("table", { class: "shortcuts" }, el("tbody", {}, ...rows)),
      el("div", { class: "row" }, el("button", { type: "button", onclick: closeDialog }, "Close")));
  };
```

- [ ] **Step 9: Every icon button is named**

```bash
grep -n 'el("button"' app/app.js
```

Every hit either has visible words as its content or passes both `title` and `"aria-label"`; the glyph buttons all go through `iconButton()`. The static `#btn-more` in `index.html` carries both. Fix any that do not.

- [ ] **Step 10: Gates and e2e**

```bash
npm run lint
npm test
npm run pack
npm run e2e
```

Expected: 0 lint errors; 35 tests pass; pack succeeds; e2e 13 scenarios, all PASS except I-b PASS or LIMITED (B exercises Escape from the search field through the new handler).

- [ ] **Step 11: Look at it, keyboard only** — reload the extension and put the mouse away. The strip at the bottom reads `/ search · j k move · x select · g group · d duplicates · ? all shortcuts`. `j`/`k` move an amber-ringed focus through rows across windows, arrows too; `x` and Space select, the bar appears; `g` groups, `g` again ungroups; `d` opens duplicates, Esc closes it and focus returns; `?` lists every binding; `/` jumps to search, ArrowDown goes back to the rows; Tab reaches the header, `⋯` opens with Enter, ArrowDown walks its items, Esc closes it. Every glyph button shows a tooltip.

- [ ] **Step 12: Commit**

```bash
git add lib/shortcuts.js test/shortcuts.test.js app/index.html app/app.js app/dialogs.js && git commit lib/shortcuts.js test/shortcuts.test.js app/index.html app/app.js app/dialogs.js -m "Console keyboard: one shortcut table, j k x g d, hint strip, shortcuts panel, focus" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UNR1Jj1F1e65B68YPwVuUj"
```

---

## Task 6 — e2e scenarios for the Console behaviours (M-R)

**Files:**
- Modify: `e2e/run.js`, `e2e/README.md`

**Interfaces:**
- Consumes: everything from Tasks 1-5 through the DOM, `window.TabVaultApp.refresh()`, `window.TabVaultApp.selection()`, `self.TabVault.SHORTCUTS` in the page, `chrome.storage.session` in the worker.
- Produces: scenarios M (dark theme via the Settings override, first paint after reload, System following the OS), N (CURRENT tag and ring on the window hosting TabVault), O (bulk bar appears on selection via `j`/`x`, Move-to menu, Esc closes the menu then the bar), P (colour dots change a group's colour, in Chrome and on the page), Q (`?` panel lists the whole table, hint strip text, every glyph button named), R (window rename round-trips through storage, export and the import list; Escape cancels). Run order: ... J, M, N, O, P, Q, R, L, K (K stays last).

- [ ] **Step 1: Register the scenarios**

Replace the `ORDER` line with:

```js
const ORDER = ["A", "B", "C", "D", "E", "F", "G", "H", "I-a", "I-b", "J", "K", "L", "M", "N", "O", "P", "Q", "R"];
```

- [ ] **Step 2: Insert the scenarios**

Insert this block directly before the `// L. Settings persistence` comment block (that is, after scenario J's `catch`):

```js
    // ---------------------------------------------------------------
    // 1.1 Console scenarios M-R. They share one fresh fixture window,
    // created here because I-b may have relaunched the browser, which
    // leaves no earlier fixture window behind.
    // ---------------------------------------------------------------
    let winM = null;
    let tabsM = [];
    try {
      winM = await (await worker()).evaluate((urls) => chrome.windows.create({ url: urls, focused: false }), [oneUrl, twoUrl, threeUrl]);
      tabsM = await waitFor(async () => {
        const ts = await (await worker()).evaluate((id) => chrome.tabs.query({ windowId: id }), winM.id);
        return ts.length === 3 && ts.every((t) => String(t.url || "").startsWith(BASE)) ? ts.sort((a, b) => a.index - b.index) : null;
      }, { timeout: 15000 });
      await appPage.evaluate(() => window.TabVaultApp.refresh());
      await appPage.waitForSelector(`.window[data-window="${winM.id}"]`);
    } catch (e) {
      console.log(`M-R fixture window could not be created: ${e.message}`);
    }

    const LIGHT_G = "rgb(247, 247, 245)"; // --g light #F7F7F5
    const DARK_G = "rgb(19, 21, 24)"; // --g dark #131518
    const bodyBg = () => appPage.evaluate(() => getComputedStyle(document.body).backgroundColor);
    async function setAppearance(value) {
      await openMenuItem("#btn-settings");
      await appPage.waitForSelector("#dialog h2");
      await appPage.selectOption('#dialog select[aria-label="Appearance"]', value);
      await appPage.click('#dialog button:has-text("Save")');
      await waitFor(async () => (await appPage.evaluate(() => document.documentElement.dataset.theme)) === value);
    }
    async function blurAll() {
      await appPage.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    }

    // ---------------------------------------------------------------
    // M. Dark theme via the Settings override
    // ---------------------------------------------------------------
    try {
      await appPage.emulateMedia({ colorScheme: "light" });
      await setAppearance("dark");
      const darkBg = await bodyBg();
      assert(darkBg === DARK_G, `Appearance dark: body background ${darkBg}, expected ${DARK_G}`);
      const mirror = await appPage.evaluate(() => localStorage.getItem("tabvault.theme"));
      assert(mirror === "dark", `localStorage mirror = ${JSON.stringify(mirror)}`);
      await appPage.reload();
      await appPage.waitForSelector("#toolbar");
      const bootTheme = await appPage.evaluate(() => document.documentElement.dataset.theme);
      const bootBg = await bodyBg();
      assert(bootTheme === "dark" && bootBg === DARK_G, `after reload: data-theme=${bootTheme}, background ${bootBg}`);
      await appPage.waitForSelector(".window");

      await appPage.emulateMedia({ colorScheme: "dark" });
      await setAppearance("light");
      const lightBg = await bodyBg();
      assert(lightBg === LIGHT_G, `Appearance light under a dark OS: ${lightBg}`);

      await setAppearance("system");
      const systemDark = await bodyBg();
      await appPage.emulateMedia({ colorScheme: "light" });
      const systemLight = await bodyBg();
      assert(systemDark === DARK_G && systemLight === LIGHT_G, `System: dark OS -> ${systemDark}, light OS -> ${systemLight}`);
      record("M", "PASS", `dark override -> ${darkBg} (mirror "${mirror}"), after reload data-theme=${bootTheme} ${bootBg}; light override under dark OS -> ${lightBg}; System follows the OS: ${systemDark} / ${systemLight}`);
    } catch (e) {
      record("M", "FAIL", e.message);
    }
    await appPage.emulateMedia({ colorScheme: "light" }).catch(() => {});

    // ---------------------------------------------------------------
    // N. The window hosting TabVault is marked CURRENT with the --p ring
    // ---------------------------------------------------------------
    try {
      const appTab = (await (await worker()).evaluate((prefix) => chrome.tabs.query({ url: prefix + "*" }), ownPrefix))[0];
      await (await worker()).evaluate(({ windowId, url }) => chrome.tabs.create({ windowId, url, active: false }), { windowId: appTab.windowId, url: threeUrl });
      await appPage.evaluate(() => window.TabVaultApp.refresh());
      await appPage.waitForSelector(`.window[data-window="${appTab.windowId}"]`);
      const cards = await appPage.$$eval(".window", (nodes) => nodes.map((n) => ({
        id: Number(n.dataset.window),
        current: n.classList.contains("current"),
        tag: (n.querySelector(".tag-current") || {}).textContent || "",
        ring: getComputedStyle(n).borderTopColor,
      })));
      const marked = cards.filter((c) => c.current || c.tag);
      assert(marked.length === 1 && marked[0].id === appTab.windowId, `expected only window ${appTab.windowId} marked: ${JSON.stringify(cards)}`);
      assert(marked[0].tag === "CURRENT", `tag text = ${JSON.stringify(marked[0].tag)}`);
      assert(marked[0].ring === "rgb(183, 121, 31)", `ring colour = ${marked[0].ring}, expected --p #B7791F`);
      record("N", "PASS", `window ${appTab.windowId} (TabVault's own) is the only card with .current and the CURRENT tag; ring ${marked[0].ring}; cards ${JSON.stringify(cards)}`);
    } catch (e) {
      record("N", "FAIL", e.message);
    }

    // ---------------------------------------------------------------
    // O. The bulk bar appears on selection and Esc closes it
    // ---------------------------------------------------------------
    try {
      assert(winM, "no fixture window for M-R");
      await clearSelection();
      await blurAll();
      assert(await appPage.$eval("#selbar", (n) => n.hidden), "bulk bar visible with nothing selected");
      const first = tabsM[0];
      const second = tabsM[1];
      let cursor = null;
      for (let i = 0; i < 80 && cursor !== first.id; i++) {
        await appPage.keyboard.press("j");
        cursor = await appPage.$eval(".tab.cursor", (n) => Number(n.dataset.tab)).catch(() => null);
      }
      assert(cursor === first.id, `j never reached tab ${first.id} (cursor ${cursor})`);
      const focused = await appPage.evaluate(() => document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.tab : null);
      assert(Number(focused) === first.id, `the cursor row does not hold focus (active element data-tab=${focused})`);
      await appPage.keyboard.press("x");
      await appPage.waitForSelector("#selbar:not([hidden])");
      await appPage.click(`.tab[data-tab="${second.id}"] input[type=checkbox]`);
      await waitForTextContains(appPage, "#selcount", "2 selected");
      const counts = await appPage.$eval("#counts", (n) => n.textContent);
      assert(counts.endsWith(" · 2 sel"), `counter = "${counts}"`);
      const position = await appPage.$eval("#selbar", (n) => getComputedStyle(n).position);
      assert(position === "sticky", `bulk bar position = ${position}`);

      await appPage.click("#move-btn");
      await appPage.waitForSelector('#move-menu:not([hidden]) button[data-target="new"]');
      await appPage.keyboard.press("Escape");
      await appPage.waitForSelector("#move-menu[hidden]", { state: "attached" });
      const stillSelected = await appPage.evaluate(() => window.TabVaultApp.selection().length);
      assert(stillSelected === 2, `first Esc should close only the menu; selection is ${stillSelected}`);

      await appPage.keyboard.press("Escape");
      await appPage.waitForSelector("#selbar[hidden]", { state: "attached" });
      const after = await appPage.evaluate(() => window.TabVaultApp.selection().length);
      assert(after === 0, `selection after second Esc = ${after}`);
      record("O", "PASS", `j reached tab ${first.id} with focus, x selected it, checkbox added ${second.id}: bar sticky, "2 selected", counter "${counts}"; Esc closed the Move-to menu only, Esc again cleared the selection and hid the bar`);
    } catch (e) {
      record("O", "FAIL", e.message);
    }

    // ---------------------------------------------------------------
    // P. The colour dots change a group's colour
    // ---------------------------------------------------------------
    try {
      assert(winM, "no fixture window for M-R");
      const gid = await (await worker()).evaluate(async ({ tabId, windowId }) => {
        const id = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId } });
        await chrome.tabGroups.update(id, { title: "Dots", color: "grey" });
        return id;
      }, { tabId: tabsM[2].id, windowId: winM.id });
      await appPage.evaluate(() => window.TabVaultApp.refresh());
      const g = `.group[data-group="${gid}"]`;
      await appPage.waitForSelector(g);
      await appPage.click(`${g} .gdot`);
      const offered = await appPage.$$eval(`${g} .swatches button`, (bs) => bs.map((b) => b.dataset.color));
      assert(JSON.stringify(offered) === JSON.stringify(["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan"]), `picker offers ${JSON.stringify(offered)}`);
      await appPage.click(`${g} .swatches button[data-color="green"]`);
      const live = await waitFor(async () => {
        const x = await (await worker()).evaluate((id) => chrome.tabGroups.get(id), gid);
        return x.color === "green" ? x : null;
      });
      const edge = await waitFor(async () => {
        const c = await appPage.$eval(`${g} .ghead`, (n) => getComputedStyle(n).borderLeftColor).catch(() => null);
        return c === "rgb(24, 128, 56)" ? c : null; // GROUP_COLORS.green #188038
      });
      const pickerOpen = (await appPage.$(`${g} .swatches`)) !== null;
      assert(!pickerOpen, "the picker is still open after choosing a colour");
      record("P", "PASS", `group ${gid}: picker offered ${offered.length} colours; clicked green -> chrome.tabGroups.get says ${live.color}; header bar ${edge}; picker closed`);
    } catch (e) {
      record("P", "FAIL", e.message);
    }

    // ---------------------------------------------------------------
    // Q. The ? panel, the hint strip, named icon buttons
    // ---------------------------------------------------------------
    try {
      await blurAll();
      await appPage.keyboard.press("?");
      await waitForTextContains(appPage, "#dialog h2", "Keyboard shortcuts");
      const rows = await appPage.$$eval("#dialog table.shortcuts tr", (r) => r.length);
      const expectedRows = await appPage.evaluate(() => self.TabVault.SHORTCUTS.length);
      assert(rows === expectedRows, `panel lists ${rows} rows, the table has ${expectedRows}`);
      await appPage.keyboard.press("Escape");
      await waitFor(async () => appPage.$eval("#dialog-backdrop", (n) => n.hidden));
      const hints = await appPage.$eval("#hints", (n) => n.textContent);
      assert(hints === "/ search · j k move · x select · g group · d duplicates · ? all shortcuts", `hint strip = "${hints}"`);
      const unnamed = await appPage.$$eval("#toolbar button, #grid button, #selbar button", (bs) => bs
        .filter((b) => !/[A-Za-z]{2}/.test(b.textContent) && !(b.getAttribute("title") && b.getAttribute("aria-label")))
        .map((b) => b.outerHTML.slice(0, 120)));
      assert(unnamed.length === 0, `glyph buttons without title and aria-label: ${JSON.stringify(unnamed)}`);
      record("Q", "PASS", `? opened "Keyboard shortcuts" with ${rows} rows (= SHORTCUTS.length), Esc closed it; hint strip "${hints}"; every glyph-only button has title and aria-label`);
    } catch (e) {
      record("Q", "FAIL", e.message);
    }

    // ---------------------------------------------------------------
    // R. Window rename round-trips through storage, export and import
    // ---------------------------------------------------------------
    try {
      assert(winM, "no fixture window for M-R");
      const card = `.window[data-window="${winM.id}"]`;
      await appPage.click(`${card} button[aria-label="Rename window"]`);
      const input = appPage.locator(`${card} input.wname-edit`);
      await input.fill("E2E Research");
      await input.press("Enter");
      await waitForTextContains(appPage, `${card} .wname`, "E2E Research");
      const stored = await (await worker()).evaluate(() => chrome.storage.session.get("windowNames"));
      assert(stored.windowNames && stored.windowNames[String(winM.id)] === "E2E Research", `storage.session windowNames = ${JSON.stringify(stored)}`);

      await appPage.click(`${card} button[aria-label="Rename window"]`);
      await appPage.locator(`${card} input.wname-edit`).fill("Not saved");
      await appPage.locator(`${card} input.wname-edit`).press("Escape");
      const kept = await waitForTextContains(appPage, `${card} .wname`, "E2E Research");
      assert(!kept.includes("Not saved"), `Escape did not cancel: "${kept}"`);

      await openMenuItem("#btn-export");
      await appPage.waitForSelector("#dialog h2");
      const downloadPromise = appPage.waitForEvent("download");
      await appPage.click('#dialog button:has-text("Download JSON")');
      const download = await downloadPromise;
      const file = path.join(DOWNLOAD_DIR, `rename-${download.suggestedFilename()}`);
      await download.saveAs(file);
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      const exported = json.windows.find((w) => w.id === winM.id);
      assert(exported && exported.windowName === "E2E Research", `exported window ${winM.id}: ${JSON.stringify(exported && { id: exported.id, windowName: exported.windowName })}`);

      await appPage.setInputFiles("#import-file", file);
      await waitForTextContains(appPage, "#dialog h2", "choose windows to restore");
      const labels = await appPage.$$eval("#dialog .list label", (nodes) => nodes.map((n) => n.textContent));
      assert(labels.some((l) => l.includes("E2E Research")), `import list does not show the name: ${JSON.stringify(labels)}`);
      await appPage.click('#dialog button:has-text("Cancel")');
      record("R", "PASS", `renamed window ${winM.id} to "E2E Research" (storage.session confirms), Escape cancelled a second rename, export carries windowName, import list shows it`);
    } catch (e) {
      record("R", "FAIL", e.message);
    }
    await appPage.emulateMedia({ colorScheme: null }).catch(() => {});
```

- [ ] **Step 3: `e2e/README.md`**

Change `the report still lists results in scenario order A–H, I-a, I-b, J–L.` to `the report still lists results in scenario order A–H, I-a, I-b, J–R.` and append this section at the end of the file:

```markdown
## Console scenarios (1.1): M-R

They run after J and before L, on one fixture window of their own (created right after J, since I-b may have relaunched the browser).

- **M** Appearance: Settings, Appearance Dark turns `body` to the dark `--g`, the choice is mirrored to `localStorage["tabvault.theme"]`, and after a reload the page is dark from the first frame (`app/theme-boot.js`). Light overrides a dark OS (`page.emulateMedia`); System follows the emulated OS both ways.
- **N** The window holding TabVault's own tab (given a second tab first) is the only card with `.current` and the `CURRENT` tag, and its ring is `--p`.
- **O** `j` walks the rows until the fixture's first tab holds focus, `x` selects it, a checkbox adds a second: the bulk bar is sticky and says "2 selected", the counter ends in "· 2 sel". The first Escape closes the Move-to menu only; the second clears the selection and hides the bar.
- **P** The group's colour dot opens exactly the eight colours; clicking green recolours the group in Chrome and the header's bar on the page, and the picker closes.
- **Q** `?` opens "Keyboard shortcuts" with one row per `SHORTCUTS` entry; Escape closes it; the hint strip reads the spec's text; every glyph-only button has `title` and `aria-label`.
- **R** Pencil, "E2E Research", Enter: the name shows, `chrome.storage.session` holds it, Escape cancels a second rename, the exported JSON carries `windowName`, and the import list shows the name.
```

- [ ] **Step 4: Gates and e2e**

```bash
npm run lint
npm test
npm run pack
npm run e2e
```

Expected: 0 lint errors; 35 tests pass; pack succeeds; e2e 19 scenarios, all PASS except I-b PASS or LIMITED. If a new scenario fails, fix the app, not the assertion, unless the assertion contradicts the spec; report which.

- [ ] **Step 5: Commit**

```bash
git add e2e/run.js e2e/README.md && git commit e2e/run.js e2e/README.md -m "e2e: Console scenarios for theme, CURRENT, bulk bar, colour dots, shortcuts panel, window names" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UNR1Jj1F1e65B68YPwVuUj"
```

---

## Task 7 — Store screenshots, 1.1.0, history, listing "What's new"

**Files:**
- Modify: `tools/screenshots.js`, `docs/store/screenshots/01-all-windows.png`, `02-search.png`, `03-selection.png`, `04-duplicates.png`, `05-snapshots.png`, `docs/store/promo-tile-440x280.png`, `manifest.json`, `package.json`, `package-lock.json`, `docs/HISTORY.md`, `docs/store/listing.md`, `README.md`, `PRIVACY.md`, `CLAUDE.md`

**Interfaces:**
- `npm run screenshots` writes 1280x800 (promo 440x280) PNGs that are 8-bit RGB, colour type 2, no alpha, in the light theme, with named windows.
- Version `1.1.0` everywhere the version is stated.

- [ ] **Step 1: `tools/screenshots.js`**

Add `const zlib = require("zlib");` after the `const { pathToFileURL } = require("url");` line.

Directly after the `sleep` function add:

```js
// ---- PNG without alpha -----------------------------------------------------
// The Web Store wants 24-bit PNGs with no alpha channel; Playwright writes 8-bit
// RGBA. This decodes the RGBA image (all five PNG row filters), composites it on
// white, and re-encodes it as colour type 2. Zero dependencies.
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function toRgbPng(png) {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("not a PNG");
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("ascii", off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (colorType === 2 && bitDepth === 8) return png;
  if (colorType !== 6 || bitDepth !== 8 || interlace !== 0) throw new Error(`unsupported PNG: colour type ${colorType}, depth ${bitDepth}, interlace ${interlace}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const outStride = width * 3 + 1;
  const out = Buffer.alloc(outStride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    const line = Buffer.from(raw.subarray(start + 1, start + 1 + stride));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = (line[x] + add) & 0xff;
    }
    const o = y * outStride;
    out[o] = 0;
    for (let x = 0; x < width; x++) {
      const alpha = line[x * 4 + 3];
      for (let k = 0; k < 3; k++) out[o + 1 + x * 3 + k] = Math.round((line[x * 4 + k] * alpha + 255 * (255 - alpha)) / 255);
    }
    prev = line;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib.deflateSync(out, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]);
}
```

In the `chromium.launchPersistentContext(USER_DATA_DIR, { ... })` options add `colorScheme: "light",` after `viewport: { width: WIDTH, height: HEIGHT },` (the store screenshots are the light theme).

Replace the comment

```js
    // Three is deliberate: a .window column is a fixed 320px, so a fourth one
    // would be sliced in half by the right edge of a 1280-wide screenshot.
```

with

```js
    // Three is deliberate: at 1280 px wide the Console grid shows three window
    // cards per row, so the first screenshot shows every window.
```

Directly after the snapshot-history `await sw(async () => { ... });` block (before `await app.bringToFront();`) add:

```js
    // Window names (1.1) live in chrome.storage.session, which the page reads on refresh.
    await app.evaluate((names) => chrome.storage.session.set({ windowNames: names }), {
      [research.id]: "Research",
      [work.id]: "Work",
      [personal.id]: "Personal",
    });
```

Replace the `shot` helper with:

```js
    const shot = async (name) => {
      const file = path.join(SHOTS, name);
      fs.writeFileSync(file, toRgbPng(await app.screenshot()));
      console.log("wrote " + file);
    };
```

and replace `await promo.screenshot({ path: PROMO_PNG });` with `fs.writeFileSync(PROMO_PNG, toRgbPng(await promo.screenshot()));`.

(The rest keeps working: `#counts` still contains " of " while searching, `#selbar:not([hidden])` and `#sel-clear` still exist, `#btn-dupes` and `#btn-snapshots` are still in the header.)

- [ ] **Step 2: Regenerate and check the images**

```bash
npm run screenshots
node -e "const fs=require('fs');const d='docs/store/';for(const f of ['screenshots/01-all-windows.png','screenshots/02-search.png','screenshots/03-selection.png','screenshots/04-duplicates.png','screenshots/05-snapshots.png','promo-tile-440x280.png']){const b=fs.readFileSync(d+f);console.log(f,b.readUInt32BE(16)+'x'+b.readUInt32BE(20),'depth',b[24],'colour type',b[25])}"
```

Foreground, 600000 ms timeout; it opens a real browser window. Expected: the five screenshots `1280x800 depth 8 colour type 2`, the promo `440x280 depth 8 colour type 2`. Then open each of the six PNGs with the Read tool and check: light theme; header with amber Find duplicates and the counter; three cards named Research, Work, Personal; group dots and bars; favicons; 02 shows `4 of` in the counter; 03 shows the dark floating bar with Move to ▾; 04 and 05 show the dialogs; the hint strip is at the bottom. Nothing is cut off at the right edge.

- [ ] **Step 3: Version 1.1.0**

With the Edit tool: in `manifest.json` change `"version": "1.0.0",` to `"version": "1.1.0",`; in `package.json` the same; in `package-lock.json` change the two `"version": "1.0.0",` lines that belong to `tabvault` itself (line 3, directly under `"name": "tabvault",`, and line 9, under `"packages": { "": { "name": "tabvault",`) and no other. Then:

```bash
node -e "const fs=require('fs');console.log(JSON.parse(fs.readFileSync('manifest.json','utf8')).version, require('./package.json').version, JSON.parse(fs.readFileSync('package-lock.json','utf8')).version)"
```

Expected: `1.1.0 1.1.0 1.1.0`.

- [ ] **Step 4: `docs/HISTORY.md` — append**

```markdown

## 2026-09-28 — 1.1 "Console" UI

- Request: the owner tried the 1.0 store build and asked for better UI/UX. Three mockups; direction A, "Console", chosen (dense, keyboard-first, mono for names and counts, one amber for the thing to press). Spec: `docs/superpowers/specs/2026-09-28-console-ui-design.md`; plan: `docs/superpowers/plans/2026-09-28-console-ui.md`.
- Tokens exactly as the spec's table, light and dark, following Chrome's scheme with an Appearance override (System/Light/Dark). IBM Plex Sans 400/500/600 and Plex Mono 500 bundled in `app/fonts/` with the OFL 1.1 licence; `tools/pack.js` refuses to build without them. No network requests.
- Window cards in a responsive grid (3/2/1 columns), the window hosting TabVault marked CURRENT, window names editable inline, kept in `chrome.storage.session` and carried into snapshots and exports as the optional `windowName` (schema stays 1; restore re-applies names with a `nameWindow` step).
- Groups: colour dot, 3 px bar, eight-dot picker. Tab rows: favicon or a letter badge coloured from the domain (`lib/ui.js`), domain in mono, flags (pinned, audible, muted, `zz`, `dup`), the active-tab bar.
- Floating bulk bar with a Move-to menu; Esc closes a menu first, then clears. One shortcut table (`lib/shortcuts.js`) drives the key handler, the hint strip and the `?` panel; new keys `j` `k` `x` `g` `d`.
- Rulings made in the plan: an explicit Light/Dark choice is mirrored to `localStorage` and applied by `app/theme-boot.js` before first paint (MV3 forbids inline scripts; "System" needs no script); window names use Plex Mono Medium because only 500 is bundled; Pin and Group read Unpin and Ungroup when every selected tab already is, so 1.0's Unpin and Ungroup survive; the picker offers the spec's eight colours and an existing orange group still renders orange; unnamed windows show the active tab's title; `dup` uses the whole session and the `ignoreHash` setting; the muted flag stays; the page scrolls instead of each card.
- Store screenshots regenerated in the new look (light theme, RGB without alpha, written by `tools/screenshots.js` itself).
- Result: 35 unit tests, 19 e2e scenarios (I-b PASS or LIMITED as before).
```

- [ ] **Step 5: `docs/store/listing.md`**

In the description block, replace

```
• See every window as a column and every tab as a row, with your native tab groups shown inline.
```

with

```
• See every window as a card and every tab as a row with its favicon and site, with your native tab groups shown inline. The window TabVault is open in is marked CURRENT, and you can give any window a name.
```

and replace

```
• Navigate entirely from the keyboard: arrows to move, Enter to go to a tab, Space to select, Delete to close, ? for the full list.
```

with

```
• Navigate entirely from the keyboard: j and k (or the arrows) to move, x to select, g to group, d for duplicates, Enter to go to a tab, Delete to close, ? for the full list. The shortcuts are always shown at the bottom of the page.
• Light and dark themes that follow Chrome, or pick one in Settings.
```

In the Graphic assets table, replace the five screenshot descriptions with:

```
| Screenshots (upload in this order) | `docs/store/screenshots/01-all-windows.png` — the whole session: three named window cards (Research, Work, Personal), three colour-coded tab groups, a pinned tab, the header counter and the shortcut strip | 1280×800 |
| | `docs/store/screenshots/02-search.png` — searching "release": only matching tabs remain, the counter reads "3 win · 4 of 27 tabs" | 1280×800 |
| | `docs/store/screenshots/03-selection.png` — four tabs selected with the floating bar: Move to ▾, Group, Pin, Discard, Close, Esc to clear | 1280×800 |
| | `docs/store/screenshots/04-duplicates.png` — the duplicate finder listing two duplicated URLs with a Keep radio per copy | 1280×800 |
| | `docs/store/screenshots/05-snapshots.png` — the snapshot list: automatic, startup and a kept manual snapshot, with Restore/Export/Keep/Delete | 1280×800 |
```

(If Step 2's 02 screenshot shows a different counter, write what it shows.) Replace the paragraph starting `**Screenshot format rule (the dashboard's words):**` through `` `sharp(file).flatten({ background: '#ffffff' }).removeAlpha().png()` fixes it. `` with:

```
**Screenshot format rule (the dashboard's words):** up to 5, 1280x800 or
640x400, JPEG or 24-bit PNG with no alpha channel, at least one required.
Since 1.1, `tools/screenshots.js` writes every screenshot and the promo tile
as an 8-bit RGB PNG (colour type 2) itself, compositing Playwright's RGBA
output onto white; check byte 25 of each file is 2 after regenerating.
```

Append at the end of the file (the outer fence here is `~~~` because the appended text contains its own code block):

~~~markdown

## 10. What's new in 1.1.0 (for the update)

Upload the 1.1.0 package as in section 8, replace all five screenshots with the
regenerated ones (same order), and paste this block at the top of the
description, above "TabVault puts every window...", with one blank line after it:

```
NEW IN 1.1
• A new look: denser rows, a warm light theme and a dark theme that follow Chrome, or choose one in Settings → Appearance.
• Windows are cards in a grid; the window TabVault is open in is marked CURRENT. Name any window with the pencil; names are kept in snapshots and exports.
• Every tab shows its favicon (or a coloured letter), its site, and flags for pinned, playing, unloaded and duplicate tabs. The active tab of each window is marked.
• Pick a group's colour from eight dots.
• Selected tabs get a floating bar: Move to, Group, Pin, Discard, Close. Esc clears it.
• More keyboard: j and k to move, x to select, g to group, d for duplicates, ? for every shortcut, with a hint strip at the bottom.
• Fonts are bundled with the extension; it still makes no network requests.
```
~~~

- [ ] **Step 6: `README.md`**

Replace `- Every window as a column, every tab as a row, with native tab groups shown inline` with:

```
- Every window as a card in a responsive grid, every tab as a row with its favicon (or a coloured letter), site and flags, native tab groups shown inline; the window TabVault is open in is marked CURRENT
- Name windows inline (the pencil on each card); names last for the browser session and are kept in snapshots and exports
```

Replace `- Light/dark/system theme, compact density, and an option to show URLs under titles` with `- Light and dark themes that follow Chrome, an Appearance override (System/Light/Dark), compact density, and an option to show URLs under titles; IBM Plex fonts bundled`.

Replace `or select tabs and choose a window from the "Move to…" menu in the selection bar.` with `or select tabs and choose a window from **Move to ▾** in the floating selection bar.` and `theme (system/light/dark)` with `Appearance (System/Light/Dark)`.

Replace the rows of the Keyboard shortcuts table (keep its header) with:

```markdown
| `/` | Search |
| `j` `↓` / `k` `↑` | Next / previous tab |
| `←` `→` | Previous / next window |
| `Enter` | Go to the focused tab |
| `x` or `Space` | Select / unselect the focused tab |
| `g` | Group the selected tabs (Ungroup when all are grouped) |
| `d` | Find duplicates |
| `Delete` | Close selected tabs |
| `Ctrl`/`Cmd`+click | Toggle a tab's selection |
| `Shift`+click | Select a range of tabs |
| `Esc` | Close a menu; otherwise clear search and selection |
| `?` | All shortcuts |
| `Alt+Shift+T` | Open TabVault (browser-level shortcut, configurable at `chrome://extensions/shortcuts`) |
```

and add this paragraph after the table (one blank line before it):

```markdown
The list lives in one place, `lib/shortcuts.js`; the page's key handler, the hint strip and the `?` panel all read it.
```

In the Files table, add these rows directly after the `app/dialogs.js` row:

```markdown
| `app/theme-boot.js` | Applies an explicit Light/Dark choice before first paint |
| `app/fonts/` | IBM Plex Sans (400/500/600) and Plex Mono (500), OFL 1.1 (`LICENSE.txt`) |
| `lib/ui.js` | Header counter text, tab domain, favicon fallback colour, duplicate flags |
| `lib/shortcuts.js` | The keyboard shortcut table |
```

Replace this line:

```
Nothing is written outside of `chrome.storage.local`; there is no server, account or sync involved (see [Privacy](#privacy)).
```

with:

```
Two small things live elsewhere: window names are kept in `chrome.storage.session` under `windowNames` (Chrome clears it when the browser closes; the names also travel inside snapshots and exports), and the page keeps a copy of your Appearance choice in its own `localStorage` so the right theme paints first. There is no server, account or sync involved (see [Privacy](#privacy)).
```

- [ ] **Step 7: `PRIVACY.md`**

Change `Effective date: 2026-09-19` to `Effective date: 2026-09-28`. Replace the settings bullet's first words `- **Your settings** — theme, density,` with `- **Your settings** — appearance (theme), density,`, and add after that bullet (after the line ending `and whether restored tabs load lazily.`):

```markdown
- **Window names** — any names you type for your windows. They are kept until
  the browser closes and are also saved inside snapshots and exports.
```

Replace

```
(`chrome.storage.local`, plus a single short-lived value in
`chrome.storage.session` used to time the snapshot debounce). TabVault has no
```

with

```
(`chrome.storage.local`; `chrome.storage.session`, which the browser clears
when it closes, for window names and a short-lived value that times the
snapshot debounce; and the extension page's own `localStorage`, for a copy of
your Appearance choice). TabVault has no
```

- [ ] **Step 8: `CLAUDE.md`**

Replace this line:

```
- The page pauses re-rendering while a group rename input or a `<select>` inside the grid/selection bar is focused; `state.renderPending` flushes on blur.
```

with:

```
- The page pauses re-rendering while a group or window rename input is open (`state.editing`) or a `<select>` inside the grid/selection bar is focused; `state.renderPending` flushes on blur.
- Window names live in `chrome.storage.session` under `windowNames` (window id to name, cleared when the browser closes). `buildSession` copies them into sessions as the optional `windowName`; restore re-applies them through a `nameWindow` step; a rename schedules a snapshot.
- Appearance: `settings.theme` (system/light/dark) is mirrored to `localStorage["tabvault.theme"]` and stamped on `<html data-theme>` before first paint by `app/theme-boot.js` (MV3 forbids inline scripts). "System" is pure CSS.
- Keyboard shortcuts exist in one table, `lib/shortcuts.js`: the key handler, the hint strip and the `?` panel read it. Add a binding there and nowhere else.
- Styles are one inline `<style>` in `app/index.html`, split by `/* == section == */` markers; the tokens are the spec's table (`docs/superpowers/specs/2026-09-28-console-ui-design.md`).
- `tools/pack.js` refuses to build without the four IBM Plex woff2 files and `app/fonts/LICENSE.txt`.
```

Replace this line (1.1 added the `.catch`, and the grid has no selects any more):

```
- Confirm-close button lacks a `.catch`; the delegated `change` handler in wire() is a no-op (blur flushes pending renders); tabbing between grid selects drops focus to body.
```

with:

```
- The delegated `change` handler in wire() is a no-op (blur flushes pending renders).
```

- [ ] **Step 9: Gates, e2e, manual check**

```bash
npm run lint
npm test
npm run pack
npm run e2e
```

Expected: 0 lint errors; 35 tests pass; pack writes `dist/tabvault-1.1.0.zip` and its listing includes the five `app/fonts/` entries, `app/theme-boot.js`, `lib/ui.js` and `lib/shortcuts.js`, and nothing under `docs/`, `tools/`, `test/`, `e2e/` or `node_modules/`; e2e 19 scenarios, all PASS except I-b PASS or LIMITED.

Manual, in real Chrome (load unpacked or reload): the page opens in the Console look; Appearance Dark, reload, no light flash; a named window survives a page reload and shows in Export; `Alt+Shift+T` still opens TabVault; the zip loads unpacked from a scratch folder after extracting it. Record anything not checked.

- [ ] **Step 10: Commit**

```bash
git add tools/screenshots.js docs/store/screenshots/01-all-windows.png docs/store/screenshots/02-search.png docs/store/screenshots/03-selection.png docs/store/screenshots/04-duplicates.png docs/store/screenshots/05-snapshots.png docs/store/promo-tile-440x280.png manifest.json package.json package-lock.json docs/HISTORY.md docs/store/listing.md README.md PRIVACY.md CLAUDE.md && git commit tools/screenshots.js docs/store/screenshots/01-all-windows.png docs/store/screenshots/02-search.png docs/store/screenshots/03-selection.png docs/store/screenshots/04-duplicates.png docs/store/screenshots/05-snapshots.png docs/store/promo-tile-440x280.png manifest.json package.json package-lock.json docs/HISTORY.md docs/store/listing.md README.md PRIVACY.md CLAUDE.md -m "TabVault 1.1.0: Console store screenshots, history, listing What's new, docs" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UNR1Jj1F1e65B68YPwVuUj"
```

Never add the three untracked `ChatGPT Image ....png` files in `docs/store/screenshots/`.
