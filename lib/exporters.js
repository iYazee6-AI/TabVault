(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TabVault = Object.assign(root.TabVault || {}, api); }
})(typeof self !== "undefined" ? self : this, function () {
  function pad(n) { return String(n).padStart(2, "0"); }

  function stamp(now) {
    const d = new Date(now);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  function toJsonFile(session, { now = Date.now(), version = "0" } = {}) {
    const payload = { ...session, exportedAt: now, app: { name: "TabVault", version } };
    return { filename: `tabvault-${stamp(now)}.json`, text: JSON.stringify(payload, null, 2) };
  }

  function parseImport(text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error("This file is not valid JSON."); }
    if (!data || typeof data !== "object") throw new Error("This file is not a TabVault export.");
    if (data.schema !== 1) throw new Error(`Unsupported schema version: ${data.schema}. Expected 1.`);
    if (!Array.isArray(data.windows)) throw new Error("The file has no windows array.");
    data.windows.forEach((w, wi) => {
      if (!w || !Array.isArray(w.tabs)) throw new Error(`Window ${wi + 1} has no tabs array.`);
      w.tabs.forEach((t, ti) => {
        if (!t || typeof t.url !== "string" || !t.url) throw new Error(`Window ${wi + 1}, tab ${ti + 1} has no url.`);
      });
      if (!Array.isArray(w.groups)) w.groups = [];
    });
    return data;
  }

  return { toJsonFile, parseImport };
});
