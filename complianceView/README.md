# Compliance View — Wazuh Native Integration

A unified compliance dashboard comparing alert violations across **all** compliance frameworks simultaneously: PCI DSS, HIPAA, GDPR, NIST 800-53, TSC, and PECA.

Accessible natively from the Wazuh **Security Operations** sidebar at **order 400.5** (after IT Hygiene at 400, before PCI DSS at 401), via `/overview/?tab=compliance-overview&tabView=dashboard`. Also accessible as a standalone OSD app at `/app/complianceView`.

---

## Architecture

This feature uses a two-layer approach:

### Layer 1 — Standalone OSD plugin (API server + fallback UI)

A minimal OSD server plugin installed at `/usr/share/wazuh-dashboard/plugins/complianceView/`. It serves three API routes that the injected UI calls to fetch compliance data from OpenSearch.

The plugin also registers its own OSD application at `/app/complianceView` (with `navLinkStatus: 2` — hidden from the sidebar). This provides a direct URL fallback that works independently of the Wazuh bundle patches.

```
complianceView/
  opensearch_dashboards.json   — plugin manifest (id, OSD version, server/ui flags)
  package.json                 — npm metadata + webpack devDependencies
  webpack.config.js            — webpack 5 build config (single output bundle)
  install.sh                   — standalone installer (build + deploy)
  patch_bundles.py             — idempotent bundle patcher (Layer 2)
  public/
    bundle_entry.js            — OSD __osdBundles__.define() registration
    index.js                   — standalone dashboard UI (unused in normal flow)
  server/
    index.js                   — OSD server-side entry point (plugin factory)
    plugin.js                  — plugin lifecycle class (setup/start/stop)
    routes/
      index.js                 — 3 API routes, all querying OpenSearch directly
```

### Layer 2 — Wazuh bundle patching (native Security Operations entry)

`patch_bundles.py` patches the pre-compiled Wazuh JavaScript bundles to register the Compliance Overview as a native Wazuh module — exactly as PECA was added. This makes it appear in the Security Operations sidebar alongside PCI DSS, GDPR, HIPAA, NIST, TSC, and PECA.

**Patches applied to `wazuh.chunk.2.js` (6):**
1. Catalog map — adds `peca` + `compliance-overview` entries
2. Agent tab counts — registers the modules as valid for agent view
3. Overview tab counts — registers the modules as valid for overview
4. Injects `mountComplianceOverview()` (vanilla JS dashboard), `ComplianceOverviewPanel` (React wrapper), and `peca_data_source_PECADataSource` (PECA data source class) after the GitHub DataSource class
5. Adds `pecaColumns` table column definition
6. Module tabs — adds `peca` and `compliance-overview` module definitions

**Patches applied to `wazuh.plugin.js` (steps 7–11):**
7a. Pre-clean: removes legacy `peca_app` block (if present from old installs) to prevent duplicate-id error
7b. Adds `peca` app constant (order: 406, category: `wz-category-security-operations`)
7c. Adds `compliance_overview_app` constant (**order: 400.5** — between IT Hygiene and PCI DSS)
8–9. Inserts both into the apps list (sorted by order value)
10. Upgrades existing installed bundles: swaps dark-default CSS to light-default, adds `fyp-theme-changed` listener
11. Upgrades existing installed bundles: corrects order from 407 → 400.5
12. Upgrades existing installed bundles: adds `!important` to key light-theme CSS declarations

### Technology choices

- **Vanilla JS + DOM manipulation** — `mountComplianceOverview` uses no React, no D3, no external runtime deps; wrapped in a thin React class for OSD compatibility
- **Light theme default** — both the standalone app (`.cv-root`) and embedded panel (`.cv-ov`) default to light colors matching Wazuh Dashboard's native light mode
- **Dark theme via `.dark-theme` class** — scoped under `.cv-root.dark-theme` and `.cv-ov.dark-theme`; toggled by reading `fyp_theme_v2` from localStorage and listening for the `fyp-theme-changed` CustomEvent from the localization plugin
- **`!important` on key light-theme declarations** — prevents OSD/Wazuh global CSS and the localization plugin's dark-mode rules from overriding card backgrounds and table header colours
- **Webpack 5** — compiles the standalone plugin UI into one self-contained 15 KB bundle
- **Build in /tmp** — avoids VirtualBox shared-folder symlink restrictions
- **OpenSearch aggregation queries** — counts computed server-side; no full document fetch
- **Idempotent patching** — `patch_bundles.py` detects already-applied patches and skips them safely

---

## Server-Side Routes

All routes query `wazuh-alerts-*` in OpenSearch (`https://localhost:9200`) using the `admin` credentials. They accept a `time_range` query param (`24h` | `7d` | `30d`, default `24h`).

### `GET /api/compliance_view/summary?time_range=<range>`

Returns the total alert count for each compliance framework in the given period.

**Response shape:**
```json
{
  "frameworks": {
    "pci_dss":     { "label": "PCI DSS",     "count": 490 },
    "hipaa":       { "label": "HIPAA",        "count": 484 },
    "gdpr":        { "label": "GDPR",         "count": 514 },
    "nist_800_53": { "label": "NIST 800-53",  "count": 490 },
    "tsc":         { "label": "TSC",          "count": 490 },
    "peca":        { "label": "PECA",         "count": 28  }
  },
  "total": 997
}
```

**OpenSearch query used:** single `_search` with one `filter` aggregation per framework. For built-in frameworks the filter is `exists: { field: "rule.<fw>" }`. For PECA it is `term: { "rule.groups": "peca" }`.

---

### `GET /api/compliance_view/details?framework=<key>&time_range=<range>`

Returns section/clause-level breakdown for one framework.

**Response shape:**
```json
{
  "framework": "pci_dss",
  "sections": [
    {
      "key": "10.6.1",
      "count": 312,
      "severity": { "info": 0, "low": 10, "medium": 200, "high": 90, "critical": 12 },
      "last_alert": "2026-04-14T06:55:00.000Z"
    }
  ]
}
```

For PECA sections the `description` field is also populated from the hardcoded mapping:

| Group key  | Description |
|-----------|-------------|
| peca_3    | Unauthorized Access to Information System or Data |
| peca_4    | Unauthorized Copying or Transmission of Data |
| peca_5    | Interference with Information System or Data |
| peca_6    | Unauthorized Access to Critical Infrastructure |
| peca_8    | Unauthorized Interception |
| peca_11   | Electronic Forgery |
| peca_20   | Offenses by Malicious Code |
| peca_21   | Cyber Terrorism |
| peca_36   | Data Protection of Service Providers |
| peca_37   | Data Retention |

**OpenSearch query used:** `terms` aggregation on the framework field (e.g. `rule.pci_dss`), filtered to matching documents. For PECA: `terms` on `rule.groups` with `include: "peca_.*"`. Each bucket gets a nested `range` aggregation on `rule.level` for severity breakdown, plus a `max` aggregation on `@timestamp`.

---

### `GET /api/compliance_view/overlap?time_range=<range>`

Returns the cross-framework alert co-occurrence matrix.

**Response shape:**
```json
{
  "frameworks": ["pci_dss", "hipaa", "gdpr", "nist_800_53", "tsc", "peca"],
  "matrix": {
    "pci_dss": { "pci_dss": 490, "hipaa": 420, "gdpr": 390, ... },
    "hipaa":   { "pci_dss": 420, "hipaa": 484, ... },
    ...
  }
}
```

`matrix[A][A]` = total alerts for framework A (diagonal).  
`matrix[A][B]` = alerts triggering both A and B simultaneously.

**OpenSearch query used:** single `_search` with nested `filter` aggregations — one outer agg per framework, each containing one inner agg per other framework.

---

## Data Sources

| Framework  | OpenSearch field   | Filter type       |
|------------|--------------------|-------------------|
| PCI DSS    | `rule.pci_dss`     | `exists`          |
| HIPAA      | `rule.hipaa`       | `exists`          |
| GDPR       | `rule.gdpr`        | `exists`          |
| NIST 800-53| `rule.nist_800_53` | `exists`          |
| TSC        | `rule.tsc`         | `exists`          |
| PECA       | `rule.groups`      | `term: "peca"`    |

---

## UI Sections

1. **Framework Summary Row** — one card per framework with total count + colour-coded status indicator (green < 10, yellow 10–50, red > 50). Cards are clickable and scroll to the detail table.

2. **Framework Checkboxes** — toggle individual frameworks on/off in the detail table without reloading data.

3. **Comparative Table** — all sections across visible frameworks in one sortable table. Columns: Framework · Section/Clause · Description · Alerts · Severity Breakdown · Last Alert. Click any column header to sort.

4. **Cross-Framework Overlap Matrix** — heatmap table. Rows = source framework, columns = target framework. Cell colour scales from transparent (0 overlaps) to red (highest overlap). Diagonal shows that framework's total count.

---

## Installation

### Standalone (from this folder)

```bash
sudo bash install.sh
```

`install.sh` is fully end-to-end: it builds the webpack bundle, installs the OSD plugin, runs `patch_bundles.py` to patch the Wazuh bundles, regenerates the `.gz` and `.br` compressed variants, and restarts the dashboard.

Use `--no-restart` to skip the service restart:
```bash
sudo bash install.sh --no-restart
```

### Via main repo installer

```bash
sudo bash /media/sf_sharedfolderclone/wazuh-fyp-repo/setup.sh --only complianceView
```

### Accessing the plugin

After installation:

| Access point | URL |
|---|---|
| Wazuh sidebar | Security Operations → Compliance Overview (order 400.5) |
| Wazuh overview card | Same order — appears after IT Hygiene, before PCI DSS |
| Direct URL | `https://<host>/app/complianceView` |
| Overview tab | `/overview/?tab=compliance-overview&tabView=dashboard` |

---

## Configuration

Alert thresholds are defined as constants in `public/index.js`:

```js
var THRESHOLD_GREEN  = 10;   // < 10 alerts → green (NORMAL)
var THRESHOLD_YELLOW = 50;   // 10–50 → yellow (ELEVATED), >50 → red (HIGH)
```

OpenSearch credentials are stored in `server/.env` (written by `install.sh` on first run):

```
OS_HOST=localhost
OS_PORT=9200
OS_USER=admin
OS_PASSWORD=
```

Set `OS_PASSWORD` to the `admin` indexer password from `wazuh-passwords.txt`. The `.env` file is not overwritten on reinstall, so credentials survive upgrades.

---

## Wazuh Version Compatibility

| Component               | Version |
|-------------------------|---------|
| Wazuh Manager           | 4.14.3  |
| OpenSearch Dashboards   | 2.19.4  |
| Node.js (build)         | ≥ 18    |
| Webpack                 | 5       |
