#!/usr/bin/env bash
# =============================================================================
# install.sh — AI Assistant standalone installer
#
# Installs and configures the full AI Assistant stack on a Wazuh all-in-one host:
#   C. OpenSearch MCP Server (opensearch-mcp-server-py, port 9900)
#   D. MCP-LLM Gateway (FastAPI + LangChain, port 9912)
#   E. Dashboard AI-assistant plugins (assistantDashboards + mlCommonsDashboards)
#   F. ML Commons cluster settings
#   G. ML model registration + conversational agent registration
#
# Usage (run as root or with sudo):
#   sudo bash install.sh              # full install + ML Commons setup
#   sudo bash install.sh --no-restart # skip wazuh-dashboard restart at the end
#
# Prerequisites:
#   - Wazuh 4.14.3 all-in-one (manager + indexer + dashboard on same host)
#   - python3-venv, python3-pip, curl, gzip, brotli available via apt/yum
#   - Internet access (pip packages, OSD tarball ~338 MB)
#
# Credentials:
#   - After Step D, edit /etc/mcp-llm-gateway/mcp-llm-gateway.env and set:
#       LLM_PROVIDER=groq
#       GROQ_API_KEY=gsk_xxxx
#       GATEWAY_API_KEY=<your-internal-secret>
#       MCP_SSE_URL=http://127.0.0.1:9900/sse
#   - After Step C, edit /etc/mcp-server/mcp-server.env and set:
#       OPENSEARCH_URL=https://127.0.0.1:9200
#       OPENSEARCH_USERNAME=admin
#       OPENSEARCH_PASSWORD=<indexer-admin-password>
# =============================================================================

set -uo pipefail

RESTART=1
for _arg in "$@"; do [ "$_arg" = "--no-restart" ] && RESTART=0; done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Colour helpers ─────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

_sudo() {
    if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo -E "$@"; fi
}

echo "=== AI Assistant installer ==="
echo "Source : ${SCRIPT_DIR}"
echo ""

# ── Prerequisites ───────────────────────────────────────────────────────────
command -v python3 >/dev/null 2>&1 || { error "python3 is required"; exit 1; }
command -v curl    >/dev/null 2>&1 || { error "curl is required"; exit 1; }
info "Python : $(python3 --version)"

# =============================================================================
# C. OpenSearch MCP Server
# =============================================================================
info "=== [C] OpenSearch MCP Server ==="

_sudo mkdir -p /opt/mcp_server-env /var/log/mcp_server /etc/mcp-server
_sudo useradd --system --no-create-home --shell /usr/sbin/nologin mcpserver 2>/dev/null || true
_sudo chown -R root:root /etc/mcp-server
_sudo chmod 750 /etc/mcp-server
_sudo touch /etc/mcp-server/mcp-server.env
_sudo chmod 640 /etc/mcp-server/mcp-server.env
_sudo chown -R mcpserver:mcpserver /var/log/mcp_server
_sudo chmod 750 /var/log/mcp_server

info "Installing python3-venv and pip (if not already present) …"
_sudo apt-get install -y python3-venv python3-pip 2>/dev/null | grep -E "^(Get|Inst|Sett)" || true

info "Creating Python venv at /opt/mcp_server-env …"
_sudo python3 -m venv /opt/mcp_server-env \
    || { error "Failed to create mcp_server venv"; exit 1; }
_sudo /opt/mcp_server-env/bin/pip install --quiet --upgrade pip
_sudo /opt/mcp_server-env/bin/pip install --quiet opensearch-mcp-server-py \
    || { error "Failed to install opensearch-mcp-server-py"; exit 1; }
success "opensearch-mcp-server-py installed."

if [ ! -s /etc/mcp-server/mcp-server.env ]; then
    _sudo cp "${SCRIPT_DIR}/mcp-server.env.example" /etc/mcp-server/mcp-server.env
    echo ""
    warn "ACTION REQUIRED: Fill in Wazuh Indexer credentials:"
    warn "  sudo nano /etc/mcp-server/mcp-server.env"
    warn "    OPENSEARCH_URL=https://127.0.0.1:9200"
    warn "    OPENSEARCH_USERNAME=admin"
    warn "    OPENSEARCH_PASSWORD=<indexer-admin-password>"
    warn "Press ENTER once saved, or Ctrl-C to abort."
    read -r _
fi

_sudo cp "${SCRIPT_DIR}/services/mcp-server.service" /etc/systemd/system/mcp-server.service
_sudo systemctl daemon-reload
_sudo systemctl enable mcp-server
_sudo systemctl restart mcp-server || { error "Failed to start mcp-server"; exit 1; }
success "mcp-server service enabled and started (port 9900)."

# =============================================================================
# D. MCP-LLM Gateway
# =============================================================================
info ""
info "=== [D] MCP-LLM Gateway ==="

_sudo mkdir -p /opt/mcp_llm_gateway-env /var/log/mcp_llm_gateway /etc/mcp-llm-gateway
_sudo useradd --system --no-create-home --shell /usr/sbin/nologin mcpgateway 2>/dev/null || true
_sudo chown root:mcpgateway /etc/mcp-llm-gateway
_sudo chmod 750 /etc/mcp-llm-gateway
_sudo touch /etc/mcp-llm-gateway/mcp-llm-gateway.env
_sudo touch /etc/mcp-llm-gateway/mcp-llm-gateway.prompt
_sudo chown root:mcpgateway /etc/mcp-llm-gateway/mcp-llm-gateway.env
_sudo chown root:mcpgateway /etc/mcp-llm-gateway/mcp-llm-gateway.prompt
_sudo chmod 640 /etc/mcp-llm-gateway/mcp-llm-gateway.env
_sudo chmod 640 /etc/mcp-llm-gateway/mcp-llm-gateway.prompt
_sudo chown -R mcpgateway:mcpgateway /var/log/mcp_llm_gateway
_sudo chmod 750 /var/log/mcp_llm_gateway

info "Creating Python venv at /opt/mcp_llm_gateway-env …"
_sudo python3 -m venv /opt/mcp_llm_gateway-env \
    || { error "Failed to create gateway venv"; exit 1; }
_sudo /opt/mcp_llm_gateway-env/bin/pip install --quiet --upgrade pip

info "Installing pinned Python dependencies …"
_sudo /opt/mcp_llm_gateway-env/bin/pip install --quiet \
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
    "httpx==0.28.1" \
    || { error "Failed to install gateway dependencies"; exit 1; }
success "Gateway Python dependencies installed."

_sudo cp "${SCRIPT_DIR}/mcp_llm_gateway.py" /opt/mcp_llm_gateway-env/mcp_llm_gateway.py
_sudo chmod 644 /opt/mcp_llm_gateway-env/mcp_llm_gateway.py

_sudo cp "${SCRIPT_DIR}/mcp-llm-gateway.prompt" /etc/mcp-llm-gateway/mcp-llm-gateway.prompt
_sudo chown root:mcpgateway /etc/mcp-llm-gateway/mcp-llm-gateway.prompt
_sudo chmod 640 /etc/mcp-llm-gateway/mcp-llm-gateway.prompt

if [ ! -s /etc/mcp-llm-gateway/mcp-llm-gateway.env ]; then
    _sudo cp "${SCRIPT_DIR}/mcp-llm-gateway.env.example" /etc/mcp-llm-gateway/mcp-llm-gateway.env
    _sudo chown root:mcpgateway /etc/mcp-llm-gateway/mcp-llm-gateway.env
    _sudo chmod 640 /etc/mcp-llm-gateway/mcp-llm-gateway.env
    echo ""
    warn "ACTION REQUIRED: Fill in LLM credentials:"
    warn "  sudo nano /etc/mcp-llm-gateway/mcp-llm-gateway.env"
    warn "  Groq (recommended — fast, free tier):"
    warn "    LLM_PROVIDER=groq"
    warn "    GROQ_API_KEY=gsk_xxxx"
    warn "    GROQ_MODEL=qwen/qwen3-32b"
    warn "  Also set:"
    warn "    GATEWAY_API_KEY=<your-internal-secret>"
    warn "    MCP_SSE_URL=http://127.0.0.1:9900/sse"
    warn "Press ENTER once saved, or Ctrl-C to abort."
    read -r _
fi

_sudo cp "${SCRIPT_DIR}/services/mcp-llm-gateway.service" /etc/systemd/system/mcp-llm-gateway.service
_sudo systemctl daemon-reload
_sudo systemctl enable mcp-llm-gateway
_sudo systemctl restart mcp-llm-gateway || { error "Failed to start mcp-llm-gateway"; exit 1; }
success "mcp-llm-gateway service enabled and started (port 9912)."

# =============================================================================
# E. Dashboard AI-assistant OSD plugins
# =============================================================================
info ""
info "=== [E] Dashboard AI-assistant OSD plugins ==="

OSD_PKG="/usr/share/wazuh-dashboard/package.json"
if [ ! -r "$OSD_PKG" ]; then
    error "Cannot read $OSD_PKG — is wazuh-dashboard installed?"
    exit 1
fi
OSD_VERSION=$(python3 -c "import json; d=json.load(open('$OSD_PKG')); print(d['version'])") \
    || { error "Could not determine OSD version from $OSD_PKG"; exit 1; }
info "Detected OSD version: $OSD_VERSION"

TARBALL="opensearch-dashboards-${OSD_VERSION}-linux-x64.tar.gz"
TARBALL_URL="https://artifacts.opensearch.org/releases/bundle/opensearch-dashboards/${OSD_VERSION}/${TARBALL}"
EXTRACT_DIR="/tmp/opensearch-dashboards-${OSD_VERSION}"

info "Downloading OSD tarball (this may take several minutes — ~338 MB) …"
curl -# "$TARBALL_URL" -o "/tmp/$TARBALL" \
    || { error "Failed to download $TARBALL_URL"; exit 1; }

info "Extracting plugin directories only …"
tar -xzf "/tmp/$TARBALL" -C /tmp \
    --wildcards \
    "opensearch-dashboards-${OSD_VERSION}/plugins/assistantDashboards/*" \
    "opensearch-dashboards-${OSD_VERSION}/plugins/mlCommonsDashboards/*" \
    || { error "Failed to extract plugins from tarball"; exit 1; }

PLUGINS_DEST="/usr/share/wazuh-dashboard/plugins"
info "Copying plugins to $PLUGINS_DEST …"
_sudo cp -r "$EXTRACT_DIR/plugins/assistantDashboards/" "$PLUGINS_DEST/"
_sudo cp -r "$EXTRACT_DIR/plugins/mlCommonsDashboards/" "$PLUGINS_DEST/"
_sudo chown -R wazuh-dashboard:wazuh-dashboard "$PLUGINS_DEST/assistantDashboards/"
_sudo chown -R wazuh-dashboard:wazuh-dashboard "$PLUGINS_DEST/mlCommonsDashboards/"
_sudo chmod -R 750 "$PLUGINS_DEST/assistantDashboards/"
_sudo chmod -R 750 "$PLUGINS_DEST/mlCommonsDashboards/"
success "AI assistant OSD plugins copied."

rm -rf "/tmp/$TARBALL" "$EXTRACT_DIR" 2>/dev/null || true

DASH_YML="/etc/wazuh-dashboard/opensearch_dashboards.yml"
if ! _sudo grep -q "assistant.chat.enabled" "$DASH_YML" 2>/dev/null; then
    echo "assistant.chat.enabled: true" | _sudo tee -a "$DASH_YML" > /dev/null
    success "Added assistant.chat.enabled: true to $DASH_YML"
else
    info "assistant.chat.enabled already present in $DASH_YML — skipping."
fi

info "Applying Dashboard Assistant UI personalisation (Wazuh branding) …"
_sudo apt-get install -y brotli 2>/dev/null | grep -E "^(Get|Inst|Sett)" || true
DASH_UI_SCRIPT=$(mktemp /tmp/dashboard-assistant-ui-XXXXXX.sh)
curl -s "https://raw.githubusercontent.com/wazuh/integrations/main/integrations/AI_assistant/config/dashboard/dashboard-assistant-ui.sh" \
    -o "$DASH_UI_SCRIPT" \
    && chmod +x "$DASH_UI_SCRIPT" \
    && _sudo bash "$DASH_UI_SCRIPT" \
    && success "Dashboard UI personalisation applied." \
    || warn "Dashboard UI personalisation failed (non-fatal — continuing)."
rm -f "$DASH_UI_SCRIPT"

# =============================================================================
# F. ML Commons cluster settings
# =============================================================================
info ""
info "=== [F] ML Commons cluster settings ==="

CERTS_DIR="/etc/wazuh-indexer/certs"
INDEXER="https://127.0.0.1:9200"
CURL_BASE="curl -sk --cacert $CERTS_DIR/root-ca.pem --cert $CERTS_DIR/admin.pem --key $CERTS_DIR/admin-key.pem"

echo ""
info "What is the IP address of this host (where the MCP-LLM Gateway runs)?"
info "Primary IP detected: $(hostname -I | awk '{print $1}')"
printf "  Gateway IP [default: %s]: " "$(hostname -I | awk '{print $1}')"
read -r GATEWAY_IP
GATEWAY_IP="${GATEWAY_IP:-$(hostname -I | awk '{print $1}')}"
info "Using gateway IP: $GATEWAY_IP"

info "1/3  Enabling agent framework …"
$CURL_BASE -XPUT "$INDEXER/_cluster/settings" \
    -H 'Content-Type: application/json' \
    -d '{"persistent":{"plugins.ml_commons.agent_framework_enabled":true}}' \
    | grep -q '"acknowledged":true' \
    || { error "Failed to enable agent framework"; exit 1; }
success "Agent framework enabled."

info "2/3  Allowing non-ML nodes …"
$CURL_BASE -XPUT "$INDEXER/_cluster/settings" \
    -H 'Content-Type: application/json' \
    -d '{"persistent":{"plugins.ml_commons.only_run_on_ml_node":"false"}}' \
    | grep -q '"acknowledged":true' \
    || { error "Failed to set only_run_on_ml_node"; exit 1; }
success "Non-ML node execution allowed."

info "3/3  Setting private IP and trusted connector endpoints …"
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
    }" | grep -q '"acknowledged":true' \
    || { error "Failed to set trusted connector endpoints"; exit 1; }
success "ML Commons cluster settings applied."

# =============================================================================
# G. Register ML model and conversational agent
# =============================================================================
info ""
info "=== [G] ML model + conversational agent registration ==="

echo ""
info "What GATEWAY_API_KEY did you set in /etc/mcp-llm-gateway/mcp-llm-gateway.env?"
printf "  Gateway API key: "
read -rs GATEWAY_API_KEY_INPUT
echo ""

info "Registering remote model (mcp-llm-gateway-model) …"
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

MODEL_ID=$(echo "$REGISTER_RESPONSE" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); print(d.get('model_id',''))" 2>/dev/null)
if [ -z "$MODEL_ID" ]; then
    MODEL_ID="mcp-llm-gateway-model"
    warn "Could not parse model_id from response — using name '${MODEL_ID}'."
fi
info "Model registered. model_id: $MODEL_ID"

TASK_STATUS=$(echo "$REGISTER_RESPONSE" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)
if [ "$TASK_STATUS" = "CREATED" ]; then
    TASK_ID=$(echo "$REGISTER_RESPONSE" | python3 -c \
        "import sys,json; d=json.load(sys.stdin); print(d.get('task_id',''))" 2>/dev/null)
    info "Waiting for model registration task (task_id: ${TASK_ID}) …"
    for i in $(seq 1 12); do
        TASK_RESP=$($CURL_BASE -XGET "$INDEXER/_plugins/_ml/tasks/$TASK_ID")
        TASK_STATE=$(echo "$TASK_RESP" | python3 -c \
            "import sys,json; d=json.load(sys.stdin); print(d.get('state',''))" 2>/dev/null)
        TASK_MODEL=$(echo "$TASK_RESP" | python3 -c \
            "import sys,json; d=json.load(sys.stdin); print(d.get('model_id',''))" 2>/dev/null)
        if [ "$TASK_STATE" = "COMPLETED" ]; then
            [ -n "$TASK_MODEL" ] && MODEL_ID="$TASK_MODEL"
            success "Registration task completed. model_id: $MODEL_ID"
            break
        fi
        info "  Task state: $TASK_STATE — waiting 5 s …"
        sleep 5
    done
fi

info "Deploying model $MODEL_ID …"
$CURL_BASE -XPOST "$INDEXER/_plugins/_ml/models/${MODEL_ID}/_deploy" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); \
      print('Deploy status:', d.get('status','unknown'))" 2>/dev/null \
    || warn "Deploy call may have failed — check indexer logs."
success "Model deployed."

info "Registering conversational agent (mcp-os-agent) …"
AGENT_RESPONSE=$($CURL_BASE \
    -XPOST "$INDEXER/_plugins/_ml/agents/_register" \
    -H 'Content-Type: application/json' \
    -d "{
      \"name\": \"mcp-os-agent\",
      \"type\": \"conversational\",
      \"app_type\": \"os_chat\",
      \"description\": \"Conversational agent that delegates to MCP+LLM gateway.\",
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

AGENT_ID=$(echo "$AGENT_RESPONSE" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); print(d.get('agent_id',''))" 2>/dev/null)
if [ -z "$AGENT_ID" ]; then
    error "Could not extract agent_id from response: $AGENT_RESPONSE"
    exit 1
fi
success "Agent registered. agent_id: $AGENT_ID"

info "Setting agent as root agent for Dashboard Assistant …"
$CURL_BASE \
    -XPUT "$INDEXER/.plugins-ml-config/_doc/os_chat" \
    -H 'Content-Type: application/json' \
    -d "{
      \"type\": \"os_chat_root_agent\",
      \"configuration\": { \"agent_id\": \"${AGENT_ID}\" }
    }" | python3 -c "import sys,json; d=json.load(sys.stdin); \
      print('Root agent result:', d.get('result','unknown'))" 2>/dev/null \
    || { error "Failed to set root agent"; exit 1; }
success "Root agent configured."

# =============================================================================
# Restart wazuh-dashboard
# =============================================================================
echo ""
if [ "$RESTART" -eq 1 ]; then
    info "Restarting wazuh-dashboard …"
    if command -v systemctl >/dev/null 2>&1; then
        _sudo systemctl restart wazuh-dashboard
        sleep 3
        STATUS=$(systemctl is-active wazuh-dashboard 2>/dev/null || echo "unknown")
        info "wazuh-dashboard status: $STATUS"
    else
        warn "systemctl not found — restart wazuh-dashboard manually."
    fi
else
    info "Skipping service restart (--no-restart passed)."
fi

echo ""
echo "=== AI Assistant installation complete ==="
echo ""
echo "  MCP Server     : systemctl status mcp-server        (port 9900)"
echo "  MCP-LLM Gateway: systemctl status mcp-llm-gateway   (port 9912)"
echo ""
echo "  ML Commons model_id : $MODEL_ID"
echo "  Conversational agent_id : $AGENT_ID"
echo ""
echo "  Verify gateway health:"
echo "    curl -s http://127.0.0.1:9912/health | python3 -m json.tool"
echo ""
echo "  Test via ML Commons:"
echo "    curl -sk --cacert /etc/wazuh-indexer/certs/root-ca.pem \\"
echo "         --cert /etc/wazuh-indexer/certs/admin.pem \\"
echo "         --key  /etc/wazuh-indexer/certs/admin-key.pem \\"
echo "         -XPOST https://127.0.0.1:9200/_plugins/_ml/agents/${AGENT_ID}/_execute \\"
echo "         -H 'Content-Type: application/json' \\"
echo "         -d '{\"parameters\":{\"question\":\"Hello\"}}'"
