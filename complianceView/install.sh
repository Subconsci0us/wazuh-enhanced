#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install.sh – Build and install the complianceView OSD plugin
#
# Implements:
#   • Standalone OSD app at /app/complianceView (navLinkStatus hidden — accessed
#     programmatically; also embedded in Wazuh Overview via mountComplianceOverview)
#   • Light theme by default (bg #f8fafc, text #1a202c, accent #2b6cb0)
#   • Dark theme activated by .dark-theme CSS class on root element
#   • Reads fyp_theme_v2 from localStorage on mount; listens for fyp-theme-changed
#     CustomEvent (dispatched by the localization plugin)
#   • Compliance Overview appears in Security Operations sidebar and Wazuh
#     overview dashboard at order 400.5 (after IT Hygiene, before PCI DSS)
#   • Removes legacy peca_app duplicate (id:"peca") if present from old installs
#
# Usage (run as root or with sudo):
#   bash install.sh              # build, install, patch, compress, restart
#   bash install.sh --no-restart # build and install only; skip service restart
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

RESTART=1
for _arg in "$@"; do [ "$_arg" = "--no-restart" ] && RESTART=0; done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ID="complianceView"
INSTALL_DIR="/usr/share/wazuh-dashboard/plugins/${PLUGIN_ID}"
BUILD_DIR="/tmp/${PLUGIN_ID}-build"
WAZUH_DIR="/usr/share/wazuh-dashboard/plugins/wazuh/target/public"
CHUNK2="${WAZUH_DIR}/wazuh.chunk.2.js"
WAZUH_PLUGIN="${WAZUH_DIR}/wazuh.plugin.js"

echo "=== Compliance View plugin installer ==="
echo "Source : ${SCRIPT_DIR}"
echo "Build  : ${BUILD_DIR}"
echo "Target : ${INSTALL_DIR}"
echo ""

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
command -v node    >/dev/null 2>&1 || { echo "ERROR: node is required";    exit 1; }
command -v npm     >/dev/null 2>&1 || { echo "ERROR: npm is required";     exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is required"; exit 1; }

echo "Node   : $(node --version)"
echo "Python : $(python3 --version)"

# ── 2. Copy sources to /tmp (avoids vboxsf symlink / permission issues) ───────
echo ""
echo "[1/6] Preparing build directory…"
rm -rf "${BUILD_DIR}"
cp -r "${SCRIPT_DIR}" "${BUILD_DIR}"

# ── 3. Install npm dev dependencies (webpack only — no external runtime libs) ─
echo ""
echo "[2/6] Installing npm dependencies…"
cd "${BUILD_DIR}"
npm install --legacy-peer-deps 2>&1

if ! npx webpack --version >/dev/null 2>&1; then
  echo "      webpack-cli not found — installing globally…"
  npm install -g webpack-cli
fi

# ── 4. Build the public bundle ────────────────────────────────────────────────
echo ""
echo "[3/6] Building bundle with webpack…"
cd "${BUILD_DIR}"
npx webpack --config webpack.config.js --mode production 2>&1

BUNDLE="${BUILD_DIR}/target/public/${PLUGIN_ID}.plugin.js"
if [ ! -f "${BUNDLE}" ]; then
  echo "ERROR: webpack build failed — ${PLUGIN_ID}.plugin.js not found"
  exit 1
fi
echo "      Build successful: $(du -sh "${BUNDLE}" | cut -f1) bundle"

# ── 5. Install plugin ─────────────────────────────────────────────────────────
echo ""
echo "[4/6] Copying plugin to ${INSTALL_DIR}…"

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
OS_HOST=localhost
OS_PORT=9200
OS_USER=admin
OS_PASSWORD=
ENVEOF
  echo "      WARNING: OS_PASSWORD not set in ${ENV_FILE}"
  echo "      Edit that file and set OS_PASSWORD, then restart wazuh-dashboard."
  echo "      Find the password in wazuh-passwords.txt (admin entry)."
else
  echo "      ${ENV_FILE} already exists — skipping."
fi

if id wazuh-dashboard >/dev/null 2>&1; then
  chown -R wazuh-dashboard:wazuh-dashboard "${INSTALL_DIR}"
fi

rm -rf "${BUILD_DIR}"
echo "      Plugin files installed."

# ── 6. Patch Wazuh bundles ────────────────────────────────────────────────────
# patch_bundles.py is idempotent: already-applied patches are detected and
# skipped, so re-running this script on an existing installation is safe.
# It handles:
#   • PECA + Compliance Overview catalog, tab counts, column defs, module tabs
#   • mountComplianceOverview() + ComplianceOverviewPanel injection
#   • Light-theme CSS default for the embedded Compliance Overview panel
#   • fyp-theme-changed event listener in the embedded panel
#   • Removal of legacy peca_app (duplicate id:"peca") from old installs
#   • compliance_overview_app order 400.5 (after IT Hygiene, before PCI DSS)
echo ""
echo "[5/6] Patching Wazuh bundles (wazuh.chunk.2.js + wazuh.plugin.js)…"

if [ ! -f "${CHUNK2}" ]; then
  echo "ERROR: ${CHUNK2} not found — is the Wazuh plugin installed?"
  exit 1
fi

python3 "${SCRIPT_DIR}/patch_bundles.py"

# ── 7. Regenerate compressed variants ────────────────────────────────────────
# OSD serves pre-compressed .gz and .br files when the browser supports them.
# Both must be regenerated after any patch to the source JS file.
echo ""
echo "[6/6] Regenerating compressed variants…"

_compress() {
  local src="$1"
  local base
  base="$(basename "${src}")"

  # gzip: try -k (keep) first; fall back to redirect for systems that don't
  # support writing to a path owned by another user with -k.
  if gzip -9 -k -f "${src}" 2>/dev/null; then
    echo "      ${base}.gz updated (gzip -k)"
  else
    gzip -9 -c "${src}" > "${src}.gz"
    echo "      ${base}.gz updated (gzip -c)"
  fi

  if command -v brotli >/dev/null 2>&1; then
    brotli -f -o "${src}.br" "${src}"
    echo "      ${base}.br updated"
  else
    echo "      brotli not found — ${base}.br NOT updated"
    echo "      Install with: apt-get install brotli"
  fi
}

_compress "${CHUNK2}"
_compress "${WAZUH_PLUGIN}"

# Fix ownership of patched + compressed files
if id wazuh-dashboard >/dev/null 2>&1; then
  for f in "${CHUNK2}" "${CHUNK2}.gz" "${CHUNK2}.br" \
            "${WAZUH_PLUGIN}" "${WAZUH_PLUGIN}.gz" "${WAZUH_PLUGIN}.br"; do
    [ -f "$f" ] && chown wazuh-dashboard:wazuh-dashboard "$f" 2>/dev/null || true
  done
fi

# ── 8. Restart wazuh-dashboard ────────────────────────────────────────────────
echo ""
if [ "$RESTART" -eq 1 ]; then
  echo "Restarting wazuh-dashboard service…"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart wazuh-dashboard
    sleep 3
    STATUS=$(systemctl is-active wazuh-dashboard 2>/dev/null || echo "unknown")
    echo "Service status: ${STATUS}"
  else
    echo "systemctl not found — please restart wazuh-dashboard manually."
  fi
else
  echo "Skipping service restart (--no-restart passed)."
fi

echo ""
echo "=== Installation complete ==="
echo ""
echo "Compliance Overview is accessible:"
echo "  • Wazuh sidebar  : Security Operations → Compliance Overview"
echo "    (order 400.5 — appears after IT Hygiene, before PCI DSS)"
echo "  • Wazuh overview : Security Operations card grid (same order)"
echo "  • Direct URL     : https://<host>/app/complianceView"
echo "  • Overview tab   : /overview/?tab=compliance-overview&tabView=dashboard"
echo ""
echo "Theme:"
echo "  • Default: light (bg #f8fafc, text #1a202c, accent #2b6cb0)"
echo "  • Dark mode: add .dark-theme class, or set fyp_theme_v2=dark in localStorage"
echo "  • Reacts to fyp-theme-changed CustomEvent from the localization plugin"
