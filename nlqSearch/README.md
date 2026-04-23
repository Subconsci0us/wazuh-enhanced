# NLQ Search — Natural Language Query Plugin for Wazuh Dashboard

An OpenSearch Dashboards plugin that lets SOC analysts search Wazuh alerts using **plain English** in two ways:

1. **EN toggle on every existing search bar** — an "EN" button appears next to the "DQL" label on all Wazuh module pages (Security Events, GDPR, Malware Detection, etc.). Type English, press Enter, the query is translated and run automatically.
2. **Standalone page** at `/app/nlqSearch` — full-featured interface with editable Sec-IR JSON, raw DSL view, re-transpile, and results table.

---

## EN Toggle on Existing Search Bars

The plugin injects an **EN** button directly next to the "DQL" language selector on every Wazuh module page that uses the standard OSD query bar:

```
[ search input …                         ] [ EN ] [ DQL ] [→]
```

**Usage:**
1. Click **EN** — it turns teal to show NLQ mode is active.
2. Type a plain-English security query in the existing search bar.
3. Press **Enter** — the plugin translates it to DQL behind the scenes and auto-submits.
4. Results appear in the page's existing table as normal.

The **time range** is not overridden — the page's existing time-picker (top-right) is respected.

The translated DQL string is also placed back into the search bar so you can see exactly what was searched.

---

## Standalone Page

The dedicated page at `/app/nlqSearch` (accessible from the Wazuh sidebar) provides a richer interface for power users:
- Full Sec-IR JSON visible and editable
- Raw Wazuh DSL query display
- Re-transpile button (edit IR, regenerate DSL without another LLM call)
- Results table with timestamp, agent, rule description, level, ID, groups

---

## How the Pipeline Works

```
Plain English query
        │
        ▼
Time-range pre-processor (deterministic regex — runs BEFORE the LLM)
        │
        ▼
LLM call (Groq llama-3.3-70b-versatile, Gemini 2.5-flash, or local Ollama model)
        │  produces Sec-IR JSON
        ▼
Schema validator
        │  errors? → self-correction loop (up to 2 retries)
        ▼
Wazuh DSL transpiler (deterministic — no LLM)
        │  produces OpenSearch bool query
        ▼
Wazuh Indexer (wazuh-alerts-*)
        │  returns matching alerts
        ▼
Results table in the dashboard
```

### Sec-IR (Security Intermediate Representation)

The LLM outputs a structured JSON object — not raw DSL. This is the same schema used by the reference `sec-ir` project. It decouples the natural language understanding (LLM) from the query generation (deterministic transpiler).

Example IR for *"Show failed admin logins in the last 24 hours"*:

```json
{
  "sec_ir_version": "1.0",
  "event_type": "authentication_failure",
  "pattern": "single_event",
  "entity": { "user_role": "admin" },
  "severity": "high",
  "time_range": { "type": "relative", "value": "last_24h" },
  "aggregation": null,
  "correlation": null
}
```

---

## Features

| Feature | Description |
|---------|-------------|
| **EN toggle on existing bars** | Injects an EN button next to "DQL" on Security Events, GDPR, Malware, and all other module pages |
| **Auto-translate and run** | Type English → press Enter → DQL is generated and the search runs automatically |
| **Standalone page** | Full-featured `/app/nlqSearch` with IR editor, DSL view, and results table |
| **DSL mode** | Paste raw OpenSearch DSL directly and execute (standalone page) |
| **Editable IR** | Edit the generated Sec-IR JSON and re-transpile without another LLM call |
| **Self-correction** | Up to 2 automatic retry rounds when the LLM output fails schema validation |
| **Time-range detector** | Deterministic regex extracts time windows before the LLM call |
| **Multi-backend** | Groq API (default), Gemini API (cloud), or Ollama (local) — swap with one env var |

---

## Directory Structure

```
nlqSearch/
├── opensearch_dashboards.json    ← OSD plugin manifest
├── package.json                  ← npm metadata (webpack devDeps only)
├── webpack.config.js             ← webpack 5 build config
├── install.sh                    ← build + deploy script (run as root)
├── .env.example                  ← environment variable template
├── README.md                     ← this file
├── server/
│   ├── index.js                  ← OSD server entry point
│   ├── plugin.js                 ← plugin lifecycle class
│   ├── routes/
│   │   └── index.js              ← /translate, /execute, /retranspile routes
│   ├── lib/
│   │   ├── schema.json           ← Sec-IR JSON schema
│   │   ├── validator.js          ← manual schema validator (zero deps)
│   │   └── transpiler.js        ← Wazuh DSL transpiler
│   └── llm_backends/
│       ├── index.js              ← backend factory (picks groq/gemini/ollama)
│       ├── groq.js               ← Groq OpenAI-compatible API client
│       ├── gemini.js             ← Gemini REST API client
│       └── ollama.js             ← Ollama HTTP client
├── public/
│   ├── bundle_entry.js           ← OSD bundle registration
│   └── index.js                  ← full UI (vanilla JS, no React)
└── target/public/
    └── nlqSearch.plugin.js       ← pre-built webpack bundle (ready to install)
```

---

## Installation

### Quick install (recommended)

```bash
cd /path/to/wazuh-fyp-repo/nlqSearch

# Set your Groq API key (recommended) — or Gemini, or skip for Ollama
export GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
# Alternative: export GEMINI_API_KEY=your-key-here

sudo -E bash install.sh
```

The script:
1. Copies sources to `/tmp` (avoids vboxsf restrictions)
2. Installs webpack devDependencies
3. Builds the browser bundle
4. Copies all files to `/usr/share/wazuh-dashboard/plugins/nlqSearch/`
5. Writes your API key to the server `.env` file
6. Fixes file ownership
7. Restarts `wazuh-dashboard`

### Manual install (if install.sh fails)

```bash
# From the nlqSearch directory:
npm install --legacy-peer-deps
npx webpack --config webpack.config.js --mode production

PLUGIN_DIR="/usr/share/wazuh-dashboard/plugins/nlqSearch"
sudo mkdir -p "${PLUGIN_DIR}/target/public" \
              "${PLUGIN_DIR}/server/routes" \
              "${PLUGIN_DIR}/server/lib" \
              "${PLUGIN_DIR}/server/llm_backends"

sudo cp opensearch_dashboards.json package.json "${PLUGIN_DIR}/"
sudo cp server/index.js server/plugin.js "${PLUGIN_DIR}/server/"
sudo cp server/routes/index.js "${PLUGIN_DIR}/server/routes/"
sudo cp server/lib/*.js server/lib/schema.json "${PLUGIN_DIR}/server/lib/"
sudo cp server/llm_backends/*.js "${PLUGIN_DIR}/server/llm_backends/"
sudo cp target/public/nlqSearch.plugin.js "${PLUGIN_DIR}/target/public/"

# Write API key (use Groq, or replace with Gemini vars)
sudo tee "${PLUGIN_DIR}/server/.env" <<EOF
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
GROQ_MODEL=llama-3.3-70b-versatile
NLQ_BACKEND=groq
INDEXER_HOST=localhost
INDEXER_PORT=9200
INDEXER_USER=admin
INDEXER_PASSWORD=your-indexer-password
EOF

sudo chown -R wazuh-dashboard:wazuh-dashboard "${PLUGIN_DIR}"
sudo systemctl restart wazuh-dashboard
```

---

## Configuration

Edit `/usr/share/wazuh-dashboard/plugins/nlqSearch/server/.env` after installation:

| Variable | Default | Description |
|----------|---------|-------------|
| `NLQ_BACKEND` | `groq` | `groq`, `gemini`, or `ollama` |
| `GROQ_API_KEY` | _(required for Groq)_ | Groq API key — get at [console.groq.com/keys](https://console.groq.com/keys) |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model to use (also: `llama-3.1-8b-instant`, `mixtral-8x7b-32768`) |
| `GEMINI_API_KEY` | _(required for Gemini)_ | Google AI Studio API key |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model to use |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `phi3.5` | Ollama model (must be pulled: `ollama pull phi3.5`) |
| `INDEXER_HOST` | `localhost` | Wazuh Indexer host |
| `INDEXER_PORT` | `9200` | Wazuh Indexer port |
| `INDEXER_USER` | `admin` | Indexer username |
| `INDEXER_PASSWORD` | _(required for execute)_ | Indexer admin password |

After changing `.env`, restart the dashboard:
```bash
sudo systemctl restart wazuh-dashboard
```

---

## API Routes

All routes are POST and live under `/api/nlq_search/`.

### `POST /api/nlq_search/translate`

Translates plain English to Sec-IR + Wazuh DSL.

**Request:**
```json
{
  "query": "Show failed logins from 10.0.0.5 in the last 6 hours",
  "backend": "groq"
}
```

**Response (success):**
```json
{
  "ir": { "sec_ir_version": "1.0", "event_type": "authentication_failure", ... },
  "wazuh_query": { "query": { "bool": { "must": [ ... ] } } },
  "correction_rounds": 0
}
```

### `POST /api/nlq_search/execute`

Runs a Wazuh DSL query against the indexer.

**Request:**
```json
{
  "wazuh_query": { "query": { "bool": { "must": [ ... ] } } },
  "index": "wazuh-alerts-*"
}
```

**Response:**
```json
{
  "hits": [ { "_source": { "@timestamp": "...", "rule": {...}, "agent": {...} } } ],
  "total": 42,
  "index": "wazuh-alerts-*"
}
```

### `POST /api/nlq_search/retranspile`

Re-generates Wazuh DSL from an edited IR JSON object (no LLM call).

**Request:**
```json
{ "ir": { "sec_ir_version": "1.0", ... } }
```

---

## Supported Event Types

| event_type | Description |
|------------|-------------|
| `authentication_failure` | Failed logins, auth errors |
| `privilege_escalation` | Windows priv-esc techniques, DCSync, Kerberos |
| `lateral_movement` | SMB relay, pass-the-hash, remote execution |
| `port_scan` | Network reconnaissance |
| `process_injection` | CreateRemoteThread, process hollowing |
| `file_deletion` | FIM delete events |
| `malware_alert` | AV hits, C2 contact, LOLBin abuse |
| `ransomware_behavior` | Shadow copy deletion, mass encryption |
| `policy_violation` | Unauthorized access, compliance breach |
| `data_exfiltration` | Data leaving the environment |

## Patterns

| pattern | Description |
|---------|-------------|
| `single_event` | Any matching event |
| `repeated_attempts` | Same event above a threshold (uses aggregation) |
| `spike` | Anomalously high volume (approximated as threshold) |
| `sequence` | Ordered chain of different events (uses correlation) |
| `absence` | Event did NOT occur (inverted must_not query) |

---

## Switching Backends

### Groq (default — recommended)

```
NLQ_BACKEND=groq
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
GROQ_MODEL=llama-3.3-70b-versatile
```

Get your key at [console.groq.com/keys](https://console.groq.com/keys). Free tier available. Other available models: `llama-3.1-8b-instant` (lower latency), `mixtral-8x7b-32768`, `gemma2-9b-it`.

### Gemini

```
NLQ_BACKEND=gemini
GEMINI_API_KEY=AIzaxxxxxxxxxxxxxxxxx
GEMINI_MODEL=gemini-2.5-flash
```

### Ollama (fully offline, no API key required)

1. Install Ollama: https://ollama.com
2. Pull a model: `ollama pull phi3.5` (or `qwen3:4b`, `mistral`, etc.)
3. Edit `/usr/share/wazuh-dashboard/plugins/nlqSearch/server/.env`:
   ```
   NLQ_BACKEND=ollama
   OLLAMA_HOST=http://localhost:11434
   OLLAMA_MODEL=phi3.5
   ```
4. Restart the dashboard.

After any `.env` change, restart: `sudo systemctl restart wazuh-dashboard`

---

## Logs

```bash
sudo journalctl -u wazuh-dashboard -f | grep nlqSearch
```

---

## DQL String Generation (`irToDQL`)

The EN toggle on existing pages converts Sec-IR to a DQL string (not a JSON body) because the OSD query bar only accepts DQL/Lucene text. The conversion is deterministic and runs entirely in the browser:

| IR field | DQL output |
|----------|-----------|
| `event_type: "authentication_failure"` | `rule.groups: "authentication_failed"` |
| `event_type: "port_scan"` | `(rule.groups: "recon" or rule.groups: "port_scan")` |
| `entity.user: "alice"` | `data.win.eventdata.targetUserName: "alice"` |
| `entity.src_ip: "10.0.0.5"` | `data.srcip: "10.0.0.5"` |
| `entity.host: "server1"` | `agent.name: "server1"` |
| `entity.*: "*"` | *(skipped — wildcard means no filter)* |
| `severity: "high"` | `rule.level >= 10 and rule.level <= 12` |
| `time_range` | *(omitted — existing time-picker handles it)* |

Example — *"Show failed admin logins in the last 24 hours"*:
```
rule.groups: "authentication_failed" and data.win.eventdata.targetUserName: "admin" and rule.level >= 10 and rule.level <= 12
```

---

## Notes on the Injector

- Uses a `MutationObserver` on `document.body` so it works across client-side navigation (OSD is a single-page app — navigating between pages doesn't reload the bundle).
- Uses the React native value-setter trick to update the controlled `<textarea>` in a way React detects: `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, val)` followed by `el.dispatchEvent(new Event('input', { bubbles: true }))`.
- A `window.__nlqProcessing` flag prevents the keydown listener from re-intercepting the simulated Enter event that triggers the actual search.
- Guards (`data-nlq-scanned`, `data-nlq-handler`) prevent duplicate injection on re-renders.

---

## Screenshot

**EN toggle on module pages:**  
The EN button appears immediately to the left of the DQL button on every page that has a query bar (Security Events, GDPR, Malware Detection, Vulnerability, etc.).

**Standalone NLQ Search page (`/app/nlqSearch`):**
- Mode toggle (English | Query Language)
- Search bar with Translate / Run Query buttons
- Collapsible Sec-IR JSON editor (editable, with Re-transpile button)
- Collapsible generated DSL query display + DQL equivalent string
- Results table (timestamp, agent, rule description, level, rule ID, groups)
