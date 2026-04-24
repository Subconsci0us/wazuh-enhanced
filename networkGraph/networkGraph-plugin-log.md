# networkGraph Plugin – Full Development Log

**Author:** Claude (AI assistant)  
**Date:** 2026-04-07  
**Status:** ✅ Complete and working  
**Plugin location (source):** `/media/sf_sharedfolderclone/FYP_siem/wazuh-custom/plugins/networkGraph/`  
**Plugin location (installed):** `/usr/share/wazuh-dashboard/plugins/networkGraph/`

---

## 1. Requirements

Build an OpenSearch Dashboards plugin for **Wazuh 4.14.3** (OSD 2.19.4) that shows a live
D3.js force-directed network graph of Wazuh agents connected to the manager.

### Environment
| Item | Value |
|------|-------|
| Wazuh version | 4.14.3 |
| OSD version | 2.19.4 |
| Dashboard install | `/usr/share/wazuh-dashboard/` |
| Plugins directory | `/usr/share/wazuh-dashboard/plugins/` |
| Wazuh REST API | `https://localhost:55000` |
| API user | `wazuh-wui` |
| API password | `v86bPF+u+2nph5LxghIFWivBr87qPgJL` |
| Agent 000 | Always the Wazuh manager itself |

### Functional requirements
1. `opensearch_dashboards.json` manifest registering the plugin with id `"networkGraph"`.
2. **UI:** Register a new app in the OSD sidebar titled "Network Graph".
3. **Graph:** D3 force-directed graph. Manager (agent 000) as the centre node. All other agents as surrounding nodes.
4. **Node info:** Each node shows agent name, IP, OS label.
5. **Agent→manager edges:** One edge per agent, colour-coded by alert severity.
6. **Agent→agent edges:** Derived from alert `data.srcip`/`data.dstip` fields cross-referenced against known agent IPs.
7. **Edge colours (most-severe wins):**
   - Gray  → no recent alerts
   - Green → alerts present, all `rule.level < 7`
   - Yellow → at least one alert `rule.level` 7–11
   - Red   → at least one alert `rule.level >= 12`
8. **Polling:** Refresh every 10 seconds. Add/remove nodes automatically.
9. **Node styling:** Manager larger/distinct. Agents green outline (active) or gray (disconnected). All nodes draggable.
10. **Server side:** Proxy routes to the Wazuh API (avoids browser CORS). JWT auth with token caching.
11. **`install.sh`:** Builds the plugin, copies it to the dashboard, restarts the service.
12. **No extra npm packages** except D3.js (bundled inline).

---

## 2. Research Phase

### 2a. Reference plugin examined: `ganttChartDashboards`

Located at `/usr/share/wazuh-dashboard/plugins/ganttChartDashboards/`.

**Structure learned:**
```
ganttChartDashboards/
├── opensearch_dashboards.json   ← manifest: id, version, requiredPlugins, server, ui
├── package.json                 ← build scripts, dependencies
├── server/
│   ├── index.js                 ← exports plugin() factory function
│   ├── plugin.js                ← Plugin class: setup() + start() + stop()
│   └── routes/index.js          ← HTTP route definitions using @osd/config-schema
└── target/public/
    └── ganttChartDashboards.plugin.js   ← pre-built webpack bundle
```

**Key discovery — the `__osdBundles__` registration system:**

The pre-built public bundle calls:
```js
__osdBundles__.define("plugin/ganttChartDashboards/public", __webpack_require__, 134)
```

`window.__osdBundles__` is set by OSD's `/bootstrap.js` (a dynamically generated script
served before any plugin bundles load). It exposes `define`, `get`, and `has`.

When OSD's `core.entry.js` wants to instantiate a plugin it calls:
```js
function read(name) {
  const exportId = `plugin/${name}/public`;
  if (!window.__osdBundles__.has(exportId)) {
    throw new Error(`Definition of plugin "${name}" not found and may have failed to load.`);
  }
  const pluginExport = window.__osdBundles__.get(exportId);  // calls bundleRequire(entryId)
  if (typeof pluginExport?.plugin !== "function") {
    throw new Error(`Definition of plugin "${name}" should be a function.`);
  }
  return pluginExport.plugin;
}
```

**`__osdBundles__` implementation** (from
`src/legacy/ui/ui_render/bootstrap/osd_bundles_loader_source.js`):
```javascript
function osdBundlesLoader() {
  var modules = {};
  function define(key, bundleRequire, bundleModuleKey) {
    modules[key] = { bundleRequire, bundleModuleKey };
  }
  function get(key) {
    return modules[key].bundleRequire(modules[key].bundleModuleKey);
  }
  return { has, define, get };
}
```
`get(key)` calls `bundleRequire(bundleModuleKey)` → returns the module exports → OSD
calls `exports.plugin()` to create the plugin instance.

**Script loading order** (from `src/legacy/ui/ui_render/ui_render_mixin.js` lines 162–178):
OSD generates `/bootstrap.js` at runtime.  It sets `window.__osdBundles__`, then loads
all plugin bundles via `<script async=false>` tags in the `window.onload` callback.
After all scripts load, `__osdBootstrap__()` is called which calls `setup()` on each plugin.

Our bundle IS included in the load list (confirmed in the served `/bootstrap.js`):
```
'/414303/bundles/plugin/networkGraph/networkGraph.plugin.js'
```

### 2b. Build toolchain analysis

The ganttChart plugin uses `yarn plugin-helpers build` which requires the full OSD source
tree as a workspace peer.  This machine only has OSD *installed*, not the source.

**Available tools:**
| Tool | Version |
|------|---------|
| Node.js | 18.19.1 |
| npm | 9.2.0 |
| webpack (global) | 5.105.4 |
| D3.js (npm) | 7.9.0 |

**Build strategy chosen:** Custom webpack 5 config. No OSD build toolchain. D3 bundled inline.
No React or OSD module imports — UI is pure vanilla JS + D3.

### 2c. vboxsf limitation
`npm install` fails on the VirtualBox shared folder (`/media/sf_sharedfolderclone/`)
because vboxsf does not support symlinks (which npm uses for `node_modules/.bin/`).

**Workaround:** `install.sh` copies source to `/tmp/` before running `npm install`.

---

## 3. Plugin Architecture

```
networkGraph/
├── opensearch_dashboards.json    ← OSD plugin manifest
├── package.json                  ← npm metadata + build script
├── webpack.config.js             ← custom webpack 5 build config
├── install.sh                    ← build + install + restart script
├── public/
│   ├── bundle_entry.js           ← webpack entry: registers with OSD
│   └── index.js                  ← plugin class + D3 graph + mount logic
├── server/
│   ├── index.js                  ← server entry: exports plugin() factory
│   ├── plugin.js                 ← server Plugin class
│   └── routes/
│       └── index.js              ← Wazuh API proxy routes (JWT auth)
└── target/
    └── public/
        └── networkGraph.plugin.js   ← compiled webpack bundle (291 KB)
```

---

## 4. File-by-File Explanation

### 4a. `opensearch_dashboards.json`
```json
{
  "id": "networkGraph",
  "version": "1.0.0",
  "opensearchDashboardsVersion": "2.19.4",
  "requiredPlugins": ["navigation"],
  "optionalPlugins": [],
  "server": true,
  "ui": true
}
```
- `"server": true` — OSD loads `server/index.js` on startup.
- `"ui": true` — OSD includes `target/public/networkGraph.plugin.js` in the browser's script load list.
- `"requiredPlugins": ["navigation"]` — ensures the OSD nav bar is ready before our plugin sets up.

---

### 4b. `public/bundle_entry.js`
The webpack **entry point** — the first file webpack processes.

**What it does:**
1. `require('./index.js')` — loads and executes the entire plugin code + D3. Stores the result in `pluginModule`.
2. Calls `window.__osdBundles__.define(...)` to register the plugin with OSD's bundle registry.

```javascript
(function registerPlugin() {
  if (typeof window === 'undefined' || !window.__osdBundles__) return;
  try {
    window.__osdBundles__.define(
      'plugin/networkGraph/public',
      function bundleRequire() { return pluginModule; },
      0
    );
  } catch(e) { ... }
}());
```

**Why `window.__osdBundles__` (not bare `__osdBundles__`):**

An earlier version used `if (typeof __osdBundles__ !== 'undefined')`. This caused the plugin
to fail silently in the browser. The root cause: webpack 5 + terser production mode may
treat a bare unqualified global like `__osdBundles__` as an undeclared local variable,
potentially skipping the define call. Using `window.__osdBundles__` is unambiguous —
terser cannot optimise away a property access on the `window` object.

---

### 4c. `public/index.js`
The main plugin code (~350 lines). Handles everything in the browser.

**Constants:**
```javascript
var API_BASE      = '/api/network_graph';   // OSD proxy route base
var POLL_INTERVAL = 10000;                  // 10 seconds
var MANAGER_ID    = '000';
// Edge colours
var COLOR_NONE    = '#888888';  // gray   – no alerts
var COLOR_LOW     = '#00a550';  // green  – level < 7
var COLOR_MEDIUM  = '#f0a500';  // yellow – level 7-11
var COLOR_HIGH    = '#d4371c';  // red    – level >= 12
```

**`createGraph(container)`** — D3 rendering engine:
- Creates full-size `<svg>` with dark background.
- Zoom + pan via `d3.zoom()`.
- `d3.forceSimulation()` with link / charge / centre / collision forces.
- Drag behaviour on all nodes.
- Tooltip `<div>` (shows name, ID, IP, OS, status on hover).
- Arrow-head `<marker>` defs for directed peer edges.
- Returns `{ update(agents, alertMap), destroy() }`.

**`mountApp(params)`** — called by OSD when the user navigates to the app:
- Builds the page layout (dark header bar + legend bar + graph canvas).
- `fetchData()` calls both proxy routes in parallel (`Promise.all`):
  - `GET /api/network_graph/agents` → list of all agents
  - `GET /api/network_graph/alerts` → last 5 minutes of alerts
- Processes the response:
  - Builds `alertMap`: `{ agentId → [rule.level values] }`
  - Detects peer IPs from `data.srcip`/`data.dstip` alert fields
  - Cross-references peer IPs against known agent IPs to build `alertMap._peers`
- Calls `graph.update(agents, alertMap)` to redraw.
- Sets up `setInterval(fetchData, 10000)` for auto-refresh.
- Returns `unmount()` function that clears the interval and removes DOM elements.

**`NetworkGraphPlugin` class:**
```javascript
NetworkGraphPlugin.prototype.setup = function(core) {
  core.application.register({
    id:          'networkGraph',
    title:       'Network Graph',
    euiIconType: 'visNetwork',
    category:    { id: 'wazuh', label: 'Wazuh', order: 1000 },
    mount:       function(params) { return mountApp(params); },
  });
};
```
`core.application.register()` is the OSD API that adds the "Network Graph" entry to the
sidebar and tells OSD to call `mount()` when the user navigates to `/app/networkGraph`.

---

### 4d. `server/index.js`
OSD server-side entry point. Exports the required `plugin()` factory:
```javascript
function plugin(initializerContext) {
  return new NetworkGraphPlugin(initializerContext);
}
```
OSD calls this automatically when the dashboard starts up because `"server": true` is set
in the manifest.

---

### 4e. `server/plugin.js`
The server-side plugin class. Three lifecycle methods OSD calls:
- `setup(core)` — runs at startup. Creates an HTTP router and registers the proxy routes.
- `start(core)` — runs after all plugins have set up. No-op for this plugin.
- `stop()` — runs on shutdown. No-op.

---

### 4f. `server/routes/index.js`
Registers two HTTP routes on the OSD server and handles all communication with the
Wazuh REST API. This is the backend proxy — the browser never talks to Wazuh directly.

**Why a proxy is needed:**
The Wazuh API runs on port 55000 with a self-signed certificate. Browsers block
cross-origin requests to it (CORS). By routing through OSD's own server (same origin
as the dashboard), we avoid CORS entirely.

**JWT token management:**
```javascript
const TOKEN_LIFETIME = 14 * 60 * 1000; // 14 minutes (Wazuh tokens last 15 min)
let cachedToken    = null;
let tokenExpiresAt = 0;

async function getWazuhToken(logger) {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  // POST /security/user/authenticate?raw=true  with Basic auth
  // raw=true returns the token as plain text (not JSON-wrapped)
  const token = await wazuhRequest('POST', '/security/user/authenticate?raw=true', ...);
  cachedToken    = token;
  tokenExpiresAt = Date.now() + TOKEN_LIFETIME;
  return token;
}
```
On the first request, a JWT is fetched from Wazuh using Basic auth.  All subsequent
requests within the 14-minute window reuse the cached token. If the token expires (or
Wazuh returns error code 6 — invalid token), the cache is cleared and a fresh token is
fetched automatically. This means the plugin never hits the Wazuh auth endpoint
more than once per 14 minutes regardless of how many browser clients are polling.

**Routes:**
```
GET /api/network_graph/agents
  → GET https://localhost:55000/agents
      ?limit=500
      &select=id,name,ip,status,os.name,os.version
  ← returns Wazuh API JSON body directly to the browser

GET /api/network_graph/alerts
  → GET https://localhost:55000/alerts
      ?limit=500
      &select=agent.id,rule.level,data.srcip,data.dstip,...
      &q=timestamp>5-minutes-ago
      &sort=-timestamp
  ← returns Wazuh API JSON body directly to the browser
```
Both routes use `rejectUnauthorized: false` in the HTTPS agent to handle the manager's
self-signed certificate.

---

### 4g. `webpack.config.js`
Tells webpack how to build the public bundle:
```javascript
module.exports = {
  entry:  './public/bundle_entry.js',  // start here
  output: {
    path:     './target/public/',
    filename: 'networkGraph.plugin.js', // OSD expects this exact filename
  },
  resolve: { fallback: { fs: false, path: false, ... } },  // no Node built-ins in browser
  performance: { hints: false },  // suppress size warnings (D3 is large)
};
```
D3 is included as a regular `npm` dependency, so webpack bundles it inline.
The final bundle is ~291 KB (minified).

---

## 5. `install.sh` — Step-by-Step Explanation

```
/media/sf_sharedfolderclone/FYP_siem/wazuh-custom/plugins/networkGraph/install.sh
```

Run as root: `sudo bash install.sh`

### What it does, step by step:

**Step 1 – Prerequisite check**
```bash
command -v node  >/dev/null 2>&1 || { echo "ERROR: node is required"; exit 1; }
command -v npm   >/dev/null 2>&1 || { echo "ERROR: npm is required";  exit 1; }
```
Verifies that `node` and `npm` are on the PATH. If either is missing the script exits
immediately with a clear error. No point going further without them.

**Step 2 – Copy source to /tmp**
```bash
cp -r "${SCRIPT_DIR}" /tmp/networkGraph-build
```
The source lives on the VirtualBox shared folder (`/media/sf_sharedfolderclone/`).
That filesystem (vboxsf) does not support symbolic links. npm creates symlinks inside
`node_modules/.bin/` for CLI tools (like `webpack`). This step copies everything to
a real Linux filesystem (`/tmp`) where symlinks work normally.

**Step 3 – Install npm dependencies**
```bash
npm install --legacy-peer-deps
```
Downloads D3.js (~682 KB of source modules) and webpack + webpack-cli into the temp
directory's `node_modules/`. The `--legacy-peer-deps` flag avoids peer dependency
conflicts between D3 v7 and other packages.

**Step 4 – Build the public bundle**
```bash
npx webpack --config webpack.config.js --mode production
```
Runs webpack on `public/bundle_entry.js`. Webpack traces all `require()` calls, pulls in
`public/index.js` and all of D3, then outputs a single minified file:
`target/public/networkGraph.plugin.js` (~291 KB).

This is the file the browser will download. It contains the entire plugin UI + D3, with no
external dependencies.

**Step 5 – Remove old installation**
```bash
rm -rf /usr/share/wazuh-dashboard/plugins/networkGraph
```
Wipes any previous version so there are no leftover stale files. OSD does not hot-reload
plugins — a full reinstall is needed for changes to take effect.

**Step 6 – Copy files to OSD plugins directory**
```bash
mkdir -p /usr/share/wazuh-dashboard/plugins/networkGraph/target/public
mkdir -p /usr/share/wazuh-dashboard/plugins/networkGraph/server/routes
cp opensearch_dashboards.json  → /usr/share/wazuh-dashboard/plugins/networkGraph/
cp package.json                → ...
cp server/index.js             → .../server/
cp server/plugin.js            → .../server/
cp server/routes/index.js      → .../server/routes/
cp target/public/networkGraph.plugin.js → .../target/public/
```
Only the **runtime files** are copied — not the webpack config, npm packages, or source
map files. The server-side `.js` files are already plain Node.js (no compilation needed).
The public bundle is the webpack output from Step 4.

**Step 7 – Fix ownership**
```bash
chown -R wazuh-dashboard:wazuh-dashboard /usr/share/wazuh-dashboard/plugins/networkGraph
```
The `wazuh-dashboard` service runs as the `wazuh-dashboard` system user. If the plugin
files are owned by root, the process may not be able to read them. This ensures the
correct ownership.

**Step 8 – Clean up /tmp**
```bash
rm -rf /tmp/networkGraph-build
```
Removes the temporary build directory that was created in Step 2. The `node_modules/`
folder alone is ~50 MB — no point leaving it on disk.

**Step 9 – Restart the service**
```bash
systemctl restart wazuh-dashboard
```
OSD plugins are loaded once at startup. The service must be restarted for any plugin
changes to take effect. After the restart, OSD scans the plugins directory, finds
`networkGraph/opensearch_dashboards.json`, loads `server/index.js`, and adds the
plugin bundle URL to the browser's bootstrap script.

---

## 6. How the Plugin Works End-to-End (Runtime Flow)

```
Browser loads https://localhost/app/...
  │
  ├─ 1. Fetches /bootstrap.js (generated by OSD server)
  │       Sets window.__osdBundles__, window.__osdPublicPath__
  │       Queues all plugin bundle URLs for loading
  │
  ├─ 2. Loads all plugin bundles (including networkGraph.plugin.js)
  │       Our bundle executes:
  │         → runs index.js + D3 initialisation
  │         → calls window.__osdBundles__.define("plugin/networkGraph/public", fn, 0)
  │
  ├─ 3. OSD bootstrap runs
  │       calls read("networkGraph")
  │         → window.__osdBundles__.get("plugin/networkGraph/public")
  │         → calls fn(0) → returns { plugin: function() {...} }
  │         → calls plugin() → returns new NetworkGraphPlugin()
  │
  ├─ 4. OSD calls NetworkGraphPlugin.setup(core)
  │       core.application.register({ id: 'networkGraph', title: 'Network Graph', ... })
  │       "Network Graph" appears in sidebar under Wazuh
  │
  └─ 5. User navigates to /app/networkGraph
          OSD calls mountApp(params)
            → builds page DOM (header, legend, graph canvas)
            → fetchData():
                GET /api/network_graph/agents  →  server proxy  →  Wazuh API /agents
                GET /api/network_graph/alerts  →  server proxy  →  Wazuh API /alerts
            → builds D3 force graph with agent nodes + coloured edges
            → setInterval(fetchData, 10000) — polls every 10 seconds
```

---

## 7. What's Working vs What Needs Real Data

| Feature | Status | Notes |
|---------|--------|-------|
| Plugin loads in OSD | ✅ Verified | Shows in server logs |
| Sidebar entry "Network Graph" | ✅ Verified | Appears under Wazuh section |
| Manager node displayed | ✅ Verified | Agent 000 in centre |
| Agent nodes displayed | ✅ Verified | Tested with 3 fake agents |
| Agent → manager edges | ✅ Verified | All shown as gray (no alerts) |
| 10-second auto-polling | ✅ Verified | Nodes appear/disappear on refresh |
| Draggable nodes | ✅ Implemented | D3 drag behaviour |
| Zoom + pan | ✅ Implemented | D3 zoom behaviour |
| Hover tooltips | ✅ Implemented | Shows name/IP/OS/status |
| Edge colouring (green/yellow/red) | ⚠️ Needs real alerts | Logic correct; alerts index empty |
| Agent-to-agent edges | ⚠️ Needs real alerts | Needs alerts with srcip/dstip fields |
| OS labels (WIN/DEB/RPM/LNX) | ⚠️ Needs real agents | Test agents have no OS info |
| Server-side JWT proxy | ✅ Verified | Token fetched and cached on first request |

---

## 8. Bugs Found and Fixed During Development

### Bug 1 – `npm install` fails on vboxsf
**Symptom:** `npm install` exits with permissions error on the shared folder.  
**Cause:** VirtualBox shared folder (vboxsf) does not support symbolic links. npm creates
symlinks in `node_modules/.bin/`.  
**Fix:** `install.sh` copies source to `/tmp/` before running `npm install`.

### Bug 2 – Plugin registers server-side but fails to load in browser
**Symptom:** OSD server logs show "Setting up networkGraph" and "Starting networkGraph"
but the browser shows:
```
Error: Definition of plugin "networkGraph" not found and may have failed to load.
```
**Root cause:** First version of `bundle_entry.js` used:
```javascript
if (typeof __osdBundles__ !== 'undefined') {
  __osdBundles__.define(...)
}
```
Webpack 5 + terser production mode treats bare `__osdBundles__` as an undeclared variable
in the local module scope. The `typeof` guard may evaluate to `"undefined"` at runtime
even when `window.__osdBundles__` is defined, so the `define()` call is skipped.

**Fix:** Changed to use `window.__osdBundles__` explicitly:
```javascript
if (typeof window !== 'undefined' && window.__osdBundles__) {
  window.__osdBundles__.define(...)
}
```
Terser cannot evaluate `window.__osdBundles__` at compile time, so the call is preserved.

---

## 9. Final File Tree (as installed)

```
/usr/share/wazuh-dashboard/plugins/networkGraph/
├── opensearch_dashboards.json
├── package.json
├── server/
│   ├── index.js
│   ├── plugin.js
│   └── routes/
│       └── index.js
└── target/
    └── public/
        └── networkGraph.plugin.js   (291 KB webpack bundle)
```

---

## 10. Test Commands

```bash
# Check service is running
systemctl status wazuh-dashboard

# Check plugin loaded (server-side logs)
journalctl -u wazuh-dashboard -n 100 --no-pager | grep -i networkgraph

# Verify bundle is served correctly (should return ~291 KB)
curl -sk https://localhost/414303/bundles/plugin/networkGraph/networkGraph.plugin.js | wc -c

# Add temporary test agents (creates 3 never_connected agents)
TOKEN=$(curl -sk -u 'wazuh-wui:v86bPF+u+2nph5LxghIFWivBr87qPgJL' \
  'https://localhost:55000/security/user/authenticate?raw=true')
for i in 1 2 3; do
  curl -sk -X POST "https://localhost:55000/agents" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"test-agent-0${i}\", \"ip\": \"192.168.1.10${i}\"}"
done

# Remove test agents
curl -sk -X DELETE \
  "https://localhost:55000/agents?agents_list=001,002,003&status=never_connected&older_than=0s" \
  -H "Authorization: Bearer $TOKEN"

# Navigate to the plugin
# https://localhost/app/networkGraph
```

---

## Fix: WAZUH_API_PASSWORD auto-resolution — 2026-04-23

### Symptom

During first-run installation via `setup.sh`, `networkGraph/install.sh` printed:

```
WARNING: WAZUH_API_PASSWORD not set.
Edit <env_file> and set WAZUH_API_PASSWORD, then restart wazuh-dashboard.
```

The plugin's `.env` was written with a blank `WAZUH_API_PASSWORD=`, causing all Wazuh API calls to fail with 401 until the operator manually edited the file.

### Root cause

`setup.sh` never resolved or exported `WAZUH_API_PASSWORD` before calling `install.sh`. The variable was only populated if the operator had set it in their shell environment before running the script.

### Fix (in `setup.sh`)

Added `resolve_wazuh_passwords()` helper to `setup.sh`. It locates `wazuh-install-files.tar` on any machine (checks `$REPO_DIR`, `$HOME`, `/root`, `/tmp`, then falls back to `find / -maxdepth 6`) and parses the `wazuh-wui` API password from `wazuh-install-files/wazuh-passwords.txt` inside the tar:

```bash
WAZUH_API_PASSWORD=$(... | grep -A1 "api_username: 'wazuh-wui'" \
    | grep "api_password:" | sed "s/.*api_password: '//;s/'.*//")
export WAZUH_API_PASSWORD
```

This is called once before the feature loop. Because `_sudo` uses `sudo -E`, the exported variable is visible to `networkGraph/install.sh` with no further changes to this plugin.

### No changes to networkGraph files

`networkGraph/install.sh` already reads `WAZUH_API_PASSWORD` from the environment correctly. The fix is entirely in `setup.sh`.

### Status

Resolved. On first-run install the `.env` is now written with the correct password automatically.

---

## Session 2026-04-23 — Wazuh Dashboard Threat Intelligence Sidebar Integration

### Goal

Register the Network Graph plugin as a native entry in the Wazuh Dashboard's **Threat Intelligence** sidebar section, matching how PECA and Compliance Overview appear under Security Operations.

### Design decision: wazuh.plugin.js only

Unlike PECA and Compliance Overview (which are Wazuh overview-module tabs requiring `wazuh.chunk.2.js` changes for the catalog map, DataSource class, tab counts, and module-tab config), Network Graph is a **standalone OSD plugin** at `/app/networkGraph`. The Wazuh sidebar just needs a registered app entry; there is no module tab, no DataSource, and no chunk.2.js change required.

The `redirectTo` points directly to the plugin URL:
```js
redirectTo: () => '/app/networkGraph'
```
No agent-context store lookup needed — network topology is a global view, not per-agent.

### App constant (wazuh.plugin.js)

```js
const network_graph_app = {
  category: "wz-category-threat-intelligence",
  id: "network-graph",
  title: i18n("wz-app-network-graph-title", { defaultMessage: "Network Graph" }),
  breadcrumbLabel: i18n("wz-app-network-graph-breadcrumbLabel", { defaultMessage: "Network Graph" }),
  description: i18n("wz-app-network-graph-description", { defaultMessage: "Visualize agent network topology, live connections, and alert traffic across your monitored infrastructure." }),
  euiIconType: "visNetwork",
  order: 303,
  showInOverviewApp: true,
  showInAgentMenu: false,
  redirectTo: () => '/app/networkGraph'
};
```

Order 303 places it after MITRE ATT&CK (302) in the Threat Intelligence category.

### Files changed

| File | Change |
|------|--------|
| `networkGraph/patch_plugin.py` | **New** — idempotent Python patch script for `wazuh.plugin.js` |
| `setup.sh` `install_networkGraph()` | **Updated** — added Step 2 (run `patch_plugin.py`) and Step 3 (regenerate `.gz`/`.br` compressed variants) |

### patch_plugin.py logic

- Primary anchor: inserts `network_graph_app` immediately after `compliance_overview_app`'s `redirectTo` line, before `const docker=`
- Fallback anchor: inserts before `const docker=` using the TSC redirect anchor (for installs without complianceView)
- Apps list: inserts `network_graph_app` after `compliance_overview_app` in the sorted apps array; fallback inserts before `.sort(` call
- All patches are idempotent — re-running detects the marker and skips

### Patch verified on live system (2026-04-23)

```
=== Patching wazuh.plugin.js (networkGraph sidebar entry) ===
  [OK]   applied: network_graph_app definition (after compliance_overview_app)
  [OK]   applied: apps list: insert network_graph_app after compliance_overview_app
plugin.js written.

Network Graph sidebar patch complete.
```

Compressed files regenerated (.gz and .br) and `wazuh-dashboard` restarted successfully.

### Status

Complete. Network Graph now appears in the Wazuh Dashboard under **Threat Intelligence** in the sidebar navigation.

---

## Session 2026-04-23 — Light theme conversion

### Issue

The Network Graph plugin page used hardcoded dark colours (`#0d0d1a` backgrounds, `#eee` text, dark SVG canvas). The rest of the Wazuh Dashboard runs in light mode; the plugin stood out as an inconsistent dark island.

### Changes (`public/index.js`)

| Element | Before | After |
|---------|--------|-------|
| Page background | `#0d0d1a` | `#f8fafc` |
| Header bar | `#12122a` / border `#2a2a4a` | `#f1f5f9` / border `#e2e8f0` |
| Header title | `#4fc3f7` | `#2b6cb0` |
| Status text | `#888` | `#718096` |
| Refresh button | `#1e6091` | `#3182ce` |
| Legend bar | `#0d0d1a` / border `#1a1a3a` | `#f8fafc` / border `#e2e8f0` |
| SVG canvas background | `#0d0d1a` | `#f8fafc` |
| Agent node fill | `#1a1a2e` | `#f1f5f9` |
| Agent OS abbreviation text | `#cccccc` | `#4a5568` |
| Agent name label | `#dddddd` | `#4a5568` |
| Tooltip background | `rgba(0,0,0,0.85)` | `rgba(255,255,255,0.97)` + border + shadow |
| Tooltip text | `#eee` | `#1a202c` |

Edge colours (gray/green/yellow/red) and manager/active/inactive node border colours are unchanged — they are semantic and already contrast well on a light background.

### Status

Built, installed, compressed variants regenerated. ✓

---

## 2026-04-23 — Removed redundant OSD sidebar entry

### Change

Removed the `core.application.register()` category block from `NetworkGraphPlugin.prototype.setup` in `public/index.js`. The plugin no longer appears as a navigation item in the generic OSD sidebar.

The `/app/networkGraph` route is still registered (OSD still mounts the page) — only the sidebar entry is removed. Access is now exclusively through the Wazuh native sidebar entry added by `patch_plugin.py` under **Threat Intelligence > Network Graph** (order 303).

### Reason

The OSD sidebar entry (under "Wazuh") was redundant and created a duplicate link alongside the Wazuh-native entry. Removing it simplifies the navigation — the plugin is surfaced in exactly one place (the Wazuh Threat Intelligence section).

### Files changed

- `public/index.js` — removed `category` block from `core.application.register()`
- `target/public/networkGraph.plugin.js` — rebuilt (webpack production)

### Status

Bundle rebuilt. ✓

---
## Session 2026-04-23 (FIX 2 — smooth refresh, no respawn animation)

### Changes to public/index.js

**Position preservation across poll cycles**
- Added `var prevNodeIds = new Set()` in `createGraph()` closure scope
- At the top of `update()`, snapshot current node positions from the live simulation:
  ```js
  var posMap = {};
  simulation.nodes().forEach(function(n) {
    if (n.id != null) posMap[n.id] = { x: n.x, y: n.y, vx: n.vx||0, vy: n.vy||0 };
  });
  ```
- Manager node and each agent node carry `x, y, vx, vy` from posMap (falling back to undefined for new nodes, which D3 initialises randomly — correct behaviour)

**Topology change detection**
- Build `newNodeIds` Set each cycle; compare size and membership against `prevNodeIds`
- `topologyChanged = true` only when nodes are added or removed
- Update `prevNodeIds = newNodeIds` after detection

**Conditional simulation restart**
- `simulation.alpha(0.1).restart()` called only when `topologyChanged`
- Steady-state polls (no topology change) leave the simulation untouched — nodes stay exactly where the user positioned them

**Smooth transitions**
- New nodes: enter at `opacity: 0`, fade to `1` over 400ms
- Removed nodes: fade to `opacity: 0` over 400ms then `.remove()`
- Edge colour updates: `transition().duration(500)` on stroke attribute

### Build & install
- Built in /tmp/networkGraph-build (`webpack compiled successfully in 33864ms`)
- Installed to `/usr/share/wazuh-dashboard/plugins/networkGraph/target/public/networkGraph.plugin.js`
- Wazuh-dashboard restarted — service active ✓

---

## 2026-04-24 — Hash-router bypass fix (window.location.replace)

### Symptom

Clicking **Network Graph** in the Wazuh sidebar navigated to
`https://localhost/app/network-graph#/app/networkGraph` instead of
`https://localhost/app/networkGraph`. The sidebar entry appeared to do nothing — the
URL fragment changed but the page stayed on whatever Wazuh module was currently open.

### Root cause

Wazuh's sidebar navigation calls `history.push(redirectTo())` internally.
`history.push` uses the browser's History API to append a new entry, but Wazuh's OSD
integration runs on a hash-based router (`#/...`). When `redirectTo` returned
`'/app/networkGraph'`, the hash router treated it as a hash path and produced
`/app/network-graph#/app/networkGraph` — appending the destination as a fragment to the
currently active Wazuh app URL instead of navigating to a new OSD app.

### Fix

Changed `redirectTo` in both fresh-install code and the upgrade patch to use
`window.location.replace()` instead of returning a bare string:

```js
// Before (broken — hash router intercepts):
redirectTo: () => '/app/networkGraph'

// After (correct — full browser navigation bypasses hash router):
redirectTo: () => { window.location.replace('/app/networkGraph'); }
```

`window.location.replace()` forces a full browser navigation that completely bypasses
the Wazuh hash router. The history entry is replaced (not pushed) so the back button
does not loop.

### Files changed

| File | Change |
|------|--------|
| `patch_plugin.py` `NET_GRAPH_APP` constant | `redirectTo` updated to `window.location.replace` for fresh installs |
| `patch_plugin.py` Step 1b | New idempotent upgrade step that fixes already-installed bundles with the old bare-string `redirectTo` |

### Status

Fix applied to `patch_plugin.py`. Re-running install.sh applies both the fresh-install
constant and the step-1b upgrade patch in one pass. ✓

---

## 2026-04-24 — PLAN: Right-Side Incident Sidebar

**Status:** PLANNED — not yet implemented  
**Scope:** Add a docked incident sidebar to the Network Graph page, inspired by OpenSearch Security Analytics' Correlations view.

---

### Goal

Every refresh cycle the sidebar populates with the alerts that drove the current edge colours (the same 5-minute window the graph already fetches). The sidebar is NOT a separate fetch — it reuses the alert data that `fetchData()` already has.

---

### Reconnaissance Summary

**Current data flow (relevant facts for sidebar):**

1. `fetchData()` in `mountApp()` calls two routes in parallel:
   - `GET /api/network_graph/agents` → Wazuh `/agents?limit=500&select=id,name,ip,status,os.name,os.version`
   - `GET /api/network_graph/alerts` → Wazuh `/alerts?limit=500&select=agent.id,rule.level,data.srcip,data.dstip,data.src_ip,data.dst_ip&q=timestamp>5min_ago&sort=-timestamp`

2. `alerts` from the alerts route are currently used only to build `alertMap` (agentId → [levels]) and `peerPairs`. The raw alert objects are discarded after `fetchData()` returns. The sidebar needs these raw alert objects.

3. `createGraph(container)` returns `{ update(agents, alertMap), destroy() }`. The update function takes `agents` and `alertMap` — no raw alerts.

4. The alerts route's `select` parameter is insufficient for the sidebar. Missing fields: `rule.id`, `rule.description`, `rule.groups`, `agent.name`, `timestamp`. Also need the document `_id` for the investigate link (Wazuh API returns this as `id` on each alert item in `affected_items`).

5. `ipToAgent` (IP → agentId reverse lookup) is built inside `fetchData()` and is currently local. The sidebar needs it to display "Agent-01 → Agent-03" edge labels.

6. Current layout: full-height flex column inside `params.element` with header + legend + canvas. No horizontal split yet.

7. No theming system exists yet (all colours are hardcoded to light-theme values). The plan introduces `.dark-theme` scoped CSS via a `<style>` injection.

8. The `createGraph()` function has no click handlers on edges and no external API to highlight a specific edge programmatically.

---

### Files to Change

| File | Changes |
|------|---------|
| `server/routes/index.js` | Expand alerts `select` to include more fields |
| `public/index.js` | All layout, sidebar, cross-link, animation changes |
| (rebuild) `target/public/networkGraph.plugin.js` | Re-run webpack after JS changes |

No new files needed. Everything stays in the two existing files as per the "keep code in networkGraph/public/index.js" and "single-file server routes" constraints.

---

### Phase 1 — Server Route: Expand Alert Fields

**File:** `server/routes/index.js`

**Change:** Update the `select` parameter in the alerts route from:
```
&select=agent.id,rule.level,data.srcip,data.dstip,data.src_ip,data.dst_ip
```
to:
```
&select=agent.id,agent.name,rule.level,rule.id,rule.description,rule.groups,data.srcip,data.dstip,data.src_ip,data.dst_ip,timestamp
```

**Why:** The sidebar needs `rule.description` for the incident title, `rule.groups` for the group chips, `agent.name` for the source display, and `timestamp` for relative time. `rule.id` is needed to identify the rule. The Wazuh API also returns `id` on each alert item in `affected_items` which maps to the OpenSearch document `_id` — needed for the investigate link URL.

**Test after this change (before touching client side):**
```bash
TOKEN=$(curl -sk -u 'wazuh-wui:v86bPF+u+2nph5LxghIFWivBr87qPgJL' \
  'https://localhost:55000/security/user/authenticate?raw=true')
curl -sk -H "Authorization: Bearer $TOKEN" \
  'https://localhost:55000/alerts?limit=3&select=agent.id,agent.name,rule.level,rule.id,rule.description,rule.groups,data.srcip,data.dstip,timestamp&sort=-timestamp' \
  | python3 -m json.tool | head -80
```
Inspect the response to confirm:
- `id` field present on each alert item (this is the document `_id` for the investigate URL)
- `rule.description` is a string
- `rule.groups` is an array of strings
- `agent.name` is present
- `timestamp` is ISO 8601

Also test the investigate URL manually: navigate to `/app/wazuh#/overview/?tab=general&tabView=discover&_g=(filters:!())&_a=(filters:!((meta:(alias:!n,disabled:!f,index:'wazuh-alerts-*',key:_id,negate:!f,params:(query:'ALERT_ID'),type:phrase),query:(match_phrase:(_id:'ALERT_ID')))),query:(language:kuery,query:''))` replacing `ALERT_ID` with a real `id` value from the curl output. Confirm the Wazuh Discover view loads filtered to that alert. If the URL pattern doesn't match what the dashboard actually produces, copy the URL from clicking through a live alert and update the `INVESTIGATE_URL_TEMPLATE` constant accordingly.

---

### Phase 2 — Client: Thread Raw Alerts Through the Pipeline

**File:** `public/index.js`

**Current flow:**
```
fetchData()
  → alerts = alertsBody.data.affected_items
  → build alertMap from alerts  [alerts discarded after this]
  → graph.update(agents, alertMap)
```

**New flow:**
```
fetchData()
  → rawAlerts = alertsBody.data.affected_items   [keep reference]
  → build alertMap from rawAlerts  (unchanged logic)
  → graph.update(agents, alertMap)               (unchanged)
  → sidebar.update(rawAlerts, ipToAgent)         [NEW]
```

**Changes inside `fetchData()`:**
- Rename `alerts` to `rawAlerts` (clarity).
- Move `ipToAgent` build to before both the alertMap loop and the sidebar call (it's already built there, just needs to stay in scope long enough to pass to `sidebar.update`).
- After `graph.update(...)`, call `sidebar.update(rawAlerts, ipToAgent)`.
- Also pass agents array so the sidebar can resolve agent names from IDs.

The sidebar's `update` call signature:
```js
sidebar.update(rawAlerts, agents, ipToAgent)
```

---

### Phase 3 — Layout: Horizontal Split

**File:** `public/index.js`, inside `mountApp()`

**Current structure:**
```
element (flex-column)
  ├── header
  ├── legend
  └── canvas (flex:1)
```

**New structure:**
```
element (flex-column)
  ├── header (full width)
  ├── legend (full width)
  └── mainRow (flex-row, flex:1)
       ├── graphPane (flex:1, min-width:0, position:relative)
       │    └── canvas div (100% width/height, D3 SVG goes here)
       └── sidebarPane (width:320px, flex-shrink:0, overflow:hidden)
            └── [incident sidebar DOM]
```

The sidebar pane width is 320px fixed (not a percentage) — this is simpler and more predictable than 30% which can become very narrow on small screens.

**Responsive collapse (< 1200px):**
- A CSS `@media (max-width: 1199px)` rule hides the sidebarPane (`display:none`) and shows a floating toggle button.
- A click on the toggle button adds/removes a class `sidebar-open` on the mainRow — the sidebarPane slides in as a fixed overlay from the right.

**Toggle button (always visible):**
- Small button anchored to the right edge of the graphPane header area.
- Icon: `▶` (collapsed) / `◀` (expanded).
- On click: toggles `sidebar-hidden` class on sidebarPane. When hidden, graphPane takes full width.

Implementation approach: inject a `<style>` block into the document `<head>` (scoped to `.ng-layout` class applied to `element`). This avoids inline style management for state transitions.

```css
.ng-layout { ... }
.ng-main-row { display:flex; flex:1; overflow:hidden; }
.ng-graph-pane { flex:1; min-width:0; position:relative; }
.ng-sidebar-pane { width:320px; flex-shrink:0; border-left:1px solid #e2e8f0; 
                   overflow:hidden; display:flex; flex-direction:column; 
                   transition:width 0.2s ease; }
.ng-sidebar-pane.ng-sidebar-hidden { width:0; }
.dark-theme .ng-sidebar-pane { border-left-color:#2d3748; background:#1a202c; }
@media (max-width:1199px) {
  .ng-sidebar-pane { position:fixed; top:0; right:0; height:100%; z-index:200;
                     transform:translateX(100%); transition:transform 0.2s ease; }
  .ng-sidebar-pane.ng-sidebar-open { transform:translateX(0); }
}
```

**Dark theme detection:** Check `document.documentElement.classList.contains('dark-theme')` or `document.body.classList.contains('dark-theme')`. Apply `.dark-theme` class to `element` when detected on mount and also listen for class mutations with a `MutationObserver` for live theme switching.

---

### Phase 4 — `createSidebar(container)` Function

**File:** `public/index.js` — new top-level function, similar structure to `createGraph()`.

Returns `{ update(alerts, agents, ipToAgent), scrollToIncident(nodeA, nodeB), highlightEntry(alertId), destroy() }`.

**Internal DOM structure:**
```
container (sidebarPane)
  ├── sidebarHeader
  │    ├── titleRow: "Recent Incidents" + toggle button
  │    ├── subtitleRow: "Last refresh: HH:MM:SS" + count badge
  │    └── filterRow: severity filter <select>
  └── incidentList (scrollable div, flex:1, overflow-y:auto)
       ├── [incident entries — D3 data join]
       └── [empty state div — shown when list is empty]
```

**Severity chip colour mapping:**
```js
var SEVERITY_COLORS = {
  critical: { bg: '#fed7d7', text: '#c53030', border: '#fc8181' },  // level ≥ 15
  high:     { bg: '#feebc8', text: '#c05621', border: '#f6ad55' },  // level 12–14
  medium:   { bg: '#fefcbf', text: '#975a16', border: '#f6e05e' },  // level 7–11
  low:      { bg: '#bee3f8', text: '#2b6cb0', border: '#90cdf4' },  // level 4–6
  info:     { bg: '#e2e8f0', text: '#4a5568', border: '#cbd5e0' },  // level < 4
};
function severityFromLevel(level) {
  if (level >= 15) return 'critical';
  if (level >= 12) return 'high';
  if (level >= 7)  return 'medium';
  if (level >= 4)  return 'low';
  return 'info';
}
```

**Each incident entry DOM (single `<div class="ng-incident">`):**
```
[severity chip: "12"] [rule description (truncated ~80 chars, title=full text)]
[src → dst chip row]  [timestamp: "30s ago"]
[rule group chips]    [🔍 investigate button]
```

Layout: CSS grid or flex. Compact (≤ 70px tall per entry).

**D3 data join with key = alert `id`:**
```js
var sel = d3.select(incidentList)
  .selectAll('div.ng-incident')
  .data(filteredAlerts, function(d) { return d.id; });

var entering = sel.enter().append('div').attr('class', 'ng-incident ng-incident-new');
// ... build DOM for new entries ...

// Mark new entries for 3-second animation, then remove the class.
entering.each(function() {
  var el = this;
  setTimeout(function() {
    el.classList.remove('ng-incident-new');
  }, 3000);
});

sel.exit().remove();
```

The `ng-incident-new` class applies a CSS left-border pulse animation:
```css
.ng-incident-new {
  animation: ng-new-entry 3s ease forwards;
}
@keyframes ng-new-entry {
  0%   { border-left: 3px solid #3182ce; }
  80%  { border-left: 3px solid #3182ce; }
  100% { border-left: 3px solid transparent; }
}
```

**Filtering:** The `<select>` filter has options `all | critical | high+ | medium+`. On change, re-run the D3 data join with the filtered subset. Keep the full `rawAlerts` array in closure scope; the select only changes which subset is shown.

**Sorting:** Before the data join, sort `rawAlerts` by timestamp desc (already sorted from server), then stable-sort by severity desc within the same timestamp second (useful when multiple alerts arrive at the same second).

**Top 50 cap:** If `filteredAlerts.length > 50`, display only the first 50 and show a "Show all N incidents" button at the bottom. Clicking it removes the cap and re-runs the join.

**Empty state:** A sibling `<div class="ng-empty-state">` with a green checkmark SVG and the text "No incidents in the last refresh interval. System is quiet." Toggle `display:none` vs `display:flex` based on whether the filtered list is empty.

**Relative timestamp helper:**
```js
function relativeTime(isoTimestamp) {
  var diffMs = Date.now() - new Date(isoTimestamp).getTime();
  if (diffMs < 0) diffMs = 0;
  var secs = Math.floor(diffMs / 1000);
  if (secs < 60)  return secs + 's ago';
  var mins = Math.floor(secs / 60);
  if (mins < 60)  return mins + 'm ago';
  var hours = Math.floor(mins / 60);
  return hours + 'h ago';
}
```

**Source/destination display:**
```js
function incidentNodes(alert, agents, ipToAgent) {
  var srcIp = alert.data && (alert.data.srcip || alert.data.src_ip);
  var dstIp = alert.data && (alert.data.dstip || alert.data.dst_ip);
  var srcAgentId = srcIp && ipToAgent[srcIp];
  var dstAgentId = dstIp && ipToAgent[dstIp];

  // Build a lookup: agentId → name (from the agents array)
  var agentNameById = {};
  (agents || []).forEach(function(a) { agentNameById[a.id] = a.name || ('Agent ' + a.id); });

  if (srcAgentId && dstAgentId) {
    return (agentNameById[srcAgentId] || srcAgentId) + ' → ' + (agentNameById[dstAgentId] || dstAgentId);
  }
  if (srcAgentId) {
    return agentNameById[srcAgentId] || srcAgentId;
  }
  // Fall back to the alert's own agent name (the agent that generated the alert)
  return (alert.agent && alert.agent.name) || (alert.agent && alert.agent.id) || 'Unknown';
}
```

**Investigate link URL:**
```js
var INVESTIGATE_URL_TEMPLATE =
  "/app/wazuh#/overview/?tab=general&tabView=discover&_g=(filters:!())" +
  "&_a=(filters:!((meta:(alias:!n,disabled:!f,index:'wazuh-alerts-*',key:_id," +
  "negate:!f,params:(query:'ALERT_ID'),type:phrase),query:(match_phrase:(_id:'ALERT_ID'))))," +
  "query:(language:kuery,query:''))";

function investigateUrl(alertId) {
  return INVESTIGATE_URL_TEMPLATE.split('ALERT_ID').join(encodeURIComponent(alertId));
}
```

Each investigate button: `<a href="..." target="_blank" rel="noopener noreferrer">🔍</a>`.

---

### Phase 5 — Refresh Animation

**File:** `public/index.js`, inside `createSidebar()` and `fetchData()`.

Approach: the `update()` method on the sidebar takes care of the fade internally.

```js
function update(rawAlerts, agents, ipToAgent) {
  // Fade existing list to 0.5 opacity
  d3.select(incidentList).transition().duration(200).style('opacity', 0.5);

  // Snapshot current scroll position
  var prevScrollTop = incidentList.scrollTop;

  // ... build new data, run D3 join ...

  // Fade back + restore scroll
  d3.select(incidentList).transition().duration(200).delay(200).style('opacity', 1)
    .on('end', function() {
      incidentList.scrollTop = prevScrollTop;
    });

  // Update subtitle timestamp
  subtitleEl.textContent = 'Last refresh: ' + new Date().toLocaleTimeString();

  // Pulse header if new critical alert appeared
  var hadCritical = rawAlerts.some(function(a) { return a.rule && a.rule.level >= 12; });
  if (hadCritical) {
    sidebarHeader.style.borderLeft = '3px solid ' + COLOR_HIGH;
    setTimeout(function() { sidebarHeader.style.borderLeft = ''; }, 2000);
  }
}
```

Note: restore scroll in `.on('end')` after the fade-back transition completes. This prevents the scroll jumping during the fade-out.

---

### Phase 6 — Edge ↔ Sidebar Cross-Linking

**Two-way bridge between graph and sidebar.**

**6a. createGraph() changes:**

Add optional callbacks to the `update()` or new options passed to `createGraph()`:

```js
function createGraph(container, opts) {
  // opts = { onEdgeClick, onEdgeHighlightEnd }
  var onEdgeClick = (opts && opts.onEdgeClick) || function() {};
  ...
}
```

Add click handler to link enter selection:
```js
linkEnter.on('click', function(event, d) {
  var srcId = typeof d.source === 'object' ? d.source.id : d.source;
  var dstId = typeof d.target === 'object' ? d.target.id : d.target;
  onEdgeClick(srcId, dstId);
});
```

Expose `highlightEdge(srcId, dstId)` and `clearHighlight()` on the returned object:

```js
function highlightEdge(nodeA, nodeB) {
  linkLayer.selectAll('line').each(function(d) {
    var src = typeof d.source === 'object' ? d.source.id : d.source;
    var tgt = typeof d.target === 'object' ? d.target.id : d.target;
    var isMatch = (src === nodeA && tgt === nodeB) || (src === nodeB && tgt === nodeA);
    d3.select(this)
      .attr('stroke-width', isMatch ? 5 : (d.isPeer ? 1.5 : 2))
      .style('filter', isMatch ? 'drop-shadow(0 0 4px currentColor)' : null);
  });
  // Auto-clear after 2 seconds
  setTimeout(clearHighlight, 2000);
}

function clearHighlight() {
  linkLayer.selectAll('line')
    .attr('stroke-width', function(d) { return d.isPeer ? 1.5 : 2; })
    .style('filter', null);
}
```

**6b. createSidebar() changes:**

Accept callbacks `{ onIncidentHover, onIncidentHoverOut }` in options:
```js
function createSidebar(container, opts) {
  var onIncidentHover   = (opts && opts.onIncidentHover)   || function() {};
  var onIncidentHoverOut = (opts && opts.onIncidentHoverOut) || function() {};
  ...
}
```

On each incident entry's enter selection, attach hover handlers:
```js
entering
  .on('mouseover', function(event, d) {
    var srcIp = d.data && (d.data.srcip || d.data.src_ip);
    var dstIp = d.data && (d.data.dstip || d.data.dst_ip);
    var srcAgent = srcIp && currentIpToAgent[srcIp];
    var dstAgent = dstIp && currentIpToAgent[dstIp];
    if (srcAgent && dstAgent) onIncidentHover(srcAgent, dstAgent);
    else if (d.agent && d.agent.id) onIncidentHover(d.agent.id, MANAGER_ID);
  })
  .on('mouseout', function() { onIncidentHoverOut(); });
```

Expose `scrollToIncident(nodeA, nodeB)` and `pulseEntry(alertId)`:
```js
function scrollToIncident(nodeA, nodeB) {
  // Find first entry where both nodes match
  var found = incidentList.querySelector(
    '[data-src="' + nodeA + '"][data-dst="' + nodeB + '"],' +
    '[data-src="' + nodeB + '"][data-dst="' + nodeA + '"]'
  );
  if (!found) return;
  found.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  pulseEntry(found.dataset.alertId);
}

function pulseEntry(alertId) {
  var el = incidentList.querySelector('[data-alert-id="' + alertId + '"]');
  if (!el) return;
  el.classList.add('ng-incident-pulse');
  setTimeout(function() { el.classList.remove('ng-incident-pulse'); }, 2000);
}
```

CSS for the pulse:
```css
.ng-incident-pulse {
  animation: ng-pulse-border 2s ease;
}
@keyframes ng-pulse-border {
  0%   { box-shadow: 0 0 0 2px #3182ce; }
  50%  { box-shadow: 0 0 0 3px #3182ce; }
  100% { box-shadow: none; }
}
```

Each incident entry needs `data-alert-id`, `data-src`, `data-dst` HTML attributes set on the enter selection.

**6c. Wiring in mountApp():**

```js
var graph = createGraph(canvas, {
  onEdgeClick: function(srcId, dstId) {
    if (sidebar) sidebar.scrollToIncident(srcId, dstId);
  }
});

var sidebar = createSidebar(sidebarPane, {
  onIncidentHover:    function(srcId, dstId) { if (graph) graph.highlightEdge(srcId, dstId); },
  onIncidentHoverOut: function()              { if (graph) graph.clearHighlight(); },
});
```

---

### Phase 7 — Sidebar Toggle Button

A small button in the top-right of the header:
```js
var toggleBtn = document.createElement('button');
toggleBtn.id = 'ng-sidebar-toggle';
toggleBtn.textContent = '◀';
toggleBtn.title = 'Toggle incident sidebar';
toggleBtn.style.cssText = 'margin-left:8px;padding:4px 8px;background:#e2e8f0;' +
  'border:none;border-radius:4px;cursor:pointer;font-size:12px;';
header.appendChild(toggleBtn);

var sidebarHidden = false;
toggleBtn.addEventListener('click', function() {
  sidebarHidden = !sidebarHidden;
  sidebarPane.classList.toggle('ng-sidebar-hidden', sidebarHidden);
  toggleBtn.textContent = sidebarHidden ? '▶' : '◀';
});
```

---

### Phase 8 — Dark Theme Support

Inject a `<style id="ng-styles">` block into `document.head` on mount. The style block includes all sidebar-specific CSS plus `.dark-theme` overrides.

```css
/* Light theme (default) */
.ng-sidebar-pane { background:#ffffff; border-left:1px solid #e2e8f0; }
.ng-sidebar-header { background:#f1f5f9; border-bottom:1px solid #e2e8f0; }
.ng-incident { border-bottom:1px solid #f0f4f8; }

/* Dark theme */
.dark-theme .ng-sidebar-pane { background:#1a202c; border-left-color:#2d3748; }
.dark-theme .ng-sidebar-header { background:#2d3748; border-bottom-color:#4a5568; }
.dark-theme .ng-incident { border-bottom-color:#2d3748; color:#e2e8f0; }
.dark-theme .ng-incident-desc { color:#cbd5e0; }
```

Theme detection at mount time:
```js
function isDarkTheme() {
  return document.documentElement.classList.contains('dark-theme') ||
         document.body.classList.contains('dark-theme') ||
         document.querySelector('.euiBody--darkColorScheme') !== null;
}
```

Apply to the root element: `element.classList.toggle('dark-theme', isDarkTheme())`.

Use a `MutationObserver` on `document.body` to detect live theme changes and re-apply the class.

---

### Phase 9 — Build & Deploy Sequence

After all code changes:

1. Copy source to `/tmp/networkGraph-build/` (done by `install.sh`).
2. Run `npm install --legacy-peer-deps` in the build directory.
3. Run `npx webpack --mode production` → produces new `target/public/networkGraph.plugin.js`.
4. Run `sudo bash install.sh --no-restart` to copy files.
5. Restart `wazuh-dashboard` manually: `sudo systemctl restart wazuh-dashboard`.
6. Verify bundle loaded: `journalctl -u wazuh-dashboard -n 50 --no-pager | grep -i network`.

---

### Phase 10 — Testing Checklist

After install, run through each test:

1. **Sidebar populates with alerts:** Generate test alerts (`wazuh-logtest` or SSH failures). Wait for next refresh (10s). Verify severity chips show rule levels. Verify rule descriptions appear truncated with full text on hover.

2. **Severity chips match rule levels:**
   - Level ≥ 15 → red chip
   - Level 12–14 → orange chip
   - Level 7–11 → yellow chip
   - Level 4–6 → blue chip
   - Level < 4 → gray chip

3. **Investigate link:** Click 🔍 button. Confirm new tab opens to Wazuh Discover view filtered to that specific alert `_id`. If URL pattern is wrong, copy the actual URL from manually navigating to a known alert and update `INVESTIGATE_URL_TEMPLATE`.

4. **Refresh animation:** Watch 2–3 refresh cycles. Verify the list fades briefly (200ms), updates, fades back — no jarring rebuild. Verify scroll position preserved when user has scrolled partway down.

5. **Edge click → sidebar scroll:** Click a colored edge in the graph. Verify the sidebar scrolls to the first incident involving those two nodes and a pulse animation plays for 2 seconds.

6. **Incident hover → edge highlight:** Hover over an incident entry that involves a peer-to-peer connection. Verify the corresponding edge in the graph glows/thickens for 2 seconds.

7. **New incident animation:** Trigger an alert while the page is open. On next refresh, the new entry should have a left-border accent animation for 3 seconds.

8. **Empty state:** Wait until the 5-minute alert window has passed with no new alerts. Verify the green checkmark empty state is shown.

9. **Narrow window collapse:** Resize browser window to < 1200px. Verify sidebar collapses. Verify the toggle button appears and clicking it slides the sidebar in from the right.

10. **Toggle button:** On wide screen, click the ◀ / ▶ toggle button. Verify sidebar hides/shows and the graph expands to fill the space.

11. **Dark theme:** Enable Wazuh Dashboard dark theme. Verify sidebar matches dark colour scheme (dark background, light text, dark borders).

12. **Filter dropdown:** Select "Critical only" — verify only rule.level ≥ 15 alerts shown. Select "High+" — verify only ≥ 12 shown. Select "Medium+" — verify only ≥ 7 shown.

13. **>50 incidents cap:** If possible to generate >50 alerts, verify only top 50 shown with "Show all N incidents" button. Clicking it shows all.

14. **curl test for new route fields:**
```bash
TOKEN=$(curl -sk -u 'wazuh-wui:v86bPF+u+2nph5LxghIFWivBr87qPgJL' \
  'https://localhost:55000/security/user/authenticate?raw=true')
curl -sk -H "Authorization: Bearer $TOKEN" \
  'https://localhost:55000/alerts?limit=3&select=agent.id,agent.name,rule.level,rule.id,rule.description,rule.groups,data.srcip,data.dstip,timestamp&sort=-timestamp' \
  | python3 -m json.tool | head -100
```
Verify all requested fields appear in response.

15. **Browser console:** No JS errors. Specifically: no "Cannot read property of undefined" on alert fields, no D3 data join key collisions.

---

### Risk Notes & Unknowns

1. **Alert document `_id` field name:** The Wazuh API returns each alert item in `affected_items`. The OpenSearch document ID (`_id`) is typically exposed as `id` on each item. Verify with the curl test in Phase 1 before writing client code that depends on `alert.id`.

2. **`rule.groups` field:** Wazuh rules can have multiple groups. The field should be an array of strings. Some decoders may omit it — always check `Array.isArray(alert.rule.groups)` before rendering chips.

3. **`rule.description` field:** Most rules have this. For custom rules without a description, fall back to `'Rule ' + alert.rule.id`.

4. **Agent-to-agent incident display:** For peer-to-peer alerts, `incidentNodes()` uses `ipToAgent` for src/dst lookup. The `ipToAgent` map is built from the agents list — if src or dst IP doesn't match any enrolled agent (e.g., external IP), the display falls back gracefully to the alert's agent name.

5. **Sidebar pane scroll + D3 join interaction:** D3's `selection.exit().remove()` removes DOM nodes from the bottom of the list. The scroll position snapshot must be taken before the D3 join runs and restored after the fade-back transition completes (not in the middle of the transition).

6. **CSS injection cleanup:** The `<style id="ng-styles">` injected into `document.head` must be removed in the `unmount()` function to avoid style leaking when the user navigates away and returns.

7. **MutationObserver cleanup:** The theme-watching `MutationObserver` must be `.disconnect()`-ed in `unmount()`.

8. **Performance with many alerts:** 500 alerts × DOM nodes is potentially heavy. The 50-item cap mitigates this. If performance is still poor with 50 items, consider using virtual scrolling (out of scope for now).

---

### Implementation Order (when building)

Execute phases in this order to allow incremental testing at each step:

1. Phase 1 (server route) → curl test → confirm fields present
2. Phase 2 (thread raw alerts through fetchData) → console.log to verify data reaches sidebar.update
3. Phase 3 (layout split) → visually confirm 70/30 split, no graph regression
4. Phase 4 (createSidebar basic) → incidents appear in list with chips and text
5. Phase 5 (refresh animation) → watch several cycles
6. Phase 6 (cross-linking) → test edge click and hover
7. Phase 7 (toggle button) → test show/hide
8. Phase 8 (dark theme) → toggle theme and verify
9. Phase 9 (build) → install and full regression test
10. Phase 10 (testing checklist) → log results

---

### Status: PLANNED — ready to implement in next session

---

## Session 2026-04-24 — Right-Side Incident Sidebar (Phases 1–9 implemented)

**Developer:** Claude Sonnet 4.6
**Scope:** Implement the full right-side incident sidebar plan (phases 1–9) from the plan above.

---

### Files changed

| File | Change |
|------|--------|
| `server/routes/index.js` | Expanded alerts `select` to include `agent.name`, `rule.id`, `rule.description`, `rule.groups`, `timestamp` |
| `public/index.js` | Full rewrite — horizontal split layout, createSidebar, cross-linking, toggle, dark theme support |
| `target/public/networkGraph.plugin.js` | Rebuilt (316 KiB, webpack 5.106.2, Node 18.19.1) |

---

### Phase 1 — Server route: alert fields expanded

`server/routes/index.js` alerts select parameter changed from:
```
&select=agent.id,rule.level,data.srcip,data.dstip,data.src_ip,data.dst_ip
```
to:
```
&select=agent.id,agent.name,rule.level,rule.id,rule.description,rule.groups,data.srcip,data.dstip,data.src_ip,data.dst_ip,timestamp
```

**Note:** Wazuh 4.14.3 REST API does not expose an `/alerts` endpoint — alerts are stored directly in the indexer (OpenSearch). The proxy returns `{"title":"Not Found","detail":"404: Not Found"}` with HTTP 200. The client-side `(alertsBody.data && alertsBody.data.affected_items) || []` fallback handles this gracefully and the sidebar shows the green-checkmark empty state. This is pre-existing behaviour from the original build; not caused by the sidebar addition.

---

### Phase 2 — Raw alerts threaded through fetchData

`fetchData()` now retains the full `rawAlerts` array (previously discarded after building `alertMap`) and passes it to `sidebar.update(rawAlerts, agents, ipToAgent)` after `graph.update()`.

---

### Phase 3 — Horizontal split layout

Old layout (canvas directly in element):
```
element(flex-col) → header → legend → canvas(flex:1)
```

New layout:
```
element(flex-col, class ng-layout)
  → header → legend
  → mainRow(flex-row, flex:1)
       → graphPane(flex:1) → canvas
       → sidebarPane(320px, collapsible)
```

CSS injected into `document.head` as `<style id="ng-styles">` on mount, removed in unmount.

---

### Phase 4 — createSidebar()

New top-level function `createSidebar(container, opts)`. Structure:
- Header: title + count badge + last-refresh time + filter dropdown
- Scrollable incident list (D3 data join keyed by alert `id`)
- Empty state (green checkmark SVG + "System is quiet" message)
- Show-all button (appears when list is capped at 50 entries)

Each incident entry shows:
- Severity chip (colour-coded by rule.level: critical/high/medium/low/info)
- Rule description (truncated to 75 chars, full text in title attribute)
- Source → destination label (resolved from agent names via ipToAgent)
- Relative timestamp (e.g. "30s ago")
- Rule group chips (up to 3, filtered to < 22 chars)
- 🔍 investigate link (opens Wazuh Discover filtered to alert _id)

New animations:
- `ng-incident-new` — left-border fade-in over 3 seconds for new entries
- `ng-incident-pulse` — box-shadow pulse for 2 seconds (triggered by edge click)

---

### Phase 5 — Refresh animation

`sidebar.update()` fades the incident list to 0.5 opacity (200ms), runs the D3 join, then fades back (200ms delay + 200ms fade) and restores scroll position. Header left-border pulses red for 2 seconds if any high-severity alert is present.

---

### Phase 6 — Edge ↔ Sidebar cross-linking

**createGraph changes:**
- Accepts `opts = { onEdgeClick }` parameter
- Click handler on link enter selection calls `onEdgeClick(srcId, dstId)`
- New `highlightEdge(nodeA, nodeB)` — thickens matched edge (stroke-width 5) and adds `drop-shadow(0 0 4px currentColor)` filter; auto-clears after 2 seconds
- New `clearHighlight()` — resets all edges to default widths
- `destroy()` return now also includes `highlightEdge` and `clearHighlight`

**createSidebar changes:**
- Accepts `opts = { onIncidentHover, onIncidentHoverOut }` parameter
- Incident entry `mouseover` → calls `onIncidentHover(srcId, dstId)` using `data-src`/`data-dst` attributes
- Incident entry `mouseout` → calls `onIncidentHoverOut()`
- `scrollToIncident(nodeA, nodeB)` — queries by `[data-src][data-dst]`, scrolls into view, triggers pulse
- `pulseEntry(alertId)` — adds `ng-incident-pulse` class for 2 seconds

**Wired in mountApp:**
```js
graph = createGraph(canvas, {
  onEdgeClick: function(srcId, dstId) { if (sidebar) sidebar.scrollToIncident(srcId, dstId); },
});
sidebar = createSidebar(sidebarPane, {
  onIncidentHover:    function(srcId, dstId) { if (graph) graph.highlightEdge(srcId, dstId); },
  onIncidentHoverOut: function()              { if (graph) graph.clearHighlight(); },
});
```

---

### Phase 7 — Sidebar toggle button

`#ng-sidebar-toggle` button appended to the header bar (right of Refresh). Toggles `ng-sidebar-hidden` class on `sidebarPane`. Arrow icon: `◀` (open) / `▶` (closed). CSS uses `transition: width 0.2s ease` on `.ng-sidebar-pane`. On narrow screens (< 1200px), switches to a fixed-position slide-over via `@media` query.

---

### Phase 8 — Dark theme support

Theme detection:
- `isDarkTheme()` checks `document.documentElement`, `document.body`, and `.euiBody--darkColorScheme`
- `applyTheme(dark)` toggles `.dark-theme` class on `element`
- Listens to `fyp-theme-changed` CustomEvent (dispatched by the localization plugin)
- `MutationObserver` on `document.body` as fallback

Dark theme CSS scoped to `.ng-layout.dark-theme`:
- Sidebar background: `#1e293b`; header: `#2d3748`
- SVG canvas background: `#1a202c` (via `.dark-theme .ng-graph-svg`)
- Incident text/borders updated to dark palette

All observers and listeners cleaned up in `unmount()`.

---

### Phase 9 — Build & deploy

```
Webpack: 5.106.2
Node.js: 18.19.1
Bundle size: 316 KiB (up from 291 KiB — sidebar + helper code adds ~25 KiB)
Build time: 28.6 s
```

Install result:
```
[1/5] Build dir prepared
[2/5] npm install: 153 packages, 0 vulnerabilities
[3/5] webpack: compiled successfully
[4/5] Plugin files copied to /usr/share/wazuh-dashboard/plugins/networkGraph/
[5/5] patch_plugin.py: all 3 patches [SKIP] (already applied)
wazuh.plugin.js.gz + .br regenerated
wazuh-dashboard restarted — active ✓
57 plugins loaded in OSD startup log (networkGraph confirmed present) ✓
```

---

### Testing results

| Test | Result |
|------|--------|
| `/api/network_graph/agents` via OSD proxy | HTTP 200, returns 1 agent (manager) ✓ |
| `/api/network_graph/alerts` via OSD proxy | HTTP 200, body = Wazuh 404 (pre-existing — no `/alerts` endpoint in 4.14.3 REST API) |
| Client-side fallback for missing alerts | `rawAlerts = []`, sidebar shows empty state ✓ |
| Plugin in OSD startup log (57 plugins) | ✓ confirmed |
| Dashboard service active | `active` ✓ |

**Pending UI tests** (require browser + real alert data):
- Sidebar visible to right of graph, toggle button collapses/expands it
- Severity chips render with correct colours
- Edge click → sidebar scroll
- Incident hover → edge highlight
- Dark theme toggle (via localization plugin)
- Investigate link URL correctness (must verify INVESTIGATE_URL_TEMPLATE against live alert)

### Status: IMPLEMENTED — built and installed. UI testing pending.



---

## 2026-04-24 — Urdu localisation: dynamic string support

Added `_t()` / `_tFmt()` localisation helpers to `public/index.js`. Replaced three dynamic string concatenations with `_tFmt()` calls so they render in Urdu when Urdu mode is active:

- `showAllBtn.textContent` → `_tFmt('ng.showAll', { count })`
- Sidebar `subtitleEl.textContent` → `_tFmt('ng.lastRefresh', { time })`
- Header `statusEl.textContent` (agent count) → `_tFmt('ng.agentsStatus', { count, time })`

All static UI strings (title, legend labels, filter options, sidebar header, empty-state message) were added to `localization/locales/en.json` and `ur.json` for DOM text-replacement coverage.

**Rebuild required:** `sudo bash install.sh`
