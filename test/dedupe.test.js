const test = require("node:test");
const assert = require("node:assert/strict");
const { tab, win } = require("./fake-data.js");
const { buildSession } = require("../lib/session.js");
const { normalizeUrl, findDuplicates } = require("../lib/dedupe.js");

test("normalizeUrl lowercases host, drops hash when asked, trims trailing slash on paths", () => {
  assert.equal(normalizeUrl("HTTPS://Example.com/Path/#frag", { ignoreHash: true }), "https://example.com/Path");
  assert.equal(normalizeUrl("https://example.com/Path/#frag", { ignoreHash: false }), "https://example.com/Path#frag");
  assert.equal(normalizeUrl("https://example.com/", { ignoreHash: true }), "https://example.com/");
  assert.equal(normalizeUrl("not a url", { ignoreHash: true }), "not a url");
});

test("findDuplicates groups by normalized url and keeps the most recently accessed", () => {
  const s = buildSession({ windows: [
    win({ id: 1, tabs: [tab({ id: 1, url: "https://a.com/x#1", lastAccessed: 10 }), tab({ id: 2, url: "https://a.com/x#2", lastAccessed: 30 }), tab({ id: 3, url: "https://b.com/" })] }),
    win({ id: 2, tabs: [tab({ id: 4, url: "https://A.com/x/", lastAccessed: 20 })] }),
  ], groups: [] });
  const d = findDuplicates(s, { ignoreHash: true });
  assert.equal(d.length, 1);
  assert.equal(d[0].url, "https://a.com/x");
  assert.deepEqual(d[0].tabs.map((x) => [x.windowId, x.tab.id]), [[1, 1], [1, 2], [2, 4]]);
  assert.equal(d[0].keepId, 2);
  assert.equal(findDuplicates(s, { ignoreHash: false }).length, 0);
});

test("findDuplicates ignores tabs without a url", () => {
  const s = buildSession({ windows: [win({ id: 1, tabs: [tab({ id: 1, url: "" }), tab({ id: 2, url: "" })] })], groups: [] });
  assert.equal(findDuplicates(s, { ignoreHash: true }).length, 0);
});
