(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function (root) {
  // The weekly tidy (1.7): what to look at, in four sections, each tab in one section only
  // (woken snoozes, then duplicates, then tabs not visited for N days, then groups with one tab).
  // The page computes it from the session it already reads; the user ticks and acts. Kept pages
  // ("Keep") stay out for KEEP_MS. The worker keeps tidyState (when the last tidy was, when the
  // next one became due) in chrome.storage.local and checks it on its 5-minute tick.
  const DAY = 24 * 3600000;
  const WEEK = 7 * DAY;
  const KEEP_MS = 30 * DAY;
  const TIDY_LOG_CAP = 20;
  const TIDY_STATE_KEY = "tidyState";
  const TIDY_KEPT_KEY = "tidyKept";
  const TIDY_LOG_KEY = "tidyLog";

  const inNode = typeof module === "object" && module.exports;
  function dedupeApi() { return inNode ? require("./dedupe.js") : root.TabVault; }

  function keptKey(url, ignoreHash = true) {
    return dedupeApi().normalizeUrl(url, { ignoreHash });
  }

  function addKept(kept, urls, now = Date.now(), ignoreHash = true) {
    const out = { ...(kept || {}) };
    for (const u of urls || []) out[keptKey(u, ignoreHash)] = now;
    return out;
  }

  function pruneKept(kept, now = Date.now()) {
    const out = {};
    for (const [k, at] of Object.entries(kept || {})) if (typeof at === "number" && now - at < KEEP_MS) out[k] = at;
    return out;
  }

  function item(w, t, extra = {}) {
    return { tabId: t.id, windowId: w.id, url: t.url, title: t.title || t.url, favIconUrl: t.favIconUrl || "", lastAccessed: t.lastAccessed || null, groupId: t.groupId === undefined ? null : t.groupId, ...extra };
  }

  // Incognito windows and tabs are left out entirely, as snooze leaves them (nothing of them is
  // stored): they are never listed, never counted as another copy, never closed into the vault.
  function tidySections(session, { now = Date.now(), idleDays = 14, ignoreHash = true, kept = {}, woken = [], ownPrefix = "" } = {}) {
    const windows = ((session && session.windows) || [])
      .filter((w) => w && !w.incognito)
      .map((w) => ({ ...w, tabs: (w.tabs || []).filter((t) => t && !t.incognito) }));
    session = { ...(session || {}), windows };
    const listed = new Set();
    const isKept = (url) => {
      const at = (kept || {})[keptKey(url, ignoreHash)];
      return typeof at === "number" && now - at < KEEP_MS;
    };
    const own = (t) => ownPrefix && String(t.url || "").startsWith(ownPrefix);
    const byId = new Map();
    for (const w of windows) for (const t of w.tabs || []) byId.set(t.id, { w, t });

    const wokenOut = [];
    for (const e of woken || []) {
      if (!e || !e.wokeAt || !byId.has(e.tabId) || listed.has(e.tabId)) continue;
      const { w, t } = byId.get(e.tabId);
      listed.add(t.id);
      wokenOut.push(item(w, t, { entryId: e.id, wokeAt: e.wokeAt }));
    }

    const duplicates = [];
    for (const set of dedupeApi().findDuplicates(session, { ignoreHash })) {
      for (const { windowId, tab } of set.tabs) {
        if (tab.id === set.keepId || listed.has(tab.id) || tab.pinned || tab.active || own(tab) || isKept(tab.url)) continue;
        const w = windows.find((x) => x.id === windowId);
        listed.add(tab.id);
        duplicates.push(item(w, tab));
      }
    }

    const limit = idleDays * DAY;
    const stale = [];
    for (const w of windows) {
      for (const t of w.tabs || []) {
        if (listed.has(t.id) || t.pinned || t.active || t.audible || own(t) || typeof t.lastAccessed !== "number") continue;
        const idle = now - t.lastAccessed;
        if (idle < limit || isKept(t.url)) continue;
        stale.push(item(w, t, { days: Math.floor(idle / DAY) }));
      }
    }
    stale.sort((a, b) => a.lastAccessed - b.lastAccessed || a.tabId - b.tabId);
    for (const s of stale) listed.add(s.tabId);

    const lonely = [];
    for (const w of windows) {
      const counts = new Map();
      for (const t of w.tabs || []) if (t.groupId !== null && t.groupId !== undefined && t.groupId !== -1) counts.set(t.groupId, (counts.get(t.groupId) || 0) + 1);
      for (const [gid, n] of counts) {
        if (n !== 1) continue;
        const t = w.tabs.find((x) => x.groupId === gid);
        if (listed.has(t.id) || own(t) || isKept(t.url)) continue;
        const g = (w.groups || []).find((x) => x.id === gid) || { title: "", color: "grey" };
        listed.add(t.id);
        lonely.push(item(w, t, { group: { title: g.title || "", color: g.color || "grey" } }));
      }
    }
    return { woken: wokenOut, duplicates, stale, lonely };
  }

  // The worker's second guard before "Close into the vault": only tab ids that are open, not
  // incognito and not in an incognito window. tabs: chrome tabs; windows: chrome windows.
  function tidyClosable(tabIds, tabs, windows) {
    const byId = new Map((tabs || []).map((t) => [t.id, t]));
    const privateWindows = new Set((windows || []).filter((w) => w && w.incognito).map((w) => w.id));
    const ids = [];
    let refused = 0;
    let missing = 0;
    for (const id of tabIds || []) {
      const t = byId.get(id);
      if (!t) missing++;
      else if (t.incognito || privateWindows.has(t.windowId)) refused++;
      else ids.push(id);
    }
    return { ids, refused, missing };
  }

  function appendTidyLog(log, counts, now = Date.now()) {
    const entry = { at: now, closed: counts.closed || 0, snoozed: counts.snoozed || 0, kept: counts.kept || 0, ungrouped: counts.ungrouped || 0 };
    return [entry, ...(Array.isArray(log) ? log : [])].slice(0, TIDY_LOG_CAP);
  }

  function weekLine(log, now = Date.now()) {
    const sum = { closed: 0, snoozed: 0, kept: 0, ungrouped: 0 };
    for (const e of Array.isArray(log) ? log : []) {
      if (!e || now - e.at > WEEK) continue;
      for (const k of Object.keys(sum)) sum[k] += Number(e[k]) || 0;
    }
    const parts = [];
    if (sum.closed) parts.push(`${sum.closed} closed into the vault`);
    if (sum.snoozed) parts.push(`${sum.snoozed} snoozed`);
    if (sum.kept) parts.push(`${sum.kept} kept`);
    if (sum.ungrouped) parts.push(`${sum.ungrouped} ungrouped`);
    return parts.length ? `Tidied this week: ${parts.join(", ")}` : "Nothing tidied this week yet.";
  }

  // state: { lastAt, dueAt, notifiedAt } or nothing. The first look starts the week (no tidy is
  // due the moment 1.7 is installed); a week after lastAt it is due until the user tidies or says
  // Not now (tidyReset). changed: the state should be written back.
  function tidyDue(state, settings, now = Date.now()) {
    const s = state && typeof state === "object" ? state : null;
    if (!s || typeof s.lastAt !== "number") return { due: false, state: { lastAt: now }, changed: true };
    if (!(settings && settings.tidy && settings.tidy.weekly)) return { due: false, state: s, changed: false };
    if (now - s.lastAt < WEEK) return { due: false, state: s, changed: false };
    if (typeof s.dueAt === "number") return { due: true, state: s, changed: false };
    return { due: true, state: { ...s, dueAt: now }, changed: true };
  }

  function tidyReset(now = Date.now()) {
    return { lastAt: now };
  }

  function shouldNotify(state, settings, permitted) {
    if (!permitted || !(settings && settings.tidy && settings.tidy.notify && settings.tidy.weekly)) return false;
    if (!state || typeof state.dueAt !== "number") return false;
    return !(typeof state.notifiedAt === "number" && state.notifiedAt >= state.dueAt);
  }

  function tidyShelfName(now = Date.now()) {
    const d = new Date(now);
    const p = (n) => String(n).padStart(2, "0");
    return `Tidy ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  return { TIDY_STATE_KEY, TIDY_KEPT_KEY, TIDY_LOG_KEY, TIDY_LOG_CAP, KEEP_MS, keptKey, addKept, pruneKept, tidySections, tidyClosable, appendTidyLog, weekLine, tidyDue, tidyReset, shouldNotify, tidyShelfName };
});
