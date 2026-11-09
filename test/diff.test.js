const test = require("node:test");
const assert = require("node:assert/strict");
const { tab, win, group } = require("./fake-data.js");
const { buildSession } = require("../lib/session.js");
const { diffSessions } = require("../lib/diff.js");

const S = (windows, groups = [], windowNames = {}) => buildSession({ windows, groups, windowNames });
const urls = (list) => list.map((x) => x.tab.url).sort();

test("identical sessions give three empty lists", () => {
  const s = S([win({ id: 1, tabs: [tab({ id: 1, url: "https://a.com/" }), tab({ id: 2, url: "https://b.com/" })] })]);
  const d = diffSessions(s, s);
  assert.deepEqual([d.missing.length, d.added.length, d.moved.length], [0, 0, 0]);
});

test("one tab closed, one opened, one moved between windows", () => {
  const snap = S([
    win({ id: 1, tabs: [tab({ id: 1, url: "https://keep.com/" }), tab({ id: 2, url: "https://gone.com/" }), tab({ id: 3, url: "https://wander.com/" })] }),
    win({ id: 2, tabs: [tab({ id: 4, url: "https://other.com/" })] }),
  ], [], { 1: "Research", 2: "Personal" });
  const now = S([
    win({ id: 10, tabs: [tab({ id: 11, url: "https://keep.com/" }), tab({ id: 12, url: "https://fresh.com/" })] }),
    win({ id: 20, tabs: [tab({ id: 21, url: "https://other.com/" }), tab({ id: 22, url: "https://wander.com/" })] }),
  ], [], { 10: "Research", 20: "Personal" });
  const d = diffSessions(snap, now);
  assert.deepEqual(urls(d.missing), ["https://gone.com/"]);
  assert.equal(d.missing[0].windowLabel, "Research");
  assert.equal(d.missing[0].targetWindowId, 10);
  assert.deepEqual(urls(d.added), ["https://fresh.com/"]);
  assert.deepEqual(urls(d.moved), ["https://wander.com/"]);
  assert.equal(d.moved[0].from.windowLabel, "Research");
  assert.equal(d.moved[0].windowId, 20);
});

test("a tab that changed group in the same window counts as moved", () => {
  const snap = S([win({ id: 1, tabs: [tab({ id: 1, url: "https://a.com/", groupId: 5 })] })], [group({ id: 5, windowId: 1, title: "Reading" })]);
  const now = S([win({ id: 1, tabs: [tab({ id: 1, url: "https://a.com/" })] })]);
  const d = diffSessions(snap, now);
  assert.equal(d.moved.length, 1);
  assert.equal(d.moved[0].from.groupTitle, "Reading");
});

test("duplicate URLs count by multiplicity: two saved and one open leaves one missing", () => {
  const snap = S([win({ id: 1, tabs: [tab({ id: 1, url: "https://dup.com/" }), tab({ id: 2, url: "https://dup.com/" })] })]);
  const now = S([win({ id: 1, tabs: [tab({ id: 3, url: "https://dup.com/" })] })]);
  const d = diffSessions(snap, now);
  assert.equal(d.missing.length, 1);
  assert.equal(d.added.length, 0);
  const more = S([win({ id: 1, tabs: [tab({ id: 3, url: "https://dup.com/" }), tab({ id: 4, url: "https://dup.com/" }), tab({ id: 5, url: "https://dup.com/" })] })]);
  assert.equal(diffSessions(snap, more).added.length, 1);
});

test("windows match by name first, else by the largest URL overlap", () => {
  const snap = S([
    win({ id: 1, tabs: [tab({ id: 1, url: "https://x.com/1" }), tab({ id: 2, url: "https://x.com/2" })] }),
    win({ id: 2, tabs: [tab({ id: 3, url: "https://y.com/1" }), tab({ id: 4, url: "https://y.com/2" })] }),
  ], [], { 1: "Named" });
  const now = S([
    win({ id: 30, tabs: [tab({ id: 31, url: "https://y.com/1" })] }),
    win({ id: 40, tabs: [tab({ id: 41, url: "https://z.com/" })] }),
  ], [], { 40: "Named" });
  const d = diffSessions(snap, now);
  assert.equal(d.windowMap[1], 40, "matched by name even with no shared URL");
  assert.equal(d.windowMap[2], 30, "matched by overlap");
  const gone = d.missing.find((m) => m.tab.url === "https://y.com/2");
  assert.equal(gone.targetWindowId, 30);
});

test("Ignore #hash on and off", () => {
  const snap = S([win({ id: 1, tabs: [tab({ id: 1, url: "https://a.com/page#one" })] })]);
  const now = S([win({ id: 1, tabs: [tab({ id: 2, url: "https://a.com/page#two" })] })]);
  assert.equal(diffSessions(snap, now, { ignoreHash: true }).missing.length, 0);
  const strict = diffSessions(snap, now, { ignoreHash: false });
  assert.equal(strict.missing.length, 1);
  assert.equal(strict.added.length, 1);
});

test("chrome:// pages and TabVault's own pages are ignored on both sides", () => {
  const own = "chrome-extension://abc/";
  const snap = S([win({ id: 1, tabs: [tab({ id: 1, url: "chrome://settings/" }), tab({ id: 2, url: own + "app/index.html" }), tab({ id: 3, url: "https://a.com/" })] })]);
  const now = S([win({ id: 1, tabs: [tab({ id: 4, url: "chrome://extensions/" }), tab({ id: 5, url: own + "app/index.html?panel=1" }), tab({ id: 6, url: "https://a.com/" })] })]);
  const d = diffSessions(snap, now, { ownPrefix: own });
  assert.deepEqual([d.missing.length, d.added.length, d.moved.length], [0, 0, 0]);
});
