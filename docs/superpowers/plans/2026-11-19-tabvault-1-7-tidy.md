# TabVault 1.7.0 "Tidy" — implementation plan

Date: 2026-11-19. Spec: `docs/superpowers/specs/2026-11-19-tabvault-1-7-tidy-design.md`. Branch `feat/tidy-1.7` from tag `v1.6.0` (main 14a1205), worktree `E:/Dev/tabvault-tidy`. Test first, task by task. Nothing is merged, pushed, tagged or uploaded by this plan; Naqid reviews the branch first.

House constraints for every task: no new required permission (only `notifications`, optional, asked inside a click); no `innerHTML` or `insertAdjacentHTML`; no `alert`, `confirm` or `prompt`; no literal backslash in any new or edited line; pure logic in `lib/` with the UMD wrapper; every storage write of snoozes, the tidy state and the kept list goes through a worker queue; no tab title or address leaves the browser; e2e only with `TABVAULT_HEADLESS=1` and a free `TABVAULT_E2E_PORT`, at most two full runs.

## Task 1 — `lib/snooze.js` (tests first: `test/snooze.test.js`)

`wakeTimeFor(choice, now, { morningHour = 9 })` for `later` (+3 h), `tomorrow` (next day 9:00), `nextWeek` (the next Monday 9:00, a week on when today is Monday); `wakeError(ts, now)`; `snoozeEntries(tabs, groupsById, { wakeAt, now, ownPrefix })` returning `{ entries, skipped }` (no incognito, own pages or non-web pages); `dueEntries`, `nextWakeAt`; `wakePlan(entries, liveWindowIds)` (one bucket per live window, every other entry in one new-window bucket, in snooze order, with the group targets); `markWoken`, `markFailed` (three attempts), `markSeen`, `pruneWoken` (seen or older than 7 days), `reschedule`, `removeEntries`; `snoozeLabel` for the saved index.

## Task 2 — `lib/group-rules.js` (tests first: `test/group-rules.test.js`)

`cleanGroupRule`, `cleanGroupRules` (also in `withDefaults` through `lib/settings.js`), `matchGroupRule(rules, tab)` (site via `lib/discard-rule.js` `hostOf` and `hostAllowed`, title word), `ruleTargetFor(tab, rules, { leftAlone, windowType })` (null for pinned, grouped, incognito, non-normal windows, left alone), `planGroupRules(windows, rules, { leftAlone })` for the preview, `leftAloneAfter(map, tabId, changeInfo, tab)` (a change to no group adds the tab with its host; a navigation to another host removes it), `mergeGroupRules(current, incoming)`.

## Task 3 — `lib/tidy.js` (tests first: `test/tidy.test.js`)

`tidySections(session, { now, idleDays, ignoreHash, kept, woken, ownPrefix })` returning `{ woken, duplicates, stale, lonely }` with one section per tab; `keptKey`, `pruneKept` (30 days); `weekLine(log, now)`; `tidyDue(state, settings, now)` returning `{ due, state }` (first sight sets `lastAt`); `appendTidyLog`.

## Task 4 — the worker (`background.js`)

Snooze section: `snoozeWrite` queue, messages `snoozeTabs`, `snoozeWake`, `snoozeReschedule`, `snoozeCancel`; `wakeDue()` at every start, `onStartup`, the snooze alarm and the idle tick; tabs created then marked woken; `tabs.onActivated` marks seen; the Recently closed entry tagged `snooze: { wakeAt }`; `self.wakeDueSnoozes` and `self.snoozeClockOffset` for the harness. Group rules section: `tabs.onUpdated` (url, groupId) through `ruleTargetFor`, the left-alone map in `storage.session`, messages `groupRulesPlan`, `groupRulesApply`, `groupRulesUndo`. Tidy section: `tidyClose` (shelf "Tidy <date>" found or made, then the shelving path), `tidyKeep`, `tidyLogAdd`, `tidyDismiss`; the due check on the idle tick; the optional notification and its click.

## Task 5 — the page (`app/tidy.js`, `app/index.html`, `app/app.js`, `app/dialogs.js`)

New `app/tidy.js` (loaded after `bookmarks.js`): dialogs `snooze`, `groupRules`, `tidy`; the Snoozed section; the tidy bar. `app/app.js`: the selection bar's Snooze, the ⏾ on group headers, four palette commands, snoozes in the saved index (Enter wakes), hooks for the new file. `app/dialogs.js`: the JSON export of the session carries `groupRules`; the import offers to add them. `app/index.html`: the menu items, the section, the bar, the CSS.

## Task 6 — e2e (`e2e/run.js`)

TA, TC, TD after AH; TB last of them (it closes and relaunches the browser), before L and K. Ids start with T so they never collide with the AI branch's AI, AJ, AK.

## Task 7 — version, docs, store kit

1.7.0 in `manifest.json` and `package.json`; `CHANGES.md` for the owner; `docs/HISTORY.md`; `CLAUDE.md` rules; `README.md` feature list; `PRIVACY.md`; `docs/store/listing.md` (What's new, justifications for every permission, section 18 hand checks); `tools/screenshots.js` three new shots; `docs/store/upload-next.md` for the owner.

## Gates

`npm run lint` 0 errors; `npm test` green; `npm run e2e` headless, all PASS (LIMITED only where `chrome.tabs.discard` crashes Playwright's Chromium); `npm run pack` builds `dist/tabvault-1.7.0.zip` with nothing outside `manifest.json`, `background.js`, `app/`, `lib/`, `icons/`. Backslash and control-byte count of every touched file: 0 new.

## Deliberately left out

Workspaces, notes and tags, the AI branch, an Arabic interface (no `_locales` exists), path or regular-expression rules, a rule that moves an already grouped tab, a tidy that acts without the user, a snooze morning-hour setting (9:00 is fixed in 1.7), counts or names in the notification.

## Real-install checks left for the owner (no automation covers them)

1. Snooze a tab for "Later today", quit Chrome, start it after the wake time: the tab is back.
2. A group rule while dragging tabs by hand in the tab strip: a dragged-out tab stays out.
3. Turn on the tidy notification: Chrome's prompt, and the permission gone after turning it off.
