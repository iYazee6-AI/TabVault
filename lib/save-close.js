(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  // Save and close: the worker snapshots the chosen windows (kept, named), then closes exactly
  // the tabs that snapshot saved. Chrome quits when its last window closes, so when nothing
  // else would stay open, one closing window is kept with a New Tab opened in it first.
  //
  // windows: every open window as { id, tabIds } (all of its tabs, TabVault's own included);
  // targetIds: the windows to save and close; savedTabIds: the tab ids in the snapshot (a tab
  // opened after it, or TabVault's own page, is never closed).
  function planSaveClose({ windows = [], targetIds = [], savedTabIds = null } = {}) {
    const targets = new Set(targetIds);
    const saved = savedTabIds ? new Set(savedTabIds) : null;
    const tabIds = [];
    let survivors = 0;
    let emptied = null;
    for (const w of windows) {
      const closing = targets.has(w.id) ? w.tabIds.filter((id) => !saved || saved.has(id)) : [];
      tabIds.push(...closing);
      if (closing.length < w.tabIds.length) survivors++;
      else if (closing.length && emptied === null) emptied = w.id;
    }
    return { tabIds, count: tabIds.length, keepOpenWindowId: survivors === 0 ? emptied : null };
  }

  function defaultTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // "Work · 12:40"; a long label is cut so the Snapshots row stays one line.
  function snapshotName(label, now = Date.now(), fmtTime = defaultTime) {
    const base = String(label || "").trim() || "Window";
    return `${base.length > 60 ? base.slice(0, 59) + "…" : base} · ${fmtTime(now)}`;
  }

  return { planSaveClose, snapshotName };
});
