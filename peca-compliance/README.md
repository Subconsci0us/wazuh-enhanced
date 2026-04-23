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

## PECA Sections Coverage

All sections from Chapter II (Offences and Punishments) were evaluated against
available Wazuh log sources. Sections from Chapters III–VII are procedural,
administrative, or investigative-power provisions and generate no system events.

### Detectable Sections — Active Rules

| Section | Title (verified from PDF) | Rule ID(s) | Status | Wazuh Source |
|---------|--------------------------|------------|--------|--------------|
| 3  | Unauthorized Access to Information System or Data | 100100 | Active | SSHD/PAM auth failures (SID 5710, 5716, 5503, 5504) |
| 4  | Unauthorized Copying or Transmission of Data | 100101 | Active | Syscheck integrity change (SID 550) |
| 5  | Interference with Information System or Data | 100104 | Active | Syscheck file deletion (SID 553) |
| 6  | Unauthorized Access to Critical Infrastructure Information System or Data | 100102 | Active | Syscheck integrity change on critical path (SID 550) |
| 7  | Unauthorized Copying or Transmission of Critical Infrastructure Data | 100105 | Active | Syscheck new file in critical path (SID 554) |
| 8  | Interference with Critical Infrastructure Information System or Data | 100102 | Active | Syscheck integrity change on critical path (SID 550) |
| 10 | Cyber Terrorism | 100106 | Active | Overlay on Sec 6/7/8 rules (SID 100102, 100105) |
| 11 | Electronic Forgery | 100101 | Active | Syscheck integrity change (SID 550) |
| 12 | Electronic Fraud | 100107 | Active | Web application injection attacks (if_group web) |
| 13 | Making, Obtaining or Supplying Device for Use in Offence | 100108 | Active | Syscheck: known offensive tool binary added (SID 554) |
| 14 | Unauthorized Use of Identity Information | 100109 | Active | Syscheck: /etc/shadow modification (SID 550) |
| 17 | Unauthorized Interception | 100110 | Active | Rootcheck: promiscuous mode / packet capture tool (if_group rootcheck) |
| 20 | Offences Against Malicious Code | 100103 | Active | Rootcheck / rootkit detection (if_group rootcheck) |
| 21 | Cyber Stalking | 100111 | Active | SSHD: repeated auth failures (SID 5716) |
| 22 | Spamming | 100112 | Active | Postfix: bounce/reject/flood events (if_group postfix) |
| 23 | Spoofing | 100113 | Active | Network attack: ARP/DNS spoofing (if_group attack) |

### Out of Scope — Content-Based Offences

These sections describe offences based on the *content* of communications or
publications. Content classification generates no log event that a SIEM can
ingest. Attempting to write rules for these sections would produce only
false positives or noise with no reliable true-positive signal.

| Section | Title (verified from PDF) | Reason |
|---------|--------------------------|--------|
| 9   | Glorification of an Offence | Content-based: disseminating material glorifying terrorism |
| 10A | Hate Speech | Content-based: publishing inter-faith/sectarian/racial hatred material |
| 10B | Recruitment, Funding and Planning of Terrorism | Content-based: inviting/motivating terrorism funding or recruitment |
| 18  | Offences Against Dignity of a Natural Person | Content-based: false defamatory information transmitted online |
| 19  | Offences Against Modesty of a Natural Person and Minor | Content-based: sexually explicit material |
| 19A | Child Pornography | Content-based: sexual imagery involving minors |

### Out of Scope — Telecoms/Physical Obligations

| Section | Title (verified from PDF) | Reason |
|---------|--------------------------|--------|
| 15 | Unauthorized Issuance of SIM Cards | Telecoms-operator obligation (subscriber verification); no SIEM event |
| 16 | Tampering with Communication Equipment | Physical IMEI tampering; no standard log source |

### Out of Scope — Procedural, Administrative, or Investigative-Power Sections

Chapters III–VII of PECA define investigative powers, court procedures,
establishment of agencies, and international cooperation. None of these generate
system log events.

| Section | Title (verified from PDF) | Reason |
|---------|--------------------------|--------|
| 24  | Legal Recognition of Offences in Relation to Information System | Procedural / legal recognition clause |
| 25  | Pakistan Penal Code to Apply | Procedural / applicability clause |
| 26–35 | Investigation agency powers, warrants, data preservation, search and seizure | Chapter III — investigative procedures |
| 36  | Real-time Collection and Recording of Information | Chapter III — court-ordered real-time intercept; ISP obligation, not a SIEM event |
| 37  | Forensic Laboratory | Chapter IV — government lab establishment; administrative |
| 38  | Confidentiality of Information | Chapter IV — confidentiality obligation on officers |
| 39  | International Cooperation | Chapter IV — government-to-government cooperation |
| 40–51 | Prosecution, trial, preventive measures, miscellaneous | Chapters V–VII — court and administrative procedures |

> **README correction note:** An earlier version of this table incorrectly titled
> Section 21 as "Cyber Terrorism" (the correct title is **Cyber Stalking**),
> Section 36 as "Data Protection of Service Providers" (the correct title is
> **Real-time Collection and Recording of Information**), and Section 37 as
> "Data Retention" (the correct title is **Forensic Laboratory**). All titles
> have been verified directly from the PECA 2016 PDF.

---

## Rule ID Range

PECA rules use IDs **100100–100113** to avoid conflicts with Wazuh built-in
rules (1–99999) and the default local rules range. The next available ID for
future PECA rules is **100114**.

---

## Severity Levels Used

| Level | Meaning |
|-------|---------|
| 7  | Medium severity — potential offence indicator, may need correlation |
| 10 | High severity — confirmed attack pattern mapped to PECA section |
| 12 | Critical — critical infrastructure involvement or cyber terrorism overlay |

---

## Dashboard Module

The PECA compliance module is integrated into the Wazuh Dashboard alongside
PCI DSS, HIPAA, GDPR, NIST 800-53, and TSC. It appears in the Modules section
and shows a filtered events view for all PECA-tagged alerts.

The dashboard integration requires edits to the Wazuh plugin's compiled
JavaScript bundles. These are handled automatically by `setup.sh` (Step C).
The modified source files are in `../wazuh-custom/`.

For full implementation details, see `PECA-2016-compliance-module.md`.
