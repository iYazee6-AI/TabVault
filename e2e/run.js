const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const REPO = path.join(__dirname, "..");
const ROOT = path.join(__dirname, ".tmp");
const EXT_DIR = path.join(ROOT, "ext");
const USER_DATA_DIR = path.join(ROOT, "userdata");
const DOWNLOAD_DIR = path.join(ROOT, "downloads");
const BASE = "http://localhost:8765/test-pages";

const ORDER = ["A", "B", "C", "D", "E", "F", "G", "H", "I-a", "I-b", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "AA", "AB", "AC", "AD", "AE", "AF"];
const byId = new Map();
const consoleErrors = { worker: [], app: [] };

// Seeded up front so a run that crashes or exits early still reports which
// scenarios never got to run, instead of silently omitting them.
for (const id of ORDER) byId.set(id, { id, status: "NOT RUN", evidence: "harness did not reach this scenario" });

function record(id, status, evidence) {
  byId.set(id, { id, status, evidence });
  console.log(`\n[${status}] ${id}\n${evidence}\n`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function waitFor(fn, { timeout = 5000, interval = 100 } = {}) {
  const start = Date.now();
  let lastErr;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    if (Date.now() - start > timeout) throw lastErr || new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, interval));
  }
}

async function waitForTextContains(page, selector, substr, timeout = 5000) {
  await page.waitForFunction(
    ({ sel, s }) => {
      const el = document.querySelector(sel);
      return el && el.textContent && el.textContent.includes(s);
    },
    { sel: selector, s: substr },
    { timeout }
  );
  return page.$eval(selector, (el) => el.textContent);
}

function consoleErrorSnapshot() {
  return { app: consoleErrors.app.length, worker: consoleErrors.worker.length };
}
function newConsoleErrorsSince(snap) {
  return { app: consoleErrors.app.slice(snap.app), worker: consoleErrors.worker.slice(snap.worker) };
}

// A disconnected/crashed target throws various shapes of "gone" error
// depending on exactly when in its lifecycle it died; this environment's
// crash (see the note above scenario I-b) has been observed to produce all
// of these phrasings from Playwright.
function looksLikeDisconnect(err) {
  return /closed|destroyed|crashed|disconnected/i.test((err && err.message) || String(err));
}

// Builds a fresh copy of the extension under e2e/.tmp/ext, with Focus mode's optional
// host permission granted at install (below).
function buildExtensionCopy() {
  fs.rmSync(EXT_DIR, { recursive: true, force: true });
  fs.mkdirSync(EXT_DIR, { recursive: true });
  const entries = ["manifest.json", "background.js", "app", "lib", "icons"];
  for (const entry of entries) {
    fs.cpSync(path.join(REPO, entry), path.join(EXT_DIR, entry), { recursive: true });
  }
  // Focus mode (1.4) asks for <all_urls> at run time (optional_host_permissions); no one can
  // click Chrome's prompt here, so the copy grants it at install. AF walks the declined path
  // with self.focusPermissionOverride instead.
  const mf = path.join(EXT_DIR, "manifest.json");
  const m = JSON.parse(fs.readFileSync(mf, "utf8"));
  m.host_permissions = m.optional_host_permissions || [];
  delete m.optional_host_permissions;
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
}

function attachPageListeners(page) {
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.app.push(`${page.url()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => consoleErrors.app.push(`${page.url()}: ${String(err)}`));
}

async function main() {
  let server = null;
  let context = null;
  let ownPrefix = null;
  let appPage = null;

  const attachedWorkers = new WeakSet();

  // Always re-acquires a live service worker handle rather than trusting a
  // handle captured once at launch: the extension's MV3 service worker can
  // be torn down and respawned by Chrome (idle recycling, or as a side
  // effect of the environment crash documented at scenario I-b), and a
  // stale handle throws "Target ... closed" even though the browser itself
  // is fine. Every chrome.* call in this file goes through this.
  async function worker() {
    let w = context.serviceWorkers()[0];
    if (!w) w = await context.waitForEvent("serviceworker", { timeout: 10000 });
    if (!attachedWorkers.has(w)) {
      attachedWorkers.add(w);
      w.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.worker.push(msg.text());
      });
      w.on("pageerror", (err) => consoleErrors.worker.push(String(err)));
    }
    return w;
  }

  // Launches (or relaunches) the persistent-context browser, loads the
  // extension, and opens the app page as a second tab of the harness's own
  // (sole, therefore focused) browser window. Opening the app page before any
  // fixture window matters: chrome.windows.create defaults to focused:true,
  // so opening the app page any later would attach it (via
  // context.newPage()) to whichever fixture window was created most
  // recently instead of the harness window. Assigns the outer context/
  // ownPrefix/appPage directly rather than returning them, since every
  // caller just wants those refreshed in place (including after a
  // mid-scenario relaunch).
  async function launchAndOpenApp() {
    // A relaunch reuses the profile, and Playwright's Chromium dies on the first download of a
    // relaunched profile whose History database already records one (H's export does). Dropping
    // History (the downloads table lives there) avoids it; no scenario reads browsing history.
    const profileDir = path.join(USER_DATA_DIR, "Default");
    if (fs.existsSync(profileDir)) {
      for (const f of fs.readdirSync(profileDir)) if (f.startsWith("History")) fs.rmSync(path.join(profileDir, f), { force: true });
    }
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      acceptDownloads: true,
      args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
    });

    const w = await worker();
    const id = new URL(w.url()).host;
    ownPrefix = `chrome-extension://${id}/`;

    appPage = await context.newPage();
    attachPageListeners(appPage);
    await appPage.goto(`chrome-extension://${id}/app/index.html`);
    await appPage.waitForSelector("#toolbar");
  }

  // Waits for the environment crash (see scenario I-b) to fully settle, then
  // relaunches if the browser is actually gone. An immediate connectivity
  // check right after a discard-triggering click can still read "connected"
  // for a moment before the process actually dies (observed take ~150-300ms
  // in standalone repros), so a bare check without first waiting can miss a
  // disconnect that is already in progress.
  async function settleAndRelaunchIfDisconnected(label) {
    await new Promise((r) => setTimeout(r, 1500));
    if (!(context.browser() && context.browser().isConnected())) {
      console.log(`\nBrowser disconnected${label ? ` ${label}` : ""}; relaunching.\n`);
      await context.close().catch(() => {});
      await launchAndOpenApp();
      return true;
    }
    return false;
  }

  // Exercises the exact chrome.tabs.discard() call restoreSession() makes
  // (app/dialogs.js: chrome.tabs.discard(id).catch(() => {})), in isolation
  // on a freshly created real tab, as supporting evidence when the real
  // Restore flow couldn't be observed live. A standalone repro sweep showed
  // discard()'s own resolved Tab object is reliably observable (8/8) --
  // the crash instead hits any FOLLOW-UP call, so this reads discard()'s
  // own return value directly rather than a separate chrome.tabs.get()/
  // query() afterward, which reliably loses the race (failed 5/5 in that
  // sweep, even issued a full 1.5 real seconds later). Even so, the crash's
  // exact timing is racy enough that starting a fresh window+tabs from
  // scratch can occasionally lose too (observed as Chrome's own "No tab
  // with id" once a crash from a previous attempt was still underway), so
  // this retries a few times, relaunching the browser in between.
  async function runIsolatedDiscardCheck(oneUrl, twoUrl) {
    let isolated = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= 5 && !isolated; attempt++) {
      try {
        isolated = await (await worker()).evaluate(async (urls) => {
          const w = await chrome.windows.create({ url: urls, focused: false });
          await new Promise((r) => setTimeout(r, 500)); // let the fresh tabs finish navigating first
          const tabs = (await chrome.tabs.query({ windowId: w.id })).sort((a, b) => a.index - b.index);
          const nonFirst = tabs[1];
          const after = await chrome.tabs.discard(nonFirst.id);
          return { windowId: w.id, tabId: after.id, url: after.url, discarded: after.discarded };
        }, [oneUrl, twoUrl]);
        if (isolated.discarded !== true) {
          lastErr = new Error(`attempt ${attempt}: discarded was not true: ${JSON.stringify(isolated)}`);
          isolated = null;
        }
      } catch (e) {
        lastErr = new Error(`attempt ${attempt}: ${e.message}`);
      }
      if (!isolated) await settleAndRelaunchIfDisconnected("during the isolated discard check retry loop");
    }
    if (!isolated) throw new Error(`isolated chrome.tabs.discard() did not report discarded=true in 5 attempts; last error: ${lastErr && lastErr.message}`);
    return isolated;
  }

  try {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    fs.rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
    fs.mkdirSync(ROOT, { recursive: true });
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

    buildExtensionCopy();

    server = await require("./server.js").start();

    // The machine's installed Google Chrome refuses --load-extension /
    // --disable-extensions-except entirely (chrome://extensions stays empty,
    // no serviceworker event ever fires). Playwright's own managed Chromium
    // (installed via `npx playwright install chromium`) honors the unpacked
    // extension flags normally, so it is used here instead of channel: "chrome".
    await launchAndOpenApp();

    const oneUrl = `${BASE}/one.html`;
    const twoUrl = `${BASE}/two.html`;
    const threeUrl = `${BASE}/three.html`;

    async function expectedCounts() {
      const w = await worker();
      return w.evaluate(async (prefix) => {
        const windows = await chrome.windows.getAll({ populate: true });
        let winCount = 0;
        let tabCount = 0;
        for (const win of windows) {
          const tabs = (win.tabs || []).filter((t) => !String(t.url || t.pendingUrl || "").startsWith(prefix));
          if (tabs.length === 0) continue;
          winCount++;
          tabCount += tabs.length;
        }
        return { winCount, tabCount };
      }, ownPrefix);
    }

    async function clearSelection() {
      await appPage.click("#sel-clear").catch(() => {});
    }

    // Unconditional cleanup after a scenario's try/catch: close an open dialog or menu, clear the
    // search and the selection, so a failure part-way through cannot leave state for the next one.
    async function resetUi() {
      try {
        if (await appPage.$eval("#dialog-backdrop", (n) => !n.hidden)) {
          await appPage.click("#dialog-backdrop", { position: { x: 5, y: 5 } });
          await waitFor(async () => appPage.$eval("#dialog-backdrop", (n) => n.hidden));
        }
      } catch (e) {
        console.log("  resetUi: dialog did not close: " + e.message);
      }
      if (await appPage.$("#more-menu:not([hidden]), #move-menu:not([hidden])").catch(() => null)) {
        await appPage.keyboard.press("Escape").catch(() => {});
      }
      await appPage.fill("#search", "").catch(() => {});
      if (await appPage.$("#selbar:not([hidden])").catch(() => null)) await clearSelection();
    }

    // Export, Import, Settings and Help live in the header's "⋯" menu since 1.1.
    async function openMenuItem(selector) {
      await appPage.click("#btn-more");
      await appPage.click(selector);
    }

    // ---------------------------------------------------------------
    // Fixtures: two windows created directly via the service worker, with
    // window B's "two" tab placed in a blue "Grp" group.
    // ---------------------------------------------------------------
    const winB = await (await worker()).evaluate((urls) => chrome.windows.create({ url: urls }), [oneUrl, twoUrl]);
    // A newer Chromium can answer windows.create before its tabs carry their URL (only pendingUrl),
    // so the fixture waits until both tabs have committed theirs.
    let tabsB = await waitFor(async () => {
      const ts = await (await worker()).evaluate((id) => chrome.tabs.query({ windowId: id }), winB.id);
      return ts.length === 2 && ts.every((t) => t.url && t.url.endsWith(".html")) ? ts : null;
    }, { timeout: 15000 });
    tabsB.sort((a, b) => a.index - b.index);
    const oneInB = tabsB.find((t) => t.url.endsWith("one.html"));
    const twoInB = tabsB.find((t) => t.url.endsWith("two.html"));
    const grpGroupId = await (await worker()).evaluate((tabId) => chrome.tabs.group({ tabIds: [tabId] }), twoInB.id);
    await (await worker()).evaluate((gid) => chrome.tabGroups.update(gid, { title: "Grp", color: "blue" }), grpGroupId);

    const winC = await (await worker()).evaluate((urls) => chrome.windows.create({ url: urls }), [threeUrl, oneUrl]);

    await appPage.evaluate(() => window.TabVaultApp.refresh());
    await appPage.waitForSelector(".window");

    // ---------------------------------------------------------------
    // A. Initial listing
    // ---------------------------------------------------------------
    try {
      await appPage.waitForFunction(() => document.querySelectorAll("#grid .window").length >= 2);
      const cols = await appPage.$$eval(".window", (nodes) =>
        nodes.map((n) => ({ window: n.dataset.window, count: n.querySelector(".whead .count")?.textContent }))
      );
      const colB = cols.find((c) => Number(c.window) === winB.id);
      const colC = cols.find((c) => Number(c.window) === winC.id);
      assert(colB && colB.count === "2", `window B column missing or wrong count: ${JSON.stringify(cols)}`);
      assert(colC && colC.count === "2", `window C column missing or wrong count: ${JSON.stringify(cols)}`);

      const groupTitles = await appPage.$$eval(".group .gtitle", (nodes) => nodes.map((n) => n.textContent));
      assert(groupTitles.includes("Grp"), `no group titled "Grp": ${JSON.stringify(groupTitles)}`);

      const expected = await expectedCounts();
      const countsText = await appPage.$eval("#counts", (el) => el.textContent);
      assert(
        countsText === `${expected.winCount} win · ${expected.tabCount} tabs`,
        `counts text "${countsText}" did not match expected ${JSON.stringify(expected)}`
      );

      fs.mkdirSync(ROOT, { recursive: true });
      await appPage.screenshot({ path: path.join(ROOT, "main-page.png") });

      record("A", "PASS", `columns=${JSON.stringify(cols)}, groups=${JSON.stringify(groupTitles)}, counts="${countsText}" (expected ${JSON.stringify(expected)}). Screenshot: main-page.png`);
    } catch (e) {
      record("A", "FAIL", e.message);
    }

    // ---------------------------------------------------------------
    // B. Search + Escape
    // ---------------------------------------------------------------
    try {
      const expected = await expectedCounts();
      await appPage.fill("#search", "three");
      const countsText = await waitForTextContains(appPage, "#counts", " of ");
      assert(countsText === `${expected.winCount} win · 1 of ${expected.tabCount} tabs`, `counts text after search = "${countsText}"`);
      const visibleRows = await appPage.$$eval("#grid .tab", (nodes) => nodes.length);
      assert(visibleRows === 1, `expected 1 visible tab row, got ${visibleRows}`);
      const visibleTabId = await appPage.$eval("#grid .tab", (el) => el.dataset.tab);
      const threeTabsNow = await (await worker()).evaluate((url) => chrome.tabs.query({ url }), threeUrl);
      assert(threeTabsNow.length === 1, `expected exactly one three.html tab at this point, found ${threeTabsNow.length}`);
      assert(Number(visibleTabId) === threeTabsNow[0].id, `visible row's data-tab (${visibleTabId}) is not the three.html tab (${threeTabsNow[0].id})`);

      await appPage.focus("#search");
      await appPage.keyboard.press("Escape");
      await waitFor(async () => (await appPage.$eval("#search", (el) => el.value)) === "");
      const countsAfter = await appPage.$eval("#counts", (el) => el.textContent);
      assert(countsAfter === `${expected.winCount} win · ${expected.tabCount} tabs`, `counts after Escape = "${countsAfter}"`);

      record("B", "PASS", `search "three" -> counts="${countsText}", visible row data-tab=${visibleTabId} (matches three.html tab ${threeTabsNow[0].id}); Escape -> search cleared, counts="${countsAfter}"`);
    } catch (e) {
      record("B", "FAIL", e.message);
    }

    // ---------------------------------------------------------------
    // C. Move via "Move to…"
    // ---------------------------------------------------------------
    try {
      await clearSelection();
      await appPage.click(`.tab[data-tab="${oneInB.id}"] input[type=checkbox]`);
      await appPage.click("#move-btn");
      await appPage.click(`#move-menu button[data-target="${winC.id}"]`);
      const moved = await waitFor(async () => {
        const t = await (await worker()).evaluate((id) => chrome.tabs.get(id), oneInB.id);
        return t.windowId === winC.id ? t : null;
      });
      assert(moved.windowId === winC.id, `tab did not move: ${JSON.stringify(moved)}`);
      record("C", "PASS", `moved tab ${oneInB.id} (one.html) from window ${winB.id} to window ${winC.id}; chrome.tabs.get confirms windowId=${moved.windowId}`);
    } catch (e) {
      record("C", "FAIL", e.message);
    }

    // ---------------------------------------------------------------
    // D. Drag row onto another window's column
    // ---------------------------------------------------------------
    try {
      // C's move re-renders the grid; a drag that starts while a row is being replaced is lost
      // (the failures D had on a busy machine). Settle the page first, and drag once more if the
      // first drop did not land; the assertions below are unchanged.
      const dragOnce = async () => {
        await appPage.evaluate(() => window.TabVaultApp.refresh());
        await appPage.waitForTimeout(300);
        await appPage.locator(`.tab[data-tab="${twoInB.id}"]`).dragTo(appPage.locator(`.window[data-window="${winC.id}"] .whead`));
      };
      const landed = async () => (await (await worker()).evaluate((id) => chrome.tabs.get(id), twoInB.id)).windowId === winC.id;
      await dragOnce();
      if (!(await waitFor(landed, { timeout: 3000 }).catch(() => false))) await dragOnce();
      const moved = await waitFor(async () => {
        const t = await (await worker()).evaluate((id) => chrome.tabs.get(id), twoInB.id);
        return t.windowId === winC.id && t.groupId === -1 ? t : null;
      });
      assert(moved.windowId === winC.id, `tab did not move to window C: ${JSON.stringify(moved)}`);
      assert(moved.groupId === -1, `tab still grouped after drag: ${JSON.stringify(moved)}`);
      const winBGone = await (await worker()).evaluate((id) => chrome.windows.get(id).then(() => false, () => true), winB.id);
      record("D", "PASS", `dragged tab ${twoInB.id} (two.html) onto window ${winC.id}: windowId=${moved.windowId}, groupId=${moved.groupId} (ungrouped). Source window ${winB.id} auto-closed=${winBGone}`);
    } catch (e) {
      record("D", "FAIL", e.message);
    }

    // ---------------------------------------------------------------
    // E. Select two tabs, Close
    // ---------------------------------------------------------------
    try {
      const tabsC = await (await worker()).evaluate((id) => chrome.tabs.query({ windowId: id }), winC.id);
      const threeTab = tabsC.find((t) => t.url.endsWith("three.html"));
      const oneTabs = tabsC.filter((t) => t.url.endsWith("one.html")).sort((a, b) => a.id - b.id);
      const toClose = oneTabs[0];

      await clearSelection();
      await appPage.click(`.tab[data-tab="${threeTab.id}"] input[type=checkbox]`);
      await appPage.click(`.tab[data-tab="${toClose.id}"] input[type=checkbox]`);
      await appPage.click("#sel-close");

      await waitFor(async () => {
        const w = await worker();
        const stillThere = await w.evaluate((ids) => Promise.all(ids.map((id) => chrome.tabs.get(id).then(() => true, () => false))), [threeTab.id, toClose.id]);
        return stillThere.every((x) => x === false);
      });
      record("E", "PASS", `closed tabs ${threeTab.id} (three.html) and ${toClose.id} (one.html); both gone per chrome.tabs.get`);
    } catch (e) {
      record("E", "FAIL", e.message);
    }

    // ---------------------------------------------------------------
    // F. Group + rename + color
    // ---------------------------------------------------------------
    try {
      await appPage.evaluate(() => window.TabVaultApp.refresh());
      const tabsC = await (await worker()).evaluate((id) => chrome.tabs.query({ windowId: id }), winC.id);
      assert(tabsC.length === 2, `expected exactly 2 tabs in window C before grouping, got ${tabsC.length}: ${JSON.stringify(tabsC.map((t) => t.url))}`);

      await clearSelection();
      for (const t of tabsC) await appPage.click(`.tab[data-tab="${t.id}"] input[type=checkbox]`);
      await appPage.click("#sel-group");

      await appPage.waitForSelector(".group");
      await appPage.click('.group .ghead button[title="Rename group"]');
      const input = appPage.locator(".group .ghead input[type=text]");
      await input.fill("Renamed");
      await input.press("Enter");
      await waitForTextContains(appPage, ".group .gtitle", "Renamed");
      const before = (await (await worker()).evaluate(() => chrome.tabGroups.query({ title: "Renamed" })))[0];
      const target = before.color === "purple" ? "cyan" : "purple";
      await appPage.click(".group .ghead .gdot");
      await appPage.click(`.group .swatches button[data-color="${target}"]`);

      const groups = await waitFor(async () => {
        const gs = await (await worker()).evaluate(() => chrome.tabGroups.query({ title: "Renamed" }));
        return gs.length === 1 && gs[0].color === target ? gs : null;
      });
      record("F", "PASS", `grouped tabs ${tabsC.map((t) => t.id).join(",")}, renamed to "Renamed", colour ${before.color} -> ${target} via the colour dots; chrome.tabGroups.query confirms ${JSON.stringify(groups)}`);
    } catch (e) {
      record("F", "FAIL", e.message);
    }

    // ---------------------------------------------------------------
    // G. Duplicates
    // ---------------------------------------------------------------
    try {
      await (await worker()).evaluate(({ windowId, url }) => Promise.all([1, 2].map(() => chrome.tabs.create({ windowId, url, active: false }))), { windowId: winC.id, url: oneUrl });
      await appPage.evaluate(() => window.TabVaultApp.refresh());

      await appPage.click("#btn-dupes");
      await appPage.waitForSelector("#dialog h2");
      const headerText = await waitForTextContains(appPage, "#dialog .muted", "duplicated URL");
      assert(headerText.includes("1 duplicated URL"), `duplicates header = "${headerText}"`);
      const rowCount = await appPage.$$eval("#dialog table tr", (rows) => rows.length - 1); // minus header row
      assert(rowCount === 3, `expected 3 duplicate rows, got ${rowCount}`);
      const expectedLabel = await (await worker()).evaluate(async (windowId) => {
        const { windowNames = {} } = await chrome.storage.local.get("windowNames");
        const [active] = await chrome.tabs.query({ windowId, active: true });
        return new Map(Object.entries(windowNames)).get(String(windowId)) || (active && (active.title || active.url)) || "";
      }, winC.id);
      const windowCells = await appPage.$$eval("#dialog table td.wcell", (cells) => cells.map((c) => c.textContent));
      assert(expectedLabel && windowCells.length === 3 && windowCells.every((c) => c === expectedLabel.slice(0, 40) && !/^[0-9]+$/.test(c)), 'Window column = ' + JSON.stringify(windowCells) + ', expected the window label ' + JSON.stringify(expectedLabel));
      const closeCount = rowCount - 1;
      const checked = await appPage.$$eval("#dialog table input[type=checkbox]", (bs) => bs.filter((b) => b.checked).length);
      const keptMarks = await appPage.$$eval("#dialog table .kept", (ks) => ks.length);
      assert(checked === closeCount && keptMarks === 1, `expected ${closeCount} checked rows and 1 kept marker, got ${checked} and ${keptMarks}`);

      await appPage.click(`#dialog button:has-text("Close ${closeCount} selected")`);
      const remaining = await waitFor(async () => {
        const tabs = await (await worker()).evaluate((url) => chrome.tabs.query({ url }), oneUrl);
        return tabs.length === 1 ? tabs : null;
      });
      record("G", "PASS", `header="${headerText}", duplicate rows=${rowCount}, Window column=${JSON.stringify(windowCells)}; clicked "Close ${closeCount} selected" -> exactly ${remaining.length} one.html tab remains (id=${remaining[0].id})`);
    } catch (e) {
      record("G", "FAIL", e.message);
    }

    // Close the harness window's leftover blank tab (Playwright's initial
    // about:blank tab) before exporting. This makes window C's clone the
    // *only* window Import has to restore, which matters for scenario I-b:
    // the chrome.tabs.discard() environment crash there interrupts whatever
    // window's steps are in progress when it hits, so a second window's
    // createWindow step -- and the "Import complete" screen -- would never
    // happen if the discard-requiring window weren't the only (and so also
    // the last) one restored.
    {
      const appTab = (await (await worker()).evaluate((prefix) => chrome.tabs.query({ url: prefix + "*" }), ownPrefix))[0];
      const blanks = await (await worker()).evaluate(
        ({ windowId, appTabId }) => chrome.tabs.query({ windowId }).then((tabs) => tabs.filter((t) => t.id !== appTabId).map((t) => t.id)),
        { windowId: appTab.windowId, appTabId: appTab.id }
      );
      if (blanks.length) await (await worker()).evaluate((ids) => chrome.tabs.remove(ids), blanks);
      await appPage.evaluate(() => window.TabVaultApp.refresh());
    }

    // ---------------------------------------------------------------
    // H. Export
    // ---------------------------------------------------------------
    let exportedJson = null;
    let exportedFilePath = null;
    try {
      // Force a refresh: G's fixture mutations went through sw.evaluate/direct
      // chrome.* calls outside the app's own click handlers, so state.session
      // may still reflect an intermediate point in G (e.g. right after the two
      // extra duplicate tabs were added, before "Close 2 duplicates" ran) if
      // we rely on the page's own 100ms debounced refresh alone.
      await appPage.evaluate(() => window.TabVaultApp.refresh());
      await openMenuItem("#btn-export");
      await appPage.waitForSelector("#dialog h2");
      const downloadPromise = appPage.waitForEvent("download");
      await appPage.click('#dialog button:has-text("Download JSON")');
      const download = await downloadPromise;
      const suggested = download.suggestedFilename();
      exportedFilePath = path.join(DOWNLOAD_DIR, suggested);
      await download.saveAs(exportedFilePath);
      exportedJson = JSON.parse(fs.readFileSync(exportedFilePath, "utf8"));

      assert(exportedJson.schema === 1, `schema = ${exportedJson.schema}`);
      assert(exportedJson.app && exportedJson.app.name === "TabVault", `app.name = ${JSON.stringify(exportedJson.app)}`);

      const expected = await expectedCounts();
      const gotWindows = exportedJson.windows.length;
      const gotTabs = exportedJson.windows.reduce((n, w) => n + w.tabs.length, 0);
      assert(gotWindows === expected.winCount, `exported window count ${gotWindows} != live ${expected.winCount}`);
      assert(gotTabs === expected.tabCount, `exported tab count ${gotTabs} != live ${expected.tabCount}`);
      assert(gotWindows === 1, `expected exactly 1 exported window (the harness's blank tab was closed above), got ${gotWindows}`);

      await appPage.click("#dialog-backdrop", { position: { x: 5, y: 5 } }).catch(() => {});
      record("H", "PASS", `downloaded "${suggested}", schema=${exportedJson.schema}, app.name="${exportedJson.app.name}", windows=${gotWindows}, tabs=${gotTabs} (matches live ${JSON.stringify(expected)})`);
    } catch (e) {
      record("H", "FAIL", e.message);
    }

    // ---------------------------------------------------------------
    // I-a / I-b. Import
    //
    // NOTE ON ENVIRONMENT LIMITATION (see e2e/README.md for the full
    // writeup): calling chrome.tabs.discard() from the extension while
    // Playwright's Chromium is CDP-attached disconnects the entire browser
    // process, typically within ~150-300ms of the call. This was isolated
    // with several standalone repro scripts making a bare
    // chrome.tabs.discard() call directly (no Import, no TabVault code
    // involved at all): an active tab opened via context.newPage(), a
    // background tab created purely via chrome.tabs.create with no
    // Playwright Page object, and one inside a tab group -- all crash
    // identically. Racing it live was tried four ways (a tight sequential
    // poll, an 80-wide concurrent burst of reads issued the instant a
    // click's promise resolves, a MutationObserver running entirely in-page
    // so no Node<->CDP round trip is needed until the final read, and a
    // full-session-restore-on-relaunch recovery) and none reliably observed
    // a post-click chrome.* result. This is a genuine Playwright/Chromium
    // defect, not a TabVault bug or a harness bug in the usual sense.
    //
    // Task 8's settings.lazyRestore (app/dialogs.js, lib/restore-plan.js)
    // gives this harness a way to test Import for real without hitting that
    // crash at all: with lazy loading off, restoreSession() makes no
    // chrome.tabs.discard() calls. So:
    //   I-a (must PASS): lazy loading OFF. The real Restore flow is driven
    //     to completion and its outcome is verified live and for real --
    //     restored windows, tab URLs in order, pinned state, the recreated
    //     group's title/color, and the result dialog's reported counts.
    //   I-b (PASS or LIMITED, never silently skipped): lazy loading back ON
    //     (the default), so this exercises the actual discardTab step and
    //     therefore the actual crash. If the browser survives, the same
    //     kind of live discarded=true assertion I-a makes for URLs/groups is
    //     required to pass here too. If it doesn't (the expected outcome in
    //     this environment), the part is marked LIMITED -- not PASS, not
    //     silently green -- with the isolated discard check (which exercises
    //     the identical chrome.tabs.discard() call outside the crash-prone
    //     multi-step flow) run as supporting evidence, and the browser is
    //     relaunched so J, K, L can continue.
    // Full step-by-step plan generation, including that `discard: false`
    // emits no discardTab steps at all, is independently covered by the
    // already-passing unit test test/restore-plan.test.js.
    // ---------------------------------------------------------------

    async function setLazyRestore(wanted) {
      await openMenuItem("#btn-settings");
      await appPage.waitForSelector("#dialog h2");
      const lazyCheckbox = appPage.locator("#dialog label", { hasText: "lazy" }).locator("input[type=checkbox]");
      if (wanted) await lazyCheckbox.check();
      else await lazyCheckbox.uncheck();
      await appPage.click('#dialog button:has-text("Save")');
      await waitFor(async () => {
        const stored = await (await worker()).evaluate(() => chrome.storage.local.get("settings"));
        const lazy = stored.settings && stored.settings.lazyRestore !== false;
        return lazy === wanted;
      });
    }

    // ---------------------------------------------------------------
    // I-a. Import with lazy loading OFF: real, live restore verification
    // ---------------------------------------------------------------
    try {
      assert(exportedFilePath, "no exported file from scenario H to import");
      await setLazyRestore(false);

      const beforeIds = (await (await worker()).evaluate(() => chrome.windows.getAll())).map((w) => w.id);
      const errSnap = consoleErrorSnapshot();

      await appPage.setInputFiles("#import-file", exportedFilePath);
      await appPage.waitForSelector("#dialog h2");
      await waitForTextContains(appPage, "#dialog h2", "choose windows to restore");
      const rows = await appPage.$$eval("#dialog .list label", (nodes) => nodes.map((n) => n.textContent));
      assert(rows.length === exportedJson.windows.length, `import dialog listed ${rows.length} window row(s), expected ${exportedJson.windows.length}: ${JSON.stringify(rows)}`);
      await appPage.click('#dialog button:has-text("Restore selected windows")');
      await waitForTextContains(appPage, "#dialog h2", "complete", 15000);

      const newErrors = newConsoleErrorsSince(errSnap);
      assert(newErrors.app.length === 0 && newErrors.worker.length === 0, `console errors appeared during restore: ${JSON.stringify(newErrors)}`);

      const resultText = await appPage.$eval("#dialog", (el) => el.textContent);
      assert(resultText.includes("Restored 1 windows and 2 tabs."), `result dialog did not report the expected restored counts: "${resultText}"`);
      assert(!resultText.includes("tabs load when you open them"), `result dialog still claims lazy loading, but it was off: "${resultText}"`);
      await appPage.click("#dialog-backdrop", { position: { x: 5, y: 5 } }).catch(() => {});

      const newWindows = await (await worker()).evaluate(async (beforeIdsArg) => {
        const beforeSet = new Set(beforeIdsArg);
        const windows = await chrome.windows.getAll({ populate: true });
        return windows.filter((w) => !beforeSet.has(w.id));
      }, beforeIds);
      assert(newWindows.length === 1, `expected exactly 1 new window, got ${newWindows.length}: ${JSON.stringify(newWindows.map((w) => w.id))}`);
      const newWin = newWindows[0];
      const tabs = newWin.tabs.slice().sort((a, b) => a.index - b.index);

      const expectedTabs = exportedJson.windows[0].tabs;
      const actualUrls = tabs.map((t) => t.url);
      const expectedUrls = expectedTabs.map((t) => t.url);
      assert(JSON.stringify(actualUrls) === JSON.stringify(expectedUrls), `restored URLs in order ${JSON.stringify(actualUrls)} != expected ${JSON.stringify(expectedUrls)}`);

      const actualPinned = tabs.map((t) => Boolean(t.pinned));
      const expectedPinned = expectedTabs.map((t) => Boolean(t.pinned));
      assert(JSON.stringify(actualPinned) === JSON.stringify(expectedPinned), `restored pinned state ${JSON.stringify(actualPinned)} != expected ${JSON.stringify(expectedPinned)}`);

      const discardedTabs = tabs.filter((t) => t.discarded);
      assert(discardedTabs.length === 0, `a tab was discarded even though lazy loading was off: ${JSON.stringify(tabs.map((t) => ({ id: t.id, discarded: t.discarded })))}`);

      const expectedGroup = exportedJson.windows[0].groups[0];
      assert(expectedGroup, "fixture export unexpectedly has no group to check against");
      const groups = await (await worker()).evaluate((windowId) => chrome.tabGroups.query({ windowId }), newWin.id);
      assert(groups.length === 1, `expected exactly 1 restored group, got ${groups.length}: ${JSON.stringify(groups)}`);
      assert(groups[0].title === expectedGroup.title, `restored group title "${groups[0].title}" != expected "${expectedGroup.title}"`);
      assert(groups[0].color === expectedGroup.color, `restored group color "${groups[0].color}" != expected "${expectedGroup.color}"`);

      record(
        "I-a",
        "PASS",
        `lazy loading off; import dialog listed ${rows.length} window row(s); result dialog: "${resultText.trim().replace(/\s+/g, " ")}"; new window ${newWin.id} has URLs in order ${JSON.stringify(actualUrls)} (expected ${JSON.stringify(expectedUrls)}), pinned ${JSON.stringify(actualPinned)}, 0 discarded tabs, group ${JSON.stringify(groups[0])} (expected title "${expectedGroup.title}" color "${expectedGroup.color}"); 0 new console errors.`
      );
    } catch (e) {
      record("I-a", "FAIL", e.message);
    }

    // ---------------------------------------------------------------
    // I-b. Import with lazy loading back ON: the real discardTab step, which
    // is expected to crash this environment (see the note above)
    // ---------------------------------------------------------------
    try {
      assert(exportedFilePath, "no exported file from scenario H to import");
      await setLazyRestore(true);

      const beforeIds = (await (await worker()).evaluate(() => chrome.windows.getAll())).map((w) => w.id);
      const errSnap = consoleErrorSnapshot();

      await appPage.setInputFiles("#import-file", exportedFilePath);
      await appPage.waitForSelector("#dialog h2");
      await waitForTextContains(appPage, "#dialog h2", "choose windows to restore");
      await appPage.click('#dialog button:has-text("Restore selected windows")');

      let crashed = false;
      let v = null;
      try {
        v = await (await worker()).evaluate(async (beforeIdsArg) => {
          const beforeSet = new Set(beforeIdsArg);
          const windows = await chrome.windows.getAll({ populate: true });
          const newWindows = windows.filter((w) => !beforeSet.has(w.id));
          const discardFlags = [];
          for (const w of newWindows) {
            const tabs = w.tabs.slice().sort((a, b) => a.index - b.index);
            for (let i = 1; i < tabs.length; i++) discardFlags.push({ id: tabs[i].id, index: i, discarded: tabs[i].discarded });
          }
          return { newWindowCount: newWindows.length, discardFlags };
        }, beforeIds);
      } catch (e) {
        if (looksLikeDisconnect(e)) crashed = true;
        else throw e;
      }
      if (!crashed && !(context.browser() && context.browser().isConnected())) crashed = true;

      const newErrors = newConsoleErrorsSince(errSnap);
      const hadConsoleErrors = newErrors.app.length > 0 || newErrors.worker.length > 0;

      if (hadConsoleErrors) {
        record("I-b", "FAIL", `console errors appeared between the Restore click and the outcome (this overrides what would otherwise be a LIMITED environment-crash result): ${JSON.stringify(newErrors)}`);
      } else if (crashed) {
        let isolatedEvidence;
        try {
          await settleAndRelaunchIfDisconnected("after the real Restore click with lazy loading on (expected)");
          const isolated = await runIsolatedDiscardCheck(oneUrl, twoUrl);
          isolatedEvidence = `Isolated chrome.tabs.discard() on a fresh real tab reliably reported discarded=true: ${JSON.stringify(isolated)}.`;
        } catch (e) {
          isolatedEvidence = `Isolated discard check (supporting evidence) also failed: ${e.message}`;
        }
        record("I-b", "LIMITED", `chrome.tabs.discard crashes Playwright's Chromium in this environment; discard verified in isolation. ${isolatedEvidence}`);
      } else {
        assert(v.newWindowCount > 0, "browser survived but no new windows appeared after import");
        assert(v.discardFlags.length > 0, "browser survived but there were no non-first tabs to check discard on");
        const allDiscarded = v.discardFlags.every((d) => d.discarded);
        if (allDiscarded) {
          record("I-b", "PASS", `browser survived the real Restore click with lazy loading on; ${v.newWindowCount} new window(s), non-first tabs report discarded=true: ${JSON.stringify(v.discardFlags)}; 0 new console errors.`);
        } else {
          record("I-b", "FAIL", `browser survived but not all non-first tabs were discarded: ${JSON.stringify(v.discardFlags)}`);
        }
      }
    } catch (e) {
      record("I-b", "FAIL", e.message);
    }

    // Whichever path I-b took, make sure the browser is alive before J/K/L:
    // the crashed branch above already relaunches, but the isolated check's
    // own last (successful) attempt could itself be moments from crashing
    // again, same as after the main Restore click.
    await settleAndRelaunchIfDisconnected("after scenario I-b");
    // Playwright 1.65's Chromium survives chrome.tabs.discard, so I-b can PASS live and leave its
    // Restore result dialog open (a crash and relaunch used to close it): close it before J.
    await resetUi().catch(() => {});

    // ---------------------------------------------------------------
    // J. Snapshot now / delete / keep-unkeep
    // ---------------------------------------------------------------
    try {
      await appPage.click("#btn-snapshots");
      await appPage.waitForSelector("#dialog h2");

      await appPage.click('#dialog button:has-text("Snapshot now")');
      const snap1 = await waitFor(async () => {
        const { snapshots = [] } = await (await worker()).evaluate(() => chrome.storage.local.get("snapIndex").then((r) => ({ snapshots: r.snapIndex || [] })));
        return snapshots.find((s) => s.reason === "manual" && s.pinned) || null;
      });
      await waitForTextContains(appPage, `[data-snapshot="${snap1.id}"]`, "manual");
      const row1Text = await appPage.$eval(`[data-snapshot="${snap1.id}"]`, (el) => el.textContent);
      assert(row1Text.includes("manual") && row1Text.includes("kept"), `first snapshot row text = "${row1Text}"`);

      fs.mkdirSync(ROOT, { recursive: true });
      await appPage.screenshot({ path: path.join(ROOT, "snapshots-dialog.png") });

      await appPage.click(`[data-snapshot="${snap1.id}"] button:has-text("Delete")`);
      await waitFor(async () => (await appPage.$(`[data-snapshot="${snap1.id}"]`)) === null);
      const gone = await (await worker()).evaluate((id) => chrome.storage.local.get("snapIndex").then((r) => ({ snapshots: r.snapIndex || [] })).then((r) => !(r.snapshots || []).some((s) => s.id === id)), snap1.id);
      assert(gone, "deleted snapshot still present in storage");

      await appPage.click('#dialog button:has-text("Snapshot now")');
      const snap2 = await waitFor(async () => {
        const { snapshots = [] } = await (await worker()).evaluate(() => chrome.storage.local.get("snapIndex").then((r) => ({ snapshots: r.snapIndex || [] })));
        return snapshots.find((s) => s.reason === "manual" && s.pinned) || null;
      });
      await waitForTextContains(appPage, `[data-snapshot="${snap2.id}"]`, "manual");

      await appPage.click(`[data-snapshot="${snap2.id}"] button:has-text("Unkeep")`);
      await waitFor(async () => {
        const { snapshots = [] } = await (await worker()).evaluate(() => chrome.storage.local.get("snapIndex").then((r) => ({ snapshots: r.snapIndex || [] })));
        const s = snapshots.find((x) => x.id === snap2.id);
        return s && s.pinned === false;
      });
      await waitForTextContains(appPage, `[data-snapshot="${snap2.id}"]`, "Keep");

      await appPage.click(`[data-snapshot="${snap2.id}"] button:has-text("Keep")`);
      await waitFor(async () => {
        const { snapshots = [] } = await (await worker()).evaluate(() => chrome.storage.local.get("snapIndex").then((r) => ({ snapshots: r.snapIndex || [] })));
        const s = snapshots.find((x) => x.id === snap2.id);
        return s && s.pinned === true;
      });
      await waitForTextContains(appPage, `[data-snapshot="${snap2.id}"]`, "Unkeep");

      await appPage.click("#dialog-backdrop", { position: { x: 5, y: 5 } }).catch(() => {});
      record(
        "J",
        "PASS",
        `snapshot ${snap1.id}: reason=manual, kept marker shown, deleted (storage confirms). snapshot ${snap2.id}: Unkeep -> pinned=false ("Keep" shown), Keep -> pinned=true ("Unkeep" shown). Screenshot: snapshots-dialog.png`
      );
    } catch (e) {
      record("J", "FAIL", e.message);
    }

    // ---------------------------------------------------------------
    // 1.1 Console scenarios M-R. They share one fresh fixture window,
    // created here because I-b may have relaunched the browser, which
    // leaves no earlier fixture window behind.
    // ---------------------------------------------------------------
    let winM = null;
    let tabsM = [];
    try {
      winM = await (await worker()).evaluate((urls) => chrome.windows.create({ url: urls, focused: false }), [oneUrl, twoUrl, threeUrl]);
      tabsM = await waitFor(async () => {
        const ts = await (await worker()).evaluate((id) => chrome.tabs.query({ windowId: id }), winM.id);
        return ts.length === 3 && ts.every((t) => String(t.url || "").startsWith(BASE)) ? ts.sort((a, b) => a.index - b.index) : null;
      }, { timeout: 15000 });
      await appPage.evaluate(() => window.TabVaultApp.refresh());
      await appPage.waitForSelector(`.window[data-window="${winM.id}"]`);
    } catch (e) {
      console.log(`M-R fixture window could not be created: ${e.message}`);
    }

    const LIGHT_G = "rgb(247, 247, 245)"; // --g light #F7F7F5
    const DARK_G = "rgb(19, 21, 24)"; // --g dark #131518
    const bodyBg = () => appPage.evaluate(() => getComputedStyle(document.body).backgroundColor);
    async function setAppearance(value) {
      await openMenuItem("#btn-settings");
      await appPage.waitForSelector("#dialog h2");
      await appPage.selectOption('#dialog select[aria-label="Appearance"]', value);
      await appPage.click('#dialog button:has-text("Save")');
      await waitFor(async () => (await appPage.evaluate(() => document.documentElement.dataset.theme)) === value);
    }
    async function blurAll() {
      await appPage.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    }

    // ---------------------------------------------------------------
    // M. Dark theme via the Settings override
    // ---------------------------------------------------------------
    try {
      await appPage.emulateMedia({ colorScheme: "light" });
      await setAppearance("dark");
      const darkBg = await bodyBg();
      assert(darkBg === DARK_G, `Appearance dark: body background ${darkBg}, expected ${DARK_G}`);
      const mirror = await appPage.evaluate(() => localStorage.getItem("tabvault.theme"));
      assert(mirror === "dark", `localStorage mirror = ${JSON.stringify(mirror)}`);
      await appPage.reload();
      await appPage.waitForSelector("#toolbar");
      const bootTheme = await appPage.evaluate(() => document.documentElement.dataset.theme);
      const bootBg = await bodyBg();
      assert(bootTheme === "dark" && bootBg === DARK_G, `after reload: data-theme=${bootTheme}, background ${bootBg}`);
      await appPage.waitForSelector(".window");

      await appPage.emulateMedia({ colorScheme: "dark" });
      await setAppearance("light");
      const lightBg = await bodyBg();
      assert(lightBg === LIGHT_G, `Appearance light under a dark OS: ${lightBg}`);

      await setAppearance("system");
      const systemDark = await bodyBg();
      await appPage.emulateMedia({ colorScheme: "light" });
      const systemLight = await bodyBg();
      assert(systemDark === DARK_G && systemLight === LIGHT_G, `System: dark OS -> ${systemDark}, light OS -> ${systemLight}`);
      record("M", "PASS", `dark override -> ${darkBg} (mirror "${mirror}"), after reload data-theme=${bootTheme} ${bootBg}; light override under dark OS -> ${lightBg}; System follows the OS: ${systemDark} / ${systemLight}`);
    } catch (e) {
      record("M", "FAIL", e.message);
    }
    await appPage.emulateMedia({ colorScheme: "light" }).catch(() => {});
    await resetUi();

    // ---------------------------------------------------------------
    // N. The window hosting TabVault is marked CURRENT with the --p ring
    // ---------------------------------------------------------------
    try {
      const appTab = (await (await worker()).evaluate((prefix) => chrome.tabs.query({ url: prefix + "*" }), ownPrefix))[0];
      await (await worker()).evaluate(({ windowId, url }) => chrome.tabs.create({ windowId, url, active: false }), { windowId: appTab.windowId, url: threeUrl });
      await appPage.evaluate(() => window.TabVaultApp.refresh());
      await appPage.waitForSelector(`.window[data-window="${appTab.windowId}"]`);
      const cards = await appPage.$$eval(".window", (nodes) => nodes.map((n) => ({
        id: Number(n.dataset.window),
        current: n.classList.contains("current"),
        tag: (n.querySelector(".tag-current") || {}).textContent || "",
        ring: getComputedStyle(n).borderTopColor,
      })));
      const marked = cards.filter((c) => c.current || c.tag);
      assert(marked.length === 1 && marked[0].id === appTab.windowId, `expected only window ${appTab.windowId} marked: ${JSON.stringify(cards)}`);
      assert(marked[0].tag === "CURRENT", `tag text = ${JSON.stringify(marked[0].tag)}`);
      assert(marked[0].ring === "rgb(183, 121, 31)", `ring colour = ${marked[0].ring}, expected --p #B7791F`);
      record("N", "PASS", `window ${appTab.windowId} (TabVault's own) is the only card with .current and the CURRENT tag; ring ${marked[0].ring}; cards ${JSON.stringify(cards)}`);
    } catch (e) {
      record("N", "FAIL", e.message);
    }

    // ---------------------------------------------------------------
    // O. The bulk bar appears on selection and Esc closes it
    // ---------------------------------------------------------------
    try {
      assert(winM, "no fixture window for M-R");
      await clearSelection();
      await blurAll();
      assert(await appPage.$eval("#selbar", (n) => n.hidden), "bulk bar visible with nothing selected");
      const first = tabsM[0];
      const second = tabsM[1];
      let cursor = null;
      for (let i = 0; i < 80 && cursor !== first.id; i++) {
        await appPage.keyboard.press("j");
        cursor = await appPage.$eval(".tab.cursor", (n) => Number(n.dataset.tab)).catch(() => null);
      }
      assert(cursor === first.id, `j never reached tab ${first.id} (cursor ${cursor})`);
      const focused = await appPage.evaluate(() => document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.tab : null);
      assert(Number(focused) === first.id, `the cursor row does not hold focus (active element data-tab=${focused})`);
      await appPage.keyboard.press("x");
      await appPage.waitForSelector("#selbar:not([hidden])");
      await appPage.click(`.tab[data-tab="${second.id}"] input[type=checkbox]`);
      await waitForTextContains(appPage, "#selcount", "2 selected");
      const counts = await appPage.$eval("#counts", (n) => n.textContent);
      assert(counts.endsWith(" · 2 sel"), `counter = "${counts}"`);
      const position = await appPage.$eval("#selbar", (n) => getComputedStyle(n).position);
      assert(position === "sticky", `bulk bar position = ${position}`);

      await appPage.click("#move-btn");
      await appPage.waitForSelector('#move-menu:not([hidden]) button[data-target="new"]');
      await appPage.keyboard.press("Escape");
      await appPage.waitForSelector("#move-menu[hidden]", { state: "attached" });
      const stillSelected = await appPage.evaluate(() => window.TabVaultApp.selection().length);
      assert(stillSelected === 2, `first Esc should close only the menu; selection is ${stillSelected}`);

      await appPage.keyboard.press("Escape");
      await appPage.waitForSelector("#selbar[hidden]", { state: "attached" });
      const after = await appPage.evaluate(() => window.TabVaultApp.selection().length);
      assert(after === 0, `selection after second Esc = ${after}`);

      // Carry-in (Task 5 review MEDIUM-1): x never acts on a cursor row the search hides.
      // The checkbox click moved the cursor to the second tab, so hide whichever row holds it now.
      const cursorNow = await appPage.$eval(".tab.cursor", (n) => Number(n.dataset.tab));
      const cursorTab = tabsM.find((t) => t.id === cursorNow);
      assert(cursorTab, `cursor ${cursorNow} is not a fixture tab`);
      const hideQuery = cursorTab.url.endsWith("three.html") ? "two.html" : "three.html";
      await appPage.fill("#search", hideQuery);
      await waitFor(async () => (await appPage.$(`.tab[data-tab="${cursorNow}"]`)) === null && (await appPage.$(".tab")) !== null);
      await blurAll();
      await appPage.keyboard.press("x");
      const hiddenSel = await appPage.evaluate(() => window.TabVaultApp.selection());
      assert(hiddenSel.length === 0, `x with the cursor row (${cursorNow}) hidden by the search "${hideQuery}" selected ${JSON.stringify(hiddenSel)}`);
      await appPage.fill("#search", "");
      await appPage.waitForSelector(`.tab[data-tab="${cursorNow}"]`);
      record("O", "PASS", `j reached tab ${first.id} with focus, x selected it, checkbox added ${second.id}: bar sticky, "2 selected", counter "${counts}"; Esc closed the Move-to menu only, Esc again cleared the selection and hid the bar; with the cursor row (${cursorNow}) hidden by the search "${hideQuery}", x selected nothing`);
    } catch (e) {
      record("O", "FAIL", e.message);
    }
    await appPage.fill("#search", "").catch(() => {});
    await clearSelection();

    // ---------------------------------------------------------------
    // P. The colour dots change a group's colour
    // ---------------------------------------------------------------
    try {
      assert(winM, "no fixture window for M-R");
      const gid = await (await worker()).evaluate(async ({ tabId, windowId }) => {
        const id = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId } });
        await chrome.tabGroups.update(id, { title: "Dots", color: "grey" });
        return id;
      }, { tabId: tabsM[2].id, windowId: winM.id });
      await appPage.evaluate(() => window.TabVaultApp.refresh());
      const g = `.group[data-group="${gid}"]`;
      await appPage.waitForSelector(g);
      await appPage.click(`${g} .gdot`);
      const offered = await appPage.$$eval(`${g} .swatches button`, (bs) => bs.map((b) => b.dataset.color));
      assert(JSON.stringify(offered) === JSON.stringify(["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan"]), `picker offers ${JSON.stringify(offered)}`);
      await appPage.click(`${g} .swatches button[data-color="green"]`);
      const live = await waitFor(async () => {
        const x = await (await worker()).evaluate((id) => chrome.tabGroups.get(id), gid);
        return x.color === "green" ? x : null;
      });
      const edge = await waitFor(async () => {
        const c = await appPage.$eval(`${g} .ghead`, (n) => getComputedStyle(n).borderLeftColor).catch(() => null);
        return c === "rgb(24, 128, 56)" ? c : null; // GROUP_COLORS.green #188038
      });
      const pickerOpen = (await appPage.$(`${g} .swatches`)) !== null;
      assert(!pickerOpen, "the picker is still open after choosing a colour");
      record("P", "PASS", `group ${gid}: picker offered ${offered.length} colours; clicked green -> chrome.tabGroups.get says ${live.color}; header bar ${edge}; picker closed`);
    } catch (e) {
      record("P", "FAIL", e.message);
    }

    // ---------------------------------------------------------------
    // Q. The ? panel, the hint strip, named icon buttons
    // ---------------------------------------------------------------
    try {
      await blurAll();
      await appPage.keyboard.press("?");
      await waitForTextContains(appPage, "#dialog h2", "Keyboard shortcuts");
      const rows = await appPage.$$eval("#dialog table.shortcuts tr", (r) => r.length);
      const expectedRows = await appPage.evaluate(() => self.TabVault.SHORTCUTS.length);
      assert(rows === expectedRows, `panel lists ${rows} rows, the table has ${expectedRows}`);
      await appPage.keyboard.press("Escape");
      await waitFor(async () => appPage.$eval("#dialog-backdrop", (n) => n.hidden));
      const hints = await appPage.$eval("#hints", (n) => n.textContent);
      assert(hints === "/ search · j k move · x select · g group · d duplicates · ? all shortcuts", `hint strip = "${hints}"`);
      const unnamed = await appPage.$$eval("#toolbar button, #grid button, #selbar button", (bs) => bs
        .filter((b) => !/[A-Za-z]{2}/.test(b.textContent) && !(b.getAttribute("title") && b.getAttribute("aria-label")))
        .map((b) => b.outerHTML.slice(0, 120)));
      assert(unnamed.length === 0, `glyph buttons without title and aria-label: ${JSON.stringify(unnamed)}`);

      // Carry-in (Task 5 review MEDIUM-2): the panel is opened from a row, a re-render replaces that row
      // while the panel is open (a real title change in a fixture tab), and closing it puts focus on a row, not <body>.
      const cursorId = await appPage.$eval(".tab.cursor", (n) => Number(n.dataset.tab));
      await appPage.focus(`.tab[data-tab="${cursorId}"]`);
      await appPage.evaluate((id) => { window.__e2eRow = document.querySelector(`.tab[data-tab="${id}"]`); }, cursorId);
      await appPage.keyboard.press("?");
      await waitForTextContains(appPage, "#dialog h2", "Keyboard shortcuts");
      const titled = context.pages().find((p) => p.url() === twoUrl);
      let rerender = "a title change in a fixture tab";
      if (titled) await titled.evaluate(() => { document.title = "Two retitled"; });
      else { rerender = "TabVaultApp.refresh()"; await appPage.evaluate(() => window.TabVaultApp.refresh()); }
      await waitFor(() => appPage.evaluate(() => !window.__e2eRow.isConnected));
      await appPage.keyboard.press("Escape");
      await waitFor(async () => appPage.$eval("#dialog-backdrop", (n) => n.hidden));
      const back = await appPage.evaluate(() => {
        const a = document.activeElement;
        return a ? { tag: a.tagName, row: a.classList.contains("tab"), tab: a.dataset ? a.dataset.tab || null : null } : null;
      });
      assert(back && back.row && Number(back.tab) === cursorId, `after the panel closed over a re-rendered row, focus is on ${JSON.stringify(back)}`);
      record("Q", "PASS", `? opened "Keyboard shortcuts" with ${rows} rows (= SHORTCUTS.length), Esc closed it; hint strip "${hints}"; every glyph-only button has title and aria-label; opened from row ${cursorId}, re-rendered by ${rerender}, Esc put focus back on row ${back.tab}`);
    } catch (e) {
      record("Q", "FAIL", e.message);
    }
    await resetUi();

    // ---------------------------------------------------------------
    // R. Window rename round-trips through storage, export and import
    // ---------------------------------------------------------------
    try {
      assert(winM, "no fixture window for M-R");
      const card = `.window[data-window="${winM.id}"]`;
      await appPage.click(`${card} button[aria-label="Rename window"]`);
      const input = appPage.locator(`${card} input.wname-edit`);
      await input.fill("E2E Research");
      await input.press("Enter");
      await waitForTextContains(appPage, `${card} .wname`, "E2E Research");
      // Names live in chrome.storage.local (Task 3: storage.session is wiped on an extension update).
      const stored = await (await worker()).evaluate(() => chrome.storage.local.get("windowNames"));
      assert(stored.windowNames && stored.windowNames[String(winM.id)] === "E2E Research", `storage.local windowNames = ${JSON.stringify(stored)}`);

      await appPage.click(`${card} button[aria-label="Rename window"]`);
      await appPage.locator(`${card} input.wname-edit`).fill("Not saved");
      await appPage.locator(`${card} input.wname-edit`).press("Escape");
      const kept = await waitForTextContains(appPage, `${card} .wname`, "E2E Research");
      assert(!kept.includes("Not saved"), `Escape did not cancel: "${kept}"`);

      await openMenuItem("#btn-export");
      await appPage.waitForSelector("#dialog h2");
      const downloadPromise = appPage.waitForEvent("download");
      await appPage.click('#dialog button:has-text("Download JSON")');
      const download = await downloadPromise;
      const file = path.join(DOWNLOAD_DIR, `rename-${download.suggestedFilename()}`);
      await download.saveAs(file);
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      const exported = json.windows.find((w) => w.id === winM.id);
      assert(exported && exported.windowName === "E2E Research", `exported window ${winM.id}: ${JSON.stringify(exported && { id: exported.id, windowName: exported.windowName })}`);

      await appPage.setInputFiles("#import-file", file);
      await waitForTextContains(appPage, "#dialog h2", "choose windows to restore");
      const labels = await appPage.$$eval("#dialog .list label", (nodes) => nodes.map((n) => n.textContent));
      assert(labels.some((l) => l.includes("E2E Research")), `import list does not show the name: ${JSON.stringify(labels)}`);
      await appPage.click('#dialog button:has-text("Cancel")');
      record("R", "PASS", `renamed window ${winM.id} to "E2E Research" (storage.local confirms), Escape cancelled a second rename, export carries windowName, import list shows it`);
    } catch (e) {
      record("R", "FAIL", e.message);
    }
    await appPage.emulateMedia({ colorScheme: null }).catch(() => {});
    await resetUi();

    // ---------------------------------------------------------------
    // S. About dialog from the ⋯ menu: version from the manifest, links
    // ---------------------------------------------------------------
    try {
      const REPO_URL = "https://github.com/iYazee6-AI/TabVault";
      const fileVersion = JSON.parse(fs.readFileSync(path.join(REPO, "manifest.json"), "utf8")).version;
      const live = await (await worker()).evaluate(() => { const m = chrome.runtime.getManifest(); return { version: m.version, homepage: m.homepage_url }; });
      await openMenuItem("#btn-about");
      await waitForTextContains(appPage, "#dialog h2", "TabVault");
      const version = await appPage.$eval("#dialog h2 .version", (n) => n.textContent);
      assert(version === live.version && version === fileVersion, `About shows version "${version}", manifest says "${live.version}" (file "${fileVersion}")`);
      const links = await appPage.$$eval("#dialog a", (as) => as.map((a) => ({ text: a.textContent, href: a.getAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel") })));
      const repo = links.find((l) => l.text === "github.com/iYazee6-AI/TabVault");
      assert(repo && repo.href === REPO_URL && repo.target === "_blank" && repo.rel === "noopener", `repository link = ${JSON.stringify(repo)}`);
      assert(links.length === 3 && links.some((l) => l.href === REPO_URL + "/issues") && links.some((l) => l.href === REPO_URL + "/blob/main/PRIVACY.md"), `links = ${JSON.stringify(links)}`);
      assert(live.homepage === REPO_URL, `manifest homepage_url = ${live.homepage}`);
      await appPage.keyboard.press("Escape");
      await waitFor(async () => appPage.$eval("#dialog-backdrop", (n) => n.hidden));
      record("S", "PASS", `⋯ > About shows "TabVault ${version}" (= getManifest().version and manifest.json), repository link ${repo.href} (target=_blank rel=noopener), issues and privacy links, homepage_url set; Esc closed it`);
    } catch (e) {
      record("S", "FAIL", e.message);
    }
    await resetUi();

    // ---------------------------------------------------------------
    // T. Duplicates: choose per row. Two duplicate groups in the fixture
    // window (query strings keep them apart from every other one.html or
    // two.html in the session); one extra copy is unchecked and survives.
    // ---------------------------------------------------------------
    try {
      assert(winM, "no fixture window for T");
      const urlA = oneUrl + "?dupT";
      const urlB = twoUrl + "?dupT";
      const created = await (await worker()).evaluate(async ({ windowId, urls }) => {
        const out = [];
        for (const url of urls) out.push((await chrome.tabs.create({ windowId, url, active: false })).id);
        return out;
      }, { windowId: winM.id, urls: [urlA, urlA, urlA, urlB, urlB] });
      await waitFor(async () => {
        const ts = await (await worker()).evaluate((ids) => Promise.all(ids.map((id) => chrome.tabs.get(id))), created);
        return ts.every((t) => String(t.url || "").endsWith("?dupT"));
      }, { timeout: 15000 });
      await appPage.evaluate(() => window.TabVaultApp.refresh());
      const idsA = created.slice(0, 3);
      const idsB = created.slice(3);

      await appPage.click("#btn-dupes");
      await waitForTextContains(appPage, "#dialog .muted", "duplicated URL");
      const buttonLabel = () => appPage.$eval("#dialog button.primary", (b) => ({ text: b.textContent, disabled: b.disabled }));
      const rowInfo = (id) => appPage.$eval(`#dialog tr[data-tab="${id}"]`, (tr) => ({ box: !!tr.querySelector("input[type=checkbox]"), kept: !!tr.querySelector(".kept") }));
      const infoA = await Promise.all(idsA.map(rowInfo));
      const infoB = await Promise.all(idsB.map(rowInfo));
      assert(infoA.filter((r) => r.kept && !r.box).length === 1 && infoA.filter((r) => r.box && !r.kept).length === 2, `group A rows = ${JSON.stringify(infoA)}`);
      assert(infoB.filter((r) => r.kept && !r.box).length === 1 && infoB.filter((r) => r.box && !r.kept).length === 1, `group B rows = ${JSON.stringify(infoB)}`);
      const keptA = idsA[infoA.findIndex((r) => r.kept)];
      const keptB = idsB[infoB.findIndex((r) => r.kept)];
      const extrasA = idsA.filter((id) => id !== keptA);
      const extraB = idsB.find((id) => id !== keptB);

      const total = await appPage.$$eval("#dialog table.dupes input[type=checkbox]", (bs) => bs.length);
      const allChecked = await appPage.$$eval("#dialog table.dupes input[type=checkbox]", (bs) => bs.every((b) => b.checked));
      const initial = await buttonLabel();
      assert(allChecked && initial.text === `Close ${total} selected` && !initial.disabled, `default: all checked=${allChecked}, button ${JSON.stringify(initial)}, ${total} boxes`);
      await appPage.click('#dialog button:has-text("Select none")');
      const none = await buttonLabel();
      assert(none.text === "Close 0 selected" && none.disabled, `after Select none: ${JSON.stringify(none)}`);
      await appPage.click('#dialog button:has-text("Select all")');
      const all = await buttonLabel();
      assert(all.text === `Close ${total} selected` && !all.disabled, `after Select all: ${JSON.stringify(all)}`);

      // Leave any duplicate outside this fixture alone, then uncheck one of group A's extra copies.
      const mine = created.map(String);
      const foreign = await appPage.$$eval("#dialog table.dupes input[type=checkbox]", (bs, ours) => {
        let n = 0;
        for (const b of bs) if (!ours.includes(b.dataset.tab)) { b.click(); n++; }
        return n;
      }, mine);
      const spared = extrasA[0];
      await appPage.click(`#dialog tr[data-tab="${spared}"] input[type=checkbox]`);
      // Keep the other copy in group B instead: the marker moves, the old kept copy gets a ticked checkbox.
      await appPage.click(`#dialog tr[data-tab="${extraB}"] input[type=radio]`);
      const swappedNew = await rowInfo(extraB);
      const swappedOld = await rowInfo(keptB);
      const oldBoxChecked = await appPage.$eval(`#dialog tr[data-tab="${keptB}"] input[type=checkbox]`, (b) => b.checked).catch(() => null);
      const sparedStill = await appPage.$eval(`#dialog tr[data-tab="${spared}"] input[type=checkbox]`, (b) => b.checked);
      assert(swappedNew.kept && !swappedNew.box && swappedOld.box && !swappedOld.kept && oldBoxChecked === true && sparedStill === false, `after Keep moved to ${extraB}: new ${JSON.stringify(swappedNew)}, old ${JSON.stringify(swappedOld)} checked=${oldBoxChecked}, spared checked=${sparedStill}`);
      const toClose = [extrasA[1], keptB];
      const chosen = await buttonLabel();
      assert(chosen.text === `Close ${toClose.length} selected` && !chosen.disabled, `after unchecking ${spared}: ${JSON.stringify(chosen)}`);
      await appPage.click(`#dialog button:has-text("Close ${toClose.length} selected")`);
      const open = await waitFor(async () => {
        const present = await (await worker()).evaluate(async (ids) => {
          const out = [];
          for (const id of ids) { try { await chrome.tabs.get(id); out.push(id); } catch { /* closed */ } }
          return out;
        }, created);
        return toClose.every((id) => !present.includes(id)) ? present : null;
      });
      const expectedOpen = [keptA, spared, extraB].sort((a, b) => a - b);
      assert(JSON.stringify([...open].sort((a, b) => a - b)) === JSON.stringify(expectedOpen), `tabs still open ${JSON.stringify(open)}, expected ${JSON.stringify(expectedOpen)}`);
      const toastText = await appPage.$eval("#toast", (n) => n.textContent);
      assert(toastText === `Closed ${toClose.length} duplicates`, `toast = "${toastText}"`);
      const foreignNote = foreign ? ` (and ${foreign} foreign row(s))` : "";
      record("T", "PASS", `two groups (${urlA} x3, ${urlB} x2): kept rows carry the kept marker and no checkbox; default "Close ${total} selected", Select none -> "Close 0 selected" disabled, Select all -> back; unchecked ${spared}${foreignNote}, moved Keep in group B from ${keptB} to ${extraB} (marker moved, ${keptB} got a ticked checkbox) -> "${chosen.text}"; closed exactly ${JSON.stringify(toClose)}; still open ${JSON.stringify(expectedOpen)} incl. the unchecked ${spared} and the newly kept ${extraB}, previously kept ${keptB} closed; toast "${toastText}"`);
      await (await worker()).evaluate((ids) => chrome.tabs.remove(ids).catch(() => {}), open);
    } catch (e) {
      record("T", "FAIL", e.message);
    }
    await resetUi();

    // ---------------------------------------------------------------
    // 1.2 Keeper scenarios U-Z. Z (auto-discard) may crash Playwright's
    // Chromium (chrome.tabs.discard), so it runs last of them and relaunches.
    // ---------------------------------------------------------------
    const badgeText = async () => (await worker()).evaluate(() => chrome.action.getBadgeText({}));
    async function expectBadge(label) {
      let want = null;
      let got = null;
      try {
        await waitFor(async () => {
          want = String((await expectedCounts()).tabCount);
          got = await badgeText();
          return got === want;
        }, { timeout: 8000 });
      } catch {
        throw new Error(`${label}: badge "${got}", expected "${want}"`);
      }
      return got;
    }
    async function anyNormalWindowId() {
      const wins = await (await worker()).evaluate(() => chrome.windows.getAll({ windowTypes: ["normal"] }));
      return wins[0].id;
    }

    // ---------------------------------------------------------------
    // U. The icon badge counts tabs after opening and closing one
    // ---------------------------------------------------------------
    try {
      const first = await expectBadge("at start");
      const windowId = await anyNormalWindowId();
      const created = await (await worker()).evaluate(({ windowId: wid, url }) => chrome.tabs.create({ windowId: wid, url, active: false }), { windowId, url: `${oneUrl}?badge=1` });
      const opened = await expectBadge("after opening a tab");
      assert(Number(opened) === Number(first) + 1, `badge went ${first} -> ${opened} after opening a tab`);
      await (await worker()).evaluate((id) => chrome.tabs.remove(id), created.id);
      const closed = await expectBadge("after closing it");
      assert(closed === first, `badge went ${opened} -> ${closed} after closing the tab`);
      record("U", "PASS", `badge "${first}" -> "${opened}" after opening a tab -> "${closed}" after closing it (each equal to the non-TabVault tab count)`);
    } catch (e) {
      record("U", "FAIL", e.message);
    }

    // ---------------------------------------------------------------
    // V. Recently closed: a closed tab is listed and reopens in the
    // current window; a closed window's tabs reopen together
    // ---------------------------------------------------------------
    try {
      const recentList = async () => (await worker()).evaluate(() => chrome.storage.local.get("recentlyClosed").then((r) => r.recentlyClosed || []));
      const windowId = await anyNormalWindowId();
      const rcUrl = `${threeUrl}?rc=1`;
      const t = await (await worker()).evaluate(({ wid, url }) => chrome.tabs.create({ windowId: wid, url, active: false }), { wid: windowId, url: rcUrl });
      await waitFor(async () => (await (await worker()).evaluate((id) => chrome.tabs.get(id), t.id)).url === rcUrl, { timeout: 10000 });
      await (await worker()).evaluate((id) => chrome.tabs.remove(id), t.id);
      const entry = await waitFor(async () => (await recentList()).find((e) => e.url === rcUrl), { timeout: 8000 });

      await appPage.waitForSelector("#recent:not([hidden])");
      const heading = await appPage.$eval("#recent-toggle", (n) => n.textContent);
      assert((await appPage.$eval("#recent-list", (n) => n.hidden)) === true, "the section is not collapsed by default");
      await appPage.click("#recent-toggle");
      await appPage.waitForSelector(`#recent-list [data-recent="${entry.id}"]`);
      const ownWindow = await appPage.evaluate(() => chrome.tabs.getCurrent().then((x) => x.windowId));
      await appPage.click(`#recent-list [data-recent="${entry.id}"] button.reopen`);
      const reopened = await waitFor(async () => {
        const ts = await (await worker()).evaluate((url) => chrome.tabs.query({ url }), rcUrl);
        return ts[0] || null;
      }, { timeout: 10000 });
      assert(reopened.windowId === ownWindow, `reopened in window ${reopened.windowId}, the current window is ${ownWindow}`);
      await waitFor(async () => !(await recentList()).some((e) => e.id === entry.id));
      await (await worker()).evaluate((id) => chrome.tabs.remove(id), reopened.id);

      const batchUrls = [`${oneUrl}?rcw=1`, `${twoUrl}?rcw=1`];
      const winV = await (await worker()).evaluate((urls) => chrome.windows.create({ url: urls, focused: false }), batchUrls);
      await waitFor(async () => {
        const ts = await (await worker()).evaluate((id) => chrome.tabs.query({ windowId: id }), winV.id);
        return ts.length === 2 && ts.every((x) => String(x.url || "").includes("?rcw=1"));
      }, { timeout: 15000 });
      await (await worker()).evaluate((id) => chrome.windows.remove(id), winV.id);
      const batch = await waitFor(async () => {
        const list = await recentList();
        const mine = list.filter((e) => batchUrls.includes(e.url) && e.batch);
        return mine.length === 2 && mine[0].batch === mine[1].batch ? mine[0].batch : null;
      }, { timeout: 8000 });
      await appPage.waitForSelector(`#recent-list [data-batch="${batch}"] button.reopen-all`);
      await appPage.click(`#recent-list [data-batch="${batch}"] button.reopen-all`);
      const back = await waitFor(async () => {
        const all = await (await worker()).evaluate(() => chrome.tabs.query({}));
        const mine = all.filter((x) => batchUrls.includes(x.url));
        return mine.length === 2 && mine[0].windowId === mine[1].windowId ? mine : null;
      }, { timeout: 10000 });
      await (await worker()).evaluate((id) => chrome.windows.remove(id), back[0].windowId);
      record("V", "PASS", `closed ${rcUrl}: listed (heading "${heading.trim()}", collapsed by default), Reopen put it back in the current window ${ownWindow} and removed the entry; a closed 2-tab window was listed as batch ${batch} and Reopen all brought both back in one window`);
    } catch (e) {
      record("V", "FAIL", e.message);
    }
    await resetUi();

    // ---------------------------------------------------------------
    // W. Command palette: Alt+K opens it, typing filters actions and
    // tabs, Enter runs the action, Esc closes
    // ---------------------------------------------------------------
    try {
      // V's Reopen can leave another tab active in TabVault's window; keys go to the page in front.
      await appPage.bringToFront();
      await appPage.evaluate(() => window.TabVaultApp.refresh());
      await blurAll();
      await appPage.evaluate(() => { window.__wkeys = []; document.addEventListener("keydown", (k) => window.__wkeys.push([k.key, k.code, k.altKey, k.defaultPrevented]), true); });
      await appPage.keyboard.press("Alt+K");
      await appPage.waitForSelector("#palette-backdrop:not([hidden])", { timeout: 10000 });
      const focusedInput = await appPage.evaluate(() => document.activeElement && document.activeElement.id);
      assert(focusedInput === "palette-input", `focus after Alt+K is on ${focusedInput}`);
      const allRows = await appPage.$$eval("#palette-list .prow", (rs) => rs.length);

      await appPage.keyboard.type("duplicates");
      await waitFor(async () => (await appPage.$eval("#palette-list .prow.on", (n) => n.dataset.action).catch(() => null)) === "dupes");
      const dupeKeys = await appPage.$eval('#palette-list .prow[data-action="dupes"] .pkeys', (n) => n.textContent);
      assert(dupeKeys === "d", `the duplicates row shows keys "${dupeKeys}"`);

      await appPage.fill("#palette-input", "Three");
      const tabRow = await waitFor(async () => appPage.$eval('#palette-list .prow[data-kind="tab"]', (n) => n.textContent).catch(() => null));
      assert(/Three/.test(tabRow), `tab row text "${tabRow}"`);

      const indexBefore = await (await worker()).evaluate(() => chrome.storage.local.get("snapIndex").then((r) => (r.snapIndex || []).length));
      await appPage.fill("#palette-input", "snapshot now");
      await waitFor(async () => (await appPage.$eval("#palette-list .prow.on", (n) => n.dataset.action).catch(() => null)) === "snapshot");
      await appPage.keyboard.press("Enter");
      await appPage.waitForSelector("#palette-backdrop[hidden]", { state: "attached" });
      const newest = await waitFor(async () => {
        const index = await (await worker()).evaluate(() => chrome.storage.local.get("snapIndex").then((r) => r.snapIndex || []));
        return index.length > indexBefore && index[0].reason === "manual" ? index[0] : null;
      }, { timeout: 8000 });

      await appPage.keyboard.press("Alt+K");
      await appPage.waitForSelector("#palette-backdrop:not([hidden])");
      await appPage.keyboard.press("Escape");
      await appPage.waitForSelector("#palette-backdrop[hidden]", { state: "attached" });
      record("W", "PASS", `Alt+K opened the palette with focus in its input (${allRows} rows on an empty query); "duplicates" selected the dupes action showing key "d"; "Three" listed a tab row; "snapshot now" + Enter closed it and stored manual snapshot ${newest.id}; Esc closed it again`);
    } catch (e) {
      const why = await appPage.evaluate(() => ({
        active: document.activeElement && (document.activeElement.id || document.activeElement.tagName),
        dialog: !document.getElementById("dialog-backdrop").hidden,
        menus: [...document.querySelectorAll(".menu:not([hidden])")].map((m) => m.id),
        palette: !document.getElementById("palette-backdrop").hidden,
        visible: document.visibilityState, focused: document.hasFocus(), keys: window.__wkeys,
      })).catch((x) => String(x));
      record("W", "FAIL", `${e.message} | page state ${JSON.stringify(why)}`);
    }
    await appPage.keyboard.press("Escape").catch(() => {});
    await resetUi();

    // ---------------------------------------------------------------
    // X. Save and close: Shift+S and the card button both ask first with
    // the count; Cancel keeps the tabs; confirming stores a kept, named
    // snapshot and closes the window's tabs
    // ---------------------------------------------------------------
    try {
      const xUrls = [`${oneUrl}?x=1`, `${twoUrl}?x=1`];
      const winX = await (await worker()).evaluate((urls) => chrome.windows.create({ url: urls, focused: false }), xUrls);
      const tabsX = await waitFor(async () => {
        const ts = await (await worker()).evaluate((id) => chrome.tabs.query({ windowId: id }), winX.id);
        return ts.length === 2 && ts.every((t) => String(t.url || "").includes("?x=1")) ? ts.sort((a, b) => a.index - b.index) : null;
      }, { timeout: 15000 });
      await appPage.evaluate(() => window.TabVaultApp.refresh());
      await appPage.waitForSelector(`.window[data-window="${winX.id}"]`);

      await appPage.click(`.tab[data-tab="${tabsX[0].id}"] input[type=checkbox]`);
      await blurAll();
      await appPage.keyboard.press("Shift+S");
      const askedByKey = await waitForTextContains(appPage, "#save-close-text", "Save 2 tabs and close them?");
      const focusOn = await appPage.evaluate(() => document.activeElement && document.activeElement.id);
      assert(focusOn === "save-close-cancel", `the confirmation opened with focus on ${focusOn}, not Cancel`);
      await appPage.click("#save-close-cancel");
      await waitFor(async () => appPage.$eval("#dialog-backdrop", (n) => n.hidden));
      await clearSelection();
      const stillOpen = await (await worker()).evaluate((id) => chrome.tabs.query({ windowId: id }).then((ts) => ts.length), winX.id);
      assert(stillOpen === 2, `after Cancel the window has ${stillOpen} tabs`);

      const indexBefore = await (await worker()).evaluate(() => chrome.storage.local.get("snapIndex").then((r) => (r.snapIndex || []).length));
      await appPage.click(`.window[data-window="${winX.id}"] .whead button[title="Save and close window"]`);
      await waitForTextContains(appPage, "#save-close-text", "Save 2 tabs and close them?");
      await appPage.click("#save-close-go");
      await waitFor(async () => (await worker()).evaluate((id) => chrome.windows.get(id).then(() => false, () => true), winX.id), { timeout: 10000 });
      const snap = await waitFor(async () => {
        const index = await (await worker()).evaluate(() => chrome.storage.local.get("snapIndex").then((r) => r.snapIndex || []));
        return index.length > indexBefore ? index.find((s) => s.reason === "save-close") : null;
      });
      assert(snap && snap.pinned === true && snap.tabs === 2 && snap.windows === 1 && /· [0-9]/.test(snap.name || ""), `save-close snapshot ${JSON.stringify(snap)}`);
      const full = await (await worker()).evaluate((id) => chrome.storage.local.get(`snap:${id}`), snap.id);
      const urls = full[`snap:${snap.id}`].session.windows[0].tabs.map((t) => t.url);
      assert(xUrls.every((u) => urls.includes(u)), `snapshot URLs ${JSON.stringify(urls)}`);
      record("X", "PASS", `Shift+S on a row of window ${winX.id} asked "${askedByKey}" with focus on Cancel; Cancel kept both tabs; the card button asked again and confirming stored kept snapshot "${snap.name}" (2 tabs, both URLs) and closed the window`);
    } catch (e) {
      record("X", "FAIL", e.message);
    }
    await resetUi();

    // ---------------------------------------------------------------
    // Y. Side panel layout (?panel=1). Playwright cannot drive Chrome's
    // side panel itself, so the page is opened as a narrow tab of a
    // fixture window: the layout is asserted, not the panel API.
    // ---------------------------------------------------------------
    let panelPage = null;
    try {
      const options = await (await worker()).evaluate(() => (chrome.sidePanel ? chrome.sidePanel.getOptions({}) : null));
      assert(options && String(options.path || "").endsWith("app/index.html?panel=1"), `side panel options ${JSON.stringify(options)}`);
      const winY = await (await worker()).evaluate((urls) => chrome.windows.create({ url: urls, focused: false }), [`${oneUrl}?y=1`, `${twoUrl}?y=1`]);
      const tabsY = await waitFor(async () => {
        const ts = await (await worker()).evaluate((id) => chrome.tabs.query({ windowId: id }), winY.id);
        return ts.length === 2 && ts.every((t) => String(t.url || "").includes("?y=1")) ? ts.sort((a, b) => a.index - b.index) : null;
      }, { timeout: 15000 });
      const panelUrl = `${ownPrefix}app/index.html?panel=1`;
      const pageEvent = context.waitForEvent("page", { timeout: 10000 });
      await (await worker()).evaluate(({ wid, url }) => chrome.tabs.create({ windowId: wid, url, active: true }), { wid: winY.id, url: panelUrl });
      panelPage = await pageEvent;
      attachPageListeners(panelPage);
      await panelPage.setViewportSize({ width: 380, height: 760 });
      await panelPage.waitForSelector(".window");

      const layout = await panelPage.evaluate(() => document.documentElement.dataset.layout);
      assert(layout === "panel", `data-layout = "${layout}"`);
      const columns = await panelPage.$eval("#grid", (n) => getComputedStyle(n).gridTemplateColumns.trim().split(/ +/).length);
      assert(columns === 1, `the grid has ${columns} columns`);
      const cards = await panelPage.$$eval("#grid .window", (ns) => ns.map((n) => ({ id: Number(n.dataset.window), current: n.classList.contains("current"), collapsed: n.classList.contains("collapsed") })));
      assert(cards.length >= 2, `expected the panel window and at least one other, got ${JSON.stringify(cards)}`);
      assert(cards[0].id === winY.id && cards[0].current && !cards[0].collapsed, `first card ${JSON.stringify(cards[0])}, the panel's window is ${winY.id}`);
      assert(cards.slice(1).every((c) => c.collapsed && !c.current), `other cards not all collapsed: ${JSON.stringify(cards.slice(1))}`);
      const searchTop = await panelPage.$eval("#search", (n) => n.getBoundingClientRect().top);
      await panelPage.$eval("#main", (n) => { n.scrollTop = n.scrollHeight; });
      const searchTopAfter = await panelPage.$eval("#search", (n) => n.getBoundingClientRect().top);
      assert(searchTop < 120 && searchTopAfter === searchTop, `search box top ${searchTop} -> ${searchTopAfter} after scrolling`);
      const panelEntry = await panelPage.$eval("#btn-panel", (n) => n.hidden);
      assert(panelEntry === true, "the Open in side panel entry is visible inside the panel");
      await panelPage.click(`.tab[data-tab="${tabsY[1].id}"] input[type=checkbox]`);
      await panelPage.waitForSelector("#selbar:not([hidden])");
      const bar = await panelPage.$eval("#selbar", (n) => { const r = n.getBoundingClientRect(); return { bottom: Math.round(r.bottom), width: Math.round(r.width) }; });
      const vh = await panelPage.evaluate(() => window.innerHeight);
      assert(bar.bottom >= vh - 60, `bulk bar bottom ${bar.bottom} in a ${vh} px panel`);
      await panelPage.screenshot({ path: path.join(ROOT, "panel-layout.png") });
      record("Y", "PASS", `side panel path ${options.path}; ?panel=1 page: data-layout=panel, 1 grid column, cards ${JSON.stringify(cards.map((c) => [c.id, c.current ? "current" : c.collapsed ? "collapsed" : "open"]))}, search pinned at ${searchTop}px through a scroll, menu entry hidden, bulk bar bottom ${bar.bottom}/${vh}px. Screenshot: panel-layout.png`);
      await (await worker()).evaluate((id) => chrome.windows.remove(id), winY.id).catch(() => {});
    } catch (e) {
      record("Y", "FAIL", e.message);
    }
    if (panelPage && !panelPage.isClosed()) await panelPage.close().catch(() => {});
    await appPage.bringToFront().catch(() => {});

    // == 1.2 next ==    // ---------------------------------------------------------------
    // Z. Auto-discard: the settings round-trip, the plan on real tabs,
    // then the run itself. chrome.tabs.discard crashes Playwright's
    // Chromium here (see I-b), so the run is PASS when it survives and
    // LIMITED when the browser dies; the plan part must pass either way.
    // ---------------------------------------------------------------
    try {
      const winZ = await (await worker()).evaluate((urls) => chrome.windows.create({ url: urls, focused: false }), [`${oneUrl}?z=1`, `${twoUrl}?z=1`, `${threeUrl}?z=1`]);
      const tabsZ = await waitFor(async () => {
        const ts = await (await worker()).evaluate((id) => chrome.tabs.query({ windowId: id }), winZ.id);
        return ts.length === 3 && ts.every((t) => String(t.url || "").includes("?z=1")) ? ts.sort((a, b) => a.index - b.index) : null;
      }, { timeout: 15000 });
      await (await worker()).evaluate((id) => chrome.tabs.update(id, { pinned: true }), tabsZ[1].id);

      await appPage.evaluate(() => window.TabVaultApp.refresh());
      await openMenuItem("#btn-settings");
      await appPage.waitForSelector("#ad-enabled");
      const lineBefore = await appPage.$eval("#ad-last-run", (n) => n.textContent);
      // Naqid finding 2: only autoDiscardable can be checked, so no promise about forms is made.
      const note = await appPage.$eval("#dialog", (n) => n.textContent);
      assert(note.includes("tabs an extension marked as not discardable") && !/form you are/i.test(note), "the never-unloaded note still promises unsaved forms or lacks the not-discardable line");
      await appPage.check("#ad-enabled");
      await appPage.selectOption("#ad-minutes", "15");
      await appPage.click('#dialog button:has-text("Save")');
      const saved = await waitFor(async () => {
        const { settings } = await (await worker()).evaluate(() => chrome.storage.local.get("settings"));
        const ad = settings && settings.autoDiscard;
        return ad && ad.enabled === true && ad.minutes === 15 ? ad : null;
      });
      // Off again before anything can fire: the 5-minute alarm must not discard during L and K.
      await (await worker()).evaluate(async () => {
        const { settings } = await chrome.storage.local.get("settings");
        await chrome.storage.local.set({ settings: { ...settings, autoDiscard: { ...settings.autoDiscard, enabled: false } } });
      });

      const later = Date.now() + 3 * 3600000;
      const { plan } = await (await worker()).evaluate((now) => self.planAutoDiscard({ now }), later);
      const [activeZ, pinnedZ, idleZ] = tabsZ;
      assert(plan.ids.includes(idleZ.id), `the idle tab ${idleZ.id} is not in the plan ${JSON.stringify(plan)}`);
      assert(!plan.ids.includes(activeZ.id), `the active tab ${activeZ.id} is in the plan`);
      assert(!plan.ids.includes(pinnedZ.id), `the pinned tab ${pinnedZ.id} is in the plan`);
      assert(plan.ids.length <= 25, `plan exceeds the cap: ${plan.ids.length}`);
      const planEvidence = `settings saved ${JSON.stringify(saved)} (line before: "${lineBefore}"); plan at +3h: ${plan.ids.length} of ${plan.eligible} eligible, includes idle ${idleZ.id}, excludes active ${activeZ.id} and pinned ${pinnedZ.id}`;

      let run = null;
      let threw = false;
      try {
        run = await (await worker()).evaluate((now) => self.runAutoDiscard({ now, force: true }), later);
      } catch (e) {
        if (!looksLikeDisconnect(e)) throw e;
        threw = true;
      }
      const relaunched = await settleAndRelaunchIfDisconnected("after the auto-discard run");
      if (threw || relaunched) {
        record("Z", "LIMITED", `${planEvidence}; the run's chrome.tabs.discard crashed Playwright's Chromium (the documented quirk), browser relaunched`);
      } else {
        assert(run && run.ok && run.unloaded >= 1, `run result ${JSON.stringify(run)}`);
        const lastRun = await (await worker()).evaluate(() => chrome.storage.session.get("autoDiscard.lastRun"));
        assert(lastRun["autoDiscard.lastRun"] && lastRun["autoDiscard.lastRun"].unloaded === run.unloaded, `lastRun ${JSON.stringify(lastRun)}`);
        await appPage.evaluate(() => window.TabVaultApp.refresh());
        const zz = await waitFor(async () => appPage.$eval(`.tab[data-tab="${idleZ.id}"] .flags`, (n) => n.textContent).catch(() => null).then((x) => (x && x.includes("zz") ? x : null)), { timeout: 8000 }).catch(() => "(row replaced: discard gave the tab a new id)");
        await openMenuItem("#btn-settings");
        const line = await waitForTextContains(appPage, "#ad-last-run", "unloaded");
        record("Z", "PASS", `${planEvidence}; run: ${JSON.stringify(run)}; flags of ${idleZ.id}: ${zz}; settings line "${line}"`);
      }
    } catch (e) {
      record("Z", "FAIL", e.message);
    }
    await resetUi().catch(() => {});

    // ---------------------------------------------------------------
    // 1.3 Shelf scenarios AA-AE. Restores in them run with lazy restore
    // off (chrome.tabs.discard crashes Playwright's Chromium, see I-b);
    // the idle rules run with the global unload setting off, so nothing
    // is discarded. The AA fixture uses 127.0.0.1 (the same server) so a
    // rule for that host touches no other fixture tab.
    // ---------------------------------------------------------------
    const ipBase = "http://127.0.0.1:8765/test-pages";
    const settingsNow = async () => (await (await worker()).evaluate(() => chrome.storage.local.get("settings"))).settings || {};
    async function patchSettings(patch) {
      await (await worker()).evaluate(async (p) => {
        const { settings = {} } = await chrome.storage.local.get("settings");
        await chrome.storage.local.set({ settings: { ...settings, ...p } });
      }, patch);
      await appPage.evaluate(() => window.TabVaultApp.refresh()).catch(() => {});
    }
    async function openWindowWith(urls) {
      const w = await (await worker()).evaluate((u) => chrome.windows.create({ url: u, focused: false }), urls);
      const tabs = await waitFor(async () => {
        const ts = await (await worker()).evaluate((id) => chrome.tabs.query({ windowId: id }), w.id);
        return ts.length === urls.length && urls.every((u) => ts.some((t) => t.url === u && t.title && t.status === "complete")) ? ts.sort((a, b) => a.index - b.index) : null;
      }, { timeout: 15000 });
      return { win: w, tabs };
    }
    const tabGone = async (id) => (await worker()).evaluate((tid) => chrome.tabs.get(tid).then(() => false, () => true), id);
    const shelfItems = async (shelfId) => (await worker()).evaluate((id) => self.TabVault.readShelf(chrome.storage.local, id), shelfId);
    let aaShelfId = null;
    let aaUrls = [];
    try {
      await appPage.evaluate(() => window.TabVaultApp.saveSettings({ lazyRestore: false }));
    } catch (e) {
      console.log("  could not turn lazy restore off: " + e.message);
    }

    // ---------------------------------------------------------------
    // AA. Idle rules: a shelving rule is created off, its switch stays
    // locked until the dry run, the dry run lists the fixture tabs, and
    // Run idle rules now shelves the idle ones (never the active tab),
    // tags their Recently closed entries, and records nothing there
    // when "Remember recently closed tabs" is off
    // ---------------------------------------------------------------
    try {
      aaUrls = [`${ipBase}/one.html?aa=1`, `${ipBase}/two.html?aa=1`, `${ipBase}/three.html?aa=1`];
      const { win: winAA, tabs: tabsAA } = await openWindowWith(aaUrls);
      const [activeAA, idle1, idle2] = tabsAA;
      assert(activeAA.active, `the first fixture tab is not the active one: ${JSON.stringify(tabsAA.map((t) => [t.id, t.active]))}`);
      const gid = await (await worker()).evaluate(({ tabId, windowId }) => chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId } }), { tabId: idle2.id, windowId: winAA.id });
      await (await worker()).evaluate((g) => chrome.tabGroups.update(g, { title: "AA Grp", color: "red" }), gid);

      await appPage.evaluate(() => window.TabVaultApp.refresh());
      await openMenuItem("#btn-settings");
      await appPage.waitForSelector("#rule-add");
      await appPage.click("#rule-add");
      await appPage.waitForSelector("#rule-editor");
      await appPage.fill("#rule-pattern", "*.com");
      await appPage.click("#rule-dry-run");
      const refused = await waitForTextContains(appPage, "#rule-error", "whole domain ending");
      await appPage.fill("#rule-pattern", "127.0.0.1");
      await appPage.selectOption("#rule-minutes", "15");

      // Naqid fix 1: a dry run made as Unload (here on 60 more tabs of the host) must not unlock
      // the rule once it is switched to Shelve; the Shelve dry run brings back the 50-tab question.
      const bigUrls = Array.from({ length: 60 }, (_, n) => `${ipBase}/one.html?big=${n}`);
      const bigWin = await (await worker()).evaluate((u) => chrome.windows.create({ url: u, focused: false }), bigUrls);
      await waitFor(async () => {
        const ts = await (await worker()).evaluate((id) => chrome.tabs.query({ windowId: id }), bigWin.id);
        return ts.length === 60 && ts.every((x) => x.status === "complete" && String(x.url).includes("?big="));
      }, { timeout: 60000, interval: 500 });
      await (await worker()).evaluate(() => { self.idleClockOffset = 3 * 3600000; });
      await appPage.check('input[name="rule-action"][value="unload"]');
      await appPage.click("#rule-dry-run");
      await waitForTextContains(appPage, "#rule-dry-result", "would be unloaded now");
      assert(!(await appPage.$eval("#rule-on", (n) => n.disabled)), "an Unload rule's switch is locked");
      await appPage.check('input[name="rule-action"][value="shelve"]');
      assert(await appPage.$eval("#rule-on", (n) => n.disabled), "switching from Unload to Shelve after an Unload dry run left the switch unlocked");
      assert((await appPage.$eval("#rule-dry-result", (n) => n.textContent)) === "", "the Unload preview is still shown for the Shelve rule");
      await appPage.selectOption("#rule-shelf", "new");
      await appPage.fill("#rule-new-shelf", "E2E Shelf");
      const lockedBefore = await appPage.$eval("#rule-on", (n) => n.disabled);
      assert(lockedBefore === true, "the On switch is not locked before the dry run");
      await appPage.click("#rule-dry-run");
      const largeText = await waitForTextContains(appPage, "#rule-confirm-box", "Turn it on anyway?");
      assert(/matches 6[0-9] open tabs/.test(largeText), `the large-match question said "${largeText}"`);
      assert(await appPage.$eval("#rule-on", (n) => n.disabled), "the switch unlocked above 50 matches without the second confirmation");
      await (await worker()).evaluate((id) => chrome.windows.remove(id), bigWin.id);
      await waitFor(async () => (await (await worker()).evaluate((id) => chrome.windows.get(id).then(() => false, () => true), bigWin.id)));

      await appPage.click("#rule-dry-run");
      const dryText = await waitForTextContains(appPage, "#rule-dry-result", "would be shelved now");
      assert(/2 tabs would be shelved now/.test(dryText) && dryText.includes("Two") && dryText.includes("Three") && !dryText.includes("One"), `dry run said "${dryText}"`);
      const lockedAfter = await appPage.$eval("#rule-on", (n) => n.disabled);
      assert(lockedAfter === false, "the On switch did not unlock after the dry run");
      await appPage.selectOption("#rule-minutes", "30");
      assert(await appPage.$eval("#rule-on", (n) => n.disabled), "changing the idle time did not lock the switch again");
      await appPage.selectOption("#rule-minutes", "15");
      assert(!(await appPage.$eval("#rule-on", (n) => n.disabled)), "going back to the dry-run values did not unlock it");
      await appPage.check("#rule-on");
      await appPage.click("#rule-save");
      const savedRule = await waitFor(async () => {
        const s = await settingsNow();
        const r = (s.idleRules || []).find((x) => x.pattern === "127.0.0.1");
        return r && r.enabled === true && r.previewedFor === "127.0.0.1|15|shelve" && r.shelfId ? r : null;
      });
      aaShelfId = savedRule.shelfId;
      const recordedBefore = (await settingsNow()).recordClosed !== false;

      await appPage.click("#idle-run-now");
      await waitFor(async () => (await tabGone(idle1.id)) && (await tabGone(idle2.id)), { timeout: 10000 });
      assert(!(await tabGone(activeAA.id)), "the active tab was shelved");
      const items = await shelfItems(aaShelfId);
      assert(items.length === 2 && items.some((x) => x.url === aaUrls[1]) && items.some((x) => x.url === aaUrls[2]), `shelf items ${JSON.stringify(items.map((x) => x.url))}`);
      const grouped = items.find((x) => x.url === aaUrls[2]);
      assert(grouped.group && grouped.group.title === "AA Grp" && grouped.group.color === "red", `the grouped item kept ${JSON.stringify(grouped.group)}`);
      const tagged = await waitFor(async () => {
        const list = (await (await worker()).evaluate(() => chrome.storage.local.get("recentlyClosed"))).recentlyClosed || [];
        const mine = list.filter((e) => aaUrls.slice(1).includes(e.url));
        return mine.length === 2 && mine.every((e) => e.shelf && e.shelf.id === aaShelfId) ? mine : null;
      }, { timeout: 8000 });
      const line = await waitForTextContains(appPage, "#ad-last-run", "2 shelved");

      const extraUrl = `${ipBase}/one.html?aa=2`;
      const extra = await (await worker()).evaluate(({ wid, url }) => chrome.tabs.create({ windowId: wid, url, active: false }), { wid: winAA.id, url: extraUrl });
      await waitFor(async () => (await (await worker()).evaluate((id) => chrome.tabs.get(id), extra.id)).status === "complete", { timeout: 10000 });
      await patchSettings({ recordClosed: false });
      const run2 = await (await worker()).evaluate(() => self.runIdleRules({ manual: true }));
      assert(run2.ok && run2.shelved === 1, `second run ${JSON.stringify(run2)}`);
      await waitFor(async () => tabGone(extra.id));
      await new Promise((r) => setTimeout(r, 1500));
      const after = (await (await worker()).evaluate(() => chrome.storage.local.get("recentlyClosed"))).recentlyClosed || [];
      assert(!after.some((e) => e.url === extraUrl), "a shelved tab was recorded while Remember recently closed tabs was off");
      assert((await shelfItems(aaShelfId)).some((x) => x.url === extraUrl), "the third tab is not on the shelf");
      await patchSettings({ recordClosed: recordedBefore });
      record("AA", "PASS", `"*.com" refused ("${refused.trim()}"); an Unload dry run on 60 more tabs left the switch locked once the action became Shelve, and the Shelve dry run asked "${largeText.trim()}" with the switch still locked; rule 127.0.0.1 / 15 min / shelve to a new shelf created with the switch locked; the dry run said "${dryText.trim()}" and unlocked it (a changed time locked it again); saved on ${JSON.stringify(savedRule)}; Run idle rules now shelved ${idle1.id} and ${idle2.id} (the active ${activeAA.id} stayed), the grouped item kept AA Grp/red, both Recently closed entries tagged with the shelf (${tagged.map((e) => e.shelf.name).join(", ")}); line "${line}"; with Remember recently closed off a third shelved tab left no entry`);
    } catch (e) {
      record("AA", "FAIL", e.message);
    }
    // The rule off and the clock back, so the 5-minute alarm cannot shelve anything later.
    await (await worker()).evaluate(async () => {
      self.idleClockOffset = 0;
      const { settings = {} } = await chrome.storage.local.get("settings");
      await chrome.storage.local.set({ settings: { ...settings, idleRules: (settings.idleRules || []).map((r) => ({ ...r, enabled: false })) } });
    }).catch(() => {});
    await resetUi().catch(() => {});

    // ---------------------------------------------------------------
    // AB. The Shelves section: listed with its count and rule, Open
    // brings the grouped item back into a recreated group (the item
    // stays), Open and remove takes it off the shelf
    // ---------------------------------------------------------------
    try {
      assert(aaShelfId, "no shelf from AA");
      await appPage.evaluate(() => window.TabVaultApp.refresh());
      await appPage.waitForSelector("#shelves:not([hidden])");
      assert(await appPage.$eval("#shelves-list", (n) => n.hidden), "the Shelves section is not collapsed by default");
      await appPage.click("#shelves-toggle");
      const head = await waitForTextContains(appPage, `.shelf[data-shelf="${aaShelfId}"] .btitle`, "3 tabs");
      assert(head.includes("E2E Shelf") && head.includes('from rule "127.0.0.1"'), `shelf header "${head}"`);
      await appPage.click(`.shelf[data-shelf="${aaShelfId}"] .s-toggle`);
      await appPage.waitForSelector(`.shelf[data-shelf="${aaShelfId}"] .srow`);
      const items = await shelfItems(aaShelfId);
      const grouped = items.find((x) => x.url === aaUrls[2]);
      const ownWindow = await appPage.evaluate(() => chrome.tabs.getCurrent().then((x) => x.windowId));
      await appPage.click(`.srow[data-item="${grouped.id}"] .s-open`);
      const opened = await waitFor(async () => {
        const ts = await (await worker()).evaluate((url) => chrome.tabs.query({ url }), aaUrls[2]);
        return ts[0] && ts[0].groupId !== -1 ? ts[0] : null;
      }, { timeout: 10000 });
      const g = await (await worker()).evaluate((id) => chrome.tabGroups.get(id), opened.groupId);
      assert(opened.windowId === ownWindow && g.title === "AA Grp" && g.color === "red", `opened in window ${opened.windowId} (own ${ownWindow}) group ${JSON.stringify(g)}`);
      assert((await shelfItems(aaShelfId)).length === 3, "Open removed the item");
      const plain = items.find((x) => x.url === aaUrls[1]);
      await appPage.click(`.srow[data-item="${plain.id}"] .s-open-remove`);
      await waitFor(async () => (await shelfItems(aaShelfId)).length === 2, { timeout: 8000 });
      const reopened = await waitFor(async () => (await (await worker()).evaluate((url) => chrome.tabs.query({ url }), aaUrls[1]))[0] || null, { timeout: 8000 });
      await waitForTextContains(appPage, `.shelf[data-shelf="${aaShelfId}"] .btitle`, "2 tabs");
      await (await worker()).evaluate((ids) => chrome.tabs.remove(ids), [opened.id, reopened.id]).catch(() => {});
      record("AB", "PASS", `Shelves listed collapsed, then "${head.trim()}"; Open put ${aaUrls[2]} back in the current window ${ownWindow} inside a recreated group ${JSON.stringify({ title: g.title, color: g.color })} and kept it on the shelf; Open and remove reopened ${aaUrls[1]} and the shelf went to 2 tabs`);
    } catch (e) {
      record("AB", "FAIL", e.message);
    }
    await resetUi().catch(() => {});

    // ---------------------------------------------------------------
    // AC. Compare a snapshot with now: one tab closed and one opened
    // since show as one missing and one new; Reopen missing brings it back
    // ---------------------------------------------------------------
    try {
      const acUrls = [`${oneUrl}?ac=1`, `${twoUrl}?ac=1`];
      const { win: winAC, tabs: tabsAC } = await openWindowWith(acUrls);
      const snap = await appPage.evaluate(() => chrome.runtime.sendMessage({ type: "snapshotNow" }));
      assert(snap && snap.ok && snap.id, `snapshot ${JSON.stringify(snap)}`);
      const newUrl = `${threeUrl}?ac=1`;
      await (await worker()).evaluate((id) => chrome.tabs.remove(id), tabsAC[1].id);
      await (await worker()).evaluate(({ wid, url }) => chrome.tabs.create({ windowId: wid, url, active: false }), { wid: winAC.id, url: newUrl });
      await waitFor(async () => (await (await worker()).evaluate((url) => chrome.tabs.query({ url }), newUrl)).some((t) => t.status === "complete"), { timeout: 10000 });
      await appPage.evaluate(() => window.TabVaultApp.refresh());
      await appPage.click("#btn-snapshots");
      await appPage.waitForSelector(`[data-snapshot="${snap.id}"] button.compare`);
      await appPage.click(`[data-snapshot="${snap.id}"] button.compare`);
      const counts = await waitForTextContains(appPage, "#compare-counts", "Missing now");
      const missing = await appPage.$$eval('#compare-missing .crow[data-kind="missing"]', (ns) => ns.map((n) => n.dataset.url));
      const added = await appPage.$$eval('#compare-added .crow[data-kind="added"]', (ns) => ns.map((n) => n.dataset.url));
      assert(missing.length === 1 && missing[0] === acUrls[1], `missing ${JSON.stringify(missing)}`);
      assert(added.length === 1 && added[0] === newUrl, `new since ${JSON.stringify(added)}`);
      await appPage.click("#compare-reopen-new");
      const back = await waitFor(async () => (await (await worker()).evaluate((url) => chrome.tabs.query({ url }), acUrls[1]))[0] || null, { timeout: 10000 });
      await waitForTextContains(appPage, "#compare-counts", "Missing now 0");
      await (await worker()).evaluate((ids) => Promise.all(ids.map((id) => chrome.windows.remove(id).catch(() => {}))), [winAC.id, back.windowId]);
      record("AC", "PASS", `snapshot ${snap.id}, then ${acUrls[1]} closed and ${newUrl} opened: Compare showed "${counts.trim()}" with missing ${JSON.stringify(missing)} and new ${JSON.stringify(added)}; Reopen 1 in a new window brought it back (window ${back.windowId}) and the count went to 0`);
    } catch (e) {
      record("AC", "FAIL", e.message);
    }
    await resetUi().catch(() => {});

    // ---------------------------------------------------------------
    // AD. Saved search in the palette: two snapshots and a shelf hold
    // the word; the Saved section lists the snapshot URL once with
    // "+1 older", Enter opens it, Open all opens every match
    // ---------------------------------------------------------------
    try {
      const sUrl = `${oneUrl}?saved=quokka`;
      const shUrl = `${twoUrl}?saved=quokka`;
      await (await worker()).evaluate(async ({ sUrl: a, shUrl: b }) => {
        const TV = self.TabVault;
        const session = { schema: 1, windows: [{ id: 1, type: "normal", windowName: "AD research", groups: [], tabs: [{ id: 1, index: 0, url: a, title: "Quokka field notes", groupId: null }] }] };
        await TV.addSnapshot(chrome.storage.local, TV.makeSnapshot(session, "change", Date.now() - 2 * 3600000), 20);
        await TV.addSnapshot(chrome.storage.local, TV.makeSnapshot(session, "change", Date.now() - 3600000), 20);
        const shelf = await TV.createShelf(chrome.storage.local, "AD shelf");
        await TV.appendItems(chrome.storage.local, shelf.id, [TV.shelfItem({ url: b, title: "Quokka shelf page" }, { savedAt: Date.now() })]);
      }, { sUrl, shUrl });
      await appPage.evaluate(() => window.TabVaultApp.refresh());
      await blurAll();
      await appPage.keyboard.press("Alt+K");
      await appPage.waitForSelector("#palette-backdrop:not([hidden])");
      await appPage.keyboard.type("quokka");
      const rows = await waitFor(async () => {
        const rs = await appPage.$$eval("#palette-list .prow", (ns) => ns.map((n) => ({ kind: n.dataset.kind, url: n.dataset.url || "", text: n.textContent, marks: [...n.querySelectorAll("mark")].map((m) => m.textContent) })));
        return rs.filter((r) => r.kind === "saved").length === 2 ? rs : null;
      }, { timeout: 8000 });
      const snapRow = rows.findIndex((r) => r.url === sUrl);
      assert(snapRow >= 0 && rows[snapRow].text.includes("+1 older") && rows[snapRow].text.includes("snapshot") && rows[snapRow].text.includes("AD research"), `snapshot row ${JSON.stringify(rows[snapRow])}`);
      assert(rows[snapRow].marks.includes("Quokka"), `no highlight in ${JSON.stringify(rows[snapRow])}`);
      assert(rows.some((r) => r.url === shUrl && r.text.includes("shelf AD shelf")), `shelf row missing: ${JSON.stringify(rows)}`);
      assert(rows[rows.length - 1].kind === "openAll", `last row ${JSON.stringify(rows[rows.length - 1])}`);
      const section = await appPage.$$eval("#palette-list .psection", (ns) => ns.map((n) => n.textContent));
      assert(section.includes("Saved"), `sections ${JSON.stringify(section)}`);
      for (let i = 0; i < snapRow; i++) await appPage.keyboard.press("ArrowDown");
      await appPage.keyboard.press("Enter");
      const openedSaved = await waitFor(async () => (await (await worker()).evaluate((url) => chrome.tabs.query({ url }), sUrl))[0] || null, { timeout: 10000 });
      await appPage.bringToFront();
      await (await worker()).evaluate((id) => chrome.tabs.remove(id), openedSaved.id);
      await waitFor(async () => tabGone(openedSaved.id));
      await appPage.evaluate(() => window.TabVaultApp.refresh());
      await blurAll();
      await appPage.keyboard.press("Alt+K");
      await appPage.waitForSelector("#palette-backdrop:not([hidden])");
      await appPage.keyboard.type("quokka");
      await waitFor(async () => (await appPage.$$eval('#palette-list .prow[data-kind="openAll"]', (ns) => ns.length)) === 1, { timeout: 8000 });
      await appPage.keyboard.press("ArrowUp");
      const allText = await appPage.$eval("#palette-list .prow.on", (n) => n.textContent);
      await appPage.keyboard.press("Enter");
      const both = await waitFor(async () => {
        const all = await (await worker()).evaluate(() => chrome.tabs.query({}));
        const a = all.find((t) => t.url === sUrl);
        const b = all.find((t) => t.url === shUrl);
        return a && b && a.windowId === b.windowId ? a.windowId : null;
      }, { timeout: 10000 });
      await appPage.bringToFront();
      await (await worker()).evaluate((id) => chrome.windows.remove(id), both).catch(() => {});
      record("AD", "PASS", `"quokka" listed 2 saved rows (the snapshot URL once with "+1 older", highlighted, and the shelf item) under a Saved section; Enter opened ${sUrl}; "${allText.trim()}" opened both in window ${both}`);
    } catch (e) {
      record("AD", "FAIL", e.message);
    }
    await appPage.keyboard.press("Escape").catch(() => {});
    await appPage.bringToFront().catch(() => {});
    await resetUi().catch(() => {});

    // ---------------------------------------------------------------
    // AE. Markdown: export the selected tabs of a fixture window as
    // Markdown (download captured), paste it into Import with one
    // javascript: link added, restore, compare the URLs and the group
    // ---------------------------------------------------------------
    try {
      const aeUrls = [`${oneUrl}?ae=1`, `${twoUrl}?ae=1`, `${threeUrl}?ae=1`];
      const { win: winAE, tabs: tabsAE } = await openWindowWith(aeUrls);
      const gid = await (await worker()).evaluate(({ ids, windowId }) => chrome.tabs.group({ tabIds: ids, createProperties: { windowId } }), { ids: [tabsAE[1].id, tabsAE[2].id], windowId: winAE.id });
      await (await worker()).evaluate((g) => chrome.tabGroups.update(g, { title: "AE Grp", color: "green" }), gid);
      await appPage.evaluate(() => window.TabVaultApp.refresh());
      await appPage.waitForSelector(`.window[data-window="${winAE.id}"]`);
      for (const t of tabsAE) await appPage.click(`.tab[data-tab="${t.id}"] input[type=checkbox]`);
      await openMenuItem("#btn-export");
      await appPage.waitForSelector("#export-what-selected");
      await appPage.check("#export-what-selected");
      await appPage.check("#export-format-markdown");
      await waitFor(async () => appPage.$eval("#export-download", (n) => !n.disabled && n.textContent === "Download Markdown"));
      const downloadPromise = appPage.waitForEvent("download");
      await appPage.click("#export-download");
      const download = await downloadPromise;
      const mdFile = path.join(DOWNLOAD_DIR, download.suggestedFilename());
      await download.saveAs(mdFile);
      const md = fs.readFileSync(mdFile, "utf8");
      assert(/[.]md$/.test(mdFile) && md.includes("### AE Grp") && aeUrls.every((u) => md.includes(`](${u})`)), `markdown export:${md}`);
      await clearSelection();
      await (await worker()).evaluate((id) => chrome.windows.remove(id), winAE.id);
      await waitFor(async () => (await (await worker()).evaluate((id) => chrome.windows.get(id).then(() => false, () => true), winAE.id)));

      await openMenuItem("#btn-import");
      await appPage.waitForSelector("#import-paste");
      await appPage.fill("#import-paste", md + "- [bad](javascript:alert(1))" + String.fromCharCode(10));
      const summary = await waitForTextContains(appPage, "#import-summary", "Found 1 window, 3 tabs, 1 group");
      assert(summary.includes("1 link skipped: not web pages"), `summary "${summary}"`);
      const before = new Set((await (await worker()).evaluate(() => chrome.windows.getAll())).map((w) => w.id));
      await appPage.click('#dialog button:has-text("Restore selected windows")');
      await waitForTextContains(appPage, "#dialog h2", "Import complete");
      const restored = await waitFor(async () => {
        const wins = await (await worker()).evaluate(() => chrome.windows.getAll({ populate: true }));
        const w = wins.find((x) => !before.has(x.id));
        return w && w.tabs.length === 3 ? w : null;
      }, { timeout: 10000 });
      const got = restored.tabs.sort((a, b) => a.index - b.index).map((t) => t.url || t.pendingUrl);
      assert(JSON.stringify(got) === JSON.stringify(aeUrls), `restored ${JSON.stringify(got)}`);
      const groups = await (await worker()).evaluate((id) => chrome.tabGroups.query({ windowId: id }), restored.id);
      assert(groups.length === 1 && groups[0].title === "AE Grp", `restored groups ${JSON.stringify(groups)}`);
      await (await worker()).evaluate((id) => chrome.windows.remove(id), restored.id).catch(() => {});
      record("AE", "PASS", `exported the 3 selected tabs as ${path.basename(mdFile)} (### AE Grp, three links), pasted it back with a javascript: link: "${summary.trim()}"; restored window ${restored.id} with the same URLs in order and the group "AE Grp"`);
    } catch (e) {
      record("AE", "FAIL", e.message);
    }
    await resetUi().catch(() => {});
    try {
      await appPage.evaluate(() => window.TabVaultApp.saveSettings({ lazyRestore: true }));
    } catch (e) {
      console.log("  could not turn lazy restore back on: " + e.message);
    }



    // ---------------------------------------------------------------
    // AF. Focus mode (1.4), two windows. The harness's manifest copy lists <all_urls> under
    // host_permissions (no one can click Chrome's permission prompt here), and the browser-level
    // shortcut is called through self.runFocusCommand, the function the Alt+Shift+F command and
    // the toolbar menu item call (Playwright cannot press a browser command). The declined path
    // runs with self.focusPermissionOverride = false and chrome.permissions.request stubbed to
    // answer false in the asking page.
    // ---------------------------------------------------------------
    {
      let winAF = null;
      const extraTabs = [];
      const hasVeil = (p) => p.evaluate(() => Boolean(document.getElementById("tabvault-focus-veil")));
      const pageFor = (suffix) => waitFor(async () => context.pages().find((p) => p.url().endsWith(suffix)) || null, { timeout: 15000 });
      const focusState = async () => (await worker()).evaluate(() => chrome.storage.session.get("focus").then((r) => r.focus || { on: false }));
      const badge = async () => (await worker()).evaluate(() => chrome.action.getBadgeText({}));
      const command = async (windowId) => (await worker()).evaluate((id) => self.runFocusCommand(id), windowId);
      try {
        await resetUi();
        const ownWindow = await appPage.evaluate(() => chrome.tabs.getCurrent().then((x) => x.windowId));
        // A test page in TabVault's own window (it must stay sharp) and a second window with one.
        const ownUrl = `${BASE}/three.html?af=own`;
        const ownTab = await (await worker()).evaluate(({ w, u }) => chrome.tabs.create({ windowId: w, url: u, active: false }), { w: ownWindow, u: ownUrl });
        extraTabs.push(ownTab.id);
        const otherUrl = `${BASE}/one.html?af=other`;
        const opened = await openWindowWith([otherUrl]);
        winAF = opened.win;
        const pageOwn = await pageFor("three.html?af=own");
        const pageOther = await pageFor("one.html?af=other");
        await appPage.bringToFront();

        // On: the other window's tab is veiled (blur 8px, dimmed, the pill), the own window's is not.
        const on = await command(ownWindow);
        assert(on && on.ok && on.mode === "veil" && on.veiled >= 1, `focus on answered ${JSON.stringify(on)}`);
        await waitFor(() => hasVeil(pageOther), { timeout: 10000 });
        const look = await pageOther.evaluate(() => {
          const root = document.getElementById("tabvault-focus-veil").shadowRoot;
          const v = root.querySelector("[part=veil]");
          const cs = getComputedStyle(v);
          return { filter: cs.backdropFilter || cs.webkitBackdropFilter, bg: cs.backgroundColor, pill: root.querySelector("button").textContent };
        });
        assert(String(look.filter).includes("blur(8px)"), `veil filter ${look.filter}`);
        assert(look.bg.includes("0.35"), `veil dim ${look.bg}`);
        assert(look.pill === "TabVault focus is on this other window. Click to lift.", `pill "${look.pill}"`);
        assert(!(await hasVeil(pageOwn)), "the focused window's tab got a veil");
        const st = await focusState();
        assert(st.on && st.windowId === ownWindow && st.mode === "veil", `state ${JSON.stringify(st)}`);
        assert((await badge()) === "●", `badge "${await badge()}" while focus is on`);
        await appPage.waitForSelector("#focus-bar:not([hidden])", { timeout: 5000 });
        const barOn = await appPage.$eval("#focus-text", (n) => n.textContent);

        // A tab opened in the other window gets the veil; a tab Chrome will not let us touch is counted.
        const newUrl = `${BASE}/two.html?af=new`;
        await (await worker()).evaluate(({ w, u }) => chrome.tabs.create({ windowId: w, url: u, active: true }), { w: winAF.id, u: newUrl });
        const pageNew = await pageFor("two.html?af=new");
        await waitFor(() => hasVeil(pageNew), { timeout: 10000 });
        const blank = await (await worker()).evaluate((w) => chrome.tabs.create({ windowId: w, url: "about:blank", active: false }), winAF.id);
        await waitFor(async () => ((await focusState()).skipped || []).includes(blank.id), { timeout: 10000 });
        const barSkip = await waitForTextContains(appPage, "#focus-text", "could not be veiled", 5000);
        await (await worker()).evaluate((id) => chrome.tabs.remove(id), blank.id);
        await waitFor(async () => !((await focusState()).skipped || []).includes(blank.id), { timeout: 5000 });

        // The pill lifts everything.
        await pageNew.locator("#tabvault-focus-veil button").click();
        await waitFor(async () => !(await focusState()).on, { timeout: 10000 });
        await waitFor(async () => !(await hasVeil(pageOther)) && !(await hasVeil(pageNew)), { timeout: 10000 });
        await waitFor(async () => (await badge()) !== "●", { timeout: 5000 });
        await appPage.waitForSelector("#focus-bar", { state: "hidden", timeout: 5000 });

        // The command toggles: on, again from the same window lifts; from the other window it moves.
        await command(ownWindow);
        await waitFor(() => hasVeil(pageOther), { timeout: 10000 });
        const moved = await command(winAF.id);
        assert(moved && moved.ok && moved.mode === "veil", `move answered ${JSON.stringify(moved)}`);
        await waitFor(async () => (await hasVeil(pageOwn)) && !(await hasVeil(pageOther)), { timeout: 10000 });
        assert((await focusState()).windowId === winAF.id, "focus did not move to the other window");
        const off = await command(winAF.id);
        assert(off && off.lifted === true, `lift answered ${JSON.stringify(off)}`);
        await waitFor(async () => !(await hasVeil(pageOwn)) && !(await hasVeil(pageOther)), { timeout: 10000 });

        // Declined: the command opens the page's question in the window; Chrome says no; Minimise.
        await (await worker()).evaluate(() => { self.focusPermissionOverride = false; return chrome.storage.local.remove("focusFallback"); });
        const ask = await command(ownWindow);
        assert(ask && ask.ask === true, `without the permission the command answered ${JSON.stringify(ask)}`);
        const askPage = await pageFor(`app/index.html?focus=${ownWindow}`);
        await askPage.waitForSelector("#focus-allow", { timeout: 10000 });
        const askText = await askPage.$eval("#focus-text-ask", (n) => n.textContent);
        assert(askText === "Focus mode draws a veil over your other windows, which needs permission to touch those pages; TabVault still reads nothing from them.", `question "${askText}"`);
        await askPage.evaluate(() => { Object.defineProperty(chrome.permissions, "request", { value: () => Promise.resolve(false), configurable: true, writable: true }); });
        await askPage.click("#focus-allow");
        const declined = await waitForTextContains(askPage, "#focus-note", "did not grant", 5000);
        await askPage.click("#focus-minimize");
        await waitFor(async () => (await focusState()).mode === "minimize", { timeout: 10000 });
        const minState = await (await worker()).evaluate((id) => chrome.windows.get(id).then((w) => w.state), winAF.id);
        assert(minState === "minimized", `other window state ${minState}`);
        const fallback = await (await worker()).evaluate(() => chrome.storage.local.get("focusFallback").then((r) => r.focusFallback));
        assert(fallback === "minimize", `fallback ${fallback}`);
        assert(!(await hasVeil(pageOther)), "the minimise fallback drew a veil");
        const lifted = await command(ownWindow);
        assert(lifted && lifted.lifted === true, `fallback lift answered ${JSON.stringify(lifted)}`);
        const backState = await waitFor(async () => {
          const s = await (await worker()).evaluate((id) => chrome.windows.get(id).then((w) => w.state), winAF.id);
          return s !== "minimized" ? s : null;
        }, { timeout: 10000 });
        await askPage.close().catch(() => {});

        record("AF", "PASS", `focus on from window ${ownWindow}: the other window's tab veiled (${look.filter}, ${look.bg}, pill "${look.pill}"), the own window's tab not; badge dot, bar "${barOn}"; a new tab in the other window veiled; about:blank counted ("${barSkip}"); the pill lifted every veil and the bar; the command toggled on and moved the focus to window ${winAF.id} (own tab veiled, other sharp) and lifted it; declined: the question "${askText.slice(0, 40)}...", "${declined.trim().slice(0, 50)}...", Minimise put window ${winAF.id} ${minState} and remembered it, the lift brought it back ${backState}`);
      } catch (e) {
        record("AF", "FAIL", e.message);
      } finally {
        await (await worker()).evaluate(async () => { self.focusPermissionOverride = undefined; await self.liftFocus(); await chrome.storage.local.remove("focusFallback"); }).catch(() => {});
        if (winAF) await (await worker()).evaluate((id) => chrome.windows.remove(id), winAF.id).catch(() => {});
        for (const id of extraTabs) await (await worker()).evaluate((tid) => chrome.tabs.remove(tid), id).catch(() => {});
        await appPage.bringToFront().catch(() => {});
        await resetUi().catch(() => {});
      }
    }

    // ---------------------------------------------------------------
    // L. Settings persistence (run before K; K's real-time wait is kept
    // last so it does not slow down debugging of the others)
    // ---------------------------------------------------------------
    try {
      await openMenuItem("#btn-settings");
      await appPage.waitForSelector("#dialog h2");
      await appPage.selectOption("#dialog select >> nth=1", "compact"); // density select (theme is select#0)
      const urlsCheckbox = appPage.locator("#dialog label", { hasText: "Show URLs" }).locator("input[type=checkbox]");
      await urlsCheckbox.check();
      await appPage.click('#dialog button:has-text("Save")');

      await waitFor(async () => (await appPage.evaluate(() => document.documentElement.dataset.density)) === "compact");
      const densityAttr = await appPage.evaluate(() => document.documentElement.dataset.density);
      const showUrlsAttr = await appPage.evaluate(() => document.documentElement.dataset.showUrls);
      assert(densityAttr === "compact", `data-density = "${densityAttr}"`);
      assert(showUrlsAttr === "true", `data-show-urls = "${showUrlsAttr}"`);
      const turlVisible = await appPage.$eval(".tab .turl", (el) => getComputedStyle(el).display !== "none");
      assert(turlVisible, "URL line (.turl) is not visible after enabling Show URLs");

      await appPage.reload();
      await appPage.waitForSelector(".window");
      const densityAfterReload = await appPage.evaluate(() => document.documentElement.dataset.density);
      const showUrlsAfterReload = await appPage.evaluate(() => document.documentElement.dataset.showUrls);
      assert(densityAfterReload === "compact", `data-density after reload = "${densityAfterReload}"`);
      assert(showUrlsAfterReload === "true", `data-show-urls after reload = "${showUrlsAfterReload}"`);

      record("L", "PASS", `after Save: data-density="${densityAttr}", data-show-urls="${showUrlsAttr}", .turl visible=${turlVisible}; after reload: data-density="${densityAfterReload}", data-show-urls="${showUrlsAfterReload}"`);
    } catch (e) {
      record("L", "FAIL", e.message);
    }

    // ---------------------------------------------------------------
    // K. Change-driven snapshot (slow, kept last)
    // ---------------------------------------------------------------
    try {
      const before = await (await worker()).evaluate(async () => (await chrome.storage.local.get("snapIndex").then((r) => ({ snapshots: r.snapIndex || [] }))).snapshots || []);
      const countBefore = before.length;

      // winC no longer necessarily exists (Import, and any relaunch after
      // it, both start fresh window state), so pick whatever window is
      // currently open rather than relying on an earlier fixture id.
      const anyWindow = (await (await worker()).evaluate(() => chrome.windows.getAll()))[0];
      await (await worker()).evaluate(({ windowId, url }) => chrome.tabs.create({ windowId, url, active: false }), { windowId: anyWindow.id, url: threeUrl });

      console.log("K: waiting 40s for the change-driven snapshot alarm...");
      await new Promise((r) => setTimeout(r, 40000));

      // Re-acquire the worker explicitly here: this is the one spot in the
      // run where 40 real seconds pass with no chrome.* activity at all, so
      // if the service worker were ever going to idle out and respawn on
      // its own, this is where it would happen. worker() already does this
      // re-acquisition on every call, but the wait is called out here since
      // this is specifically the scenario it matters most for.
      const after = await (await worker()).evaluate(async () => (await chrome.storage.local.get("snapIndex").then((r) => ({ snapshots: r.snapIndex || [] }))).snapshots || []);
      assert(after.length >= countBefore + 1, `snapshot count did not increase: before=${countBefore}, after=${after.length}`);
      const newest = after.slice().sort((a, b) => b.takenAt - a.takenAt)[0];
      assert(newest.reason === "change", `newest snapshot reason = "${newest.reason}"`);

      record("K", "PASS", `snapshot count ${countBefore} -> ${after.length} after opening a tab and waiting 40s; newest snapshot reason="${newest.reason}"`);
    } catch (e) {
      record("K", "FAIL", e.message);
    }

    if (appPage && !appPage.isClosed()) await appPage.close().catch(() => {});
  } finally {
    const results = ORDER.map((id) => byId.get(id));
    const passed = results.filter((r) => r.status === "PASS");
    const failed = results.filter((r) => r.status === "FAIL");
    const limited = results.filter((r) => r.status === "LIMITED");
    const notRun = results.filter((r) => r.status === "NOT RUN");
    const failedForExit = [...failed, ...notRun];

    try {
      fs.mkdirSync(ROOT, { recursive: true });
      fs.writeFileSync(path.join(ROOT, "results.json"), JSON.stringify({ results, consoleErrors }, null, 2));

      const summaryLine =
        `${results.length} scenarios, ${passed.length} passed, ${failed.length} failed, ${limited.length} environment-limited` +
        (notRun.length ? `, ${notRun.length} not run` : "") +
        ".";

      const lines = [];
      lines.push("# TabVault e2e run");
      lines.push("");
      lines.push(`Run at ${new Date().toISOString()}. ${summaryLine}`);
      lines.push("");
      lines.push("| Scenario | Status |");
      lines.push("|---|---|");
      for (const r of results) lines.push(`| ${r.id} | ${r.status} |`);
      lines.push("");
      lines.push("## Evidence");
      for (const r of results) {
        lines.push("");
        lines.push(`### ${r.id}: ${r.status}`);
        lines.push("");
        lines.push("```");
        lines.push(r.evidence);
        lines.push("```");
      }
      lines.push("");
      lines.push("## Console errors");
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(consoleErrors, null, 2));
      lines.push("```");
      fs.writeFileSync(path.join(ROOT, "report.md"), lines.join("\n"));

      console.log("\n\n=== SUMMARY ===");
      for (const r of results) console.log(`${r.id}: ${r.status}`);
      console.log(`\n${summaryLine}`);
      console.log(`\nReport: ${path.join(ROOT, "report.md")}`);
    } catch (reportErr) {
      console.error("Failed to write e2e results/report (continuing to teardown):", reportErr);
    }

    if (context) await context.close().catch(() => {});
    if (server) await new Promise((resolve) => server.close(() => resolve()));

    if (failedForExit.length > 0) {
      console.error(`\n${failedForExit.length} scenario(s) FAILED or did not run: ${failedForExit.map((r) => `${r.id} (${r.status})`).join(", ")}`);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});
