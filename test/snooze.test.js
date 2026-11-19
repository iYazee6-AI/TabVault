const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../lib/snooze.js");
const { fakeArea } = require("./fake-storage.js");

const own = "chrome-extension://abc/";
const HOUR = 3600000;
const DAY = 24 * HOUR;
// Local times, so the tests hold in any time zone.
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();

test("later today is three hours on", () => {
  const now = at(2026, 11, 19, 14, 10);
  assert.equal(S.wakeTimeFor("later", now), now + 3 * HOUR);
});

test("tomorrow morning is 9:00 the next day, across a month end and a year end", () => {
  assert.equal(S.wakeTimeFor("tomorrow", at(2026, 11, 19, 23, 50)), at(2026, 11, 20, 9));
  assert.equal(S.wakeTimeFor("tomorrow", at(2026, 11, 30, 8, 0)), at(2026, 12, 1, 9));
  assert.equal(S.wakeTimeFor("tomorrow", at(2026, 12, 31, 1, 0)), at(2027, 1, 1, 9));
  assert.equal(S.wakeTimeFor("tomorrow", at(2026, 11, 19, 1, 0), { morningHour: 7 }), at(2026, 11, 20, 7));
});

test("next week is the next Monday at 9:00, a full week on when today is Monday", () => {
  assert.equal(new Date(at(2026, 11, 23)).getDay(), 1); // 2026-11-23 is a Monday
  assert.equal(S.wakeTimeFor("nextWeek", at(2026, 11, 19, 10)), at(2026, 11, 23, 9)); // Thursday
  assert.equal(S.wakeTimeFor("nextWeek", at(2026, 11, 22, 22)), at(2026, 11, 23, 9)); // Sunday night
  assert.equal(S.wakeTimeFor("nextWeek", at(2026, 11, 23, 8)), at(2026, 11, 30, 9)); // Monday
  assert.equal(S.wakeTimeFor("nextWeek", at(2026, 12, 29, 8)), at(2027, 1, 4, 9)); // across the year
});

test("an unknown choice gives no time", () => {
  assert.equal(S.wakeTimeFor("someday", Date.now()), null);
});

test("a wake time must be a minute to a year ahead", () => {
  const now = at(2026, 11, 19, 12);
  assert.match(S.wakeError(NaN, now), /Pick a date/);
  assert.match(S.wakeError(now + 30000, now), /at least a minute/);
  assert.match(S.wakeError(now - HOUR, now), /at least a minute/);
  assert.match(S.wakeError(now + 400 * DAY, now), /within a year/);
  assert.equal(S.wakeError(now + 2 * 60000, now), null);
  assert.equal(S.wakeError(now + 300 * DAY, now), null);
});

const groups = new Map([[7, { id: 7, title: "Work", color: "blue" }]]);
const tabs = [
  { id: 1, windowId: 10, index: 0, url: "https://a.com/x", title: "A", pinned: true, groupId: -1, favIconUrl: "https://a.com/f.ico" },
  { id: 2, windowId: 10, index: 1, url: "https://b.com/", title: "B", pinned: false, groupId: 7 },
  { id: 3, windowId: 10, index: 2, url: "chrome://settings/", title: "Settings", groupId: -1 },
  { id: 4, windowId: 11, index: 0, url: own + "app/index.html", title: "TabVault", groupId: -1 },
  { id: 5, windowId: 12, index: 0, url: "https://c.com/", title: "Secret", incognito: true, groupId: -1 },
  { id: 6, windowId: 10, index: 3, url: "", pendingUrl: "file:///C:/notes.txt", title: "", groupId: -1 },
];

test("snoozeEntries keeps the url, title, pinned state, group and window; skips the rest", () => {
  const now = at(2026, 11, 19, 12);
  const { entries, skipped } = S.snoozeEntries(tabs, groups, { wakeAt: now + HOUR, now, ownPrefix: own, run: 42 });
  assert.equal(entries.length, 3);
  assert.equal(skipped, 3);
  assert.deepEqual(S.snoozeEntries(tabs, groups, { wakeAt: now + HOUR, now, ownPrefix: own }).tabIds, [1, 2, 6]);
  const [a, b, f] = entries;
  assert.equal(a.url, "https://a.com/x");
  assert.equal(a.pinned, true);
  assert.equal(a.group, null);
  assert.equal(a.windowId, 10);
  assert.equal(a.wakeAt, now + HOUR);
  assert.equal(a.snoozedAt, now);
  assert.equal(a.run, 42);
  assert.deepEqual(b.group, { title: "Work", color: "blue" });
  assert.equal(f.url, "file:///C:/notes.txt");
  assert.ok(entries.every((e) => typeof e.id === "string" && e.id && !e.wokeAt && e.attempts === 0));
  assert.equal(new Set(entries.map((e) => e.id)).size, 3);
});

function entry(id, over = {}) {
  return { id, url: `https://${id}.com/`, title: id, favIconUrl: "", pinned: false, group: null, windowId: 10, index: 0, snoozedAt: 0, wakeAt: 1000, attempts: 0, error: "", ...over };
}

test("due and next wake look only at sleeping entries with tries left", () => {
  const list = [entry("a", { wakeAt: 500 }), entry("b", { wakeAt: 1500 }), entry("c", { wakeAt: 200, wokeAt: 300, tabId: 9 }), entry("d", { wakeAt: 100, attempts: 3 })];
  assert.deepEqual(S.dueEntries(list, 1000).map((e) => e.id), ["a"]);
  assert.equal(S.nextWakeAt(list), 500);
  assert.equal(S.nextWakeAt([entry("x", { wokeAt: 5 })]), null);
  assert.deepEqual(S.sleeping(list).map((e) => e.id), ["a", "b", "d"]);
  assert.deepEqual(S.woken(list).map((e) => e.id), ["c"]);
});

test("the wake plan puts entries back in their live windows, the rest in one new window, pinned first", () => {
  const list = [
    entry("a", { windowId: 10 }),
    entry("b", { windowId: 99, group: { title: "G", color: "red" } }),
    entry("c", { windowId: 10, pinned: true }),
    entry("d", { windowId: 98 }),
    entry("e", { windowId: 11 }),
  ];
  const plan = S.wakePlan(list.map((e) => ({ ...e, run: 7 })), new Set([10, 11]), 7);
  assert.deepEqual(plan.map((b) => [b.windowId, b.entries.map((e) => e.id)]), [[10, ["c", "a"]], [11, ["e"]], [null, ["b", "d"]]]);
  assert.deepEqual(S.wakePlan([], new Set([10])), []);
  // Another browser run: the same window id is a stranger now, so a new window.
  assert.deepEqual(S.wakePlan([entry("a", { windowId: 10, run: 6 })], new Set([10]), 7).map((b) => b.windowId), [null]);
  assert.deepEqual(S.wakePlan([entry("a", { windowId: 10 })], new Set([10]), null).map((b) => b.windowId), [null]);
});

test("woken entries keep the new tab id; failures count tries and keep the entry", () => {
  let list = [entry("a"), entry("b")];
  list = S.markWoken(list, [{ id: "a", tabId: 55 }], 2000);
  assert.equal(list[0].wokeAt, 2000);
  assert.equal(list[0].tabId, 55);
  list = S.markFailed(list, ["b"], "No window", 2000);
  list = S.markFailed(list, ["b"], "No window", 2100);
  assert.equal(list[1].attempts, 2);
  assert.equal(list[1].error, "No window");
  assert.equal(list.length, 2);
  list = S.markFailed(list, ["b"], "No window", 2200);
  assert.deepEqual(S.dueEntries(list, 9999).map((e) => e.id), []); // three tries: waits for Wake now
  list = S.reschedule(list, ["b"], 5000);
  assert.equal(list[1].attempts, 0);
  assert.equal(list[1].wakeAt, 5000);
  assert.equal(list[1].error, "");
});

test("seen drops the woken entry of that tab only; pruning drops woken entries after 7 days", () => {
  const now = at(2026, 11, 19, 12);
  const list = [entry("a", { wokeAt: now - HOUR, tabId: 1 }), entry("b", { wokeAt: now - 8 * DAY, tabId: 2 }), entry("c")];
  const seen = S.markSeen(list, 1);
  assert.equal(seen.changed, true);
  assert.deepEqual(seen.list.map((e) => e.id), ["b", "c"]);
  assert.equal(S.markSeen(list, 77).changed, false);
  assert.deepEqual(S.pruneWoken(list, now).map((e) => e.id), ["a", "c"]);
  assert.deepEqual(S.removeEntries(list, ["a", "c"]).map((e) => e.id), ["b"]);
});

test("the saved-index label names the wake time", () => {
  assert.equal(S.snoozeLabel(entry("a"), (ts) => `T${ts}`), "snoozed until T1000");
  assert.equal(S.snoozeLabel(entry("a", { wokeAt: 5 }), (ts) => `T${ts}`), "woke from snooze T5");
});

test("a write is read back before anything may close; a failed write throws and keeps the old list", async () => {
  const area = fakeArea({ [S.SNOOZE_KEY]: [entry("old")] });
  const out = await S.appendSnoozes(area, [entry("n1"), entry("n2")]);
  assert.deepEqual(out.map((e) => e.id), ["old", "n1", "n2"]);
  assert.deepEqual((await S.readSnoozes(area)).map((e) => e.id), ["old", "n1", "n2"]);

  const failing = fakeArea({ [S.SNOOZE_KEY]: [entry("old")] }, { failSetOnce: true });
  await assert.rejects(() => S.appendSnoozes(failing, [entry("n1")]), /quota/);
  assert.deepEqual((await S.readSnoozes(failing)).map((e) => e.id), ["old"]);

  // A store that answers set but keeps nothing: the read-back catches it.
  const liar = { get: async () => ({}), set: async () => {} };
  await assert.rejects(() => S.appendSnoozes(liar, [entry("n1")]), /could not be read back/);
});

test("a stored list that is not an array reads as empty", async () => {
  assert.deepEqual(await S.readSnoozes(fakeArea({ [S.SNOOZE_KEY]: "junk" })), []);
});

// ---- review fixes of 1.7.0 --------------------------------------------------------------

test("a wake marks its entries waking first; the mark is cleared when the tab is woken or failed", () => {
  let list = S.markWaking([entry("a"), entry("b"), entry("c")], ["a", "b"], 777);
  assert.equal(list[0].waking, 777);
  assert.equal(list[1].waking, 777);
  assert.equal(list[2].waking, undefined);
  list = S.markWoken(list, [{ id: "a", tabId: 5 }], 800);
  list = S.markFailed(list, ["b"], "No window", 800);
  assert.equal("waking" in list[0], false);
  assert.equal("waking" in list[1], false);
  assert.equal(list[0].wokeAt, 800);
  assert.equal(list[1].attempts, 1);
});

test("an entry still waking at the next pass is woken when its tab is open, else counted as a failed try", () => {
  const list = [
    entry("a", { waking: 50 }),
    entry("b", { waking: 50 }),
    entry("c", { waking: 50, attempts: 2 }),
    entry("d"),
    entry("e", { waking: 50, url: "https://a.com/" }), // the same address as a: one tab is claimed once
  ];
  const open = [{ id: 31, url: "https://a.com/" }, { id: 32, url: "", pendingUrl: "https://d.com/" }, { id: 33, url: "https://x.com/", incognito: true }];
  const r = S.resolveWaking(list, open, 900);
  assert.deepEqual(r.woke, [{ id: "a", tabId: 31 }]);
  assert.deepEqual(r.failed.sort(), ["b", "c", "e"]);
  const by = Object.fromEntries(r.list.map((e) => [e.id, e]));
  assert.equal(by.a.wokeAt, 900);
  assert.equal(by.a.tabId, 31);
  assert.equal("waking" in by.a, false);
  assert.equal(by.b.attempts, 1);
  assert.equal("waking" in by.b, false);
  assert.match(by.b.error, /interrupted/);
  assert.equal(by.c.attempts, 3); // the retry cap holds: it now waits for Wake now
  assert.deepEqual(S.dueEntries(r.list, 99999).map((e) => e.id).sort(), ["b", "d", "e"]);
  assert.equal(r.changed, true);
  assert.equal(S.resolveWaking([entry("z")], open, 900).changed, false);
});

test("a wake opens nothing when the waking mark cannot be written", async () => {
  const area = fakeArea({ [S.SNOOZE_KEY]: [entry("a"), entry("b")] }, { failSetOnce: true });
  let opened = 0;
  const list = await S.readSnoozes(area);
  await assert.rejects(() => S.wakeEntries(area, list, list, async (es) => { opened += es.length; return { woke: [], failed: [], error: "" }; }, 1000), /quota/);
  assert.equal(opened, 0);
  const after = await S.readSnoozes(area);
  assert.ok(after.every((e) => !e.waking && !e.wokeAt), JSON.stringify(after));

  // A store that keeps the list but drops the mark: nothing opens either.
  let kept = { [S.SNOOZE_KEY]: [entry("a")] };
  const dropper = {
    get: async () => JSON.parse(JSON.stringify(kept)),
    set: async (items) => { kept = { [S.SNOOZE_KEY]: items[S.SNOOZE_KEY].map((e) => { const c = { ...e }; delete c.waking; return c; }) }; },
  };
  const l2 = await S.readSnoozes(dropper);
  const r2 = await S.wakeEntries(dropper, l2, l2, async (es) => { opened += es.length; return { woke: es.map((e) => ({ id: e.id, tabId: 1 })), failed: [], error: "" }; }, 1000);
  assert.equal(opened, 0);
  assert.equal(r2.woke.length, 0);
  assert.equal(r2.unmarked, 1);
});

test("a wake writes the mark, opens, then marks woken; a failed last write leaves the mark for the next pass", async () => {
  const area = fakeArea({ [S.SNOOZE_KEY]: [entry("a"), entry("b"), entry("c")] });
  const list = await S.readSnoozes(area);
  let seenMarked = null;
  const r = await S.wakeEntries(area, list, [list[0], list[1]], async (es) => {
    seenMarked = (await S.readSnoozes(area)).filter((e) => e.waking).map((e) => e.id);
    return { woke: [{ id: es[0].id, tabId: 41 }], failed: [es[1].id], error: "No window" };
  }, 1000);
  assert.deepEqual(seenMarked, ["a", "b"]); // the mark was stored before any tab opened
  const by = Object.fromEntries((await S.readSnoozes(area)).map((e) => [e.id, e]));
  assert.equal(by.a.tabId, 41);
  assert.equal(by.b.attempts, 1);
  assert.ok(!by.a.waking && !by.b.waking && !by.c.waking);
  assert.equal(r.woke.length, 1);
  assert.equal(r.failed.length, 1);

  // The tab opened but the worker could not record it: the entry stays waking, and the next
  // pass finds its tab open instead of opening it again.
  let sets = 0;
  const base = fakeArea({ [S.SNOOZE_KEY]: [entry("d")] });
  const flaky = { get: base.get, set: async (items) => { sets++; if (sets === 2) throw new Error("worker gone"); return base.set(items); } };
  const l3 = await S.readSnoozes(flaky);
  await assert.rejects(() => S.wakeEntries(flaky, l3, l3, async (es) => ({ woke: [{ id: es[0].id, tabId: 51 }], failed: [], error: "" }), 1000), /worker gone/);
  const stuck = await S.readSnoozes(flaky);
  assert.equal(stuck[0].waking, 1000);
  assert.deepEqual(S.dueEntries(S.resolveWaking(stuck, [{ id: 51, url: "https://d.com/" }], 2000).list, 99999), []);
});

test("a snooze skips tab ids already being snoozed and repeats in one call", () => {
  assert.deepEqual(S.freshSnoozeIds([1, 2, 2, 3, "x", 4.5], new Set([3])), [1, 2]);
  assert.deepEqual(S.freshSnoozeIds([5], new Set([5])), []);
  assert.deepEqual(S.freshSnoozeIds(null, new Set()), []);
});

test("Cancel can promise a Recently closed copy only when one is really there", () => {
  const e = entry("a", { url: "https://a.com/p", snoozedAt: 5000 });
  assert.equal(S.inRecentlyClosed(e, [{ id: "r1", url: "https://a.com/p", closedAt: 5100, snooze: { wakeAt: 1000 } }]), true);
  assert.equal(S.inRecentlyClosed(e, [{ id: "r1", url: "https://a.com/p", closedAt: 4000 }]), false); // an older close of the page
  assert.equal(S.inRecentlyClosed(e, [{ id: "r1", url: "https://a.com/other", closedAt: 5100 }]), false);
  assert.equal(S.inRecentlyClosed(e, []), false); // recording off, or pushed out past the cap
  assert.equal(S.inRecentlyClosed(e, null), false);
});
