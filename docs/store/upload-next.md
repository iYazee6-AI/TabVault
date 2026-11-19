# TabVault: what to upload next

Written 2026-11-19 for the owner. The store shows **1.4.1.4**. 1.5.0 and 1.6.0 are tagged and zipped but were never uploaded; 1.7.0 "Tidy" is built on branch `feat/tidy-1.7` and waits for Naqid's review and its tag.

## Which zip

Upload **only the newest**, once you have tried it: `dist/tabvault-1.7.0.zip` (rebuilt from the `v1.7.0` tag after the review; check its SHA-256 against the listing, section 18). It already holds everything in 1.5.0 (the toolbar button can open the side panel) and 1.6.0 (bookmarks). Every upload is a review round of its own, so three uploads would mean three waits; one upload means one. Skip the 1.5.0 and 1.6.0 zips.

What changes for people who have 1.4.1: nothing is asked at the update. The two new permissions, `bookmarks` and `notifications`, are optional: Chrome asks only when someone turns on Bookmarks or the tidy notification.

What to paste: section 18 of `docs/store/listing.md` says which boxes change (the description with its NEW IN 1.7 block, the single purpose, five permission rows, the Web history row, and five screenshots: 01, 07, 08, 09, 02).

## Ten minutes in real Chrome before you upload

Load the unzipped 1.7.0 folder at `chrome://extensions` (Developer mode, Load unpacked) in a Chrome profile you can play in. Tick each line:

1. [ ] Click the TabVault toolbar button: the full page opens. Settings, Toolbar button opens, Side panel, Save; click it again: the side panel opens. Right-click the button: "Open in side panel" and "Open full page" both work. Set it back to Full page.
2. [ ] Settings, Bookmarks, tick it: Chrome asks "Read and change your bookmarks"; Allow. Alt+K, type `b:` and a word: your bookmarks show. Untick Bookmarks: at `chrome://extensions`, TabVault, Details, the bookmarks permission is gone.
3. [ ] Select a tab, press Snooze, pick a date and time two minutes ahead, Snooze until then. The tab closes and is listed under Snoozed (below your windows). Wait: it opens again in its window.
4. [ ] Snooze another tab two minutes ahead and quit Chrome completely. Start Chrome again after the two minutes: the tab opens again by itself, and Snoozed is empty.
5. [ ] Snooze a whole group (the ⏾ on its header), then Wake now on each row: the tabs come back in a group of the same name and colour.
6. [ ] ⋯, Group rules, Add a rule: a site you use (for example `github.com`), group "Code", Save. Open a page of that site: it joins "Code".
7. [ ] Drag that tab out of the "Code" group in Chrome's own tab strip: it stays out. Click a link to another page of the same site: still out. Go to a different site and back: it joins "Code" again.
8. [ ] Group rules, Run rules on open tabs now: the list shows what would move; Move, then Undo: everything is back where it was.
9. [ ] ⋯, Tidy now: tick a duplicate, Close into the vault, then Restore: it comes back. Tick "Also tell me with a notification": Chrome asks "Display notifications"; Allow, then untick it: at `chrome://extensions` the notifications permission is gone.
10. [ ] ⋯, About shows 1.7.0.

All ticked: say `tabvault 1.7 ok` and the tag and the final zip follow; then the upload is yours.
