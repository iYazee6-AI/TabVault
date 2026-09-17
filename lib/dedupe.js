(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  function normalizeUrl(url, { ignoreHash = true } = {}) {
    let u;
    try { u = new URL(url); } catch { return String(url || ""); }
    let path = u.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    const hash = ignoreHash ? "" : u.hash;
    return `${u.protocol}//${u.host}${path}${u.search}${hash}`;
  }

  // Groups tabs sharing a normalized URL; keepId is the most recently accessed tab (ties: active, then first).
  function findDuplicates(session, { ignoreHash = true } = {}) {
    const byUrl = new Map();
    for (const w of session.windows || []) {
      for (const tab of w.tabs) {
        if (!tab.url) continue;
        const key = normalizeUrl(tab.url, { ignoreHash });
        if (!byUrl.has(key)) byUrl.set(key, []);
        byUrl.get(key).push({ windowId: w.id, tab });
      }
    }
    const out = [];
    for (const [url, tabs] of byUrl) {
      if (tabs.length < 2) continue;
      const keep = tabs.reduce((best, cur) => {
        const b = best.tab, c = cur.tab;
        if ((c.lastAccessed || 0) > (b.lastAccessed || 0)) return cur;
        if ((c.lastAccessed || 0) === (b.lastAccessed || 0) && c.active && !b.active) return cur;
        return best;
      });
      out.push({ url, tabs, keepId: keep.tab.id });
    }
    return out;
  }

  return { normalizeUrl, findDuplicates };
});
