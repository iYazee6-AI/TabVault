# TabVault 1.3.0 "Shelf" — design

Date: 2026-11-08. Status: design only, nothing built. The owner's word of the day ("do them all") on Wakeel's brief, which named seven candidates and asked for at most four; the cut below is the implementer's (Opus) proposal for Wakeel and the owner, and the Assumptions section lists what they may overturn. Builds on 1.2.0 "Keeper" (`docs/superpowers/specs/2026-11-07-tabvault-1-2-keeper-design.md`, tag `v1.2.0`, main 0a22aba).

## Why

1.2 keeps the tabs that are open: it unloads idle ones, remembers closed ones and puts a window away on one command. What is saved is still hard to get back to. A snapshot is a row with a date; to find "that pricing page from Tuesday" the user restores whole snapshots or exports them and greps. And the Keeper's idle rule is one rule for every site, which is right for memory but not for the user who wants news tabs gone after an hour and the tracker never touched. 1.3 is the version that finds and files: search every saved tab from the palette, compare a snapshot with now, let the user write per-site rules that can file idle tabs onto a shelf, and move lists in and out as plain Markdown.

## The candidates, weighed

| # | Candidate | Verdict | Why |
|---|---|---|---|
| 1 | Rules: idle tabs from site X go to vault Y and close | **In** (feature 1) | The most-asked follow-up to auto-discard in the 2026-11-01 survey (OneTab, Tab Wrangler, Auto Tab Discard all have a form of it). Needs no permission: `tabs.remove` and the 5-minute alarm already exist. It is the one feature that changes the "nothing is ever closed" promise, so it carries the most guards (below). |
| 2 | Scheduled session snapshots, keep last K, diff against now | **Half in** (feature 2: the diff) | The schedule is out: the house rule since 1.0 is that snapshots are event-driven, never on a timer, and an idle browser on a timer stores the same session again and again (dedup throws them away, so the schedule adds nothing the debounce does not already take). "Keep the last K" exists (Settings, 5 to 200). The diff view is new and answers the real question after a crash or a bad close: what is missing since then. |
| 3 | Search every saved vault from the palette, highlighted, open all matches | **In** (feature 3) | The saved snapshots are TabVault's biggest store and today they cannot be searched at all. It reuses `lib/search.js` and `lib/palette.js` and needs nothing new from Chrome. |
| 4 | Duplicate finder across windows, one click to keep one | **Out (shipped)** | 1.1 already finds the same URL across every window, marks one copy to keep per URL, pre-ticks the extras and closes them with one button ("Close 2 selected", screenshot 04). A further "keep the first everywhere" button saves one click at the price of a second way to do the same thing. |
| 5 | Export and import, JSON and Markdown, round-trip test | **In** (feature 4: Markdown, both ways) | JSON export and import exist since 1.0 (`lib/exporters.js`, schema 1). Markdown is new, small, and is what people paste into notes apps; the import side lets a list of links from anywhere become a restorable window. The round-trip tests cover both formats. |
| 6 | User-rebindable shortcuts on an options page | **Wait (1.4 or never)** | `chrome.commands` already has its own rebinding page (`chrome://extensions/shortcuts`) for the two browser-level commands; the in-page keys are single letters chosen not to collide, and rebinding them adds a conflict checker, a settings migration and a second source for the hint strip and the `?` panel (today `lib/shortcuts.js` is the one table). No user has asked. If it comes back, the smallest form is a "Change browser shortcuts" button that opens `chrome://extensions/shortcuts` with `chrome.tabs.create`. |
| 7 | Focus mode: hide every tab but the current group's for a while | **Wait** | Chrome has no API to hide a tab. The only honest mechanisms are collapsing the other groups (ungrouped tabs stay visible, so it half-works) or moving the other tabs to a second window (disruptive, and a crash mid-spell leaves the user's session rearranged). It also needs a timer that survives the worker sleeping, and a restore that can conflict with what the user did meanwhile. Not worth the risk until Chrome ships a tab-hiding API (Firefox has `tabs.hide`; Chrome has nothing like it). |

Permissions: none new. The manifest stays `tabs`, `tabGroups`, `storage`, `unlimitedStorage`, `alarms`, `sidePanel`; no host permissions, no `downloads` (exports keep using a blob link in the page), no `notifications`, no `sessions`.

## Features

### 1. Rules for idle tabs, with shelves and a dry run

**User story.** As someone who opens many news and shopping tabs, I want tabs from `news.example.com` that I have not touched for an hour put on a "Reading later" shelf and closed, and tabs from `*.tracker.example.com` never touched, so that my windows stay small without me losing anything.

**What a rule is.** A site pattern (the same host syntax as the 1.2 allowlist: `host` or `*.host`), an idle time (15, 30, 60, 120 minutes, 4 hours, 1 day), and one action:

- `unload` — the 1.2 behaviour, but with this rule's own threshold for these sites;
- `shelve` — copy the tab onto a named shelf, then close it;
- `never` — never unload or shelve these sites (replaces the 1.2 allowlist, which migrates into `never` rules).

Rules are checked top to bottom; the first rule whose pattern matches the tab's host decides; a tab no rule matches falls back to the 1.2 global setting (Unload idle tabs on or off, its threshold). The 1.2 exemptions still apply to every rule and cannot be turned off: the active tab of each window, audible tabs, `autoDiscardable === false`, TabVault's own pages, a tab without `lastAccessed`, and a group whose name starts with the pin emoji. Four more lines, one each:

- A shelving rule never touches the active tab of any window.
- Incognito tabs are never unloaded or shelved by a rule.
- The global "Never unload pinned tabs" wins over every rule; there is no per-rule pinned option.
- A pattern must leave a registrable domain: `*.com` and `*.co.uk` are refused, because a short list of two-level public suffixes (`co.uk`, `com.au`, `co.jp`, `com.br`, `com.sa`, `co.nz`, `co.za`, `com.mx`, `co.in`, `com.tr` and the like, kept in `lib/discard-rule.js`) is treated as a suffix, not a domain.

**Shelves.** A shelf is a named, append-only list of saved tabs that is never rotated out: OneTab's list, kept inside TabVault. Each item is `{url, title, favIconUrl, savedAt, ruleId, group}`, where `group` is `{id, title, color}` of the tab's group when it was shelved (or absent); restoring an item recreates that group (by title and colour in the target window, joining one of the same title and colour if it is there). The Shelves section of the page lists them with Open (in the current window, the item stays), Open and remove, Remove, Open all, Export (JSON or Markdown, feature 4). A shelf can also be filled by hand: "Move to shelf…" in the selection bar and the palette. A shelf with no rule pointing at it is kept until the user deletes it; deleting a non-empty shelf asks first with the count.

**Guards on closing (the OneTab complaint, again).**

1. A shelving rule may save then close a tab only when the user turns that switch on, per rule, after running its dry run. The rule is created with the switch off; the dry run shows the tabs it would shelve right now ("4 tabs would be shelved: …"); the switch unlocks only after that preview has been shown for the current pattern and threshold (editing either locks it again). A dry run that matches more than 50 open tabs does not unlock the switch until the user confirms that count in a second step ("This rule matches 63 open tabs. Turn it on anyway?").
2. The tab is written to the shelf, and the write is read back, before `chrome.tabs.remove` is called; a failed write leaves the tab open and counts as "failed" in the run record.
3. The 25-per-run cap of 1.2 covers unload and shelve together: unloads run first, then shelves, each oldest idle first; the rest wait for the next run.
4. Shelving records nothing in Recently closed itself. The worker's `chrome.tabs.onRemoved` handler (`background.js:304`) already writes the entry when the tab closes; shelving tags that entry with the shelf id (shown as "shelved to Reading later"). When "Remember recently closed tabs" is off, nothing is recorded there at all.
5. The last-run line under the rules shows "last run 12:40: 7 unloaded, 3 shelved"; the toolbar badge does not change meaning.
6. Never the last tab of the last window: when shelving would leave no normal window, the tab is unloaded instead (the same rule as save and close).

**UI (Settings, replacing the Unload idle tabs block).**

```
Idle tabs
  [x] Unload tabs not used for [ 1 hour v ]   (tabs no rule below matches)
  [x] Never unload pinned tabs

  Rules (first match wins)                                   [+ Add rule]
  +----------------------------------------------------------------------+
  | news.example.com      after 1 hour    Shelve to "Reading later"  [on] |
  |                                         Dry run · Edit · ↑ ↓ · Delete |
  | *.tracker.example.com                 Never                      [on] |
  | shop.example.com      after 4 hours   Unload                     [on] |
  +----------------------------------------------------------------------+
  last run 12:40 PM: 7 unloaded, 3 shelved           [Run idle rules now]

  Never touched, whatever the rules say: the tab you are on in each window,
  tabs playing sound, tabs an extension marked as not discardable, tabs in a
  group whose name starts with 📌.
```

The rule editor (inline, no dialog on top of a dialog):

```
  Sites      [ news.example.com          ]   one host; *.host covers subdomains
  After      [ 1 hour v ]
  Then       ( ) Unload   (•) Shelve to [ Reading later v | + New shelf ]   ( ) Never
  [Dry run]   →  4 tabs would be shelved now:
                 The Weekly Roundup · What changed in browsers · …
  [Save]  [Cancel]          (the On switch unlocks after a dry run)
```

The Shelves section of the main page (collapsed by default, like Recently closed):

```
  ▸ Shelves 2
  ▾ Reading later · 14 tabs · from rule "news.example.com"   [Open all] [Export] [⋯]
      N  The Weekly Roundup              news.example.com   12:40   [Open] [×]
      N  What changed in browsers        news.example.com   12:40   [Open] [×]
```

**Storage shape** (`chrome.storage.local`, through a new `lib/shelves.js` and the worker's write queue, like `recentlyClosed`):

```
settings.idleRules = [
  { id: "r1", pattern: "news.example.com", idleMinutes: 60,
    action: "shelve", shelfId: "s1",
    enabled: true, previewedFor: "news.example.com|60" }
]
shelfIndex = [ { id: "s1", name: "Reading later", chunks: 2, updatedAt } ]
shelf:s1:0 = [ { url, title, favIconUrl, savedAt, ruleId, group } ]   // 200 items per key
shelf:s1:1 = [ ... ]                                                  // the newest chunk last
```

Each shelf is chunked at 200 items per key (`shelf:<id>:<n>`); the item count shown in the header is derived from the chunks (200 times the full chunks plus the length of the last), never stored. Removing an item rewrites only its chunk; a chunk left short in the middle is compacted on the shelf's next append.

Settings version: `settings.autoDiscard.allowlist` (1.2; `lib/settings.js:11` and `:37`, read by `lib/discard-rule.js`) migrates once into `never` rules at worker start and the key is kept one release for downgrade; `settings.idleRules` defaults to `[]`, so a 1.2 user sees no change in behaviour until they add a rule. The pure part of the decision (which tab gets which action) stays in `lib/discard-rule.js`, extended to `planIdle(tabs, groups, settings, now)` returning `{unload: [ids], shelve: [{id, shelfId}], skipped}`.

**Permissions touched:** `tabs` (already: `remove`, `discard`, `query`), `storage`, `alarms` (the existing 5-minute `tabvault-idle` alarm). None new.

**Tests.** Unit: first-match order; `never` beats a later `shelve`; the fallback to the global setting; the exemptions apply to every action; a shelving rule skips the active tab of every window; incognito tabs are never planned; the global pinned setting wins over every rule; the cap of 25 across both actions with unloads before shelves and oldest idle first; a pattern that leaves only a public suffix (`*.com`, `*.co.uk`, `*.com.sa`) is refused; more than 50 matches needs the second confirmation; the shelf item keeps the group and a restore recreates it; chunking at 200 (the 201st item opens chunk 1, the count is derived); the last-tab case turns shelve into unload; the allowlist migration (1.2 list becomes `never` rules, idempotent, a 1.3 store left alone); `shelves.add` dedups the same URL on the same shelf within a minute; a failed shelf write produces no close in the plan's executor (fake storage that rejects). e2e: a rule created disabled, the switch locked until the dry run, the dry run listing the fixture tabs; "Run idle rules now" shelving a fixture tab whose `lastAccessed` is old (the harness sets the idle time to the minimum and backdates through a test hook, as Z does for discard), the tab gone, the shelf listing it, the Recently closed entry tagged with the shelf id (and no entry when "Remember recently closed tabs" is off); Open from the shelf. The unload half stays LIMITED where Playwright's Chromium crashes on `chrome.tabs.discard`.

**Risks.** (a) The listing promise changes: "nothing is ever closed" becomes "Nothing is closed unless a rule you wrote says so" — the description, PRIVACY.md and the in-page note must all change together. (b) A wrong pattern shelves half the browser: a pattern must leave a registrable domain (the suffix list above), the switch stays off until the dry run, more than 50 matches needs a second confirmation, and the cap is 25 a run. (e) Text typed into a tab (a half-written form or comment) can be lost when the tab is shelved: closing a tab does not keep its page state, and TabVault cannot read page content to warn. The dry run is the guard: it lists every tab the rule would close before the switch can be turned on, and the active tab of each window is never shelved. (c) `lastAccessed` resets when Chrome restarts on some versions, so a rule may wait longer than set after a restart; that errs on the safe side and is said in the note. (d) Storage growth: a shelf grows without bound; `unlimitedStorage` covers it, the chunks of 200 keep each write small, and the shelf header shows the derived count so the user sees it.

### 2. Compare a snapshot with now

**User story.** After Chrome crashed and restored only some windows, I want to see which tabs from this morning's snapshot are not open now, and reopen just those.

**What it does.** "Compare with now" on any snapshot row (and in the palette: "Compare latest snapshot with now"). The diff is by normalised URL (the duplicate finder's normaliser, honouring Ignore #hash), window by window where windows can be matched (by window name, else by the largest URL overlap), with three lists: missing now (in the snapshot, not open), new since (open, not in the snapshot), moved (open but in another window or group). Actions: Reopen missing (all, or ticked ones) into one new window, or into their matched windows; Select new (puts the "new since" tabs into the page's selection so the bulk bar acts on them). Nothing closes from this view.

**UI.**

```
  Compare: 11/8/2026, 9:06 AM (change) with now                       [Close]
  Missing now 6   New since 11   Moved 2        [ ] Ignore #hash
  ── Missing now ───────────────────────────────────────────────────────
  [x] D  Manifest V3 migration guide   docs.example.com    was in Research
  [x] T  Flights - March               travel.example.com  was in Personal
  ...
  [Reopen 6 in a new window]  [Reopen into their windows]
  ── New since ─────────────────────────────────────────────────────────
     M  Inbox (12)                     mail.example.com    Work      [Select all new]
```

**Storage shape:** none. The diff is computed in the page from `snap:<id>` and `chrome.windows.getAll`; a new pure module `lib/diff.js` (`diffSessions(snapshot, current, {ignoreHash})`).

**Permissions touched:** `tabs` (read, `create` for reopen), `storage` (read). None new.

**Tests.** Unit: identical sessions give three empty lists; one tab closed, one opened, one moved between windows; duplicate URLs counted by multiplicity (two copies saved, one open, one missing); window matching by name and by overlap; Ignore #hash on and off; `chrome://` and TabVault's own URLs ignored on both sides. e2e: take a snapshot, close one fixture tab and open another, Compare shows one missing and one new, Reopen missing restores it (lazy restore off in the harness, as I-a).

**Risks.** Large sessions (thousands of tabs): the diff is O(n) with a map and runs only on click. Window matching can guess wrong; the view shows "was in Research" and the default action reopens into one new window, which is always safe.

### 3. Search every saved tab from the palette

**User story.** I remember reading a page about storage quotas last week; I want to type "quota" into the palette and see it whether it is open, in a snapshot, on a shelf or in Recently closed, and open it, or open every match at once.

**What it does.** The palette (Alt+K) gains a scope prefix and a second section. Typing searches open tabs and actions as today; results from saved places follow under "Saved" with where they are ("snapshot 11/7, 9:06 AM · Research", "shelf Reading later", "recently closed 12:59"). A saved URL is listed once, under its newest occurrence, with "+3 older" when it appears in more. Prefixes narrow it: `s:` saved only, `t:` open tabs only, `a:` actions only (`>` is not used; it collides with nothing but reads as a shell prompt). Matched words are highlighted with `<mark>` built through `el()` text nodes, never `innerHTML` (the lint rule stays). Enter opens the saved tab in the current window (focuses it instead if the URL is already open); Shift+Enter opens it in a new window; "Open all N matches" is the last row when there are two or more saved matches, opens them unloaded in one new window (lazy restore's path), and asks first above 20 ("Open 37 tabs?").

**UI.**

```
  [ s: quota                                                         ]
  ── Open tabs ────────────────────────────────────────────────────────
     D  chrome.storage [quota]s explained   Research   docs.example.com
  ── Saved ────────────────────────────────────────────────────────────
     D  chrome.storage [quota]s explained   snapshot 11/7 9:06 AM  +3 older
     D  Storage [quota] errors in MV3       shelf Reading later
     D  Raising the [quota]                 recently closed 12:59
     ↳  Open all 3 saved matches in a new window
  ↑ ↓ move · Enter open · Shift+Enter new window · Esc close
```

**Storage shape:** none persisted. The page builds an in-memory index on the first palette open of a page load: every `snap:<id>` (read through `lib/snapstore.js`), every `shelf:<id>:<n>` chunk, `recentlyClosed`; one entry per (normalised URL), keeping the newest occurrence and a count. It is rebuilt on `storage.onChanged` for those keys (debounced 1 s). Scoring reuses `lib/palette.js` `textScore`; saved results rank below open tabs of equal score and are capped at 30 rows.

**Permissions touched:** `storage` (read), `tabs` (`create`, `update` to focus). None new.

**Tests.** Unit (`lib/palette.js` extended, new `lib/saved-index.js`): one entry per URL across snapshots with the newest kept and the count right; the prefixes; highlight ranges for multi-word queries, overlapping and case-insensitive matches, and a title containing `<script>` rendered as text (the ranges are offsets, the page builds text nodes); the 30 cap; "Open all" above 20 asks. e2e: seed two snapshots and a shelf through the worker, type a word in the palette, the Saved section lists one row with "+1 older", Enter opens it, "Open all" opens a window with the matches.

**Risks.** Memory: 200 snapshots of 500 tabs is 100,000 entries before dedup; after dedup by URL it is the user's distinct URLs (usually a few thousand), well within a page's budget, but the index is built lazily and only on palette open. Privacy: no change, all of it is already stored locally; the listing's Web history disclosure covers it.

### 4. Markdown export and import (and a JSON round trip)

**User story.** I want to paste my research window into my notes as a list of links, and later paste a list of links from my notes back into TabVault and open it as a window.

**What it does.** Export (current session, a snapshot, a shelf, or the current selection) gets a format choice: JSON (as today, schema 1) or Markdown. Markdown is one `## Window name` heading per window (or `## Window 2`), a `### Group name` heading per group, and one `- [title](url)` line per tab; pinned tabs get a trailing ` (pinned)`. Import accepts a `.json` file (as today), a `.md` or `.txt` file, or pasted text: every `[title](url)` and every bare `http(s)://` URL on its own line is a tab, `##` headings start a window, `###` headings start a group; with no headings it is one window. The import preview (already in 1.0 for JSON: pick the windows to restore) shows the parsed windows before anything opens.

**Allowed URLs on import:** `http:`, `https:`, `file:` (opened only if the user allowed file access; otherwise reported), `ftp:` is dropped, and `javascript:`, `data:`, `chrome:`, `chrome-extension:`, `about:` (except `about:blank`) are dropped with a count in the preview ("3 links skipped: not web pages"). The same filter is applied to JSON imports from 1.3 on, which they lacked.

**UI.**

```
  Export                                                      [Close]
  What     (•) This session  ( ) Selected tabs (12)  ( ) Snapshot…  ( ) Shelf…
  Format   (•) JSON (restorable, every detail)   ( ) Markdown (for notes)
  [Download]  [Copy to clipboard]

  Import                                                      [Close]
  [Choose file…]  or paste:
  +------------------------------------------------------------------+
  | ## Research                                                      |
  | - [Manifest V3 migration guide](https://docs.example.com/mv3)    |
  +------------------------------------------------------------------+
  Found 2 windows, 14 tabs, 1 group · 3 links skipped: not web pages
  [x] Research (10)  [x] Window 2 (4)          [Restore selected]
```

Copy to clipboard uses `navigator.clipboard.writeText` from the click, with no `clipboardWrite` permission; that is check 1 of the release plan's real-install checks. If the check fails, the button falls back to a selected textarea with "press Ctrl+C", and no permission is added.

**Storage shape:** none. `lib/exporters.js` gains `toMarkdown(session, {title})` and `parseMarkdown(text)`, returning the same session object `parseImport` returns, so restore does not change.

**Permissions touched:** none (blob download and file input as today; clipboard from a user gesture).

**Tests.** Unit: JSON round trip (session to `toJsonFile` to `parseImport` deep-equals the session, window names and groups included); Markdown round trip on URLs, titles, window names, group names and order (`parseMarkdown(toMarkdown(s))` equals `s` reduced to those fields); titles with `]`, `)`, `|` and backticks escaped and restored; bare URLs; no headings; CRLF input; the scheme filter with every dropped scheme; an empty or junk paste gives a clear error and opens nothing. e2e: export Markdown of a fixture window (the download is captured through Playwright's download event), paste it into Import, restore, compare URLs.

**Risks.** Markdown escaping is fiddly; the round-trip tests are the guard. A paste of thousands of links opens thousands of tabs: the preview shows the count and the restore keeps lazy loading on, and above 100 tabs it asks again.

## Scope

In: the four features, the allowlist migration, the JSON import scheme filter, the listing and PRIVACY.md changes for shelving, tests at both levels, screenshots for the new views. Out: scheduled snapshots, shortcut rebinding, focus mode, a one-click duplicate keep, any sync, any server, any account, page-content search (breaks the privacy promise).

## Tests (totals)

Unit: from 70 to about 105 (`lib/discard-rule.js` planIdle, `lib/shelves.js`, `lib/diff.js`, `lib/saved-index.js`, `lib/exporters.js` Markdown and filter, the migration). e2e: from 27 to 32 scenarios (AA rules dry run and shelve, AB shelves section, AC compare, AD saved search in the palette, AE Markdown export and import). Lint 0 errors; `npm run pack` produces `dist/tabvault-1.3.0.zip` with no new files outside `app/`, `lib/`, `background.js`, `icons/`, `manifest.json`.

## Store

- No new permission, so the upload asks no new justification. The `tabs` and `alarms` rows in section 5 of `docs/store/listing.md` gain "and closes tabs a rule you wrote shelves, after saving them" (`tabs`) and "runs your idle rules" (`alarms`). The single purpose sentence gains "files idle tabs onto local shelves by the user's rules".
- The store promise for 1.3 reads exactly: "Nothing is closed unless a rule you wrote says so". It replaces "nothing is ever closed" in the description, PRIVACY.md and the in-page note.
- What the reviewer will ask: why an extension closes tabs without a click. The answer in the listing and the justification: only a rule the user wrote closes tabs, and only after the user ran its dry run and turned its switch on; every closed tab is saved to a local shelf first; the default is off. The Web history disclosure stays (shelves are tab URLs and titles, stored locally); no new data type.
- PRIVACY.md: a Shelves bullet under What TabVault stores (name, the saved tabs, kept until you remove them), the idle rules under settings, and the Unload idle tabs bullet widened to rules (it reads the same tab details and keeps only the run record; shelving stores the tab's title, address and favicon address on the shelf you chose).
- Screenshots (decided): 03 becomes the rules block with a dry run open; 04 (duplicates) is replaced by the palette's Saved section when 1.3 ships; 05 stays snapshots.

## Release plan

- Version 1.3.0 "Shelf"; branch `feature/1.3-shelf`; built on Opus by the plan's tasks in this order: (1) `lib/exporters.js` Markdown and the scheme filter (smallest, no UI risk), (2) `lib/diff.js` and the Compare view, (3) `lib/saved-index.js` and the palette's Saved section, (4) `lib/shelves.js`, `planIdle`, the migration, the Settings rules block and the Shelves section. Each task with its unit tests first; e2e after each; Naqid reviews the branch before any merge, with feature 1 as the focus.
- Real-install checks before the upload (no automation covers them):
  1. Verify in a real install that `writeText` works from the options page without `clipboardWrite`.
  2. A shelving rule at 15 minutes on a test site: the dry run lists the tabs, the switch unlocks, the tabs land on the shelf with their group and are closed, the active tab stays.
  3. Restore a shelved item whose group is gone: the group is recreated with its title and colour.
- The listing's NEW IN 1.3 block (CHANGES text):

```
NEW IN 1.3
• Shelves: named lists of saved tabs that are never rotated away. Move tabs to a shelf by hand, or write a rule.
• Idle rules: per site, after the time you choose, unload the tab, shelve it (saved first, then closed), or never touch it. Nothing is closed unless a rule you wrote says so: a shelving rule stays off until you have run its dry run and turned it on, and at most 25 tabs are handled a run.
• Search everything you saved: the Alt+K palette now finds tabs in your snapshots, shelves and recently closed list, highlights the match, and opens one or all of them.
• Compare a snapshot with now: see what is missing, what is new and what moved since then, and reopen just the missing tabs.
• Markdown: export a window, a snapshot or a shelf as a list of links for your notes, and paste a list of links back in to open it as a window.
• Imports now skip links that are not web pages (javascript:, data:, chrome: and the like) and tell you how many.
```

- HISTORY.md gets the 1.3.0 section; CLAUDE.md the non-obvious rules (first match wins, the dry-run lock, shelf write before close, the saved index is in-memory only).

## Assumptions (Wakeel or the owner may overturn any)

1. Four features: rules with shelves, compare, saved search, Markdown. Scheduled snapshots, rebinding and focus mode wait; the duplicate one-click is already shipped.
2. Ruled by Wakeel (2026-11-08): a shelving rule may save then close a tab only when the user turns that switch on per rule after running its dry run; the store promise reads "Nothing is closed unless a rule you wrote says so".
3. The 1.2 allowlist becomes `never` rules (one migration, the old key kept one release).
4. Saved search lists one row per URL (newest occurrence) rather than every snapshot's copy.
5. Ruled by Wakeel (2026-11-08): screenshot 04 (duplicates) is replaced by the palette's Saved section when 1.3 ships; 03 becomes the rules block.
6. The version is 1.3.0, released after the 1.2.0 store review has passed (one package in review at a time).
