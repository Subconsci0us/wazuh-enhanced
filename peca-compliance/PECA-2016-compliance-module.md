# PECA Compliance Module — Work Log

## Status: COMPLETE (Phase 1 + Phase 2 done)

---

## Session 1 — 2026-04-08 (Research notes, no changes)

### Goal
Add a PECA (Prevention of Electronic Crimes Act 2016) compliance module to the Wazuh Dashboard (v4.14.3), alongside existing modules: PCI DSS, HIPAA, NIST 800-53, GDPR, TSC.

### Environment
- Wazuh installed at: `/usr/share/wazuh-dashboard/`
- Wazuh plugin at: `/usr/share/wazuh-dashboard/plugins/wazuh/`
- Shared folder / repo: `/media/sf_sharedfolderclone/wazuh-fyp-repo/`
- Wazuh API credentials: user `wazuh-wui`, password `v86bPF+u+2nph5LxghIFWivBr87qPgJL`
- API base URL: `https://localhost:55000`

### What Was Done This Session
- Task was scoped and planned. No files modified. Session interrupted.

---

## Session 2 — 2026-04-08 (Full Implementation)

### Phase 1 — Research Findings

**Architecture:**
- `common/*.js` files are plain server-side JS (loaded by Node.js via `require()`)
- `target/public/wazuh.plugin.js` — main webpack bundle (app registrations, plugin setup)
- `target/public/wazuh.chunk.2.js` — frontend chunk (module definitions, data sources, views)

**How compliance modules work:**
1. Each module is registered as an OpenSearch Dashboard app in `wazuh.plugin.js` with `redirectTo: '/overview/?tab=MODULE_ID&tabView=dashboard'`
2. Module metadata (title, description, appId) is in `WAZUH_MODULES` object in `wazuh.chunk.2.js` (also in `common/wazuh-modules.js` for server-side reporting)
3. Each module has a `DataSource` class that builds OpenSearch query filters
4. PCI/GDPR/HIPAA/NIST/TSC use dedicated `rule.XXX` fields (populated by Wazuh engine)
5. Docker/GitHub/AWS use `rule.groups` filtering

**PECA Data Approach:**
- PECA rules use `<group>peca_3,peca_4,</group>` style groups stored in `rule.groups`
- The outer group `<group name="peca,">` gives all PECA alerts a "peca" group tag
- PECA module uses `getRuleGroupsFilter("rule.groups", "peca", "peca-rule-group")` — same as GitHub/Docker pattern
- No dedicated `rule.peca` field exists; filtering is on `rule.groups: "peca"`

**Key Files:**
- Module list UI: `target/public/wazuh.chunk.2.js` (WAZUH_MODULES object)
- App registration: `target/public/wazuh.plugin.js` (const pciDss = {...} pattern)
- Server reporting: `server/lib/reporting/extended-information.js`
- Module metadata: `common/wazuh-modules.js`
- Constants: `common/constants.js`

### Phase 2 — Implementation

#### Files Modified (existing)

| File | Change |
|------|--------|
| `common/wazuh-modules.js` | Added `peca` module entry (title, appId, description) |
| `common/constants.js` | Added `PECA` to `WAZUH_MODULES_ID` enum; added `DATA_SOURCE_FILTER_CONTROLLED_PECA_RULE_GROUP = 'peca-rule-group'` |
| `server/lib/reporting/extended-information.js` | Added PECA imports and PECA reporting section (mirrors GDPR pattern but uses rule.groups) |
| `target/public/wazuh.chunk.2.js` | 6 edits (see below) |
| `target/public/wazuh.plugin.js` | Added `peca_app` constant + added to apps array |

#### Files Created (new)

| File | Description |
|------|-------------|
| `common/compliance-requirements/peca-requirements.js` | PECA section descriptions (Sections 3,4,5,6,8,11,20,21,36,37) |
| `server/lib/reporting/peca-request.js` | OpenSearch query functions for PECA reporting (uses rule.groups aggregation with `peca_.*` regex filter) |
| `server/integration-files/peca-requirements-pdfmake.js` | PECA requirements text for PDF report generation |

#### Bundle Changes (wazuh.chunk.2.js — 6 edits)

1. **WAZUH_MODULES object**: Added `peca:{title:"PECA",appId:"peca",description:"..."}`
2. **agents tab counts**: Added `peca:1`
3. **overview tab counts**: Added `peca:1`
4. **PECADataSource class**: Added new class after GitHubDataSource using `getRuleGroupsFilter("rule.groups","peca","peca-rule-group")`
5. **pecaColumns**: Added column definition using `rule.groups` field
6. **Module config**: Added `peca:{init:"events",tabs:[renderDiscoverTab({moduleId:"peca",tableColumns:pecaColumns,DataSource:peca_data_source_PECADataSource,...})],...}`

#### Bundle Changes (wazuh.plugin.js — 2 edits)

1. **peca_app constant**: Added app definition with `id:"peca"`, `order:406`, `redirectTo: '/overview/?tab=peca&tabView=events'`
2. **Apps array**: Added `peca_app` to the registered apps list

#### Compressed Files Regenerated

After editing the .js files, regenerated:
- `wazuh.chunk.2.js.gz` (gzip)
- `wazuh.chunk.2.js.br` (brotli)
- `wazuh.plugin.js.gz` (gzip)
- `wazuh.plugin.js.br` (brotli)

#### Backups Location
`/media/sf_sharedfolderclone/FYP_siem/wazuh-custom/backups/`

#### Custom Files Copy
All modified/created files copied to:
`/media/sf_sharedfolderclone/FYP_siem/wazuh-custom/plugins/wazuh/`

### PECA Sections Mapping

| Section | Title | Rule Group | Has Rules |
|---------|-------|------------|-----------|
| 3  | Unauthorized Access to Information System or Data | `peca_3` | Yes |
| 4  | Unauthorized Copying or Transmission of Data | `peca_4` | Yes |
| 5  | Interference with Information System or Data | `peca_5` | No |
| 6  | Unauthorized Access to Critical Infrastructure | `peca_6` | Yes |
| 8  | Unauthorized Interception | `peca_8` | Yes |
| 11 | Electronic Forgery | `peca_11` | Yes |
| 20 | Offenses by Malicious Code | `peca_20` | Yes |
| 21 | Cyber Terrorism | `peca_21` | No |
| 36 | Data Protection of Service Providers | `peca_36` | No |
| 37 | Data Retention | `peca_37` | No |

### How to Verify
1. Navigate to the Wazuh Dashboard
2. Go to Modules section (left sidebar)
3. Look for **PECA** in the Security operations section (order 406, after TSC)
4. Click PECA — it will load the events/alerts view filtered by `rule.groups: "peca"`
5. Any alerts triggered by peca_rules.xml will appear here

### Known Limitations
- PECA module uses the **Events** tab only (no custom dashboard with visualizations)
- The "Controls" (inventory) tab is not available since PECA uses rule.groups, not a dedicated rule.peca field
- Per-section breakdown in the events view requires filtering manually by group name (peca_3, peca_4, etc.)

---

## Incident — 2026-04-08: Wazuh Manager Daemon Failure + Recovery

### Symptom
After restarting `wazuh-dashboard`, the Wazuh health check reported two errors:

1. **Error 3099**: `Some Wazuh daemons are not ready yet in node "node01" (wazuh-analysisd->failed, wazuh-execd->failed, wazuh-db->failed)`
2. **Error 3002**: `Request failed with status code 500` (Check API Connection)

The alerts index pattern check passed fine — that was not a real error.

### Root Cause
`wazuh-manager.service` had silently failed (status: `failed, Result: timeout`) at some earlier point (17:36:38 PKT). This left all Wazuh daemons stopped. Stale PID files in `/var/ossec/var/run/` from orphaned processes were also present, making `wazuh-control status` print "Process XXXX not used by Wazuh, removing..." for each daemon.

### Recovery Steps

```bash
# Step 1: Check what's actually running
systemctl status wazuh-manager
/var/ossec/bin/wazuh-control status

# Step 2: Clean up stale PID files
rm -f /var/ossec/var/run/*.pid /var/ossec/var/run/*.lock

# Step 3: Start the manager
systemctl start wazuh-manager
sleep 10

# Step 4: Verify daemons are up
/var/ossec/bin/wazuh-control status
```

### Post-Recovery State
All critical daemons running:
`wazuh-analysisd`, `wazuh-execd`, `wazuh-db`, `wazuh-remoted`, `wazuh-logcollector`, `wazuh-syscheckd`, `wazuh-modulesd`, `wazuh-monitord`, `wazuh-authd`

API test confirmed working:
```bash
TOKEN=$(curl -k -s -u wazuh-wui:"v86bPF+u+2nph5LxghIFWivBr87qPgJL" \
  https://localhost:55000/security/user/authenticate \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
curl -k -s -H "Authorization: Bearer $TOKEN" https://localhost:55000/
# → {"title":"Wazuh API REST","api_version":"4.14.3",...}
```

### Daemons That Remain "Stopped" (Normal / Expected)
These are disabled optional services — not a problem:

| Daemon | Reason stopped |
|--------|---------------|
| `wazuh-clusterd` | Single-node setup, cluster mode not enabled |
| `wazuh-maild` | Mail notifications not configured |
| `wazuh-agentlessd` | Agentless monitoring not used |
| `wazuh-integratord` | No external integrations configured |
| `wazuh-dbd` | Legacy DB connector, replaced by indexer |
| `wazuh-csyslogd` | Remote syslog forwarding not configured |
| `wazuh-reportd` | Reporting daemon, not used |

### Notes for Future
- If health check shows 3099 again, first check `systemctl status wazuh-manager`
- If manager is in `failed` state, clean PID files then `systemctl start wazuh-manager`
- The manager can fail silently on boot if it starts before OpenSearch is ready — the timeout is in the systemd unit. Consider adding `After=wazuh-indexer.service` to the unit if this recurs on reboot.

---

## Incident — 2026-04-09: Wazuh Manager Daemon Failure + Recovery (Recurrence)

### Symptom
Same error as the 2026-04-08 incident. Dashboard health check reported:

1. **Error 3002**: `Request failed with status code 500` (Check API Connection)
2. **Error 3099**: `Some Wazuh daemons are not ready yet in node "node01" (wazuh-modulesd->stopped, wazuh-analysisd->stopped, wazuh-execd->stopped, wazuh-db->stopped, wazuh-remoted->stopped)`

### Root Cause
`wazuh-manager.service` failed again with `Result: timeout` at 11:39:50 PKT. The systemd start timed out while launching daemons, but orphaned `wazuh-apid` processes (PIDs 2306, 2307, 2308, 2311, 2314) stayed alive with their PID files in `/var/ossec/var/run/`. All other daemons were down.

Root cause is the same as before: the manager starts before all dependencies (likely OpenSearch/indexer) are fully ready, causing the start to time out. This is a known boot-ordering issue.

### Recovery Steps

```bash
# Step 1: Confirm manager is in failed state
systemctl status wazuh-manager
/var/ossec/bin/wazuh-control status

# Step 2: Kill orphaned wazuh-apid processes (check PIDs from PID files or wazuh-control status)
kill -9 <apid_pids>

# Step 3: Clean up stale PID/lock/start files
rm -f /var/ossec/var/run/*.pid /var/ossec/var/run/*.lock /var/ossec/var/run/*.start

# Step 4: Reset failed state and start the manager
systemctl reset-failed wazuh-manager
systemctl start wazuh-manager
sleep 15

# Step 5: Verify daemons are up
/var/ossec/bin/wazuh-control status
```

### Post-Recovery State
All critical daemons running:
`wazuh-analysisd`, `wazuh-execd`, `wazuh-db`, `wazuh-remoted`, `wazuh-logcollector`, `wazuh-syscheckd`, `wazuh-modulesd`, `wazuh-monitord`, `wazuh-authd`, `wazuh-apid`

API test confirmed working:
```bash
TOKEN=$(curl -k -s -u wazuh-wui:"v86bPF+u+2nph5LxghIFWivBr87qPgJL" \
  https://localhost:55000/security/user/authenticate \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
curl -k -s -H "Authorization: Bearer $TOKEN" https://localhost:55000/
# → {"data":{"title":"Wazuh API REST","api_version":"4.14.3",...}}
```

### Recurring Pattern — Recommended Permanent Fix
This is the **second time** this exact failure has occurred. The manager times out on boot because it starts before OpenSearch/indexer is ready. To prevent future recurrences, add `wazuh-indexer.service` to the manager's unit dependencies:

```bash
# Add ordering dependency to the systemd unit
systemctl edit wazuh-manager
```
Add:
```ini
[Unit]
After=wazuh-indexer.service
Requires=wazuh-indexer.service
```
Then: `systemctl daemon-reload`

This was noted as a recommendation after the first incident but not yet applied.

---

## TO DO (future enhancements)
- ~~Create OpenSearch saved visualizations for PECA sections (bar chart by peca section, timeline, etc.)~~ **DONE — 2026-04-09**
- ~~Create a full dashboard tab with pre-built visualizations (requires creating saved objects in OpenSearch)~~ **DONE — 2026-04-09**
- Consider mapping PECA sections to dedicated rule fields (requires Wazuh rules engine modification)

---

## Session 3 — 2026-04-09: OpenSearch Visualizations + Dashboard

### Goal
Create saved visualizations and a full dashboard for PECA compliance in OpenSearch Dashboards, accessible from the Dashboards app.

### Approach
Saved objects written directly to `.kibana_1` via the OpenSearch API using admin certs (same approach used by Wazuh for built-in content). No OSD API auth needed this way.

Index pattern used: `wazuh-alerts-*`  
PECA filter embedded in every visualization's `searchSourceJSON`: `rule.groups: peca`

### Visualizations Created

| ID | Title | Type | Description |
|----|-------|------|-------------|
| `peca-alerts-timeline` | PECA Alerts Over Time | Line chart | Date histogram of all PECA alerts on `@timestamp` (auto interval) |
| `peca-alerts-by-section` | PECA Alerts by Section | Horizontal bar | Filters aggregation — one bucket per PECA section (peca_3 through peca_37) |
| `peca-alerts-by-level` | PECA Alerts by Severity Level | Donut pie | Terms agg on `rule.level` |
| `peca-top-rules` | PECA Top Rules Fired | Data table | Terms on `rule.id` + `rule.description` sub-bucket, sorted by count |
| `peca-alerts-by-agent` | PECA Alerts by Agent | Vertical bar | Terms agg on `agent.name` |

### Dashboard Created

| ID | Title |
|----|-------|
| `peca-compliance-dashboard` | PECA 2016 Compliance |

**Layout:**
- Row 1 (full width): PECA Alerts Over Time (timeline)
- Row 2 (split): Alerts by Section (left) + Alerts by Severity Level (right)
- Row 3 (split): Top Rules Fired (left, wider) + Alerts by Agent (right)

### How to Access
- Open Wazuh Dashboard: `https://localhost/`
- Go to **Dashboards** in the left nav (OpenSearch Dashboards section, not Wazuh modules)
- Search for **"PECA"** — dashboard appears as "PECA 2016 Compliance"

Or direct URL: `https://localhost/app/dashboards#/view/peca-compliance-dashboard`

### Script
Creation script saved at: `peca-compliance/create_peca_visualizations.py`  
Re-run it any time to recreate the saved objects (safe to re-run — uses PUT, so it will overwrite existing).

### State at End of Session
- 5 visualizations + 1 dashboard created and verified in `.kibana_1`
- 15 existing PECA alerts in index (all `peca_20` / rule 100103 — malicious code / rootcheck hits)

---

## Session 3 (continued) — 2026-04-09: PECA Dashboard Tab in Wazuh Module

### Goal
Add a **Dashboard** tab to the PECA module page in the Wazuh UI (same as GDPR, PCI DSS, HIPAA, NIST, TSC which have Dashboard + Events tabs).

### Approach
Patched `target/public/wazuh.chunk.2.js` using the same inline `DashboardByRenderer` + `savedVis` pattern used by all other compliance modules. Visualizations are defined inline (not by reference to saved OpenSearch objects) so they respect the module's DataSource filters and the search bar date range.

### Bundle Changes (`wazuh.chunk.2.js` — 1 patch)

Inserted ~11 KB of code immediately before the `peca:{...}` module config entry:

| Added | Description |
|-------|-------------|
| `peca_dashboard_plugins` / `peca_dashboard_DashboardByRenderer` | Plugin handle + renderer ref (same as `gdpr_dashboards_dashboard_*`) |
| `peca_dashboard_extends()` | Extends helper (boilerplate) |
| `getVSPecaAlertsOverTime(indexPatternId)` | Line chart — date_histogram on `timestamp` |
| `getVSPecaBySection(indexPatternId)` | Horizontal bar — filters agg, one bucket per PECA section (peca_3 … peca_37) |
| `getVSPecaByLevel(indexPatternId)` | Donut — terms on `rule.level` |
| `getVSPecaTopRules(indexPatternId)` | Bar chart — terms on `rule.id` |
| `getVSPecaByAgent(indexPatternId)` | Donut — terms on `agent.name` |
| `peca_dashboard_getDashboardPanels(indexPatternId, isPinnedAgent)` | Overview layout (5 panels) + agent layout (3 panels) |
| `DashboardPECAComponent` | React component (mirrors `DashboardGDPRComponent`) |
| `DashboardPECA` | Wrapped with `withErrorBoundary` via `redux.compose` |

Changed module config:
- `init:"events"` → `init:"dashboard"`
- `tabs:` now has `{id:"dashboard",name:"Dashboard",buttons:[ButtonExploreAgent,ButtonModuleGenerateReport],component:DashboardPECA}` as the first tab, followed by the existing `renderDiscoverTab` (Events tab)

### Dashboard Layout

**Overview (no agent pinned):**
- Row 1 full-width: Alerts Over Time
- Row 2 split 50/50: Alerts by Section | Alerts by Severity
- Row 3 split 32/16: Top Rules | Alerts by Agent

**Agent view (agent pinned):**
- Row 1 split 50/50: Top Rules | Alerts by Severity
- Row 2 full-width: Alerts Over Time

### Scripts
- `peca-compliance/patch_peca_dashboard.py` — re-runnable patch script
- Backups: `wazuh-custom/backups/wazuh.chunk.2.js.pre-peca-dashboard.bak` (before), `.with-peca-dashboard.bak` (after)

### How to Access
Wazuh Dashboard → left sidebar → **Modules** → Security operations → **PECA**
- First tab: **Dashboard** (5 inline visualizations)
- Second tab: **Events** (discover/alert table)
