#!/usr/bin/env python3
"""
Create PECA compliance saved objects (visualizations + dashboard) in OpenSearch .kibana_1.
Writes directly via the OpenSearch API using admin certs.
"""

import json
import subprocess
import sys

OPENSEARCH = "https://127.0.0.1:9200"
KIBANA_INDEX = ".kibana_1"
CERTS = {
    "cacert": "/etc/wazuh-indexer/certs/root-ca.pem",
    "cert":   "/etc/wazuh-indexer/certs/admin.pem",
    "key":    "/etc/wazuh-indexer/certs/admin-key.pem",
}

INDEX_PATTERN = "wazuh-alerts-*"

# Base search source — all PECA alerts filtered by rule.groups: peca
SEARCH_SOURCE = json.dumps({
    "index": INDEX_PATTERN,
    "filter": [
        {
            "meta": {
                "index": INDEX_PATTERN,
                "negate": False,
                "disabled": False,
                "alias": None,
                "type": "phrase",
                "key": "rule.groups",
                "value": "peca",
                "params": {"query": "peca", "type": "phrase"}
            },
            "query": {"match_phrase": {"rule.groups": "peca"}},
            "$state": {"store": "appState"}
        }
    ],
    "query": {"query": "", "language": "lucene"}
})


def curl_put(doc_id, body):
    url = f"{OPENSEARCH}/{KIBANA_INDEX}/_doc/{doc_id}"
    cmd = [
        "curl", "-sk",
        "--cacert", CERTS["cacert"],
        "--cert",   CERTS["cert"],
        "--key",    CERTS["key"],
        "-XPUT", url,
        "-H", "Content-Type: application/json",
        "-d", json.dumps(body)
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    resp = json.loads(result.stdout)
    status = resp.get("result", resp.get("error", "?"))
    print(f"  [{status}] {doc_id}")
    if "error" in resp:
        print(f"    ERROR: {resp}")
    return resp


# ── 1. PECA Alerts Over Time (line chart) ─────────────────────────────────────

vis_timeline = {
    "type": "visualization",
    "visualization": {
        "title": "PECA Alerts Over Time",
        "visState": json.dumps({
            "title": "PECA Alerts Over Time",
            "type": "line",
            "params": {
                "type": "line",
                "grid": {"categoryLines": False},
                "categoryAxes": [{
                    "id": "CategoryAxis-1", "type": "category", "position": "bottom",
                    "show": True, "scale": {"type": "linear"},
                    "labels": {"show": True, "filter": True, "truncate": 100},
                    "title": {}
                }],
                "valueAxes": [{
                    "id": "ValueAxis-1", "name": "LeftAxis-1", "type": "value",
                    "position": "left", "show": True,
                    "scale": {"type": "linear", "mode": "normal"},
                    "labels": {"show": True, "rotate": 0, "filter": False, "truncate": 100},
                    "title": {"text": "Alert Count"}
                }],
                "seriesParams": [{
                    "show": True, "type": "line", "mode": "normal",
                    "data": {"label": "Alert Count", "id": "1"},
                    "valueAxis": "ValueAxis-1",
                    "drawLinesBetweenPoints": True,
                    "lineWidth": 2, "interpolate": "linear", "showCircles": True
                }],
                "addTooltip": True, "addLegend": True, "legendPosition": "right",
                "times": [], "addTimeMarker": False, "labels": {},
                "thresholdLine": {"show": False, "value": 10, "width": 1, "style": "full", "color": "#E7664C"}
            },
            "aggs": [
                {"id": "1", "enabled": True, "type": "count", "schema": "metric", "params": {}},
                {
                    "id": "2", "enabled": True, "type": "date_histogram", "schema": "segment",
                    "params": {
                        "field": "@timestamp",
                        "useNormalizedOpenSearchInterval": True,
                        "scaleMetricValues": False,
                        "interval": "auto",
                        "drop_partials": False,
                        "min_doc_count": 1,
                        "extended_bounds": {}
                    }
                }
            ]
        }),
        "uiStateJSON": "{}",
        "description": "PECA compliance alerts over time",
        "version": 1,
        "kibanaSavedObjectMeta": {"searchSourceJSON": SEARCH_SOURCE}
    }
}

# ── 2. PECA Alerts by Section (horizontal bar — filters agg) ──────────────────

PECA_SECTIONS = [
    ("peca_3",  "Sec 3 - Unauthorized Access"),
    ("peca_4",  "Sec 4 - Unauthorized Copying/Transmission"),
    ("peca_5",  "Sec 5 - Interference with IS"),
    ("peca_6",  "Sec 6 - Critical Infrastructure"),
    ("peca_8",  "Sec 8 - Unauthorized Interception"),
    ("peca_11", "Sec 11 - Electronic Forgery"),
    ("peca_20", "Sec 20 - Malicious Code"),
    ("peca_21", "Sec 21 - Cyber Terrorism"),
    ("peca_36", "Sec 36 - Data Protection"),
    ("peca_37", "Sec 37 - Data Retention"),
]

filters_agg_filters = {}
for group, label in PECA_SECTIONS:
    filters_agg_filters[label] = {
        "query": {"match_phrase": {"rule.groups": group}}
    }

vis_by_section = {
    "type": "visualization",
    "visualization": {
        "title": "PECA Alerts by Section",
        "visState": json.dumps({
            "title": "PECA Alerts by Section",
            "type": "histogram",
            "params": {
                "type": "histogram",
                "grid": {"categoryLines": False},
                "categoryAxes": [{
                    "id": "CategoryAxis-1", "type": "category", "position": "left",
                    "show": True, "scale": {"type": "linear"},
                    "labels": {"show": True, "rotate": 0, "filter": False, "truncate": 200},
                    "title": {}
                }],
                "valueAxes": [{
                    "id": "ValueAxis-1", "name": "LeftAxis-1", "type": "value",
                    "position": "bottom", "show": True,
                    "scale": {"type": "linear", "mode": "normal"},
                    "labels": {"show": True, "rotate": 0, "filter": True, "truncate": 100},
                    "title": {"text": "Alert Count"}
                }],
                "seriesParams": [{
                    "show": True, "type": "histogram", "mode": "normal",
                    "data": {"label": "Alert Count", "id": "1"},
                    "valueAxis": "ValueAxis-1"
                }],
                "addTooltip": True, "addLegend": False, "legendPosition": "right",
                "times": [], "addTimeMarker": False,
                "labels": {"show": False},
                "thresholdLine": {"show": False, "value": 10, "width": 1, "style": "full", "color": "#E7664C"}
            },
            "aggs": [
                {"id": "1", "enabled": True, "type": "count", "schema": "metric", "params": {}},
                {
                    "id": "2", "enabled": True, "type": "filters", "schema": "segment",
                    "params": {
                        "filters": [
                            {"input": {"query": f"rule.groups: {grp}", "language": "lucene"}, "label": label}
                            for grp, label in PECA_SECTIONS
                        ]
                    }
                }
            ]
        }),
        "uiStateJSON": "{}",
        "description": "Count of PECA alerts per PECA section",
        "version": 1,
        "kibanaSavedObjectMeta": {"searchSourceJSON": SEARCH_SOURCE}
    }
}

# ── 3. PECA Alerts by Severity Level (pie) ────────────────────────────────────

vis_by_level = {
    "type": "visualization",
    "visualization": {
        "title": "PECA Alerts by Severity Level",
        "visState": json.dumps({
            "title": "PECA Alerts by Severity Level",
            "type": "pie",
            "params": {
                "type": "pie",
                "addTooltip": True,
                "addLegend": True,
                "legendPosition": "right",
                "isDonut": True,
                "labels": {
                    "show": True,
                    "values": True,
                    "last_level": True,
                    "truncate": 100
                }
            },
            "aggs": [
                {"id": "1", "enabled": True, "type": "count", "schema": "metric", "params": {}},
                {
                    "id": "2", "enabled": True, "type": "terms", "schema": "segment",
                    "params": {
                        "field": "rule.level",
                        "size": 10,
                        "order": "desc",
                        "orderBy": "1",
                        "otherBucket": False,
                        "otherBucketLabel": "Other",
                        "missingBucket": False,
                        "missingBucketLabel": "Missing"
                    }
                }
            ]
        }),
        "uiStateJSON": "{}",
        "description": "Distribution of PECA alerts by Wazuh severity level",
        "version": 1,
        "kibanaSavedObjectMeta": {"searchSourceJSON": SEARCH_SOURCE}
    }
}

# ── 4. PECA Top Rules Fired (data table) ─────────────────────────────────────

vis_top_rules = {
    "type": "visualization",
    "visualization": {
        "title": "PECA Top Rules Fired",
        "visState": json.dumps({
            "title": "PECA Top Rules Fired",
            "type": "table",
            "params": {
                "perPage": 10,
                "showPartialRows": False,
                "showMetricsAtAllLevels": False,
                "sort": {"columnIndex": None, "direction": None},
                "showTotal": False,
                "totalFunc": "sum",
                "percentageCol": ""
            },
            "aggs": [
                {"id": "1", "enabled": True, "type": "count", "schema": "metric", "params": {}},
                {
                    "id": "2", "enabled": True, "type": "terms", "schema": "bucket",
                    "params": {
                        "field": "rule.id",
                        "size": 10,
                        "order": "desc",
                        "orderBy": "1",
                        "otherBucket": False,
                        "missingBucket": False,
                        "customLabel": "Rule ID"
                    }
                },
                {
                    "id": "3", "enabled": True, "type": "terms", "schema": "bucket",
                    "params": {
                        "field": "rule.description",
                        "size": 1,
                        "order": "desc",
                        "orderBy": "1",
                        "otherBucket": False,
                        "missingBucket": False,
                        "customLabel": "Description"
                    }
                }
            ]
        }),
        "uiStateJSON": json.dumps({"vis": {"params": {"sort": {"columnIndex": 0, "direction": "desc"}}}}),
        "description": "Top PECA rules by alert count with descriptions",
        "version": 1,
        "kibanaSavedObjectMeta": {"searchSourceJSON": SEARCH_SOURCE}
    }
}

# ── 5. PECA Alerts by Agent (bar chart) ──────────────────────────────────────

vis_by_agent = {
    "type": "visualization",
    "visualization": {
        "title": "PECA Alerts by Agent",
        "visState": json.dumps({
            "title": "PECA Alerts by Agent",
            "type": "histogram",
            "params": {
                "type": "histogram",
                "grid": {"categoryLines": False},
                "categoryAxes": [{
                    "id": "CategoryAxis-1", "type": "category", "position": "bottom",
                    "show": True, "scale": {"type": "linear"},
                    "labels": {"show": True, "filter": True, "truncate": 100},
                    "title": {}
                }],
                "valueAxes": [{
                    "id": "ValueAxis-1", "name": "LeftAxis-1", "type": "value",
                    "position": "left", "show": True,
                    "scale": {"type": "linear", "mode": "normal"},
                    "labels": {"show": True, "rotate": 0, "filter": False, "truncate": 100},
                    "title": {"text": "Alert Count"}
                }],
                "seriesParams": [{
                    "show": True, "type": "histogram", "mode": "normal",
                    "data": {"label": "Alert Count", "id": "1"},
                    "valueAxis": "ValueAxis-1"
                }],
                "addTooltip": True, "addLegend": False, "legendPosition": "right",
                "times": [], "addTimeMarker": False,
                "labels": {"show": False},
                "thresholdLine": {"show": False, "value": 10, "width": 1, "style": "full", "color": "#E7664C"}
            },
            "aggs": [
                {"id": "1", "enabled": True, "type": "count", "schema": "metric", "params": {}},
                {
                    "id": "2", "enabled": True, "type": "terms", "schema": "segment",
                    "params": {
                        "field": "agent.name",
                        "size": 10,
                        "order": "desc",
                        "orderBy": "1",
                        "otherBucket": False,
                        "missingBucket": False
                    }
                }
            ]
        }),
        "uiStateJSON": "{}",
        "description": "PECA alerts distributed by monitored agent/host",
        "version": 1,
        "kibanaSavedObjectMeta": {"searchSourceJSON": SEARCH_SOURCE}
    }
}

# ── Dashboard ─────────────────────────────────────────────────────────────────

PANEL_W = 24  # half of 48-column grid
PANEL_H = 15

dashboard_panels = json.dumps([
    {
        "panelIndex": "1", "gridData": {"x": 0, "y": 0, "w": 48, "h": 12, "i": "1"},
        "version": "2.19.4",
        "embeddableConfig": {},
        "panelRefName": "panel_1"
    },
    {
        "panelIndex": "2", "gridData": {"x": 0, "y": 12, "w": 24, "h": PANEL_H, "i": "2"},
        "version": "2.19.4",
        "embeddableConfig": {},
        "panelRefName": "panel_2"
    },
    {
        "panelIndex": "3", "gridData": {"x": 24, "y": 12, "w": 24, "h": PANEL_H, "i": "3"},
        "version": "2.19.4",
        "embeddableConfig": {},
        "panelRefName": "panel_3"
    },
    {
        "panelIndex": "4", "gridData": {"x": 0, "y": 27, "w": 32, "h": PANEL_H, "i": "4"},
        "version": "2.19.4",
        "embeddableConfig": {},
        "panelRefName": "panel_4"
    },
    {
        "panelIndex": "5", "gridData": {"x": 32, "y": 27, "w": 16, "h": PANEL_H, "i": "5"},
        "version": "2.19.4",
        "embeddableConfig": {},
        "panelRefName": "panel_5"
    },
])

dashboard_references = [
    {"name": "panel_1", "type": "visualization", "id": "peca-alerts-timeline"},
    {"name": "panel_2", "type": "visualization", "id": "peca-alerts-by-section"},
    {"name": "panel_3", "type": "visualization", "id": "peca-alerts-by-level"},
    {"name": "panel_4", "type": "visualization", "id": "peca-top-rules"},
    {"name": "panel_5", "type": "visualization", "id": "peca-alerts-by-agent"},
]

dashboard = {
    "type": "dashboard",
    "references": dashboard_references,
    "dashboard": {
        "title": "PECA 2016 Compliance",
        "description": "Prevention of Electronic Crimes Act 2016 — alert overview and section breakdown",
        "panelsJSON": dashboard_panels,
        "optionsJSON": json.dumps({"useMargins": True, "syncColors": False, "hidePanelTitles": False}),
        "version": 1,
        "timeRestore": False,
        "kibanaSavedObjectMeta": {
            "searchSourceJSON": json.dumps({"query": {"query": "", "language": "lucene"}, "filter": []})
        }
    }
}

# ── Create all objects ────────────────────────────────────────────────────────

print("Creating PECA visualizations and dashboard...")
print()

objects = [
    ("visualization:peca-alerts-timeline",    vis_timeline),
    ("visualization:peca-alerts-by-section",  vis_by_section),
    ("visualization:peca-alerts-by-level",    vis_by_level),
    ("visualization:peca-top-rules",          vis_top_rules),
    ("visualization:peca-alerts-by-agent",    vis_by_agent),
    ("dashboard:peca-compliance-dashboard",   dashboard),
]

for doc_id, body in objects:
    curl_put(doc_id, body)

print()
print("Done. Open the dashboard at:")
print("  https://localhost/app/dashboards#/view/peca-compliance-dashboard")
print("  (or search for 'PECA' in Dashboards)")
