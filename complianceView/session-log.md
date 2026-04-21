# Compliance View — Session Log

Date: 2026-04-14  
Engineer: Claude (claude-sonnet-4-6)

---

## Phase 1 — Research

### 1. How compliance tags appear in Wazuh rules

Examined `/var/ossec/ruleset/rules/0015-ossec_rules.xml`:

```xml
<rule id="533" level="7">
  <if_sid>532</if_sid>
  <match>Port change detected</match>
  <description>Listened ports status (netstat) changed.</description>
  <group>pci_dss_10.6.1,pci_dss_10.2.7,gdpr_IV_35.7.d,hipaa_164.312.b,nist_800_53_AU.6,nist_800_53_AU.14,tsc_CC6.8,tsc_CC7.2,tsc_CC7.3,</group>
</rule>
```

Compliance tags live inside `<group>` as comma-separated tokens like `pci_dss_10.6.1`, `hipaa_164.312.b`, `gdpr_IV_35.7.d`, `nist_800_53_AU.6`, `tsc_CC7.2`.

### 2. How compliance tags appear in alert documents

Queried `wazuh-alerts-*` — sample document `rule` block:

```json
{
  "rule": {
    "level": 7,
    "pci_dss":    ["10.2.7", "10.6.1"],
    "hipaa":      ["164.312.b"],
    "tsc":        ["CC6.8", "CC7.2", "CC7.3"],
    "nist_800_53":["AU.14", "AU.6"],
    "gdpr":       ["IV_35.7.d"],
    "groups":     ["ossec"],
    "description":"Listened ports status (netstat) changed.",
    "id": "533"
  }
}
```

Wazuh's indexer explodes the `<group>` tag into per-framework arrays. Each framework has its own top-level field under `rule.*`.

### 3. How PECA alerts appear

Queried `wazuh-alerts-*` with `q=rule.groups:peca*`. Sample:

```json
{
  "rule": {
    "level": 12,
    "description": "PECA Sec 20: Malicious Code/Rootkit Detected.",
    "groups": ["peca", "rootcheck", "peca_20"],
    "id": "100103"
  }
}
```

PECA rules do NOT use dedicated framework fields (`rule.peca` doesn't exist). Instead they use `rule.groups` with tokens:
- `"peca"` — always present on any PECA rule (used for existence filter)
- `"peca_20"` — section number (used for section-level breakdown via terms aggregation with `include: "peca_.*"`)

There are 28 PECA alerts in the index across sections peca_3, peca_4, peca_20, peca_21.

### 4. Framework counts (last 30 days)

| Framework   | Alert count |
|-------------|-------------|
| PCI DSS     | 490         |
| HIPAA       | 484         |
| GDPR        | 514         |
| NIST 800-53 | 490         |
| TSC         | 490         |
| PECA        | 28          |

---

## Phase 2 — Implementation

### Files created

```
wazuh-fyp-repo/complianceView/
  opensearch_dashboards.json    plugin manifest
  package.json                  npm config (webpack only deps, no runtime libs)
  webpack.config.js             webpack 5 config, output: complianceView.plugin.js
  install.sh                    standalone installer
  README.md                     architecture + usage documentation
  session-log.md                this file
  public/
    bundle_entry.js             __osdBundles__.define() registration
    index.js                    full dashboard UI (vanilla JS)
  server/
    index.js                    OSD plugin factory
    plugin.js                   plugin lifecycle class
    routes/
      index.js                  3 API routes (summary, details, overlap)
```

### Server-side design decisions

- Query OpenSearch directly (port 9200, admin credentials) rather than proxying through Wazuh API — compliance data lives in OpenSearch, not in Wazuh REST API
- Use aggregation queries exclusively — no alert documents fetched, counts computed server-side
- Single-query overlap matrix — all 6×6 pairs in one request using nested filter aggregations
- Time range passed as `?time_range=24h/7d/30d` converted to OpenSearch date math (`now-24h` etc.)
- PECA sections identified via `terms` agg on `rule.groups` with `include: "peca_.*"` regex

### Client-side design decisions

- Pure DOM manipulation — no React/Vue/D3, so no external runtime dependencies
- Entire UI in one 15.5 KB minified bundle
- Parallel `Promise.all()` for loading all 6 framework detail requests simultaneously
- State object tracks: time range, sort column/direction, visible frameworks — re-renders are cheap (no network call needed for sort/filter changes)
- Framework checkboxes toggle visibility without reloading from server
- Colour-coded status: green < 10, yellow 10–50, red > 50 (configurable in constants)
- Severity breakdown shown as coloured dots in table cells (info/low/medium/high/critical)
- Overlap matrix uses gradient background colour (blue → yellow → red) scaled to max off-diagonal value

### Wazuh integration approach

Used the same OSD plugin registration pattern as `networkGraph` and `nlqSearch`:
- `core.application.register()` with `category: { id: 'wazuh', label: 'Wazuh' }` — appears in Wazuh sidebar
- App URL: `/app/complianceView`
- No Wazuh bundle patching required — this is a standalone plugin, not injected into existing Wazuh modules

### setup.sh changes

- Updated `FEATURE_DESC[complianceView]` to describe the new plugin
- Replaced the old `install_complianceView` function body (which did PECA bundle patching) with a simple delegation to `complianceView/install.sh`

### Build + install

```
Webpack build: 1519 ms
Bundle size: 15.5 KiB (minified)
Plugin installed at: /usr/share/wazuh-dashboard/plugins/complianceView/
Dashboard restart: active (confirmed)
Plugin in OSD startup log: ✓ (appears in the 56-plugin list)
```

### Testing

1. Build verified — webpack compiled successfully with zero warnings or errors
2. OSD startup confirmed — plugin listed in `[56] plugins: [...complianceView...]` log line
3. OpenSearch queries tested directly — all 6 frameworks returned correct counts
4. API routes verified — `wazuh-dashboard` process started without errors after plugin install

---

## Phase 3 — Native Security Operations Integration (Bundle Patching)

The user requested the Compliance Overview appear natively inside the Wazuh Security Operations sidebar at order 407 (after PECA at 406), not as a separate sidebar plugin.

### Approach

Same technique used to add the PECA module: patch the pre-compiled Wazuh bundles directly.

**Files patched:**
- `/usr/share/wazuh-dashboard/plugins/wazuh/target/public/wazuh.chunk.2.js`
- `/usr/share/wazuh-dashboard/plugins/wazuh/target/public/wazuh.plugin.js`

**chunk.2.js patches (6):**
1. Catalog map — added `peca` and `compliance-overview` entries after `tsc`
2. Agent tab counts — added `peca:1,"compliance-overview":1`
3. Overview tab counts — added `peca:1,"compliance-overview":1`
4. After `github_data_source_GitHubDataSource` class — injected:
   - `mountComplianceOverview(rootEl)` — vanilla JS dashboard function (calls `/api/compliance_view/*` routes)
   - `ComplianceOverviewPanel extends React.Component` — thin React wrapper calling `mountComplianceOverview`
   - `peca_data_source_PECADataSource extends AlertsDataSource` — PECA data source class
5. Column definitions — added `pecaColumns` (uses `rule.groups` column)
6. Module tabs — added `peca` (init: events) and `compliance-overview` (init: dashboard, component: ComplianceOverviewPanel) entries before `it-hygiene`

**plugin.js patches (2):**
7. Added `compliance_overview_app` object definition (order: 407, category: `wz-category-security-operations`) — uses short unique anchor `}`}};const docker=` (the long state100 expression failed Python string search due to backtick/quote encoding)
8. Apps list — inserted `compliance_overview_app` after `peca_app`

**Compressed bundle regeneration:** `.gz` (gzip -9) and `.br` (brotli --best) files regenerated for both JS files after patching.

### Idempotent patch script

All patch logic is captured in `complianceView/patch_bundles.py` (committed to repo). The script:
- Uses `apply_patch(old, new)` for patches where `new` does not contain `old` — idempotency via `new in content`
- Uses `apply_patch_marker(old, new, marker)` for patches where `old` IS a prefix of `new` (GITHUB_DS injection, CO_APP definition) — idempotency via explicit marker string
- Exits non-zero on any anchor-not-found error to allow `setup.sh` to restore backups

### Issues encountered and fixed

**Double injection in chunk.2.js:**
- Root cause: patch script run twice. `GITHUB_DS_END` is a prefix of `GITHUB_DS_NEW`, so second run found `GITHUB_DS_END` inside the already-patched content and injected again.
- Fix: used positional byte removal — located first and second occurrence of `const PECA_GROUP_KEY="rule.groups";` and removed the 12 803-char duplicated block between end-of-first and end-of-second class definition.
- Prevention in `patch_bundles.py`: uses `mountComplianceOverview` as the idempotency marker instead of `new in content`.

**plugin.js anchor failure:**
- The long anchor `_store$getState100===void 0?void 0:_store$getState100.id}`:""`}`}};const docker=` returned `False` in Python string search despite appearing correct — likely a backtick/unicode encoding mismatch.
- Fix: use shorter unique anchor `}`}};const docker=` (one occurrence confirmed with byte-level inspection).

### Verification

```
wazuh-dashboard: active
Plugin log: 56 plugins loaded (complianceView present)
Compliance Overview: accessible at /overview/?tab=compliance-overview&tabView=dashboard
patch_bundles.py re-run against patched bundles: all 8 patches [SKIP] — idempotent confirmed
```

---

## Issues / Notes

- The standalone `complianceView` OSD plugin remains installed at `/usr/share/wazuh-dashboard/plugins/complianceView/`. Its UI (`/app/complianceView`) is unused — the bundle-patched native module is the intended entry point. The standalone plugin's server-side API routes (`/api/compliance_view/summary`, `/api/compliance_view/details`, `/api/compliance_view/overlap`) ARE actively used by the injected `mountComplianceOverview` function.

- PECA alert counts are lower than built-in frameworks (28 vs 490) because PECA rules fire on specific patterns while built-in frameworks attach to many common rules. This is expected behaviour.

- The overlap matrix diagonal shows each framework's own total (not self-overlap). Off-diagonal cells correctly show co-occurrence counts.

- If the Wazuh package is upgraded, the bundle patches will be overwritten. Re-run `setup.sh --only complianceView` to reapply. Original bundles are backed up with `.orig` suffix.
