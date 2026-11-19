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
  const { entries, skipped } = S.snoozeEntries(tabs, groups, { wakeAt: now + HOUR, now, ownPrefix: own });
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
  const plan = S.wakePlan(list, new Set([10, 11]));
  assert.deepEqual(plan.map((b) => [b.windowId, b.entries.map((e) => e.id)]), [[10, ["c", "a"]], [11, ["e"]], [null, ["b", "d"]]]);
  assert.deepEqual(S.wakePlan([], new Set([10])), []);
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
