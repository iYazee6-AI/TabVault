(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  // Auto-discard: which idle tabs the worker unloads at each 5-minute alarm. Pure; the worker
  // feeds it chrome.tabs.query results and calls chrome.tabs.discard on the ids it returns.
  const PROTECT_EMOJI = "📌"; // a group named with this first is never unloaded
  const RUN_CAP = 25; // a wake after sleep must not unload a hundred tabs at once; the rest wait

  // One host per line (commas and spaces also separate). "*.example.com" matches example.com
  // and every subdomain; "example.com" matches it and www.example.com. A pasted URL is reduced
  // to its host; anything that is not a host is dropped.
  function parseAllowlist(text) {
    const out = [];
    const flat = [9, 10, 13].reduce((s, c) => s.split(String.fromCharCode(c)).join(" "), String(text || ""));
    for (let raw of flat.split(/[ ,;]+/)) {
      raw = raw.trim().toLowerCase();
      if (!raw) continue;
      raw = raw.replace(/^[a-z][a-z0-9+.-]*:[/][/]/, "").split("/")[0].split("?")[0].split("#")[0].replace(/:[0-9]+$/, "");
      const wild = raw.startsWith("*.");
      const host = wild ? raw.slice(2) : raw;
      if (!/^[a-z0-9-]+([.][a-z0-9-]+)*$/.test(host)) continue;
      const entry = wild ? "*." + host : host;
      if (!out.includes(entry)) out.push(entry);
    }
    return out;
  }

  function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
  }

  function hostAllowed(host, patterns) {
    if (!host) return false;
    for (const p of patterns || []) {
      if (p.startsWith("*.")) {
        const base = p.slice(2);
        if (host === base || host.endsWith("." + base)) return true;
      } else if (host === p || host === "www." + p) {
        return true;
      }
    }
    return false;
  }

  // tabs: chrome.tabs.query results; groups: chrome.tabGroups.query({}); settings: the
  // settings.autoDiscard object (lib/settings.js). Returns { ids, eligible }: ids, oldest
  // first and at most `cap`, to unload now; eligible, how many qualified before the cap.
  // Never: the active tab, an audible tab, an already unloaded tab, a tab Chrome marks
  // autoDiscardable false, TabVault's own pages, a tab without lastAccessed (Chrome 121+;
  // skipped rather than guessed), a pinned tab while keepPinned is on, a tab in a group whose
  // name starts with the pin emoji, a tab on the allowlist, or one used within the threshold.
  function planDiscard(tabs, { settings, now = Date.now(), groups = [], ownPrefix = "", cap = RUN_CAP } = {}) {
    const s = settings || {};
    const idleMs = (Number(s.minutes) || 60) * 60000;
    const protectedGroups = new Set((groups || []).filter((g) => String(g.title || "").trimStart().startsWith(PROTECT_EMOJI)).map((g) => g.id));
    const allow = Array.isArray(s.allowlist) ? s.allowlist : [];
    const keepPinned = s.keepPinned !== false;
    const picked = [];
    for (const t of tabs || []) {
      if (t.active || t.audible || t.discarded) continue;
      if (t.autoDiscardable === false) continue;
      const url = String(t.url || t.pendingUrl || "");
      if (!url || (ownPrefix && url.startsWith(ownPrefix))) continue;
      if (typeof t.lastAccessed !== "number") continue;
      if (keepPinned && t.pinned) continue;
      if (typeof t.groupId === "number" && protectedGroups.has(t.groupId)) continue;
      if (hostAllowed(hostOf(url), allow)) continue;
      if (now - t.lastAccessed < idleMs) continue;
      picked.push(t);
    }
    picked.sort((a, b) => a.lastAccessed - b.lastAccessed);
    return { ids: picked.slice(0, cap).map((t) => t.id), eligible: picked.length };
  }

  function defaultTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // The line under the setting: "last run 12:40, 7 unloaded" (plus failures and the ones left
  // for the next run). lastRun: { at, unloaded, failed, waiting } from storage.session.
  function lastRunText(lastRun, fmtTime = defaultTime) {
    if (!lastRun || typeof lastRun.at !== "number") return "Not run yet in this browser session.";
    let text = `last run ${fmtTime(lastRun.at)}, ${lastRun.unloaded || 0} unloaded`;
    if (lastRun.failed) text += `, ${lastRun.failed} could not be unloaded`;
    if (lastRun.waiting) text += `, ${lastRun.waiting} wait for the next run`;
    return text;
  }

  return { PROTECT_EMOJI, RUN_CAP, parseAllowlist, hostAllowed, planDiscard, lastRunText };
});
