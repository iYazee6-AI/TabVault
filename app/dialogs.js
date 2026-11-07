(() => {
  const TV = self.TabVault;
  const App = window.TabVaultApp;
  const { el, toast, closeDialog, windowLabel } = App;
  const VERSION = chrome.runtime.getManifest().version;

  function download(filename, text) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function fmt(ts) { return new Date(ts).toLocaleString(); }

  // ---- duplicates --------------------------------------------------------------------
  App.dialogs.duplicates = (box) => {
    const settings = App.getSettings();
    let ignoreHash = settings.ignoreHash;
    // The Window column uses the cards' label: the window's name, else its active
    // tab's title; "Window N" (grid position) only if that is blank.
    const windowCell = (windowId) => {
      const wins = App.getSession().windows;
      const win = wins.find((w) => w.id === windowId);
      const label = win ? windowLabel(win) : "";
      return label || (win ? "Window " + (wins.indexOf(win) + 1) : "Window");
    };
    const draw = () => {
      const groups = TV.findDuplicates(App.getSession(), { ignoreHash });
      box.replaceChildren(
        el("h2", {}, "Duplicate tabs"),
        el("div", { class: "row" }, el("label", {}, el("input", { type: "checkbox", checked: ignoreHash ? "" : null, onchange: (e) => { ignoreHash = e.target.checked; draw(); } }), " Ignore #hash when comparing"), el("span", { class: "muted" }, `${groups.length} duplicated URL${groups.length === 1 ? "" : "s"}`)),
      );
      if (!groups.length) { box.append(el("p", { class: "muted" }, "No duplicates."), el("div", { class: "row" }, el("button", { onclick: closeDialog }, "Close"))); return; }
      // Per group: a Keep radio on every row (the dedupe rule's pick by default). The kept row shows
      // the "kept" marker; every other row has a close checkbox, all checked on each draw.
      const keep = new Map(groups.map((g) => [g.url, g.keepId]));
      const checked = new Map();
      for (const g of groups) for (const { tab } of g.tabs) if (tab.id !== g.keepId) checked.set(tab.id, true);
      const go = el("button", { class: "primary", type: "button" });
      const chosen = () => groups.flatMap((g) => g.tabs.map((x) => x.tab.id).filter((id) => id !== keep.get(g.url) && checked.get(id)));
      const update = () => { const n = chosen().length; go.textContent = `Close ${n} selected`; go.disabled = n === 0; };
      const bodies = new Map();
      const drawRows = (g) => {
        const kept = keep.get(g.url);
        bodies.get(g.url).replaceChildren(...g.tabs.map(({ windowId, tab }) => {
          const name = tab.title || tab.url;
          const radio = el("input", { type: "radio", name: `keep-${g.url}`, checked: tab.id === kept ? "" : null, "aria-label": `Keep ${name}`, onchange: () => {
            const prev = keep.get(g.url);
            keep.set(g.url, tab.id);
            checked.set(prev, true);
            drawRows(g);
            update();
            const again = bodies.get(g.url).querySelector(`tr[data-tab="${tab.id}"] input[type=radio]`);
            if (again) again.focus();
          } });
          const mark = tab.id === kept
            ? el("span", { class: "kept" }, "kept")
            : el("input", { type: "checkbox", checked: checked.get(tab.id) ? "" : null, dataset: { tab: String(tab.id) }, "aria-label": `Close ${name}`, onchange: (e) => { checked.set(tab.id, e.target.checked); update(); } });
          return el("tr", { dataset: { tab: String(tab.id) } }, el("td", {}, radio), el("td", {}, mark), el("td", { title: tab.url }, name), el("td", { class: "muted wcell", title: windowCell(windowId) }, windowCell(windowId).slice(0, 40)));
        }));
      };
      const setAll = (on) => {
        for (const g of groups) { for (const { tab } of g.tabs) if (tab.id !== keep.get(g.url)) checked.set(tab.id, on); drawRows(g); }
        update();
      };
      const list = el("div", { class: "list" });
      for (const g of groups) {
        const body = el("tbody");
        bodies.set(g.url, body);
        drawRows(g);
        const table = el("table", { class: "dupes" }, el("thead", {}, el("tr", {}, el("th", {}, "Keep"), el("th", {}, "Close"), el("th", {}, "Title"), el("th", {}, "Window"))), body);
        list.append(el("div", {}, el("div", { class: "muted", style: "word-break:break-all" }, g.url), table));
      }
      go.addEventListener("click", async () => {
        const ids = chosen();
        if (!ids.length) return;
        try { await chrome.tabs.remove(ids); toast(`Closed ${ids.length} duplicate${ids.length === 1 ? "" : "s"}`); closeDialog(); }
        catch (e) { toast(`Could not close: ${e.message || e}`); }
      });
      update();
      box.append(
        el("div", { class: "row" }, el("button", { type: "button", class: "small", onclick: () => setAll(true) }, "Select all"), el("button", { type: "button", class: "small", onclick: () => setAll(false) }, "Select none")),
        list,
        el("div", { class: "row" }, go, el("button", { onclick: closeDialog }, "Cancel")));
    };
    draw();
  };

  // ---- export -----------------------------------------------------------------------
  App.dialogs.export = (box) => {
    const session = App.getSession();
    const f = TV.toJsonFile(session, { now: Date.now(), version: VERSION });
    box.replaceChildren(
      el("h2", {}, "Export session"),
      el("p", {}, `${session.windows.length} windows, ${TV.countTabs(session)} tabs, with groups, pinned state and positions.`),
      el("p", { class: "muted" }, `File: ${f.filename}`),
      el("div", { class: "row" }, el("button", { class: "primary", onclick: () => { download(f.filename, f.text); toast("Exported"); closeDialog(); } }, "Download JSON"), el("button", { onclick: closeDialog }, "Cancel")));
  };

  // ---- import / restore -------------------------------------------------------------
  async function restoreSession(session, selectedWindowIds, onProgress) {
    const allowIncognito = await chrome.extension.isAllowedIncognitoAccess();
    const screen = { width: window.screen.availWidth, height: window.screen.availHeight };
    const discard = App.getSettings().lazyRestore !== false;
    const { steps, skipped } = TV.planRestore(session, { selectedWindowIds, allowIncognito, screen, discard });
    const ids = new Map();
    const failedWindows = new Set();
    const result = { windows: 0, tabs: 0, errors: [], skipped, discard };
    let discardFailures = 0;
    const names = {};
    for (const step of steps) {
      try {
        switch (step.op) {
          case "createWindow": {
            const opts = { url: step.url, incognito: step.incognito, focused: false };
            if (step.bounds) Object.assign(opts, step.bounds);
            else if (step.state === "maximized" || step.state === "fullscreen") opts.state = step.state;
            let w;
            try {
              w = await chrome.windows.create(opts);
            } catch (e) {
              const message = (e && e.message) || e;
              const retryOpts = { ...opts };
              delete retryOpts.url;
              try {
                w = await chrome.windows.create(retryOpts);
              } catch (e2) {
                failedWindows.add(step.ref);
                result.errors.push(`window ${step.ref}: ${(e2 && e2.message) || e2}`);
                break;
              }
              ids.set(step.ref, w.id);
              result.errors.push(`tab ${step.firstTabRef}: ${message}`);
              result.windows++;
              onProgress(`Window ${result.windows}…`);
              break;
            }
            ids.set(step.ref, w.id);
            ids.set(step.firstTabRef, w.tabs[0].id);
            result.windows++; result.tabs++;
            onProgress(`Window ${result.windows}…`);
            break;
          }
          case "createTab": {
            if (failedWindows.has(step.windowRef) || ids.get(step.windowRef) === undefined) break;
            const t = await chrome.tabs.create({ windowId: ids.get(step.windowRef), url: step.url, active: false, index: step.index });
            ids.set(step.ref, t.id);
            result.tabs++;
            break;
          }
          case "updateTab": {
            if (ids.get(step.ref) === undefined) break;
            const patch = {};
            if (step.pinned) patch.pinned = true;
            if (step.muted) patch.muted = true;
            await chrome.tabs.update(ids.get(step.ref), patch);
            break;
          }
          case "groupTabs": {
            if (failedWindows.has(step.windowRef) || ids.get(step.windowRef) === undefined) break;
            const gid = await chrome.tabs.group({ tabIds: step.tabRefs.map((r) => ids.get(r)).filter((x) => x !== undefined), createProperties: { windowId: ids.get(step.windowRef) } });
            ids.set(step.groupRef, gid);
            break;
          }
          case "updateGroup":
            if (ids.get(step.groupRef) === undefined) break;
            await chrome.tabGroups.update(ids.get(step.groupRef), { title: step.title, color: step.color, collapsed: step.collapsed });
            break;
          case "discardTab":
            if (ids.get(step.ref) === undefined) break;
            await chrome.tabs.discard(ids.get(step.ref)).catch(() => { discardFailures++; });
            break;
          case "nameWindow":
            if (failedWindows.has(step.windowRef) || ids.get(step.windowRef) === undefined) break;
            names[ids.get(step.windowRef)] = step.name;
            break;
          default: break;
        }
      } catch (e) {
        result.errors.push(`${step.op} ${step.ref || ""}: ${(e && e.message) || e}`);
      }
    }
    if (Object.keys(names).length) {
      try {
        const { [TV.WINDOW_NAMES_KEY]: windowNames = {} } = await chrome.storage.local.get(TV.WINDOW_NAMES_KEY);
        await chrome.storage.local.set({ [TV.WINDOW_NAMES_KEY]: { ...windowNames, ...names } });
      } catch (e) {
        result.errors.push(`window names: ${(e && e.message) || e}`);
      }
    }
    if (discardFailures) result.errors.push(`${discardFailures} tab(s) could not be unloaded`);
    return result;
  }

  App.dialogs.import = (box, text) => {
    let session;
    try { session = TV.parseImport(text); }
    catch (e) { box.replaceChildren(el("h2", {}, "Import failed"), el("p", {}, e.message), el("div", { class: "row" }, el("button", { onclick: closeDialog }, "Close"))); return; }
    showRestore(box, session, "Import");
  };

  function showRestore(box, session, title) {
    const chosen = new Set(session.windows.map((w) => w.id));
    const rows = session.windows.map((w) => el("label", { class: "row" },
      el("input", { type: "checkbox", checked: "", onchange: (e) => { e.target.checked ? chosen.add(w.id) : chosen.delete(w.id); } }),
      el("span", {}, `${w.incognito ? "🕶 " : ""}${w.windowName || (w.tabs[0] && (w.tabs[0].title || w.tabs[0].url)) || "(empty)"}`),
      el("span", { class: "muted" }, `${w.tabs.length} tabs, ${(w.groups || []).length} groups`)));
    const status = el("p", { class: "muted" }, session.capturedAt ? `Captured ${fmt(session.capturedAt)}` : "");
    const go = el("button", { class: "primary" }, "Restore selected windows");
    go.addEventListener("click", async () => {
      go.disabled = true;
      let r;
      try {
        r = await restoreSession(session, [...chosen], (p) => { status.textContent = p; });
      } catch (e) {
        status.textContent = `Restore failed: ${e.message || e}`;
        go.disabled = false;
        return;
      }
      const lines = [`Restored ${r.windows} windows and ${r.tabs} tabs${r.discard ? " (tabs load when you open them)" : ""}.`];
      for (const s of r.skipped) lines.push(`Skipped window ${s.windowId}: ${s.reason}`);
      for (const e of r.errors) lines.push(`Error: ${e}`);
      box.replaceChildren(el("h2", {}, `${title} complete`), ...lines.map((l) => el("p", {}, l)), el("div", { class: "row" }, el("button", { onclick: closeDialog }, "Close")));
    });
    box.replaceChildren(el("h2", {}, `${title}: choose windows to restore`), status, el("div", { class: "list" }, ...rows), el("div", { class: "row" }, go, el("button", { onclick: closeDialog }, "Cancel")));
  }

  // ---- snapshots ------------------------------------------------------------------
  App.dialogs.snapshots = async (box) => {
    const draw = async () => {
      // Version 2 storage: the index holds the metadata; a snapshot's session is read only when
      // it is restored or exported.
      const snapshots = await TV.listSnapshots(chrome.storage.local);
      const full = async (s) => {
        const snap = await TV.getSnapshot(chrome.storage.local, s.id);
        if (!snap) { toast("That snapshot is gone"); draw(); }
        return snap;
      };
      const list = el("div", { class: "list" });
      if (!snapshots.length) list.append(el("p", { class: "muted" }, "No snapshots yet. They are taken automatically when your tabs change."));
      for (const s of snapshots) {
        list.append(el("div", { class: "row snap", dataset: { snapshot: s.id } },
          el("span", { title: s.name ? `${s.name} · ${fmt(s.takenAt)}` : fmt(s.takenAt) }, s.name || fmt(s.takenAt)),
          el("span", { class: "muted" }, `${s.reason}${s.pinned ? " · kept" : ""}`),
          el("span", { class: "muted" }, `${s.windows} window${s.windows === 1 ? "" : "s"} · ${s.tabs} tab${s.tabs === 1 ? "" : "s"}`),
          el("button", { onclick: async () => { const snap = await full(s); if (snap) showRestore(box, snap.session, "Snapshot"); } }, "Restore"),
          el("button", { onclick: async () => { const snap = await full(s); if (!snap) return; const f = TV.toJsonFile(snap.session, { now: s.takenAt, version: VERSION }); download(f.filename, f.text); toast("Exported"); } }, "Export"),
          el("button", { onclick: async () => { await chrome.runtime.sendMessage({ type: "pinSnapshot", id: s.id, pinned: !s.pinned }); draw(); } }, s.pinned ? "Unkeep" : "Keep"),
          el("button", { class: "danger", onclick: async () => { await chrome.runtime.sendMessage({ type: "deleteSnapshot", id: s.id }); draw(); } }, "Delete")));
      }
      box.replaceChildren(el("h2", {}, "Snapshots"),
        el("div", { class: "row" }, el("button", { class: "primary", onclick: async () => {
          const r = await chrome.runtime.sendMessage({ type: "snapshotNow" });
          if (r && r.skipped) toast("Nothing to snapshot (no other windows open)");
          else toast(r && r.ok ? "Snapshot saved" : `Snapshot failed: ${r && r.error}`);
          draw();
        } }, "Snapshot now"), el("span", { class: "muted" }, `${snapshots.length} stored`)),
        list, el("div", { class: "row" }, el("button", { onclick: closeDialog }, "Close")));
    };
    await draw();
  };

  // ---- settings ---------------------------------------------------------------------
  App.dialogs.settings = (box) => {
    const s = App.getSettings();
    const debounce = el("input", { type: "number", min: "30", max: "600", value: String(s.debounceSeconds) });
    const keep = el("input", { type: "number", min: "5", max: "200", value: String(s.keepSnapshots) });
    const hash = el("input", { type: "checkbox", checked: s.ignoreHash ? "" : null });
    const theme = el("select", { "aria-label": "Appearance" }, ...[["system", "System"], ["light", "Light"], ["dark", "Dark"]].map(([value, label]) => el("option", { value, selected: value === s.theme ? "" : null }, label)));
    const urls = el("input", { type: "checkbox", checked: s.showUrls ? "" : null });
    const density = el("select", {}, ...["comfortable", "compact"].map((d) => el("option", { value: d, selected: d === s.density ? "" : null }, d)));
    const lazy = el("input", { type: "checkbox", checked: s.lazyRestore !== false ? "" : null });
    const badge = el("select", { "aria-label": "Icon badge" }, ...[["total", "Tab count"], ["unloaded", "Unloaded tabs"], ["off", "Off"]].map(([value, label]) => el("option", { value, selected: value === s.badge ? "" : null }, label)));
    // Unload idle tabs (auto-discard): off by default; the worker reads these at every alarm.
    const ad = s.autoDiscard;
    const idleLabel = (m) => (m < 60 ? `${m} minutes` : m === 60 ? "1 hour" : `${m / 60} hours`);
    const adOn = el("input", { type: "checkbox", id: "ad-enabled", checked: ad.enabled ? "" : null });
    const adMinutes = el("select", { id: "ad-minutes", "aria-label": "Idle threshold" }, ...TV.IDLE_MINUTES.map((m) => el("option", { value: String(m), selected: m === ad.minutes ? "" : null }, idleLabel(m))));
    const adPinned = el("input", { type: "checkbox", id: "ad-pinned", checked: ad.keepPinned ? "" : null });
    const adAllow = el("textarea", { id: "ad-allow", rows: "3", "aria-label": "Never unload tabs on these sites", placeholder: "*.example.com" });
    adAllow.value = ad.allowlist.join(String.fromCharCode(10));
    const lastRun = el("span", { id: "ad-last-run", class: "muted" }, "");
    const showLastRun = () => chrome.storage.session.get("autoDiscard.lastRun").then((r) => { lastRun.textContent = TV.lastRunText(r["autoDiscard.lastRun"]); }, () => { lastRun.textContent = ""; });
    showLastRun();
    const runNow = el("button", { type: "button", class: "small", onclick: async () => {
      runNow.disabled = true;
      const r = await chrome.runtime.sendMessage({ type: "discardIdleNow" }).catch((e) => ({ ok: false, error: e.message }));
      runNow.disabled = false;
      if (!r || !r.ok) toast(`Could not unload: ${r && r.error}`);
      showLastRun();
    } }, "Unload idle tabs now");
    const recordClosed = el("input", { type: "checkbox", id: "record-closed", checked: s.recordClosed ? "" : null });
    const err = el("p", { class: "muted" });
    box.replaceChildren(el("h2", {}, "Settings"),
      el("label", { class: "row" }, "Snapshot after tabs stop changing for ", debounce, " seconds (30–600)"),
      el("label", { class: "row" }, "Keep the last ", keep, " snapshots (5–200); kept snapshots never expire"),
      el("label", { class: "row" }, hash, " Ignore #hash when finding duplicates"),
      el("label", { class: "row" }, "Appearance ", theme),
      el("label", { class: "row" }, urls, " Show URLs under titles"),
      el("label", { class: "row" }, "Density ", density),
      el("label", { class: "row" }, lazy, " Load restored tabs only when opened (lazy)"),
      el("label", { class: "row" }, "Icon badge ", badge),
      el("label", { class: "row" }, recordClosed, " Remember recently closed tabs (kept on this computer, last 200)"),
      el("h3", {}, "Unload idle tabs"),
      el("label", { class: "row" }, adOn, " Unload tabs not used for ", adMinutes),
      el("label", { class: "row" }, adPinned, " Never unload pinned tabs"),
      el("label", { class: "col" }, "Never unload tabs on these sites (one per line; *.example.com covers its subdomains)", adAllow),
      el("p", { class: "muted" }, `Never unloaded: the tab you are on in each window, tabs playing sound, tabs Chrome protects (for example a form you are filling), and tabs in a group whose name starts with ${TV.PROTECT_EMOJI}. Unloaded tabs stay where they are and reload when you open them; nothing is closed.`),
      el("div", { class: "row" }, lastRun, runNow),
      err,
      el("div", { class: "row" }, el("button", { class: "primary", onclick: async () => {
        const d = Number(debounce.value), k = Number(keep.value);
        if (!Number.isInteger(d) || d < 30 || d > 600) { err.textContent = "Debounce must be a whole number between 30 and 600."; return; }
        if (!Number.isInteger(k) || k < 5 || k > 200) { err.textContent = "Keep must be a whole number between 5 and 200."; return; }
        await App.saveSettings({ debounceSeconds: d, keepSnapshots: k, ignoreHash: hash.checked, theme: theme.value, showUrls: urls.checked, density: density.value, lazyRestore: lazy.checked, badge: badge.value, recordClosed: recordClosed.checked,
          autoDiscard: { enabled: adOn.checked, minutes: Number(adMinutes.value), keepPinned: adPinned.checked, allowlist: TV.parseAllowlist(adAllow.value) } });
        toast("Settings saved"); closeDialog();
      } }, "Save"), el("button", { onclick: closeDialog }, "Cancel")));
  };

  // ---- help ---------------------------------------------------------------------------
  App.dialogs.help = (box) => {
    const rows = TV.SHORTCUTS.map((s) => el("tr", {},
      el("td", {}, ...s.display.map((k) => el("kbd", {}, k))),
      el("td", {}, s.label)));
    box.replaceChildren(
      el("h2", {}, "Keyboard shortcuts"),
      el("table", { class: "shortcuts" }, el("tbody", {}, ...rows)),
      el("div", { class: "row" }, el("button", { type: "button", onclick: closeDialog }, "Close")));
  };

  // ---- about --------------------------------------------------------------------------
  // Static text and links only; nothing is fetched.
  const REPO_URL = "https://github.com/iYazee6-AI/TabVault";
  App.dialogs.about = (box) => {
    const link = (href, text) => el("a", { href, target: "_blank", rel: "noopener" }, text);
    box.replaceChildren(
      el("h2", {}, "TabVault ", el("span", { class: "version" }, VERSION)),
      el("p", {}, "Every window, group and tab on one page. Local only."),
      el("ul", { class: "links" },
        el("li", {}, "Source: ", link(REPO_URL, REPO_URL.replace("https://", ""))),
        el("li", {}, link(REPO_URL + "/issues", "Report an issue")),
        el("li", {}, link(REPO_URL + "/blob/main/PRIVACY.md", "Privacy policy"))),
      el("p", { class: "muted" }, "MIT licence. Type: IBM Plex Sans and Plex Mono (SIL Open Font License)."),
      el("div", { class: "row" }, el("button", { type: "button", onclick: closeDialog }, "Close")));
  };

  // ---- save and close -----------------------------------------------------------------
  // The confirmation is never skipped (no "do not ask again"); focus starts on Cancel.
  App.dialogs.saveClose = (box, { windowIds, count, name }) => {
    const plural = count === 1 ? "" : "s";
    const go = el("button", { type: "button", class: "primary", id: "save-close-go" }, `Save and close ${count} tab${plural}`);
    const cancel = el("button", { type: "button", id: "save-close-cancel", onclick: closeDialog }, "Cancel");
    go.addEventListener("click", async () => {
      go.disabled = true;
      const r = await chrome.runtime.sendMessage({ type: "saveAndClose", windowIds, name }).catch((e) => ({ ok: false, error: e.message || String(e) }));
      closeDialog();
      if (r && r.ok && !r.skipped) toast(`Saved ${r.closed} tab${r.closed === 1 ? "" : "s"} to Snapshots and closed them`);
      else if (r && r.skipped) toast("Nothing to save");
      else toast(`Could not save and close: ${r && r.error}`);
    });
    box.replaceChildren(
      el("h2", {}, "Save and close"),
      el("p", { id: "save-close-text" }, `Save ${count} tab${plural} and close them? The snapshot is kept and can be restored from Snapshots.`),
      el("p", { class: "muted" }, `Snapshot name: ${name}`),
      el("div", { class: "row" }, go, cancel));
    cancel.focus();
  };

  App.restoreSession = restoreSession;
})();
