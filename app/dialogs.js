(() => {
  const TV = self.TabVault;
  const App = window.TabVaultApp;
  const { el, toast, closeDialog, windowLabel } = App;
  const VERSION = chrome.runtime.getManifest().version;

  function download(filename, text, type = "application/json") {
    const blob = new Blob([text], { type });
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
  // What: this session, the selected tabs, a snapshot or a shelf. Format: JSON (schema 1, every
  // detail, restorable) or Markdown (a list of links for notes). The text is prepared before the
  // buttons are enabled, so Copy calls navigator.clipboard.writeText inside the click itself (no
  // clipboardWrite permission); if the browser refuses, the text is shown selected for Ctrl+C.
  function selectedSession() {
    const ids = new Set(App.selection());
    const s = App.getSession();
    const windows = [];
    for (const w of s.windows) {
      const tabs = w.tabs.filter((t) => ids.has(t.id));
      if (!tabs.length) continue;
      const used = new Set(tabs.map((t) => t.groupId).filter((g) => g !== null));
      windows.push({ ...w, tabs, groups: (w.groups || []).filter((g) => used.has(g.id)) });
    }
    return { ...s, windows };
  }

  App.dialogs.export = async (box, opts = {}) => {
    const session = App.getSession();
    const selectedCount = App.selection().length;
    const snapshots = await TV.listSnapshots(chrome.storage.local).catch(() => []);
    const shelves = await TV.listShelves(chrome.storage.local).catch(() => []);
    let what = opts.what || "session";
    let format = opts.format || "json";
    let snapshotId = opts.snapshotId || (snapshots[0] && snapshots[0].id) || "";
    let shelfId = opts.shelfId || (shelves[0] && shelves[0].id) || "";
    let ready = null;
    let token = 0;

    const radio = (name, value, current, label, disabled, onpick) => el("label", { class: "opt" },
      el("input", { type: "radio", name, value, id: `${name}-${value}`, checked: value === current ? "" : null, disabled: disabled ? "" : null, onchange: () => onpick(value) }), ` ${label}`);
    const snapSelect = el("select", { id: "export-snapshot", "aria-label": "Snapshot to export", onchange: (e) => { snapshotId = e.target.value; what = "snapshot"; draw(); } },
      ...snapshots.map((s) => el("option", { value: s.id, selected: s.id === snapshotId ? "" : null }, `${s.name || fmt(s.takenAt)} · ${s.tabs} tabs`)));
    const shelfSelect = el("select", { id: "export-shelf", "aria-label": "Shelf to export", onchange: (e) => { shelfId = e.target.value; what = "shelf"; draw(); } },
      ...shelves.map((s) => el("option", { value: s.id, selected: s.id === shelfId ? "" : null }, s.name)));
    const info = el("p", { class: "muted", id: "export-info" });
    const dl = el("button", { type: "button", class: "primary", id: "export-download" });
    const copy = el("button", { type: "button", id: "export-copy" }, "Copy to clipboard");
    const fallback = el("div", { class: "col", hidden: "" });

    // The chosen source as { session, title, now }.
    async function source() {
      if (what === "selected") return { session: selectedSession(), title: "Selected tabs", now: Date.now() };
      if (what === "snapshot") {
        const snap = snapshotId ? await TV.getSnapshot(chrome.storage.local, snapshotId) : null;
        if (!snap) throw new Error("That snapshot is gone");
        return { session: snap.session, title: snap.name || `Snapshot ${fmt(snap.takenAt)}`, now: snap.takenAt };
      }
      if (what === "shelf") {
        const shelf = shelves.find((s) => s.id === shelfId);
        if (!shelf) throw new Error("That shelf is gone");
        const items = await TV.readShelf(chrome.storage.local, shelf.id);
        return { session: TV.shelfToSession(shelf, items), title: shelf.name, now: Date.now() };
      }
      return { session, title: "TabVault session", now: Date.now() };
    }

    async function prepare() {
      const mine = ++token;
      ready = null;
      dl.disabled = true; copy.disabled = true;
      try {
        const src = await source();
        if (mine !== token) return;
        const tabs = TV.countTabs(src.session);
        if (!tabs) { info.textContent = "Nothing to export."; return; }
        ready = format === "markdown"
          ? { filename: TV.markdownFilename(src.now), text: TV.toMarkdown(src.session, { title: src.title }), type: "text/markdown" }
          : { ...TV.toJsonFile(src.session, { now: src.now, version: VERSION }), type: "application/json" };
        info.textContent = `${src.session.windows.length} window${src.session.windows.length === 1 ? "" : "s"}, ${tabs} tab${tabs === 1 ? "" : "s"} · file ${ready.filename}`;
        dl.disabled = false; copy.disabled = false;
      } catch (e) {
        if (mine === token) info.textContent = e.message || String(e);
      }
    }

    function draw() {
      fallback.hidden = true;
      dl.textContent = format === "markdown" ? "Download Markdown" : "Download JSON";
      const pick = (v) => { what = v; draw(); };
      box.replaceChildren(
        el("h2", {}, "Export"),
        el("div", { class: "row", role: "radiogroup", "aria-label": "What to export" }, el("span", { class: "muted" }, "What"),
          radio("export-what", "session", what, "This session", false, pick),
          radio("export-what", "selected", what, `Selected tabs (${selectedCount})`, !selectedCount, pick),
          radio("export-what", "snapshot", what, "Snapshot", !snapshots.length, pick), snapshots.length ? snapSelect : null,
          radio("export-what", "shelf", what, "Shelf", !shelves.length, pick), shelves.length ? shelfSelect : null),
        el("div", { class: "row", role: "radiogroup", "aria-label": "Format" }, el("span", { class: "muted" }, "Format"),
          radio("export-format", "json", format, "JSON (restorable, every detail)", false, (v) => { format = v; draw(); }),
          radio("export-format", "markdown", format, "Markdown (for notes)", false, (v) => { format = v; draw(); })),
        info,
        el("div", { class: "row" }, dl, copy, el("button", { type: "button", onclick: closeDialog }, "Cancel")),
        fallback);
      prepare();
    }

    dl.addEventListener("click", () => {
      if (!ready) return;
      download(ready.filename, ready.text, ready.type);
      toast("Exported");
      closeDialog();
    });
    copy.addEventListener("click", () => {
      if (!ready) return;
      const text = ready.text;
      const showFallback = () => {
        const area = el("textarea", { id: "export-copy-text", rows: "8", readonly: "", "aria-label": "Export text" });
        area.value = text;
        fallback.replaceChildren(el("p", { class: "muted" }, "Copying was blocked by the browser: the text is selected below, press Ctrl+C (Cmd+C on a Mac)."), area);
        fallback.hidden = false;
        area.focus(); area.select();
      };
      try {
        navigator.clipboard.writeText(text).then(() => toast("Copied to the clipboard"), showFallback);
      } catch {
        showFallback();
      }
    });
    draw();
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

  // Import: a chosen file (JSON, Markdown or text) goes straight to the window chooser; the menu's
  // Import opens a paste box whose preview (the same chooser) updates as you type. Links that are
  // not web pages are dropped and counted (lib/exporters.js); nothing opens before Restore.
  function summaryText(session) {
    const tabs = TV.countTabs(session);
    const groups = session.windows.reduce((n, w) => n + (w.groups || []).length, 0);
    const parts = [`Found ${session.windows.length} window${session.windows.length === 1 ? "" : "s"}, ${tabs} tab${tabs === 1 ? "" : "s"}, ${groups} group${groups === 1 ? "" : "s"}`];
    if (session.skippedLinks) parts.push(`${session.skippedLinks} link${session.skippedLinks === 1 ? "" : "s"} skipped: not web pages`);
    return parts.join(" · ");
  }

  App.dialogs.import = (box, text) => {
    if (typeof text === "string") {
      let session;
      try { session = TV.parseImportText(text); }
      catch (e) { box.replaceChildren(el("h2", {}, "Import failed"), el("p", {}, e.message), el("div", { class: "row" }, el("button", { onclick: closeDialog }, "Close"))); return; }
      showRestore(box, session, "Import");
      return;
    }
    const area = el("textarea", { id: "import-paste", rows: "7", "aria-label": "Paste Markdown links, web addresses or a TabVault JSON export", placeholder: "## Research" + String.fromCharCode(10) + "- [Manifest V3 migration guide](https://docs.example.com/mv3)" });
    const preview = el("div", { id: "import-preview", class: "col" });
    let timer = null;
    const update = () => {
      const t = area.value;
      if (!t.trim()) { preview.replaceChildren(el("p", { class: "muted" }, "Paste a list of links: one window per ## heading, one group per ### heading, or no headings for one window.")); return; }
      let session;
      try { session = TV.parseImportText(t); }
      catch (e) { preview.replaceChildren(el("p", { class: "muted", id: "import-summary" }, e.message)); return; }
      preview.replaceChildren(...chooserNodes(box, session, "Import"));
    };
    area.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(update, 250); });
    box.replaceChildren(
      el("h2", {}, "Import"),
      el("div", { class: "row" }, el("button", { type: "button", id: "import-choose", onclick: () => document.getElementById("import-file").click() }, "Choose file…"), el("span", { class: "muted" }, "a .json export, a .md or .txt list of links, or paste:")),
      area, preview);
    update();
    area.focus();
  };

  function showRestore(box, session, title) {
    box.replaceChildren(el("h2", {}, `${title}: choose windows to restore`), ...chooserNodes(box, session, title));
  }

  // The window chooser: the summary, one tick per window, Restore and Cancel. Above 100 tabs the
  // button asks again; file: links are dropped (and said) when TabVault may not open local files.
  const ASK_ABOVE = 100;
  function chooserNodes(box, session, title) {
    const chosen = new Set(session.windows.map((w) => w.id));
    const rows = session.windows.map((w) => el("label", { class: "row" },
      el("input", { type: "checkbox", checked: "", onchange: (e) => { e.target.checked ? chosen.add(w.id) : chosen.delete(w.id); confirmed = false; go.textContent = "Restore selected windows"; } }),
      el("span", {}, `${w.incognito ? "🕶 " : ""}${w.windowName || (w.tabs[0] && (w.tabs[0].title || w.tabs[0].url)) || "(empty)"}`),
      el("span", { class: "muted" }, `${w.tabs.length} tabs, ${(w.groups || []).length} groups`)));
    const summary = el("p", { class: "muted", id: "import-summary" }, summaryText(session));
    const status = el("p", { class: "muted" }, session.capturedAt ? `Captured ${fmt(session.capturedAt)}` : "");
    const go = el("button", { class: "primary" }, "Restore selected windows");
    let confirmed = false;
    go.addEventListener("click", async () => {
      const count = session.windows.filter((w) => chosen.has(w.id)).reduce((n, w) => n + w.tabs.length, 0);
      if (count > ASK_ABOVE && !confirmed) {
        confirmed = true;
        go.textContent = `Open ${count} tabs? Restore anyway`;
        status.textContent = `This opens ${count} tabs${App.getSettings().lazyRestore !== false ? "; they load only when you open them" : ""}.`;
        return;
      }
      go.disabled = true;
      let r;
      let fileSkipped = 0;
      try {
        let toRestore = session;
        const hasFile = session.windows.some((w) => w.tabs.some((t) => String(t.url).startsWith("file:")));
        if (hasFile && !(await chrome.extension.isAllowedFileSchemeAccess())) {
          toRestore = { ...session, windows: session.windows.map((w) => {
            const tabs = w.tabs.filter((t) => !String(t.url).startsWith("file:"));
            fileSkipped += w.tabs.length - tabs.length;
            return { ...w, tabs };
          }) };
        }
        r = await restoreSession(toRestore, [...chosen], (p) => { status.textContent = p; });
      } catch (e) {
        status.textContent = `Restore failed: ${e.message || e}`;
        go.disabled = false;
        return;
      }
      const lines = [`Restored ${r.windows} windows and ${r.tabs} tabs${r.discard ? " (tabs load when you open them)" : ""}.`];
      if (fileSkipped) lines.push(`${fileSkipped} file link${fileSkipped === 1 ? "" : "s"} skipped: allow access to file URLs for TabVault at chrome://extensions to open them.`);
      for (const s of r.skipped) lines.push(`Skipped window ${s.windowId}: ${s.reason}`);
      for (const e of r.errors) lines.push(`Error: ${e}`);
      box.replaceChildren(el("h2", {}, `${title} complete`), ...lines.map((l) => el("p", {}, l)), el("div", { class: "row" }, el("button", { onclick: closeDialog }, "Close")));
    });
    return [summary, status, el("div", { class: "list" }, ...rows), el("div", { class: "row" }, go, el("button", { onclick: closeDialog }, "Cancel"))];
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
          el("button", { class: "compare", title: "Compare this snapshot with the tabs open now", onclick: () => App.openDialog("compare", { snapshotId: s.id }) }, "Compare"),
          el("button", { title: "Export this snapshot as JSON or Markdown", onclick: () => App.openDialog("export", { what: "snapshot", snapshotId: s.id }) }, "Export"),
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

  // ---- move to shelf (1.3) ------------------------------------------------------------
  // The selected tabs are saved to the shelf (read back) and only then closed, in the worker.
  App.dialogs.moveToShelf = (box, { tabIds = [] } = {}) => {
    const shelves = App.getShelves();
    const n = tabIds.length;
    const pick = el("select", { id: "move-shelf-pick", "aria-label": "Shelf" },
      ...shelves.map((s) => el("option", { value: s.id }, s.name)),
      el("option", { value: "new", selected: shelves.length ? null : "" }, "+ New shelf"));
    const name = el("input", { type: "text", id: "move-shelf-name", placeholder: "Reading later", maxlength: "60", "aria-label": "New shelf name" });
    const nameRow = el("label", { class: "row" }, "Name ", name);
    const err = el("p", { class: "muted" });
    const sync = () => { nameRow.hidden = pick.value !== "new"; };
    pick.addEventListener("change", sync);
    const go = el("button", { type: "button", class: "primary", id: "move-shelf-go", disabled: n ? null : "" }, `Shelve ${n} tab${n === 1 ? "" : "s"}`);
    go.addEventListener("click", async () => {
      let shelfId = pick.value;
      if (shelfId === "new") {
        if (!name.value.trim()) { err.textContent = "Name the new shelf."; name.focus(); return; }
        const r = await chrome.runtime.sendMessage({ type: "shelfCreate", name: name.value }).catch((e) => ({ ok: false, error: e.message }));
        if (!r || !r.ok) { err.textContent = `Could not create the shelf: ${r && r.error}`; return; }
        shelfId = r.shelf.id;
      }
      go.disabled = true;
      closeDialog();
      await App.moveToShelf(tabIds, shelfId);
    });
    box.replaceChildren(
      el("h2", {}, "Move to shelf"),
      el("p", {}, `Save ${n} selected tab${n === 1 ? "" : "s"} to a shelf, then close ${n === 1 ? "it" : "them"}. A shelf is kept until you delete it; open its tabs again from Shelves below your windows.`),
      el("label", { class: "row" }, "Shelf ", pick),
      nameRow, err,
      el("div", { class: "row" }, go, el("button", { type: "button", onclick: closeDialog }, "Cancel")));
    sync();
    if (pick.value === "new") name.focus();
  };

  // ---- compare a snapshot with now (1.3) ---------------------------------------------
  // lib/diff.js does the matching; this view only reopens (into one new window, or into the
  // windows the snapshot's windows were matched to) and selects. Nothing closes from it.
  function plural(n, word) { return `${n} ${word}${n === 1 ? "" : "s"}`; }
  function oneWindowSession(tabs) {
    return { schema: 1, windows: [{ id: 1, type: "normal", state: "normal", incognito: false, bounds: { left: 0, top: 0, width: 0, height: 0 }, groups: [], tabs: tabs.map((t, i) => ({ id: i + 1, index: i, url: t.url, title: t.title || "", pinned: false, muted: false, groupId: null })) }] };
  }

  App.dialogs.compare = async (box, { snapshotId } = {}) => {
    const area = chrome.storage.local;
    const snapshots = await TV.listSnapshots(area);
    if (!snapshots.length) {
      box.replaceChildren(el("h2", {}, "Compare with now"), el("p", { class: "muted" }, "No snapshots yet. They are taken automatically when your tabs change."), el("div", { class: "row" }, el("button", { type: "button", onclick: closeDialog }, "Close")));
      return;
    }
    let id = snapshotId && snapshots.some((s) => s.id === snapshotId) ? snapshotId : snapshots[0].id;
    let ignoreHash = App.getSettings().ignoreHash !== false;
    let snap = null;
    const ticked = new Set();

    const load = async () => {
      snap = await TV.getSnapshot(area, id);
      await App.refresh();
      ticked.clear();
    };
    const row = (kind, x, extra, check) => el("div", { class: "crow", dataset: { kind, url: x.tab.url } },
      check || null,
      el("span", { class: "ctitle", title: x.tab.url }, x.tab.title || x.tab.url),
      el("span", { class: "domain mono" }, TV.domainOf(x.tab.url)),
      el("span", { class: "muted cwhere" }, extra));

    const draw = () => {
      if (!snap) {
        box.replaceChildren(el("h2", {}, "Compare with now"), el("p", {}, "That snapshot is gone."), el("div", { class: "row" }, el("button", { type: "button", onclick: closeDialog }, "Close")));
        return;
      }
      const d = TV.diffSessions(snap.session, App.getSession(), { ignoreHash });
      if (!ticked.size) d.missing.forEach((_m, i) => ticked.add(i));
      const pick = el("select", { id: "compare-snapshot", "aria-label": "Snapshot to compare", onchange: async (e) => { id = e.target.value; await load(); draw(); } },
        ...snapshots.map((s) => el("option", { value: s.id, selected: s.id === id ? "" : null }, s.name || fmt(s.takenAt))));
      const chosen = () => d.missing.filter((_m, i) => ticked.has(i));
      const reopenNew = el("button", { type: "button", class: "primary", id: "compare-reopen-new" });
      const reopenInto = el("button", { type: "button", id: "compare-reopen-into" }, "Reopen into their windows");
      const label = () => {
        const n = chosen().length;
        reopenNew.textContent = `Reopen ${n} in a new window`;
        reopenNew.disabled = !n; reopenInto.disabled = !n;
      };
      const after = async (n, how) => { toast(`Reopened ${plural(n, "tab")}${how}`); await load(); draw(); };
      reopenNew.addEventListener("click", async () => {
        const list = chosen();
        reopenNew.disabled = true;
        try {
          const r = await App.restoreSession(oneWindowSession(list.map((m) => m.tab)), [1], () => {});
          if (r.errors.length) toast(`Reopened with errors: ${r.errors[0]}`);
          await after(list.length, " in a new window");
        } catch (e) { toast(`Could not reopen: ${e.message || e}`); label(); }
      });
      reopenInto.addEventListener("click", async () => {
        const list = chosen();
        reopenInto.disabled = true;
        const live = new Set(App.getSession().windows.filter((w) => w.type === "normal").map((w) => w.id));
        const homeless = [];
        try {
          for (const m of list) {
            if (m.targetWindowId !== null && live.has(m.targetWindowId)) await chrome.tabs.create({ windowId: m.targetWindowId, url: m.tab.url, active: false });
            else homeless.push(m.tab);
          }
          if (homeless.length) await App.restoreSession(oneWindowSession(homeless), [1], () => {});
          await after(list.length, homeless.length ? `; ${homeless.length} in a new window` : "");
        } catch (e) { toast(`Could not reopen: ${e.message || e}`); label(); }
      });
      const selectNew = el("button", { type: "button", id: "compare-select-new", disabled: d.added.length ? null : "", onclick: () => { App.selectTabs(d.added.map((a) => a.tab.id)); closeDialog(); toast(`${plural(d.added.length, "new tab")} selected`); } }, "Select all new");
      const missingRows = d.missing.map((m, i) => row("missing", m, `was in ${m.windowLabel}${m.groupTitle ? " · " + m.groupTitle : ""}`,
        el("input", { type: "checkbox", checked: ticked.has(i) ? "" : null, "aria-label": `Reopen ${m.tab.title || m.tab.url}`, onchange: (e) => { e.target.checked ? ticked.add(i) : ticked.delete(i); label(); } })));
      const addedRows = d.added.map((a) => row("added", a, `${a.windowLabel}${a.groupTitle ? " · " + a.groupTitle : ""}`));
      const movedRows = d.moved.map((m) => row("moved", m, `now in ${m.windowLabel}${m.groupTitle ? " · " + m.groupTitle : ""}, was in ${m.from.windowLabel}${m.from.groupTitle ? " · " + m.from.groupTitle : ""}`));
      label();
      box.replaceChildren(
        el("h2", {}, "Compare with now"),
        el("div", { class: "row" }, el("span", {}, "Snapshot "), pick, el("span", { class: "muted" }, `taken ${fmt(snap.takenAt)}`)),
        el("div", { class: "row", id: "compare-counts" },
          el("span", { class: "mono" }, `Missing now ${d.missing.length}`), el("span", { class: "mono" }, `New since ${d.added.length}`), el("span", { class: "mono" }, `Moved ${d.moved.length}`),
          el("label", {}, el("input", { type: "checkbox", id: "compare-hash", checked: ignoreHash ? "" : null, onchange: (e) => { ignoreHash = e.target.checked; ticked.clear(); draw(); } }), " Ignore #hash")),
        el("h3", {}, "Missing now"),
        el("div", { class: "list", id: "compare-missing" }, ...(missingRows.length ? missingRows : [el("p", { class: "muted" }, "Nothing is missing: every tab of the snapshot is open.")])),
        el("div", { class: "row" }, reopenNew, reopenInto),
        el("h3", {}, "New since"),
        el("div", { class: "list", id: "compare-added" }, ...(addedRows.length ? addedRows : [el("p", { class: "muted" }, "No new tabs since the snapshot.")])),
        el("div", { class: "row" }, selectNew),
        movedRows.length ? el("h3", {}, "Moved") : null,
        movedRows.length ? el("div", { class: "list", id: "compare-moved" }, ...movedRows) : null,
        el("div", { class: "row" }, el("button", { type: "button", onclick: closeDialog }, "Close")));
    };
    await load();
    draw();
  };

  // ---- settings ---------------------------------------------------------------------
  // The idle-tabs block (1.3): the global unload setting for tabs no rule matches, then the rules
  // (first match wins). Rule edits are saved at once (the dry-run lock lives in the stored rule);
  // the dialog's Save button saves the other settings.
  const idleLabel = (m) => (m < 60 ? `${m} minutes` : m === 60 ? "1 hour" : m === 1440 ? "1 day" : `${m / 60} hours`);

  App.dialogs.settings = async (box) => {
    const s = App.getSettings();
    const debounce = el("input", { type: "number", min: "30", max: "600", value: String(s.debounceSeconds) });
    const keep = el("input", { type: "number", min: "5", max: "200", value: String(s.keepSnapshots) });
    const hash = el("input", { type: "checkbox", checked: s.ignoreHash ? "" : null });
    const theme = el("select", { "aria-label": "Appearance" }, ...[["system", "System"], ["light", "Light"], ["dark", "Dark"]].map(([value, label]) => el("option", { value, selected: value === s.theme ? "" : null }, label)));
    const urls = el("input", { type: "checkbox", checked: s.showUrls ? "" : null });
    const density = el("select", {}, ...["comfortable", "compact"].map((d) => el("option", { value: d, selected: d === s.density ? "" : null }, d)));
    const lazy = el("input", { type: "checkbox", checked: s.lazyRestore !== false ? "" : null });
    const badge = el("select", { "aria-label": "Icon badge" }, ...[["total", "Tab count"], ["unloaded", "Unloaded tabs"], ["off", "Off"]].map(([value, label]) => el("option", { value, selected: value === s.badge ? "" : null }, label)));
    const ad = s.autoDiscard;
    const adOn = el("input", { type: "checkbox", id: "ad-enabled", checked: ad.enabled ? "" : null });
    const adMinutes = el("select", { id: "ad-minutes", "aria-label": "Idle threshold" }, ...TV.IDLE_MINUTES.map((m) => el("option", { value: String(m), selected: m === ad.minutes ? "" : null }, idleLabel(m))));
    const adPinned = el("input", { type: "checkbox", id: "ad-pinned", checked: ad.keepPinned ? "" : null });
    const lastRun = el("span", { id: "ad-last-run", class: "muted" }, "");
    const showLastRun = () => chrome.storage.session.get("autoDiscard.lastRun").then((r) => { lastRun.textContent = TV.lastRunText(r["autoDiscard.lastRun"]); }, () => { lastRun.textContent = ""; });
    showLastRun();
    const runNow = el("button", { type: "button", class: "small", id: "idle-run-now", onclick: async () => {
      runNow.disabled = true;
      const r = await chrome.runtime.sendMessage({ type: "runIdleNow" }).catch((e) => ({ ok: false, error: e.message }));
      runNow.disabled = false;
      if (!r || !r.ok) toast(`Could not run the idle rules: ${r && r.error}`);
      showLastRun();
    } }, "Run idle rules now");
    const recordClosed = el("input", { type: "checkbox", id: "record-closed", checked: s.recordClosed ? "" : null });
    const rulesBox = el("div", { id: "rules", class: "rules" });
    const addRule = el("button", { type: "button", class: "small", id: "rule-add" }, "+ Add rule");
    const err = el("p", { class: "muted" });
    const rules = createRulesEditor(rulesBox, addRule);
    await rules.load();
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
      el("h3", {}, "Idle tabs"),
      el("label", { class: "row" }, adOn, " Unload tabs not used for ", adMinutes, el("span", { class: "muted" }, " (tabs no rule below matches)")),
      el("label", { class: "row" }, adPinned, " Never unload pinned tabs"),
      el("div", { class: "row rules-head" }, el("strong", {}, "Rules (first match wins)"), addRule),
      rulesBox,
      el("div", { class: "row" }, lastRun, runNow),
      el("p", { class: "muted", id: "idle-note" }, `Never touched, whatever the rules say: the tab you are on in each window, tabs playing sound, tabs an extension marked as not discardable, and tabs in a group whose name starts with ${TV.PROTECT_EMOJI}. Unloaded tabs stay where they are and reload when you open them. Nothing is closed unless a rule you wrote says so: a shelving rule stays off until you have run its dry run and turned it on, saves each tab to its shelf before closing it, and handles at most 25 tabs a run. Text typed into a page is lost when its tab is shelved. After Chrome restarts, a rule may wait longer than its time.`),
      err,
      el("div", { class: "row" }, el("button", { class: "primary", onclick: async () => {
        const d = Number(debounce.value), k = Number(keep.value);
        if (!Number.isInteger(d) || d < 30 || d > 600) { err.textContent = "Debounce must be a whole number between 30 and 600."; return; }
        if (!Number.isInteger(k) || k < 5 || k > 200) { err.textContent = "Keep must be a whole number between 5 and 200."; return; }
        const current = App.getSettings();
        await App.saveSettings({ debounceSeconds: d, keepSnapshots: k, ignoreHash: hash.checked, theme: theme.value, showUrls: urls.checked, density: density.value, lazyRestore: lazy.checked, badge: badge.value, recordClosed: recordClosed.checked,
          autoDiscard: { ...current.autoDiscard, enabled: adOn.checked, minutes: Number(adMinutes.value), keepPinned: adPinned.checked } });
        toast("Settings saved"); closeDialog();
      } }, "Save"), el("button", { onclick: closeDialog }, "Cancel")));
  };

  // The rules list and its inline editor. Every change is saved at once through App.saveSettings.
  function createRulesEditor(container, addButton) {
    let shelves = [];
    let editing = null; // { draft, isNew }
    const dry = new Map(); // rule id -> { text, list, needsConfirm }
    const rulesNow = () => App.getSettings().idleRules.slice();
    const saveRules = async (list) => { await App.saveSettings({ idleRules: list }); };
    const shelfName = (id) => { const sh = shelves.find((x) => x.id === id); return sh ? sh.name : "(deleted shelf)"; };
    const actionText = (r) => (r.action === "never" ? "Never" : r.action === "unload" ? "Unload" : `Shelve to "${shelfName(r.shelfId)}"`);

    async function load() {
      shelves = await TV.listShelves(chrome.storage.local).catch(() => []);
      draw();
    }

    // Runs the dry run in the worker (it sees every tab); returns { tabs, matchCount, action }.
    async function runDry(rule) {
      const r = await chrome.runtime.sendMessage({ type: "idleDryRun", rule }).catch((e) => ({ ok: false, error: e.message }));
      if (!r || !r.ok) throw new Error((r && r.error) || "the dry run failed");
      return r;
    }
    function dryText(r, rule) {
      const n = r.tabs.length;
      if (rule.action === "never") return `${r.matchCount} open tab${r.matchCount === 1 ? "" : "s"} match; they will never be unloaded or shelved.`;
      const verb = rule.action === "shelve" ? "shelved" : "unloaded";
      if (!n) return `No tab would be ${verb} now (${r.matchCount} open tab${r.matchCount === 1 ? "" : "s"} match the site; they are in use, exempt or not idle long enough).`;
      return `${n} tab${n === 1 ? "" : "s"} would be ${verb} now:`;
    }
    function dryList(r) {
      const titles = r.tabs.slice(0, 12).map((t) => t.title || t.url);
      return el("div", { class: "muted dry-list" }, titles.join(" · ") + (r.tabs.length > 12 ? ` · and ${r.tabs.length - 12} more` : ""));
    }

    function ruleRow(r, i, list) {
      const unlocked = TV.ruleUnlocked(r);
      const sw = el("input", { type: "checkbox", role: "switch", class: "rule-on", "aria-label": `Rule ${r.pattern} on`, checked: r.enabled && unlocked ? "" : null, disabled: unlocked ? null : "", title: unlocked ? "Turn this rule on or off" : "Run its dry run first: the switch unlocks after it",
        onchange: async (e) => { const next = rulesNow(); const at = next.findIndex((x) => x.id === r.id); if (at < 0) return; next[at] = { ...next[at], enabled: e.target.checked }; await saveRules(next); draw(); } });
      const move = async (delta) => { const next = rulesNow(); const j = i + delta; if (j < 0 || j >= next.length) return; [next[i], next[j]] = [next[j], next[i]]; await saveRules(next); draw(); };
      const d = dry.get(r.id);
      return el("div", { class: "rule", dataset: { rule: r.id } },
        el("div", { class: "row rule-main" },
          el("span", { class: "mono rule-pattern" }, r.pattern),
          el("span", { class: "rule-after" }, r.action === "never" ? "" : `after ${idleLabel(r.idleMinutes)}`),
          el("span", { class: "rule-action" }, actionText(r)),
          el("label", { class: "rule-switch" }, sw, " on")),
        el("div", { class: "row rule-tools" },
          el("button", { type: "button", class: "small rule-dry", onclick: () => dryFromRow(r) }, "Dry run"),
          el("button", { type: "button", class: "small rule-edit", onclick: () => { editing = { draft: { ...r }, isNew: false, dryKey: r.previewedFor }; draw(); } }, "Edit"),
          el("button", { type: "button", class: "small", "aria-label": "Move rule up", title: "Move up", disabled: i === 0 ? "" : null, onclick: () => move(-1) }, "↑"),
          el("button", { type: "button", class: "small", "aria-label": "Move rule down", title: "Move down", disabled: i === list.length - 1 ? "" : null, onclick: () => move(1) }, "↓"),
          el("button", { type: "button", class: "small danger rule-delete", onclick: async () => { await saveRules(rulesNow().filter((x) => x.id !== r.id)); dry.delete(r.id); draw(); } }, "Delete")),
        d ? el("div", { class: "rule-dry-out" }, el("p", { class: "muted" }, d.text), d.list || null,
          d.needsConfirm ? el("div", { class: "row" }, el("span", {}, `This rule matches ${d.matchCount} open tabs. Turn it on anyway?`),
            el("button", { type: "button", class: "small rule-confirm-large", onclick: () => unlockRow(r, true) }, "Allow it")) : null) : null);
    }

    async function dryFromRow(r) {
      try {
        const out = await runDry(r);
        const gate = TV.dryRunUnlock(out.matchCount, false);
        dry.set(r.id, { text: dryText(out, r), list: out.tabs.length ? dryList(out) : null, needsConfirm: r.action === "shelve" && gate.needsConfirm, matchCount: out.matchCount });
        if (r.action === "shelve" && gate.unlocked) await unlockRow(r, false);
        else draw();
      } catch (e) { toast(`Dry run failed: ${e.message || e}`); }
    }
    async function unlockRow(r, confirmed) {
      const next = rulesNow();
      const at = next.findIndex((x) => x.id === r.id);
      if (at < 0) return;
      next[at] = { ...next[at], previewedFor: TV.ruleKey(next[at]) };
      if (confirmed) { const d = dry.get(r.id); if (d) d.needsConfirm = false; }
      await saveRules(next);
      draw();
    }

    function editor() {
      const { draft, isNew } = editing;
      const pattern = el("input", { type: "text", id: "rule-pattern", value: draft.pattern || "", placeholder: "news.example.com", "aria-label": "Sites", spellcheck: "false" });
      const minutes = el("select", { id: "rule-minutes", "aria-label": "After" }, ...TV.RULE_IDLE_MINUTES.map((m) => el("option", { value: String(m), selected: m === draft.idleMinutes ? "" : null }, idleLabel(m))));
      const shelfSel = el("select", { id: "rule-shelf", "aria-label": "Shelf" },
        ...shelves.map((sh) => el("option", { value: sh.id, selected: sh.id === draft.shelfId ? "" : null }, sh.name)),
        el("option", { value: "new", selected: !shelves.length || draft.shelfId === "new" ? "" : null }, "+ New shelf"));
      const newShelf = el("input", { type: "text", id: "rule-new-shelf", placeholder: "Reading later", "aria-label": "New shelf name", maxlength: "60" });
      const actionRadio = (value, label) => el("label", { class: "opt" }, el("input", { type: "radio", name: "rule-action", value, checked: draft.action === value ? "" : null, onchange: () => { draft.action = value; relock(); sync(); } }), ` ${label}`);
      const on = el("input", { type: "checkbox", id: "rule-on", role: "switch" });
      const onLabel = el("label", { class: "opt" }, on, " On");
      const hint = el("span", { class: "muted", id: "rule-on-hint" });
      const dryBtn = el("button", { type: "button", id: "rule-dry-run" }, "Dry run");
      const dryOut = el("div", { id: "rule-dry-result", class: "muted" });
      const confirmLarge = el("div", { class: "row", id: "rule-confirm-box", hidden: "" });
      const error = el("p", { class: "muted", id: "rule-error" });
      let dryKey = editing.dryKey || "";
      on.checked = isNew ? draft.action !== "shelve" : Boolean(draft.enabled);
      // The dry-run key covers the pattern, the time and the action (lib/discard-rule.js ruleKey):
      // a dry run made as Unload or Never does not unlock the rule once it is set to Shelve.
      const key = () => TV.ruleKey({ pattern: TV.normalizePattern(pattern.value), idleMinutes: Number(minutes.value), action: draft.action });
      let shownKey = "";
      const unlocked = () => draft.action !== "shelve" || (dryKey && dryKey === key());
      function relock() {
        if (shownKey && key() !== shownKey) { dryOut.replaceChildren(); confirmLarge.hidden = true; shownKey = ""; }
        if (!unlocked()) on.checked = false;
      }
      function sync() {
        const shelving = draft.action === "shelve";
        shelfSel.disabled = !shelving;
        newShelf.hidden = !(shelving && shelfSel.value === "new");
        on.disabled = !unlocked();
        hint.textContent = shelving && !unlocked() ? "(the On switch unlocks after a dry run)" : "";
      }
      pattern.addEventListener("input", () => { relock(); sync(); });
      minutes.addEventListener("change", () => { relock(); sync(); });
      shelfSel.addEventListener("change", sync);
      dryBtn.addEventListener("click", async () => {
        const p = TV.normalizePattern(pattern.value);
        const why = TV.patternError(pattern.value);
        if (why) { error.textContent = why; return; }
        error.textContent = "";
        const rule = { id: draft.id, pattern: p, idleMinutes: Number(minutes.value), action: draft.action, shelfId: draft.action === "shelve" ? shelfSel.value : null, enabled: true, previewedFor: "" };
        dryBtn.disabled = true;
        try {
          const ranKey = key();
          const out = await runDry(rule);
          // Values changed while the dry run ran: its result is for a rule no longer on screen.
          if (key() !== ranKey) return;
          shownKey = ranKey;
          dryOut.replaceChildren(el("p", {}, dryText(out, rule)), out.tabs.length ? dryList(out) : "");
          const gate = TV.dryRunUnlock(out.matchCount, false);
          if (draft.action === "shelve" && gate.needsConfirm) {
            dryKey = "";
            confirmLarge.replaceChildren(el("span", {}, `This rule matches ${out.matchCount} open tabs. Turn it on anyway?`),
              el("button", { type: "button", class: "small", id: "rule-confirm-large", onclick: () => { dryKey = TV.allowLargeKey(ranKey, key()); confirmLarge.hidden = true; sync(); } }, "Allow it"));
            confirmLarge.hidden = false;
          } else {
            dryKey = ranKey;
            confirmLarge.hidden = true;
          }
        } catch (e) {
          dryOut.textContent = `Dry run failed: ${e.message || e}`;
        } finally {
          dryBtn.disabled = false;
          sync();
        }
      });
      const save = el("button", { type: "button", class: "primary", id: "rule-save", onclick: async () => {
        const why = TV.patternError(pattern.value);
        if (why) { error.textContent = why; return; }
        let shelfId = null;
        if (draft.action === "shelve") {
          shelfId = shelfSel.value;
          if (shelfId === "new") {
            const name = newShelf.value.trim();
            if (!name) { error.textContent = "Name the new shelf."; newShelf.focus(); return; }
            const r = await chrome.runtime.sendMessage({ type: "shelfCreate", name }).catch((e) => ({ ok: false, error: e.message }));
            if (!r || !r.ok) { error.textContent = `Could not create the shelf: ${r && r.error}`; return; }
            shelfId = r.shelf.id;
            shelves = await TV.listShelves(chrome.storage.local).catch(() => shelves);
          }
        }
        const p = TV.normalizePattern(pattern.value);
        const rule = { id: draft.id, pattern: p, idleMinutes: Number(minutes.value), action: draft.action, shelfId, previewedFor: draft.action === "shelve" && unlocked() ? key() : "", enabled: false };
        rule.enabled = on.checked && (draft.action !== "shelve" || rule.previewedFor === TV.ruleKey(rule));
        const next = rulesNow();
        const at = next.findIndex((x) => x.id === rule.id);
        if (at >= 0) next[at] = rule; else next.push(rule);
        await saveRules(next);
        dry.delete(rule.id);
        editing = null;
        draw();
        toast(isNew ? "Rule added" : "Rule saved");
      } }, "Save");
      const cancel = el("button", { type: "button", id: "rule-cancel", onclick: () => { editing = null; draw(); } }, "Cancel");
      const node = el("div", { class: "rule-editor", id: "rule-editor" },
        el("label", { class: "row" }, "Sites ", pattern, el("span", { class: "muted" }, "one host; *.host covers subdomains")),
        el("label", { class: "row" }, "After ", minutes),
        el("div", { class: "row", role: "radiogroup", "aria-label": "Then" }, el("span", {}, "Then"), actionRadio("unload", "Unload"), actionRadio("shelve", "Shelve to"), shelfSel, newShelf, actionRadio("never", "Never")),
        el("div", { class: "row" }, dryBtn, el("span", { class: "muted" }, "lists what this rule would do to your open tabs now")),
        dryOut, confirmLarge,
        el("div", { class: "row" }, onLabel, hint),
        error,
        el("div", { class: "row" }, save, cancel));
      sync();
      setTimeout(() => { if (pattern.isConnected) pattern.focus(); }, 0);
      return node;
    }

    function draw() {
      const list = App.getSettings().idleRules;
      const nodes = list.map((r, i) => (editing && !editing.isNew && editing.draft.id === r.id ? editor() : ruleRow(r, i, list)));
      if (editing && editing.isNew) nodes.push(editor());
      if (!nodes.length) nodes.push(el("p", { class: "muted" }, "No rules yet. Add one to unload, shelve or never touch the tabs of one site."));
      container.replaceChildren(...nodes);
      addButton.disabled = Boolean(editing);
    }

    addButton.addEventListener("click", () => {
      editing = { draft: { id: TV.ruleId(), pattern: "", idleMinutes: 60, action: "shelve", shelfId: shelves[0] ? shelves[0].id : "new", enabled: false, previewedFor: "" }, isNew: true, dryKey: "" };
      draw();
    });
    return { load };
  }

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
      el("p", { class: "muted" }, "Free for personal and non-commercial use (PolyForm Noncommercial License 1.0.0); commercial use needs the author's written permission. Type: IBM Plex Sans and Plex Mono (SIL Open Font License 1.1)."),
      el("div", { class: "row" }, el("button", { type: "button", onclick: closeDialog }, "Close")));
  };

  // ---- focus mode (1.4) -----------------------------------------------------------------
  // Asked once, before the first veil: the optional <all_urls> host permission. Chrome's own
  // prompt follows the Allow click (permissions.request must run inside it, with nothing awaited
  // first). Declined, or Minimise chosen: the other windows are minimised instead, and the
  // shortcut remembers that choice (storage.local focusFallback).
  App.dialogs.focus = (box, { windowId }) => {
    const allow = el("button", { type: "button", class: "primary", id: "focus-allow" }, "Allow and focus");
    const minimize = el("button", { type: "button", id: "focus-minimize" }, "Minimise the other windows instead");
    const cancel = el("button", { type: "button", id: "focus-cancel", onclick: closeDialog }, "Cancel");
    const note = el("p", { id: "focus-note", class: "muted" }, "Chrome asks you once. TabVault never reads, stores or sends anything from those pages; the veil is only drawn on top of them.");
    const start = async (mode) => {
      const r = await chrome.runtime.sendMessage({ type: "focusStart", windowId, mode }).catch((e) => ({ ok: false, error: e.message || String(e) }));
      closeDialog();
      if (!r || !r.ok) { toast("Focus mode failed: " + ((r && r.error) || "no answer")); return; }
      if (mode === "minimize") toast(`Focus is on: ${r.minimized} other window${r.minimized === 1 ? "" : "s"} minimised (no veil without the permission)`);
      else toast(`Focus is on: ${r.veiled} tab${r.veiled === 1 ? "" : "s"} veiled${r.skipped ? `, ${r.skipped} could not be` : ""}`);
    };
    allow.addEventListener("click", () => {
      allow.disabled = true;
      chrome.permissions.request({ origins: TV.FOCUS_ORIGINS }).then((granted) => {
        if (granted) { start("veil"); return; }
        allow.disabled = false;
        note.textContent = "Chrome did not grant the permission, so Focus mode cannot draw the veil. It can minimise your other windows instead.";
        note.className = "";
        minimize.classList.add("primary");
        minimize.focus();
      }, (e) => { allow.disabled = false; note.textContent = "Chrome refused the request: " + (e.message || e); note.className = ""; });
    });
    minimize.addEventListener("click", async () => {
      minimize.disabled = true;
      await chrome.storage.local.set({ [TV.FOCUS_FALLBACK_KEY]: "minimize" }).catch(() => {});
      start("minimize");
    });
    box.replaceChildren(
      el("h2", {}, "Focus mode"),
      el("p", { id: "focus-text-ask" }, "Focus mode draws a veil over your other windows, which needs permission to touch those pages; TabVault still reads nothing from them."),
      note,
      el("div", { class: "row" }, allow, minimize, cancel));
    allow.focus();
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
