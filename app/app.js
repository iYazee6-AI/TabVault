(() => {
  const TV = self.TabVault;
  const $ = (id) => document.getElementById(id);
  const OWN_PREFIX = chrome.runtime.getURL("");
  const DEFAULT_SETTINGS = { debounceSeconds: 30, keepSnapshots: 20, ignoreHash: true, theme: "system", showUrls: false, density: "comfortable" };
  const GROUP_COLORS = { grey: "#8a8a8a", blue: "#1a73e8", red: "#d93025", yellow: "#f9ab00", green: "#188038", pink: "#d01884", purple: "#a142f4", cyan: "#007b83", orange: "#fa903e" };

  const state = {
    session: { schema: 1, windows: [] },
    settings: { ...DEFAULT_SETTINGS },
    query: "",
    selected: new Set(),
    cursor: null,
    collapsedWindows: new Set(),
    lastClicked: null,
  };

  // ---- data ------------------------------------------------------------------
  async function loadSettings() {
    const { settings = {} } = await chrome.storage.local.get("settings");
    state.settings = { ...DEFAULT_SETTINGS, ...settings };
    applySettings();
  }
  async function saveSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    await chrome.storage.local.set({ settings: state.settings });
    applySettings();
    render();
  }
  function applySettings() {
    const root = document.documentElement;
    const dark = state.settings.theme === "dark" || (state.settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.dataset.theme = state.settings.theme;
    root.classList.toggle("dark", dark);
    root.dataset.showUrls = String(Boolean(state.settings.showUrls));
    root.dataset.density = state.settings.density;
  }

  async function readSession() {
    const windows = await chrome.windows.getAll({ populate: true });
    const groups = chrome.tabGroups ? await chrome.tabGroups.query({}) : [];
    return TV.buildSession({ windows, groups, now: Date.now(), excludeUrlPrefix: OWN_PREFIX });
  }

  let refreshTimer = null;
  async function refresh() {
    state.session = await readSession();
    const live = new Set(state.session.windows.flatMap((w) => w.tabs.map((t) => t.id)));
    for (const id of state.selected) if (!live.has(id)) state.selected.delete(id);
    if (state.cursor !== null && !live.has(state.cursor)) state.cursor = null;
    render();
  }
  function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refresh().catch(console.error), 100); }

  // ---- rendering -------------------------------------------------------------
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) node.setAttribute(k, v);
    }
    for (const c of children) if (c !== null && c !== undefined) node.append(c);
    return node;
  }

  function windowTitle(w) {
    const active = w.tabs.find((t) => t.active) || w.tabs[0];
    return active ? active.title || active.url : "(empty)";
  }

  function tabRow(w, t) {
    const row = el("div", {
      class: `tab${state.selected.has(t.id) ? " selected" : ""}${state.cursor === t.id ? " cursor" : ""}${t.active ? " active" : ""}${t.discarded ? " discarded" : ""}`,
      draggable: "true", title: t.url, dataset: { tab: String(t.id), window: String(w.id) },
    });
    const icon = el("img", { src: t.favIconUrl || "../icons/icon16.png", alt: "" });
    icon.addEventListener("error", () => { icon.src = "../icons/icon16.png"; });
    const text = el("div", { class: "text" }, el("span", { class: "ttitle" }, t.title || t.url), el("span", { class: "turl" }, t.url));
    const badges = [];
    if (t.pinned) badges.push("📌");
    if (t.audible && !t.muted) badges.push("🔊");
    if (t.muted) badges.push("🔇");
    const close = el("button", { class: "close", title: "Close tab", onclick: (e) => { e.stopPropagation(); chrome.tabs.remove(t.id); } }, "×");
    row.append(el("input", { type: "checkbox", checked: state.selected.has(t.id) ? "" : null, onclick: (e) => { e.stopPropagation(); toggleSelect(t.id, e.shiftKey, w); } }), icon, text, el("span", { class: "badge" }, badges.join(" ")), close);
    row.addEventListener("click", (e) => {
      if (e.ctrlKey || e.metaKey) { toggleSelect(t.id, false, w); return; }
      if (e.shiftKey) { toggleSelect(t.id, true, w); return; }
      focusTab(t.id, w.id);
    });
    row.addEventListener("dragstart", (e) => {
      const ids = state.selected.has(t.id) ? [...state.selected] : [t.id];
      e.dataTransfer.setData("text/plain", JSON.stringify({ tabIds: ids }));
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("dragover"); });
    row.addEventListener("dragleave", () => row.classList.remove("dragover"));
    row.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); row.classList.remove("dragover"); dropTabs(e, { windowId: w.id, index: t.index, groupId: t.groupId }); });
    return row;
  }

  function groupSection(w, g, tabs) {
    const sec = el("div", { class: `group${g.collapsed ? " collapsed" : ""}`, style: `--gcolor:${GROUP_COLORS[g.color] || "#999"}` });
    const title = el("span", { class: "gtitle" }, g.title || "(unnamed group)");
    const head = el("div", { class: "ghead" },
      el("button", { title: g.collapsed ? "Expand" : "Collapse", onclick: () => chrome.tabGroups.update(g.id, { collapsed: !g.collapsed }) }, g.collapsed ? "▸" : "▾"),
      title,
      el("span", { class: "badge" }, String(tabs.length)),
      el("button", { title: "Rename", onclick: () => renameGroup(g, title) }, "✎"),
      el("select", { title: "Color", onchange: (e) => chrome.tabGroups.update(g.id, { color: e.target.value }) }, ...Object.keys(GROUP_COLORS).map((c) => el("option", { value: c, selected: c === g.color ? "" : null }, c))),
      el("button", { title: "Ungroup", onclick: () => chrome.tabs.ungroup(tabs.map((t) => t.id)) }, "⊟"));
    sec.append(head, ...tabs.map((t) => tabRow(w, t)));
    sec.addEventListener("dragover", (e) => { e.preventDefault(); sec.classList.add("drop"); });
    sec.addEventListener("dragleave", () => sec.classList.remove("drop"));
    sec.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); sec.classList.remove("drop"); dropTabs(e, { windowId: w.id, index: -1, groupId: g.id }); });
    return sec;
  }

  function renameGroup(g, titleEl) {
    const input = el("input", { type: "text", value: g.title });
    const done = async () => { await chrome.tabGroups.update(g.id, { title: input.value.trim() }); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(); if (e.key === "Escape") render(); });
    input.addEventListener("blur", done);
    titleEl.replaceWith(input);
    input.focus(); input.select();
  }

  function windowColumn(w) {
    const col = el("div", { class: `window${w.incognito ? " incognito" : ""}${state.collapsedWindows.has(w.id) ? " collapsed" : ""}`, dataset: { window: String(w.id) } });
    const head = el("div", { class: "whead" },
      el("button", { title: "Collapse", onclick: () => { state.collapsedWindows.has(w.id) ? state.collapsedWindows.delete(w.id) : state.collapsedWindows.add(w.id); render(); } }, state.collapsedWindows.has(w.id) ? "▸" : "▾"),
      el("span", { class: "title", title: windowTitle(w) }, (w.incognito ? "🕶 " : "") + windowTitle(w)),
      el("span", { class: "count" }, String(w.tabs.length)),
      el("button", { title: "Select all in window", onclick: () => { for (const t of w.tabs) state.selected.add(t.id); render(); } }, "☑"),
      el("button", { title: "Focus window", onclick: () => chrome.windows.update(w.id, { focused: true }) }, "⤴"),
      el("button", { class: "danger", title: "Close window", onclick: () => closeWindow(w) }, "×"));
    const body = el("div", { class: "tabs" });
    // Render in index order, wrapping consecutive tabs of a group in a section.
    let i = 0;
    while (i < w.tabs.length) {
      const t = w.tabs[i];
      if (t.groupId === null) { body.append(tabRow(w, t)); i++; continue; }
      const g = w.groups.find((x) => x.id === t.groupId) || { id: t.groupId, title: "", color: "grey", collapsed: false };
      const members = [];
      while (i < w.tabs.length && w.tabs[i].groupId === t.groupId) members.push(w.tabs[i++]);
      body.append(groupSection(w, g, members));
    }
    col.append(head, body);
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drop"); });
    col.addEventListener("dragleave", () => col.classList.remove("drop"));
    col.addEventListener("drop", (e) => { e.preventDefault(); col.classList.remove("drop"); dropTabs(e, { windowId: w.id, index: -1, groupId: null }); });
    return col;
  }

  function closeWindow(w) {
    const head = document.querySelector(`.window[data-window="${w.id}"] .whead`);
    const confirmBtn = el("button", { class: "danger", onclick: () => chrome.windows.remove(w.id) }, `Close ${w.tabs.length} tabs`);
    const cancel = el("button", { onclick: () => render() }, "Cancel");
    head.replaceChildren(confirmBtn, cancel);
  }

  function render() {
    const grid = $("grid");
    const scroll = { left: grid.scrollLeft, top: grid.scrollTop };
    const filtered = TV.filterSession(state.session, state.query);
    grid.replaceChildren();
    if (filtered.windows.length === 0) {
      grid.append(el("div", { id: "empty" }, state.query ? "No tabs match." : "No other windows are open."));
    } else {
      for (const w of filtered.windows) grid.append(windowColumn(w));
    }
    grid.scrollLeft = scroll.left; grid.scrollTop = scroll.top;
    const total = TV.countTabs(state.session);
    $("counts").textContent = state.query ? `${filtered.count} of ${total} tabs` : `${state.session.windows.length} windows · ${total} tabs`;
    renderSelbar();
  }

  function renderSelbar() {
    const n = state.selected.size;
    $("selbar").hidden = n === 0;
    $("selcount").textContent = `${n} selected`;
    const sel = $("move-target");
    sel.replaceChildren(el("option", { value: "" }, "Move to…"), el("option", { value: "new" }, "New window"),
      ...state.session.windows.map((w) => el("option", { value: String(w.id) }, `${windowTitle(w).slice(0, 40)} (${w.tabs.length})`)));
  }

  // ---- selection ---------------------------------------------------------------
  function toggleSelect(id, range, w) {
    if (range && state.lastClicked !== null && w.tabs.some((t) => t.id === state.lastClicked)) {
      const ids = w.tabs.map((t) => t.id);
      const a = ids.indexOf(state.lastClicked), b = ids.indexOf(id);
      for (const x of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) state.selected.add(x);
    } else {
      state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    }
    state.lastClicked = id;
    state.cursor = id;
    render();
  }
  function selection() { return [...state.selected]; }
  function clearSelection() { state.selected.clear(); render(); }

  // ---- actions -------------------------------------------------------------------
  async function focusTab(tabId, windowId) {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
  }
  async function moveTabs(ids, windowId, index = -1) {
    if (windowId === "new") {
      const w = await chrome.windows.create({ tabId: ids[0] });
      if (ids.length > 1) await chrome.tabs.move(ids.slice(1), { windowId: w.id, index: -1 });
      return;
    }
    await chrome.tabs.move(ids, { windowId: Number(windowId), index });
  }
  async function dropTabs(e, target) {
    let data;
    try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }
    const ids = (data && data.tabIds) || [];
    if (!ids.length) return;
    await moveTabs(ids, target.windowId, target.index);
    if (target.groupId !== null && target.groupId !== undefined) await chrome.tabs.group({ tabIds: ids, groupId: target.groupId });
    else await chrome.tabs.ungroup(ids).catch(() => {});
    toast(`Moved ${ids.length} tab${ids.length === 1 ? "" : "s"}`);
  }
  async function groupSelection() {
    const ids = selection();
    if (!ids.length) return;
    const byWindow = new Map();
    for (const w of state.session.windows) for (const t of w.tabs) if (state.selected.has(t.id)) { if (!byWindow.has(w.id)) byWindow.set(w.id, []); byWindow.get(w.id).push(t.id); }
    for (const [windowId, tabIds] of byWindow) await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    toast("Grouped");
  }
  async function forEachSelected(fn) { for (const id of selection()) { try { await fn(id); } catch (e) { console.warn("TabVault action failed", id, e); } } }

  function toast(text) {
    const t = $("toast");
    t.textContent = text; t.classList.add("on");
    clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove("on"), 1800);
  }

  // ---- dialogs (content provided by dialogs.js) -------------------------------------
  const dialogs = {};
  function openDialog(name, arg) {
    const box = $("dialog");
    box.replaceChildren();
    if (!dialogs[name]) return;
    $("dialog-backdrop").hidden = false;
    dialogs[name](box, arg);
  }
  function closeDialog() { $("dialog-backdrop").hidden = true; $("dialog").replaceChildren(); }

  // ---- keyboard ----------------------------------------------------------------------
  function visibleTabs() {
    const rows = [...document.querySelectorAll("#grid .tab")];
    return rows.map((r) => ({ id: Number(r.dataset.tab), windowId: Number(r.dataset.window), el: r }));
  }
  function moveCursor(delta) {
    const rows = visibleTabs();
    if (!rows.length) return;
    let i = rows.findIndex((r) => r.id === state.cursor);
    i = i < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, i + delta));
    state.cursor = rows[i].id;
    render();
    const row = document.querySelector(`.tab[data-tab="${state.cursor}"]`);
    if (row) row.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function moveCursorWindow(delta) {
    const rows = visibleTabs();
    const cur = rows.find((r) => r.id === state.cursor);
    const windows = [...new Set(rows.map((r) => r.windowId))];
    const wi = cur ? windows.indexOf(cur.windowId) : 0;
    const target = windows[Math.max(0, Math.min(windows.length - 1, wi + delta))];
    const first = rows.find((r) => r.windowId === target);
    if (first) { state.cursor = first.id; render(); }
  }
  document.addEventListener("keydown", (e) => {
    const inField = e.target.matches("input, select, textarea");
    if (!$("dialog-backdrop").hidden) { if (e.key === "Escape") closeDialog(); return; }
    if (e.key === "/" && !inField) { e.preventDefault(); $("search").focus(); $("search").select(); return; }
    if (e.key === "Escape") { if (inField) e.target.blur(); state.query = ""; $("search").value = ""; state.selected.clear(); render(); return; }
    if (inField) return;
    if (e.key === "?") { openDialog("help"); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); moveCursor(1); }
    if (e.key === "ArrowUp") { e.preventDefault(); moveCursor(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); moveCursorWindow(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); moveCursorWindow(-1); }
    if (e.key === "Enter" && state.cursor !== null) { const r = visibleTabs().find((x) => x.id === state.cursor); if (r) focusTab(r.id, r.windowId); }
    if (e.key === " " && state.cursor !== null) { e.preventDefault(); state.selected.has(state.cursor) ? state.selected.delete(state.cursor) : state.selected.add(state.cursor); render(); }
    if (e.key === "Delete" && state.selected.size) { chrome.tabs.remove(selection()); }
  });

  // ---- wiring -------------------------------------------------------------------------
  function wire() {
    $("search").addEventListener("input", (e) => { state.query = e.target.value; render(); });
    $("search").addEventListener("keydown", (e) => { if (e.key === "Enter") { const r = visibleTabs()[0]; if (r) focusTab(r.id, r.windowId); } });
    $("move-target").addEventListener("change", async (e) => { const v = e.target.value; if (!v) return; await moveTabs(selection(), v); e.target.value = ""; toast("Moved"); });
    $("sel-group").addEventListener("click", groupSelection);
    $("sel-ungroup").addEventListener("click", () => chrome.tabs.ungroup(selection()));
    $("sel-pin").addEventListener("click", () => forEachSelected((id) => chrome.tabs.update(id, { pinned: true })));
    $("sel-unpin").addEventListener("click", () => forEachSelected((id) => chrome.tabs.update(id, { pinned: false })));
    $("sel-discard").addEventListener("click", () => forEachSelected((id) => chrome.tabs.discard(id)));
    $("sel-close").addEventListener("click", () => chrome.tabs.remove(selection()));
    $("sel-clear").addEventListener("click", clearSelection);
    $("btn-dupes").addEventListener("click", () => openDialog("duplicates"));
    $("btn-export").addEventListener("click", () => openDialog("export"));
    $("btn-import").addEventListener("click", () => $("import-file").click());
    $("import-file").addEventListener("change", async (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) openDialog("import", await f.text()); });
    $("btn-snapshots").addEventListener("click", () => openDialog("snapshots"));
    $("btn-settings").addEventListener("click", () => openDialog("settings"));
    $("btn-help").addEventListener("click", () => openDialog("help"));
    $("dialog-backdrop").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeDialog(); });

    const events = [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onActivated, chrome.tabs.onReplaced, chrome.windows.onCreated, chrome.windows.onRemoved, chrome.windows.onFocusChanged];
    if (chrome.tabGroups) events.push(chrome.tabGroups.onCreated, chrome.tabGroups.onUpdated, chrome.tabGroups.onRemoved, chrome.tabGroups.onMoved);
    for (const ev of events) ev.addListener(scheduleRefresh);
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applySettings);
  }

  window.TabVaultApp = {
    getSession: () => state.session, getSettings: () => state.settings, saveSettings, refresh, openDialog, closeDialog, toast, selection, dialogs, el, focusTab,
  };

  loadSettings().then(refresh).then(wire).catch((e) => { console.error(e); $("grid").textContent = `TabVault could not start: ${e.message || e}`; });
})();
