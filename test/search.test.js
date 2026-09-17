const test = require("node:test");
const assert = require("node:assert/strict");
const { tab, win } = require("./fake-data.js");
const { buildSession } = require("../lib/session.js");
const { filterSession } = require("../lib/search.js");

function session() {
  return buildSession({ windows: [
    win({ id: 1, tabs: [tab({ id: 1, title: "GitHub - TabVault", url: "https://github.com/x/tabvault" }), tab({ id: 2, title: "Docs", url: "https://developer.chrome.com/docs" })] }),
    win({ id: 2, tabs: [tab({ id: 3, title: "News", url: "https://news.ycombinator.com/" })] }),
  ], groups: [] });
}

test("empty query returns everything", () => {
  const r = filterSession(session(), "");
  assert.equal(r.count, 3);
  assert.equal(r.windows.length, 2);
});

test("terms match title or url, case-insensitive, all terms required", () => {
  assert.deepEqual(filterSession(session(), "tabvault").windows[0].tabs.map((t) => t.id), [1]);
  assert.equal(filterSession(session(), "CHROME docs").count, 1);
  assert.equal(filterSession(session(), "chrome news").count, 0);
});

test("windows without matches are dropped from the result", () => {
  const r = filterSession(session(), "news");
  assert.deepEqual(r.windows.map((w) => w.id), [2]);
});
