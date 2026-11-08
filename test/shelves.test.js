const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeArea } = require("./fake-storage.js");
const S = require("../lib/shelves.js");

const item = (n, props = {}) => S.shelfItem({ url: `https://s.example.com/${n}`, title: `T${n}`, favIconUrl: "" }, { savedAt: 1000 + n * 61000, ...props });

test("a shelf is created empty; items append in order and read back", async () => {
  const area = fakeArea();
  const shelf = await S.createShelf(area, "  Reading later  ", 5);
  assert.equal(shelf.name, "Reading later");
  assert.equal(shelf.chunks, 0);
  assert.deepEqual((await S.listShelves(area)).map((s) => s.id), [shelf.id]);
  const r = await S.appendItems(area, shelf.id, [item(1), item(2)], { now: 9 });
  assert.equal(r.added, 2);
  assert.deepEqual((await S.readShelf(area, shelf.id)).map((x) => x.title), ["T1", "T2"]);
  await assert.rejects(() => S.createShelf(area, "   "), /name/i);
});

test("chunks of 200: the 201st item opens chunk 1 and the count is derived from the chunks", async () => {
  const area = fakeArea();
  const shelf = await S.createShelf(area, "Big");
  await S.appendItems(area, shelf.id, Array.from({ length: 200 }, (_, i) => item(i)));
  let [meta] = await S.listShelves(area);
  assert.equal(meta.chunks, 1);
  assert.equal(area.data[S.chunkKey(shelf.id, 0)].length, 200);
  await S.appendItems(area, shelf.id, [item(500)]);
  [meta] = await S.listShelves(area);
  assert.equal(meta.chunks, 2);
  assert.equal(area.data[S.chunkKey(shelf.id, 1)].length, 1);
  assert.equal(S.itemCount(await S.readChunks(area, meta)), 201);
  assert.equal("count" in meta, false, "the count is never stored");
});

test("removing an item rewrites only its chunk; a short middle chunk is compacted on the next append", async () => {
  const area = fakeArea();
  const shelf = await S.createShelf(area, "Big");
  const first = Array.from({ length: 201 }, (_, i) => item(i));
  await S.appendItems(area, shelf.id, first);
  const before1 = JSON.stringify(area.data[S.chunkKey(shelf.id, 1)]);
  await S.removeItems(area, shelf.id, [first[3].id]);
  assert.equal(area.data[S.chunkKey(shelf.id, 0)].length, 199);
  assert.equal(JSON.stringify(area.data[S.chunkKey(shelf.id, 1)]), before1, "the other chunk was not rewritten");
  await S.appendItems(area, shelf.id, [item(900)]);
  assert.equal(area.data[S.chunkKey(shelf.id, 0)].length, 200);
  assert.equal(area.data[S.chunkKey(shelf.id, 1)].length, 1);
  const all = await S.readShelf(area, shelf.id);
  assert.equal(all.length, 201);
  assert.equal(all[all.length - 1].title, "T900");
});

test("the same URL on the same shelf within a minute is added once", async () => {
  const area = fakeArea();
  const shelf = await S.createShelf(area, "Dupes");
  const a = S.shelfItem({ url: "https://d.example.com/" }, { savedAt: 10000 });
  const b = S.shelfItem({ url: "https://d.example.com/" }, { savedAt: 40000 });
  const c = S.shelfItem({ url: "https://d.example.com/" }, { savedAt: 80000 });
  assert.equal((await S.appendItems(area, shelf.id, [a, b])).added, 1);
  assert.equal((await S.appendItems(area, shelf.id, [c])).added, 1, "a minute later it is a new save");
});

test("deleting a shelf removes its chunks and its index entry", async () => {
  const area = fakeArea();
  const shelf = await S.createShelf(area, "Gone");
  await S.appendItems(area, shelf.id, Array.from({ length: 250 }, (_, i) => item(i)));
  await S.deleteShelf(area, shelf.id);
  assert.deepEqual(await S.listShelves(area), []);
  assert.deepEqual(Object.keys(area.data).filter((k) => k.startsWith("shelf:")), []);
});

test("a shelf item keeps its group; a restore joins a matching group or recreates it", () => {
  const it = S.shelfItem({ url: "https://g.example.com/", title: "G" }, { savedAt: 1, ruleId: "r1", group: { id: 9, title: "Reading", color: "yellow" } });
  assert.deepEqual(it.group, { id: 9, title: "Reading", color: "yellow" });
  assert.equal(it.ruleId, "r1");
  const plain = S.shelfItem({ url: "https://p.example.com/" }, { savedAt: 1 });
  assert.equal("group" in plain, false);
  const other = S.shelfItem({ url: "https://h.example.com/" }, { savedAt: 1, group: { id: 4, title: "Work", color: "blue" } });
  const targets = S.groupTargets([it, plain, other], [{ id: 77, title: "Reading", color: "yellow" }, { id: 78, title: "Work", color: "red" }]);
  assert.deepEqual(targets.map((t) => [t.groupId, t.newKey]), [[77, null], [null, null], [null, "Work|blue"]]);
  const session = S.shelfToSession({ id: "s", name: "Later" }, [it, plain, other]);
  const w = session.windows[0];
  assert.equal(w.windowName, "Later");
  assert.deepEqual(w.groups.map((g) => [g.title, g.color]), [["Reading", "yellow"], ["Work", "blue"]]);
  assert.equal(w.tabs[0].groupId, w.groups[0].id);
  assert.equal(w.tabs[1].groupId, null);
});

test("executeShelve: a failed shelf write closes nothing; a written one is read back, then closed", async () => {
  const tabsById = new Map([[1, { id: 1, url: "https://a.example.com/", title: "A", groupId: -1 }], [2, { id: 2, url: "https://b.example.com/", title: "B", groupId: 5 }]]);
  const groupsById = new Map([[5, { id: 5, title: "Grp", color: "red" }]]);
  const bad = fakeArea();
  const shelfBad = await S.createShelf(bad, "X");
  bad.set = async () => { throw new Error("QUOTA_BYTES quota exceeded"); };
  const removed = [];
  const r1 = await S.executeShelve(bad, [{ id: 1, shelfId: shelfBad.id, ruleId: "r" }], { tabsById, groupsById, now: 1, removeTabs: async (ids) => removed.push(...ids) });
  assert.deepEqual(removed, []);
  assert.equal(r1.failed, 1);
  assert.equal(r1.shelved, 0);

  const good = fakeArea();
  const shelf = await S.createShelf(good, "Y");
  const order = [];
  const realGet = good.get;
  good.get = async (k) => { order.push("get"); return realGet(k); };
  const r2 = await S.executeShelve(good, [{ id: 1, shelfId: shelf.id, ruleId: "r" }, { id: 2, shelfId: shelf.id, ruleId: "r" }], { tabsById, groupsById, now: 1, removeTabs: async (ids) => { order.push("remove"); removed.push(...ids); } });
  assert.deepEqual(removed, [1, 2]);
  assert.equal(r2.shelved, 2);
  assert.ok(order.lastIndexOf("get") < order.indexOf("remove"), "read back before the close");
  const items = await S.readShelf(good, shelf.id);
  assert.deepEqual(items.map((x) => x.url), ["https://a.example.com/", "https://b.example.com/"]);
  assert.deepEqual(items[1].group, { id: 5, title: "Grp", color: "red" });

  const missing = await S.executeShelve(good, [{ id: 1, shelfId: "nope", ruleId: "r" }], { tabsById, groupsById, now: 1, removeTabs: async () => { throw new Error("must not close"); } });
  assert.equal(missing.failed, 1);
});

test("a write that reads back without the items counts as failed and closes nothing", async () => {
  const area = fakeArea();
  const shelf = await S.createShelf(area, "Lossy");
  const realSet = area.set;
  area.set = async (items) => { const copy = { ...items }; for (const k of Object.keys(copy)) if (k.startsWith("shelf:")) copy[k] = []; return realSet(copy); };
  const tabsById = new Map([[1, { id: 1, url: "https://a.example.com/", title: "A" }]]);
  const r = await S.executeShelve(area, [{ id: 1, shelfId: shelf.id, ruleId: null }], { tabsById, groupsById: new Map(), now: 1, removeTabs: async () => { throw new Error("must not close"); } });
  assert.equal(r.failed, 1);
});

test("fix 3: closeEach closes tab by tab, so one vanished tab does not leave the others open", async () => {
  const open = new Set([1, 2, 3]);
  const closed = [];
  const remove = async (id) => { if (!open.has(id)) throw new Error(`No tab with id: ${id}.`); open.delete(id); closed.push(id); };
  open.delete(2); // the user closed it between the plan and the close
  const r = await S.closeEach([1, 2, 3], remove);
  assert.deepEqual(closed, [1, 3]);
  assert.deepEqual(r, { closed: [1, 3], missing: [2] });
  assert.equal(open.size, 0);
});
