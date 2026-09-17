const test = require("node:test");
const assert = require("node:assert/strict");
const { tab, win } = require("./fake-data.js");
const { buildSession } = require("../lib/session.js");
const { makeSnapshot, isSameSession, rotate } = require("../lib/snapshots.js");

const s1 = () => buildSession({ windows: [win({ id: 1, tabs: [tab({ id: 1, url: "https://a.com/", active: true, lastAccessed: 1 })] })], groups: [], now: 1 });

test("makeSnapshot records counts and an id", () => {
  const snap = makeSnapshot(s1(), "change", 500);
  assert.equal(typeof snap.id, "string");
  assert.equal(snap.takenAt, 500);
  assert.equal(snap.reason, "change");
  assert.equal(snap.pinned, false);
  assert.equal(snap.windows, 1);
  assert.equal(snap.tabs, 1);
  assert.equal(snap.session.schema, 1);
});

test("isSameSession ignores volatile fields but not urls", () => {
  const a = s1();
  const b = buildSession({ windows: [win({ id: 1, tabs: [tab({ id: 1, url: "https://a.com/", active: false, lastAccessed: 99 })] })], groups: [], now: 2 });
  const c = buildSession({ windows: [win({ id: 1, tabs: [tab({ id: 1, url: "https://b.com/" })] })], groups: [], now: 3 });
  assert.equal(isSameSession(a, b), true);
  assert.equal(isSameSession(a, c), false);
});

test("rotate keeps pinned snapshots and the newest N unpinned, newest first", () => {
  const snaps = [1, 2, 3, 4, 5].map((t) => ({ ...makeSnapshot(s1(), "change", t), id: `s${t}`, pinned: t === 2 }));
  const kept = rotate(snaps, 2);
  assert.deepEqual(kept.map((s) => s.id), ["s5", "s4", "s2"]);
});
