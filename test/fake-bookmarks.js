// An in-memory stand-in for chrome.bookmarks (1.6): the invisible root "0" holds the Bookmarks bar
// ("1"), Other bookmarks ("2") and Mobile bookmarks ("3"), as Chrome makes them. Promise-returning
// get, getChildren, getSubTree, getTree, search, create, move and update. remove and removeTree
// exist, as on the real API, but THROW and record the call: TabVault must never call them, and
// every test checks `calls.remove` and `calls.removeTree` stay empty.
function fakeBookmarks({ failMoveFor = [] } = {}) {
  let next = 100;
  let clock = 1700000000000;
  const nodes = new Map();
  const calls = { remove: [], removeTree: [], move: [], create: [] };
  const failMove = new Set(failMoveFor.map(String));

  function add(props) {
    const n = { id: props.id || String(next++), parentId: props.parentId, title: props.title || "", dateAdded: props.dateAdded || clock++, children: props.url ? undefined : [] };
    if (props.url) n.url = props.url;
    if (props.folderType) n.folderType = props.folderType;
    if (props.unmodifiable) n.unmodifiable = props.unmodifiable;
    nodes.set(n.id, n);
    if (n.parentId !== undefined) {
      const p = nodes.get(n.parentId);
      const at = props.index === undefined ? p.children.length : Math.min(props.index, p.children.length);
      p.children.splice(at, 0, n.id);
    }
    return n;
  }
  add({ id: "0", title: "" });
  add({ id: "1", parentId: "0", title: "Bookmarks bar", folderType: "bookmarks-bar" });
  add({ id: "2", parentId: "0", title: "Other bookmarks", folderType: "other" });
  add({ id: "3", parentId: "0", title: "Mobile bookmarks", folderType: "mobile" });

  function view(n, deep) {
    const p = n.parentId === undefined ? null : nodes.get(n.parentId);
    const v = { id: n.id, title: n.title, dateAdded: n.dateAdded };
    if (n.parentId !== undefined) { v.parentId = n.parentId; v.index = p.children.indexOf(n.id); }
    if (n.url) v.url = n.url;
    else v.dateGroupModified = n.dateAdded;
    if (n.folderType) v.folderType = n.folderType;
    if (n.unmodifiable) v.unmodifiable = n.unmodifiable;
    if (!n.url && deep) v.children = n.children.map((id) => view(nodes.get(id), true));
    return v;
  }
  function must(id) {
    const n = nodes.get(String(id));
    if (!n) throw new Error(`Can't find bookmark for id. (${id})`);
    return n;
  }
  function isAncestor(a, b) { // is a an ancestor of b (or b itself)?
    let cur = nodes.get(b);
    while (cur) { if (cur.id === a) return true; cur = cur.parentId === undefined ? null : nodes.get(cur.parentId); }
    return false;
  }

  const api = {
    get: async (ids) => [].concat(ids).map((id) => view(must(id), false)),
    getChildren: async (id) => must(id).children.map((c) => view(nodes.get(c), false)),
    getSubTree: async (id) => [view(must(id), true)],
    getTree: async () => [view(nodes.get("0"), true)],
    search: async (q) => [...nodes.values()].filter((n) => n.id !== "0" && (`${n.title} ${n.url || ""}`).toLowerCase().includes(String(q).toLowerCase())).map((n) => view(n, false)),
    create: async (props) => {
      const parentId = String(props.parentId || "2");
      const parent = must(parentId);
      if (parent.url) throw new Error("Parameter 'parentId' does not specify a folder.");
      if (parentId === "0") throw new Error("Can't modify the root bookmark folders.");
      calls.create.push({ ...props });
      return view(add({ parentId, title: props.title, url: props.url, index: props.index }), false);
    },
    move: async (id, dest) => {
      const n = must(id);
      calls.move.push({ id: String(id), ...dest });
      if (failMove.has(String(id))) throw new Error("move failed (test)");
      if (n.parentId === "0" || n.id === "0") throw new Error("Can't modify the root bookmark folders.");
      const to = must(dest.parentId || n.parentId);
      if (isAncestor(n.id, to.id)) throw new Error("Can't move a folder into its own descendant.");
      const from = nodes.get(n.parentId);
      from.children.splice(from.children.indexOf(n.id), 1);
      n.parentId = to.id;
      const at = dest.index === undefined ? to.children.length : Math.min(dest.index, to.children.length);
      to.children.splice(at, 0, n.id);
      return view(n, false);
    },
    update: async (id, changes) => {
      const n = must(id);
      if (changes.title !== undefined) n.title = changes.title;
      if (changes.url !== undefined && n.url) n.url = changes.url;
      return view(n, false);
    },
    remove: async (id) => { calls.remove.push(String(id)); throw new Error("TabVault must never call bookmarks.remove"); },
    removeTree: async (id) => { calls.removeTree.push(String(id)); throw new Error("TabVault must never call bookmarks.removeTree"); },
  };

  // Test helpers, not part of the chrome API: build a tree, and drop a node the way the user does
  // in Chrome's own bookmark manager.
  const helpers = {
    folder: (parentId, title) => add({ parentId: String(parentId), title }).id,
    link: (parentId, title, url) => add({ parentId: String(parentId), title, url }).id,
    userDelete: (id) => {
      const n = must(id);
      const drop = (x) => { for (const c of x.children || []) drop(nodes.get(c)); nodes.delete(x.id); };
      const p = nodes.get(n.parentId);
      p.children.splice(p.children.indexOf(n.id), 1);
      drop(n);
    },
    parentOf: (id) => must(id).parentId,
    titleOf: (id) => must(id).title,
    urlOf: (id) => must(id).url,
    childrenOf: (id) => must(id).children.slice(),
    has: (id) => nodes.has(String(id)),
  };
  return { api, calls, ...helpers };
}
module.exports = { fakeBookmarks };
