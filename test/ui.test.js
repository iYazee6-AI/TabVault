const test = require("node:test");
const assert = require("node:assert/strict");
const { formatCounts } = require("../lib/ui.js");

test("formatCounts: windows and tabs; a search shows matched of total; a selection is appended", () => {
  assert.equal(formatCounts({ windows: 3, tabs: 27 }), "3 win · 27 tabs");
  assert.equal(formatCounts({ windows: 3, tabs: 27, selected: 4 }), "3 win · 27 tabs · 4 sel");
  assert.equal(formatCounts({ windows: 3, tabs: 27, shown: 4 }), "3 win · 4 of 27 tabs");
  assert.equal(formatCounts({ windows: 3, tabs: 27, shown: 0, selected: 2 }), "3 win · 0 of 27 tabs · 2 sel");
  assert.equal(formatCounts({ windows: 1, tabs: 1 }), "1 win · 1 tab");
});
