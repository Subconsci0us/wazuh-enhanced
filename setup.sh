#!/usr/bin/env bash
# =============================================================================
# Wazuh FYP — Full Stack Setup Script
# =============================================================================
# Tested on: Ubuntu 24.04 LTS / Linux Mint (clean install), AWS Amazon Linux 2023
# Run as:    sudo bash setup.sh
#
# Usage:
#   sudo bash setup.sh                              # installs ALL features
#   sudo bash setup.sh --only networkGraph nlqSearch
#   sudo bash setup.sh --skip complianceView
#   sudo bash setup.sh --no-restart                 # skip dashboard restart (e.g. in CI)
#   sudo bash setup.sh --list
#   sudo bash setup.sh --help
#
# Features:
#   pecaRules       Deploy PECA compliance detection rules to Wazuh Manager
#   aiAssistant     MCP Server + LLM Gateway + Dashboard AI chat plugins
#   networkGraph    Build and install the Network Graph OSD plugin
#   nlqSearch       Build and install the NLQ Search OSD plugin
#   complianceView  Patch Wazuh Dashboard bundles to add PECA compliance module
#   localization    Floating Urdu/English toolbar + dark mode
# =============================================================================

set -uo pipefail

# ── Colour helpers ─────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
fatal()   { echo -e "${RED}[FATAL]${NC} $*" >&2; exit 1; }

# ── Portable sudo: no-op when already root (e.g. inside Docker), sudo -E otherwise
# This lets the script be used both as `sudo bash setup.sh` and as
# `docker exec -u root container bash setup.sh --no-restart`.
_sudo() {
    if [ "$(id -u)" -eq 0 ]; then
        "$@"
    else
        # -E preserves the environment (including PATH changes from ensure_node)
        sudo -E "$@"
    fi
}

# ── Auto-detect or install Node.js + npm ──────────────────────────────────────
# Wazuh Docker images and some minimal AWS AMIs ship only the OSD-bundled node
# binary with no system-level npm.  This function ensures both are available.
ensure_node() {
    # Fast path: already have everything
    if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
        return 0
    fi

    # Check for the Node.js binary bundled inside the Wazuh Dashboard installation
    OSD_NODE_BIN="/usr/share/wazuh-dashboard/node/bin"
    if [ -x "${OSD_NODE_BIN}/node" ] && ! command -v node >/dev/null 2>&1; then
        export PATH="${OSD_NODE_BIN}:${PATH}"
        info "Using Wazuh-bundled Node: $(node --version)"
    fi

    # Install npm if still missing (bundled OSD node does not ship npm)
    if ! command -v npm >/dev/null 2>&1; then
        info "npm not found — installing via system package manager …"
        if command -v apt-get >/dev/null 2>&1; then
            _sudo apt-get install -y npm 2>&1 | grep -E "^(Get|Inst|Sett|Err)" || true
        elif command -v yum >/dev/null 2>&1; then
            _sudo yum install -y npm 2>&1 | grep -E "^(Installed|Updated|Error)" || true
        fi
    fi

    # If node itself is still missing, install the full nodejs package
    if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
        info "Installing Node.js + npm from package manager …"
        if command -v apt-get >/dev/null 2>&1; then
            _sudo apt-get install -y nodejs npm 2>&1 | grep -E "^(Get|Inst|Sett|Err)" || true
        elif command -v yum >/dev/null 2>&1; then
            _sudo yum install -y nodejs npm 2>&1 | grep -E "^(Installed|Updated|Error)" || true
        else
            fatal "Cannot install Node.js: no supported package manager (apt-get / yum) found."
        fi
    fi

    command -v node >/dev/null 2>&1 || fatal "node is required but could not be installed."
    command -v npm  >/dev/null 2>&1 || fatal "npm is required but could not be installed."
    info "Node: $(node --version)  npm: $(npm --version)"
}

# ── Locate repo root ───────────────────────────────────────────────────────────
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# =============================================================================
# Feature Registry
# =============================================================================
# ALL_FEATURES defines the canonical install order.
ALL_FEATURES=(pecaRules aiAssistant networkGraph nlqSearch complianceView localization)

declare -A FEATURE_DESC
FEATURE_DESC[pecaRules]="Deploy PECA compliance detection rules to Wazuh Manager"
FEATURE_DESC[aiAssistant]="MCP Server + LLM Gateway + Dashboard AI chat plugins + ML Commons"
FEATURE_DESC[networkGraph]="Build and install the Network Graph OSD plugin"
FEATURE_DESC[nlqSearch]="Build and install the NLQ Search OSD plugin"
FEATURE_DESC[complianceView]="Comparative Compliance View — unified OSD plugin comparing PCI DSS, HIPAA, GDPR, NIST, TSC, PECA"
FEATURE_DESC[localization]="Floating toolbar with Urdu/English toggle and dark mode for the entire dashboard"

# =============================================================================
# Argument Parsing
# =============================================================================
MODE="all"
ONLY_FEATURES=()
SKIP_FEATURES=()
NO_RESTART=0

show_help() {
    echo -e "${BOLD}Usage:${NC}"
    echo "  sudo bash setup.sh [OPTIONS]"
    echo ""
    echo -e "${BOLD}Options:${NC}"
    echo "  (none)                        Install ALL features (default)"
    echo "  --only FEATURE [FEATURE ...]  Install only the listed features"
    echo "  --skip FEATURE [FEATURE ...]  Install everything except listed features"
    echo "  --no-restart                  Skip the final wazuh-dashboard service restart"
    echo "  --list                        Print available features and exit"
    echo "  --help                        Print this help message and exit"
    echo ""
    echo -e "${BOLD}Available features:${NC}"
    for f in "${ALL_FEATURES[@]}"; do
        printf "  ${GREEN}%-20s${NC} %s\n" "$f" "${FEATURE_DESC[$f]}"
    done
    echo ""
    echo -e "${BOLD}Examples:${NC}"
    echo "  sudo bash setup.sh"
    echo "  sudo bash setup.sh --only networkGraph nlqSearch"
    echo "  sudo bash setup.sh --skip complianceView"
    echo "  sudo bash setup.sh --no-restart"
    echo "  sudo bash setup.sh --list"
}

show_list() {
    echo -e "${BOLD}Available features:${NC}"
    for f in "${ALL_FEATURES[@]}"; do
        printf "  ${GREEN}%-20s${NC} %s\n" "$f" "${FEATURE_DESC[$f]}"
    done
}

# Parse arguments
i=1
while [ "$i" -le "$#" ]; do
    arg="${!i}"
    case "$arg" in
        --help|-h)
            show_help
            exit 0
            ;;
        --list|-l)
            show_list
            exit 0
            ;;
        --no-restart)
            NO_RESTART=1
            ;;
        --only)
            [ "$MODE" = "skip" ] && fatal "--only and --skip are mutually exclusive."
            MODE="only"
            i=$((i + 1))
            while [ "$i" -le "$#" ]; do
                next="${!i}"
                [[ "$next" == --* ]] && break
                ONLY_FEATURES+=("$next")
                i=$((i + 1))
            done
            [ "${#ONLY_FEATURES[@]}" -eq 0 ] && fatal "--only requires at least one feature name."
            continue
            ;;
        --skip)
            [ "$MODE" = "only" ] && fatal "--only and --skip are mutually exclusive."
            MODE="skip"
            i=$((i + 1))
            while [ "$i" -le "$#" ]; do
                next="${!i}"
                [[ "$next" == --* ]] && break
                SKIP_FEATURES+=("$next")
                i=$((i + 1))
            done
            [ "${#SKIP_FEATURES[@]}" -eq 0 ] && fatal "--skip requires at least one feature name."
            continue
            ;;
        --peca)
            # Legacy flag — equivalent to --only complianceView
            MODE="only"
            ONLY_FEATURES=("complianceView")
            ;;
        *)
            fatal "Unknown option: '$arg'. Run --help for usage."
            ;;
    esac
    i=$((i + 1))
done

# Validate feature names
validate_features() {
    for f in "$@"; do
        local found=0
        for valid in "${ALL_FEATURES[@]}"; do
            [ "$f" = "$valid" ] && found=1 && break
        done
        [ "$found" -eq 0 ] && fatal "Unknown feature: '$f'. Run --list to see available features."
    done
}
[ "${#ONLY_FEATURES[@]}" -gt 0 ] && validate_features "${ONLY_FEATURES[@]}"
[ "${#SKIP_FEATURES[@]}" -gt 0 ] && validate_features "${SKIP_FEATURES[@]}"

# Build effective feature list
FEATURES_TO_RUN=()
case "$MODE" in
    all)
        FEATURES_TO_RUN=("${ALL_FEATURES[@]}")
        ;;
    only)
        FEATURES_TO_RUN=("${ONLY_FEATURES[@]}")
        ;;
    skip)
        for f in "${ALL_FEATURES[@]}"; do
            local_skip=0
            for s in "${SKIP_FEATURES[@]}"; do
                [ "$f" = "$s" ] && local_skip=1 && break
            done
            [ "$local_skip" -eq 0 ] && FEATURES_TO_RUN+=("$f")
        done
        ;;
esac

# Helper: is a feature in FEATURES_TO_RUN?
feature_selected() {
    local target="$1"
    for f in "${FEATURES_TO_RUN[@]+"${FEATURES_TO_RUN[@]}"}"; do
        [ "$f" = "$target" ] && return 0
    done
    return 1
}

# ── Feature status tracking ────────────────────────────────────────────────────
declare -A FEATURE_STATUS
for _f in "${ALL_FEATURES[@]}"; do
    FEATURE_STATUS[$_f]="skipped"
done

# =============================================================================
# Shared Setup — always runs; fatal on failure
# =============================================================================
shared_setup() {
    info "=== Shared Setup: Checking prerequisites ==="

    # Detect existing Wazuh installation via filesystem artifacts.
    # This handles: native install (systemctl), Docker containers (no systemctl),
    # and any environment where the dashboard or manager files are already present.
    local WAZUH_INSTALLED=0
    if [ -d "/usr/share/wazuh-dashboard" ] || [ -d "/var/ossec" ]; then
        WAZUH_INSTALLED=1
    elif command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet wazuh-manager 2>/dev/null; then
        WAZUH_INSTALLED=1
    fi

    if [ "$WAZUH_INSTALLED" -eq 1 ]; then
        warn "Wazuh already installed — skipping installer and indexer health check."
        return 0
    fi

    # ── Fresh all-in-one install ──────────────────────────────────────────────
    info "Downloading wazuh-install.sh …"
    curl -sO https://packages.wazuh.com/4.14/wazuh-install.sh \
        || fatal "Failed to download Wazuh installer."
    info "Running Wazuh installer (this takes several minutes) …"
    _sudo bash ./wazuh-install.sh -a \
        || fatal "Wazuh all-in-one installer failed."
    success "Wazuh installer completed."

    info "Waiting for Wazuh Indexer (OpenSearch) to become healthy …"
    RETRIES=60
    COUNT=0
    # Accept HTTP 200 or 401 as "healthy" — the indexer returns 401 Unauthorized
    # on a fresh install because security is enabled by default. A 401 means the
    # process is up and accepting connections; 000 means connection refused.
    until _IDX_CODE=$(curl -sk -o /dev/null -w "%{http_code}" https://localhost:9200 2>/dev/null) \
            && { [ "$_IDX_CODE" = "200" ] || [ "$_IDX_CODE" = "401" ]; }; do
        COUNT=$((COUNT + 1))
        [ "$COUNT" -ge "$RETRIES" ] && fatal "Wazuh Indexer did not become healthy after $((RETRIES * 5)) seconds."
        info "  Attempt $COUNT/$RETRIES — waiting 5 s …"
        sleep 5
    done
    success "Wazuh Indexer is healthy (HTTP $_IDX_CODE)."
}

# =============================================================================
# Helper: resolve_wazuh_passwords
# Locates wazuh-install-files.tar on any machine (no assumed path) and exports:
#   WAZUH_API_PASSWORD      — the wazuh-wui API password
#   WAZUH_INDEXER_PASSWORD  — the admin OpenSearch indexer password
# Safe to call multiple times; skips work if both vars are already set.
# =============================================================================
resolve_wazuh_passwords() {
    if [ -n "${WAZUH_API_PASSWORD:-}" ] && [ -n "${WAZUH_INDEXER_PASSWORD:-}" ]; then
        return 0
    fi

    # Check known locations before paying the cost of a full find
    local _TAR=""
    for _loc in \
        "${REPO_DIR}/wazuh-install-files.tar" \
        "${HOME}/wazuh-install-files.tar" \
        "/root/wazuh-install-files.tar" \
        "/tmp/wazuh-install-files.tar"; do
        if [ -f "$_loc" ]; then
            _TAR="$_loc"
            break
        fi
    done

    # Fall back to filesystem search (maxdepth 6 avoids /proc and deep mounts)
    if [ -z "$_TAR" ]; then
        info "Searching filesystem for wazuh-install-files.tar …"
        _TAR=$(find / -maxdepth 6 -name "wazuh-install-files.tar" -type f 2>/dev/null | head -1)
    fi

    if [ -z "$_TAR" ]; then
        warn "wazuh-install-files.tar not found anywhere on this machine."
        warn "Set WAZUH_API_PASSWORD and WAZUH_INDEXER_PASSWORD manually before running."
        return 1
    fi

    info "Found install tar: $_TAR"

    # Extract the passwords text file from inside the tar (needs sudo if root-owned)
    local _PWTEXT
    _PWTEXT=$(_sudo tar -xOf "$_TAR" wazuh-install-files/wazuh-passwords.txt 2>/dev/null)
    if [ -z "$_PWTEXT" ]; then
        warn "Could not read wazuh-install-files/wazuh-passwords.txt from $_TAR"
        return 1
    fi

    # Parse wazuh-wui API password
    # Format: api_username: 'wazuh-wui'  (followed by)  api_password: '<value>'
    if [ -z "${WAZUH_API_PASSWORD:-}" ]; then
        WAZUH_API_PASSWORD=$(printf '%s\n' "$_PWTEXT" \
            | grep -A1 "api_username: 'wazuh-wui'" \
            | grep "api_password:" \
            | sed "s/.*api_password: '//;s/'.*//")
        if [ -n "$WAZUH_API_PASSWORD" ]; then
            export WAZUH_API_PASSWORD
            success "WAZUH_API_PASSWORD resolved (wazuh-wui)."
        else
            warn "Could not parse wazuh-wui api_password — set WAZUH_API_PASSWORD manually."
        fi
    fi

    # Parse admin indexer password
    # Format: indexer_username: 'admin'  (followed by)  indexer_password: '<value>'
    if [ -z "${WAZUH_INDEXER_PASSWORD:-}" ]; then
        WAZUH_INDEXER_PASSWORD=$(printf '%s\n' "$_PWTEXT" \
            | grep -A1 "indexer_username: 'admin'" \
            | grep "indexer_password:" \
            | sed "s/.*indexer_password: '//;s/'.*//")
        if [ -n "$WAZUH_INDEXER_PASSWORD" ]; then
            export WAZUH_INDEXER_PASSWORD
            success "WAZUH_INDEXER_PASSWORD resolved (admin)."
        else
            warn "Could not parse admin indexer_password — set WAZUH_INDEXER_PASSWORD manually."
        fi
    fi
}

# =============================================================================
# Feature: pecaRules
# =============================================================================
install_pecaRules() {
    info "=== Feature: pecaRules — Deploying PECA compliance rules ==="

    RULES_SRC="$REPO_DIR/peca-compliance"
    RULES_DEST="/var/ossec/etc/rules"

    if [ ! -d "$RULES_SRC" ] || [ -z "$(ls -A "$RULES_SRC"/*.xml 2>/dev/null)" ]; then
        error "No XML rule files found in $RULES_SRC"
        return 1
    fi

    if [ ! -d "$RULES_DEST" ]; then
        error "$RULES_DEST does not exist — is this the Wazuh Manager host?"
        return 1
    fi

    _sudo cp "$RULES_SRC"/*.xml "$RULES_DEST/" || { error "Failed to copy rules to $RULES_DEST"; return 1; }

    # Match the ownership and permissions of other rules files so the manager
    # process can read them.  Detect dynamically: typically wazuh:wazuh in Docker /
    # Amazon Linux, ossec:ossec on native Ubuntu installs.
    _RULES_OWNER=$(stat -c '%U:%G' "$RULES_DEST/local_rules.xml" 2>/dev/null \
        || stat -f '%Su:%Sg' "$RULES_DEST/local_rules.xml" 2>/dev/null \
        || echo "wazuh:wazuh")
    for _xml in "$RULES_DEST"/peca_*.xml; do
        [ -f "$_xml" ] || continue
        _sudo chown "$_RULES_OWNER" "$_xml" || true
        _sudo chmod 660 "$_xml"             || true
    done
    success "Rules copied to $RULES_DEST."

    # ── Check for rule ID conflicts ───────────────────────────────────────────
    info "Checking for rule ID conflicts …"

    PECA_FILE="$RULES_DEST/peca_rules.xml"
    OTHER_IDS=""
    for _f in "$RULES_DEST"/*.xml; do
        [ "$(basename "$_f")" = "peca_rules.xml" ] && continue
        OTHER_IDS="$OTHER_IDS
$(_sudo grep -oP '(?<=id=")[0-9]+' "$_f" 2>/dev/null)"
    done
    OTHER_IDS=$(echo "$OTHER_IDS" | sort -u | grep -v '^$')
    PECA_IDS=$(_sudo grep -oP '(?<=id=")[0-9]+' "$PECA_FILE" 2>/dev/null)

    CONFLICTS=""
    for _id in $PECA_IDS; do
        echo "$OTHER_IDS" | grep -qx "$_id" && CONFLICTS="$CONFLICTS $_id"
    done
    CONFLICTS="${CONFLICTS# }"

    if [ -n "$CONFLICTS" ]; then
        warn "Rule ID conflicts detected: $CONFLICTS"
        warn "Renumbering conflicting PECA rules starting from 100100 …"
        PECA_TMP=$(mktemp)
        _sudo cp "$PECA_FILE" "$PECA_TMP"
        _sudo chmod 644 "$PECA_TMP"
        NEXT_ID=100100
        ASSIGNED=""
        for _old in $CONFLICTS; do
            while echo "$OTHER_IDS $ASSIGNED" | grep -qw "$NEXT_ID"; do
                NEXT_ID=$((NEXT_ID + 1))
            done
            sed -i "s/id=\"${_old}\"/id=\"${NEXT_ID}\"/g" "$PECA_TMP"
            info "  Rule ID ${_old} → ${NEXT_ID}"
            ASSIGNED="$ASSIGNED $NEXT_ID"
            NEXT_ID=$((NEXT_ID + 1))
        done
        _sudo cp "$PECA_TMP" "$PECA_FILE"
        rm -f "$PECA_TMP"
        success "PECA rules renumbered."
    else
        info "No rule ID conflicts found."
    fi

    # Restart wazuh-manager only if systemctl is available (not in Docker)
    if command -v systemctl >/dev/null 2>&1; then
        info "Restarting wazuh-manager …"
        _sudo systemctl restart wazuh-manager || { error "Failed to restart wazuh-manager"; return 1; }
        success "wazuh-manager restarted."
    else
        warn "systemctl not available — skipping wazuh-manager restart."
        warn "PECA rules will take effect when the manager process is next restarted."
    fi
}

# =============================================================================
# Feature: aiAssistant
# =============================================================================
install_aiAssistant() {
    info "=== Feature: aiAssistant — MCP Server + LLM Gateway + Dashboard plugins ==="

    # ── C: OpenSearch MCP Server ──────────────────────────────────────────────
    info "--- C: Setting up OpenSearch MCP Server ---"

    _sudo mkdir -p /opt/mcp_server-env /var/log/mcp_server /etc/mcp-server
    _sudo useradd --system --no-create-home --shell /usr/sbin/nologin mcpserver 2>/dev/null || true
    _sudo chown -R root:root /etc/mcp-server
    _sudo chmod 750 /etc/mcp-server
    _sudo touch /etc/mcp-server/mcp-server.env
    _sudo chmod 640 /etc/mcp-server/mcp-server.env
    _sudo chown -R mcpserver:mcpserver /var/log/mcp_server
    _sudo chmod 750 /var/log/mcp_server

    info "Creating Python venv at /opt/mcp_server-env …"
    _sudo apt-get install -y python3-venv python3-pip 2>/dev/null | grep -E "^(Get|Inst|Sett)" || true
    _sudo python3 -m venv /opt/mcp_server-env \
        || { error "Failed to create mcp_server venv"; return 1; }
    _sudo /opt/mcp_server-env/bin/pip install --quiet --upgrade pip
    _sudo /opt/mcp_server-env/bin/pip install --quiet opensearch-mcp-server-py \
        || { error "Failed to install opensearch-mcp-server-py"; return 1; }
    success "opensearch-mcp-server-py installed."

    if [ ! -s /etc/mcp-server/mcp-server.env ]; then
        _sudo cp "$REPO_DIR/ai-assistant/mcp-server.env.example" /etc/mcp-server/mcp-server.env
        echo ""
        warn "ACTION REQUIRED: Fill in Wazuh Indexer credentials:"
        warn "  sudo nano /etc/mcp-server/mcp-server.env"
        warn "Press ENTER to continue once saved, or Ctrl-C to abort."
        read -r _
    fi

    _sudo cp "$REPO_DIR/ai-assistant/services/mcp-server.service" /etc/systemd/system/mcp-server.service
    _sudo systemctl daemon-reload
    _sudo systemctl enable mcp-server
    _sudo systemctl restart mcp-server || { error "Failed to start mcp-server"; return 1; }
    success "mcp-server service enabled and started."

    # ── D: MCP-LLM Gateway ───────────────────────────────────────────────────
    info "--- D: Setting up MCP-LLM Gateway ---"

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
        || { error "Failed to create gateway venv"; return 1; }
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
        || { error "Failed to install gateway dependencies"; return 1; }
    success "Gateway dependencies installed."

    _sudo cp "$REPO_DIR/ai-assistant/mcp_llm_gateway.py" /opt/mcp_llm_gateway-env/mcp_llm_gateway.py
    _sudo chmod 644 /opt/mcp_llm_gateway-env/mcp_llm_gateway.py
    _sudo cp "$REPO_DIR/ai-assistant/mcp-llm-gateway.prompt" /etc/mcp-llm-gateway/mcp-llm-gateway.prompt
    _sudo chown root:mcpgateway /etc/mcp-llm-gateway/mcp-llm-gateway.prompt
    _sudo chmod 640 /etc/mcp-llm-gateway/mcp-llm-gateway.prompt

    if [ ! -s /etc/mcp-llm-gateway/mcp-llm-gateway.env ]; then
        _sudo cp "$REPO_DIR/ai-assistant/mcp-llm-gateway.env.example" /etc/mcp-llm-gateway/mcp-llm-gateway.env
        _sudo chown root:mcpgateway /etc/mcp-llm-gateway/mcp-llm-gateway.env
        _sudo chmod 640 /etc/mcp-llm-gateway/mcp-llm-gateway.env
        echo ""
        warn "ACTION REQUIRED: Fill in LLM credentials:"
        warn "  sudo nano /etc/mcp-llm-gateway/mcp-llm-gateway.env"
        warn "  Set LLM_PROVIDER, matching API key, GATEWAY_API_KEY, MCP_SSE_URL."
        warn "Press ENTER to continue once saved, or Ctrl-C to abort."
        read -r _
    fi

    _sudo cp "$REPO_DIR/ai-assistant/services/mcp-llm-gateway.service" /etc/systemd/system/mcp-llm-gateway.service
    _sudo systemctl daemon-reload
    _sudo systemctl enable mcp-llm-gateway
    _sudo systemctl restart mcp-llm-gateway || { error "Failed to start mcp-llm-gateway"; return 1; }
    success "mcp-llm-gateway service enabled and started."

    # ── E: Dashboard AI-assistant plugins ────────────────────────────────────
    info "--- E: Installing Dashboard AI-assistant plugins ---"

    OSD_PKG="/usr/share/wazuh-dashboard/package.json"
    if [ ! -r "$OSD_PKG" ]; then
        OSD_VERSION=$(_sudo python3 -c "import json; d=json.load(open('$OSD_PKG')); print(d['version'])" 2>/dev/null) \
            || { error "Could not determine OSD version from $OSD_PKG"; return 1; }
    else
        OSD_VERSION=$(python3 -c "import json; d=json.load(open('$OSD_PKG')); print(d['version'])") \
            || { error "Could not determine OSD version"; return 1; }
    fi
    info "Detected OSD version: $OSD_VERSION"

    TARBALL="opensearch-dashboards-${OSD_VERSION}-linux-x64.tar.gz"
    TARBALL_URL="https://artifacts.opensearch.org/releases/bundle/opensearch-dashboards/${OSD_VERSION}/${TARBALL}"
    EXTRACT_DIR="/tmp/opensearch-dashboards-${OSD_VERSION}"

    info "Downloading OSD tarball (this may take a few minutes) …"
    curl -# "$TARBALL_URL" -o "/tmp/$TARBALL" \
        || { error "Failed to download $TARBALL_URL"; return 1; }

    info "Extracting plugin directories only …"
    tar -xzf "/tmp/$TARBALL" -C /tmp \
        --wildcards \
        "opensearch-dashboards-${OSD_VERSION}/plugins/assistantDashboards/*" \
        "opensearch-dashboards-${OSD_VERSION}/plugins/mlCommonsDashboards/*" \
        || { error "Failed to extract plugins from tarball"; return 1; }

    PLUGINS_DEST="/usr/share/wazuh-dashboard/plugins"
    info "Copying plugins to $PLUGINS_DEST …"
    _sudo cp -r "$EXTRACT_DIR/plugins/assistantDashboards/" "$PLUGINS_DEST/"
    _sudo cp -r "$EXTRACT_DIR/plugins/mlCommonsDashboards/" "$PLUGINS_DEST/"
    _sudo chown -R wazuh-dashboard:wazuh-dashboard "$PLUGINS_DEST/assistantDashboards/"
    _sudo chown -R wazuh-dashboard:wazuh-dashboard "$PLUGINS_DEST/mlCommonsDashboards/"
    _sudo chmod -R 750 "$PLUGINS_DEST/assistantDashboards/"
    _sudo chmod -R 750 "$PLUGINS_DEST/mlCommonsDashboards/"
    success "AI assistant plugins copied to $PLUGINS_DEST."

    DASH_YML="/etc/wazuh-dashboard/opensearch_dashboards.yml"
    if ! _sudo grep -q "assistant.chat.enabled" "$DASH_YML" 2>/dev/null; then
        echo "assistant.chat.enabled: true" | _sudo tee -a "$DASH_YML" > /dev/null
        success "Added assistant.chat.enabled: true to $DASH_YML"
    else
        info "assistant.chat.enabled already present in $DASH_YML — skipping."
    fi

    info "Personalising Dashboard Assistant UI …"
    _sudo apt-get install -y brotli 2>/dev/null | grep -E "^(Get|Inst|Sett)" || true
    DASH_UI_SCRIPT=$(mktemp /tmp/dashboard-assistant-ui-XXXXXX.sh)
    curl -s "https://raw.githubusercontent.com/wazuh/integrations/main/integrations/AI_assistant/config/dashboard/dashboard-assistant-ui.sh" \
        -o "$DASH_UI_SCRIPT" \
        && chmod +x "$DASH_UI_SCRIPT" \
        && _sudo bash "$DASH_UI_SCRIPT" \
        && success "Dashboard UI personalisation applied." \
        || warn "Dashboard UI personalisation failed (non-fatal — continuing)."

    # ── F: ML Commons cluster settings ───────────────────────────────────────
    info "--- F: Applying ML Commons cluster settings ---"

    DIR="/etc/wazuh-indexer/certs"
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
        | grep -q '"acknowledged":true' \
        || { error "Failed to enable agent framework"; return 1; }
    success "Agent framework enabled."

    info "2/3 Allowing non-ML nodes …"
    $CURL_BASE -XPUT "$INDEXER/_cluster/settings" \
        -H 'Content-Type: application/json' \
        -d '{"persistent":{"plugins.ml_commons.only_run_on_ml_node":"false"}}' \
        | grep -q '"acknowledged":true' \
        || { error "Failed to set only_run_on_ml_node"; return 1; }
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
        }" | grep -q '"acknowledged":true' \
        || { error "Failed to set trusted endpoints"; return 1; }
    success "Cluster settings applied."

    # ── G: Register ML model and conversational agent ─────────────────────────
    info "--- G: Registering ML model and conversational agent ---"

    echo ""
    info "What GATEWAY_API_KEY did you set in /etc/mcp-llm-gateway/mcp-llm-gateway.env?"
    printf "  Gateway API key: "
    read -rs GATEWAY_API_KEY_INPUT
    echo ""

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
        MODEL_ID="mcp-llm-gateway-model"
        warn "Could not parse model_id from response — using name '$MODEL_ID'."
    fi
    info "Model registered. model_id: $MODEL_ID"

    TASK_STATUS=$(echo "$REGISTER_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)
    if [ "$TASK_STATUS" = "CREATED" ]; then
        TASK_ID=$(echo "$REGISTER_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('task_id',''))" 2>/dev/null)
        info "Waiting for model registration task (task_id: $TASK_ID) …"
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

    info "Deploying model $MODEL_ID …"
    $CURL_BASE -XPOST "$INDEXER/_plugins/_ml/models/${MODEL_ID}/_deploy" \
        | python3 -c "import sys,json; d=json.load(sys.stdin); print('Deploy status:', d.get('status','unknown'))" 2>/dev/null \
        || warn "Deploy call may have failed — check indexer logs."
    success "Model deployed."

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
        return 1
    fi
    success "Agent registered. agent_id: $AGENT_ID"

    info "Setting agent as root agent …"
    $CURL_BASE \
        -XPUT "$INDEXER/.plugins-ml-config/_doc/os_chat" \
        -H 'Content-Type: application/json' \
        -d "{
          \"type\": \"os_chat_root_agent\",
          \"configuration\": { \"agent_id\": \"${AGENT_ID}\" }
        }" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Root agent result:', d.get('result','unknown'))" 2>/dev/null \
        || { error "Failed to set root agent"; return 1; }
    success "Root agent configured."

    info "AI Assistant installed. Model ID: $MODEL_ID  Agent ID: $AGENT_ID"
}

# =============================================================================
# Feature: networkGraph
# =============================================================================
install_networkGraph() {
    info "=== Feature: networkGraph — Building and installing Network Graph plugin ==="

    NET_DIR="$REPO_DIR/networkGraph"
    if [ ! -d "$NET_DIR" ]; then
        error "networkGraph directory not found at $NET_DIR"
        return 1
    fi

    ensure_node

    local _NORESTART=""
    [ "${NO_RESTART}" -eq 1 ] && _NORESTART="--no-restart"

    info "Running networkGraph/install.sh …"
    (cd "$NET_DIR" && _sudo bash install.sh ${_NORESTART}) \
        || { error "networkGraph/install.sh failed"; return 1; }

    # ── Step 2: Patch Wazuh plugin.js to add the Threat Intelligence sidebar entry ─
    WAZUH_PLUGIN="/usr/share/wazuh-dashboard/plugins/wazuh"
    PLUGIN_JS="$WAZUH_PLUGIN/target/public/wazuh.plugin.js"

    if [ ! -f "$PLUGIN_JS" ]; then
        error "wazuh.plugin.js not found — is Wazuh Dashboard installed?"
        return 1
    fi

    info "Backing up wazuh.plugin.js (if not already done) …"
    [ -f "${PLUGIN_JS}.orig" ] || _sudo cp "$PLUGIN_JS" "${PLUGIN_JS}.orig"

    info "Patching Wazuh sidebar navigation (Threat Intelligence entry) …"
    _sudo python3 "$NET_DIR/patch_plugin.py" \
        || { error "Sidebar patch failed — restoring original …"
             _sudo cp "${PLUGIN_JS}.orig" "$PLUGIN_JS"
             return 1; }

    # ── Step 3: Regenerate compressed bundle files ────────────────────────────
    # The dashboard prefers .br > .gz > .js when serving bundles.
    # Remove stale compressed variants so it serves the patched .js.
    info "Updating compressed bundle files …"

    if ! command -v brotli >/dev/null 2>&1; then
        if command -v apt-get >/dev/null 2>&1; then
            _sudo apt-get install -y brotli 2>/dev/null | grep -E "^(Get|Inst|Sett)" || true
        elif command -v yum >/dev/null 2>&1; then
            _sudo yum install -y brotli 2>/dev/null | grep -E "^(Installed|Updated)" || true
        fi
    fi

    _sudo rm -f "${PLUGIN_JS}.gz" "${PLUGIN_JS}.br"

    if command -v gzip >/dev/null 2>&1; then
        _sudo gzip -9 -k "$PLUGIN_JS" \
            && _sudo chown wazuh-dashboard:wazuh-dashboard "${PLUGIN_JS}.gz" \
            || warn "gzip failed — .gz variant skipped"
    else
        warn "gzip not found — .gz variant skipped"
    fi

    if command -v brotli >/dev/null 2>&1; then
        _sudo brotli --best -k "$PLUGIN_JS" -o "${PLUGIN_JS}.br" \
            && _sudo chown wazuh-dashboard:wazuh-dashboard "${PLUGIN_JS}.br" \
            || warn "brotli failed — .br variant skipped"
    else
        warn "brotli not found — .br variant skipped"
    fi

    _sudo chown wazuh-dashboard:wazuh-dashboard "$PLUGIN_JS"

    success "Network Graph plugin installed and registered in Threat Intelligence sidebar."
    warn "Hard-refresh your browser (Ctrl+Shift+R) after the dashboard restarts."
}

# =============================================================================
# Feature: nlqSearch
# =============================================================================
install_nlqSearch() {
    info "=== Feature: nlqSearch — Building and installing NLQ Search plugin ==="

    NLQ_DIR="$REPO_DIR/nlqSearch"
    if [ ! -d "$NLQ_DIR" ]; then
        error "nlqSearch directory not found at $NLQ_DIR"
        return 1
    fi

    ensure_node

    # Map canonical password to the name nlqSearch/install.sh expects
    export INDEXER_PASSWORD="${INDEXER_PASSWORD:-${WAZUH_INDEXER_PASSWORD:-}}"

    local _NORESTART=""
    [ "${NO_RESTART}" -eq 1 ] && _NORESTART="--no-restart"

    info "Running nlqSearch/install.sh …"
    (cd "$NLQ_DIR" && _sudo bash install.sh ${_NORESTART}) \
        || { error "nlqSearch/install.sh failed"; return 1; }

    if [ -z "${GEMINI_API_KEY:-}" ]; then
        echo ""
        warn "GEMINI_API_KEY is not set. To enable Gemini backend for NLQ Search:"
        warn "  sudo nano /usr/share/wazuh-dashboard/plugins/nlqSearch/server/.env"
        warn "  Set: GEMINI_API_KEY=your-key-here"
    fi
    if [ -z "${INDEXER_PASSWORD:-}" ]; then
        warn "ACTION REQUIRED: INDEXER_PASSWORD could not be auto-resolved."
        warn "  sudo nano /usr/share/wazuh-dashboard/plugins/nlqSearch/server/.env"
        warn "  Set: INDEXER_PASSWORD=<admin password from wazuh-install-files.tar>"
        warn "  Then: sudo systemctl restart wazuh-dashboard"
    fi
    success "NLQ Search plugin installed. Navigate to https://localhost/app/nlqSearch"
}

# =============================================================================
# Feature: complianceView
# =============================================================================
install_complianceView() {
    info "=== Feature: complianceView — Injecting Compliance Overview into Wazuh Security Operations ==="

    CV_DIR="$REPO_DIR/complianceView"

    # ── Step 1: Build and install the standalone OSD plugin (API routes) ────────
    if [ ! -d "$CV_DIR" ]; then
        error "complianceView directory not found at $CV_DIR — is the repo complete?"
        return 1
    fi

    ensure_node

    # Map canonical password to the name complianceView/install.sh expects
    export OS_PASSWORD="${OS_PASSWORD:-${WAZUH_INDEXER_PASSWORD:-}}"

    local _NORESTART=""
    [ "${NO_RESTART}" -eq 1 ] && _NORESTART="--no-restart"

    info "Building and installing complianceView OSD plugin (API routes) …"
    (cd "$CV_DIR" && _sudo bash install.sh ${_NORESTART}) \
        || { error "complianceView/install.sh failed"; return 1; }

    # ── Step 2: Patch Wazuh bundle to add the native Security Operations entry ──
    WAZUH_PLUGIN="/usr/share/wazuh-dashboard/plugins/wazuh"
    CHUNK2="$WAZUH_PLUGIN/target/public/wazuh.chunk.2.js"
    PLUGIN_JS="$WAZUH_PLUGIN/target/public/wazuh.plugin.js"

    if [ ! -f "$CHUNK2" ] || [ ! -f "$PLUGIN_JS" ]; then
        error "Wazuh bundle files not found — is Wazuh installed?"
        return 1
    fi

    info "Backing up original bundle files (if not already done) …"
    [ -f "${CHUNK2}.orig"    ] || _sudo cp "$CHUNK2"    "${CHUNK2}.orig"
    [ -f "${PLUGIN_JS}.orig" ] || _sudo cp "$PLUGIN_JS" "${PLUGIN_JS}.orig"

    info "Applying bundle patches …"
    _sudo python3 "$CV_DIR/patch_bundles.py" \
        || { error "Bundle patch script failed — restoring originals …"
             _sudo cp "${CHUNK2}.orig"    "$CHUNK2"
             _sudo cp "${PLUGIN_JS}.orig" "$PLUGIN_JS"
             return 1; }

    # ── Step 3: Regenerate compressed bundle files ────────────────────────────
    # The dashboard prefers .br > .gz > .js when serving bundles.
    # We must remove the old compressed variants so it serves the patched .js.
    # Regenerating them is optional (the dashboard falls back to .js), but
    # improves performance on production deployments.
    info "Updating compressed bundle files …"

    # Try to install compression tools via the available package manager
    if ! command -v brotli >/dev/null 2>&1; then
        if command -v apt-get >/dev/null 2>&1; then
            _sudo apt-get install -y brotli 2>/dev/null | grep -E "^(Get|Inst|Sett)" || true
        elif command -v yum >/dev/null 2>&1; then
            _sudo yum install -y brotli 2>/dev/null | grep -E "^(Installed|Updated)" || true
        fi
    fi

    for JS_FILE in "$CHUNK2" "$PLUGIN_JS"; do
        # Remove old compressed files first — critical so the dashboard serves
        # the patched .js rather than the stale compressed originals.
        _sudo rm -f "${JS_FILE}.gz" "${JS_FILE}.br"

        # Regenerate .gz if gzip is available
        if command -v gzip >/dev/null 2>&1; then
            _sudo gzip -9 -k "$JS_FILE" \
                && _sudo chown wazuh-dashboard:wazuh-dashboard "${JS_FILE}.gz" \
                || warn "gzip failed for $(basename "$JS_FILE") — .gz variant skipped"
        else
            warn "gzip not found — .gz variant skipped for $(basename "$JS_FILE")"
        fi

        # Regenerate .br if brotli is available
        if command -v brotli >/dev/null 2>&1; then
            _sudo brotli --best -k "$JS_FILE" -o "${JS_FILE}.br" \
                && _sudo chown wazuh-dashboard:wazuh-dashboard "${JS_FILE}.br" \
                || warn "brotli failed for $(basename "$JS_FILE") — .br variant skipped"
        else
            warn "brotli not found — .br variant skipped for $(basename "$JS_FILE")"
        fi

        _sudo chown wazuh-dashboard:wazuh-dashboard "$JS_FILE"
    done

    success "Bundle patches applied."
    success "Compliance Overview installed in Security Operations tab."
    warn "Hard-refresh your browser (Ctrl+Shift+R) after the dashboard restarts."
}

# =============================================================================
# Feature: localization
# =============================================================================
install_localization() {
    info "=== Feature: localization — Building and installing Localization plugin ==="

    LOC_DIR="$REPO_DIR/localization"
    if [ ! -d "$LOC_DIR" ]; then
        error "localization directory not found at $LOC_DIR"
        return 1
    fi

    ensure_node

    local _NORESTART=""
    [ "${NO_RESTART}" -eq 1 ] && _NORESTART="--no-restart"

    info "Running localization/install.sh …"
    (cd "$LOC_DIR" && _sudo bash install.sh ${_NORESTART}) \
        || { error "localization/install.sh failed"; return 1; }
    success "Localization plugin installed. Floating toolbar visible on all dashboard pages."
}

# =============================================================================
# Main
# =============================================================================
echo ""
echo -e "${BOLD}════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Wazuh FYP — Setup Script${NC}"
echo -e "${BOLD}════════════════════════════════════════════════════════════${NC}"
echo ""

case "$MODE" in
    all)   info "Mode: install ALL features" ;;
    only)  info "Mode: install ONLY — ${FEATURES_TO_RUN[*]}" ;;
    skip)  info "Mode: install all EXCEPT — ${SKIP_FEATURES[*]}" ;;
esac

[ "${NO_RESTART}" -eq 1 ] && info "Restart: DISABLED (--no-restart)"

if [ "${#FEATURES_TO_RUN[@]}" -eq 0 ]; then
    warn "No features selected — nothing to install."
    exit 0
fi

echo ""
info "Features that will be installed: ${FEATURES_TO_RUN[*]}"
echo ""

# ── Shared setup ───────────────────────────────────────────────────────────────
shared_setup

# ── Resolve Wazuh passwords from install tar (machine-independent) ─────────────
resolve_wazuh_passwords || true   # non-fatal: plugins warn if still unset

# ── Feature installation loop ──────────────────────────────────────────────────
NEEDS_DASH_RESTART=0

for FEATURE in "${ALL_FEATURES[@]}"; do
    if ! feature_selected "$FEATURE"; then
        echo -e "${YELLOW}[SKIP]${NC}   $FEATURE — not selected"
        continue
    fi

    echo ""
    echo -e "${CYAN}────────────────────────────────────────────────────────────${NC}"
    echo -e "${CYAN}  Installing: $FEATURE${NC}"
    echo -e "${CYAN}────────────────────────────────────────────────────────────${NC}"

    if "install_${FEATURE}"; then
        FEATURE_STATUS[$FEATURE]="ok"
        echo -e "${GREEN}[OK]${NC}     $FEATURE installed successfully."
        NEEDS_DASH_RESTART=1
    else
        FEATURE_STATUS[$FEATURE]="failed"
        echo -e "${RED}[FAILED]${NC} $FEATURE — see errors above. Continuing with remaining features."
    fi
done

# ── Single dashboard restart (after all features) ──────────────────────────────
if [ "$NEEDS_DASH_RESTART" -eq 1 ]; then
    echo ""
    if [ "${NO_RESTART}" -eq 1 ]; then
        info "Skipping wazuh-dashboard restart (--no-restart passed)."
        info "Restart the dashboard manually when ready:"
        info "  systemctl restart wazuh-dashboard   # native install"
        info "  docker restart <container>          # Docker"
    elif ! command -v systemctl >/dev/null 2>&1; then
        warn "systemctl not available — skipping automatic dashboard restart."
        warn "Restart the dashboard container / process manually to apply plugins."
    else
        info "Restarting wazuh-dashboard (once, after all features installed) …"
        _sudo systemctl restart wazuh-dashboard

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
            warn "Dashboard did not come back up. Check logs:"
            warn "  sudo journalctl -u wazuh-dashboard -n 50"
        else
            success "Wazuh Dashboard is healthy."
        fi
    fi
fi

# ── Service status ─────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────────────"
echo "  SERVICE STATUS"
echo "────────────────────────────────────────────────────────────"
for SVC in wazuh-manager wazuh-indexer wazuh-dashboard mcp-server mcp-llm-gateway; do
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "$SVC" 2>/dev/null; then
        echo -e "  ${GREEN}[OK]${NC}     $SVC"
    else
        echo -e "  ${YELLOW}[--]${NC}     $SVC (not running or not installed)"
    fi
done

# ── Feature summary ────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────────────"
echo "  FEATURE INSTALLATION SUMMARY"
echo "────────────────────────────────────────────────────────────"
FAILURES=0
for FEATURE in "${ALL_FEATURES[@]}"; do
    case "${FEATURE_STATUS[$FEATURE]}" in
        ok)      echo -e "  ${GREEN}[OK]${NC}     $FEATURE" ;;
        failed)  echo -e "  ${RED}[FAILED]${NC} $FEATURE"; FAILURES=$((FAILURES + 1)) ;;
        skipped) echo -e "  ${YELLOW}[SKIP]${NC}   $FEATURE" ;;
    esac
done
echo "────────────────────────────────────────────────────────────"
echo ""

if [ "$FAILURES" -gt 0 ]; then
    warn "$FAILURES feature(s) failed. Review the output above for details."
    exit 1
else
    success "All selected features installed successfully."
fi
