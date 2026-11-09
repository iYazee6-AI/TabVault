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

  // name: optional label shown in the Snapshots list (save and close names its snapshot).
  function makeSnapshot(session, reason, now = Date.now(), name = "") {
    const { countTabs } = sessionApi();
    const snap = { id: randomId(), takenAt: now, reason, pinned: false, windows: session.windows.length, tabs: countTabs(session), session };
    if (name) snap.name = String(name).slice(0, 120);
    return snap;
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

  // The change debounce (background.js scheduleSnapshot). pendingSince marks when the current run
  // of changes started; past the cap (max(10 x debounce, 5 min)) the pending alarm is left to fire
  // ("wait") instead of being pushed out again. If that alarm is gone (the pendingSince clear
  // failed after it fired), waiting would stop change snapshots for the session, so a stale
  // pendingSince with no alarm starts a new run instead. alarmPending is read only past the cap.
  // Returns "start" (set pendingSince = now, create the alarm), "rearm" (re-create the alarm) or "wait".
  function scheduleDecision({ pendingSince, now, debounceSeconds, alarmPending = true }) {
    if (pendingSince === undefined || pendingSince === null) return "start";
    const cap = Math.max(10 * debounceSeconds * 1000, 300000);
    if (now - pendingSince > cap) return alarmPending ? "wait" : "start";
    return "rearm";
  }

  return { makeSnapshot, isSameSession, rotate, scheduleDecision };
});
