#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# install.sh – Build and install the networkGraph OSD plugin
#
# Usage (run as root or with sudo):
#   cd /path/to/networkGraph
#   bash install.sh
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ID="networkGraph"
INSTALL_DIR="/usr/share/wazuh-dashboard/plugins/${PLUGIN_ID}"
BUILD_DIR="/tmp/${PLUGIN_ID}-build"

echo "=== networkGraph plugin installer ==="
echo "Source : ${SCRIPT_DIR}"
echo "Build  : ${BUILD_DIR}"
echo "Target : ${INSTALL_DIR}"
echo ""

# ── 1. Check prerequisites ──────────────────────────────────────────────────
command -v node  >/dev/null 2>&1 || { echo "ERROR: node is required"; exit 1; }
command -v npm   >/dev/null 2>&1 || { echo "ERROR: npm is required";  exit 1; }

NODE_VER=$(node --version)
echo "Node : ${NODE_VER}"

# ── 2. Copy sources to /tmp to avoid vboxsf/symlink restrictions ─────────────
echo ""
echo "[1/4] Preparing build directory…"
rm -rf "${BUILD_DIR}"
cp -r "${SCRIPT_DIR}" "${BUILD_DIR}"

# ── 3. Install npm dependencies (includes D3 and webpack) ───────────────────
echo ""
echo "[2/4] Installing npm dependencies…"
cd "${BUILD_DIR}"
npm install --legacy-peer-deps 2>&1

# Ensure webpack-cli is available locally or globally
if ! npx webpack --version >/dev/null 2>&1; then
  echo "      webpack-cli not found – installing globally…"
  npm install -g webpack-cli
fi

# ── 4. Build the public bundle ───────────────────────────────────────────────
echo ""
echo "[3/4] Building public bundle with webpack…"
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
echo "[4/4] Copying plugin to ${INSTALL_DIR}…"

if [ -d "${INSTALL_DIR}" ]; then
  echo "      Removing existing installation…"
  rm -rf "${INSTALL_DIR}"
fi

mkdir -p "${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}/target/public"
mkdir -p "${INSTALL_DIR}/server/routes"

# Manifest + package metadata
cp "${BUILD_DIR}/opensearch_dashboards.json" "${INSTALL_DIR}/"
cp "${BUILD_DIR}/package.json"               "${INSTALL_DIR}/"

# Server-side (pre-compiled Node.js)
cp "${BUILD_DIR}/server/index.js"            "${INSTALL_DIR}/server/"
cp "${BUILD_DIR}/server/plugin.js"           "${INSTALL_DIR}/server/plugin.js"
cp "${BUILD_DIR}/server/routes/index.js"     "${INSTALL_DIR}/server/routes/"

# Public bundle (built by webpack)
cp "${BUNDLE}" "${INSTALL_DIR}/target/public/"

# Fix ownership so the wazuh-dashboard service can read the files
if id wazuh-dashboard >/dev/null 2>&1; then
  chown -R wazuh-dashboard:wazuh-dashboard "${INSTALL_DIR}"
fi

# Clean up build dir
rm -rf "${BUILD_DIR}"

echo "      Files installed."

# ── 6. Restart wazuh-dashboard ───────────────────────────────────────────────
echo ""
echo "Restarting wazuh-dashboard service…"
if command -v systemctl >/dev/null 2>&1; then
  systemctl restart wazuh-dashboard
  sleep 3
  STATUS=$(systemctl is-active wazuh-dashboard 2>/dev/null || echo "unknown")
  echo "Service status: ${STATUS}"
else
  echo "systemctl not found – please restart wazuh-dashboard manually."
fi

echo ""
echo "=== Installation complete ==="
echo ""
echo "Open your browser and navigate to:"
echo "  https://<wazuh-dashboard-host>:<port>/app/networkGraph"
echo ""
echo "The plugin should appear in the sidebar as 'Network Graph'."
