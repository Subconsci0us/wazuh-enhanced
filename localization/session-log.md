# localization — Session Log

## 2026-04-21 — Bug fixes: toolbar visibility + dialog injection

### Issue 1 — Toolbar not visible after install
**Symptom:** Plugin installed successfully (present in OSD plugin list, bundle served HTTP 200), but toolbar was not visible on any page.

**Root cause:** OSD applies `transform: scaleX()` to `<body>` during its React bootstrap animation. When any ancestor element has a CSS `transform`, `position: fixed` children are no longer anchored to the viewport — they anchor to the transformed ancestor's coordinate space instead. Combined with `overflow: hidden` on `<body>`, the toolbar was rendered but clipped/invisible.

**Fix:** Replaced the plain `<div>` toolbar container with a `<dialog>` element and call `dialog.show()` (non-modal). `<dialog>` elements are promoted to the browser's **top layer**, a separate rendering surface above all stacking contexts that is immune to ancestor `transform`/`filter` properties. `position: fixed` on a top-layer element anchors correctly to the viewport.

**Additional fix:** OSD's React tree mounts ~300–500 ms after `start()` fires. An early-injected `<div>` can be wiped when OSD calls `replaceChildren()` on body. The dialog approach is immune to this, but we also added a `setTimeout(500)` secondary injection attempt as belt-and-braces, plus MutationObserver now re-injects the toolbar if it's ever removed from the DOM.

**Files changed:** `public/index.js` — `createToolbar()` rewritten to use `<dialog>` + `dialog.show()`; `_mountToolbar()` wrapper added; `start()` updated with setTimeout retry; `startObserver()` MutationObserver callback now checks for toolbar removal.

**Test result:** Toolbar visible in bottom-right corner after Ctrl+Shift+R hard refresh. ✓

---

### Issue 2 — Toolbar shown on all pages (user feedback)
**Symptom:** Toolbar appeared on every page (Agents, Security Events, NLQ Search, etc.), but user only needs it on the main Wazuh home page.

**Fix:** Added navigation-aware visibility logic:

- **Primary method:** Subscribe to `core.application.currentAppId$` (OSD's RxJS Observable, available from `CoreStart` passed to `start(core)`). Shows toolbar only when `appId === 'wz-home'`; hides it on all other app IDs.
- **Fallback method (if OSD API unavailable):** Intercepts `history.pushState` / `history.replaceState` + listens to `popstate` / `hashchange` events. Shows toolbar only when `window.location.pathname` contains `/app/wz-home`.

The toolbar hides/shows without re-creating the `<dialog>` element — just `display: flex` / `display: none` toggled via `_setToolbarVisible()`.

**Cleanup:** `_stopNavListener()` called from `stop()` to unsubscribe Observable / restore original history methods / remove event listeners.

**New functions added:**
- `_isWazuhHome()` — URL-based check
- `_setToolbarVisible(bool)` — show/hide toggle
- `_checkVisibility()` — calls `_setToolbarVisible(_isWazuhHome())`
- `_startNavListener(core)` — wires OSD API or History API fallback
- `_stopNavListener()` — cleanup on plugin stop

**New state variables:** `_appIdSub`, `_origPushState`, `_origReplaceState`

**Files changed:** `public/index.js`

**Status:** Rebuilt and pending reinstall.

---

## 2026-04-21 — Initial build

### Research
- Inspected existing plugins (networkGraph, nlqSearch, complianceView) to catalogue all user-facing strings.
- Confirmed all three custom plugins use vanilla DOM + inline CSS with dark backgrounds (#0d0d1a). The Wazuh Dashboard chrome itself uses OSD 2.19.4 which builds on EUI (Elastic UI Framework).
- CSS class patterns: EUI prefixes `.eui*`; OSD uses `.globalNavContent`, `#osd-top-nav`.
- Existing plugin dark colors: bg #0d0d1a, accent #4fc3f7, text #eee — already dark. Dark mode targets OSD chrome.

### Files created
```
localization/
├── opensearch_dashboards.json   plugin manifest (id: localization, server: true, ui: true)
├── package.json                 webpack devDependencies only, no D3
├── webpack.config.js            standard webpack 5 config, JSON handled natively
├── install.sh                   build + deploy to /usr/share/wazuh-dashboard/plugins/
├── README.md
├── public/
│   ├── bundle_entry.js          OSD bundle registration (window.__osdBundles__.define)
│   └── index.js                 main plugin: toolbar, dark mode, translation engine
├── server/
│   ├── index.js                 minimal server entry (no routes)
│   └── plugin.js                minimal server plugin
└── locales/
    ├── en.json                  46 English strings covering all three custom plugins
    └── ur.json                  46 Urdu translations
```

### Architecture decisions
- Plugin injects toolbar in `start()` lifecycle hook (not via `application.register`) so it appears on EVERY OSD page.
- Dark mode: injects `<style id="fyp-dark-mode">` with ~80 EUI CSS rules into `<head>`. Toggling removes the element.
- Translation: pre-built `EN_TO_UR` and `UR_TO_EN` maps at module load. `applyReplaceMap()` walks DOM text nodes with `TreeWalker`.
- MutationObserver watches `document.body` for `childList` mutations (plugin re-renders). Debounced 150 ms. Re-applies EN→UR map when active.
- RTL: adds `fyp-rtl` CSS class to `document.body`; injected stylesheet applies `direction: rtl` to `.euiPageContentBody` and custom app containers while keeping header/sidebar LTR.
- Preferences stored in `localStorage` keys: `fyp_theme` (`'dark'|'light'`), `fyp_language` (`'en'|'ur'`).
- Global: `window.__fypLocale__.t(key)` / `window.__fypLocale__.lang` for custom plugins that choose to integrate.

### setup.sh changes
- Added `localization` to `ALL_FEATURES` array.
- Added `FEATURE_DESC[localization]`.
- Added `install_localization()` function (delegates to `localization/install.sh`).

### Status
- **BUILT** — source files complete. Not yet installed/tested (requires sudo for dashboard restart).
- **Untested** — see testing checklist below.

---

## Testing checklist (to be completed after install)

**Commands to run:**
```bash
# Build and install
cd /media/sf_sharedfolderclone/wazuh-fyp-repo/localization
sudo bash install.sh

# Verify plugin file installed
sudo ls /usr/share/wazuh-dashboard/plugins/localization/

# Check for server-side errors
journalctl -u wazuh-dashboard --no-pager | grep -i localization | tail -20
```

**Manual tests:**
1. [ ] Toolbar appears (bottom-right pill) on main dashboard page
2. [ ] Toolbar persists when navigating to Agents, Security Events, etc.
3. [ ] Dark mode toggle: colors change across OSD chrome
4. [ ] Dark mode toggle: returns to light mode on second click
5. [ ] Dark mode preference persists after page refresh
6. [ ] Language toggle (اردو): custom plugin text switches to Urdu
7. [ ] Language toggle (EN): reverts to English
8. [ ] Language preference persists after refresh
9. [ ] RTL layout activates for Urdu (text-align right in content area)
10. [ ] networkGraph, nlqSearch, complianceView pages: translations apply
11. [ ] Dark mode + Urdu active simultaneously: both work together

**Known limitations:**
- Dynamic strings (e.g. "42 agent(s) – last updated 14:32") are NOT translated because they're concatenated with runtime data. Only static standalone strings are replaced.
- If an OSD page uses shadow DOM or iframes, translations won't apply inside them (none of our plugins do this).
- MutationObserver may not catch text set via `element.innerHTML` with embedded HTML tags; only bare text nodes are targeted.

---

## 2026-04-23 — Dark mode CSS fixes + default theme reset to light

### Issues addressed

1. **euiBetaBadge white background in dark mode** — section category headings on the Wazuh overview page ("Threat intelligence", "Security operations", etc.) rendered with a white background and grey text instead of dark-themed colours when dark mode was active. The `DARK_CSS` block had `euiBadge` styles but no rules for `euiBetaBadge` / `euiBetaBadge--hollow`.

2. **euiBreadcrumbWall blue background in dark mode** — the breadcrumb wrapper bar showed a distracting blue background in dark mode. `DARK_CSS` had colour rules for `euiBreadcrumb` text but no background reset for the wrapper elements.

3. **Dark mode active by default** — `localStorage` contained `fyp_theme: 'dark'` from prior testing. Because `loadPreferences()` read that key unconditionally, every fresh page load started in dark mode. Default intent is light mode.

### Fixes applied

**`DARK_CSS` additions (in `public/index.js`):**
```css
/* EUI BetaBadge */
.euiBetaBadge { background-color: #1e293b !important; color: #94a3b8 !important; border-color: #334155 !important; }
.euiBetaBadge--hollow { background-color: transparent !important; border: 1px solid #475569 !important; color: #94a3b8 !important; }
.euiCard__betaBadgeWrapper .euiBetaBadge { background-color: #1e293b !important; border-color: #334155 !important; color: #94a3b8 !important; }

/* Breadcrumb wrapper */
.euiBreadcrumbWall { background: transparent !important; }
.euiBreadcrumbWrapper { background: transparent !important; }
```

Removed the old `#cv-root, #ng-root, #nlq-root { background: #0d0d1a !important; }` override — plugins are now light-themed, so dark mode CSS applies to them normally when toggled.

**Default theme reset:**
- `setDarkMode()` now saves to `fyp_theme_v2` instead of `fyp_theme`.
- `loadPreferences()` reads `fyp_theme_v2`. If absent (first run after this update), it writes `'light'` and starts light — the stale `fyp_theme: 'dark'` value is silently ignored.
- Going forward, the dark/light toggle still persists via `fyp_theme_v2`.

### Files changed

| File | Change |
|------|--------|
| `public/index.js` | `DARK_CSS`: added `euiBetaBadge` + `euiBreadcrumbWall` rules; removed stale plugin-bg override |
| `public/index.js` | `setDarkMode()`: localStorage key → `fyp_theme_v2` |
| `public/index.js` | `loadPreferences()`: reads `fyp_theme_v2`; defaults to `'light'` on first run |

### Status

Built, installed, compressed variants regenerated, dashboard restarted. ✓

---
## Session 2026-04-23 (FIX 1 — toolbar redesign)

### Changes to public/index.js

**Theme button hidden (TEMPORARY)**
- `themeBtn` still created but `themeBtn.style.display = 'none'` added
- Theme logic (`setDarkMode`, `fyp_theme_v2` localStorage key) fully preserved
- `setDarkMode()` now dispatches `fyp-theme-changed` CustomEvent:
  ```js
  window.dispatchEvent(new CustomEvent('fyp-theme-changed', { detail: { theme: enabled ? 'dark' : 'light' } }));
  ```
  Custom plugins subscribe to this event to toggle their `.dark-theme` class.

**EN/UR button redesign**
- Replaced single toggle `langBtn` with two always-visible buttons: `enBtn` and `urBtn`
- Both appended to the `<dialog>` toolbar
- New `LANG_BTN_BASE` constant holds shared button styles (no color)
- New `_syncLangBtns(enBtn, urBtn)` function applies:
  - Active language: `background:#3b82f6; color:#fff; border:1px solid #3b82f6` (solid blue)
  - Inactive language: `background:transparent; color:#94a3b8; border:1px solid #475569` (muted/outlined)
- Styling is theme-independent (fixed colors, not inherited from OSD theme)
- `setLanguage()` calls `_syncLangBtns()` on every language change

### Build & install
- Built in /tmp/localization-build (`webpack compiled successfully`)
- Installed to `/usr/share/wazuh-dashboard/plugins/localization/target/public/localization.plugin.js`
- Wazuh-dashboard restarted — service active ✓

### Cross-plugin theme coordination

The `fyp-theme-changed` CustomEvent dispatched by `setDarkMode()` is consumed by:
- `networkGraph/public/index.js` — toggles `.dark-theme` on its SVG canvas root
- `complianceView/public/index.js` — toggles `.dark-theme` on `.cv-root`
- `complianceView/patch_bundles.py` MOUNT_FN — toggles `.dark-theme` on `.cv-ov`

All three listeners call `window.removeEventListener` on unmount to avoid memory leaks.

---

## 2026-04-24 — install.sh updated to be fully documented

`localization/install.sh` rewritten to:
- Document dual EN/UR buttons (always visible, no toggle-based approach)
- Document active button style: `background:#3b82f6; color:#fff` (solid blue)
- Document inactive button style: `transparent; color:#94a3b8; border:#475569` (muted outline)
- Document that theme button is hidden (`display:none`) — TEMPORARY
- Document `fyp_theme_v2` default of `'light'`
- Document `fyp-theme-changed` CustomEvent — how other plugins react to it
- Matches localization/README.md for consistent documentation

No source code changes in this session — documentation and install.sh only.

---

## 2026-04-24 — Comprehensive Urdu translation coverage

**Developer:** Claude Sonnet 4.6
**Scope:** Expand en.json and ur.json to cover all visible UI strings across all three plugins

### Problem

The DOM text-replacement system (TreeWalker + MutationObserver) only translates strings whose exact text node content is present as a value in en.json. Many strings in networkGraph, nlqSearch, and complianceView were missing from the locale files, so they remained in English when Urdu mode was active.

### What changed

#### localization/locales/en.json — 18 new keys added

| Key | String |
|-----|--------|
| `ng.title.full` | `⛎ Wazuh Network Graph` (with emoji, matches DOM text node) |
| `ng.legend.peer.full` | `┅┅ Agent-to-agent (peer)` (with box-drawing chars) |
| `ng.sidebarTitle` | `Recent Incidents` |
| `ng.waitingData` | `Waiting for data…` |
| `ng.allSeverities` | `All severities` |
| `ng.highPlus` | `High+ (≥12)` |
| `ng.mediumPlus` | `Medium+ (≥7)` |
| `ng.emptyLine1` | `No incidents in the last 5 minutes.` |
| `ng.emptyLine2` | `System is quiet.` |
| `ng.showAll` | `Show all {count} incidents` (template — used via `_tFmt()`) |
| `ng.lastRefresh` | `Last refresh: {time}` (template) |
| `ng.agentsStatus` | `{count} agent(s) – last updated {time}` (template) |
| `nlq.title.full` | `🔍 NLQ Search` (with emoji) |
| `nlq.busy.translating` | `Translating…` |
| `nlq.busy.transpiling` | `Transpiling…` |
| `nlq.dslInputTitle` | `Wazuh DSL Query (JSON)` |
| `nlq.runningQuery` | `Running query…` |
| `nlq.notSecurity` | `Not a security query — please enter a security detection request.` |
| `cv.loadingFrameworks` | `Loading frameworks…` |
| `cv.overlapDesc` | Full overlap section description paragraph |
| `cv.matrixLegend` | Matrix diagonal/off-diagonal legend line |
| `cv.lastUpdated` | `Last updated: {time}` (template) |

All new keys have corresponding Urdu translations in ur.json.

#### localization/locales/ur.json — 18 new keys added (all correct Urdu)

Selected translations of note:
- `ng.sidebarTitle`: حالیہ واقعات
- `ng.waitingData`: ڈیٹا کا انتظار ہے…
- `ng.allSeverities`: تمام شدتیں
- `ng.emptyLine1`: گزشتہ 5 منٹ میں کوئی واقعہ نہیں۔
- `ng.emptyLine2`: نظام پرسکون ہے۔
- `nlq.notSecurity`: یہ سیکیورٹی سے متعلق سوال نہیں — براہ کرم سیکیورٹی درخواست درج کریں۔
- `cv.overlapDesc`: ہر خانہ ظاہر کرتا ہے کہ منتخب وقت کی حد میں کتنے الرٹس نے ایک ساتھ دونوں فریم ورکس میں خلاف ورزی کی۔ زیادہ اوورلیپ کا مطلب ہے کہ ایک واقعہ کا متعدد ضابطوں پر اثر پڑا۔
- `cv.matrixLegend`: قطری = اس فریم ورک کے کل الرٹس۔ غیر قطری = ایک ساتھ دونوں فریم ورکس کو متاثر کرنے والے الرٹس۔

### Why DOM replacement isn't enough for dynamic strings

The TreeWalker replaces text nodes whose trimmed content exactly matches an en.json value. Dynamic strings like `"3 agent(s) – last updated 12:34:56 PM"` contain runtime values and will never match any static locale key. Template keys (with `{placeholders}`) require plugin-side code to call `_tFmt()`.

### Plugin code changes

Two plugins were updated with a `_t()` / `_tFmt()` helper pair and had their dynamic string concatenations replaced:

**networkGraph/public/index.js** (3 lines changed):
- `showAllBtn.textContent`: now uses `_tFmt('ng.showAll', { count })`
- `subtitleEl.textContent`: now uses `_tFmt('ng.lastRefresh', { time })`
- `statusEl.textContent` (agent count): now uses `_tFmt('ng.agentsStatus', { count, time })`

**complianceView/public/index.js** (1 line changed):
- `refs.statusEl.textContent`: now uses `_tFmt('cv.lastUpdated', { time })`

nlqSearch required no code changes — all its visible strings are static and handled by DOM replacement once added to locale files.

### Strings NOT translated (intentional)

- Tooltip labels inside the D3 graph (`"ID:"`, `"IP:"`, `"OS:"`, `"Status:"`) — concatenated with live API data, can't match statically
- Error messages that include dynamic API error text
- `"toolbar.switchToEn": "Switch to English"` in ur.json — kept in English intentionally (label for English speakers switching back)

### Rebuild required

All three affected plugins plus the localization plugin must be rebuilt for changes to take effect:

```bash
sudo bash /media/sf_sharedfolderclone/wazuh-fyp-repo/localization/install.sh
sudo bash /media/sf_sharedfolderclone/wazuh-fyp-repo/networkGraph/install.sh
sudo bash /media/sf_sharedfolderclone/wazuh-fyp-repo/nlqSearch/install.sh
sudo bash /media/sf_sharedfolderclone/wazuh-fyp-repo/complianceView/install.sh
```

Or run the master install script:
```bash
sudo bash /media/sf_sharedfolderclone/wazuh-fyp-repo/setup.sh
```

### Status

Source files updated. Rebuild required. Untested on live instance.

---

## 2026-04-24 — Session 3: failsafes + deployment

### Changes

**complianceView/public/index.js** — Added `_CV_EN` English fallback map to `_t()`:
```js
var _CV_EN = { 'cv.lastUpdated': 'Last updated: {time}' };
function _t(key) {
  return (window.__fypLocale__ && window.__fypLocale__.t(key)) || _CV_EN[key] || key;
}
```
Prevents key-name bleed-through when localization plugin is absent (same fix already applied to networkGraph in this session).

**localization/public/index.js** — Moved `window.__fypLocale__` assignment from `start()` into `setup()` so the object is available immediately during OSD bootstrap, before `start()` fires. `start()` now just updates `.lang` to keep it current.

**setup.sh** — Added localization dependency check after `FEATURES_TO_RUN` is built. If any UI plugin (networkGraph/nlqSearch/complianceView) is selected but `localization` is not, a prominent yellow warning box is printed before installation begins.

**localization/README.md** — Updated key count 46→68; removed outdated "dynamic strings not translated" limitation; added `_t()/_tFmt()` pattern section for plugin developers; noted `__fypLocale__` is now set in `setup()`.

**README.md (root)** — Added `localization` row to features table; added "Localization dependency" callout explaining that UI plugins require the localization plugin for Urdu support.

### Deployment

All four plugins rebuilt and reinstalled:
- localization  — OK
- networkGraph  — OK
- nlqSearch     — OK
- complianceView — OK

All four `wazuh-dashboard` restarts reported `active`. Deployment complete.
