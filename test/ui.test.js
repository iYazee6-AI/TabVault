const test = require("node:test");
const assert = require("node:assert/strict");
const { tab, win } = require("./fake-data.js");
const { buildSession } = require("../lib/session.js");
const { findDuplicates } = require("../lib/dedupe.js");
const { formatCounts, domainOf, faviconColor, faviconLetter, FAVICON_COLORS, duplicateIds } = require("../lib/ui.js");

test("formatCounts: windows and tabs; a search shows matched of total; a selection is appended", () => {
  assert.equal(formatCounts({ windows: 3, tabs: 27 }), "3 win · 27 tabs");
  assert.equal(formatCounts({ windows: 3, tabs: 27, selected: 4 }), "3 win · 27 tabs · 4 sel");
  assert.equal(formatCounts({ windows: 3, tabs: 27, shown: 4 }), "3 win · 4 of 27 tabs");
  assert.equal(formatCounts({ windows: 3, tabs: 27, shown: 0, selected: 2 }), "3 win · 0 of 27 tabs · 2 sel");
  assert.equal(formatCounts({ windows: 1, tabs: 1 }), "1 win · 1 tab");
});

test("domainOf: bare host for web pages, scheme and host for browser pages, scheme alone otherwise", () => {
  assert.equal(domainOf("https://www.Example.com/a?b#c"), "example.com");
  assert.equal(domainOf("http://docs.example.com:8080/x"), "docs.example.com");
  assert.equal(domainOf("chrome://extensions/"), "chrome://extensions");
  assert.equal(domainOf("file:///C:/notes.txt"), "file");
  assert.equal(domainOf("about:blank"), "about");
  assert.equal(domainOf("not a url"), "");
});

test("faviconColor maps a domain to one of eight fixed colours, stably and case-insensitively", () => {
  assert.equal(FAVICON_COLORS.length, 8);
  const letters = ["a", "b", "c", "d", "e", "f", "g", "h"].map(faviconColor);
  assert.deepEqual([...new Set(letters)].sort(), [...FAVICON_COLORS].sort(), "a-h cover all eight colours");
  assert.equal(faviconColor("example.com"), "#475569");
  assert.equal(faviconColor("github.com"), "#C2410C");
  assert.equal(faviconColor("GitHub.COM"), faviconColor("github.com"));
  assert.equal(faviconLetter("docs.example.com"), "D");
  assert.equal(faviconLetter("chrome://extensions"), "C");
  assert.equal(faviconLetter(""), "?");
});

test("duplicateIds flags every copy the duplicate finder would close, never the kept one", () => {
  const s = buildSession({ windows: [
    win({ id: 1, tabs: [tab({ id: 1, url: "https://a.com/x#1", lastAccessed: 10 }), tab({ id: 2, url: "https://a.com/x#2", lastAccessed: 30 }), tab({ id: 3, url: "https://b.com/" })] }),
    win({ id: 2, tabs: [tab({ id: 4, url: "https://A.com/x/", lastAccessed: 20 })] }),
  ], groups: [] });
  assert.deepEqual([...duplicateIds(findDuplicates(s, { ignoreHash: true }))].sort((a, b) => a - b), [1, 4]);
  assert.equal(duplicateIds(findDuplicates(s, { ignoreHash: false })).size, 0);
  assert.equal(duplicateIds([]).size, 0);
});
