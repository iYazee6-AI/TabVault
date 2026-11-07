const test = require("node:test");
const assert = require("node:assert/strict");
const { paletteActions, filterPalette } = require("../lib/palette.js");
const { SHORTCUTS } = require("../lib/shortcuts.js");
const { domainOf } = require("../lib/ui.js");

const extras = [{ id: "snapshot", label: "Snapshot now" }, { id: "export", label: "Export" }, { id: "settings", label: "Settings" }];
const actions = paletteActions(SHORTCUTS, extras);
const tabs = [
  { tab: { id: 1, title: "Release notes draft", url: "https://tracker.example.com/notes" }, windowId: 1 },
  { tab: { id: 2, title: "Snapshot testing guide", url: "https://docs.example.com/snap" }, windowId: 1 },
  { tab: { id: 3, title: "Inbox", url: "https://mail.example.com/" }, windowId: 2 },
];

test("paletteActions lists every bound shortcut by name, then the extras", () => {
  const bound = SHORTCUTS.filter((s) => s.action);
  assert.equal(actions.length, bound.length + extras.length);
  assert.deepEqual(actions.find((a) => a.id === "dupes").keys, ["d"]);
  assert.equal(actions[actions.length - 1].id, "settings");
});

test("an empty query lists the actions only, in order", () => {
  const rows = filterPalette("", actions, tabs);
  assert.ok(rows.every((r) => r.kind === "action"));
  assert.equal(rows[0].action.id, actions[0].id);
});

test("ranking: a prefix match beats a word start beats a substring; actions win ties", () => {
  const rows = filterPalette("snap", actions, tabs, { domainOf });
  assert.equal(rows[0].kind, "action");
  assert.equal(rows[0].action.id, "snapshot");
  assert.equal(rows[1].kind, "tab");
  assert.equal(rows[1].tab.id, 2);
  const notes = filterPalette("notes", actions, tabs, { domainOf });
  assert.equal(notes[0].tab.id, 1, "the word 'notes' starts a word in the title");
});

test("tabs match on every word in title or URL; misses are dropped; the limit holds", () => {
  const rows = filterPalette("mail inbox", actions, tabs, { domainOf });
  assert.deepEqual(rows.map((r) => r.tab && r.tab.id), [3]);
  assert.deepEqual(filterPalette("zzzz", actions, tabs), []);
  assert.equal(filterPalette("e", actions, tabs, { limit: 2 }).length, 2);
});

// Naqid finding 4: Option+K types a character in macOS text fields; only the search box keeps Alt+K.
test("Alt+K opens the palette on the page and in the search box, not in other fields", () => {
  const { opensPalette } = require("../lib/palette.js");
  const altK = { altKey: true, ctrlKey: false, metaKey: false, code: "KeyK" };
  assert.equal(opensPalette(altK, { editable: false }), true);
  assert.equal(opensPalette(altK, { editable: true, id: "search" }), true);
  assert.equal(opensPalette(altK, { editable: true, id: "ad-allow" }), false);
  assert.equal(opensPalette(altK, { editable: true, id: "" }), false);
  assert.equal(opensPalette({ ...altK, ctrlKey: true }, { editable: false }), false);
  assert.equal(opensPalette({ ...altK, code: "KeyJ" }, { editable: false }), false);
});
