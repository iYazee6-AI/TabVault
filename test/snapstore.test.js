const test = require("node:test");
const assert = require("node:assert/strict");
const { tab, win } = require("./fake-data.js");
const { fakeArea } = require("./fake-storage.js");
const { buildSession } = require("../lib/session.js");
const { makeSnapshot } = require("../lib/snapshots.js");
const store = require("../lib/snapstore.js");

const session = (url = "https://a.com/") => buildSession({ windows: [win({ id: 1, tabs: [tab({ id: 1, url })] })], groups: [], now: 1 });
const snap = (id, at, pinned = false) => ({ ...makeSnapshot(session(`https://a.com/${id}`), "change", at), id, pinned });

test("a 1.x store (one snapshots key) migrates to an index plus one key per snapshot", async () => {
  const legacy = [snap("a", 10), snap("b", 30, true), snap("c", 20)];
  const area = fakeArea({ storageVersion: 1, snapshots: legacy, settings: { keepSnapshots: 5 } });
  assert.equal(await store.migrate(area), "migrated");
  assert.equal(area.data.storageVersion, 2);
  assert.equal(area.data.snapshots, undefined);
  assert.deepEqual(area.data.snapIndex.map((s) => s.id), ["b", "c", "a"]);
  assert.equal(area.data.snapIndex[0].pinned, true);
  assert.equal(area.data.snapIndex[0].session, undefined, "the index holds metadata only");
  assert.deepEqual(area.data["snap:a"].session, legacy[0].session);
  assert.deepEqual(area.data.settings, { keepSnapshots: 5 }, "other keys untouched");
});

test("a version 2 store is left alone; a fresh store is stamped 2", async () => {
  const area = fakeArea({ storageVersion: 2, snapIndex: [{ id: "x" }], snapshots: ["stray"] });
  const before = JSON.stringify(area.data);
  assert.equal(await store.migrate(area), "current");
  assert.equal(JSON.stringify(area.data), before);
  const fresh = fakeArea({});
  assert.equal(await store.migrate(fresh), "fresh");
  assert.equal(fresh.data.storageVersion, 2);
  assert.deepEqual(fresh.data.snapIndex, []);
});

test("addSnapshot rotates and removes the keys of rotated-out snapshots; delete and pin", async () => {
  const area = fakeArea({ storageVersion: 2, snapIndex: [] });
  for (const [id, at] of [["a", 1], ["b", 2], ["c", 3]]) await store.addSnapshot(area, snap(id, at), 2);
  assert.deepEqual((await store.listSnapshots(area)).map((s) => s.id), ["c", "b"]);
  assert.equal(area.data["snap:a"], undefined);
  assert.equal((await store.latestSnapshot(area)).id, "c");
  await store.pinSnapshot(area, "b", true);
  assert.equal((await store.listSnapshots(area)).find((s) => s.id === "b").pinned, true);
  assert.equal((await store.getSnapshot(area, "b")).pinned, true);
  await store.deleteSnapshot(area, "c");
  assert.deepEqual((await store.listSnapshots(area)).map((s) => s.id), ["b"]);
  assert.equal(area.data["snap:c"], undefined);
});

test("a quota error drops the oldest unpinned snapshot and retries once", async () => {
  const area = fakeArea({ storageVersion: 2, snapIndex: [] });
  await store.addSnapshot(area, snap("old", 1), 10);
  await store.addSnapshot(area, snap("kept", 2, true), 10);
  area.set = ((orig) => { let failed = false; return async (items) => { if (!failed) { failed = true; throw new Error("quota"); } return orig(items); }; })(area.set);
  await store.addSnapshot(area, snap("new", 3), 10);
  assert.deepEqual((await store.listSnapshots(area)).map((s) => s.id), ["new", "kept"]);
  assert.equal(area.data["snap:old"], undefined);
});
