(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function (root) {
  // The command palette (Alt+K): one list of actions (every bound entry of lib/shortcuts.js plus
  // the page's extra commands) and tabs, filtered and ranked as you type. Pure; app/app.js draws it.
  function searchApi() {
    return (typeof module === "object" && module.exports) ? require("./search.js") : root.TabVault;
  }

  // shortcuts: SHORTCUTS rows (those with an action); extras: [{ id, label, keys? }].
  function paletteActions(shortcuts, extras = []) {
    const out = [];
    for (const s of shortcuts || []) {
      if (!s.action) continue;
      out.push({ id: s.action, label: s.label, keys: s.display || [], shortcut: true });
    }
    for (const x of extras) out.push({ id: x.id, label: x.label, keys: x.keys || [], shortcut: false });
    return out;
  }

  // 3 for a match at the very start, 2 at the start of a word, 1 anywhere; 0 when a word is missing.
  function wordScore(text, word) {
    let i = text.indexOf(word);
    if (i < 0) return 0;
    if (i === 0) return 3;
    while (i > 0) {
      if (/[^a-z0-9]/.test(text.charAt(i - 1))) return 2;
      i = text.indexOf(word, i + 1);
    }
    return 1;
  }

  function textScore(text, words) {
    const t = String(text || "").toLowerCase();
    let total = 0;
    for (const w of words) {
      const s = wordScore(t, w);
      if (!s) return 0;
      total += s;
    }
    return total;
  }

  // tabs: [{ tab, windowId, windowLabel }]. A tab matches when every word is in its title or URL
  // (the page's search rule, lib/search.js); it ranks by where the words fall in its title, then
  // its domain. Actions rank by their label and come before tabs on an equal score. An empty
  // query lists the actions only.
  function filterPalette(query, actions, tabs, { limit = 50, domainOf = null } = {}) {
    const { terms, matches } = searchApi();
    const words = terms(query);
    const rows = [];
    let order = 0;
    for (const a of actions || []) {
      const score = words.length ? textScore(a.label, words) : 1;
      if (score) rows.push({ kind: "action", action: a, score, order: order++ });
    }
    if (words.length) {
      for (const x of tabs || []) {
        if (!matches(x.tab, words)) continue;
        const domain = domainOf ? domainOf(x.tab.url) : "";
        const score = Math.max(textScore(x.tab.title, words), textScore(domain, words) - 1, 0.5);
        rows.push({ kind: "tab", tab: x.tab, windowId: x.windowId, windowLabel: x.windowLabel || "", score, order: order++ });
      }
    }
    rows.sort((a, b) => b.score - a.score || (a.kind === b.kind ? 0 : a.kind === "action" ? -1 : 1) || a.order - b.order);
    return rows.slice(0, limit);
  }

  // Alt+K (matched on the physical key, so any layout works) opens the palette, except while
  // typing in a field other than the search box: on macOS Option+K types a character there.
  // key: the keydown event's altKey, ctrlKey, metaKey and code; field: { editable, id } of its target.
  function opensPalette(key, field = {}) {
    if (!key || !key.altKey || key.ctrlKey || key.metaKey || key.code !== "KeyK") return false;
    return !field.editable || field.id === "search";
  }

  return { paletteActions, filterPalette, opensPalette };
});
