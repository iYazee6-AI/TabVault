# TabVault 1.7.0 "Tidy" — design

Date: 2026-11-19. Status: the owner's word of the day ("let's continue the work and prepare its version"); he picked none of the five ideas offered on 2026-11-17 (workspaces, snooze, auto-group rules, weekly tidy, notes and tags), so Wakeel picked three that share one idea: **the browser tidies itself and nothing is lost**. Builds on 1.6.0 (tag `v1.6.0`, main 14a1205). Branch `feat/tidy-1.7`, worktree `E:/Dev/tabvault-tidy`.

## Why

1.2 to 1.6 made TabVault good at keeping things: snapshots, recently closed, shelves, bookmarks. The windows themselves still grow until the user sits down and cleans them by hand. 1.7 adds the three habits that keep a browser small without a cleaning session: put a tab away until it is needed (snooze), file new tabs into the right group as they open (rules), and once a week look at what has gone stale (tidy). Every one of them closes tabs only into a place TabVault already keeps, so each step can be undone.

## Out of 1.7

Workspaces (the next version), notes and tags, anything from the AI branch (`feat/ai-assistant` is not merged and not touched), a snooze "when I next open this site" trigger, regular-expression or path rules, an Arabic interface (the extension has no `_locales`; it stays English like every version before), a tidy that runs by itself without the user looking.

## Permissions

Before: `tabs`, `tabGroups`, `storage`, `unlimitedStorage`, `alarms`, `sidePanel`, `contextMenus`, `scripting`; optional `bookmarks`; optional host `<all_urls>`.

After: the same required list (snooze uses the `alarms` permission TabVault already has); one new **optional** permission, `notifications`, asked for only inside the click on "Tell me with a notification" in the Tidy settings, and given back when that switch is turned off. Without it the weekly tidy shows a calm bar in the page and nothing else. No required permission is added, so the update asks Chrome users nothing.

## 1. Snooze

- **What.** Put a tab, the selected tabs or a whole group away until later today (in 3 hours), tomorrow morning (9:00), next week (Monday 9:00) or a date and time picked in the dialog (at least a minute ahead, at most a year). The tabs close now and reopen then, inactive, in their window when it still exists (found by the window id of the same browser run), else together in one new window; pinned tabs come back pinned; grouped tabs come back in a group of the same name and colour (joined when the window has one, made otherwise).
- **Where.** The selection bar's Snooze button, a ⏾ button on every group header, the palette ("Snooze selected tabs"). A Snoozed section under Shelves (collapsed, with the count) lists each tab with its wake time and Wake now, Reschedule, Cancel. Cancel asks once and then forgets the snooze without opening it; the tab is still in Recently closed (when recording is on), so nothing is lost silently.
- **Kept like the vault.** Entries live in `chrome.storage.local` under `snoozed` (`lib/snooze.js`), written only by the worker's `snoozeWrite` queue, written and read back before any tab closes (the shelf rule of 1.3). Their Recently closed entry is tagged "snoozed until …". The palette's saved search finds them ("snoozed until Mon 09:00"); Enter on one wakes it instead of opening a copy.
- **Waking.** One alarm, `tabvault-snooze`, set to the earliest wake time (`when`). The worker also wakes what is due at every start, at browser startup, and on every 5-minute idle tick, so a wake missed while the browser was closed or the alarm was lost happens at the next chance, and nothing is ever dropped: an entry is marked woken only after its tab was created; a failed wake stays listed with the error and is tried again (three times, then it waits for Wake now). This is the "cap-branch alarm fallback" lesson of 1.2: never trust one alarm alone.
- **Woken and not looked at.** A woken entry keeps the new tab's id until the user activates that tab (then it is dropped) or for 7 days; the tidy lists the ones still open and unseen.
- **Never.** Incognito tabs (nothing of them is stored), TabVault's own pages, and anything but http, https and file pages are not snoozed; they are counted in the toast.

## 2. Group rules

- **What.** A rule is a site (`example.com` or `*.example.com`, the idle-rule syntax and its "must leave a registrable domain" check), an optional title word (case-insensitive), a group name and a colour, and an on switch. Rules are checked top to bottom; the first match wins. No rules, nothing happens: the feature is off until the user writes one.
- **When.** A tab that navigates (a new tab loading its first page included) to a matching page is put into the group of that name in its window (joined when one exists, made with the colour otherwise).
- **Never fights the user.** A rule only moves a tab that is in no group (a tab the user or Chrome put into a group stays there). It never moves a pinned tab, an incognito tab, or a tab in a popup or app window. If the user takes a tab out of a group (drag, Ungroup, anything that sets its group to none), that tab is left alone until it navigates to a different site; the list lives in `storage.session` (`groupRulesLeftAlone`) so a worker restart keeps it.
- **Run on open tabs now.** The Group rules dialog previews every tab that would move ("title → group"), counts the ones left alone, and Apply moves exactly the previewed tabs that still match; Undo puts them back where they were (ungrouped, at their old place). The undo lives in the dialog until it closes.
- **Backup.** The JSON export of "This session" carries the rules (`groupRules`) when there are any; importing such a file offers "Add N group rules" (rules already present are skipped). Markdown export is unchanged.

## 3. Weekly tidy

- **What.** A calm review in the page or the side panel (Tidy dialog: ⋯ → Tidy now, or the palette). Four sections, each with its count, select all, and its actions: **Not visited for N days** (default 14; never pinned, active, audible or TabVault tabs; oldest first), **Duplicates** (every copy but the one Find duplicates would keep), **Groups with one tab** (with Ungroup as a fourth action), **Woke from snooze, not looked at**. A tab is listed once (woken, then duplicates, then not visited, then lonely groups).
- **Actions.** Close into the vault (the tabs are saved to the shelf "Tidy <date>", read back, then closed; the result line has Restore, which reopens them in this window with their groups and takes them off the shelf), Snooze (the snooze dialog), Keep (hides that page from the tidy for 30 days; for a woken tab it also marks it seen). Nothing is pre-ticked.
- **Once a week.** The worker checks on its 5-minute tick: a week after the last tidy (or after the update to 1.7) the page shows a bar "Your weekly tidy is ready" with Open and Not now (Not now waits another week). No notification unless the user turns on "Tell me with a notification" in the Tidy dialog (the optional permission above); the notification says only that the tidy is ready, no tab names.
- **Tidied this week.** The dialog's last line sums the past 7 days: "Tidied this week: 12 closed into the vault, 3 snoozed, 4 kept" (`tidyLog`, the last 20 runs).

## Storage keys (all `chrome.storage.local` unless said)

`snoozed` (array, worker-written), `settings.groupRules`, `settings.tidy` (`{ weekly, idleDays, notify }`), `tidyState` (`{ lastAt, dueAt, notifiedAt }`), `tidyKept` (normalised address to time), `tidyLog`; `storage.session` `groupRulesLeftAlone` (tab id to host). Nothing leaves the browser.

## Tests

- Unit, pure functions: `lib/snooze.js` (wake times for each choice across midnight, month end and a Sunday; validation; due and next-wake; the wake plan by window with groups and pinned; failed wakes kept and counted; woken pruning), `lib/group-rules.js` (site and title-word matching, first match, never pinned or grouped or incognito or popup, left-alone until another site, the preview plan, rules cleaning and import merge), `lib/tidy.js` (each section, the day threshold, one section per tab, kept pages hidden for 30 days, woken only while open and unseen, the week's line, due once a week).
- e2e (headless): TA snooze a grouped and a pinned tab and Wake now brings both back into their window with the group; TB snooze, the wake time passes while the browser is closed, the relaunched browser wakes the tab (in a new window) and the list is empty; TC a rule groups a new tab, a tab dragged out (ungrouped) is left alone, and comes back under the rule only after it navigates to another site, plus the preview, Apply and Undo; TD a tidy run closes stale tabs into the vault and Restore brings them back.

## Store

Version 1.7.0 in `manifest.json` and `package.json`; the About dialog already shows the manifest version. Listing: What's new, the summary line kept, a `notifications` justification (optional), the `alarms` justification widened to snooze. PRIVACY.md: snoozes, rules and the tidy log are stored locally only. Three new screenshots (snooze, rules, tidy), taken headless.
