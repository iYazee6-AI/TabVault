(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  // The one defaults table: the page (app/app.js) and the worker (background.js) both read it,
  // so a new setting is added here and nowhere else. Stored under chrome.storage.local "settings".
  const IDLE_MINUTES = [15, 30, 60, 120, 240];
  const BADGE_MODES = ["total", "unloaded", "off"];
  // Idle rules (1.3): one site pattern, an idle time, an action. RULE_IDLE_MINUTES adds a day.
  const RULE_IDLE_MINUTES = [15, 30, 60, 120, 240, 1440];
  const RULE_ACTIONS = ["unload", "shelve", "never"];
  const IDLE_RULES_VERSION = 1;

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
    idleRules: [],
  });

  // A stored rule is cleaned, never trusted: an unknown action becomes unload, an unknown idle
  // time an hour; a shelving rule with no shelf is off. Rules without an id or a pattern are dropped.
  function cleanRule(r) {
    if (!r || typeof r !== "object") return null;
    const pattern = typeof r.pattern === "string" ? r.pattern.trim().toLowerCase() : "";
    if (!pattern) return null;
    const id = typeof r.id === "string" && r.id ? r.id : "";
    if (!id) return null;
    const action = RULE_ACTIONS.includes(r.action) ? r.action : "unload";
    const shelfId = action === "shelve" && typeof r.shelfId === "string" && r.shelfId ? r.shelfId : null;
    return {
      id,
      pattern,
      idleMinutes: RULE_IDLE_MINUTES.includes(r.idleMinutes) ? r.idleMinutes : 60,
      action,
      shelfId,
      enabled: action === "shelve" && !shelfId ? false : r.enabled === undefined ? true : Boolean(r.enabled),
      previewedFor: typeof r.previewedFor === "string" ? r.previewedFor : "",
    };
  }

  function ruleId() {
    const bytes = new Uint8Array(5);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return "r" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Once, at worker start: the 1.2 allowlist ("never unload these sites") becomes never rules
  // ahead of any rule already there; the allowlist key stays one release for a downgrade.
  // raw: the stored settings object as it is (not withDefaults). Returns { settings, changed }.
  function migrateIdleRules(raw) {
    const s = raw && typeof raw === "object" ? raw : {};
    if (s.idleRulesVersion >= IDLE_RULES_VERSION) return { settings: s, changed: false };
    const rules = Array.isArray(s.idleRules) ? s.idleRules.slice() : [];
    const have = new Set(rules.map((r) => r && r.pattern));
    const allow = s.autoDiscard && Array.isArray(s.autoDiscard.allowlist) ? s.autoDiscard.allowlist : [];
    const added = [];
    for (const p of allow) {
      if (typeof p !== "string" || !p || have.has(p)) continue;
      have.add(p);
      added.push({ id: ruleId(), pattern: p, idleMinutes: 60, action: "never", shelfId: null, enabled: true, previewedFor: "" });
    }
    return { settings: { ...s, idleRules: [...added, ...rules], idleRulesVersion: IDLE_RULES_VERSION }, changed: true };
  }

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
    out.idleRules = Array.isArray(s.idleRules) ? s.idleRules.map(cleanRule).filter(Boolean) : [];
    if (!BADGE_MODES.includes(out.badge)) out.badge = DEFAULT_SETTINGS.badge;
    out.recordClosed = out.recordClosed !== false;
    return out;
  }

  return { DEFAULT_SETTINGS, IDLE_MINUTES, BADGE_MODES, RULE_IDLE_MINUTES, RULE_ACTIONS, withDefaults, cleanRule, migrateIdleRules, ruleId };
});
