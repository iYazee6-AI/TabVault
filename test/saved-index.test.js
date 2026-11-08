const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSavedIndex, searchSaved, openAllNeedsConfirm, OPEN_ALL_ASK } = require("../lib/saved-index.js");
const { parsePaletteQuery, highlightRanges } = require("../lib/palette.js");

const sess = (tabs, windowName) => ({ schema: 1, windows: [{ id: 1, windowName, groups: [], tabs: tabs.map((t, i) => ({ id: i + 1, index: i, groupId: null, title: "", ...t })) }] });
const fmt = { date: (ts) => `D${ts}`, time: (ts) => `T${ts}` };

function sample() {
  return buildSavedIndex({
    snapshots: [
      { id: "s2", takenAt: 200, name: "", session: sess([{ url: "https://docs.example.com/quota#a", title: "chrome.storage quotas explained" }, { url: "https://docs.example.com/quota#b", title: "same page again" }], "Research") },
      { id: "s1", takenAt: 100, name: "", session: sess([{ url: "https://docs.example.com/quota", title: "old title" }, { url: "chrome://settings", title: "settings quota" }]) },
    ],
    shelves: [{ id: "sh", name: "Reading later", items: [{ url: "https://news.example.com/errors", title: "Storage quota errors in MV3", savedAt: 150 }] }],
    recent: [{ id: "r", url: "https://blog.example.com/raise", title: "Raising the quota", closedAt: 300 }],
  }, { ignoreHash: true, fmt });
}

test("one entry per URL across snapshots, shelves and recently closed; the newest kept, the count right", () => {
  const index = sample();
  assert.equal(index.length, 3, JSON.stringify(index.map((e) => e.url)));
  const quota = index.find((e) => e.url.startsWith("https://docs.example.com/quota"));
  assert.equal(quota.title, "chrome.storage quotas explained");
  assert.equal(quota.count, 2, "two snapshots hold it (twice in the newer one counts once)");
  assert.equal(quota.where.kind, "snapshot");
  assert.equal(quota.where.label, "snapshot D200 · Research");
  assert.equal(index.find((e) => e.where.kind === "shelf").where.label, "shelf Reading later");
  assert.equal(index.find((e) => e.where.kind === "recent").where.label, "recently closed T300");
  assert.equal(index[0].where.kind, "recent", "newest first");
  assert.ok(!index.some((e) => e.url.startsWith("chrome:")), "chrome:// pages are not indexed");
});

test("searchSaved matches every word in the title or URL, ranks by title, caps at 30", () => {
  const index = sample();
  const rows = searchSaved(index, "quota");
  assert.equal(rows.length, 3);
  assert.equal(searchSaved(index, "quota errors").length, 1);
  assert.equal(searchSaved(index, "").length, 0);
  const many = buildSavedIndex({ recent: Array.from({ length: 50 }, (_, i) => ({ id: String(i), url: `https://x.example.com/${i}`, title: `match ${i}`, closedAt: i })) }, { fmt });
  assert.equal(searchSaved(many, "match").length, 30);
  assert.equal(searchSaved(many, "match", { limit: 5 }).length, 5);
});

test("Open all asks first above 20", () => {
  assert.equal(OPEN_ALL_ASK, 20);
  assert.equal(openAllNeedsConfirm(20), false);
  assert.equal(openAllNeedsConfirm(21), true);
});

test("the prefixes s:, t: and a: narrow the palette's scope", () => {
  assert.deepEqual(parsePaletteQuery("s: quota"), { scope: "saved", text: "quota" });
  assert.deepEqual(parsePaletteQuery("T:inbox"), { scope: "tabs", text: "inbox" });
  assert.deepEqual(parsePaletteQuery("a: snap"), { scope: "actions", text: "snap" });
  assert.deepEqual(parsePaletteQuery("quota"), { scope: "all", text: "quota" });
  assert.deepEqual(parsePaletteQuery("x: y"), { scope: "all", text: "x: y" });
  assert.deepEqual(parsePaletteQuery(">quota"), { scope: "all", text: ">quota" });
});

test("highlight ranges: several words, overlaps merged, case-insensitive, offsets only", () => {
  assert.deepEqual(highlightRanges("Storage Quota errors", ["quota", "err"]), [[8, 13], [14, 17]]);
  assert.deepEqual(highlightRanges("abcabc", ["ab", "bc"]), [[0, 6]]);
  assert.deepEqual(highlightRanges("QUOTA quota", ["quota"]), [[0, 5], [6, 11]]);
  assert.deepEqual(highlightRanges("anything", []), []);
  const title = "<script>alert(1)</script> quota";
  const r = highlightRanges(title, ["script"]);
  assert.deepEqual(r, [[1, 7], [18, 24]]);
  assert.equal(title.slice(r[0][0], r[0][1]), "script", "the ranges cut the raw text; the page builds text nodes from them");
});
