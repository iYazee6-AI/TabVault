const test = require("node:test");
const assert = require("node:assert/strict");
const { planRestore } = require("../lib/restore-plan.js");

const session = {
  schema: 1,
  windows: [
    { id: 1, type: "normal", state: "normal", incognito: false, bounds: { left: 10, top: 10, width: 800, height: 600 },
      groups: [{ id: 5, title: "Work", color: "blue", collapsed: true }],
      tabs: [
        { id: 11, index: 0, url: "https://pinned.com/", pinned: true, muted: false, groupId: null },
        { id: 12, index: 1, url: "https://a.com/", pinned: false, muted: true, groupId: 5 },
        { id: 13, index: 2, url: "https://b.com/", pinned: false, muted: false, groupId: 5 },
      ] },
    { id: 2, type: "normal", state: "maximized", incognito: true, bounds: { left: 0, top: 0, width: 5000, height: 5000 }, groups: [],
      tabs: [{ id: 21, index: 0, url: "https://c.com/", pinned: false, muted: false, groupId: null }] },
  ],
};

test("plan opens the first non-pinned tab with the window, adds the rest inactive, then pins, mutes, groups, discards", () => {
  const { steps, skipped } = planRestore(session, { selectedWindowIds: [1], allowIncognito: false, screen: { width: 1920, height: 1080 } });
  assert.deepEqual(skipped, []);
  assert.deepEqual(steps.map((s) => s.op), ["createWindow", "createTab", "createTab", "updateTab", "updateTab", "groupTabs", "updateGroup", "discardTab", "discardTab"]);
  assert.deepEqual(steps[0], { op: "createWindow", ref: "w1", url: "https://a.com/", incognito: false, state: "normal", bounds: { left: 10, top: 10, width: 800, height: 600 }, firstTabRef: "t12" });
  assert.deepEqual(steps[1], { op: "createTab", ref: "t11", windowRef: "w1", url: "https://pinned.com/", index: 0, pinned: true });
  assert.deepEqual(steps[2], { op: "createTab", ref: "t13", windowRef: "w1", url: "https://b.com/", index: 2, pinned: false });
  assert.deepEqual(steps[3], { op: "updateTab", ref: "t11", pinned: true });
  assert.deepEqual(steps[4], { op: "updateTab", ref: "t12", muted: true });
  assert.deepEqual(steps[5], { op: "groupTabs", groupRef: "g5", windowRef: "w1", tabRefs: ["t12", "t13"] });
  assert.deepEqual(steps[6], { op: "updateGroup", groupRef: "g5", title: "Work", color: "blue", collapsed: true });
  assert.deepEqual(steps.slice(7).map((s) => s.ref), ["t11", "t13"], "the window's first tab is not discarded");
});

test("incognito windows are skipped unless allowed; maximized windows get no bounds; oversized bounds dropped", () => {
  const denied = planRestore(session, { selectedWindowIds: [2], allowIncognito: false, screen: { width: 1920, height: 1080 } });
  assert.deepEqual(denied.steps, []);
  assert.deepEqual(denied.skipped, [{ windowId: 2, reason: "incognito access is not allowed for TabVault" }]);
  const allowed = planRestore(session, { selectedWindowIds: [2], allowIncognito: true, screen: { width: 1920, height: 1080 } });
  assert.equal(allowed.steps[0].incognito, true);
  assert.equal(allowed.steps[0].state, "maximized");
  assert.equal(allowed.steps[0].bounds, null);
});

test("discard: false emits no discardTab steps and is otherwise identical", () => {
  const withDiscard = planRestore(session, { selectedWindowIds: [1], allowIncognito: false, screen: { width: 1920, height: 1080 } });
  const withoutDiscard = planRestore(session, { selectedWindowIds: [1], allowIncognito: false, screen: { width: 1920, height: 1080 }, discard: false });
  assert.deepEqual(withoutDiscard.skipped, withDiscard.skipped);
  assert.ok(!withoutDiscard.steps.some((s) => s.op === "discardTab"), "no discardTab steps when discard is false");
  assert.deepEqual(withoutDiscard.steps, withDiscard.steps.filter((s) => s.op !== "discardTab"), "steps are otherwise identical");
});

test("a window whose tabs are all pinned opens with its first tab", () => {
  const s = { schema: 1, windows: [{ id: 3, state: "normal", incognito: false, bounds: { left: 0, top: 0, width: 100, height: 100 }, groups: [], tabs: [{ id: 31, index: 0, url: "https://p.com/", pinned: true, muted: false, groupId: null }] }] };
  const { steps } = planRestore(s, { selectedWindowIds: [3], allowIncognito: true, screen: null });
  assert.equal(steps[0].firstTabRef, "t31");
  assert.deepEqual(steps.map((x) => x.op), ["createWindow", "updateTab"]);
});
