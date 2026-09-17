const test = require("node:test");
const assert = require("node:assert/strict");
const { tab, win, group } = require("./fake-data.js");
const S = require("../lib/session.js");

test("buildSession maps windows, groups and tabs to schema 1, focused window first", () => {
  const w1 = win({ id: 1, tabs: [tab({ id: 11, title: "A", url: "https://a.com/", active: true, pinned: true }), tab({ id: 12, url: "https://b.com/", groupId: 5, audible: true, mutedInfo: { muted: true } })] });
  const w2 = win({ id: 2, focused: true, incognito: true, state: "maximized", tabs: [tab({ id: 21, url: "https://c.com/" })] });
  const g = group({ id: 5, windowId: 1, title: "Work", color: "blue", collapsed: true });
  const s = S.buildSession({ windows: [w1, w2], groups: [g], now: 123, browser: { name: "Chrome", version: "1" } });
  assert.equal(s.schema, 1);
  assert.equal(s.capturedAt, 123);
  assert.deepEqual(s.windows.map((w) => w.id), [2, 1], "focused first");
  const a = s.windows[1];
  assert.deepEqual(a.groups, [{ id: 5, title: "Work", color: "blue", collapsed: true }]);
  assert.deepEqual(a.tabs[0], { id: 11, index: 0, title: "A", url: "https://a.com/", favIconUrl: "", pinned: true, muted: false, audible: false, active: true, discarded: false, groupId: null, lastAccessed: 1011, openerTabId: null });
  assert.equal(a.tabs[1].groupId, 5);
  assert.equal(a.tabs[1].muted, true);
  assert.equal(s.windows[0].incognito, true);
  assert.deepEqual(s.windows[0].bounds, { left: 0, top: 0, width: 1200, height: 800 });
});

test("buildSession excludes the extension's own page and empty windows it leaves behind", () => {
  const w = win({ id: 1, tabs: [tab({ id: 1, url: "chrome-extension://abc/app/index.html" }), tab({ id: 2, url: "https://x.com/" })] });
  const only = win({ id: 2, tabs: [tab({ id: 3, url: "chrome-extension://abc/app/index.html" })] });
  const s = S.buildSession({ windows: [w, only], groups: [], excludeUrlPrefix: "chrome-extension://abc/" });
  assert.deepEqual(s.windows.map((x) => x.tabs.map((t) => t.id)), [[2]]);
  assert.equal(S.countTabs(s), 1);
});

test("buildSession orders tabs by index and uses pendingUrl when url is empty", () => {
  const w = win({ id: 1, tabs: [tab({ id: 1, index: 1, url: "" , pendingUrl: "https://p.com/" }), tab({ id: 2, index: 0 })] });
  const s = S.buildSession({ windows: [w], groups: [] });
  assert.deepEqual(s.windows[0].tabs.map((t) => t.id), [2, 1]);
  assert.equal(s.windows[0].tabs[1].url, "https://p.com/");
});

test("stripVolatile removes fields that change without user intent", () => {
  const w = win({ id: 1, focused: true, tabs: [tab({ id: 1, active: true, discarded: true, audible: true, lastAccessed: 5 })] });
  const s = S.buildSession({ windows: [w], groups: [], now: 9 });
  const v = S.stripVolatile(s);
  assert.equal(v.capturedAt, undefined);
  assert.equal(v.windows[0].focused, undefined);
  assert.equal(v.windows[0].tabs[0].lastAccessed, undefined);
  assert.equal(v.windows[0].tabs[0].active, undefined);
  assert.equal(v.windows[0].tabs[0].discarded, undefined);
  assert.equal(v.windows[0].tabs[0].audible, undefined);
  assert.equal(v.windows[0].tabs[0].url, s.windows[0].tabs[0].url);
  assert.equal(s.windows[0].tabs[0].active, true, "input untouched");
});
