(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function (root) {
  // Group rules (1.7): "pages of this site (and, optionally, with this word in the title) go into
  // the group of this name". Stored in settings.groupRules (cleaned by lib/settings.js); checked
  // top to bottom, the first match wins. A rule only ever moves a tab that is in no group, is not
  // pinned, not incognito and sits in a normal window; and never a tab the user took out of a
  // group (the left-alone map, tab id to the host it had then) until it goes to another site.
  const inNode = typeof module === "object" && module.exports;
  function ruleApi() { return inNode ? require("./discard-rule.js") : root.TabVault; }
  function settingsApi() { return inNode ? require("./settings.js") : root.TabVault; }

  const LEFT_ALONE_KEY = "groupRulesLeftAlone"; // chrome.storage.session

  function ungrouped(tab) {
    return tab.groupId === undefined || tab.groupId === null || tab.groupId === -1;
  }

  function matchGroupRule(rules, tab) {
    const { hostOf, hostAllowed } = ruleApi();
    const host = hostOf(tab && (tab.url || tab.pendingUrl));
    if (!host) return null;
    const title = String((tab && tab.title) || "").toLowerCase();
    for (const r of rules || []) {
      if (!r || !r.enabled) continue;
      if (!hostAllowed(host, [r.site])) continue;
      if (r.titleWord && !title.includes(r.titleWord.toLowerCase())) continue;
      return r;
    }
    return null;
  }

  // The rule that should move this tab now, or null. windowType: the tab's window type.
  function ruleTargetFor(tab, rules, { leftAlone = {}, windowType = "normal" } = {}) {
    if (!tab || tab.pinned || tab.incognito || !ungrouped(tab)) return null;
    if (windowType !== "normal") return null;
    if (Object.prototype.hasOwnProperty.call(leftAlone || {}, String(tab.id))) return null;
    return matchGroupRule(rules, tab);
  }

  // After a tabs.onUpdated change: leaving a group marks the tab left alone (with its host then);
  // a navigation to another host forgets it. Returns { map, changed }; the map is a new object
  // when changed.
  function leftAloneAfter(map, tabId, changeInfo, tab) {
    const { hostOf } = ruleApi();
    const cur = map || {};
    const key = String(tabId);
    if (changeInfo && changeInfo.groupId === -1) {
      const host = hostOf(tab && tab.url);
      if (cur[key] === host) return { map: cur, changed: false };
      return { map: { ...cur, [key]: host }, changed: true };
    }
    if (changeInfo && changeInfo.url && Object.prototype.hasOwnProperty.call(cur, key) && hostOf(changeInfo.url) !== cur[key]) {
      return { map: forgetTab(cur, tabId), changed: true };
    }
    return { map: cur, changed: false };
  }

  function forgetTab(map, tabId) {
    const out = { ...(map || {}) };
    delete out[String(tabId)];
    return out;
  }

  // The preview of "Run rules on open tabs now": every tab of a normal window a rule would move,
  // and how many matched a rule but are left alone.
  function planGroupRules(windows, rules, { leftAlone = {} } = {}) {
    const moves = [];
    let alone = 0;
    if (!(rules || []).some((r) => r && r.enabled)) return { moves, leftAlone: 0 };
    for (const w of windows || []) {
      for (const t of w.tabs || []) {
        const tabLike = { ...t, incognito: t.incognito || w.incognito };
        const r = ruleTargetFor(tabLike, rules, { leftAlone, windowType: w.type || "normal" });
        if (r) {
          moves.push({ tabId: t.id, windowId: w.id, index: t.index, title: t.title || t.url, url: t.url, ruleId: r.id, group: r.group, color: r.color });
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(leftAlone || {}, String(t.id)) && ruleTargetFor(tabLike, rules, { windowType: w.type || "normal" })) alone++;
      }
    }
    return { moves, leftAlone: alone };
  }

  // The group of that exact name in that window, or null (a new one is made).
  function groupIdFor(groups, windowId, title) {
    const g = (groups || []).find((x) => x.windowId === windowId && (x.title || "") === title);
    return g ? g.id : null;
  }

  function ruleKey(r) {
    return `${r.site}|${(r.titleWord || "").toLowerCase()}|${r.group.toLowerCase()}`;
  }

  // Import (from a JSON export): rules not already there are added at the end with new ids.
  function mergeGroupRules(current, incoming) {
    const { cleanGroupRule, ruleId } = settingsApi();
    const rules = (current || []).slice();
    const have = new Set(rules.map(ruleKey));
    let added = 0;
    for (const raw of Array.isArray(incoming) ? incoming : []) {
      const r = cleanGroupRule({ ...(raw && typeof raw === "object" ? raw : {}), id: "x" });
      if (!r || have.has(ruleKey(r))) continue;
      have.add(ruleKey(r));
      rules.push({ ...r, id: ruleId() });
      added++;
    }
    return { rules, added };
  }

  return { LEFT_ALONE_KEY, matchGroupRule, ruleTargetFor, leftAloneAfter, forgetTab, planGroupRules, groupIdFor, mergeGroupRules };
});
