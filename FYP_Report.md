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

This report documents the design, implementation, and evaluation of an AI-enhanced Security Information and Event Management (SIEM) system developed as a final year project at IBA Karachi. The project augments the open-source Wazuh SIEM platform (version 4.14.3) with five substantive enhancements: (1) a custom compliance ruleset mapped to Pakistan's Prevention of Electronic Crimes Act 2016 (PECA), (2) an AI-driven security analyst chatbot powered by a large language model gateway, (3) an interactive network topology visualisation plugin, (4) a natural language query (NLQ) search interface enabling plain-English alert retrieval, and (5) a comparative cross-framework compliance dashboard. An additional localization layer provides bilingual Urdu/English support and a persistent dark mode across all custom plugins. All components are delivered as OpenSearch Dashboards plugins and are deployable via a single idempotent setup script with feature-flag-controlled selective installation.

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

This project addresses these barriers by constructing an AI-enhanced layer on top of Wazuh rather than re-implementing SIEM functionality from scratch. The rationale for this approach is both practical and academically sound: Wazuh provides a production-grade, extensible foundation, and the OpenSearch Dashboards plugin architecture — upon which Wazuh's web interface is built — offers documented extension points. The project contributes enhancements in five distinct areas, each delivered as a self-contained, installable component.

The secondary motivation for this work is the alignment of security monitoring tooling with Pakistan's regulatory landscape. PECA 2016 is the country's primary legislation governing electronic crimes, yet no open-source SIEM platform ships with PECA-mapped detection rules or compliance dashboards. The absence of such mappings means Pakistani organisations either operate without compliance visibility or rely on costly commercial alternatives. This project directly addresses this gap.

### 1.1 Objectives

The project set out to achieve the following objectives:

- Integrate an AI-driven natural language interface into the Wazuh Dashboard, enabling SOC analysts to query alerts in plain English without knowledge of the underlying query language.
- Implement custom Wazuh detection rules mapped to sections of PECA 2016 and surface those rules within a dedicated dashboard module.
- Develop a live network topology graph that contextualises alert severity within the agent infrastructure.
- Construct a unified compliance view that allows simultaneous comparison of alert coverage across PCI DSS, HIPAA, GDPR, NIST 800-53, TSC, and PECA.
- Provide bilingual Urdu/English UI support to broaden accessibility for domestic security practitioners.

### 1.2 Scope

The project is scoped to Wazuh 4.14.3 running as an all-in-one deployment (manager, indexer, and dashboard on a single host) on Ubuntu 24.04 LTS or Linux Mint 22. The AI chatbot supports Google Gemini, OpenAI GPT, and AWS Bedrock Claude as interchangeable LLM backends. The NLQ search plugin supports Gemini (cloud) and Ollama (local/offline) backends. All custom plugins target OpenSearch Dashboards 2.19.4.

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
3. The LLM (Gemini or Ollama) generates a Sec-IR JSON object conforming to the schema.
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
| LLM Provider (tested) | Google Gemini (gemini-2.5-flash) |

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

### 6.1 Overview

The AI chatbot provides a natural language interface to the Wazuh alert data, accessible through the Dashboard Assistant chat panel embedded in the top-right corner of the Wazuh Dashboard. Analysts can ask questions such as "Analyse the most important alerts in my environment" or "Which endpoints are affected by CVE-2023-47038?" and receive structured, contextual answers without writing any queries.

### 6.2 Architecture

The chatbot system comprises three services deployed on the same host as the Wazuh all-in-one installation:

**OpenSearch MCP Server** (port 9900): A Python service (`opensearch-mcp-server-py 0.8.0`) that exposes Wazuh Indexer query capabilities as eleven Model Context Protocol (MCP) tools. The server communicates with the Wazuh Indexer via OpenSearch's standard HTTP API, authenticated with admin credentials. It serves tool definitions and accepts tool call requests over a Server-Sent Events (SSE) endpoint.

**MCP-LLM Gateway** (port 9912): A FastAPI service that acts as the bridge between OpenSearch ML Commons and the LLM provider. It receives the analyst's question via `POST /analyze`, constructs a LangChain agent with the MCP server's tools, submits the question to the LLM, proxies any tool calls the LLM requests to the MCP Server, and returns the final LLM-generated response. The gateway exposes a `/health` endpoint that validates connectivity to both the LLM provider and the MCP Server.

**Dashboard Plugins** (embedded in OSD): The `assistantDashboards` and `mlCommonsDashboards` plugins, extracted from the official OpenSearch Dashboards 2.19.4 distribution tarball and installed into the Wazuh Dashboard plugins directory. These provide the chat panel UI and the ML Commons client. An HTTP connector registered in the Wazuh Indexer links OpenSearch ML Commons to the MCP-LLM Gateway.

### 6.3 LLM Providers

The gateway supports three interchangeable LLM backends, selectable via a single environment variable:

| Provider | Variable | Model Tested |
|----------|----------|-------------|
| Google Gemini | `LLM_PROVIDER=gemini` | `gemini-2.5-flash` |
| OpenAI | `LLM_PROVIDER=openai` | `gpt-4o` |
| AWS Bedrock Claude | `LLM_PROVIDER=claude_bedrock` | `anthropic.claude-3-sonnet-20240229-v1:0` |

Google Gemini with `gemini-2.5-flash` is the primary tested provider, as it is available on the free tier. Switching providers requires only updating the gateway's environment configuration and restarting the service.

### 6.4 Security Considerations

The LLM provider API key is stored exclusively in `/etc/mcp-llm-gateway/mcp-llm-gateway.env`, which is owned by the `mcpgateway` system user with permissions mode 640. The key never reaches the browser, the Wazuh Dashboard, or OpenSearch. The call chain from browser to LLM provider is:

```
Browser → OSD → OpenSearch ML Commons → Gateway (internal API key) → LLM Provider (LLM key, server-side only)
```

The `GATEWAY_API_KEY` transmitted between ML Commons and the gateway is an independent internal secret, distinct from any LLM provider credential.

### 6.5 MCP Tool Catalogue

The OpenSearch MCP Server exposes eleven tools to the LLM agent. _[Full tool list to be documented from the MCP server's tool definitions — insert here.]_

### 6.6 System Prompt

The gateway uses a SOC analyst system prompt that instructs the LLM to act as an expert security analyst, to use only the provided tools to retrieve data, and to produce concise, actionable answers. The prompt includes guidance on tool selection and response formatting.

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

## 8. Feature 4: Natural Language Query Search Plugin

### 8.1 Overview

The NLQ Search plugin (`nlqSearch`) enables SOC analysts to query Wazuh alerts in plain English through two interfaces: a standalone dedicated page at `/app/nlqSearch` providing a full-featured query builder, and a global EN toggle injected into every existing search bar across all Wazuh module pages.

### 8.2 Translation Pipeline

The NLQ pipeline translates plain-English queries into executable OpenSearch DSL in four deterministic stages:

1. **Time-range pre-processor**: A set of regular expressions extract temporal constraints from the query string before the LLM is invoked. This prevents temporal reasoning errors from propagating to the LLM call and ensures consistent time-range formatting.

2. **LLM call**: The pre-processed query is submitted to the LLM (Gemini or Ollama) with a structured system prompt that defines the Sec-IR schema, ten event type categories, five query pattern types, disambiguation rules, and seven few-shot examples. The LLM is instructed to produce a JSON object conforming to the Sec-IR 1.0 schema.

3. **Schema validation and self-correction**: The LLM output is validated against the Sec-IR schema by a manual zero-dependency JavaScript validator (equivalent in semantics to the Python `jsonschema` Draft7Validator used in the reference Sec-IR implementation). If validation fails, the LLM is re-invoked with the error description appended to the prompt; up to two retries are attempted.

4. **DSL transpiler**: A deterministic JavaScript transpiler converts the validated Sec-IR object to an OpenSearch bool query. The transpiler is a faithful reimplementation of the Python reference transpiler from the Sec-IR project, preserving identical field mappings, severity ranges, and pattern logic.

**Example pipeline execution:**

Query: `"Show failed admin logins in the last 24 hours"`

Sec-IR output:
```json
{
  "sec_ir_version": "1.0",
  "event_type": "authentication_failure",
  "pattern": "single_event",
  "entity": { "user_role": "admin" },
  "severity": "high",
  "time_range": { "type": "relative", "value": "last_24h" }
}
```

OpenSearch DSL output:
```json
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
```

### 8.3 Supported Query Types

**Event types (ten):** `authentication_failure`, `privilege_escalation`, `lateral_movement`, `port_scan`, `process_injection`, `file_deletion`, `malware_alert`, `ransomware_behavior`, `policy_violation`, `data_exfiltration`.

**Query patterns (five):** `single_event` (any matching event), `repeated_attempts` (threshold-based aggregation), `spike` (anomalous volume approximated as threshold), `sequence` (ordered multi-event chain), `absence` (event did not occur).

### 8.4 Global EN Toggle

The EN toggle is injected into every OSD page that renders a query bar with the `[data-test-subj="switchQueryLanguageButton"]` attribute. The injection mechanism operates via a `MutationObserver` on `document.body` combined with a 500 ms `setInterval` fallback to handle React's two-pass render timing.

Because the OSD query bar accepts DQL (Dashboard Query Language) strings rather than full JSON DSL bodies, the plugin maintains an `irToDQL()` function that converts a Sec-IR object to a DQL string. The time range is deliberately omitted from the DQL string — the existing time-picker on each module page handles the temporal filter.

Updating the React-controlled textarea requires use of the native value setter trick: the prototype's `set` method is called directly, bypassing React's synthetic event system, followed by a dispatched `input` event to trigger React's change handler. A `window.__nlqProcessing` flag prevents the `keydown` interceptor from re-processing the simulated Enter event that executes the actual search.

### 8.5 API Endpoints

| Route | Method | Description |
|-------|--------|-------------|
| `/api/nlq_search/translate` | POST | Translates plain English to Sec-IR + OpenSearch DSL |
| `/api/nlq_search/execute` | POST | Executes an OpenSearch DSL query against `wazuh-alerts-*` |
| `/api/nlq_search/retranspile` | POST | Regenerates DSL from an edited IR object (no LLM call) |

### 8.6 Backend Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `NLQ_BACKEND` | `gemini` | LLM backend: `gemini` or `ollama` |
| `GEMINI_API_KEY` | _(required)_ | Google AI Studio API key |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model name |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL (offline mode) |
| `OLLAMA_MODEL` | `phi3.5` | Ollama model |
| `INDEXER_PASSWORD` | _(required)_ | Wazuh Indexer admin password |

---

## 9. Feature 5: Comparative Compliance View Plugin

### 9.1 Overview

The Compliance View plugin (`complianceView`) provides a unified dashboard comparing alert coverage across all six compliance frameworks simultaneously: PCI DSS, HIPAA, GDPR, NIST 800-53, TSC, and PECA. It is accessible as a native module within the Wazuh Security Operations sidebar at order 407 (immediately after the PECA module at order 406).

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

The Compliance Overview is integrated into the Wazuh Security Operations sidebar through the same bundle patching mechanism used for the PECA module. The `patch_bundles.py` script applies eight patches across two files:

**`wazuh.chunk.2.js` (six patches):**
- Catalog map entries for `peca` and `compliance-overview`
- Agent and overview tab count registrations
- Injection of `mountComplianceOverview()` (vanilla JS dashboard function), `ComplianceOverviewPanel` (React wrapper), and `peca_data_source_PECADataSource` class
- `pecaColumns` column definition
- Module tab definitions for both modules

**`wazuh.plugin.js` (two patches):**
- `const peca={...}` constant definition at `order:406`
- `const compliance_overview_app={...}` constant definition at `order:407`
- Both inserted into the app registration array

The script implements idempotency by checking for marker strings before applying each patch, allowing safe re-execution on an already-patched installation. Three install states are handled: fresh install (neither module present), partial install (compliance overview present but PECA absent — the state produced by an earlier defective version of the script), and fully patched.

---

## 10. Feature 6: Localization and Dark Mode Plugin

### 10.1 Overview

The Localization plugin (`localization`) injects a persistent floating toolbar into the Wazuh home page, providing dark mode and bilingual Urdu/English support for all three custom FYP plugins (Network Graph, NLQ Search, Compliance View). User preferences are stored in `localStorage` and persist across page reloads and navigation.

### 10.2 Dark Mode

Dark mode is implemented as a CSS injection: toggling the feature appends or removes a `<style id="fyp-dark-mode">` element containing approximately eighty CSS rules targeting EUI class names and OSD chrome selectors. The colour palette targets OSD's structural elements (page background, header, sidebar) while leaving the custom plugins — which already use dark colour schemes by default — largely unchanged.

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

### 10.3 Urdu Localisation

The plugin maintains two locale files (`locales/en.json` and `locales/ur.json`) each containing 46 key-value pairs covering strings from all three custom plugins. Both files are bundled into the webpack output at build time.

Translation is applied via a `TreeWalker` that traverses DOM text nodes and replaces matched strings using pre-built bidirectional `EN_TO_UR` and `UR_TO_EN` maps. A `MutationObserver` on `document.body`, debounced at 150 ms, re-applies the active translation map after any DOM mutation to handle plugin re-renders.

Right-to-left (RTL) layout is activated when Urdu is selected by adding a `fyp-rtl` CSS class to `document.body`. The injected stylesheet applies `direction: rtl` to content areas while preserving the LTR layout of the header and sidebar.

A global `window.__fypLocale__` API (`{ lang, t(key) }`) is exposed for any custom plugin that wishes to integrate with the localisation system, along with a `fyp-language-changed` window event.

### 10.4 Toolbar Visibility Implementation

The toolbar is rendered as a `<dialog>` element and activated via `dialog.show()` (non-modal). This choice addresses a layout issue specific to the OSD bootstrap animation: OSD applies a CSS `transform: scaleX()` to `<body>` during its React mount animation. Any `position: fixed` child element under a transformed ancestor loses viewport anchoring and anchors to the transformed element's coordinate space instead. By using a `<dialog>` element, which is promoted to the browser's top layer — a rendering surface that lies above all stacking contexts — the toolbar is immune to this transform behaviour and reliably anchors to the viewport.

The toolbar is displayed only on the Wazuh home page (`appId === 'wz-home'`), using OSD's `core.application.currentAppId$` RxJS Observable for navigation detection, with a History API intercept fallback.

### 10.5 Known Limitations

- Dynamic strings that concatenate translated text with runtime data (e.g., "42 alert(s) — last updated 14:32") are not translated, as the concatenation produces a composite text node that does not match any static key.
- Translation is limited to the three custom FYP plugins; OSD's built-in pages (Discover, Dashboards) are not translated.
- There may be a brief (≤ 150 ms) flash of English text on plugin re-renders before the MutationObserver re-applies the Urdu translation.

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

The response was routed through the complete chain (ML Commons → MCP-LLM Gateway → Gemini → MCP Server → Wazuh Indexer) and a natural-language response was returned, confirming end-to-end connectivity.

### 13.5 NLQ Translation Test

The NLQ translate route was tested via `curl` with a Gemini API key configured, confirming that the LLM returned a valid Sec-IR JSON on the first attempt (zero correction rounds) for several representative queries.

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

**Localisation scope**: The Urdu translations cover only the 46 strings present in the three custom FYP plugins. OSD's built-in pages (Discover, Management, Dashboards) are not translated. Dynamic strings assembled at runtime from translated fragments and data values are not translatable by the current DOM text-node replacement approach.

**AI assistant model dependency**: The chatbot depends on a third-party LLM API (Gemini, OpenAI, or AWS Bedrock). Response quality, latency, and availability are determined by the external provider. The `gemini-2.5-flash` model was chosen for its free-tier availability; production deployments would benefit from a paid tier to avoid rate limits.

**No agent-to-agent edge validation**: The network graph's peer-edge logic — which infers agent-to-agent connections from alert `srcip`/`dstip` fields — could not be validated during development because the test environment had no agents generating alerts with IP fields. The logic is implemented but untested against live data.

### 14.2 Recommended Future Work

1. **Expand PECA coverage** — author detection rules for Sections 5, 21, 36, and 37, potentially using custom log sources or Wazuh's active response framework.
2. **PECA dedicated field** — investigate Wazuh manager modifications that would allow PECA tags to be indexed as a dedicated `rule.peca` field, enabling first-class compliance integration equivalent to PCI DSS.
3. **NLQ sequence query support** — explore integration with OpenSearch's Alerting plugin or Wazuh's correlation engine to enable true multi-event sequence detection.
4. **Performance benchmarking** — measure NLQ translation latency (LLM call + transpilation + execution) under varying query complexity and alert volume.
5. **Automated testing** — develop a test harness using `wazuh-logtest` for all PECA rules and a mock LLM backend for NLQ pipeline unit tests.
6. **Urdu translation expansion** — extend the locale files to cover dynamic strings and built-in Wazuh module page text.
7. **AWS deployment hardening** — the EC2 deployment exposed the PECA sidebar issue and a JS syntax error in the bundle patch; add pre-deployment patch validation (Node.js `vm.Script` parse check) to the install script.

---

## 15. Conclusion

This project has successfully delivered a functionally complete AI-enhanced SIEM layer on top of Wazuh 4.14.3, addressing five distinct gaps in the platform's capabilities as they apply to Pakistani security operations. The PECA compliance module provides, for the first time in an open-source SIEM context, a dashboard view of alerts mapped to Pakistan's Prevention of Electronic Crimes Act. The AI chatbot enables natural-language interrogation of live alert data through a production-grade LLM gateway architecture. The network topology plugin contextualises alerts within their infrastructure topology. The NLQ search interface translates plain English into executable OpenSearch queries via a schema-constrained intermediate representation. The comparative compliance view enables simultaneous cross-framework compliance analysis. A localization layer adds Urdu language support and dark mode across all custom components.

The technical difficulty of this project warrants emphasis. The development team operated without access to the Wazuh plugin build toolchain, requiring all custom plugins to be built against OSD's generic bundle system using a standalone webpack configuration. The integration of custom modules into Wazuh's sidebar navigation required systematic reverse-engineering of pre-compiled, minified JavaScript bundles, followed by precise byte-level patching and recompression. The NLQ pipeline required a faithful JavaScript reimplementation of a Python reference codebase, including a zero-dependency schema validator and a deterministic DSL transpiler. Multiple incidents involving corrupted bundles, masked browser caching, and LLM garbage output required methodical diagnosis across multiple layers of the stack.

The resulting system is deployable in full via a single idempotent script on a clean Ubuntu 24.04 LTS or Linux Mint 22 host, has been validated against a clean Wazuh Docker environment, and has been successfully deployed to an AWS EC2 instance. The work demonstrates that meaningful intelligence augmentation of an enterprise-grade SIEM platform is achievable within the scope of a final year undergraduate project, even in the presence of significant architectural constraints.

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
