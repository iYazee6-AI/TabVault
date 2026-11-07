const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldRecord, closedEntry, appendClosed, removeEntries, sections, RECENT_CAP } = require("../lib/recent.js");

const own = "chrome-extension://abc/";

test("chrome:// pages, TabVault itself and empty URLs are not recorded", () => {
  assert.equal(shouldRecord("https://a.com/", own), true);
  assert.equal(shouldRecord("file:///C:/notes.txt", own), true);
  assert.equal(shouldRecord("chrome://newtab/", own), false);
  assert.equal(shouldRecord("chrome://settings", own), false);
  assert.equal(shouldRecord(own + "app/index.html", own), false);
  assert.equal(shouldRecord("about:blank", own), false);
  assert.equal(shouldRecord("", own), false);
});

test("append puts the newest first and caps the list at 200", () => {
  let list = [];
  for (let i = 0; i < 205; i++) list = appendClosed(list, [closedEntry({ url: `https://a.com/${i}`, windowId: 1 }, { closedAt: i })]);
  assert.equal(list.length, RECENT_CAP);
  assert.equal(list[0].url, "https://a.com/204");
  assert.equal(list[199].url, "https://a.com/5");
});

test("an entry keeps url, title, favicon, window and group; a huge data: favicon is dropped", () => {
  const e = closedEntry({ url: "https://a.com/", title: "A", favIconUrl: "https://a.com/f.ico", windowId: 3 }, { groupTitle: "Work", closedAt: 9 });
  assert.equal(typeof e.id, "string");
  assert.deepEqual({ ...e, id: "x" }, { id: "x", url: "https://a.com/", title: "A", favIconUrl: "https://a.com/f.ico", windowId: 3, groupTitle: "Work", closedAt: 9 });
  assert.equal(closedEntry({ url: "https://a.com/", favIconUrl: "data:" + "x".repeat(3000) }).favIconUrl, "");
});

test("sections group one window close; remove drops entries by id", () => {
  const a = closedEntry({ url: "https://a.com/" }, { batch: "w1-5" });
  const b = closedEntry({ url: "https://b.com/" }, { batch: "w1-5" });
  const c = closedEntry({ url: "https://c.com/" });
  const s = sections([a, b, c]);
  assert.equal(s.length, 2);
  assert.equal(s[0].entries.length, 2);
  assert.equal(s[1].batch, "");
  assert.deepEqual(removeEntries([a, b, c], [a.id, c.id]).map((e) => e.url), ["https://b.com/"]);
});
