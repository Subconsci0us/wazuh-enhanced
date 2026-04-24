# localization — Wazuh Dashboard Localization & Theme Plugin

OSD 2.19.4 plugin that injects a persistent floating toolbar (bottom-right corner) into every Wazuh Dashboard page, providing:

- **EN / UR language toggle** — two always-visible buttons; active language shown as solid blue (`#3b82f6`), inactive as muted outline
- **Dark mode** — comprehensive CSS override for OSD chrome and all custom FYP plugins
- **Theme broadcast** — dispatches `fyp-theme-changed` CustomEvent on `window` so other plugins (networkGraph, complianceView) can react without polling
- **Urdu / English translation** — DOM text replacement for networkGraph, nlqSearch, complianceView
- **RTL layout** — when Urdu is active, page content flips to right-to-left direction
- **Persistence** — theme and language choices survive navigation and page refresh via `localStorage`
- **Default theme** — light mode (`fyp_theme_v2 = 'light'`). Dark mode persists via `fyp_theme_v2 = 'dark'`

---

## Architecture

```
public/index.js
  ├── LocalizationPlugin.setup()   → sets window.__fypLocale__ stub (early, before start())
  ├── LocalizationPlugin.start()   → refreshes lang, injects toolbar, loads preferences, starts observer
  ├── setDarkMode(bool)            → injects/removes <style id="fyp-dark-mode">
  │                                   dispatches fyp-theme-changed CustomEvent
  ├── setLanguage('en'|'ur')       → swaps DOM text, applies RTL, fires event
  ├── _syncLangBtns(enBtn, urBtn)  → updates EN/UR button active/inactive styles
  ├── _applyReplaceMap(map)        → TreeWalker text-node replacement
  └── MutationObserver             → re-applies translation after plugin re-renders
```

The plugin does NOT register a sidebar application (`core.application.register` is not called). Instead, it operates entirely via the `setup()` and `start()` lifecycle hooks which run on every OSD page.

`window.__fypLocale__` is set in `setup()` (not `start()`) so other plugins' `_t()` helpers never see `undefined` during the OSD bootstrap phase.

---

## Toolbar

A floating pill in the bottom-right corner of every page:

```
[ EN ] [ UR ]
```

- **EN** and **UR** are always both visible.
- Active language: solid blue background (`#3b82f6`, white text).
- Inactive language: transparent background, muted outline (`#475569`).
- Dark/light theme button is visible; click toggles between `☾ Dark` and `☀ Light`.

### Theme broadcast

When dark mode is toggled, the plugin dispatches:
```js
window.dispatchEvent(new CustomEvent('fyp-theme-changed', {
  detail: { theme: 'dark' | 'light' }
}));
```

Other plugins listen for this event to toggle their `.dark-theme` CSS class:
- `networkGraph/public/index.js` — toggles `.dark-theme` on SVG canvas root
- `complianceView/public/index.js` — toggles `.dark-theme` on `.cv-root`
- Embedded `mountComplianceOverview` (via patch_bundles.py) — toggles `.dark-theme` on `.cv-ov`

---

## Locales

`locales/en.json` and `locales/ur.json` — 68 keys covering:
- `ng.*`  — networkGraph strings (including template strings for dynamic counts/times)
- `nlq.*` — nlqSearch strings
- `cv.*`  — complianceView strings
- `toolbar.*` — toolbar button labels

Both files are bundled into the webpack output at build time; no runtime file reads.

Keys whose values contain `{varName}` placeholders (e.g. `"ng.showAll": "Show all {count} incidents"`) are **template keys** — they are not used for DOM text replacement. Instead plugin code calls `_tFmt()` to resolve them.

---

## Global API

```javascript
// Available on window from setup() onward (before start() fires)
window.__fypLocale__.lang        // 'en' | 'ur'
window.__fypLocale__.t('ng.refresh')  // → 'Refresh' or 'ریفریش'

// Event fired when language changes
window.addEventListener('fyp-language-changed', function() {
  // re-render UI text using window.__fypLocale__.t()
});
```

### `_t()` / `_tFmt()` pattern for plugin developers

Each UI plugin embeds a small fallback map and two helpers so it degrades gracefully when the localization plugin is absent:

```javascript
// English fallbacks for template-key strings used in this plugin
var _MY_EN = {
  'ng.showAll': 'Show all {count} incidents',
};

function _t(key) {
  // 1. localization plugin (Urdu or English)
  // 2. local English fallback map
  // 3. key name (last resort)
  return (window.__fypLocale__ && window.__fypLocale__.t(key)) || _MY_EN[key] || key;
}

function _tFmt(key, vars) {
  var s = _t(key);
  Object.keys(vars || {}).forEach(function(k) {
    s = s.replace('{' + k + '}', String(vars[k]));
  });
  return s;
}

// Usage:
showAllBtn.textContent = _tFmt('ng.showAll', { count: total });
```

Static strings (no placeholders) are translated automatically by the DOM TreeWalker — no `_t()` call needed.

---

## Install

```bash
# Standalone:
cd localization/
sudo bash install.sh

# Via main setup.sh:
sudo bash setup.sh --only localization
```

---

## Dark mode color palette

| Token          | Value     |
|----------------|-----------|
| Page bg        | `#0f172a` |
| Surface/cards  | `#1e293b` |
| Header/sidebar | `#0d1527` |
| Border         | `#334155` |
| Text primary   | `#e2e8f0` |
| Text secondary | `#94a3b8` |
| Accent         | `#3b82f6` |
| Danger         | `#f87171` |
| Success        | `#4ade80` |

Coverage includes: OSD chrome, EUI panels/tables/tabs/forms/badges, `euiBetaBadge` section headings, `euiBreadcrumbWall`, modals, flyouts, popovers, context menus, code blocks, and all custom FYP plugin pages.

---

## Theme persistence

Preferences are stored in `localStorage`:

| Key | Values | Notes |
|-----|--------|-------|
| `fyp_theme_v2` | `'light'` \| `'dark'` | Written on first load and on every toggle. Default: `'light'`. |
| `fyp_language` | `'en'` \| `'ur'` | Written on every language toggle. Default: `'en'` (no entry). |

The older `fyp_theme` key (written by versions before 2026-04-23) is ignored. On first load after the update, `fyp_theme_v2` is absent, so the plugin defaults to light mode regardless of any stale `fyp_theme` value.

---

## Known limitations

- Translations re-apply within 150 ms of any DOM mutation via MutationObserver; there may be a brief flash of English text on plugin re-renders.
- OSD built-in pages (Discover, Dashboards, Maps) are not translated — only the three custom FYP plugins.
- If the localization plugin is not installed, UI plugins fall back to English via their embedded `_MY_EN` map; Urdu mode is unavailable until the localization plugin is installed.
