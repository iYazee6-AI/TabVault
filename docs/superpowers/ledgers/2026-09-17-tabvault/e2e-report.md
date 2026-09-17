# TabVault e2e run

Run at 2026-09-17T13:13:40.935Z. 13 scenarios, 13 passed, 0 failed, 0 environment-limited.

| Scenario | Status |
|---|---|
| A | PASS |
| B | PASS |
| C | PASS |
| D | PASS |
| E | PASS |
| F | PASS |
| G | PASS |
| H | PASS |
| I-a | PASS |
| I-b | PASS |
| J | PASS |
| K | PASS |
| L | PASS |

## Evidence

### A: PASS

```
columns=[{"window":"426615312","count":"2"},{"window":"426615306","count":"1"},{"window":"426615309","count":"2"}], groups=["Grp"], counts="3 windows · 5 tabs" (expected {"winCount":3,"tabCount":5}). Screenshot: main-page.png
```

### B: PASS

```
search "three" -> counts="1 of 5 tabs", visible row data-tab=426615313 (matches three.html tab 426615313); Escape -> search cleared, counts="3 windows · 5 tabs"
```

### C: PASS

```
moved tab 426615310 (one.html) from window 426615309 to window 426615312; chrome.tabs.get confirms windowId=426615312
```

### D: PASS

```
dragged tab 426615311 (two.html) onto window 426615312: windowId=426615312, groupId=-1 (ungrouped). Source window 426615309 auto-closed=true
```

### E: PASS

```
closed tabs 426615313 (three.html) and 426615310 (one.html); both gone per chrome.tabs.get
```

### F: PASS

```
grouped tabs 426615314,426615311, renamed to "Renamed", set color blue; chrome.tabGroups.query confirms [{"collapsed":false,"color":"blue","id":2127197445,"shared":false,"title":"Renamed","windowId":426615312}]
```

### G: PASS

```
header="1 duplicated URL", duplicate rows=3; clicked "Close 2 duplicates" -> exactly 1 one.html tab remains (id=426615318)
```

### H: PASS

```
downloaded "tabvault-2026-09-17-1612.json", schema=1, app.name="TabVault", windows=1, tabs=2 (matches live {"winCount":1,"tabCount":2})
```

### I-a: PASS

```
lazy loading off; import dialog listed 1 window row(s); result dialog: "Import completeRestored 1 windows and 2 tabs.Close"; new window 426615322 has URLs in order ["http://localhost:8765/test-pages/two.html","http://localhost:8765/test-pages/one.html"] (expected ["http://localhost:8765/test-pages/two.html","http://localhost:8765/test-pages/one.html"]), pinned [false,false], 0 discarded tabs, group {"collapsed":false,"color":"blue","id":1998807403,"shared":false,"title":"Renamed","windowId":426615322} (expected title "Renamed" color "blue"); 0 new console errors.
```

### I-b: PASS

```
browser survived the real Restore click with lazy loading on; 1 new window(s), non-first tabs report discarded=true: [{"id":426615328,"index":1,"discarded":true}]; 0 new console errors.
```

### J: PASS

```
snapshot 84cfe9b494c3fd63: reason=manual, kept marker shown, deleted (storage confirms). snapshot 4cf0170a87c4d868: Unkeep -> pinned=false ("Keep" shown), Keep -> pinned=true ("Unkeep" shown). Screenshot: snapshots-dialog.png
```

### K: PASS

```
snapshot count 6 -> 7 after opening a tab and waiting 40s; newest snapshot reason="change"
```

### L: PASS

```
after Save: data-density="compact", data-show-urls="true", .turl visible=true; after reload: data-density="compact", data-show-urls="true"
```

## Console errors

```json
{
  "worker": [],
  "app": []
}
```