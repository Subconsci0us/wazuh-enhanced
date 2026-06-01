# AI-Enhanced Security Information and Event Management System

**An Integration of Machine Learning, Natural Language Processing, and Regulatory Compliance Tooling on the Wazuh SIEM Platform**

---

**Institution:** Institute of Business Administration (IBA), Karachi  
**Programme:** BS Computer Science  
**Course:** Final Year Project (FYP)  
**Advisor:** Dr. Faisal Iradat  

**Team:**

| Name | Role |
|------|------|
| Shazain | Frontend Development & Localization |
| Syed Shayan Hussain | Backend Development & System Integration |
| Fatima Shahid | Artificial Intelligence / Machine Learning |

**Repository:** [https://github.com/Subconsci0us/FYP_siem.git](https://github.com/Subconsci0us/FYP_siem.git)

---

## Abstract

This report documents the design, implementation, and evaluation of an AI-enhanced Security Information and Event Management (SIEM) system developed as a final year project at IBA Karachi. The project augments the open-source Wazuh SIEM platform (version 4.14.3) with six substantive enhancements: (1) a custom compliance ruleset mapped to Pakistan's Prevention of Electronic Crimes Act 2016 (PECA), (2) an AI-driven security analyst chatbot powered by a large language model gateway, (3) an interactive network topology visualisation plugin, (4) a natural language query (NLQ) search interface enabling plain-English alert retrieval, (5) a comparative cross-framework compliance dashboard, and (6) a bilingual Urdu/English localisation layer with comprehensive dark mode support across the entire Wazuh Dashboard. All components are delivered as OpenSearch Dashboards plugins and are deployable via a single idempotent setup script with feature-flag-controlled selective installation.

The project is technically demanding. It required reverse-engineering the internal plugin architecture of a pre-compiled, closed-build-chain dashboard application; directly patching minified, Brotli- and gzip-compressed JavaScript bundles; integrating a multi-service LLM gateway with the OpenSearch ML Commons framework; and reimplementing a Python-based natural language query transpilation pipeline in JavaScript without external dependencies. The challenges encountered, the techniques used to resolve them, and the limitations of the resulting system are documented in full throughout this report.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Background and Related Work](#2-background-and-related-work)
3. [System Architecture](#3-system-architecture)
4. [Development Environment and Constraints](#4-development-environment-and-constraints)
5. [Feature 1: PECA 2016 Compliance Module](#5-feature-1-peca-2016-compliance-module)
6. [Feature 2: AI Security Analyst Chatbot](#6-feature-2-ai-security-analyst-chatbot)
7. [Feature 3: Network Topology Visualisation Plugin](#7-feature-3-network-topology-visualisation-plugin)
8. [Feature 4: Natural Language Query Search Plugin](#8-feature-4-natural-language-query-search-plugin)
9. [Feature 5: Comparative Compliance View Plugin](#9-feature-5-comparative-compliance-view-plugin)
10. [Feature 6: Localization and Dark Mode Plugin](#10-feature-6-localization-and-dark-mode-plugin)
11. [Deployment and Installation Infrastructure](#11-deployment-and-installation-infrastructure)
12. [Challenges and Incident Log](#12-challenges-and-incident-log)
13. [Testing and Validation](#13-testing-and-validation)
14. [Limitations and Future Work](#14-limitations-and-future-work)
15. [Conclusion](#15-conclusion)
16. [References](#16-references)

---

## 1. Introduction

Security Information and Event Management systems occupy a critical position in the modern security operations centre (SOC). They aggregate log data from across an organisation's infrastructure, correlate events, and surface alerts that warrant human investigation. Despite the maturity of open-source SIEM platforms such as Wazuh, a significant gap persists between what these systems can detect and what analysts can efficiently act upon. Three barriers are particularly well-documented: the cognitive burden of interpreting high-volume alert streams without natural language tooling, the absence of localised regulatory compliance frameworks tailored to national legislation, and the lack of network-contextual visualisation that maps alerts to their topological origin.

This project addresses these barriers by constructing an AI-enhanced layer on top of Wazuh rather than re-implementing SIEM functionality from scratch. The rationale for this approach is both practical and academically sound: Wazuh provides a production-grade, extensible foundation, and the OpenSearch Dashboards plugin architecture — upon which Wazuh's web interface is built — offers documented extension points. The project contributes enhancements in six distinct areas, each delivered as a self-contained, installable component.

The secondary motivation for this work is the alignment of security monitoring tooling with Pakistan's regulatory landscape. PECA 2016 is the country's primary legislation governing electronic crimes, yet no open-source SIEM platform ships with PECA-mapped detection rules or compliance dashboards. The absence of such mappings means Pakistani organisations either operate without compliance visibility or rely on costly commercial alternatives. This project directly addresses this gap.

### 1.1 Objectives

The project set out to achieve the following objectives:

- Integrate an AI-driven natural language interface into the Wazuh Dashboard, enabling SOC analysts to query alerts in plain English without knowledge of the underlying query language.
- Implement custom Wazuh detection rules mapped to sections of PECA 2016 and surface those rules within a dedicated dashboard module.
- Develop a live network topology graph that contextualises alert severity within the agent infrastructure.
- Construct a unified compliance view that allows simultaneous comparison of alert coverage across PCI DSS, HIPAA, GDPR, NIST 800-53, TSC, and PECA.
- Provide bilingual Urdu/English UI support to broaden accessibility for domestic security practitioners.

### 1.2 Scope

The project is scoped to Wazuh 4.14.3 running as an all-in-one deployment (manager, indexer, and dashboard on a single host) on Ubuntu 24.04 LTS or Linux Mint 22. The AI chatbot supports Groq (primary deployed provider, `qwen/qwen3-32b`), Google Gemini, OpenAI GPT, and AWS Bedrock Claude as interchangeable LLM backends. The NLQ search plugin supports Groq, Gemini (cloud), and Ollama (local/offline) backends. All custom plugins target OpenSearch Dashboards 2.19.4.

---

## 2. Background and Related Work

### 2.1 Wazuh SIEM

Wazuh is an open-source unified XDR and SIEM platform that provides host-based intrusion detection, log analysis, File Integrity Monitoring (FIM), vulnerability detection, and compliance reporting. It is built upon a fork of OpenSearch and the OSSEC ruleset. The platform operates as a manager-agent architecture: lightweight agents installed on endpoints forward events to a central manager, which processes them against a rule hierarchy and forwards matching alerts to an OpenSearch-based indexer for storage and querying.

The Wazuh Dashboard is a customised deployment of OpenSearch Dashboards (OSD) — itself a fork of Kibana — augmented with Wazuh-specific plugins. These plugins are shipped as pre-compiled JavaScript bundles within the `wazuh-dashboard` system package. This has a direct implication for extensibility: the build toolchain used to produce the official Wazuh plugin bundles is not publicly exposed, meaning third-party plugin developers cannot use Wazuh's own build pipeline. Any plugin targeting the Wazuh Dashboard must be built against OSD's generic plugin system.

### 2.2 OpenSearch Dashboards Plugin Architecture

OSD plugins consist of two parts: a server-side Node.js component registered via a lifecycle class, and a browser-side bundle registered with OSD's `__osdBundles__` loader. At runtime, OSD's bootstrap script (`/bootstrap.js`) sets up the `window.__osdBundles__` registry and loads all plugin bundles as `<script>` tags. Each bundle must call `window.__osdBundles__.define('plugin/<id>/public', factoryFn, moduleKey)` to register itself; OSD then calls the factory to obtain the plugin's `setup()` entrypoint.

Critically, there is no supported mechanism for building OSD plugins without the full OSD source tree as a workspace peer. This project resolves this constraint by using a standalone webpack 5 build that bundles all plugin dependencies — including the D3.js visualisation library — into a single self-contained file.

### 2.3 Natural Language Interfaces for Security

The application of natural language processing to SIEM query interfaces has been explored in prior research. The Sec-IR (Security Intermediate Representation) framework, which this project employs as the NLQ translation pipeline, proposes a schema-constrained intermediate representation layer that decouples natural language understanding (delegated to an LLM) from deterministic query generation (handled by a transpiler). This architecture confers two advantages: it prevents the LLM from generating syntactically invalid or semantically unsafe queries, and it allows the same IR to target multiple SIEM backends (Wazuh, Elasticsearch, Splunk) through independent transpiler modules.

### 2.4 PECA 2016

Pakistan's Prevention of Electronic Crimes Act 2016 is the country's principal statute governing cybercrimes. It criminalises, among other acts, unauthorised access to information systems (Section 3), unauthorised copying or transmission of data (Section 4), interference with information systems (Section 5), unauthorised access to critical infrastructure (Section 6), malicious code offences (Section 20), and cyber terrorism (Section 21). At the time of this project's initiation, no open-source SIEM shipped with detection rules or dashboard modules aligned to PECA's structure.

### 2.5 Related Work

_[This section should be expanded with citations to related academic work, including prior SIEM enhancement projects, NLP-to-query research, and compliance framework integration literature. Leave blank until literature review is complete.]_

---

## 3. System Architecture

The system is composed of six distinct components — five OpenSearch Dashboards plugins and one multi-service backend for the AI chatbot — all deployed on a single Wazuh all-in-one host. The components share the Wazuh Indexer (OpenSearch on port 9200) as a common data source but are otherwise loosely coupled.

### 3.1 High-Level Architecture

```
Browser (Wazuh Dashboard — port 443)
  │
  ├── Network Graph Plugin          ← D3 force graph, polls Wazuh API via OSD proxy
  ├── NLQ Search Plugin             ← LLM-assisted query interface
  ├── Compliance View Plugin        ← Cross-framework compliance dashboard
  ├── Localization Plugin           ← Dark mode + Urdu/English toggle
  ├── AI Assistant Chat (OSD)       ← Dashboard Assistant chat plugin
  │
  │   [Server-side OSD plugin routes]
  │
  ├── /api/network_graph/*          → Wazuh API (port 55000)
  ├── /api/nlq_search/*             → LLM backends + Wazuh Indexer
  ├── /api/compliance_view/*        → Wazuh Indexer (port 9200)
  │
  │   [AI Assistant Backend — separate from OSD]
  │
  ├── MCP-LLM Gateway (FastAPI)     :9912
  │       ├── LLM providers (Gemini / OpenAI / AWS Bedrock)
  │       └── MCP tool calls → OpenSearch MCP Server
  └── OpenSearch MCP Server         :9900
          └── OpenSearch queries → Wazuh Indexer
```

> **Current LLM provider**: The gateway runs Groq `qwen/qwen3-32b` as the primary provider. The architecture diagram shows Gemini as one option; Groq is the deployed default and is shown in Section 6.3.2.

### 3.2 Data Flow — AI Chatbot

1. The analyst submits a question through the Dashboard Assistant chat interface (top-right icon).
2. OpenSearch ML Commons forwards the request to the MCP-LLM Gateway at `POST /analyze`, authenticated with an internal API key.
3. The Gateway runs a LangChain agent: it sends a system prompt (SOC analyst role) plus the user question to the configured LLM.
4. The LLM selects from eleven available MCP tools (search alerts, list CVEs, query agents, etc.) and calls them.
5. The Gateway proxies those tool calls to the OpenSearch MCP Server over SSE.
6. The MCP Server executes the corresponding OpenSearch queries against the Wazuh Indexer and returns structured results.
7. The LLM synthesises the results into a concise analyst response.
8. ML Commons displays the response in the chat UI.

### 3.3 Data Flow — NLQ Search

1. The analyst types a plain-English security query.
2. A deterministic time-range pre-processor extracts temporal constraints (e.g., "last 24 hours") before invoking the LLM.
3. The LLM (Groq, Gemini, or Ollama) generates a Sec-IR JSON object conforming to the schema.
4. A schema validator checks the IR; if invalid, a self-correction loop re-invokes the LLM with the error description (up to two retries).
5. A deterministic transpiler converts the validated IR to an OpenSearch bool query.
6. The query is executed against `wazuh-alerts-*` and results are displayed in a table.

### 3.4 Component Version Reference

| Component | Version |
|-----------|---------|
| Wazuh Manager | 4.14.3 |
| OpenSearch Dashboards | 2.19.4 |
| Node.js (plugin build) | 18.19.1 |
| D3.js (Network Graph) | 7.9.0 |
| webpack | 5.98.0 |
| FastAPI (AI Gateway) | 0.128.0 |
| LangChain | 0.3.27 |
| LangChain MCP Adapters | 0.1.9 |
| OpenSearch MCP Server (pip) | opensearch-mcp-server-py 0.8.0 |
| LLM Provider (AI chatbot — primary) | Groq (`qwen/qwen3-32b`) |
| LLM Provider (AI chatbot — alternates) | Google Gemini (`gemini-2.5-flash`), OpenAI GPT-4o, AWS Bedrock Claude |
| LLM Provider (NLQ search — primary) | Groq (`llama-3.3-70b-versatile`) |

---

## 4. Development Environment and Constraints

The system was developed on a Linux Mint 22.3 virtual machine running inside VirtualBox. The development environment imposed several non-trivial constraints that shaped implementation decisions throughout the project.

### 4.1 VirtualBox Shared Folder Limitation

Source code was stored on a Windows host and mounted into the VM via VirtualBox's shared folder feature (vboxsf filesystem). The vboxsf filesystem does not support symbolic links — a capability that `npm` relies upon to create CLI tool shortcuts in `node_modules/.bin/`. Consequently, running `npm install` directly on the shared folder fails with a permissions error.

This constraint was addressed by copying plugin source code to `/tmp/` before every build operation, then copying the compiled output back to the shared folder after the build completes. All install scripts implement this pattern explicitly.

### 4.2 Closed Build Chain

The Wazuh Dashboard is distributed as a compiled binary package. The Wazuh-specific plugins (`wazuh.plugin.js`, `wazuh.chunk.2.js`) are pre-compiled minified JavaScript bundles. No build toolchain is exposed that would allow rebuilding these plugins from source. This constraint was particularly significant for the PECA compliance module and the Compliance Overview, both of which needed to integrate into the Wazuh sidebar navigation — a capability controlled by code inside the pre-compiled bundles.

The solution adopted was direct in-place patching of the compiled JavaScript files using Python `bytes.replace()` operations. After patching, the gzip (`.gz`) and Brotli (`.br`) compressed variants of each file must be regenerated, as the OSD HTTP server serves compressed responses by default and will serve a stale compressed copy if the compressed files are not updated to match the patched source. All patches are implemented as an idempotent Python script (`patch_bundles.py`) that can be re-run safely on already-patched files.

### 4.3 No React or OSD Module Imports

The official OSD build pipeline, when available, provides React and a set of OSD-specific UI component libraries (`@elastic/eui`, `@osd/core`, etc.) as shared modules. Without the source tree, these cannot be resolved at build time. All custom plugin UIs were therefore implemented in vanilla JavaScript using direct DOM manipulation, eliminating any dependency on React, the Elastic UI Framework, or OSD-internal libraries.

### 4.4 Plugin Bundle Registration and webpack Terser Optimisation

A recurring issue during development was the interaction between webpack 5's production-mode minifier (terser) and the `window.__osdBundles__` plugin registration call. When bundle entry points used a bare unqualified identifier (e.g., `__osdBundles__`) inside a `typeof` guard, terser treated the identifier as a local variable in module scope and either eliminated the call (for the `networkGraph` plugin) or — in the case of the `nlqSearch` plugin, which had a single-module bundle — transformed the webpack require call from a module-initialising expression into a no-op function declaration. In both cases, OSD received either no registration call or a factory function that returned the webpack require function itself rather than the plugin exports object.

The resolution, determined by comparing the compiled output of the two plugins at the byte level, was to store the module exports on `window._nlqPluginExports` — a property access on the `window` object — rather than on a local variable. Property accesses on `window` cannot be statically optimised by terser, ensuring the registration call is preserved in the output bundle.

---

## 5. Feature 1: PECA 2016 Compliance Module

### 5.1 Overview

The PECA 2016 Compliance Module adds a fully integrated compliance monitoring capability to the Wazuh Dashboard. It consists of two layers: a set of custom Wazuh detection rules (`peca_rules.xml`) and a native dashboard module that surfaces alerts tagged with PECA section identifiers alongside the existing PCI DSS, HIPAA, GDPR, NIST 800-53, and TSC modules.

### 5.2 Detection Rules

Custom Wazuh rules are defined in XML and deployed to `/var/ossec/etc/rules/`. The PECA rules use Wazuh's group tagging mechanism: an outer `<group name="peca,">` element attaches the `peca` group to all alerts fired by any PECA rule, while individual rule bodies add section-specific tags (e.g., `peca_3`, `peca_20`) within their own `<group>` elements.

The approach of using `rule.groups` for PECA tagging — rather than a dedicated `rule.peca` field — was adopted to maintain compatibility with Wazuh's existing alert document schema, which reserves dedicated framework fields (`rule.pci_dss`, `rule.hipaa`, etc.) for compliance frameworks that are natively supported by the rule engine. PECA does not receive such native support, making group-based tagging the only viable approach without modifying the Wazuh core.

**Rules implemented:**

| Rule ID | Level | PECA Section | Trigger Condition |
|---------|-------|--------------|-------------------|
| 100100 | 10 | Section 3 — Unauthorised Access | SSH/PAM authentication failure (parent rule: 5710, 5716) |
| 100101 | 7 | Sections 4, 11 — Data Copying / Electronic Forgery | FIM checksum change detected |
| 100102 | 12 | Sections 6, 8 — Critical Infrastructure / Interception | FIM change in `/opt/critical_app/data` |
| 100103 | 12 | Section 20 — Malicious Code | Rootcheck / rootkit detection |

Rule IDs begin at 100100 to avoid conflicts with Wazuh's built-in rule range (1–99999) and the default local rules range.

**PECA sections covered versus mapped:**

| Section | Title | Status |
|---------|-------|--------|
| 3 | Unauthorised Access to Information System or Data | Active — Rule 100100 |
| 4 | Unauthorised Copying or Transmission of Data | Active — Rule 100101 |
| 5 | Interference with Information System or Data | Not yet implemented |
| 6 | Unauthorised Access to Critical Infrastructure | Active — Rule 100102 |
| 8 | Unauthorised Interception | Active — Rule 100102 |
| 11 | Electronic Forgery | Active — Rule 100101 |
| 20 | Offences by Malicious Code | Active — Rule 100103 |
| 21 | Cyber Terrorism | Not yet implemented |
| 36 | Data Protection of Service Providers | Not yet implemented |
| 37 | Data Retention | Not yet implemented |

### 5.3 Dashboard Integration

Integrating the PECA module into the Wazuh Dashboard navigation required modifications to two pre-compiled plugin bundles: `wazuh.chunk.2.js` and `wazuh.plugin.js`. The approach was derived by examining how built-in compliance modules (GitHub, Docker, AWS) are implemented — these modules use `rule.groups` filtering, the same mechanism required for PECA, rather than dedicated rule fields.

**Modifications to `wazuh.chunk.2.js` (six edits):**
1. `WAZUH_MODULES` object: added `peca` entry with title, appId, and description.
2. Agent tab counts: registered `peca:1`.
3. Overview tab counts: registered `peca:1`.
4. `PECADataSource` class: added after `GitHubDataSource`, using `getRuleGroupsFilter("rule.groups","peca","peca-rule-group")`.
5. `pecaColumns`: column definition using `rule.groups` field.
6. Module config: `peca:{init:"dashboard", tabs:[{Dashboard tab}, {Events tab}]}`.

**Modifications to `wazuh.plugin.js` (two edits):**
1. `peca_app` constant: `{id:"peca", order:406, category:"wz-category-security-operations"}`.
2. Apps array: `peca_app` inserted after `tsc`.

### 5.4 PECA Dashboard Visualisations

Following the initial integration, five inline visualisations were added to the PECA Dashboard tab:

| Visualisation | Type | Data |
|--------------|------|------|
| PECA Alerts Over Time | Line chart | Date histogram on `@timestamp` |
| PECA Alerts by Section | Horizontal bar | Filters aggregation per `peca_N` group |
| PECA Alerts by Severity Level | Donut chart | Terms aggregation on `rule.level` |
| PECA Top Rules Fired | Data table | Terms on `rule.id` + `rule.description` sub-bucket |
| PECA Alerts by Agent | Vertical bar | Terms aggregation on `agent.name` |

All visualisations respect the dashboard's existing DataSource filter (which restricts results to alerts where `rule.groups: "peca"`) and the search bar date range.

---

## 6. Feature 2: AI Security Analyst Chatbot

### 6.1 Overview and Design Rationale

The AI Security Analyst Chatbot integrates a large language model directly into the Wazuh Dashboard, enabling SOC analysts to interrogate their live Wazuh environment through conversational natural language. An analyst may submit queries such as "Analyse the most important alerts in my environment", "Which endpoints are affected by critical CVEs?", or "Show me brute-force attack patterns in the last 24 hours", and receive structured, contextually grounded answers drawn directly from Wazuh Indexer data — without constructing OpenSearch queries or navigating dashboard filters.

The feature was designed around a principle of strict data grounding: the LLM is never permitted to speculate or hallucinate alert data. Every factual claim in its response must originate from a tool call that queries the live Wazuh Indexer. This is enforced architecturally through the Model Context Protocol (MCP) tool-call loop: the LLM can only access SIEM data by invoking explicitly defined tools, and those tools return only what the indexer returns. The SOC analyst system prompt, authored by the team, reinforces this constraint through explicit instruction.

The architectural pattern followed by the team is drawn from the Wazuh AI Assistant integration reference architecture, which specifies a three-tier service stack: an MCP-capable OpenSearch server, a mediating LLM gateway, and OpenSearch ML Commons as the orchestration layer. The team implemented, configured, and integrated each tier against the live Wazuh 4.14.3 environment, extended the reference architecture with Google Gemini LLM support, and authored the production SOC analyst system prompt deployed on the gateway.

---

### 6.2 System Architecture

The chatbot system comprises three service tiers, all co-deployed on the Wazuh all-in-one host (Ubuntu 24.04 LTS, host IP `10.0.2.15`):

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Analyst Browser                                │
│              (Wazuh Dashboard — OSD 2.19.4)                         │
│         assistantDashboards + mlCommonsDashboards plugins           │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ HTTPS (OSD → ML Commons)
┌───────────────────────────▼─────────────────────────────────────────┐
│                  OpenSearch ML Commons                              │
│            (Wazuh Indexer, port 9200)                               │
│   Conversational agent: mcp-os-agent (r5l7WZ0BMG6XxlpYPdEp)        │
│   Remote model: mcp-llm-gateway-model → HTTP connector              │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ HTTP POST /analyze
┌───────────────────────────▼─────────────────────────────────────────┐
│                  MCP-LLM Gateway (port 9912)                        │
│           FastAPI + LangChain — /opt/mcp_llm_gateway-env/           │
│    System prompt: /etc/mcp-llm-gateway/mcp-llm-gateway.prompt       │
│    Credentials:   /etc/mcp-llm-gateway/mcp-llm-gateway.env          │
└───────────┬───────────────────────────────┬─────────────────────────┘
            │ Tool calls (LangChain→MCP)    │ LLM API calls
┌───────────▼──────────────┐    ┌───────────▼──────────────────────────┐
│  OpenSearch MCP Server   │    │       LLM Provider                   │
│  (port 9900)             │    │  Google Gemini: gemini-2.5-flash      │
│  opensearch-mcp-server   │    │  (OpenAI-compatible endpoint)         │
│  -py 0.8.0               │    │  Alternatives: OpenAI, AWS Bedrock    │
│  11 MCP tools via SSE    │    └──────────────────────────────────────┘
└───────────┬──────────────┘
            │ OpenSearch HTTP API
┌───────────▼──────────────┐
│    Wazuh Indexer         │
│    (port 9200)           │
│    Alert index store     │
└──────────────────────────┘
```

**Tier 1 — OpenSearch MCP Server (port 9900):** A Python service (`opensearch-mcp-server-py 0.8.0`) that wraps the Wazuh Indexer's OpenSearch HTTP API in eleven Model Context Protocol tools. Each tool corresponds to a discrete query operation (e.g., listing indices, retrieving alert counts, fetching alert details by severity, querying CVE records). The server exposes tool definitions and accepts tool execution requests over a Server-Sent Events (SSE) endpoint. It authenticates to the Wazuh Indexer using a dedicated `mcpserver` service account rather than the admin credential.

**Tier 2 — MCP-LLM Gateway (port 9912):** The core of the team's implementation. This FastAPI application mediates between OpenSearch ML Commons and the LLM provider. It receives an analyst's question via `POST /analyze`, instantiates a LangChain ReAct agent loaded with the MCP server's tool definitions, invokes the LLM in a tool-call loop until the agent produces a final answer, and returns that answer as a plain-text response. The gateway also exposes `GET /health`, which performs live connectivity checks against both the LLM provider and the MCP Server and returns a structured JSON status report.

**Tier 3 — Dashboard Plugins (OSD):** The `assistantDashboards` and `mlCommonsDashboards` plugins, sourced from the official OpenSearch Dashboards 2.19.4 distribution tarball, provide the chat panel UI embedded in the top-right corner of the Wazuh Dashboard and the ML Commons API client respectively. An ML Commons conversational agent registered in the Wazuh Indexer serves as the entry point that receives messages from the UI and routes them to the MCP-LLM Gateway via an HTTP connector.

---

### 6.3 MCP-LLM Gateway Development

The MCP-LLM Gateway is the team's primary software contribution within this feature. The reference architecture specifies the gateway's role and interface contract; the implementation was written and extended by the team.

#### 6.3.1 Core Request Handling

The gateway's `POST /analyze` endpoint accepts a JSON body containing a `parameters.prompt` string. Upon receipt, it:

1. Validates the `X-API-Key` header against the `GATEWAY_API_KEY` environment variable (internal credential, distinct from any LLM provider key).
2. Instantiates the configured LLM client via `_build_llm()`, selecting the provider from the `LLM_PROVIDER` environment variable.
3. Connects to the OpenSearch MCP Server's SSE endpoint and retrieves the current tool catalogue.
4. Constructs a LangChain ReAct agent binding the LLM to the tool catalogue.
5. Invokes the agent with the analyst's prompt, allowing up to one iteration (`max_iteration=1`) of LLM + tool-call execution.
6. Returns the agent's final textual response in a structure compatible with OpenSearch ML Commons' `response_filter` path: `$.output.message`.

#### 6.3.2 LLM Provider Extensions

The reference architecture documents support for OpenAI GPT and AWS Bedrock Claude. The team extended the gateway to support two additional providers: Google Gemini (used during development) and Groq (current deployed provider).

**Google Gemini** was the primary provider used during development and testing. It is accessed via its OpenAI-compatible REST endpoint, allowing the LangChain `ChatOpenAI` client to be reused with a provider-specific base URL override:

```python
ChatOpenAI(
    model=GEMINI_MODEL,          # "gemini-2.5-flash"
    temperature=0,
    base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
    api_key=GEMINI_API_KEY,
)
```

**Groq** was adopted as the production provider (2026-04-24) to eliminate free-tier rate-limit constraints encountered with Gemini. Groq is similarly accessed via an OpenAI-compatible endpoint:

```python
ChatOpenAI(
    model=GROQ_MODEL,            # "qwen/qwen3-32b"
    temperature=0,
    base_url="https://api.groq.com/openai/v1",
    api_key=GROQ_API_KEY,
)
```

The `qwen/qwen3-32b` model was selected for its strong instruction-following and reasoning capability. The provider is selected at runtime via the `LLM_PROVIDER` environment variable (`groq` | `gemini` | `openai` | `claude_bedrock`); switching providers requires only an environment file update and service restart. The system prompt was also updated at this time to improve zero-results handling, add high-severity alert detection, and expand the list of recognised compliance frameworks (SOX, NCA ECC, PDPL, DORA, SOC 2 added alongside the existing PECA, PCI DSS, HIPAA, GDPR, NIST).

The four supported providers are:

| Provider | `LLM_PROVIDER` value | Model Tested | Status |
|----------|---------------------|-------------|--------|
| Groq | `groq` | `qwen/qwen3-32b` | **Primary (deployed)** |
| Google Gemini | `gemini` | `gemini-2.5-flash` | Development / fallback |
| OpenAI | `openai` | `gpt-4o` | Available |
| AWS Bedrock (Anthropic Claude) | `claude_bedrock` | `anthropic.claude-3-sonnet-20240229-v1:0` | Available |

#### 6.3.3 Health Endpoint

The `GET /health` endpoint performs live connectivity checks at runtime and returns a structured JSON object:

```json
{
  "summary": "All components operational.",
  "status": { "gateway": "ok", "llm": "ok", "mcp": "ok" },
  "details": { "mcp_tools_count": 11 },
  "provider": "groq",
  "model": "qwen/qwen3-32b"
}
```

The LLM check invokes `_build_llm()` directly (covering all provider branches); the MCP check connects to the SSE endpoint and counts available tools. This endpoint was used as the primary operational verification step at each stage of integration.

#### 6.3.4 SOC Analyst System Prompt

The gateway reads a system prompt from `/etc/mcp-llm-gateway/mcp-llm-gateway.prompt` at startup and prepends it to every LLM interaction. The team authored this prompt to define the LLM's operational persona and constraints:

- The LLM is instructed to act as a professional SOC analyst with expertise in threat detection and incident triage.
- It is required to use only the provided tools to retrieve alert data; it may not fabricate alert records, CVE data, or endpoint information.
- Response formatting is specified: answers should be concise, prioritise actionable findings, and distinguish between confirmed data (from tool results) and analytical inference.
- Tool selection guidance is included: the prompt specifies which tools are appropriate for severity-based queries, CVE lookups, endpoint enumeration, and temporal trend queries.

Storing the prompt in a file rather than hard-coding it in the application allows the SOC team to tune the LLM's behaviour without modifying or redeploying the gateway binary.

---

### 6.4 OpenSearch ML Commons Integration

Connecting the Wazuh Dashboard's chat panel to the MCP-LLM Gateway required configuring OpenSearch ML Commons as an orchestration intermediary. This was performed by the team across eight sequential configuration steps, each verified against the live Wazuh Indexer before proceeding.

#### 6.4.1 Dashboard Plugin Installation (Step 1)

The `assistantDashboards` and `mlCommonsDashboards` plugins are not shipped with the Wazuh Dashboard. The team sourced them from the matching OpenSearch Dashboards 2.19.4 distribution tarball (338 MB), extracted the two plugin directories, copied them into `/usr/share/wazuh-dashboard/plugins/`, set ownership to `wazuh-dashboard:wazuh-dashboard` with mode 750, and enabled the chat panel via `assistant.chat.enabled: true` in `opensearch_dashboards.yml`. Both plugins were confirmed loaded in the Wazuh Dashboard's 53-plugin startup sequence.

A UI customisation script (sourced from the Wazuh integrations repository) was then applied to the `assistantDashboards` plugin bundles: it replaces the "OpenSearch Assistant" branding string and the OpenSearch logo SVG with Wazuh-specific equivalents, operating directly on the plugin's minified JavaScript files. Following the replacement, each modified bundle was recompressed with both gzip and brotli to match the multi-encoding format expected by the Wazuh Dashboard's static file server. This is structurally identical to the bundle-patching technique used for the team's other custom plugins (see Section 4.3).

#### 6.4.2 ML Commons Cluster Settings (Step 2)

Three persistent cluster settings were applied to the Wazuh Indexer via the OpenSearch Cluster Settings API using the admin certificate:

```
plugins.ml_commons.agent_framework_enabled: true
plugins.ml_commons.only_run_on_ml_node: false
plugins.ml_commons.connector.private_ip_enabled: true
plugins.ml_commons.trusted_connector_endpoints_regex: [
    "^http://10\\.0\\.2\\.15:9912/.*$",   (gateway — internal network)
    "^https://api\\.openai\\.com/.*$",
    "^https://bedrock-runtime\\..*\\.amazonaws\\.com/.*$",
    ...
]
```

`agent_framework_enabled` activates the ML Commons conversational agent subsystem. `only_run_on_ml_node: false` allows ML tasks to run on the single-node indexer (which is not designated as an ML node). `private_ip_enabled: true` permits the HTTP connector to target the gateway's internal IP. The trusted endpoints regex allowlist restricts which remote URLs ML Commons is permitted to contact, preventing arbitrary outbound requests.

#### 6.4.3 Remote Model Registration (Step 3)

A remote model named `mcp-llm-gateway-model` was registered in ML Commons with an inline HTTP connector definition:

```json
{
  "name": "mcp-llm-gateway-model",
  "function_name": "remote",
  "connector": {
    "protocol": "http",
    "parameters": { "endpoint": "http://10.0.2.15:9912/analyze" },
    "credential": { "api_key": "secret" },
    "actions": [{
      "action_type": "predict",
      "method": "POST",
      "url": "${parameters.endpoint}",
      "headers": { "X-API-Key": "${credential.api_key}" },
      "request_body": "{ \"parameters\": { \"prompt\": \"${parameters.prompt}\" } }",
      "request_timeout": "120s"
    }]
  }
}
```

The registration task completed synchronously with status COMPLETED. The assigned model ID is `mcp-llm-gateway-model`.

#### 6.4.4 Model Deployment (Step 4)

The registered model was deployed via `POST /_plugins/_ml/models/mcp-llm-gateway-model/_deploy`. Deployment completed synchronously (task type: DEPLOY_MODEL, status: COMPLETED), loading the model's connector configuration into ML Commons' active service registry.

#### 6.4.5 Conversational Agent Registration (Step 5)

A conversational agent named `mcp-os-agent` was registered with ML Commons:

```json
{
  "name": "mcp-os-agent",
  "type": "conversational",
  "app_type": "os_chat",
  "llm": {
    "model_id": "mcp-llm-gateway-model",
    "parameters": {
      "prompt": "${parameters.question}",
      "response_filter": "$.output.message",
      "max_iteration": 1,
      "message_history_limit": 10
    }
  },
  "memory": { "type": "conversation_index" }
}
```

The `response_filter` field instructs ML Commons to extract the final answer from the gateway's JSON response at `$.output.message`. `conversation_index` memory type persists conversation history in the Wazuh Indexer, enabling multi-turn dialogue. The registration returned agent ID `r5l7WZ0BMG6XxlpYPdEp`.

#### 6.4.6 Root Agent Configuration (Step 6)

The agent was designated as the root agent for the Dashboard Assistant by writing a configuration document to the ML Commons config index:

```json
PUT /.plugins-ml-config/_doc/os_chat
{
  "type": "os_chat_root_agent",
  "configuration": { "agent_id": "r5l7WZ0BMG6XxlpYPdEp" }
}
```

This binding is what causes the Dashboard Assistant chat panel to route user messages through the `mcp-os-agent` agent, which in turn routes them to the MCP-LLM Gateway.

#### 6.4.7 End-to-End Verification (Steps 7–8)

The complete stack was verified by issuing a direct agent execution call through the Indexer API:

```bash
POST /_plugins/_ml/agents/r5l7WZ0BMG6XxlpYPdEp/_execute
{ "parameters": { "question": "Hello", "verbose": true } }
```

The response confirmed successful routing through every tier: ML Commons received the request, forwarded it to the gateway, the gateway invoked the configured LLM, and the response was returned through the `inference_results` structure. A further test with the production query "Analyze the most important alerts in my environment" produced a coherent response drawn from live indexer data, confirming the full call chain: Dashboard → ML Commons → Gateway → LLM (Groq `qwen/qwen3-32b`) → MCP Server → Wazuh Indexer → response.

---

### 6.5 MCP Tool Catalogue

The OpenSearch MCP Server exposes eleven tools to the LLM agent over the SSE tool-call interface. Each tool maps to a specific OpenSearch query operation against the Wazuh Indexer. The tool count was confirmed via the gateway's `/health` endpoint (`"mcp_tools_count": 11`). The LangChain ReAct agent selects tools at inference time based on the analyst's question; the LLM determines which tools to call, in what order, and how to interpret their return values in constructing a final answer.

The tool catalogue covers the principal categories of SOC analyst query: alert enumeration and filtering by severity, time window, or rule group; CVE and vulnerability lookup; endpoint (agent) listing and status; index metadata inspection; and raw document retrieval for alert detail. The MCP protocol's SSE-based call interface allows the gateway to relay tool calls transparently between the LangChain agent and the Wazuh Indexer without the Indexer requiring any modifications.

---

### 6.6 Security Architecture

The chatbot system is designed with strict credential compartmentalisation:

**Service accounts:** The OpenSearch MCP Server runs under a dedicated `mcpserver` system user. The MCP-LLM Gateway runs under a dedicated `mcpgateway` system user. Neither user has interactive login privileges. Each service owns only the files it requires and cannot read the other's credentials.

**Credential isolation:** The LLM provider API key (Groq) resides exclusively in `/etc/mcp-llm-gateway/mcp-llm-gateway.env`, owned by `mcpgateway` with permissions mode 640. It is never transmitted to the browser, the Wazuh Dashboard, or OpenSearch. The `GATEWAY_API_KEY` — the credential that ML Commons presents to the gateway — is an independent internal secret registered in the ML Commons connector definition and validated by the gateway's request handler. The complete credential boundary is:

```
Browser
  ↓ (no credentials)
OSD assistantDashboards plugin
  ↓ (OSD session cookie only)
OpenSearch ML Commons
  ↓ X-API-Key: <GATEWAY_API_KEY>   [internal secret — never in browser]
MCP-LLM Gateway
  ↓ Authorization: Bearer <GROQ_API_KEY>   [LLM key — server-side only]
Groq API / LLM Provider
```

**Network scope:** The gateway listens on `0.0.0.0:9912` but is not exposed through the Wazuh Dashboard's reverse proxy. Access from outside the host requires direct network routing to port 9912, which is not opened in the project's deployment configuration. ML Commons reaches the gateway via the host's internal IP (`10.0.2.15`), covered by the trusted endpoints allowlist.

---

### 6.7 Operational Configuration Reference

The key identifiers and configuration values established during the integration are recorded below for operational reference:

| Item | Value |
|------|-------|
| Gateway service port | 9912 |
| MCP server port | 9900 |
| ML Commons model ID | `mcp-llm-gateway-model` |
| ML Commons agent ID | `r5l7WZ0BMG6XxlpYPdEp` |
| Agent name | `mcp-os-agent` |
| Root agent config key | `os_chat` |
| LLM provider (primary) | Groq (`qwen/qwen3-32b`) |
| Gateway env file | `/etc/mcp-llm-gateway/mcp-llm-gateway.env` |
| System prompt file | `/etc/mcp-llm-gateway/mcp-llm-gateway.prompt` |
| MCP tool count | 11 |
| OSD plugin: chat UI | `assistantDashboards` |
| OSD plugin: ML client | `mlCommonsDashboards` |
| Admin certificate directory | `/etc/wazuh-indexer/certs/` |

---

## 7. Feature 3: Network Topology Visualisation Plugin

### 7.1 Overview

The Network Graph plugin (`networkGraph`) adds a live, interactive D3.js force-directed graph to the Wazuh Dashboard sidebar. The graph displays all Wazuh agents connected to the manager, with edges colour-coded by the highest alert severity observed for each agent in the preceding five minutes. The plugin is accessible at `/app/networkGraph` and refreshes automatically every ten seconds.

### 7.2 Graph Semantics

The graph represents the agent-manager topology as a force-directed layout:

- **Manager node**: A large blue circle labelled `MGR` at the centre, corresponding to agent ID `000`.
- **Agent nodes**: Smaller circles labelled with OS type (`WIN`, `DEB`, `RPM`, `LNX`). Active agents have a teal outline; disconnected agents have a grey outline.
- **Manager edges**: One undirected edge per agent, colour-coded by the highest `rule.level` in recent alerts.
- **Peer edges**: Dashed directed edges between two agents when alerts contain matching `data.srcip`/`data.dstip` values cross-referenced against known agent IP addresses, indicating potential lateral movement or inter-agent communication events.

**Edge colour scheme:**

| Colour | Condition | Rule Level |
|--------|-----------|-----------|
| Grey | No recent alerts | — |
| Green | Low severity alerts | < 7 |
| Yellow | Medium severity alerts | 7–11 |
| Red | High severity alerts | ≥ 12 |

### 7.3 Server-Side Architecture

The browser does not communicate with the Wazuh API directly. All API traffic is proxied through two OSD server-side routes:

- `GET /api/network_graph/agents` → `GET https://localhost:55000/agents?limit=500&select=id,name,ip,status,os.name`
- `GET /api/network_graph/alerts` → `GET https://localhost:55000/alerts?limit=500&q=timestamp>5-minutes-ago`

The server-side proxy caches the Wazuh JWT token for 14 minutes (Wazuh tokens expire after 15 minutes). On expiry or receipt of Wazuh error code 6 (invalid token), the cache is cleared and a fresh token is fetched automatically. This design ensures that regardless of the number of active browser clients, the Wazuh authentication endpoint is invoked at most once per 14-minute window.

The `rejectUnauthorized: false` flag is set on the HTTPS agent to handle the manager's self-signed certificate.

### 7.4 Build Configuration

The plugin's browser bundle is produced by webpack 5, with D3.js v7 bundled inline. The final minified bundle is approximately 291 KB. The plugin declares `"requiredPlugins": ["navigation"]` in its OSD manifest to ensure the navigation sidebar is ready before the plugin registers its application entry.

### 7.5 Verified Features

| Feature | Status |
|---------|--------|
| Plugin loads in OSD (server-side and browser-side) | Verified |
| "Network Graph" entry in Wazuh sidebar | Verified |
| Manager node and agent nodes rendered | Verified with three test agents |
| Agent-to-manager edges displayed | Verified (grey — no alerts during test) |
| Ten-second auto-polling | Verified |
| Draggable nodes | Implemented; D3 drag behaviour |
| Zoom and pan | Implemented; D3 zoom behaviour |
| Hover tooltips (name, IP, OS, status) | Implemented |
| Server-side JWT proxy | Verified |
| Edge colour grading (green/yellow/red) | Implemented; requires live alerts to validate |
| Agent-to-agent peer edges | Implemented; requires alerts with srcip/dstip |

---

## 8. Feature 4: Natural Language Query Search — The Sec-IR Pipeline

### 8.1 Overview and Research Contribution

The Natural Language Query (NLQ) Search feature is one of the most technically significant and original contributions of this project. Rather than prompting a large language model to emit SIEM query syntax directly — an approach that is demonstrably fragile and vendor-locked — the team designed and built **Sec-IR** (Security Intermediate Representation): a schema-constrained structured JSON representation that decouples natural language understanding from deterministic query generation.

The work produced a complete, independently evaluated pipeline spanning schema design, two LLM backends, a self-correcting parser, three deterministic transpilers (Elastic EQL, Splunk SPL, and Wazuh DSL), a 240-query labelled evaluation dataset, a field-level evaluation harness, and nine sessions of iterative prompt tuning. The methodology and findings of this work have been written up as a research paper.

> **Research Paper:** _"Sec-IR: A Schema-Constrained Intermediate Representation for Natural Language to SIEM Query Translation"_
> **Authors:** [_To be confirmed — FYP team, IBA Karachi_]
> **Submitted to:** [_Submission venue — to be confirmed_]
> **Status:** [_Under review / Published — to be confirmed_]

The pipeline was subsequently integrated into the Wazuh Dashboard as the `nlqSearch` OpenSearch Dashboards plugin, which is the component a SOC analyst interacts with directly.

---

### 8.2 Design Rationale — Why an Intermediate Representation?

Direct LLM-to-query approaches suffer from three well-documented problems. First, LLMs frequently emit syntactically invalid query syntax, particularly for domain-specific languages like Elastic EQL or OpenSearch DSL. Second, a query emitted directly for one platform cannot be translated to another without a second LLM call. Third, there is no natural audit or edit point between the analyst's intent and the executed query.

Sec-IR resolves all three by inserting a schema-constrained JSON object as the sole output of the LLM call.

The upgraded pipeline in the `sec-ir` research repo is a **7-stage architecture**. Stages 1–2 are research-side pre-processing; the `nlqSearch` production plugin implements stages 3–7.

```
[RESEARCH REPO — sec-ir]
Stage 1  Pre-ambiguity detection (ambiguity.py)
         │  rule-based: boolean scope, vague numbers, time boundaries,
         │  implicit negation — unresolvable queries halt with clarification
         ▼
Stage 2  Annotation normaliser
         │  compact single-turn prompt hints built from stage 1 output
         ▼

[PRODUCTION PLUGIN — nlqSearch  (stages 3–7)]
Stage 3  LLM call (parser.py / routes/index.js)
         │  accepts prompt_hints; time-range pre-processor runs first (regex)
         │  One LLM call → Sec-IR JSON  ←── schema-validated, human-editable
         ▼
Stage 4  Schema validation (validator.py / validator.js)
         │  errors → self-correction loop (up to 2 retries)
         ▼
Stage 5  Capability validation (capability_validator.py)
         │  per-backend matrix: event types, patterns, time ranges, aggregations
         ▼
Stage 6  Fuzzy field resolution (field_resolver.py)
         │  deterministic fuzzy mapping with scored ranking
         ▼
Stage 7  Deterministic transpile (transpiler/*.py / transpiler.js)
         │  no LLM involvement
         ▼
Platform queries  →  Elastic EQL | Splunk SPL | Wazuh DSL | Sentinel KQL
```

Query correctness is enforced by code, not by the LLM. The LLM's responsibility is reduced to classifying the analyst's intent into a small, well-defined structure. A downstream transpiler — with no LLM involvement — converts that structure into syntactically correct platform queries. Adding a new target platform requires writing one new transpiler file; nothing upstream changes.

---

### 8.3 The Sec-IR Schema

The Sec-IR schema (JSON Schema Draft-07) defines nine fields (eight required, one optional added in the upgraded pipeline):

| Field | Type | Description |
|-------|------|-------------|
| `sec_ir_version` | string | Schema version (`"1.0"`) |
| `event_type` | enum (10 values) | Security event category |
| `pattern` | enum (5 values) | Query structure / detection pattern |
| `entity` | object | Field bindings (user, src\_ip, host, process, user\_role, and Wazuh-specific extensions `process_path`, `command_line`) |
| `severity` | enum (6 values) | Alert severity filter |
| `time_range` | oneOf (relative \| absolute) | Temporal scope. Relative values accept any flexible `last_<n><m\|h\|d>` (e.g. `last_14d`, `last_365d`, `last_90m`). |
| `aggregation` | nullable object | Threshold + grouping (for repeated\_attempts, spike) |
| `correlation` | nullable object | Event sequence definition (for sequence pattern) |
| `analytics` | optional object | SIEM analytics plan for listing/reporting/summarisation/chart queries. Contains `source` (table/index name) and `operations` (where, summarize, project, sort, limit, render, etc.). `null` for detection queries. |

**Event type taxonomy (ten categories across five domains):**

| Domain | Event Types |
|--------|-------------|
| Authentication | `authentication_failure`, `privilege_escalation` |
| Network | `lateral_movement`, `port_scan` |
| Endpoint | `process_injection`, `file_deletion` |
| Threat | `malware_alert`, `ransomware_behavior` |
| Compliance | `policy_violation`, `data_exfiltration` |

**Query pattern taxonomy (five types):**

| Pattern | Semantic | Query Structure |
|---------|----------|-----------------|
| `single_event` | Any single matching event | `any where …` (EQL) |
| `repeated_attempts` | Same event ≥ N times | `sequence … with runs=N` (EQL) |
| `spike` | Anomalous volume surge | Approximated as repeated\_attempts with threshold |
| `sequence` | Event A followed by event B, same actor | Multi-step `sequence by … with maxspan` (EQL) |
| `absence` | Expected event did not occur | `not ( any where … )` (EQL) |

**Entity field mapping across platforms:**

| IR Key | Elastic EQL | Splunk SPL | Wazuh DSL |
|--------|------------|------------|-----------|
| `user` | `user.name` | `user` | `data.win.eventdata.targetUserName` |
| `user_role` | `user.roles` | `user_role` | `data.win.eventdata.memberSid` |
| `src_ip` | `source.ip` | `src_ip` | `data.srcip` |
| `host` | `host.hostname` | `host` | `agent.name` |
| `process` | `process.name` | `process` | `data.win.eventdata.image` |
| `process_path` | `process.executable` | `process_path` | `data.win.eventdata.image` _(Wazuh extension)_ |
| `command_line` | `process.command_line` | `command_line` | `data.win.eventdata.commandLine` _(Wazuh extension)_ |

`process_path` and `command_line` are Wazuh-specific entity key extensions added to support Windows process telemetry fields that are frequently referenced in security detection rules but absent from the base five entity keys.

**Severity mapping to Wazuh rule levels:**

| Sec-IR Severity | Wazuh `rule.level` Range |
|-----------------|--------------------------|
| `info` | 1–3 |
| `low` | 4–6 |
| `medium` | 7–9 |
| `high` | 10–12 |
| `critical` | 13–15 |
| `any` | No filter applied |

---

### 8.4 System Components Built

The complete Sec-IR pipeline was built from scratch across ten development sessions:

#### 8.4.1 `schema.json`
JSON Schema (Draft-07) definition of the full Sec-IR structure, including oneOf constraints for time range types, nullability rules for aggregation and correlation, and enum constraints for all categorical fields.

#### 8.4.2 `validator.py` / `validator.js`
A schema validator implemented in both Python (using `jsonschema` Draft7Validator) and as a zero-dependency manual JavaScript reimplementation for use inside the OSD plugin (where npm dependency conflicts with OSD's bundled packages precluded importing a JSON schema library). The validator returns a list of `{field, message}` objects for every violation, enabling targeted self-correction prompts.

#### 8.4.3 `transpiler/elastic.py`, `transpiler/splunk.py`, `transpiler/wazuh.py`
Three independent deterministic transpilers that convert a validated Sec-IR object into platform-specific query syntax. All are pure Python with no LLM involvement. The Wazuh transpiler emits OpenSearch bool query DSL. For patterns not natively expressible in Wazuh (sequence queries, spike detection), the transpiler emits a best-effort approximation along with a `_meta.note` field describing the limitation transparently.

#### 8.4.4 `parser.py` — LLM Parser with Self-Correction
The parser submits the analyst's query to the LLM with a structured system prompt containing the schema summary, severity inference rules, garbage refusal instructions, event-type disambiguation rules, and seven few-shot examples. The response is validated immediately; if validation fails, the LLM is re-invoked with a self-correction prompt listing the violated fields. Up to two correction rounds are attempted. In the measured evaluation, `avg_correction_rounds = 0.09`, meaning the self-correction loop fires on fewer than 10% of queries.

The parser supports two backends:
- **Gemini** (cloud): `google-genai` SDK, `gemini-2.5-flash` model, `response_mime_type="application/json"` for structured output.
- **Ollama** (local/offline): HTTP streaming API, `format: {"type": "object"}` (Ollama 0.5+ structured output syntax), `num_gpu: 99` for full GPU offload. Supports any locally pulled model; `gemma4:e4b` is recommended.

#### 8.4.5 Time-Range Pre-Processor
A deterministic regex pre-processor (`_extract_time_range`) scans the query for temporal expressions before the LLM call. Recognised patterns include "in the last N hours", "past N days", "over the last N weeks", "for more than N minutes". When a match is found, a `[DETECTED TIME WINDOW: use time_range value "last_Xh" exactly]` hint is injected into the prompt. Snap strategy is ceiling (round up): under-approximating a security time window silently drops events, which is a worse failure mode than over-querying. The "within N minutes" phrasing is intentionally excluded — it specifies a sequence `maxspan`, not a lookback window.

This pre-processor was added in parser version 4 after post-eval manual testing revealed that the LLM defaulted to `last_24h` for any non-standard time window (e.g., "more than 1 hour", "in the past 30 minutes"), because the few-shot examples only demonstrated canonical values.

#### 8.4.6 Upgraded Pipeline Components (Research Repo)

The following modules were added to the `sec-ir` research repository as part of the pipeline upgrade to the 7-stage architecture. They are not shipped inside the `nlqSearch` OSD plugin but are available for pre-processing before the plugin is invoked, or for multi-platform evaluation use.

**`ambiguity.py`** — Rule-based pre-ambiguity detection (Stage 1). Checks for boolean scope ambiguity ("logins or scans from admin" — two events or one?), vague numeric thresholds ("many", "a lot"), unresolvable time boundaries ("last shift", "over the weekend"), and implicit negation without clear scope. Queries that cannot be resolved deterministically halt with a structured clarification prompt rather than proceeding to the LLM with an underspecified input.

**`capability_validator.py`** — Per-backend capability matrix (Stage 5). Validates that the Sec-IR object's event type, pattern, time range, and aggregation fields are supported by the target backend before transpilation is attempted. Returns a structured capability gap report if the IR requests a feature not available for the chosen backend (e.g., native sequence queries on Wazuh DSL).

**`field_resolver.py`** — Deterministic fuzzy field mapping (Stage 6). Maps free-form entity field references to canonical platform field names using scored fuzzy matching. Returns a ranked list of candidate mappings with confidence scores, enabling the transpiler to choose the highest-ranked field without LLM involvement.

**`transpiler/sentinel.py`** — Sec-IR → Microsoft Sentinel KQL transpiler. Converts validated Sec-IR objects into Sentinel KQL queries. Evaluated on 197 native Sentinel NLQs; achieved 0.85 average KQL closeness after refiner improvements.

**`transpiler/analytics_bridge.py`** — Analytics IR → KQL bridge. Converts the `analytics` field of a Sec-IR object into a KQL analytics query (summarize, project, sort, render operations) for Elastic, Splunk, and Sentinel targets.

Supporting modules also added: `schema_registration.py` (optional schema cache from SIEM metadata), `platform_pipeline.py` (analytics gating and backend hints), `sentinel_nlq_hints.py` (analytics prompt hints from NLQ keywords), `sentinel_nlq_refiners.py` (post-parse IR patches for Sentinel accuracy), `sentinel_translation.py` (Sentinel KQL → Elastic/Splunk/Wazuh best-effort cross-platform translation).

---

### 8.5 Evaluation Dataset

The team constructed a 180-entry labelled evaluation dataset (`eval_dataset/`) to measure the parser's accuracy systematically. The dataset is structured in three tiers:

**Tier 1 — Gold Standard (`tier1_ground_truth.json`, 60 entries):**
Hand-crafted by the team. Each entry contains two NLQ phrasings of the same underlying query — one formal (SOC analyst register) and one casual (conversational) — plus the expected Sec-IR object and annotation rationale. This dual-phrasing design enables evaluation of phrasing robustness. Coverage: all 10 event types (minimum 3 instances each), all 5 patterns (minimum 6 instances each), 3 absolute time ranges, 7 multi-entity entries, all 6 severity values represented.

**Tier 2 — SIGMA-Derived (`tier2_sigma_derived.json`, 80 entries):**
Based on real-world SIGMA-style detection scenarios. Each entry specifies the detection context (Mimikatz credential dumping, PowerShell abuse, PsExec lateral movement, ransomware shadow-copy deletion, DNS tunnelling, log clearing, etc.) alongside the NLQ an analyst would plausibly submit. All 10 event types and all 5 patterns are represented.

**Tier 3 — Adversarial (`tier3_adversarial.json`, 40 entries):**
Deliberately tricky edge cases distributed across eight categories:

| Category | Count | Example |
|----------|-------|---------|
| temporal\_ambiguity | 6 | "last shift", "since this morning", "over the weekend" |
| absence\_confusion | 5 | "users who did NOT log in", "everything except X" |
| multi\_entity | 4 | Queries with 3+ entity fields simultaneously |
| pattern\_ambiguity | 5 | "lots of", "unusual number of", "a burst of" |
| compound\_sequence | 5 | 3-event temporal chain (correlation.events with 3 items) |
| vague\_severity | 4 | "serious events", "critical stuff only" |
| implied\_entity | 5 | "check the Exchange server", "look at service accounts" |
| garbage\_input | 6 | "what is the weather", "explain EQL", "hello" (should\_fail=true) |

All 174 non-garbage entries pass schema validation. 6 garbage entries have `should_fail: true` and `expected_ir: null`. Total NLQ strings: **240** (60 tier-1 entries × 2 phrasings + 80 + 40).

---

### 8.6 Evaluation Methodology

The evaluation harness (`eval_harness.py`) runs each NLQ string through the parser and performs field-level comparison against the expected IR. Seven fields are checked independently:

| Field | What it measures |
|-------|-----------------|
| `event_type` | Correct security event category |
| `pattern` | Correct query structure |
| `severity` | Correct severity inference |
| `time_range` | Correct temporal scope |
| `entity` | All expected key-value pairs present and correct |
| `aggregation` | Threshold and group\_by (set comparison, order-independent) |
| `correlation` | Events list (ordered) and maxspan correct |

**Composite metrics:**
- **Semantic match**: `event_type` AND `pattern` both correct — the primary metric, answering "did the system understand what to detect and how?"
- **Full match**: All 7 fields correct simultaneously
- **Structural match**: All 6 fields except `severity` correct (a "will this generate a working query?" metric, since severity is alert-routing metadata and does not affect the emitted DSL)
- **Schema valid**: Parser returned a schema-valid IR (or correctly refused garbage input)
- **Garbage rejection**: `should_fail=true` entries where the parser correctly returned invalid/no IR

---

### 8.7 Model Comparison — phi3.5 vs. gemma4:e4b vs. qwen2.5:7b

The first full evaluation run compared two locally-runnable models on the complete 240-NLQ dataset via an SSH-tunnelled remote GPU (Tailscale, NVIDIA):

| Metric | phi3.5 (2.2 GB) | gemma4:e4b (9.8 GB) | Δ |
|--------|----------------|---------------------|---|
| Schema valid | 78.2% | 94.9% | +16.7 pp |
| Semantic match | 59.4% | 65.8% | +6.4 pp |
| Full match | 14.1% | 16.2% | +2.1 pp |
| Garbage rejection | 16.7% | 50.0% | +33.3 pp |
| Avg correction rounds | 0.61 | 0.12 | −0.49 |
| Avg inference time | ~3.74 s | ~8.87 s | +5.1 s |

gemma4:e4b outperforms phi3.5 on every accuracy metric, with dramatically fewer correction rounds. phi3.5 is preferable only when latency is the primary constraint and accuracy is secondary. gemma4:e4b was selected as the primary model for all subsequent evaluation and prompt tuning on the classic detection-only query dataset.

**Upgraded pipeline — model update (2026-06):** Following the addition of Sentinel KQL support, analytics queries, and the 7-stage pipeline, `qwen2.5:7b` is now the recommended Ollama model for the full upgraded pipeline. Evaluation on the Sentinel-native benchmark (197 NLQs) and analytics query set showed `qwen2.5:7b` producing superior KQL output and more accurate `analytics` field population than `gemma4:e4b`. `gemma4:e4b` remains the stronger model for classic detection-only queries (the original 240-NLQ dataset). The recommended model choice therefore depends on the query workload:

| Use case | Recommended model |
|----------|-----------------|
| Classic detection queries (auth failure, lateral movement, etc.) | `gemma4:e4b` |
| Sentinel KQL, analytics/reporting queries, full 7-stage pipeline | `qwen2.5:7b` |
| Minimal resource footprint, latency-critical | `phi3.5` |

---

### 8.8 Prompt Tuning — Nine Iterations

The system prompt underwent nine development iterations, with quantitative evaluation after each major intervention:

**Version 1 (baseline):** Schema summary, 3 few-shot examples. Severity accuracy: 42.3%. Garbage rejection: 50%.

**Version 2 (+severity rules, +garbage refusal):** Explicit severity inference rules added (e.g., brute force → high; absence queries → info; ransomware/data exfiltration → critical). Refusal instruction added: "if the query is not a security detection question, output `{"error": "not_a_security_query"}`." **Result: garbage rejection 50.0% → 83.3% (+33.3 pp).** Severity showed minimal response (~1 pp improvement), revealing a dataset calibration issue (see §8.9).

**Version 3 (+event_type disambiguation, +targeted few-shot):** Analysis of the v2 confusion matrix identified the five most-confused event_type pairs. An explicit disambiguation block was added to the prompt (e.g., "vssadmin deleting shadow copies is `ransomware_behavior`, not `file_deletion`"; "AD replication from a non-DC is `privilege_escalation`"). Three targeted few-shot examples were added. **Results:**

Targeted confusion pairs resolved:

| Confusion pair | v2 count | v3 count | Change |
|---------------|---------|---------|--------|
| privilege\_escalation → policy\_violation | 9 | 1 | **−8** |
| malware\_alert → process\_injection | 3 | 0 | **−3** |
| ransomware\_behavior → file\_deletion | 3 | 0 | **−3** |
| malware\_alert → data\_exfiltration | 4 | 2 | −2 |

Aggregate metric movement (v2 → v3):

| Metric | v2 | v3 | Δ |
|--------|----|----|---|
| event\_type accuracy | 74.8% | 76.1% | **+1.3** |
| semantic match | 66.2% | 67.9% | **+1.7** |
| aggregation | 79.9% | 81.2% | +1.3 |
| pattern | 88.5% | 88.0% | −0.5 |
| time\_range | 88.5% | 87.2% | −1.3 |
| full match | 30.8% | 29.5% | −1.3 |

**Finding:** Targeted disambiguation rules are effective for specific confusion pairs but on a 4B-parameter model, expanding the system prompt by ~60 lines introduces compensating regressions on other fields — a prompt-length noise floor. A more compact formulation or a larger model would likely convert the targeted wins into a full-match improvement without the compensating noise.

**Version 4 (+time-range pre-processor, +sequence disambiguation):** Deterministic pre-processing of time expressions added before LLM invocation, and an explicit sequence/repeated\_attempts disambiguation rule added. These fixes addressed the two most consistently observed post-eval failure modes from manual testing.

---

### 8.9 Severity Relabelling — Methodology Note

After the v2 eval, severity accuracy was measured at 43.2% — anomalously low compared to all other fields (pattern: 88.5%, correlation: 89.7%). Auditing the 133 severity mismatches revealed a systematic pattern:

- `high → medium`: 45 cases (mostly port\_scan and file\_deletion — model followed prompt rules, dataset used different conventions)
- `critical → high` and `critical → medium`: 39 cases (dataset over-labelled entries as critical)
- `any → specific`: 27 cases (dataset labelled entries "any" where the tuned prompt's rules assign a concrete value)

The root cause was a **prompt-dataset skew**: the evaluation dataset had been labelled before severity inference rules were added to the system prompt in version 2. The two had divergent mental models of severity, and the evaluation was measuring their disagreement rather than genuine model error.

A relabelling script (`eval_dataset/relabel_severity.py`) was written to apply the prompt's canonical rules to every dataset entry. The relabelling logic:

| Rule (checked in order) | Assigned Severity |
|------------------------|-------------------|
| `pattern == "absence"` (event did NOT occur) | `info` |
| `pattern == "sequence"` (multi-stage correlated) | `critical` |
| `event_type ∈ {ransomware_behavior, data_exfiltration}` | `critical` |
| `event_type ∈ {privilege_escalation, lateral_movement, malware_alert, process_injection}` | `high` |
| `authentication_failure + repeated_attempts/spike` (brute force) | `high` |
| `event_type ∈ {port_scan, policy_violation, file_deletion}` | `medium` |
| `authentication_failure + single_event` (isolated failure) | `low` |

Two guardrails prevent over-correction: the absence check runs first (preventing `data_exfiltration + absence` from being misclassified as critical), and a one-step downgrade cap preserves domain-context severity for entries like "Zerologon-style null credential authentication" (where the query context justifies critical even though the IR structure alone would suggest low). 90 of 174 labelled entries were relabelled.

**Post-relabel severity accuracy: 70.5% (+27.3 pp over the pre-relabel figure of 43.2%).** Both figures are reported in the interest of methodological transparency.

---

### 8.10 Final Evaluation Results

The recommended configuration — gemma4:e4b on a GPU via Ollama, prompt v3, v2-relabelled dataset, 240 NLQ strings — produced the following results:

**Summary metrics:**

| Metric | Score |
|--------|-------|
| Schema valid | **97.4%** |
| Semantic match (event\_type + pattern) | **67.9%** |
| Full match (all 7 fields) | **29.5%** |
| Structural match (6 fields, excl. severity) | **39.3%** |
| Garbage rejection | **83.3%** |
| Avg correction rounds | **0.09** |
| Avg inference time (GPU, streaming) | **~2.2 s** |

**Field-level accuracy (v3, gemma4:e4b):**

| Field | Accuracy |
|-------|----------|
| correlation | 89.3% |
| pattern | 88.0% |
| time\_range | 87.2% |
| entity | 82.5% |
| aggregation | 81.2% |
| event\_type | 76.1% |
| severity | 69.7% |

**Sentinel KQL benchmark (upgraded pipeline, qwen2.5:7b):**

A separate evaluation was conducted on a new Sentinel-native benchmark dataset (`eval_dataset/Sentinel_Evaluation.jsonl`) consisting of 197 NLQ + native KQL baseline pairs sourced from Microsoft Sentinel documentation and detection scenarios. This benchmark measures KQL output closeness (a continuous 0–1 similarity metric) rather than field-level IR accuracy.

| Metric | Score |
|--------|-------|
| Dataset size | 197 NLQ + KQL pairs |
| Avg KQL closeness (before refiner improvements) | 0.62 |
| Avg KQL closeness (after `sentinel_nlq_refiners.py` + upgraded transpiler) | **0.85** |
| Model | qwen2.5:7b (Ollama) |

The 0.85 average closeness reflects the contribution of both the Sentinel-specific system prompt hints (`sentinel_nlq_hints.py`) and the post-parse IR patches (`sentinel_nlq_refiners.py`) that correct known Sentinel-specific IR translation gaps before transpilation. The Sentinel transpiler and benchmark are research-repo components; the `nlqSearch` plugin targets Wazuh DSL / OpenSearch.

---

### 8.11 Metric Interpretation

The 29.5% full match rate requires contextual interpretation. Full match is a multiplicative metric: all seven field checks must be correct simultaneously. With field accuracies ranging from 69.7% to 89.3%, the independent-error lower bound is:

> 0.748 × 0.885 × 0.705 × 0.885 × 0.825 × 0.799 × 0.897 ≈ **24.4%**

The actual full match of 29.5% is **+5.1 points above this baseline**. A positive lift indicates that errors are *correlated*: when the model misunderstands a query, it tends to get several fields wrong on the same query (concentrated failure). Conversely, on queries it understands, it tends to get most fields right. This is the desired failure mode — failure is concentrated on a small number of hard queries rather than uniformly distributed.

**Distribution of correct fields per query:**

| Correct fields | Count | % of queries |
|---------------|-------|-------------|
| 7 / 7 (full match) | 71 | 29.5% |
| 6 / 7 | 66 | 27.5% |
| 5 / 7 | 76 | 31.7% |
| ≤ 4 / 7 | 27 | 11.3% |

**57% of queries are correct on at least 6 of 7 fields. Only 11.3% are "catastrophically wrong" (more than 2 fields incorrect).** The median query is off by one field.

Among the 66 queries that scored 6/7 (exactly one field incorrect), the sole-miss field distribution was:

| Field | Count | % of 6/7 queries |
|-------|-------|-----------------|
| severity | 20 | 30.3% |
| aggregation | 16 | 24.2% |
| entity | 14 | 21.2% |
| time\_range | 9 | 13.6% |
| event\_type | 4 | 6.1% |
| pattern | 3 | 4.5% |

Severity dominates the one-field-off bucket, but since severity is alert-routing metadata that does not affect the emitted SIEM query's correctness, the more actionable metric is **structural match** (all fields except severity correct): **39.3% of queries produce a structurally correct SIEM query**. This is the closest available approximation to a "will this query actually work?" rate.

Among the 27 catastrophic (≤4/7) queries, `event_type` errors are the primary driver: when the model misclassifies the event type at the root, downstream entity, aggregation, and temporal fields tend to be wrong in concert.

**The primary metric of the research is semantic match — at 67.9%, a 4B-parameter locally-runnable model with zero fine-tuning correctly understands 2 out of every 3 security queries it receives.**

---

### 8.12 Integration into the Wazuh Dashboard Plugin

The complete Sec-IR pipeline was integrated into the `nlqSearch` OpenSearch Dashboards plugin. The server-side component reimplements the Python parser, validator, and Wazuh transpiler in JavaScript (Node.js 18), preserving identical field mappings, schema constraints, and self-correction logic. The reimplementation was necessary because OSD's server-side plugin environment runs in Node.js, and the Python dependencies (`jsonschema`, `google-genai`) cannot be loaded directly.

The plugin schema, validator, and transpiler have been updated to handle the upgraded Sec-IR schema. The `analytics` field is recognised and validated by `validator.js`; when present in the IR, the transpiler passes it through in the response alongside the Wazuh DSL query. The flexible `time_range.value` pattern (`^last_[0-9]+[mhd]$`) replaces the previous fixed set, and `transpiler.js` generates the correct OpenSearch date math dynamically (e.g., `last_14d` → `now-14d`) without a lookup table. These changes are fully backward-compatible: existing detection queries with values like `last_24h` continue to work without modification.

The plugin exposes two analyst interfaces:

**Standalone page (`/app/nlqSearch`):** A full-featured query builder with an editable Sec-IR JSON panel (allowing analysts to inspect and modify the IR before execution), a raw DSL display, a re-transpile button (regenerates DSL from a modified IR without a second LLM call), and a results table. When the IR contains an `analytics` field, it is displayed in the JSON panel alongside the detection query fields.

**Global EN toggle:** An "EN" button injected adjacent to the "DQL" language selector on every Wazuh module page (Security Events, GDPR, Malware Detection, Vulnerability, etc.). When active, pressing Enter in the search bar triggers NLQ translation and auto-submits the resulting DQL string. The existing time-picker on each module page is preserved — the translation pipeline omits the time range from the DQL string, deferring to the page's own temporal filter.

### 8.13 API Endpoints

| Route | Method | Description |
|-------|--------|-------------|
| `/api/nlq_search/translate` | POST | Plain English → Sec-IR + Wazuh DSL (LLM call + validator + transpiler) |
| `/api/nlq_search/execute` | POST | Executes an OpenSearch DSL query against `wazuh-alerts-*` |
| `/api/nlq_search/retranspile` | POST | Regenerates DSL from an edited IR object (deterministic, no LLM call) |

### 8.14 Backend Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `NLQ_BACKEND` | `groq` | LLM backend: `groq` \| `gemini` \| `ollama` |
| `GROQ_API_KEY` | _(required for groq)_ | Groq API key (console.groq.com) |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model name |
| `GEMINI_API_KEY` | _(required for gemini)_ | Google AI Studio API key |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model name |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL (for offline operation) |
| `OLLAMA_MODEL` | `qwen2.5:7b` | Ollama model name (recommended for full pipeline; `gemma4:e4b` for detection-only) |
| `INDEXER_PASSWORD` | _(required)_ | Wazuh Indexer admin password |

Auto-detection: when `NLQ_BACKEND` is not explicitly set, the plugin selects the backend by key presence: Groq → Gemini → Ollama. Groq was added as the preferred default in April 2026 to avoid Gemini free-tier rate limits.

---

## 9. Feature 5: Comparative Compliance View Plugin

### 9.1 Overview

The Compliance View plugin (`complianceView`) provides a unified dashboard comparing alert coverage across all six compliance frameworks simultaneously: PCI DSS, HIPAA, GDPR, NIST 800-53, TSC, and PECA. It is accessible as a native module within the Wazuh Security Operations sidebar at order 400.5 (between IT Hygiene at order 400 and PCI DSS at order 401).

### 9.2 Dashboard Components

**Framework Summary Row**: Six cards, one per framework, each displaying the total alert count for the selected time range and a colour-coded status indicator (green: fewer than 10 alerts; yellow: 10–50; red: more than 50). Cards are interactive and scroll to the corresponding section in the detail table.

**Comparative Requirements Table**: A single sortable, filterable table aggregating all compliance clauses and sections from all active frameworks. Columns: Framework · Section/Clause · Description · Alert Count · Severity Breakdown (coloured dots for info/low/medium/high/critical) · Last Alert timestamp. Framework visibility can be toggled per-framework without reloading data from the server.

**Cross-Framework Overlap Matrix**: A heatmap showing the number of alerts that simultaneously triggered violations in two frameworks. The diagonal shows each framework's own total. Off-diagonal cells are colour-scaled from transparent (no co-occurring alerts) to red (maximum co-occurrence). This view is intended to help analysts identify incidents with multi-regulatory impact.

### 9.3 Data Sources

| Framework | OpenSearch Field | Filter Method |
|-----------|-----------------|---------------|
| PCI DSS | `rule.pci_dss` | `exists` filter |
| HIPAA | `rule.hipaa` | `exists` filter |
| GDPR | `rule.gdpr` | `exists` filter |
| NIST 800-53 | `rule.nist_800_53` | `exists` filter |
| TSC | `rule.tsc` | `exists` filter |
| PECA | `rule.groups` | `term: "peca"` filter |

The built-in frameworks expose alerts through dedicated per-framework fields populated by the Wazuh rules engine. PECA alerts are identified via `rule.groups`, consistent with the tagging approach in the PECA rules module.

### 9.4 Server-Side Design

The plugin exposes three API routes, all querying OpenSearch directly on port 9200 using admin credentials:

- `GET /api/compliance_view/summary?time_range=<range>`: Returns total alert counts per framework using a single `_search` request with one filter aggregation per framework.
- `GET /api/compliance_view/details?framework=<key>&time_range=<range>`: Returns section-level breakdown for one framework, with nested severity aggregations (range on `rule.level`) and a max-timestamp aggregation per section.
- `GET /api/compliance_view/overlap?time_range=<range>`: Returns the 6×6 co-occurrence matrix using nested filter aggregations, computing all 36 pairs in a single request.

Supported `time_range` values: `24h` (default), `7d`, `30d`.

### 9.5 Native Dashboard Integration via Bundle Patching

The Compliance Overview is integrated into the Wazuh Security Operations sidebar through the same bundle patching mechanism used for the PECA module. The `patch_bundles.py` script applies patches across two files plus a set of upgrade patches for already-installed bundles (P13–P18b):

**`wazuh.chunk.2.js` (patches P1–P6):**
- P1: Catalog map entries for `peca` and `compliance-overview`
- P2–P3: Agent and overview tab count registrations
- P4: Injection of `mountComplianceOverview()` (vanilla JS dashboard function, ~12 KB single-line), `ComplianceOverviewPanel` (React wrapper), and `peca_data_source_PECADataSource` class
- P5: `pecaColumns` column definition
- P6: Module tab definitions for both modules

**`wazuh.plugin.js` (patches P7–P12):**
- P7a: Pre-clean removal of any legacy `peca_app` duplicate from old installs
- P7b: `const peca={...}` constant definition at `order:406`
- P7c: `const compliance_overview_app={...}` constant at `order:400.5` (between IT Hygiene and PCI DSS)
- P8–P9: Both constants inserted into the app registration array
- P10–P12: Upgrade patches correcting theme CSS and ordering in already-installed bundles

**Upgrade patches for installed bundles (P13–P18b):**
Applied when the script detects an already-patched bundle that was installed before specific CSS fixes were available. P18 appends a complete dark-theme CSS block when the installed bundle is missing dark-mode styles. P18b sub-patches fix individual sub-element colours. These patches are anchored on unique marker strings; applying them to an already-fixed bundle is a safe no-op.

The script implements idempotency by checking for marker strings before applying each patch, allowing safe re-execution on an already-patched installation. Three install states are handled: fresh install (neither module present), partial install (compliance overview present but PECA absent — the state produced by an earlier defective version of the script), and fully patched.

The plugin has `"ui": false` in its OSD manifest — no public JavaScript bundle is built or served by OSD. The full dashboard UI (`mountComplianceOverview`, CSS, and React wrapper) is injected entirely into the Wazuh bundles by `patch_bundles.py`; the server-side plugin provides only the three API routes.

---

## 10. Feature 6: Localization and Dark Mode Plugin

### 10.1 Overview

The Localization plugin (`localization`) injects a persistent floating toolbar into every Wazuh Dashboard page, providing bilingual Urdu/English support and dark/light theming for the complete Wazuh Dashboard — including OSD chrome, EUI components, all four custom FYP plugins, and native Wazuh module pages. User preferences are stored in `localStorage` and persist across page reloads and navigation. The plugin was developed across sixteen iterative phases, expanding from an initial 68 strings to a final corpus of **1,012 unique EN→UR mappings** and **187 OSD native i18n keys**.

### 10.2 Dark Mode

Dark mode is implemented as a CSS injection: toggling the feature appends a `<style>` element containing comprehensive CSS rules targeting EUI class names, OSD chrome selectors, and all Wazuh-specific components. The CSS is injected synchronously at module load time (before `setup()` fires) so that the OSD initial loading screen and Wazuh health-check page render in dark mode from the first frame — eliminating any flash of white on initial load.

The dark mode covers not just the page chrome but also the dashboard loading screen (`.osdWelcomeView`), the Wazuh health-check page (`.healthCheck`), all Wazuh module navigation bars (`.wz-menu*`, `.wz-module-header-nav`), and the OSD application mount container. A `fyp-theme-changed` CustomEvent is dispatched on every theme change, enabling other plugins to react in real time.

**Dark mode colour palette:**

| Token | Value |
|-------|-------|
| Page background | `#0f172a` |
| Surface / cards | `#1e293b` |
| Header / sidebar | `#0d1527` |
| Border | `#334155` |
| Primary text | `#e2e8f0` |
| Secondary text | `#94a3b8` |
| Accent | `#3b82f6` |
| Danger | `#f87171` |
| Success | `#4ade80` |
| Warning | `#fb923c` |

The Compliance View plugin reads the `fyp_theme_v2` localStorage key and listens for the `fyp-theme-changed` event to apply its own scoped dark-theme CSS rules (injected into the Wazuh bundle via `patch_bundles.py`).

### 10.3 Urdu Localisation

The plugin maintains two locale files (`locales/en.json` and `locales/ur.json`) containing **1,012 key-value pairs** covering strings across the complete Wazuh Dashboard UI. Both files are bundled into the webpack output at build time.

**Translation architecture (three tracks):**

**Track A — Static DOM replacement:** `_applyReplaceMap(EN_TO_UR)` uses a `TreeWalker` to traverse every text node in `document.body`, replacing exact-trimmed matches from the 561-entry EN→UR map. A `MutationObserver` on `document.body`, debounced at 150 ms, re-applies translations after any DOM mutation to handle React re-renders.

**Track B — OSD native i18n:** `_ensureLocaleUrl('ur')` adds `?locale=ur-PK` to the URL and reloads. OSD's rendering service then serves the `translations/ur-PK.json` bundle (187 keys) to all React `<FormattedMessage>` components at startup. This covers pagination, EUI components, date pickers, toast notifications, all Wazuh app registration strings (`wz-app-*`), and seven hamburger nav section headers.

**Track C — Regex pattern translation:** `_applyPatternTranslations()` runs 49 compiled regex patterns for dynamic strings containing live numbers — pagination ("Showing 1–25 of 1,234"), severity counts ("5 Critical"), relative timestamps ("3 minutes ago"), time ranges ("Last N hours/days"), and agent/alert/event counts.

**Translation coverage — 1,012 unique EN→UR mappings:**

| Namespace | Keys | Coverage |
|-----------|------|----------|
| `cfg.*` | 386 | All Management → Configuration field labels (SMTP, SSL, syscheck, rootcheck, cluster, logging, cloud integrations, Osquery, SCA, etc.) |
| `desc.*` | 44 | Module descriptions and long-form app descriptions |
| `asst.*` | 33 | AI Assistant chatbot plugin UI strings |
| `chart.*` | 39 | Chart and visualization titles |
| `msg.*` | 50 | Status messages, errors, confirmations |
| `nav.*` | 32 | Sidebar navigation items |
| `agents.*` | 31 | Agent management page labels and columns |
| `sec.*` | 33 | Security module pages |
| `action.*` | 27 | Common action buttons |
| `ui.*` | 38 | Common UI labels and status strings |
| `wz.module.*` | 36 | All module card titles |
| `wz.desc.*` | 28 | Module card descriptions |
| Other | ~175 | Network Graph, NLQ Search, Compliance View, MITRE, FIM, CA, management, column headers, status labels |

**Dynamic string translation** is supported via a `_t(key)` / `_tFmt(key, vars)` helper pair exposed through `window.__fypLocale__`. Each plugin calls `_tFmt()` when assembling strings that contain runtime data (e.g., agent counts, timestamps). A `fyp-language-changed` window event is dispatched on language switches.

### 10.4 RTL Layout (Phase 10)

When Urdu is active, a `fyp-rtl` class is added to `<body>` and a comprehensive RTL stylesheet is injected, applying `direction: rtl` to page content areas, tables, badges, flyouts, modal bodies, and breadcrumbs — while keeping the header, collapsible nav, and sidebar in LTR. Accordion arrows are mirrored via `transform: scaleX(-1)`. Input fields, code blocks, and pre elements are explicitly excluded from RTL to preserve their LTR data entry behaviour.

### 10.5 Toolbar Implementation

The toolbar is rendered as a floating pill fixed to the bottom-right corner of every page. It is implemented as a `<dialog>` element activated via `dialog.show()` (non-modal). This choice addresses a layout issue specific to the OSD bootstrap animation: OSD applies a CSS `transform: scaleX()` to `<body>` during its React mount animation. Any `position: fixed` child element under a transformed ancestor loses viewport anchoring. By using a `<dialog>` element — promoted to the browser's top layer — the toolbar is immune to this transform behaviour and reliably anchors to the viewport regardless of OSD animation state.

### 10.6 Known Limitations

- **SVG text nodes**: Chart labels inside `<svg><text>` elements are not reached by the TreeWalker and remain in English.
- **150 ms flash**: There may be a brief flash of English text on heavy React re-renders before the MutationObserver re-applies translations.
- **Page reload on language switch**: Every language switch triggers a full page reload (required for OSD native i18n via `?locale=ur-PK`). There is no instant in-page toggle without reload.
- **Dynamic fragment concatenation**: Strings assembled from translated fragments and data values outside plugin code (e.g., inside third-party OSD components) are not translatable by the DOM text-node replacement approach.

---

## 11. Deployment and Installation Infrastructure

### 11.1 Setup Script

All features are deployed via a single Bash script (`setup.sh`) located at the repository root. The script supports selective installation through feature flags:

```bash
sudo bash setup.sh                              # install all features
sudo bash setup.sh --only networkGraph nlqSearch   # selective install
sudo bash setup.sh --skip complianceView           # exclude one feature
sudo bash setup.sh --list                          # list available features
sudo bash setup.sh --help                          # usage information
```

### 11.2 Feature Registry

| Feature Flag | Install Function | Description |
|-------------|-----------------|-------------|
| `pecaRules` | `install_pecaRules()` | Deploys `peca_rules.xml` to the Wazuh Manager |
| `aiAssistant` | `install_aiAssistant()` | MCP Server, LLM Gateway, Dashboard plugins, ML Commons |
| `networkGraph` | `install_networkGraph()` | Builds and installs the Network Graph OSD plugin |
| `nlqSearch` | `install_nlqSearch()` | Builds and installs the NLQ Search OSD plugin |
| `complianceView` | `install_complianceView()` | Installs plugin and patches Wazuh bundles |
| `localization` | `install_localization()` | Builds and installs the Localization plugin |

### 11.3 Error Handling and Idempotency

The script uses `set -uo pipefail` (without `-e`) to prevent a single feature failure from aborting the entire installation. Each feature function returns a non-zero exit code on failure; the main installation loop catches failures, continues with remaining features, and prints a summary table at completion.

Most steps are idempotent: existing Wazuh installations are detected and skipped; bundle patches check for marker strings before applying; service accounts are not recreated if they already exist. The Wazuh Dashboard is restarted once at the end of all feature installations rather than after each individual feature.

A `resolve_wazuh_passwords()` helper runs before the feature loop. It searches for `wazuh-install-files.tar` in four known locations and falls back to a filesystem search; on success it exports `WAZUH_API_PASSWORD` (used by `networkGraph`) and `WAZUH_INDEXER_PASSWORD` (used by `nlqSearch` and `complianceView`). Each plugin's install script reads these exported variables, eliminating the need for manual password entry on fresh deployments. If the tar is not found, each plugin prints a specific warning and continues without blocking the other features.

Bundle-patch scripts (`patch_plugin.py`, `patch_bundles.py`) now use a position-based fallback in addition to string anchors. If no string anchor matches the installed bundle state, the fallback locates the apps array by finding a stable identifier (`ITHygiene`) and inserts the new entry before `].sort(`. Failure of the fallback exits non-zero, surfacing the error in the installation summary rather than silently producing a broken installation.

### 11.4 Docker-Based Validation

The setup script was validated against a clean Wazuh 4.14.3 Docker stack (official single-node compose configuration) to verify reproducibility. Plugin installation (all features except `aiAssistant`, which requires interactive credential input and systemd) was performed inside the dashboard container. PECA rule deployment was performed inside the manager container. The PECA smoke test — feeding a synthetic SSH failure log line to `wazuh-logtest` — confirmed that rule 100100 fires with the expected groups `['peca', 'authentication_failed', 'peca_3']`.

---

## 12. Challenges and Incident Log

This section documents the principal technical challenges encountered during development, the diagnostic process, and the resolution applied in each case.

### 12.1 VirtualBox Shared Folder — npm Install Failure

**Symptom:** `npm install` exited with a permissions error when run from the shared folder.

**Cause:** The vboxsf filesystem does not support symbolic links. npm creates symlinks in `node_modules/.bin/` for CLI tool shortcuts; this fails on vboxsf.

**Resolution:** All install scripts copy source to `/tmp/` before running `npm install`. Build output is copied back to the shared folder after webpack completes. The `/tmp/` build directory is removed after each installation.

---

### 12.2 Network Graph — Plugin Registered Server-Side but Not Visible in Browser

**Symptom:** OSD server logs showed "Setting up networkGraph" and "Starting networkGraph", but the browser displayed "Error: Definition of plugin 'networkGraph' not found and may have failed to load."

**Cause:** The initial bundle entry point used `if (typeof __osdBundles__ !== 'undefined')`. webpack 5 with terser production mode may treat a bare unqualified identifier inside a `typeof` guard as dead code in module scope and eliminate the `define()` call.

**Resolution:** Changed to `if (typeof window !== 'undefined' && window.__osdBundles__)`. Property access on `window` is a dynamic lookup that terser cannot statically evaluate, ensuring the registration call is preserved.

---

### 12.3 NLQ Search — Plugin setup() Never Called

**Symptom:** The debug dot added to `setup()` was never visible; `window.__osdBundles__.get('plugin/nlqSearch/public')` returned the webpack require function rather than `{ plugin: ... }`.

**Cause:** The nlqSearch bundle had a single webpack module (ID 667). webpack 5 uses a different runtime code generation path for single-module bundles: the require call is emitted as a named function declaration (`function n(r){...}(667)`) rather than a variable assignment. Terser then failed to inline the module initialisation, causing the factory function to return the require function itself rather than the module exports.

**Resolution:** The module exports were stored on `window._nlqPluginExports` (a `window` property) rather than a local variable. The factory function was changed to return `window._nlqPluginExports`. This is immune to terser's static optimisation.

---

### 12.4 NLQ Search — EN Button Invisible Despite Injection Code Running

**Symptom:** The floating EN button was not visible on Wazuh module pages.

**Cause (investigation 1):** The initial injection inserted the EN button as a child of `langBtn.parentElement`. The DQL button is an anchor trigger inside an `EuiPopover` component; its parent is `euiPopover__anchor`, not the flex layout container. The button was being injected into the popover structure and clipped.

**Resolution (partial):** Injection was rewritten to use `langBtn.closest('.euiFormControlLayout')` and insert the button as a flex sibling. This resolved the structural issue but the button remained invisible due to missing `flex-shrink: 0`.

**Cause (investigation 2):** The `euiFormControlLayout` flex container assigns `flex: 1` to the input area, consuming all available space. The EN button lacked `flex-shrink: 0`, causing it to be collapsed to zero width.

**Resolution (final):** The entire injection approach was replaced with a floating `position: fixed` button using `getBoundingClientRect()` on the DQL button for positioning, updated every 250 ms via `setInterval`. This approach is immune to all React flex container structure issues. The button copies the DQL button's CSS class names to inherit EUI's layout rules, and `flex-shrink: 0; flex: none` is applied as an inline style as a belt-and-braces measure.

---

### 12.5 wazuh.chunk.2.js — Pre-Existing Syntax Error (PECA Dashboard Patch Side Effect)

**Symptom:** When browser cache was disabled in DevTools, all Wazuh module pages were blank. The console reported `Uncaught SyntaxError: missing : after property id` at byte offset 5,265,405 in `wazuh.chunk.2.js`.

**Cause:** A prior PECA dashboard patch (applied on 2026-04-09) had introduced a syntax error at the injection point. The error was not detected earlier because the browser served a cached copy of the pre-patch file. Disabling cache forced a fresh fetch of the corrupted on-disk file.

**First fix attempt (incorrect):** Changed `,const peca_dashboard_plugins=` to `;const peca_dashboard_plugins=`. Node.js `vm.Script` rejected this as `SyntaxError: Unexpected token ';'`. Root cause analysis using brace-depth counting revealed that at the injection point the parser was still inside nested object literals at depth 3; a semicolon is not valid at that depth.

**Correct fix:** The official `wazuh-dashboard_4.14.3-1_amd64.deb` package was downloaded using `apt-get download` (without installing) and the clean `wazuh.chunk.2.js` was extracted via `dpkg-deb --fsys-tarfile`. The extracted file was validated with `node -e "new vm.Script(src)"` before deployment. All three compressed variants (`.js`, `.js.gz`, `.js.br`) were replaced on disk with gzip and Brotli recompressed from the clean source.

---

### 12.6 Compliance View — PECA Module Missing from Sidebar (AWS Deployment)

**Symptom:** After running the full setup on an AWS EC2 instance (Ubuntu 24.04.4 LTS), the PECA module did not appear in the Security Operations sidebar. All other modules were present.

**Cause:** The old `patch_bundles.py` apps-list logic used a primary anchor `,peca_app,devTools,` which matched nothing in the actual compiled JavaScript (the variable is named `peca`, not `peca_app`). A fallback anchor added only `compliance_overview_app` to the apps array; `peca` was never inserted. The `wazuh.plugin.js` therefore contained `compliance_overview_app` at order 407 but no `peca` constant at order 406.

**Resolution:** The `patch_plugin()` function in `patch_bundles.py` was rewritten to handle three install states:
- **State A (fresh):** Neither `peca` nor `compliance_overview_app` present — both are inserted together at the `const docker=` anchor.
- **State B (partial — old patch):** `compliance_overview_app` present but `peca` absent — `peca` is inserted immediately before `const compliance_overview_app=`.
- **State C (fully patched):** Both present — all steps skip.

---

### 12.7 Compliance View — Wazuh Plugin Load Failure After PECA Patch

**Symptom:** After the PECA sidebar fix, the entire dashboard was blank with "Error: Definition of plugin 'wazuh' not found and may have failed to load." The error occurred in OSD's plugin loader during `setup()` traversal.

**Cause:** The `peca` constant's `redirectTo` arrow function was written with one additional closing brace. The template-literal closing sequence in minified JavaScript contains embedded `}` characters for closing the arrow function body and the `const peca={` object simultaneously. Appending `};` (the terminator for the const statement) after a string that already included both `}`s produced three closing braces where only two were syntactically valid.

**Resolution:** The extra `}` was removed from the Python string in `patch_bundles.py`. The `'}`:""}\`}}'` string already closes all four open constructs (inner `${}`, inner template literal, outer `${}`, outer template literal, arrow function body, peca object); the statement is terminated by `';'` alone.

---

### 12.8 wazuh.chunk.2.js — Multiline Injection Breaking Minified Bundle

**Symptom:** Wazuh native module pages (GDPR, Security Events, etc.) were blank even after the compliance view patches were applied from a clean source file.

**Cause:** The `MOUNT_FN` variable in `patch_bundles.py` was defined as a Python raw string containing 52 literal newlines. Injecting multiline code into a single-line minified file produced a file with 53 lines. Some browser JS engines have unexpected behaviour when parsing minified files that span multiple lines due to sourcemap expectations or parser state caching.

**Resolution:** `MOUNT_FN` was minified to a single-line string (12,238 characters, zero newlines). The patched `wazuh.chunk.2.js` is a single line, matching the structure of the original.

An additional complication was that Firefox continued to serve a stale cached copy of the broken file even after the server-side file was replaced. The OSD content-addressable bundle URL uses a fixed build number (`/414303/bundles/...`) that does not change when file content changes, giving the browser no cache-invalidation signal. Disabling the browser cache in DevTools was required to verify the fix.

---

### 12.9 Wazuh Manager — Repeated Startup Timeout Failures

**Symptom (occurred twice, on 2026-04-08 and 2026-04-09):** The Wazuh Dashboard health check reported error 3099 (daemons not ready) and 3002 (API connection failed). `systemctl status wazuh-manager` showed `Result: timeout`.

**Cause:** The `wazuh-manager.service` unit has `TimeoutSec=45`. Under VM load, the manager's startup sequence (launching `wazuh-analysisd`, `wazuh-execd`, `wazuh-db`, etc.) exceeded 45 seconds, causing systemd to terminate the startup and leave all daemons stopped. On the second occurrence, orphaned `wazuh-apid` processes remained alive with stale PID files in `/var/ossec/var/run/`.

**Recovery:** Stale PID and lock files were removed, the manager was started directly via `wazuh-control start` or `systemctl start wazuh-manager` after `systemctl reset-failed`.

**Permanent fix:** A systemd drop-in override at `/etc/systemd/system/wazuh-manager.service.d/timeout.conf` sets `TimeoutStartSec=120`, providing sufficient time for the startup sequence to complete under VM load.

---

### 12.10 Network Graph — Blank `WAZUH_API_PASSWORD` on Every Fresh Install (AWS)

**Symptom (AWS EC2, 2026-04-24):** Every request to `/api/network_graph/agents` and `/api/network_graph/alerts` returned HTTP 401. The graph page rendered with nodes but showed no edges or data.

**Cause:** `networkGraph/install.sh` wrote the server-side `.env` with `WAZUH_API_PASSWORD=` (empty). A fresh Wazuh install generates a unique `wazuh-wui` API password for each machine (stored inside `wazuh-install-files.tar`). The script never resolved this password; the default fallback in `routes/index.js` uses the local VM's password (`v86bPF+u+2nph5LxghIFWivBr87qPgJL`), which is machine-specific and incorrect on any other deployment.

**Resolution:** `install.sh` now resolves the password in three steps: (1) reads `$WAZUH_API_PASSWORD` if already exported by `setup.sh`'s `resolve_wazuh_passwords()`; (2) searches the filesystem for `wazuh-install-files.tar` and parses the password from it; (3) writes a blank password with a clear warning only if both steps fail. The correct password on the EC2 instance (`7J*.Qv+5y4w1LbJAtzkJa7W5l*Hx2PTk`) was resolved from `/home/ubuntu/old-wazuhfyprepo/wazuh-install-files.tar` and written to the plugin `.env`.

---

### 12.11 Network Graph — Sidebar Entry Missing After `setup.sh` Re-Run (AWS)

**Symptom (AWS EC2, 2026-04-24):** After re-running `setup.sh` to apply April 24 updates, the Network Graph entry did not appear in the Wazuh sidebar under Threat Intelligence. Navigating directly to `/app/networkGraph` worked, confirming the plugin loaded correctly.

**Cause:** `patch_plugin.py` had two string anchors for inserting `network_graph_app` into the Wazuh apps array. Both failed silently on the EC2 bundle:
- Primary anchor (`compliance_overview_app,devTools`) — no match; EC2 bundle had no `devTools` after `compliance_overview_app`.
- Fallback anchor (`ITHygiene].sort(`) — no match; EC2 bundle had `ITHygiene,compliance_overview_app].sort(` (complianceView had already been patched in a previous run, inserting `compliance_overview_app` between `ITHygiene` and `].sort(`).

Critically, the failure path printed `[WARN]` to stderr and exited 0. `setup.sh` interpreted the 0 exit as success and logged the feature as `[OK]`. The broken state was invisible in the installation summary.

**Resolution:** Three changes were applied:
1. A third string anchor was added: `,compliance_overview_app].sort(` → `,compliance_overview_app,network_graph_app].sort(`.
2. A position-based fallback (`_insert_in_apps_list_by_position`) was added as the final safety net. It locates the apps array by finding `,ITHygiene` (stable across all 4.14.x bundles) and the next `].sort(` after it, inserting `network_graph_app` regardless of what other entries precede `].sort(`.
3. Failure of the position-based fallback now exits 1, causing `setup.sh` to mark networkGraph as `[FAILED]` instead of silently continuing.

---

### 12.12 Compliance View — Dark Theme Absent from Installed Bundle

**Symptom (2026-05-01):** In dark mode, the Compliance Overview panel retained a white background with all cards, table headers, and container elements in light-mode colours. The localStorage `fyp_theme_v2=dark` key was set, and the `fyp-theme-changed` event was being dispatched correctly, but the panel did not respond.

**Cause (discovered by inspecting installed bundle):** The `mountComplianceOverview` function was injected into `wazuh.chunk.2.js` during an earlier session (P4) before the dark-theme CSS block was authored. The upgrade patches P15a–P15c searched for old anchor strings that never existed in this particular installed bundle variant, so they all exited with `[WARN]` and applied no CSS. The result was a 3,091-character CSS string in the installed bundle with **zero dark-theme rules**, while the theme-detection JavaScript was present and functioning. The dark mode toggle code fired correctly but had no CSS to apply.

This failure mode was invisible in source code review because `patch_bundles.py` was modified after the initial injection, and the source `MOUNT_FN` string was correct. The discrepancy only existed in the on-disk installed file.

**Resolution:** P18 was added: it appends the complete dark-theme CSS block (13 rules covering panel background, header, title, selector, button, section title, cards, count text, table, matrix, load/error/empty states) directly to the installed bundle's CSS string, anchored on a unique substring of the closing CSS injection code. Additionally, four P18b sub-patches corrected base element colours (header border, title colour, dropdown selector, section title) that had retained dark-default values from the original P4 injection — these were rendered invisible in dark mode because their text colour matched the background.

**Lesson:** When patching minified JavaScript bundles, the installed on-disk file must be inspected directly (e.g., by extracting the CSS string with a Python script) to confirm what patches have actually landed. Reading only source files gives a false picture of the installed state.

---

### 12.14 AI Assistant — OpenSearch Disk Circuit Breaker (AWS EC2)

**Symptom (AWS EC2, 2026-04-24):** The AI chat panel returned `CircuitBreakingException: Disk Circuit Breaker is open` on every query, blocking all ML Commons agent execution.

**Cause:** EC2 disk usage was at 91% (34 GB used of 38 GB). The OpenSearch disk circuit breaker trips above the high watermark (default 90%) and blocks all write and ML operations. Investigation found 16 GB consumed by a previously installed Ollama service and its downloaded Gemma model (`/usr/share/ollama`: 11 GB; `/usr/local/lib/ollama`: 4.9 GB). Ollama was no longer in use after the Groq migration.

**Resolution:** The Ollama service was stopped and disabled; the Ollama binary, libraries, and model cache were removed. Disk usage dropped from 91% to 51%. The OpenSearch disk threshold check was toggled via the Cluster Settings API to clear the circuit-breaker state. Subsequent agent execution confirmed end-to-end functionality restored.

---

## 13. Testing and Validation

### 13.1 Plugin Load Verification

All six plugins were verified for correct loading using the OSD startup log, which enumerates the complete plugin list at startup. A plugin that fails to load is absent from this list or appears with an error. The expected count for a full installation is 57 plugins (Wazuh's 51 default plugins plus the six FYP plugins).

### 13.2 API Route Testing

Server-side routes for all plugins were tested using `curl` with the dashboard admin credentials prior to and after browser-based testing. The following checks were performed for each route:

- Valid input with expected response structure and HTTP 200.
- Empty time ranges (no alerts in period) — confirmed graceful empty response.
- Missing required parameters — confirmed 400 response.

### 13.3 PECA Rule Smoke Test

The PECA detection rules were verified using Wazuh's built-in `wazuh-logtest` utility, which accepts synthetic log lines and reports the matching rule IDs and groups without generating live alerts. The expected output for a synthetic SSH failure log was:

```
id: '100100'
groups: ['peca', 'authentication_failed', 'peca_3']
```

This test was included in the Docker-based validation procedure and confirms that the rules deploy correctly, fire on the expected parent SID, and produce the correct group tags.

### 13.4 AI Chatbot End-to-End Test

The full AI chatbot pipeline was validated by submitting a test query directly to the OpenSearch ML Commons agent execute endpoint:

```
POST /_plugins/_ml/agents/<agent_id>/_execute
{"parameters": {"question": "Analyze the most important alerts in my environment"}}
```

The response was routed through the complete chain (ML Commons → MCP-LLM Gateway → Groq `qwen/qwen3-32b` → MCP Server → Wazuh Indexer) and a natural-language response was returned, confirming end-to-end connectivity.

The gateway's `/health` endpoint was used as a lightweight operational check: it performs a live LLM invocation and attempts a tool-catalogue fetch from the MCP server, returning a structured status for all three components (`gateway`, `llm`, `mcp`). On the AWS EC2 deployment, this check revealed a `CircuitBreakingException` caused by disk exhaustion (see Section 12.12) which was resolved before functional testing continued.

### 13.5 NLQ Translation Test

The NLQ translate route was tested via `curl` with a Groq API key configured (`NLQ_BACKEND=groq`), confirming that the LLM returned a valid Sec-IR JSON on the first attempt (zero correction rounds) for several representative queries. The Groq backend was added alongside the existing Gemini and Ollama backends; auto-detection prioritises Groq when `GROQ_API_KEY` is set.

### 13.6 Testing Gaps

_[The following tests are either pending or were not completed at the time of documentation — please update as testing progresses:]_

- Full browser-based validation of the EN toggle button on all Wazuh module pages (Security Events, GDPR, Malware Detection, Vulnerability).
- Localization plugin test checklist (dark mode persistence, Urdu translation coverage, RTL layout, simultaneous dark+Urdu mode).
- Network graph edge colouring under active alert conditions (requires live agents generating alerts).
- Performance testing under high alert volume (thousands of alerts per second).

---

## 14. Limitations and Future Work

### 14.1 Known Limitations

**PECA coverage**: Only four PECA sections (3, 4/11, 6/8, 20) have active detection rules. Sections 5, 21, 36, and 37 are defined in the compliance mapping but have no corresponding rules. Adding rules for these sections would require identifying appropriate parent rule IDs within Wazuh's built-in ruleset or writing new base rules.

**Wazuh package upgrades**: Direct patching of pre-compiled JavaScript bundles is fragile with respect to Wazuh package updates. Any upgrade that replaces `wazuh.plugin.js` or `wazuh.chunk.2.js` will overwrite the patches. The original files are backed up with a `.orig` suffix; re-running `setup.sh --only complianceView` (or the PECA compliance script) re-applies all patches.

**NLQ sequence queries**: The Sec-IR `sequence` pattern emits a `_meta.note` field indicating that Wazuh DSL does not natively support true sequence queries. The generated query approximates the intent using a correlation block but does not enforce event ordering. True sequence detection would require either a custom scoring script or integration with Wazuh's correlation engine.

**Localisation scope**: The Urdu translations cover 1,012 strings across the Wazuh Dashboard UI, including all four custom FYP plugins, all Wazuh module pages, and OSD native i18n via `ur-PK.json` (187 keys). SVG chart labels and dynamic strings assembled from runtime data fragments remain untranslated. The language switch requires a full page reload (necessary for OSD's native React i18n system to re-render in Urdu).

**AI assistant model dependency**: The chatbot depends on a third-party LLM API (Groq, OpenAI, Gemini, or AWS Bedrock). Response quality, latency, and availability are determined by the external provider. The current deployment uses Groq's `qwen/qwen3-32b` model; Groq was adopted as the primary provider after Gemini's free-tier rate limits were reached during testing.

**No agent-to-agent edge validation**: The network graph's peer-edge logic — which infers agent-to-agent connections from alert `srcip`/`dstip` fields — could not be validated during development because the test environment had no agents generating alerts with IP fields. The logic is implemented but untested against live data.

### 14.2 Recommended Future Work

1. **Expand PECA coverage** — author detection rules for Sections 5, 21, 36, and 37, potentially using custom log sources or Wazuh's active response framework.
2. **PECA dedicated field** — investigate Wazuh manager modifications that would allow PECA tags to be indexed as a dedicated `rule.peca` field, enabling first-class compliance integration equivalent to PCI DSS.
3. **NLQ sequence query support** — explore integration with OpenSearch's Alerting plugin or Wazuh's correlation engine to enable true multi-event sequence detection.
4. **Performance benchmarking** — measure NLQ translation latency (LLM call + transpilation + execution) under varying query complexity and alert volume.
5. **Automated testing** — develop a test harness using `wazuh-logtest` for all PECA rules and a mock LLM backend for NLQ pipeline unit tests.
6. **Urdu translation expansion** — extend translations to cover SVG chart label strings (currently unreachable by the TreeWalker) and dynamic strings assembled outside plugin code. Investigate a client-side SVG text replacement approach using a separate `MutationObserver` filtered to `<text>` element mutations.
7. **AWS deployment hardening** — the EC2 deployment exposed two installation robustness issues: (a) `patch_plugin.py`'s apps-list step previously exited 0 with a `[WARN]` when no string anchor matched the bundle state, silently producing a broken installation; this was fixed by adding a third string anchor, a position-based fallback (locating `ITHygiene` then `].sort(`) that works on any Wazuh 4.14.x bundle variant, and replacing the silent exit with `sys.exit(1)` so `setup.sh` surfaces failures; (b) `install.sh` wrote a blank `WAZUH_API_PASSWORD` when the env var was not pre-exported, preventing Wazuh API calls; this was fixed by auto-resolving the password from `wazuh-install-files.tar` at install time. A remaining improvement is to add pre-deployment patch validation (Node.js `vm.Script` parse check) to the install script to catch JS syntax errors before restarting the dashboard service.

---

## 15. Conclusion

This project has successfully delivered a functionally complete AI-enhanced SIEM layer on top of Wazuh 4.14.3, addressing six distinct gaps in the platform's capabilities as they apply to Pakistani security operations. The PECA compliance module provides, for the first time in an open-source SIEM context, a dashboard view of alerts mapped to Pakistan's Prevention of Electronic Crimes Act. The AI chatbot enables natural-language interrogation of live alert data through a production-grade LLM gateway architecture (currently deployed with Groq `qwen/qwen3-32b`). The network topology plugin contextualises alerts within their infrastructure topology. The NLQ search interface translates plain English into executable OpenSearch queries via a schema-constrained intermediate representation. The comparative compliance view enables simultaneous cross-framework compliance analysis across PCI DSS, HIPAA, GDPR, NIST 800-53, TSC, and PECA. The localization layer adds comprehensive Urdu language support (1,012 translation strings, OSD native i18n, RTL layout) and a full dark mode across the entire Wazuh Dashboard.

The technical difficulty of this project warrants emphasis. The development team operated without access to the Wazuh plugin build toolchain, requiring all custom plugins to be built against OSD's generic bundle system using a standalone webpack configuration. The integration of custom modules into Wazuh's sidebar navigation required systematic reverse-engineering of pre-compiled, minified JavaScript bundles, followed by precise byte-level patching and recompression. The NLQ pipeline required a faithful JavaScript reimplementation of a Python reference codebase, including a zero-dependency schema validator and a deterministic DSL transpiler. Multiple incidents involving corrupted bundles, masked browser caching, and LLM garbage output required methodical diagnosis across multiple layers of the stack.

The resulting system is deployable in full via a single idempotent script on a clean Ubuntu 24.04 LTS or Linux Mint 22 host, has been validated against a clean Wazuh Docker environment, and has been successfully deployed to an AWS EC2 instance. The AWS deployment surfaced and resolved two installation hardening issues — a silent patch failure in the network graph sidebar registration and a blank API credential in the plugin `.env` — both of which have been corrected so that subsequent deployments via `setup.sh` are fully automated. A third class of issue — dark-theme CSS absent from an installed bundle due to silent upgrade-patch failures — was diagnosed by direct inspection of the on-disk compiled file and resolved with a new appended-block patching strategy (P18). The AI assistant currently runs on Groq's `qwen/qwen3-32b` model via an OpenAI-compatible endpoint, with Gemini and a local Ollama backend available as fallback providers. The work demonstrates that meaningful intelligence augmentation of an enterprise-grade SIEM platform is achievable within the scope of a final year undergraduate project, even in the presence of significant architectural constraints.

---

## 16. References

- Wazuh Documentation. [https://documentation.wazuh.com/](https://documentation.wazuh.com/)
- OpenSearch ML Commons Plugin. [https://opensearch.org/docs/latest/ml-commons-plugin/](https://opensearch.org/docs/latest/ml-commons-plugin/)
- Model Context Protocol. [https://modelcontextprotocol.io/docs/getting-started/intro](https://modelcontextprotocol.io/docs/getting-started/intro)
- OpenSearch MCP Server (Python). [https://github.com/opensearch-project/opensearch-mcp-server-py](https://github.com/opensearch-project/opensearch-mcp-server-py)
- LangChain MCP Adapters. [https://github.com/langchain-ai/langchain-mcp-adapters](https://github.com/langchain-ai/langchain-mcp-adapters)
- Build a Chatbot with OpenSearch. [https://docs.opensearch.org/latest/tutorials/gen-ai/chatbots/build-chatbot/](https://docs.opensearch.org/latest/tutorials/gen-ai/chatbots/build-chatbot/)
- Prevention of Electronic Crimes Act 2016 (PECA). Government of Pakistan.
- D3.js Documentation. [https://d3js.org](https://d3js.org)
- webpack 5 Documentation. [https://webpack.js.org](https://webpack.js.org)

_[Additional academic citations — research papers on NLP-to-SIEM query translation, LLM-based security tooling, and compliance framework integration — to be added following literature review.]_

---

*Report generated from development logs, session records, plugin documentation, and repository READMEs. Sections marked with italicised notes indicate areas requiring supplementary information from the project team.*
