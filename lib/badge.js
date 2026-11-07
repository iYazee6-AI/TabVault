(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  // The toolbar icon badge. One colour for both browser themes: the console amber (--p light).
  const BADGE_COLOR = "#B7791F";
  const BADGE_TEXT_COLOR = "#FFFFFF";

  // tabs: chrome.tabs.query({}). TabVault's own pages are not counted, as on the page.
  function countForBadge(tabs, ownPrefix = "") {
    let total = 0;
    let unloaded = 0;
    for (const t of tabs || []) {
      const url = String(t.url || t.pendingUrl || "");
      if (ownPrefix && url.startsWith(ownPrefix)) continue;
      total++;
      if (t.discarded) unloaded++;
    }
    return { total, unloaded };
  }

  // mode: "total" (default), "unloaded" or "off". A zero unloaded count shows nothing; a count
  // past 999 reads "999+" (the badge has room for about four characters).
  function badgeText(mode, { total = 0, unloaded = 0 } = {}) {
    if (mode === "off") return "";
    const n = mode === "unloaded" ? unloaded : total;
    if (!n) return "";
    return n > 999 ? "999+" : String(n);
  }

  return { BADGE_COLOR, BADGE_TEXT_COLOR, countForBadge, badgeText };
});
