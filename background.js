importScripts("lib/session.js", "lib/snapshots.js", "lib/settings.js", "lib/snapstore.js", "lib/badge.js", "lib/discard-rule.js", "lib/recent.js", "lib/save-close.js", "lib/shelves.js", "lib/focus.js");

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

chrome.action.onClicked.addListener(() => { openPage().catch((e) => console.warn("TabVault open failed", e)); });
// The toolbar click keeps opening the full page; the side panel (the same page with ?panel=1)
// opens from the page's menu, the palette, or this command (bind it at chrome://extensions/shortcuts).
// sidePanel.open must run inside the command's user gesture, so nothing is awaited before it.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "open-tabvault") openPage().catch(() => {});
  if (command === "focus-window") runFocusCommand(tab && typeof tab.windowId === "number" ? tab.windowId : undefined).catch((e) => console.warn("TabVault focus failed", e));
  if (command === "open-side-panel" && chrome.sidePanel && tab && typeof tab.windowId === "number") {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch((e) => console.warn("TabVault side panel failed", e));
  }
});
if (chrome.sidePanel) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  chrome.sidePanel.setOptions({ path: "app/index.html?panel=1", enabled: true }).catch(() => {});
}

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
    return appendRecent(infos.filter(Boolean).map((info) => TV.closedEntry(info, { groupTitle: info.groupTitle, closedAt, batch, shelf: info.shelf })));
  }).catch((e) => console.warn("TabVault recently-closed failed", e));
}

chrome.tabs.onRemoved.addListener((tabId, info) => {
  const cached = tabCache.get(tabId);
  tabCache.delete(tabId);
  // A tab an idle rule or "Move to shelf" just saved: its entry says which shelf (1.3).
  const shelf = shelvedTabs.get(tabId) || null;
  shelvedTabs.delete(tabId);
  const described = describeClosed(tabId, cached).catch(() => null).then((d) => (d && shelf ? { ...d, shelf } : d));
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
  described.then((d) => (d ? appendRecent([TV.closedEntry(d, { groupTitle: d.groupTitle, closedAt: Date.now(), shelf: d.shelf })]) : null))
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
async function veilTab(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [VEIL_FILE] });
    return true;
  } catch {
    return false; // a PDF viewer, an error page, a page that refuses: counted on the page
  }
}
function unveilTab(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: () => { const h = document.getElementById("tabvault-focus-veil"); if (h) h.remove(); },
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
    const action = TV.tabAction(state, tab, OWN_PREFIX);
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

function createFocusMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: FOCUS_MENU, title: "Focus this window", contexts: ["action"] }, () => {
      void chrome.runtime.lastError; // a second create during a quick reload: the item is there already
      getFocus().then((s) => { if (s.on) chrome.contextMenus.update(FOCUS_MENU, { title: "Lift the focus" }).catch(() => {}); }, () => {});
    });
  });
}
chrome.runtime.onInstalled.addListener(createFocusMenu);
chrome.runtime.onStartup.addListener(createFocusMenu);
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== FOCUS_MENU) return;
  runFocusCommand(tab && typeof tab.windowId === "number" ? tab.windowId : undefined).catch((e) => console.warn("TabVault focus failed", e));
});

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
