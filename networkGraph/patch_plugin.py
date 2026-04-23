#!/usr/bin/env python3
"""
patch_plugin.py — Idempotent patch that registers the Network Graph plugin
as a Threat Intelligence entry in the Wazuh sidebar and overview page.

Patches applied to wazuh.plugin.js:
  1. network_graph_app constant (order 303, wz-category-threat-intelligence)
     Inserted before `const docker=` — the same general area used for
     peca_app (406) and compliance_overview_app (407).
  2. Apps list — insert network_graph_app alongside the other custom apps.

No chunk.2.js changes are needed: networkGraph is a standalone OSD plugin
at /app/networkGraph, not a Wazuh overview-module tab.  The Wazuh overview
page reads registered apps and calls redirectTo() — no module catalog entry,
tab-count entry, or module-config entry is required.

All patches are idempotent: already-applied patches are detected and skipped.
"""
import sys

PLUGIN = '/usr/share/wazuh-dashboard/plugins/wazuh/target/public/wazuh.plugin.js'

I18N = '_osd_i18n__WEBPACK_IMPORTED_MODULE_0__["i18n"].translate'


def apply_patch(content, old, new, label):
    if new in content:
        print(f'  [SKIP] already applied: {label}')
        return content, 'skipped'
    if old not in content:
        print(f'  [WARN] anchor not found: {label}', file=sys.stderr)
        return content, 'missing'
    content = content.replace(old, new, 1)
    print(f'  [OK]   applied: {label}')
    return content, 'applied'


def apply_patch_marker(content, old, new, marker, label):
    if marker in content:
        print(f'  [SKIP] already applied: {label}')
        return content, 'skipped'
    if old not in content:
        print(f'  [WARN] anchor not found: {label}', file=sys.stderr)
        return content, 'missing'
    content = content.replace(old, new, 1)
    print(f'  [OK]   applied: {label}')
    return content, 'applied'


# ── 1. network_graph_app constant ─────────────────────────────────────────────
# Placed in wz-category-threat-intelligence at order 303, after MITRE ATT&CK
# (302) and before the cloud-security category (which starts at ~350+).
# redirectTo points directly to the standalone OSD plugin URL — no agent-context
# store lookup needed since network topology is a global (not per-agent) view.
NET_GRAPH_APP = (
    'const network_graph_app={'
    'category:"wz-category-threat-intelligence",'
    'id:"network-graph",'
    f'title:{I18N}("wz-app-network-graph-title",{{defaultMessage:"Network Graph"}}),'
    f'breadcrumbLabel:{I18N}("wz-app-network-graph-breadcrumbLabel",{{defaultMessage:"Network Graph"}}),'
    f'description:{I18N}("wz-app-network-graph-description",'
    '{defaultMessage:"Visualize agent network topology, live connections, and alert traffic across your monitored infrastructure."}),'
    'euiIconType:"visNetwork",'
    'order:303,'
    'showInOverviewApp:true,'
    'showInAgentMenu:false,'
    "redirectTo:()=>'/app/networkGraph'};"
)
NET_GRAPH_MARKER = 'const network_graph_app='

# Anchor: the end of the compliance_overview_app redirectTo, immediately before
# `const docker=`.  This is verified unique in Wazuh 4.14.3 + our custom patches.
# We rely on the compliance_overview_app already being present (installed by the
# complianceView feature).  If it is absent we fall back to the original TSC anchor.
CO_ANCHOR = 'redirectTo:()=>`/overview/?tab=compliance-overview&tabView=dashboard`};const docker='
CO_ANCHOR_NEW = (
    'redirectTo:()=>`/overview/?tab=compliance-overview&tabView=dashboard`};'
    + NET_GRAPH_APP
    + 'const docker='
)

# Fallback anchor: used when compliance_overview_app has not yet been patched
# (e.g. this script runs before complianceView/install.sh).
TSC_ANCHOR = '}`}};const docker='
TSC_ANCHOR_NEW = '}`}};' + NET_GRAPH_APP + 'const docker='


# ── 2. Apps list entry ────────────────────────────────────────────────────────
# The array is .sort()ed by the `order` value so insertion position is cosmetic.
# Primary: after compliance_overview_app (the last of our custom entries).
# Fallback: before the sort call.
APPS_OLD_PRIMARY  = ',compliance_overview_app,devTools,'
APPS_NEW_PRIMARY  = ',compliance_overview_app,network_graph_app,devTools,'
APPS_OLD_FALLBACK = ',about,ITHygiene].sort('
APPS_NEW_FALLBACK = ',about,ITHygiene,network_graph_app].sort('


def patch_plugin():
    print('=== Patching wazuh.plugin.js (networkGraph sidebar entry) ===')
    with open(PLUGIN, 'r', encoding='utf-8') as f:
        p = f.read()

    # ── Step 1: network_graph_app constant ────────────────────────────────────
    if NET_GRAPH_MARKER in p:
        print(f'  [SKIP] already applied: network_graph_app definition')
    elif CO_ANCHOR in p:
        p, _ = apply_patch_marker(
            p, CO_ANCHOR, CO_ANCHOR_NEW, NET_GRAPH_MARKER,
            'network_graph_app definition (after compliance_overview_app)'
        )
    elif TSC_ANCHOR in p:
        p, _ = apply_patch_marker(
            p, TSC_ANCHOR, TSC_ANCHOR_NEW, NET_GRAPH_MARKER,
            'network_graph_app definition (TSC fallback anchor)'
        )
    else:
        print('  [ERROR] no suitable anchor found for network_graph_app constant',
              file=sys.stderr)
        sys.exit(1)

    # ── Step 2: apps list ─────────────────────────────────────────────────────
    if ',network_graph_app,' in p or ',network_graph_app]' in p:
        print('  [SKIP] already applied: network_graph_app in apps list')
    elif APPS_OLD_PRIMARY in p:
        p, _ = apply_patch(
            p, APPS_OLD_PRIMARY, APPS_NEW_PRIMARY,
            'apps list: insert network_graph_app after compliance_overview_app'
        )
    else:
        p, _ = apply_patch(
            p, APPS_OLD_FALLBACK, APPS_NEW_FALLBACK,
            'apps list fallback: insert network_graph_app before sort'
        )

    with open(PLUGIN, 'w', encoding='utf-8') as f:
        f.write(p)
    print('plugin.js written.\n')


if __name__ == '__main__':
    try:
        patch_plugin()
    except Exception as e:
        print(f'[ERROR] plugin.js patch failed: {e}', file=sys.stderr)
        sys.exit(1)
    print('Network Graph sidebar patch complete.')
