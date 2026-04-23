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
