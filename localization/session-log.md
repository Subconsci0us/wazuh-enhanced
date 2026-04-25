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

---

## 2026-04-25 — Site-wide Urdu localization expansion plan

### Research findings

Before planning, the live system was audited. Key facts that shape every decision below:

**1. Wazuh plugin strings are hardcoded**
`wazuh.plugin.js` + 20 chunk files contain ~7 000+ string literals. The Wazuh plugin's `translations/en-US.json` is empty — Wazuh does NOT use `@osd/i18n` keys for its own UI strings. They are compiled directly into the minified bundle. This means the OSD native i18n system cannot translate Wazuh-specific text. **DOM text-node replacement is the only viable approach for all Wazuh strings.**

**2. OSD Core uses the native i18n system**
OSD itself has 2 562 i18n keys (namespaces: `core.*`, `dashboard.*`, `opensearch-dashboards-react.*`, `queryEnhancements.*`, `data.*`, `visualize.*`, etc.). These are rendered via React `<FormattedMessage>` components and resolved at render time by `@osd/i18n.translate()`. Changing locale for these requires server-side registration of a `ur-PK.json` file + an OSD restart (or page reload with `?i18n-locale=ur-PK`). DOM replacement is still needed as a fallback because React renders asynchronously.

**3. OSD locale switching requires a page reload**
OSD reads its locale from config (`opensearch_dashboards.yml → i18n.locale`) or a URL query param (`?i18n-locale=ur-PK`) at bootstrap time. There is no client-side dynamic locale switch. The approach for Phase 6 is: server registers `ur-PK.json`, and when the user clicks "UR" the page reloads with `?i18n-locale=ur-PK` in the URL. On reload, OSD renders all `<FormattedMessage>` components in Urdu. When the user clicks "EN" the page reloads without the param (or with `?i18n-locale=en-US`).

**4. Current translation coverage**
68 keys, all in custom plugins (networkGraph, nlqSearch, complianceView). Toolbar only visible on `wz-home`. DOM replacement already runs on every page — the only restriction is the toolbar being hidden outside home.

**5. DOM replacement already works site-wide**
The MutationObserver is active on all pages. The TreeWalker + debounce approach already re-applies translations when any React component re-renders. The foundation is sound; the gap is purely string catalog coverage.

---

### Architecture for full-site localization

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LOCALIZATION PLUGIN — two-track approach                 │
├─────────────────────────────────────────┬───────────────────────────────────┤
│  TRACK A — DOM replacement              │  TRACK B — OSD native i18n        │
│  (Wazuh plugin strings + fallback)      │  (OSD Core / EUI chrome strings)  │
│                                         │                                   │
│  • TreeWalker on document.body          │  • server/plugin.js registers      │
│  • MutationObserver (already running)   │    ur-PK.json via                 │
│  • Covers: Wazuh Overview, Agents,      │    i18n.registerTranslationFile() │
│    all security modules, Management,    │  • ur-PK.json covers ~200 priority │
│    OSD navbar text nodes                │    core.*, dashboard.*,            │
│  • ~350+ new keys in en.json/ur.json    │    queryEnhancements.* keys        │
│  • Instant (no reload)                  │  • On "UR" click: reload with      │
│                                         │    ?i18n-locale=ur-PK              │
│                                         │  • On "EN" click: reload without   │
└─────────────────────────────────────────┴───────────────────────────────────┘
```

Track A gives instant Urdu for all Wazuh content. Track B gives correct Urdu for OSD chrome (Discover, Dashboard management, Settings). Both tracks fire together; Track B's page-reload approach means OSD chrome strings are correct on second paint, while Track A keeps custom plugin strings correct even without a reload.

---

### Phase 0 — Unblock toolbar on all pages

**File**: `localization/public/index.js`

**Change**: Replace the `_isWazuhHome()` check in `_startNavListener()` with always-visible logic. The toolbar currently only appears on `/app/wz-home`. For site-wide localization this must be removed — users need the EN/UR toggle on every page.

```js
// Before: _appIdSub = core.application.currentAppId$.subscribe(function(appId) {
//   _setToolbarVisible(appId === 'wz-home' || !appId);
// });

// After:
_appIdSub = core.application.currentAppId$.subscribe(function() {
  _setToolbarVisible(true);
});
// Also update _isWazuhHome() fallback to always return true
```

Also update `_checkVisibility()` to always call `_setToolbarVisible(true)`.

**Impact**: Toolbar appears on every Wazuh page (Overview, Agents, Threat Hunting, Discover, Settings, etc.).

---

### Phase 1 — Wazuh Overview / Home page strings (~60 new keys)

**Visible sections** (inspected from live instance):

| Section | Strings to add |
|---------|---------------|
| Section category badges | "Threat intelligence", "Security operations", "Endpoint security", "Auditing and policy monitoring", "IT Hygiene", "Cloud security", "Regulatory Compliance" |
| Module cards | "Security Events", "Integrity Monitoring", "Policy Monitoring", "Vulnerability Detection", "Malware Detection", "Threat Hunting", "Configuration Assessment", "MITRE ATT&CK" |
| Module card descriptions | 8 description strings (one per module card) |
| AWS / Azure / Google Cloud / Office 365 / GitHub / Docker | Display names |
| Status pills | "Active", "Disconnected", "Never connected", "Pending" |
| Header row | "Overview", "Agents", "Management", "Dev Tools", "Explore", "Discover" |
| Agent summary widget | "Agents by Status", "Total agents", "Active", "Disconnected", "Never connected" |

**Key naming convention** (new namespace `wz.*`):
```
wz.section.threatIntel     = "Threat intelligence"
wz.section.secOps          = "Security operations"
wz.module.securityEvents   = "Security Events"
wz.module.fim              = "File Integrity Monitoring"
wz.module.vuln             = "Vulnerability Detection"
...
wz.status.active           = "Active"
wz.status.disconnected     = "Disconnected"
wz.status.neverConnected   = "Never connected"
wz.status.pending          = "Pending"
```

**Urdu translations** (sample):
- "Threat intelligence" → "خطرات کی معلومات"
- "Security Events" → "سیکیورٹی واقعات"
- "File Integrity Monitoring" → "فائل سالمیت نگرانی"
- "Vulnerability Detection" → "کمزوریوں کا پتہ لگانا"
- "Active" → "فعال"
- "Disconnected" → "منقطع"

---

### Phase 2 — Navigation sidebar strings (~40 new keys)

The left collapsible nav renders text nodes that the TreeWalker already sees. All nav item labels need to be added to the catalog.

**Sidebar sections**:

| Nav group | Items |
|-----------|-------|
| Top-level | "Home", "Overview", "Agents" |
| Threat Detection | "Security Events", "Threat Hunting", "File Integrity Monitoring", "Malware Detection", "Vulnerability Detection", "MITRE ATT\&CK", "Configuration Assessment" |
| Auditing | "Policy Monitoring", "System Auditing" |
| Regulatory | "PCI DSS", "GDPR", "HIPAA", "NIST 800-53", "TSC" |
| Cloud | "AWS", "Azure", "Google Cloud", "Office 365", "GitHub", "Docker" |
| Management | "Rules", "Decoders", "CDB Lists", "Groups", "Cluster", "Status", "Logs", "Settings", "Ruleset Test" |
| OSD | "Discover", "Dashboard", "Visualize", "Dev Tools", "Reports", "Advanced Settings", "Index Patterns", "Dashboard management" |

**Key naming**: `nav.*` namespace.

**RTL consideration for sidebar**: The sidebar is currently excluded from RTL (`direction: ltr !important`) to keep icons in the correct position. Nav item text itself should still read RTL when Urdu is active. Phase 10 addresses this with targeted CSS: keep icon+text-container LTR, but let the text node inside use `unicode-bidi: embed`.

---

### Phase 3 — Agents page strings (~50 new keys)

**Agents list table columns**:
`wz.agents.col.name`, `.id`, `.status`, `.ip`, `.group`, `.os`, `.version`, `.actions`, `.lastKeepAlive`, `.registerDate`

English → Urdu:
- "Name" → "نام"
- "ID" → "شناخت"
- "Status" → "حالت"
- "IP address" → "آئی پی پتہ"
- "Group" → "گروپ"
- "Operating system" → "آپریٹنگ سسٹم"
- "Version" → "ورژن"
- "Actions" → "اقدامات"

**Agents page headings / filters**:
- "Agents management" → "ایجنٹس کا انتظام"
- "Add agent" → "ایجنٹ شامل کریں"
- "Agent filter" → "ایجنٹ فلٹر"
- "All agents" → "تمام ایجنٹس"
- "No agents found" → "کوئی ایجنٹ نہیں ملا"
- "Agents summary" → "ایجنٹس خلاصہ"
- "Agent enrollment" → "ایجنٹ اندراج"

**Agent detail panel** (flyout that opens on row click):
- "Agent information", "Configuration", "Groups", "Vulnerabilities", "Events", "Inventory", "Configuration Assessment"

---

### Phase 4 — Security module strings (~80 new keys)

Each security module is a React SPA that re-renders on navigation. The MutationObserver already catches these re-renders. We need to add the static strings from each module.

**4.1 Threat Hunting (Security Events)**
- Dashboard header: "Threat Hunting", "Add filter", "Search alerts"
- Table columns: "Timestamp", "Agent", "Rule description", "Level", "Rule ID", "Technique", "Tactic"
- Empty state: "No alerts found for the selected time range."
- Severity labels: "Critical", "High", "Medium", "Low", "Informational"

**4.2 File Integrity Monitoring**
- "File Integrity Monitoring dashboard"
- Event types: "Added", "Modified", "Deleted", "Permissions changed", "Ownership changed"
- Columns: "File", "Action", "Date", "Agent", "Rule"

**4.3 Vulnerability Detection**
- "Vulnerability Detection"
- Severity pills: "Critical", "High", "Medium", "Low"
- Columns: "CVE", "Package", "Version", "Fix version", "Published", "Affected agents"

**4.4 MITRE ATT&CK**
- "MITRE ATT&CK" (keep acronym, add Urdu subtitle)
- "Tactics", "Techniques", "Sub-techniques"
- "Explore security alerts mapped to adversary tactics and techniques for better threat understanding." → long description

**4.5 Configuration Assessment**
- "Policy Monitoring"
- "Pass" → "کامیاب", "Fail" → "ناکام", "Not applicable" → "قابل اطلاق نہیں"
- Columns: "ID", "Description", "Rationale", "Result", "Remediation"

**4.6 Malware Detection**
- "Malware Detection"
- Event columns matching Threat Hunting pattern

**4.7 AWS / Azure / Google Cloud modules**
- Module name labels + dashboard section headings (short, non-technical: service names stay in English)
- "AWS dashboard", "Azure Logs", "Google Cloud Pub/Sub"

**Key insight for modules**: React re-renders the entire module content on tab switch. The MutationObserver + 150 ms debounce catches this. No additional observer logic is needed — only the string catalog matters.

---

### Phase 5 — Management section strings (~70 new keys)

**5.1 Rules**
- Page title: "Rules" → "قوانین"
- Columns: "ID" → "شناخت", "Level" → "سطح", "Description" → "تفصیل", "Groups" → "گروپس", "File" → "فائل", "Status" → "حالت"
- Filters: "Search rules", "Filter by group", "Filter by level", "Filter by file", "Filter by status"
- Status: "Enabled" → "فعال", "Disabled" → "غیر فعال"

**5.2 Decoders**
- Columns: "Name" → "نام", "Type" → "قسم", "File" → "فائل", "Parents" → "والدین"

**5.3 CDB Lists**
- "CDB Lists" → "CDB فہرستیں"
- "Add list", "Delete list", "Import list"

**5.4 Groups**
- "Groups" → "گروپس"
- Columns: "Name", "Agents count", "Configuration status", "Actions"
- "Add group" → "گروپ شامل کریں"

**5.5 Cluster / Status**
- "Cluster" → "کلسٹر"
- "Master node" → "ماسٹر نوڈ", "Worker node" → "ورکر نوڈ"
- "Running" → "چل رہا ہے", "Stopped" → "بند"
- "Cluster status", "Daemons status"

**5.6 Logs**
- "Logs" → "لاگز"
- Log level labels: "Information" → "معلومات", "Warning" → "تنبیہ", "Error" → "خرابی", "Debug" → "ڈیبگ"

**5.7 Settings**
- Top-level: "Settings" → "ترتیبات", "API Connections" → "API روابط"
- "Add API connection" → "API رابطہ شامل کریں"
- "About" → "بارے میں"

---

### Phase 6 — Server-side OSD native i18n registration

**Goal**: Translate OSD Core strings (Discover UI, Dashboard panels, Settings screens) that use `<FormattedMessage>` and cannot be reached by DOM replacement until after a React re-render.

**File**: `localization/server/plugin.js`

**Change**: In the `setup(core)` method, call `core.i18n.registerTranslationFile(absolutePath)` to register `localization/locales/ur-PK.json` (a new file, separate from `ur.json`). This makes OSD serve the translations at `/translations/ur-PK.json` on the next OSD start.

```js
// server/plugin.js — setup method
const path = require('path');
setup(core) {
  core.i18n.registerTranslationFile(
    path.resolve(__dirname, '../locales/ur-PK.json')
  );
  return {};
}
```

**`locales/ur-PK.json`** — new file, format mirrors the OSD translation files:
```json
{
  "locale": "ur-PK",
  "messages": {
    "core.application.appNotFound.title": "ایپلیکیشن نہیں ملی",
    "dashboard.actions.toggleExpandPanelMenuItem.expandedDisplayName": "چھوٹا کریں",
    "dashboard.actions.toggleExpandPanelMenuItem.notExpandedDisplayName": "پینل بڑا کریں",
    ...
  }
}
```

**Priority keys to include** (~200 of the most visible OSD chrome strings):
- `core.*` — "Application not found", browser deprecation warnings, table select/sort controls
- `dashboard.*` — Panel actions, "Add panel", "Add visualization", empty state, clone, rename
- `opensearch-dashboards-react.*` — Range controls, edit dropdown labels
- `queryEnhancements.*` — Query language switcher, banner, callout messages
- `data.*` (subset) — Date picker labels, search bar labels
- `visualize.*` (subset) — "New visualization", "Edit", "Save"

This requires ~4–6 hours of translation work to produce the `ur-PK.json` keys file.

---

### Phase 7 — Client-side locale switch on language toggle

**Goal**: When the user clicks "UR", trigger an OSD page reload with `?i18n-locale=ur-PK` so `<FormattedMessage>` components render in Urdu. When the user clicks "EN", reload without that param (or with `?i18n-locale=en-US`).

**File**: `localization/public/index.js` — `setLanguage()` function

**Change**:
```js
function setLanguage(lang) {
  if (lang !== 'en' && lang !== 'ur') return;
  try { localStorage.setItem('fyp_language', lang); } catch (_) {}

  if (lang === 'ur') {
    // Track A: instant DOM replacement
    _applyDomTranslations();
    // Track B: reload with OSD locale param so FormattedMessage components render in Urdu
    var url = new URL(window.location.href);
    url.searchParams.set('i18n-locale', 'ur-PK');
    window.location.replace(url.toString());
    return; // reload handles the rest
  } else {
    // Revert Track A immediately
    _applyReplaceMap(UR_TO_EN);
    // Track B: reload without locale param
    var url = new URL(window.location.href);
    url.searchParams.delete('i18n-locale');
    window.location.replace(url.toString());
    return;
  }
}
```

**`loadPreferences()` change**: On page load, if `localStorage.fyp_language === 'ur'` AND `i18n-locale=ur-PK` is already in the URL, apply only Track A (DOM replacement) — no reload needed. If `localStorage.fyp_language === 'ur'` but the URL param is absent, trigger the reload.

**Fallback**: If Phase 6 server registration is not yet complete (localization plugin server doesn't export `i18n.registerTranslationFile`), the reload will still apply Track A DOM replacements on load without any OSD chrome Urdu — a graceful degradation.

---

### Phase 8 — Attribute translation expansion

The current `_applyReplaceMap()` already handles `placeholder` attributes. Expand to:

**New attribute targets** in `_applyReplaceMap()`:

```js
// title attributes (button tooltips, column header titles)
document.querySelectorAll('[title]').forEach(function(el) {
  if (_isInsideToolbar(el)) return;
  var t = (el.getAttribute('title') || '').trim();
  if (t && replaceMap[t]) el.setAttribute('title', replaceMap[t]);
});

// aria-label attributes (screen reader + visible labels for icon buttons)
document.querySelectorAll('[aria-label]').forEach(function(el) {
  if (_isInsideToolbar(el)) return;
  var a = (el.getAttribute('aria-label') || '').trim();
  if (a && replaceMap[a]) el.setAttribute('aria-label', replaceMap[a]);
});

// alt attributes (images with descriptive alt text)
document.querySelectorAll('img[alt]').forEach(function(el) {
  var alt = (el.getAttribute('alt') || '').trim();
  if (alt && replaceMap[alt]) el.setAttribute('alt', replaceMap[alt]);
});
```

**Keys to add for attributes** (~30 new keys):
- Button `title` values: "Sort ascending", "Sort descending", "Filter", "Remove filter", "Close", "Expand row", "Collapse row", "Delete", "Edit", "Refresh"
- `aria-label` values for icon buttons: "Add filter", "Delete filter", "Toggle row details", "Open menu", "Close flyout"

---

### Phase 9 — Dynamic string pattern matching (regex fallback)

Some Wazuh strings are dynamic but follow predictable patterns:
- "Showing 1 - 25 of 1,234 agents"
- "Last updated: 2 minutes ago"
- "Showing page 3 of 12"

These will never match exact keys. Add a `_applyPatternTranslations(map)` function that runs after `_applyReplaceMap()`:

```js
var PATTERNS_EN_TO_UR = [
  {
    re: /^Showing (\d[\d,]*) - (\d[\d,]*) of (\d[\d,]*)(.*)$/,
    fn: function(m) {
      return m[1] + ' سے ' + m[2] + ' تک، کل ' + m[3] + m[4];
    }
  },
  {
    re: /^(\d+) agent\(s\)(.*)$/,
    fn: function(m) { return m[1] + ' ایجنٹ' + m[2]; }
  },
  // ... additional patterns
];

function _applyPatternTranslations() {
  if (_lang !== 'ur') return;
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, ...);
  var node;
  while ((node = walker.nextNode())) {
    var text = node.textContent.trim();
    for (var i = 0; i < PATTERNS_EN_TO_UR.length; i++) {
      var m = text.match(PATTERNS_EN_TO_UR[i].re);
      if (m) {
        node.textContent = node.textContent.replace(text, PATTERNS_EN_TO_UR[i].fn(m));
        break;
      }
    }
  }
}
```

Call `_applyPatternTranslations()` after each `_applyReplaceMap()` call and in the MutationObserver callback.

**Scope**: 10–15 patterns covering the most common dynamic text forms.

**Note**: Pattern replacement runs only when `_lang === 'ur'` and only on text nodes not already replaced by the exact-match pass.

---

### Phase 10 — RTL CSS expansion for full site

The current `RTL_CSS` targets `euiPageBody`, `euiPageContent`, `euiPageContentBody`, and specific application containers. For full-site RTL, expand to cover:

**New RTL CSS rules**:

```css
/* Sidebar nav item text (direction embed keeps icons LTR, text RTL) */
.fyp-rtl .euiListGroupItem__label {
  unicode-bidi: embed;
  direction: rtl;
}

/* Flyout panels opened from anywhere */
.fyp-rtl .euiFlyout,
.fyp-rtl .euiFlyoutBody {
  direction: rtl !important;
}
.fyp-rtl .euiFlyoutHeader { direction: ltr !important; } /* header icons stay LTR */

/* Modal dialogs */
.fyp-rtl .euiModal__flex { direction: rtl !important; }
.fyp-rtl .euiModalHeader { direction: ltr !important; }

/* Context menus / dropdowns */
.fyp-rtl .euiContextMenuPanel { direction: rtl !important; }
.fyp-rtl .euiPopover__panel { direction: rtl !important; }

/* Breadcrumbs — reverse display order via flex-direction */
.fyp-rtl .euiBreadcrumbs { flex-direction: row-reverse !important; }

/* EUI accordion expand/collapse arrows flip */
.fyp-rtl .euiAccordion__iconWrapper { transform: scaleX(-1); }

/* Align status badges */
.fyp-rtl .euiBadge { direction: rtl !important; }

/* Tables */
.fyp-rtl .euiTable { direction: rtl !important; }
.fyp-rtl .euiTableHeaderCell,
.fyp-rtl .euiTableRowCell { text-align: right !important; }
```

**Preserve LTR for**:
- Toolbar (already has `direction: ltr !important`)
- Code blocks / pre / `.euiCode` (technical content stays LTR)
- EUI icons (SVG, stays neutral)
- Input/search bars: keep `direction: ltr` for query strings, IP addresses, CVE IDs

---

### Phase 11 — Locale persistence and UX polish

**Persistence across sessions** (current + enhancements):
- `localStorage.fyp_language` → already used for Track A
- On page load, `loadPreferences()` reads `fyp_language`. If `'ur'` and URL lacks `i18n-locale=ur-PK`, `setLanguage('ur')` fires the reload immediately (before any visible content renders, since it's called 500 ms after `start()`).
- To avoid reload-loop: check if URL already has `?i18n-locale=ur-PK` before reloading.

```js
function loadPreferences() {
  var savedLang = localStorage.getItem('fyp_language');
  var savedTheme = localStorage.getItem('fyp_theme_v2') || 'light';
  if (savedTheme === 'dark') setDarkMode(true);
  if (savedLang === 'ur') {
    var currentParam = new URL(window.location.href).searchParams.get('i18n-locale');
    if (currentParam !== 'ur-PK') {
      // Need reload for OSD chrome — but apply DOM translations immediately while reload fires
      _lang = 'ur';
      _applyReplaceMap(EN_TO_UR);
      _syncLangBtn();
      document.body.classList.add('fyp-rtl');
      injectStyle('fyp-rtl-style', RTL_CSS);
      // Trigger reload for Track B
      var url = new URL(window.location.href);
      url.searchParams.set('i18n-locale', 'ur-PK');
      window.location.replace(url.toString());
    } else {
      // URL already has the param — OSD chrome is in Urdu. Apply DOM replacements only.
      setLanguage('ur');
    }
  }
}
```

**Toolbar label update**: When on a page with `?i18n-locale=ur-PK`, the "EN" button should make clear it will reload the page. Add a subtitle or `title` tooltip: `"Switch to English (page will reload)"`.

---

### Phase 12 — Testing checklist

**Per-page test matrix** (test each in both EN and UR, with both Light and Dark themes):

| Page | Key checks |
|------|-----------|
| wz-home (Overview) | Section badges, module cards, agent summary widget |
| Agents list | Table columns, status pills, search bar placeholder |
| Agent detail flyout | Info tabs, section headers |
| Threat Hunting | Dashboard header, filter bar, table columns, empty state |
| File Integrity Monitoring | Event type labels, columns |
| Vulnerability Detection | Severity pills, columns, CVE table |
| MITRE ATT\&CK | Tactic/technique labels |
| Configuration Assessment | Pass/Fail/N-A labels, policy columns |
| Malware Detection | Module title, event columns |
| Management → Rules | Column headers, filter dropdowns, status labels |
| Management → Decoders | Column headers |
| Management → CDB Lists | Page title, actions |
| Management → Groups | Column headers, agent count |
| Management → Cluster | Node type labels, daemon status |
| Management → Status | Running/Stopped labels |
| Management → Logs | Log level labels |
| Management → Settings | Section headers, API connection UI |
| OSD Discover (EN) | Search bar placeholder, date picker, column headers |
| OSD Discover (UR) | Same with Phase 6 server i18n active |
| OSD Dashboard management | Panel actions, add panel |
| Dark mode + Urdu active | Verify no CSS conflicts |
| Page reload persistence | Reload in Urdu — stays Urdu on every page |
| Navigate between pages | Urdu persists on SPA navigation (MutationObserver) |

**Regression checks**:
- Custom plugins (networkGraph, nlqSearch, complianceView) still translate correctly
- `_t()` / `_tFmt()` helpers in networkGraph and complianceView still work
- `window.__fypLocale__` still exposed after all changes
- `fyp-theme-changed` CustomEvent still fires on dark/light toggle
- Toolbar visible on all pages, not only wz-home

---

### Implementation order and effort estimate

| Phase | Files changed | Effort | Dependencies |
|-------|--------------|--------|--------------|
| 0 — Toolbar on all pages | `public/index.js` (5 lines) | 15 min | None |
| 1 — Overview strings | `locales/en.json`, `locales/ur.json` | 2 h | Phase 0 |
| 2 — Sidebar nav strings | `locales/en.json`, `locales/ur.json` | 1.5 h | Phase 0 |
| 3 — Agents page strings | `locales/en.json`, `locales/ur.json` | 2 h | Phase 0 |
| 4 — Security module strings | `locales/en.json`, `locales/ur.json` | 3 h | Phase 0 |
| 5 — Management strings | `locales/en.json`, `locales/ur.json` | 2 h | Phase 0 |
| 6 — Server-side OSD i18n | `server/plugin.js`, `locales/ur-PK.json` (new) | 3 h | Phase 0 |
| 7 — Client locale switch (reload) | `public/index.js` | 1 h | Phase 6 |
| 8 — Attribute translation | `public/index.js`, `locales/*.json` | 1.5 h | Phase 1–5 |
| 9 — Pattern matching | `public/index.js` | 1.5 h | Phases 1–5 |
| 10 — RTL expansion | `public/index.js` (RTL_CSS block) | 1 h | Phase 0 |
| 11 — Persistence UX | `public/index.js` | 1 h | Phases 6–7 |
| 12 — Testing | Manual | 3 h | All phases |
| **Total** | | **~23 h** | |

**Recommended execution order**: Phase 0 → 1 → 2 → 3 → 10 → 4 → 5 → 8 → 9 → 6 → 7 → 11 → 12. Phases 1–5 and 8–9 are pure data work (adding keys); they can be interleaved with Phase 0 and 10 code changes in one session. Phases 6–7 are a separate server-side session with an OSD restart required.

---

### New files to create

| File | Purpose |
|------|---------|
| `locales/ur-PK.json` | OSD native i18n translations (Phase 6). Separate from `ur.json` to keep concerns isolated — `ur.json` is DOM-replacement data, `ur-PK.json` is OSD i18n key data. |

### Files to modify

| File | Changes |
|------|---------|
| `public/index.js` | Phase 0 (toolbar), Phase 7 (locale switch reload), Phase 8 (attribute translation), Phase 9 (pattern matching), Phase 10 (RTL CSS), Phase 11 (persistence) |
| `locales/en.json` | Phases 1–5, 8: ~350 new keys |
| `locales/ur.json` | Phases 1–5, 8: ~350 new Urdu translations |
| `server/plugin.js` | Phase 6: register `ur-PK.json` |
| `install.sh` | Update documentation to reflect expanded scope |
| `README.md` | Update key count, architecture section, add Phase 6 instructions |

### Status

**Plan complete. No implementation started.**
