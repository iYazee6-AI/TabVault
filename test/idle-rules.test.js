const test = require("node:test");
const assert = require("node:assert/strict");
const { planIdle, dryRunRule, patternError, ruleKey, ruleUnlocked, dryRunUnlock, LARGE_MATCH } = require("../lib/discard-rule.js");
const { withDefaults } = require("../lib/settings.js");

const MIN = 60000;
const NOW = 10000 * MIN;
let next = 1;
const t = (props = {}) => ({ id: next++, windowId: 1, url: `https://site${next}.com/`, active: false, audible: false, discarded: false, pinned: false, incognito: false, groupId: -1, lastAccessed: NOW - 120 * MIN, ...props });
const anchor = () => t({ active: true, url: "https://anchor.example.org/" }); // keeps window 1 alive
const rule = (props = {}) => {
  const r = { id: `r${next++}`, pattern: "news.example.com", idleMinutes: 60, action: "unload", shelfId: null, enabled: true, previewedFor: "", ...props };
  if (r.action === "shelve" && r.previewedFor === "") r.previewedFor = ruleKey(r);
  return r;
};
const settings = ({ rules = [], global = {} } = {}) => withDefaults({ autoDiscard: { enabled: false, minutes: 60, keepPinned: true, ...global }, idleRules: rules });
const shelfIds = new Set(["s1", "s2"]);
const plan = (tabs, s, opts = {}) => planIdle(tabs, [], s, NOW, { shelfIds, windows: [{ id: 1, type: "normal" }, { id: 2, type: "normal" }], ...opts });

test("rules are checked top to bottom: the first match decides", () => {
  const news = t({ url: "https://news.example.com/a" });
  const s = settings({ rules: [rule({ action: "shelve", shelfId: "s1" }), rule({ action: "unload" })] });
  const p = plan([anchor(), news], s);
  assert.deepEqual(p.shelve.map((x) => [x.id, x.shelfId]), [[news.id, "s1"]]);
  assert.deepEqual(p.unload, []);
});

test("never beats a later shelve, and *.host covers subdomains", () => {
  const sub = t({ url: "https://a.tracker.example.com/board" });
  const s = settings({ rules: [rule({ pattern: "*.tracker.example.com", action: "never" }), rule({ pattern: "*.example.com", action: "shelve", shelfId: "s1" })] });
  const p = plan([anchor(), sub], s);
  assert.deepEqual([p.unload.length, p.shelve.length], [0, 0]);
});

test("a tab no rule matches falls back to the global setting, and only when it is on (or forced)", () => {
  const other = t({ url: "https://elsewhere.example.net/" });
  const s = settings({ rules: [rule({ action: "never" })] });
  assert.deepEqual(plan([anchor(), other], s).unload, []);
  assert.deepEqual(plan([anchor(), other], settings({ rules: [rule({ action: "never" })], global: { enabled: true } })).unload, [other.id]);
  assert.deepEqual(plan([anchor(), other], s, { force: true }).unload, [other.id]);
});

test("each rule has its own idle time; a tab used within it waits", () => {
  const fresh = t({ url: "https://news.example.com/fresh", lastAccessed: NOW - 20 * MIN });
  const old = t({ url: "https://news.example.com/old", lastAccessed: NOW - 40 * MIN });
  const p = plan([anchor(), fresh, old], settings({ rules: [rule({ idleMinutes: 30, action: "shelve", shelfId: "s1" })] }));
  assert.deepEqual(p.shelve.map((x) => x.id), [old.id]);
});

test("the exemptions apply to every action: active, audible, not discardable, own pages, no lastAccessed, the pin-emoji group", () => {
  const own = "chrome-extension://abc/";
  const tabs = [
    t({ url: "https://news.example.com/1", active: true }),
    t({ url: "https://news.example.com/2", audible: true }),
    t({ url: "https://news.example.com/3", autoDiscardable: false }),
    t({ url: own + "app/index.html" }),
    t({ url: "https://news.example.com/4", lastAccessed: undefined }),
    t({ url: "https://news.example.com/5", groupId: 7 }),
  ];
  const groups = [{ id: 7, title: "📌 Keep" }];
  for (const action of ["unload", "shelve"]) {
    const p = planIdle(tabs, groups, settings({ rules: [rule({ action, shelfId: "s1" })], global: { enabled: true } }), NOW, { shelfIds, ownPrefix: own, windows: [{ id: 1, type: "normal" }] });
    assert.deepEqual([p.unload, p.shelve], [[], []], action);
  }
});

test("a shelving rule never touches the active tab of any window", () => {
  const a1 = t({ windowId: 1, url: "https://news.example.com/a", active: true });
  const a2 = t({ windowId: 2, url: "https://news.example.com/b", active: true });
  const idle = t({ windowId: 2, url: "https://news.example.com/c" });
  const p = plan([a1, a2, idle], settings({ rules: [rule({ action: "shelve", shelfId: "s1" })] }));
  assert.deepEqual(p.shelve.map((x) => x.id), [idle.id]);
});

test("incognito tabs are never planned by a rule", () => {
  const inc = t({ url: "https://news.example.com/private", incognito: true, windowId: 2 });
  for (const action of ["unload", "shelve"]) {
    const p = plan([anchor(), inc], settings({ rules: [rule({ action, shelfId: "s1" })] }));
    assert.deepEqual([p.unload, p.shelve], [[], []], action);
  }
});

test("the global Never unload pinned tabs wins over every rule", () => {
  const pinned = t({ url: "https://news.example.com/p", pinned: true });
  const s = settings({ rules: [rule({ action: "shelve", shelfId: "s1" })] });
  assert.deepEqual(plan([anchor(), pinned], s).shelve, []);
  const off = settings({ rules: [rule({ action: "shelve", shelfId: "s1" })], global: { keepPinned: false } });
  assert.deepEqual(plan([anchor(), pinned], off).shelve.map((x) => x.id), [pinned.id]);
});

test("at most 25 a run across both actions: unloads first, then shelves, each oldest idle first", () => {
  const unloads = Array.from({ length: 20 }, (_, i) => t({ url: `https://u.example.com/${i}`, lastAccessed: NOW - (100 + i) * MIN }));
  const shelves = Array.from({ length: 10 }, (_, i) => t({ url: `https://news.example.com/${i}`, lastAccessed: NOW - (500 + i) * MIN }));
  const s = settings({ rules: [rule({ pattern: "u.example.com", action: "unload" }), rule({ action: "shelve", shelfId: "s1" })] });
  const p = plan([anchor(), ...unloads, ...shelves], s);
  assert.equal(p.unload.length, 20);
  assert.equal(p.shelve.length, 5);
  assert.equal(p.eligible, 30);
  assert.equal(p.waiting, 5);
  assert.equal(p.unload[0], unloads[19].id, "the longest idle unload first");
  assert.deepEqual(p.shelve.map((x) => x.id), shelves.slice(5).reverse().map((x) => x.id), "the five oldest shelves");
});

test("a shelving rule that was not dry-run for its current pattern and time plans nothing", () => {
  const news = t({ url: "https://news.example.com/a" });
  const stale = rule({ action: "shelve", shelfId: "s1", previewedFor: "news.example.com|30" });
  assert.equal(ruleUnlocked(stale), false);
  assert.deepEqual(plan([anchor(), news], settings({ rules: [stale] })).shelve, []);
  const off = rule({ action: "shelve", shelfId: "s1", enabled: false });
  assert.deepEqual(plan([anchor(), news], settings({ rules: [off] })).shelve, []);
  const noShelf = rule({ action: "shelve", shelfId: "gone" });
  assert.deepEqual(plan([anchor(), news], settings({ rules: [noShelf] })).shelve, [], "a shelf that no longer exists");
});

test("when shelving would leave no normal window, the last tab is unloaded instead", () => {
  const a = t({ windowId: 1, url: "https://news.example.com/a", lastAccessed: NOW - 300 * MIN });
  const b = t({ windowId: 1, url: "https://news.example.com/b", lastAccessed: NOW - 200 * MIN });
  const p = planIdle([a, b], [], settings({ rules: [rule({ action: "shelve", shelfId: "s1" })] }), NOW, { shelfIds, windows: [{ id: 1, type: "normal" }] });
  assert.deepEqual(p.shelve.map((x) => x.id), [a.id]);
  assert.deepEqual(p.unload, [b.id]);
});

test("a pattern must leave a registrable domain", () => {
  for (const bad of ["*.com", "*.co.uk", "*.com.sa", "com", "co.uk", "", "two words.com", "a.com, b.com"]) assert.ok(patternError(bad), `${bad} accepted`);
  for (const ok of ["news.example.com", "*.example.com", "example.co.uk", "*.shop.com.sa", "127.0.0.1", "https://news.example.com/path"]) assert.equal(patternError(ok), null, ok);
  assert.equal(ruleKey({ pattern: "a.com", idleMinutes: 15 }), "a.com|15");
});

test("the dry run lists what the rule would do now; more than 50 matches needs a second confirmation", () => {
  const r = rule({ action: "shelve", shelfId: "s1", enabled: false, previewedFor: "x" });
  const tabs = [anchor(), ...Array.from({ length: 63 }, (_, i) => t({ url: `https://news.example.com/${i}`, lastAccessed: NOW - (i < 4 ? 120 : 1) * MIN }))];
  const d = dryRunRule(r, tabs, [], settings({ rules: [r] }), NOW, { windows: [{ id: 1, type: "normal" }] });
  assert.equal(d.tabs.length, 4, "only the idle ones would be shelved now");
  assert.equal(d.matchCount, 63);
  assert.equal(LARGE_MATCH, 50);
  assert.deepEqual(dryRunUnlock(63, false), { unlocked: false, needsConfirm: true });
  assert.deepEqual(dryRunUnlock(63, true), { unlocked: true, needsConfirm: false });
  assert.deepEqual(dryRunUnlock(50, false), { unlocked: true, needsConfirm: false });
  const earlier = rule({ action: "never" });
  const d2 = dryRunRule(r, tabs, [], settings({ rules: [earlier, r] }), NOW, { windows: [{ id: 1, type: "normal" }] });
  assert.equal(d2.tabs.length, 0, "an earlier never rule wins in the dry run too");
});
