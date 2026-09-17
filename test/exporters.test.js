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
