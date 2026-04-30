#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# install.sh — Build and install the localization OSD plugin
#
# Implements:
#   • Floating toolbar (bottom-right) visible on ALL pages — EN/UR toggle +
#     dark/light theme toggle
#   • Single language toggle: shows target language (UR when in EN, EN when in UR)
#   • Phase 7: language toggle reloads page with ?locale=ur-PK so OSD native
#     i18n (Discover, Dashboard, Settings chrome) renders in Urdu automatically
#   • Phase 8: attribute translation — placeholder, title, aria-label attrs
#     are also translated by the DOM replacement pass
#   • 300 locale keys covering the entire Wazuh site:
#       - Overview section badges and module card names
#       - Navigation sidebar (all Wazuh + OSD nav items)
#       - Agents page columns, status labels, detail panel
#       - Security modules: severity levels, FIM events, CA pass/fail, MITRE
#       - Management: Rules, Decoders, Groups, Cluster, Logs, Settings, API
#       - Common action buttons and empty-state messages
#   • Dark mode: injects DARK_CSS block into <head>; default is light
#   • RTL: adds fyp-rtl class to body when Urdu active; content area goes RTL,
#     header/sidebar stay LTR
#   • fyp-theme-changed CustomEvent dispatched on theme change for other plugins
#   • window.__fypLocale__ exposed in setup() for _t()/_tFmt() helpers
#   • localStorage keys: fyp_language ('en'|'ur'), fyp_theme_v2 ('light'|'dark')
#
# Usage (run as root or with sudo):
#   bash install.sh              # build, install, restart wazuh-dashboard
#   bash install.sh --no-restart # build and install only; skip service restart
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

RESTART=1
for _arg in "$@"; do [ "$_arg" = "--no-restart" ] && RESTART=0; done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ID="localization"
INSTALL_DIR="/usr/share/wazuh-dashboard/plugins/${PLUGIN_ID}"
BUILD_DIR="/tmp/${PLUGIN_ID}-build"

echo "=== localization plugin installer ==="
echo "Source : ${SCRIPT_DIR}"
echo "Build  : ${BUILD_DIR}"
echo "Target : ${INSTALL_DIR}"
echo ""

# ── 1. Check prerequisites ──────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || { echo "ERROR: node is required"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "ERROR: npm is required";  exit 1; }
echo "Node : $(node --version)"

# ── 2. Copy sources to /tmp to avoid vboxsf/symlink restrictions ─────────────
echo ""
echo "[1/4] Preparing build directory…"
rm -rf "${BUILD_DIR}"
cp -r "${SCRIPT_DIR}" "${BUILD_DIR}"

# ── 3. Install npm dependencies ──────────────────────────────────────────────
echo ""
echo "[2/4] Installing npm dependencies…"
cd "${BUILD_DIR}"
npm install --legacy-peer-deps 2>&1

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

mkdir -p "${INSTALL_DIR}/target/public"
mkdir -p "${INSTALL_DIR}/server"
mkdir -p "${INSTALL_DIR}/translations"

cp "${BUILD_DIR}/opensearch_dashboards.json" "${INSTALL_DIR}/"
cp "${BUILD_DIR}/package.json"               "${INSTALL_DIR}/"
cp "${BUILD_DIR}/.i18nrc.json"               "${INSTALL_DIR}/"
cp "${BUILD_DIR}/server/index.js"            "${INSTALL_DIR}/server/"
cp "${BUILD_DIR}/server/plugin.js"           "${INSTALL_DIR}/server/"
cp "${BUNDLE}" "${INSTALL_DIR}/target/public/"

# Phase 6: OSD native i18n — copy ur-PK translation bundle
if [ -d "${BUILD_DIR}/translations" ]; then
  cp -r "${BUILD_DIR}/translations/." "${INSTALL_DIR}/translations/"
  echo "      Translations: $(ls "${INSTALL_DIR}/translations/")"
fi

if id wazuh-dashboard >/dev/null 2>&1; then
  chown -R wazuh-dashboard:wazuh-dashboard "${INSTALL_DIR}"
fi

rm -rf "${BUILD_DIR}"
echo "      Plugin files installed."

# ── 6. Restart wazuh-dashboard ───────────────────────────────────────────────
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
echo "The localization toolbar appears as a floating pill (bottom-right corner)"
echo "on EVERY page of the Wazuh Dashboard."
echo ""
echo "  UR / EN  — single toggle showing target language (click to switch)"
echo "  Theme    — dark/light toggle (☾ Dark / ☀ Light)"
echo ""
echo "300 locale keys cover: Overview, nav sidebar, Agents, security modules,"
echo "Management (Rules/Decoders/Groups/Cluster/Logs/Settings), action buttons."
echo ""
echo "Phase 6 — OSD native i18n:"
echo "  .i18nrc.json + translations/ur-PK.json registered with OSD at startup."
echo "  ~110 OSD chrome keys: pagination, date picker, modals, dashboard, EUI components."
echo ""
echo "Phase 7 — URL locale switch:"
echo "  Clicking UR/EN reloads the page with/without ?locale=ur-PK so OSD React"
echo "  components (<FormattedMessage>) also render in Urdu."
echo ""
echo "Phase 8 — Attribute translation:"
echo "  placeholder, title (tooltips), and aria-label attributes are translated"
echo "  by the DOM replacement pass alongside visible text nodes."
echo ""
echo "localStorage keys used:"
echo "  fyp_language  — 'en' or 'ur'"
echo "  fyp_theme_v2  — 'light' (default) or 'dark'"
echo ""
echo "Theme changes broadcast via CustomEvent 'fyp-theme-changed' on window."
echo "Other plugins (networkGraph, nlqSearch, complianceView) listen for this"
echo "event to toggle their .dark-theme CSS class."
