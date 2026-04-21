# Wazuh AI Assistant Setup Log

**Started:** 2026-04-04  
**Goal:** Complete the Wazuh environment section of the AI Assistant-Wazuh Integration README  
**README location:** `/home/mint/Downloads/README.md`  
**Sections already completed (per user):** OpenSearch MCP Server, MCP-LLM Gateway

---

## Baseline Check

**Commands run:**
```bash
curl -sk https://localhost/
systemctl status wazuh-dashboard
```

**Result:**
- `curl -sk https://localhost/` → HTTP 302 redirect, exit code 0 (dashboard reachable)
- `wazuh-dashboard.service` → **active (running)** since 2026-03-03 12:57:55 PKT (over 1 month uptime)
- Dashboard PID: 62505, node process
- OSD version visible in logs: `osd-version: 2.19.4` (seen in request headers from browser)

**Baseline status: HEALTHY**

---

## Wazuh Environment — Step 1: Install OpenSearch Dashboards Plugins

**Status: COMPLETE**

**OSD version check:**
```bash
cat /usr/share/wazuh-dashboard/package.json
# → version: 2.19.4
```
README uses 2.19.2 but this system is 2.19.4 — downloaded matching tarball.

**Commands run:**
```bash
# Download matching OSD tarball (338 MB)
cd /tmp && curl -# https://artifacts.opensearch.org/releases/bundle/opensearch-dashboards/2.19.4/opensearch-dashboards-2.19.4-linux-x64.tar.gz -o opensearch-dashboards-2.19.4.tar.gz

# Extract only the two plugins needed
tar -xzf opensearch-dashboards-2.19.4.tar.gz \
  --wildcards \
  'opensearch-dashboards-2.19.4/plugins/assistantDashboards/*' \
  'opensearch-dashboards-2.19.4/plugins/mlCommonsDashboards/*'

# Copy to wazuh-dashboard plugins dir
cp -r /tmp/opensearch-dashboards-2.19.4/plugins/assistantDashboards/ /usr/share/wazuh-dashboard/plugins/
cp -r /tmp/opensearch-dashboards-2.19.4/plugins/mlCommonsDashboards/ /usr/share/wazuh-dashboard/plugins/

# Set ownership and permissions
chown -R wazuh-dashboard:wazuh-dashboard /usr/share/wazuh-dashboard/plugins/assistantDashboards/
chown -R wazuh-dashboard:wazuh-dashboard /usr/share/wazuh-dashboard/plugins/mlCommonsDashboards/
chmod -R 750 /usr/share/wazuh-dashboard/plugins/assistantDashboards/
chmod -R 750 /usr/share/wazuh-dashboard/plugins/mlCommonsDashboards/

# Add assistant config
echo "assistant.chat.enabled: true" >> /etc/wazuh-dashboard/opensearch_dashboards.yml

# Restart and verify
systemctl restart wazuh-dashboard
curl -sk https://localhost/ -o /dev/null -w "%{http_code}"  # → 302
```

**Result:**
- Both plugins extracted and copied successfully
- Ownership: `wazuh-dashboard:wazuh-dashboard` on both dirs
- Both plugins loaded as part of 53-plugin startup (confirmed in journalctl logs): `mlCommonsDashboards`, `assistantDashboards`
- Dashboard restarted and returned 302 — **HEALTHY**

---

## Wazuh Environment — Step 2: Cluster Settings

**Status: COMPLETE**

**Admin cert path:** `/etc/wazuh-indexer/certs/` (root-ca.pem, admin.pem, admin-key.pem)  
**Indexer endpoint:** `https://127.0.0.1:9200`  
**Gateway IP:** `10.0.2.15` (host IP, gateway listens on 0.0.0.0:9912)

**Commands run:**
```bash
DIR="/etc/wazuh-indexer/certs"

# 1. Enable agent framework
curl -sk --cacert $DIR/root-ca.pem --cert $DIR/admin.pem --key $DIR/admin-key.pem \
  -XPUT https://127.0.0.1:9200/_cluster/settings \
  -H 'Content-Type: application/json' \
  -d '{"persistent":{"plugins.ml_commons.agent_framework_enabled":true}}'
# → acknowledged: true

# 2. Allow non-ML nodes
curl -sk --cacert $DIR/root-ca.pem --cert $DIR/admin.pem --key $DIR/admin-key.pem \
  -XPUT https://127.0.0.1:9200/_cluster/settings \
  -H 'Content-Type: application/json' \
  -d '{"persistent":{"plugins.ml_commons.only_run_on_ml_node":"false"}}'
# → acknowledged: true

# 3. Private IP + trusted endpoints (gateway at 10.0.2.15:9912)
curl -sk --cacert $DIR/root-ca.pem --cert $DIR/admin.pem --key $DIR/admin-key.pem \
  -XPUT https://127.0.0.1:9200/_cluster/settings \
  -H 'Content-Type: application/json' \
  -d '{
    "persistent": {
      "plugins.ml_commons.connector.private_ip_enabled": true,
      "plugins.ml_commons.trusted_connector_endpoints_regex": [
        "^https://runtime\\.sagemaker\\..*[a-z0-9-]\\.amazonaws\\.com/.*$",
        "^https://api\\.openai\\.com/.*$",
        "^https://api\\.cohere\\.ai/.*$",
        "^https://bedrock-runtime\\..*[a-z0-9-]\\.amazonaws\\.com/.*$",
        "^http://10\\.0\\.2\\.15:9912/.*$"
      ]
    }
  }'
# → acknowledged: true, all settings persisted
```

**Dashboard status after step: HEALTHY (302)**

---

## Wazuh Environment — Step 3: Register Remote Model

**Status: COMPLETE**

**Commands run:**
```bash
DIR="/etc/wazuh-indexer/certs"
curl -sk --cacert $DIR/root-ca.pem --cert $DIR/admin.pem --key $DIR/admin-key.pem \
  -XPOST https://127.0.0.1:9200/_plugins/_ml/models/_register \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "mcp-llm-gateway-model",
    "function_name": "remote",
    "description": "Remote model: OpenSearch -> MCP+LLM Gateway",
    "connector": {
      "name": "mcp-llm-gateway-connector",
      "version": 1,
      "protocol": "http",
      "parameters": { "endpoint": "http://10.0.2.15:9912/analyze" },
      "credential": { "api_key": "secret" },
      "actions": [{
        "action_type": "predict",
        "method": "POST",
        "url": "${parameters.endpoint}",
        "headers": {
          "Content-Type": "application/json",
          "X-API-Key": "${credential.api_key}"
        },
        "request_body": "{ \"parameters\": { \"prompt\": \"${parameters.prompt}\" } }",
        "request_timeout": "120s"
      }]
    }
  }'
```

**Result:**
```json
{"task_id": "rJl6WZ0BMG6XxlpYf9FB", "status": "CREATED", "model_id": "mcp-llm-gateway-model"}
```
Task state: COMPLETED. Model ID: **`mcp-llm-gateway-model`**  
Note: model_id is the model name (not a hash), confirmed via task lookup and direct GET.

**Dashboard status after step: HEALTHY (302)**

---

## Wazuh Environment — Step 4: Deploy the Model

**Status: COMPLETE**

**Commands run:**
```bash
DIR="/etc/wazuh-indexer/certs"
curl -sk --cacert $DIR/root-ca.pem --cert $DIR/admin.pem --key $DIR/admin-key.pem \
  -XPOST https://127.0.0.1:9200/_plugins/_ml/models/mcp-llm-gateway-model/_deploy
```

**Result:**
```json
{"task_id": "rZl7WZ0BMG6XxlpYAdE7", "task_type": "DEPLOY_MODEL", "status": "COMPLETED"}
```
Deployed synchronously — COMPLETED immediately.

**Dashboard status after step: HEALTHY (302)**

---

## Wazuh Environment — Step 5: Create Conversational Agent

**Status: COMPLETE**

**Commands run:**
```bash
DIR="/etc/wazuh-indexer/certs"
curl -sk --cacert $DIR/root-ca.pem --cert $DIR/admin.pem --key $DIR/admin-key.pem \
  -XPOST https://127.0.0.1:9200/_plugins/_ml/agents/_register \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "mcp-os-agent",
    "type": "conversational",
    "app_type": "os_chat",
    "description": "Conversational agent that delegates to MCP+LLM gateway; MCP tool-calls happen in the gateway.",
    "llm": {
      "model_id": "mcp-llm-gateway-model",
      "parameters": {
        "prompt": "${parameters.question}",
        "response_filter": "$.output.message",
        "max_iteration": 1,
        "stop_when_no_tool_found": true,
        "message_history_limit": 10
      }
    },
    "memory": { "type": "conversation_index" },
    "tools": [{ "type": "SearchIndexTool", "name": "placeholder_noop" }]
  }'
```

**Result:**
```json
{"agent_id": "r5l7WZ0BMG6XxlpYPdEp"}
```
Agent ID: **`r5l7WZ0BMG6XxlpYPdEp`**

**Dashboard status after step: HEALTHY (302)**

---

## Wazuh Environment — Step 6: Set Agent as Root Agent

**Status: COMPLETE**

**Commands run:**
```bash
DIR="/etc/wazuh-indexer/certs"
curl -sk --cacert $DIR/root-ca.pem --cert $DIR/admin.pem --key $DIR/admin-key.pem \
  -XPUT https://127.0.0.1:9200/.plugins-ml-config/_doc/os_chat \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "os_chat_root_agent",
    "configuration": { "agent_id": "r5l7WZ0BMG6XxlpYPdEp" }
  }'
```

**Result:**
```json
{"_index": ".plugins-ml-config", "_id": "os_chat", "_version": 1, "result": "created", ...}
```
Root agent configured successfully (result: created).

**Dashboard status after step: HEALTHY (302)**

---

## Wazuh Environment — Step 7: Test the Agent

**Status: COMPLETE**

**Commands run:**
```bash
DIR="/etc/wazuh-indexer/certs"
curl -sk --cacert $DIR/root-ca.pem --cert $DIR/admin.pem --key $DIR/admin-key.pem \
  -XPOST https://127.0.0.1:9200/_plugins/_ml/agents/r5l7WZ0BMG6XxlpYPdEp/_execute \
  -H 'Content-Type: application/json' \
  -d '{"parameters": {"question": "Hello", "verbose": true}}'
```

**Result:**
```json
{
  "inference_results": [{
    "output": [
      {"name": "memory_id", "result": "sJl7WZ0BMG6XxlpYjtF3"},
      {"name": "parent_interaction_id", "result": "sZl7WZ0BMG6XxlpYkNEn"},
      {"name": "response", "result": "Hello! I can help with cybersecurity questions and analyze alerts and vulnerabilities from your Wazuh environment.\nExamples of queries:\n- Analyze the most important alerts in my environment\n- Analyze brute force attack alerts\n- List critical CVEs"}
    ]
  }]
}
```
Response matches README expected output exactly. Agent is functional end-to-end.

**Dashboard status after step: HEALTHY (302)**

---

## Wazuh Environment — Step 8: Personalize Dashboard Assistant UI

**Status: COMPLETE**

**Commands run:**
```bash
# Install brotli
apt-get install -y brotli

# Fetch the UI customization script from GitHub
curl -s "https://raw.githubusercontent.com/wazuh/integrations/main/integrations/AI_assistant/config/dashboard/dashboard-assistant-ui.sh" \
  -o /tmp/dashboard-assistant-ui.sh

# Run the script (backs up JS files, replaces "OpenSearch Assistant" with "Dashboard assistant",
# replaces OpenSearch logo with Wazuh logo SVG, recompresses with gzip and brotli)
chmod +x /tmp/dashboard-assistant-ui.sh
bash /tmp/dashboard-assistant-ui.sh

# Restart dashboard
systemctl restart wazuh-dashboard
```

**Result:**
- Script completed without errors
- Backed up: assistantDashboards.chunk.10.js{,.br,.gz}.bak and assistantDashboards.plugin.js{,.br,.gz}.bak
- Replaced UI strings and logo in both JS files
- Recompressed with gzip and brotli
- Dashboard restarted: active, returns 302

**Dashboard status after step: HEALTHY (302)**

---

## LLM Credentials — Gemini Setup

**Status: COMPLETE — All components operational**  
**Date:** 2026-04-04

### What was done

The gateway originally used AWS Bedrock (invalid credentials). Switched to Google Gemini via its OpenAI-compatible API.

**Gateway Python script modified** (`/opt/mcp_llm_gateway-env/mcp_llm_gateway.py`):
- Added `GEMINI_API_KEY` and `GEMINI_MODEL` env vars
- Added `gemini` provider case in `_build_llm()` using `ChatOpenAI` with Gemini's base URL:
  ```python
  ChatOpenAI(
      model=GEMINI_MODEL,
      temperature=0,
      base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
      api_key=GEMINI_API_KEY,
  )
  ```
- Simplified health check LLM test to call `_build_llm()` directly (covers all providers)
- Updated health response to show correct model name for all providers

**Gateway env file updated** (`/etc/mcp-llm-gateway/mcp-llm-gateway.env`):
```
LLM_PROVIDER="gemini"
GEMINI_API_KEY="<key from /home/mint/geminikey>"
GEMINI_MODEL="gemini-2.5-flash"
```

**Model selection note:**  
`gemini-3.1-pro-preview` was requested but has a free-tier quota of 0 (paid plan required). `gemini-2.5-flash` was chosen as it works on the free tier and is available under this API key.

**Commands run:**
```bash
systemctl restart mcp-llm-gateway
curl -s http://127.0.0.1:9912/health
```

**Health check result:**
```json
{"summary": "All components operational.", "status": {"gateway": "ok", "llm": "ok", "mcp": "ok"}, "details": {"mcp_tools_count": 11}, "provider": "gemini", "model": "gemini-2.5-flash"}
```

**End-to-end test** (real security query through full stack):
```bash
POST /_plugins/_ml/agents/r5l7WZ0BMG6XxlpYPdEp/_execute
{"parameters": {"question": "Analyze the most important alerts in my environment"}}
# → response: "No endpoints are affected by important alerts in the monitored environment (0 records found)."
```
Query routed: Wazuh ML Commons → gateway → Gemini → MCP → Wazuh Indexer → response. Fully functional.

---

## SETUP COMPLETE

**All steps completed and verified on 2026-04-04.**

### Key IDs and Values
| Item | Value |
|------|-------|
| OSD version | 2.19.4 |
| Host IP | 10.0.2.15 |
| Gateway port | 9912 |
| MCP server port | 9900 |
| Gateway API key | `secret` |
| LLM provider | `gemini` |
| LLM model | `gemini-2.5-flash` |
| Gemini API key file | `/home/mint/geminikey` |
| Model ID (OpenSearch) | `mcp-llm-gateway-model` |
| Agent ID | `r5l7WZ0BMG6XxlpYPdEp` |
| Admin certs | `/etc/wazuh-indexer/certs/` |

### Services Running
| Service | Status |
|---------|--------|
| wazuh-dashboard | active |
| wazuh-indexer | active |
| mcp-server | active (port 9900) |
| mcp-llm-gateway | active (port 9912) |

### Using the chatbot
- Open the Wazuh Dashboard in your browser: `https://localhost/`
- Click the **chat icon** in the top-right corner
- Sign out and back in if the icon is not visible after the plugin install

### To switch LLM model in the future
Edit `/etc/mcp-llm-gateway/mcp-llm-gateway.env`, change `GEMINI_MODEL`, then:
```bash
systemctl restart mcp-llm-gateway
```

---

## Issue — wazuh-manager "API is down" after restart (2026-04-12)

### Symptom

Wazuh Dashboard showed **"API is down"** for the default API connection. All wazuh-manager processes were stopped (`wazuh-apid not running`, etc.). `systemctl status wazuh-manager` showed:

```
Active: failed (Result: timeout)
wazuh-manager.service: start operation timed out. Terminating.
```

### Root cause

The `wazuh-manager.service` unit file has `TimeoutSec=45`. The startup sequence (loading modulesd, analysisd, db, apid, etc.) takes ~26 seconds under normal conditions but can exceed 45 seconds under VM load. systemd killed the startup mid-way, leaving all processes stopped.

### Fix

**1. Start the manager immediately (one-off):**
```bash
sudo /var/ossec/bin/wazuh-control start
```

**2. Permanently increase the systemd start timeout to 120 seconds:**
```bash
sudo mkdir -p /etc/systemd/system/wazuh-manager.service.d
sudo tee /etc/systemd/system/wazuh-manager.service.d/timeout.conf <<'EOF'
[Service]
TimeoutStartSec=120
EOF
sudo systemctl daemon-reload
```

The drop-in file at `/etc/systemd/system/wazuh-manager.service.d/timeout.conf` persists across package upgrades and reboots.

### Verification

```bash
sudo /var/ossec/bin/wazuh-control status   # wazuh-apid should show "is running"
curl -sk -u "wazuh-wui:<password>" \
     https://localhost:55000/security/user/authenticate -X GET
# → {"data":{"token":"..."},"error":0}
```

API credentials (`wazuh-wui` user + password) are in `/usr/share/wazuh-dashboard/data/wazuh/config/wazuh.yml`.

### Notes

- `wazuh-clusterd`, `wazuh-maild`, `wazuh-agentlessd`, `wazuh-dbd`, `wazuh-csyslogd`, `wazuh-integratord` not running is **normal** in a single-node setup — these are optional services.
- If the manager fails to start again after a reboot, run `sudo /var/ossec/bin/wazuh-control start` manually; the timeout fix prevents future occurrences.

---

## Session: Install Script Feature Flags — 2026-04-13

### What was changed

Rewrote `setup.sh` from a single linear script (818 lines) to a function-based script with feature flag support (957 lines). No new folder — this is a modification to the root-level install script.

### Feature registry

Defined in `ALL_FEATURES` array (canonical install order):

| Feature | Function | What it does |
|---|---|---|
| `pecaRules` | `install_pecaRules()` | Steps B — copy XML rules, check/fix ID conflicts, restart manager |
| `aiAssistant` | `install_aiAssistant()` | Steps C–G — MCP server, gateway, dashboard plugins, ML Commons, model+agent |
| `networkGraph` | `install_networkGraph()` | Calls `networkGraph/install.sh` |
| `nlqSearch` | `install_nlqSearch()` | Calls `nlqSearch/install.sh` |
| `complianceView` | `install_complianceView()` | Steps I — bundle patching, recompression |

### New flags

```
sudo bash setup.sh                              # all features (default, unchanged)
sudo bash setup.sh --only networkGraph nlqSearch
sudo bash setup.sh --skip complianceView
sudo bash setup.sh --list
sudo bash setup.sh --help
```

`--only` and `--skip` are mutually exclusive. Unknown feature names cause an immediate fatal error. `--peca` (legacy flag) maps to `--only complianceView`.

### Error handling changes

- Old: `set -euo pipefail` + `error()` calling `exit 1` — any failure aborted the whole script.
- New: `set -uo pipefail` (no `-e`) + `error()` prints without exiting + `fatal()` exits (used only in `shared_setup` and arg parsing). Each feature function uses `|| return 1` on critical commands. Main loop catches failures and continues.
- Summary table printed at end: `[OK]` / `[FAILED]` / `[SKIP]` per feature. Exit code 1 if any feature failed.

### Dashboard restart

Previously: restarted wazuh-dashboard after Step E (aiAssistant), Step H2 (nlqSearch), and Step I (complianceView) — three restarts in a full install.

Now: single restart after all features complete.

### README.md

Added "Feature Flags" subsection under "How to Run setup.sh" with usage examples, feature table, error handling notes, and single-restart behaviour.
