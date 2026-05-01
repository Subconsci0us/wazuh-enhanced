# Project Context — Enhanced SIEM with AI-Driven Security

## Project Overview

This is a Final Year Project (FYP) for IBA Karachi's BS Computer Science program. The project builds an AI-enhanced layer on top of Wazuh (open-source SIEM) — it does not rebuild SIEM functionality from scratch. The enhancements include AI-driven anomaly detection, natural language query translation, compliance reporting (including Pakistan's PECA 2016), network visualization, and bilingual Urdu/English support.

**Team:** Shazain (Frontend & Localization), Syed Shayan Hussain (Backend & Integration), Fatima Shahid (AI/ML)  
**Advisor:** Dr. Faisal Iradat, IBA Karachi  
**GitHub:** https://github.com/Subconsci0us/FYP_siem.git

---

## Environment

| Item | Value |
|------|-------|
| VM | Linux Mint 22.3 on VirtualBox |
| Wazuh version | 4.14.3 |
| OpenSearch Dashboards version | 2.19.4 |
| Wazuh install path | `/usr/share/wazuh-dashboard/` |
| Wazuh plugins | `/usr/share/wazuh-dashboard/plugins/` |
| Wazuh API | `https://localhost:55000` |
| Wazuh API user | `wazuh-wui` |
| Wazuh API password | `v86bPF+u+2nph5LxghIFWivBr87qPgJL` |
| Dashboard admin user | `admin` |
| Dashboard admin password | `lO.5jGDicEdmbH9kt9So1DYeFqkl6k6s` |
| OpenSearch | `https://localhost:9200` (same admin credentials as dashboard) |
| Node.js | 18.19.1 |
| npm | 9.2.0 |
| Shared folder mount | `/media/sf_sharedfolderclone/` |

---

## Directory Structure and Rules

### 1. `/media/sf_sharedfolderclone/FYP_siem/` — REFERENCE ONLY

This contains the Wazuh source code and original project documents (SRS, SD, Proposal, defense slides). **Do not modify any files here.** Read from it when you need to understand Wazuh internals or the project requirements.

### 2. `/media/sf_sharedfolderclone/sec-ir/` — REFERENCE ONLY

This is a separate repository containing the Sec-IR natural language query translation system (English → Sec-IR JSON → SIEM queries). It has its own parser, validator, transpilers (Elastic, Splunk, Wazuh), and evaluation dataset. **Do not modify any files here.** Use it as reference when working on the NLQ Search plugin.

### 3. `/media/sf_sharedfolderclone/wazuh-fyp-repo/` — MAIN WORKING DIRECTORY

This is the only directory where files should be created or modified. It contains all FYP deliverables — custom Wazuh plugins, install scripts, and configuration files. Structure:

```
wazuh-fyp-repo/
├── install.sh                  # Master install script with feature flags
├── README.md                   # Project-wide documentation
├── networkGraph/               # Network topology visualization plugin
│   ├── session-log.md
│   ├── README.md
│   └── ... (plugin files)
├── nlqSearch/                  # Natural language query search plugin
│   ├── session-log.md
│   ├── README.md
│   └── ... (plugin files)
├── complianceView/             # Comparative compliance dashboard plugin
│   ├── session-log.md
│   ├── README.md
│   └── ... (plugin files)
├── pecaRules/                  # PECA 2016 custom Wazuh rules
│   └── peca_rules.xml
└── (future feature folders follow the same pattern)
```

Each feature lives in its own folder. Every feature folder must contain:
- `README.md` — documents architecture, routes, data sources, usage
- `session-log.md` — detailed log of everything done: research findings, files created, issues encountered, fixes applied, what works, what's untested

### Session Log Rules

- **Always append** to the existing session-log.md for the feature you're working on. Never overwrite it.
- If a session-log.md does not exist for the feature, create one.
- Log entries should include: date, what was researched, what files were created/modified, issues found, how they were resolved, and current status (working / untested / broken).

---

## Plugin Development Pattern

All custom plugins are OpenSearch Dashboards plugins built for OSD 2.19.4. They follow this pattern:

- **Vanilla JS + D3.js** — no React imports from OSD. UI is pure JavaScript.
- **webpack 5** — custom webpack config to bundle the plugin since OSD's build toolchain is not available without the full source tree.
- **Build in /tmp** — VirtualBox shared folder (vboxsf) does not support symlinks, so `npm install` fails there. Always copy source to `/tmp/` before building, then copy the built bundle back.
- **`__osdBundles__` registration** — the compiled bundle must call `window.__osdBundles__.define("plugin/<pluginId>/public", fn, 0)` to register with OSD. Use `window.__osdBundles__` explicitly (not bare `__osdBundles__`) to prevent webpack terser from optimizing out the call.
- **Server-side proxy** — browser code should not call the Wazuh API directly. Create server-side routes that proxy to the Wazuh API, handling JWT authentication and token caching.
- **opensearch_dashboards.json** — manifest with `opensearchDashboardsVersion: "2.19.4"`, `server: true`, `ui: true`.

---

## Install Script

`wazuh-fyp-repo/install.sh` is the master install script. It supports feature flags:

```bash
sudo bash install.sh                            # installs ALL features
sudo bash install.sh --only networkGraph nlqSearch  # installs only specified features
sudo bash install.sh --skip complianceView          # installs everything except specified
sudo bash install.sh --list                         # prints available features
sudo bash install.sh --help                         # prints usage
```

Each feature has a registered install function (e.g. `install_networkGraph`). The dashboard is restarted only once after all selected features are installed. When adding a new feature, register its install function in install.sh following the existing pattern.

---

## Wazuh API Authentication

To get a JWT token:
```bash
TOKEN=$(curl -k -s -u wazuh-wui:"v86bPF+u+2nph5LxghIFWivBr87qPgJL" \
  https://localhost:55000/security/user/authenticate \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
```

Then use it:
```bash
curl -k -s -H "Authorization: Bearer $TOKEN" https://localhost:55000/agents?pretty=true
```

Tokens expire after 15 minutes. Server-side plugin routes should cache the token and refresh on expiry.

---

## PECA 2016 Compliance Mapping

Custom Wazuh rules use `rule.groups` for PECA tagging (not dedicated XML tags like the built-in PCI DSS/HIPAA frameworks). The groups follow the format `peca_N` where N is the PECA section number.

| PECA Section | Description | Rule Group |
|-------------|-------------|------------|
| 3 | Unauthorized Access to Information System or Data | peca_3 |
| 4 | Unauthorized Copying or Transmission of Data | peca_4 |
| 5 | Interference with Information System or Data | peca_5 |
| 6 | Unauthorized Access to Critical Infrastructure | peca_6 |
| 8 | Unauthorized Interception | peca_8 |
| 11 | Electronic Forgery | peca_11 |
| 20 | Offenses by Malicious Code | peca_20 |
| 21 | Cyber Terrorism | peca_21 |
| 36 | Data Protection of Service Providers | peca_36 |
| 37 | Data Retention | peca_37 |

Built-in compliance frameworks (PCI DSS, HIPAA, GDPR, NIST 800-53, TSC) use dedicated fields in alert documents: `rule.pci_dss`, `rule.hipaa`, `rule.gdpr`, `rule.nist_800_53`, `rule.tsc`.

---

## VirtualBox Shared Folder Limitation

The shared folder `/media/sf_sharedfolderclone/` is mounted as vboxsf which does not support symbolic links. This breaks `npm install` because npm creates symlinks in `node_modules/.bin/`. 

**Workaround:** Always copy source to `/tmp/` before running `npm install` or any build step, then copy the built artifacts back to the shared folder.

---

## Git and GitHub

**Do not** run any git commands (git add, git commit, git push, git pull, git checkout, etc.). Do not initialize repos, create branches, or modify .gitignore. All version control is handled manually and separately. Just write the files — nothing else.

---

## Code Quality Standards

All code produced will be audited by automated tools (Codex, linters, static analysis) and reviewed by evaluators. Write accordingly:

- **Robust error handling everywhere.** Every API call, file read, network request, and JSON parse must be wrapped in try/catch or equivalent. Never assume a call will succeed. Handle timeouts, malformed responses, missing fields, and connection failures gracefully.
- **Input validation.** Validate all inputs — API request bodies, query parameters, config values, environment variables. Fail early with clear error messages, not silently with undefined behavior.
- **No hardcoded secrets in committed files.** API keys, passwords, and credentials must come from environment variables or config files listed in .gitignore. Use `.env.example` files with placeholder values.
- **Meaningful variable and function names.** No single-letter variables outside of loop counters. No ambiguous abbreviations. Code should be readable without comments.
- **Comments where intent is non-obvious.** Don't comment what the code does (the code says that). Comment why a non-obvious decision was made, why a workaround exists, or what a magic number means.
- **Consistent code style.** Follow the conventions already present in the codebase. If starting fresh, use standard linting rules for the language (ESLint defaults for JS, PEP 8 for Python).
- **No dead code.** Don't leave commented-out blocks, unused imports, or unreachable branches. If something is removed, remove it fully.
- **Defensive coding.** Check for null/undefined before accessing nested properties. Use optional chaining and default values. Assume external data (API responses, user input) is malformed until proven otherwise.

---

## Testing Requirements

Every feature must be tested before being marked as done. Do not skip testing.

- **After building a plugin:** Run install.sh, restart the dashboard, check `journalctl -u wazuh-dashboard --no-pager | grep -i <pluginName>` for server-side errors, and load the plugin URL in the browser.
- **After creating server-side routes:** Test every route with `curl` and verify the response structure and status codes. Test with valid input, invalid input, and missing input.
- **After writing transpiler/parser logic:** Run against known test cases and verify output matches expected results.
- **Log all test results** in the session-log.md — what was tested, the exact command or action performed, and the actual output. Include both passing and failing tests.
