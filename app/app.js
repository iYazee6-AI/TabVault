(() => {
  const TV = self.TabVault;
  const $ = (id) => document.getElementById(id);
  const OWN_PREFIX = chrome.runtime.getURL("");
  const DEFAULT_SETTINGS = { debounceSeconds: 30, keepSnapshots: 20, ignoreHash: true, theme: "system", showUrls: false, density: "comfortable", lazyRestore: true };
  const THEME_MIRROR = "tabvault.theme"; // read by app/theme-boot.js before first paint
  const GROUP_COLORS = { grey: "#8a8a8a", blue: "#1a73e8", red: "#d93025", yellow: "#f9ab00", green: "#188038", pink: "#d01884", purple: "#a142f4", cyan: "#007b83", orange: "#fa903e" };
  // The picker offers the spec's eight; an existing orange group still renders orange.
  const PICKER_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan"];

  const state = {
    session: { schema: 1, windows: [] },
    settings: { ...DEFAULT_SETTINGS },
    query: "",
    selected: new Set(),
    cursor: null,
    collapsedWindows: new Set(),
    lastClicked: null,
    editing: false,
    confirmClose: null,
    renderPending: false,
    currentWindowId: null,
    colorPickerFor: null,
    dupes: new Set(),
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
    const theme = state.settings.theme === "light" || state.settings.theme === "dark" ? state.settings.theme : "system";
    root.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_MIRROR, theme);
    } catch {
      /* storage unavailable: the next load paints with the System tokens first, then this function applies the chosen theme once chrome.storage.local answers */
    }
    root.dataset.showUrls = String(Boolean(state.settings.showUrls));
    root.dataset.density = state.settings.density;
  }

  async function readSession() {
    const windows = await chrome.windows.getAll({ populate: true });
    const groups = chrome.tabGroups ? await chrome.tabGroups.query({}) : [];
    const { windowNames = {} } = await chrome.storage.local.get("windowNames").catch(() => ({}));
    return TV.buildSession({ windows, groups, now: Date.now(), excludeUrlPrefix: OWN_PREFIX, windowNames });
  }

  let refreshTimer = null;
  async function refresh() {
    const [session, own] = await Promise.all([readSession(), chrome.tabs.getCurrent().catch(() => null)]);
    state.session = session;
    state.currentWindowId = own ? own.windowId : null;
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

  // Every glyph-only button gets the same text as its tooltip and its accessible name.
  function iconButton(glyph, label, onclick, extraClass = "") {
    return el("button", { type: "button", class: extraClass ? `icon ${extraClass}` : "icon", title: label, "aria-label": label, onclick }, glyph);
  }

  function windowTitle(w) {
    const active = w.tabs.find((t) => t.active) || w.tabs[0];
    return active ? active.title || active.url : "(empty)";
  }

  function windowLabel(w) {
    return w.windowName || windowTitle(w);
  }

  function favicon(t, domain) {
    const badge = el("span", { class: "fav letter", style: `--fav:${TV.faviconColor(domain)}`, "aria-hidden": "true" }, TV.faviconLetter(domain));
    if (!t.favIconUrl) return badge;
    const img = el("img", { class: "fav", src: t.favIconUrl, alt: "" });
    img.addEventListener("error", () => img.replaceWith(badge), { once: true });
    return img;
  }

  function tabRow(w, t) {
    const selected = state.selected.has(t.id);
    const domain = TV.domainOf(t.url);
    const row = el("div", {
      class: `tab${selected ? " selected" : ""}${state.cursor === t.id ? " cursor" : ""}${t.active ? " active" : ""}${t.discarded ? " discarded" : ""}`,
      draggable: "true", tabindex: "-1", title: t.url, dataset: { tab: String(t.id), window: String(w.id) },
    });
    const text = el("div", { class: "text" }, el("span", { class: "ttitle" }, t.title || t.url), el("span", { class: "turl" }, t.url));
    const flags = el("span", { class: "flags" });
    if (t.pinned) flags.append(el("span", { class: "flag", title: "Pinned" }, "📌"));
    if (t.audible && !t.muted) flags.append(el("span", { class: "flag", title: "Playing audio" }, "🔊"));
    if (t.muted) flags.append(el("span", { class: "flag", title: "Muted" }, "🔇"));
    if (t.discarded) flags.append(el("span", { class: "flag mono", title: "Unloaded: loads when you open it" }, "zz"));
    if (state.dupes.has(t.id)) flags.append(el("span", { class: "flag mono dup", title: "Duplicate: Find duplicates would close this copy" }, "dup"));
    const check = el("input", { type: "checkbox", "aria-label": `Select ${t.title || t.url}`, checked: selected ? "" : null, onclick: (e) => { e.stopPropagation(); toggleSelect(t.id, e.shiftKey, w); } });
    const close = iconButton("×", "Close tab", (e) => { e.stopPropagation(); chrome.tabs.remove(t.id).catch((err) => toast(`Could not close: ${err.message || err}`)); }, "close");
    row.append(check, favicon(t, domain), text, el("span", { class: "domain mono" }, domain), flags, close);
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
    row.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); row.classList.add("dragover"); });
    row.addEventListener("dragleave", () => row.classList.remove("dragover"));
    row.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); row.classList.remove("dragover"); dropTabs(e, { windowId: w.id, index: t.index, groupId: t.groupId }); });
    return row;
  }

  function groupSection(w, g, tabs) {
    const picking = state.colorPickerFor === g.id;
    const sec = el("div", { class: `group${g.collapsed ? " collapsed" : ""}`, style: `--gcolor:${GROUP_COLORS[g.color] || GROUP_COLORS.grey}`, dataset: { group: String(g.id) } });
    const title = el("span", { class: "gtitle" }, g.title || "(unnamed group)");
    const dot = el("button", {
      type: "button", class: "gdot", title: `Colour: ${g.color}. Click to change`, "aria-label": `Group colour ${g.color}, change`, "aria-expanded": String(picking),
      onclick: () => { state.colorPickerFor = picking ? null : g.id; render(); },
    });
    const head = el("div", { class: "ghead" },
      dot,
      title,
      el("span", { class: "gcount mono", title: `${tabs.length} tabs` }, String(tabs.length)),
      iconButton("✎", "Rename group", () => renameGroup(g, title)),
      iconButton("⊟", "Ungroup", () => chrome.tabs.ungroup(tabs.map((t) => t.id)).catch((e) => toast(`Could not ungroup: ${e.message || e}`))),
      iconButton(g.collapsed ? "▸" : "▾", g.collapsed ? "Expand group" : "Collapse group", () => chrome.tabGroups.update(g.id, { collapsed: !g.collapsed }).catch((e) => toast(`Could not collapse: ${e.message || e}`))));
    sec.append(head);
    if (picking) sec.append(colorPicker(g));
    sec.append(...tabs.map((t) => tabRow(w, t)));
    sec.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); sec.classList.add("drop"); });
    sec.addEventListener("dragleave", () => sec.classList.remove("drop"));
    sec.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); sec.classList.remove("drop"); dropTabs(e, { windowId: w.id, index: -1, groupId: g.id }); });
    return sec;
  }

  function colorPicker(g) {
    return el("div", { class: "swatches", role: "group", "aria-label": "Group colour" },
      ...PICKER_COLORS.map((c) => el("button", {
        type: "button", class: c === g.color ? "swatch on" : "swatch", style: `--sw:${GROUP_COLORS[c]}`,
        title: c, "aria-label": `Colour ${c}`, "aria-pressed": String(c === g.color), dataset: { color: c },
        onclick: () => {
          state.colorPickerFor = null;
          chrome.tabGroups.update(g.id, { color: c }).catch((err) => toast(`Could not recolor: ${err.message || err}`));
          render();
        },
      })));
  }

  function renameGroup(g, titleEl) {
    state.editing = true;
    const input = el("input", { type: "text", value: g.title });
    let settled = false;
    const done = async () => {
      if (settled) return;
      settled = true;
      try {
        await chrome.tabGroups.update(g.id, { title: input.value.trim() });
      } catch (e) {
        toast(`Could not rename: ${(e && e.message) || e}`);
      } finally {
        state.editing = false;
        render();
      }
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") done();
      if (e.key === "Escape") { settled = true; state.editing = false; render(); }
    });
    input.addEventListener("blur", done);
    titleEl.replaceWith(input);
    input.focus(); input.select();
  }

  // Inline rename: Enter or blur saves, Escape cancels. The name lives in
  // chrome.storage.local (see saveWindowName); storage.onChanged refreshes the page.
  function renameWindow(w, nameEl) {
    state.editing = true;
    const input = el("input", { type: "text", class: "wname-edit", value: w.windowName || "", placeholder: windowTitle(w), maxlength: "60", "aria-label": "Window name" });
    let settled = false;
    const finish = async (save) => {
      if (settled) return;
      settled = true;
      try {
        if (save) await saveWindowName(w.id, input.value);
      } catch (e) {
        toast(`Could not rename: ${(e && e.message) || e}`);
      } finally {
        state.editing = false;
        await refresh().catch(console.error);
      }
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    nameEl.replaceWith(input);
    input.focus(); input.select();
  }

  async function saveWindowName(windowId, name) {
    // storage.local, not storage.session: session storage is also wiped on an extension update,
    // reload or disable while the windows stay open. The worker clears the key on browser startup.
    const { windowNames = {} } = await chrome.storage.local.get("windowNames");
    const live = state.session.windows.map((x) => x.id);
    await chrome.storage.local.set({ windowNames: TV.setWindowName(windowNames, windowId, name, live) });
  }

  function windowColumn(w) {
    const dropTarget = w.type === "normal";
    const collapsed = state.collapsedWindows.has(w.id);
    const current = w.id === state.currentWindowId;
    const col = el("section", {
      class: `window${w.incognito ? " incognito" : ""}${collapsed ? " collapsed" : ""}${dropTarget ? "" : " nodrop"}${current ? " current" : ""}`,
      "aria-label": `Window ${windowLabel(w)}`,
      dataset: { window: String(w.id) },
    });
    let head;
    if (state.confirmClose === w.id) {
      const full = state.session.windows.find((x) => x.id === w.id) || w;
      const confirmBtn = el("button", { type: "button", class: "danger", onclick: () => { chrome.windows.remove(w.id).catch((e) => toast(`Could not close: ${e.message || e}`)); state.confirmClose = null; } }, `Close ${full.tabs.length} tabs`);
      const cancel = el("button", { type: "button", onclick: () => { state.confirmClose = null; render(); } }, "Cancel");
      head = el("div", { class: "whead" }, confirmBtn, cancel);
    } else {
      const name = el("span", { class: w.windowName ? "wname" : "wname unnamed", title: windowTitle(w) }, (w.incognito ? "🕶 " : "") + windowLabel(w));
      head = el("div", { class: "whead" },
        iconButton(collapsed ? "▸" : "▾", collapsed ? "Expand window" : "Collapse window", () => { collapsed ? state.collapsedWindows.delete(w.id) : state.collapsedWindows.add(w.id); render(); }),
        name,
        current ? el("span", { class: "tag-current", title: "TabVault is open in this window" }, "CURRENT") : null,
        el("span", { class: "count", title: `${w.tabs.length} tabs` }, String(w.tabs.length)),
        iconButton("✎", "Rename window", () => renameWindow(w, name)),
        iconButton("☑", "Select all in window", () => { for (const t of w.tabs) state.selected.add(t.id); render(); }),
        iconButton("⤴", "Focus window", () => chrome.windows.update(w.id, { focused: true }).catch((e) => toast(`Could not focus: ${e.message || e}`))),
        iconButton("×", "Close window", () => { state.confirmClose = w.id; render(); }, "danger"));
    }
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
    if (dropTarget) {
      col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drop"); });
      col.addEventListener("dragleave", () => col.classList.remove("drop"));
      col.addEventListener("drop", (e) => { e.preventDefault(); col.classList.remove("drop"); dropTabs(e, { windowId: w.id, index: -1, groupId: null }); });
    }
    return col;
  }

  function render() {
    if (state.editing) return;
    const active = document.activeElement;
    if (active && active.tagName === "SELECT" && (active.closest("#grid") || active.closest("#selbar"))) {
      state.renderPending = true;
      return;
    }
    state.renderPending = false;
    const main = $("main");
    const scrollTop = main.scrollTop;
    const filtered = TV.filterSession(state.session, state.query);
    state.dupes = TV.duplicateIds(TV.findDuplicates(state.session, { ignoreHash: state.settings.ignoreHash !== false }));
    const grid = $("grid");
    grid.replaceChildren();
    if (filtered.windows.length === 0) grid.append(emptyState());
    else for (const w of filtered.windows) grid.append(windowColumn(w));
    main.scrollTop = scrollTop;
    $("counts").textContent = TV.formatCounts({
      windows: state.session.windows.length,
      tabs: TV.countTabs(state.session),
      shown: state.query.trim() ? filtered.count : null,
      selected: state.selected.size,
    });
    renderSelbar();
  }

  function clearSearch() {
    state.query = "";
    $("search").value = "";
    render();
  }

  function emptyState() {
    const q = state.query.trim();
    if (q) {
      return el("div", { id: "empty" },
        el("p", {}, "Nothing matches ", el("span", { class: "mono" }, `“${q}”`)),
        el("button", { type: "button", onclick: clearSearch }, "Clear search"));
    }
    return el("div", { id: "empty" },
      el("p", {}, "No other windows are open. TabVault lists every tab except its own."),
      el("div", { class: "links" },
        el("button", { type: "button", onclick: () => openDialog("snapshots") }, "Snapshots"),
        el("button", { type: "button", onclick: () => $("import-file").click() }, "Import")));
  }

  let lastMoveTargetKey = null;
  function renderSelbar() {
    const n = state.selected.size;
    $("selbar").hidden = n === 0;
    $("selcount").textContent = `${n} selected`;
    const key = state.session.windows.map((w) => `${w.id}:${w.tabs.length}:${w.windowName || ""}`).join("|");
    if (key === lastMoveTargetKey) return;
    lastMoveTargetKey = key;
    const sel = $("move-target");
    sel.replaceChildren(el("option", { value: "" }, "Move to…"), el("option", { value: "new" }, "New window"),
      ...state.session.windows.filter((w) => w.type === "normal").map((w) => el("option", { value: String(w.id) }, `${windowLabel(w).slice(0, 40)} (${w.tabs.length})`)));
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
  function windowForTab(id) {
    return state.session.windows.find((w) => w.tabs.some((t) => t.id === id)) || null;
  }
  // Returns true if the move actually happened; false if it was refused (incognito/normal mismatch).
  async function moveTabs(ids, windowId, index = -1) {
    const incognitoFlags = new Set(ids.map((id) => Boolean((windowForTab(id) || {}).incognito)));
    if (incognitoFlags.size > 1) { toast("Cannot move incognito and normal tabs together"); return false; }
    const sourceIncognito = [...incognitoFlags][0] || false;
    if (windowId === "new") {
      const w = await chrome.windows.create({ tabId: ids[0], incognito: sourceIncognito });
      if (ids.length > 1) await chrome.tabs.move(ids.slice(1), { windowId: w.id, index: -1 });
      return true;
    }
    const targetWindow = state.session.windows.find((w) => w.id === Number(windowId));
    if (targetWindow && Boolean(targetWindow.incognito) !== sourceIncognito) { toast("Cannot move tabs between incognito and normal windows"); return false; }
    await chrome.tabs.move(ids, { windowId: Number(windowId), index });
    return true;
  }
  async function dropTabs(e, target) {
    let data;
    try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }
    const ids = (data && data.tabIds) || [];
    if (!ids.length) return;
    try {
      const moved = await moveTabs(ids, target.windowId, target.index);
      if (!moved) return;
      if (target.groupId !== null && target.groupId !== undefined) await chrome.tabs.group({ tabIds: ids, groupId: target.groupId });
      else await chrome.tabs.ungroup(ids).catch(() => {});
      toast(`Moved ${ids.length} tab${ids.length === 1 ? "" : "s"}`);
    } catch (err) {
      console.warn("TabVault move failed", err);
      toast(`Could not move: ${err.message || err}`);
    }
  }
  async function groupSelection() {
    const ids = selection();
    if (!ids.length) return;
    try {
      const byWindow = new Map();
      for (const w of state.session.windows) for (const t of w.tabs) if (state.selected.has(t.id)) { if (!byWindow.has(w.id)) byWindow.set(w.id, []); byWindow.get(w.id).push(t.id); }
      for (const [windowId, tabIds] of byWindow) await chrome.tabs.group({ tabIds, createProperties: { windowId } });
      toast("Grouped");
    } catch (err) {
      console.warn("TabVault group failed", err);
      toast(`Could not group: ${err.message || err}`);
    }
  }
  async function forEachSelected(fn) {
    let failed = 0;
    for (const id of selection()) { try { await fn(id); } catch (e) { failed++; console.warn("TabVault action failed", id, e); } }
    if (failed) toast(`${failed} action${failed === 1 ? "" : "s"} failed; see console`);
  }

  function toast(text) {
    const t = $("toast");
    t.textContent = text; t.classList.add("on");
    clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove("on"), 1800);
  }

  // ---- menus ---------------------------------------------------------------------
  // A menu is a `.menu` element; its trigger button names it with aria-controls.
  function menuButton(menu) {
    return document.querySelector(`[aria-controls="${menu.id}"]`);
  }
  // Closes every open menu; returns whether one was open (Escape uses this).
  function closeMenus(refocus = false) {
    let wasOpen = false;
    for (const menu of document.querySelectorAll(".menu")) {
      if (menu.hidden) continue;
      wasOpen = true;
      menu.hidden = true;
      const button = menuButton(menu);
      if (button) {
        button.setAttribute("aria-expanded", "false");
        if (refocus) button.focus();
      }
    }
    return wasOpen;
  }
  function toggleMenu(menuId, fill) {
    const menu = $(menuId);
    const opening = menu.hidden;
    closeMenus();
    if (!opening) return;
    if (fill) fill(menu);
    menu.hidden = false;
    const button = menuButton(menu);
    if (button) button.setAttribute("aria-expanded", "true");
    const first = menu.querySelector("button");
    if (first) first.focus();
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
    const rows = [...document.querySelectorAll("#grid .tab")].filter((r) => r.offsetParent !== null);
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
    if (e.key === "Escape" && closeMenus(true)) { e.preventDefault(); return; }
    const inField = e.target.matches("input, select, textarea");
    if (!$("dialog-backdrop").hidden) { if (e.key === "Escape") closeDialog(); return; }
    if (e.key === "/" && !inField) { e.preventDefault(); $("search").focus(); $("search").select(); return; }
    if (e.key === "Escape") { if (inField) e.target.blur(); state.query = ""; $("search").value = ""; state.selected.clear(); state.confirmClose = null; render(); return; }
    if (inField) return;
    if (e.key === "?") { openDialog("help"); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); moveCursor(1); }
    if (e.key === "ArrowUp") { e.preventDefault(); moveCursor(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); moveCursorWindow(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); moveCursorWindow(-1); }
    if (e.key === "Enter" && state.cursor !== null) { const r = visibleTabs().find((x) => x.id === state.cursor); if (r) focusTab(r.id, r.windowId); }
    if (e.key === " " && state.cursor !== null) { e.preventDefault(); state.selected.has(state.cursor) ? state.selected.delete(state.cursor) : state.selected.add(state.cursor); render(); }
    if (e.key === "Delete" && state.selected.size) { chrome.tabs.remove(selection()).catch((err) => toast(`Could not close: ${err.message || err}`)); }
  });

  // ---- wiring -------------------------------------------------------------------------
  function wire() {
    $("search").addEventListener("input", (e) => { state.query = e.target.value; render(); });
    $("search").addEventListener("keydown", (e) => { if (e.key === "Enter") { const r = visibleTabs()[0]; if (r) focusTab(r.id, r.windowId); } });
    $("move-target").addEventListener("change", async (e) => {
      const v = e.target.value;
      if (!v) return;
      try {
        const moved = await moveTabs(selection(), v);
        if (moved) toast("Moved");
      } catch (err) {
        console.warn("TabVault move failed", err);
        toast(`Could not move: ${err.message || err}`);
      } finally {
        e.target.value = "";
      }
    });
    $("sel-group").addEventListener("click", groupSelection);
    $("sel-ungroup").addEventListener("click", () => chrome.tabs.ungroup(selection()).catch((e) => toast(`Could not ungroup: ${e.message || e}`)));
    $("sel-pin").addEventListener("click", () => forEachSelected((id) => chrome.tabs.update(id, { pinned: true })));
    $("sel-unpin").addEventListener("click", () => forEachSelected((id) => chrome.tabs.update(id, { pinned: false })));
    $("sel-discard").addEventListener("click", () => forEachSelected((id) => chrome.tabs.discard(id)));
    $("sel-close").addEventListener("click", () => chrome.tabs.remove(selection()).catch((e) => toast(`Could not close: ${e.message || e}`)));
    $("sel-clear").addEventListener("click", clearSelection);
    $("btn-dupes").addEventListener("click", () => openDialog("duplicates"));
    $("btn-export").addEventListener("click", () => openDialog("export"));
    $("btn-import").addEventListener("click", () => $("import-file").click());
    $("import-file").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (!f) return;
      if (f.size > 50 * 1024 * 1024) { toast("File is too large to import (limit 50 MB)"); return; }
      openDialog("import", await f.text());
    });
    $("btn-snapshots").addEventListener("click", () => openDialog("snapshots"));
    $("btn-settings").addEventListener("click", () => openDialog("settings"));
    $("btn-help").addEventListener("click", () => openDialog("help"));
    $("btn-more").addEventListener("click", (e) => { e.stopPropagation(); toggleMenu("more-menu"); });
    $("more-menu").addEventListener("click", () => closeMenus());
    document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) closeMenus(); });
    chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.windowNames) scheduleRefresh(); });
    $("dialog-backdrop").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeDialog(); });

    for (const container of [$("grid"), $("selbar")]) {
      container.addEventListener("change", () => { if (state.renderPending) render(); });
      container.addEventListener("blur", () => { if (state.renderPending) render(); }, true);
    }

    const events = [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onActivated, chrome.tabs.onReplaced, chrome.windows.onCreated, chrome.windows.onRemoved, chrome.windows.onFocusChanged];
    if (chrome.tabGroups) events.push(chrome.tabGroups.onCreated, chrome.tabGroups.onUpdated, chrome.tabGroups.onRemoved, chrome.tabGroups.onMoved);
    for (const ev of events) ev.addListener(scheduleRefresh);

    document.addEventListener("dragend", () => {
      for (const node of document.querySelectorAll(".drop, .dragover")) node.classList.remove("drop", "dragover");
    });
  }

  window.TabVaultApp = {
    getSession: () => state.session, getSettings: () => state.settings, saveSettings, refresh, openDialog, closeDialog, toast, selection, dialogs, el, focusTab,
  };

  loadSettings().then(refresh).then(wire).catch((e) => { console.error(e); $("grid").textContent = `TabVault could not start: ${e.message || e}`; });
})();
