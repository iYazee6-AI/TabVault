const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { fakeArea } = require("./fake-storage.js");
const { fakeBookmarks } = require("./fake-bookmarks.js");
const B = require("../lib/bookmarks.js");

function never(fb) {
  assert.deepEqual(fb.calls.remove, [], "bookmarks.remove must never be called");
  assert.deepEqual(fb.calls.removeTree, [], "bookmarks.removeTree must never be called");
}

function sample() {
  const fb = fakeBookmarks();
  const work = fb.folder("1", "Work");
  const a = fb.link(work, "Alpha docs", "https://a.example.com/docs#intro");
  const b = fb.link(work, "Beta", "https://b.example.com/");
  const sub = fb.folder(work, "Deep");
  const c = fb.link(sub, "Gamma", "https://c.example.com/x");
  const d = fb.link("2", "Alpha again", "https://a.example.com/docs");
  const js = fb.link("2", "A bookmarklet", "javascript:void(0)");
  return { fb, work, a, b, sub, c, d, js };
}

// ---- THE RULE: TabVault never deletes a bookmark ---------------------------------------------

test("the rule: safeBookmarks hands out no remove and no removeTree", () => {
  const { fb } = sample();
  const safe = B.safeBookmarks(fb.api);
  assert.equal(safe.remove, undefined);
  assert.equal(safe.removeTree, undefined);
  assert.ok(Object.isFrozen(safe));
  assert.deepEqual(Object.keys(safe).sort(), B.SAFE_METHODS.filter((m) => fb.api[m]).sort());
  assert.ok(!B.SAFE_METHODS.includes("remove") && !B.SAFE_METHODS.includes("removeTree"));
});

test("the rule: no source file calls bookmarks.remove or removeTree", () => {
  const root = path.join(__dirname, "..");
  // Everything the extension ships and runs (what tools/pack.js packs). The e2e harness is left
  // out: it replaces remove and removeTree with counting stubs to prove they are never called.
  const files = [path.join(root, "background.js")];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".js") || name.endsWith(".html")) files.push(p);
    }
  };
  walk(path.join(root, "app"));
  walk(path.join(root, "lib"));
  assert.ok(files.some((f) => f.endsWith("bookmarks.js")));
  const bad = [];
  for (const f of files) {
    // Code only: whole-line comments (which may name the forbidden calls to explain the rule) are left out.
    const text = fs.readFileSync(f, "utf8").replace(/^[ ]*[/][/].*$/gm, "").replace(/[/][*][^]*?[*][/]/g, "");
    if (/removeTree/.test(text.replace(/"removeTree"/g, ""))) bad.push(`${f}: removeTree`);
    if (/bookmarks[)\]]*\s*\.\s*remove\b/.test(text)) bad.push(`${f}: bookmarks.remove`);
    if (/\[\s*["'`]remove(Tree)?["'`]\s*\]/.test(text)) bad.push(`${f}: ["remove"]`);
  }
  assert.deepEqual(bad, []);
});

test("delete is a move: one bookmark goes to Deleted under Other bookmarks, keeps its title and address, and its origin is stored", async () => {
  const { fb, work, a } = sample();
  const area = fakeArea();
  const r = await B.moveToDeleted(fb.api, area, [a], { now: 42 });
  never(fb);
  assert.equal(r.moved, 1);
  const del = r.deletedFolderId;
  assert.equal(fb.parentOf(del), "2");
  assert.equal(fb.titleOf(del), "Deleted");
  assert.equal(fb.parentOf(a), del);
  assert.equal(fb.titleOf(a), "Alpha docs");
  assert.equal(fb.urlOf(a), "https://a.example.com/docs#intro");
  const trash = await B.readTrash(area);
  assert.deepEqual(trash[a], { id: a, title: "Alpha docs", url: "https://a.example.com/docs#intro", parentId: work, index: 0, path: ["Bookmarks bar", "Work"], movedAt: 42 });
  assert.equal(area.data[B.DELETED_ID_KEY], del);
  assert.equal(r.backup, null, "one bookmark takes no backup");
});

test("the Deleted folder is found by its stored id (even renamed), then by name, and made again when the user deleted it", async () => {
  const { fb, a, b, c } = sample();
  const area = fakeArea();
  const first = (await B.moveToDeleted(fb.api, area, [a])).deletedFolderId;
  await fb.api.update(first, { title: "Bin" });
  assert.equal((await B.moveToDeleted(fb.api, area, [b])).deletedFolderId, first);
  // the stored id is gone: found by name
  const byName = fb.folder("2", "Deleted");
  fb.userDelete(first);
  assert.equal((await B.moveToDeleted(fb.api, area, [c])).deletedFolderId, byName);
  assert.equal(area.data[B.DELETED_ID_KEY], byName);
  // gone entirely (the user emptied and deleted it): made again
  fb.userDelete(byName);
  const again = await B.ensureDeletedFolder(B.safeBookmarks(fb.api), area);
  assert.notEqual(again.id, byName);
  assert.equal(fb.parentOf(again.id), "2");
  never(fb);
});

test("a folder moves whole; its own children in the same call are not moved twice; top folders and Deleted itself are refused", async () => {
  const { fb, work, a, c } = sample();
  const area = fakeArea();
  const r = await B.moveToDeleted(fb.api, area, [work, a, c, "1", "2"]);
  never(fb);
  assert.equal(r.moved, 1);
  assert.equal(fb.parentOf(work), r.deletedFolderId);
  assert.equal(fb.parentOf(a), work, "a stays inside its folder");
  assert.deepEqual(r.skipped.sort(), ["1", "2", a, c].sort());
  const again = await B.moveToDeleted(fb.api, area, [r.deletedFolderId, work]);
  assert.equal(again.moved, 0, "Deleted itself and what is already in it are skipped");
  never(fb);
});

test("more than 10 bookmarks moved take a backup first; a failed backup moves nothing", async () => {
  const fb = fakeBookmarks();
  const f = fb.folder("1", "Lots");
  const ids = Array.from({ length: 11 }, (_, i) => fb.link(f, `L${i}`, `https://l.example.com/${i}`));
  const area = fakeArea();
  const r = await B.moveToDeleted(fb.api, area, ids, { now: 7, keep: 5 });
  assert.equal(r.moved, 11);
  assert.ok(r.backup && r.backup.reason === "before-delete");
  assert.equal((await B.listBackups(area))[0].id, r.backup.id);
  const read = await B.readBackup(area, r.backup.id);
  assert.equal(read.nodes.filter((n) => n.url).length, 11, "the backup was taken before the move");

  const fb2 = fakeBookmarks();
  const f2 = fb2.folder("1", "Lots");
  const ids2 = Array.from({ length: 11 }, (_, i) => fb2.link(f2, `L${i}`, `https://l.example.com/${i}`));
  const area2 = fakeArea();
  await B.ensureDeletedFolder(B.safeBookmarks(fb2.api), area2);
  const broken = { ...area2, set: async (items) => { if (Object.keys(items).some((k) => k.startsWith("bmBackup:"))) throw new Error("QUOTA_BYTES quota exceeded"); return area2.set(items); } };
  await assert.rejects(() => B.moveToDeleted(fb2.api, broken, ids2), /backup could not be written/);
  assert.ok(ids2.every((id) => fb2.parentOf(id) === f2), "nothing moved");
  assert.deepEqual(fb2.calls.move, []);
  never(fb2);
});

test("a move that fails keeps that bookmark where it was and drops its origin record", async () => {
  // the fake numbers new nodes from 100: Work 100, A 101, B 102, C 103; moving 103 fails
  const fb = fakeBookmarks({ failMoveFor: ["103"] });
  const work = fb.folder("1", "Work");
  const a = fb.link(work, "A", "https://a.example.com/");
  fb.link(work, "B", "https://b.example.com/");
  const c = fb.link(work, "C", "https://c.example.com/");
  assert.equal(c, "103");
  const area = fakeArea();
  const r = await B.moveToDeleted(fb.api, area, [a, c]);
  assert.equal(r.moved, 1);
  assert.equal(r.failed.length, 1);
  assert.equal(fb.parentOf(c), work);
  const trash = await B.readTrash(area);
  assert.ok(trash[a] && !trash[c]);
  never(fb);
});

test("origin records are pruned once the user empties Deleted or moves an item back", async () => {
  const { fb, a, b } = sample();
  const area = fakeArea();
  const del = (await B.moveToDeleted(fb.api, area, [a, b])).deletedFolderId;
  fb.userDelete(a);
  await fb.api.move(b, { parentId: "1" });
  const c = fb.link("1", "C", "https://c2.example.com/");
  await B.moveToDeleted(fb.api, area, [c]);
  const trash = await B.readTrash(area);
  assert.deepEqual(Object.keys(trash), [c]);
  assert.equal(fb.parentOf(c), del);
  never(fb);
});

// ---- save tabs as a bookmark folder ----------------------------------------------------------

test("tabs are saved as a folder inside TabVault under Other bookmarks; links that are not web pages are skipped", async () => {
  const fb = fakeBookmarks();
  const area = fakeArea();
  const tabs = [
    { title: "One", url: "https://one.example.com/" },
    { title: "", url: "https://two.example.com/" },
    { title: "Settings", url: "chrome://settings" },
    { title: "Script", url: "javascript:alert(1)" },
    { title: "Local", url: "file:///C:/notes.txt" },
  ];
  const r = await B.saveTabsAsFolder(fb.api, area, { name: "  Research  ", tabs });
  assert.equal(r.saved, 3);
  assert.equal(r.skipped, 2);
  assert.equal(r.title, "Research");
  const tv = fb.parentOf(r.folderId);
  assert.equal(fb.titleOf(tv), "TabVault");
  assert.equal(fb.parentOf(tv), "2");
  assert.deepEqual(fb.childrenOf(r.folderId).map((id) => [fb.titleOf(id), fb.urlOf(id)]), [["One", "https://one.example.com/"], ["https://two.example.com/", "https://two.example.com/"], ["Local", "file:///C:/notes.txt"]]);
  // a second save reuses the TabVault folder
  const r2 = await B.saveTabsAsFolder(fb.api, area, { name: "Research", tabs: tabs.slice(0, 1) });
  assert.equal(fb.parentOf(r2.folderId), tv);
  await assert.rejects(() => B.saveTabsAsFolder(fb.api, area, { name: "x", tabs: tabs.slice(2, 4) }), /not a web page/);
  assert.equal(r.backup, null);
  const many = Array.from({ length: 11 }, (_, i) => ({ title: `T${i}`, url: `https://m.example.com/${i}` }));
  const r3 = await B.saveTabsAsFolder(fb.api, area, { name: "Many", tabs: many });
  assert.equal(r3.backup.reason, "before-save");
  never(fb);
});

// ---- backups ---------------------------------------------------------------------------------

test("a backup holds the whole tree in order, reads back, nests again and lists with its counts", async () => {
  const { fb, work, a, b, sub, c, d, js } = sample();
  const area = fakeArea();
  const { meta, nodes } = await B.takeBackup(fb.api, area, { now: 1000, reason: "manual", version: "1.6.0" });
  assert.equal(meta.bookmarks, 5);
  assert.equal(meta.folders, 2);
  assert.deepEqual(nodes.map((n) => n.id), ["1", work, a, b, sub, c, "2", d, js, "3"]);
  assert.equal(nodes[0].folderType, "bookmarks-bar");
  assert.equal(nodes.find((n) => n.id === c).parentId, sub);
  // every folder comes before what it holds: a restore can create parents first
  const seen = new Set();
  for (const n of nodes) { if (n.parentId !== "0") assert.ok(seen.has(n.parentId), `${n.id} after its parent`); seen.add(n.id); }
  const listed = await B.listBackups(area);
  assert.deepEqual(listed.map((m) => m.id), [meta.id]);
  const read = await B.readBackup(area, meta.id);
  assert.deepEqual(read.nodes, nodes);
  const tops = B.nestNodes(nodes);
  assert.deepEqual(tops.map((t) => t.title), ["Bookmarks bar", "Other bookmarks", "Mobile bookmarks"]);
  assert.deepEqual(tops[0].children[0].children.map((x) => x.title), ["Alpha docs", "Beta", "Deep"]);
  const file = B.backupFile(meta, read.nodes, { version: "1.6.0" });
  const parsed = JSON.parse(file.text);
  assert.equal(parsed.format, "tabvault-bookmarks");
  assert.equal(parsed.schema, 1);
  assert.deepEqual(parsed.counts, { bookmarks: 5, folders: 2 });
  assert.match(file.filename, /^tabvault-bookmarks-[0-9-]+\.json$/);
  never(fb);
});

test("backups are chunked by 500 nodes and only the newest N are kept", async () => {
  const fb = fakeBookmarks();
  const f = fb.folder("2", "Big");
  for (let i = 0; i < 1200; i++) fb.link(f, `B${i}`, `https://big.example.com/${i}`);
  const area = fakeArea();
  const first = await B.takeBackup(fb.api, area, { now: 1, keep: 2 });
  assert.equal(first.meta.chunks, Math.ceil(first.meta.nodes / B.BACKUP_CHUNK));
  assert.ok(Array.isArray(area.data[B.bookmarkChunkKey(first.meta.id, 2)]));
  const second = await B.takeBackup(fb.api, area, { now: 2, keep: 2 });
  const third = await B.takeBackup(fb.api, area, { now: 3, keep: 2 });
  assert.deepEqual((await B.listBackups(area)).map((m) => m.id), [third.meta.id, second.meta.id]);
  assert.equal(area.data[B.bookmarkChunkKey(first.meta.id, 0)], undefined, "the rotated-out backup's chunks are removed");
  assert.equal((await B.readBackup(area, third.meta.id)).nodes.length, third.meta.nodes);
  never(fb);
});

test("a backup that does not read back is refused and leaves the list as it was", async () => {
  const { fb } = sample();
  const area = fakeArea();
  await B.takeBackup(fb.api, area, { now: 1 });
  const lossy = { ...area, get: async (keys) => { const got = await area.get(keys); for (const k of Object.keys(got)) if (k.startsWith("bmBackup:") && Array.isArray(got[k])) got[k] = got[k].slice(1); return got; } };
  await assert.rejects(() => B.takeBackup(fb.api, lossy, { now: 2 }), /read back/);
  assert.equal((await B.listBackups(area)).length, 1);
  assert.equal(Object.keys(area.data).filter((k) => k.startsWith("bmBackup:")).length, 1);
});

test("the HTML export is the standard bookmarks file, escaped, with the bar marked", async () => {
  const fb = fakeBookmarks();
  const f = fb.folder("1", "R&D <x>");
  fb.link(f, "Quote \" and <b>", "https://q.example.com/?a=1&b=2");
  fb.link("2", "Other one", "https://o.example.com/");
  const nodes = B.flattenTree(await fb.api.getTree());
  const { text, filename } = B.toBookmarksHtml(nodes, { now: 0 });
  assert.match(filename, /\.html$/);
  assert.ok(text.startsWith("<!DOCTYPE NETSCAPE-Bookmark-file-1>"));
  assert.match(text, /<H3[^>]*PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar<\/H3>/);
  assert.match(text, /<H3[^>]*>R&amp;D &lt;x&gt;<\/H3>/);
  assert.match(text, /<A HREF="https:\/\/q\.example\.com\/\?a=1&amp;b=2"[^>]*>Quote &quot; and &lt;b&gt;<\/A>/);
  assert.match(text, /<DT><A HREF="https:\/\/o\.example\.com\/"/);
  assert.ok(!/<b>/.test(text));
});

// ---- search, folders, duplicates -------------------------------------------------------------

test("the index lists bookmarks with their folder path, leaves Deleted out, and b: search finds titles, addresses and folders", async () => {
  const { fb, a, work } = sample();
  const area = fakeArea();
  const gone = fb.link("1", "Alpha gone", "https://gone.example.com/");
  const del = (await B.moveToDeleted(fb.api, area, [gone])).deletedFolderId;
  const tree = await fb.api.getTree();
  assert.equal(await B.deletedFolderId(area, tree), del);
  const index = B.buildBookmarkIndex(tree, { deletedId: del });
  assert.ok(!index.links.some((l) => l.id === gone));
  assert.equal(index.links.find((l) => l.id === a).path, "Bookmarks bar › Work");
  assert.deepEqual(index.folders.map((f) => [f.title, f.path, f.count]), [["Work", "Bookmarks bar", 3], ["Deep", "Bookmarks bar › Work", 1]]);
  const rows = B.searchBookmarks(index, "alpha");
  assert.deepEqual(rows.map((r) => r.entry.title).sort(), ["Alpha again", "Alpha docs"]);
  assert.ok(rows.every((r) => r.kind === "bookmark"));
  assert.deepEqual(B.searchBookmarks(index, "b.example").map((r) => r.entry.id), [index.links.find((l) => l.title === "Beta").id]);
  const folderRows = B.searchBookmarks(index, "work");
  assert.equal(folderRows[0].kind, "bmFolder");
  assert.equal(folderRows[0].entry.id, work);
  assert.deepEqual(B.searchBookmarks(index, ""), []);
});

test("a folder opens as one window of its web pages (subfolders included); above 50 asks first", async () => {
  const { fb, work } = sample();
  const [sub] = await fb.api.getSubTree(work);
  const links = B.folderLinks(sub);
  assert.deepEqual(links.map((l) => l.url), ["https://a.example.com/docs#intro", "https://b.example.com/", "https://c.example.com/x"]);
  const s = B.folderToSession("Work", links);
  assert.equal(s.windows.length, 1);
  assert.equal(s.windows[0].windowName, "Work");
  assert.deepEqual(s.windows[0].tabs.map((t) => t.index), [0, 1, 2]);
  assert.equal(B.openFolderNeedsConfirm(50), false);
  assert.equal(B.openFolderNeedsConfirm(51), true);
});

test("duplicate bookmarks group by address (the ignore-hash setting applies), oldest first; nothing pre-ticked", async () => {
  const { fb } = sample();
  fb.link("3", "Beta mobile", "https://b.example.com");
  const index = B.buildBookmarkIndex(await fb.api.getTree());
  const withHash = B.findBookmarkDuplicates(index, { ignoreHash: true });
  assert.deepEqual(withHash.map((g) => g.items.map((x) => x.title)), [["Alpha docs", "Alpha again"], ["Beta", "Beta mobile"]].sort((x, y) => (x[0] < y[0] ? -1 : 1)));
  const strict = B.findBookmarkDuplicates(index, { ignoreHash: false });
  assert.deepEqual(strict.map((g) => g.items.length), [2]);
  assert.ok(withHash.every((g) => g.items[0].dateAdded <= g.items[1].dateAdded));
});

test("isWebPage: http, https and file only", () => {
  assert.ok(B.isWebPage("https://x.example.com/"));
  assert.ok(B.isWebPage("file:///tmp/a.html"));
  for (const u of ["javascript:void(0)", "chrome://settings", "data:text/plain,hi", "about:blank", "", "not a url"]) assert.equal(B.isWebPage(u), false, u);
});
