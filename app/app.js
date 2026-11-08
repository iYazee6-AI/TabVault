(() => {
  const TV = self.TabVault;
  const $ = (id) => document.getElementById(id);
  const OWN_PREFIX = chrome.runtime.getURL("");
  const THEME_MIRROR = "tabvault.theme"; // read by app/theme-boot.js before first paint
  const GROUP_COLORS = { grey: "#8a8a8a", blue: "#1a73e8", red: "#d93025", yellow: "#f9ab00", green: "#188038", pink: "#d01884", purple: "#a142f4", cyan: "#007b83", orange: "#fa903e" };
  // The picker offers the spec's eight; an existing orange group still renders orange.
  const PICKER_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan"];

  const state = {
    session: { schema: 1, windows: [] },
    settings: TV.withDefaults({}),
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
    // tab id -> the favIconUrl that failed to load; that tab shows its letter badge until its URL changes.
    failedFavicons: new Map(),
    recent: [],
    recentOpen: false,
    shelves: [],
    shelvesOpen: false,
    openShelves: new Set(),
    confirmDeleteShelf: null,
    // "panel" when loaded as the side panel (?panel=1), else "page".
    layout: new URLSearchParams(location.search).get("panel") === "1" ? "panel" : "page",
    panelSeen: new Set(),
  };

  // ---- data ------------------------------------------------------------------
  async function loadSettings() {
    const { settings = {} } = await chrome.storage.local.get("settings");
    state.settings = TV.withDefaults(settings);
    applySettings();
  }
  async function saveSettings(patch) {
    state.settings = TV.withDefaults({ ...state.settings, ...patch });
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
    root.dataset.layout = state.layout;
  }

  async function readSession() {
    const windows = await chrome.windows.getAll({ populate: true });
    const groups = chrome.tabGroups ? await chrome.tabGroups.query({}) : [];
    const { [TV.WINDOW_NAMES_KEY]: windowNames = {} } = await chrome.storage.local.get(TV.WINDOW_NAMES_KEY).catch(() => ({}));
    return TV.buildSession({ windows, groups, now: Date.now(), excludeUrlPrefix: OWN_PREFIX, windowNames });
  }

  let refreshTimer = null;
  async function refresh() {
    // In the side panel there is no tab of our own: the panel's window is the current one.
    const [session, own, panelWindow] = await Promise.all([
      readSession(),
      chrome.tabs.getCurrent().catch(() => null),
      state.layout === "panel" ? chrome.windows.getCurrent().catch(() => null) : null,
    ]);
    state.session = session;
    state.currentWindowId = own ? own.windowId : panelWindow ? panelWindow.id : null;
    if (state.layout === "panel") {
      // The panel opens on its own window; every other window starts collapsed (once, so a
      // window the user expands stays expanded).
      for (const w of session.windows) {
        if (state.panelSeen.has(w.id)) continue;
        state.panelSeen.add(w.id);
        if (w.id !== state.currentWindowId) state.collapsedWindows.add(w.id);
      }
    }
    const live = new Set(state.session.windows.flatMap((w) => w.tabs.map((t) => t.id)));
    for (const id of state.selected) if (!live.has(id)) state.selected.delete(id);
    for (const id of state.failedFavicons.keys()) if (!live.has(id)) state.failedFavicons.delete(id);
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
    if (!t.favIconUrl || state.failedFavicons.get(t.id) === t.favIconUrl) return badge;
    const img = el("img", { class: "fav", src: t.favIconUrl, alt: "" });
    img.addEventListener("error", () => { state.failedFavicons.set(t.id, t.favIconUrl); img.replaceWith(badge); }, { once: true });
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
    // Rows in a popup or app window (the column's nodrop) take no drops: Chrome refuses the move.
    if (w.type === "normal") {
      row.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); row.classList.add("dragover"); });
      row.addEventListener("dragleave", () => row.classList.remove("dragover"));
      row.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); row.classList.remove("dragover"); dropTabs(e, { windowId: w.id, index: t.index, groupId: t.groupId }); });
    }
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
    if (w.type === "normal") {
      sec.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); sec.classList.add("drop"); });
      sec.addEventListener("dragleave", () => sec.classList.remove("drop"));
      sec.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); sec.classList.remove("drop"); dropTabs(e, { windowId: w.id, index: -1, groupId: g.id }); });
    }
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
    const { [TV.WINDOW_NAMES_KEY]: windowNames = {} } = await chrome.storage.local.get(TV.WINDOW_NAMES_KEY);
    const live = state.session.windows.map((x) => x.id);
    await chrome.storage.local.set({ [TV.WINDOW_NAMES_KEY]: TV.setWindowName(windowNames, windowId, name, live) });
  }

  function windowColumn(w) {
    const dropTarget = w.type === "normal";
    // A search in the panel looks inside collapsed windows too.
    const collapsed = state.collapsedWindows.has(w.id) && !(state.layout === "panel" && state.query.trim());
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
        iconButton("⤓", "Save and close window", () => confirmSaveClose([w.id])),
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
    const rowHadFocus = Boolean(active && active.classList && active.classList.contains("tab"));
    const main = $("main");
    const scrollTop = main.scrollTop;
    const filtered = TV.filterSession(state.session, state.query);
    state.dupes = TV.duplicateIds(TV.findDuplicates(state.session, { ignoreHash: state.settings.ignoreHash !== false }));
    const grid = $("grid");
    grid.replaceChildren();
    if (filtered.windows.length === 0) grid.append(emptyState());
    else {
      const wins = state.layout === "panel"
        ? filtered.windows.slice().sort((a, b) => Number(b.id === state.currentWindowId) - Number(a.id === state.currentWindowId))
        : filtered.windows;
      for (const w of wins) grid.append(windowColumn(w));
    }
    main.scrollTop = scrollTop;
    if (rowHadFocus) focusCursorRow(false);
    $("counts").textContent = TV.formatCounts({
      windows: state.session.windows.length,
      tabs: TV.countTabs(state.session),
      shown: state.query.trim() ? filtered.count : null,
      selected: state.selected.size,
    });
    renderSelbar();
  }

  function focusCursorRow(scroll = true) {
    const row = state.cursor === null ? null : document.querySelector(`.tab[data-tab="${state.cursor}"]`);
    if (!row) return;
    row.focus({ preventScroll: true });
    if (scroll) row.scrollIntoView({ block: "nearest", inline: "nearest" });
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
        el("button", { type: "button", onclick: () => openDialog("import") }, "Import")));
  }

  // Rendered once from the shortcut table; its text reads exactly TV.hintText().
  function renderHints() {
    const parts = [];
    TV.HINTS.forEach(([keys, label], i) => {
      if (i) parts.push(" · ");
      const caps = keys.split(" ").flatMap((k, j) => (j ? [" ", el("kbd", {}, k)] : [el("kbd", {}, k)]));
      if (keys === "?") parts.push(el("button", { type: "button", class: "link", title: "All shortcuts", onclick: () => openDialog("help") }, ...caps, ` ${label}`));
      else parts.push(el("span", {}, ...caps, ` ${label}`));
    });
    $("hints").replaceChildren(...parts);
  }

  // ---- recently closed ---------------------------------------------------------
  // The worker records closed tabs (lib/recent.js); the page lists them under the windows,
  // collapsed by default. Removing and clearing go through the worker so writes never race.
  async function loadRecent() {
    const { [TV.RECENT_KEY]: list = [] } = await chrome.storage.local.get(TV.RECENT_KEY).catch(() => ({}));
    state.recent = Array.isArray(list) ? list : [];
    renderRecent();
  }
  function clockTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  async function reopenEntries(entries, newWindow) {
    const urls = entries.map((e) => e.url);
    try {
      if (newWindow) await chrome.windows.create({ url: urls, focused: false });
      else {
        for (const url of urls) {
          const props = { url, active: state.layout === "panel" };
          if (state.currentWindowId !== null) props.windowId = state.currentWindowId;
          await chrome.tabs.create(props);
        }
      }
      await chrome.runtime.sendMessage({ type: "recentRemove", ids: entries.map((e) => e.id) });
      toast(newWindow ? `Reopened ${urls.length} tab${urls.length === 1 ? "" : "s"} in a new window` : "Reopened");
    } catch (err) {
      toast(`Could not reopen: ${err.message || err}`);
    }
  }
  function recentRow(e) {
    const domain = TV.domainOf(e.url);
    return el("div", { class: "rrow", title: e.url, dataset: { recent: e.id } },
      favicon({ id: `recent-${e.id}`, favIconUrl: e.favIconUrl }, domain),
      el("span", { class: "rtitle" }, e.title || e.url),
      e.groupTitle ? el("span", { class: "when", title: "Group" }, e.groupTitle) : null,
      e.shelf ? el("span", { class: "when shelved", title: "Saved to this shelf, then closed" }, `shelved to ${e.shelf.name}`) : null,
      el("span", { class: "domain mono" }, domain),
      el("span", { class: "when mono", title: new Date(e.closedAt).toLocaleString() }, clockTime(e.closedAt)),
      el("button", { type: "button", class: "reopen", title: "Reopen in this window", onclick: () => reopenEntries([e], false) }, "Reopen"));
  }
  function renderRecent() {
    const list = state.recent;
    const open = state.recentOpen && list.length > 0;
    $("recent").hidden = list.length === 0;
    $("recent-count").textContent = String(list.length);
    $("recent-toggle").setAttribute("aria-expanded", String(open));
    $("recent-toggle").querySelector(".caret").textContent = open ? "▾" : "▸";
    $("recent-list").hidden = !open;
    if (!open) { $("recent-list").replaceChildren(); return; }
    $("recent-list").replaceChildren(...TV.sections(list).flatMap((s) => {
      if (!s.batch) return s.entries.map(recentRow);
      const n = s.entries.length;
      return [el("div", { class: "rbatch", dataset: { batch: s.batch } },
        el("div", { class: "bhead" },
          el("span", { class: "btitle" }, `Window closed · ${n} tab${n === 1 ? "" : "s"}`),
          el("span", { class: "when mono" }, clockTime(s.entries[0].closedAt)),
          el("button", { type: "button", class: "reopen-all", title: "Reopen these tabs in a new window", onclick: () => reopenEntries(s.entries, true) }, "Reopen all")),
        ...s.entries.map(recentRow))];
    }));
  }

  // ---- shelves (1.3) -----------------------------------------------------------
  // Named lists of saved tabs (lib/shelves.js), listed under Recently closed, collapsed by
  // default. The page reads them; every write goes through the worker (shelfRemoveItems,
  // shelfDelete, shelveTabs). Opening an item keeps it on the shelf unless "Open and remove".
  async function loadShelves() {
    const area = chrome.storage.local;
    const metas = await TV.listShelves(area).catch(() => []);
    const out = [];
    for (const m of metas) out.push({ ...m, items: await TV.readShelf(area, m.id).catch(() => []) });
    state.shelves = out;
    renderShelves();
  }
  let shelvesTimer = null;
  function scheduleShelves() { clearTimeout(shelvesTimer); shelvesTimer = setTimeout(() => loadShelves().catch(console.error), 150); }

  // Into this window (the item's group joined or recreated by title and colour), or every item
  // in one new window through the restore path (lazy when lazy restore is on).
  async function openShelfItems(shelf, items, { newWindow = false } = {}) {
    if (newWindow || state.currentWindowId === null) {
      const r = await window.TabVaultApp.restoreSession(TV.shelfToSession(shelf, items), [1], () => {});
      if (r.errors.length) toast(`Opened with errors: ${r.errors[0]}`);
      return;
    }
    const windowId = state.currentWindowId;
    const groups = chrome.tabGroups ? await chrome.tabGroups.query({ windowId }) : [];
    const made = new Map();
    for (const target of TV.groupTargets(items, groups)) {
      const tab = await chrome.tabs.create({ windowId, url: target.item.url, active: false });
      if (!chrome.tabGroups) continue;
      if (target.groupId !== null) { await chrome.tabs.group({ tabIds: [tab.id], groupId: target.groupId }); continue; }
      if (!target.newKey) continue;
      if (made.has(target.newKey)) { await chrome.tabs.group({ tabIds: [tab.id], groupId: made.get(target.newKey) }); continue; }
      const gid = await chrome.tabs.group({ tabIds: [tab.id], createProperties: { windowId } });
      await chrome.tabGroups.update(gid, { title: target.item.group.title, color: target.item.group.color || "grey" });
      made.set(target.newKey, gid);
    }
  }
  async function removeShelfItems(shelf, ids) {
    const r = await chrome.runtime.sendMessage({ type: "shelfRemoveItems", shelfId: shelf.id, itemIds: ids }).catch((e) => ({ ok: false, error: e.message }));
    if (!r || !r.ok) toast(`Could not remove: ${r && r.error}`);
  }
  function shelfRow(shelf, item) {
    const domain = TV.domainOf(item.url);
    const open = (remove) => openShelfItems(shelf, [item]).then(() => (remove ? removeShelfItems(shelf, [item.id]) : null)).then(() => toast(remove ? "Opened and removed from the shelf" : "Opened"), (e) => toast(`Could not open: ${e.message || e}`));
    return el("div", { class: "rrow srow", title: item.url, dataset: { item: item.id } },
      favicon({ id: `shelf-${item.id}`, favIconUrl: item.favIconUrl }, domain),
      el("span", { class: "rtitle" }, item.title || item.url),
      item.group ? el("span", { class: "when", title: "Group" }, item.group.title || "(unnamed group)") : null,
      el("span", { class: "domain mono" }, domain),
      el("span", { class: "when mono", title: new Date(item.savedAt).toLocaleString() }, clockTime(item.savedAt)),
      el("button", { type: "button", class: "s-open", title: "Open in this window; it stays on the shelf", onclick: () => open(false) }, "Open"),
      el("button", { type: "button", class: "s-open-remove", title: "Open in this window and take it off the shelf", onclick: () => open(true) }, "Open and remove"),
      iconButton("×", "Remove from the shelf", () => removeShelfItems(shelf, [item.id]), "s-remove"));
  }
  function renderShelves() {
    const list = state.shelves;
    const open = state.shelvesOpen && list.length > 0;
    $("shelves").hidden = list.length === 0;
    $("shelves-count").textContent = String(list.length);
    $("shelves-toggle").setAttribute("aria-expanded", String(open));
    $("shelves-toggle").querySelector(".caret").textContent = open ? "▾" : "▸";
    $("shelves-list").hidden = !open;
    if (!open) { $("shelves-list").replaceChildren(); return; }
    const rules = state.settings.idleRules || [];
    $("shelves-list").replaceChildren(...list.map((sh) => {
      const n = sh.items.length;
      const expanded = state.openShelves.has(sh.id);
      const from = rules.filter((r) => r.shelfId === sh.id).map((r) => `"${r.pattern}"`);
      const confirming = state.confirmDeleteShelf === sh.id;
      const del = el("button", { type: "button", class: confirming ? "s-delete danger" : "s-delete", title: "Delete this shelf", onclick: async () => {
        if (n && !confirming) { state.confirmDeleteShelf = sh.id; renderShelves(); return; }
        state.confirmDeleteShelf = null;
        const r = await chrome.runtime.sendMessage({ type: "shelfDelete", shelfId: sh.id }).catch((e) => ({ ok: false, error: e.message }));
        if (!r || !r.ok) { toast(`Could not delete: ${r && r.error}`); renderShelves(); } else toast("Shelf deleted");
      } }, confirming ? `Delete ${n} tab${n === 1 ? "" : "s"}?` : "Delete");
      return el("div", { class: "rbatch shelf", dataset: { shelf: sh.id } },
        el("div", { class: "bhead" },
          iconButton(expanded ? "▾" : "▸", expanded ? "Hide the tabs on this shelf" : "Show the tabs on this shelf", () => { expanded ? state.openShelves.delete(sh.id) : state.openShelves.add(sh.id); renderShelves(); }, "s-toggle"),
          el("span", { class: "btitle" }, `${sh.name} · ${n} tab${n === 1 ? "" : "s"}${from.length ? ` · from rule ${from.join(", ")}` : ""}`),
          el("button", { type: "button", class: "s-open-all", disabled: n ? null : "", title: "Open every tab of this shelf in a new window", onclick: () => openShelfItems(sh, sh.items, { newWindow: true }).then(() => toast(`Opened ${n} tab${n === 1 ? "" : "s"}`), (e) => toast(`Could not open: ${e.message || e}`)) }, "Open all"),
          el("button", { type: "button", class: "s-export", onclick: () => openDialog("export", { what: "shelf", shelfId: sh.id }) }, "Export"),
          del),
        ...(expanded ? sh.items.slice().reverse().map((it) => shelfRow(sh, it)) : []));
    }));
  }

  // "Move to shelf…": the selection bar's menu lists the shelves; New shelf asks for a name.
  function fillShelfMenu(menu) {
    menu.replaceChildren(
      ...state.shelves.map((sh) => el("button", { type: "button", role: "menuitem", dataset: { shelf: sh.id } }, sh.name)),
      el("button", { type: "button", role: "menuitem", dataset: { shelf: "new" } }, "New shelf…"));
  }
  async function moveToShelf(tabIds, shelfId) {
    const ids = tabIds.filter((id) => windowForTab(id));
    if (!ids.length) { toast("Select the tabs to shelve first"); return; }
    const r = await chrome.runtime.sendMessage({ type: "shelveTabs", tabIds: ids, shelfId }).catch((e) => ({ ok: false, error: e.message }));
    if (!r || !r.ok) { toast(`Could not shelve: ${r && r.error}`); return; }
    for (const id of ids) state.selected.delete(id);
    toast(r.failed ? `Shelved ${r.shelved}; ${r.failed} could not be saved and stay open` : `Shelved ${r.shelved} tab${r.shelved === 1 ? "" : "s"} and closed ${r.shelved === 1 ? "it" : "them"}`);
  }

  function selectedTabs() {
    return state.session.windows.flatMap((w) => w.tabs).filter((t) => state.selected.has(t.id));
  }

  function renderSelbar() {
    const tabs = selectedTabs();
    const n = state.selected.size;
    $("selbar").hidden = n === 0;
    if (n === 0) {
      $("move-menu").hidden = true;
      $("move-btn").setAttribute("aria-expanded", "false");
      return;
    }
    $("selcount").textContent = `${n} selected`;
    $("sel-pin").textContent = tabs.length && tabs.every((t) => t.pinned) ? "Unpin" : "Pin";
    $("sel-group").textContent = tabs.length && tabs.every((t) => t.groupId !== null) ? "Ungroup" : "Group";
  }

  // Built when the menu opens, so the targets stay put while it is open.
  function fillMoveMenu(menu) {
    const targets = [{ value: "new", label: "New window" }, ...state.session.windows.filter((w) => w.type === "normal").map((w) => ({ value: String(w.id), label: `${windowLabel(w).slice(0, 40)} · ${w.tabs.length}` }))];
    menu.replaceChildren(...targets.map((t) => el("button", { type: "button", role: "menuitem", dataset: { target: t.value } }, t.label)));
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
  // Group reads "Ungroup" when every selected tab is already grouped (renderSelbar).
  function groupOrUngroupSelection() {
    const tabs = selectedTabs();
    if (!tabs.length) return Promise.resolve();
    if (tabs.every((t) => t.groupId !== null)) {
      return chrome.tabs.ungroup(tabs.map((t) => t.id)).then(() => toast("Ungrouped"), (e) => toast(`Could not ungroup: ${e.message || e}`));
    }
    return groupSelection();
  }

  // Pin reads "Unpin" when every selected tab is pinned (renderSelbar).
  function togglePinSelection() {
    const tabs = selectedTabs();
    const pin = !(tabs.length && tabs.every((t) => t.pinned));
    return forEachSelected((id) => chrome.tabs.update(id, { pinned: pin }));
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
  let dialogReturnFocus = null;
  async function openDialog(name, arg) {
    const box = $("dialog");
    box.replaceChildren();
    if (!dialogs[name]) return;
    // A dialog opened from a menu item returns focus to the menu's button, since the item is hidden.
    const from = document.activeElement;
    const fromMenu = from && from.closest ? from.closest(".menu") : null;
    dialogReturnFocus = fromMenu ? menuButton(fromMenu) || from : from;
    closeMenus();
    $("dialog-backdrop").hidden = false;
    await dialogs[name](box, arg);
    const first = box.querySelector("input, select, button");
    if (first && !box.contains(document.activeElement)) first.focus();
  }
  function closeDialog() {
    $("dialog-backdrop").hidden = true;
    $("dialog").replaceChildren();
    const back = dialogReturnFocus;
    dialogReturnFocus = null;
    if (back && back.isConnected && typeof back.focus === "function") back.focus();
    else if (back && !back.isConnected) focusCursorRow(); // a re-render replaced the row the dialog was opened from
  }

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
    focusCursorRow();
  }
  function moveCursorWindow(delta) {
    const rows = visibleTabs();
    const cur = rows.find((r) => r.id === state.cursor);
    const windows = [...new Set(rows.map((r) => r.windowId))];
    const wi = cur ? windows.indexOf(cur.windowId) : 0;
    const target = windows[Math.max(0, Math.min(windows.length - 1, wi + delta))];
    const first = rows.find((r) => r.windowId === target);
    if (first) { state.cursor = first.id; render(); focusCursorRow(); }
  }
  function toggleCursorSelection() {
    // Only a row on screen is acted on, as with Enter: never one hidden by the search or inside a collapsed window or group.
    if (state.cursor === null || !visibleTabs().some((r) => r.id === state.cursor)) return;
    state.selected.has(state.cursor) ? state.selected.delete(state.cursor) : state.selected.add(state.cursor);
    state.lastClicked = state.cursor;
    render();
  }

  const ACTIONS = {
    search: () => { $("search").focus(); $("search").select(); },
    next: () => moveCursor(1),
    prev: () => moveCursor(-1),
    nextWindow: () => moveCursorWindow(1),
    prevWindow: () => moveCursorWindow(-1),
    open: () => {
      if (state.cursor === null) return;
      const r = visibleTabs().find((x) => x.id === state.cursor);
      if (r) focusTab(r.id, r.windowId);
    },
    toggle: toggleCursorSelection,
    group: () => { if (state.selected.size) groupOrUngroupSelection(); },
    dupes: () => openDialog("duplicates"),
    close: () => { if (state.selected.size) chrome.tabs.remove(selection()).catch((err) => toast(`Could not close: ${err.message || err}`)); },
    escape: (e) => {
      // An open group colour picker takes the Escape by itself (a stale id with no picker on screen is just dropped).
      if (state.colorPickerFor !== null) {
        const groupId = state.colorPickerFor;
        const open = document.querySelector("#grid .swatches");
        state.colorPickerFor = null;
        if (open) {
          render();
          const dot = document.querySelector(`.group[data-group="${groupId}"] .gdot`);
          if (dot) dot.focus();
          return;
        }
      }
      if (e.target.matches("input, select, textarea")) e.target.blur();
      state.query = "";
      $("search").value = "";
      state.selected.clear();
      state.confirmClose = null;
      render();
    },
    help: () => openDialog("help"),
    saveClose: () => { const id = thisWindowId(); if (id === null) toast("Move to a tab first (j or k)"); else confirmSaveClose([id]); },
  };

  document.addEventListener("keydown", (e) => {
    if (palette.open) { if (e.key === "Escape") { e.preventDefault(); closePalette(); } return; }
    if (e.key === "Escape" && closeMenus(true)) { e.preventDefault(); return; }
    const openMenu = document.querySelector(".menu:not([hidden])");
    if (openMenu) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...openMenu.querySelectorAll("button")];
        const i = items.indexOf(document.activeElement);
        const next = items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
        if (next) next.focus();
      }
      return; // Enter and Space activate the focused item natively
    }
    if (!$("dialog-backdrop").hidden) { if (e.key === "Escape") closeDialog(); return; }
    // Alt+K opens the command palette (lib/palette.js opensPalette: not while typing in a field
    // other than the search box, where Option+K types a character on macOS).
    const field = { editable: Boolean(e.target && e.target.matches && e.target.matches("input, textarea, select, [contenteditable], [contenteditable] *")), id: e.target && e.target.id };
    if (TV.opensPalette(e, field)) { e.preventDefault(); openPalette(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const s = TV.findShortcut(e.key);
    if (!s || !s.action) return;
    const inField = e.target.matches("input, select, textarea");
    if (inField && s.action !== "escape") return; // typing, including "/" in the search field
    if ((s.action === "open" || s.action === "toggle") && e.target.closest("button")) return; // let the focused button take Enter/Space
    e.preventDefault();
    ACTIONS[s.action](e);
  });

  // ---- save and close ------------------------------------------------------------
  // "This window": the focused row's window when the cursor is on screen, else the window
  // TabVault is in (the page's tab, or the side panel's window).
  function thisWindowId() {
    const r = state.cursor === null ? null : visibleTabs().find((x) => x.id === state.cursor);
    return r ? r.windowId : state.currentWindowId;
  }
  // Opens the confirmation (app/dialogs.js saveClose); nothing closes before its button.
  function confirmSaveClose(windowIds) {
    const wins = state.session.windows.filter((w) => windowIds.includes(w.id));
    const count = wins.reduce((n, w) => n + w.tabs.length, 0);
    if (!count) { toast("Nothing to save in this window"); return; }
    const label = wins.length === 1 ? windowLabel(wins[0]) : "All windows";
    openDialog("saveClose", { windowIds: wins.map((w) => w.id), count, name: TV.snapshotName(label, Date.now()) });
  }

  // ---- command palette (Alt+K) ----------------------------------------------------
  // Actions (lib/shortcuts.js by name plus the commands below) and tabs, ranked by lib/palette.js.
  // The page's own extra commands; each run(e) gets a stand-in event for the shortcut actions.
  const PALETTE_COMMANDS = [
    { id: "snapshot", label: "Snapshot now", run: () => snapshotNow() },
    { id: "discardIdle", label: "Discard idle tabs now", run: () => discardIdleNow() },
    { id: "export", label: "Export", run: () => openDialog("export") },
    { id: "snapshots", label: "Snapshots", run: () => openDialog("snapshots") },
    { id: "compare", label: "Compare latest snapshot with now", run: () => openDialog("compare") },
    { id: "import", label: "Import (file or pasted links)", run: () => openDialog("import") },
    { id: "settings", label: "Settings", run: () => openDialog("settings") },
    { id: "sidePanel", label: "Open side panel", run: () => openSidePanel(), when: () => canOpenPanel() },
    { id: "saveCloseAll", label: "Save and close all windows", run: () => confirmSaveClose(state.session.windows.map((w) => w.id)) },
    { id: "moveToShelf", label: "Move selected tabs to a shelf", run: () => (state.selected.size ? openDialog("moveToShelf", { tabIds: selection() }) : toast("Select the tabs to shelve first")) },
    { id: "shelves", label: "Show shelves", run: () => { state.shelvesOpen = true; renderShelves(); if (state.shelves.length) $("shelves").scrollIntoView({ block: "nearest" }); else toast("No shelves yet: add one with Move to shelf or an idle rule in Settings"); } },
  ];
  const palette = { open: false, rows: [], index: 0, returnFocus: null, confirmAll: false };

  // The side panel (Chrome 116+, the sidePanel permission). chrome.sidePanel.open must run inside
  // the click or key press, so it is called without awaiting anything first.
  function canOpenPanel() {
    return state.layout !== "panel" && Boolean(chrome.sidePanel && chrome.sidePanel.open);
  }
  function openSidePanel() {
    if (!canOpenPanel()) return;
    const target = state.currentWindowId !== null ? { windowId: state.currentWindowId } : null;
    if (!target) { toast("Could not find this window"); return; }
    chrome.sidePanel.open(target).catch((e) => toast("Could not open the side panel: " + (e.message || e)));
  }

  async function snapshotNow() {
    const r = await chrome.runtime.sendMessage({ type: "snapshotNow" }).catch((e) => ({ ok: false, error: e.message }));
    if (r && r.skipped) toast("Nothing to snapshot (no other windows open)");
    else toast(r && r.ok ? "Snapshot saved" : `Snapshot failed: ${r && r.error}`);
  }
  async function discardIdleNow() {
    const r = await chrome.runtime.sendMessage({ type: "discardIdleNow" }).catch((e) => ({ ok: false, error: e.message }));
    if (!r || !r.ok) { toast(`Could not unload: ${r && r.error}`); return; }
    toast(`Unloaded ${r.unloaded} idle tab${r.unloaded === 1 ? "" : "s"}${r.waiting ? `; ${r.waiting} wait for the next run` : ""}`);
  }

  function paletteCommands() {
    return PALETTE_COMMANDS.filter((c) => !c.when || c.when());
  }

  // ---- saved search (1.3) -------------------------------------------------------------
  // The index of everything saved (snapshots, shelves, recently closed) lives in memory only:
  // built on the first palette open of a page load, rebuilt (debounced 1 s) when those keys change.
  const saved = { index: null, dirty: true, building: null, timer: null };
  async function buildSaved() {
    const area = chrome.storage.local;
    const metas = await TV.listSnapshots(area).catch(() => []);
    const keys = metas.map((m) => TV.snapshotKey(m.id));
    const got = keys.length ? await area.get(keys).catch(() => ({})) : {};
    const snapshots = metas.map((m) => got[TV.snapshotKey(m.id)]).filter(Boolean);
    const shelves = [];
    for (const sh of await TV.listShelves(area).catch(() => [])) shelves.push({ ...sh, items: await TV.readShelf(area, sh.id).catch(() => []) });
    saved.index = TV.buildSavedIndex({ snapshots, shelves, recent: state.recent }, { ignoreHash: state.settings.ignoreHash !== false });
    saved.dirty = false;
  }
  function ensureSaved() {
    if (saved.index && !saved.dirty) return Promise.resolve();
    if (!saved.building) saved.building = buildSaved().catch(console.error).finally(() => { saved.building = null; });
    return saved.building;
  }
  function savedChanged() {
    saved.dirty = true;
    if (!saved.index) return; // never built in this page load: the first palette open builds it
    clearTimeout(saved.timer);
    saved.timer = setTimeout(() => ensureSaved().then(() => { if (palette.open) drawPalette(true); }), 1000);
  }

  function paletteRows(query) {
    const { scope, text } = TV.parsePaletteQuery(query);
    const actions = scope === "all" || scope === "actions" ? TV.paletteActions(TV.SHORTCUTS, paletteCommands()) : [];
    const tabs = scope === "all" || scope === "tabs" ? state.session.windows.flatMap((w) => w.tabs.map((tab) => ({ tab, windowId: w.id, windowLabel: windowLabel(w) }))) : [];
    const rows = scope === "saved" ? [] : TV.filterPalette(text, actions, tabs, { domainOf: TV.domainOf });
    if ((scope === "all" || scope === "saved") && saved.index) {
      const found = TV.searchSaved(saved.index, text);
      rows.push(...found);
      if (found.length >= 2) rows.push({ kind: "openAll", entries: found.map((r) => r.entry) });
    }
    return rows;
  }
  function openPalette() {
    if (palette.open) { $("palette-input").select(); return; }
    closeMenus();
    palette.open = true;
    palette.returnFocus = document.activeElement;
    $("palette-backdrop").hidden = false;
    $("palette-input").value = "";
    drawPalette();
    $("palette-input").focus();
    ensureSaved().then(() => { if (palette.open && $("palette-input").value.trim()) drawPalette(true); });
  }
  function closePalette(refocus = true) {
    if (!palette.open) return;
    palette.open = false;
    palette.confirmAll = false;
    $("palette-backdrop").hidden = true;
    $("palette-list").replaceChildren();
    const back = palette.returnFocus;
    palette.returnFocus = null;
    if (refocus && back && back.isConnected && typeof back.focus === "function") back.focus();
  }
  // keep: keep the highlighted row where it is (the saved index arrived after typing).
  function drawPalette(keep = false) {
    const before = keep ? palette.index : 0;
    palette.rows = paletteRows($("palette-input").value);
    palette.index = Math.min(before, Math.max(0, palette.rows.length - 1));
    palette.confirmAll = false;
    renderPaletteList();
  }
  // Title text with the query words in <mark>, built from text nodes (lib/palette.js ranges).
  function markedText(text, cls) {
    const words = TV.terms(TV.parsePaletteQuery($("palette-input").value).text);
    const span = el("span", { class: cls });
    let at = 0;
    for (const [s, e] of TV.highlightRanges(text, words)) {
      if (s > at) span.append(text.slice(at, s));
      span.append(el("mark", {}, text.slice(s, e)));
      at = e;
    }
    if (at < text.length) span.append(text.slice(at));
    return span;
  }
  function renderPaletteList() {
    const list = $("palette-list");
    if (!palette.rows.length) {
      const q = $("palette-input").value.trim();
      list.replaceChildren(el("div", { class: "pempty" }, q && !saved.index ? "Searching saved tabs…" : "No action, tab or saved tab matches."));
      $("palette-input").removeAttribute("aria-activedescendant");
      return;
    }
    const hasSaved = palette.rows.some((r) => r.kind === "saved");
    const nodes = [];
    let shownTabs = false;
    let shownSaved = false;
    palette.rows.forEach((r, i) => {
      if (r.kind === "tab" && hasSaved && !shownTabs) { shownTabs = true; nodes.push(el("div", { class: "psection", role: "presentation" }, "Open tabs")); }
      if (r.kind === "saved" && !shownSaved) { shownSaved = true; nodes.push(el("div", { class: "psection", role: "presentation" }, "Saved")); }
      const on = i === palette.index;
      const attrs = { id: `palette-row-${i}`, class: `prow${on ? " on" : ""}`, role: "option", "aria-selected": String(on), dataset: { kind: r.kind, index: String(i) } };
      if (r.kind === "action") {
        attrs.dataset.action = r.action.id;
        nodes.push(el("div", attrs,
          el("span", { class: "pkind", "aria-hidden": "true" }, "›"),
          markedText(r.action.label, "plabel"),
          el("span", { class: "pkeys" }, ...r.action.keys.map((k) => el("kbd", {}, k)))));
        return;
      }
      if (r.kind === "tab") {
        const domain = TV.domainOf(r.tab.url);
        attrs.dataset.tab = String(r.tab.id);
        nodes.push(el("div", attrs,
          favicon(r.tab, domain),
          markedText(r.tab.title || r.tab.url, "plabel"),
          el("span", { class: "pwin" }, r.windowLabel.slice(0, 30)),
          el("span", { class: "domain mono" }, domain)));
        return;
      }
      if (r.kind === "saved") {
        const e = r.entry;
        const domain = TV.domainOf(e.url);
        attrs.dataset.url = e.url;
        attrs.title = e.url;
        nodes.push(el("div", attrs,
          favicon({ id: `saved-${i}`, favIconUrl: e.favIconUrl }, domain),
          markedText(e.title || e.url, "plabel"),
          el("span", { class: "pwin" }, e.where.label),
          e.count > 1 ? el("span", { class: "polder mono" }, `+${e.count - 1} older`) : null));
        return;
      }
      const n = r.entries.length;
      nodes.push(el("div", attrs,
        el("span", { class: "pkind", "aria-hidden": "true" }, "↳"),
        el("span", { class: "plabel" }, palette.confirmAll ? `Open ${n} tabs? Press Enter again to open them` : `Open all ${n} saved matches in a new window`)));
    });
    list.replaceChildren(...nodes);
    $("palette-input").setAttribute("aria-activedescendant", `palette-row-${palette.index}`);
    const current = list.querySelector(".prow.on");
    if (current) current.scrollIntoView({ block: "nearest" });
  }

  // A saved tab: focus it when the same URL is open, else open it here (or in a new window).
  async function openSaved(entry, newWindow) {
    const ignoreHash = state.settings.ignoreHash !== false;
    const key = TV.normalizeUrl(entry.url, { ignoreHash });
    if (!newWindow) {
      for (const w of state.session.windows) {
        const t = w.tabs.find((x) => TV.normalizeUrl(x.url, { ignoreHash }) === key);
        if (t) { await focusTab(t.id, w.id); return; }
      }
      const props = { url: entry.url, active: true };
      if (state.currentWindowId !== null) props.windowId = state.currentWindowId;
      await chrome.tabs.create(props);
      return;
    }
    await chrome.windows.create({ url: entry.url, focused: true });
  }
  // Every saved match in one new window, unloaded when lazy restore is on (the restore path).
  async function openAllSaved(entries) {
    const session = { schema: 1, windows: [{ id: 1, type: "normal", state: "normal", incognito: false, bounds: { left: 0, top: 0, width: 0, height: 0 }, groups: [], tabs: entries.map((e, i) => ({ id: i + 1, index: i, url: e.url, title: e.title, pinned: false, muted: false, groupId: null })) }] };
    const r = await window.TabVaultApp.restoreSession(session, [1], () => {});
    toast(`Opened ${r.tabs} saved tab${r.tabs === 1 ? "" : "s"} in a new window${r.errors.length ? `; ${r.errors.length} error${r.errors.length === 1 ? "" : "s"}` : ""}`);
  }

  function runPaletteRow(i, { newWindow = false } = {}) {
    const r = palette.rows[i];
    if (!r) return;
    if (r.kind === "openAll" && TV.openAllNeedsConfirm(r.entries.length) && !palette.confirmAll) {
      palette.confirmAll = true;
      renderPaletteList();
      return;
    }
    closePalette(false);
    if (r.kind === "tab") { focusTab(r.tab.id, r.windowId).catch((e) => toast(`Could not open: ${e.message || e}`)); return; }
    if (r.kind === "saved") { openSaved(r.entry, newWindow).catch((e) => toast(`Could not open: ${e.message || e}`)); return; }
    if (r.kind === "openAll") { openAllSaved(r.entries).catch((e) => toast(`Could not open: ${e.message || e}`)); return; }
    const command = PALETTE_COMMANDS.find((c) => c.id === r.action.id);
    const stand = { target: document.body, preventDefault() {} };
    if (command) Promise.resolve(command.run(stand)).catch((e) => toast(`${r.action.label} failed: ${e.message || e}`));
    else if (ACTIONS[r.action.id]) ACTIONS[r.action.id](stand);
  }
  function wirePalette() {
    const input = $("palette-input");
    input.addEventListener("input", drawPalette);
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); closePalette(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!palette.rows.length) return;
        palette.index = (palette.index + (e.key === "ArrowDown" ? 1 : -1) + palette.rows.length) % palette.rows.length;
        renderPaletteList();
        return;
      }
      if (e.key === "Enter") { e.preventDefault(); runPaletteRow(palette.index, { newWindow: e.shiftKey }); }
    });
    $("palette-list").addEventListener("click", (e) => {
      const row = e.target.closest(".prow");
      if (row) runPaletteRow(Number(row.dataset.index));
    });
    $("palette-backdrop").addEventListener("click", (e) => { if (e.target === e.currentTarget) closePalette(); });
    $("btn-palette").addEventListener("click", () => openPalette());
    $("btn-panel").hidden = !canOpenPanel();
    $("btn-panel").addEventListener("click", () => openSidePanel());
  }

  // ---- wiring -------------------------------------------------------------------------
  function wire() {
    renderHints();
    wirePalette();
    $("search").addEventListener("input", (e) => { state.query = e.target.value; render(); });
    $("search").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { const r = visibleTabs()[0]; if (r) focusTab(r.id, r.windowId); }
      if (e.key === "ArrowDown") { e.preventDefault(); $("search").blur(); moveCursor(1); }
    });
    $("move-btn").addEventListener("click", (e) => { e.stopPropagation(); toggleMenu("move-menu", fillMoveMenu); });
    $("move-menu").addEventListener("click", async (e) => {
      const item = e.target.closest("button[data-target]");
      if (!item) return;
      closeMenus();
      try {
        const moved = await moveTabs(selection(), item.dataset.target);
        if (moved) toast("Moved");
      } catch (err) {
        console.warn("TabVault move failed", err);
        toast(`Could not move: ${err.message || err}`);
      }
    });
    $("sel-group").addEventListener("click", () => groupOrUngroupSelection());
    $("sel-pin").addEventListener("click", () => togglePinSelection());
    $("sel-discard").addEventListener("click", () => forEachSelected((id) => chrome.tabs.discard(id)));
    $("shelf-btn").addEventListener("click", (e) => { e.stopPropagation(); toggleMenu("shelf-menu", fillShelfMenu); });
    $("shelf-menu").addEventListener("click", (e) => {
      const item = e.target.closest("button[data-shelf]");
      if (!item) return;
      closeMenus();
      if (item.dataset.shelf === "new") openDialog("moveToShelf", { tabIds: selection() });
      else moveToShelf(selection(), item.dataset.shelf).catch((err) => toast(`Could not shelve: ${err.message || err}`));
    });
    $("shelves-toggle").addEventListener("click", () => { state.shelvesOpen = !state.shelvesOpen; renderShelves(); });
    $("sel-close").addEventListener("click", () => chrome.tabs.remove(selection()).catch((e) => toast(`Could not close: ${e.message || e}`)));
    $("sel-clear").addEventListener("click", clearSelection);
    $("btn-dupes").addEventListener("click", () => openDialog("duplicates"));
    $("btn-export").addEventListener("click", () => openDialog("export"));
    $("btn-import").addEventListener("click", () => openDialog("import"));
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
    $("btn-about").addEventListener("click", () => openDialog("about"));
    $("btn-more").addEventListener("click", (e) => { e.stopPropagation(); toggleMenu("more-menu"); });
    $("more-menu").addEventListener("click", () => closeMenus());
    document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) closeMenus(); });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[TV.WINDOW_NAMES_KEY]) scheduleRefresh();
      if (changes[TV.RECENT_KEY]) loadRecent().catch(console.error);
      if (Object.keys(changes).some((k) => k === TV.SHELF_INDEX_KEY || k.startsWith("shelf:"))) scheduleShelves();
      if (changes.settings) renderShelves();
      if (Object.keys(changes).some((k) => k === TV.RECENT_KEY || k === TV.SNAP_INDEX_KEY || k.startsWith("snap:") || k === TV.SHELF_INDEX_KEY || k.startsWith("shelf:"))) savedChanged();
    });
    $("recent-toggle").addEventListener("click", () => { state.recentOpen = !state.recentOpen; renderRecent(); });
    $("recent-clear").addEventListener("click", () => chrome.runtime.sendMessage({ type: "recentClear" }).then(() => toast("Recently closed cleared"), (e) => toast("Could not clear: " + (e.message || e))));
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
    getSession: () => state.session, getSettings: () => state.settings, saveSettings, refresh, openDialog, closeDialog, toast, selection, dialogs, el, focusTab, windowLabel, openPalette,
    selectTabs: (ids) => { for (const id of ids) state.selected.add(id); render(); },
    moveToShelf, getShelves: () => state.shelves,
  };

  loadSettings().then(refresh).then(wire).then(loadRecent).then(loadShelves).catch((e) => { console.error(e); $("grid").textContent = `TabVault could not start: ${e.message || e}`; });
})();
