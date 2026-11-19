// TabVault 1.7 "Tidy": the page side of snooze, group rules and the weekly tidy. The decisions
// are in lib/snooze.js, lib/group-rules.js and lib/tidy.js; every write of snoozes, the tidy
// state, the kept list and the log goes through the worker. Text nodes only (el()).
(() => {
  const TV = self.TabVault;
  const App = window.TabVaultApp;
  const { el, toast, closeDialog, openDialog } = App;
  const $ = (id) => document.getElementById(id);
  const OWN_PREFIX = chrome.runtime.getURL("");
  const SWATCH = { grey: "#8a8a8a", blue: "#1a73e8", red: "#d93025", yellow: "#f9ab00", green: "#188038", pink: "#d01884", purple: "#a142f4", cyan: "#007b83", orange: "#fa903e" };
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const whenText = (ts) => new Date(ts).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const send = (msg) => chrome.runtime.sendMessage(msg).catch((e) => ({ ok: false, error: e.message || String(e) }));

  const st = { snoozed: [], open: false, confirmCancel: null, tidyState: null };

  // A datetime-local value (local time) for a timestamp.
  function localInput(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ---- snooze dialog ---------------------------------------------------------------------
  // { tabIds, label }: snooze these tabs. { reschedule: [entry ids], label }: a new wake time.
  // fromTidy: the weekly tidy opened it (logged there, and the tidy opens again after).
  App.dialogs.snooze = (box, { tabIds = [], reschedule = null, label = "", fromTidy = false } = {}) => {
    const n = reschedule ? reschedule.length : tabIds.length;
    const what = label || plural(n, reschedule ? "snoozed tab" : "tab");
    const now = Date.now();
    const err = el("p", { class: "muted", id: "snooze-error" });
    const go = async (wakeAt) => {
      const e = TV.wakeError(wakeAt, Date.now());
      if (e) { err.textContent = e; return; }
      if (!n) { err.textContent = "Select the tabs to snooze first."; return; }
      const r = await send(reschedule ? { type: "snoozeReschedule", ids: reschedule, wakeAt } : { type: "snoozeTabs", tabIds, wakeAt });
      if (!r || !r.ok) { err.textContent = `Could not snooze: ${r && r.error}`; return; }
      closeDialog();
      if (reschedule) { toast(`Wakes ${whenText(wakeAt)}`); return; }
      App.forgetSelected(tabIds);
      if (fromTidy && r.snoozed) await send({ type: "tidyLog", counts: { snoozed: r.snoozed } });
      // notClosed: Chrome kept those tabs open (it refuses while a tab is dragged), so their
      // snooze was taken back; already: a second request for tabs a first one is snoozing.
      const notClosed = r.notClosed ? `${plural(r.notClosed, "tab")} could not close and ${r.notClosed === 1 ? "was" : "were"} not snoozed; try again` : "";
      if (r.snoozed) toast(`Snoozed ${plural(r.snoozed, "tab")} until ${whenText(wakeAt)}${r.skipped ? `; ${r.skipped} not snoozed (not a web page, or private)` : ""}${notClosed ? `; ${notClosed}` : ""}`);
      else if (notClosed) toast(`Not snoozed: ${notClosed}`);
      else if (r.already) toast("Already snoozed");
      else toast("Nothing snoozed: only web pages in normal windows can be snoozed");
      if (fromTidy) openDialog("tidy");
    };
    const choice = (id, title) => el("button", { type: "button", class: "snooze-choice", dataset: { choice: id }, onclick: () => go(TV.wakeTimeFor(id, Date.now())) },
      el("span", {}, title), el("span", { class: "when" }, whenText(TV.wakeTimeFor(id, now))));
    const pick = el("input", { type: "datetime-local", id: "snooze-at", "aria-label": "Wake at", value: localInput(TV.wakeTimeFor("tomorrow", now)) });
    box.replaceChildren(
      el("h2", {}, reschedule ? `Reschedule ${what}` : `Snooze ${what}`),
      el("p", { class: "muted" }, reschedule ? "Pick a new time to open it again." : "It closes now and opens again by itself at the time you pick: in its window if that is still open, else in a new one, with its group and pin. Until then it waits under Snoozed, below your windows."),
      el("div", { class: "snooze-choices" }, choice("later", "Later, in 3 hours"), choice("tomorrow", "Tomorrow morning"), choice("nextWeek", "Next week")),
      el("div", { class: "row" }, el("label", { class: "opt" }, "Pick a date and time ", pick),
        el("button", { type: "button", id: "snooze-pick-go", onclick: () => go(new Date(pick.value).getTime()) }, reschedule ? "Wake then" : "Snooze until then")),
      err,
      el("div", { class: "row" }, el("button", { type: "button", onclick: () => (fromTidy ? openDialog("tidy") : closeDialog()) }, "Cancel")));
    if (!n) err.textContent = "Select the tabs to snooze first.";
  };

  // ---- the Snoozed section -----------------------------------------------------------------
  async function loadSnoozed() {
    st.snoozed = await TV.readSnoozes(chrome.storage.local).catch(() => []);
    renderSnoozed();
  }
  async function wake(ids) {
    const r = await send({ type: "snoozeWake", ids });
    if (!r || !r.ok) { toast(`Could not wake: ${r && r.error}`); return; }
    toast(r.failed ? `Woke ${r.woke}; ${r.failed} could not open (${r.error})` : `Woke ${plural(r.woke, "tab")}`);
  }
  // Cancel promises a copy in Recently closed only when one is really there: recording may be off,
  // or more than RECENT_CAP closes since may have pushed it out (TV.inRecentlyClosed).
  async function hasRecentCopy(e) {
    const got = await chrome.storage.local.get(TV.RECENT_KEY).catch(() => ({}));
    return TV.inRecentlyClosed(e, got[TV.RECENT_KEY]);
  }
  async function cancel(e) {
    const kept = await hasRecentCopy(e);
    const c = st.confirmCancel;
    // First click, or the copy came or went since the question was asked: ask (again) with the truth.
    if (!c || c.id !== e.id || c.kept !== kept) { st.confirmCancel = { id: e.id, kept }; renderSnoozed(); return; }
    st.confirmCancel = null;
    const r = await send({ type: "snoozeCancel", ids: [e.id] });
    if (!r || !r.ok) { toast(`Could not cancel: ${r && r.error}`); return; }
    toast(kept ? "Snooze cancelled; the page is still in Recently closed" : "Snooze cancelled; the page is gone");
  }
  function wakeInstead(e) {
    st.confirmCancel = null;
    renderSnoozed();
    return wake([e.id]);
  }
  function snoozeRow(e) {
    const domain = TV.domainOf(e.url);
    const c = st.confirmCancel && st.confirmCancel.id === e.id ? st.confirmCancel : null;
    const confirming = Boolean(c);
    const onlyCopy = c && !c.kept;
    return el("div", { class: "rrow zrow", title: e.url, dataset: { snooze: e.id } },
      App.favicon({ id: `snooze-${e.id}`, favIconUrl: e.favIconUrl }, domain),
      el("span", { class: "rtitle" }, e.title || e.url),
      e.pinned ? el("span", { class: "when", title: "Comes back pinned" }, "📌") : null,
      e.group ? el("span", { class: "when", title: "Comes back in this group" }, e.group.title || "(unnamed group)") : null,
      el("span", { class: "domain mono" }, domain),
      e.error
        ? el("span", { class: "when failed", title: `Could not wake: ${e.error}` }, `could not wake, tried ${e.attempts} times`)
        : el("span", { class: "when wake mono", title: new Date(e.wakeAt).toLocaleString() }, whenText(e.wakeAt)),
      el("button", { type: "button", class: "z-wake", title: "Open it now", onclick: () => wake([e.id]) }, "Wake now"),
      el("button", { type: "button", class: "z-resched", title: "Pick another time", onclick: () => openDialog("snooze", { reschedule: [e.id], label: `"${(e.title || e.url).slice(0, 40)}"` }) }, "Reschedule"),
      onlyCopy ? el("span", { class: "z-only", title: "Recently closed does not have this page (recording is off, or it was pushed out). Forgetting the snooze loses it." }, "This is the only copy") : null,
      onlyCopy ? el("button", { type: "button", class: "z-wake-instead primary", title: "Open it now instead", onclick: () => wakeInstead(e) }, "Wake instead") : null,
      el("button", { type: "button", class: confirming ? "z-cancel danger" : "z-cancel", title: c && c.kept ? "Forget this snooze without opening the tab (it stays in Recently closed)" : "Forget this snooze without opening the tab", onclick: () => cancel(e) }, onlyCopy ? "Forget it" : confirming ? "Forget it?" : "Cancel"));
  }
  function renderSnoozed() {
    const list = TV.sleeping(st.snoozed).slice().sort((a, b) => a.wakeAt - b.wakeAt);
    const open = st.open && list.length > 0;
    $("snoozed").hidden = list.length === 0;
    $("snoozed-count").textContent = String(list.length);
    $("snoozed-toggle").setAttribute("aria-expanded", String(open));
    $("snoozed-toggle").querySelector(".caret").textContent = open ? "▾" : "▸";
    $("snoozed-list").hidden = !open;
    $("snoozed-list").replaceChildren(...(open ? list.map(snoozeRow) : []));
  }
  App.showSnoozed = () => {
    st.open = true;
    renderSnoozed();
    if (TV.sleeping(st.snoozed).length) $("snoozed").scrollIntoView({ block: "nearest" });
    else toast("Nothing is snoozed: select tabs and press Snooze");
  };
  App.wakeSnoozes = wake;

  // ---- group rules dialog --------------------------------------------------------------------
  App.dialogs.groupRules = (box) => {
    let editing = null; // a rule id, "new", or null
    let draft = null;
    let preview = null; // { moves, leftAlone } from the worker
    let result = null; // { moved, groups, undo }
    let busy = false;
    const rules = () => App.getSettings().groupRules || [];
    const save = (list) => App.saveSettings({ groupRules: list }).then(draw);
    const chip = (name, color) => el("span", { class: "gchip", style: `--chip:${SWATCH[color] || SWATCH.grey}` }, name);

    function editor() {
      const err = el("p", { class: "muted", id: "grule-error" });
      const site = el("input", { type: "text", id: "grule-site", value: draft.site, placeholder: "github.com or *.example.com", "aria-label": "Site", oninput: (e) => { draft.site = e.target.value; } });
      const word = el("input", { type: "text", id: "grule-word", value: draft.titleWord, placeholder: "optional", maxlength: "60", "aria-label": "Title word", oninput: (e) => { draft.titleWord = e.target.value; } });
      const group = el("input", { type: "text", id: "grule-group", value: draft.group, placeholder: "Code", maxlength: "60", "aria-label": "Group name", oninput: (e) => { draft.group = e.target.value; } });
      const color = el("select", { id: "grule-color", "aria-label": "Group colour", onchange: (e) => { draft.color = e.target.value; } },
        ...TV.GROUP_COLORS.map((c) => el("option", { value: c, selected: c === draft.color ? "" : null }, c)));
      const ok = el("button", { type: "button", class: "primary", id: "grule-save", onclick: () => {
        const e = TV.patternError(draft.site);
        if (e) { err.textContent = e; site.focus(); return; }
        if (!draft.group.trim()) { err.textContent = "Name the group."; group.focus(); return; }
        const rule = TV.cleanGroupRule({ ...draft, id: editing === "new" ? TV.ruleId() : editing, site: TV.normalizePattern(draft.site) });
        if (!rule) { err.textContent = "That rule could not be saved."; return; }
        const list = rules();
        const next = editing === "new" ? [...list, rule] : list.map((r) => (r.id === editing ? rule : r));
        editing = null; draft = null; preview = null;
        save(next);
      } }, "Save rule");
      return el("div", { class: "rule-editor" },
        el("div", { class: "row" }, el("label", { class: "opt" }, "Pages of ", site), el("label", { class: "opt" }, "with this word in the title ", word)),
        el("div", { class: "row" }, el("label", { class: "opt" }, "go into the group ", group), el("label", { class: "opt" }, "colour ", color)),
        err,
        el("div", { class: "row" }, ok, el("button", { type: "button", onclick: () => { editing = null; draft = null; draw(); } }, "Cancel")));
    }

    function ruleRow(r, i, list) {
      const move = (d) => { const next = list.slice(); const [x] = next.splice(i, 1); next.splice(i + d, 0, x); save(next); };
      return el("div", { class: "grule", dataset: { rule: r.id } },
        el("input", { type: "checkbox", class: "grule-on", title: "On or off", "aria-label": `Rule for ${r.site} on`, checked: r.enabled ? "" : null, onchange: (e) => save(list.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x))) }),
        el("span", { class: "gsite mono", title: r.site }, `${r.site}${r.titleWord ? ` · title has "${r.titleWord}"` : ""}`),
        el("span", { class: "muted" }, "→"),
        chip(r.group, r.color),
        el("button", { type: "button", class: "small", onclick: () => { editing = r.id; draft = { ...r }; draw(); } }, "Edit"),
        el("button", { type: "button", class: "small", disabled: i ? null : "", title: "Move up (the first match wins)", "aria-label": "Move up", onclick: () => move(-1) }, "↑"),
        el("button", { type: "button", class: "small", disabled: i < list.length - 1 ? null : "", title: "Move down", "aria-label": "Move down", onclick: () => move(1) }, "↓"),
        el("button", { type: "button", class: "small danger", onclick: () => save(list.filter((x) => x.id !== r.id)) }, "Delete"));
    }

    function runBlock() {
      const out = [];
      const run = el("button", { type: "button", id: "grules-run", disabled: rules().some((r) => r.enabled) && !busy ? null : "", onclick: async () => {
        busy = true; result = null;
        const r = await send({ type: "groupRulesPlan" });
        busy = false;
        if (!r || !r.ok) { toast(`Could not plan: ${r && r.error}`); return; }
        preview = r;
        draw();
      } }, "Run rules on open tabs now…");
      out.push(el("div", { class: "row" }, run, el("span", { class: "muted" }, "Shows what would move first.")));
      if (preview) {
        const n = preview.moves.length;
        const lines = preview.moves.map((m) => el("div", { class: "crow", dataset: { tab: String(m.tabId) } },
          el("span", { class: "ctitle", title: m.url }, m.title), el("span", { class: "muted" }, "→"), chip(m.group, m.color)));
        const apply = el("button", { type: "button", class: "primary", id: "grules-apply", disabled: n ? null : "", onclick: async () => {
          apply.disabled = true;
          const r = await send({ type: "groupRulesApply", tabIds: preview.moves.map((m) => m.tabId) });
          if (!r || !r.ok) { toast(`Could not apply: ${r && r.error}`); apply.disabled = false; return; }
          preview = null; result = r;
          draw();
        } }, n ? `Move ${plural(n, "tab")}` : "Nothing to move");
        out.push(el("p", { class: "muted", id: "grules-preview-line" }, `${n ? `${plural(n, "tab")} would move` : "No open tab would move"}${preview.leftAlone ? `; ${preview.leftAlone} left alone because you took ${preview.leftAlone === 1 ? "it" : "them"} out of a group` : ""}.`),
          el("div", { class: "list", id: "grules-preview" }, ...lines),
          el("div", { class: "row" }, apply, el("button", { type: "button", onclick: () => { preview = null; draw(); } }, "Cancel")));
      }
      if (result) {
        const undo = el("button", { type: "button", id: "grules-undo", disabled: result.undo.length ? null : "", onclick: async () => {
          undo.disabled = true;
          const r = await send({ type: "groupRulesUndo", undo: result.undo });
          result = null;
          toast(r && r.ok ? `Put ${plural(r.restored, "tab")} back` : `Could not undo: ${r && r.error}`);
          draw();
        } }, "Undo");
        out.push(el("div", { class: "row" }, el("span", { id: "grules-result" }, `Moved ${plural(result.moved, "tab")} into ${plural(result.groups, "group")}${result.failed ? `; ${result.failed} could not move` : ""}.`), undo));
      }
      return out;
    }

    function draw() {
      const list = rules();
      box.replaceChildren(
        el("h2", {}, "Group rules"),
        el("p", { class: "muted" }, "A new or navigated tab whose site matches a rule goes into that group in its window. The first matching rule wins. A rule never moves a pinned tab or a tab already in a group, and a tab you take out of a group is left alone until it goes to another site."),
        el("div", { class: "rules", id: "grules-list" }, ...(list.length ? list.map((r, i) => (editing === r.id ? editor() : ruleRow(r, i, list))) : [el("p", { class: "muted" }, "No rules yet, so nothing is grouped by itself.")])),
        editing === "new" ? editor() : el("div", { class: "row" }, el("button", { type: "button", id: "grules-add", onclick: () => { editing = "new"; draft = { site: "", titleWord: "", group: "", color: "blue", enabled: true }; draw(); } }, "Add a rule")),
        el("h3", {}, "Your open tabs"),
        ...runBlock(),
        el("p", { class: "muted" }, "The rules travel with Export (JSON, this session) and come back with Import."),
        el("div", { class: "row" }, el("button", { type: "button", onclick: closeDialog }, "Close")));
      const first = box.querySelector("#grule-site");
      if (first) first.focus();
    }
    draw();
  };

  // ---- the weekly tidy ---------------------------------------------------------------------
  const SECTIONS = [
    { key: "woken", title: () => "Woke from snooze, not looked at" },
    { key: "duplicates", title: () => "Duplicates" },
    { key: "stale", title: (s) => `Not visited for ${s.tidy.idleDays} days` },
    { key: "lonely", title: () => "Groups with one tab" },
  ];

  App.dialogs.tidy = async (box) => {
    await App.refresh().catch(() => {});
    const picked = Object.fromEntries(SECTIONS.map((s) => [s.key, new Set()]));
    let sections = null;
    let weekLine = "";
    let closed = null; // { shelfId, shelfName, urls, since, count }

    // window.tidyClockOffset: the e2e harness moves the tidy clock with it; nothing else sets it.
    async function load() {
      const settings = App.getSettings();
      const got = await chrome.storage.local.get([TV.TIDY_KEPT_KEY, TV.TIDY_LOG_KEY, TV.SNOOZE_KEY]).catch(() => ({}));
      sections = TV.tidySections(App.getSession(), {
        now: Date.now() + (Number(window.tidyClockOffset) || 0), idleDays: settings.tidy.idleDays, ignoreHash: settings.ignoreHash !== false,
        kept: got[TV.TIDY_KEPT_KEY] || {}, woken: TV.woken(got[TV.SNOOZE_KEY] || []), ownPrefix: OWN_PREFIX,
      });
      weekLine = TV.weekLine(got[TV.TIDY_LOG_KEY] || [], Date.now());
      for (const s of SECTIONS) {
        const live = new Set(sections[s.key].map((x) => x.tabId));
        for (const id of picked[s.key]) if (!live.has(id)) picked[s.key].delete(id);
      }
    }

    async function again() { await App.refresh().catch(() => {}); await load(); draw(); }

    async function closeIntoVault(key) {
      const items = sections[key].filter((x) => picked[key].has(x.tabId));
      if (!items.length) return;
      const since = Date.now();
      const r = await send({ type: "tidyClose", tabIds: items.map((x) => x.tabId) });
      if (!r || !r.ok) { toast(`Could not close: ${r && r.error}`); return; }
      closed = { shelfId: r.shelfId, shelfName: r.shelfName, urls: new Set(items.map((x) => x.url)), since, count: r.shelved };
      picked[key].clear();
      if (r.failed) toast(`${r.failed} could not be saved and stay open`);
      else if (r.refused) toast(`${plural(r.refused, "private (incognito) tab")} left open: the tidy never stores those`);
      await again();
    }
    async function keep(key) {
      const items = sections[key].filter((x) => picked[key].has(x.tabId));
      if (!items.length) return;
      const r = await send({ type: "tidyKeep", urls: items.map((x) => x.url), entryIds: items.map((x) => x.entryId).filter(Boolean) });
      if (!r || !r.ok) { toast(`Could not keep: ${r && r.error}`); return; }
      picked[key].clear();
      toast(`Kept ${plural(items.length, "tab")}: left out of the tidy for 30 days`);
      await again();
    }
    async function ungroup(key) {
      const items = sections[key].filter((x) => picked[key].has(x.tabId));
      if (!items.length) return;
      try { await chrome.tabs.ungroup(items.map((x) => x.tabId)); } catch (e) { toast(`Could not ungroup: ${e.message || e}`); return; }
      await send({ type: "tidyLog", counts: { ungrouped: items.length } });
      picked[key].clear();
      await again();
    }
    async function restore() {
      const shelves = await TV.listShelves(chrome.storage.local).catch(() => []);
      const shelf = shelves.find((s) => s.id === closed.shelfId);
      if (!shelf) { toast("That shelf is gone"); return; }
      const items = (await TV.readShelf(chrome.storage.local, shelf.id)).filter((it) => it.savedAt >= closed.since - 1000 && closed.urls.has(it.url));
      if (!items.length) { toast("Nothing left to restore"); return; }
      await App.openShelfItems(shelf, items);
      await App.removeShelfItems(shelf, items.map((it) => it.id));
      toast(`Restored ${plural(items.length, "tab")}`);
      closed = null;
      await again();
    }

    function row(key, x) {
      const domain = TV.domainOf(x.url);
      let where = null;
      if (key === "stale") where = el("span", { class: "cwhere muted" }, `${x.days} days`);
      if (key === "lonely") where = el("span", { class: "cwhere gchip", style: `--chip:${SWATCH[x.group.color] || SWATCH.grey}` }, x.group.title || "(unnamed group)");
      if (key === "woken") where = el("span", { class: "cwhere muted" }, `woke ${whenText(x.wokeAt)}`);
      return el("label", { class: "crow", title: x.url, dataset: { tab: String(x.tabId) } },
        el("input", { type: "checkbox", checked: picked[key].has(x.tabId) ? "" : null, onchange: (e) => { e.target.checked ? picked[key].add(x.tabId) : picked[key].delete(x.tabId); draw(); } }),
        App.favicon({ id: `tidy-${x.tabId}`, favIconUrl: x.favIconUrl }, domain),
        el("span", { class: "ctitle" }, x.title),
        where,
        el("span", { class: "domain mono" }, domain));
    }

    function section(def, settings) {
      const list = sections[def.key];
      const sel = picked[def.key];
      const n = sel.size;
      const all = el("input", { type: "checkbox", class: "t-all", "aria-label": "Select all", checked: list.length && n === list.length ? "" : null, disabled: list.length ? null : "", onchange: (e) => { for (const x of list) e.target.checked ? sel.add(x.tabId) : sel.delete(x.tabId); draw(); } });
      const act = (label, cls, fn) => el("button", { type: "button", class: `small ${cls}`, disabled: n ? null : "", onclick: fn }, label);
      return el("section", { class: "tidy-sec", dataset: { section: def.key } },
        el("h3", {}, el("label", { class: "opt" }, all, ` ${def.title(settings)}`), el("span", { class: "n" }, String(list.length))),
        ...(list.length ? list.map((x) => row(def.key, x)) : [el("p", { class: "muted" }, "Nothing here.")]),
        list.length ? el("div", { class: "row" },
          act(n ? `Close ${n} into the vault` : "Close into the vault", "t-close", () => closeIntoVault(def.key)),
          act("Snooze…", "t-snooze", () => openDialog("snooze", { tabIds: [...sel], fromTidy: true })),
          act("Keep", "t-keep", () => keep(def.key)),
          def.key === "lonely" ? act("Ungroup", "t-ungroup", () => ungroup(def.key)) : null) : null);
    }

    function settingsBlock(settings) {
      const t = settings.tidy;
      const weekly = el("input", { type: "checkbox", id: "tidy-weekly", checked: t.weekly ? "" : null, onchange: (e) => App.saveSettings({ tidy: { ...App.getSettings().tidy, weekly: e.target.checked } }) });
      const days = el("select", { id: "tidy-days", "aria-label": "Not visited for", onchange: async (e) => { await App.saveSettings({ tidy: { ...App.getSettings().tidy, idleDays: Number(e.target.value) } }); await again(); } },
        ...TV.TIDY_DAYS.map((d) => el("option", { value: String(d), selected: d === t.idleDays ? "" : null }, `${d} days`)));
      // The notification needs Chrome's optional notifications permission, asked inside this
      // change event (nothing awaited first) and given back when the switch goes off.
      const notify = el("input", { type: "checkbox", id: "tidy-notify", checked: t.notify ? "" : null });
      notify.addEventListener("change", () => {
        const on = notify.checked;
        if (on) {
          chrome.permissions.request({ permissions: ["notifications"] }).then((granted) => {
            if (!granted) { notify.checked = false; toast("Chrome did not allow notifications; the tidy will wait quietly in the page"); return null; }
            return App.saveSettings({ tidy: { ...App.getSettings().tidy, notify: true } });
          }).catch((e) => { notify.checked = false; toast(`Could not ask: ${e.message || e}`); });
        } else {
          App.saveSettings({ tidy: { ...App.getSettings().tidy, notify: false } })
            .then(() => chrome.permissions.remove({ permissions: ["notifications"] }).catch(() => false));
        }
      });
      return [
        el("h3", {}, "Settings"),
        el("label", { class: "row" }, weekly, " Remind me once a week, with a bar on this page"),
        el("label", { class: "row" }, "Not visited means ", days),
        el("label", { class: "row" }, notify, " Also tell me with a notification (Chrome asks once)"),
      ];
    }

    function draw() {
      const settings = App.getSettings();
      const total = SECTIONS.reduce((a, s) => a + sections[s.key].length, 0);
      box.replaceChildren(...[
        el("h2", {}, "Tidy"),
        el("p", { class: "muted" }, total
          ? "Nothing here closes by itself. Tick what you are done with: Close into the vault keeps each page on a shelf, one click from coming back."
          : "All tidy: nothing stale, no duplicates, no lonely groups."),
        closed ? el("div", { class: "row", id: "tidy-closed" },
          el("span", {}, `Closed ${plural(closed.count, "tab")} into the vault (shelf "${closed.shelfName}").`),
          el("button", { type: "button", class: "small", id: "tidy-restore", onclick: () => restore() }, "Restore")) : null,
        ...SECTIONS.map((s) => section(s, settings)),
        el("p", { class: "week-line", id: "tidy-week" }, weekLine),
        ...settingsBlock(settings),
        el("div", { class: "row" },
          el("button", { type: "button", class: "primary", id: "tidy-done", onclick: async () => { await send({ type: "tidyDone" }); closeDialog(); toast("Tidy done; the next one is in a week"); } }, "Done for this week"),
          el("button", { type: "button", onclick: closeDialog }, "Close")),
      ].filter(Boolean)); // replaceChildren would write a null as the text "null"
    }

    await load();
    draw();
  };

  // ---- the weekly bar --------------------------------------------------------------------------
  async function loadTidyState() {
    // The stored settings, not the page's copy: this can run before the page has loaded them.
    const got = await chrome.storage.local.get([TV.TIDY_STATE_KEY, "settings"]).catch(() => ({}));
    st.tidyState = got[TV.TIDY_STATE_KEY] || null;
    const s = st.tidyState;
    $("tidy-bar").hidden = !(TV.withDefaults(got.settings).tidy.weekly && s && typeof s.dueAt === "number");
  }
  App.openTidy = () => openDialog("tidy");

  $("btn-tidy").addEventListener("click", () => openDialog("tidy"));
  $("btn-group-rules").addEventListener("click", () => openDialog("groupRules"));
  $("tidy-open").addEventListener("click", () => openDialog("tidy"));
  $("tidy-later").addEventListener("click", () => send({ type: "tidyDone" }).then(() => toast("The tidy waits another week")));
  $("snoozed-toggle").addEventListener("click", () => { st.open = !st.open; renderSnoozed(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[TV.SNOOZE_KEY]) loadSnoozed().catch(console.error);
    if (changes[TV.TIDY_STATE_KEY] || changes.settings) loadTidyState().catch(console.error);
  });
  loadSnoozed().catch(console.error);
  loadTidyState().catch(console.error);
  // ?tidy=1: the weekly notification opened this page.
  if (new URLSearchParams(location.search).get("tidy") === "1") setTimeout(() => openDialog("tidy"), 300);
})();
