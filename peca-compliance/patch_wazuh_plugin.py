#!/usr/bin/env python3
"""
Patch wazuh.plugin.js to add the missing `const peca` Application object.

The compiled Wazuh bundle references `peca` as a bare variable in the
Applications array but ships without the corresponding `const peca = {...}`
declaration (every other compliance module — pciDss, hipaa, gdpr, nist80053,
tsc — has one).  This causes a ReferenceError on page load that crashes the
entire Wazuh plugin before the UI renders.

This script injects the declaration immediately before `const Applications=[`
using the same structure and webpack-import variable names as the existing
compliance module objects.  The patch is idempotent: re-running it on an
already-patched bundle is a no-op.
"""

import re
import sys

BUNDLE = '/usr/share/wazuh-dashboard/plugins/wazuh/target/public/wazuh.plugin.js'

# Marker that must exist in the Applications array to confirm the bundle
# already references peca (if it doesn't we skip — nothing to fix).
APPLICATIONS_PECA_MARKER = ',peca,'

# Injection point: the semicolon closing the last Application const before
# the array literal.  We insert const peca immediately before `const Applications=[`.
INJECTION_POINT = '};const Applications=[fileIntegrityMonitoring'

# Already-patched sentinel — presence of this string means the script was
# already run and the bundle is in the correct state.
ALREADY_PATCHED_SENTINEL = 'const peca={category:"wz-category-security-operations"'


def detect_webpack_vars(content: str) -> tuple[str, str]:
    """Return (i18n_var, redux_var) by reading them from the `const tsc` definition."""
    tsc_idx = content.find('const tsc=')
    if tsc_idx == -1:
        raise RuntimeError('Could not locate `const tsc=` in bundle — wrong file?')
    region = content[tsc_idx: tsc_idx + 1000]

    i18n_match = re.search(r'(_osd_i18n[A-Za-z_0-9]*__WEBPACK_IMPORTED_MODULE_[0-9]+__)', region)
    redux_match = re.search(r'(_redux_store[A-Za-z_0-9]*__WEBPACK_IMPORTED_MODULE_[0-9]+__)', region)

    if not i18n_match:
        raise RuntimeError('Could not detect i18n webpack import variable name')
    if not redux_match:
        raise RuntimeError('Could not detect redux-store webpack import variable name')

    return i18n_match.group(1), redux_match.group(1)


def build_peca_const(i18n_var: str, redux_var: str) -> str:
    """Build the `const peca = {...}` declaration string."""
    i18n = f'{i18n_var}["i18n"].translate'
    store = f'{redux_var}["a"].getState()'

    # redirectTo mirrors the tsc pattern exactly, using distinct temp-var names
    # (_peca1/_peca2) so they do not clash with any existing generated names.
    redirect = (
        'redirectTo:()=>{'
        'var _peca1,_peca2;'
        'return `/overview/?tab=peca&tabView=dashboard${'
        '(_peca1=' + store + ')!==null&&'
        '_peca1!==void 0&&'
        '(_peca1=_peca1.appStateReducers)!==null&&'
        '_peca1!==void 0&&'
        '(_peca1=_peca1.currentAgentData)!==null&&'
        '_peca1!==void 0&&'
        '_peca1.id'
        '?`&agentId=${'
        '(_peca2=' + store + ')===null||'
        '_peca2===void 0||'
        '(_peca2=_peca2.appStateReducers)===null||'
        '_peca2===void 0||'
        '(_peca2=_peca2.currentAgentData)===null||'
        '_peca2===void 0'
        '?void 0'
        ':_peca2.id'
        '}`'
        ':""'
        '}`}'
    )

    return (
        'const peca={'
        'category:"wz-category-security-operations",'
        'id:"peca",'
        f'title:{i18n}("wz-app-peca-title",{{defaultMessage:"PECA"}}),'
        f'breadcrumbLabel:{i18n}("wz-app-peca-breadcrumbLabel",{{defaultMessage:"PECA"}}),'
        f'description:{i18n}("wz-app-peca-description",'
        '{'
        'defaultMessage:"Prevention of Electronic Crimes Act 2016 (PECA) — '
        "Pakistan's cybercrime law covering unauthorized access, data theft, "
        'and cyber terrorism."'
        '}),'
        'euiIconType:"packetbeatApp",'
        'order:406,'
        'showInOverviewApp:true,'
        'showInAgentMenu:true,'
        + redirect +
        '};'
    )


def main() -> int:
    try:
        with open(BUNDLE, 'r') as fh:
            content = fh.read()
    except OSError as exc:
        print(f'ERROR: Cannot read bundle: {exc}', file=sys.stderr)
        return 1

    # ── Already patched? ──────────────────────────────────────────────────────
    if ALREADY_PATCHED_SENTINEL in content:
        print('Bundle already patched — nothing to do.')
        return 0

    # ── Sanity checks ─────────────────────────────────────────────────────────
    if APPLICATIONS_PECA_MARKER not in content:
        print(
            'WARNING: `peca` not found in the Applications array — '
            'this bundle may not need patching or is a different version.',
            file=sys.stderr,
        )
        return 0

    if content.count(INJECTION_POINT) != 1:
        print(
            f'ERROR: Expected exactly 1 occurrence of injection marker, '
            f'got {content.count(INJECTION_POINT)}.',
            file=sys.stderr,
        )
        return 1

    # ── Detect webpack variable names ─────────────────────────────────────────
    try:
        i18n_var, redux_var = detect_webpack_vars(content)
    except RuntimeError as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 1

    print(f'Detected i18n var : {i18n_var}')
    print(f'Detected redux var: {redux_var}')

    # ── Build and inject ───────────────────────────────────────────────────────
    peca_const = build_peca_const(i18n_var, redux_var)

    # Insert right before `const Applications=[`
    new_content = content.replace(
        '};const Applications=[fileIntegrityMonitoring',
        '};' + peca_const + 'const Applications=[fileIntegrityMonitoring',
        1,
    )

    if new_content == content:
        print('ERROR: Replacement produced no change.', file=sys.stderr)
        return 1

    try:
        with open(BUNDLE, 'w') as fh:
            fh.write(new_content)
    except OSError as exc:
        print(f'ERROR: Cannot write bundle: {exc}', file=sys.stderr)
        return 1

    added = len(new_content) - len(content)
    print(f'SUCCESS: const peca injected (+{added} bytes).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
