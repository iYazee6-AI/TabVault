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

## 1. Pre-submission checklist

- [ ] `npm test` passes (23 tests).
- [ ] `npm run e2e` passes (13 scenarios; scenario I-b is expected to report
      LIMITED on this machine — `chrome.tabs.discard` crashes Playwright's
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
- [ ] `PRIVACY.md` contact email filled in and the file is reachable at a
      public URL.
- [ ] `manifest.json` `version` is the base you want to publish (currently
      `1.0.0`). The Release workflow appends the run number, so the uploaded
      package is `1.0.0.<run number>`; every later upload must be higher.
- [ ] The zip you are about to upload came from **Actions → Release build →
      Run workflow**, and was downloaded from the GitHub Release
      `v<manifest version>.<run number>` that the workflow created (for
      example `v1.0.0.7`). That zip is the upload. Never hand-make one.

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

## 3. Create the item and upload

1. Dashboard → **Items** → **New item**.
2. Upload the zip from the GitHub Release. The dashboard reads the name,
   version, description and icon from the manifest.
3. Work through the tabs below. Click **Save draft** often.

## 4. Store listing tab

**Product details**

| Field | Value |
|---|---|
| Title (from manifest) | `TabVault` |
| Summary (from manifest, 126 characters, max 132) | `Every window and tab in one page. Search, move, group, clean duplicates, and keep your session safe with snapshots and export.` |
| Category | `Productivity` → subcategory `Tools`. TabVault manages the browser's own windows and tabs rather than acting on page content, which is what the Tools subcategory covers; if the dashboard offers only one level, choose `Productivity`. |
| Language | `English` |

**Description** (paste as is):

```
TabVault puts every window and tab you have open into a single page, and keeps local snapshots of your session so a crash or a stray click does not cost you your tabs.

WHAT YOU CAN DO
• See every window as a column and every tab as a row, with your native tab groups shown inline.
• Search across all tab titles and URLs at once (press / to jump to the search box).
• Select tabs with checkboxes, Ctrl/Cmd-click or Shift-click ranges, then move them to another window, group them, pin them, unload them or close them in bulk.
• Drag a tab row onto another window's column, or onto a group, to move it there.
• Create, rename, recolour, collapse and ungroup native tab groups.
• Find tabs that share a URL, choose which copy to keep, and close the rest in one click.
• Navigate entirely from the keyboard: arrows to move, Enter to go to a tab, Space to select, Delete to close, ? for the full list.

SNAPSHOTS, EXPORT AND RESTORE
• Snapshots are taken after your tabs stop changing for a while, and on browser startup — not on a fixed timer, so an idle browser does not fill your storage. Identical sessions are never stored twice.
• Take one yourself with Snapshot now, and mark any snapshot Keep so it is never rotated away.
• Export the current session, or any snapshot, to a JSON file with every window, tab, group, pinned state and position.
• Import a file and restore only the windows you pick. Restored tabs open unloaded by default: the first tab of each window loads, the rest load the moment you click them.

WHAT IT NEVER DOES
• It never reads the content of a page. TabVault asks for no access to websites and injects no scripts, so it sees a tab's title, address and favicon and nothing more.
• It makes no network requests, contains no analytics or telemetry, and has no account or server. Everything it stores stays in your browser's local extension storage on your machine.
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
| Screenshots (upload in this order) | `docs/store/screenshots/01-all-windows.png` — the whole session: three windows as columns, two named tab groups, a pinned tab, the toolbar counter | 1280×800 |
| | `docs/store/screenshots/02-search.png` — searching "release": only matching tabs remain, counter reads "4 of 27 tabs" | 1280×800 |
| | `docs/store/screenshots/03-selection.png` — four tabs selected with the bulk-action bar showing Move to…, Group, Pin, Discard, Close | 1280×800 |
| | `docs/store/screenshots/04-duplicates.png` — the duplicate finder listing two duplicated URLs with a Keep radio per copy | 1280×800 |
| | `docs/store/screenshots/05-snapshots.png` — the snapshot list: automatic, startup and a kept manual snapshot, with Restore/Export/Keep/Delete | 1280×800 |
| Small promo tile | `docs/store/promo-tile-440x280.png` | 440×280 |
| Marquee promo tile | leave empty (optional) | 1400×560 |
| Video | leave empty (none) | |

All five screenshots were captured by `npm run screenshots` from the real
extension running in Chromium, using example pages served locally on port
8771 and mapped to `*.example.com`. Nothing in them is mocked up.

**Additional fields**

| Field | Value |
|---|---|
| Official URL | leave empty, or a verified site you own |
| Homepage URL | `https://github.com/iYazee6-AI/TabVault` |
| Support URL | `https://github.com/iYazee6-AI/TabVault/issues` |
| Mature content | `No` |

## 5. Privacy tab

**Single purpose** (paste):

```
TabVault lists every browser window and tab in one page so the user can search, organise and clean them up, and keeps local snapshots of that session so it can be exported and restored. All data stays in the browser's local extension storage.
```

**Permission justifications** (one box per permission; these are every
permission in `manifest.json` — there are no optional permissions and no host
permissions)

| Permission | When it is requested | Why | Without it |
|---|---|---|---|
| `tabs` | At install, for the life of the extension. | Reads the title, URL, favicon, pinned/muted state, position and group of every tab via `chrome.windows.getAll({populate:true})` so the page can list them, and calls `chrome.tabs.move`, `group`, `ungroup`, `update`, `discard`, `create` and `remove` when the user moves, groups, pins, unloads, opens or closes tabs — plus the same calls when restoring a snapshot or an imported file. | The extension has nothing to show and nothing to restore. |
| `tabGroups` | At install. | Reads native tab groups (`chrome.tabGroups.query`) so they appear inline under their window, and calls `chrome.tabGroups.update` to rename, recolour and collapse them, including when recreating them during a restore. | Groups would be invisible in the listing and lost on restore. |
| `storage` | At install. | `chrome.storage.local` holds the user's settings and the snapshot history; a single value in `chrome.storage.session` tracks when the current burst of tab changes started so a busy browser cannot postpone a snapshot forever. This is the only place any data is kept. | No snapshots, no settings; the extension becomes a read-only viewer. |
| `unlimitedStorage` | At install. | A snapshot stores a full session, and the history is many snapshots; a user with hundreds of tabs exceeds the default extension storage quota, and a quota failure would silently lose a snapshot. This permission lifts that cap. It grants no additional access to anything — only more room in the extension's own local storage. | Snapshots would start failing to save once the history grew past the default quota. |
| `alarms` | At install. | Snapshots are debounced: after tabs stop changing for N seconds (30 by default) one is taken. A Manifest V3 service worker is torn down while idle and cannot hold a timer, so the delay is measured with a single re-armed `chrome.alarms` alarm. No alarm is ever used to poll or to run on a schedule. | Automatic snapshots would be impossible; only manual ones would remain. |
| Host permissions | none | The manifest declares no `host_permissions` and no `optional_host_permissions`, and the extension registers no content scripts and calls no scripting API. It never reads page content. | — |

**Remote code**

| Field | Value |
|---|---|
| Are you using remote code? | `No, I am not using remote code` |
| Justification (if asked) | `All JavaScript ships inside the package: background.js, app/ and lib/. There is no eval, no new Function, no remotely hosted script or stylesheet, and no network request of any kind.` |

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
| Web history | Yes | The addresses and titles of the tabs the user has open, and of the tabs in each stored snapshot. Written only to local extension storage; never transmitted. |
| User activity | No | No clicks, keystrokes or analytics are recorded. |
| Website content | No | No host permissions and no content scripts: the content of pages is never readable. |

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
   - **Screenshot quality.** All five are 1280×800 PNGs of the real UI, which
     is what the store expects; do not crop or rescale them.

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
