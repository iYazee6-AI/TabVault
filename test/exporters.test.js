const test = require("node:test");
const assert = require("node:assert/strict");
const { tab, win } = require("./fake-data.js");
const { buildSession } = require("../lib/session.js");
const { toJsonFile, parseImport } = require("../lib/exporters.js");

test("toJsonFile names the file by local time and wraps the session", () => {
  const s = buildSession({ windows: [win({ id: 1, tabs: [tab({ id: 1 })] })], groups: [] });
  const now = new Date(2026, 8, 17, 9, 5).getTime();
  const f = toJsonFile(s, { now, version: "1.0.0" });
  assert.equal(f.filename, "tabvault-2026-09-17-0905.json");
  const parsed = JSON.parse(f.text);
  assert.equal(parsed.schema, 1);
  assert.equal(parsed.exportedAt, now);
  assert.deepEqual(parsed.app, { name: "TabVault", version: "1.0.0" });
  assert.equal(parsed.windows[0].tabs[0].id, 1);
});

test("parseImport round-trips an export and rejects bad files", () => {
  const s = buildSession({ windows: [win({ id: 1, tabs: [tab({ id: 1, url: "https://a.com/" })] })], groups: [] });
  const f = toJsonFile(s, { now: 1, version: "1.0.0" });
  const back = parseImport(f.text);
  assert.equal(back.windows[0].tabs[0].url, "https://a.com/");
  assert.throws(() => parseImport("{"), /not valid JSON/i);
  assert.throws(() => parseImport(JSON.stringify({ schema: 2, windows: [] })), /schema/i);
  assert.throws(() => parseImport(JSON.stringify({ schema: 1 })), /windows/i);
  assert.throws(() => parseImport(JSON.stringify({ schema: 1, windows: [{ tabs: [{ title: "x" }] }] })), /url/i);
});

test("windowName is optional: kept through export and import, dropped when blank or not a string", () => {
  const s = buildSession({ windows: [win({ id: 1, tabs: [tab({ id: 1 })] }), win({ id: 2, tabs: [tab({ id: 2 })] })], groups: [], windowNames: { 1: "Research" } });
  const back = parseImport(toJsonFile(s, { now: 1, version: "1.1.0" }).text);
  assert.equal(back.windows[0].windowName, "Research");
  assert.equal("windowName" in back.windows[1], false);
  const odd = parseImport(JSON.stringify({ schema: 1, windows: [
    { windowName: 42, tabs: [{ url: "https://a.com/" }] },
    { windowName: "   ", tabs: [{ url: "https://b.com/" }] },
    { windowName: ` ${"y".repeat(70)} `, tabs: [{ url: "https://c.com/" }] },
  ] }));
  assert.equal("windowName" in odd.windows[0], false);
  assert.equal("windowName" in odd.windows[1], false);
  assert.equal(odd.windows[2].windowName, "y".repeat(60));
});

// ---- 1.3: JSON round trip, Markdown both ways, the scheme filter -------------------
const { toMarkdown, parseMarkdown, parseImportText, isImportableUrl } = require("../lib/exporters.js");
const { group } = require("./fake-data.js");
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const BS = String.fromCharCode(92);

function richSession() {
  return buildSession({
    windows: [
      win({ id: 1, tabs: [
        tab({ id: 11, url: "https://a.example.com/one", title: "One", pinned: true }),
        tab({ id: 12, url: "https://a.example.com/two", title: "Two", groupId: 7 }),
        tab({ id: 13, url: "https://a.example.com/three", title: "Three", groupId: 7 }),
        tab({ id: 14, url: "https://a.example.com/four", title: "Four" }),
      ] }),
      win({ id: 2, tabs: [
        tab({ id: 21, url: "https://b.example.com/x", title: "Ex", groupId: 8 }),
        tab({ id: 22, url: "https://b.example.com/y", title: "Why" }),
      ] }),
    ],
    groups: [group({ id: 7, windowId: 1, title: "Reading", color: "yellow" }), group({ id: 8, windowId: 2, title: "", color: "blue" })],
    windowNames: { 1: "Research" },
  });
}

// What Markdown keeps: window names, group names, tab order, titles, URLs, pinned.
function reduce(s) {
  return s.windows.map((w) => ({
    windowName: w.windowName || "",
    tabs: w.tabs.slice().sort((a, b) => a.index - b.index).map((t) => {
      const g = t.groupId === null ? null : (w.groups || []).find((x) => x.id === t.groupId);
      return { url: t.url, title: t.title, pinned: Boolean(t.pinned), group: g ? g.title : null };
    }),
  }));
}

test("JSON round trip: the parsed export deep-equals the session, names and groups included", () => {
  const s = richSession();
  const back = parseImport(toJsonFile(s, { now: 5, version: "1.3.0" }).text);
  delete back.exportedAt;
  delete back.app;
  assert.deepEqual(back, JSON.parse(JSON.stringify(s)));
});

test("Markdown round trip keeps URLs, titles, window and group names, pinned and order", () => {
  const s = richSession();
  const md = toMarkdown(s, { title: "My tabs" });
  assert.match(md, /^# My tabs/);
  assert.ok(md.includes("## Research"), md);
  assert.ok(md.includes("## Window 2"), md);
  assert.ok(md.includes("### Reading"), md);
  assert.ok(md.includes("- [One](https://a.example.com/one) (pinned)"), md);
  const back = parseMarkdown(md);
  assert.deepEqual(reduce(back), reduce(s));
  assert.equal(back.schema, 1);
  assert.equal(back.skippedLinks, 0);
});

test("Markdown escapes ] ) | [ * _ and backticks in titles and restores them; odd URLs survive", () => {
  const nasty = "a]b)c|d[e*f_g`h" + BS + "i <script>";
  const s = buildSession({ windows: [win({ id: 3, tabs: [
    tab({ id: 31, title: nasty, url: "https://w.example.org/wiki/Foo_(bar)" }),
    tab({ id: 32, title: "Spaced", url: "file:///C:/My%20Docs/a b.html" }),
  ] })], groups: [] });
  const md = toMarkdown(s);
  assert.ok(!md.includes("[" + nasty + "]"), "the title went out unescaped");
  const back = parseMarkdown(md);
  assert.deepEqual(reduce(back), reduce(s));
});

test("bare URLs on their own line are tabs; no headings gives one window; CRLF parses like LF", () => {
  const text = ["Some notes", "https://x.example.com/a", "- https://x.example.com/b", "* [Cee](https://x.example.com/c)", "not a link: https://x.example.com/d in a sentence"].join(CR + NL);
  const s = parseMarkdown(text);
  assert.equal(s.windows.length, 1);
  assert.deepEqual(s.windows[0].tabs.map((t) => t.url), ["https://x.example.com/a", "https://x.example.com/b", "https://x.example.com/c"]);
  assert.equal(s.windows[0].tabs[2].title, "Cee");
  assert.equal(s.windows[0].tabs[0].title, "https://x.example.com/a");
});

test("headings start windows and groups; an empty heading or the end marker closes a group", () => {
  const text = ["## Work", "### Sprint", "- [A](https://a.example.com/)", "<!-- end of group -->", "- [B](https://b.example.com/)", "## Window 2", "- [C](https://c.example.com/)"].join(NL);
  const s = parseMarkdown(text);
  assert.equal(s.windows.length, 2);
  assert.equal(s.windows[0].windowName, "Work");
  assert.equal("windowName" in s.windows[1], false);
  const [a, b] = s.windows[0].tabs;
  assert.equal(s.windows[0].groups.length, 1);
  assert.equal(s.windows[0].groups[0].title, "Sprint");
  assert.equal(a.groupId, s.windows[0].groups[0].id);
  assert.equal(b.groupId, null);
});

test("the scheme filter: web and file pages pass, the rest are dropped and counted", () => {
  for (const ok of ["http://a.com/", "https://a.com/x", "file:///tmp/a.html", "about:blank"]) assert.equal(isImportableUrl(ok), true, ok);
  for (const bad of ["javascript:alert(1)", "data:text/html,hi", "chrome://settings", "chrome-extension://abc/x.html", "about:config", "ftp://a.com/f", "edge://flags", "view-source:https://a.com", "", "nonsense"]) assert.equal(isImportableUrl(bad), false, bad);
  const md = ["- [ok](https://a.com/)", "- [js](javascript:alert(1))", "- [data](data:text/plain,x)", "- [set](chrome://settings)", "- [ext](chrome-extension://abc/p.html)", "- [about](about:config)", "- [ftp](ftp://a.com/f)"].join(NL);
  const s = parseMarkdown(md);
  assert.deepEqual(s.windows[0].tabs.map((t) => t.url), ["https://a.com/"]);
  assert.equal(s.skippedLinks, 6);
});

test("JSON imports get the same filter; a file left with no tab is refused", () => {
  const data = { schema: 1, windows: [
    { id: 1, groups: [], tabs: [{ id: 1, index: 0, url: "https://a.com/" }, { id: 2, index: 1, url: "javascript:void(0)" }] },
    { id: 2, groups: [], tabs: [{ id: 3, index: 0, url: "chrome://newtab/" }] },
  ] };
  const back = parseImport(JSON.stringify(data));
  assert.equal(back.windows.length, 1);
  assert.deepEqual(back.windows[0].tabs.map((t) => t.url), ["https://a.com/"]);
  assert.equal(back.skippedLinks, 2);
  assert.throws(() => parseImport(JSON.stringify({ schema: 1, windows: [{ tabs: [{ url: "data:,x" }] }] })), /no web pages/i);
});

test("an empty or junk paste gives a clear error and nothing to open", () => {
  assert.throws(() => parseMarkdown(""), /no links/i);
  assert.throws(() => parseMarkdown("just some words" + NL + "and more"), /no links/i);
  assert.throws(() => parseMarkdown("- [x](javascript:alert(1))"), /no web pages/i);
  assert.throws(() => parseImportText("   "), /no links/i);
  assert.equal(parseImportText(toJsonFile(richSession(), { now: 1 }).text).windows.length, 2);
  assert.equal(parseImportText(toMarkdown(richSession())).windows.length, 2);
});
