# SDD ledger — plan: docs/superpowers/plans/2026-09-17-tabvault.md
Spec: docs/superpowers/specs/2026-09-17-tabvault-design.md (read)
Branch: feature/tabvault-1.0 (in place; Chrome load-unpacked path stability)
Ruling: work in place on a feature branch, no worktree — cost if wrong: none material.

## Pre-flight scan
| Pair / task | Produces vs consumes | Found |
|---|---|---|
| T1 -> T2,T3 | buildSession/countTabs/stripVolatile; fake-data builders | tests use them consistently; OK |
| T3 -> T5 | makeSnapshot(session, reason, now), isSameSession, rotate(list, keep) | background.js calls match; OK |
| T3 -> T7 | toJsonFile(session,{now,version}) -> {filename,text}; parseImport(text) | dialogs.js calls match; OK |
| T4 -> T7 | planRestore(session,{selectedWindowIds,allowIncognito,screen}) -> {steps,skipped}; step shapes | executor switch covers every op; OK |
| T5 -> T7 | messages snapshotNow/deleteSnapshot/pinSnapshot; sender gate = extension page URL | dialogs send from the page; OK |
| T6 -> T7 | window.TabVaultApp {getSession,getSettings,saveSettings,openDialog,closeDialog,toast,selection,dialogs,el,focusTab}; #dialog box | dialogs.js uses el/toast/closeDialog/getSession/getSettings/saveSettings/dialogs; OK |
| T6 index.html | script order lib/* then app.js then dialogs.js | dialogs.js reads window.TabVaultApp set synchronously by app.js IIFE; OK |
| T1 manifest | permissions incl. alarms (deviation recorded in spec and plan) | OK |
| T8 | e2e prose adapted from FormKeeper harness; scenario K waits 40 s | acceptable; noted |
| Rubric | Tasks 5–7 have no unit tests (Chrome API + DOM); e2e covers them | accepted |
Ruling: implementers for Tasks 5–7 do node --check plus a manual Chrome check when they can; the in-repo e2e (Task 8) is the verification of record — cost if wrong: UI bugs surface at Task 8 instead of per task.

## Progress
Task 1: complete (commits f6faa7a..a2b3701, review clean)
Task 1: minor (deferred): buildSession keeps popup/app/devtools window types (display/restore may want to filter); no tests for multiple groups per window or dead groups
Task 2: complete (commits a2b3701..765ec0e, review clean)
Task 2: minor (deferred): normalizeUrl renders about:/mailto: style URLs as scheme://host (cosmetic, grouping unaffected)
Task 3: complete (commits 765ec0e..02e95b4, review clean)
Task 4: complete (commits 02e95b4..5882573, review clean)
Task 4: note for Task 7 executor: verify live that createTab with pinned plus a later updateTab pinned keeps saved order; the redundant updateTab is spec-mandated and idempotent
Task 5: review (opus) found 1 Important (plan-mandated): title changes re-arm the debounce → starvation and churn. Ruling: drop title from the trigger, add mutedInfo; make stripVolatile sort windows by id so focus order does not defeat dedup; openPage query uses PAGE_URL + "*" — cost if wrong: a title-only change is captured on the next structural change instead of immediately.
Task 5: minor (deferred): minimized window focus may need state normal; onCommand/onStartup swallow errors silently; UA version is major-only; whole-array rewrite per snapshot (plan-mandated storage shape); msg.id unvalidated (safe no-op)
Task 5: fix round 1/5 (3 addressed, 0 open; commits 3beefc3..72f5020)
Task 5: complete (commits 5882573..72f5020, review clean after 1 fix round)
Task 6: review (opus) found 5 Important (plan-mandated): column scroll lost on re-render; keyboard cursor enters CSS-hidden rows; close-window label uses the filtered count; group rename destroyed by re-render; move/drop/group failures silent. Ruling: fix all five plus dragend cleanup and favicon loop guard in one round — cost if wrong: re-render pauses while a rename input is focused.
Task 6: minor (deferred): same-window downward drop index asymmetry; Space/Enter double-activation when a grid button has focus; rows lack tabindex/role (a11y); theme flash before settings load; forEachSelected is serial
Task 6: fix round 1/5 (7 addressed, 1 new open — editing flag can stick forever if the rename save rejects; commits ffd085a..a15bc06)
Task 6: fix round 2/5 (1 addressed, 0 open; commits a15bc06..e49f875)
Task 6: complete (commits 72f5020..e49f875, review clean after 2 fix rounds)
Task 7: review (opus) found 1 Important (plan-mandated): after a failed createWindow the remaining steps resolve refs to undefined and act on the user's current window. Ruling: track failed windows and skip steps with unmapped refs; also guard duplicates close, restore failures, and the "nothing to snapshot" reply — cost if wrong: none.
Task 7: minor (deferred): parseImport does not validate window ids; settings validation message styled as helper text; tables lack tbody; dialogs do not move focus/trap focus; fitBounds does not validate left/top against the screen
Task 7: fix round 1/5 (4 addressed, 0 open; commits 8808ea8..3fa0a9b)
Task 7: minor (deferred): a window created with no tabs would map the window ref without firstTabRef (Chrome does not produce this)
Task 7: complete (commits e49f875..3fa0a9b, review clean after 1 fix round)
Task 8: e2e 12/12 reported, but review (opus) found scenario I scored PASS with none of its assertions (Restore click crashes Playwright's Chromium on chrome.tabs.discard; harness substituted an isolated discard check). Ruling: (a) add a real setting lazyRestore (default on) and a planRestore `discard` option so the full restore path is verifiable with discard off; (b) scenario I splits into I-a (must PASS: windows, URLs, groups) and I-b (discarded===true, LIMITED when the browser dies, never PASS); LIMITED is reported separately, exit code non-zero only on FAIL/NOT RUN; worker handle re-acquired; console errors fail the part — cost if wrong: one extra setting; lazy-load-inside-restore stays unverified by automation and goes on the manual checklist.
Task 8: minor (deferred): clearSelection swallows failures; positional selector for the density control
Task 8: fix round 1/5 (7 addressed, 0 open; commits 98ad271..6b3cf1e). e2e: 13 scenarios (I split into I-a/I-b); final runs 13/13 PASS and 12 PASS + 1 LIMITED (I-b), exit 0. Unit 21/21.
Task 8: minor (deferred): LIMITED branch tolerates the isolated discard check itself failing; looksLikeDisconnect classifies by message text alone; I-a hardcodes the "Restored 1 windows and 2 tabs." string; stale sw comment; README says A–L
Task 8: complete (commits 3fa0a9b..6b3cf1e, review clean after 1 fix round)
All tasks complete. Final whole-branch review dispatched over f6faa7a..6b3cf1e.
Final review (fable): With fixes. Important: I-1 restricted first-tab URL or non-numeric bounds drops a whole window on restore; I-2 100 ms re-render wipes the close confirmation, open selects, focus; I-3 url-driven navigations can starve change snapshots; I-4 single snapshots key rewritten in full; I-5 non-normal/incognito windows offered as move targets that fail.
Ruling: single fix wave = I-1 (retry windows.create without url, numeric bounds, test), I-2 (state-held confirmation, stable move-target options, select-open guard), I-3 (max-wait cap via chrome.storage.session pendingSince), I-4 minimal (storageVersion key + drop data: favicons over 2 KB from stored sessions; the key split stays deferred), I-5 (exclude non-normal windows from move/drop targets; split incognito moves with a toast; pass incognito to windows.create), M-1 docs, M-2 catch+toast on fire-and-forget calls, M-4 count discard failures, M-5 import size cap, M-3 manual checklist line — cost if wrong: ~150 contained lines under one scoped re-review.
Ruling: M-6 (more e2e scenarios), M-7 (settings cache in worker), M-8 (keyed DOM reconciliation), and the snapshot key split stay deferred to 1.1.
Final fix wave base: 6b3cf1e
Final fix wave: re-review (opus) — all 12 findings ADDRESSED; unit 23/23; e2e 13/13.
Final: parked — background.js cap branch returns without checking an alarm is pending; if storage.session.remove ever rejects, pendingSince goes stale and change snapshots stop for the session — Ruling: rare double failure; follow-up: chrome.alarms.get fallback in the cap branch — cost if wrong: change snapshots stop until browser restart.
Final: parked — rows and groups inside non-normal (popup) window columns remain drop targets; the drop fails with a "Could not move" toast — Ruling: cosmetic; follow-up: skip row/group drop handlers when the column is nodrop.
Final: parked — confirm-close button has no .catch; the delegated change handler is a no-op (blur flushes); tabbing between grid selects drops focus to body; a retried window keeps an extra New Tab page and a single-tab group in it throws into the per-step catch.
