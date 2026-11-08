# Chrome Web Store submission kit for TabVault

Everything below is ready to paste. Values in `<angle brackets>` are yours to
fill in. Fields are named as they appear in the Chrome Web Store Developer
Dashboard (https://chrome.google.com/webstore/devconsole).

## 0. Before you start (one time)

1. Pick the Google account that will own the extension. Turn on 2-Step
   Verification at https://myaccount.google.com/security (the dashboard
   refuses accounts without it).
2. Open https://chrome.google.com/webstore/devconsole, accept the developer
   agreement, and pay the one-time registration fee.
3. In **Account** (left sidebar):
   - **Publisher display name**: `<your name or company>`
   - **Contact email**: `iyazee6+store@gmail.com` → click **Verify email** and
     confirm the link Google sends.
4. Fill in `iyazee6+store@gmail.com` in `PRIVACY.md`, commit, and push. The
   policy URL will be
   `https://github.com/iYazee6-AI/TabVault/blob/main/PRIVACY.md`.
   That URL only resolves if the repository is **public** — check it in an
   incognito window before you paste it into the dashboard. If the repo is
   private, either make it public or host the same text somewhere public and
   use that address instead.

**Learned on the first submission (2026-09-23).** The developer account is
active. The contact email in this kit is `iyazee6+store@gmail.com`; the
Developer Dashboard's own contact-email field must be a verified address and
may refuse a plus-address, in which case use the plain Gmail address there
and keep the plus-address in `PRIVACY.md`. The privacy policy URL only works
once the repository is public.

## 1. Pre-submission checklist

- [ ] `npm test` passes (122 tests).
- [ ] `npm run e2e` passes (32 scenarios; scenarios I-b and Z are expected to
      report LIMITED on this machine — `chrome.tabs.discard` crashes Playwright's
      bundled Chromium, see `e2e/README.md`. LIMITED is a pass for release
      purposes; FAIL or NOT RUN is not).
- [ ] The manual checks from `README.md` → "Manual checks before release",
      done in real Chrome with the extension loaded unpacked:
      - `Alt+Shift+T` actually opens TabVault (it can collide with Chrome's
        focus-the-toolbar shortcut on Windows; rebind at
        `chrome://extensions/shortcuts` if it does).
      - Export, then Import, a session containing a `file://` tab (needs
        "Allow access to file URLs").
      - Lazy restore: Settings → "Load restored tabs only when opened (lazy)"
        on, then restore a snapshot, and confirm the non-first tabs open
        unloaded and load on click.
      - Unload idle tabs (1.2): Settings → "Unload tabs not used for" 15
        minutes on, leave a few tabs alone past that, and confirm they show
        `zz` within 5 minutes after, with the "last run" line under the
        setting; the active, playing and pinned tabs stay loaded.
      - Side panel (1.2): ⋯ → "Open in side panel" opens the one-column
        layout beside the page; the toolbar icon still opens the full page.
      - The three 1.3 checks in section 14: Copy to clipboard from the Export
        dialog, a shelving rule at 15 minutes, and a shelved item whose
        group is gone.
- [ ] `PRIVACY.md` contact email filled in and the file is reachable at a
      public URL.
- [ ] `manifest.json` `version` is the base you want to publish (currently
      `1.3.0`). The Release workflow appends the run number, so the uploaded
      package is `1.3.0.<run number>`; every later upload must be higher.
- [ ] `manifest.json` `name` is `TabVault: Open-Source Tab Manager` (33 characters; Chrome
      allows 75, and this kit keeps the title at or under 45 so store cards
      and search do not cut it). The store title is read from this field, so
      the listing title changes only with a new package.
- [ ] The listing makes no claim the code does not back: the memory line says
      TabVault unloads the tabs you select (Discard, lazy restore) and, since
      1.2 and only when you turn it on, tabs idle past a threshold you pick;
      since 1.3 the promise reads "Nothing is closed unless a rule you wrote
      says so": only a shelving rule the user wrote, dry-ran and switched on
      closes tabs, each saved to a shelf first; there is no memory meter (the
      `processes` API is Dev channel only). Change that line only when the
      code changes.
- [ ] The zip you are about to upload came from **Actions → Release build →
      Run workflow**, and was downloaded from the GitHub Release
      `v<manifest version>.<run number>` that the workflow created (for
      example `v1.0.0.7`). That zip is the upload. Never hand-make one.
- [ ] If you upload the local package instead (section 2 allows it), check
      it is the one built with the `v1.2.0` tag: `dist/tabvault-1.2.0.zip`,
      415,960 bytes, SHA-256
      `a9ea9bb801c39ccf75ce91f58ff2aec9069e88f5374686c4108e7b1cc6a5e541`
      (`certutil -hashfile dist/tabvault-1.2.0.zip SHA256` or `sha256sum`).
      Its 29 files match the `v1.2.0` tag (checked 2026-11-08, line endings
      aside). A Release build zip has its own hash, since the run number is
      stamped into its manifest.

## 2. Build the package

1. GitHub → **Actions** → **Release build** → **Run workflow** (optionally
   type release notes; leaving it empty auto-generates them from commits).
2. The workflow runs `npm test`, stamps the version as
   `<manifest major.minor.patch>.<run number>` in the runner only (nothing is
   committed back), runs `npm run pack`, and publishes a GitHub Release tagged
   `v<that version>` with `dist/tabvault-<version>.zip` attached.
3. Download that zip from the Release page. It is also kept as a workflow
   artifact for 90 days.

`npm run pack` locally produces the same layout and is useful for inspecting
what goes in — `manifest.json`, `background.js`, `app/`, `lib/`, `icons/` and
nothing else (no `docs/`, `test/`, `e2e/`, `tools/` or `node_modules/`) — but
the local zip carries the un-stamped three-segment version, so do not upload
it.

The zip written by `npm run pack` is the same package the Release workflow
builds; uploading the local one is fine when the workflow is slow or broken.
Since 2026-09-23 the workflow runs Trivy from the pinned image
`aquasec/trivy:0.74.0` (the `trivy-action` step died when upstream deleted
the `setup-trivy` tag it depended on).

## 3. Create the item and upload

1. Dashboard → **Items** → **New item**.
2. Upload the zip from the GitHub Release. The dashboard reads the name,
   version, description and icon from the manifest.
3. Work through the tabs below. Click **Save draft** often.

## 4. Store listing tab

**Product details**

| Field | Value |
|---|---|
| Title (from manifest `name`, 33 characters, kept at or under 45) | `TabVault: Open-Source Tab Manager` |
| Summary (from manifest `description`, 128 characters, max 132) | `Every window and tab in one page or the side panel. Search, group, dedupe, unload idle tabs, reopen closed tabs, keep snapshots.` |
| Category | `Productivity` → subcategory `Tools`. TabVault manages the browser's own windows and tabs rather than acting on page content, which is what the Tools subcategory covers; if the dashboard offers only one level, choose `Productivity`. |
| Language | `English` |

**Description** (paste as is):

```
TabVault is an open-source tab manager. It puts every window and tab you have open into a single page, and keeps local snapshots of your session so a crash or a stray click does not cost you your tabs.

Free memory on your terms: pick the tabs you are not using and click Discard, or turn on Unload idle tabs in Settings and TabVault unloads tabs you have not used for the time you choose (15 minutes to 4 hours). Unloaded tabs stay in their windows and reload when you click them; the tab you are on, tabs playing sound, pinned tabs (unless you allow it) and protected groups are never unloaded. Write a rule per site to unload its tabs sooner, never touch them, or file them onto a shelf. Nothing is closed unless a rule you wrote says so: a shelving rule stays off until you have run its dry run and turned it on, and every tab it closes is saved to the shelf first. All of it is off until you turn it on.

WHAT YOU CAN DO
• See every window as a card and every tab as a row with its favicon and site, with your native tab groups shown inline. The window TabVault is open in is marked CURRENT, and you can give any window a name.
• Search across all tab titles and URLs at once (press / to jump to the search box).
• Select tabs with checkboxes, Ctrl/Cmd-click or Shift-click ranges, then move them to another window, group them, pin them, unload them or close them in bulk.
• Drag a tab row onto another window's card, or onto a group, to move it there.
• Create, rename, recolour, collapse and ungroup native tab groups.
• Find tabs that share a URL, choose which copy to keep and which extra copies to close, row by row.
• Navigate entirely from the keyboard: j and k (or the arrows) to move, x to select, g to group, d for duplicates, Enter to go to a tab, Delete to close, ? for the full list. The shortcuts are always shown at the bottom of the page.
• Press Alt+K for the command palette: type a few letters to run any action or jump to any tab, or to find a tab you saved in a snapshot, on a shelf or in the recently closed list, highlighted, and open one or all of them.
• Shelves: named lists of saved tabs that are never rotated away. Move tabs to a shelf by hand, or let an idle rule file them there; reopen them one at a time or all at once, in their groups.
• Open TabVault in Chrome's side panel for a one-column view beside the page you are reading.
• The toolbar icon shows how many tabs you have open (or how many are unloaded, or nothing).
• Reopen recently closed tabs, one at a time or a whole closed window at once.
• Light and dark themes that follow Chrome, or pick one in Settings.

SNAPSHOTS, EXPORT AND RESTORE
• Save and close: put a whole window away in one step. TabVault asks first with the count, keeps a named snapshot, then closes the tabs.
• Snapshots are taken after your tabs stop changing for a while, and on browser startup — not on a fixed timer, so an idle browser does not fill your storage. Identical sessions are never stored twice.
• Take one yourself with Snapshot now, and mark any snapshot Keep so it is never rotated away.
• Compare any snapshot with what is open now: see what is missing, what is new and what moved, and reopen just the missing tabs.
• Export the current session, the selected tabs, a snapshot or a shelf: as a JSON file with every window, tab, group, pinned state and position, or as Markdown, a list of links for your notes.
• Import a file or paste a list of links and restore only the windows you pick. Links that are not web pages (javascript:, data:, chrome: and the like) are skipped and counted. Restored tabs open unloaded by default: the first tab of each window loads, the rest load the moment you click them.

WHAT IT NEVER DOES
• It never reads the content of a page. TabVault asks for no access to websites and injects no scripts, so it sees a tab's title, address and favicon and nothing more.
• It sends nothing to any server of its own, contains no analytics or telemetry, and has no account. The only network activity is the browser fetching each tab's favicon from that tab's own site, which 1.0 did too. Everything it stores stays in your browser's local extension storage on your machine.
• Export and import are manual file operations that you start.

GOOD TO KNOW
• Chrome and Edge only: TabVault uses the Chromium tab groups API.
• It shows the tabs you have open; it does not search history or bookmarks.
• Incognito windows are only visible if you allow the extension in incognito at chrome://extensions.

Open source, plain HTML and JavaScript, no build step and no dependencies, MIT licensed. Source: https://github.com/iYazee6-AI/TabVault
```

**Graphic assets**

| Field | File | Size |
|---|---|---|
| Store icon | `icons/icon128.png` | 128×128 |
| Screenshots (upload in this order) | `docs/store/screenshots/01-all-windows.png` — the whole session: three named window cards (Research, Work, Personal), three colour-coded tab groups, a pinned tab, the header counter, the shortcut strip, and the Recently closed section opened below (a single tab, a closed window of three with Reopen all) | 1280×800 |
| | `docs/store/screenshots/02-command-palette.png` — the Alt+K palette after typing "s": actions with their keys first, then matching tabs with their window and site | 1280×800 |
| | `docs/store/screenshots/03-idle-rules.png` — Settings, Idle tabs: the global unload setting, the rules (a never rule, an unload rule, a shelving rule) and a shelving rule's dry run open in the editor, listing the tabs it would shelve now, with its On switch unlocked | 1280×800 |
| | `docs/store/screenshots/04-saved-search.png` — the Alt+K palette searching "quota": the open tab first, then the Saved section with matches from a snapshot (with "+N older"), a shelf and the recently closed list, the words highlighted, and "Open all saved matches in a new window" | 1280×800 |
| | `docs/store/screenshots/05-snapshots.png` — the snapshot list: a kept manual snapshot, a kept "Personal" save-and-close snapshot, automatic and startup ones, with Restore/Export/Keep/Delete | 1280×800 |
| Small promo tile | `docs/store/promo-tile-440x280.png` | 440×280 |
| Marquee promo tile | leave empty (optional) | 1400×560 |
| Video | leave empty (none) | |

All five screenshots were captured by `npm run screenshots` from the real
extension running in Chromium, using example pages served locally on port
8771 and mapped to `*.example.com`. Nothing in them is mocked up; the
snapshot history is seeded through the extension's own `lib/snapstore.js`,
the recently closed entries are real closes the worker recorded, and the
"last run" line under Unload idle tabs reads a run record the script writes
(a real run's `chrome.tabs.discard` crashes Playwright's Chromium).
Regenerated for 1.2.0 on 2026-11-08 in Chromium's new headless mode
(`TABVAULT_HEADLESS=1`; the other overrides, `TABVAULT_PLAYWRIGHT`,
`TABVAULT_SHOTS_DIR` and `TABVAULT_TMP_DIR`, are described at the top of
`tools/screenshots.js`); the promo tile came out byte for byte the same.

**Additional fields**

| Field | Value |
|---|---|
| Official URL | leave empty, or a verified site you own |
| Homepage URL | `https://github.com/iYazee6-AI/TabVault` |
| Support URL | `https://github.com/iYazee6-AI/TabVault/issues` |
| Mature content | `No` |

**Screenshot format rule (the dashboard's words):** up to 5, 1280x800 or
640x400, JPEG or 24-bit PNG with no alpha channel, at least one required.
Since 1.1, `tools/screenshots.js` writes every screenshot and the promo tile
as an 8-bit RGB PNG (colour type 2) itself, compositing Playwright's RGBA
output onto white; check byte 25 of each file is 2 after regenerating.

## 5. Privacy tab

**Single purpose** (paste):

```
TabVault lists every browser window and tab in one page (or in the side panel) so the user can search, organise, unload and clean them up, files idle tabs onto local shelves by the user's rules, and keeps local snapshots of that session and a list of recently closed tabs so they can be exported, restored and reopened. All data stays in the browser's local extension storage.
```

**Permission justifications** (one box per permission; these are every
permission in `manifest.json` — there are no optional permissions and no host
permissions)

| Permission | When it is requested | Why | Without it |
|---|---|---|---|
| `tabs` | At install, for the life of the extension. | Reads the title, URL, favicon, pinned/muted state, position and group of every tab via `chrome.windows.getAll({populate:true})` so the page can list them, and calls `chrome.tabs.move`, `group`, `ungroup`, `update`, `discard`, `create` and `remove` when the user moves, groups, pins, unloads, opens or closes tabs — plus the same calls when restoring a snapshot or an imported file, and closes tabs a rule you wrote shelves, after saving them (only a shelving rule the user wrote, dry-ran and switched on; every such tab is written to a local shelf and read back before `chrome.tabs.remove`). | The extension has nothing to show and nothing to restore. |
| `tabGroups` | At install. | Reads native tab groups (`chrome.tabGroups.query`) so they appear inline under their window, and calls `chrome.tabGroups.update` to rename, recolour and collapse them, including when recreating them during a restore. | Groups would be invisible in the listing and lost on restore. |
| `storage` | At install. | `chrome.storage.local` holds the user's settings (including the idle rules), the snapshot history, the shelves (the tabs the user or a rule saved there, kept until removed) and the recently closed list (at most 200 tabs, off switch in Settings); `chrome.storage.session` holds short-lived values: when the current burst of tab changes started (so a busy browser cannot postpone a snapshot forever), when the browser session started, and the idle-tab rule's last run. This is the only place any data is kept. | No snapshots, no settings, no recently closed list; the extension becomes a read-only viewer. |
| `unlimitedStorage` | At install. | A snapshot stores a full session, and the history is many snapshots; a user with hundreds of tabs exceeds the default extension storage quota, and a quota failure would silently lose a snapshot. This permission lifts that cap. It grants no additional access to anything — only more room in the extension's own local storage. | Snapshots would start failing to save once the history grew past the default quota. |
| `alarms` | At install. | Snapshots are debounced: after tabs stop changing for N seconds (30 by default) one is taken. A Manifest V3 service worker is torn down while idle and cannot hold a timer, so the delay is measured with a single re-armed `chrome.alarms` alarm. A second alarm fires every 5 minutes: it refreshes the tab count on the toolbar icon and runs your idle rules: only when the user has turned on Unload idle tabs or written a rule, it unloads tabs idle past the user's threshold, and a shelving rule the user wrote, dry-ran and switched on saves the idle tabs of its site to a local shelf and then closes them; at most 25 tabs a run. | Automatic snapshots, idle-tab unloading and the idle rules would be impossible, and the icon count could go stale. |
| `sidePanel` | At install. | Shows the same TabVault page (`app/index.html?panel=1`, a one-column layout) in Chrome's side panel when the user opens it from TabVault's menu, the command palette, or a keyboard shortcut they assign. The toolbar icon still opens the full page. It grants no access to any website. | TabVault could only be used as a full tab. |
| Host permissions | none | The manifest declares no `host_permissions` and no `optional_host_permissions`, and the extension registers no content scripts and calls no scripting API. It never reads page content. | — |

**Remote code**

| Field | Value |
|---|---|
| Are you using remote code? | `No, I am not using remote code` |
| Justification (if asked) | `All JavaScript ships inside the package: background.js, app/ and lib/. There is no eval, no new Function, and no remotely hosted script or stylesheet. The extension sends nothing to any server of its own; the only network activity is the browser fetching each tab's favicon from that tab's own site.` |

**Data usage** — "What user data do you plan to collect from users now or in
the future?" Tick:

| Checkbox | Tick | Why |
|---|---|---|
| Personally identifiable information | No | TabVault asks for no personal data and has no account. |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | No | It reads no page content, no cookies and no credentials. |
| Personal communications | No | |
| Location | No | |
| Web history | Yes | The addresses and titles of the tabs the user has open, of the tabs in each stored snapshot, of the tabs saved on shelves, and of the last 200 tabs the user closed (the recently closed list, which can be turned off and cleared). Written only to local extension storage; never transmitted. |
| User activity | No | No clicks, keystrokes or analytics are recorded. |
| Website content | No | No host permissions and no content scripts: the content of pages is never readable. |

Unload idle tabs (1.2) adds nothing to this table: each run reads the tab
details the `tabs` permission already gives (last used time, active,
audible, pinned, group name, host), stores none of them, and keeps only the
time of its last run and three counts in `chrome.storage.session`.
`PRIVACY.md` says the same under "What TabVault does not store".

Shelves and idle rules (1.3) add no new data type either: a shelf holds a
tab's title, address, favicon address, group name and colour and the time it
was saved, in `chrome.storage.local`, which is the Web history row above; a
rule is a site pattern the user typed, an idle time and an action. Nothing is
transmitted. The saved-tab search in the palette builds its index in the
page's memory and stores nothing.

Certifications (tick all three):

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

| Field | Value |
|---|---|
| Privacy policy URL | `https://github.com/iYazee6-AI/TabVault/blob/main/PRIVACY.md` |

## 6. Distribution tab

| Field | Value |
|---|---|
| Payments | `Free of charge` |
| Visibility | `Public` (use `Unlisted` if you want to share a link first without being searchable) |
| Distribution regions | `All regions` |

## 7. Submit

1. Every tab shows a green check when complete. Click **Submit for review**.
2. Leave **Publish automatically after it has passed review** ticked unless
   you want to time the release.
3. Review usually takes one to a few days.
4. You receive an email when the item is published or rejected. Rejections
   quote the policy section.
5. The rejection causes to expect for **this** extension, all pre-answered
   above:
   - **`tabs` is a broad permission.** Reviewers want the single purpose and
     the justification to line up. Both say the same thing: the product *is*
     the list of tabs.
   - **`unlimitedStorage` looks unnecessary.** The justification above gives
     the concrete reason (a session plus its history exceeds the default
     quota) and points out it grants no extra reach.
   - **Privacy policy URL unreachable.** It has to be publicly readable; a
     private GitHub repo returns a 404 to the reviewer. Check it signed out.
   - **Data disclosure mismatch.** "Web history" is ticked because tab URLs
     are stored locally; make sure `PRIVACY.md` still says the same thing if
     you edit either.
   - **Why does an extension close tabs without a click? (1.3)** Only a rule
     the user wrote closes tabs, and only after the user ran its dry run
     (which lists the tabs it would close) and turned its switch on; every
     closed tab is saved to a local shelf first and the write is read back
     before the close; the default is off, at most 25 tabs are handled a run,
     and the tab the user is on is never touched. The `tabs` and `alarms`
     justifications above say the same.
   - **Screenshot quality.** All five are 1280×800 PNGs of the real UI, which
     is what the store expects; do not crop or rescale them.

**If the dashboard says "Unable to publish" with a list**, every line maps
to the Privacy practices tab: "single purpose description" is the first
block of section 5; "a justification for <permission>" is that permission's
row in the table (one text box per permission); "a justification for remote
code use" is the Remote code block (choose No; if a text box still shows,
paste the justification); "certify that your data usage complies" is the
three certification checkboxes. Save draft after filling them, then Submit.

## 8. Publishing an update later

1. Bump `version` in `manifest.json` (for example `1.0.1` or `1.1.0`).
2. `npm test`, `npm run e2e`, the manual checks, commit, push.
3. GitHub → **Actions** → **Release build** → **Run workflow**, then download
   the zip from the new GitHub Release.
4. Dashboard → the item → **Package** → **Upload new package** → choose that
   zip → **Submit for review**. Listing text and images carry over; update the
   description and screenshots only if the UI actually changed.

## 9. Things the store may ask that are not settled here

- **Publisher display name and contact email**: pick the name users will see
  and verify the address. Not decided in this repo.
- **Trader status** (EU Digital Services Act prompt): answer according to
  whether you distribute the extension in a business capacity.
- **Verified official URL**: only needed if you want the listing to show a
  verified website; requires Search Console ownership of the domain.
- **Is the GitHub repository public?** Everything here assumes it is — the
  privacy policy URL, the homepage URL and the support URL all point at it.
- **Single listing or also Microsoft Edge Add-ons?** TabVault runs on Edge
  too, but the Edge store is a separate submission with its own account and
  is not covered here.
- **Account-level 2-Step Verification and the registration fee** must be done
  by you; nothing in this repo can do it.

## 10. The 1.1.1 rename (title "TabVault: Open-Source Tab Manager")

Decided 2026-11-02 (the owner's word `tabvault rename open-source`, from the
2026-11-01 competitor survey: at least 18 store items are called TabVault, and
the earlier draft title was 54 characters). 1.1.1 changes only the manifest
`name` (the store title), the manifest `description` (the summary) and this
kit; the code is the same as 1.1.0.

1. Build the 1.1.1 package (section 2) and upload it as in section 8. If 1.1.0
   is still in review, either wait until it is published or cancel that
   review in the dashboard first; a new package cannot be uploaded while one
   is pending.
2. Store listing tab: replace the whole description with the block in section
   4 (it now opens with "TabVault is an open-source tab manager" and the
   memory line), keeping the "NEW IN 1.1" block below on top while 1.1 is new.
3. The title and summary come from the package; check they read as in
   section 4 after the upload.

## 11. What's new in 1.1.0 (for the update)

Upload the 1.1.0 package as in section 8, replace all five screenshots with the
regenerated ones (same order), and paste this block at the top of the
description, above "TabVault is an open-source tab manager...", with one blank line after it:

```
NEW IN 1.1
• A new look: denser rows, a warm light theme and a dark theme that follow Chrome, or choose one in Settings → Appearance.
• Windows are cards in a grid; the window TabVault is open in is marked CURRENT. Name any window with the pencil; names are kept in snapshots and exports.
• Every tab shows its favicon (or a coloured letter), its site, and flags for pinned, playing, unloaded and duplicate tabs. The active tab of each window is marked.
• Pick a group's colour from eight dots.
• Selected tabs get a floating bar: Move to, Group, Pin, Discard, Close. Esc clears it.
• More keyboard: j and k to move, x to select, g to group, d for duplicates, ? for every shortcut, with a hint strip at the bottom.
• Duplicates: choose which copy to keep and which extra copies to close, row by row.
• About in the ⋯ menu: version, the open-source repository, privacy policy.
• Fonts are bundled with the extension. TabVault still sends nothing to any server of its own and has no analytics; the only network activity is the browser fetching each tab's favicon from that tab's own site, as in 1.0.
```

## 12. What's new in 1.2.0 "Keeper" (for the update)

1.2.0 supersedes 1.1.1 (spec assumption 6): upload 1.2.0 instead of 1.1.1; the
rename ("TabVault: Open-Source Tab Manager") goes out inside it. If 1.1.1 is
already in review, cancel that review first or wait for it (section 10). Upload the 1.2.0
package as in section 8 (the dashboard asks for the new `sidePanel`
justification from section 5 before it accepts the package), replace all five
screenshots with the regenerated ones in the new order (section 4: two files
changed name), update the description from section 4, and paste this block at
the top of it, above "TabVault is an open-source tab manager...", with one
blank line after it:

```
NEW IN 1.2
• Unload idle tabs: turn it on in Settings and tabs you have not used for 15 minutes to 4 hours are unloaded every few minutes, at most 25 at a time. Never the tab you are on, tabs playing sound, pinned tabs (unless you allow it), a group whose name starts with 📌, or the sites you list. Nothing is ever closed, and Settings shows when it last ran.
• The toolbar icon counts your tabs (or your unloaded tabs, or nothing).
• Recently closed: reopen a tab you closed, or a whole closed window at once. Kept on your computer only, the last 200, with a Clear button and an off switch.
• Command palette: press Alt+K and type to run any action or jump to any tab.
• Side panel: open TabVault beside the page you are reading, in one column, from the ⋯ menu or the palette.
• Save and close: put a window away in one step. TabVault asks first with the count, keeps a named snapshot you can restore, then closes the tabs.
```

The three owner's source images ("ChatGPT Image Sep 23 ...", untracked) now sit in
`docs/store/marketing-sources/`, not beside the store screenshots, so they are not
uploaded by mistake. Upload only the five `0*-*.png` files in
`docs/store/screenshots/` (the `marketing-0*` images are separate marketing art).

## 13. The 1.2.0 kit refresh (2026-11-08)

Checked against `manifest.json` as tagged `v1.2.0` (permissions `tabs`,
`tabGroups`, `storage`, `unlimitedStorage`, `alarms`, `sidePanel`; no
optional or host permissions), with every `chrome.*` call in `background.js`,
`app/` and `lib/`: section 5 has one row per permission and none for an API
that needs no permission (`windows`, `action`, `commands`, `runtime`).
The description (section 4, 3,762 characters, plus the 925-character NEW IN
1.2 block from section 12; the store allows 16,000) names the six Keeper
features: unload idle tabs, the icon count, the side panel, recently closed,
the command palette, save and close. The summary is 128 characters (132 max).

What changed in this refresh: the five screenshots were captured again from
the 1.2.0 code (same names and order as section 4), the local package's
SHA-256 is in section 1, `PRIVACY.md` (effective 2026-11-08) says in so many
words that Unload idle tabs touches no data, and section 5 says why it adds
no data disclosure. Nothing in the package changed; the version stays 1.2.0.

The upload is yours (section 12 has the order: package, the `sidePanel`
justification, the five screenshots, the description with NEW IN 1.2 on top).
Before it, the three hands-on checks no automation covers, in real Chrome
with the package loaded unpacked: the side panel from ⋯ and from the palette,
the `open-side-panel` command once bound at `chrome://extensions/shortcuts`,
and Unload idle tabs at 15 minutes (`zz` on the idle tabs, the "last run"
line, the active, playing and pinned tabs left loaded).

## 14. What's new in 1.3.0 "Shelf" (for the update)

1.3.0 goes up only after the 1.2.0 review has passed (one package in review
at a time; spec assumption 6). It asks for no new permission, so the
dashboard asks for no new justification; the `tabs` and `alarms` rows of
section 5 and the single purpose were reworded for the idle rules, so paste
those three again. Upload the 1.3.0 package as in section 8, replace
screenshots 03 and 04 with `03-idle-rules.png` and `04-saved-search.png`
(the duplicates shot `04-duplicates.png` is retired; 01, 02 and 05 were
captured again from 1.3.0), update the description from section 4, and paste
this block at the top of it, above "TabVault is an open-source tab
manager...", with one blank line after it (it replaces the NEW IN 1.2 block):

```
NEW IN 1.3
• Shelves: named lists of saved tabs that are never rotated away. Move tabs to a shelf by hand, or write a rule.
• Idle rules: per site, after the time you choose, unload the tab, shelve it (saved first, then closed), or never touch it. Nothing is closed unless a rule you wrote says so: a shelving rule stays off until you have run its dry run and turned it on, and at most 25 tabs are handled a run.
• Search everything you saved: the Alt+K palette now finds tabs in your snapshots, shelves and recently closed list, highlights the match, and opens one or all of them.
• Compare a snapshot with now: see what is missing, what is new and what moved since then, and reopen just the missing tabs.
• Markdown: export a window, a snapshot or a shelf as a list of links for your notes, and paste a list of links back in to open it as a window.
• Imports now skip links that are not web pages (javascript:, data:, chrome: and the like) and tell you how many.
```

Before the upload, the three real-install checks no automation covers, in
real Chrome with the package loaded unpacked:

1. Export dialog on the main page (`app/index.html`): **Copy to clipboard**
   puts the text on the clipboard without a `clipboardWrite` permission
   (`navigator.clipboard.writeText` from the click). If Chrome refuses it,
   the dialog shows the text selected with "press Ctrl+C" instead; no
   permission is added either way.
2. A shelving rule at 15 minutes on a test site: the dry run lists the tabs,
   the switch unlocks, the idle tabs land on the shelf with their group and
   are closed, the active tab stays, and each Recently closed entry says
   "shelved to" the shelf.
3. Open a shelved item whose group is gone: the group is recreated in the
   current window with its title and colour.
