#!/usr/bin/env bash
# =============================================================================
# Wazuh FYP — Full Stack Setup Script
# =============================================================================
# Tested on: Ubuntu 24.04 LTS / Linux Mint (clean install)
# Run as: regular user with sudo privileges
# Usage:  bash setup.sh
#
# This script installs and configures:
#   1. Wazuh all-in-one (manager + indexer + dashboard)
#   2. PECA compliance detection rules
#   3. OpenSearch MCP Server (Python service)
#   4. MCP-LLM Gateway (FastAPI + LangChain Python service)
#   5. Dashboard AI-assistant plugins (assistantDashboards + mlCommonsDashboards)
#   6. ML Commons cluster settings + remote model + conversational agent
# =============================================================================

set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Locate repo root (directory containing this script) ───────────────────────
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# =============================================================================
# STEP A — Install Wazuh all-in-one
# =============================================================================
info "=== STEP A: Installing Wazuh all-in-one ==="

if systemctl is-active --quiet wazuh-manager 2>/dev/null; then
    warn "wazuh-manager is already running — skipping Wazuh install."
else
    info "Downloading wazuh-install.sh …"
    curl -sO https://packages.wazuh.com/4.14/wazuh-install.sh
    info "Running Wazuh installer (this takes several minutes) …"
    sudo bash ./wazuh-install.sh -a
    success "Wazuh installer completed."
fi

info "Waiting for Wazuh Indexer (OpenSearch) to become healthy …"
RETRIES=60
COUNT=0
until curl -sk https://localhost:9200 | grep -q '"status"' 2>/dev/null; do
    COUNT=$((COUNT + 1))
    if [ "$COUNT" -ge "$RETRIES" ]; then
        error "Wazuh Indexer did not become healthy after $((RETRIES * 5)) seconds. Check logs."
    fi
    info "  Attempt $COUNT/$RETRIES — waiting 5 s …"
    sleep 5
done
success "Wazuh Indexer is healthy."

# =============================================================================
# STEP B — Deploy PECA rules
# =============================================================================
info "=== STEP B: Deploying PECA compliance rules ==="

RULES_SRC="$REPO_DIR/peca-compliance"
RULES_DEST="/var/ossec/etc/rules"

if [ ! -d "$RULES_SRC" ] || [ -z "$(ls -A "$RULES_SRC"/*.xml 2>/dev/null)" ]; then
    error "No XML rule files found in $RULES_SRC — cannot continue."
fi

sudo cp "$RULES_SRC"/*.xml "$RULES_DEST/"
success "Rules copied to $RULES_DEST."

# ── Check for rule ID conflicts ───────────────────────────────────────────────
info "Checking for rule ID conflicts …"

PECA_FILE="$RULES_DEST/peca_rules.xml"

# Collect IDs from every rule file except peca_rules.xml
OTHER_IDS=""
for _f in "$RULES_DEST"/*.xml; do
    [ "$(basename "$_f")" = "peca_rules.xml" ] && continue
    OTHER_IDS="$OTHER_IDS
$(sudo grep -oP '(?<=id=")[0-9]+' "$_f" 2>/dev/null)"
done
OTHER_IDS=$(echo "$OTHER_IDS" | sort -u | grep -v '^$')

# Collect PECA rule IDs (order preserved for stable renumbering)
PECA_IDS=$(sudo grep -oP '(?<=id=")[0-9]+' "$PECA_FILE" 2>/dev/null)

CONFLICTS=""
for _id in $PECA_IDS; do
    if echo "$OTHER_IDS" | grep -qx "$_id"; then
        CONFLICTS="$CONFLICTS $_id"
    fi
done
CONFLICTS="${CONFLICTS# }"

if [ -n "$CONFLICTS" ]; then
    warn "Rule ID conflicts detected: $CONFLICTS"
    warn "Renumbering conflicting PECA rules starting from 100100 …"

    PECA_TMP=$(mktemp)
    sudo cp "$PECA_FILE" "$PECA_TMP"
    sudo chmod 644 "$PECA_TMP"

    NEXT_ID=100100
    ASSIGNED=""
    for _old in $CONFLICTS; do
        # Advance past any ID already in use by other files or already assigned this pass
        while echo "$OTHER_IDS $ASSIGNED" | grep -qw "$NEXT_ID"; do
            NEXT_ID=$((NEXT_ID + 1))
        done
        sed -i "s/id=\"${_old}\"/id=\"${NEXT_ID}\"/g" "$PECA_TMP"
        info "  Rule ID ${_old} → ${NEXT_ID}"
        ASSIGNED="$ASSIGNED $NEXT_ID"
        NEXT_ID=$((NEXT_ID + 1))
    done

    sudo cp "$PECA_TMP" "$PECA_FILE"
    rm -f "$PECA_TMP"
    success "PECA rules renumbered."
else
    info "No rule ID conflicts found."
fi

info "Restarting wazuh-manager …"
sudo systemctl restart wazuh-manager
success "wazuh-manager restarted."

# =============================================================================
# STEP C — Set up OpenSearch MCP Server
# =============================================================================
info "=== STEP C: Setting up OpenSearch MCP Server ==="

# Directories
sudo mkdir -p /opt/mcp_server-env /var/log/mcp_server /etc/mcp-server

# Dedicated system user
sudo useradd --system --no-create-home --shell /usr/sbin/nologin mcpserver 2>/dev/null || true

# Permissions
sudo chown -R root:root /etc/mcp-server
sudo chmod 750 /etc/mcp-server
sudo touch /etc/mcp-server/mcp-server.env
sudo chmod 640 /etc/mcp-server/mcp-server.env
sudo chown -R mcpserver:mcpserver /var/log/mcp_server
sudo chmod 750 /var/log/mcp_server

# Python venv
info "Creating Python venv at /opt/mcp_server-env …"
sudo apt-get install -y python3-venv python3-pip 2>/dev/null | grep -E "^(Get|Inst|Sett)" || true
sudo python3 -m venv /opt/mcp_server-env
sudo /opt/mcp_server-env/bin/pip install --quiet --upgrade pip
sudo /opt/mcp_server-env/bin/pip install --quiet opensearch-mcp-server-py
success "opensearch-mcp-server-py installed."

# Config file
if [ ! -s /etc/mcp-server/mcp-server.env ]; then
    sudo cp "$REPO_DIR/ai-assistant/mcp-server.env.example" /etc/mcp-server/mcp-server.env
    echo ""
    warn "ACTION REQUIRED: Fill in the Wazuh Indexer credentials in /etc/mcp-server/mcp-server.env"
    warn "  sudo nano /etc/mcp-server/mcp-server.env"
    warn "Press ENTER to continue once you have saved the file, or Ctrl-C to abort."
    read -r _
fi

# Systemd service
sudo cp "$REPO_DIR/ai-assistant/services/mcp-server.service" /etc/systemd/system/mcp-server.service
sudo systemctl daemon-reload
sudo systemctl enable mcp-server
sudo systemctl restart mcp-server
success "mcp-server service enabled and started."

# =============================================================================
# STEP D — Set up MCP-LLM Gateway
# =============================================================================
info "=== STEP D: Setting up MCP-LLM Gateway ==="

# Directories
sudo mkdir -p /opt/mcp_llm_gateway-env /var/log/mcp_llm_gateway /etc/mcp-llm-gateway

# Dedicated system user
sudo useradd --system --no-create-home --shell /usr/sbin/nologin mcpgateway 2>/dev/null || true

# Permissions on config dir
sudo chown root:mcpgateway /etc/mcp-llm-gateway
sudo chmod 750 /etc/mcp-llm-gateway
sudo touch /etc/mcp-llm-gateway/mcp-llm-gateway.env
sudo touch /etc/mcp-llm-gateway/mcp-llm-gateway.prompt
sudo chown root:mcpgateway /etc/mcp-llm-gateway/mcp-llm-gateway.env
sudo chown root:mcpgateway /etc/mcp-llm-gateway/mcp-llm-gateway.prompt
sudo chmod 640 /etc/mcp-llm-gateway/mcp-llm-gateway.env
sudo chmod 640 /etc/mcp-llm-gateway/mcp-llm-gateway.prompt

# Permissions on log dir
sudo chown -R mcpgateway:mcpgateway /var/log/mcp_llm_gateway
sudo chmod 750 /var/log/mcp_llm_gateway

# Python venv
info "Creating Python venv at /opt/mcp_llm_gateway-env …"
sudo python3 -m venv /opt/mcp_llm_gateway-env
sudo /opt/mcp_llm_gateway-env/bin/pip install --quiet --upgrade pip

# Install pinned dependencies (versions verified on this installation)
info "Installing pinned Python dependencies …"
sudo /opt/mcp_llm_gateway-env/bin/pip install --quiet \
    "fastapi==0.128.0" \
    "uvicorn[standard]==0.40.0" \
    "pydantic==2.12.5" \
    "langchain==0.3.27" \
    "langchain-core==0.3.79" \
    "langchain-openai==0.3.35" \
    "langchain-anthropic==0.3.22" \
    "langchain-mcp-adapters==0.1.9" \
    "langchain-aws==0.2.35" \
    "boto3==1.42.30" \
    "httpx==0.28.1"
success "Gateway dependencies installed."

# Copy gateway script
sudo cp "$REPO_DIR/ai-assistant/mcp_llm_gateway.py" /opt/mcp_llm_gateway-env/mcp_llm_gateway.py
sudo chmod 644 /opt/mcp_llm_gateway-env/mcp_llm_gateway.py

# Copy prompt
sudo cp "$REPO_DIR/ai-assistant/mcp-llm-gateway.prompt" /etc/mcp-llm-gateway/mcp-llm-gateway.prompt
sudo chown root:mcpgateway /etc/mcp-llm-gateway/mcp-llm-gateway.prompt
sudo chmod 640 /etc/mcp-llm-gateway/mcp-llm-gateway.prompt

# Config file
if [ ! -s /etc/mcp-llm-gateway/mcp-llm-gateway.env ]; then
    sudo cp "$REPO_DIR/ai-assistant/mcp-llm-gateway.env.example" /etc/mcp-llm-gateway/mcp-llm-gateway.env
    sudo chown root:mcpgateway /etc/mcp-llm-gateway/mcp-llm-gateway.env
    sudo chmod 640 /etc/mcp-llm-gateway/mcp-llm-gateway.env
    echo ""
    warn "ACTION REQUIRED: Fill in your LLM credentials in /etc/mcp-llm-gateway/mcp-llm-gateway.env"
    warn "  Set LLM_PROVIDER and the matching API key (GEMINI_API_KEY, OPENAI_API_KEY, or AWS vars)."
    warn "  Also set GATEWAY_API_KEY and MCP_SSE_URL."
    warn "  sudo nano /etc/mcp-llm-gateway/mcp-llm-gateway.env"
    warn "Press ENTER to continue once you have saved the file, or Ctrl-C to abort."
    read -r _
fi

# Systemd service
sudo cp "$REPO_DIR/ai-assistant/services/mcp-llm-gateway.service" /etc/systemd/system/mcp-llm-gateway.service
sudo systemctl daemon-reload
sudo systemctl enable mcp-llm-gateway
sudo systemctl restart mcp-llm-gateway
success "mcp-llm-gateway service enabled and started."

# =============================================================================
# STEP E — Install Dashboard plugins (version-safe)
# =============================================================================
info "=== STEP E: Installing Wazuh Dashboard AI-assistant plugins ==="

# Read actual OSD version from package.json
OSD_PKG="/usr/share/wazuh-dashboard/package.json"
if [ ! -r "$OSD_PKG" ]; then
    warn "Cannot read $OSD_PKG (permission denied). Trying with sudo …"
    OSD_VERSION=$(sudo python3 -c "import json; d=json.load(open('$OSD_PKG')); print(d['version'])" 2>/dev/null) \
        || error "Could not determine OSD version from $OSD_PKG."
else
    OSD_VERSION=$(python3 -c "import json; d=json.load(open('$OSD_PKG')); print(d['version'])")
fi
info "Detected OSD version: $OSD_VERSION"

TARBALL="opensearch-dashboards-${OSD_VERSION}-linux-x64.tar.gz"
TARBALL_URL="https://artifacts.opensearch.org/releases/bundle/opensearch-dashboards/${OSD_VERSION}/${TARBALL}"
EXTRACT_DIR="/tmp/opensearch-dashboards-${OSD_VERSION}"

info "Downloading OSD tarball (this may take a few minutes) …"
curl -# "$TARBALL_URL" -o "/tmp/$TARBALL" \
    || error "Failed to download $TARBALL_URL — check the OSD version and your internet connection."

info "Extracting plugin directories only …"
tar -xzf "/tmp/$TARBALL" -C /tmp \
    --wildcards \
    "opensearch-dashboards-${OSD_VERSION}/plugins/assistantDashboards/*" \
    "opensearch-dashboards-${OSD_VERSION}/plugins/mlCommonsDashboards/*" \
    || error "Failed to extract plugins from tarball. The OSD version ($OSD_VERSION) may not contain these plugins."

PLUGINS_DEST="/usr/share/wazuh-dashboard/plugins"

info "Copying plugins to $PLUGINS_DEST …"
sudo cp -r "$EXTRACT_DIR/plugins/assistantDashboards/"    "$PLUGINS_DEST/"
sudo cp -r "$EXTRACT_DIR/plugins/mlCommonsDashboards/"    "$PLUGINS_DEST/"

sudo chown -R wazuh-dashboard:wazuh-dashboard "$PLUGINS_DEST/assistantDashboards/"
sudo chown -R wazuh-dashboard:wazuh-dashboard "$PLUGINS_DEST/mlCommonsDashboards/"
sudo chmod -R 750 "$PLUGINS_DEST/assistantDashboards/"
sudo chmod -R 750 "$PLUGINS_DEST/mlCommonsDashboards/"
success "Plugins installed."

# Add assistant config to dashboard yml (idempotent)
DASH_YML="/etc/wazuh-dashboard/opensearch_dashboards.yml"
if ! sudo grep -q "assistant.chat.enabled" "$DASH_YML" 2>/dev/null; then
    echo "assistant.chat.enabled: true" | sudo tee -a "$DASH_YML" > /dev/null
    success "Added assistant.chat.enabled: true to $DASH_YML"
else
    info "assistant.chat.enabled already present in $DASH_YML — skipping."
fi

# Restart dashboard and verify
info "Restarting wazuh-dashboard …"
sudo systemctl restart wazuh-dashboard

DASH_OK=0
for i in $(seq 1 12); do
    HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" https://localhost/ 2>/dev/null || true)
    if [ "$HTTP_CODE" = "302" ] || [ "$HTTP_CODE" = "200" ]; then
        DASH_OK=1
        break
    fi
    info "  Dashboard not yet up (attempt $i/12) — waiting 5 s …"
    sleep 5
done

if [ "$DASH_OK" -ne 1 ]; then
    warn "Dashboard did not come back up after plugin install. Rolling back …"
    sudo rm -rf "$PLUGINS_DEST/assistantDashboards" "$PLUGINS_DEST/mlCommonsDashboards"
    # Remove the assistant config line
    sudo sed -i '/assistant\.chat\.enabled/d' "$DASH_YML"
    sudo systemctl restart wazuh-dashboard
    error "Plugin installation failed — version mismatch? OSD version was $OSD_VERSION. Dashboard has been restored."
fi
success "Wazuh Dashboard is healthy with plugins installed."

# Personalise Dashboard Assistant UI (optional — replaces OpenSearch branding)
info "Personalising Dashboard Assistant UI …"
sudo apt-get install -y brotli 2>/dev/null | grep -E "^(Get|Inst|Sett)" || true
DASH_UI_SCRIPT=$(mktemp /tmp/dashboard-assistant-ui-XXXXXX.sh)
curl -s "https://raw.githubusercontent.com/wazuh/integrations/main/integrations/AI_assistant/config/dashboard/dashboard-assistant-ui.sh" \
    -o "$DASH_UI_SCRIPT" && chmod +x "$DASH_UI_SCRIPT" && sudo bash "$DASH_UI_SCRIPT" \
    && sudo systemctl restart wazuh-dashboard \
    && success "Dashboard UI personalisation applied." \
    || warn "Dashboard UI personalisation failed (non-fatal — continuing)."

# =============================================================================
# STEP F — Apply cluster settings
# =============================================================================
info "=== STEP F: Applying ML Commons cluster settings ==="

DIR="/etc/wazuh-indexer/certs"

# Prompt for gateway IP
echo ""
info "What is the IP address of the host running the MCP-LLM Gateway?"
info "(This machine's primary IP is: $(hostname -I | awk '{print $1}'))"
printf "  Gateway IP [default: %s]: " "$(hostname -I | awk '{print $1}')"
read -r GATEWAY_IP
GATEWAY_IP="${GATEWAY_IP:-$(hostname -I | awk '{print $1}')}"
info "Using gateway IP: $GATEWAY_IP"

CURL_BASE="curl -sk --cacert $DIR/root-ca.pem --cert $DIR/admin.pem --key $DIR/admin-key.pem"
INDEXER="https://127.0.0.1:9200"

info "1/3 Enabling agent framework …"
$CURL_BASE -XPUT "$INDEXER/_cluster/settings" \
    -H 'Content-Type: application/json' \
    -d '{"persistent":{"plugins.ml_commons.agent_framework_enabled":true}}' \
    | grep -q '"acknowledged":true' || error "Failed to enable agent framework."
success "Agent framework enabled."

info "2/3 Allowing non-ML nodes …"
$CURL_BASE -XPUT "$INDEXER/_cluster/settings" \
    -H 'Content-Type: application/json' \
    -d '{"persistent":{"plugins.ml_commons.only_run_on_ml_node":"false"}}' \
    | grep -q '"acknowledged":true' || error "Failed to set only_run_on_ml_node."
success "Non-ML node execution allowed."

info "3/3 Setting private IP and trusted connector endpoints …"
$CURL_BASE -XPUT "$INDEXER/_cluster/settings" \
    -H 'Content-Type: application/json' \
    -d "{
      \"persistent\": {
        \"plugins.ml_commons.connector.private_ip_enabled\": true,
        \"plugins.ml_commons.trusted_connector_endpoints_regex\": [
          \"^https://runtime\\\\.sagemaker\\\\..*[a-z0-9-]\\\\.amazonaws\\\\.com/.*\$\",
          \"^https://api\\\\.openai\\\\.com/.*\$\",
          \"^https://api\\\\.cohere\\\\.ai/.*\$\",
          \"^https://bedrock-runtime\\\\..*[a-z0-9-]\\\\.amazonaws\\\\.com/.*\$\",
          \"^http://${GATEWAY_IP}:9912/.*\$\"
        ]
      }
    }" | grep -q '"acknowledged":true' || error "Failed to set trusted endpoints."
success "Cluster settings applied."

# =============================================================================
# STEP G — Register ML model and conversational agent
# =============================================================================
info "=== STEP G: Registering ML model and conversational agent ==="

# Prompt for gateway API key
echo ""
info "What GATEWAY_API_KEY did you set in /etc/mcp-llm-gateway/mcp-llm-gateway.env?"
printf "  Gateway API key: "
read -rs GATEWAY_API_KEY_INPUT
echo ""

# Register remote model
info "Registering remote model …"
REGISTER_RESPONSE=$($CURL_BASE \
    -XPOST "$INDEXER/_plugins/_ml/models/_register" \
    -H 'Content-Type: application/json' \
    -d "{
      \"name\": \"mcp-llm-gateway-model\",
      \"function_name\": \"remote\",
      \"description\": \"Remote model: OpenSearch -> MCP+LLM Gateway\",
      \"connector\": {
        \"name\": \"mcp-llm-gateway-connector\",
        \"version\": 1,
        \"protocol\": \"http\",
        \"parameters\": { \"endpoint\": \"http://${GATEWAY_IP}:9912/analyze\" },
        \"credential\": { \"api_key\": \"${GATEWAY_API_KEY_INPUT}\" },
        \"actions\": [{
          \"action_type\": \"predict\",
          \"method\": \"POST\",
          \"url\": \"\${parameters.endpoint}\",
          \"headers\": {
            \"Content-Type\": \"application/json\",
            \"X-API-Key\": \"\${credential.api_key}\"
          },
          \"request_body\": \"{ \\\"parameters\\\": { \\\"prompt\\\": \\\"\${parameters.prompt}\\\" } }\",
          \"request_timeout\": \"120s\"
        }]
      }
    }")

MODEL_ID=$(echo "$REGISTER_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('model_id',''))" 2>/dev/null)
if [ -z "$MODEL_ID" ]; then
    # Sometimes the model_id is the model name
    MODEL_ID="mcp-llm-gateway-model"
    warn "Could not parse model_id from response — using name '$MODEL_ID'."
fi
info "Model registered. model_id: $MODEL_ID"

# Poll for task completion if status is CREATED
TASK_STATUS=$(echo "$REGISTER_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)
if [ "$TASK_STATUS" = "CREATED" ]; then
    TASK_ID=$(echo "$REGISTER_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('task_id',''))" 2>/dev/null)
    info "Waiting for model registration task to complete (task_id: $TASK_ID) …"
    for i in $(seq 1 12); do
        TASK_RESP=$($CURL_BASE -XGET "$INDEXER/_plugins/_ml/tasks/$TASK_ID")
        TASK_STATE=$(echo "$TASK_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('state',''))" 2>/dev/null)
        TASK_MODEL=$(echo "$TASK_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('model_id',''))" 2>/dev/null)
        if [ "$TASK_STATE" = "COMPLETED" ]; then
            [ -n "$TASK_MODEL" ] && MODEL_ID="$TASK_MODEL"
            success "Registration task completed. model_id: $MODEL_ID"
            break
        fi
        info "  Task state: $TASK_STATE — waiting 5 s …"
        sleep 5
    done
fi

# Deploy model
info "Deploying model $MODEL_ID …"
$CURL_BASE -XPOST "$INDEXER/_plugins/_ml/models/${MODEL_ID}/_deploy" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print('Deploy status:', d.get('status','unknown'))" 2>/dev/null \
    || warn "Deploy call may have failed — check indexer logs."
success "Model deployed."

# Register conversational agent
info "Registering conversational agent …"
AGENT_RESPONSE=$($CURL_BASE \
    -XPOST "$INDEXER/_plugins/_ml/agents/_register" \
    -H 'Content-Type: application/json' \
    -d "{
      \"name\": \"mcp-os-agent\",
      \"type\": \"conversational\",
      \"app_type\": \"os_chat\",
      \"description\": \"Conversational agent that delegates to MCP+LLM gateway; MCP tool-calls happen in the gateway.\",
      \"llm\": {
        \"model_id\": \"${MODEL_ID}\",
        \"parameters\": {
          \"prompt\": \"\${parameters.question}\",
          \"response_filter\": \"\$.output.message\",
          \"max_iteration\": 1,
          \"stop_when_no_tool_found\": true,
          \"message_history_limit\": 10
        }
      },
      \"memory\": { \"type\": \"conversation_index\" },
      \"tools\": [{ \"type\": \"SearchIndexTool\", \"name\": \"placeholder_noop\" }]
    }")

AGENT_ID=$(echo "$AGENT_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('agent_id',''))" 2>/dev/null)
if [ -z "$AGENT_ID" ]; then
    error "Could not extract agent_id from response: $AGENT_RESPONSE"
fi
success "Agent registered. agent_id: $AGENT_ID"

# Set agent as root agent
info "Setting agent as root agent …"
$CURL_BASE \
    -XPUT "$INDEXER/.plugins-ml-config/_doc/os_chat" \
    -H 'Content-Type: application/json' \
    -d "{
      \"type\": \"os_chat_root_agent\",
      \"configuration\": { \"agent_id\": \"${AGENT_ID}\" }
    }" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Root agent result:', d.get('result','unknown'))" 2>/dev/null \
    || error "Failed to set root agent."
success "Root agent configured."

# =============================================================================
# STEP H — Final health check + summary
# =============================================================================
info "=== STEP H: Final health check ==="

echo ""
echo "────────────────────────────────────────────────────────────"
echo "  SERVICE STATUS"
echo "────────────────────────────────────────────────────────────"
for SVC in wazuh-manager wazuh-indexer wazuh-dashboard mcp-server mcp-llm-gateway; do
    if systemctl is-active --quiet "$SVC" 2>/dev/null; then
        echo -e "  ${GREEN}[OK]${NC}  $SVC"
    else
        echo -e "  ${RED}[!!]${NC}  $SVC (not running)"
    fi
done

echo ""
echo "────────────────────────────────────────────────────────────"
echo "  GATEWAY HEALTH"
echo "────────────────────────────────────────────────────────────"
GW_HEALTH=$(curl -s "http://127.0.0.1:9912/health" 2>/dev/null || echo '{"summary":"unreachable"}')
echo "  $GW_HEALTH"

echo ""
echo "────────────────────────────────────────────────────────────"
echo "  SETUP SUMMARY"
echo "────────────────────────────────────────────────────────────"
echo "  Wazuh Manager:   4.14.x (installed)"
echo "  OSD Version:     $OSD_VERSION"
echo "  MCP Server port: 9900"
echo "  Gateway port:    9912"
echo "  Gateway IP:      $GATEWAY_IP"
echo "  Model ID:        $MODEL_ID"
echo "  Agent ID:        $AGENT_ID"
echo ""
echo "  Dashboard URL:   https://localhost/"
echo "    Username:      admin"
echo "    Password:      (see wazuh-install-files.tar from Wazuh installer)"
echo ""
echo "  Click the chat icon in the top-right of the Dashboard"
echo "  to open the AI Assistant."
echo "────────────────────────────────────────────────────────────"
success "Setup complete!"

# =============================================================================
# STEP I — Install PECA Compliance Dashboard Module
# =============================================================================
# NOTE: Run this step manually after the main setup if you want the PECA
# module to appear in the Wazuh Dashboard alongside PCI DSS, HIPAA, etc.
#
# What this does:
#   1. Copies the PECA server-side JS files into the Wazuh plugin
#   2. Patches the compiled frontend bundles (wazuh.plugin.js, wazuh.chunk.2.js)
#      to register PECA as a module in the UI
#   3. Regenerates the .gz and .br compressed bundle files
#   4. Fixes file ownership and restarts the dashboard
#
# The compiled bundle patches are string replacements applied with Python.
# They are idempotent — running this step twice will not double-apply the patch.
#
# Usage: bash setup.sh --peca
# Or call the function directly: install_peca_module
# =============================================================================

install_peca_module() {
    info "=== STEP I: Installing PECA Compliance Dashboard Module ==="

    WAZUH_PLUGIN="/usr/share/wazuh-dashboard/plugins/wazuh"
    PECA_SRC="$REPO_DIR/peca-compliance/plugins/wazuh"

    if [ ! -d "$WAZUH_PLUGIN" ]; then
        error "Wazuh plugin not found at $WAZUH_PLUGIN — is Wazuh installed?"
    fi
    if [ ! -d "$PECA_SRC" ]; then
        error "PECA source files not found at $PECA_SRC — is the repo complete?"
    fi

    # ── 1. Copy server-side files ─────────────────────────────────────────────
    info "Copying PECA server-side files …"

    sudo cp "$PECA_SRC/common/compliance-requirements/peca-requirements.js" \
        "$WAZUH_PLUGIN/common/compliance-requirements/peca-requirements.js"

    sudo cp "$PECA_SRC/server/lib/reporting/peca-request.js" \
        "$WAZUH_PLUGIN/server/lib/reporting/peca-request.js"

    sudo cp "$PECA_SRC/server/integration-files/peca-requirements-pdfmake.js" \
        "$WAZUH_PLUGIN/server/integration-files/peca-requirements-pdfmake.js"

    sudo cp "$PECA_SRC/common/wazuh-modules.js" \
        "$WAZUH_PLUGIN/common/wazuh-modules.js"

    sudo cp "$PECA_SRC/common/constants.js" \
        "$WAZUH_PLUGIN/common/constants.js"

    sudo cp "$PECA_SRC/server/lib/reporting/extended-information.js" \
        "$WAZUH_PLUGIN/server/lib/reporting/extended-information.js"

    sudo chown -R wazuh-dashboard:wazuh-dashboard \
        "$WAZUH_PLUGIN/common/compliance-requirements/peca-requirements.js" \
        "$WAZUH_PLUGIN/common/wazuh-modules.js" \
        "$WAZUH_PLUGIN/common/constants.js" \
        "$WAZUH_PLUGIN/server/lib/reporting/peca-request.js" \
        "$WAZUH_PLUGIN/server/lib/reporting/extended-information.js" \
        "$WAZUH_PLUGIN/server/integration-files/peca-requirements-pdfmake.js"

    success "Server-side files copied."

    # ── 2. Patch compiled frontend bundles ────────────────────────────────────
    info "Patching compiled frontend bundles …"

    CHUNK2="$WAZUH_PLUGIN/target/public/wazuh.chunk.2.js"
    PLUGIN_JS="$WAZUH_PLUGIN/target/public/wazuh.plugin.js"

    # Back up originals if no backup already exists
    [ -f "${CHUNK2}.orig" ] || sudo cp "$CHUNK2" "${CHUNK2}.orig"
    [ -f "${PLUGIN_JS}.orig" ] || sudo cp "$PLUGIN_JS" "${PLUGIN_JS}.orig"

    sudo python3 << PYEOF
import sys

def patch_file(path, replacements):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    changed = 0
    for old, new in replacements:
        if old in content:
            content = content.replace(old, new, 1)
            changed += 1
        elif new in content:
            pass  # already patched — idempotent
        else:
            print(f"  WARNING: expected string not found in {path}:", file=sys.stderr)
            print(f"    {old[:80]}", file=sys.stderr)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    return changed

# ── wazuh.chunk.2.js patches ──────────────────────────────────────────────────
chunk2_patches = [
    # 1. Add peca to WAZUH_MODULES object
    (
        'tsc:{title:"TSC",appId:"tsc",description:"Trust Services Criteria for Security, Availability, Processing Integrity, Confidentiality, and Privacy"},ciscat:',
        'tsc:{title:"TSC",appId:"tsc",description:"Trust Services Criteria for Security, Availability, Processing Integrity, Confidentiality, and Privacy"},peca:{title:"PECA",appId:"peca",description:"Prevention of Electronic Crimes Act 2016 (PECA) \u2014 Pakistan\'s cybercrime law covering unauthorized access, data theft, and cyber terrorism."},ciscat:'
    ),
    # 2. Add peca to agents tab visualisation count
    (
        'this.agents={welcome:8,general:11,fim:7,gcp:7,pm:4,vuls:10,oscap:13,ciscat:3,audit:9,gdpr:6,pci:6,hipaa:6,aws:8,tsc:6,nist:5,virustotal:6,configuration:0,osquery:5,docker:5,mitre:6}',
        'this.agents={welcome:8,general:11,fim:7,gcp:7,pm:4,vuls:10,oscap:13,ciscat:3,audit:9,gdpr:6,pci:6,hipaa:6,aws:8,tsc:6,nist:5,virustotal:6,configuration:0,osquery:5,docker:5,mitre:6,peca:1}'
    ),
    # 3. Add peca to overview tab visualisation count
    (
        'this.overview={welcome:0,general:6,fim:7,pm:5,vuls:7,oscap:8,ciscat:3,audit:6,pci:6,gdpr:5,hipaa:8,nist:7,aws:8,gcp:5,virustotal:5,osquery:6,sca:0,docker:5,mitre:6,tsc:6}',
        'this.overview={welcome:0,general:6,fim:7,pm:5,vuls:7,oscap:8,ciscat:3,audit:6,pci:6,gdpr:5,hipaa:8,nist:7,aws:8,gcp:5,virustotal:5,osquery:6,sca:0,docker:5,mitre:6,tsc:6,peca:1}'
    ),
    # 4. Add PECADataSource class after GitHubDataSource
    (
        'const GITHUB_GROUP_KEY="rule.groups";const GITHUB_GROUP_VALUE="github";class github_data_source_GitHubDataSource extends alerts_data_source_AlertsDataSource{constructor(id,title){super(id,title)}getRuleGroupsFilter(){return super.getRuleGroupsFilter(GITHUB_GROUP_KEY,GITHUB_GROUP_VALUE,constants["p"])}getFixedFilters(){return[...super.getFixedFiltersClusterManager(),...this.getRuleGroupsFilter(),...super.getFixedFilters()]}}',
        'const GITHUB_GROUP_KEY="rule.groups";const GITHUB_GROUP_VALUE="github";class github_data_source_GitHubDataSource extends alerts_data_source_AlertsDataSource{constructor(id,title){super(id,title)}getRuleGroupsFilter(){return super.getRuleGroupsFilter(GITHUB_GROUP_KEY,GITHUB_GROUP_VALUE,constants["p"])}getFixedFilters(){return[...super.getFixedFiltersClusterManager(),...this.getRuleGroupsFilter(),...super.getFixedFilters()]}}const PECA_GROUP_KEY="rule.groups";const PECA_GROUP_VALUE="peca";class peca_data_source_PECADataSource extends alerts_data_source_AlertsDataSource{constructor(id,title){super(id,title)}getRuleGroupsFilter(){return super.getRuleGroupsFilter(PECA_GROUP_KEY,PECA_GROUP_VALUE,"peca-rule-group")}getFixedFilters(){return[...super.getFixedFiltersClusterManager(),...this.getRuleGroupsFilter(),...super.getFixedFilters()]}}'
    ),
    # 5. Add pecaColumns after tscColumns
    (
        'const tscColumns=[commonColumns.timestamp,commonColumns["agent.name"],{id:"rule.tsc",initialWidth:283},commonColumns["rule.description"],commonColumns["rule.level"],commonColumns["rule.id"]];const git',
        'const tscColumns=[commonColumns.timestamp,commonColumns["agent.name"],{id:"rule.tsc",initialWidth:283},commonColumns["rule.description"],commonColumns["rule.level"],commonColumns["rule.id"]];const pecaColumns=[commonColumns.timestamp,commonColumns["agent.name"],{id:"rule.groups",initialWidth:220},commonColumns["rule.description"],commonColumns["rule.level"],commonColumns["rule.id"]];const git'
    ),
    # 6. Add peca module config (events tab only)
    (
        ',tsc:{init:"dashboard",tabs:[{id:"dashboard",name:"Dashboard",buttons:[ButtonExploreAgent,ButtonModuleGenerateReport],component:DashboardTSC},{id:"inventory",name:"Controls",buttons:[ButtonExploreAgent],component:props=>external_osdSharedDeps_React_default.a.createElement(ComplianceTable,modules_defaults_extends({},props,{DataSource:tsc_data_souce_TSCDataSource}))},renderDiscoverTab({moduleId:"tsc",tableColumns:tscColumns,DataSource:tsc_data_souce_TSCDataSource,categoriesSampleData:[constants["ac"]]})],availableFor:["manager","agent"]},"it-hygiene":',
        ',tsc:{init:"dashboard",tabs:[{id:"dashboard",name:"Dashboard",buttons:[ButtonExploreAgent,ButtonModuleGenerateReport],component:DashboardTSC},{id:"inventory",name:"Controls",buttons:[ButtonExploreAgent],component:props=>external_osdSharedDeps_React_default.a.createElement(ComplianceTable,modules_defaults_extends({},props,{DataSource:tsc_data_souce_TSCDataSource}))},renderDiscoverTab({moduleId:"tsc",tableColumns:tscColumns,DataSource:tsc_data_souce_TSCDataSource,categoriesSampleData:[constants["ac"]]})],availableFor:["manager","agent"]},peca:{init:"events",tabs:[renderDiscoverTab({moduleId:"peca",tableColumns:pecaColumns,DataSource:peca_data_source_PECADataSource,categoriesSampleData:[]})],availableFor:["manager","agent"]},"it-hygiene":'
    ),
]

n = patch_file("$CHUNK2", chunk2_patches)
print(f"wazuh.chunk.2.js: {n} patch(es) applied.")

# ── wazuh.plugin.js patches ───────────────────────────────────────────────────
# Build the peca_app definition using the same pattern as the tsc app.
# We insert it immediately after the closing }; of the tsc constant.
TSC_END_MARKER = 'void 0:_store\$getState26.id}\`:\"\`}\`}};'
PECA_APP = (
    TSC_END_MARKER +
    'const peca_app={category:"wz-category-security-operations",id:"peca",'
    'title:_osd_i18n__WEBPACK_IMPORTED_MODULE_0__["i18n"].translate("wz-app-peca-title",{defaultMessage:"PECA"}),'
    'breadcrumbLabel:_osd_i18n__WEBPACK_IMPORTED_MODULE_0__["i18n"].translate("wz-app-peca-breadcrumbLabel",{defaultMessage:"PECA"}),'
    'description:_osd_i18n__WEBPACK_IMPORTED_MODULE_0__["i18n"].translate("wz-app-peca-description",{defaultMessage:"Prevention of Electronic Crimes Act 2016 (PECA) - Pakistan\'s cybercrime law covering unauthorized access, data theft, and cyber terrorism."}),'
    'euiIconType:"users",order:406,showInOverviewApp:true,showInAgentMenu:true,'
    'redirectTo:()=>{'
    'var _store\$getState99,_store\$getState100;'
    'return\`/overview/?tab=peca&tabView=events\${'
    '(_store\$getState99=_redux_store__WEBPACK_IMPORTED_MODULE_1__["a"].getState())!==null&&_store\$getState99!==void 0'
    '&&(_store\$getState99=_store\$getState99.appStateReducers)!==null&&_store\$getState99!==void 0'
    '&&(_store\$getState99=_store\$getState99.currentAgentData)!==null&&_store\$getState99!==void 0'
    '&&_store\$getState99.id'
    '?\`&agentId=\${'
    '(_store\$getState100=_redux_store__WEBPACK_IMPORTED_MODULE_1__["a"].getState())===null||_store\$getState100===void 0'
    '||(_store\$getState100=_store\$getState100.appStateReducers)===null||_store\$getState100===void 0'
    '||(_store\$getState100=_store\$getState100.currentAgentData)===null||_store\$getState100===void 0'
    '?void 0:_store\$getState100.id}\`:\"\`}\`}};'
)

plugin_patches = [
    # Insert peca_app definition after tsc definition
    (TSC_END_MARKER, PECA_APP),
    # Add peca_app to apps registration array
    (
        ',threatHunting,vulnerabilityDetection,mitreAttack,pciDss,hipaa,gdpr,nist80053,tsc,devTools,',
        ',threatHunting,vulnerabilityDetection,mitreAttack,pciDss,hipaa,gdpr,nist80053,tsc,peca_app,devTools,'
    ),
]

n = patch_file("$PLUGIN_JS", plugin_patches)
print(f"wazuh.plugin.js: {n} patch(es) applied.")
PYEOF

    if [ $? -ne 0 ]; then
        error "Bundle patching failed. Restoring originals …"
        sudo cp "${CHUNK2}.orig" "$CHUNK2"
        sudo cp "${PLUGIN_JS}.orig" "$PLUGIN_JS"
        exit 1
    fi

    # ── 3. Fix ownership on patched bundles ───────────────────────────────────
    sudo chown wazuh-dashboard:wazuh-dashboard "$CHUNK2" "$PLUGIN_JS"

    # ── 4. Regenerate compressed files ───────────────────────────────────────
    info "Regenerating compressed bundle files …"
    sudo apt-get install -y brotli 2>/dev/null | grep -E "^(Get|Inst|Sett)" || true

    for JS_FILE in "$CHUNK2" "$PLUGIN_JS"; do
        sudo rm -f "${JS_FILE}.gz" "${JS_FILE}.br"
        sudo gzip -9 -k "$JS_FILE"
        sudo brotli --best -k "$JS_FILE" -o "${JS_FILE}.br"
        sudo chown wazuh-dashboard:wazuh-dashboard "${JS_FILE}.gz" "${JS_FILE}.br"
    done
    success "Compressed files regenerated."

    # ── 5. Restart dashboard and verify ──────────────────────────────────────
    info "Restarting wazuh-dashboard …"
    sudo systemctl restart wazuh-dashboard

    DASH_OK=0
    for i in $(seq 1 12); do
        HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" https://localhost/ 2>/dev/null || true)
        if [ "$HTTP_CODE" = "302" ] || [ "$HTTP_CODE" = "200" ]; then
            DASH_OK=1; break
        fi
        info "  Dashboard not yet up (attempt $i/12) — waiting 5 s …"
        sleep 5
    done

    if [ "$DASH_OK" -ne 1 ]; then
        warn "Dashboard did not come back up. Restoring original bundles …"
        sudo cp "${CHUNK2}.orig" "$CHUNK2"
        sudo cp "${PLUGIN_JS}.orig" "$PLUGIN_JS"
        sudo rm -f "${CHUNK2}.gz" "${CHUNK2}.br" "${PLUGIN_JS}.gz" "${PLUGIN_JS}.br"
        sudo gzip -9 -k "$CHUNK2" && sudo gzip -9 -k "$PLUGIN_JS"
        sudo brotli --best -k "$CHUNK2" -o "${CHUNK2}.br" && sudo brotli --best -k "$PLUGIN_JS" -o "${PLUGIN_JS}.br"
        sudo chown wazuh-dashboard:wazuh-dashboard "$CHUNK2" "$PLUGIN_JS" "${CHUNK2}.gz" "${CHUNK2}.br" "${PLUGIN_JS}.gz" "${PLUGIN_JS}.br"
        sudo systemctl restart wazuh-dashboard
        error "PECA module install failed — bundles restored."
    fi

    success "PECA compliance dashboard module installed."
    warn "ACTION REQUIRED: Hard-refresh your browser (Ctrl+Shift+R) to clear the bundle cache."
    warn "PECA will appear in Modules → Security operations, after TSC."
}

# Run PECA install step if --peca flag is passed
if [[ "${1:-}" == "--peca" ]]; then
    REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    install_peca_module
    exit 0
fi
