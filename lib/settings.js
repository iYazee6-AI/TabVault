(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  // The one defaults table: the page (app/app.js) and the worker (background.js) both read it,
  // so a new setting is added here and nowhere else. Stored under chrome.storage.local "settings".
  const IDLE_MINUTES = [15, 30, 60, 120, 240];
  const BADGE_MODES = ["total", "unloaded", "off"];

  const DEFAULT_AUTO_DISCARD = Object.freeze({ enabled: false, minutes: 60, keepPinned: true, allowlist: [] });

  const DEFAULT_SETTINGS = Object.freeze({
    debounceSeconds: 30,
    keepSnapshots: 20,
    ignoreHash: true,
    theme: "system",
    showUrls: false,
    density: "comfortable",
    lazyRestore: true,
    badge: "total",
    recordClosed: true,
    autoDiscard: DEFAULT_AUTO_DISCARD,
  });

  // Stored settings over the defaults; autoDiscard is merged one level deep so a store written
  // by 1.1 (no autoDiscard) or a partial object still yields every field. Unknown values fall
  // back to the default rather than reaching the worker.
  function withDefaults(stored) {
    const s = stored && typeof stored === "object" ? stored : {};
    const ad = s.autoDiscard && typeof s.autoDiscard === "object" ? s.autoDiscard : {};
    const out = { ...DEFAULT_SETTINGS, ...s };
    out.autoDiscard = {
      enabled: Boolean(ad.enabled),
      minutes: IDLE_MINUTES.includes(ad.minutes) ? ad.minutes : DEFAULT_AUTO_DISCARD.minutes,
      keepPinned: ad.keepPinned === undefined ? DEFAULT_AUTO_DISCARD.keepPinned : Boolean(ad.keepPinned),
      allowlist: Array.isArray(ad.allowlist) ? ad.allowlist.filter((x) => typeof x === "string" && x) : [],
    };
    if (!BADGE_MODES.includes(out.badge)) out.badge = DEFAULT_SETTINGS.badge;
    out.recordClosed = out.recordClosed !== false;
    return out;
  }

  return { DEFAULT_SETTINGS, IDLE_MINUTES, BADGE_MODES, withDefaults };
});
