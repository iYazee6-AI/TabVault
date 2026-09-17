(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  function terms(query) {
    return String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  }

  function matches(tab, words) {
    const hay = `${tab.title} ${tab.url}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  }

  // Returns the session's windows with only the tabs that match; windows with no match are dropped.
  function filterSession(session, query) {
    const words = terms(query);
    let count = 0;
    const windows = [];
    for (const w of session.windows || []) {
      const tabs = words.length ? w.tabs.filter((t) => matches(t, words)) : w.tabs;
      if (tabs.length === 0) continue;
      count += tabs.length;
      windows.push({ ...w, tabs });
    }
    return { windows, count };
  }

  return { filterSession, matches, terms };
});
