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

const { migrateIdleRules } = require("../lib/settings.js");

test("withDefaults: idleRules default to [] and bad rules are cleaned, never trusted", () => {
  assert.deepEqual(withDefaults({}).idleRules, []);
  const s = withDefaults({ idleRules: [
    { id: "r1", pattern: "news.example.com", idleMinutes: 60, action: "shelve", shelfId: "s1", enabled: true, previewedFor: "news.example.com|60" },
    { id: "r2", pattern: "x.example.com", idleMinutes: 7, action: "explode", enabled: "yes" },
    { id: "r3", pattern: "y.example.com", idleMinutes: 1440, action: "shelve", enabled: true },
    "junk", { pattern: "" },
  ] });
  assert.equal(s.idleRules.length, 3);
  assert.deepEqual(s.idleRules[0], { id: "r1", pattern: "news.example.com", idleMinutes: 60, action: "shelve", shelfId: "s1", enabled: true, previewedFor: "news.example.com|60" });
  assert.equal(s.idleRules[1].idleMinutes, 60);
  assert.equal(s.idleRules[1].action, "unload");
  assert.equal(s.idleRules[1].enabled, true);
  assert.equal(s.idleRules[2].enabled, false, "a shelving rule without a shelf is off");
});

test("the 1.2 allowlist migrates once into never rules; a 1.3 store is left alone", () => {
  const raw = { keepSnapshots: 9, autoDiscard: { enabled: true, minutes: 30, allowlist: ["*.tracker.example.com", "mail.example.com"] } };
  const m = migrateIdleRules(raw);
  assert.equal(m.changed, true);
  assert.deepEqual(m.settings.idleRules.map((r) => [r.pattern, r.action, r.enabled]), [["*.tracker.example.com", "never", true], ["mail.example.com", "never", true]]);
  assert.deepEqual(m.settings.autoDiscard.allowlist, raw.autoDiscard.allowlist, "the 1.2 key is kept one release for a downgrade");
  assert.equal(m.settings.keepSnapshots, 9);
  const again = migrateIdleRules(m.settings);
  assert.equal(again.changed, false, "idempotent");
  const mine = { idleRules: [{ id: "a", pattern: "x.com", idleMinutes: 15, action: "unload", enabled: true }], idleRulesVersion: 1, autoDiscard: { allowlist: ["y.com"] } };
  assert.equal(migrateIdleRules(mine).changed, false, "a 1.3 store is not touched");
  const fresh = migrateIdleRules({});
  assert.deepEqual(fresh.settings.idleRules, []);
  const savedByPageFirst = { idleRules: [], autoDiscard: { allowlist: ["z.example.com"] } };
  assert.deepEqual(migrateIdleRules(savedByPageFirst).settings.idleRules.map((r) => r.pattern), ["z.example.com"], "a page save before the worker ran does not lose the list");
});
