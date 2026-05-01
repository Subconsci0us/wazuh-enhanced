#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install.sh – Install the complianceView OSD plugin
#
# The complianceView plugin is server-only (ui: false in opensearch_dashboards.json).
# The public bundle is NOT built or loaded by OSD. The plugin registers only
# three server-side API routes used by the native Wazuh Compliance Overview panel.
#
# The UI is injected directly into the Wazuh bundles via patch_bundles.py
# (mountComplianceOverview function in wazuh.chunk.2.js).  The sole entry
# point is the native Wazuh Security Operations tab at order 400.5.
#
# Usage (run as root or with sudo):
#   bash install.sh              # install, patch, compress, restart
#   bash install.sh --no-restart # install and patch only; skip service restart
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

RESTART=1
for _arg in "$@"; do [ "$_arg" = "--no-restart" ] && RESTART=0; done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ID="complianceView"
INSTALL_DIR="/usr/share/wazuh-dashboard/plugins/${PLUGIN_ID}"
WAZUH_DIR="/usr/share/wazuh-dashboard/plugins/wazuh/target/public"
CHUNK2="${WAZUH_DIR}/wazuh.chunk.2.js"
WAZUH_PLUGIN="${WAZUH_DIR}/wazuh.plugin.js"

echo "=== Compliance View plugin installer ==="
echo "Source : ${SCRIPT_DIR}"
echo "Target : ${INSTALL_DIR}"
echo ""

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is required"; exit 1; }
echo "Python : $(python3 --version)"

# ── 2. Install plugin (server-side files only) ────────────────────────────────
echo ""
echo "[1/4] Copying plugin to ${INSTALL_DIR}…"

if [ -d "${INSTALL_DIR}" ]; then
  echo "      Removing existing installation…"
  rm -rf "${INSTALL_DIR}"
fi

mkdir -p "${INSTALL_DIR}/server/routes"

cp "${SCRIPT_DIR}/opensearch_dashboards.json" "${INSTALL_DIR}/"
cp "${SCRIPT_DIR}/package.json"               "${INSTALL_DIR}/"
cp "${SCRIPT_DIR}/server/index.js"            "${INSTALL_DIR}/server/"
cp "${SCRIPT_DIR}/server/plugin.js"           "${INSTALL_DIR}/server/"
cp "${SCRIPT_DIR}/server/load_env.js"         "${INSTALL_DIR}/server/"
cp "${SCRIPT_DIR}/server/routes/index.js"     "${INSTALL_DIR}/server/routes/"

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

echo "      Plugin files installed."

# ── 3. Patch Wazuh bundles ────────────────────────────────────────────────────
# patch_bundles.py is idempotent: already-applied patches are detected and
# skipped, so re-running this script on an existing installation is safe.
# It handles:
#   • PECA + Compliance Overview catalog, tab counts, column defs, module tabs
#   • mountComplianceOverview() + ComplianceOverviewPanel injection into chunk.2.js
#   • Full light/dark theme CSS for the embedded panel
#   • fyp-theme-changed event listener
#   • Removal of legacy peca_app (duplicate id:"peca") from old installs
#   • compliance_overview_app order 400.5 (after IT Hygiene, before PCI DSS)
echo ""
echo "[2/4] Patching Wazuh bundles (wazuh.chunk.2.js + wazuh.plugin.js)…"

if [ ! -f "${CHUNK2}" ]; then
  echo "ERROR: ${CHUNK2} not found — is the Wazuh plugin installed?"
  exit 1
fi

python3 "${SCRIPT_DIR}/patch_bundles.py"

# ── 4. Regenerate compressed variants ────────────────────────────────────────
echo ""
echo "[3/4] Regenerating compressed variants…"

_compress() {
  local src="$1"
  local base
  base="$(basename "${src}")"

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

if id wazuh-dashboard >/dev/null 2>&1; then
  for f in "${CHUNK2}" "${CHUNK2}.gz" "${CHUNK2}.br" \
            "${WAZUH_PLUGIN}" "${WAZUH_PLUGIN}.gz" "${WAZUH_PLUGIN}.br"; do
    [ -f "$f" ] && chown wazuh-dashboard:wazuh-dashboard "$f" 2>/dev/null || true
  done
fi

# ── 5. Restart wazuh-dashboard ────────────────────────────────────────────────
echo ""
echo "[4/4] Service restart…"
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
echo "  • Overview tab   : /overview/?tab=compliance-overview&tabView=dashboard"
echo ""
echo "Theme:"
echo "  • Default: light (bg #f8fafc, text #0f172a, accent #2b6cb0)"
echo "  • Dark mode: set fyp_theme_v2=dark in localStorage (via localization plugin)"
echo "  • Reacts to fyp-theme-changed CustomEvent from the localization plugin"
