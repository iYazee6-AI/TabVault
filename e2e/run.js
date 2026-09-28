const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const REPO = path.join(__dirname, "..");
const ROOT = path.join(__dirname, ".tmp");
const EXT_DIR = path.join(ROOT, "ext");
const USER_DATA_DIR = path.join(ROOT, "userdata");
const DOWNLOAD_DIR = path.join(ROOT, "downloads");
const BASE = "http://localhost:8765/test-pages";

const ORDER = ["A", "B", "C", "D", "E", "F", "G", "H", "I-a", "I-b", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T"];
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

// Builds a fresh copy of the extension under e2e/.tmp/ext. No manifest changes
// are needed: TabVault declares no host permissions, so nothing needs patching
// for the harness (unlike FormKeeper, which needed a localhost host_permission).
function buildExtensionCopy() {
  fs.rmSync(EXT_DIR, { recursive: true, force: true });
  fs.mkdirSync(EXT_DIR, { recursive: true });
  const entries = ["manifest.json", "background.js", "app", "lib", "icons"];
  for (const entry of entries) {
    fs.cpSync(path.join(REPO, entry), path.join(EXT_DIR, entry), { recursive: true });
  }
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
    let tabsB = await (await worker()).evaluate((id) => chrome.tabs.query({ windowId: id }), winB.id);
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
      await appPage.locator(`.tab[data-tab="${twoInB.id}"]`).dragTo(appPage.locator(`.window[data-window="${winC.id}"] .whead`));
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

    // ---------------------------------------------------------------
    // J. Snapshot now / delete / keep-unkeep
    // ---------------------------------------------------------------
    try {
      await appPage.click("#btn-snapshots");
      await appPage.waitForSelector("#dialog h2");

      await appPage.click('#dialog button:has-text("Snapshot now")');
      const snap1 = await waitFor(async () => {
        const { snapshots = [] } = await (await worker()).evaluate(() => chrome.storage.local.get("snapshots"));
        return snapshots.find((s) => s.reason === "manual" && s.pinned) || null;
      });
      await waitForTextContains(appPage, `[data-snapshot="${snap1.id}"]`, "manual");
      const row1Text = await appPage.$eval(`[data-snapshot="${snap1.id}"]`, (el) => el.textContent);
      assert(row1Text.includes("manual") && row1Text.includes("kept"), `first snapshot row text = "${row1Text}"`);

      fs.mkdirSync(ROOT, { recursive: true });
      await appPage.screenshot({ path: path.join(ROOT, "snapshots-dialog.png") });

      await appPage.click(`[data-snapshot="${snap1.id}"] button:has-text("Delete")`);
      await waitFor(async () => (await appPage.$(`[data-snapshot="${snap1.id}"]`)) === null);
      const gone = await (await worker()).evaluate((id) => chrome.storage.local.get("snapshots").then((r) => !(r.snapshots || []).some((s) => s.id === id)), snap1.id);
      assert(gone, "deleted snapshot still present in storage");

      await appPage.click('#dialog button:has-text("Snapshot now")');
      const snap2 = await waitFor(async () => {
        const { snapshots = [] } = await (await worker()).evaluate(() => chrome.storage.local.get("snapshots"));
        return snapshots.find((s) => s.reason === "manual" && s.pinned) || null;
      });
      await waitForTextContains(appPage, `[data-snapshot="${snap2.id}"]`, "manual");

      await appPage.click(`[data-snapshot="${snap2.id}"] button:has-text("Unkeep")`);
      await waitFor(async () => {
        const { snapshots = [] } = await (await worker()).evaluate(() => chrome.storage.local.get("snapshots"));
        const s = snapshots.find((x) => x.id === snap2.id);
        return s && s.pinned === false;
      });
      await waitForTextContains(appPage, `[data-snapshot="${snap2.id}"]`, "Keep");

      await appPage.click(`[data-snapshot="${snap2.id}"] button:has-text("Keep")`);
      await waitFor(async () => {
        const { snapshots = [] } = await (await worker()).evaluate(() => chrome.storage.local.get("snapshots"));
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
      const repo = links.find((l) => l.text === "GitHub repository");
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
      const toClose = [extrasA[1], extraB];
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
      const expectedOpen = [keptA, spared, keptB].sort((a, b) => a - b);
      assert(JSON.stringify([...open].sort((a, b) => a - b)) === JSON.stringify(expectedOpen), `tabs still open ${JSON.stringify(open)}, expected ${JSON.stringify(expectedOpen)}`);
      const toastText = await appPage.$eval("#toast", (n) => n.textContent);
      assert(toastText === `Closed ${toClose.length} duplicates`, `toast = "${toastText}"`);
      const foreignNote = foreign ? ` (and ${foreign} foreign row(s))` : "";
      record("T", "PASS", `two groups (${urlA} x3, ${urlB} x2): kept rows carry the kept marker and no checkbox; default "Close ${total} selected", Select none -> "Close 0 selected" disabled, Select all -> back; unchecked ${spared}${foreignNote} -> "${chosen.text}"; closed exactly ${JSON.stringify(toClose)}; still open ${JSON.stringify(expectedOpen)} incl. the unchecked ${spared}; toast "${toastText}"`);
      await (await worker()).evaluate((ids) => chrome.tabs.remove(ids).catch(() => {}), open);
    } catch (e) {
      record("T", "FAIL", e.message);
    }
    await resetUi();

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
      const before = await (await worker()).evaluate(async () => (await chrome.storage.local.get("snapshots")).snapshots || []);
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
      const after = await (await worker()).evaluate(async () => (await chrome.storage.local.get("snapshots")).snapshots || []);
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
