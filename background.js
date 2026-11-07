importScripts("lib/session.js", "lib/snapshots.js", "lib/settings.js", "lib/snapstore.js", "lib/badge.js", "lib/discard-rule.js", "lib/recent.js");

const PAGE_URL = chrome.runtime.getURL("app/index.html");
const OWN_PREFIX = chrome.runtime.getURL("");
const ALARM = "tabvault-snapshot";
const TV = self.TabVault;

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  return TV.withDefaults(settings);
}

// Snapshot storage version 2 (lib/snapstore.js): moved over once from 1.x's single "snapshots"
// key. Every snapshot read or write waits for this, so nothing sees a half-migrated store.
const ready = TV.migrate(chrome.storage.local).catch((e) => console.warn("TabVault storage migration failed", e));

// ---- open the page -------------------------------------------------------
async function openPage() {
  const existing = await chrome.tabs.query({ url: PAGE_URL + "*" });
  if (existing.length) {
    const t = existing[0];
    await chrome.tabs.update(t.id, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: PAGE_URL });
}

chrome.action.onClicked.addListener(() => { openPage().catch((e) => console.warn("TabVault open failed", e)); });
chrome.commands.onCommand.addListener((command) => { if (command === "open-tabvault") openPage().catch(() => {}); });

// ---- snapshots ------------------------------------------------------------
// All writes to `snapshots` go through this queue so bursts of changes cannot interleave.
let queue = ready;
function enqueue(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

async function captureSession() {
  const windows = await chrome.windows.getAll({ populate: true });
  const groups = chrome.tabGroups ? await chrome.tabGroups.query({}) : [];
  const info = await chrome.runtime.getPlatformInfo().catch(() => null);
  const version = (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || "";
  const { [self.TabVault.WINDOW_NAMES_KEY]: windowNames = {} } = await chrome.storage.local.get(self.TabVault.WINDOW_NAMES_KEY).catch(() => ({}));
  return self.TabVault.buildSession({ windows, groups, now: Date.now(), browser: { name: "Chrome", version, os: info && info.os }, excludeUrlPrefix: OWN_PREFIX, windowNames });
}

// opts.windowIds limits the snapshot to those windows; opts.name labels it; opts.pinned keeps it.
// Change and startup snapshots are skipped when nothing changed since the latest one.
async function takeSnapshot(reason, opts = {}) {
  return enqueue(async () => {
    let session = await captureSession();
    if (opts.windowIds) {
      const want = new Set(opts.windowIds);
      session = { ...session, windows: session.windows.filter((w) => want.has(w.id)) };
    }
    if (session.windows.length === 0) return { ok: true, skipped: true };
    const settings = await getSettings();
    if (reason === "change" || reason === "startup") {
      const latest = await TV.latestSnapshot(chrome.storage.local);
      if (latest && TV.isSameSession(latest.session, session)) return { ok: true, skipped: true };
    }
    const snap = TV.makeSnapshot(session, reason, Date.now(), opts.name || "");
    if (reason === "manual" || opts.pinned) snap.pinned = true;
    await TV.addSnapshot(chrome.storage.local, snap, settings.keepSnapshots);
    return { ok: true, id: snap.id, tabs: snap.tabs };
  });
}

// chrome.storage.session (Chrome 102+, no extra permission) tracks when the current
// run of changes started, so a steady stream of activity cannot re-arm the debounce
// forever: past a cap, the already-pending alarm is left to fire instead of being pushed out.
async function scheduleSnapshot() {
  const settings = await getSettings();
  const now = Date.now();
  const { pendingSince } = await chrome.storage.session.get("pendingSince");
  const args = { pendingSince, now, debounceSeconds: settings.debounceSeconds };
  let decision = TV.scheduleDecision(args);
  if (decision === "wait") {
    // Past the cap: leave the pending alarm to fire. If it is gone (the pendingSince clear in
    // onAlarm rejected after it fired), waiting would stop change snapshots for the session.
    const pending = await chrome.alarms.get(ALARM).catch(() => null);
    decision = TV.scheduleDecision({ ...args, alarmPending: Boolean(pending) });
  }
  if (decision === "wait") return;
  if (decision === "start") await chrome.storage.session.set({ pendingSince: now });
  const minutes = Math.max(0.5, settings.debounceSeconds / 60);
  await chrome.alarms.create(ALARM, { delayInMinutes: minutes }); // re-creating replaces the pending alarm
}

function onChange() { scheduleSnapshot().catch((e) => console.warn("TabVault schedule failed", e)); }

for (const ev of [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.windows.onCreated, chrome.windows.onRemoved]) ev.addListener(onChange);
// Title changes are deliberately not a trigger: live titles (counters, timers) would re-arm the debounce forever. Titles are captured on the next structural change.
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.pinned !== undefined || info.groupId !== undefined || info.mutedInfo !== undefined) onChange(); });
if (chrome.tabGroups) for (const ev of [chrome.tabGroups.onCreated, chrome.tabGroups.onRemoved, chrome.tabGroups.onUpdated, chrome.tabGroups.onMoved]) ev.addListener(onChange);
// A window rename is a user change, like a group rename: schedule a snapshot for it.
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes[self.TabVault.WINDOW_NAMES_KEY]) onChange(); });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM) return;
  chrome.storage.session.remove("pendingSince").catch(() => {})
    .then(() => takeSnapshot("change"))
    .catch((e) => console.warn("TabVault snapshot failed", e));
});
// Window ids reset with the browser, so names kept in storage.local from the last run would land on
// strangers: clear them before the startup snapshot. Snapshots keep the old names for restore.
chrome.runtime.onStartup.addListener(() => {
  self.TabVault.clearWindowNames(chrome.storage.local).catch(() => {})
    .then(() => takeSnapshot("startup"))
    .catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => {
  takeSnapshot("startup").catch(() => {});
});

// ---- badge ------------------------------------------------------------------
// The icon shows the tab count (or the unloaded count, or nothing: settings.badge). Updates are
// gated to one per 2 s; a gated call leaves one trailing update so a burst (ten tabs closed at
// once) still ends on the right number. The 5-minute idle alarm also refreshes it.
let badgeLastAt = 0;
let badgeTrailing = null;
async function refreshBadge() {
  const [settings, tabs] = await Promise.all([getSettings(), chrome.tabs.query({})]);
  await chrome.action.setBadgeText({ text: TV.badgeText(settings.badge, TV.countForBadge(tabs, OWN_PREFIX)) });
}
function scheduleBadge() {
  const now = Date.now();
  if (now - badgeLastAt >= 2000) {
    badgeLastAt = now;
    refreshBadge().catch((e) => console.warn("TabVault badge failed", e));
    return;
  }
  if (badgeTrailing) return;
  badgeTrailing = setTimeout(() => {
    badgeTrailing = null;
    badgeLastAt = Date.now();
    refreshBadge().catch((e) => console.warn("TabVault badge failed", e));
  }, 2000 - (now - badgeLastAt));
}
chrome.action.setBadgeBackgroundColor({ color: TV.BADGE_COLOR }).catch(() => {});
if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ color: TV.BADGE_TEXT_COLOR }).catch(() => {});
for (const ev of [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onReplaced]) ev.addListener(() => scheduleBadge());
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.discarded !== undefined || info.url) scheduleBadge(); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.settings) scheduleBadge(); });
scheduleBadge();

// ---- auto-discard idle tabs --------------------------------------------------
// One alarm every 5 minutes (MV3 workers cannot hold timers). Off by default; the rule is
// lib/discard-rule.js. Each run is recorded in storage.session so the Settings dialog can say
// when it last ran and what it unloaded. Nothing is ever closed. The same alarm refreshes the badge.
const IDLE_ALARM = "tabvault-idle";
const LAST_RUN_KEY = "autoDiscard.lastRun";

async function ensureIdleAlarm() {
  const existing = await chrome.alarms.get(IDLE_ALARM).catch(() => null);
  if (!existing) await chrome.alarms.create(IDLE_ALARM, { delayInMinutes: 5, periodInMinutes: 5 });
}

// The plan without acting on it (the e2e harness asserts on it; force runs ignore "enabled").
async function planAutoDiscard({ now = Date.now() } = {}) {
  const settings = await getSettings();
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ discarded: false, active: false, audible: false }),
    chrome.tabGroups ? chrome.tabGroups.query({}) : [],
  ]);
  return { settings, plan: TV.planDiscard(tabs, { settings: settings.autoDiscard, now, groups, ownPrefix: OWN_PREFIX }) };
}

let discardRunning = null;
// force: run even when the setting is off ("Discard idle tabs now" from the page).
function runAutoDiscard({ now = Date.now(), force = false } = {}) {
  if (discardRunning) return discardRunning;
  discardRunning = (async () => {
    const { settings, plan } = await planAutoDiscard({ now });
    if (!settings.autoDiscard.enabled && !force) return { ok: true, skipped: true };
    let unloaded = 0;
    let failed = 0;
    for (const id of plan.ids) {
      try {
        const tab = await chrome.tabs.discard(id);
        if (tab) unloaded++; else failed++;
      } catch {
        failed++;
      }
    }
    const lastRun = { at: Date.now(), unloaded, failed, waiting: plan.eligible - plan.ids.length, manual: Boolean(force) };
    await chrome.storage.session.set({ [LAST_RUN_KEY]: lastRun }).catch(() => {});
    scheduleBadge();
    return { ok: true, ...lastRun };
  })().finally(() => { discardRunning = null; });
  return discardRunning;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== IDLE_ALARM) return;
  scheduleBadge();
  runAutoDiscard().catch((e) => console.warn("TabVault auto-discard failed", e));
});
ensureIdleAlarm().catch(() => {});

// ---- recently closed -----------------------------------------------------------
// tabs.onRemoved carries no URL, so the worker keeps what it knows about each open tab in a
// memory cache (seeded at start, kept by tab events). A tab closed while the worker slept is
// looked up in the latest snapshot of this browser session instead. A tab closed on its own is
// appended at once; the tabs of a closing window are appended together on windows.onRemoved.
const tabCache = new Map();
const groupTitles = new Map();
const closingWindows = new Map();
const SESSION_START_KEY = "sessionStartedAt";

function cacheTab(t) {
  if (!t || typeof t.id !== "number") return;
  tabCache.set(t.id, { url: t.url || t.pendingUrl || "", title: t.title || "", favIconUrl: t.favIconUrl || "", windowId: t.windowId, groupId: t.groupId });
}
chrome.tabs.query({}).then((tabs) => { for (const t of tabs) if (!tabCache.has(t.id)) cacheTab(t); }).catch(() => {});
if (chrome.tabGroups) {
  chrome.tabGroups.query({}).then((gs) => { for (const g of gs) groupTitles.set(g.id, g.title || ""); }).catch(() => {});
  chrome.tabGroups.onCreated.addListener((g) => groupTitles.set(g.id, g.title || ""));
  chrome.tabGroups.onUpdated.addListener((g) => groupTitles.set(g.id, g.title || ""));
}
// Marks when this browser session began, so the snapshot fallback never matches a tab id
// from an earlier session (ids reset with the browser; storage.session is cleared with it).
chrome.storage.session.get(SESSION_START_KEY).then((r) => {
  if (r[SESSION_START_KEY] === undefined) return chrome.storage.session.set({ [SESSION_START_KEY]: Date.now() });
}).catch(() => {});
chrome.tabs.onCreated.addListener(cacheTab);
chrome.tabs.onUpdated.addListener((_id, _info, tab) => cacheTab(tab));
chrome.tabs.onAttached.addListener((id, info) => { const c = tabCache.get(id); if (c) c.windowId = info.newWindowId; });
chrome.tabs.onReplaced.addListener((added, removed) => {
  tabCache.delete(removed);
  chrome.tabs.get(added).then(cacheTab).catch(() => {});
});

let recentQueue = Promise.resolve();
function recentWrite(fn) {
  const run = recentQueue.then(fn);
  recentQueue = run.catch(() => {});
  return run;
}

async function appendRecent(entries) {
  const list = entries.filter((e) => e && TV.shouldRecord(e.url, OWN_PREFIX));
  if (!list.length) return;
  const settings = await getSettings();
  if (!settings.recordClosed) return;
  await recentWrite(async () => {
    const { [TV.RECENT_KEY]: current = [] } = await chrome.storage.local.get(TV.RECENT_KEY);
    await chrome.storage.local.set({ [TV.RECENT_KEY]: TV.appendClosed(current, list) });
  });
}

// What was known about a tab that just closed: the cache, else the latest snapshot taken in
// this browser session.
async function describeClosed(tabId, cached) {
  if (cached && cached.url) return { ...cached, groupTitle: groupTitles.get(cached.groupId) || "" };
  const [snap, started] = await Promise.all([
    TV.latestSnapshot(chrome.storage.local).catch(() => null),
    chrome.storage.session.get(SESSION_START_KEY).then((r) => r[SESSION_START_KEY], () => undefined),
  ]);
  if (!snap || started === undefined || snap.takenAt < started) return null;
  for (const w of snap.session.windows) {
    const t = w.tabs.find((x) => x.id === tabId);
    if (!t) continue;
    const g = t.groupId === null ? null : (w.groups || []).find((x) => x.id === t.groupId);
    return { url: t.url, title: t.title, favIconUrl: t.favIconUrl, windowId: w.id, groupTitle: g ? g.title : "" };
  }
  return null;
}

function flushClosingWindow(windowId) {
  const bucket = closingWindows.get(windowId);
  if (!bucket) return;
  closingWindows.delete(windowId);
  clearTimeout(bucket.timer);
  const closedAt = Date.now();
  Promise.all(bucket.items).then((infos) => {
    const batch = `w${windowId}-${closedAt}`;
    return appendRecent(infos.filter(Boolean).map((info) => TV.closedEntry(info, { groupTitle: info.groupTitle, closedAt, batch })));
  }).catch((e) => console.warn("TabVault recently-closed failed", e));
}

chrome.tabs.onRemoved.addListener((tabId, info) => {
  const cached = tabCache.get(tabId);
  tabCache.delete(tabId);
  const described = describeClosed(tabId, cached).catch(() => null);
  if (info && info.isWindowClosing) {
    let bucket = closingWindows.get(info.windowId);
    if (!bucket) {
      // windows.onRemoved normally flushes this; the timer covers a missed event.
      bucket = { items: [], timer: setTimeout(() => flushClosingWindow(info.windowId), 2000) };
      closingWindows.set(info.windowId, bucket);
    }
    bucket.items.push(described);
    return;
  }
  described.then((d) => (d ? appendRecent([TV.closedEntry(d, { groupTitle: d.groupTitle, closedAt: Date.now() })]) : null))
    .catch((e) => console.warn("TabVault recently-closed failed", e));
});
chrome.windows.onRemoved.addListener((windowId) => flushClosingWindow(windowId));

// ---- messages from the page ------------------------------------------------
function safeRespond(sendResponse, payload) { try { sendResponse(payload); } catch { /* page closed */ } }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return;
  const fromPage = sender && sender.id === chrome.runtime.id && typeof sender.url === "string" && sender.url.startsWith(OWN_PREFIX);
  if (!fromPage) return;
  const reply = (p) => safeRespond(sendResponse, p);
  const fail = (e) => reply({ ok: false, error: String((e && e.message) || e) });
  switch (msg.type) {
    case "snapshotNow": takeSnapshot("manual").then(reply, fail); return true;
    case "deleteSnapshot":
      enqueue(async () => { await TV.deleteSnapshot(chrome.storage.local, msg.id); return { ok: true }; }).then(reply, fail);
      return true;
    case "pinSnapshot":
      enqueue(async () => { await TV.pinSnapshot(chrome.storage.local, msg.id, msg.pinned); return { ok: true }; }).then(reply, fail);
      return true;
    case "openPage": openPage().then(() => reply({ ok: true }), fail); return true;
    case "discardIdleNow": runAutoDiscard({ force: true }).then(reply, fail); return true;
    case "recentRemove":
      recentWrite(async () => {
        const { [TV.RECENT_KEY]: current = [] } = await chrome.storage.local.get(TV.RECENT_KEY);
        await chrome.storage.local.set({ [TV.RECENT_KEY]: TV.removeEntries(current, Array.isArray(msg.ids) ? msg.ids : []) });
        return { ok: true };
      }).then(reply, fail);
      return true;
    case "recentClear":
      recentWrite(async () => { await chrome.storage.local.set({ [TV.RECENT_KEY]: [] }); return { ok: true }; }).then(reply, fail);
      return true;
    default: return;
  }
});
