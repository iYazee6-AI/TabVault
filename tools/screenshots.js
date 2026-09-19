// Captures the Chrome Web Store screenshots and the small promo tile from the
// REAL extension: Playwright launches Chromium with an unpacked copy of
// TabVault loaded (the same way e2e/run.js does), seeds example windows, tabs
// and groups through the browser's own APIs, then photographs TabVault's own
// page. Nothing here is mocked: every pixel of the UI in the PNGs is the
// shipping app/index.html rendering real chrome.windows/chrome.tabGroups data.
//
// Run: npm run screenshots
//
// Output:
//   docs/store/screenshots/01..05-*.png   1280x800
//   docs/store/promo-tile-440x280.png     440x280 (from docs/store/promo-tile.html)
//
// The example pages are served locally on port 8771 (e2e/server.js owns 8765;
// the two must never collide) and Chromium is told to resolve *.example.com to
// that server, so the tab URLs read like ordinary sites instead of localhost.

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { pathToFileURL } = require("url");

const REPO = path.join(__dirname, "..");
const TMP = path.join(REPO, "tools", ".tmp");
const EXT_DIR = path.join(TMP, "ext");
const USER_DATA_DIR = path.join(TMP, "userdata");
const SHOTS = path.join(REPO, "docs", "store", "screenshots");
const PROMO_HTML = path.join(REPO, "docs", "store", "promo-tile.html");
const PROMO_PNG = path.join(REPO, "docs", "store", "promo-tile-440x280.png");

const PORT = 8771;
const WIDTH = 1280;
const HEIGHT = 800;

// ---------------------------------------------------------------------------
// Example pages. Each entry is one fixture page: a path on the local server, a
// host that Chromium maps to it, the title Chrome will read, and a colour for
// the generated favicon so the tab rows look like a real browser session.
// ---------------------------------------------------------------------------
const PAGES = [
  { host: "docs.example.com", p: "/manifest-v3", title: "Manifest V3 migration guide", color: "#0f766e", letter: "D" },
  { host: "docs.example.com", p: "/storage-quotas", title: "chrome.storage quotas explained", color: "#0f766e", letter: "D" },
  { host: "docs.example.com", p: "/tab-groups-api", title: "chrome.tabGroups API reference", color: "#0f766e", letter: "D" },
  { host: "docs.example.com", p: "/service-workers", title: "Service worker lifecycle", color: "#0f766e", letter: "D" },
  { host: "docs.example.com", p: "/startup-cost", title: "Measuring extension startup cost", color: "#0f766e", letter: "D" },
  { host: "news.example.com", p: "/weekly", title: "The Weekly Roundup", color: "#b45309", letter: "N" },
  { host: "news.example.com", p: "/browsers", title: "What changed in browsers this month", color: "#b45309", letter: "N" },
  { host: "blog.example.com", p: "/release-engineering", title: "Release engineering for small teams", color: "#6d28d9", letter: "B" },
  { host: "blog.example.com", p: "/keyboard-first", title: "Designing keyboard-first interfaces", color: "#6d28d9", letter: "B" },
  { host: "blog.example.com", p: "/css-nesting", title: "CSS nesting is everywhere now", color: "#6d28d9", letter: "B" },
  { host: "mail.example.com", p: "/inbox", title: "Inbox (12)", color: "#1d4ed8", letter: "M" },
  { host: "tracker.example.com", p: "/board", title: "Sprint board - Release 2.4", color: "#be123c", letter: "T" },
  { host: "tracker.example.com", p: "/notes", title: "Release notes draft - 2.4", color: "#be123c", letter: "T" },
  { host: "tracker.example.com", p: "/issue-418", title: "Duplicate finder ignores the hash", color: "#be123c", letter: "T" },
  { host: "wiki.example.com", p: "/release-checklist", title: "Release checklist", color: "#047857", letter: "W" },
  { host: "wiki.example.com", p: "/onboarding", title: "Onboarding - week one", color: "#047857", letter: "W" },
  { host: "shop.example.com", p: "/cart", title: "Your cart (3 items)", color: "#c2410c", letter: "S" },
  { host: "shop.example.com", p: "/desk-lamp", title: "Adjustable desk lamp", color: "#c2410c", letter: "S" },
  { host: "shop.example.com", p: "/gift-ideas", title: "Gift ideas", color: "#c2410c", letter: "S" },
  { host: "recipes.example.com", p: "/slow-roast-tomato-pasta", title: "Slow-roast tomato pasta", color: "#15803d", letter: "R" },
  { host: "recipes.example.com", p: "/weekend-sourdough", title: "Weekend sourdough, step by step", color: "#15803d", letter: "R" },
  { host: "recipes.example.com", p: "/ramen-shortlist", title: "Tokyo ramen shortlist", color: "#15803d", letter: "R" },
  { host: "travel.example.com", p: "/kyoto", title: "Kyoto in five days", color: "#0369a1", letter: "T" },
  { host: "travel.example.com", p: "/flights", title: "Flights - March", color: "#0369a1", letter: "T" },
  { host: "music.example.com", p: "/focus", title: "Focus playlist", color: "#7c2d12", letter: "M" },
];

const byPath = new Map(PAGES.map((x) => [x.p, x]));
const U = {};
for (const x of PAGES) U[x.p] = "http://" + x.host + x.p;

function faviconHref(color, letter) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" rx="7" fill="' + color + '"/>' +
    '<text x="16" y="23" font-family="Arial, sans-serif" font-size="19" font-weight="bold" fill="#ffffff" text-anchor="middle">' +
    letter +
    "</text></svg>";
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function pageHtml(entry) {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    "<title>" + entry.title + "</title>",
    '<link rel="icon" href="' + faviconHref(entry.color, entry.letter) + '">',
    '<style>body{margin:0;padding:56px;font:16px/1.5 "Segoe UI",system-ui,Arial,sans-serif;color:#172026;background:#f4f6f8}h1{font-size:28px;margin:0 0 12px}</style>',
    "</head><body>",
    "<h1>" + entry.title + "</h1>",
    "<p>" + entry.host + entry.p + "</p>",
    "</body></html>",
  ].join("");
}

function startServer() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(String(req.url || "/").split("?")[0]);
    const entry = byPath.get(pathname);
    if (!entry) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(pageHtml(entry));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => {
      console.log("fixture pages on http://127.0.0.1:" + PORT + " (mapped to *.example.com)");
      resolve(server);
    });
  });
}

// Same shipping-file list tools/pack.js uses, so the browser loads exactly what
// the store package would contain.
function buildExtensionCopy() {
  fs.rmSync(EXT_DIR, { recursive: true, force: true });
  fs.mkdirSync(EXT_DIR, { recursive: true });
  for (const entry of ["manifest.json", "background.js", "app", "lib", "icons"]) {
    fs.cpSync(path.join(REPO, entry), path.join(EXT_DIR, entry), { recursive: true });
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  buildExtensionCopy();

  const server = await startServer();
  let context = null;

  try {
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      viewport: { width: WIDTH, height: HEIGHT },
      args: [
        "--disable-extensions-except=" + EXT_DIR,
        "--load-extension=" + EXT_DIR,
        "--host-resolver-rules=MAP *.example.com 127.0.0.1:" + PORT,
        "--window-size=1400,980",
      ],
    });

    // Re-acquire the worker on every use: an MV3 service worker can be recycled
    // at any point and a stale handle throws "Target closed" (same reason
    // e2e/run.js does this).
    async function worker() {
      let w = context.serviceWorkers()[0];
      if (!w) w = await context.waitForEvent("serviceworker", { timeout: 15000 });
      return w;
    }
    const sw = async (fn, arg) => (await worker()).evaluate(fn, arg);

    const extId = new URL((await worker()).url()).host;

    // Open TabVault before creating any fixture window, so the app page lands
    // in the harness's own (focused) window rather than a fixture one.
    const app = await context.newPage();
    await app.goto("chrome-extension://" + extId + "/app/index.html");
    await app.waitForSelector("#toolbar");

    // Drop the harness window's leftover blank tab so the only thing left in
    // that window is TabVault itself, which the page excludes from its own
    // listing. Without this an "about:blank" row shows up in the screenshots.
    await sw(async (prefix) => {
      const own = (await chrome.tabs.query({ url: prefix + "*" }))[0];
      const others = (await chrome.tabs.query({ windowId: own.windowId })).filter((t) => t.id !== own.id).map((t) => t.id);
      if (others.length) await chrome.tabs.remove(others);
    }, "chrome-extension://" + extId + "/");

    // ---- seed three example windows ----------------------------------------
    // Three is deliberate: a .window column is a fixed 320px, so a fourth one
    // would be sliced in half by the right edge of a 1280-wide screenshot.
    const newWindow = (urls, left, top) =>
      sw(
        ({ u, l, t }) => chrome.windows.create({ url: u, focused: false, left: l, top: t, width: 1080, height: 760 }),
        { u: urls, l: left, t: top }
      );

    const research = await newWindow(
      [U["/manifest-v3"], U["/storage-quotas"], U["/tab-groups-api"], U["/service-workers"], U["/weekly"], U["/browsers"], U["/keyboard-first"], U["/css-nesting"], U["/startup-cost"], U["/release-engineering"]],
      40,
      40
    );
    const work = await newWindow(
      [U["/inbox"], U["/board"], U["/notes"], U["/issue-418"], U["/release-checklist"], U["/onboarding"], U["/storage-quotas"]],
      80,
      80
    );
    const personal = await newWindow(
      [U["/cart"], U["/desk-lamp"], U["/gift-ideas"], U["/kyoto"], U["/flights"], U["/slow-roast-tomato-pasta"], U["/weekend-sourdough"], U["/ramen-shortlist"], U["/focus"], U["/weekly"]],
      120,
      120
    );

    // Wait until every fixture tab has actually committed its URL; titles and
    // favicons arrive with it, and the group/pin steps below match on URL.
    const deadline = Date.now() + 30000;
    for (;;) {
      const live = await sw(() => chrome.tabs.query({}).then((ts) => ts.map((t) => String(t.url || ""))));
      const wanted = PAGES.map((x) => "http://" + x.host + x.p);
      if (wanted.every((u) => live.includes(u))) break;
      if (Date.now() > deadline) throw new Error("fixture tabs did not finish loading: " + JSON.stringify(live));
      await sleep(500);
    }
    await sleep(1500);

    async function tabsOf(windowId) {
      const list = await sw((id) => chrome.tabs.query({ windowId: id }), windowId);
      return list.slice().sort((a, b) => a.index - b.index);
    }
    const pick = (list, suffix) => list.find((t) => String(t.url || "").endsWith(suffix));

    // createProperties.windowId is required: without it chrome.tabs.group puts
    // the new group in the CURRENT window (the one holding TabVault), which
    // silently drags the tabs out of their own window.
    const makeGroup = async (windowId, suffixes, title, color) => {
      const list = await tabsOf(windowId);
      const ids = suffixes.map((s) => pick(list, s).id);
      await sw(
        async ({ tabIds, windowId: wid, title: gt, color: gc }) => {
          const gid = await chrome.tabs.group({ tabIds, createProperties: { windowId: wid } });
          await chrome.tabGroups.update(gid, { title: gt, color: gc });
        },
        { tabIds: ids, windowId, title, color }
      );
    };

    await makeGroup(research.id, ["/manifest-v3", "/storage-quotas", "/tab-groups-api", "/service-workers"], "Reading", "yellow");
    await makeGroup(work.id, ["/board", "/notes", "/issue-418"], "Release 2.4", "blue");
    await makeGroup(personal.id, ["/kyoto", "/flights"], "Japan", "green");

    const workTabs = await tabsOf(work.id);
    await sw((id) => chrome.tabs.update(id, { pinned: true }), pick(workTabs, "/inbox").id);

    // ---- seed a snapshot history ------------------------------------------
    // Real snapshot records built by the extension's own lib/snapshots.js from
    // the live session, back-dated so the list looks like a normal day's
    // history instead of five identical rows.
    await sw(async () => {
      const windows = await chrome.windows.getAll({ populate: true });
      const groups = await chrome.tabGroups.query({});
      const own = chrome.runtime.getURL("");
      const full = self.TabVault.buildSession({ windows, groups, now: Date.now(), excludeUrlPrefix: own });
      const slice = (n) => ({ ...full, windows: full.windows.slice(0, n) });
      const now = Date.now();
      const minutes = (m) => now - m * 60000;
      const plan = [
        { session: slice(3), reason: "change", at: minutes(14) },
        { session: slice(3), reason: "change", at: minutes(96) },
        { session: slice(2), reason: "change", at: minutes(233) },
        { session: slice(1), reason: "startup", at: minutes(391) },
      ];
      const snapshots = plan
        .map((x) => self.TabVault.makeSnapshot(x.session, x.reason, x.at))
        .sort((a, b) => b.takenAt - a.takenAt);
      await chrome.storage.local.set({ snapshots });
    });

    await app.bringToFront();
    await app.evaluate(() => window.TabVaultApp.refresh());
    await app.waitForFunction(() => document.querySelectorAll("#grid .window").length >= 3, null, { timeout: 15000 });
    await app.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
    await sleep(600);

    const counts = await app.$eval("#counts", (e) => e.textContent);
    console.log("toolbar counts: " + counts);

    const shot = async (name) => {
      const file = path.join(SHOTS, name);
      await app.screenshot({ path: file });
      console.log("wrote " + file);
    };

    // 01 — the whole session at a glance
    await shot("01-all-windows.png");

    // 02 — search across every window
    await app.click("#search");
    await app.fill("#search", "release");
    await app.waitForFunction(() => document.querySelector("#counts").textContent.includes(" of "));
    await sleep(400);
    await shot("02-search.png");
    await app.fill("#search", "");
    await app.waitForFunction(() => !document.querySelector("#counts").textContent.includes(" of "));

    // 03 — multi-select and the bulk-action bar
    const personalTabs = await tabsOf(personal.id);
    const selection = [
      pick(personalTabs, "/cart").id,
      pick(personalTabs, "/desk-lamp").id,
      pick(personalTabs, "/gift-ideas").id,
      pick(personalTabs, "/weekly").id,
    ];
    for (const id of selection) {
      await app.click('.tab[data-tab="' + id + '"] input[type=checkbox]');
    }
    await app.waitForSelector("#selbar:not([hidden])");
    await sleep(400);
    await shot("03-selection.png");
    await app.click("#sel-clear");

    // 04 — the duplicate finder (two URLs are open twice in the seeded session)
    await app.click("#btn-dupes");
    await app.waitForSelector("#dialog h2");
    await app.waitForFunction(() => document.querySelector("#dialog").textContent.includes("duplicated URL"));
    await sleep(400);
    await shot("04-duplicates.png");
    await app.click("#dialog-backdrop", { position: { x: 5, y: 5 } });
    await app.waitForFunction(() => document.getElementById("dialog-backdrop").hidden);

    // 05 — snapshots, including a manual one taken right now through the UI
    await app.click("#btn-snapshots");
    await app.waitForSelector("#dialog h2");
    await app.click('#dialog button:has-text("Snapshot now")');
    await app.waitForFunction(() => document.querySelectorAll("#dialog .row[data-snapshot]").length >= 5, null, { timeout: 15000 });
    await sleep(800);
    await shot("05-snapshots.png");
    await app.click("#dialog-backdrop", { position: { x: 5, y: 5 } });

    // ---- promo tile --------------------------------------------------------
    const promo = await context.newPage();
    await promo.setViewportSize({ width: 440, height: 280 });
    await promo.goto(pathToFileURL(PROMO_HTML).href);
    await promo.waitForFunction(() => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0));
    await sleep(300);
    await promo.screenshot({ path: PROMO_PNG });
    console.log("wrote " + PROMO_PNG);
    await promo.close();

    console.log("done");
  } finally {
    if (context) await context.close().catch(() => {});
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});
