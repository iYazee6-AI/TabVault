(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function (root) {
  // Snapshot storage, version 2: an index key holding each snapshot's metadata (newest first)
  // plus one key per snapshot holding the whole record. 1.x kept every snapshot under one
  // "snapshots" key rewritten on each write; migrate() moves that store over once.
  // area: a chrome.storage area (or any object with promise-returning get/set/remove).
  const STORAGE_VERSION = 2;
  const INDEX_KEY = "snapIndex";
  const LEGACY_KEY = "snapshots";
  const PREFIX = "snap:";

  function snapshotsApi() {
    return (typeof module === "object" && module.exports) ? require("./snapshots.js") : root.TabVault;
  }

  function keyOf(id) { return PREFIX + id; }

  function meta(s) {
    const m = { id: s.id, takenAt: s.takenAt, reason: s.reason, pinned: Boolean(s.pinned), windows: s.windows, tabs: s.tabs };
    if (s.name) m.name = s.name;
    return m;
  }

  // Returns "migrated", "fresh" or "current". A version-2 store is never touched.
  async function migrate(area) {
    const { storageVersion, [LEGACY_KEY]: legacy } = await area.get(["storageVersion", LEGACY_KEY]);
    if (storageVersion >= STORAGE_VERSION) return "current";
    const list = Array.isArray(legacy) ? legacy.filter((s) => s && s.id && s.session) : [];
    const sorted = list.slice().sort((a, b) => b.takenAt - a.takenAt);
    const items = { storageVersion: STORAGE_VERSION, [INDEX_KEY]: sorted.map(meta) };
    for (const s of sorted) items[keyOf(s.id)] = s;
    await area.set(items);
    if (legacy !== undefined) await area.remove(LEGACY_KEY);
    return list.length || legacy !== undefined ? "migrated" : "fresh";
  }

  async function listSnapshots(area) {
    const { [INDEX_KEY]: index = [] } = await area.get(INDEX_KEY);
    return Array.isArray(index) ? index : [];
  }

  async function getSnapshot(area, id) {
    const { [keyOf(id)]: snap = null } = await area.get(keyOf(id));
    return snap;
  }

  async function latestSnapshot(area) {
    const index = await listSnapshots(area);
    return index.length ? getSnapshot(area, index[0].id) : null;
  }

  // Adds snap, rotates (pinned kept, `keep` newest unpinned), removes the keys rotated out.
  // On a write error (quota) the oldest unpinned snapshot is dropped and the write retried once.
  async function addSnapshot(area, snap, keep) {
    const { rotate } = snapshotsApi();
    const index = await listSnapshots(area);
    let next = rotate([meta(snap), ...index], keep);
    const write = async (list) => {
      await area.set({ [keyOf(snap.id)]: snap, [INDEX_KEY]: list });
    };
    try {
      await write(next);
    } catch (e) {
      const idx = next.map((s) => s.pinned || s.id === snap.id).lastIndexOf(false);
      if (idx < 0) throw e;
      next = next.slice(0, idx).concat(next.slice(idx + 1));
      await write(next);
    }
    const kept = new Set(next.map((s) => s.id));
    const dropped = index.filter((s) => !kept.has(s.id)).map((s) => keyOf(s.id));
    if (dropped.length) await area.remove(dropped);
    return next;
  }

  async function deleteSnapshot(area, id) {
    const index = await listSnapshots(area);
    await area.set({ [INDEX_KEY]: index.filter((s) => s.id !== id) });
    await area.remove(keyOf(id));
  }

  async function pinSnapshot(area, id, pinned) {
    const index = await listSnapshots(area);
    const snap = await getSnapshot(area, id);
    const items = { [INDEX_KEY]: index.map((s) => (s.id === id ? { ...s, pinned: Boolean(pinned) } : s)) };
    if (snap) items[keyOf(id)] = { ...snap, pinned: Boolean(pinned) };
    await area.set(items);
  }

  return { STORAGE_VERSION, SNAP_INDEX_KEY: INDEX_KEY, snapshotKey: keyOf, migrate, listSnapshots, getSnapshot, latestSnapshot, addSnapshot, deleteSnapshot, pinSnapshot };
});
