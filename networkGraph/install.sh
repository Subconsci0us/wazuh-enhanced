#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# install.sh – Build and install the networkGraph OSD plugin
#
# Implements:
#   • D3 force-directed graph of Wazuh agents with live alert colouring
#   • Position preservation across 10-second poll cycles (no respawn animation)
#   • Topology-change detection: simulation restarts only when nodes are added
#     or removed (alpha 0.1), leaving steady-state positions untouched
#   • 400 ms fade-in/out for entering/exiting nodes; 500 ms edge colour transitions
#   • Wazuh sidebar entry under Threat Intelligence via patch_plugin.py
#     (uses window.location.replace to bypass Wazuh's hash router)
#
# Usage (run as root or with sudo):
#   bash install.sh              # build, install, patch, restart wazuh-dashboard
#   bash install.sh --no-restart # build and install only; skip service restart
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

RESTART=1
for _arg in "$@"; do [ "$_arg" = "--no-restart" ] && RESTART=0; done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ID="networkGraph"
INSTALL_DIR="/usr/share/wazuh-dashboard/plugins/${PLUGIN_ID}"
BUILD_DIR="/tmp/${PLUGIN_ID}-build"
WAZUH_PLUGIN="/usr/share/wazuh-dashboard/plugins/wazuh/target/public/wazuh.plugin.js"

echo "=== networkGraph plugin installer ==="
echo "Source : ${SCRIPT_DIR}"
echo "Build  : ${BUILD_DIR}"
echo "Target : ${INSTALL_DIR}"
echo ""

# ── 1. Check prerequisites ──────────────────────────────────────────────────
command -v node    >/dev/null 2>&1 || { echo "ERROR: node is required";    exit 1; }
command -v npm     >/dev/null 2>&1 || { echo "ERROR: npm is required";     exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is required"; exit 1; }
echo "Node   : $(node --version)"
echo "Python : $(python3 --version)"

# ── 2. Copy sources to /tmp to avoid vboxsf/symlink restrictions ─────────────
echo ""
echo "[1/5] Preparing build directory…"
rm -rf "${BUILD_DIR}"
cp -r "${SCRIPT_DIR}" "${BUILD_DIR}"

# ── 3. Install npm dependencies (includes D3 and webpack) ───────────────────
echo ""
echo "[2/5] Installing npm dependencies…"
cd "${BUILD_DIR}"
npm install --legacy-peer-deps 2>&1

if ! npx webpack --version >/dev/null 2>&1; then
  echo "      webpack-cli not found – installing globally…"
  npm install -g webpack-cli
fi

# ── 4. Build the public bundle ───────────────────────────────────────────────
echo ""
echo "[3/5] Building public bundle with webpack…"
cd "${BUILD_DIR}"
npx webpack --config webpack.config.js --mode production 2>&1

BUNDLE="${BUILD_DIR}/target/public/${PLUGIN_ID}.plugin.js"
if [ ! -f "${BUNDLE}" ]; then
  echo "ERROR: webpack build failed – ${PLUGIN_ID}.plugin.js not found"
  exit 1
fi
echo "      Build successful: $(du -sh "${BUNDLE}" | cut -f1) bundle"

# ── 5. Install plugin to wazuh-dashboard ────────────────────────────────────
echo ""
echo "[4/5] Copying plugin to ${INSTALL_DIR}…"

if [ -d "${INSTALL_DIR}" ]; then
  echo "      Removing existing installation…"
  rm -rf "${INSTALL_DIR}"
fi

mkdir -p "${INSTALL_DIR}/target/public"
mkdir -p "${INSTALL_DIR}/server/routes"

cp "${BUILD_DIR}/opensearch_dashboards.json" "${INSTALL_DIR}/"
cp "${BUILD_DIR}/package.json"               "${INSTALL_DIR}/"
cp "${BUILD_DIR}/server/index.js"            "${INSTALL_DIR}/server/"
cp "${BUILD_DIR}/server/plugin.js"           "${INSTALL_DIR}/server/"
cp "${BUILD_DIR}/server/load_env.js"         "${INSTALL_DIR}/server/"
cp "${BUILD_DIR}/server/routes/index.js"     "${INSTALL_DIR}/server/routes/"
cp "${BUNDLE}" "${INSTALL_DIR}/target/public/"

# Write .env — credentials are read at runtime via load_env.js
ENV_FILE="${INSTALL_DIR}/server/.env"
if [ ! -f "${ENV_FILE}" ]; then
  cat > "${ENV_FILE}" <<'ENVEOF'
WAZUH_API_HOST=localhost
WAZUH_API_PORT=55000
WAZUH_API_USER=wazuh-wui
WAZUH_API_PASSWORD=
ENVEOF
  echo "      WARNING: WAZUH_API_PASSWORD not set in ${ENV_FILE}"
  echo "      Edit that file and set WAZUH_API_PASSWORD, then restart wazuh-dashboard."
  echo "      Find the password in wazuh-passwords.txt (wazuh-wui entry)."
else
  echo "      ${ENV_FILE} already exists — skipping."
fi

if id wazuh-dashboard >/dev/null 2>&1; then
  chown -R wazuh-dashboard:wazuh-dashboard "${INSTALL_DIR}"
fi

rm -rf "${BUILD_DIR}"
echo "      Plugin files installed."

# ── 6. Patch wazuh.plugin.js (sidebar entry + redirectTo fix) ───────────────
echo ""
echo "[5/5] Patching Wazuh bundles (wazuh.plugin.js)…"
python3 "${SCRIPT_DIR}/patch_plugin.py"

# Regenerate compressed variants (needed because OSD serves pre-compressed files)
if [ -f "${WAZUH_PLUGIN}" ]; then
  echo "      Regenerating compressed variants…"
  gzip -9 -k -f "${WAZUH_PLUGIN}" 2>/dev/null \
    || gzip -9 -c "${WAZUH_PLUGIN}" > "${WAZUH_PLUGIN}.gz"
  if command -v brotli >/dev/null 2>&1; then
    brotli -f -o "${WAZUH_PLUGIN}.br" "${WAZUH_PLUGIN}" && echo "      .br updated"
  else
    echo "      brotli not found — .br file NOT updated (may serve stale compressed copy)"
    echo "      Install with: apt-get install brotli"
  fi
  echo "      .gz updated"
fi

# ── 7. Fix ownership of patched files ────────────────────────────────────────
if id wazuh-dashboard >/dev/null 2>&1; then
  chown wazuh-dashboard:wazuh-dashboard "${WAZUH_PLUGIN}" \
    "${WAZUH_PLUGIN}.gz" "${WAZUH_PLUGIN}.br" 2>/dev/null || true
fi

# ── 8. Restart wazuh-dashboard ───────────────────────────────────────────────
echo ""
if [ "$RESTART" -eq 1 ]; then
  echo "Restarting wazuh-dashboard service…"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart wazuh-dashboard
    sleep 3
    STATUS=$(systemctl is-active wazuh-dashboard 2>/dev/null || echo "unknown")
    echo "Service status: ${STATUS}"
  else
    echo "systemctl not found – please restart wazuh-dashboard manually."
  fi
else
  echo "Skipping service restart (--no-restart passed)."
fi

echo ""
echo "=== Installation complete ==="
echo ""
echo "Network Graph is accessible at:"
echo "  https://<host>/app/networkGraph"
echo ""
echo "It also appears in the Wazuh sidebar under Threat Intelligence."
echo "Clicking the sidebar entry uses window.location.replace() to navigate"
echo "directly to /app/networkGraph, bypassing the Wazuh hash router."
