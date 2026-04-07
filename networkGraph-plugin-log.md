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
