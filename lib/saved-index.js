(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function (root) {
  // Search everything saved (1.3): the palette's Saved section. The page builds this index in
  // memory on the first palette open of a page load (and again, debounced, when snapshots,
  // shelves or the recently closed list change); nothing of it is ever stored.
  const SAVED_LIMIT = 30;
  const OPEN_ALL_ASK = 20;

  const inNode = typeof module === "object" && module.exports;
  function dedupeApi() { return inNode ? require("./dedupe.js") : root.TabVault; }
  function searchApi() { return inNode ? require("./search.js") : root.TabVault; }
  function paletteApi() { return inNode ? require("./palette.js") : root.TabVault; }

  function defaultDate(ts) {
    return new Date(ts).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function defaultTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function indexable(url) {
    return /^(https?|file):/i.test(String(url || ""));
  }

  // sources: { snapshots: [{ id, takenAt, name, session }], shelves: [{ id, name, items }],
  // recent: [entries of lib/recent.js] }. Returns one entry per normalised URL, newest first:
  // { key, url, title, favIconUrl, at, where: { kind, id, label }, count } where count is how
  // many places hold it (a snapshot, a shelf or the recently closed list each count once).
  function buildSavedIndex(sources = {}, { ignoreHash = true, fmt = {} } = {}) {
    const { normalizeUrl } = dedupeApi();
    const fmtDate = fmt.date || defaultDate;
    const fmtTime = fmt.time || defaultTime;
    const byKey = new Map();
    const add = (place, t, at, label, kind, id) => {
      if (!indexable(t.url)) return;
      const key = normalizeUrl(t.url, { ignoreHash });
      const seen = place.seen;
      let e = byKey.get(key);
      if (!e) { e = { key, url: t.url, title: t.title || t.url, favIconUrl: t.favIconUrl || "", at, where: { kind, id, label }, count: 0 }; byKey.set(key, e); }
      else if (at > e.at) Object.assign(e, { url: t.url, title: t.title || t.url, favIconUrl: t.favIconUrl || e.favIconUrl, at, where: { kind, id, label } });
      if (!seen.has(key)) { seen.add(key); e.count++; }
    };
    for (const s of sources.snapshots || []) {
      if (!s || !s.session) continue;
      const place = { seen: new Set() };
      for (const w of s.session.windows || []) {
        const label = `snapshot ${s.name || fmtDate(s.takenAt)}${w.windowName ? " · " + w.windowName : ""}`;
        for (const t of w.tabs || []) add(place, t, s.takenAt, label, "snapshot", s.id);
      }
    }
    for (const sh of sources.shelves || []) {
      const place = { seen: new Set() };
      for (const it of sh.items || []) add(place, it, it.savedAt || 0, `shelf ${sh.name}`, "shelf", sh.id);
    }
    const recentPlace = { seen: new Set() };
    for (const r of sources.recent || []) add(recentPlace, r, r.closedAt || 0, `recently closed ${fmtTime(r.closedAt)}`, "recent", r.id);
    return [...byKey.values()].sort((a, b) => b.at - a.at);
  }

  // Every word must be in the title or the URL (the page's search rule); ranked by where the
  // words fall in the title, then newest first; at most `limit` rows.
  function searchSaved(index, query, { limit = SAVED_LIMIT } = {}) {
    const { terms, matches } = searchApi();
    const { textScore } = paletteApi();
    const words = terms(query);
    if (!words.length) return [];
    const rows = [];
    for (const entry of index || []) {
      if (!matches(entry, words)) continue;
      const score = Math.max(textScore(entry.title, words), textScore(entry.url, words) - 1, 0.5);
      rows.push({ kind: "saved", entry, score });
    }
    rows.sort((a, b) => b.score - a.score || b.entry.at - a.entry.at);
    return rows.slice(0, limit);
  }

  function openAllNeedsConfirm(n) {
    return n > OPEN_ALL_ASK;
  }

  return { SAVED_LIMIT, OPEN_ALL_ASK, buildSavedIndex, searchSaved, openAllNeedsConfirm };
});
