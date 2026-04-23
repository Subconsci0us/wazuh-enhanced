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

---

## Session 4 — 2026-04-23: Missing PECA Detection Rules Added

### Goal
Extend `peca_rules.xml` to cover all PECA Chapter II sections that are
detectable in a SIEM, filling the gap left by the original 4 rules (100100–100103).

### Pre-work: Docker Shutdown
Wazuh Docker stack (`single-node`) was running and was shut down before this
session to ensure the local installation is used:
```bash
cd /home/mint/wazuh-docker-test/wazuh-docker-4.14.3/single-node
docker compose down
```

### Source Document Analysis

The complete PECA 2016 Act PDF (`/media/sf_sharedfolderclone/peca.pdf`, 29 pages)
was read in full. All 51 sections were evaluated against Wazuh's available log
sources. Analysis focused on Chapter II (Offences and Punishments, Sections 3–23).

**README Title Errors Found and Corrected:**

The previous README contained three incorrect section titles:

| Entry in old README | Correct title (from PDF) |
|---------------------|-------------------------|
| Sec 21: "Cyber Terrorism" | Sec 21: **Cyber Stalking** |
| Sec 36: "Data Protection of Service Providers" | Sec 36: **Real-time Collection and Recording of Information** |
| Sec 37: "Data Retention" | Sec 37: **Forensic Laboratory** |

Section 10 is the actual Cyber Terrorism section. Sections 36 and 37 are both
out of scope — they are investigative-power provisions in Chapter III/IV, not
criminal offences, and they generate no system log events.

### Sections Analysed

**Chapter II — all 21 sections evaluated:**

| Section | Title | Decision | Rationale |
|---------|-------|----------|-----------|
| 3  | Unauthorized Access | Already covered | Rule 100100 |
| 4  | Unauthorized Copying/Transmission | Already covered | Rule 100101 |
| 5  | Interference with Information System or Data | **Added** | Syscheck file deletion (SID 553) |
| 6  | Unauthorized Access to Critical Infra | Already covered | Rule 100102 |
| 7  | Unauthorized Copying of Critical Infra Data | **Added** | Syscheck new file on critical path (SID 554) |
| 8  | Interference with Critical Infra | Already covered | Rule 100102 |
| 9  | Glorification of an Offence | Out of scope | Content-based: no system log event |
| 10 | Cyber Terrorism | **Added** | Overlay on Sec 6/7/8 parent rules (SID 100102, 100105) |
| 10A | Hate Speech | Out of scope | Content-based: no system log event |
| 10B | Recruitment/Funding/Planning of Terrorism | Out of scope | Content-based: no system log event |
| 11 | Electronic Forgery | Already covered | Rule 100101 |
| 12 | Electronic Fraud | **Added** | Web app injection attacks (if_group web + match) |
| 13 | Making/Obtaining Device for Use in Offence | **Added** | Syscheck: offensive tool binary added (SID 554 + match) |
| 14 | Unauthorized Use of Identity Information | **Added** | Syscheck: /etc/shadow modified (SID 550 + match) |
| 15 | Unauthorized Issuance of SIM Cards | Out of scope | Telecoms-operator obligation; no SIEM event |
| 16 | Tampering with Communication Equipment | Out of scope | Physical IMEI tampering; no standard log source |
| 17 | Unauthorized Interception | **Added** | Rootcheck: promiscuous mode / packet capture (if_group rootcheck + match) |
| 18 | Offences Against Dignity | Out of scope | Content-based: no system log event |
| 19 | Offences Against Modesty | Out of scope | Content-based: no system log event |
| 19A | Child Pornography | Out of scope | Content-based: no system log event |
| 20 | Malicious Code | Already covered | Rule 100103 |
| 21 | Cyber Stalking | **Added** | SSHD repeated auth failures (SID 5716) |
| 22 | Spamming | **Added** | Postfix bounce/reject/flood events (if_group postfix + match) |
| 23 | Spoofing | **Added** | Network attack: ARP/DNS spoofing (if_group attack + match) |

**Chapters III–VII (Sec 24–51) — all out of scope:**
Procedural, investigative-power, administrative, and international-cooperation
sections. None generate system log events detectable by a SIEM.

### New Rules Added

All 10 new rules appended to `peca-compliance/peca_rules.xml` inside the
existing `<group name="peca,">` block. Existing rules 100100–100103 were not
modified.

| Rule ID | PECA Section | Title | Level | Parent Anchor |
|---------|-------------|-------|-------|---------------|
| 100104 | 5  | Interference with Information System | 10 | if_sid 553 (syscheck file deleted) |
| 100105 | 7  | Unauthorized Copy of Critical Infra Data | 12 | if_sid 554 + match /opt/critical_app |
| 100106 | 10 | Cyber Terrorism | 12 | if_sid 100102, 100105 |
| 100107 | 12 | Electronic Fraud | 10 | if_group web + injection match |
| 100108 | 13 | Hacking Tool Detected | 7  | if_sid 554 + tool name match |
| 100109 | 14 | Identity Information Theft | 10 | if_sid 550 + match /etc/shadow |
| 100110 | 17 | Unauthorized Interception | 10 | if_group rootcheck + promiscuous/pcap match |
| 100111 | 21 | Cyber Stalking | 7  | if_sid 5716 (SSHD multiple auth failures) |
| 100112 | 22 | Spamming | 7  | if_group postfix + bounce/reject match |
| 100113 | 23 | Spoofing | 10 | if_group attack + spoof/arp-poison match |

### Rule Design Decisions

**Section 5 (SID 553 — file deleted):** File deletion is the most reliable
syscheck-visible indicator of intentional system interference. Bulk deletion
is characteristic of wiper malware and destructive DoS-type attacks.

**Section 7 (SID 554 + match):** A new file appearing in a monitored critical
path is the earliest syscheck-visible signal of data staging prior to
exfiltration. Narrowed to `/opt/critical_app` to match the existing critical
infrastructure path convention used in rule 100102.

**Section 10 (Cyber Terrorism) — rule chaining:** Rather than extending the
broad `critical_infrastructure` group (which would risk rule recursion since
100105 also outputs that group), rule 100106 extends specific SIDs 100102 and
100105. This fires the cyber-terrorism overlay exactly when a critical-infra
event is confirmed, with no chaining ambiguity. Output group does NOT include
`critical_infrastructure` to prevent circular re-triggering.

**Section 12 (Electronic Fraud):** Extended `if_group web` (covers all
Apache/nginx/IIS web log rules) with a match filter for injection and fraud
keywords. The match filter is required to avoid firing on every web access
log entry.

**Section 13 (Hacking Tools):** Used SID 554 (new file) with a match list of
known offensive-security tool names (nmap, metasploit, sqlmap, hydra, aircrack,
hashcat, john, nikto, netcat, msfconsole). Requires syscheck to monitor the
directories where tools would be installed (/usr/bin, /opt, /tmp etc.).

**Section 14 (Identity Information):** Used SID 550 (integrity changed) with
match `/etc/shadow` — the most definitive credential file on Linux. `/etc/passwd`
modification is already common for legitimate user management; `/etc/shadow`
modification is far more specific and suspicious.

**Section 17 (Interception) vs Section 20 (Malicious Code):** Both extend
`if_group rootcheck`. Rule 100103 (Sec 20) fires on ALL rootcheck events
(no match filter). Rule 100110 (Sec 17) adds a match filter for
`promiscuous|tcpdump|tshark|wireshark|libpcap` — so it fires only on rootcheck
events that contain packet-capture indicators. Both rules can fire on the same
event when rootcheck reports a sniffer — this is correct (the event maps to
two different PECA sections).

**Section 21 (Cyber Stalking) vs Section 3 (Unauthorized Access):** Rule 100100
(Sec 3) fires on single auth failures (SIDs 5710, 5716, 5503, 5504). Rule 100111
(Sec 21) fires specifically on SID 5716 (SSHD multiple auth failures = brute-force
pattern), which implies persistence — the distinguishing behavioral element of
cyber stalking. Both rules will fire when SID 5716 triggers; this dual-tagging
is intentional.

**Section 22 (Spamming):** Used `if_group postfix` to hook into the Postfix
log integration. Added a match filter (`reject|bounce|flood|too many|rate.limit|
blacklist|spam`) to avoid firing on every routine mail delivery event.

**Section 23 (Spoofing):** Used `if_group attack` (covers Snort/Suricata/arpwatch
integration rules) with a match for `spoof|arp.poison|arp_spoof|dns.poison|
cache.poison|gratuitous.arp` to isolate network-layer identity forgery events.

### Files Modified

| File | Change |
|------|--------|
| `peca-compliance/peca_rules.xml` | Added rules 100104–100113 (10 new rules) inside existing group block |
| `peca-compliance/README.md` | Fixed 3 incorrect section titles; added rows for all new rules; added out-of-scope section tables |
| `peca-compliance/PECA-2016-compliance-module.md` | Appended this session log |

### setup.sh — No Changes Required

The `install_pecaRules()` function in `setup.sh` copies all `peca_*.xml` files
from the repo's `peca-compliance/` directory to `/var/ossec/etc/rules/`. Because
the new rules are added to the existing `peca_rules.xml` file (not a new file),
no changes to `setup.sh` are needed.

To deploy the updated rules to the local Wazuh manager:
```bash
sudo bash /media/sf_sharedfolderclone/wazuh-fyp-repo/setup.sh --only pecaRules
```

### Current State

- `peca_rules.xml` now contains 14 rules (100100–100113)
- 16 PECA sections are covered by active rules (3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 17, 20, 21, 22, 23)
- All remaining Chapter II sections have been explicitly evaluated and documented as out of scope
- Rules have not yet been deployed; the local Wazuh manager must be restarted after `setup.sh --only pecaRules` to load the new rules
