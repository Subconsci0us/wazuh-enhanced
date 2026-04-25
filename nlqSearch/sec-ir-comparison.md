# Sec-IR vs nlqSearch — Design Comparison

**Sec-IR** (`/media/sf_sharedfolderclone/sec-ir/`) is the research prototype.
**nlqSearch** (this folder) is its productionized implementation as a Wazuh / OSD plugin, narrowed to Wazuh and extended with query execution.

---

## What is identical

The core intellectual contribution — the intermediate representation pipeline — is faithfully ported:

- The Sec-IR JSON schema (7 fields, 10 event types, 5 patterns)
- The system prompt (word-for-word match, including all disambiguation rules and all 7 few-shot examples)
- The v4 deterministic time-range pre-processor (`_inject_time_hint` / `injectTimeHint`) — same regex, same ceiling-snap logic
- The self-correction loop (up to 2 rounds, same correction prompt format)
- The Wazuh DSL transpiler logic — all 5 pattern builders (`single_event`, `repeated_attempts`, `spike`, `sequence`, `absence`) produce identical output, including the `_meta.note` fields for sequence and spike

---

## What is different

| Dimension | sec-ir | nlqSearch |
|---|---|---|
| **Language** | Python | JavaScript (Node.js inside OSD) |
| **Target platforms** | Elastic EQL + Splunk SPL + **Wazuh DSL** | **Wazuh DSL only** |
| **LLM backends** | Gemini, Ollama | **Groq (new, priority)**, Gemini, Ollama |
| **Backend priority order** | Gemini > Ollama | Groq > Gemini > Ollama |
| **Backend auto-detect** | Probes Ollama via HTTP to confirm it's running | Checks env vars only — no liveness probe |
| **Transpile return type** | `json.dumps(...)` → a JSON **string** | Returns a plain **JS object** |
| **Validator** | Uses `jsonschema` Python library + `schema.json` | Manual JS validator (zero dependencies, avoids OSD/ajv conflicts) |
| **Query execution** | None — just emits query text | `/api/nlq_search/execute` runs the DSL against OpenSearch and returns hits |
| **IR editing + retranspile** | Not present | `/api/nlq_search/retranspile` — analyst edits IR in UI, regenerates DSL without a second LLM call |
| **Frontend UI** | CLI (`python run.py`, `python parser.py`) | Browser plugin UI in OSD |
| **Evaluation harness** | Full — 240 NLQs, 3 tiers, field-level accuracy metrics | None |

---

## The Groq addition — why it matters

sec-ir's recommended backend is `gemma4:e4b` on Ollama (local GPU). The FYP VM has no GPU. The Gemini free tier hits rate limits after ~20-25 queries in a burst. nlqSearch inserts **Groq** as the top-priority backend — `llama-3.3-70b-versatile` via Groq's cloud API. This is a 70B model with a generous free tier and much faster inference than Ollama on CPU, making it practical for the FYP environment without needing a local GPU.

---

## The retranspile endpoint — design significance

This is the most significant capability sec-ir doesn't have. In sec-ir, the IR is a stepping stone you can inspect manually before running `python -m transpiler.wazuh`. In the plugin, the `/retranspile` endpoint formalizes this as a UI affordance: the analyst can see the IR the LLM produced, tweak a field (e.g. change `severity` from `medium` to `high`), and regenerate the Wazuh DSL — no LLM cost, no round-trip latency, fully deterministic.

---

## One behavioral divergence to be aware of

In sec-ir, `transpiler/wazuh.py`'s `transpile()` returns a **JSON string** (it calls `json.dumps()`). In nlqSearch, `transpiler.js`'s `transpile()` returns a **plain JS object**. The route layer serializes it when sending the HTTP response. This matters if you ever compare the two transpilers directly — the same IR produces the same logical structure, but the Python one is a string and the JS one is an object.
