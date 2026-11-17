(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function (root) {
  // Bookmarks (1.6), behind the optional "bookmarks" permission and the Bookmarks setting.
  //
  // THE RULE: TabVault never deletes a bookmark. chrome.bookmarks.remove and removeTree are never
  // called. Every removal, one or many, by the page, the worker or any later tool, goes through
  // moveToDeleted below, which moves the bookmark or folder into a folder named "Deleted" under
  // Other bookmarks (made when missing) and records where it came from. Emptying "Deleted" is the
  // user's own act, in Chrome's bookmark manager. Callers get the API only through safeBookmarks,
  // which does not carry remove or removeTree at all (test/bookmarks.test.js holds the rule).
  //
  // Nothing here touches the network; everything stays in chrome.bookmarks and chrome.storage.local.
  const inNode = typeof module === "object" && module.exports;
  function searchApi() { return inNode ? require("./search.js") : root.TabVault; }
  function paletteApi() { return inNode ? require("./palette.js") : root.TabVault; }
  function dedupeApi() { return inNode ? require("./dedupe.js") : root.TabVault; }

  const DELETED_TITLE = "Deleted";
  const TABVAULT_TITLE = "TabVault";
  const DELETED_ID_KEY = "bmDeletedFolderId";
  const TABVAULT_ID_KEY = "bmTabVaultFolderId";
  // bookmark id -> { id, title, url?, parentId, index, path: [folder titles from the root], movedAt }
  const TRASH_KEY = "bmTrash";
  const BACKUP_INDEX_KEY = "bmBackupIndex";
  const BACKUP_CHUNK = 500;
  const BULK_BACKUP_ABOVE = 10;
  const OPEN_FOLDER_ASK = 50;
  const BACKUPS_KEEP = 5;
  const BACKUP_SCHEMA = 1;
  const NAME_MAX = 100;
  const SEARCH_LIMIT = 30;

  // Only these methods of chrome.bookmarks are ever handed out. remove and removeTree are not
  // among them, so no caller holding this object can delete a bookmark.
  const SAFE_METHODS = Object.freeze(["get", "getChildren", "getRecent", "getSubTree", "getTree", "search", "create", "move", "update"]);
  function safeBookmarks(raw) {
    if (!raw) return null;
    const out = {};
    for (const m of SAFE_METHODS) if (typeof raw[m] === "function") out[m] = raw[m].bind(raw);
    return Object.freeze(out);
  }

  // What may be bookmarked or opened from a bookmark: web pages and local files. javascript:
  // (bookmarklets), data:, chrome: and the like are skipped, as the importers skip them.
  function isWebPage(url) {
    let u;
    try { u = new URL(String(url || "")); } catch { return false; }
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "file:";
  }

  function randomId(prefix) {
    const bytes = new Uint8Array(5);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function pad(n) { return String(n).padStart(2, "0"); }
  function stamp(now) {
    const d = new Date(now);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  // ---- the tree ------------------------------------------------------------------------------
  // getTree() gives [invisible root]; its children are the Bookmarks bar, Other bookmarks and
  // Mobile bookmarks (and a managed folder under policy).
  function topFolders(tree) {
    const top = Array.isArray(tree) ? tree[0] : tree;
    return (top && top.children) || [];
  }
  function otherFolderOf(tree) {
    const tops = topFolders(tree);
    return tops.find((n) => n.folderType === "other") || tops.find((n) => n.id === "2") || tops[1] || tops[0] || null;
  }

  // Map id -> { node, parentId, path } over the whole tree; path is the titles of the folders
  // above the node, the top folder first ("Bookmarks bar", "Work").
  function indexTree(tree) {
    const map = new Map();
    const walk = (n, parentId, path) => {
      map.set(n.id, { node: n, parentId, path });
      const here = n.parentId === undefined || n.id === "0" ? path : path.concat(n.title || "");
      for (const c of n.children || []) walk(c, n.id, here);
    };
    for (const top of Array.isArray(tree) ? tree : [tree]) walk(top, undefined, []);
    return map;
  }
  function isTopLevel(entry) {
    return !entry || entry.parentId === undefined || entry.parentId === "0";
  }
  function isInside(map, id, ancestorId) {
    let cur = map.get(id);
    while (cur) {
      if (cur.parentId === ancestorId) return true;
      cur = cur.parentId === undefined ? null : map.get(cur.parentId);
    }
    return false;
  }
  function subtreeSize(node) {
    let n = 1;
    for (const c of node.children || []) n += subtreeSize(c);
    return n;
  }

  // A folder TabVault owns, directly under Other bookmarks: found by the id stored under `key`
  // first (it may have been renamed; it still counts while it is a folder), then by its title
  // among Other bookmarks' folders, else created; the id is stored again either way. A folder the
  // user deleted is simply made again.
  async function ensureFolder(api, area, { key, title }) {
    const tree = await api.getTree();
    const other = otherFolderOf(tree);
    if (!other) throw new Error("Chrome has no Other bookmarks folder.");
    const map = indexTree(tree);
    const { [key]: storedId } = await area.get(key);
    if (storedId) {
      const hit = map.get(String(storedId));
      if (hit && !hit.node.url && !isTopLevel(hit)) return hit.node;
    }
    const byName = (other.children || []).find((n) => !n.url && n.title === title);
    const folder = byName || (await api.create({ parentId: other.id, title }));
    await area.set({ [key]: folder.id });
    return folder;
  }
  function ensureDeletedFolder(api, area) { return ensureFolder(api, area, { key: DELETED_ID_KEY, title: DELETED_TITLE }); }
  function ensureTabVaultFolder(api, area) { return ensureFolder(api, area, { key: TABVAULT_ID_KEY, title: TABVAULT_TITLE }); }

  // The stored Deleted folder's id when it still exists (for search and duplicates, which leave
  // its contents out); never creates anything.
  async function deletedFolderId(area, tree) {
    const { [DELETED_ID_KEY]: id } = await area.get(DELETED_ID_KEY);
    if (id && indexTree(tree).has(String(id))) return String(id);
    const other = otherFolderOf(tree);
    const byName = other && (other.children || []).find((n) => !n.url && n.title === DELETED_TITLE);
    return byName ? byName.id : null;
  }

  // ---- delete is a move ----------------------------------------------------------------------
  // Moves each bookmark or folder in `ids` into "Deleted". A top-level folder, an unmodifiable
  // (managed) node, the Deleted folder itself, anything already inside it, and anything whose
  // folder is moved in the same call are skipped (the last move with their folder). Where each
  // came from is written to TabVault's own storage (TRASH_KEY, keyed by bookmark id) before it is
  // moved, so a later restore can put it back; titles and addresses are never changed. More than
  // BULK_BACKUP_ABOVE bookmarks (folders count with everything in them) take a backup of the whole
  // tree first; if that backup fails, nothing is moved. Returns { moved, failed, skipped,
  // deletedFolderId, backup }.
  async function moveToDeleted(rawApi, area, ids, { now = Date.now(), keep = BACKUPS_KEEP, version = "0", reason = "before-delete" } = {}) {
    const api = safeBookmarks(rawApi);
    const deleted = await ensureDeletedFolder(api, area);
    const tree = await api.getTree();
    const map = indexTree(tree);
    const wanted = [...new Set((ids || []).map(String))];
    const picks = [];
    const skipped = [];
    for (const id of wanted) {
      const e = map.get(id);
      if (!e || isTopLevel(e) || e.node.unmodifiable || id === deleted.id || isInside(map, id, deleted.id)) { skipped.push(id); continue; }
      picks.push(e);
    }
    const pickIds = new Set(picks.map((e) => e.node.id));
    const top = picks.filter((e) => ![...pickIds].some((other) => other !== e.node.id && isInside(map, e.node.id, other)));
    for (const e of picks) if (!top.includes(e)) skipped.push(e.node.id);
    if (!top.length) return { moved: 0, failed: [], skipped, deletedFolderId: deleted.id, backup: null };
    const count = top.reduce((n, e) => n + subtreeSize(e.node), 0);
    let backup = null;
    if (count > BULK_BACKUP_ABOVE) backup = (await takeBackup(api, area, { reason, now, keep, version })).meta;
    const { [TRASH_KEY]: stored = {} } = await area.get(TRASH_KEY);
    const trash = pruneTrash(stored && typeof stored === "object" ? stored : {}, map, deleted.id);
    for (const e of top) {
      const n = e.node;
      const rec = { id: n.id, title: n.title || "", parentId: e.parentId, index: typeof n.index === "number" ? n.index : null, path: e.path.slice(), movedAt: now };
      if (n.url) rec.url = n.url;
      trash[n.id] = rec;
    }
    await area.set({ [TRASH_KEY]: trash });
    const moved = [];
    const failed = [];
    for (const e of top) {
      try { await api.move(e.node.id, { parentId: deleted.id }); moved.push(e.node.id); } catch (err) { failed.push({ id: e.node.id, error: String((err && err.message) || err) }); }
    }
    if (failed.length) {
      for (const f of failed) delete trash[f.id];
      await area.set({ [TRASH_KEY]: trash });
    }
    return { moved: moved.length, movedIds: moved, failed, skipped, deletedFolderId: deleted.id, backup };
  }

  // Records whose bookmark is gone (the user emptied Deleted) or no longer in Deleted (the user
  // moved it back) are dropped.
  function pruneTrash(trash, map, deletedId) {
    const out = {};
    for (const [id, rec] of Object.entries(trash)) {
      if (map.has(id) && isInside(map, id, deletedId)) out[id] = rec;
    }
    return out;
  }
  async function readTrash(area) {
    const { [TRASH_KEY]: t = {} } = await area.get(TRASH_KEY);
    return t && typeof t === "object" ? t : {};
  }

  // ---- save tabs as a bookmark folder -----------------------------------------------------------
  // A new folder `name` inside "TabVault" (under Other bookmarks, made when missing), one bookmark
  // per tab that is a web page, in order. More than BULK_BACKUP_ABOVE bookmarks take a backup first.
  async function saveTabsAsFolder(rawApi, area, { name, tabs, now = Date.now(), keep = BACKUPS_KEEP, version = "0" } = {}) {
    const api = safeBookmarks(rawApi);
    const all = Array.isArray(tabs) ? tabs : [];
    const links = all.filter((t) => t && isWebPage(t.url || t.pendingUrl));
    const skipped = all.length - links.length;
    if (!links.length) throw new Error(skipped ? `Nothing to bookmark: ${skipped} link${skipped === 1 ? " is" : "s are"} not a web page.` : "Nothing to bookmark.");
    const title = String(name || "").trim().slice(0, NAME_MAX) || `Saved tabs ${stamp(now)}`;
    let backup = null;
    if (links.length > BULK_BACKUP_ABOVE) backup = (await takeBackup(api, area, { reason: "before-save", now, keep, version })).meta;
    const parent = await ensureTabVaultFolder(api, area);
    const folder = await api.create({ parentId: parent.id, title });
    for (const t of links) {
      const url = String(t.url || t.pendingUrl);
      await api.create({ parentId: folder.id, title: String(t.title || "").slice(0, 500) || url, url });
    }
    return { folderId: folder.id, title, saved: links.length, skipped, backup };
  }

  // ---- backups ----------------------------------------------------------------------------------
  // A backup is the whole tree as a flat list in tree order (each folder before what it holds):
  // { id, parentId, index, title, url?, dateAdded, dateGroupModified?, folderType? }. The ids and
  // parent ids are Chrome's at the time; the top folders keep their folderType (or their place),
  // so a restore can match them to today's tree and recreate everything beneath in order, parents
  // first. Stored as BACKUP_INDEX_KEY (metadata, newest first) plus "bmBackup:<id>:<n>" chunks of
  // BACKUP_CHUNK nodes; the downloaded file holds the same nodes nested as a tree.
  function chunkKey(id, n) { return `bmBackup:${id}:${n}`; }

  function flattenTree(tree) {
    const out = [];
    const walk = (n) => {
      const rec = { id: n.id, parentId: n.parentId, index: n.index, title: n.title || "", dateAdded: n.dateAdded || null };
      if (n.url) rec.url = n.url;
      else if (n.dateGroupModified) rec.dateGroupModified = n.dateGroupModified;
      if (n.folderType) rec.folderType = n.folderType;
      if (n.unmodifiable) rec.unmodifiable = n.unmodifiable;
      out.push(rec);
      for (const c of n.children || []) walk(c);
    };
    for (const top of topFolders(tree)) walk(top);
    return out;
  }

  // The flat list nested again: top folders with children in index order.
  function nestNodes(nodes) {
    const byId = new Map();
    for (const n of nodes || []) {
      const copy = { ...n };
      if (!copy.url) copy.children = [];
      byId.set(n.id, copy);
    }
    const tops = [];
    for (const n of byId.values()) {
      const parent = n.parentId === undefined ? null : byId.get(n.parentId);
      if (parent && parent.children) parent.children.push(n);
      else tops.push(n);
    }
    const order = (list) => { list.sort((a, b) => (a.index || 0) - (b.index || 0)); for (const n of list) if (n.children) order(n.children); };
    order(tops);
    return tops;
  }

  function countNodes(nodes) {
    let bookmarks = 0, folders = 0;
    for (const n of nodes || []) { if (n.url) bookmarks++; else if (n.parentId !== "0" && n.parentId !== undefined) folders++; }
    return { bookmarks, folders };
  }

  async function listBackups(area) {
    const { [BACKUP_INDEX_KEY]: index = [] } = await area.get(BACKUP_INDEX_KEY);
    return Array.isArray(index) ? index : [];
  }

  // Takes a backup now: writes the chunks, reads them back and checks every node, and only then
  // adds it to the index; the oldest beyond `keep` are dropped. A write that cannot be read back
  // throws and leaves the index as it was. Returns { meta, nodes }.
  async function takeBackup(rawApi, area, { reason = "manual", now = Date.now(), keep = BACKUPS_KEEP, version = "0" } = {}) {
    const api = safeBookmarks(rawApi);
    const nodes = flattenTree(await api.getTree());
    const id = randomId("k");
    const writes = {};
    let chunks = 0;
    for (let i = 0; i < nodes.length; i += BACKUP_CHUNK) writes[chunkKey(id, chunks++)] = nodes.slice(i, i + BACKUP_CHUNK);
    const keys = Object.keys(writes);
    const fail = async (why) => { await area.remove(keys).catch(() => {}); throw new Error(why); };
    try { await area.set(writes); } catch (e) { return fail(`The bookmarks backup could not be written: ${(e && e.message) || e}`); }
    const back = await area.get(keys);
    const ok = keys.every((k) => Array.isArray(back[k]) && back[k].length === writes[k].length && back[k].every((n, i) => n && n.id === writes[k][i].id && n.url === writes[k][i].url));
    if (!ok) return fail("The bookmarks backup could not be read back after writing.");
    const counts = countNodes(nodes);
    const meta = { id, takenAt: now, reason, bookmarks: counts.bookmarks, folders: counts.folders, nodes: nodes.length, chunks, schema: BACKUP_SCHEMA, version };
    const index = await listBackups(area);
    const limit = Math.max(1, Math.floor(Number(keep) || BACKUPS_KEEP));
    const all = [meta, ...index.filter((m) => m && m.id !== id)];
    const kept = all.slice(0, limit);
    const dropped = all.slice(limit);
    try { await area.set({ [BACKUP_INDEX_KEY]: kept }); } catch (e) { return fail(`The bookmarks backup could not be listed: ${(e && e.message) || e}`); }
    const stale = dropped.flatMap((m) => Array.from({ length: m.chunks || 0 }, (_, n) => chunkKey(m.id, n)));
    if (stale.length) await area.remove(stale);
    return { meta, nodes };
  }

  // { meta, nodes } of a stored backup, or null when it is gone or incomplete.
  async function readBackup(area, id) {
    const meta = (await listBackups(area)).find((m) => m.id === id);
    if (!meta) return null;
    const keys = Array.from({ length: meta.chunks || 0 }, (_, n) => chunkKey(id, n));
    const got = keys.length ? await area.get(keys) : {};
    if (!keys.every((k) => Array.isArray(got[k]))) return null;
    const nodes = keys.flatMap((k) => got[k]);
    if (meta.nodes !== undefined && nodes.length !== meta.nodes) return null;
    return { meta, nodes };
  }

  // The download: the backup's nodes nested as a tree, with its metadata.
  function backupFile(meta, nodes, { version = "0" } = {}) {
    const payload = {
      format: "tabvault-bookmarks",
      schema: BACKUP_SCHEMA,
      takenAt: meta.takenAt,
      reason: meta.reason,
      counts: { bookmarks: meta.bookmarks, folders: meta.folders },
      app: { name: "TabVault", version },
      roots: nestNodes(nodes),
    };
    return { filename: `tabvault-bookmarks-${stamp(meta.takenAt)}.json`, text: JSON.stringify(payload, null, 2) };
  }

  // The standard bookmarks HTML file (the "Netscape" format every browser imports), from the
  // flat nodes of a backup or flattenTree(getTree()).
  function escapeHtml(s) {
    return String(s || "").split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;").split(String.fromCharCode(34)).join("&quot;");
  }
  function toBookmarksHtml(nodes, { now = Date.now() } = {}) {
    const NL = String.fromCharCode(10);
    const secs = (ms) => (ms ? String(Math.floor(ms / 1000)) : "");
    const lines = [
      "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
      "<!-- This is an automatically generated file.",
      "     It will be read and overwritten.",
      "     DO NOT EDIT! -->",
      "<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">",
      "<TITLE>Bookmarks</TITLE>",
      "<H1>Bookmarks</H1>",
      "<DL><p>",
    ];
    const walk = (list, depth) => {
      const ind = "    ".repeat(depth);
      for (const n of list) {
        const added = n.dateAdded ? ` ADD_DATE="${secs(n.dateAdded)}"` : "";
        if (n.url) { lines.push(`${ind}<DT><A HREF="${escapeHtml(n.url)}"${added}>${escapeHtml(n.title || n.url)}</A>`); continue; }
        const mod = n.dateGroupModified ? ` LAST_MODIFIED="${secs(n.dateGroupModified)}"` : "";
        const bar = n.folderType === "bookmarks-bar" ? " PERSONAL_TOOLBAR_FOLDER=\"true\"" : "";
        lines.push(`${ind}<DT><H3${added}${mod}${bar}>${escapeHtml(n.title)}</H3>`);
        lines.push(`${ind}<DL><p>`);
        walk(n.children || [], depth + 1);
        lines.push(`${ind}</DL><p>`);
      }
    };
    // The top folders' contents: the bar as its own folder, the others' items at the top level,
    // as Chrome's own export does.
    const tops = nestNodes(nodes);
    for (const top of tops) {
      if (top.folderType === "bookmarks-bar" || (!top.folderType && top.id === "1")) walk([top], 1);
      else walk(top.children || [], 1);
    }
    lines.push("</DL><p>");
    return { filename: `tabvault-bookmarks-${stamp(now)}.html`, text: lines.join(NL) + NL };
  }

  // ---- search, folders, duplicates -------------------------------------------------------------
  // The page's in-memory index: every bookmark (links) and every folder below the top ones, with
  // the folder path; the Deleted folder and what is in it are left out.
  function buildBookmarkIndex(tree, { deletedId = null } = {}) {
    const links = [];
    const folders = [];
    const walk = (n, path, top) => {
      if (deletedId && n.id === deletedId) return 0;
      if (n.url) { links.push({ id: n.id, title: n.title || n.url, url: n.url, path: path.join(" › "), dateAdded: n.dateAdded || 0 }); return isWebPage(n.url) ? 1 : 0; }
      const here = path.concat(n.title || "");
      let count = 0;
      const entry = top ? null : { id: n.id, title: n.title || "(unnamed folder)", path: path.join(" › "), count: 0 };
      if (entry) folders.push(entry);
      for (const c of n.children || []) count += walk(c, here, false);
      if (entry) entry.count = count;
      return count;
    };
    for (const t of topFolders(tree)) walk(t, [], true);
    return { links, folders };
  }

  // "b:" in the palette (lib/palette.js parsePaletteQuery). Every word must be in the title or the
  // address (a folder: its title or path), ranked as the saved search ranks; at most `limit` rows.
  function searchBookmarks(index, query, { limit = SEARCH_LIMIT } = {}) {
    const { terms, matches } = searchApi();
    const { textScore } = paletteApi();
    const words = terms(query);
    if (!words.length || !index) return [];
    const rows = [];
    for (const b of index.links || []) {
      if (!matches(b, words)) continue;
      rows.push({ kind: "bookmark", entry: b, score: Math.max(textScore(b.title, words), textScore(b.url, words) - 1, 0.5) });
    }
    for (const f of index.folders || []) {
      if (!f.count || !matches({ title: f.title, url: f.path }, words)) continue;
      rows.push({ kind: "bmFolder", entry: f, score: Math.max(textScore(f.title, words) + 0.25, 0.5) });
    }
    rows.sort((a, b) => b.score - a.score || (a.kind === b.kind ? 0 : a.kind === "bmFolder" ? -1 : 1));
    return rows.slice(0, limit);
  }

  // The web pages of a folder and every folder in it, in tree order, as a one-window session for
  // the restore path (lazy when lazy restore is on).
  function folderLinks(subtree) {
    const out = [];
    const walk = (n) => { if (n.url) { if (isWebPage(n.url)) out.push({ title: n.title || n.url, url: n.url }); return; } for (const c of n.children || []) walk(c); };
    for (const n of Array.isArray(subtree) ? subtree : [subtree]) walk(n);
    return out;
  }
  function folderToSession(title, links) {
    return { schema: 1, capturedAt: null, windows: [{ id: 1, type: "normal", state: "normal", incognito: false, windowName: String(title || "").slice(0, 60), bounds: { left: 0, top: 0, width: 0, height: 0 }, groups: [], tabs: (links || []).map((l, i) => ({ id: i + 1, index: i, title: l.title, url: l.url, favIconUrl: "", pinned: false, muted: false, groupId: null })) }] };
  }
  function openFolderNeedsConfirm(n) { return n > OPEN_FOLDER_ASK; }

  // Bookmarks sharing an address (normalised as the tab duplicates are, ignoreHash from the
  // settings), oldest first in each group: [{ key, items }]. Nothing is pre-ticked; the dialog
  // lets the user pick which to move to Deleted.
  function findBookmarkDuplicates(index, { ignoreHash = true } = {}) {
    const { normalizeUrl } = dedupeApi();
    const byKey = new Map();
    for (const b of (index && index.links) || []) {
      if (!isWebPage(b.url)) continue;
      const key = normalizeUrl(b.url, { ignoreHash });
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(b);
    }
    const out = [];
    for (const [key, items] of byKey) {
      if (items.length < 2) continue;
      out.push({ key, items: items.slice().sort((a, b) => (a.dateAdded || 0) - (b.dateAdded || 0)) });
    }
    return out.sort((a, b) => b.items.length - a.items.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  function backupReasonText(reason) {
    return reason === "manual" ? "backed up by you" : reason === "before-delete" ? "before a bulk delete" : reason === "before-save" ? "before saving tabs" : String(reason || "");
  }

  return {
    BOOKMARKS_PERMISSION: "bookmarks", DELETED_TITLE, TABVAULT_TITLE, DELETED_ID_KEY, TABVAULT_ID_KEY, TRASH_KEY, BACKUP_INDEX_KEY, BACKUP_CHUNK, BULK_BACKUP_ABOVE, OPEN_FOLDER_ASK, BACKUPS_KEEP, SAFE_METHODS,
    safeBookmarks, isWebPage, indexTree, otherFolderOf, ensureDeletedFolder, ensureTabVaultFolder, deletedFolderId,
    moveToDeleted, readTrash, saveTabsAsFolder,
    flattenTree, nestNodes, countNodes, takeBackup, listBackups, readBackup, backupFile, toBookmarksHtml, bookmarkChunkKey: chunkKey,
    buildBookmarkIndex, searchBookmarks, folderLinks, folderToSession, openFolderNeedsConfirm, findBookmarkDuplicates, backupReasonText,
  };
});
