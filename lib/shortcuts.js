(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  // The one list of shortcuts. app/app.js dispatches keydown through findShortcut(),
  // the hint strip renders HINTS, and the "?" panel in app/dialogs.js renders SHORTCUTS,
  // so the three cannot drift. keys are KeyboardEvent.key values; display is what the
  // panel shows; rows with action null are documentation only (mouse, browser).
  const SHORTCUTS = [
    { action: "search", keys: ["/"], display: ["/"], label: "Search tabs" },
    { action: "next", keys: ["j", "ArrowDown"], display: ["j", "↓"], label: "Next tab" },
    { action: "prev", keys: ["k", "ArrowUp"], display: ["k", "↑"], label: "Previous tab" },
    { action: "nextWindow", keys: ["ArrowRight"], display: ["→"], label: "Next window" },
    { action: "prevWindow", keys: ["ArrowLeft"], display: ["←"], label: "Previous window" },
    { action: "open", keys: ["Enter"], display: ["Enter"], label: "Go to the focused tab" },
    { action: "toggle", keys: ["x", " "], display: ["x", "Space"], label: "Select or unselect the focused tab" },
    { action: "group", keys: ["g"], display: ["g"], label: "Group the selected tabs (Ungroup when all are grouped)" },
    { action: "dupes", keys: ["d"], display: ["d"], label: "Find duplicates" },
    { action: "close", keys: ["Delete"], display: ["Delete"], label: "Close the selected tabs" },
    { action: "escape", keys: ["Escape"], display: ["Esc"], label: "Close a menu; otherwise clear search and selection" },
    { action: "help", keys: ["?"], display: ["?"], label: "All shortcuts (this panel)" },
    { action: null, keys: [], display: ["Ctrl+click"], label: "Toggle a tab's selection (Cmd+click on macOS)" },
    { action: null, keys: [], display: ["Shift+click"], label: "Select a range of tabs" },
    { action: null, keys: [], display: ["Alt+Shift+T"], label: "Open TabVault (browser shortcut, chrome://extensions/shortcuts)" },
  ];

  // The strip at the bottom of the page, in this order.
  const HINTS = [["/", "search"], ["j k", "move"], ["x", "select"], ["g", "group"], ["d", "duplicates"], ["?", "all shortcuts"]];

  function findShortcut(key) {
    return SHORTCUTS.find((s) => s.keys.includes(key)) || null;
  }

  function hintText() {
    return HINTS.map(([keys, label]) => `${keys} ${label}`).join(" · ");
  }

  return { SHORTCUTS, HINTS, findShortcut, hintText };
});
