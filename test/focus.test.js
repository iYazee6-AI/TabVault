const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../lib/focus.js");

const OWN = "chrome-extension://abc/";

test("isVeilable: http and https pages only, never the Web Store", () => {
  assert.equal(F.isVeilable("https://example.com/a"), true);
  assert.equal(F.isVeilable("http://127.0.0.1:8765/x.html"), true);
  assert.equal(F.isVeilable("chrome://newtab/"), false);
  assert.equal(F.isVeilable("chrome-extension://other/page.html"), false);
  assert.equal(F.isVeilable("file:///C:/a.pdf"), false);
  assert.equal(F.isVeilable("about:blank"), false);
  assert.equal(F.isVeilable("data:text/html,hi"), false);
  assert.equal(F.isVeilable("view-source:https://a.com/"), false);
  assert.equal(F.isVeilable("https://chromewebstore.google.com/detail/x"), false);
  assert.equal(F.isVeilable("https://chrome.google.com/webstore/detail/x"), false);
  assert.equal(F.isVeilable("https://chrome.google.com/other"), true);
  assert.equal(F.isVeilable(""), false);
  assert.equal(F.isVeilable(undefined), false);
});

test("focusCommand toggles: on, lift from the same window, move from another", () => {
  assert.equal(F.focusCommand(F.FOCUS_OFF, 1), "on");
  assert.equal(F.focusCommand(undefined, 1), "on");
  const s = F.startState(1, "veil", 100);
  assert.equal(F.focusCommand(s, 1), "lift");
  assert.equal(F.focusCommand(s, 2), "move");
});

test("planVeil: every tab outside the focused window, sorted into veil, unloaded and skip", () => {
  const windows = [
    { id: 1, type: "normal", tabs: [{ id: 10, url: "https://a.com/" }, { id: 11, url: "chrome://newtab/" }] },
    { id: 2, type: "normal", tabs: [
      { id: 20, url: "https://b.com/" },
      { id: 21, url: "chrome://settings/" },
      { id: 22, url: "https://c.com/", discarded: true },
      { id: 23, url: OWN + "app/index.html" },
      { id: 24, url: "", pendingUrl: "https://d.com/" },
      { id: 25, url: "https://chromewebstore.google.com/" },
    ] },
    { id: 3, type: "popup", tabs: [{ id: 30, url: "https://e.com/" }] },
    { id: 4, type: "devtools", tabs: [{ id: 40, url: "devtools://x" }] },
  ];
  const plan = F.planVeil(windows, 1, OWN);
  assert.deepEqual(plan.veil, [20, 24]); // the popup window (30) is never veiled
  assert.deepEqual(plan.skip, [21, 25]);
  assert.deepEqual(plan.unloaded, [22]);
});

test("planVeil with one window veils nothing", () => {
  const plan = F.planVeil([{ id: 1, tabs: [{ id: 1, url: "https://a.com/" }] }], 1, OWN);
  assert.deepEqual(plan, { veil: [], skip: [], unloaded: [] });
});

test("tabAction: what a tab that loads, opens or moves needs while focus is on", () => {
  const on = F.startState(1, "veil", 0);
  assert.equal(F.tabAction(on, { id: 5, windowId: 2, url: "https://a.com/" }, OWN), "veil");
  assert.equal(F.tabAction(on, { id: 5, windowId: 2, url: "chrome://newtab/" }, OWN), "skip");
  assert.equal(F.tabAction(on, { id: 5, windowId: 1, url: "https://a.com/" }, OWN), "unveil");
  assert.equal(F.tabAction(on, { id: 5, windowId: 2, url: OWN + "app/index.html" }, OWN), "none");
  assert.equal(F.tabAction(F.FOCUS_OFF, { id: 5, windowId: 2, url: "https://a.com/" }, OWN), "none");
  assert.equal(F.tabAction(F.startState(1, "minimize", 0), { id: 5, windowId: 2, url: "https://a.com/" }, OWN), "none");
});

test("tabAction: a popup opened from the focused window (a sign-in, a payment) stays clear", () => {
  const on = F.startState(1, "veil", 0);
  const tab = { id: 6, windowId: 3, url: "https://login.example.com/" };
  assert.equal(F.tabAction(on, tab, OWN, { type: "popup" }), "none");
  assert.equal(F.tabAction(on, tab, OWN, { type: "app" }), "none");
  assert.equal(F.tabAction(on, tab, OWN, { type: "normal" }), "veil");
  assert.equal(F.tabAction(on, { ...tab, windowId: 1 }, OWN, { type: "popup" }), "unveil");
});

test("withSkipped keeps a sorted set and does not touch the input", () => {
  const s0 = F.startState(1, "veil", 0);
  const s1 = F.withSkipped(F.withSkipped(F.withSkipped(s0, 9, true), 3, true), 9, true);
  assert.deepEqual(s1.skipped, [3, 9]);
  assert.deepEqual(s0.skipped, []);
  assert.deepEqual(F.withSkipped(s1, 3, false).skipped, [9]);
  assert.equal(s1.windowId, 1);
});

test("startState: veil unless minimize is asked for", () => {
  assert.equal(F.startState(7, "minimize", 5).mode, "minimize");
  assert.equal(F.startState(7, "anything", 5).mode, "veil");
  assert.deepEqual(F.startState(7, "veil", 5, { skipped: [1] }), { on: true, windowId: 7, mode: "veil", since: 5, skipped: [1], minimized: [] });
});

test("minimizePlan: other normal windows that are not minimised, with the state to go back to", () => {
  const windows = [
    { id: 1, type: "normal", state: "maximized" },
    { id: 2, type: "normal", state: "maximized" },
    { id: 3, type: "normal", state: "minimized" },
    { id: 4, type: "popup", state: "normal" },
    { id: 5, type: "normal" },
  ];
  assert.deepEqual(F.minimizePlan(windows, 1), [{ id: 2, state: "maximized" }, { id: 5, state: "normal" }]);
});

test("focusSummary: the page's line", () => {
  assert.equal(F.focusSummary(F.FOCUS_OFF), "");
  assert.equal(F.focusSummary(F.startState(1, "veil", 0)), "Focus is on");
  assert.equal(F.focusSummary({ ...F.startState(1, "veil", 0), skipped: [4] }), "Focus is on · 1 tab could not be veiled");
  assert.equal(F.focusSummary({ ...F.startState(1, "veil", 0), skipped: [4, 5] }), "Focus is on · 2 tabs could not be veiled");
  assert.equal(F.focusSummary({ ...F.startState(1, "minimize", 0), minimized: [{ id: 2 }, { id: 3 }] }), "Focus is on: 2 other windows minimised");
});

test("the badge dot and the permission are fixed values", () => {
  assert.equal(F.FOCUS_BADGE, "●");
  assert.deepEqual(F.FOCUS_ORIGINS, ["<all_urls>"]);
});
