// An in-memory stand-in for a chrome.storage area: promise-returning get/set/remove with
// the same key shapes (string, array, object of defaults, null for everything).
// maxBytes: a quota; a set whose result would serialise larger than it throws, like Chrome's.
function fakeArea(initial = {}, { failSetOnce = false, maxBytes = Infinity } = {}) {
  const data = JSON.parse(JSON.stringify(initial));
  let fail = failSetOnce;
  const pick = (keys) => {
    if (keys === null || keys === undefined) return { ...data };
    if (typeof keys === "string") keys = [keys];
    if (Array.isArray(keys)) { const out = {}; for (const k of keys) if (k in data) out[k] = data[k]; return out; }
    const out = {}; for (const [k, d] of Object.entries(keys)) out[k] = k in data ? data[k] : d; return out;
  };
  return {
    data,
    get: async (keys) => JSON.parse(JSON.stringify(pick(keys))),
    set: async (items) => {
      if (fail) { fail = false; throw new Error("QUOTA_BYTES quota exceeded"); }
      if (JSON.stringify({ ...data, ...items }).length > maxBytes) throw new Error("QUOTA_BYTES quota exceeded");
      Object.assign(data, JSON.parse(JSON.stringify(items)));
    },
    remove: async (keys) => { for (const k of [].concat(keys)) delete data[k]; },
  };
}
module.exports = { fakeArea };
