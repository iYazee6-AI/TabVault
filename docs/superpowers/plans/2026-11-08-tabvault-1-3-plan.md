# TabVault 1.3.0 "Shelf" — implementation plan

Date: 2026-11-08. Spec: `docs/superpowers/specs/2026-11-08-tabvault-1-3-design.md` (Wakeel's rulings in its Assumptions 2 and 5 are final). Branch `feature/1.3-shelf` from main 487e8d7. Built on Opus, test first, task by task, in the spec's release-plan order. Nothing is merged, pushed, tagged or uploaded by this plan; Naqid reviews the branch first, with feature 1 as the focus.

House constraints for every task: no new permission in `manifest.json`; no `innerHTML` or `insertAdjacentHTML` (text nodes through `el()` only); no `alert`, `confirm` or `prompt`; no literal backslash in any new or edited line (a backslash is built with `String.fromCharCode(92)`); pure logic in `lib/` with the UMD wrapper; every storage write of shelves and recently closed goes through the worker's queues.

## Task 1 — Markdown export and import, the scheme filter (`lib/exporters.js`)

Tests first (`test/exporters.test.js`):
1. JSON round trip: `parseImport(toJsonFile(s).text)` deep-equals `s` (window names and groups included) once `exportedAt` and `app` are dropped.
2. Markdown round trip: `parseMarkdown(toMarkdown(s))` equals `s` reduced to URLs, titles, window names, group names, pinned and order; ungrouped tabs after a group come back ungrouped.
3. Titles with `]`, `)`, `|`, `[`, `*`, `_` and backticks are escaped and restored; a URL with parentheses or a space uses the `<url>` form and comes back intact.
4. Bare `http(s)://` URLs on their own line (with or without a list marker) are tabs; no headings gives one window; CRLF input parses like LF.
5. The scheme filter: `javascript:`, `data:`, `chrome:`, `chrome-extension:`, `about:` (not `about:blank`), `ftp:`, `edge:`, `view-source:` are dropped and counted (`skippedLinks`); `http:`, `https:`, `file:` and `about:blank` pass. The same filter on JSON imports; a JSON file left with no tab is refused.
6. An empty or junk paste throws a clear error ("No links found").

Code: `isImportableUrl(url)`, `toMarkdown(session, {title})`, `parseMarkdown(text)`, `parseImportText(text)` (JSON when it starts with `{`, else Markdown), `filterImportable(session)`; `parseImport` applies the filter. Markdown shape: optional `# title`; `## Window name` (or `## Window N`); `### Group name` (`### (unnamed group)` for a blank title); `- [title](url)` with ` (pinned)`; a group ends at the next heading or at `<!-- end of group -->`, which the export writes when ungrouped tabs follow a group.

Page (`app/dialogs.js`, `app/index.html`): the Export dialog gets What (this session, selected tabs, a snapshot, a shelf) and Format (JSON, Markdown), Download and Copy to clipboard (`navigator.clipboard.writeText` from the click; on failure a selected textarea with "press Ctrl+C"; no `clipboardWrite`). Import gets a dialog with Choose file and a paste box, the summary line ("Found 2 windows, 14 tabs, 1 group · 3 links skipped: not web pages"), the window list, and a second confirmation above 100 tabs; `file:` links are reported and skipped when file access is off. The file input accepts `.json`, `.md`, `.txt`.

e2e AE: export Markdown of a fixture window (captured through Playwright's download event), paste it into Import, restore (lazy restore off), compare the URLs.

## Task 2 — Compare a snapshot with now (`lib/diff.js`)

Tests first (`test/diff.test.js`): identical sessions give three empty lists; one tab closed, one opened, one moved between windows; duplicates by multiplicity (two saved, one open: one missing); window matching by name and by overlap; Ignore #hash on and off; `chrome://` and TabVault's own URLs ignored on both sides.

Code: `diffSessions(snapshot, current, {ignoreHash, ownPrefix})` returning `{missing, added, moved, windowMap}`; the duplicate finder's `normalizeUrl`. Page: a Compare dialog (from a snapshot row's Compare button and the palette's "Compare latest snapshot with now") with the three lists, ticks on missing rows, "Reopen N in a new window", "Reopen into their windows", "Select all new" (puts the new tabs into the page's selection). Nothing closes from it.

e2e AC: take a snapshot, close one fixture tab and open another, Compare shows one missing and one new, Reopen missing brings it back.

## Task 3 — Search every saved tab from the palette (`lib/saved-index.js`, `lib/palette.js`)

Tests first (`test/saved-index.test.js`, `test/palette.test.js`): one entry per URL across snapshots, shelves and recently closed, the newest kept, the count right; the prefixes `s:`, `t:`, `a:`; highlight ranges for multi-word, overlapping and case-insensitive matches, and a title holding `<script>` stays text (ranges are offsets); the cap of 30; "Open all" above 20 asks.

Code: `buildSavedIndex({snapshots, shelves, recent}, {ignoreHash, fmt})`, `searchSaved(index, query, {limit})`, `parsePaletteQuery(q)`, `highlightRanges(text, words)`, `openAllNeedsConfirm(n)`. Page: the index is built on the first palette open of a page load and rebuilt (debounced 1 s) on `storage.onChanged` for `snap:`, `shelf:` and `recentlyClosed`; the palette shows Open tabs, then Saved (with where and "+N older"), then "Open all N saved matches in a new window"; Enter opens in the current window (focuses an open copy), Shift+Enter in a new window; `<mark>` nodes built with `el()`.

e2e AD: seed two snapshots and a shelf, type a word, the Saved section lists one row with "+1 older", Enter opens it, "Open all" opens a window with the matches.

## Task 4 — Idle rules and shelves (`lib/shelves.js`, `lib/discard-rule.js`, `lib/settings.js`, worker, page)

Tests first (`test/shelves.test.js`, `test/discard-rule.test.js`, `test/settings.test.js`): first-match order; `never` beats a later `shelve`; the fallback to the global setting; the exemptions apply to every action; a shelving rule skips the active tab of every window; incognito tabs are never planned by a rule; the global pinned setting wins over every rule; the cap of 25 across both actions with unloads first and oldest idle first; `*.com`, `*.co.uk`, `*.com.sa` refused; more than 50 matches needs the second confirmation; a shelving rule that was not dry-run for its current pattern and time plans nothing; the shelf item keeps the group and a restore joins or recreates it; chunks of 200 (the 201st item opens chunk 1, the count derived); a short middle chunk compacted on the next append; the last-tab case turns shelve into unload; the allowlist migration (1.2 list to `never` rules, idempotent, a 1.3 store left alone); `appendItems` drops the same URL on the same shelf within a minute; a failed shelf write closes nothing (fake storage that rejects); the write is read back before the close.

Code: `planIdle(tabs, groups, settings, now, opts)` returning `{unload, shelve, skipped, eligible, waiting}`; `patternError`, `ruleKey`, `ruleUnlocked`, `dryRunUnlock`; `migrateIdleRules`; `lib/shelves.js` (`createShelf`, `listShelves`, `readShelf`, `appendItems`, `removeItems`, `deleteShelf`, `shelfItem`, `groupTargets`, `shelfToSession`, `executeShelve`). Worker: the settings migration at start, `runIdleRules` (unloads first, then shelves; `runAutoDiscard` kept as its name for the harness), a `shelfWrite` queue, the Recently closed entry tagged with the shelf (`shelf: {id, name}`) by the existing `onRemoved` path, messages `idleDryRun`, `runIdleNow`, `shelfCreate`, `shelveTabs`, `shelfRemoveItems`, `shelfDelete`, a test clock offset `idleClockOffset` for the harness. Page: the Settings "Idle tabs" block (global unload, pinned, the rules list with switches, Dry run, Edit, up, down, Delete, the inline editor, the last-run line "last run 12:40: 7 unloaded, 3 shelved", Run idle rules now, the never-touched note); the Shelves section under Recently closed (collapsed by default; Open, Open and remove, Remove, Open all, Export, Delete with the count); "Move to shelf…" in the selection bar and the palette.

e2e AA: a shelving rule created off, the switch locked until the dry run, the dry run lists the fixture tabs, Run idle rules now shelves the idle tabs and keeps the active one, the shelf lists them, the Recently closed entry is tagged with the shelf and absent when "Remember recently closed tabs" is off. e2e AB: the Shelves section lists the shelf with its count and rule, Open brings an item back into its recreated group, Open and remove drops it.

## Task 5 — Version, store kit, docs

`manifest.json` and `package.json` to 1.3.0 (no new permission); `docs/store/listing.md`: the description's promise "Nothing is closed unless a rule you wrote says so", the `tabs` and `alarms` justifications, the single purpose, section 14 NEW IN 1.3 (the spec's CHANGES text), the screenshot table (03 the rules block with a dry run, 04 the palette's Saved section replacing the duplicates shot); `tools/screenshots.js` captures them (through `TABVAULT_PLAYWRIGHT` set to the house Playwright, headless); `PRIVACY.md` (shelves local only, the idle rules, the effective date); `README.md`, `docs/HISTORY.md` 1.3.0, `CLAUDE.md` (first match wins, the dry-run lock, shelf write before close, the saved index is in memory only).

## Gates

`npm test` all green; `npm run lint` 0 errors; `npm run e2e` with AA to AE (LIMITED allowed only where `chrome.tabs.discard` crashes Playwright's Chromium); `npm run pack` builds `dist/tabvault-1.3.0.zip` with nothing outside `app/`, `lib/`, `background.js`, `icons/`, `manifest.json`. Backslash and control-byte count of every touched file: 0 new.

## Real-install checks left for the owner (no automation covers them)

1. `navigator.clipboard.writeText` from the Export dialog on the main page without `clipboardWrite`.
2. A shelving rule at 15 minutes on a test site: dry run, unlock, shelved with the group and closed, the active tab stays.
3. Restore a shelved item whose group is gone: recreated with its title and colour.
