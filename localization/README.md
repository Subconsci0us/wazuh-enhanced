# localization — Wazuh Dashboard Localization & Dark Mode Plugin

OSD 2.19.4 plugin that injects a persistent floating toolbar into every Wazuh Dashboard page, providing:

- **Dark mode** — comprehensive CSS override for OSD chrome and all custom FYP plugins
- **Urdu / English toggle** — DOM text replacement for networkGraph, nlqSearch, complianceView
- **RTL layout** — when Urdu is active, page content flips to right-to-left direction
- **Persistence** — theme and language choices survive navigation and page refresh via `localStorage`
- **Default theme** — light mode. Dark mode can be toggled via the toolbar button and persists across sessions via `localStorage` key `fyp_theme_v2`

---

## Architecture

```
public/index.js
  ├── LocalizationPlugin.start()   → injects toolbar, loads preferences, starts observer
  ├── setDarkMode(bool)            → injects/removes <style id="fyp-dark-mode">
  ├── setLanguage('en'|'ur')       → swaps DOM text, applies RTL, fires event
  ├── _applyReplaceMap(map)        → TreeWalker text-node replacement
  └── MutationObserver             → re-applies translation after plugin re-renders
```

The plugin does NOT register a sidebar application (`core.application.register` is not called). Instead, it operates entirely via the `start()` lifecycle hook which runs on every OSD page.

---

## Locales

`locales/en.json` and `locales/ur.json` — 46 keys covering:
- `ng.*`  — networkGraph strings
- `nlq.*` — nlqSearch strings
- `cv.*`  — complianceView strings
- `toolbar.*` — toolbar button labels

Both files are bundled into the webpack output at build time; no runtime file reads.

---

## Global API

```javascript
// Available on window after plugin loads
window.__fypLocale__.lang        // 'en' | 'ur'
window.__fypLocale__.t('ng.refresh')  // → 'Refresh' or 'ریفریش'

// Event fired when language changes
window.addEventListener('fyp-language-changed', function() {
  // re-render UI text using window.__fypLocale__.t()
});
```

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

- Dynamic strings (e.g. result counts concatenated with data) are not translated.
- Translations re-apply within 150 ms of any DOM mutation via MutationObserver; there may be a brief flash of English text on plugin re-renders.
- OSD built-in pages (Discover, Dashboards, Maps) are not translated — only the three custom FYP plugins.
