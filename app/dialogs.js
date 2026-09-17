(() => {
  const TV = self.TabVault;
  const App = window.TabVaultApp;
  const { el, toast, closeDialog } = App;
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
    const draw = () => {
      const groups = TV.findDuplicates(App.getSession(), { ignoreHash });
      const keep = new Map(groups.map((g) => [g.url, g.keepId]));
      box.replaceChildren(
        el("h2", {}, "Duplicate tabs"),
        el("div", { class: "row" }, el("label", {}, el("input", { type: "checkbox", checked: ignoreHash ? "" : null, onchange: (e) => { ignoreHash = e.target.checked; draw(); } }), " Ignore #hash when comparing"), el("span", { class: "muted" }, `${groups.length} duplicated URL${groups.length === 1 ? "" : "s"}`)),
      );
      if (!groups.length) { box.append(el("p", { class: "muted" }, "No duplicates."), el("div", { class: "row" }, el("button", { onclick: closeDialog }, "Close"))); return; }
      const list = el("div", { class: "list" });
      for (const g of groups) {
        const table = el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Keep"), el("th", {}, "Title"), el("th", {}, "Window"))));
        for (const { windowId, tab } of g.tabs) {
          table.append(el("tr", {}, el("td", {}, el("input", { type: "radio", name: `keep-${g.url}`, checked: keep.get(g.url) === tab.id ? "" : null, onchange: () => keep.set(g.url, tab.id) })), el("td", { title: tab.url }, tab.title || tab.url), el("td", { class: "muted" }, String(windowId))));
        }
        list.append(el("div", {}, el("div", { class: "muted", style: "word-break:break-all" }, g.url), table));
      }
      const toClose = () => groups.flatMap((g) => g.tabs.map((x) => x.tab.id).filter((id) => id !== keep.get(g.url)));
      box.append(list, el("div", { class: "row" },
        el("button", { class: "primary", onclick: async () => { const ids = toClose(); try { await chrome.tabs.remove(ids); toast(`Closed ${ids.length} duplicate${ids.length === 1 ? "" : "s"}`); closeDialog(); } catch (e) { toast(`Could not close: ${e.message || e}`); } } }, `Close ${toClose().length} duplicates`),
        el("button", { onclick: closeDialog }, "Cancel")));
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
              failedWindows.add(step.ref);
              result.errors.push(`window ${step.ref}: ${(e && e.message) || e}`);
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
            await chrome.tabs.discard(ids.get(step.ref)).catch(() => {});
            break;
          default: break;
        }
      } catch (e) {
        result.errors.push(`${step.op} ${step.ref || ""}: ${(e && e.message) || e}`);
      }
    }
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
      el("span", {}, `${w.incognito ? "🕶 " : ""}${(w.tabs[0] && (w.tabs[0].title || w.tabs[0].url)) || "(empty)"}`),
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
      const { snapshots = [] } = await chrome.storage.local.get("snapshots");
      const list = el("div", { class: "list" });
      if (!snapshots.length) list.append(el("p", { class: "muted" }, "No snapshots yet. They are taken automatically when your tabs change."));
      for (const s of snapshots) {
        list.append(el("div", { class: "row", dataset: { snapshot: s.id } },
          el("span", { style: "min-width:170px" }, fmt(s.takenAt)),
          el("span", { class: "muted", style: "min-width:120px" }, `${s.reason}${s.pinned ? " · kept" : ""}`),
          el("span", { class: "muted" }, `${s.windows} windows · ${s.tabs} tabs`),
          el("button", { onclick: () => showRestore(box, s.session, "Snapshot") }, "Restore"),
          el("button", { onclick: () => { const f = TV.toJsonFile(s.session, { now: s.takenAt, version: VERSION }); download(f.filename, f.text); toast("Exported"); } }, "Export"),
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
    const theme = el("select", {}, ...["system", "light", "dark"].map((t) => el("option", { value: t, selected: t === s.theme ? "" : null }, t)));
    const urls = el("input", { type: "checkbox", checked: s.showUrls ? "" : null });
    const density = el("select", {}, ...["comfortable", "compact"].map((d) => el("option", { value: d, selected: d === s.density ? "" : null }, d)));
    const lazy = el("input", { type: "checkbox", checked: s.lazyRestore !== false ? "" : null });
    const err = el("p", { class: "muted" });
    box.replaceChildren(el("h2", {}, "Settings"),
      el("label", { class: "row" }, "Snapshot after tabs stop changing for ", debounce, " seconds (30–600)"),
      el("label", { class: "row" }, "Keep the last ", keep, " snapshots (5–200); kept snapshots never expire"),
      el("label", { class: "row" }, hash, " Ignore #hash when finding duplicates"),
      el("label", { class: "row" }, "Theme ", theme),
      el("label", { class: "row" }, urls, " Show URLs under titles"),
      el("label", { class: "row" }, "Density ", density),
      el("label", { class: "row" }, lazy, " Load restored tabs only when opened (lazy)"),
      err,
      el("div", { class: "row" }, el("button", { class: "primary", onclick: async () => {
        const d = Number(debounce.value), k = Number(keep.value);
        if (!Number.isInteger(d) || d < 30 || d > 600) { err.textContent = "Debounce must be a whole number between 30 and 600."; return; }
        if (!Number.isInteger(k) || k < 5 || k > 200) { err.textContent = "Keep must be a whole number between 5 and 200."; return; }
        await App.saveSettings({ debounceSeconds: d, keepSnapshots: k, ignoreHash: hash.checked, theme: theme.value, showUrls: urls.checked, density: density.value, lazyRestore: lazy.checked });
        toast("Settings saved"); closeDialog();
      } }, "Save"), el("button", { onclick: closeDialog }, "Cancel")));
  };

  // ---- help ---------------------------------------------------------------------------
  App.dialogs.help = (box) => {
    const rows = [["/", "Search"], ["↑ ↓", "Move between tabs"], ["← →", "Move between windows"], ["Enter", "Go to tab"], ["Space", "Select / unselect"], ["Delete", "Close selected tabs"], ["Ctrl+click", "Toggle selection"], ["Shift+click", "Select a range"], ["Esc", "Clear search and selection"], ["?", "This help"], ["Alt+Shift+T", "Open TabVault (browser shortcut)"]];
    box.replaceChildren(el("h2", {}, "Keyboard shortcuts"), el("table", {}, ...rows.map(([k, d]) => el("tr", {}, el("td", {}, el("kbd", {}, k)), el("td", {}, d)))), el("div", { class: "row" }, el("button", { onclick: closeDialog }, "Close")));
  };

  App.restoreSession = restoreSession;
})();
