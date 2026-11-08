(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function (root) {
  // Compare a snapshot with now (1.3): which saved tabs are missing, which open tabs are new
  // since, which moved to another window or group. Pure; the page reads the snapshot and the
  // live session and draws the three lists. Nothing is ever closed from it.
  function dedupeApi() {
    return (typeof module === "object" && module.exports) ? require("./dedupe.js") : root.TabVault;
  }

  // Web pages and local files only: chrome://, about:, data: and TabVault's own pages are ignored
  // on both sides (they cannot be reopened, or they are this page).
  function comparable(url, ownPrefix) {
    const u = String(url || "");
    if (ownPrefix && u.startsWith(ownPrefix)) return false;
    return /^(https?|file):/i.test(u);
  }

  function groupTitleOf(w, t) {
    if (t.groupId === null || t.groupId === undefined) return "";
    const g = (w.groups || []).find((x) => x.id === t.groupId);
    return g ? g.title || "(unnamed group)" : "";
  }

  function entries(session, opts) {
    const { normalizeUrl } = dedupeApi();
    return (session.windows || []).map((w, i) => ({
      id: w.id,
      name: w.windowName || "",
      label: w.windowName || `Window ${i + 1}`,
      tabs: (w.tabs || []).filter((t) => comparable(t.url, opts.ownPrefix)).map((t) => ({ tab: t, key: normalizeUrl(t.url, { ignoreHash: opts.ignoreHash }), groupTitle: groupTitleOf(w, t) })),
    }));
  }

  // Snapshot window id -> current window id (or null): by window name first, then by the
  // largest number of shared URLs, each current window used once.
  function matchWindows(snapWins, curWins) {
    const map = {};
    const used = new Set();
    for (const s of snapWins) {
      map[s.id] = null;
      if (!s.name) continue;
      const c = curWins.find((x) => x.name === s.name && !used.has(x.id));
      if (c) { map[s.id] = c.id; used.add(c.id); }
    }
    const pairs = [];
    for (const s of snapWins) {
      if (map[s.id] !== null) continue;
      const keys = new Set(s.tabs.map((x) => x.key));
      for (const c of curWins) {
        if (used.has(c.id)) continue;
        const overlap = new Set(c.tabs.map((x) => x.key).filter((k) => keys.has(k))).size;
        if (overlap) pairs.push({ s: s.id, c: c.id, overlap });
      }
    }
    pairs.sort((a, b) => b.overlap - a.overlap);
    for (const p of pairs) {
      if (map[p.s] !== null || used.has(p.c)) continue;
      map[p.s] = p.c;
      used.add(p.c);
    }
    return map;
  }

  // snapshot, current: sessions (lib/session.js shape). Returns
  //   missing: [{ tab, windowId, windowLabel, groupTitle, targetWindowId }]  saved, not open now
  //   added:   [{ tab, windowId, windowLabel, groupTitle }]                  open, not in the snapshot
  //   moved:   [{ tab, windowId, windowLabel, groupTitle, from: { windowId, windowLabel, groupTitle } }]
  //   windowMap: { [snapshot window id]: current window id or null }
  // URLs are compared normalised (the duplicate finder's rule) and by multiplicity.
  function diffSessions(snapshot, current, { ignoreHash = true, ownPrefix = "" } = {}) {
    const opts = { ignoreHash, ownPrefix };
    const snapWins = entries(snapshot || {}, opts);
    const curWins = entries(current || {}, opts);
    const windowMap = matchWindows(snapWins, curWins);
    const curLabel = new Map(curWins.map((w) => [w.id, w.label]));
    const buckets = new Map();
    for (const w of curWins) {
      for (const x of w.tabs) {
        if (!buckets.has(x.key)) buckets.set(x.key, []);
        buckets.get(x.key).push({ ...x, windowId: w.id, taken: false });
      }
    }
    const take = (key, pred) => {
      const list = buckets.get(key) || [];
      const hit = list.find((c) => !c.taken && pred(c));
      if (hit) hit.taken = true;
      return hit || null;
    };
    const pending = [];
    const moved = [];
    for (const w of snapWins) {
      const target = windowMap[w.id];
      for (const x of w.tabs) {
        const hit = target === null ? null : take(x.key, (c) => c.windowId === target);
        if (!hit) { pending.push({ w, x, target }); continue; }
        if (hit.groupTitle !== x.groupTitle) moved.push(movedEntry(hit, w, x));
      }
    }
    const missing = [];
    for (const { w, x, target } of pending) {
      const hit = take(x.key, () => true);
      if (hit) moved.push(movedEntry(hit, w, x));
      else missing.push({ tab: x.tab, windowId: w.id, windowLabel: w.label, groupTitle: x.groupTitle, targetWindowId: target });
    }
    const added = [];
    for (const list of buckets.values()) for (const c of list) if (!c.taken) added.push({ tab: c.tab, windowId: c.windowId, windowLabel: curLabel.get(c.windowId) || "", groupTitle: c.groupTitle });
    return { missing, added, moved, windowMap };

    function movedEntry(hit, w, x) {
      return { tab: hit.tab, windowId: hit.windowId, windowLabel: curLabel.get(hit.windowId) || "", groupTitle: hit.groupTitle, from: { windowId: w.id, windowLabel: w.label, groupTitle: x.groupTitle } };
    }
  }

  return { diffSessions };
});
