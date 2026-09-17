(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  function fitBounds(bounds, state, screen) {
    if (state !== "normal" || !bounds || !screen) return null;
    if (!Number.isFinite(bounds.left) || !Number.isFinite(bounds.top) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return null;
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    if (bounds.width > screen.width || bounds.height > screen.height) return null;
    return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
  }

  // Turns a session into ordered steps the executor performs with chrome.* calls.
  // refs (w<id>, t<id>, g<id>) are placeholders the executor maps to real ids.
  function planRestore(session, { selectedWindowIds, allowIncognito = false, screen = null, discard = true } = {}) {
    const wanted = new Set(selectedWindowIds || session.windows.map((w) => w.id));
    const steps = [];
    const skipped = [];
    for (const w of session.windows) {
      if (!wanted.has(w.id)) continue;
      if (w.incognito && !allowIncognito) { skipped.push({ windowId: w.id, reason: "incognito access is not allowed for TabVault" }); continue; }
      const tabs = w.tabs.slice().sort((a, b) => a.index - b.index);
      if (tabs.length === 0) { skipped.push({ windowId: w.id, reason: "no tabs" }); continue; }
      const first = tabs.find((t) => !t.pinned) || tabs[0];
      const wref = `w${w.id}`;
      const tref = (t) => `t${t.id}`;
      const state = w.state || "normal";
      steps.push({ op: "createWindow", ref: wref, url: first.url, incognito: Boolean(w.incognito), state, bounds: fitBounds(w.bounds, state, screen), firstTabRef: tref(first) });
      for (const t of tabs) {
        if (t === first) continue;
        steps.push({ op: "createTab", ref: tref(t), windowRef: wref, url: t.url, index: t.index, pinned: Boolean(t.pinned) });
      }
      for (const t of tabs) {
        const upd = {};
        if (t.pinned) upd.pinned = true;
        if (t.muted) upd.muted = true;
        if (Object.keys(upd).length) steps.push({ op: "updateTab", ref: tref(t), ...upd });
      }
      for (const g of w.groups || []) {
        const members = tabs.filter((t) => t.groupId === g.id && !t.pinned).map(tref);
        if (members.length === 0) continue;
        steps.push({ op: "groupTabs", groupRef: `g${g.id}`, windowRef: wref, tabRefs: members });
        steps.push({ op: "updateGroup", groupRef: `g${g.id}`, title: g.title || "", color: g.color || "grey", collapsed: Boolean(g.collapsed) });
      }
      if (discard) {
        for (const t of tabs) {
          if (t === first) continue;
          steps.push({ op: "discardTab", ref: tref(t) });
        }
      }
    }
    return { steps, skipped };
  }

  return { planRestore, fitBounds };
});
