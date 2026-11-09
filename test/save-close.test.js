const test = require("node:test");
const assert = require("node:assert/strict");
const { planSaveClose, snapshotName } = require("../lib/save-close.js");

test("closing one of two windows closes its saved tabs and keeps nothing open", () => {
  const plan = planSaveClose({ windows: [{ id: 1, tabIds: [11, 12] }, { id: 2, tabIds: [21] }], targetIds: [1], savedTabIds: [11, 12] });
  assert.deepEqual(plan, { tabIds: [11, 12], count: 2, keepOpenWindowId: null });
});

test("the only window is kept open (a New Tab goes in first) when nothing else would remain", () => {
  const plan = planSaveClose({ windows: [{ id: 1, tabIds: [11, 12] }], targetIds: [1], savedTabIds: [11, 12] });
  assert.equal(plan.keepOpenWindowId, 1);
  assert.equal(plan.count, 2);
  const all = planSaveClose({ windows: [{ id: 1, tabIds: [11] }, { id: 2, tabIds: [21] }], targetIds: [1, 2], savedTabIds: [11, 21] });
  assert.equal(all.keepOpenWindowId, 1, "save and close all windows keeps one");
});

test("TabVault's own tab and tabs opened after the snapshot are never closed, so their window stays", () => {
  const plan = planSaveClose({ windows: [{ id: 1, tabIds: [11, 12, 99] }], targetIds: [1], savedTabIds: [11, 12] });
  assert.deepEqual(plan, { tabIds: [11, 12], count: 2, keepOpenWindowId: null });
});

test("snapshotName joins the label and the time", () => {
  assert.equal(snapshotName("Work", 0, () => "12:40"), "Work · 12:40");
  assert.equal(snapshotName("  ", 0, () => "09:00"), "Window · 09:00");
  assert.equal(snapshotName("x".repeat(80), 0, () => "1").length, 64);
});
