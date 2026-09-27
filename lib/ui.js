(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  // Header counter: "3 win · 27 tabs · 4 sel"; while searching, "3 win · 4 of 27 tabs".
  // shown is null when no search is active.
  function formatCounts({ windows = 0, tabs = 0, shown = null, selected = 0 } = {}) {
    const noun = tabs === 1 ? "tab" : "tabs";
    const parts = [`${windows} win`, shown === null ? `${tabs} ${noun}` : `${shown} of ${tabs} ${noun}`];
    if (selected > 0) parts.push(`${selected} sel`);
    return parts.join(" · ");
  }

  return { formatCounts };
});
