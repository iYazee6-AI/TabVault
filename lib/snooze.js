(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  // Snooze (1.7): a tab put away until a time, then opened again. Kept in chrome.storage.local
  // under "snoozed" (one array, the order of snoozing). Only the worker writes it (its snooze
  // queue), and every write is read back before a tab is closed, as shelves are (1.3). An entry
  // is "sleeping" until its tab was opened again (wokeAt and tabId set); a woken entry stays until
  // the user activates that tab or for WOKEN_KEEP_MS, so the weekly tidy can list the unseen ones.
  const SNOOZE_KEY = "snoozed";
  const HOUR = 3600000;
  const DAY = 24 * HOUR;
  const MIN_AHEAD_MS = 60000;
  const MAX_AHEAD_MS = 366 * DAY;
  const MAX_ATTEMPTS = 3; // failed wakes before an entry waits for Wake now
  const WOKEN_KEEP_MS = 7 * DAY;
  const CHOICES = ["later", "tomorrow", "nextWeek"];

  function randomId() {
    const bytes = new Uint8Array(6);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return "z" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // later: three hours on; tomorrow: the next day at the morning hour; nextWeek: the next Monday
  // at the morning hour (a week on when today is Monday). Local time. null for anything else.
  function wakeTimeFor(choice, now = Date.now(), { morningHour = 9 } = {}) {
    if (choice === "later") return now + 3 * HOUR;
    const d = new Date(now);
    if (choice === "tomorrow") {
      d.setDate(d.getDate() + 1);
    } else if (choice === "nextWeek") {
      const days = (8 - d.getDay()) % 7 || 7;
      d.setDate(d.getDate() + days);
    } else {
      return null;
    }
    d.setHours(morningHour, 0, 0, 0);
    return d.getTime();
  }

  function wakeError(ts, now = Date.now()) {
    if (typeof ts !== "number" || !Number.isFinite(ts)) return "Pick a date and time.";
    if (ts < now + MIN_AHEAD_MS) return "Pick a time at least a minute from now.";
    if (ts > now + MAX_AHEAD_MS) return "Pick a time within a year.";
    return null;
  }

  function snoozable(tab, ownPrefix) {
    if (!tab || tab.incognito) return false;
    const url = String(tab.url || tab.pendingUrl || "");
    if (ownPrefix && url.startsWith(ownPrefix)) return false;
    return /^(https?|file):/i.test(url);
  }

  // tabs: chrome tabs; groupsById: Map of chrome tab groups. Incognito tabs (nothing of them is
  // stored), TabVault's own pages and anything but http, https and file pages are skipped.
  function snoozeEntries(tabs, groupsById, { wakeAt, now = Date.now(), ownPrefix = "", run = null } = {}) {
    const entries = [];
    const tabIds = []; // tabIds[i]: the tab entries[i] was made from (the one to close)
    let skipped = 0;
    for (const t of tabs || []) {
      if (!snoozable(t, ownPrefix)) { skipped++; continue; }
      const g = typeof t.groupId === "number" && t.groupId >= 0 && groupsById ? groupsById.get(t.groupId) : null;
      const fav = String(t.favIconUrl || "");
      tabIds.push(t.id);
      entries.push({
        id: randomId(),
        url: String(t.url || t.pendingUrl || ""),
        title: String(t.title || "").slice(0, 500),
        favIconUrl: fav.startsWith("data:") && fav.length > 2048 ? "" : fav,
        pinned: Boolean(t.pinned),
        group: g ? { title: String(g.title || ""), color: String(g.color || "grey") } : null,
        windowId: typeof t.windowId === "number" ? t.windowId : null,
        index: typeof t.index === "number" ? t.index : 0,
        snoozedAt: now,
        run, // the browser run it was snoozed in: window ids mean nothing in another run
        wakeAt,
        attempts: 0,
        error: "",
      });
    }
    return { entries, skipped, tabIds };
  }

  function isSleeping(e) { return e && !e.wokeAt; }
  function sleeping(list) { return (list || []).filter(isSleeping); }
  function woken(list) { return (list || []).filter((e) => e && e.wokeAt); }

  function dueEntries(list, now = Date.now()) {
    return sleeping(list).filter((e) => e.wakeAt <= now && (e.attempts || 0) < MAX_ATTEMPTS);
  }

  function nextWakeAt(list) {
    let next = null;
    for (const e of sleeping(list)) {
      if ((e.attempts || 0) >= MAX_ATTEMPTS) continue;
      if (next === null || e.wakeAt < next) next = e.wakeAt;
    }
    return next;
  }

  // One bucket per window that is still open in the same browser run (window ids start again
  // with each run, so an id from an earlier run would be a stranger), in the order the entries
  // name them, then every
  // other entry in one bucket for a new window (windowId null). Pinned entries come first in a
  // bucket, since Chrome keeps pinned tabs at the left.
  function wakePlan(entries, liveWindowIds, run = null) {
    const live = liveWindowIds instanceof Set ? liveWindowIds : new Set(liveWindowIds || []);
    const buckets = new Map();
    const orphans = [];
    for (const e of entries || []) {
      if (run !== null && run !== undefined && e.run === run && live.has(e.windowId)) {
        if (!buckets.has(e.windowId)) buckets.set(e.windowId, []);
        buckets.get(e.windowId).push(e);
      } else {
        orphans.push(e);
      }
    }
    const pinnedFirst = (list) => [...list.filter((e) => e.pinned), ...list.filter((e) => !e.pinned)];
    const out = [...buckets].map(([windowId, list]) => ({ windowId, entries: pinnedFirst(list) }));
    if (orphans.length) out.push({ windowId: null, entries: pinnedFirst(orphans) });
    return out;
  }

  // results: [{ id, tabId }] of the entries whose tab was created.
  function markWoken(list, results, now = Date.now()) {
    const byId = new Map((results || []).map((r) => [r.id, r.tabId]));
    return (list || []).map((e) => (byId.has(e.id) ? { ...e, wokeAt: now, tabId: byId.get(e.id), error: "" } : e));
  }

  function markFailed(list, ids, error, now = Date.now()) {
    const set = new Set(ids || []);
    return (list || []).map((e) => (set.has(e.id) ? { ...e, attempts: (e.attempts || 0) + 1, error: String(error || "failed").slice(0, 200), failedAt: now } : e));
  }

  // The user activated a woken tab: its entry has done its job.
  function markSeen(list, tabId) {
    const out = (list || []).filter((e) => !(e.wokeAt && e.tabId === tabId));
    return { list: out, changed: out.length !== (list || []).length };
  }

  function pruneWoken(list, now = Date.now()) {
    return (list || []).filter((e) => !e.wokeAt || now - e.wokeAt <= WOKEN_KEEP_MS);
  }

  function reschedule(list, ids, wakeAt) {
    const set = new Set(ids || []);
    return (list || []).map((e) => (set.has(e.id) && isSleeping(e) ? { ...e, wakeAt, attempts: 0, error: "" } : e));
  }

  function removeEntries(list, ids) {
    const set = new Set(ids || []);
    return (list || []).filter((e) => !set.has(e.id));
  }

  function defaultWhen(ts) {
    return new Date(ts).toLocaleString([], { weekday: "short", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function snoozeLabel(e, fmt = defaultWhen) {
    return e.wokeAt ? `woke from snooze ${fmt(e.wokeAt)}` : `snoozed until ${fmt(e.wakeAt)}`;
  }

  async function readSnoozes(area) {
    const { [SNOOZE_KEY]: list = [] } = await area.get(SNOOZE_KEY);
    return Array.isArray(list) ? list : [];
  }

  // Writes the whole list and reads it back; throws when the stored list does not hold every id.
  async function writeSnoozes(area, list) {
    await area.set({ [SNOOZE_KEY]: list });
    const back = await readSnoozes(area);
    const have = new Set(back.map((e) => e && e.id));
    if (back.length !== list.length || !list.every((e) => have.has(e.id))) throw new Error("The snoozed tabs could not be read back, so nothing was closed.");
    return back;
  }

  async function appendSnoozes(area, entries) {
    const current = await readSnoozes(area);
    return writeSnoozes(area, [...current, ...(entries || [])]);
  }

  return { SNOOZE_KEY, CHOICES, MAX_ATTEMPTS, WOKEN_KEEP_MS, wakeTimeFor, wakeError, snoozeEntries, sleeping, woken, dueEntries, nextWakeAt, wakePlan, markWoken, markFailed, markSeen, pruneWoken, reschedule, removeEntries, snoozeLabel, readSnoozes, writeSnoozes, appendSnoozes };
});
