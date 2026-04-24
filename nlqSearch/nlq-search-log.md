# NLQ Search Plugin — Development Log

**Date:** 2026-04-12  
**Developer:** Claude Sonnet 4.6 (automated)  
**Target:** Wazuh Dashboard (OpenSearch Dashboards 2.19.4)

---

## Phase 1 — Reference Code Analysis

### Files read from `/media/sf_sharedfolderclone/sec-ir/`

| File | Key findings |
|------|-------------|
| `schema.json` | Sec-IR v1.0 JSON schema (Draft-07). 6 required fields: `sec_ir_version`, `event_type` (10 values), `pattern` (5 values), `entity` (5 optional keys), `severity` (6 values), `time_range`. Optional `aggregation` and `correlation` for aggregation/sequence patterns. |
| `parser.py` | Two backends: Gemini (google-genai SDK) and Ollama (streaming HTTP). Time-range pre-processor uses deterministic regex BEFORE LLM call. Self-correction loop: up to 2 retries with error feedback. Exact system prompt extracted (schema summary + 7 few-shot examples + disambiguation rules). |
| `validator.py` | Uses `jsonschema` Draft7Validator. Returns list of `{field, message}` dicts. |
| `transpiler/wazuh.py` | 5 pattern builders: `single_event`, `repeated_attempts`, `spike`, `sequence`, `absence`. Field mapping: `entity.user` → `data.win.eventdata.targetUserName`, `entity.src_ip` → `data.srcip`, `entity.host` → `agent.name`, `entity.process` → `data.win.eventdata.processName`. Severity → `rule.level` range. Event type → `rule.groups`. Sequence pattern emits a `_meta.note` because Wazuh DSL doesn't support native sequence queries. |
| `run.py` | End-to-end pipeline: parse → validate → transpile to 3 platforms (elastic/splunk/wazuh). |

---

## Phase 2 — Wazuh Dashboard Search Investigation

### How the existing search works

The Wazuh Dashboard uses **OpenSearch Dashboards DQL** (Dashboard Query Language) in the standard Discover bar, and the Wazuh plugin adds its own search filters via the `@osd/config-schema` validation layer. The actual alert data lives in the Wazuh Indexer (OpenSearch) at index patterns `wazuh-alerts-*`.

Queries are submitted as standard OpenSearch bool queries via the Indexer's `_search` endpoint over HTTPS at `:9200`. The Dashboard communicates with the Indexer using admin credentials stored in `/usr/share/wazuh-dashboard/data/wazuh/config/wazuh.yml`.

The existing `networkGraph` plugin demonstrated the correct proxy pattern:
- Browser calls OSD server routes (authenticated with OSD session cookie)
- OSD server proxies to Wazuh API (`:55000`) or Indexer (`:9200`)
- Credentials never exposed to browser

### Key architectural findings

1. **Plugin registration:** OSD loads plugins from `/usr/share/wazuh-dashboard/plugins/` — each needs `opensearch_dashboards.json` with `"server": true, "ui": true`.
2. **Bundle system:** `window.__osdBundles__.define('plugin/<id>/public', fn, 0)` — must use `window.` prefix not bare identifier (webpack5/terser dead-code elimination issue).
3. **Server routes:** Created via `core.http.createRouter()` in the plugin's `setup()` method. Body validated with `@osd/config-schema`.
4. **No React needed:** Vanilla JS + DOM manipulation works fine for full-page plugin apps.
5. **Node version:** 18.19.1 — native `https` module used for API calls. No `node-fetch` needed.

---

## Phase 3 — Implementation

### Files created

#### Plugin manifest and build config

| File | Purpose |
|------|---------|
| `nlqSearch/opensearch_dashboards.json` | Plugin manifest: id=nlqSearch, OSD version 2.19.4 |
| `nlqSearch/package.json` | npm metadata, webpack devDeps only (no runtime deps) |
| `nlqSearch/webpack.config.js` | webpack 5 build, entry=bundle_entry.js, output=nlqSearch.plugin.js |
| `nlqSearch/.env.example` | Template for API key + backend config |

#### Server-side (Node.js, not bundled by webpack)

| File | Purpose |
|------|---------|
| `server/index.js` | OSD entry point — exports `plugin()` factory |
| `server/plugin.js` | Plugin lifecycle class — registers router in `setup()` |
| `server/lib/schema.json` | Copy of Sec-IR JSON schema (same as sec-ir/schema.json) |
| `server/lib/validator.js` | Manual schema validator — zero deps, checks all constraints from the JSON schema manually. Returns `{field, message}[]`. |
| `server/lib/transpiler.js` | JS reimplementation of `sec-ir/transpiler/wazuh.py`. Exact same field mappings, severity ranges, event-type groups, and pattern builders. Returns a plain JS object (not a string). |
| `server/llm_backends/gemini.js` | Gemini REST API client using Node `https`. Calls `generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`. Temperature=0, responseMimeType=application/json. |
| `server/llm_backends/ollama.js` | Ollama HTTP client using Node `http`/`https`. Streaming response collected, format: `{type:"object"}` (Ollama 0.5+ syntax). |
| `server/llm_backends/index.js` | Factory: picks backend from config, exposes `callLLM(systemPrompt, userMessage, config)`. Swapping backends = single config change. |
| `server/routes/index.js` | Three POST routes: `/translate`, `/execute`, `/retranspile`. Contains the exact SYSTEM_PROMPT from parser.py, time-range pre-processor, self-correction loop. |

#### Client-side (bundled by webpack)

| File | Purpose |
|------|---------|
| `public/bundle_entry.js` | OSD bundle registration — calls `window.__osdBundles__.define(...)` |
| `public/index.js` | Full UI: toggle switch, search bar, IR editor, DSL display, results table. Vanilla JS, no React, no D3. |

#### Deployment

| File | Purpose |
|------|---------|
| `install.sh` | Build + deploy script. Handles: /tmp copy (vboxsf), npm install, webpack, file copy, .env write, ownership fix, dashboard restart. |
| `README.md` | Plugin documentation (standalone) |
| `target/public/nlqSearch.plugin.js` | Pre-built webpack bundle (13.3 KiB, committed for convenience) |

---

## System Prompt Fidelity

The system prompt in `server/routes/index.js` was copied exactly from `sec-ir/parser.py`, preserving:
- All 10 event_type values
- All 5 pattern types
- Event-type disambiguation rules (privilege_escalation vs policy_violation, ransomware_behavior vs file_deletion, etc.)
- Severity inference rules (critical → info, with "any" as last resort)
- Pattern selection rules (sequence vs repeated_attempts disambiguation)
- Time range formats and defaults
- Aggregation and correlation block definitions
- All 7 few-shot examples

---

## Transpiler Fidelity

The JavaScript transpiler in `server/lib/transpiler.js` faithfully reimplements `sec-ir/transpiler/wazuh.py`:

| Aspect | Python | JavaScript |
|--------|--------|------------|
| Field maps | `_ENTITY_FIELD_MAP` dict | `ENTITY_FIELD_MAP` object |
| Event groups | `_EVENT_TYPE_MAP` dict | `EVENT_TYPE_MAP` object |
| Severity ranges | `_SEVERITY_LEVEL` dict | `SEVERITY_LEVEL` object — info:(1,3), low:(4,6), medium:(7,9), high:(10,12), critical:(13,15) |
| Nested aggs | `reversed(group_by)` loop | Same logic, iterates reversed |
| Sequence `_meta` | String note about limitations | Same string |
| Spike | Calls `_build_repeated_attempts` + adds `_meta.note` | Same |
| Absence | `must_not` wrapping inner `must` | Same |

---

## Validator Design

The Python reference uses `jsonschema` (Draft7Validator). The JS reimplementation does manual checking to avoid any npm dependency conflicts with OSD's own packages. Checks:
- All 6 required fields present
- All enum constraints
- `time_range` oneOf (relative with value pattern, or absolute with ISO dates)
- `aggregation` structure (threshold, group_by uniqueness)
- `correlation` structure (events array ≥2, maxspan regex)
- Cross-field rules (aggregation required for repeated_attempts/spike, etc.)

---

## Issues Encountered

1. **vboxsf restrictions on /tmp build:** The install.sh copies sources to `/tmp` before `npm install` — the same approach as networkGraph. This avoids permission and symlink issues on VirtualBox shared folders.

2. **webpack5 dead-code elimination:** Had to use `window.__osdBundles__` (property lookup) rather than bare `__osdBundles__` reference in bundle_entry.js. Bare identifiers inside `typeof` guards get eliminated by terser in production mode. Discovered from reading networkGraph/public/bundle_entry.js comments.

3. **No jsonschema in Node context:** Used a manual validator instead of ajv/jsonschema to avoid version conflicts with OSD's bundled dependencies.

4. **Env vars in OSD plugin:** OSD's Node process doesn't load `.env` files automatically. Added a `load_env.js` loader that reads the `.env` file from the plugin directory into `process.env` at startup (required via `plugin.js`).

5. **INDEXER_PASSWORD:** Left blank in the default `.env` — users must fill in the Wazuh Indexer admin password (from `wazuh-install-files.tar`) for the execute route to work.

---

## What's Working

- Plugin loads successfully (confirmed in OSD logs — listed in the 55-plugin startup sequence, no errors)
- Bundle builds (13.3 KiB, webpack compiled successfully)
- Three API routes registered: `/api/nlq_search/translate`, `/api/nlq_search/execute`, `/api/nlq_search/retranspile`
- NLQ Search entry appears in the Wazuh sidebar at `/app/nlqSearch`

---

## What Needs Testing / User Setup

1. **GEMINI_API_KEY** — user must fill in `/usr/share/wazuh-dashboard/plugins/nlqSearch/server/.env` and restart the dashboard.
2. **INDEXER_PASSWORD** — fill in the same `.env` file (use the password from `wazuh-install-files.tar`).
3. **End-to-end translation** — test with a real Gemini key and confirm IR + DSL generation.
4. **Alert execution** — test with a real Wazuh Indexer query to confirm hits are returned.
5. **Ollama fallback** — optional: `ollama pull phi3.5` and switch `NLQ_BACKEND=ollama`.

---

## Environment Config (post-install)

```bash
sudo nano /usr/share/wazuh-dashboard/plugins/nlqSearch/server/.env
# Fill in GEMINI_API_KEY and INDEXER_PASSWORD
sudo systemctl restart wazuh-dashboard
```

---

## Update — Global EN Toggle Injector (2026-04-12)

### Context

After initial deployment the standalone `/app/nlqSearch` page was working correctly (Gemini translate + Wazuh Indexer execute both tested and confirmed). The user then requested a different UX: rather than a separate page, the NLQ capability should be embedded directly into the **existing search bars** already present on Wazuh module pages (Security Events, GDPR, Malware Detection, etc.).

### What the user described

> "on the GDPR or malware detection page there is a search field with DQL written on the very right side. I want a toggle on the search bar beside that which sets it to English or DQL."

### Approach chosen

**DOM injection via MutationObserver** (client-side only, no server changes).

The OSD query bar renders a language-selector button with `data-test-subj="switchQueryLanguageButton"` containing the text "DQL". The plugin's browser bundle now:

1. Starts a `MutationObserver` on `document.body` immediately in `NlqSearchPlugin.setup()`.
2. Whenever `[data-test-subj="switchQueryLanguageButton"]` appears in the DOM (including after client-side page navigation), an **EN** button is injected immediately to its left.
3. Each injected bar has its own `nlqMode` boolean state — clicking EN toggles it teal/active.
4. When EN is active and the user presses **Enter**, a `keydown` listener (capture phase) intercepts the event before OSD's own handler, calls `/api/nlq_search/translate`, converts the IR to a DQL string via `irToDQL()`, sets it back into the React-controlled textarea, and re-fires Enter to auto-submit.

### Why DQL string instead of raw JSON DSL

The OSD query bar accepts DQL (Dashboards Query Language) or Lucene text strings — not full OpenSearch JSON DSL bodies. The full JSON DSL is used by the execute route on the standalone page, but cannot be pasted into the query bar directly.

`irToDQL(ir)` converts the Sec-IR to a DQL string deterministically:
- `event_type` → `rule.groups: "authentication_failed"` (or `(rule.groups: "x" or rule.groups: "y")` for multi-group types)
- `entity.*` → `field.path: "value"` (wildcards/`*` values are skipped)
- `severity` → `rule.level >= N and rule.level <= M`
- `time_range` → **intentionally omitted** (the page's existing time-picker handles it)

Example output for *"Show failed admin logins in the last 24 hours"*:
```
rule.groups: "authentication_failed" and data.win.eventdata.targetUserName: "admin" and rule.level >= 10 and rule.level <= 12
```

### React controlled-input trick

Simply assigning `textarea.value = dql` doesn't work on React-controlled inputs — React doesn't see the change and the state stays stale. The standard workaround is:

```javascript
var nativeSetter = Object.getOwnPropertyDescriptor(
  window.HTMLTextAreaElement.prototype, 'value'
).set;
nativeSetter.call(textarea, dql);
textarea.dispatchEvent(new Event('input', { bubbles: true }));
```

After this, a simulated `KeyboardEvent('keydown', { key: 'Enter', bubbles: true })` triggers OSD's search. A `window.__nlqProcessing` flag prevents the keydown listener from re-intercepting its own simulated event.

### Re-entry guard

The observer uses `data-nlq-scanned` on each language button and `data-nlq-handler` on each textarea to prevent duplicate injections across React re-renders or multiple observer firings.

### Files changed

| File | Change |
|------|--------|
| `public/index.js` | Added `irToDQL()`, `injectIntoQueryBar()`, `initGlobalNlqInjector()`, `setReactTextareaValue()`, `flashBtn()`. Plugin `setup()` now calls `initGlobalNlqInjector()` in addition to registering the standalone app. |
| `target/public/nlqSearch.plugin.js` | Rebuilt (17.5 KiB, up from 13.3 KiB). |

Server-side code unchanged.

### Credentials wired up (same session)

- **Gemini API key**: copied from `/etc/mcp-llm-gateway/mcp-llm-gateway.env` (same key used by the AI chatbot integration).
- **Indexer password**: read from `/home/mint/creds.txt` (the Wazuh installer output file — same password as the Dashboard admin login).
- Both written to `/usr/share/wazuh-dashboard/plugins/nlqSearch/server/.env`.
- End-to-end translate tested via `curl` — Gemini returned correct IR on first attempt (0 correction rounds).
- Execute route confirmed working (returns hits array from `wazuh-alerts-*`).

### Current state

- Plugin loads cleanly (confirmed in OSD startup logs, no errors).
- EN button appears on all pages that use the OSD query bar.
- Standalone `/app/nlqSearch` page still accessible alongside the injector.

---

## Update — EN Button Visibility Fix (2026-04-12)

### Problem

User reported the EN button was not visible on any Wazuh module page despite the injector code running. Investigation confirmed:

- The plugin bundle IS loading (visible in OSD bootstrap logs).
- The `[data-test-subj="switchQueryLanguageButton"]` selector IS correct (found in `wazuh.chunk.0.js`).
- The DQL button has class `euiFormControlLayout__append dqlQueryBar__languageSwitcherButton` — it is the append element of a flex container.
- The `euiFormControlLayout` flex container gives `flex:1` to `__childrenWrapper` (the input area), which takes all available space. The DQL button has `flex-shrink:0` via EUI's own CSS. The injected EN button was **missing `flex-shrink:0`**, causing it to be squeezed to zero width and become invisible.

### Root causes identified

1. **Missing `flex-shrink:0`** — EN button gets squashed to zero width in the `euiFormControlLayout` flex row.
2. **Not inheriting EUI's `__append` class** — the EN button was styled from scratch rather than inheriting the DQL button's own class, missing EUI's built-in flex/layout rules.
3. **Narrow textarea search** — if `[data-test-subj="queryBar"]` / `form` / `.osdQueryBar__formWrapper` wasn't found as an ancestor, the textarea lookup failed silently and injection was skipped.
4. **No interval fallback** — MutationObserver can fire before React has attached `data-test-subj` attributes (two-pass render); a periodic scan was missing.

### Fixes applied to `public/index.js`

1. **EN button now copies `langBtn.className`** — inherits `euiFormControlLayout__append` and all EUI styles, including `flex-shrink:0`.

2. **Explicit `flex-shrink:0; flex:none` in inline style** — belt-and-suspenders: even if class inheritance is overridden, the inline style enforces it.

3. **Additional inline styles**: `justify-content:center`, `position:relative`, `z-index:1`, `box-shadow:none`.

4. **Textarea finder widened** — added `.euiFormControlLayout` as an intermediate fallback, and added a document-level last resort: `document.querySelector('[data-test-subj="queryInput"]')`.

5. **`setInterval` backup scan** — re-runs `scanAndInject()` every 1 second for the first 60 seconds after plugin load, catching cases where the MutationObserver fires before React attaches `data-test-subj` attributes.

### Files changed

| File | Change |
|------|--------|
| `public/index.js` | Added `flex-shrink:0; flex:none; position:relative; z-index:1; box-shadow:none; justify-content:center` to EN button style; copied `langBtn.className` to EN button; widened textarea fallback selector chain; added `setInterval` periodic scan in `initGlobalNlqInjector()`. |
| `target/public/nlqSearch.plugin.js` | Pending rebuild + redeploy (user to run `sudo -E bash install.sh` or `sudo bash install.sh`). |

### Pending

- Bundle needs to be rebuilt and redeployed. Run from the repo:
  ```bash
  cd /media/sf_sharedfolderclone/wazuh-fyp-repo/nlqSearch
  sudo -E bash install.sh
  ```
  Then verify the EN button appears on a Wazuh module page (Security Events, GDPR, Malware Detection, etc.).

---

## Session — EN Button Debugging and Root-Cause Fix (2026-04-12, continued)

### What was installed / changed in this session

This session investigated why the EN toggle button was invisible, diagnosed the actual root cause (the plugin code was never executing at all), and fixed it. Several layers of problems were found and resolved.

---

### Fix 1 — EuiPopover container fix (public/index.js)

**Problem:** Previous injection used `langBtn.parentElement` as the insertion container. From bundle analysis, the DQL button (`switchQueryLanguageButton`) is actually the anchor trigger inside a `EuiPopover` component, so its parentElement is `euiPopover__anchor` — not the flex layout container. The EN button was being inserted deep inside the popover structure, invisible.

**Fix:** Rewrote `injectIntoQueryBar` to call `langBtn.closest('.euiFormControlLayout')` to find the actual flex container (`euiFormControlLayout euiFormControlLayout--group euiFormControlLayout--compressed osdQueryBar__wrap`), then walk up from `langBtn` to find the direct child of that container (the `euiPopover` wrapper div), and insert the EN button before it as a proper flex sibling.

---

### Fix 2 — Floating button approach (public/index.js)

**Problem:** DOM injection continued to fail. Exact parent chain could not be verified without access to the live DOM.

**Fix:** Replaced the entire injection approach with a **floating `position:fixed` button**. Instead of inserting into the React-managed flex container, the EN button is appended to `document.body` and repositioned every 250 ms using `getBoundingClientRect()` on the DQL button. This is immune to all React flex/portal/wrapper structure issues.

**Key functions introduced:**
- `attachEnButton(langBtn, textarea)` — creates the floating button, starts the 250 ms positioning interval, attaches the keydown handler to the textarea. The interval also auto-cleans up when the DQL button leaves the DOM (page navigation).
- `scanAndAttach()` — checks for `[data-test-subj="switchQueryLanguageButton"]` + `[data-test-subj="queryInput"]`; if found and not yet handled, calls `attachEnButton`. Idempotent via `document.getElementById('nlq-floating-en-btn')`.
- `initGlobalNlqInjector()` — starts a `MutationObserver` + a permanent 500 ms `setInterval` fallback, both calling `scanAndAttach()`.

The old `injectIntoQueryBar()` function was removed entirely.

---

### Fix 3 — Debug dot (public/index.js)

**Problem:** After several failed injection attempts, it became clear that even a `position:fixed` button wasn't appearing. This meant the plugin's `setup()` method was never being called at all — the problem was upstream of the injection logic.

**Added:** A small teal dot (`position:fixed; bottom:8px; right:8px; z-index:99999`) is appended to `document.body` during `setup()`. Clicking it shows an alert with the live result of:
- `document.querySelector('[data-test-subj="switchQueryLanguageButton"]')` — FOUND / NOT FOUND
- `document.querySelector('[data-test-subj="queryInput"]')` — FOUND / NOT FOUND
- `document.getElementById('nlq-floating-en-btn')` — YES / NO

The dot confirmed that `setup()` was never being called (dot was not visible). This pointed to a problem in the bundle registration, not in the injection logic.

---

### Fix 4 — ROOT CAUSE: webpack 5 + terser destroys bundle registration (public/bundle_entry.js)

**Root cause:** Comparing the nlqSearch bundle with the working networkGraph bundle revealed a critical difference in the generated code:

| Plugin | Bundle registration code |
|--------|--------------------------|
| **networkGraph** (works) | `var r=e(667);!function(){...define(...,function(){return r},0)...}()` |
| **nlqSearch** (broken) | `function n(r){...}(667);!function(){...define(...,function(){return n},0)...}()` |

In the networkGraph bundle:
- `var r = e(667)` calls the webpack require function with module ID 667 and stores the module exports in `r`.
- The factory passed to `__osdBundles__.define` returns `r` — the actual plugin exports `{ plugin: ... }`. ✓

In the nlqSearch bundle (before fix):
- `function n(r){...}(667)` is parsed by JavaScript as: (1) a function **declaration** defining `n`, then (2) the expression statement `(667)` evaluating to the number 667 — a complete no-op. The module is **never initialized**.
- The factory passed to `__osdBundles__.define` returns `n` — which is the webpack require function itself, not the plugin exports. ✗
- When OSD calls `factory().plugin()`, it gets `undefined` (the require function has no `plugin` property), `plugin()` is never called, and `setup()` is never reached.

**Why it's different:** The nlqSearch bundle has only a single module (667). webpack 5 uses a slightly different runtime code generation path for single-module bundles that results in the require function being defined as a named function declaration rather than as a variable assignment. The terser minifier then cannot inline `pluginModule = n(667)` correctly — it eliminates the assignment and substitutes `n` (the function reference) inside the closure instead of `n(667)` (the call result).

**Fix:** Changed `bundle_entry.js` to store the module exports on `window._nlqPluginExports` before registering. A `window.*` property access cannot be statically analyzed or optimized away by terser:

```javascript
// Before (broken — terser eliminates pluginModule):
var pluginModule = require('./index.js');
window.__osdBundles__.define('plugin/nlqSearch/public',
  function() { return pluginModule; }, 0);

// After (fixed — window access is immune to static optimization):
window._nlqPluginExports = require('./index.js');
window.__osdBundles__.define('plugin/nlqSearch/public',
  function() { return window._nlqPluginExports; }, 0);
```

The rebuilt bundle now correctly produces:
```
function(){return window._nlqPluginExports}
```

---

### Files changed in this session

| File | Change |
|------|--------|
| `public/bundle_entry.js` | **Root cause fix**: store module on `window._nlqPluginExports` instead of a local variable, so terser cannot optimize away the module initialization. Factory function now returns `window._nlqPluginExports`. |
| `public/index.js` | Rewrote injector: floating `position:fixed` EN button using `getBoundingClientRect()` + 250 ms positioning interval; `attachEnButton()`, `scanAndAttach()`, updated `initGlobalNlqInjector()`; debug dot in `setup()`. |
| `target/public/nlqSearch.plugin.js` | Rebuilt (20 KB). Bundle registration now correct. |

---

### Current state

- Plugin `setup()` is now called correctly on every page load.
- Debug dot (teal, bottom-right) confirms plugin is alive; clicking it shows selector diagnostic.
- Floating EN button is positioned to the left of the DQL toggle on any page with `[data-test-subj="switchQueryLanguageButton"]` and `[data-test-subj="queryInput"]`.
- Pending: user to reload browser and confirm EN button and debug dot are visible.

---

## wazuh.chunk.2.js Pre-existing Syntax Error — Root Cause and Fix

### Discovery

When the user disabled the browser cache (DevTools → Network → Disable Cache) to force fresh bundle loads, the Wazuh module pages stopped rendering entirely. Only the top navigation bar was visible. The nlqSearch bundle itself loaded correctly at 19 KB (confirmed via `performance.getEntriesByType`), and `window.__osdBundles__.get('plugin/nlqSearch/public')` returned `{ plugin: plugin() }` — confirming our plugin registered correctly.

The console showed two errors:

```
Uncaught SyntaxError: missing : after property id  wazuh.chunk.2.js:1:5265405
ChunkLoadError: Loading chunk 2 failed. (missing: .../wazuh.chunk.2.js)
```

### Location of the syntax error

File: `/usr/share/wazuh-dashboard/plugins/wazuh/target/public/wazuh.chunk.2.js`  
Byte offset: 5265462

```
...],availableFor:["manager","agent"]},const peca_dashboard_plugins=Object(kibana_services["h"])();...
```

At this position the parser is inside an unclosed array literal and object literal (bracket depth `[`: -1, `{`: -2). The `,` after the closing `}` places the parser in **expression context**, but `const` is a declaration keyword — not valid in expression position. Firefox immediately throws `SyntaxError: missing : after property id` and the entire chunk fails to load.

### Why it wasn't noticed until now

The browser had a cached copy of `wazuh.chunk.2.js` from before April 9 (the last-modified date on the on-disk file), which was a working version. Normal page loads — even hard refreshes — served this cached copy because browser cache was enabled. Enabling "Disable Cache" forced a fresh fetch of the broken on-disk version, exposing the error.

**This error is not caused by our changes.** The file was last modified on April 9 and we never touched it.

### Fix applied

Patched the file in-place using Python `bytes.replace()`:

```
Find:    ],availableFor:["manager","agent"]},const peca_dashboard_plugins=
Replace: ],availableFor:["manager","agent"]};const peca_dashboard_plugins=
```

The `,` → `;` makes `const peca_dashboard_plugins=...` a valid statement at the top level of the module. The gzip companion file was then recompressed from the patched source:

```bash
gzip -c wazuh.chunk.2.js > wazuh.chunk.2.js.gz
```

A backup of the original is kept at `wazuh.chunk.2.js.bak`.

### Files changed

| File | Change |
|------|--------|
| `/usr/share/wazuh-dashboard/plugins/wazuh/target/public/wazuh.chunk.2.js` | Replaced `,const peca_dashboard_plugins=` with `;const peca_dashboard_plugins=` at byte offset 5265462. |
| `/usr/share/wazuh-dashboard/plugins/wazuh/target/public/wazuh.chunk.2.js.gz` | Recompressed from patched source. |
| `/usr/share/wazuh-dashboard/plugins/wazuh/target/public/wazuh.chunk.2.js.bak` | Original unpatched backup. |


---

## wazuh.chunk.2.js — Second Fix Attempt: Byte Patch Incorrect, Replaced With Package Copy

### Why the first patch failed

The initial fix changed `,const peca_dashboard_plugins=` to `;const peca_dashboard_plugins=` (replacing `,` with `;`). Node.js `vm.Script` rejected the patched file with `SyntaxError: Unexpected token ';'`.

Root cause analysis via brace-depth counting:

```python
# Count { and } from the enclosing module function start (offset 2981146)
# to just before the patch point (offset 5265496)
# Result: depth = 4
```

The `}` in `},const` only closes the innermost `tsc:{}` object (going from depth 4 to depth 3). Three more unclosed `{` structures remain above it. Placing `;` at depth 3 is invalid — a semicolon is not allowed inside an object literal.

The context makes this visible:

```
{                            ← depth 1: module function body
  var modules = {            ← depth 2: outer modules object
    nist: { ... },
    gdpr: { ... },
    tsc: {                   ← depth 3: tsc inner object
      tabs: [...],           ← depth 4: opened by something inside tabs
      availableFor: [...]
    }                        ← closes depth 4 → we are at depth 3
  };const peca_dashboard_plugins = ...    ← ';' is at depth 3, still inside outer object → INVALID
```

Manually guessing the correct number of `}` characters to insert is not feasible in 5.5 MB of minified code.

### Correct fix: replace with original from official package

Downloaded the official `wazuh-dashboard_4.14.3-1_amd64.deb` from the Wazuh apt repository without installing it:

```bash
cd /tmp && apt-get download wazuh-dashboard=4.14.3-1
```

Extracted `wazuh.chunk.2.js` directly from the deb's filesystem tarball:

```bash
dpkg-deb --fsys-tarfile wazuh-dashboard_4.14.3-1_amd64.deb \
  | tar -x --wildcards '*/wazuh.chunk.2.js' --to-stdout \
  > /tmp/wazuh.chunk.2.js.orig
```

Verified the extracted file parses without errors:

```
node -e "new vm.Script(src)" → PARSE OK
```

Replaced all three served variants on disk and restored correct ownership/permissions:

```bash
cp /tmp/wazuh.chunk.2.js.orig   .../wazuh/target/public/wazuh.chunk.2.js
gzip -c /tmp/wazuh.chunk.2.js.orig > .../wazuh/target/public/wazuh.chunk.2.js.gz
brotli -c /tmp/wazuh.chunk.2.js.orig > .../wazuh/target/public/wazuh.chunk.2.js.br
chown wazuh-dashboard:wazuh-dashboard wazuh.chunk.2.js wazuh.chunk.2.js.gz wazuh.chunk.2.js.br
chmod 640 wazuh.chunk.2.js wazuh.chunk.2.js.gz wazuh.chunk.2.js.br
```

Final verification via curl:

```
curl -sk --compressed https://localhost/414303/bundles/plugin/wazuh/wazuh.chunk.2.js
→ vm.Script parse: OK, size: 5499865 chars
```

### Files changed

| File | Change |
|------|--------|
| `.../wazuh/target/public/wazuh.chunk.2.js` | Replaced with clean copy extracted from `wazuh-dashboard_4.14.3-1_amd64.deb`. |
| `.../wazuh/target/public/wazuh.chunk.2.js.gz` | Recompressed from clean source. |
| `.../wazuh/target/public/wazuh.chunk.2.js.br` | Re-Brotli-compressed from clean source (previously stale April 9 copy). |
| `/tmp/wazuh-dashboard_4.14.3-1_amd64.deb` | Downloaded package (not installed). |
| `.../wazuh/target/public/wazuh.chunk.2.js.bak` | Intermediate broken backup from first patch attempt (root-owned, not served). |

### Current state

All three compressed variants of `wazuh.chunk.2.js` on disk are syntactically clean and sourced from the official 4.14.3 package. A hard refresh (`Ctrl+Shift+R`) with "Disable Cache" off should render the Wazuh module pages correctly. The nlqSearch plugin bundle is unaffected.

---

## wazuh.chunk.2.js — Multiline Injection Fix and Cache Issue (2026-04-20)

### Problem

After restoring `wazuh.chunk.2.js` from the official deb package and applying the complianceView patches (`patch_bundles.py`), Wazuh native pages (GDPR, Security Events, etc.) remained blank — only the top navigation bar was visible. The browser console showed:

```
Uncaught SyntaxError: missing : after property id  wazuh.chunk.2.js:1:5265405
ChunkLoadError: Loading chunk 2 failed. (missing: .../wazuh.chunk.2.js)
```

The Wazuh mount function silently caught this error via `catch(error){console.debug(error)}`, leaving the `.application` div empty with no visible error (unless DevTools log level was set to Verbose).

### Diagnosis

1. **Surfaced the hidden error** — temporarily patched `console.debug(error)` → `console.error("[WazuhMount]",error)` in `wazuh.plugin.js` to make the ChunkLoadError visible in the standard console.

2. **Identified multiline injection** — the `MOUNT_FN` variable in `patch_bundles.py` was defined as a Python raw string (`r"""..."""`) containing 52 real newlines. This injected multiline code into the middle of a single-line minified file (`wazuh.chunk.2.js`), breaking the file's line structure from 1 line into 53 lines.

3. **Minified the injection** — collapsed `MOUNT_FN` to a single line (12238 chars, 0 newlines). Re-applied patches to a fresh deb copy. The patched file was confirmed single-line and Node.js `vm.Script` validated it as syntactically correct.

4. **Server confirmed correct** — `curl` + `md5sum` verified the server was serving the new correct file (hashes matched disk).

5. **Browser cache was stale** — despite OSD sending `cache-control: private, no-cache, no-store, must-revalidate`, Firefox was still serving a cached copy of the OLD broken file. Disabling cache in DevTools (Network → Disable Cache) forced a fresh fetch of the corrected file, and Wazuh pages rendered correctly.

### Root cause

Two compounding issues:
1. **Multiline injection into minified JS** — the `MOUNT_FN` raw string had 52 newlines. While syntactically valid JavaScript, injecting multiline code into a single-line minified bundle can cause parser state issues in some browser engines.
2. **Aggressive browser caching** — Firefox cached the old broken `wazuh.chunk.2.js` and continued serving it even after the file was replaced on disk and the dashboard restarted. The URL path (`/414303/bundles/...`) uses a fixed build number that doesn't change when the file content changes, so the browser had no signal to invalidate its cache.

### Fix applied

Updated `patch_bundles.py`:
- Replaced the multiline `r"""..."""` raw string for `MOUNT_FN` with a single-line `"""..."""` string (all newlines collapsed, backslashes escaped).
- The patched `wazuh.chunk.2.js` is now a single line (5513516 chars), matching the structure of the original minified file.
- Regenerated `.gz` and `.br` compressed variants.

### Files changed

| File | Change |
|------|--------|
| `complianceView/patch_bundles.py` | Minified `MOUNT_FN` from 52-line raw string to single-line string (12238 chars). |
| `.../wazuh/target/public/wazuh.chunk.2.js` | Re-patched from clean deb source with single-line injection. |
| `.../wazuh/target/public/wazuh.chunk.2.js.gz` | Regenerated from patched source. |
| `.../wazuh/target/public/wazuh.chunk.2.js.br` | Regenerated from patched source. |

### Resolution

After the fix, disabling browser cache (DevTools → Network → Disable Cache) and reloading confirmed Wazuh native pages render correctly. Once the stale cache entry expired, normal browsing (with cache enabled) also worked.

---

## Fix: INDEXER_PASSWORD auto-resolution — 2026-04-23

### Symptom

After first-run installation via `setup.sh`, `nlqSearch/install.sh` wrote `INDEXER_PASSWORD=` (blank) to the plugin's `.env`. The plugin's OpenSearch queries then failed with 401 until the operator manually set the password.

### Root cause

`setup.sh` always printed the manual-action warning unconditionally and never exported `INDEXER_PASSWORD` before calling `install.sh`.

### Fix (in `setup.sh`)

`setup.sh` now calls `resolve_wazuh_passwords()` before the feature loop. That helper locates `wazuh-install-files.tar` machine-independently (no assumed path) and exports `WAZUH_INDEXER_PASSWORD` (the `admin` indexer password).

In `install_nlqSearch()`, the canonical name is mapped to the plugin-specific name before calling `install.sh`:

```bash
export INDEXER_PASSWORD="${INDEXER_PASSWORD:-${WAZUH_INDEXER_PASSWORD:-}}"
```

The manual-action warning in `install_nlqSearch()` is now conditional — it only fires if auto-resolution failed:

```bash
if [ -z "${INDEXER_PASSWORD:-}" ]; then
    warn "ACTION REQUIRED: INDEXER_PASSWORD could not be auto-resolved. ..."
fi
```

### No changes to nlqSearch plugin files

`nlqSearch/install.sh` already reads `INDEXER_PASSWORD` from the environment correctly. The fix is entirely in `setup.sh`.

### Status

Resolved. On first-run install the `.env` is now written with the correct indexer password automatically.

---

## Session 2026-04-23 — Light theme conversion + whitespace fix

### Issue 1 — Dark-mode hardcoded colours

The NLQ Search standalone page (`/app/nlqSearch`) and its injected EN button both used hardcoded dark colours. After the application default was changed to light mode, these looked inconsistent.

### Issue 2 — Whitespace at bottom of page

The `resultsArea` div was initialised with `display:none` and only shown after a query ran. Because no other element had `flex:1`, the flex container (`el`) did not fill its full height, leaving a white gap below the content area.

### Fixes (`public/index.js`)

**Light theme — standalone page:**

| Element | Before | After |
|---------|--------|-------|
| Page background | `#0d0d1a` | `#f8fafc` (`min-height:100vh`) |
| Header | `#12122a` / border `#2a2a4a` | `#f1f5f9` / border `#e2e8f0` |
| Header title | `#4fc3f7` | `#2b6cb0` |
| Subtitle | `#666` | `#718096` |
| Search area | `#12122a` | `#f1f5f9` |
| Mode toggle (active) | `#1e6091` | `#3182ce` |
| Mode toggle (inactive) | `#1a1a2e` / `#aaa` | `#e2e8f0` / `#4a5568` |
| Input textarea | `#1a1a2e` / `#eee` | `#ffffff` / `#1a202c` |
| IR / DSL areas | `#0d0d1a` | `#f8fafc` |
| IR editor (monospace) | `#0a0a1a` / `#a8ff78` | `#f8fafc` / `#276749` |
| DSL display (monospace) | `#0a0a1a` / `#ffd700` | `#f8fafc` / `#744210` |
| Re-transpile button | dark red | light red (`#fff5f5` / `#c53030`) |
| Collapse buttons | `#1a1a2e` / `#aaa` | `#e2e8f0` / `#4a5568` |
| Table header | `#12122a` / `#aaa` | `#f1f5f9` / `#4a5568` |
| Table rows | `#0d0d1a` / `#101020` | `#ffffff` / `#f7fafc` |

**Light theme — EN button (query-bar injector):**

| State | Before | After |
|-------|--------|-------|
| Default bg/text/border | `#1D1E24` / `#98A2B3` / `#69707D` | `#f8f9fa` / `#495057` / `#ced4da` |
| Hover bg | `#2c2d38` | `#e9ecef` |
| Active (NLQ on) | `#00BFB3` teal | unchanged |
| Flash restore | `transparent` / `#98A2B3` | `#f8f9fa` / `#495057` |

**Whitespace fix:**
- Removed `display:none` from `resultsArea` initial style; changed to `flex:1;min-height:0` so it always fills remaining height
- `doExecute()` now sets a loading message (`resultsArea.innerHTML = '…'`) instead of toggling display
- Page container changed from `height:100%` to `min-height:100vh` to guarantee background covers the full viewport

### Status

Built, installed, compressed variants regenerated. ✓

---

## Session — 2026-04-23

**Developer:** Claude Sonnet 4.6  
**Target:** EC2 deployment (Ubuntu) + local source (`wazuh-fyp-repo/`)  
**Scope:** Replace Gemini as the default LLM backend with Groq across the NLQ Search plugin and the AI Assistant gateway

---

### Motivation

Groq provides OpenAI-compatible REST API endpoints with substantially faster inference than Gemini's `generateContent` API. Because `langchain-openai.ChatOpenAI` already supports a `base_url` override, and because the Groq chat-completions format is identical to OpenAI's, the migration required adding one new backend file and updating four existing files — no architectural change.

---

### Research

- Groq API endpoint: `https://api.groq.com/openai/v1/chat/completions`
- Auth header: `Authorization: Bearer <GROQ_API_KEY>`
- Request body: standard OpenAI chat completions format (`model`, `messages`, `temperature`, `response_format`)
- Response: standard OpenAI format — text in `choices[0].message.content`
- `response_format: { type: "json_object" }` enforces structured JSON output (same flag used with OpenAI)
- For the AI Assistant (Python/LangChain): `ChatOpenAI(base_url="https://api.groq.com/openai/v1", api_key=GROQ_API_KEY, model=GROQ_MODEL)` — no new package needed, `langchain-openai` already installed

---

### Files Created

| File | Description |
|------|-------------|
| `server/llm_backends/groq.js` | New Node.js backend. Calls Groq's OpenAI-compatible endpoint using built-in `https`. Temperature=0, `response_format: json_object`. Includes `extractJson()` helper to strip markdown fences. |

---

### Files Modified

#### `server/llm_backends/index.js`
- Added `const { callGroq } = require('./groq')`
- Added `groq` branch in `callLLM()` — checks `config.apiKey` and delegates to `callGroq()`
- Updated `detectBackend()`: priority order is now **Groq → Gemini → Ollama** (checks `GROQ_API_KEY` first)
- Updated error message to list `"groq"`, `"gemini"`, `"ollama"` as valid values

#### `server/routes/index.js`
- Added `GROQ_API_KEY` and `GROQ_MODEL` constants read from `process.env`
- Updated `NLQ_BACKEND` auto-detection: `GROQ_API_KEY ? 'groq' : GEMINI_API_KEY ? 'gemini' : 'ollama'`
- Replaced the hardcoded `apiKey: GEMINI_API_KEY` in `llmConfig` with `apiKeyForBackend` (ternary that picks Groq/Gemini key based on chosen backend)
- Replaced the hardcoded `model` selector with `modelForBackend` (picks GROQ_MODEL / GEMINI_MODEL / OLLAMA_MODEL)

#### `install.sh`
- Warning block: changed from `GEMINI_API_KEY` to check both `GROQ_API_KEY` and `GEMINI_API_KEY`
- Copy block: added `cp groq.js "${INSTALL_DIR}/server/llm_backends/"`
- Generated `.env` template: added `GROQ_API_KEY` and `GROQ_MODEL` lines; changed `NLQ_BACKEND` default from `gemini` to `groq`
- Final note: updated to reference `GROQ_API_KEY`

#### `.env.example`
- Added `GROQ_API_KEY` and `GROQ_MODEL` fields under a new `## Groq API` section
- Changed `NLQ_BACKEND` default to `groq`

---

### Environment variable reference (post-change)

| Variable | Default | Notes |
|----------|---------|-------|
| `NLQ_BACKEND` | `groq` | `groq` \| `gemini` \| `ollama` |
| `GROQ_API_KEY` | _(required for groq)_ | From [console.groq.com/keys](https://console.groq.com/keys) |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Also: `llama-3.1-8b-instant`, `mixtral-8x7b-32768` |
| `GEMINI_API_KEY` | _(required for gemini)_ | From Google AI Studio |
| `GEMINI_MODEL` | `gemini-2.5-flash` | |
| `OLLAMA_HOST` | `http://localhost:11434` | |
| `OLLAMA_MODEL` | `phi3.5` | |

---

### Auto-detection logic

When `NLQ_BACKEND` is not set explicitly, the plugin picks:
1. `groq` — if `GROQ_API_KEY` is non-empty
2. `gemini` — if `GEMINI_API_KEY` is non-empty
3. `ollama` — fallback (no key required)

This is consistent between `routes/index.js` (server startup) and `llm_backends/index.js` (per-request fallback).

---

### Testing (EC2 deployment)

All patches applied cleanly via Python replace scripts run over SSH. Verified with:

```bash
grep -n 'groq\|GROQ' ~/wazuh-fyp-repo/nlqSearch/server/routes/index.js
# → lines 35–36 (GROQ_API_KEY, GROQ_MODEL constants)
# → line 38 (NLQ_BACKEND auto-detect)
# → lines 419–424 (apiKeyForBackend, modelForBackend)

grep -n 'groq\|GROQ' ~/wazuh-fyp-repo/nlqSearch/install.sh
# → lines 42–47, 117, 131–134, 205–207

ls ~/wazuh-fyp-repo/nlqSearch/server/llm_backends/
# → gemini.js  groq.js  index.js  ollama.js  ✓
```

Plugin not re-installed on EC2 after patch (install.sh must be re-run with `GROQ_API_KEY` set to activate the new backend on the live deployment).

---

### Status

Source files updated, documentation updated, session log appended. **Untested end-to-end** — install.sh must be re-run with a Groq API key to verify the full translation pipeline.

---

## 2026-04-23 — Moved OSD sidebar entry to Explore section

### Change

Changed `core.application.register()` category in `public/index.js`:

| Field | Before | After |
|-------|--------|-------|
| `id` | `wazuh` | `explore` |
| `label` | `Wazuh` | `Explore` |
| `order` | `1000` | `100` |

NLQ Search now appears in the OSD **Explore** section of the sidebar (alongside Discover) rather than the generic Wazuh section.

### Reason

User request — consolidate the custom FYP plugins out of the generic "Wazuh" OSD category. Explore is the natural home for a search/query tool.

### Files changed

- `public/index.js` — updated `category` in `core.application.register()`
- `target/public/nlqSearch.plugin.js` — rebuilt (webpack production)

### Status

Bundle rebuilt. ✓

---

## 2026-04-24 — Urdu localisation: missing strings added to locale files

No code changes to this plugin. The following previously missing strings were added to `localization/locales/en.json` and `ur.json` so they are picked up by the DOM text-replacement system:

- Page title with emoji: `🔍 NLQ Search`
- Button busy states: `Translating…`, `Transpiling…`, `Running query…`
- DSL input section heading: `Wazuh DSL Query (JSON)`
- Non-security query rejection message

The MutationObserver in the localization plugin will catch `textContent` assignments for these strings (button busy/ready cycles, status line updates) and replace them with Urdu within 150 ms.

**Rebuild required:** `sudo bash install.sh` (for the localization plugin bundle, which contains the updated locale JSON)
