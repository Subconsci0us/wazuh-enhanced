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

## TO DO (future enhancements)
- Create OpenSearch saved visualizations for PECA sections (bar chart by peca section, timeline, etc.)
- Create a full dashboard tab with pre-built visualizations (requires creating saved objects in OpenSearch)
- Consider mapping PECA sections to dedicated rule fields (requires Wazuh rules engine modification)
