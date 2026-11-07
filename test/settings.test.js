const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_SETTINGS, withDefaults } = require("../lib/settings.js");

test("withDefaults fills a 1.1 store and merges autoDiscard one level deep", () => {
  const s = withDefaults({ keepSnapshots: 9, autoDiscard: { enabled: true, allowlist: ["*.example.com", 3] } });
  assert.equal(s.keepSnapshots, 9);
  assert.equal(s.badge, "total");
  assert.equal(s.recordClosed, true);
  assert.deepEqual(s.autoDiscard, { enabled: true, minutes: 60, keepPinned: true, allowlist: ["*.example.com"] });
  assert.deepEqual(withDefaults(undefined).autoDiscard, DEFAULT_SETTINGS.autoDiscard);
  assert.equal(withDefaults({ badge: "nope", autoDiscard: { minutes: 7 } }).badge, "total");
  assert.equal(withDefaults({ autoDiscard: { minutes: 7 } }).autoDiscard.minutes, 60);
  assert.equal(withDefaults({ autoDiscard: { minutes: 240, keepPinned: false } }).autoDiscard.keepPinned, false);
});
