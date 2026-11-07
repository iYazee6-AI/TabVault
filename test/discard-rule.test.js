const test = require("node:test");
const assert = require("node:assert/strict");
const { planDiscard, parseAllowlist, hostAllowed, lastRunText } = require("../lib/discard-rule.js");

const MIN = 60000;
const NOW = 1000 * MIN;
let next = 1;
const t = (props = {}) => ({ id: next++, url: `https://site${next}.com/`, active: false, audible: false, discarded: false, pinned: false, groupId: -1, lastAccessed: NOW - 120 * MIN, ...props });
const settings = (props = {}) => ({ enabled: true, minutes: 60, keepPinned: true, allowlist: [], ...props });

test("threshold: a tab idle past it is planned, one used within it is not", () => {
  const old = t({ lastAccessed: NOW - 61 * MIN });
  const fresh = t({ lastAccessed: NOW - 59 * MIN });
  assert.deepEqual(planDiscard([old, fresh], { settings: settings(), now: NOW }).ids, [old.id]);
  assert.deepEqual(planDiscard([old, fresh], { settings: settings({ minutes: 15 }), now: NOW }).ids.sort(), [old.id, fresh.id].sort());
});

test("never the active, audible, already unloaded or autoDiscardable=false tab", () => {
  const tabs = [t({ active: true }), t({ audible: true }), t({ discarded: true }), t({ autoDiscardable: false })];
  assert.deepEqual(planDiscard(tabs, { settings: settings(), now: NOW }).ids, []);
});

test("pinned tabs are kept while keepPinned is on, and planned when it is off", () => {
  const pinned = t({ pinned: true });
  assert.deepEqual(planDiscard([pinned], { settings: settings(), now: NOW }).ids, []);
  assert.deepEqual(planDiscard([pinned], { settings: settings({ keepPinned: false }), now: NOW }).ids, [pinned.id]);
});

test("a tab in a group named with a leading pin emoji is kept", () => {
  const inPinGroup = t({ groupId: 7 });
  const inOther = t({ groupId: 8 });
  const groups = [{ id: 7, title: "📌 Reading" }, { id: 8, title: "Later 📌" }];
  assert.deepEqual(planDiscard([inPinGroup, inOther], { settings: settings(), now: NOW, groups }).ids, [inOther.id]);
});

test("allowlist with wildcard subdomains", () => {
  const list = parseAllowlist("*.example.com" + String.fromCharCode(10) + "https://mail.test.org/inbox?x=1, bad_host!  docs.site.io:8080");
  assert.deepEqual(list, ["*.example.com", "mail.test.org", "docs.site.io"]);
  assert.equal(hostAllowed("example.com", list), true);
  assert.equal(hostAllowed("a.b.example.com", list), true);
  assert.equal(hostAllowed("notexample.com", list), false);
  assert.equal(hostAllowed("www.mail.test.org", list), true);
  assert.equal(hostAllowed("other.test.org", list), false);
  const kept = t({ url: "https://news.example.com/x" });
  const gone = t({ url: "https://example.net/" });
  assert.deepEqual(planDiscard([kept, gone], { settings: settings({ allowlist: list }), now: NOW }).ids, [gone.id]);
});

test("a tab without lastAccessed is skipped, and TabVault's own pages are never planned", () => {
  const own = "chrome-extension://abc/";
  const tabs = [t({ lastAccessed: undefined }), t({ url: own + "app/index.html" })];
  assert.deepEqual(planDiscard(tabs, { settings: settings(), now: NOW, ownPrefix: own }).ids, []);
});

test("at most 25 per run, oldest first; eligible counts the rest", () => {
  const tabs = Array.from({ length: 40 }, (_, i) => t({ lastAccessed: NOW - (100 + i) * MIN }));
  const plan = planDiscard(tabs, { settings: settings(), now: NOW });
  assert.equal(plan.ids.length, 25);
  assert.equal(plan.eligible, 40);
  assert.equal(plan.ids[0], tabs[39].id, "the longest idle goes first");
});

test("lastRunText reads like the spec's line", () => {
  assert.equal(lastRunText({ at: 1, unloaded: 7 }, () => "12:40"), "last run 12:40, 7 unloaded");
  assert.equal(lastRunText({ at: 1, unloaded: 25, failed: 1, waiting: 3 }, () => "09:05"), "last run 09:05, 25 unloaded, 1 could not be unloaded, 3 wait for the next run");
  assert.equal(lastRunText(null), "Not run yet in this browser session.");
});
