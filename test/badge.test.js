const test = require("node:test");
const assert = require("node:assert/strict");
const { badgeText, countForBadge } = require("../lib/badge.js");

test("badgeText per mode: total, unloaded, off; empty at zero; 999+ past 999", () => {
  const c = { total: 27, unloaded: 4 };
  assert.equal(badgeText("total", c), "27");
  assert.equal(badgeText("unloaded", c), "4");
  assert.equal(badgeText("off", c), "");
  assert.equal(badgeText("unloaded", { total: 3, unloaded: 0 }), "");
  assert.equal(badgeText("total", { total: 1000 }), "999+");
  assert.equal(badgeText("total", { total: 999 }), "999");
});

test("countForBadge skips TabVault's own pages and counts discarded tabs", () => {
  const own = "chrome-extension://abc/";
  const tabs = [
    { url: "https://a.com/", discarded: false },
    { url: "https://b.com/", discarded: true },
    { url: own + "app/index.html", discarded: false },
    { url: "", pendingUrl: "https://c.com/", discarded: false },
  ];
  assert.deepEqual(countForBadge(tabs, own), { total: 3, unloaded: 1 });
});
