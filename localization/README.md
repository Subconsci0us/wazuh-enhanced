# localization — Wazuh Dashboard Localization & Theme Plugin

OSD 2.19.4 plugin that injects a persistent floating toolbar into every Wazuh Dashboard page providing Urdu/English translation, RTL layout, and dark/light theming.

---

## Features

| Feature | Description |
|---------|-------------|
| **Language toggle** | Single-click EN↔UR switch. Reloads page with `?locale=ur-PK` so OSD native React components also render in Urdu. |
| **Urdu translation** | 561 exact-match strings + 49 regex patterns covering every user-facing page. |
| **RTL layout** | Flips page content to right-to-left when Urdu is active; header/sidebar stay LTR. |
| **Dark mode** | Comprehensive CSS overrides for all OSD chrome, EUI components, and custom FYP plugins. |
| **OSD native i18n** | `translations/ur-PK.json` with ~110 keys for pagination, date picker, modals, EUI components. |
| **Attribute translation** | Translates `placeholder`, `title`, and `aria-label` attributes (Phase 8). |
| **Theme broadcast** | `fyp-theme-changed` CustomEvent lets other plugins react to theme changes. |
| **Persistence** | Language and theme survive navigation and page reload via `localStorage`. |

---

## Toolbar

A floating pill fixed to the bottom-right corner of every page:

```
[ UR ]  [ ☾ Dark ]
```

- **UR / EN** — shows the language you can switch TO (click to toggle). Page reloads on switch.
- **☾ Dark / ☀ Light** — toggles dark/light theme without page reload.

---

## Translation Architecture

### Track A — DOM text replacement

`_applyReplaceMap(EN_TO_UR)` uses a `TreeWalker` to walk every text node in `document.body`, replacing exact-trimmed matches from the 561-entry EN→UR map. Runs immediately on language switch and on every MutationObserver fire (150 ms debounce).

### Track B — OSD native i18n

`_ensureLocaleUrl('ur')` adds `?locale=ur-PK` to the URL and reloads. OSD's rendering service serves the `translations/ur-PK.json` bundle to all React `<FormattedMessage>` components at startup.

### Track C — Regex patterns

`_applyPatternTranslations()` runs 49 compiled regex patterns for dynamic strings containing live numbers (pagination, severity counts, relative timestamps, time ranges). Patterns cover:

- Pagination: "Showing 1–25 of 1,234", "Page 3 of 12"
- Severity: "High (15)", "5 Critical", "N Medium", "Informational (N)"
- Counts: "X agents", "X alerts", "X events", "X rules", "X decoders", "X groups", "X files", "X vulnerabilities"
- Timestamps: "3 minutes ago", "just now", "Last updated: …"
- Time ranges: "Last N hours/days/weeks/months/years"
- Relative: "Updated N seconds ago", "X% pass / fail"

### Phase 8 — Attribute translation

After DOM text replacement, a second pass translates `placeholder`, `title`, and `aria-label` attributes on all elements using the same map.

---

## Translation Coverage (1012 unique EN→UR mappings)

| Namespace | Keys | What is covered |
|-----------|------|----------------|
| `ng.*` | 26 | Network Graph plugin — all labels, legend, sidebar |
| `nlq.*` | 35 | NLQ Search plugin — all UI strings |
| `cv.*` | 25 | Compliance View plugin — all UI strings |
| `toolbar.*` | 4 | Toolbar button labels |
| `wz.section.*` | 7 | Overview section badge labels |
| `wz.module.*` / `wz.mod.*` | 36 | All module card titles (both capitalized and lowercase variants) |
| `wz.desc.*` | 28 | All module card descriptions (exact strings from wazuh-modules.js) |
| `nav.*` | 32 | Navigation sidebar items + app settings, reporting, server APIs, statistics, summary, indexer management, Network Graph |
| `agents.*` | 31 | Agent management page — labels, columns, action buttons |
| `sec.*` | 33 | Security module pages — severity levels, columns, chart titles |
| `mitre.*` | 5 | MITRE ATT&CK module |
| `fim.*` | 6 | File Integrity Monitoring module |
| `ca.*` | 6 | Configuration Assessment module |
| `mgmt.*` | 23 | Management pages — Rules, Decoders, Groups, Cluster, Logs, Settings |
| `action.*` | 27 | Common action buttons |
| `ui.*` | 38 | Common UI labels, status, time ranges |
| `col.*` | 15 | Table column headers |
| `status.*` | 5 | Agent status labels |
| `chart.*` | 39 | Chart and visualization titles |
| `msg.*` | 50 | Status messages, errors, confirmations |
| `desc.*` | 44 | Module description variants + long-form app descriptions (overview, security, endpoints, server APIs, compliance, network graph, cluster management) |
| `sample.*` | 3 | Sample data labels |
| `dash.*` | 11 | Dashboard page titles |
| `asst.*` | 33 | assistantDashboards chatbot plugin |
| `cfg.*` | 386 | All configuration page field labels — SMTP, SSL, anti-flooding, syscheck, rootcheck, registration, cluster, logging, cloud integrations (AWS/Azure/GCP/O365/GitHub), Osquery, CIS-CAT, Docker, active response, commands, SCA, agentless |

---

## Locale Files

```
locales/
  en.json   — 1012 English source strings (keys used for map building)
  ur.json   — 1012 Urdu translations (1:1 key match with en.json)
```

Both files are bundled into the webpack output at build time; no runtime file reads. The `buildMaps()` function constructs `EN_TO_UR` and `UR_TO_EN` lookup objects at module load time.

**Collision-free guarantee:** A Python validation script is run before each build to ensure no two JSON keys share the same English value with different Urdu translations (which would cause non-deterministic DOM replacement).

---

## OSD Native i18n (Phase 6)

```
.i18nrc.json              — registers plugin for OSD i18n scanning
translations/ur-PK.json   — 187 OSD chrome keys
```

Key groups covered:
- `core.euiPagination.*`, `core.euiTablePagination.*`, `core.euiBasicTable.*`
- `core.euiQuickSelect.*`, `core.euiSuperUpdateButton.*`, `core.euiRefreshInterval.*`
- `core.euiColumnSelector.*`, `core.euiToast.*`, `core.fatalErrors.*`
- `dashboard.*`, `opensearch-dashboards-react.*`, `queryEnhancements.*`
- `wz-app-*` — all 126 Wazuh app registration strings (titles, breadcrumb labels, descriptions, category labels for every Overview module)
- `core.ui.group.*` — 7 hamburger nav section header titles (Analytics, Data administration, Essentials, etc.)
- `home.*`, `devTools.*`, `visualize.*`, `management.*`, `savedObjectsManagement.*` — OSD built-in app nav labels

---

## RTL CSS (Phase 10)

When Urdu is active, `fyp-rtl` class is added to `<body>` and `RTL_CSS` is injected:

- Page content area, tables, badges, flyouts, modal bodies → `direction: rtl`
- Header, collapsible nav, sidebar → `direction: ltr` (stay usable)
- Breadcrumbs, tabs → `flex-direction: row-reverse`
- Accordion arrows → `transform: scaleX(-1)`
- LTR exceptions: `input[type="text/search/number"]`, `.euiFieldSearch`, `.euiFieldText`, `.euiCodeBlock`, `pre`, `code`

---

## Dark Mode Color Palette

| Token | Value |
|-------|-------|
| Page bg | `#0f172a` |
| Surface / cards | `#1e293b` |
| Header / sidebar | `#0d1527` |
| Border | `#334155` |
| Text primary | `#e2e8f0` |
| Text secondary | `#94a3b8` |
| Accent / active | `#3b82f6` |
| Danger | `#f87171` |
| Success | `#4ade80` |
| Warning | `#fb923c` |

Dark mode CSS is injected synchronously at module load time (before `setup()`) so the OSD initial loading screen and Wazuh health-check page render in dark mode from the first frame. Additional selectors cover `.osdWelcomeView`, `.osdOverviewPageHeader`, `.wz-menu*`, `.wz-module-header-nav`, `.registerAgent`, `.healthCheck`, and the OSD application mount container `[id^="application-"]`.

---

## Global API

```javascript
// Available from setup() onward (before start() fires)
window.__fypLocale__.lang          // 'en' | 'ur'
window.__fypLocale__.t('nav.home') // → 'Home' or 'ہوم'

// Fired when language changes
window.addEventListener('fyp-language-changed', function() { /* re-render */ });

// Fired when theme changes
window.addEventListener('fyp-theme-changed', function(e) {
  // e.detail.theme === 'dark' | 'light'
});
```

### `_t()` / `_tFmt()` for other plugins

```javascript
function _t(key) {
  return (window.__fypLocale__ && window.__fypLocale__.t(key)) || _MY_EN[key] || key;
}
function _tFmt(key, vars) {
  var s = _t(key);
  Object.keys(vars || {}).forEach(function(k) { s = s.replace('{' + k + '}', vars[k]); });
  return s;
}
// Usage:
showAllBtn.textContent = _tFmt('ng.showAll', { count: total });
```

Static strings are translated automatically by DOM replacement — no `_t()` call needed.

---

## localStorage Keys

| Key | Values | Notes |
|-----|--------|-------|
| `fyp_language` | `'en'` \| `'ur'` | Default: `'en'` (absent = English) |
| `fyp_theme_v2` | `'light'` \| `'dark'` | Default: `'light'` (written on first load) |

---

## Install

```bash
# Build and install (restarts wazuh-dashboard):
sudo bash install.sh

# Build only, skip restart:
sudo bash install.sh --no-restart
```

Requires `node` (v18+) and `npm`. Build runs in `/tmp/localization-build` to avoid vboxsf/symlink restrictions on the shared folder.

---

## File Structure

```
localization/
├── install.sh                  # Build + install script
├── package.json                # npm dependencies (webpack, webpack-cli)
├── webpack.config.js           # Bundle configuration
├── opensearch_dashboards.json  # OSD plugin manifest
├── .i18nrc.json                # OSD i18n registration
├── public/
│   ├── bundle_entry.js         # Webpack entry point
│   └── index.js                # Core plugin logic (~41 KB)
├── locales/
│   ├── en.json                 # 561 English source strings
│   └── ur.json                 # 561 Urdu translations
├── server/
│   ├── index.js                # Server-side plugin entry
│   └── plugin.js               # Server plugin class (no-op)
├── translations/
│   └── ur-PK.json              # ~110 OSD native i18n keys
└── session-log.md              # Development history (Phases 1–16)
```

---

## Known Limitations

- **150 ms flash** — DOM translations re-apply within 150 ms of any DOM mutation. There may be a brief flash of English on heavy re-renders.
- **SVG text nodes** — Chart labels rendered inside `<svg><text>` elements are not reached by the TreeWalker and remain in English.
- **Phase 7 page reload** — Every language switch triggers a full page reload (required for OSD native i18n). There is no instant in-page toggle without reload.
- **Very first page load in dark mode** — The HTML template is rendered server-side in light mode (OSD's own dark mode setting is separate). Dark mode CSS is injected synchronously at plugin bundle load time, so there may be a sub-100 ms flash of white on the very first page load before the bundle executes.

---

## Phase History

| Phase | Description |
|-------|-------------|
| 1–5 | Initial plugin scaffold, toolbar, dark mode, basic locale keys (68), RTL stub |
| 6 | OSD native i18n — `.i18nrc.json` + `translations/ur-PK.json` (~110 keys) |
| 7 | URL-based locale switching — `?locale=ur-PK` reload trigger |
| 8 | Attribute translation — `placeholder`, `title`, `aria-label` attrs |
| 9 | Dynamic regex patterns — 29 PATTERNS_UR for pagination/timestamps/severity |
| 10 | Full RTL CSS — flyouts, modals, popovers, breadcrumbs, tabs, accordions |
| 11 | No-flash load — apply DOM translations before URL reload fires |
| 12 | Collision detection + gap-fill — 395 keys, 6 reverse-map collisions fixed |
| 13 | Comprehensive pass — module descriptions, chatbot, severity, 476 keys |
| 14 | Full coverage audit — dashboards, charts, status messages, 561 keys, 49 patterns |
| 15 | Configuration pages — `cfg.*` (386 keys) covering all Management → Configuration field labels: SMTP, SSL, anti-flooding, syscheck, rootcheck, registration, cluster, logging, cloud integrations (AWS/Azure/GCP/O365/GitHub), Osquery, CIS-CAT, Docker, active response, SCA, agentless. Total: **984 keys** |
| 16 | Full coverage audit — loading screen dark mode (early injection, `.osdWelcomeView`), stale locale URL fix, Wazuh menu CSS gaps (`.wz-menu*`, `.registerAgent`, etc.), 25 new nav/desc locale keys, 14 new `ur-PK.json` OSD nav keys; `nlqSearch` full dark mode; `complianceView` `!important` fixes; `networkGraph` missing dark-theme rules. Total: **1009 keys**, **187 ur-PK.json messages** |
| 16b | Small gap-fill — `wz-app-cdb-lists-title` + `wz-app-server-status-title` added to `ur-PK.json`; three `wazuh.plugin.js` string variants (`wz.desc.pci.v2`, `wz.desc.tsc.v2`, `wz.desc.peca.v2`) added to DOM-replacement map for Oxford comma / trailing period / no-acronym forms. Total: **1012 keys**, **189 ur-PK.json messages** |
