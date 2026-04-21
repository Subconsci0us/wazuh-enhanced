# localization — Session Log

## 2026-04-21 — Bug fixes: toolbar visibility + dialog injection

### Issue 1 — Toolbar not visible after install
**Symptom:** Plugin installed successfully (present in OSD plugin list, bundle served HTTP 200), but toolbar was not visible on any page.

**Root cause:** OSD applies `transform: scaleX()` to `<body>` during its React bootstrap animation. When any ancestor element has a CSS `transform`, `position: fixed` children are no longer anchored to the viewport — they anchor to the transformed ancestor's coordinate space instead. Combined with `overflow: hidden` on `<body>`, the toolbar was rendered but clipped/invisible.

**Fix:** Replaced the plain `<div>` toolbar container with a `<dialog>` element and call `dialog.show()` (non-modal). `<dialog>` elements are promoted to the browser's **top layer**, a separate rendering surface above all stacking contexts that is immune to ancestor `transform`/`filter` properties. `position: fixed` on a top-layer element anchors correctly to the viewport.

**Additional fix:** OSD's React tree mounts ~300–500 ms after `start()` fires. An early-injected `<div>` can be wiped when OSD calls `replaceChildren()` on body. The dialog approach is immune to this, but we also added a `setTimeout(500)` secondary injection attempt as belt-and-braces, plus MutationObserver now re-injects the toolbar if it's ever removed from the DOM.

**Files changed:** `public/index.js` — `createToolbar()` rewritten to use `<dialog>` + `dialog.show()`; `_mountToolbar()` wrapper added; `start()` updated with setTimeout retry; `startObserver()` MutationObserver callback now checks for toolbar removal.

**Test result:** Toolbar visible in bottom-right corner after Ctrl+Shift+R hard refresh. ✓

---

### Issue 2 — Toolbar shown on all pages (user feedback)
**Symptom:** Toolbar appeared on every page (Agents, Security Events, NLQ Search, etc.), but user only needs it on the main Wazuh home page.

**Fix:** Added navigation-aware visibility logic:

- **Primary method:** Subscribe to `core.application.currentAppId$` (OSD's RxJS Observable, available from `CoreStart` passed to `start(core)`). Shows toolbar only when `appId === 'wz-home'`; hides it on all other app IDs.
- **Fallback method (if OSD API unavailable):** Intercepts `history.pushState` / `history.replaceState` + listens to `popstate` / `hashchange` events. Shows toolbar only when `window.location.pathname` contains `/app/wz-home`.

The toolbar hides/shows without re-creating the `<dialog>` element — just `display: flex` / `display: none` toggled via `_setToolbarVisible()`.

**Cleanup:** `_stopNavListener()` called from `stop()` to unsubscribe Observable / restore original history methods / remove event listeners.

**New functions added:**
- `_isWazuhHome()` — URL-based check
- `_setToolbarVisible(bool)` — show/hide toggle
- `_checkVisibility()` — calls `_setToolbarVisible(_isWazuhHome())`
- `_startNavListener(core)` — wires OSD API or History API fallback
- `_stopNavListener()` — cleanup on plugin stop

**New state variables:** `_appIdSub`, `_origPushState`, `_origReplaceState`

**Files changed:** `public/index.js`

**Status:** Rebuilt and pending reinstall.

---

## 2026-04-21 — Initial build

### Research
- Inspected existing plugins (networkGraph, nlqSearch, complianceView) to catalogue all user-facing strings.
- Confirmed all three custom plugins use vanilla DOM + inline CSS with dark backgrounds (#0d0d1a). The Wazuh Dashboard chrome itself uses OSD 2.19.4 which builds on EUI (Elastic UI Framework).
- CSS class patterns: EUI prefixes `.eui*`; OSD uses `.globalNavContent`, `#osd-top-nav`.
- Existing plugin dark colors: bg #0d0d1a, accent #4fc3f7, text #eee — already dark. Dark mode targets OSD chrome.

### Files created
```
localization/
├── opensearch_dashboards.json   plugin manifest (id: localization, server: true, ui: true)
├── package.json                 webpack devDependencies only, no D3
├── webpack.config.js            standard webpack 5 config, JSON handled natively
├── install.sh                   build + deploy to /usr/share/wazuh-dashboard/plugins/
├── README.md
├── public/
│   ├── bundle_entry.js          OSD bundle registration (window.__osdBundles__.define)
│   └── index.js                 main plugin: toolbar, dark mode, translation engine
├── server/
│   ├── index.js                 minimal server entry (no routes)
│   └── plugin.js                minimal server plugin
└── locales/
    ├── en.json                  46 English strings covering all three custom plugins
    └── ur.json                  46 Urdu translations
```

### Architecture decisions
- Plugin injects toolbar in `start()` lifecycle hook (not via `application.register`) so it appears on EVERY OSD page.
- Dark mode: injects `<style id="fyp-dark-mode">` with ~80 EUI CSS rules into `<head>`. Toggling removes the element.
- Translation: pre-built `EN_TO_UR` and `UR_TO_EN` maps at module load. `applyReplaceMap()` walks DOM text nodes with `TreeWalker`.
- MutationObserver watches `document.body` for `childList` mutations (plugin re-renders). Debounced 150 ms. Re-applies EN→UR map when active.
- RTL: adds `fyp-rtl` CSS class to `document.body`; injected stylesheet applies `direction: rtl` to `.euiPageContentBody` and custom app containers while keeping header/sidebar LTR.
- Preferences stored in `localStorage` keys: `fyp_theme` (`'dark'|'light'`), `fyp_language` (`'en'|'ur'`).
- Global: `window.__fypLocale__.t(key)` / `window.__fypLocale__.lang` for custom plugins that choose to integrate.

### setup.sh changes
- Added `localization` to `ALL_FEATURES` array.
- Added `FEATURE_DESC[localization]`.
- Added `install_localization()` function (delegates to `localization/install.sh`).

### Status
- **BUILT** — source files complete. Not yet installed/tested (requires sudo for dashboard restart).
- **Untested** — see testing checklist below.

---

## Testing checklist (to be completed after install)

**Commands to run:**
```bash
# Build and install
cd /media/sf_sharedfolderclone/wazuh-fyp-repo/localization
sudo bash install.sh

# Verify plugin file installed
sudo ls /usr/share/wazuh-dashboard/plugins/localization/

# Check for server-side errors
journalctl -u wazuh-dashboard --no-pager | grep -i localization | tail -20
```

**Manual tests:**
1. [ ] Toolbar appears (bottom-right pill) on main dashboard page
2. [ ] Toolbar persists when navigating to Agents, Security Events, etc.
3. [ ] Dark mode toggle: colors change across OSD chrome
4. [ ] Dark mode toggle: returns to light mode on second click
5. [ ] Dark mode preference persists after page refresh
6. [ ] Language toggle (اردو): custom plugin text switches to Urdu
7. [ ] Language toggle (EN): reverts to English
8. [ ] Language preference persists after refresh
9. [ ] RTL layout activates for Urdu (text-align right in content area)
10. [ ] networkGraph, nlqSearch, complianceView pages: translations apply
11. [ ] Dark mode + Urdu active simultaneously: both work together

**Known limitations:**
- Dynamic strings (e.g. "42 agent(s) – last updated 14:32") are NOT translated because they're concatenated with runtime data. Only static standalone strings are replaced.
- If an OSD page uses shadow DOM or iframes, translations won't apply inside them (none of our plugins do this).
- MutationObserver may not catch text set via `element.innerHTML` with embedded HTML tags; only bare text nodes are targeted.
