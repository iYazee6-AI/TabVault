importScripts("lib/session.js", "lib/snapshots.js");

const PAGE_URL = chrome.runtime.getURL("app/index.html");
const OWN_PREFIX = chrome.runtime.getURL("");
const ALARM = "tabvault-snapshot";
const DEFAULT_SETTINGS = { debounceSeconds: 30, keepSnapshots: 20, ignoreHash: true, theme: "system", showUrls: false, density: "comfortable", lazyRestore: true };

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings };
}

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
let queue = Promise.resolve();
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
  return self.TabVault.buildSession({ windows, groups, now: Date.now(), browser: { name: "Chrome", version, os: info && info.os }, excludeUrlPrefix: OWN_PREFIX });
}

async function takeSnapshot(reason) {
  return enqueue(async () => {
    const session = await captureSession();
    if (session.windows.length === 0) return { ok: true, skipped: true };
    const settings = await getSettings();
    const { snapshots = [] } = await chrome.storage.local.get("snapshots");
    const latest = snapshots[0];
    if (reason !== "manual" && latest && self.TabVault.isSameSession(latest.session, session)) return { ok: true, skipped: true };
    const snap = self.TabVault.makeSnapshot(session, reason, Date.now());
    if (reason === "manual") snap.pinned = true;
    const next = self.TabVault.rotate([snap, ...snapshots], settings.keepSnapshots);
    try {
      await chrome.storage.local.set({ snapshots: next });
    } catch (e) {
      // Quota: drop the oldest unpinned and retry once.
      const idx = next.map((s) => s.pinned).lastIndexOf(false);
      if (idx < 0) throw e;
      next.splice(idx, 1);
      await chrome.storage.local.set({ snapshots: next });
    }
    return { ok: true, id: snap.id };
  });
}

// chrome.storage.session (Chrome 102+, no extra permission) tracks when the current
// run of changes started, so a steady stream of activity cannot re-arm the debounce
// forever: past a cap, the already-pending alarm is left to fire instead of being pushed out.
async function scheduleSnapshot() {
  const settings = await getSettings();
  const now = Date.now();
  const { pendingSince } = await chrome.storage.session.get("pendingSince");
  if (pendingSince === undefined) {
    await chrome.storage.session.set({ pendingSince: now });
  } else if (now - pendingSince > Math.max(10 * settings.debounceSeconds * 1000, 300000)) {
    return; // max wait exceeded: let the pending alarm fire rather than re-creating it
  }
  const minutes = Math.max(0.5, settings.debounceSeconds / 60);
  await chrome.alarms.create(ALARM, { delayInMinutes: minutes }); // re-creating replaces the pending alarm
}

function onChange() { scheduleSnapshot().catch((e) => console.warn("TabVault schedule failed", e)); }

for (const ev of [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.windows.onCreated, chrome.windows.onRemoved]) ev.addListener(onChange);
// Title changes are deliberately not a trigger: live titles (counters, timers) would re-arm the debounce forever. Titles are captured on the next structural change.
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.pinned !== undefined || info.groupId !== undefined || info.mutedInfo !== undefined) onChange(); });
if (chrome.tabGroups) for (const ev of [chrome.tabGroups.onCreated, chrome.tabGroups.onRemoved, chrome.tabGroups.onUpdated, chrome.tabGroups.onMoved]) ev.addListener(onChange);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM) return;
  chrome.storage.session.remove("pendingSince").catch(() => {})
    .then(() => takeSnapshot("change"))
    .catch((e) => console.warn("TabVault snapshot failed", e));
});
chrome.runtime.onStartup.addListener(() => { takeSnapshot("startup").catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("storageVersion").then(({ storageVersion }) => {
    if (storageVersion === undefined) return chrome.storage.local.set({ storageVersion: 1 });
  }).catch(() => {});
  takeSnapshot("startup").catch(() => {});
});

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
      enqueue(async () => { const { snapshots = [] } = await chrome.storage.local.get("snapshots"); await chrome.storage.local.set({ snapshots: snapshots.filter((s) => s.id !== msg.id) }); return { ok: true }; }).then(reply, fail);
      return true;
    case "pinSnapshot":
      enqueue(async () => { const { snapshots = [] } = await chrome.storage.local.get("snapshots"); for (const s of snapshots) if (s.id === msg.id) s.pinned = Boolean(msg.pinned); await chrome.storage.local.set({ snapshots }); return { ok: true }; }).then(reply, fail);
      return true;
    case "openPage": openPage().then(() => reply({ ok: true }), fail); return true;
    default: return;
  }
});
