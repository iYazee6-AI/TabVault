const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../lib/tidy.js");

const DAY = 24 * 3600000;
const NOW = new Date(2026, 10, 19, 12, 0, 0, 0).getTime();
const tab = (id, url, over = {}) => ({ id, index: id, url, title: `T${id}`, favIconUrl: "", pinned: false, active: false, audible: false, groupId: null, lastAccessed: NOW - DAY, ...over });
const session = (windows) => ({ schema: 1, windows: windows.map(([id, tabs, groups = []]) => ({ id, type: "normal", tabs, groups })) });

test("not visited for N days: oldest first; never pinned, active, audible or unknown", () => {
  const s = session([[1, [
    tab(1, "https://a.com/", { lastAccessed: NOW - 20 * DAY }),
    tab(2, "https://b.com/", { lastAccessed: NOW - 30 * DAY }),
    tab(3, "https://c.com/", { lastAccessed: NOW - 13 * DAY }),
    tab(4, "https://d.com/", { lastAccessed: NOW - 40 * DAY, pinned: true }),
    tab(5, "https://e.com/", { lastAccessed: NOW - 40 * DAY, active: true }),
    tab(6, "https://f.com/", { lastAccessed: NOW - 40 * DAY, audible: true }),
    tab(7, "https://g.com/", { lastAccessed: null }),
  ]]]);
  const r = T.tidySections(s, { now: NOW, idleDays: 14 });
  assert.deepEqual(r.stale.map((x) => x.tabId), [2, 1]);
  assert.equal(r.stale[0].days, 30);
  assert.deepEqual(T.tidySections(s, { now: NOW, idleDays: 7 }).stale.map((x) => x.tabId), [2, 1, 3]);
});

test("duplicates list every copy but the one Find duplicates keeps; a tab is listed once", () => {
  const s = session([[1, [
    tab(1, "https://a.com/x#one", { lastAccessed: NOW - 2 * DAY }),
    tab(2, "https://a.com/x#two", { lastAccessed: NOW - 20 * DAY }),
    tab(3, "https://a.com/x", { lastAccessed: NOW - 1000 }),
    tab(4, "https://b.com/", { lastAccessed: NOW - 20 * DAY }),
  ]]]);
  const r = T.tidySections(s, { now: NOW, idleDays: 14, ignoreHash: true });
  assert.deepEqual(r.duplicates.map((x) => x.tabId).sort(), [1, 2]);
  assert.deepEqual(r.stale.map((x) => x.tabId), [4]); // 2 is old too, but already a duplicate
  assert.equal(T.tidySections(s, { now: NOW, idleDays: 14, ignoreHash: false }).duplicates.length, 0);
});

test("groups with one tab are listed with their name and colour", () => {
  const s = session([[1, [tab(1, "https://a.com/", { groupId: 5 }), tab(2, "https://b.com/", { groupId: 6 }), tab(3, "https://c.com/", { groupId: 6 })], [{ id: 5, title: "Solo", color: "red" }, { id: 6, title: "Pair", color: "blue" }]]]);
  const r = T.tidySections(s, { now: NOW, idleDays: 14 });
  assert.deepEqual(r.lonely.map((x) => [x.tabId, x.groupId, x.group.title, x.group.color]), [[1, 5, "Solo", "red"]]);
});

test("woken snoozes are listed while their tab is open, before every other section", () => {
  const s = session([[1, [tab(1, "https://a.com/", { lastAccessed: NOW - 30 * DAY }), tab(2, "https://b.com/")]]]);
  const woken = [{ id: "z1", wokeAt: NOW - DAY, tabId: 1 }, { id: "z2", wokeAt: NOW - DAY, tabId: 99 }, { id: "z3", tabId: 2 }];
  const r = T.tidySections(s, { now: NOW, idleDays: 14, woken });
  assert.deepEqual(r.woken.map((x) => [x.tabId, x.entryId]), [[1, "z1"]]);
  assert.equal(r.stale.length, 0);
});

test("kept pages stay out of the tidy for 30 days", () => {
  const s = session([[1, [tab(1, "https://a.com/x", { lastAccessed: NOW - 30 * DAY }), tab(2, "https://b.com/", { lastAccessed: NOW - 30 * DAY })]]]);
  let kept = T.addKept({}, ["https://a.com/x/"], NOW - 10 * DAY);
  assert.deepEqual(T.tidySections(s, { now: NOW, idleDays: 14, kept }).stale.map((x) => x.tabId), [2]);
  kept = T.addKept({}, ["https://a.com/x"], NOW - 31 * DAY);
  assert.deepEqual(T.tidySections(s, { now: NOW, idleDays: 14, kept }).stale.map((x) => x.tabId), [1, 2]); // kept 31 days ago: back
  assert.deepEqual(Object.keys(T.pruneKept(kept, NOW)), []);
  assert.deepEqual(Object.keys(T.pruneKept(T.addKept({}, ["https://a.com/x"], NOW - DAY), NOW)), ["https://a.com/x"]);
});

test("the week's line sums the last 7 days of the tidy log", () => {
  let log = [];
  log = T.appendTidyLog(log, { closed: 5, snoozed: 1, kept: 0 }, NOW - 8 * DAY);
  log = T.appendTidyLog(log, { closed: 7, snoozed: 2, kept: 4 }, NOW - 2 * DAY);
  log = T.appendTidyLog(log, { closed: 5, kept: 0, ungrouped: 1 }, NOW - DAY);
  assert.equal(log.length, 3);
  assert.equal(log[0].at, NOW - DAY);
  assert.equal(T.weekLine(log, NOW), "Tidied this week: 12 closed into the vault, 2 snoozed, 4 kept, 1 ungrouped");
  assert.equal(T.weekLine([], NOW), "Nothing tidied this week yet.");
  for (let i = 0; i < 30; i++) log = T.appendTidyLog(log, { closed: 1 }, NOW);
  assert.equal(log.length, T.TIDY_LOG_CAP);
});

test("the tidy is due a week after the last one; first sight starts the week; off means never", () => {
  const on = { tidy: { weekly: true, idleDays: 14, notify: false } };
  let r = T.tidyDue(undefined, on, NOW);
  assert.deepEqual(r, { due: false, state: { lastAt: NOW }, changed: true });
  r = T.tidyDue({ lastAt: NOW - 6 * DAY }, on, NOW);
  assert.equal(r.due, false);
  assert.equal(r.changed, false);
  r = T.tidyDue({ lastAt: NOW - 7 * DAY }, on, NOW);
  assert.equal(r.due, true);
  assert.equal(r.changed, true);
  assert.equal(r.state.dueAt, NOW);
  r = T.tidyDue({ lastAt: NOW - 9 * DAY, dueAt: NOW - DAY }, on, NOW);
  assert.equal(r.changed, false);
  assert.equal(r.state.dueAt, NOW - DAY);
  r = T.tidyDue({ lastAt: NOW - 9 * DAY, dueAt: NOW - DAY }, { tidy: { weekly: false } }, NOW);
  assert.equal(r.due, false);
  assert.deepEqual(T.tidyReset(NOW), { lastAt: NOW });
});

test("a notification goes out once per due tidy, only when switched on and allowed", () => {
  const due = { lastAt: NOW - 8 * DAY, dueAt: NOW - DAY };
  const s = (notify) => ({ tidy: { weekly: true, notify } });
  assert.equal(T.shouldNotify(due, s(true), true), true);
  assert.equal(T.shouldNotify(due, s(false), true), false);
  assert.equal(T.shouldNotify(due, s(true), false), false);
  assert.equal(T.shouldNotify({ ...due, notifiedAt: NOW }, s(true), true), false);
  assert.equal(T.shouldNotify({ lastAt: NOW }, s(true), true), false);
});

test("the tidy shelf is named by the local date", () => {
  assert.equal(T.tidyShelfName(NOW), "Tidy 2026-11-19");
});

test("incognito tabs are never listed by the tidy, in any section (nothing of them is stored)", () => {
  const s = {
    schema: 1,
    windows: [
      { id: 1, type: "normal", incognito: false, tabs: [tab(1, "https://a.com/", { lastAccessed: NOW - 30 * DAY }), tab(2, "https://dup.com/", { lastAccessed: NOW - DAY })], groups: [] },
      { id: 2, type: "normal", incognito: true, tabs: [
        tab(3, "https://dup.com/", { lastAccessed: NOW - DAY }),
        tab(4, "https://secret.com/", { lastAccessed: NOW - 30 * DAY }),
        tab(5, "https://solo.com/", { groupId: 9 }),
        tab(6, "https://woke.com/"),
      ], groups: [{ id: 9, title: "Hidden", color: "red" }] },
      // A tab that says it is incognito, whatever its window says.
      { id: 3, type: "normal", tabs: [tab(7, "https://b.com/", { lastAccessed: NOW - 30 * DAY, incognito: true })], groups: [] },
    ],
  };
  const r = T.tidySections(s, { now: NOW, idleDays: 14, woken: [{ id: "z1", wokeAt: NOW - DAY, tabId: 6 }] });
  const all = [...r.woken, ...r.duplicates, ...r.stale, ...r.lonely].map((x) => x.tabId);
  assert.deepEqual(all, [1]);
  assert.deepEqual(r.duplicates, []); // the normal copy has no other copy outside incognito
});

test("the close path refuses incognito tabs as a second guard", () => {
  const tabs = [{ id: 1, url: "https://a.com/" }, { id: 2, url: "https://b.com/", incognito: true }, { id: 3, url: "https://c.com/" }];
  const windows = [{ id: 10, incognito: false }, { id: 11, incognito: true }];
  tabs[0].windowId = 10; tabs[1].windowId = 10; tabs[2].windowId = 11;
  assert.deepEqual(T.tidyClosable([1, 2, 3, 4], tabs, windows), { ids: [1], refused: 2, missing: 1 });
});
