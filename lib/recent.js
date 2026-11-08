(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  // Recently closed tabs, kept locally under chrome.storage.local "recentlyClosed" (newest first,
  // at most 200). No `sessions` permission: the worker records what it already knows about a tab
  // when Chrome reports it closed. Entries closed together by a window close share a `batch`.
  const RECENT_KEY = "recentlyClosed";
  const RECENT_CAP = 200;
  const SKIP = ["chrome://", "chrome-untrusted://", "devtools://", "about:", "edge://", "view-source:"];

  function shouldRecord(url, ownPrefix = "") {
    const u = String(url || "");
    if (!u) return false;
    if (ownPrefix && u.startsWith(ownPrefix)) return false;
    return !SKIP.some((p) => u.startsWith(p));
  }

  function randomId() {
    const bytes = new Uint8Array(6);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // tab: { url, title, favIconUrl, windowId }. A data: favicon over 2 KB is dropped, as in sessions.
  // shelf: { id, name } when an idle rule or "Move to shelf" closed the tab after saving it there
  // (1.3): the entry is tagged rather than written twice.
  function closedEntry(tab, { groupTitle = "", closedAt = Date.now(), batch = "", shelf = null } = {}) {
    const fav = String(tab.favIconUrl || "");
    const entry = {
      id: randomId(),
      url: String(tab.url || ""),
      title: String(tab.title || "").slice(0, 500),
      favIconUrl: fav.startsWith("data:") && fav.length > 2048 ? "" : fav,
      windowId: typeof tab.windowId === "number" ? tab.windowId : null,
      groupTitle: String(groupTitle || ""),
      closedAt,
    };
    if (batch) entry.batch = batch;
    if (shelf && shelf.id) entry.shelf = { id: String(shelf.id), name: String(shelf.name || "") };
    return entry;
  }

  // entries: the newly closed ones, in the order they should read (newest batch first).
  function appendClosed(list, entries, cap = RECENT_CAP) {
    const old = Array.isArray(list) ? list : [];
    return [...(entries || []), ...old].slice(0, cap);
  }

  function removeEntries(list, ids) {
    const drop = new Set(ids || []);
    return (list || []).filter((e) => !drop.has(e.id));
  }

  // For the page: consecutive entries of one batch become one section; a lone entry is its own.
  function sections(list) {
    const out = [];
    for (const e of list || []) {
      const last = out[out.length - 1];
      if (e.batch && last && last.batch === e.batch) last.entries.push(e);
      else out.push({ batch: e.batch || "", entries: [e] });
    }
    return out;
  }

  return { RECENT_KEY, RECENT_CAP, shouldRecord, closedEntry, appendClosed, removeEntries, sections };
});
