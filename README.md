# Wazuh FYP — SIEM + PECA Compliance + AI Assistant

## Project Overview

This repository contains everything needed to reproduce a final-year project (FYP) that combines:

1. **Wazuh SIEM** — open-source security information and event management platform (all-in-one deployment: manager, indexer, dashboard).
2. **PECA compliance rules** — custom Wazuh detection rules mapped to sections of Pakistan's Prevention of Electronic Crimes Act (PECA 2016), covering unauthorised access, data tampering, critical infrastructure protection, and malicious code.
3. **AI chatbot assistant** — a natural-language security analyst powered by a large language model (Google Gemini, OpenAI GPT, or AWS Bedrock Claude). The chatbot is embedded directly in the Wazuh Dashboard and can answer questions like "Analyze the most important alerts in my environment" or "List critical CVEs."

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
bash setup.sh
```

The script will:

1. Download and run the official Wazuh 4.14 all-in-one installer.
2. Wait for the Wazuh Indexer to become healthy.
3. Deploy PECA rules to `/var/ossec/etc/rules/`.
4. Create the `mcpserver` system user, Python venv, and install `opensearch-mcp-server-py`.
5. Create the `mcpgateway` system user, Python venv, and install pinned gateway dependencies.
6. Pause at each config file and prompt you to fill in credentials.
7. Install and enable both systemd services.
8. Download the matching OpenSearch Dashboards tarball, extract the two AI-assistant plugins, and install them.
9. Prompt for your gateway IP and apply ML Commons cluster settings.
10. Register a remote ML model and a conversational agent, then set it as the root agent.
11. Print a final summary of all service statuses and connection details.

> **The script is idempotent** for most steps — re-running it will skip steps that are already done (e.g., existing Wazuh install, existing service accounts).

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

## References

- [Wazuh Documentation](https://documentation.wazuh.com/)
- [OpenSearch MCP Server](https://github.com/opensearch-project/opensearch-mcp-server-py)
- [LangChain MCP Adapters](https://github.com/langchain-ai/langchain-mcp-adapters)
- [OpenSearch ML Commons](https://opensearch.org/docs/latest/ml-commons-plugin/)
- [Build a Chatbot with OpenSearch](https://docs.opensearch.org/latest/tutorials/gen-ai/chatbots/build-chatbot/)
- [Model Context Protocol](https://modelcontextprotocol.io/docs/getting-started/intro)
