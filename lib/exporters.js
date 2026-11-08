(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  const NL = String.fromCharCode(10);
  const CR = String.fromCharCode(13);
  const TAB = String.fromCharCode(9);
  const BS = String.fromCharCode(92);

  function pad(n) { return String(n).padStart(2, "0"); }

  function stamp(now) {
    const d = new Date(now);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  function toJsonFile(session, { now = Date.now(), version = "0" } = {}) {
    const payload = { ...session, exportedAt: now, app: { name: "TabVault", version } };
    return { filename: `tabvault-${stamp(now)}.json`, text: JSON.stringify(payload, null, 2) };
  }

  // What an import may open (1.3, JSON and Markdown alike): web pages, local files (the page
  // reports them when file access is off) and about:blank. javascript:, data:, chrome:,
  // chrome-extension:, other about: pages, ftp: and anything unparseable are dropped.
  function isImportableUrl(url) {
    const u = String(url || "");
    if (u === "about:blank") return true;
    let parsed;
    try { parsed = new URL(u); } catch { return false; }
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "file:";
  }

  // Drops the tabs the scheme filter refuses, then the windows left empty. Returns the count dropped.
  function filterImportable(session) {
    let skipped = 0;
    session.windows = session.windows.filter((w) => {
      const before = w.tabs.length;
      w.tabs = w.tabs.filter((t) => isImportableUrl(t.url));
      skipped += before - w.tabs.length;
      return w.tabs.length > 0;
    });
    return skipped;
  }

  function parseImport(text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error("This file is not valid JSON."); }
    if (!data || typeof data !== "object") throw new Error("This file is not a TabVault export.");
    if (data.schema !== 1) throw new Error(`Unsupported schema version: ${data.schema}. Expected 1.`);
    if (!Array.isArray(data.windows)) throw new Error("The file has no windows array.");
    data.windows.forEach((w, wi) => {
      if (!w || !Array.isArray(w.tabs)) throw new Error(`Window ${wi + 1} has no tabs array.`);
      w.tabs.forEach((t, ti) => {
        if (!t || typeof t.url !== "string" || !t.url) throw new Error(`Window ${wi + 1}, tab ${ti + 1} has no url.`);
      });
      if (!Array.isArray(w.groups)) w.groups = [];
      if ("windowName" in w) {
        const name = typeof w.windowName === "string" ? w.windowName.trim().slice(0, 60) : "";
        if (name) w.windowName = name;
        else delete w.windowName;
      }
    });
    const skipped = filterImportable(data);
    if (!data.windows.length) throw new Error(skipped ? `This file has no web pages to restore (${skipped} link${skipped === 1 ? "" : "s"} skipped: not web pages).` : "This file has no web pages to restore.");
    if (skipped) data.skippedLinks = skipped;
    return data;
  }

  // ---- Markdown (1.3) -----------------------------------------------------------------
  // One "## Window name" heading per window (or "## Window 2"), one "### Group name" heading
  // per group, one "- [title](url)" line per tab, " (pinned)" after a pinned tab. When ungrouped
  // tabs follow a group, the END_GROUP comment closes it (invisible in rendered Markdown).
  const END_GROUP = "<!-- end of group -->";
  const UNNAMED_GROUP = "(unnamed group)";
  const TITLE_ESCAPES = new Set([BS, "[", "]", "(", ")", "`", "|", "*", "_", "<", ">"]);

  function oneLine(s) {
    return String(s || "").split(CR).join(" ").split(NL).join(" ").split(TAB).join(" ");
  }

  function escapeTitle(s) {
    let out = "";
    for (const ch of oneLine(s)) out += TITLE_ESCAPES.has(ch) ? BS + ch : ch;
    return out;
  }

  // Headings keep their text as typed; only a backslash is doubled so unescape() restores it.
  function escapeHeading(s) {
    return oneLine(s).trim().split(BS).join(BS + BS);
  }

  function isPunct(ch) {
    const c = ch.charCodeAt(0);
    return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
  }

  function unescape(s) {
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const ch = s.charAt(i);
      if (ch === BS && i + 1 < s.length && isPunct(s.charAt(i + 1))) { out += s.charAt(i + 1); i++; }
      else out += ch;
    }
    return out;
  }

  // A URL with a space, a parenthesis or an angle bracket goes in the <url> form.
  function urlOut(url) {
    const u = String(url || "");
    if (/[ ()<>]/.test(u) || u.includes(TAB)) return "<" + u.split("<").join("%3C").split(">").join("%3E") + ">";
    return u;
  }

  function toMarkdown(session, { title = "" } = {}) {
    const lines = [];
    if (title) lines.push("# " + escapeHeading(title), "");
    (session.windows || []).forEach((w, wi) => {
      if (wi) lines.push("");
      lines.push("## " + (w.windowName ? escapeHeading(w.windowName) : `Window ${wi + 1}`));
      let current = null;
      for (const t of (w.tabs || []).slice().sort((a, b) => a.index - b.index)) {
        const gid = t.groupId === null || t.groupId === undefined ? null : t.groupId;
        if (gid !== current) {
          if (gid !== null) {
            const g = (w.groups || []).find((x) => x.id === gid);
            lines.push("### " + (g && g.title ? escapeHeading(g.title) : UNNAMED_GROUP));
          } else {
            lines.push(END_GROUP);
          }
          current = gid;
        }
        lines.push(`- [${escapeTitle(t.title || t.url)}](${urlOut(t.url)})${t.pinned ? " (pinned)" : ""}`);
      }
    });
    return lines.join(NL) + NL;
  }

  function markdownFilename(now) {
    return `tabvault-${stamp(now)}.md`;
  }

  // Finds every [title](url) on a line (not ![image](src)); returns { title, url, end } each.
  function findLinks(line) {
    const out = [];
    let i = 0;
    while (i < line.length) {
      const open = line.indexOf("[", i);
      if (open < 0) break;
      if (open > 0 && line.charAt(open - 1) === BS) { i = open + 1; continue; }
      let j = open + 1;
      let depth = 1;
      while (j < line.length && depth) {
        const ch = line.charAt(j);
        if (ch === BS) { j += 2; continue; }
        if (ch === "[") depth++;
        else if (ch === "]") depth--;
        j++;
      }
      if (depth || line.charAt(j) !== "(") { i = open + 1; continue; }
      const titleRaw = line.slice(open + 1, j - 1);
      let k = j + 1;
      let url = "";
      if (line.charAt(k) === "<") {
        const close = line.indexOf(">", k + 1);
        if (close < 0) { i = open + 1; continue; }
        url = line.slice(k + 1, close);
        k = close + 1;
      } else {
        let paren = 0;
        const start = k;
        while (k < line.length) {
          const ch = line.charAt(k);
          if (ch === " " || ch === TAB) break;
          if (ch === "(") paren++;
          else if (ch === ")") { if (!paren) break; paren--; }
          k++;
        }
        url = line.slice(start, k);
      }
      const end = line.indexOf(")", k);
      if (end < 0) { i = open + 1; continue; }
      if (open > 0 && line.charAt(open - 1) === "!") { i = end + 1; continue; }
      out.push({ title: unescape(titleRaw).trim(), url: url.trim(), end: end + 1 });
      i = end + 1;
    }
    return out;
  }

  function stripListMarker(s) {
    const m = s.match(/^(?:[-*+]|[0-9]+[.)])[ ]+(.*)$/);
    return m ? m[1] : s;
  }

  // Markdown (or plain text) to the session shape parseImport returns, so restore is unchanged.
  // skippedLinks counts the links the scheme filter dropped.
  function parseMarkdown(text) {
    const lines = String(text || "").split(NL).map((l) => (l.endsWith(CR) ? l.slice(0, -1) : l));
    const windows = [];
    let ids = 1;
    let win = null;
    let groupId = null;
    let skipped = 0;
    let found = 0;
    const newWindow = (name) => {
      win = { id: ids++, type: "normal", state: "normal", focused: false, incognito: false, bounds: { left: 0, top: 0, width: 0, height: 0 }, groups: [], tabs: [] };
      if (name) win.windowName = name.slice(0, 60);
      windows.push(win);
      groupId = null;
    };
    const addTab = (title, url, pinned) => {
      found++;
      if (!isImportableUrl(url)) { skipped++; return; }
      if (!win) newWindow("");
      win.tabs.push({ id: ids++, index: win.tabs.length, title: title || url, url, favIconUrl: "", pinned: Boolean(pinned), muted: false, audible: false, active: false, discarded: false, groupId: pinned ? null : groupId, lastAccessed: null, openerTabId: null });
    };
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("<!--")) { if (trimmed.includes("end of group")) groupId = null; continue; }
      const heading = trimmed.match(/^(#{1,6})(?:[ ]+(.*))?$/);
      if (heading) {
        const level = heading[1].length;
        const name = unescape(String(heading[2] || "").replace(/[ ]+#+[ ]*$/, "").trim());
        if (level === 2) {
          if (win && !win.tabs.length) windows.pop();
          newWindow(/^Window [0-9]+$/.test(name) ? "" : name);
        } else if (level === 3) {
          if (!name) { groupId = null; continue; }
          if (!win) newWindow("");
          const g = { id: ids++, title: name === UNNAMED_GROUP ? "" : name.slice(0, 200), color: "grey", collapsed: false };
          win.groups.push(g);
          groupId = g.id;
        }
        continue;
      }
      const links = findLinks(trimmed);
      if (links.length) {
        links.forEach((l, n) => {
          const pinned = n === links.length - 1 && trimmed.slice(l.end).trim() === "(pinned)";
          addTab(l.title, l.url, pinned);
        });
        continue;
      }
      let bare = stripListMarker(trimmed);
      if (bare.startsWith("<") && bare.endsWith(">")) bare = bare.slice(1, -1);
      if (/^https?:[/][/][^ ]+$/i.test(bare)) addTab("", bare, false);
    }
    for (const w of windows) {
      const used = new Set(w.tabs.map((t) => t.groupId).filter((g) => g !== null));
      w.groups = w.groups.filter((g) => used.has(g.id));
    }
    const kept = windows.filter((w) => w.tabs.length);
    if (!found) throw new Error("No links found. Paste Markdown links like - [title](https://example.com) or one web address per line.");
    if (!kept.length) throw new Error(`No web pages to open: ${skipped} link${skipped === 1 ? "" : "s"} skipped (not web pages).`);
    return { schema: 1, capturedAt: null, browser: null, windows: kept, skippedLinks: skipped };
  }

  // A pasted text or a chosen file: JSON when it starts with "{", else Markdown or plain text.
  function parseImportText(text) {
    const t = String(text || "").trim();
    if (!t) throw new Error("No links found. Paste Markdown links or a TabVault JSON export.");
    return t.startsWith("{") ? parseImport(t) : parseMarkdown(t);
  }

  return { toJsonFile, parseImport, isImportableUrl, toMarkdown, parseMarkdown, parseImportText, markdownFilename };
});
