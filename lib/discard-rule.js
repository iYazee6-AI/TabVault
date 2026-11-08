(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  // Auto-discard: which idle tabs the worker unloads at each 5-minute alarm. Pure; the worker
  // feeds it chrome.tabs.query results and calls chrome.tabs.discard on the ids it returns.
  const PROTECT_EMOJI = "📌"; // a group named with this first is never unloaded
  const RUN_CAP = 25; // a wake after sleep must not unload a hundred tabs at once; the rest wait

  // One host per line (commas and spaces also separate). "*.example.com" matches example.com
  // and every subdomain; "example.com" matches it and www.example.com. A pasted URL is reduced
  // to its host; anything that is not a host is dropped.
  function parseAllowlist(text) {
    const out = [];
    const flat = [9, 10, 13].reduce((s, c) => s.split(String.fromCharCode(c)).join(" "), String(text || ""));
    for (let raw of flat.split(/[ ,;]+/)) {
      raw = raw.trim().toLowerCase();
      if (!raw) continue;
      raw = raw.replace(/^[a-z][a-z0-9+.-]*:[/][/]/, "").split("/")[0].split("?")[0].split("#")[0].replace(/:[0-9]+$/, "");
      const wild = raw.startsWith("*.");
      let host = wild ? raw.slice(2) : raw;
      // A Unicode host (bücher.example) becomes its ASCII form, as Chrome reports tab hosts.
      if (/[^ -~]/.test(host)) {
        try { host = new URL("http://" + host).hostname.toLowerCase(); } catch { continue; }
      }
      if (!/^[a-z0-9-]+([.][a-z0-9-]+)*$/.test(host)) continue;
      const entry = wild ? "*." + host : host;
      if (!out.includes(entry)) out.push(entry);
    }
    return out;
  }

  // Web pages only: a file://server/share (or ftp:) address has a host but is never a site a
  // rule or the allowlist names, so it gets none.
  function hostOf(url) {
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.toLowerCase() : "";
    } catch { return ""; }
  }

  function hostAllowed(host, patterns) {
    if (!host) return false;
    for (const p of patterns || []) {
      if (p.startsWith("*.")) {
        const base = p.slice(2);
        if (host === base || host.endsWith("." + base)) return true;
      } else if (host === p || host === "www." + p) {
        return true;
      }
    }
    return false;
  }

  // tabs: chrome.tabs.query results; groups: chrome.tabGroups.query({}); settings: the
  // settings.autoDiscard object (lib/settings.js). Returns { ids, eligible }: ids, oldest
  // first and at most `cap`, to unload now; eligible, how many qualified before the cap.
  // Never: the active tab, an audible tab, an already unloaded tab, a tab an extension
  // marked as not discardable (autoDiscardable false; Chrome's own unsaved-form check does not
  // apply to chrome.tabs.discard, so no form promise is made), TabVault's own pages, a tab without lastAccessed (Chrome 121+;
  // skipped rather than guessed), a pinned tab while keepPinned is on, a tab in a group whose
  // name starts with the pin emoji, a tab on the allowlist, or one used within the threshold.
  function planDiscard(tabs, { settings, now = Date.now(), groups = [], ownPrefix = "", cap = RUN_CAP } = {}) {
    const s = settings || {};
    const idleMs = (Number(s.minutes) || 60) * 60000;
    const protectedGroups = new Set((groups || []).filter((g) => String(g.title || "").trimStart().startsWith(PROTECT_EMOJI)).map((g) => g.id));
    const allow = Array.isArray(s.allowlist) ? s.allowlist : [];
    const keepPinned = s.keepPinned !== false;
    const picked = [];
    for (const t of tabs || []) {
      if (t.active || t.audible || t.discarded) continue;
      if (t.autoDiscardable === false) continue;
      const url = String(t.url || t.pendingUrl || "");
      if (!url || (ownPrefix && url.startsWith(ownPrefix))) continue;
      if (typeof t.lastAccessed !== "number") continue;
      if (keepPinned && t.pinned) continue;
      if (typeof t.groupId === "number" && protectedGroups.has(t.groupId)) continue;
      if (hostAllowed(hostOf(url), allow)) continue;
      if (now - t.lastAccessed < idleMs) continue;
      picked.push(t);
    }
    picked.sort((a, b) => a.lastAccessed - b.lastAccessed);
    return { ids: picked.slice(0, cap).map((t) => t.id), eligible: picked.length };
  }

  // ---- idle rules (1.3) ----------------------------------------------------------------
  // A rule: { id, pattern, idleMinutes, action: "unload" | "shelve" | "never", shelfId, enabled,
  // previewedFor }. The first enabled rule whose pattern matches a tab decides; a tab no rule
  // matches falls back to the global setting. Only a shelving rule closes tabs, and only once its
  // dry run was shown for its current pattern, idle time and action (previewedFor === ruleKey(rule)).
  const LARGE_MATCH = 50; // a dry run matching more open tabs than this asks a second time

  // Two-level public suffixes: a pattern must leave a registrable domain, so "*.co.uk" (or
  // "co.uk") is refused like "*.com". A short list of the common ones, not the whole PSL.
  const TWO_LEVEL_SUFFIXES = [
    "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk",
    "com.au", "net.au", "org.au", "edu.au", "gov.au", "co.nz", "org.nz", "net.nz",
    "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp", "co.kr", "or.kr", "co.in", "net.in", "org.in", "gov.in",
    "com.br", "net.br", "org.br", "gov.br", "com.mx", "org.mx", "gob.mx", "com.ar", "com.co", "com.pe", "com.ve", "com.ec", "com.uy", "com.py", "com.bo", "com.do",
    "com.sa", "net.sa", "org.sa", "gov.sa", "edu.sa", "com.ae", "co.ae", "com.eg", "com.qa", "com.kw", "com.bh", "com.om", "com.jo", "com.lb", "co.il", "org.il",
    "com.tr", "org.tr", "net.tr", "gov.tr", "edu.tr", "co.za", "org.za", "gov.za", "web.za", "com.ng", "co.ke", "co.tz", "co.ug", "com.gh", "co.ma",
    "com.cn", "net.cn", "org.cn", "gov.cn", "com.hk", "org.hk", "com.tw", "org.tw", "com.sg", "com.my", "com.ph", "com.vn", "co.th", "in.th", "or.th", "co.id", "or.id", "com.pk", "com.bd", "com.np", "com.lk",
    "com.ua", "co.ua", "com.ru", "com.pl", "co.at", "or.at", "co.hu", "com.gr", "com.cy", "com.mt", "co.no", "com.es", "com.pt", "co.it",
    "github.io", "gitlab.io", "pages.dev", "netlify.app", "vercel.app", "herokuapp.com", "blogspot.com", "appspot.com", "web.app", "firebaseapp.com", "azurewebsites.net", "cloudfront.net",
  ];

  // null when the pattern is one site that leaves a registrable domain, else the reason.
  function patternError(text) {
    const list = parseAllowlist(text);
    if (!list.length) return "Type one site, like news.example.com, or *.example.com for it and its subdomains.";
    if (list.length > 1) return "One site per rule.";
    const wild = list[0].startsWith("*.");
    const host = wild ? list[0].slice(2) : list[0];
    const labels = host.split(".");
    if (labels.length === 4 && labels.every((l) => /^[0-9]{1,3}$/.test(l))) return wild ? "A wildcard needs a domain name, not an address." : null;
    if (labels.length < 2 || (labels.length === 2 && TWO_LEVEL_SUFFIXES.includes(host))) return `"${list[0]}" covers a whole domain ending; name one site, like example.${host}.`;
    return null;
  }

  // The pattern as stored: the first host parseAllowlist finds, lower case.
  function normalizePattern(text) {
    return parseAllowlist(text)[0] || "";
  }

  // What a dry run was shown for: the pattern, the idle time and the action, so a dry run made
  // as Unload or Never does not unlock the same rule once it is switched to Shelve.
  function ruleKey(rule) {
    return `${rule.pattern}|${rule.idleMinutes}|${rule.action}`;
  }

  function ruleUnlocked(rule) {
    return rule.action !== "shelve" || rule.previewedFor === ruleKey(rule);
  }

  // After a dry run that matched matchCount open tabs: may the switch unlock now?
  function dryRunUnlock(matchCount, confirmed) {
    const large = matchCount > LARGE_MATCH;
    return { unlocked: !large || Boolean(confirmed), needsConfirm: large && !confirmed };
  }

  // tabs: chrome.tabs.query({}); groups: chrome.tabGroups.query({}); settings: withDefaults(...).
  // opts: { ownPrefix, cap, windows: [{ id, type }], shelfIds: Set of existing shelves, force }.
  // Returns { unload: [tab ids], shelve: [{ id, shelfId, ruleId }], detail: [{ id, action, ruleId }],
  // eligible, waiting, skipped: { exempt, never } }. Unloads come first, then shelves, each oldest
  // idle first, at most cap (25) in all. A shelving rule never plans the last tab of the last
  // normal window: that tab is unloaded instead. Incognito tabs are never planned by a rule (the
  // global setting still covers them, as in 1.2).
  function planIdle(tabs, groups, settings, now = Date.now(), { ownPrefix = "", cap = RUN_CAP, windows = null, shelfIds = null, force = false } = {}) {
    const s = settings || {};
    const ad = s.autoDiscard || {};
    const rules = (Array.isArray(s.idleRules) ? s.idleRules : []).filter((r) => r && r.enabled && ruleUnlocked(r) && (r.action !== "shelve" || !shelfIds || shelfIds.has(r.shelfId)));
    const globalOn = Boolean(ad.enabled) || force;
    const globalMs = (Number(ad.minutes) || 60) * 60000;
    const keepPinned = ad.keepPinned !== false;
    const protectedGroups = new Set((groups || []).filter((g) => String(g.title || "").trimStart().startsWith(PROTECT_EMOJI)).map((g) => g.id));
    const unloads = [];
    const shelves = [];
    const skipped = { exempt: 0, never: 0 };
    for (const t of tabs || []) {
      const url = String(t.url || t.pendingUrl || "");
      if (!url || (ownPrefix && url.startsWith(ownPrefix))) continue;
      // A tab still loading (or known only by its pendingUrl) is left for the next run.
      const loading = t.status === "loading" || (!t.url && Boolean(t.pendingUrl));
      if (loading || t.active || t.audible || t.autoDiscardable === false || typeof t.lastAccessed !== "number" || (keepPinned && t.pinned) || (typeof t.groupId === "number" && protectedGroups.has(t.groupId))) { skipped.exempt++; continue; }
      const idle = now - t.lastAccessed;
      const rule = t.incognito ? null : rules.find((r) => hostAllowed(hostOf(url), [r.pattern]));
      if (rule) {
        if (rule.action === "never") { skipped.never++; continue; }
        if (idle < rule.idleMinutes * 60000) continue;
        if (rule.action === "shelve") shelves.push({ t, ruleId: rule.id, shelfId: rule.shelfId });
        else if (!t.discarded) unloads.push({ t, ruleId: rule.id });
        continue;
      }
      if (!globalOn || t.discarded || idle < globalMs) continue;
      unloads.push({ t, ruleId: null });
    }
    const oldest = (a, b) => a.t.lastAccessed - b.t.lastAccessed;
    shelves.sort(oldest);
    if (windows) {
      const normal = new Set(windows.filter((w) => !w.type || w.type === "normal").map((w) => w.id));
      const total = (tabs || []).filter((x) => normal.has(x.windowId)).length;
      const closing = shelves.filter((x) => normal.has(x.t.windowId));
      if (closing.length && total - closing.length <= 0) {
        const last = closing[closing.length - 1];
        shelves.splice(shelves.indexOf(last), 1);
        if (!last.t.discarded) unloads.push({ t: last.t, ruleId: last.ruleId });
      }
    }
    unloads.sort(oldest);
    const takeU = unloads.slice(0, cap);
    const takeS = shelves.slice(0, Math.max(0, cap - takeU.length));
    const eligible = unloads.length + shelves.length;
    return {
      unload: takeU.map((x) => x.t.id),
      shelve: takeS.map((x) => ({ id: x.t.id, shelfId: x.shelfId, ruleId: x.ruleId })),
      detail: [...takeU.map((x) => ({ id: x.t.id, action: "unload", ruleId: x.ruleId })), ...takeS.map((x) => ({ id: x.t.id, action: "shelve", ruleId: x.ruleId }))],
      eligible,
      waiting: eligible - takeU.length - takeS.length,
      skipped,
    };
  }

  // The dry run: what this rule (as drafted, treated as on and unlocked, in its place among the
  // others) would do right now, with no cap and the global setting left out; matchCount is how many
  // open, non-incognito tabs its pattern matches at all, whatever their idle time.
  function dryRunRule(rule, tabs, groups, settings, now = Date.now(), opts = {}) {
    const draft = { ...rule, enabled: true, previewedFor: ruleKey(rule) };
    const list = Array.isArray(settings.idleRules) ? settings.idleRules.slice() : [];
    const at = list.findIndex((r) => r.id === rule.id);
    if (at >= 0) list[at] = draft; else list.push(draft);
    const s = { ...settings, idleRules: list, autoDiscard: { ...(settings.autoDiscard || {}), enabled: false } };
    const shelfIds = new Set([...(opts.shelfIds || []), draft.shelfId]);
    const plan = planIdle(tabs, groups, s, now, { ...opts, shelfIds, cap: Infinity, force: false });
    const mine = new Set(plan.detail.filter((d) => d.ruleId === rule.id).map((d) => d.id));
    const own = opts.ownPrefix || "";
    const matchCount = (tabs || []).filter((t) => !t.incognito && !(own && String(t.url || "").startsWith(own)) && hostAllowed(hostOf(t.url || t.pendingUrl || ""), [draft.pattern])).length;
    return { tabs: (tabs || []).filter((t) => mine.has(t.id)), matchCount, action: draft.action };
  }

  function defaultTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // The line under the rules: "last run 12:40: 7 unloaded, 3 shelved" (plus failures and the ones
  // left for the next run). lastRun: { at, unloaded, shelved, failed, waiting } from storage.session.
  function lastRunText(lastRun, fmtTime = defaultTime) {
    if (!lastRun || typeof lastRun.at !== "number") return "Not run yet in this browser session.";
    let text = `last run ${fmtTime(lastRun.at)}: ${lastRun.unloaded || 0} unloaded, ${lastRun.shelved || 0} shelved`;
    if (lastRun.failed) text += `, ${lastRun.failed} could not be handled`;
    if (lastRun.waiting) text += `, ${lastRun.waiting} wait for the next run`;
    return text;
  }

  return { PROTECT_EMOJI, RUN_CAP, LARGE_MATCH, TWO_LEVEL_SUFFIXES, parseAllowlist, hostAllowed, hostOf, planDiscard, planIdle, dryRunRule, patternError, normalizePattern, ruleKey, ruleUnlocked, dryRunUnlock, lastRunText };
});
