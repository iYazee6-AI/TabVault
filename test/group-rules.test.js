const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../lib/group-rules.js");
const { withDefaults, cleanGroupRule } = require("../lib/settings.js");

const rule = (id, over = {}) => ({ id, site: "github.com", titleWord: "", group: "Code", color: "blue", enabled: true, ...over });
const tab = (id, url, over = {}) => ({ id, windowId: 1, index: id, url, title: "", pinned: false, groupId: -1, incognito: false, ...over });

test("settings: groupRules default to [] and are cleaned; tidy settings get defaults", () => {
  const s = withDefaults({});
  assert.deepEqual(s.groupRules, []);
  assert.deepEqual(s.tidy, { weekly: true, idleDays: 14, notify: false });
  const t = withDefaults({ tidy: { weekly: false, idleDays: 5, notify: true } });
  assert.deepEqual(t.tidy, { weekly: false, idleDays: 14, notify: true });
  const r = withDefaults({ groupRules: [
    { id: "g1", site: " GitHub.com ", titleWord: "  pull ", group: " Code ", color: "pink", enabled: false },
    { id: "g2", site: "*.example.com", group: "Ex", color: "nope" },
    { id: "g3", site: "not a site", group: "X" },
    { id: "g4", site: "a.com", group: "" },
    { site: "b.com", group: "B" },
    "junk",
  ] }).groupRules;
  assert.deepEqual(r, [
    { id: "g1", site: "github.com", titleWord: "pull", group: "Code", color: "pink", enabled: false },
    { id: "g2", site: "*.example.com", titleWord: "", group: "Ex", color: "grey", enabled: true },
  ]);
  assert.equal(cleanGroupRule({ id: "x", site: "10.0.0.5", group: "LAN" }).site, "10.0.0.5");
});

test("a rule matches by site (www and subdomain forms) and by title word, first match wins", () => {
  const rules = [rule("a", { site: "github.com", titleWord: "pull", group: "Reviews" }), rule("b", { site: "github.com" }), rule("c", { site: "*.google.com", group: "Google" })];
  assert.equal(G.matchGroupRule(rules, tab(1, "https://github.com/x/pull/3", { title: "Fix: Pull request #3" })).id, "a");
  assert.equal(G.matchGroupRule(rules, tab(1, "https://www.github.com/x", { title: "Repo" })).id, "b");
  assert.equal(G.matchGroupRule(rules, tab(1, "https://docs.google.com/d/1")).id, "c");
  assert.equal(G.matchGroupRule(rules, tab(1, "https://google.com/")).id, "c");
  assert.equal(G.matchGroupRule(rules, tab(1, "https://gist.github.com/")), null);
  assert.equal(G.matchGroupRule(rules, tab(1, "chrome://newtab/")), null);
  assert.equal(G.matchGroupRule([rule("d", { enabled: false })], tab(1, "https://github.com/")), null);
  assert.equal(G.matchGroupRule([], tab(1, "https://github.com/")), null);
});

test("a rule never moves a pinned, grouped, incognito, popup or left-alone tab", () => {
  const rules = [rule("a")];
  const url = "https://github.com/";
  assert.equal(G.ruleTargetFor(tab(1, url), rules, { windowType: "normal" }).id, "a");
  assert.equal(G.ruleTargetFor(tab(1, url, { pinned: true }), rules, { windowType: "normal" }), null);
  assert.equal(G.ruleTargetFor(tab(1, url, { groupId: 4 }), rules, { windowType: "normal" }), null);
  assert.equal(G.ruleTargetFor(tab(1, url, { incognito: true }), rules, { windowType: "normal" }), null);
  assert.equal(G.ruleTargetFor(tab(1, url), rules, { windowType: "popup" }), null);
  assert.equal(G.ruleTargetFor(tab(1, url), rules, { windowType: "normal", leftAlone: { 1: "github.com" } }), null);
  assert.equal(G.ruleTargetFor(tab(2, url), rules, { windowType: "normal", leftAlone: { 1: "github.com" } }).id, "a");
});

test("left alone: taking a tab out of a group marks it; only a navigation to another site clears it", () => {
  let m = {};
  let r = G.leftAloneAfter(m, 5, { groupId: -1 }, tab(5, "https://github.com/a"));
  assert.equal(r.changed, true);
  m = r.map;
  assert.deepEqual(m, { 5: "github.com" });
  r = G.leftAloneAfter(m, 5, { url: "https://github.com/b" }, tab(5, "https://github.com/b"));
  assert.equal(r.changed, false); // same site: still left alone
  r = G.leftAloneAfter(m, 5, { url: "https://news.example.com/" }, tab(5, "https://news.example.com/"));
  assert.equal(r.changed, true);
  assert.deepEqual(r.map, {});
  // Joining a group, or another tab's change, leaves the map as it is.
  assert.equal(G.leftAloneAfter(m, 5, { groupId: 3 }, tab(5, "https://github.com/")).changed, false);
  assert.equal(G.leftAloneAfter(m, 6, { url: "https://x.com/" }, tab(6, "https://x.com/")).changed, false);
  // A tab taken out while on a page with no host (a New Tab) is cleared by its first web page.
  m = G.leftAloneAfter({}, 7, { groupId: -1 }, tab(7, "chrome://newtab/")).map;
  assert.deepEqual(m, { 7: "" });
  assert.deepEqual(G.leftAloneAfter(m, 7, { url: "https://github.com/" }, tab(7, "https://github.com/")).map, {});
  assert.deepEqual(G.forgetTab({ 7: "", 8: "x" }, 7), { 8: "x" });
});

test("the preview lists every tab that would move, and counts the ones left alone", () => {
  const windows = [
    { id: 1, type: "normal", incognito: false, tabs: [tab(1, "https://github.com/a", { title: "A" }), tab(2, "https://github.com/b", { pinned: true }), tab(3, "https://x.com/"), tab(4, "https://github.com/c", { groupId: 9 }), tab(5, "https://github.com/d")] },
    { id: 2, type: "popup", incognito: false, tabs: [tab(6, "https://github.com/e", { windowId: 2 })] },
    { id: 3, type: "normal", incognito: false, tabs: [tab(7, "https://docs.google.com/", { windowId: 3, title: "Doc" })] },
  ];
  const plan = G.planGroupRules(windows, [rule("a"), rule("b", { site: "*.google.com", group: "Docs", color: "green" })], { leftAlone: { 5: "github.com" } });
  assert.deepEqual(plan.moves.map((m) => [m.tabId, m.windowId, m.group, m.color, m.ruleId]), [[1, 1, "Code", "blue", "a"], [7, 3, "Docs", "green", "b"]]);
  assert.equal(plan.moves[0].title, "A");
  assert.equal(plan.moves[0].index, 1);
  assert.equal(plan.leftAlone, 1);
  assert.deepEqual(G.planGroupRules(windows, [], {}).moves, []);
});

test("an existing group of the same name in the window is joined", () => {
  const groups = [{ id: 3, windowId: 1, title: "Code", color: "red" }, { id: 4, windowId: 2, title: "Code", color: "blue" }];
  assert.equal(G.groupIdFor(groups, 1, "Code"), 3);
  assert.equal(G.groupIdFor(groups, 2, "Code"), 4);
  assert.equal(G.groupIdFor(groups, 5, "Code"), null);
  assert.equal(G.groupIdFor(groups, 1, "code"), null);
});

test("import merges new rules with fresh ids and skips the ones already there", () => {
  const current = [rule("a")];
  const r = G.mergeGroupRules(current, [{ id: "a", site: "github.com", titleWord: "", group: "Code", color: "red" }, { id: "zz", site: "news.example.com", group: "News", color: "orange" }, { site: "bad site", group: "x" }]);
  assert.equal(r.added, 1);
  assert.equal(r.rules.length, 2);
  assert.equal(r.rules[1].site, "news.example.com");
  assert.notEqual(r.rules[1].id, "zz");
  assert.ok(r.rules[1].id);
  assert.equal(G.mergeGroupRules(current, "junk").added, 0);
});
