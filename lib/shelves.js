(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  // Shelves (1.3): named, append-only lists of saved tabs that are never rotated out. Kept in
  // chrome.storage.local as an index ("shelfIndex": [{ id, name, chunks, updatedAt }]) plus the
  // items in chunks of 200 ("shelf:<id>:<n>", the newest chunk last). The item count is derived
  // from the chunks, never stored. Every write goes through the worker's shelf queue; the page
  // only reads. area: a chrome.storage area (or anything with promise-returning get/set/remove).
  const SHELF_INDEX_KEY = "shelfIndex";
  const CHUNK = 200;
  const DEDUP_MS = 60000; // the same URL on the same shelf within a minute is saved once
  const NAME_MAX = 60;

  function chunkKey(id, n) { return `shelf:${id}:${n}`; }

  function randomId(prefix) {
    const bytes = new Uint8Array(6);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function cleanName(name) {
    return String(name || "").trim().slice(0, NAME_MAX);
  }

  // tab: { url, title, favIconUrl }; group: { id, title, color } of the tab's group, or null.
  function shelfItem(tab, { savedAt = Date.now(), ruleId = null, group = null } = {}) {
    const fav = String(tab.favIconUrl || "");
    const item = {
      id: randomId("i"),
      url: String(tab.url || tab.pendingUrl || ""),
      title: String(tab.title || "").slice(0, 500),
      favIconUrl: fav.startsWith("data:") && fav.length > 2048 ? "" : fav,
      savedAt,
      ruleId: ruleId || null,
    };
    if (group && typeof group === "object") item.group = { id: group.id, title: String(group.title || ""), color: String(group.color || "grey") };
    return item;
  }

  async function listShelves(area) {
    const { [SHELF_INDEX_KEY]: index = [] } = await area.get(SHELF_INDEX_KEY);
    return Array.isArray(index) ? index : [];
  }

  async function createShelf(area, name, now = Date.now()) {
    const clean = cleanName(name);
    if (!clean) throw new Error("A shelf needs a name.");
    const index = await listShelves(area);
    const shelf = { id: randomId("s"), name: clean, chunks: 0, updatedAt: now };
    await area.set({ [SHELF_INDEX_KEY]: [...index, shelf] });
    return shelf;
  }

  // [[items of chunk 0], [items of chunk 1], ...] for shelf meta { id, chunks }.
  async function readChunks(area, shelf) {
    const keys = Array.from({ length: shelf.chunks || 0 }, (_, n) => chunkKey(shelf.id, n));
    if (!keys.length) return [];
    const got = await area.get(keys);
    return keys.map((k) => (Array.isArray(got[k]) ? got[k] : []));
  }

  async function readShelf(area, id) {
    const shelf = (await listShelves(area)).find((s) => s.id === id);
    if (!shelf) return [];
    return (await readChunks(area, shelf)).flat();
  }

  function itemCount(chunks) {
    return (chunks || []).reduce((n, c) => n + c.length, 0);
  }

  function pack(items) {
    const out = [];
    for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
    return out;
  }

  // Appends items to shelf `id`; the same URL saved on this shelf within a minute is skipped.
  // Only the last chunk (and any new ones) is rewritten, unless a chunk in the middle was left
  // short by a removal: then the whole shelf is packed again. The written chunks are read back
  // and every new item checked before this resolves; a write that cannot be read back throws.
  async function appendItems(area, id, items, { now = Date.now() } = {}) {
    const index = await listShelves(area);
    const shelf = index.find((s) => s.id === id);
    if (!shelf) throw new Error("That shelf is gone.");
    const chunks = await readChunks(area, shelf);
    const recent = chunks.slice(-2).flat();
    const fresh = [];
    let skipped = 0;
    for (const it of items || []) {
      if (!it || !it.url) continue;
      const dup = recent.concat(fresh).some((x) => x.url === it.url && Math.abs((it.savedAt || 0) - (x.savedAt || 0)) < DEDUP_MS);
      if (dup) { skipped++; continue; }
      fresh.push(it);
    }
    if (!fresh.length) return { added: 0, skipped, ids: [] };
    const shortMiddle = chunks.slice(0, -1).some((c) => c.length < CHUNK);
    const writes = {};
    let next;
    if (shortMiddle) {
      next = pack(chunks.flat().concat(fresh));
      next.forEach((c, n) => { writes[chunkKey(id, n)] = c; });
    } else {
      const from = Math.max(chunks.length - 1, 0);
      const tail = pack((chunks[from] || []).concat(fresh));
      next = chunks.slice(0, from).concat(tail);
      tail.forEach((c, n) => { writes[chunkKey(id, from + n)] = c; });
    }
    const chunkKeys = Object.keys(writes);
    writes[SHELF_INDEX_KEY] = index.map((s) => (s.id === id ? { ...s, chunks: next.length, updatedAt: now } : s));
    await area.set(writes);
    const back = await area.get(chunkKeys);
    const stored = new Set(chunkKeys.flatMap((k) => (Array.isArray(back[k]) ? back[k] : []).map((x) => x && x.id)));
    if (!fresh.every((x) => stored.has(x.id))) throw new Error("The shelf could not be read back after writing.");
    const stale = [];
    for (let n = next.length; n < chunks.length; n++) stale.push(chunkKey(id, n));
    if (stale.length) await area.remove(stale);
    return { added: fresh.length, skipped, ids: fresh.map((x) => x.id) };
  }

  // Removes items by id, rewriting only the chunks that held them; empty chunks at the end are
  // dropped. A chunk left short in the middle waits for the next append to be packed again.
  async function removeItems(area, id, itemIds) {
    const index = await listShelves(area);
    const shelf = index.find((s) => s.id === id);
    if (!shelf) return { removed: 0 };
    const drop = new Set(itemIds || []);
    const chunks = await readChunks(area, shelf);
    const writes = {};
    let removed = 0;
    chunks.forEach((c, n) => {
      const kept = c.filter((x) => !drop.has(x.id));
      if (kept.length === c.length) return;
      removed += c.length - kept.length;
      chunks[n] = kept;
      writes[chunkKey(id, n)] = kept;
    });
    if (!removed) return { removed: 0 };
    let count = chunks.length;
    while (count > 0 && chunks[count - 1].length === 0) count--;
    const stale = [];
    for (let n = count; n < chunks.length; n++) { stale.push(chunkKey(id, n)); delete writes[chunkKey(id, n)]; }
    writes[SHELF_INDEX_KEY] = index.map((s) => (s.id === id ? { ...s, chunks: count, updatedAt: Date.now() } : s));
    await area.set(writes);
    if (stale.length) await area.remove(stale);
    return { removed };
  }

  async function deleteShelf(area, id) {
    const index = await listShelves(area);
    const shelf = index.find((s) => s.id === id);
    if (!shelf) return;
    await area.set({ [SHELF_INDEX_KEY]: index.filter((s) => s.id !== id) });
    const keys = Array.from({ length: shelf.chunks || 0 }, (_, n) => chunkKey(id, n));
    if (keys.length) await area.remove(keys);
  }

  function groupKey(g) { return `${g.title}|${g.color}`; }

  // Where each item goes when it is opened in a window whose groups are `groups`: into an
  // existing group with the same title and colour (groupId), or a new one shared by every item of
  // that title and colour (newKey), or no group.
  function groupTargets(items, groups) {
    return (items || []).map((item) => {
      if (!item.group) return { item, groupId: null, newKey: null };
      const hit = (groups || []).find((g) => (g.title || "") === item.group.title && (g.color || "grey") === item.group.color);
      return hit ? { item, groupId: hit.id, newKey: null } : { item, groupId: null, newKey: groupKey(item.group) };
    });
  }

  // A shelf as a one-window session (for Export and Open all through the restore path).
  function shelfToSession(shelf, items) {
    const groups = [];
    const byKey = new Map();
    const tabs = (items || []).map((it, i) => {
      let groupId = null;
      if (it.group) {
        const key = groupKey(it.group);
        if (!byKey.has(key)) { byKey.set(key, groups.length + 1); groups.push({ id: groups.length + 1, title: it.group.title, color: it.group.color, collapsed: false }); }
        groupId = byKey.get(key);
      }
      return { id: i + 1, index: i, title: it.title || it.url, url: it.url, favIconUrl: it.favIconUrl || "", pinned: false, muted: false, groupId };
    });
    // Chrome keeps a group's tabs together: order by first appearance of each group.
    const firstAt = new Map();
    tabs.forEach((t) => { const k = t.groupId === null ? `t${t.id}` : `g${t.groupId}`; if (!firstAt.has(k)) firstAt.set(k, t.index); });
    const ordered = tabs.slice().sort((a, b) => {
      const ka = firstAt.get(a.groupId === null ? `t${a.id}` : `g${a.groupId}`);
      const kb = firstAt.get(b.groupId === null ? `t${b.id}` : `g${b.groupId}`);
      return ka - kb || a.index - b.index;
    }).map((t, i) => ({ ...t, index: i }));
    return { schema: 1, capturedAt: null, windows: [{ id: 1, type: "normal", state: "normal", incognito: false, windowName: shelf.name, bounds: { left: 0, top: 0, width: 0, height: 0 }, groups, tabs: ordered }] };
  }

  // The shelving half of an idle run (or of "Move to shelf"): for each shelf, write the tabs'
  // items, read them back, and only then close those tabs. A failed or unreadable write closes
  // nothing and counts as failed. picks: [{ id, shelfId, ruleId }]; tabsById / groupsById: Maps of
  // the live tabs and groups; removeTabs(ids) closes; onSaved(ids, shelf) runs before the close
  // (the worker tags the Recently closed entries with it).
  async function executeShelve(area, picks, { tabsById, groupsById = new Map(), now = Date.now(), removeTabs, onSaved = () => {} } = {}) {
    let shelved = 0;
    let failed = 0;
    const byShelf = new Map();
    for (const p of picks || []) {
      if (!byShelf.has(p.shelfId)) byShelf.set(p.shelfId, []);
      byShelf.get(p.shelfId).push(p);
    }
    const index = await listShelves(area).catch(() => []);
    for (const [shelfId, list] of byShelf) {
      const shelf = index.find((s) => s.id === shelfId);
      const ready = list.filter((p) => tabsById.has(p.id));
      failed += list.length - ready.length;
      if (!shelf || !ready.length) { if (!shelf) failed += ready.length; continue; }
      const items = ready.map((p) => {
        const tab = tabsById.get(p.id);
        const g = typeof tab.groupId === "number" && tab.groupId >= 0 ? groupsById.get(tab.groupId) : null;
        return shelfItem(tab, { savedAt: now, ruleId: p.ruleId, group: g ? { id: g.id, title: g.title, color: g.color } : null });
      });
      try {
        await appendItems(area, shelfId, items, { now });
      } catch {
        failed += ready.length;
        continue;
      }
      const ids = ready.map((p) => p.id);
      try {
        await onSaved(ids, shelf);
        await removeTabs(ids);
        shelved += ids.length;
      } catch {
        failed += ids.length;
      }
    }
    return { shelved, failed };
  }

  // Closes the tabs one at a time, so a tab that vanished between the plan and the close (the
  // user closed it) does not make chrome.tabs.remove reject the whole list and leave the others
  // open with their items already on the shelf. remove(id) closes one tab.
  async function closeEach(ids, remove) {
    const closed = [];
    const missing = [];
    for (const id of ids || []) {
      try { await remove(id); closed.push(id); } catch { missing.push(id); }
    }
    return { closed, missing };
  }

  return { SHELF_INDEX_KEY, SHELF_CHUNK: CHUNK, closeEach, chunkKey, shelfItem, listShelves, createShelf, readChunks, readShelf, itemCount, appendItems, removeItems, deleteShelf, groupTargets, shelfToSession, executeShelve };
});
