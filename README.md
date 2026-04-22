# Wazuh FYP — SIEM + PECA Compliance + AI Assistant + NLQ Search

## Project Overview

This repository contains everything needed to reproduce a final-year project (FYP) that combines:

1. **Wazuh SIEM** — open-source security information and event management platform (all-in-one deployment: manager, indexer, dashboard).
2. **PECA compliance rules** — custom Wazuh detection rules mapped to sections of Pakistan's Prevention of Electronic Crimes Act (PECA 2016), covering unauthorised access, data tampering, critical infrastructure protection, and malicious code.
3. **AI chatbot assistant** — a natural-language security analyst powered by a large language model (Google Gemini, OpenAI GPT, or AWS Bedrock Claude). The chatbot is embedded directly in the Wazuh Dashboard and can answer questions like "Analyze the most important alerts in my environment" or "List critical CVEs."
4. **NLQ Search** — a Wazuh Dashboard plugin that translates plain-English security queries into Wazuh DSL via the Sec-IR intermediate representation pipeline, then executes them directly against the Wazuh Indexer. Supports Gemini API and local Ollama backends.

---

## Architecture

```
Browser (Wazuh Dashboard)
        │  natural-language question
        ▼
Wazuh Indexer — ML Commons HTTP Connector
        │  POST /analyze   (X-API-Key header)
        ▼
MCP-LLM Gateway  (FastAPI + LangChain)  :9912
        │  ▲ LLM calls (Gemini / OpenAI / Bedrock)
        │  │
        │  └── Tool calls via MCP/SSE
        ▼
OpenSearch MCP Server  :9900
        │  OpenSearch queries
        ▼
Wazuh Indexer  :9200  (wazuh-alerts-*, wazuh-states-vulnerabilities-*)
```

### Components

| Component | Description | Port |
|-----------|-------------|------|
| **Wazuh Dashboard** | Web UI with embedded Dashboard Assistant chat plugin. User sends natural-language queries. | 443 (HTTPS) |
| **MCP-LLM Gateway** | FastAPI service. Receives requests from ML Commons, runs a LangChain agent, calls the LLM, and proxies MCP tool calls to the MCP Server. Returns a structured answer. | 9912 |
| **OpenSearch MCP Server** | Python service that exposes Wazuh Indexer capabilities as MCP tools. Executes OpenSearch queries against Wazuh indices and returns structured results. | 9900 |

### How They Connect

1. The user types a question in the Dashboard Assistant chat (top-right chat icon).
2. ML Commons (HTTP connector registered in the Indexer) forwards the request to the MCP-LLM Gateway at `POST /analyze`.
3. The Gateway runs a LangChain agent: it sends the system prompt + user question to the LLM.
4. The LLM decides which MCP tools to call (e.g., search alerts, list CVEs).
5. The Gateway proxies those tool calls to the MCP Server via SSE.
6. The MCP Server queries the Wazuh Indexer and returns results.
7. The LLM analyses the results and generates a concise answer.
8. The Gateway returns the answer to ML Commons, which displays it in the chat UI.

---

## Repository Layout

```
wazuh-fyp-repo/
├── setup.sh                          ← automated setup script (run this)
├── rules/
│   └── peca_rules.xml                ← PECA compliance detection rules
├── ai-assistant/
│   ├── mcp_llm_gateway.py            ← FastAPI + LangChain gateway service
│   ├── mcp-llm-gateway.env.example   ← gateway config template (fill credentials)
│   ├── mcp-llm-gateway.prompt        ← SOC analyst system prompt for the LLM
│   ├── mcp-server.env.example        ← MCP server config template
│   └── services/
│       ├── mcp-server.service        ← systemd unit for MCP Server
│       └── mcp-llm-gateway.service   ← systemd unit for MCP-LLM Gateway
├── networkGraph/
│   ├── README.md                     ← plugin documentation
│   ├── install.sh                    ← build + deploy script (run as root)
│   ├── opensearch_dashboards.json    ← OSD plugin manifest
│   ├── package.json                  ← npm metadata
│   ├── webpack.config.js             ← webpack 5 build config
│   ├── graphTest.jpg                 ← screenshot of the plugin in the browser
│   ├── networkGraph-plugin-log.md    ← full development log
│   ├── public/                       ← browser-side plugin code (D3 graph)
│   ├── server/                       ← OSD server-side plugin (Wazuh API proxy)
│   └── target/public/               ← pre-built webpack bundle (ready to install)
├── nlqSearch/
│   ├── README.md                     ← NLQ Search plugin documentation
│   ├── install.sh                    ← build + deploy script (run as root)
│   ├── opensearch_dashboards.json    ← OSD plugin manifest
│   ├── package.json                  ← npm metadata
│   ├── webpack.config.js             ← webpack 5 build config
│   ├── .env.example                  ← environment variable template (API keys)
│   ├── public/                       ← browser-side plugin code (vanilla JS UI)
│   ├── server/                       ← OSD server-side plugin (LLM proxy + transpiler)
│   │   ├── lib/                      ←   Sec-IR validator + Wazuh DSL transpiler
│   │   └── llm_backends/             ←   Gemini + Ollama backend implementations
│   └── target/public/               ← pre-built webpack bundle (ready to install)
├── complianceView/
│   ├── README.md                     ← plugin documentation + route reference
│   ├── install.sh                    ← build + deploy script (run as root)
│   ├── session-log.md                ← development log (research findings + decisions)
│   ├── opensearch_dashboards.json    ← OSD plugin manifest
│   ├── package.json                  ← npm metadata
│   ├── webpack.config.js             ← webpack 5 build config
│   ├── public/                       ← browser-side plugin code (vanilla JS dashboard)
│   └── server/                       ← OSD server-side plugin (OpenSearch aggregation proxy)
├── nlq-search-log.md                 ← NLQ Search development log
├── setup-log.md                      ← step-by-step log of the original installation
└── README.md                         ← this file
```

---

## Prerequisites

- **OS:** Ubuntu 24.04 LTS or Linux Mint 22 (clean install; no prior Wazuh)
- **User:** regular account with `sudo` privileges
- **Hardware:** minimum 4 vCPU / 8 GB RAM (Wazuh all-in-one + Python services)
- **Network:** internet access for package downloads
- **LLM account:** one of:
  - Google Gemini API key (free tier supported with `gemini-2.5-flash`)
  - OpenAI API key
  - AWS credentials with Bedrock access
- **Ports (must be open between components):**

| Port | Service | Direction |
|------|---------|-----------|
| 443 | Wazuh Dashboard | browser → host |
| 9200 | Wazuh Indexer | internal |
| 9900 | MCP Server | gateway → host |
| 9912 | MCP-LLM Gateway | indexer → host |

---

## How to Run setup.sh

```bash
git clone <this-repo-url>
cd wazuh-fyp-repo
sudo bash setup.sh
```

### Feature Flags

`setup.sh` supports selective installation via flags:

```bash
sudo bash setup.sh                              # install ALL features (default)
sudo bash setup.sh --only networkGraph nlqSearch   # install only these two
sudo bash setup.sh --skip complianceView           # install everything except this
sudo bash setup.sh --list                          # print available features and exit
sudo bash setup.sh --help                          # print usage info and exit
```

#### Available features

| Feature | Description |
|---------|-------------|
| `pecaRules` | Deploy PECA compliance detection rules to Wazuh Manager |
| `aiAssistant` | MCP Server + LLM Gateway + Dashboard AI chat plugins + ML Commons |
| `networkGraph` | Build and install the Network Graph OSD plugin |
| `nlqSearch` | Build and install the NLQ Search OSD plugin |
| `complianceView` | Comparative Compliance View — unified OSD plugin comparing PCI DSS, HIPAA, GDPR, NIST, TSC, PECA |

`--only` and `--skip` are mutually exclusive. Unknown feature names cause an immediate error.

If one feature fails, the script prints the error, marks that feature as **FAILED**, and continues with the remaining features. A summary table at the end shows which features succeeded, failed, or were skipped. The exit code is non-zero if any feature failed.

The wazuh-dashboard service is restarted **once** at the end of all feature installs (not after each individual feature).

### What the script does

1. **Shared setup** — downloads and runs the official Wazuh 4.14 all-in-one installer (skipped if already running), then waits for the Indexer to become healthy.
2. Deploy PECA rules to `/var/ossec/etc/rules/`.
3. Create the `mcpserver` system user, Python venv, and install `opensearch-mcp-server-py`.
4. Create the `mcpgateway` system user, Python venv, and install pinned gateway dependencies.
5. Pause at each config file and prompt you to fill in credentials.
6. Install and enable both systemd services.
7. Download the matching OpenSearch Dashboards tarball, extract the two AI-assistant plugins, and install them.
8. Prompt for your gateway IP and apply ML Commons cluster settings.
10. Register a remote ML model and a conversational agent, then set it as the root agent.
11. Print a final summary of all service statuses and connection details.

> **The script is idempotent** for most steps — re-running it will skip steps that are already done (e.g., existing Wazuh install, existing service accounts).

### Running setup.sh — AI Assistant walkthrough

The `aiAssistant` feature is the most involved because it requires external credentials and pauses twice for you to fill them in. Everything else is fully automated.

#### What to have ready before you run

| Credential | Where to get it |
|------------|-----------------|
| Wazuh Indexer admin password | `tar -xOf wazuh-install-files.tar wazuh-passwords.txt` — `admin` user password |
| LLM API key | Gemini: [aistudio.google.com](https://aistudio.google.com) (free tier) · OpenAI: platform.openai.com · Bedrock: AWS IAM |
| A gateway secret | Any strong string you invent (e.g. output of `openssl rand -hex 32`) — used to authenticate calls from OpenSearch to the gateway |

#### What happens when you run `sudo bash setup.sh`

1. **Wazuh install check** — detects existing installation, skips the installer if Wazuh is already running.
2. **PECA rules** — copies `peca_rules.xml` to `/var/ossec/etc/rules/`, sets correct ownership, restarts the manager.
3. **MCP Server setup** — creates a Python venv, installs `opensearch-mcp-server-py`, writes the service file.

   **Pause 1** — the script opens `/etc/mcp-server/mcp-server.env` for you to fill in:
   ```
   OPENSEARCH_URL=https://127.0.0.1:9200
   OPENSEARCH_USERNAME=admin
   OPENSEARCH_PASSWORD=<password from wazuh-passwords.txt>
   OPENSEARCH_SSL_VERIFY=false
   ```
   Save and press Enter to continue.

4. **MCP-LLM Gateway setup** — creates a second Python venv, installs pinned LangChain + FastAPI dependencies.

   **Pause 2** — the script opens `/etc/mcp-llm-gateway/mcp-llm-gateway.env` for you to fill in:
   ```
   # Choose one provider:
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=<your-key>
   GEMINI_MODEL=gemini-2.5-flash

   # Internal authentication — any secret string you choose:
   GATEWAY_API_KEY=<your-gateway-secret>

   # MCP Server SSE endpoint (same host, default port):
   MCP_SSE_URL=http://127.0.0.1:9900/sse
   ```
   Save and press Enter to continue.

5. **Dashboard plugins** — downloads the official OpenSearch Dashboards tarball for your OSD version, extracts `assistantDashboards` and `mlCommonsDashboards` plugins, installs them.
6. **ML Commons settings** — prompts for the gateway IP (just press Enter to use the machine's own IP), then applies three cluster settings to the Wazuh Indexer.
7. **Model + agent registration** — prompts for the `GATEWAY_API_KEY` you set above, registers a remote ML model pointing at the gateway, deploys it, registers a conversational agent, and sets it as the root chat agent.
8. **Dashboard restart** — restarts `wazuh-dashboard` once to activate all plugins.

#### How the API key is handled

Your LLM API key is stored only in `/etc/mcp-llm-gateway/mcp-llm-gateway.env` on the server, readable only by the `mcpgateway` system user (mode 640, `root:mcpgateway`). It never touches the dashboard or the browser.

The call chain at runtime is:

```
Browser → Wazuh Dashboard → OpenSearch ML Commons
    → POST /analyze  (X-API-Key: <GATEWAY_API_KEY>)   ← your internal secret, not your LLM key
    → MCP-LLM Gateway  →  LLM Provider API  (uses LLM key, server-side only)
```

The `GATEWAY_API_KEY` you register in ML Commons is only the internal secret between OpenSearch and the gateway — not your LLM provider key. The LLM key is never sent to the browser or stored in OpenSearch.

#### Verify the AI assistant is working

```bash
# Check all three components are healthy
curl -s http://127.0.0.1:9912/health | python3 -m json.tool

# Expected:
# {
#   "summary": "All components operational.",
#   "status": { "gateway": "ok", "llm": "ok", "mcp": "ok" },
#   "details": { "mcp_tools_count": 11 },
#   "provider": "gemini",
#   "model": "gemini-2.5-flash"
# }
```

Then open `https://<host>/` in a browser, log in, and click the **chat icon** in the top-right corner.

---

## Post-Setup Configuration

### Fill in LLM credentials

Before starting the gateway, edit `/etc/mcp-llm-gateway/mcp-llm-gateway.env`:

```bash
sudo nano /etc/mcp-llm-gateway/mcp-llm-gateway.env
```

Set `LLM_PROVIDER` and the matching API key:

**Gemini (recommended — free tier available):**
```
LLM_PROVIDER="gemini"
GEMINI_API_KEY="your-gemini-api-key"
GEMINI_MODEL="gemini-2.5-flash"
```

**OpenAI:**
```
LLM_PROVIDER="openai"
OPENAI_API_KEY="your-openai-api-key"
OPENAI_MODEL="gpt-4o"
```

**AWS Bedrock (Claude):**
```
LLM_PROVIDER="claude_bedrock"
AWS_REGION="us-east-1"
BEDROCK_MODEL_ID="anthropic.claude-3-sonnet-20240229-v1:0"
```

Also set:
- `GATEWAY_API_KEY` — any secret string (must match the `credential.api_key` in the ML model connector)
- `MCP_SSE_URL` — SSE endpoint of the MCP Server, e.g. `http://127.0.0.1:9900/sse`

Then restart the gateway:
```bash
sudo systemctl restart mcp-llm-gateway
```

### Fill in Wazuh Indexer credentials (MCP Server)

Edit `/etc/mcp-server/mcp-server.env`:

```bash
sudo nano /etc/mcp-server/mcp-server.env
```

Set `OPENSEARCH_URL`, `OPENSEARCH_USERNAME`, and `OPENSEARCH_PASSWORD` (the Wazuh Indexer admin credentials from your `wazuh-install-files.tar`). Example:

```
OPENSEARCH_URL="https://127.0.0.1:9200"
OPENSEARCH_USERNAME="admin"
OPENSEARCH_PASSWORD="your-indexer-password"
OPENSEARCH_SSL_VERIFY="false"
```

Then restart:
```bash
sudo systemctl restart mcp-server
```

### Verify health

```bash
curl -s http://127.0.0.1:9912/health | python3 -m json.tool
```

Expected response when everything is working:
```json
{
  "summary": "All components operational.",
  "status": { "gateway": "ok", "llm": "ok", "mcp": "ok" },
  "details": { "mcp_tools_count": 11 },
  "provider": "gemini",
  "model": "gemini-2.5-flash",
  "mcp_url": "http://127.0.0.1:9900/sse"
}
```

---

## Dashboard Access and Chatbot Usage

1. Open the Wazuh Dashboard in your browser: `https://<your-host-ip>/`
2. Log in with username `admin` and the password from `wazuh-install-files.tar`.
3. Click the **chat icon** in the top-right corner of the dashboard.
4. If the chat icon is not visible, sign out and sign back in.

### Example queries

- `Analyze the most important alerts in my environment`
- `Analyze brute force attack alerts from the last hour`
- `List critical CVEs from the vulnerabilities index`
- `Which endpoints are affected by CVE-2023-47038?`
- `Analyze the alert with rule ID 5710`

---

## PECA Rules Reference

| Rule ID | Level | PECA Section | Description |
|---------|-------|--------------|-------------|
| 100100 | 10 | Sec 3 (Unauthorized Access) | Authentication failure (SSH/PAM) — potential unauthorized access |
| 100101 | 7 | Sec 4/11 (Electronic Forgery / Data) | FIM integrity checksum changed — data modification detected |
| 100102 | 12 | Sec 6/8 (Critical Infrastructure) | FIM change in `/opt/critical_app/data` — critical infrastructure data modified |
| 100103 | 12 | Sec 20 (Malicious Code) | Rootcheck/rootkit detected — malicious code |

Rules are stored in `rules/peca_rules.xml` and deployed to `/var/ossec/etc/rules/` by `setup.sh`.

---

## Wazuh Version Reference

| Item | Value |
|------|-------|
| Wazuh Manager | 4.14.3 (tested) |
| OpenSearch Dashboards | 2.19.4 (tested) |
| MCP Server package | opensearch-mcp-server-py 0.8.0 |
| Gateway: fastapi | 0.128.0 |
| Gateway: langchain | 0.3.27 |
| Gateway: langchain-mcp-adapters | 0.1.9 |
| Gateway: uvicorn | 0.40.0 |
| LLM Provider (tested) | Google Gemini (gemini-2.5-flash) |

---

## Logs

```bash
# MCP Server
sudo tail -f /var/log/mcp_server/mcp-server.log

# MCP-LLM Gateway
sudo tail -f /var/log/mcp_llm_gateway/mcp-llm-gateway.log

# Wazuh Manager
sudo tail -f /var/ossec/logs/ossec.log

# Wazuh Dashboard
sudo journalctl -u wazuh-dashboard -f
```

---

## Switching LLM Provider

Edit `/etc/mcp-llm-gateway/mcp-llm-gateway.env`, set `LLM_PROVIDER` and the matching credential(s), then:

```bash
sudo systemctl restart mcp-llm-gateway
curl -s http://127.0.0.1:9912/health
```

---

## Network Graph Plugin

The **Network Graph** plugin (`networkGraph/`) adds an interactive D3 graph to the Wazuh Dashboard showing agent connectivity and recent alert relationships.

### Install Network Graph

```bash
sudo WAZUH_API_PASSWORD=<wazuh-wui-password> bash networkGraph/install.sh
```

Or via the main installer:

```bash
sudo bash setup.sh --only networkGraph
```

Then set the Wazuh API password if not passed at install time:
```bash
sudo nano /usr/share/wazuh-dashboard/plugins/networkGraph/server/.env
# Set WAZUH_API_PASSWORD=<wazuh-wui password from wazuh-install-files.tar>
sudo systemctl restart wazuh-dashboard
```

Navigate to: `https://<host>/app/networkGraph`

See `networkGraph/README.md` for full documentation.

---

## NLQ Search Plugin

The **NLQ Search** plugin (`nlqSearch/`) adds a dedicated search page to the Wazuh Dashboard sidebar where analysts can query alerts in plain English.

### Pipeline

```
"Show failed admin logins in the last 24 hours"
        │
        ▼  time-range pre-processor (deterministic regex)
        │  [DETECTED TIME WINDOW: use "last_24h" exactly]
        ▼  LLM call (Gemini / Ollama)
{
  "sec_ir_version": "1.0",
  "event_type": "authentication_failure",
  "pattern": "single_event",
  "entity": { "user_role": "admin" },
  "severity": "high",
  "time_range": { "type": "relative", "value": "last_24h" }
}
        │  schema validation + self-correction (up to 2 retries)
        ▼  Wazuh DSL transpiler (deterministic)
{
  "query": {
    "bool": {
      "must": [
        { "terms": { "rule.groups": ["authentication_failed"] } },
        { "match": { "data.win.eventdata.targetUserName": "admin" } },
        { "range": { "@timestamp": { "gte": "now-24h", "lte": "now" } } },
        { "range": { "rule.level": { "gte": 10, "lte": 12 } } }
      ]
    }
  }
}
        ▼  executed against wazuh-alerts-* (Wazuh Indexer :9200)
        ▼  results table in browser
```

### Install NLQ Search

```bash
cd nlqSearch
export GEMINI_API_KEY=your-key-here
sudo -E bash install.sh
```

Then fill in the Wazuh Indexer password:
```bash
sudo nano /usr/share/wazuh-dashboard/plugins/nlqSearch/server/.env
# Set INDEXER_PASSWORD=<password from wazuh-install-files.tar>
sudo systemctl restart wazuh-dashboard
```

> The password is in `wazuh-passwords.txt` inside `wazuh-install-files.tar` — look for the `admin` user entry.

Navigate to: `https://<host>/app/nlqSearch`

### Example queries

- `Show failed admin logins in the last 24 hours`
- `Find accounts with more than 5 login failures from the same IP`
- `Detect when vssadmin deletes shadow copies on any host`
- `Alert when a host contacts known C2 domains in the last 6 hours`
- `Find a failed login followed by privilege escalation within 10 minutes`

See `nlqSearch/README.md` for full documentation.

---

## Compliance View Plugin

The **Compliance View** plugin (`complianceView/`) adds a standalone page to the Wazuh Dashboard sidebar showing a unified cross-framework compliance dashboard.

### What it shows

1. **Framework Summary Row** — one card per framework (PCI DSS, HIPAA, GDPR, NIST 800-53, TSC, PECA) with total alert count and a colour-coded status indicator (green / yellow / red).

2. **Comparative Requirements Table** — all compliance clauses/sections from all frameworks in one sortable, filterable table. Columns: Framework · Section · Description · Alert Count · Severity Breakdown · Last Alert.

3. **Cross-Framework Overlap Matrix** — heatmap showing how many alerts triggered violations in two frameworks simultaneously. Helps analysts identify incidents with cross-regulatory impact.

### Install Compliance View

```bash
cd complianceView
sudo OS_PASSWORD=<admin-password> bash install.sh
```

Or via the main installer:

```bash
sudo bash setup.sh --only complianceView
```

Then set the Wazuh Indexer password if not passed at install time:
```bash
sudo nano /usr/share/wazuh-dashboard/plugins/complianceView/server/.env
# Set OS_PASSWORD=<password from wazuh-install-files.tar>
sudo systemctl restart wazuh-dashboard
```

Navigate to: `https://<host>/app/complianceView`

The plugin appears in the Wazuh sidebar as **Compliance View**.

### API routes

| Route | Description |
|-------|-------------|
| `GET /api/compliance_view/summary?time_range=24h` | Per-framework alert counts |
| `GET /api/compliance_view/details?framework=pci_dss&time_range=24h` | Section-level breakdown |
| `GET /api/compliance_view/overlap?time_range=24h` | Cross-framework co-occurrence matrix |

Supported `time_range` values: `24h` (default), `7d`, `30d`.

See `complianceView/README.md` for full architecture and data source documentation.

---

## Testing the Install Script with Docker

This section explains how to verify `setup.sh` on a clean Wazuh environment using Docker — the same procedure used to validate the script before AWS deployment.

### Prerequisites

- Docker CE and the Compose plugin installed (`sudo apt-get install -y docker-ce docker-compose-plugin` or equivalent)
- At least 3 GB of free RAM (stop other heavy processes first)
- `vm.max_map_count` set to at least 262144: `sudo sysctl -w vm.max_map_count=262144`

### Step 1 — Start a fresh Wazuh Docker stack

```bash
# Download the official Wazuh 4.14.3 single-node compose file
mkdir -p ~/wazuh-docker-test && cd ~/wazuh-docker-test
curl -fsSL -L https://github.com/wazuh/wazuh-docker/archive/refs/tags/v4.14.3.zip -o wazuh-docker.zip
unzip -q wazuh-docker.zip
cd wazuh-docker-4.14.3/single-node

# (Optional) reduce OpenSearch heap for low-memory hosts
sed -i 's/-Xms1g -Xmx1g/-Xms512m -Xmx512m/' docker-compose.yml

# Generate TLS certificates, then start the stack
sudo docker compose -f generate-indexer-certs.yml run --rm generator
sudo docker compose up -d

# Wait ~2.5 minutes, then verify:
curl -sk https://localhost/ -o /dev/null -w "HTTP %{http_code}\n"   # expect 302
```

### Step 2 — Copy the repo into each container

```bash
DASH=$(sudo docker ps --filter "name=dashboard" --format "{{.Names}}")
MANAGER=$(sudo docker ps --filter "name=manager" --format "{{.Names}}")

sudo docker exec -u root "$DASH" bash -c 'rm -rf /tmp/wazuh-fyp-repo'
sudo docker cp /path/to/wazuh-fyp-repo "$DASH":/tmp/wazuh-fyp-repo
sudo docker cp /path/to/wazuh-fyp-repo "$MANAGER":/tmp/wazuh-fyp-repo
```

### Step 3 — Run the install script

```bash
# Dashboard plugins (networkGraph, nlqSearch, complianceView, localization)
sudo docker exec -u root "$DASH" bash \
    /tmp/wazuh-fyp-repo/setup.sh \
    --skip aiAssistant pecaRules \
    --no-restart

# PECA rules (manager container)
sudo docker exec -u root "$MANAGER" bash \
    /tmp/wazuh-fyp-repo/setup.sh \
    --only pecaRules \
    --no-restart

# Restart the dashboard to activate plugins
sudo docker restart "$DASH"
```

> **Why `--skip aiAssistant`?** The `aiAssistant` feature requires LLM API keys, interactive prompts, and systemd services — none of which map cleanly to the Docker multi-container topology. Test it on a native host or AWS with `sudo bash setup.sh --only aiAssistant`.

### Step 4 — Verify

```bash
# All 4 custom plugins should appear in the "Setting up [55] plugins" log line
sudo docker logs "$DASH" 2>&1 | grep "plugins-system" | grep "Setting up" | tail -1

# PECA rule smoke test (expects rule id 100100, groups include 'peca')
sudo docker exec -u root "$MANAGER" bash -c '
echo "**P1**
Apr 21 14:00:00 server sshd[1234]: Failed password for invalid user testuser from 192.168.1.100 port 22 ssh2" | \
    /var/ossec/bin/wazuh-logtest 2>&1 | grep "id:\|groups:"
'
```

Expected output:
```
id: '100100'
groups: ['peca', 'authentication_failed', 'peca_3']
```

### Step 5 — Clean re-test (reproducibility check)

```bash
cd ~/wazuh-docker-test/wazuh-docker-4.14.3/single-node
sudo docker compose down -v    # removes volumes too — complete clean slate
sudo docker compose up -d
# ... repeat Steps 2–4
```

The full test log and all issues found during validation are documented in `docker-test-log.md`.

---

## References

- [Wazuh Documentation](https://documentation.wazuh.com/)
- [OpenSearch MCP Server](https://github.com/opensearch-project/opensearch-mcp-server-py)
- [LangChain MCP Adapters](https://github.com/langchain-ai/langchain-mcp-adapters)
- [OpenSearch ML Commons](https://opensearch.org/docs/latest/ml-commons-plugin/)
- [Build a Chatbot with OpenSearch](https://docs.opensearch.org/latest/tutorials/gen-ai/chatbots/build-chatbot/)
- [Model Context Protocol](https://modelcontextprotocol.io/docs/getting-started/intro)
