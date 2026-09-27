const test = require("node:test");
const assert = require("node:assert/strict");
const { SHORTCUTS, HINTS, findShortcut, hintText } = require("../lib/shortcuts.js");

test("every shortcut has key caps and a label; no key or action is bound twice", () => {
  for (const s of SHORTCUTS) {
    assert.ok(Array.isArray(s.display) && s.display.length > 0 && s.display.every((k) => typeof k === "string" && k.trim()), `bad display in ${JSON.stringify(s)}`);
    assert.ok(typeof s.label === "string" && s.label.trim(), `missing label in ${JSON.stringify(s)}`);
    assert.ok(Array.isArray(s.keys), `keys must be an array in ${JSON.stringify(s)}`);
    if (s.action) assert.ok(s.keys.length > 0, `action ${s.action} has no key`);
  }
  const keys = SHORTCUTS.flatMap((s) => s.keys);
  assert.equal(new Set(keys).size, keys.length, `a key is bound twice: ${JSON.stringify(keys)}`);
  const actions = SHORTCUTS.filter((s) => s.action).map((s) => s.action);
  assert.equal(new Set(actions).size, actions.length, `an action appears twice: ${JSON.stringify(actions)}`);
});

test("every 1.0 binding is still in the table, plus j k x g d", () => {
  for (const key of ["/", "ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Enter", " ", "Delete", "Escape", "?", "j", "k", "x", "g", "d"]) {
    assert.ok(findShortcut(key), `no shortcut for ${JSON.stringify(key)}`);
  }
  assert.equal(findShortcut("j").action, findShortcut("ArrowDown").action);
  assert.equal(findShortcut("k").action, findShortcut("ArrowUp").action);
  assert.equal(findShortcut("x").action, findShortcut(" ").action);
  assert.equal(findShortcut("q"), null);
});

test("the hint strip reads exactly as the spec says and names only bound keys", () => {
  assert.equal(hintText(), "/ search · j k move · x select · g group · d duplicates · ? all shortcuts");
  for (const [keys] of HINTS) for (const k of keys.split(" ")) assert.ok(findShortcut(k), `hint key ${k} is not bound`);
});
