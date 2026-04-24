# AI Assistant (MCP-LLM Gateway) — Development Log

---

## Session — 2026-04-23

**Developer:** Claude Sonnet 4.6  
**Target:** EC2 deployment (Ubuntu) + local source (`wazuh-fyp-repo/`)  
**Scope:** Add Groq as a supported LLM provider in `mcp_llm_gateway.py`

---

### Component Overview

The AI Assistant consists of two Python services running on the same host:

| Service | File | Port | Description |
|---------|------|------|-------------|
| **OpenSearch MCP Server** | `opensearch-mcp-server-py` (pip package) | 9900 | Exposes Wazuh Indexer (OpenSearch) queries as MCP tools over SSE |
| **MCP-LLM Gateway** | `ai-assistant/mcp_llm_gateway.py` | 9912 | FastAPI + LangChain agent. Receives requests from ML Commons, calls MCP tools, calls LLM, returns answer |

The gateway is the only file that needs updating when switching LLM providers. The MCP Server is provider-agnostic.

---

### Motivation for Adding Groq

Groq's inference API is OpenAI-compatible (same endpoint format, same `langchain-openai.ChatOpenAI` client). Adding it requires:
- One new `elif LLM_PROVIDER == "groq"` branch in `_build_llm()`
- Two new environment variable constants (`GROQ_API_KEY`, `GROQ_MODEL`)
- No new pip dependencies — `langchain-openai` is already installed

Groq provides significantly faster inference than Gemini or GPT-4o for the same workload, making it well-suited for real-time SOC alert analysis.

---

### Files Modified

#### `mcp_llm_gateway.py`

**Patch 1 — New env constants** (after `OPENAI_MODEL` line):
```python
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL   = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
```

**Patch 2 — New provider branch in `_build_llm()`** (inserted before the `gemini` branch):
```python
elif LLM_PROVIDER == "groq":
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY required for Groq provider.")
    return ChatOpenAI(
        model=GROQ_MODEL,
        temperature=0,
        base_url="https://api.groq.com/openai/v1",
        api_key=GROQ_API_KEY,
    )
```

Uses `langchain_openai.ChatOpenAI` with Groq's OpenAI-compatible base URL. No additional SDK required.

**Patch 3 — Error message update**:
```python
raise RuntimeError(
    f"Unsupported LLM_PROVIDER: {LLM_PROVIDER}. "
    f"Use groq, openai, gemini, or claude_bedrock."
)
```

**Patch 4 — Health endpoint model reporting**:
Updated the `"model"` field in `GET /health` to include the Groq model name when `LLM_PROVIDER == "groq"`.

#### `mcp-llm-gateway.env.example`

- Changed default `LLM_PROVIDER` from `gemini` to `groq`
- Added `GROQ_API_KEY` and `GROQ_MODEL` fields under a new `## Groq` section
- Kept all existing provider sections (OpenAI, Gemini, Bedrock) unchanged

---

### Supported providers after this change

| `LLM_PROVIDER` value | Key variable | Notes |
|----------------------|-------------|-------|
| `groq` | `GROQ_API_KEY` | OpenAI-compatible, fastest inference, free tier at [console.groq.com](https://console.groq.com/keys) |
| `openai` | `OPENAI_API_KEY` | Standard OpenAI GPT models |
| `gemini` | `GEMINI_API_KEY` | Uses OpenAI-compat layer (`/v1beta/openai/`) |
| `claude_bedrock` | AWS credentials | Requires `langchain-aws`, AWS IAM role |

---

### Configuration

After installation, edit `/etc/mcp-llm-gateway/mcp-llm-gateway.env`:

```bash
LLM_PROVIDER="groq"
GROQ_API_KEY="gsk_xxxxxxxxxxxxxxxxxxxx"
GROQ_MODEL="llama-3.3-70b-versatile"
GATEWAY_API_KEY="your-internal-secret"
MCP_SSE_URL="http://127.0.0.1:9900/sse"
```

Then restart: `sudo systemctl restart mcp-llm-gateway`

Verify with: `curl -s http://127.0.0.1:9912/health | python3 -m json.tool`

Expected response:
```json
{
  "summary": "All components operational.",
  "status": { "gateway": "ok", "llm": "ok", "mcp": "ok" },
  "provider": "groq",
  "model": "llama-3.3-70b-versatile"
}
```

---

### Available Groq models (as of 2026-04)

| Model | Context | Speed | Notes |
|-------|---------|-------|-------|
| `llama-3.3-70b-versatile` | 128k | Fast | Default — best balance of quality and speed |
| `llama-3.1-8b-instant` | 128k | Very fast | Lower quality, good for high-frequency queries |
| `mixtral-8x7b-32768` | 32k | Fast | Strong at instruction following |
| `gemma2-9b-it` | 8k | Fast | Lightweight |

---

### setup.sh changes

Updated `install_aiAssistant()` in `setup.sh`:
- The Pause 2 warning now lists Groq as the recommended provider with example config
- The copied `mcp-llm-gateway.env.example` already defaults to `LLM_PROVIDER=groq`

---

### Testing

Patches applied via Python replace scripts over SSH. All 4 patches confirmed applied with grep verification. Service not restarted on EC2 after patching — requires `GROQ_API_KEY` to be set in `/etc/mcp-llm-gateway/mcp-llm-gateway.env` before the gateway will start successfully with the Groq backend.

### Status

Source files updated, documentation updated. **Untested end-to-end** — gateway must be restarted with a Groq API key to verify live operation.

---

## Session — 2026-04-24

**Developer:** Claude Sonnet 4.6
**Scope:** (1) Add Groq API key to env files; (2) Research how to add a custom file-reading MCP tool

---

### Part 1 — API Keys Added to Env Files

#### What changed

Three files updated, one new file created:

| File | Change |
|------|--------|
| `nlqSearch/.env.example` | `NLQ_BACKEND` changed `groq→gemini`; `GROQ_API_KEY` filled in; `GEMINI_API_KEY` filled in |
| `nlqSearch/.env` | **New** — sourced directly by `nlqSearch/install.sh` at build time; sets all keys and `NLQ_BACKEND=gemini` |
| `ai-assistant/mcp-llm-gateway.env.example` | `LLM_PROVIDER` changed `"groq"→"gemini"`; `GROQ_API_KEY` filled in; `GEMINI_API_KEY` filled in |

The Gemini key (`AIzaSyBODTqBPDUiCCIs1kxm0B-0LdamWMhaqLI`) was sourced from `/home/mint/geminikey`.
The Groq key was sourced from `/media/sf_sharedfolderclone/groq.txt`.

#### How these files are consumed

**nlqSearch:**
`nlqSearch/install.sh` (line 52–56) sources `${SCRIPT_DIR}/.env` if present. This propagates `NLQ_BACKEND`, `GROQ_API_KEY`, and `GEMINI_API_KEY` into the shell environment before the plugin's runtime `.env` is written at `/usr/share/wazuh-dashboard/plugins/nlqSearch/server/.env`. The `.env.example` is a reference/fallback template only — the live `.env` is what install.sh actually reads.

**ai-assistant:**
`setup.sh` copies `ai-assistant/mcp-llm-gateway.env.example` to `/etc/mcp-llm-gateway/mcp-llm-gateway.env` only when the destination is absent or empty (line 552–555). The `mcp-llm-gateway.service` systemd unit loads that file via `EnvironmentFile=`. The gateway reads `GROQ_API_KEY`, `GEMINI_API_KEY`, and `LLM_PROVIDER` from its environment at startup.

#### Result

Both plugins will use Gemini as the active LLM. The Groq key is present in all env files and can be activated by changing `NLQ_BACKEND=groq` / `LLM_PROVIDER="groq"` without re-entering the key.

---

### Part 2 — Research: Adding a Custom File-Reading MCP Tool

#### Current architecture recap

```
User query (via OpenSearch ML Commons)
    │  POST /analyze
    ▼
mcp_llm_gateway.py (FastAPI, port 9912)
    │  MultiServerMCPClient → SSE → port 9900
    ▼
opensearch-mcp-server-py (MCP Server)
    │  Runs DSL queries against OpenSearch
    ▼
Wazuh Indexer (port 9200)
```

`mcp_llm_gateway.py` uses `langchain-mcp-adapters.MultiServerMCPClient` to discover tools from the MCP server. Those tools plus the LLM are assembled into a LangChain `AgentExecutor` via `create_tool_calling_agent`. The LLM decides at runtime which tools to call based on their `name` and `description` fields.

The system prompt (`/etc/mcp-llm-gateway/mcp-llm-gateway.prompt`) instructs the LLM on policy: which tool to use for what type of query, what index to use, what fields to select, etc.

---

#### How a new tool gets invoked by the LLM

The LangChain agent pattern works like this:

1. The `tools` list is serialized into the LLM's context as a schema block (name + description + input schema for each tool).
2. The LLM reads the user query alongside the tool schemas.
3. If the query matches a tool's description, the LLM emits a tool-call in its output.
4. LangChain intercepts the tool-call, runs `tool._run(args)`, and injects the result back into the conversation.
5. The LLM synthesizes a final answer using the tool output.

**The tool's `description` string is the primary signal** the LLM uses to decide when to invoke it. It must be specific enough to avoid false positives (tool called when it shouldn't be) and broad enough to cover the intended trigger questions.

---

#### Option A — Custom LangChain BaseTool in `mcp_llm_gateway.py` (Recommended)

This is the simplest approach. No new service, no new process, no changes to the MCP server.

**How to implement:**

Add a `BaseTool` subclass to `mcp_llm_gateway.py`:

```python
from langchain.tools.base import BaseTool  # already imported

class ReadReferenceTool(BaseTool):
    name: str = "read_reference_document"
    description: str = (
        "Use this tool ONLY when the user asks about <SPECIFIC TOPIC HERE>. "
        "Returns the full contents of the SOC reference document for that topic. "
        "Input: a short description of what the user is asking about (or empty string)."
    )

    def _run(self, query: str = "") -> str:
        file_path = os.getenv("SOC_REFERENCE_FILE", "/etc/mcp-llm-gateway/reference.md")
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            return f"Reference file not found at: {file_path}"
        except Exception as exc:
            return f"Error reading reference file: {exc}"

    async def _arun(self, query: str = "") -> str:
        return self._run(query)
```

Then append it in `_load_mcp_tools()`:

```python
async def _load_mcp_tools() -> list[BaseTool]:
    # ... existing MCP connection code (unchanged) ...
    tools = await client.get_tools()
    if VERBOSE:
        print(f"[gateway] Discovered {len(tools)} MCP tools", file=sys.stderr)
    # Append local tools
    tools = list(tools)
    tools.append(ReadReferenceTool())
    if VERBOSE:
        print(f"[gateway] Total tools (including local): {len(tools)}", file=sys.stderr)
    return tools
```

Add the file path to `mcp-llm-gateway.env.example`:
```
# ── Custom reference file ─────────────────────────────────────────────────────
# Path to a local file the SOC assistant can read when asked about specific topics.
SOC_REFERENCE_FILE="/etc/mcp-llm-gateway/reference.md"
```

And in `mcp_llm_gateway.py` env constants block:
```python
SOC_REFERENCE_FILE = os.getenv("SOC_REFERENCE_FILE", "/etc/mcp-llm-gateway/reference.md")
```

**Add a policy entry to `mcp-llm-gateway.prompt`:**

Append a section like:
```
# Custom Reference Document Policy
- When the user asks about <SPECIFIC TOPIC>, call the read_reference_document tool.
- Do not fabricate information about <SPECIFIC TOPIC> — always read the document first.
- Summarize the relevant sections of the document in your response.
```

**Deployment after changes:**
```bash
sudo cp wazuh-fyp-repo/ai-assistant/mcp_llm_gateway.py /opt/mcp_llm_gateway-env/mcp_llm_gateway.py
sudo cp wazuh-fyp-repo/ai-assistant/mcp-llm-gateway.prompt /etc/mcp-llm-gateway/mcp-llm-gateway.prompt
# Place the reference file:
sudo cp <your_file> /etc/mcp-llm-gateway/reference.md
sudo chown root:mcpgateway /etc/mcp-llm-gateway/reference.md
sudo chmod 640 /etc/mcp-llm-gateway/reference.md
# Add SOC_REFERENCE_FILE to the env:
echo 'SOC_REFERENCE_FILE="/etc/mcp-llm-gateway/reference.md"' | sudo tee -a /etc/mcp-llm-gateway/mcp-llm-gateway.env
sudo systemctl restart mcp-llm-gateway
```

**Pros:** No new service. No new dependencies. One small addition to one file. The file path is configurable via env var.
**Cons:** Not a real MCP tool — it bypasses the MCP protocol. Only available to this gateway instance; not discoverable by other MCP clients.

---

#### Option B — Custom FastMCP Server (Proper MCP Protocol)

For a proper MCP-native implementation that follows the MCP standard and can be discovered by any MCP client:

**Install `fastmcp` in the gateway venv:**
```bash
sudo /opt/mcp_llm_gateway-env/bin/pip install fastmcp
```

**Create `ai-assistant/custom_mcp_server.py`:**

```python
#!/usr/bin/env python3
"""Custom MCP Server — exposes local file-reading tools via SSE."""
import os
from fastmcp import FastMCP

mcp = FastMCP("wazuh-custom-tools")
REFERENCE_FILE = os.getenv("SOC_REFERENCE_FILE", "/etc/mcp-llm-gateway/reference.md")

@mcp.tool()
def read_reference_document(topic: str = "") -> str:
    """
    Read the SOC reference document.
    Use this when the user asks about <SPECIFIC TOPIC>.
    topic: optional string describing what the user is looking for.
    Returns the full file contents.
    """
    try:
        with open(REFERENCE_FILE, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        return f"Error: {e}"

if __name__ == "__main__":
    port = int(os.getenv("CUSTOM_MCP_PORT", "9901"))
    mcp.run(transport="sse", host="0.0.0.0", port=port)
```

**Register as a second server in `mcp_llm_gateway.py`:**

```python
CUSTOM_MCP_URL = os.getenv("CUSTOM_MCP_URL", "")  # empty = disabled

async def _load_mcp_tools() -> list[BaseTool]:
    server_config = {
        "opensearch": {"url": MCP_SSE_URL, "transport": "sse", "headers": headers}
    }
    if CUSTOM_MCP_URL:
        server_config["custom"] = {"url": CUSTOM_MCP_URL, "transport": "sse"}
    client = MultiServerMCPClient(server_config)
    tools = await client.get_tools()
    ...
```

**Create `ai-assistant/services/custom-mcp-server.service`:**

```ini
[Unit]
Description=Custom MCP Server (local file tools)
After=network.target

[Service]
User=mcpgateway
Group=mcpgateway
WorkingDirectory=/opt/mcp_llm_gateway-env
EnvironmentFile=/etc/mcp-llm-gateway/mcp-llm-gateway.env
ExecStart=/opt/mcp_llm_gateway-env/bin/python /opt/mcp_llm_gateway-env/custom_mcp_server.py
Restart=always
RestartSec=10
StandardOutput=append:/var/log/mcp_llm_gateway/custom-mcp-server.log
StandardError=append:/var/log/mcp_llm_gateway/custom-mcp-server.log

[Install]
WantedBy=multi-user.target
```

**Add to `mcp-llm-gateway.env.example`:**
```
CUSTOM_MCP_URL="http://127.0.0.1:9901/sse"
SOC_REFERENCE_FILE="/etc/mcp-llm-gateway/reference.md"
```

**Pros:** Proper MCP protocol. Discoverable by any MCP client. Cleanly separates concerns. Other MCP clients (not just this gateway) can use the tool.
**Cons:** Requires a new process, a new systemd service, and `fastmcp` as a new dependency. More moving parts to restart/debug.

---

#### Recommendation

Use **Option A** for a single file-reading tool. It is already running inside a LangChain agent that is not a strict MCP client — adding a `BaseTool` subclass is the natural extension point. The MCP protocol adds no value for a tool that only reads a local file.

Use **Option B** if multiple different tools are needed, if the tools need to be shared with other MCP clients (e.g., Claude Desktop), or if the team wants architectural consistency with the rest of the MCP stack.

---

#### How the chatbot will interface with the file

When the feature is built, a conversation looks like this:

```
User: "What is our PECA Section 3 escalation procedure?"

[LLM sees tool schema: read_reference_document — "Use when asked about PECA procedures"]
[LLM emits: tool_call("read_reference_document", {"topic": "PECA Section 3 escalation"})]
[LangChain calls ReadReferenceTool._run(...)]
[File read: /etc/mcp-llm-gateway/reference.md → 800-word document]
[Tool result injected back into LLM context]

LLM response: "According to the SOC reference document, the PECA Section 3 escalation
procedure is: [summarized content from file]..."
```

The file itself can be any format the LLM can read as plain text: Markdown, plain text, JSON, CSV. Markdown is recommended because headings and lists give the LLM structural cues for summarization.

**File size constraint:** The entire file is injected into the LLM's context window on every tool call. For Gemini 2.5 Flash (1M token context), files up to ~750KB of plain text are fine. For Groq Llama (128K context), keep files under ~100KB. If the reference document is large, consider splitting it into multiple files and creating one tool per topic/file.

**The system prompt policy entry** determines how precisely the LLM triggers the tool. Too vague → tool fires on unrelated queries. Too specific → tool never fires. The description should list the exact trigger phrases you expect users to type, e.g.:

```
"Use this tool when the user asks about PECA compliance procedures, escalation steps,
incident response playbooks, or policy references. Keywords: PECA, playbook, procedure,
policy, escalation, incident response checklist."
```

---

#### Files to add/modify when implementing (Option A)

| File | Change |
|------|--------|
| `ai-assistant/mcp_llm_gateway.py` | Add `ReadReferenceTool` class; append it in `_load_mcp_tools()`; add `SOC_REFERENCE_FILE` env constant |
| `ai-assistant/mcp-llm-gateway.env.example` | Add `SOC_REFERENCE_FILE` env var |
| `ai-assistant/mcp-llm-gateway.prompt` | Add policy section for when to call the new tool |
| `setup.sh` `install_aiAssistant()` | Copy reference file and ensure `SOC_REFERENCE_FILE` is in the env |
| `<reference_file>.md` | The actual content the LLM will read (user provides this) |

---

### Status: Research complete — implementation pending user decision on file/questions

---

## Session — 2026-04-24 (Prompt Update)

**Developer:** Claude Sonnet 4.6
**Scope:** Replace `mcp-llm-gateway.prompt` with updated version from `gemini-code-1776951718485.txt` in the shared folder

---

### What Changed

`ai-assistant/mcp-llm-gateway.prompt` was fully replaced with the new prompt sourced from `/media/sf_sharedfolderclone/gemini-code-1776951718485.txt`.

#### Diff summary vs. previous prompt

| Section | Change |
|---------|--------|
| Capability listing | **New** — "what can you do" canned response listing 7 capability areas |
| Conversational Context Policy | Added: "If context is ambiguous, ask the user one short clarifying question before proceeding." |
| Domain Restriction | Expanded scope: added "rules, decoders, agents, indexer configuration" to Wazuh focus; expanded laws list to include SOX, NCA ECC, PDPL, DORA, SOC 2; added "ALWAYS attempt a security interpretation before refusing" rule |
| Tool Policy (MCP) | Added error-handling response for failed MCP tool calls |
| Generic Alert Intent Normalization | Added two new equivalent queries: "Show me alerts" and "What alerts do I have?" |
| High Severity Alert Queries | **New section** — treats "high severity", "critical alerts", "top alerts", "guide me on alerts" as rule.level >= 12 searches |
| Reporting Format | Triage Decision now requires explicit reasoning alongside confidence level |
| Conditional Reporting Format | Fully rewritten — zero-results now returns a structured non-dead-end response with 3 follow-up options instead of a flat "0 records found" message |
| Response Constraints & Style | Added "Format responses with clear headers and bullet points" |

---

### Install Script

No changes to `setup.sh` required. Line 548 already copies `ai-assistant/mcp-llm-gateway.prompt` to `/etc/mcp-llm-gateway/mcp-llm-gateway.prompt` unconditionally on every install run. The updated prompt will be deployed automatically on the next `setup.sh` execution or re-run of the `install_aiAssistant` function.

To apply the prompt to a running instance without full reinstall:
```bash
sudo cp wazuh-fyp-repo/ai-assistant/mcp-llm-gateway.prompt /etc/mcp-llm-gateway/mcp-llm-gateway.prompt
sudo chown root:mcpgateway /etc/mcp-llm-gateway/mcp-llm-gateway.prompt
sudo chmod 640 /etc/mcp-llm-gateway/mcp-llm-gateway.prompt
sudo systemctl restart mcp-llm-gateway
```

---

### Status

Prompt file updated. No code changes required. Untested on live instance — restart required to pick up new prompt.

---

## Session — 2026-04-24

**Developer:** Claude Sonnet 4.6
**Target:** EC2 deployment + repo source
**Scope:** Switch AI assistant LLM provider from Gemini to Groq (qwen3-32b)

---

### Changes Made

**Reason:** Gemini was the active provider; switching to Groq with the `qwen3-32b` model per team decision.

**Files changed:**

1. `ai-assistant/mcp-llm-gateway.env.example`
   - `LLM_PROVIDER` changed from `"gemini"` → `"groq"`
   - `GROQ_MODEL` changed from `"llama-3.3-70b-versatile"` → `"qwen3-32b"`
   - Groq API key already present in the file

**EC2 running config updated:**
- `/etc/mcp-llm-gateway/mcp-llm-gateway.env` on `ec2-16-170-236-3.eu-north-1.compute.amazonaws.com`
  - Added `GROQ_API_KEY`, `GROQ_MODEL="qwen3-32b"`, set `LLM_PROVIDER="groq"`
- `mcp-llm-gateway` service restarted — confirmed `active (running)`

**Groq API key:** `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` (stored in `/media/sf_sharedfolderclone/groq.txt` and in `mcp-llm-gateway.env.example`)

**Credentials:** EC2 SSH key at `/media/sf_sharedfolderclone/credentials.pem`

### To apply on a new machine

`setup.sh` will use `mcp-llm-gateway.env.example` as the base config when the gateway env is not yet populated — it will automatically get `LLM_PROVIDER=groq` and `GROQ_MODEL=qwen3-32b` from the example file.

---

### Status

Repo updated. EC2 config updated and service restarted — active and running with Groq/qwen3-32b.
