// UMD wrapper: attaches to the TabVault global in the browser (page and service
// worker) and exports for Node tests. Every lib/ module uses this exact wrapper.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.TabVault = Object.assign(root.TabVault || {}, api);
  }
})(typeof self !== "undefined" ? self : this, function () {
  const NO_GROUP = -1;

  // Data-URL favicons can be huge (some sites inline multi-KB icons); trimming keeps
  // exported/stored sessions from ballooning on those tabs.
  function trimFavicon(url) {
    if (url && url.startsWith("data:") && url.length > 2048) return "";
    return url || "";
  }

  function mapTab(t) {
    return {
      id: t.id,
      index: t.index,
      title: t.title || "",
      url: t.url || t.pendingUrl || "",
      favIconUrl: trimFavicon(t.favIconUrl),
      pinned: Boolean(t.pinned),
      muted: Boolean(t.mutedInfo && t.mutedInfo.muted),
      audible: Boolean(t.audible),
      active: Boolean(t.active),
      discarded: Boolean(t.discarded),
      groupId: typeof t.groupId === "number" && t.groupId !== NO_GROUP ? t.groupId : null,
      lastAccessed: typeof t.lastAccessed === "number" ? t.lastAccessed : null,
      openerTabId: typeof t.openerTabId === "number" ? t.openerTabId : null,
    };
  }

  function mapGroup(g) {
    return { id: g.id, title: g.title || "", color: g.color || "grey", collapsed: Boolean(g.collapsed) };
  }

  const MAX_NAME = 60;
  function cleanName(name) {
    return typeof name === "string" ? name.trim().slice(0, MAX_NAME) : "";
  }

  // Window names live in chrome.storage.local under this key, not storage.session: Chrome also
  // clears session storage on an extension update, reload or disable, while window ids survive
  // all three. Ids do reset with the browser, so the worker clears the key on onStartup.
  const WINDOW_NAMES_KEY = "windowNames";

  // area: a chrome.storage area (chrome.storage.local). Called from runtime.onStartup.
  function clearWindowNames(area) {
    return area.remove(WINDOW_NAMES_KEY);
  }

  // names: { [windowId]: name } as kept under WINDOW_NAMES_KEY. Returns a new map with
  // `name` set for `windowId` (removed when blank); with liveIds, names of windows that are
  // no longer open are dropped so the map cannot grow without bound.
  function setWindowName(names, windowId, name, liveIds = null) {
    const keep = liveIds ? new Set(liveIds.map(String)) : null;
    const out = {};
    for (const [key, value] of Object.entries(names || {})) {
      if (keep && !keep.has(key)) continue;
      const clean = cleanName(value);
      if (clean) out[key] = clean;
    }
    const key = String(windowId);
    const clean = cleanName(name);
    if (clean) out[key] = clean;
    else delete out[key];
    return out;
  }

  // windows: chrome.windows.getAll({ populate: true }); groups: chrome.tabGroups.query({}).
  function buildSession({ windows = [], groups = [], now = Date.now(), browser = null, excludeUrlPrefix = "", windowNames = {} } = {}) {
    const groupsByWindow = new Map();
    for (const g of groups) {
      if (!groupsByWindow.has(g.windowId)) groupsByWindow.set(g.windowId, []);
      groupsByWindow.get(g.windowId).push(mapGroup(g));
    }
    const ordered = windows.slice().sort((a, b) => Number(Boolean(b.focused)) - Number(Boolean(a.focused)));
    const out = [];
    for (const w of ordered) {
      const tabs = (w.tabs || [])
        .filter((t) => !excludeUrlPrefix || !String(t.url || t.pendingUrl || "").startsWith(excludeUrlPrefix))
        .slice()
        .sort((a, b) => a.index - b.index)
        .map(mapTab);
      if (tabs.length === 0) continue;
      const usedGroups = new Set(tabs.map((t) => t.groupId).filter((g) => g !== null));
      const entry = {
        id: w.id,
        type: w.type || "normal",
        state: w.state || "normal",
        focused: Boolean(w.focused),
        incognito: Boolean(w.incognito),
        bounds: { left: w.left ?? 0, top: w.top ?? 0, width: w.width ?? 0, height: w.height ?? 0 },
        groups: (groupsByWindow.get(w.id) || []).filter((g) => usedGroups.has(g.id)),
        tabs,
      };
      const nameKey = String(w.id);
      const name = windowNames && Object.hasOwn(windowNames, nameKey) ? cleanName(windowNames[nameKey]) : "";
      if (name) entry.windowName = name;
      out.push(entry);
    }
    return { schema: 1, capturedAt: now, browser, windows: out };
  }

  function countTabs(session) {
    return (session.windows || []).reduce((n, w) => n + w.tabs.length, 0);
  }

  const VOLATILE_TAB = ["lastAccessed", "active", "discarded", "audible"];

  // A copy without the fields that change on their own; used to detect "nothing changed".
  function stripVolatile(session) {
    return {
      schema: session.schema,
      windows: (session.windows || []).map((w) => {
        const c = {
          id: w.id, type: w.type, incognito: w.incognito,
          groups: w.groups.map((g) => ({ ...g })),
          tabs: w.tabs.map((t) => { const x = { ...t }; for (const k of VOLATILE_TAB) delete x[k]; return x; }),
        };
        if (w.windowName) c.windowName = w.windowName;
        return c;
      }).slice().sort((a, b) => a.id - b.id),
    };
  }

  return { buildSession, countTabs, stripVolatile, setWindowName, WINDOW_NAMES_KEY, clearWindowNames };
});
