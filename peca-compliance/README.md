# PECA 2016 Compliance Rules

This folder contains Wazuh detection rules and implementation notes for the
**Prevention of Electronic Crimes Act 2016 (PECA)** compliance module.

---

## Files

| File | Description |
|------|-------------|
| `peca_rules.xml` | Wazuh detection rules mapped to PECA sections |
| `PECA-2016-compliance-module.md` | Full implementation log — research findings, all file changes, bundle edits, and incident recovery notes |

---

## How PECA Rules Work

PECA rules use Wazuh's group tagging system. Every rule in `peca_rules.xml` is
inside `<group name="peca,">`, which tags all resulting alerts with the group
`peca`. Individual rules then add section-specific tags like `peca_3`, `peca_4`,
etc. in their own `<group>` element.

Example:
```xml
<group name="peca,">
  <rule id="100100" level="10">
    <if_sid>5710, 5716</if_sid>
    <description>PECA Sec 3: Potential Unauthorized Access Attempt.</description>
    <group>authentication_failed,peca_3,</group>
  </rule>
</group>
```

In OpenSearch, this alert will have:
```json
"rule.groups": ["peca", "peca_3", "authentication_failed"]
```

The dashboard module filters on `rule.groups: "peca"` to show all PECA alerts,
and the section tags (`peca_3`, `peca_20`, etc.) allow per-section breakdown.

---

## PECA Sections Covered

| Section | Title | Rule IDs | Status |
|---------|-------|----------|--------|
| 3  | Unauthorized Access to Information System or Data | 100100 | Active |
| 4  | Unauthorized Copying or Transmission of Data | 100101 | Active |
| 5  | Interference with Information System or Data | — | No rules yet |
| 6  | Unauthorized Access to Critical Infrastructure | 100102 | Active |
| 8  | Unauthorized Interception | 100102 | Active |
| 11 | Electronic Forgery | 100101 | Active |
| 20 | Offenses by Malicious Code | 100103 | Active |
| 21 | Cyber Terrorism | — | No rules yet |
| 36 | Data Protection of Service Providers | — | No rules yet |
| 37 | Data Retention | — | No rules yet |

---

## Rule ID Range

PECA rules use IDs **100100–100103** to avoid conflicts with Wazuh built-in
rules (1–99999) and the default local rules range. The `setup.sh` script
automatically detects and resolves any ID conflicts if they arise.

---

## Dashboard Module

The PECA compliance module is integrated into the Wazuh Dashboard alongside
PCI DSS, HIPAA, GDPR, NIST 800-53, and TSC. It appears in the Modules section
and shows a filtered events view for all PECA-tagged alerts.

The dashboard integration requires edits to the Wazuh plugin's compiled
JavaScript bundles. These are handled automatically by `setup.sh` (Step C).
The modified source files are in `../wazuh-custom/`.

For full implementation details, see `PECA-2016-compliance-module.md`.
