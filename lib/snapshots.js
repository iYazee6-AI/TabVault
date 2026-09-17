(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function (root) {
  function sessionApi() {
    return (typeof module === "object" && module.exports) ? require("./session.js") : root.TabVault;
  }

  function randomId() {
    const bytes = new Uint8Array(8);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function makeSnapshot(session, reason, now = Date.now()) {
    const { countTabs } = sessionApi();
    return { id: randomId(), takenAt: now, reason, pinned: false, windows: session.windows.length, tabs: countTabs(session), session };
  }

  function isSameSession(a, b) {
    const { stripVolatile } = sessionApi();
    if (!a || !b) return false;
    return JSON.stringify(stripVolatile(a)) === JSON.stringify(stripVolatile(b));
  }

  // Newest first; pinned snapshots are always kept; at most `keep` unpinned ones survive.
  function rotate(snapshots, keep) {
    const sorted = snapshots.slice().sort((x, y) => y.takenAt - x.takenAt);
    let unpinned = 0;
    return sorted.filter((s) => {
      if (s.pinned) return true;
      unpinned++;
      return unpinned <= keep;
    });
  }

  return { makeSnapshot, isSameSession, rotate };
});
