// Bookmarks dialogs (1.6): save tabs as a bookmark folder, the Bookmarks dialog (back up, the HTML
// export, the stored backups) and Find duplicate bookmarks. Every write goes to the worker, which
// runs lib/bookmarks.js in its bookmark queue; a removal there is always a move into "Deleted".
// Reads go through TV.safeBookmarks (no remove, no removeTree). Nothing leaves the browser.
(() => {
  const TV = self.TabVault;
  const App = window.TabVaultApp;
  const { el, toast, closeDialog } = App;
  const VERSION = chrome.runtime.getManifest().version;

  function plural(n, word) { return `${n} ${word}${n === 1 ? "" : "s"}`; }
  function fmt(ts) { return ts ? new Date(ts).toLocaleString() : ""; }
  function offDialog(box) {
    box.replaceChildren(el("h2", {}, "Bookmarks"), el("p", {}, "Bookmarks are off. Turn them on in Settings."), el("div", { class: "row" }, el("button", { type: "button", onclick: closeDialog }, "Close")));
  }

  // ---- save as a bookmark folder ---------------------------------------------------------------
  App.dialogs.bmSave = (box, { name = "", tabs = [] } = {}) => {
    if (!App.bookmarksOn()) { offDialog(box); return; }
    const links = tabs.filter((t) => TV.isWebPage(t.url));
    const skipped = tabs.length - links.length;
    const input = el("input", { type: "text", id: "bm-save-name", value: String(name).slice(0, 100), maxlength: "100", "aria-label": "Folder name" });
    const err = el("p", { class: "muted", id: "bm-save-error" });
    const go = el("button", { type: "button", class: "primary", id: "bm-save-go", disabled: links.length ? null : "" }, `Save ${plural(links.length, "bookmark")}`);
    go.addEventListener("click", async () => {
      if (!input.value.trim()) { err.textContent = "Name the folder."; input.focus(); return; }
      go.disabled = true;
      const r = await chrome.runtime.sendMessage({ type: "bmSaveFolder", name: input.value, tabs: links }).catch((e) => ({ ok: false, error: e.message }));
      if (!r || !r.ok) { err.textContent = `Could not save: ${r && r.error}`; go.disabled = false; return; }
      closeDialog();
      toast(`Saved ${plural(r.saved, "bookmark")} to Other bookmarks › TabVault › ${r.title}${r.backup ? " (bookmarks backed up first)" : ""}`);
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go.click(); } });
    box.replaceChildren(
      el("h2", {}, "Save as bookmark folder"),
      el("p", {}, `A new folder in Other bookmarks › TabVault with ${plural(links.length, "bookmark")}, in tab order.${skipped ? ` ${plural(skipped, "link")} skipped: not web pages.` : ""}`),
      el("label", { class: "row" }, "Folder name ", input),
      err,
      el("div", { class: "row" }, go, el("button", { type: "button", onclick: closeDialog }, "Cancel")));
    input.focus(); input.select();
  };

  // ---- back up now (also a palette command) ---------------------------------------------------
  // The worker reads the whole tree, stores it (read back) and returns it; the page downloads the
  // same backup as a JSON file.
  async function backupNow() {
    if (!App.bookmarksOn()) { toast("Bookmarks are off in Settings"); return null; }
    const r = await chrome.runtime.sendMessage({ type: "bmBackup" }).catch((e) => ({ ok: false, error: e.message }));
    if (!r || !r.ok) { toast(`Backup failed: ${r && r.error}`); return null; }
    const file = TV.backupFile(r.meta, r.nodes, { version: VERSION });
    App.download(file.filename, file.text, "application/json");
    toast(`Backed up ${plural(r.meta.bookmarks, "bookmark")} in ${plural(r.meta.folders, "folder")}`);
    return r.meta;
  }
  App.backupBookmarksNow = backupNow;

  // ---- the Bookmarks dialog --------------------------------------------------------------------
  App.dialogs.bookmarks = async (box) => {
    if (!App.bookmarksOn()) { offDialog(box); return; }
    const area = chrome.storage.local;
    const draw = async () => {
      const backups = await TV.listBackups(area).catch(() => []);
      const list = el("div", { class: "list bm-backups", id: "bm-backups" });
      if (!backups.length) list.append(el("p", { class: "muted" }, "No backups yet."));
      for (const m of backups) {
        list.append(el("div", { class: "bm-row", dataset: { backup: m.id } },
          el("span", {}, fmt(m.takenAt)),
          el("span", { class: "muted" }, `${plural(m.bookmarks, "bookmark")}, ${plural(m.folders, "folder")} · ${TV.backupReasonText(m.reason)}`),
          el("button", { type: "button", class: "small bm-backup-download", onclick: async () => {
            const b = await TV.readBackup(area, m.id);
            if (!b) { toast("That backup is gone or incomplete"); draw(); return; }
            const file = TV.backupFile(b.meta, b.nodes, { version: VERSION });
            App.download(file.filename, file.text, "application/json");
          } }, "Download")));
      }
      const backupBtn = el("button", { type: "button", class: "primary", id: "bm-backup-now" }, "Back up now");
      backupBtn.addEventListener("click", async () => { backupBtn.disabled = true; await backupNow(); await draw(); });
      const htmlBtn = el("button", { type: "button", id: "bm-export-html", title: "The standard bookmarks file every browser can import" }, "Export as HTML");
      htmlBtn.addEventListener("click", async () => {
        try {
          const nodes = TV.flattenTree(await App.bookmarkApi().getTree());
          const file = TV.toBookmarksHtml(nodes);
          App.download(file.filename, file.text, "text/html");
          toast("Bookmarks exported as HTML");
        } catch (e) { toast(`Could not export: ${e.message || e}`); }
      });
      box.replaceChildren(
        el("h2", {}, "Bookmarks"),
        el("p", {}, "A backup saves every bookmark with its folders, order, titles, addresses and dates: a JSON file is downloaded, and TabVault keeps the latest copies on this computer (Settings sets how many). One is also taken by itself before any change to more than 10 bookmarks."),
        el("div", { class: "row" }, backupBtn, htmlBtn, el("button", { type: "button", id: "bm-open-dupes", onclick: () => App.openDialog("bmDupes") }, "Find duplicate bookmarks")),
        el("h3", {}, `Kept backups (${backups.length})`),
        list,
        el("p", { class: "muted", id: "bm-restore-note" }, "Restoring from a backup is coming in a later version of TabVault. Today, Chrome itself can import the HTML export (Bookmarks manager, ⋮, Import bookmarks)."),
        el("p", { class: "muted" }, "TabVault never deletes a bookmark: Delete moves it to Other bookmarks › Deleted. Only you empty that folder, in Chrome's bookmark manager."),
        el("div", { class: "row" }, el("button", { type: "button", onclick: closeDialog }, "Close")));
    };
    await draw();
  };

  // ---- duplicate bookmarks ---------------------------------------------------------------------
  // Groups of bookmarks with the same address (the ignore-hash setting applies), oldest first.
  // Nothing is ticked until the user ticks it; the chosen ones move to "Deleted".
  App.dialogs.bmDupes = async (box) => {
    if (!App.bookmarksOn()) { offDialog(box); return; }
    const area = chrome.storage.local;
    let ignoreHash = App.getSettings().ignoreHash !== false;
    const ticked = new Set();
    let groups = [];
    const load = async () => {
      const tree = await App.bookmarkApi().getTree();
      const deletedId = await TV.deletedFolderId(area, tree);
      groups = TV.findBookmarkDuplicates(TV.buildBookmarkIndex(tree, { deletedId }), { ignoreHash });
      const live = new Set(groups.flatMap((g) => g.items.map((x) => x.id)));
      for (const id of [...ticked]) if (!live.has(id)) ticked.delete(id);
    };
    const draw = () => {
      const go = el("button", { type: "button", class: "primary", id: "bm-dupes-go" });
      const label = () => { go.textContent = `Move ${ticked.size} to Deleted`; go.disabled = ticked.size === 0; };
      go.addEventListener("click", async () => {
        const ids = [...ticked];
        go.disabled = true;
        const r = await App.moveBookmarksToDeleted(ids);
        if (r && r.ok) ticked.clear();
        await load();
        draw();
      });
      const hash = el("input", { type: "checkbox", id: "bm-dupes-hash", checked: ignoreHash ? "" : null, onchange: async (e) => { ignoreHash = e.target.checked; ticked.clear(); await load(); draw(); } });
      const allButOldest = el("button", { type: "button", class: "small", id: "bm-dupes-tick", onclick: () => { ticked.clear(); for (const g of groups) for (const x of g.items.slice(1)) ticked.add(x.id); draw(); } }, "Tick all but the oldest");
      const none = el("button", { type: "button", class: "small", onclick: () => { ticked.clear(); draw(); } }, "Tick none");
      const list = el("div", { class: "list bm-dupes", id: "bm-dupes-list" });
      for (const g of groups) {
        list.append(el("div", { class: "bm-group", dataset: { key: g.key } },
          el("div", { class: "muted", style: "word-break:break-all" }, g.key),
          ...g.items.map((x) => el("label", { class: "bm-row", dataset: { bookmark: x.id } },
            el("input", { type: "checkbox", checked: ticked.has(x.id) ? "" : null, "aria-label": `Move ${x.title} to Deleted`, onchange: (e) => { e.target.checked ? ticked.add(x.id) : ticked.delete(x.id); label(); } }),
            el("span", { class: "bm-title", title: x.url }, x.title),
            el("span", { class: "muted" }, x.path),
            el("span", { class: "muted" }, x.dateAdded ? `added ${new Date(x.dateAdded).toLocaleDateString()}` : "")))));
      }
      label();
      box.replaceChildren(
        el("h2", {}, "Duplicate bookmarks"),
        el("div", { class: "row" }, el("label", {}, hash, " Ignore #hash when comparing"), el("span", { class: "muted", id: "bm-dupes-count" }, `${groups.length} duplicated address${groups.length === 1 ? "" : "es"}`)),
        groups.length ? el("div", { class: "row" }, allButOldest, none) : el("p", { class: "muted" }, "No duplicate bookmarks."),
        list,
        el("p", { class: "muted" }, "Ticked bookmarks are moved to Other bookmarks › Deleted, not deleted; more than 10 at once are backed up first."),
        el("div", { class: "row" }, go, el("button", { type: "button", onclick: closeDialog }, "Close")));
    };
    await load();
    draw();
  };
})();
