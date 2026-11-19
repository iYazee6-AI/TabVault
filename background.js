importScripts("lib/session.js", "lib/snapshots.js", "lib/settings.js", "lib/snapstore.js", "lib/badge.js", "lib/discard-rule.js", "lib/recent.js", "lib/save-close.js", "lib/shelves.js", "lib/focus.js", "lib/bookmarks.js", "lib/dedupe.js", "lib/snooze.js", "lib/group-rules.js", "lib/tidy.js");

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
// A failed migration leaves storageReady false: snapshots still go on (migrate merges them in
// on the next try), but save and close refuses, since it closes tabs on the strength of a
// snapshot (see saveAndClose).
let storageReady = false;
function runMigration() {
  return getSettings().then((s) => TV.migrate(chrome.storage.local, s.keepSnapshots)).then(() => { storageReady = true; });
}
const ready = runMigration().catch((e) => console.warn("TabVault storage migration failed", e));

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

// sidePanel.open must run inside the user gesture (a click, a command, a menu item), so it is
// called synchronously from the handler and nothing is awaited before it. False: no panel API or
// no window to open it in.
function openPanelIn(windowId) {
  if (!chrome.sidePanel || typeof windowId !== "number") return false;
  chrome.sidePanel.open({ windowId }).catch((e) => console.warn("TabVault side panel failed", e));
  return true;
}

// ---- the toolbar button (1.5) ---------------------------------------------------
// settings.actionOpens: "page" (the default) or "panel" (lib/settings.js actionBehavior). With
// "panel", setPanelBehavior lets Chrome open the side panel itself inside the click's gesture, and
// Chrome then sends no action.onClicked; with "page" the behaviour is off and onClicked opens the
// page. Applied at every worker start (which covers install, update and browser startup), at
// onInstalled and onStartup, and whenever the stored setting changes. actionMode keeps the last
// applied setting so onClicked, should Chrome still send it, opens the panel without an await.
let actionMode = "page";
async function applyActionBehavior() {
  const b = TV.actionBehavior(await getSettings());
  actionMode = b.openPanelOnActionClick ? "panel" : "page";
  if (chrome.sidePanel) await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: b.openPanelOnActionClick });
  await chrome.action.setTitle({ title: b.title });
  return b;
}
self.applyActionBehavior = applyActionBehavior;
const applyAction = () => { applyActionBehavior().catch((e) => console.warn("TabVault toolbar setting failed", e)); };
chrome.action.onClicked.addListener((tab) => {
  if (actionMode === "panel" && openPanelIn(tab && tab.windowId)) return;
  openPage().catch((e) => console.warn("TabVault open failed", e));
});
// The side panel (the same page with ?panel=1) also opens from the page's menu, the palette, the
// toolbar button's right-click menu, or this command (bind it at chrome://extensions/shortcuts).
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "open-tabvault") openPage().catch(() => {});
  if (command === "focus-window") runFocusCommand(tab && typeof tab.windowId === "number" ? tab.windowId : undefined).catch((e) => console.warn("TabVault focus failed", e));
  if (command === "open-side-panel") openPanelIn(tab && tab.windowId);
});
if (chrome.sidePanel) {
  chrome.sidePanel.setOptions({ path: "app/index.html?panel=1", enabled: true }).catch(() => {});
}
applyAction();
chrome.runtime.onInstalled.addListener(applyAction);
chrome.runtime.onStartup.addListener(applyAction);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  const was = TV.withDefaults(changes.settings.oldValue).actionOpens;
  if (TV.withDefaults(changes.settings.newValue).actionOpens !== was) applyAction();
});

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
  const [settings, tabs, focus] = await Promise.all([getSettings(), chrome.tabs.query({}), getFocus()]);
  // Focus mode shows a dot instead of the count while it is on.
  await chrome.action.setBadgeText({ text: focus.on ? TV.FOCUS_BADGE : TV.badgeText(settings.badge, TV.countForBadge(tabs, OWN_PREFIX)) });
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

// ---- idle tabs: rules, unload and shelves (1.3) ------------------------------------
// One alarm every 5 minutes (MV3 workers cannot hold timers). lib/discard-rule.js planIdle
// decides: the first enabled rule whose site pattern matches a tab (unload, shelve or never),
// else the global Unload idle tabs setting (off by default). Unloads run first, then shelves;
// at most 25 a run. A tab is closed only by a shelving rule the user dry-ran and switched on, and
// only after its shelf write was read back (lib/shelves.js executeShelve). Each run is recorded
// in storage.session for the Settings line. The same alarm refreshes the badge.
const IDLE_ALARM = "tabvault-idle";
const LAST_RUN_KEY = "autoDiscard.lastRun";

// The e2e harness moves the idle clock forward through this (as scenario Z passes `now`);
// nothing in the extension sets it.
self.idleClockOffset = 0;
function idleNow() { return Date.now() + (Number(self.idleClockOffset) || 0); }

// Settings version for 1.3: the 1.2 allowlist becomes never rules, once (lib/settings.js).
const rulesReady = chrome.storage.local.get("settings").then(({ settings }) => {
  const m = TV.migrateIdleRules(settings || {});
  if (m.changed) return chrome.storage.local.set({ settings: m.settings });
}).catch((e) => console.warn("TabVault idle-rules migration failed", e));

// Every shelf write goes through this queue (the page only reads shelves).
let shelfQueue = Promise.resolve();
function shelfWrite(fn) {
  const run = shelfQueue.then(fn);
  shelfQueue = run.catch(() => {});
  return run;
}
// Bookmarks (1.6): every bookmark write (save as a folder, move to Deleted, a backup) goes through
// this queue, through lib/bookmarks.js only, and only while the Bookmarks setting is on and Chrome
// has granted the optional permission. lib/bookmarks.js never deletes a bookmark: a removal is a
// move into the "Deleted" folder.
let bookmarkQueue = Promise.resolve();
function bookmarkWrite(fn) {
  const run = bookmarkQueue.then(fn);
  bookmarkQueue = run.catch(() => {});
  return run;
}
async function bookmarkContext() {
  const settings = await getSettings();
  if (!settings.bookmarks) throw new Error("Bookmarks are off in TabVault's settings.");
  // The same check as the page: the permission can be withdrawn at chrome://extensions while the
  // setting stays on.
  if (!(await TV.bookmarksActive({ setting: settings.bookmarks, api: chrome.bookmarks, permissions: chrome.permissions }))) throw new Error("Chrome has not granted TabVault access to bookmarks.");
  return { api: TV.safeBookmarks(chrome.bookmarks), keep: settings.bookmarkBackupsKeep, version: chrome.runtime.getManifest().version };
}
function bookmarkMessage(msg) {
  return bookmarkWrite(async () => {
    const { api, keep, version } = await bookmarkContext();
    const area = chrome.storage.local;
    if (msg.type === "bmMoveToDeleted") {
      const ids = Array.isArray(msg.ids) ? msg.ids.map(String) : [];
      return { ok: true, ...(await TV.moveToDeleted(api, area, ids, { keep, version })) };
    }
    if (msg.type === "bmSaveFolder") {
      const tabs = (Array.isArray(msg.tabs) ? msg.tabs : []).map((t) => ({ url: String((t && t.url) || ""), title: String((t && t.title) || "") }));
      return { ok: true, ...(await TV.saveTabsAsFolder(api, area, { name: msg.name, tabs, keep, version })) };
    }
    if (msg.type === "bmBackup") {
      const { meta, nodes } = await TV.takeBackup(api, area, { reason: "manual", keep, version });
      return { ok: true, meta, nodes };
    }
    return { ok: false, error: "unknown bookmarks message" };
  });
}

// tab id -> { id, name } of the shelf it was just saved to: onRemoved tags its Recently closed entry.
const shelvedTabs = new Map();

async function ensureIdleAlarm() {
  const existing = await chrome.alarms.get(IDLE_ALARM).catch(() => null);
  if (!existing) await chrome.alarms.create(IDLE_ALARM, { delayInMinutes: 5, periodInMinutes: 5 });
}

async function idleInputs() {
  await rulesReady;
  const [settings, tabs, groups, windows, shelves] = await Promise.all([
    getSettings(),
    chrome.tabs.query({}),
    chrome.tabGroups ? chrome.tabGroups.query({}) : [],
    chrome.windows.getAll({}),
    TV.listShelves(chrome.storage.local).catch(() => []),
  ]);
  return { settings, tabs, groups, windows, shelfIds: new Set(shelves.map((s) => s.id)) };
}

// The plan without acting on it (the e2e harness asserts on it). force (default here, as in 1.2)
// applies the global unload setting even while it is off; rules apply whenever they are on.
async function planAutoDiscard({ now = idleNow(), force = true } = {}) {
  const input = await idleInputs();
  const plan = TV.planIdle(input.tabs, input.groups, input.settings, now, { ownPrefix: OWN_PREFIX, windows: input.windows, shelfIds: input.shelfIds, force });
  return { ...input, plan: { ...plan, ids: plan.unload } };
}

// Closes tabs after their shelf write; never the last tab of the last normal window (a New Tab
// is opened in that window first, as save and close does).
async function closeShelved(ids) {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const closing = new Set(ids);
  const left = windows.reduce((n, w) => n + (w.tabs || []).filter((t) => !closing.has(t.id)).length, 0);
  if (!left) {
    const w = windows.find((x) => (x.tabs || []).some((t) => closing.has(t.id)));
    if (w) await chrome.tabs.create({ windowId: w.id, active: true });
  }
  // One by one (lib/shelves.js closeEach): a tab the user closed meanwhile does not keep the rest open.
  await TV.closeEach(ids, (id) => chrome.tabs.remove(id));
}

async function shelveNow(picks, input) {
  if (!picks.length) return { shelved: 0, failed: 0 };
  const tabsById = new Map(input.tabs.map((t) => [t.id, t]));
  const groupsById = new Map(input.groups.map((g) => [g.id, g]));
  const marked = [];
  return shelfWrite(() => TV.executeShelve(chrome.storage.local, picks, {
    tabsById, groupsById, now: Date.now(),
    onSaved: (ids, shelf) => { for (const id of ids) { shelvedTabs.set(id, { id: shelf.id, name: shelf.name }); marked.push(id); } },
    removeTabs: (ids) => closeShelved(ids),
  })).finally(() => {
    // Entries whose onRemoved never came (the close failed) must not tag a later close.
    setTimeout(() => { for (const id of marked) shelvedTabs.delete(id); }, 10000);
  });
}

let discardRunning = null;
// The alarm and "Run idle rules now" (manual) apply the global setting only when it is on and
// the rules whenever they are on. force (the palette's "Discard idle tabs now", as in 1.2)
// applies the global setting even while it is off.
function runAutoDiscard({ now = idleNow(), force = false, manual = false } = {}) {
  if (discardRunning) return discardRunning;
  discardRunning = (async () => {
    const input = await idleInputs();
    const plan = TV.planIdle(input.tabs, input.groups, input.settings, now, { ownPrefix: OWN_PREFIX, windows: input.windows, shelfIds: input.shelfIds, force });
    if (!plan.eligible && !force && !manual) return { ok: true, skipped: true };
    let unloaded = 0;
    let failed = 0;
    for (const id of plan.unload) {
      try {
        const tab = await chrome.tabs.discard(id);
        if (tab) unloaded++; else failed++;
      } catch {
        failed++;
      }
    }
    const sh = await shelveNow(plan.shelve, input).catch(() => ({ shelved: 0, failed: plan.shelve.length }));
    failed += sh.failed;
    const lastRun = { at: Date.now(), unloaded, shelved: sh.shelved, failed, waiting: plan.waiting, manual: Boolean(force || manual) };
    await chrome.storage.session.set({ [LAST_RUN_KEY]: lastRun }).catch(() => {});
    scheduleBadge();
    return { ok: true, ...lastRun };
  })().finally(() => { discardRunning = null; });
  return discardRunning;
}
// Worker globals the e2e harness calls (planAutoDiscard, runAutoDiscard, runIdleRules).
self.planAutoDiscard = planAutoDiscard;
self.runIdleRules = runAutoDiscard;

// "Move to shelf…" from the page: the selected tabs, saved then closed (no rule involved).
async function shelveTabs({ tabIds, shelfId }) {
  const ids = (Array.isArray(tabIds) ? tabIds : []).map(Number).filter(Number.isInteger);
  if (!ids.length) return { ok: false, error: "no tab chosen" };
  const input = await idleInputs();
  if (!input.shelfIds.has(shelfId)) return { ok: false, error: "That shelf is gone." };
  const own = new Set(input.tabs.filter((t) => String(t.url || t.pendingUrl || "").startsWith(OWN_PREFIX)).map((t) => t.id));
  const picks = ids.filter((id) => !own.has(id)).map((id) => ({ id, shelfId, ruleId: null }));
  const r = await shelveNow(picks, input);
  return { ok: true, ...r };
}

async function idleDryRun(rule) {
  const input = await idleInputs();
  const r = TV.dryRunRule(rule, input.tabs, input.groups, input.settings, idleNow(), { ownPrefix: OWN_PREFIX, windows: input.windows, shelfIds: input.shelfIds });
  return { ok: true, matchCount: r.matchCount, action: r.action, tabs: r.tabs.map((t) => ({ id: t.id, title: t.title || "", url: t.url || "" })) };
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== IDLE_ALARM) return;
  scheduleBadge();
  runAutoDiscard().catch((e) => console.warn("TabVault idle rules failed", e));
  // 1.7: the same tick is the snooze fallback (a lost or missed snooze alarm wakes here) and the
  // weekly tidy's check.
  wakeDue().catch((e) => console.warn("TabVault snooze wake failed", e));
  tidyCheck().catch((e) => console.warn("TabVault tidy check failed", e));
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
    return appendRecent(infos.filter(Boolean).map((info) => TV.closedEntry(info, { groupTitle: info.groupTitle, closedAt, batch, shelf: info.shelf, snooze: info.snooze })));
  }).catch((e) => console.warn("TabVault recently-closed failed", e));
}

chrome.tabs.onRemoved.addListener((tabId, info) => {
  const cached = tabCache.get(tabId);
  tabCache.delete(tabId);
  // A tab an idle rule or "Move to shelf" just saved: its entry says which shelf (1.3).
  const shelf = shelvedTabs.get(tabId) || null;
  shelvedTabs.delete(tabId);
  // A tab just snoozed (1.7): its entry says until when.
  const snooze = snoozedTabs.get(tabId) || null;
  snoozedTabs.delete(tabId);
  const described = describeClosed(tabId, cached).catch(() => null).then((d) => (d && shelf ? { ...d, shelf } : d)).then((d) => (d && snooze ? { ...d, snooze } : d));
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
  described.then((d) => (d ? appendRecent([TV.closedEntry(d, { groupTitle: d.groupTitle, closedAt: Date.now(), shelf: d.shelf, snooze: d.snooze })]) : null))
    .catch((e) => console.warn("TabVault recently-closed failed", e));
});
chrome.windows.onRemoved.addListener((windowId) => flushClosingWindow(windowId));

// ---- save and close --------------------------------------------------------------
// The page has already confirmed with the count (never skipped). A kept snapshot of the chosen
// windows comes first; only the tabs it saved are closed (lib/save-close.js).
async function saveAndClose({ windowIds, name }) {
  const ids = (Array.isArray(windowIds) ? windowIds : []).map(Number).filter(Number.isInteger);
  if (!ids.length) return { ok: false, error: "no window chosen" };
  await ready;
  if (!storageReady) await enqueue(runMigration).catch((e) => console.warn("TabVault storage migration failed again", e));
  if (!storageReady) return { ok: false, error: "TabVault could not finish upgrading its snapshot storage, so nothing was saved or closed. Restart the browser and try again." };
  const saved = await takeSnapshot("save-close", { windowIds: ids, name, pinned: true });
  if (!saved.ok || saved.skipped) return { ok: true, skipped: true, closed: 0 };
  const snap = await TV.getSnapshot(chrome.storage.local, saved.id);
  const savedTabIds = snap.session.windows.flatMap((w) => w.tabs.map((t) => t.id));
  const all = await chrome.windows.getAll({ populate: true });
  const plan = TV.planSaveClose({ windows: all.map((w) => ({ id: w.id, tabIds: (w.tabs || []).map((t) => t.id) })), targetIds: ids, savedTabIds });
  if (plan.keepOpenWindowId !== null) await chrome.tabs.create({ windowId: plan.keepOpenWindowId, active: true });
  if (plan.tabIds.length) await chrome.tabs.remove(plan.tabIds);
  return { ok: true, closed: plan.count, snapshotId: saved.id };
}

// ---- focus mode (1.4) -----------------------------------------------------------------
// One window stays sharp; every tab of every other window gets a veil (app/focus-veil.js: a blur
// and a lift pill) through chrome.scripting, which needs the optional <all_urls> host permission.
// The page asks for it once (app/dialogs.js focus); without it the other windows are minimised
// instead. The state lives in storage.session (lib/focus.js FOCUS_KEY), so a worker restart keeps
// it; every write goes through focusWrite. Nothing is read from any page.
const FOCUS_MENU = "tabvault-focus";
const VEIL_FILE = "app/focus-veil.js";
let focusQueue = Promise.resolve();
function focusWrite(fn) {
  const run = focusQueue.then(fn);
  focusQueue = run.catch(() => {});
  return run;
}
async function getFocus() {
  const r = await chrome.storage.session.get(TV.FOCUS_KEY).catch(() => ({}));
  return r[TV.FOCUS_KEY] || TV.FOCUS_OFF;
}
async function setFocus(state) {
  await chrome.storage.session.set({ [TV.FOCUS_KEY]: state });
  chrome.contextMenus.update(FOCUS_MENU, { title: state.on ? "Lift the focus" : "Focus this window" }).catch(() => {});
  refreshBadge().catch(() => {});
}
// The e2e harness sets self.focusPermissionOverride to false to walk the declined path; nothing
// in the extension sets it.
async function canVeil() {
  if (self.focusPermissionOverride === false) return false;
  if (!chrome.scripting) return false;
  return chrome.permissions.contains({ origins: TV.FOCUS_ORIGINS }).catch(() => false);
}
// The veil's element name: a random custom-element name made once per install and kept in
// storage.local (so a later version can still find and remove the veils an earlier one drew),
// never an id a page could look for. lib/focus.js veilTagFrom builds it.
let veilTag = null;
async function getVeilTag() {
  if (veilTag) return veilTag;
  const { [TV.FOCUS_TAG_KEY]: stored } = await chrome.storage.local.get(TV.FOCUS_TAG_KEY).catch(() => ({}));
  if (TV.isVeilTag(stored)) return (veilTag = stored);
  veilTag = TV.veilTagFrom(crypto.getRandomValues(new Uint8Array(12)));
  await chrome.storage.local.set({ [TV.FOCUS_TAG_KEY]: veilTag }).catch(() => {});
  return veilTag;
}
async function veilTab(tabId) {
  try {
    const tag = await getVeilTag();
    // The tag goes into this extension's isolated world first; the page never sees it.
    await chrome.scripting.executeScript({ target: { tabId }, func: (t) => { globalThis.tabvaultVeilTag = t; }, args: [tag] });
    await chrome.scripting.executeScript({ target: { tabId }, files: [VEIL_FILE] });
    return true;
  } catch {
    return false; // a PDF viewer, an error page, a page that refuses: counted on the page
  }
}
async function unveilTab(tabId) {
  const tag = await getVeilTag();
  return chrome.scripting.executeScript({
    target: { tabId },
    func: (t) => { for (const h of document.querySelectorAll(t)) h.remove(); globalThis.tabvaultVeil = null; },
    args: [tag],
  }).catch(() => {});
}

async function startVeil(windowId) {
  const windows = await chrome.windows.getAll({ populate: true });
  const plan = TV.planVeil(windows, windowId, OWN_PREFIX);
  const results = await Promise.all(plan.veil.map((id) => veilTab(id).then((ok) => ({ id, ok }))));
  const skipped = plan.skip.concat(results.filter((r) => !r.ok).map((r) => r.id));
  const state = TV.startState(windowId, "veil", Date.now());
  await setFocus(skipped.reduce((s, id) => TV.withSkipped(s, id, true), state));
  return { ok: true, mode: "veil", veiled: results.filter((r) => r.ok).length, skipped: skipped.length, waiting: plan.unloaded.length };
}
async function startMinimize(windowId) {
  const windows = await chrome.windows.getAll({});
  const plan = TV.minimizePlan(windows, windowId);
  for (const w of plan) await chrome.windows.update(w.id, { state: "minimized" }).catch(() => {});
  await chrome.windows.update(windowId, { focused: true }).catch(() => {});
  await setFocus(TV.startState(windowId, "minimize", Date.now(), { minimized: plan }));
  return { ok: true, mode: "minimize", minimized: plan.length };
}
async function liftNow() {
  const state = await getFocus();
  if (!state.on) return { ok: true, lifted: false };
  await setFocus(TV.FOCUS_OFF);
  if (state.mode === "minimize") {
    for (const w of state.minimized || []) await chrome.windows.update(w.id, { state: w.state }).catch(() => {});
    await chrome.windows.update(state.windowId, { focused: true }).catch(() => {});
  } else if (chrome.scripting) {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.filter((t) => TV.isVeilable(t.url)).map((t) => unveilTab(t.id)));
  }
  return { ok: true, lifted: true };
}
function liftFocus() { return focusWrite(liftNow); }

// mode: "veil", "minimize", or undefined to decide here: the veil when the permission is
// granted, the minimise fallback when the user chose it, else "ask" (the caller opens the page).
function startFocus(windowId, mode) {
  return focusWrite(async () => {
    if (typeof windowId !== "number") return { ok: false, error: "no window to focus" };
    await liftNow();
    if (mode === undefined) {
      if (await canVeil()) mode = "veil";
      else {
        const { [TV.FOCUS_FALLBACK_KEY]: fallback } = await chrome.storage.local.get(TV.FOCUS_FALLBACK_KEY).catch(() => ({}));
        if (fallback !== "minimize") return { ok: true, ask: true };
        mode = "minimize";
      }
    }
    if (mode === "veil" && !(await canVeil())) return { ok: false, error: "Focus mode needs the permission to draw on your other windows" };
    return mode === "minimize" ? startMinimize(windowId) : startVeil(windowId);
  });
}

// The command: from the shortcut, the toolbar menu or the page. The same window lifts the focus,
// another window moves it there; the first use without the permission opens the page's question
// in that window. The e2e harness calls it as self.runFocusCommand.
async function runFocusCommand(windowId) {
  if (typeof windowId !== "number") {
    const w = await chrome.windows.getLastFocused().catch(() => null);
    windowId = w ? w.id : undefined;
  }
  const action = TV.focusCommand(await getFocus(), windowId);
  if (action === "lift") return liftFocus();
  const r = await startFocus(windowId);
  if (r && r.ask) await chrome.tabs.create({ windowId, url: `${PAGE_URL}?focus=${windowId}`, active: true });
  return r;
}
self.runFocusCommand = runFocusCommand;
self.liftFocus = liftFocus;

// A tab that loads, opens or moves while the veil is on gets it (another window) or loses it
// (the focused window); one that cannot take it is counted.
function onFocusTab(tab) {
  if (!tab || typeof tab.id !== "number") return;
  focusWrite(async () => {
    const state = await getFocus();
    if (!state.on || state.mode !== "veil") return;
    const win = tab.windowId === state.windowId ? null : await chrome.windows.get(tab.windowId).catch(() => null);
    const action = TV.tabAction(state, tab, OWN_PREFIX, win);
    if (action === "none") return;
    if (action === "unveil") {
      await unveilTab(tab.id);
      if ((state.skipped || []).includes(tab.id)) await setFocus(TV.withSkipped(state, tab.id, false));
      return;
    }
    const ok = action === "veil" ? await veilTab(tab.id) : false;
    const was = (state.skipped || []).includes(tab.id);
    if (was === !ok) return;
    await setFocus(TV.withSkipped(state, tab.id, !ok));
  }).catch(() => {});
}
chrome.tabs.onCreated.addListener((tab) => { if (tab.status === "complete") onFocusTab(tab); });
chrome.tabs.onUpdated.addListener((_id, info, tab) => { if (info.status === "complete") onFocusTab(tab); });
chrome.tabs.onAttached.addListener((id) => { chrome.tabs.get(id).then(onFocusTab, () => {}); });
chrome.tabs.onRemoved.addListener((id) => {
  focusWrite(async () => {
    const state = await getFocus();
    if (state.on && (state.skipped || []).includes(id)) await setFocus(TV.withSkipped(state, id, false));
  }).catch(() => {});
});
chrome.windows.onRemoved.addListener((windowId) => {
  focusWrite(async () => {
    const state = await getFocus();
    if (state.on && state.windowId === windowId) await liftNow();
  }).catch(() => {});
});
// The user took the permission back: the veils cannot be lifted from here any more (each pill
// still removes its own), so the state is cleared.
chrome.permissions.onRemoved.addListener(() => {
  focusWrite(async () => {
    const state = await getFocus();
    if (state.on && state.mode === "veil" && !(await canVeil())) await setFocus(TV.FOCUS_OFF);
  }).catch(() => {});
});

// The toolbar button's right-click menu (1.5): open the side panel, open the full page, whatever
// the toolbar setting says; then Focus mode's item (1.4).
const MENU_PANEL = "tabvault-open-panel";
const MENU_PAGE = "tabvault-open-page";
function createActionMenu() {
  chrome.contextMenus.removeAll(() => {
    const quiet = () => { void chrome.runtime.lastError; }; // a second create during a quick reload: the item is there already
    chrome.contextMenus.create({ id: MENU_PANEL, title: "Open in side panel", contexts: ["action"] }, quiet);
    chrome.contextMenus.create({ id: MENU_PAGE, title: "Open full page", contexts: ["action"] }, quiet);
    chrome.contextMenus.create({ id: FOCUS_MENU, title: "Focus this window", contexts: ["action"] }, () => {
      void chrome.runtime.lastError; // a second create during a quick reload: the item is there already
      getFocus().then((s) => { if (s.on) chrome.contextMenus.update(FOCUS_MENU, { title: "Lift the focus" }).catch(() => {}); }, () => {});
    });
  });
}
// An update or a reload while the focus is on drops the worker's state but not the veils already
// drawn in the pages (each pill would lift only its own), and a restored browser session may carry
// a stale state: so at install, update, reload and startup the state is cleared and every veil in
// every tab the permission reaches is removed (found by the install's element name, which
// storage.local keeps across versions). The e2e harness calls it as self.focusSweep.
function focusSweep() {
  return focusWrite(async () => {
    await setFocus(TV.FOCUS_OFF).catch(() => {});
    if (!(await canVeil())) return { ok: true, swept: 0 };
    const tabs = await chrome.tabs.query({});
    const reach = tabs.filter((t) => TV.isVeilable(t.url));
    await Promise.all(reach.map((t) => unveilTab(t.id)));
    return { ok: true, swept: reach.length };
  });
}
self.focusSweep = focusSweep;
chrome.runtime.onInstalled.addListener(() => { createActionMenu(); focusSweep().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { createActionMenu(); focusSweep().catch(() => {}); });
// sidePanel.open is called synchronously here (the menu click's gesture). The e2e harness calls it
// as self.onActionMenu; the return value names what was done.
function onActionMenu(info, tab) {
  const windowId = tab && typeof tab.windowId === "number" ? tab.windowId : undefined;
  if (info.menuItemId === MENU_PANEL) {
    if (openPanelIn(windowId)) return "panel";
    console.warn("TabVault side panel failed: no window");
    return "none";
  }
  if (info.menuItemId === MENU_PAGE) {
    openPage().catch((e) => console.warn("TabVault open failed", e));
    return "page";
  }
  if (info.menuItemId === FOCUS_MENU) {
    runFocusCommand(windowId).catch((e) => console.warn("TabVault focus failed", e));
    return "focus";
  }
  return "none";
}
self.onActionMenu = onActionMenu;
chrome.contextMenus.onClicked.addListener(onActionMenu);

// ---- snooze (1.7) -------------------------------------------------------------------
// A tab put away until a time (lib/snooze.js). The list lives in storage.local "snoozed" and
// every write goes through snoozeWrite; the entries are written and read back before any tab is
// closed. One alarm is set to the earliest wake time; the worker also wakes what is due at every
// start, at browser startup and on the 5-minute idle tick, so a wake missed while the browser
// was closed or an alarm that was lost still happens. An entry is marked woken only after its
// tab exists; a failed wake stays listed with its error and is tried again.
const SNOOZE_ALARM = "tabvault-snooze";
let snoozeQueue = Promise.resolve();
function snoozeWrite(fn) {
  const run = snoozeQueue.then(fn);
  snoozeQueue = run.catch(() => {});
  return run;
}
// The e2e harness moves the snooze clock forward through this; nothing in the extension sets it.
self.snoozeClockOffset = 0;
function snoozeNow() { return Date.now() + (Number(self.snoozeClockOffset) || 0); }
// tab id -> { wakeAt } of a tab just snoozed: onRemoved tags its Recently closed entry.
const snoozedTabs = new Map();
// Tabs a wake just created: Chrome may report them activated (the first tab of a new window),
// which is not the user looking at them.
const wakingTabs = new Set();
// Tab ids of woken entries, so tabs.onActivated reads storage only when it matters.
let wokenTabIds = new Set();
function rememberWoken(list) { wokenTabIds = new Set(TV.woken(list).map((e) => e.tabId)); }

async function armSnoozeAlarm(list) {
  const next = TV.nextWakeAt(list);
  if (next === null) { await chrome.alarms.clear(SNOOZE_ALARM).catch(() => {}); return; }
  const when = Math.max(Date.now() + 1000, next - (Number(self.snoozeClockOffset) || 0));
  await chrome.alarms.create(SNOOZE_ALARM, { when });
}

async function snoozeTabs({ tabIds, wakeAt }) {
  const ids = (Array.isArray(tabIds) ? tabIds : []).map(Number).filter(Number.isInteger);
  if (!ids.length) return { ok: false, error: "no tab chosen" };
  const at = Number(wakeAt);
  const err = TV.wakeError(at, snoozeNow());
  if (err) return { ok: false, error: err };
  const tabs = (await Promise.all(ids.map((id) => chrome.tabs.get(id).catch(() => null)))).filter(Boolean);
  const groups = chrome.tabGroups ? await chrome.tabGroups.query({}) : [];
  const made = TV.snoozeEntries(tabs, new Map(groups.map((g) => [g.id, g])), { wakeAt: at, now: Date.now(), ownPrefix: OWN_PREFIX });
  const skipped = made.skipped + (ids.length - tabs.length);
  if (!made.entries.length) return { ok: true, snoozed: 0, skipped };
  // Written and read back first: a failed write closes nothing.
  await snoozeWrite(async () => {
    const list = await TV.appendSnoozes(chrome.storage.local, made.entries);
    await armSnoozeAlarm(list);
  });
  made.tabIds.forEach((id) => snoozedTabs.set(id, { wakeAt: at }));
  setTimeout(() => { for (const id of made.tabIds) snoozedTabs.delete(id); }, 10000);
  await closeShelved(made.tabIds);
  return { ok: true, snoozed: made.entries.length, skipped, wakeAt: at };
}

// Opens one bucket of the wake plan: into its window, or (windowId null) into one new window.
// Pinned and group state come back; a group of the same name and colour is joined.
async function openSnoozeBucket(bucket) {
  const out = { woke: [], failed: [], error: "" };
  let windowId = bucket.windowId;
  const groups = windowId !== null && chrome.tabGroups ? await chrome.tabGroups.query({ windowId }).catch(() => []) : [];
  const made = new Map();
  for (const e of bucket.entries) {
    let tab;
    try {
      if (windowId === null) {
        const w = await chrome.windows.create({ url: e.url, focused: false });
        windowId = w.id;
        tab = (w.tabs && w.tabs[0]) || (await chrome.tabs.query({ windowId }))[0];
        if (e.pinned) await chrome.tabs.update(tab.id, { pinned: true }).catch(() => {});
      } else {
        tab = await chrome.tabs.create({ windowId, url: e.url, active: false, pinned: e.pinned });
      }
    } catch (err) {
      out.failed.push(e.id);
      out.error = String((err && err.message) || err);
      continue;
    }
    wakingTabs.add(tab.id);
    setTimeout(() => wakingTabs.delete(tab.id), 5000);
    out.woke.push({ id: e.id, tabId: tab.id });
    if (!e.group || e.pinned || !chrome.tabGroups) continue;
    // The tab is back; a group that cannot be made is not a reason to open it twice.
    try {
      const key = `${e.group.title}|${e.group.color}`;
      let gid = made.get(key);
      if (gid === undefined) {
        const hit = groups.find((g) => (g.title || "") === e.group.title && g.color === e.group.color);
        gid = hit ? hit.id : null;
      }
      if (gid !== null) await chrome.tabs.group({ tabIds: [tab.id], groupId: gid });
      else {
        gid = await chrome.tabs.group({ tabIds: [tab.id], createProperties: { windowId } });
        await chrome.tabGroups.update(gid, { title: e.group.title, color: e.group.color });
      }
      made.set(key, gid);
    } catch (err) {
      console.warn("TabVault snooze: the group could not be made again", err);
    }
  }
  return out;
}

// ids: wake these now (Wake now, the palette); otherwise every entry that is due.
function wakeDue({ ids = null, now = snoozeNow() } = {}) {
  return snoozeWrite(async () => {
    const area = chrome.storage.local;
    const stored = await TV.readSnoozes(area);
    let list = TV.pruneWoken(stored, now);
    const want = Array.isArray(ids) ? new Set(ids.map(String)) : null;
    const pick = want ? TV.sleeping(list).filter((e) => want.has(e.id)) : TV.dueEntries(list, now);
    if (pick.length) {
      const windows = await chrome.windows.getAll({ windowTypes: ["normal"] }).catch(() => []);
      const live = new Set(windows.filter((w) => !w.incognito).map((w) => w.id));
      const woke = [];
      const failed = [];
      let error = "";
      for (const bucket of TV.wakePlan(pick, live)) {
        const r = await openSnoozeBucket(bucket);
        woke.push(...r.woke);
        failed.push(...r.failed);
        if (r.error) error = r.error;
      }
      list = TV.markWoken(list, woke, Date.now());
      if (failed.length) list = TV.markFailed(list, failed, error, Date.now());
      await TV.writeSnoozes(area, list);
      rememberWoken(list);
      await armSnoozeAlarm(list);
      return { ok: true, woke: woke.length, failed: failed.length, error };
    }
    if (list.length !== stored.length) await TV.writeSnoozes(area, list);
    rememberWoken(list);
    await armSnoozeAlarm(list);
    return { ok: true, woke: 0, failed: 0 };
  });
}
self.wakeDueSnoozes = wakeDue;

function snoozeEdit(change) {
  return snoozeWrite(async () => {
    const area = chrome.storage.local;
    const list = change(await TV.readSnoozes(area));
    if (list.error) return { ok: false, error: list.error };
    const back = await TV.writeSnoozes(area, list);
    rememberWoken(back);
    await armSnoozeAlarm(back);
    return { ok: true };
  });
}
function snoozeReschedule({ ids, wakeAt }) {
  const at = Number(wakeAt);
  const err = TV.wakeError(at, snoozeNow());
  if (err) return Promise.resolve({ ok: false, error: err });
  return snoozeEdit((list) => TV.reschedule(list, (Array.isArray(ids) ? ids : []).map(String), at));
}
// Cancel forgets the snooze without opening the tab (it is still in Recently closed).
function snoozeCancel({ ids }) {
  return snoozeEdit((list) => TV.removeEntries(list, (Array.isArray(ids) ? ids : []).map(String)));
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (!wokenTabIds.has(tabId) || wakingTabs.has(tabId)) return;
  snoozeWrite(async () => {
    const r = TV.markSeen(await TV.readSnoozes(chrome.storage.local), tabId);
    if (r.changed) await TV.writeSnoozes(chrome.storage.local, r.list);
    rememberWoken(r.list);
  }).catch(() => {});
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SNOOZE_ALARM) wakeDue().catch((e) => console.warn("TabVault snooze wake failed", e));
});
chrome.runtime.onStartup.addListener(() => { wakeDue().catch(() => {}); });
// Every worker start (install, update, browser start, a wake from sleep): what is due wakes now.
wakeDue().catch((e) => console.warn("TabVault snooze wake failed", e));

// ---- group rules (1.7) -------------------------------------------------------------------
// settings.groupRules (lib/group-rules.js): a tab that navigates to a matching page and is in no
// group, not pinned, not incognito and in a normal window goes into the group of the rule's
// name in its window. A tab the user takes out of a group is left alone (storage.session
// groupRulesLeftAlone, tab id to its host then) until it navigates to another site.
let leftAloneCache = null;
async function getLeftAlone() {
  if (leftAloneCache) return leftAloneCache;
  const r = await chrome.storage.session.get(TV.LEFT_ALONE_KEY).catch(() => ({}));
  leftAloneCache = r[TV.LEFT_ALONE_KEY] && typeof r[TV.LEFT_ALONE_KEY] === "object" ? r[TV.LEFT_ALONE_KEY] : {};
  return leftAloneCache;
}
async function setLeftAlone(map) {
  leftAloneCache = map;
  await chrome.storage.session.set({ [TV.LEFT_ALONE_KEY]: map }).catch(() => {});
}
let rulesQueue = Promise.resolve();
function rulesWrite(fn) {
  const run = rulesQueue.then(fn);
  rulesQueue = run.catch(() => {});
  return run;
}

async function groupInto(tab, rule) {
  const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
  const gid = TV.groupIdFor(groups, tab.windowId, rule.group);
  if (gid !== null) { await chrome.tabs.group({ tabIds: [tab.id], groupId: gid }); return gid; }
  const made = await chrome.tabs.group({ tabIds: [tab.id], createProperties: { windowId: tab.windowId } });
  await chrome.tabGroups.update(made, { title: rule.group, color: rule.color });
  return made;
}

// Reads the tab again (it may have moved or been grouped since the event) and groups it when a
// rule says so. Chrome refuses edits while the user drags a tab: one more try a moment later.
async function applyGroupRule(tabId, rules, leftAlone, retry = true) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return null;
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  if (!win) return null;
  const rule = TV.ruleTargetFor({ ...tab, incognito: tab.incognito || win.incognito }, rules, { leftAlone, windowType: win.type });
  if (!rule) return null;
  try {
    return await groupInto(tab, rule);
  } catch (e) {
    if (!retry) throw e;
    await new Promise((r) => setTimeout(r, 1500));
    return applyGroupRule(tabId, rules, await getLeftAlone(), false);
  }
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.groupId === undefined && !info.url) return;
  rulesWrite(async () => {
    let map = await getLeftAlone();
    const r = TV.leftAloneAfter(map, tabId, info, tab);
    if (r.changed) { map = r.map; await setLeftAlone(map); }
    if (!info.url || !chrome.tabGroups) return;
    const settings = await getSettings();
    if (!settings.groupRules.length) return;
    await applyGroupRule(tabId, settings.groupRules, map);
  }).catch((e) => console.warn("TabVault group rule failed", e));
});
chrome.tabs.onRemoved.addListener((tabId) => {
  rulesWrite(async () => {
    const map = await getLeftAlone();
    if (Object.prototype.hasOwnProperty.call(map, String(tabId))) await setLeftAlone(TV.forgetTab(map, tabId));
  }).catch(() => {});
});

async function groupRulesPlan() {
  const [settings, windows, leftAlone] = await Promise.all([getSettings(), chrome.windows.getAll({ populate: true }), getLeftAlone()]);
  const own = windows.map((w) => ({ ...w, tabs: (w.tabs || []).filter((t) => !String(t.url || "").startsWith(OWN_PREFIX)) }));
  return { settings, leftAlone, plan: TV.planGroupRules(own, settings.groupRules, { leftAlone }) };
}
// Apply moves exactly the previewed tabs that still match; the undo list puts them back.
function groupRulesApply({ tabIds }) {
  return rulesWrite(async () => {
    const want = new Set((Array.isArray(tabIds) ? tabIds : []).map(Number));
    const { settings, plan } = await groupRulesPlan();
    const undo = [];
    const groups = new Set();
    let failed = 0;
    for (const m of plan.moves.filter((x) => want.has(x.tabId))) {
      const rule = settings.groupRules.find((r) => r.id === m.ruleId);
      try {
        const gid = await groupInto({ id: m.tabId, windowId: m.windowId }, rule);
        groups.add(gid);
        undo.push({ tabId: m.tabId, windowId: m.windowId, index: m.index });
      } catch {
        failed++;
      }
    }
    return { ok: true, moved: undo.length, groups: groups.size, failed, undo };
  });
}
async function groupRulesUndo({ undo }) {
  const list = (Array.isArray(undo) ? undo : []).filter((u) => u && Number.isInteger(u.tabId));
  const alive = [];
  for (const u of list) if (await chrome.tabs.get(u.tabId).catch(() => null)) alive.push(u);
  if (!alive.length) return { ok: true, restored: 0 };
  await chrome.tabs.ungroup(alive.map((u) => u.tabId));
  for (const u of alive.slice().sort((a, b) => a.index - b.index)) {
    await chrome.tabs.move(u.tabId, { windowId: u.windowId, index: u.index }).catch(() => {});
  }
  return { ok: true, restored: alive.length };
}

// ---- weekly tidy (1.7) ----------------------------------------------------------------------
// The review itself runs in the page (lib/tidy.js tidySections). The worker keeps tidyState
// (when the last tidy was, when the next one became due), the kept list and the log, and on its
// 5-minute tick marks the tidy due a week after the last one; the page shows a calm bar. A
// notification only when the user turned it on in the Tidy dialog AND Chrome granted the
// optional notifications permission; it names no tab.
const TIDY_NOTIFICATION = "tabvault-tidy";
let tidyQueue = Promise.resolve();
function tidyWrite(fn) {
  const run = tidyQueue.then(fn);
  tidyQueue = run.catch(() => {});
  return run;
}
async function notificationsGranted() {
  if (!chrome.notifications) return false;
  return chrome.permissions.contains({ permissions: ["notifications"] }).catch(() => false);
}
function tidyCheck(now = Date.now()) {
  return tidyWrite(async () => {
    const area = chrome.storage.local;
    const [settings, got] = await Promise.all([getSettings(), area.get(TV.TIDY_STATE_KEY)]);
    const r = TV.tidyDue(got[TV.TIDY_STATE_KEY], settings, now);
    let state = r.state;
    if (r.changed) await area.set({ [TV.TIDY_STATE_KEY]: state });
    if (TV.shouldNotify(state, settings, await notificationsGranted())) {
      await chrome.notifications.create(TIDY_NOTIFICATION, { type: "basic", iconUrl: "icons/icon128.png", title: "TabVault", message: "Your weekly tidy is ready. Click to look at it." });
      state = { ...state, notifiedAt: now };
      await area.set({ [TV.TIDY_STATE_KEY]: state });
    }
    return { ok: true, due: r.due, state };
  });
}
self.tidyCheck = tidyCheck;
function tidyReset() {
  return tidyWrite(async () => {
    await chrome.storage.local.set({ [TV.TIDY_STATE_KEY]: TV.tidyReset(Date.now()) });
    if (chrome.notifications) chrome.notifications.clear(TIDY_NOTIFICATION).catch(() => {});
    return { ok: true };
  });
}
function tidyLogAdd(counts) {
  return tidyWrite(async () => {
    const { [TV.TIDY_LOG_KEY]: log = [] } = await chrome.storage.local.get(TV.TIDY_LOG_KEY);
    await chrome.storage.local.set({ [TV.TIDY_LOG_KEY]: TV.appendTidyLog(log, counts || {}, Date.now()) });
    return { ok: true };
  });
}
// Close into the vault: the shelf "Tidy <date>" (found by name, else made), then the shelving
// path (written, read back, then closed).
async function tidyClose({ tabIds }) {
  const name = TV.tidyShelfName(Date.now());
  const shelf = await shelfWrite(async () => {
    const found = (await TV.listShelves(chrome.storage.local)).find((s) => s.name === name);
    return found || TV.createShelf(chrome.storage.local, name);
  });
  const r = await shelveTabs({ tabIds, shelfId: shelf.id });
  if (r.ok && r.shelved) await tidyLogAdd({ closed: r.shelved });
  return { ...r, shelfId: shelf.id, shelfName: shelf.name };
}
// Keep: the pages stay out of the tidy for 30 days; a woken snooze among them counts as seen.
async function tidyKeep({ urls, entryIds }) {
  const settings = await getSettings();
  const list = (Array.isArray(urls) ? urls : []).map(String);
  await tidyWrite(async () => {
    const { [TV.TIDY_KEPT_KEY]: kept = {} } = await chrome.storage.local.get(TV.TIDY_KEPT_KEY);
    await chrome.storage.local.set({ [TV.TIDY_KEPT_KEY]: TV.addKept(TV.pruneKept(kept, Date.now()), list, Date.now(), settings.ignoreHash !== false) });
  });
  const ids = (Array.isArray(entryIds) ? entryIds : []).map(String);
  if (ids.length) await snoozeEdit((cur) => TV.removeEntries(cur, ids.filter((id) => cur.some((e) => e.id === id && e.wokeAt))));
  await tidyLogAdd({ kept: list.length });
  return { ok: true, kept: list.length };
}
function onTidyNotificationClick(id) {
  if (id !== TIDY_NOTIFICATION) return;
  chrome.notifications.clear(id).catch(() => {});
  chrome.tabs.create({ url: `${PAGE_URL}?tidy=1` }).catch(() => {});
}
let tidyClickWired = false;
function wireTidyNotifications() {
  if (tidyClickWired || !chrome.notifications || !chrome.notifications.onClicked) return;
  chrome.notifications.onClicked.addListener(onTidyNotificationClick);
  tidyClickWired = true;
}
wireTidyNotifications();
chrome.permissions.onAdded.addListener(() => wireTidyNotifications());
tidyCheck().catch(() => {});

// ---- messages from the page ------------------------------------------------
function safeRespond(sendResponse, payload) { try { sendResponse(payload); } catch { /* page closed */ } }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return;
  // The veil's pill (app/focus-veil.js, injected by this worker) asks for one thing only: lift.
  if (msg.type === "focusLift" && sender && sender.id === chrome.runtime.id && sender.tab) {
    liftFocus().then((r) => safeRespond(sendResponse, r), () => safeRespond(sendResponse, { ok: false }));
    return true;
  }
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
    case "runIdleNow": runAutoDiscard({ manual: true }).then(reply, fail); return true;
    case "idleDryRun": idleDryRun(msg.rule || {}).then(reply, fail); return true;
    case "shelveTabs": shelveTabs(msg).then(reply, fail); return true;
    case "shelfCreate":
      shelfWrite(async () => ({ ok: true, shelf: await TV.createShelf(chrome.storage.local, msg.name) })).then(reply, fail);
      return true;
    case "shelfRemoveItems":
      shelfWrite(async () => ({ ok: true, ...(await TV.removeItems(chrome.storage.local, msg.shelfId, Array.isArray(msg.itemIds) ? msg.itemIds : [])) })).then(reply, fail);
      return true;
    case "shelfDelete":
      shelfWrite(async () => {
        const settings = await getSettings();
        const using = settings.idleRules.filter((r) => r.shelfId === msg.shelfId).length;
        if (using) return { ok: false, error: `${using} rule${using === 1 ? " files" : "s file"} tabs onto this shelf; change or delete ${using === 1 ? "it" : "them"} first.` };
        await TV.deleteShelf(chrome.storage.local, msg.shelfId);
        return { ok: true };
      }).then(reply, fail);
      return true;
    case "saveAndClose": saveAndClose(msg).then(reply, fail); return true;
    case "snoozeTabs": snoozeTabs(msg).then(reply, fail); return true;
    case "snoozeWake": wakeDue({ ids: Array.isArray(msg.ids) ? msg.ids : [] }).then(reply, fail); return true;
    case "snoozeReschedule": snoozeReschedule(msg).then(reply, fail); return true;
    case "snoozeCancel": snoozeCancel(msg).then(reply, fail); return true;
    case "groupRulesPlan": groupRulesPlan().then((r) => reply({ ok: true, ...r.plan }), fail); return true;
    case "groupRulesApply": groupRulesApply(msg).then(reply, fail); return true;
    case "groupRulesUndo": groupRulesUndo(msg).then(reply, fail); return true;
    case "tidyClose": tidyClose(msg).then(reply, fail); return true;
    case "tidyKeep": tidyKeep(msg).then(reply, fail); return true;
    case "tidyLog": tidyLogAdd(msg.counts).then(reply, fail); return true;
    case "tidyDone": tidyReset().then(reply, fail); return true;
    case "bmMoveToDeleted":
    case "bmSaveFolder":
    case "bmBackup":
      bookmarkMessage(msg).then(reply, fail);
      return true;
    case "focusToggle": runFocusCommand(msg.windowId).then(reply, fail); return true;
    case "focusStart": startFocus(msg.windowId, msg.mode === "minimize" ? "minimize" : "veil").then(reply, fail); return true;
    case "focusLift": liftFocus().then(reply, fail); return true;
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
