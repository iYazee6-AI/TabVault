(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  // Focus mode (1.4): one window stays sharp, every tab of every other window gets a veil (a
  // blur with a lift pill), or, without the optional host permission, the other windows are
  // minimised instead. Pure: the worker keeps the state in chrome.storage.session under
  // FOCUS_KEY and does the injecting; nothing here reads a page.
  const FOCUS_KEY = "focus";
  const FOCUS_FALLBACK_KEY = "focusFallback"; // storage.local: "minimize" once the user chose it
  const FOCUS_ORIGINS = ["<all_urls>"];
  const FOCUS_BADGE = "●"; // a dot on the toolbar icon while focus is on
  const FOCUS_OFF = Object.freeze({ on: false });

  // Chrome refuses script injection into its own pages and the Web Store; other schemes
  // (chrome://, edge://, about:, data:, file: without the user's file access, other
  // extensions' pages, view-source:) are refused too. Only http and https pages are tried;
  // a PDF viewer or a page that still refuses is counted when the injection fails.
  const STORE_HOSTS = ["chromewebstore.google.com"];
  function isVeilable(url) {
    let u;
    try { u = new URL(String(url || "")); } catch { return false; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (STORE_HOSTS.includes(host)) return false;
    if (host === "chrome.google.com" && u.pathname.startsWith("/webstore")) return false;
    return true;
  }

  function tabUrl(tab) { return String((tab && (tab.url || tab.pendingUrl)) || ""); }

  // The command (shortcut, toolbar menu or the page's row) toggles: off turns it on for the
  // window it came from, the same window lifts it, another window moves it there.
  function focusCommand(state, windowId) {
    if (!state || !state.on) return "on";
    return state.windowId === windowId ? "lift" : "move";
  }

  // windows: chrome.windows.getAll({ populate: true }). Every tab outside the focused window is
  // sorted into veil (inject now), unloaded (discarded: veiled once it loads, through
  // tabs.onUpdated) or skip (cannot be injected; counted on the page). TabVault's own pages and
  // windows that are not normal or popup windows are left out of all three.
  function planVeil(windows, focusedWindowId, ownPrefix = "") {
    const veil = [];
    const skip = [];
    const unloaded = [];
    for (const w of windows || []) {
      if (w.id === focusedWindowId) continue;
      if (w.type && w.type !== "normal" && w.type !== "popup") continue;
      for (const t of w.tabs || []) {
        const url = tabUrl(t);
        if (ownPrefix && url.startsWith(ownPrefix)) continue;
        if (!isVeilable(url)) skip.push(t.id);
        else if (t.discarded) unloaded.push(t.id);
        else veil.push(t.id);
      }
    }
    return { veil, skip, unloaded };
  }

  // What a tab that loads, opens or moves while focus is on needs: "veil", "unveil" (it is in
  // the focused window now), "skip" (another window, but it cannot be injected) or "none".
  function tabAction(state, tab, ownPrefix = "") {
    if (!state || !state.on || state.mode !== "veil" || !tab) return "none";
    const url = tabUrl(tab);
    if (ownPrefix && url.startsWith(ownPrefix)) return "none";
    if (tab.windowId === state.windowId) return "unveil";
    return isVeilable(url) ? "veil" : "skip";
  }

  // The skipped tab ids are a set kept as a sorted array, so the stored state stays plain JSON.
  function withSkipped(state, tabId, skipped) {
    const set = new Set((state && state.skipped) || []);
    if (skipped) set.add(tabId); else set.delete(tabId);
    return { ...state, skipped: [...set].sort((a, b) => a - b) };
  }

  function startState(windowId, mode, now, extra = {}) {
    return { on: true, windowId, mode: mode === "minimize" ? "minimize" : "veil", since: now, skipped: [], minimized: [], ...extra };
  }

  // The minimise fallback: every other normal window that is not minimised already, with the
  // state it goes back to when the focus is lifted.
  function minimizePlan(windows, focusedWindowId) {
    const out = [];
    for (const w of windows || []) {
      if (w.id === focusedWindowId) continue;
      if (w.type && w.type !== "normal") continue;
      if (w.state === "minimized") continue;
      out.push({ id: w.id, state: w.state || "normal" });
    }
    return out;
  }

  // The page's line while focus is on.
  function focusSummary(state) {
    if (!state || !state.on) return "";
    if (state.mode === "minimize") {
      const n = (state.minimized || []).length;
      return `Focus is on: ${n} other window${n === 1 ? "" : "s"} minimised`;
    }
    const n = (state.skipped || []).length;
    return n ? `Focus is on · ${n} tab${n === 1 ? "" : "s"} could not be veiled` : "Focus is on";
  }

  return { FOCUS_KEY, FOCUS_FALLBACK_KEY, FOCUS_ORIGINS, FOCUS_BADGE, FOCUS_OFF, isVeilable, focusCommand, planVeil, tabAction, withSkipped, startState, minimizePlan, focusSummary };
});
