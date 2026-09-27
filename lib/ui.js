(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  // Header counter: "3 win · 27 tabs · 4 sel"; while searching, "3 win · 4 of 27 tabs".
  // shown is null when no search is active.
  function formatCounts({ windows = 0, tabs = 0, shown = null, selected = 0 } = {}) {
    const noun = tabs === 1 ? "tab" : "tabs";
    const parts = [`${windows} win`, shown === null ? `${tabs} ${noun}` : `${shown} of ${tabs} ${noun}`];
    if (selected > 0) parts.push(`${selected} sel`);
    return parts.join(" · ");
  }

  // What a tab row shows in mono on the right: "example.com" for web pages (no "www."),
  // "chrome://extensions" for browser pages, "file" / "about" / "data" otherwise.
  function domainOf(url) {
    let u;
    try { u = new URL(url); } catch { return ""; }
    const host = u.hostname.toLowerCase();
    if (u.protocol === "http:" || u.protocol === "https:") return host.startsWith("www.") ? host.slice(4) : host;
    if (host) return `${u.protocol}//${host}`;
    return u.protocol.slice(0, -1);
  }

  // Letter-badge colours for tabs without a favicon. Each has at least 4.5:1 contrast
  // with the white letter drawn on it, in both themes.
  const FAVICON_COLORS = ["#2F6FDE", "#C2410C", "#0F766E", "#7C3AED", "#BE185D", "#15803D", "#475569", "#A16207"];

  // FNV-1a over every character of the lower-cased domain, then a murmur3-style finaliser
  // so the colour index depends on all 32 bits (plain FNV-1a mod 8 sees only each
  // character's low 3 bits, which made github.com and gitlab.com collide). Deterministic:
  // the same site always gets the same colour.
  function faviconColor(domain) {
    const s = String(domain || "").toLowerCase();
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return FAVICON_COLORS[(h >>> 0) % FAVICON_COLORS.length];
  }

  function faviconLetter(domain) {
    const m = String(domain || "").match(/[a-z0-9]/i);
    return m ? m[0].toUpperCase() : "?";
  }

  // groups: the result of findDuplicates(). The ids are every copy it would close,
  // that is every tab of a duplicated URL except the one it keeps.
  function duplicateIds(groups) {
    const out = new Set();
    for (const g of groups || []) for (const x of g.tabs) if (x.tab.id !== g.keepId) out.add(x.tab.id);
    return out;
  }

  return { formatCounts, domainOf, FAVICON_COLORS, faviconColor, faviconLetter, duplicateIds };
});
