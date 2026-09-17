// Builders for the shapes chrome.windows.getAll({populate:true}) and chrome.tabGroups.query return.
let nextId = 1000;
function tab(props = {}) {
  const id = props.id ?? nextId++;
  return {
    id, index: 0, windowId: 1, title: `Tab ${id}`, url: `https://example.com/${id}`, favIconUrl: "",
    pinned: false, audible: false, active: false, discarded: false, groupId: -1,
    mutedInfo: { muted: false }, lastAccessed: 1000 + id, openerTabId: undefined,
    ...props,
  };
}
function win(props = {}) {
  const id = props.id ?? nextId++;
  const w = { id, type: "normal", state: "normal", focused: false, incognito: false, left: 0, top: 0, width: 1200, height: 800, tabs: [], ...props };
  w.tabs = w.tabs.map((t, i) => ({ ...t, windowId: id, index: t.index ?? i }));
  return w;
}
function group(props = {}) {
  const id = props.id ?? nextId++;
  return { id, windowId: 1, title: "", color: "grey", collapsed: false, ...props };
}
module.exports = { tab, win, group };
