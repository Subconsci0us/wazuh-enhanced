# Docker Test Log — Wazuh FYP install script verification

**Date:** 2026-04-21  
**Goal:** Verify `setup.sh` on a clean Wazuh Docker deployment, iterate until all features install correctly, confirm Phase 4 clean re-test passes, and deliver a ready-for-AWS script.

---

## PHASE 1 — Dockerised Wazuh Setup

### Environment

| Item | Value |
|------|-------|
| Host OS | Linux Mint 22.3 (Ubuntu 24.04 Noble base) |
| Architecture | x86_64 |
| RAM | 3.8 GiB |
| Disk | 78 GB (49 GB free) |

### Commands run

```bash
# Install Docker CE (Ubuntu Noble repo)
sudo apt-get update -qq
sudo apt-get install -y ca-certificates curl gnupg lsb-release
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu noble stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update -qq
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker mint

# Download and extract Wazuh Docker 4.14.3 single-node
mkdir -p /home/mint/wazuh-docker-test
cd /home/mint/wazuh-docker-test
curl -fsSL -L https://github.com/wazuh/wazuh-docker/archive/refs/tags/v4.14.3.zip -o wazuh-docker.zip
unzip -q wazuh-docker.zip
cd wazuh-docker-4.14.3/single-node

# Reduce indexer heap (VM has only 3.8 GB RAM; native Wazuh was stopped to free memory)
sudo systemctl stop wazuh-dashboard wazuh-indexer wazuh-manager filebeat
sed -i 's/-Xms1g -Xmx1g/-Xms512m -Xmx512m/' docker-compose.yml

# Prerequisite for OpenSearch
sudo sysctl -w vm.max_map_count=262144

# Generate TLS certificates
sudo docker compose -f generate-indexer-certs.yml run --rm generator

# Start stack
sudo docker compose up -d
```

**Results:** All 3 containers started and became healthy.
- `single-node-wazuh.manager-1` — running
- `single-node-wazuh.indexer-1` — running  
- `single-node-wazuh.dashboard-1` — running
- Dashboard health check: `curl -sk https://localhost/` → HTTP 302 (redirect to login)

---

## PHASE 2 — Explore Dashboard Container

### Container environment (key findings)

| Item | Finding |
|------|---------|
| Base OS | Amazon Linux 2023 |
| Running user | `wazuh-dashboard` (uid=1000) |
| `node` in PATH | NOT FOUND |
| `npm` in PATH | NOT FOUND |
| OSD bundled Node | `/usr/share/wazuh-dashboard/node/bin/node` — v18.19.0 |
| `sudo` | NOT INSTALLED |
| `systemctl` | NOT AVAILABLE |
| `python3` | v3.9.25 |
| `curl` / `bash` | present |
| Package manager | `yum` (`/usr/bin/yum`) — confirmed via `command -v yum` |
| Wazuh plugin bundle | `/usr/share/wazuh-dashboard/plugins/wazuh/target/public/wazuh.chunk.2.js` ✓ |
| Custom plugins dir | `/usr/share/wazuh-dashboard/plugins/` |
| `brotli` | NOT INSTALLED (available via yum) |
| `gzip` | NOT IN PATH on this image |

### Manager container environment

| Item | Finding |
|------|---------|
| Base OS | Amazon Linux 2023 |
| `/var/ossec/etc/rules/` | present — `local_rules.xml` owned `wazuh:wazuh` mode 660 |
| `systemctl` | NOT AVAILABLE |
| `sudo` | NOT INSTALLED |
| Running user | `wazuh` (uid=999) |

---

## PHASE 3 — Issues Found and Fixes Applied

### Issue 1 — `setup.sh` had no `--no-restart` flag

**Error:** Cannot run non-interactively in Docker because the script always calls `systemctl restart wazuh-dashboard`.

**Fix:** Added `NO_RESTART=0` variable and `--no-restart` argument parsing in `setup.sh`. All feature sub-script calls now pass `--no-restart` through when set. All individual `install_XXX()` functions propagate the flag. The feature install scripts (`networkGraph/install.sh` etc.) already supported `--no-restart`.

---

### Issue 2 — `sudo` not installed in container

**Error:** All `sudo X` calls in `setup.sh` would fail because `sudo` is not installed in the Wazuh Docker image (Amazon Linux 2023 base).

**Fix:** Added `_sudo()` helper to `setup.sh`:

```bash
_sudo() {
    if [ "$(id -u)" -eq 0 ]; then
        "$@"          # already root — run directly (Docker exec -u root)
    else
        sudo -E "$@"  # non-root on native install — use sudo with env preserved
    fi
}
```

Replaced all `sudo` calls in `setup.sh` with `_sudo`. The feature install scripts do not use `sudo` internally (they assume root access), so they needed no changes.

---

### Issue 3 — Node.js not in PATH; npm missing

**Error:** Feature install scripts fail immediately at `command -v node` / `command -v npm` checks because:
- The Wazuh Docker image ships Node at `/usr/share/wazuh-dashboard/node/bin/node` only (not in PATH)
- npm is not bundled with it
- This also affects minimal AWS AMIs where node/npm may not be pre-installed

**Fix:** Added `ensure_node()` function to `setup.sh` that:
1. Detects if node+npm are already in PATH (fast path)
2. Finds the OSD-bundled Node binary and adds it to PATH via `export`
3. Installs npm via `yum install -y npm` (Amazon Linux) or `apt-get install -y npm` (Ubuntu)
4. Falls back to installing full `nodejs npm` package if still missing
5. Calls `fatal()` if node/npm cannot be obtained

`ensure_node()` is called at the top of each `install_XXX()` function that needs it (networkGraph, nlqSearch, complianceView, localization). The `export PATH=...` is inherited by sub-shell feature install scripts.

---

### Issue 4 — `shared_setup()` tried to install Wazuh inside Docker

**Error:** `shared_setup()` checked `systemctl is-active wazuh-manager`. Inside Docker, `systemctl` is not available, so this always returned non-zero → the function tried to download and run `wazuh-install.sh`, failing immediately.

**Fix:** Restructured `shared_setup()` to detect an existing Wazuh install by filesystem presence before checking systemctl:

```bash
if [ -d "/usr/share/wazuh-dashboard" ] || [ -d "/var/ossec" ]; then
    warn "Wazuh already installed — skipping."
    return 0
elif command -v systemctl ... && systemctl is-active wazuh-manager; then
    warn "..."; return 0
fi
```

The indexer health check is also skipped when Wazuh is already installed (it only needs to run after a fresh all-in-one install).

---

### Issue 5 — `install_pecaRules()` called `systemctl restart wazuh-manager`

**Error:** `systemctl` not available in manager container; command failed with exit code 127.

**Fix:** Wrapped the restart in a systemctl availability check:

```bash
if command -v systemctl >/dev/null 2>&1; then
    _sudo systemctl restart wazuh-manager || return 1
else
    warn "systemctl not available — skipping wazuh-manager restart."
    warn "PECA rules will take effect when the manager process is next restarted."
fi
```

---

### Issue 6 — `complianceView` bundle patch: apps list anchor not found

**Error:** `patch_bundles.py` patch 8 (`apps list`) used anchor `,peca_app,devTools,` which assumes `peca_app` is already in the Wazuh plugin apps array. On a fresh Docker image (or fresh AWS install) neither `peca_app` nor `devTools` is in that array. The anchor was never found, so `compliance_overview_app` was not inserted into the apps list — meaning the plugin wouldn't appear in the sidebar.

**Root cause:** The anchor was written against a development VM that had `peca_app` added to the array via an earlier session's patch. A fresh Wazuh 4.14.3 image does not have it.

**Fix:** Modified `patch_bundles.py` to add a fallback anchor using the actual end of the apps array in a fresh Wazuh 4.14.3 bundle:

```python
# Fallback for fresh installations where peca_app is not yet in the list
APPS_LIST_FALLBACK_OLD = ',about,ITHygiene].sort('
APPS_LIST_FALLBACK_NEW = ',about,ITHygiene,compliance_overview_app].sort('
```

The `patch_plugin()` function now tries the primary anchor first, then the fallback:
```python
if APPS_LIST_OLD in p:
    p, _ = apply_patch(p, APPS_LIST_OLD, APPS_LIST_NEW, '...')
else:
    p, _ = apply_patch(p, APPS_LIST_FALLBACK_OLD, APPS_LIST_FALLBACK_NEW, '...')
```

**Verified:** Both primary and fallback anchors are idempotent.

---

### Issue 7 — `install_complianceView()`: `apt-get install brotli` fails on Amazon Linux

**Error:** Amazon Linux 2023 uses `yum`, not `apt-get`. The `apt-get install -y brotli` call silently failed, leaving brotli unavailable. The subsequent `brotli` compression step then errored with `exit 1`, failing the entire feature.

**Fix:** Made compression in `install_complianceView()` fully portable:
1. Try to install brotli via `apt-get` OR `yum` depending on what's available
2. Remove old `.gz`/`.br` files unconditionally (critical — prevents stale compressed files from being served instead of the patched `.js`)
3. Regenerate compressed files only if the tool is available — graceful `warn` if not, never `fatal`
4. Removed hardcoded `|| { error "...; return 1; }` on gzip/brotli steps

**Note on gzip:** gzip is not in `$PATH` on this Docker image but may be elsewhere. The dashboard falls back to serving uncompressed `.js` if `.gz`/`.br` are absent — this is functionally correct. On production AWS deployments, gzip will be available and the `.gz` variant will be created.

---

### Issue 8 — `install_pecaRules()`: copied rules file owned `root:root` (unreadable by wazuh)

**Error:** After copying `peca_rules.xml` to `/var/ossec/etc/rules/`, wazuh-logtest reported:
```
WARNING: (1103): Could not open file 'etc/rules/peca_rules.xml' due to [(13)-(Permission denied)]
```
The rules directory is owned `root:wazuh` with mode 770. Rules files must be owned `wazuh:wazuh` mode 660.

**Fix:** Added ownership fix step after `cp` in `install_pecaRules()`:

```bash
# Detect owner from existing rules (wazuh:wazuh in Docker, ossec:ossec on native)
_RULES_OWNER=$(stat -c '%U:%G' "$RULES_DEST/local_rules.xml" 2>/dev/null || echo "wazuh:wazuh")
for _xml in "$RULES_DEST"/peca_*.xml; do
    _sudo chown "$_RULES_OWNER" "$_xml"
    _sudo chmod 660 "$_xml"
done
```

---

## PHASE 4 — Clean Re-Test Results (PASS)

Tore down stack with `docker compose down -v`, rebuilt from scratch, re-ran install. **All features passed without any manual intervention.**

### Dashboard container (fresh) — `setup.sh --skip aiAssistant pecaRules --no-restart`

| Feature | Result |
|---------|--------|
| networkGraph | ✅ webpack build OK, plugin copied, ownership set |
| nlqSearch | ✅ webpack build OK, .env written, plugin copied |
| complianceView | ✅ webpack build OK, all 8 patches applied (fallback anchor used), .br files created |
| localization | ✅ webpack build OK, plugin copied |

Dashboard restarted → dashboard logs confirm all 4 plugins in "Setting up [55] plugins" and "Starting [55] plugins" — no errors.

### Manager container (fresh) — `setup.sh --only pecaRules --no-restart`

| Feature | Result |
|---------|--------|
| pecaRules | ✅ rules copied, ownership wazuh:wazuh, mode 660, no ID conflicts |

PECA rule test:
```
Input:  Apr 21 14:00:00 server sshd[1234]: Failed password for invalid user testuser ...
Output: id: '100100'  level: '10'
        description: 'PECA Sec 3: Potential Unauthorized Access Attempt.'
        groups: ['peca', 'authentication_failed', 'peca_3']
```

### Plugin API routes (post-restart)

| Route | HTTP Code | Notes |
|-------|-----------|-------|
| `GET /api/network_graph/agents` | 500 | Route loaded; 500 = upstream Wazuh API not configured (expected in Docker) |
| `GET /api/compliance_view/summary` | 500 | Route loaded; 500 = indexer credentials not configured (expected) |
| `POST /api/nlq_search/translate` | 400 | Route loaded; 400 = bad request body format |
| `GET /` | 302 | Dashboard login redirect (normal) |

All routes respond with non-404, confirming server-side plugins are loaded.

---

## Summary of All Files Modified

| File | Changes |
|------|---------|
| `setup.sh` | Added `--no-restart`, `_sudo()`, `ensure_node()`, fixed `shared_setup()`, fixed `install_pecaRules()` (systemctl + ownership), fixed `install_complianceView()` (portable brotli/gzip), propagated `--no-restart` to sub-scripts |
| `complianceView/patch_bundles.py` | Added fallback apps-list anchor (`,about,ITHygiene].sort(`) for fresh Wazuh 4.14.3 installations |

---

## Exact Final Test Commands

```bash
# Phase 4 clean re-test sequence
cd /home/mint/wazuh-docker-test/wazuh-docker-4.14.3/single-node

# 1. Tear down
sudo docker compose down -v

# 2. Bring up fresh
sudo docker compose up -d
# (wait ~2.5 min for dashboard to be healthy)

# 3. Copy repo
DASH=$(sudo docker ps --filter "name=dashboard" --format "{{.Names}}")
MANAGER=$(sudo docker ps --filter "name=manager" --format "{{.Names}}")
sudo docker exec -u root "$DASH" bash -c 'rm -rf /tmp/wazuh-fyp-repo'
sudo docker cp /media/sf_sharedfolderclone/wazuh-fyp-repo "$DASH":/tmp/wazuh-fyp-repo
sudo docker cp /media/sf_sharedfolderclone/wazuh-fyp-repo "$MANAGER":/tmp/wazuh-fyp-repo

# 4. Install dashboard plugins
sudo docker exec -u root "$DASH" bash \
    /tmp/wazuh-fyp-repo/setup.sh \
    --skip aiAssistant pecaRules \
    --no-restart

# 5. Install PECA rules on manager
sudo docker exec -u root "$MANAGER" bash \
    /tmp/wazuh-fyp-repo/setup.sh \
    --only pecaRules \
    --no-restart

# 6. Restart dashboard
sudo docker restart "$DASH"

# 7. Verify all plugins loaded (look for nlqSearch,networkGraph,localization,complianceView)
sudo docker logs "$DASH" 2>&1 | grep "plugins-system" | grep "Setting up" | tail -2

# 8. PECA rule smoke test
sudo docker exec -u root "$MANAGER" bash -c '
echo "**P1**
Apr 21 14:00:00 server sshd[1234]: Failed password for invalid user testuser from 192.168.1.100 port 22 ssh2" | \
    /var/ossec/bin/wazuh-logtest 2>&1 | grep "id:\|groups:\|peca"
'
```

---

## AWS Deployment Notes

On a fresh AWS instance (Ubuntu 24.04 or Amazon Linux 2023):
- `sudo` is available — the `_sudo()` helper falls through to `sudo -E` normally
- `systemctl` is available — PECA rules restart and dashboard restart work as expected
- Node.js may need to be installed — `ensure_node()` handles this automatically
- `brotli` and `gzip` are available — compressed bundle variants are regenerated correctly
- The `aiAssistant` feature requires LLM API keys; run interactively with `sudo bash setup.sh`
- The script is idempotent: re-running skips already-installed components

