'use strict';

/**
 * public/index.js — Localization + Dark Mode plugin for Wazuh Dashboard
 *
 * Responsibilities (all client-side, no server routes):
 *   1. Floating toolbar — injected into every OSD page via start() lifecycle.
 *   2. Dark mode        — CSS override injected into <head>.
 *   3. Urdu translation — DOM text-node replacement + MutationObserver re-apply.
 *
 * Global interface exposed for custom plugins:
 *   window.__fypLocale__.t(key)    → translated string for current language
 *   window.__fypLocale__.lang      → 'en' | 'ur'
 *   Event 'fyp-language-changed'   → dispatched on window when language toggles
 */

var EN = require('../locales/en.json');
var UR = require('../locales/ur.json');

// ── Translation maps ──────────────────────────────────────────────────────────
// Pre-built at module load time so applyDomTranslations never recomputes.

var EN_TO_UR = {};   // English string → Urdu string
var UR_TO_EN = {};   // Urdu string    → English string

(function buildMaps() {
  Object.keys(EN).forEach(function(key) {
    var en = EN[key];
    var ur = UR[key];
    if (en && ur && en !== ur) {
      EN_TO_UR[en] = ur;
      UR_TO_EN[ur] = en;
    }
  });
}());

// ── Module-level state ────────────────────────────────────────────────────────

var _lang            = 'en';   // current language
var _dark            = false;  // dark mode active?
var _observer        = null;   // MutationObserver instance
var _transTimer      = null;   // debounce handle
var _appIdSub        = null;   // OSD currentAppId$ subscription
var _origPushState   = null;   // saved history.pushState before override
var _origReplaceState = null;  // saved history.replaceState before override

// ── Dark mode CSS ─────────────────────────────────────────────────────────────
// Comprehensive overrides targeting EUI components (used by OSD 2.x) plus
// general page elements.  Uses !important throughout to win against compiled
// Wazuh / OSD stylesheet specificity.

var DARK_CSS = [
  /* Base */
  'html, body { background-color: #0f172a !important; color: #e2e8f0 !important; }',
  '*, *::before, *::after { border-color: #334155 !important; }',
  'a { color: #60a5fa !important; }',
  'a:hover { color: #93c5fd !important; }',

  /* Scrollbars */
  '::-webkit-scrollbar { width: 8px; height: 8px; background: #0f172a; }',
  '::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }',
  '::-webkit-scrollbar-thumb:hover { background: #475569; }',

  /* OSD top-level chrome */
  '#osd-top-nav, .globalHeader, .headerGlobalNav { background: #0d1527 !important; }',
  '.globalNavContent, .globalNavLink { background: #0d1527 !important; color: #94a3b8 !important; }',
  '.globalNavLink:hover, .globalNavLink.active { color: #e2e8f0 !important; background: #1e293b !important; }',

  /* EUI Header */
  '.euiHeader, .euiHeader--default, .euiHeader--fixed, .euiHeader--dark { background-color: #0d1527 !important; border-bottom: 1px solid #334155 !important; }',
  '.euiHeaderSection, .euiHeaderSectionItem { background: transparent !important; }',
  '.euiHeaderLogo, .euiHeaderLogo__title, .euiHeaderLogo__text { color: #e2e8f0 !important; }',
  '.euiHeaderLink { color: #94a3b8 !important; }',
  '.euiHeaderLink:hover { color: #e2e8f0 !important; background: #1e293b !important; }',
  '.euiBreadcrumb { color: #94a3b8 !important; }',
  '.euiBreadcrumb--last, .euiBreadcrumb--last a { color: #e2e8f0 !important; }',

  /* EUI Collapsible Nav / Sidebar */
  '.euiCollapsibleNav, .euiCollapsibleNavGroup, .euiCollapsibleNavGroup--light { background: #0d1527 !important; }',
  '.euiCollapsibleNavGroup__title { color: #94a3b8 !important; }',
  '.euiNavDrawer, .euiNavDrawerGroup { background: #0d1527 !important; }',
  '.euiListGroup, .euiListGroupItem { background: transparent !important; color: #94a3b8 !important; }',
  '.euiListGroupItem:hover, .euiListGroupItem__button:hover { background: #1e293b !important; color: #e2e8f0 !important; }',
  '.euiListGroupItem-isActive, .euiListGroupItem-isActive .euiListGroupItem__button { background: #1e3a5f !important; color: #60a5fa !important; }',

  /* EUI Page structure */
  '.euiPage, .euiPageBody, .euiPageContent, .euiPageContentBody, .euiPageHeader, .euiPageHeaderSection { background-color: #0f172a !important; }',
  '.euiPageSideBar { background-color: #0d1527 !important; border-right: 1px solid #334155 !important; }',

  /* EUI Panels / Cards */
  '.euiPanel, .euiCard, .euiCard__body, .euiCard__top, .euiCard__footer { background-color: #1e293b !important; }',
  '.euiPanel--hasBorder { border: 1px solid #334155 !important; }',
  '.euiPanel--hasShadow { box-shadow: 0 2px 8px rgba(0,0,0,0.5) !important; }',

  /* EUI Text */
  '.euiTitle, .euiText, .euiText *, .euiTextColor, .euiTextColor--default { color: #e2e8f0 !important; }',
  '.euiTextColor--subdued, .euiText .euiTextColor--subdued { color: #94a3b8 !important; }',
  '.euiTextColor--danger { color: #f87171 !important; }',
  '.euiTextColor--success { color: #4ade80 !important; }',
  '.euiTextColor--warning { color: #fb923c !important; }',

  /* EUI Tables */
  '.euiTable { background: #1e293b !important; }',
  'table { background: #1e293b !important; color: #e2e8f0 !important; }',
  'th { background: #0d1527 !important; color: #94a3b8 !important; }',
  'tr:nth-child(even) td { background: #162032 !important; }',
  'tr:hover td { background: #263248 !important; }',
  'td { color: #e2e8f0 !important; border-color: #334155 !important; }',
  '.euiTableHeader { background: #0d1527 !important; }',
  '.euiTableHeaderCell, .euiTableHeaderCell__button { color: #94a3b8 !important; background: #0d1527 !important; }',
  '.euiTableHeaderCell--sortable:hover { background: #1e293b !important; color: #e2e8f0 !important; }',
  '.euiTableRow { background: #1e293b !important; }',
  '.euiTableRow:nth-child(even) { background: #162032 !important; }',
  '.euiTableRow:hover { background: #263248 !important; }',
  '.euiTableRowCell, .euiTableRowCell__content { color: #e2e8f0 !important; border-color: #334155 !important; }',
  '.euiTableCellContent { color: #e2e8f0 !important; }',

  /* EUI Tabs */
  '.euiTabs { background: transparent !important; border-bottom: 1px solid #334155 !important; }',
  '.euiTab { color: #94a3b8 !important; background: transparent !important; }',
  '.euiTab:hover { color: #e2e8f0 !important; }',
  '.euiTab.euiTab-isSelected { color: #3b82f6 !important; border-bottom-color: #3b82f6 !important; }',
  '.euiTab__content { color: inherit !important; }',

  /* EUI Buttons */
  '.euiButton, .euiButton--primary { background: #1d4ed8 !important; color: #fff !important; border-color: #1d4ed8 !important; }',
  '.euiButton:hover { background: #2563eb !important; }',
  '.euiButton--secondary { background: #1e293b !important; color: #e2e8f0 !important; border-color: #334155 !important; }',
  '.euiButton--text, .euiButtonEmpty { color: #94a3b8 !important; background: transparent !important; }',
  '.euiButtonEmpty:hover { color: #e2e8f0 !important; background: #1e293b !important; }',
  '.euiButtonIcon { color: #94a3b8 !important; }',
  '.euiButtonIcon:hover { color: #e2e8f0 !important; background: #1e293b !important; }',

  /* EUI Form elements */
  '.euiFormRow { background: transparent !important; }',
  '.euiFormRow__label, .euiFormLabel { color: #94a3b8 !important; }',
  '.euiFieldText, .euiSelect, .euiTextArea, .euiFieldSearch, .euiFieldNumber, .euiFieldPassword { background: #1e293b !important; color: #e2e8f0 !important; border-color: #334155 !important; }',
  '.euiFieldText:focus, .euiSelect:focus, .euiTextArea:focus, .euiFieldSearch:focus { background: #263248 !important; border-color: #3b82f6 !important; outline: none !important; box-shadow: 0 0 0 2px rgba(59,130,246,0.3) !important; }',
  '.euiFieldText::placeholder, .euiTextArea::placeholder, .euiFieldSearch::placeholder { color: #64748b !important; }',
  '.euiComboBox, .euiComboBox__input { background: #1e293b !important; color: #e2e8f0 !important; }',
  '.euiComboBox__inputWrap, .euiComboBoxOptionsList { background: #1e293b !important; border-color: #334155 !important; }',
  '.euiComboBoxOption:hover { background: #263248 !important; color: #e2e8f0 !important; }',
  'input, select, textarea { background-color: #1e293b !important; color: #e2e8f0 !important; border-color: #334155 !important; }',
  'input::placeholder, textarea::placeholder { color: #64748b !important; }',
  'input[type="checkbox"] { accent-color: #3b82f6; }',
  'input[type="radio"] { accent-color: #3b82f6; }',

  /* EUI Super Date Picker */
  '.euiSuperDatePicker, .euiDatePopoverButton, .euiSuperUpdateButton { background: #1e293b !important; color: #e2e8f0 !important; border-color: #334155 !important; }',
  '.euiDatePopoverContent { background: #1e293b !important; }',

  /* EUI Search bar */
  '.euiSearchBar, .euiSearchBarFilters, .euiSearchBarExtensions { background: #1e293b !important; border-color: #334155 !important; }',

  /* EUI Badges */
  '.euiBadge { background: #263248 !important; color: #e2e8f0 !important; }',
  '.euiBadge--primary { background: #1e3a5f !important; color: #93c5fd !important; }',
  '.euiBadge--success { background: #14532d !important; color: #4ade80 !important; }',
  '.euiBadge--danger { background: #7f1d1d !important; color: #f87171 !important; }',
  '.euiBadge--warning { background: #7c2d12 !important; color: #fb923c !important; }',

  /* EUI Tooltips */
  '.euiToolTip, .euiToolTipPopover { background: #1e293b !important; color: #e2e8f0 !important; border: 1px solid #334155 !important; box-shadow: 0 4px 16px rgba(0,0,0,0.5) !important; }',
  '.euiToolTip__arrow { border-color: #334155 !important; background: #1e293b !important; }',

  /* EUI Modals */
  '.euiModal, .euiModal__flex { background: #1e293b !important; border: 1px solid #334155 !important; }',
  '.euiModalHeader { border-bottom: 1px solid #334155 !important; }',
  '.euiModalFooter { border-top: 1px solid #334155 !important; background: #162032 !important; }',
  '.euiOverlayMask { background: rgba(0,0,0,0.75) !important; }',

  /* EUI Flyout */
  '.euiFlyout { background: #1e293b !important; border-left: 1px solid #334155 !important; }',
  '.euiFlyoutHeader { border-bottom: 1px solid #334155 !important; background: #162032 !important; }',
  '.euiFlyoutFooter { border-top: 1px solid #334155 !important; background: #162032 !important; }',

  /* EUI Context menu / Popover */
  '.euiContextMenuPanel, .euiContextMenu { background: #1e293b !important; border: 1px solid #334155 !important; box-shadow: 0 4px 16px rgba(0,0,0,0.5) !important; }',
  '.euiContextMenuItem { color: #e2e8f0 !important; }',
  '.euiContextMenuItem:hover { background: #263248 !important; }',
  '.euiPopover__panel, .euiPopoverPanel { background: #1e293b !important; border: 1px solid #334155 !important; }',

  /* EUI Accordion */
  '.euiAccordion, .euiAccordion__triggerWrapper { background: transparent !important; }',
  '.euiAccordion__button { color: #e2e8f0 !important; }',
  '.euiAccordion__childWrapper { background: #1e293b !important; }',

  /* EUI Code / Pre */
  '.euiCode, .euiCodeBlock, pre, code { background: #0d1527 !important; color: #93c5fd !important; border: 1px solid #334155 !important; }',

  /* EUI Progress */
  '.euiProgress { background: #334155 !important; }',
  '.euiProgress .euiProgress__bar { background: #3b82f6 !important; }',

  /* EUI Icons */
  '.euiIcon { fill: currentColor !important; }',
  '.euiIcon--subdued { color: #64748b !important; }',

  /* EUI Pagination */
  '.euiPagination { background: transparent !important; }',
  '.euiPaginationButton { color: #94a3b8 !important; }',
  '.euiPaginationButton.euiPaginationButton-isActive { color: #3b82f6 !important; background: #1e3a5f !important; }',

  /* EUI Divider */
  '.euiHorizontalRule { background: #334155 !important; border-color: #334155 !important; }',

  /* Wazuh dashboard main container — covers react-rendered content areas */
  '[class*="wzPage"], [class*="wzDashboard"], [class*="wzModule"] { background: #0f172a !important; }',
  '[id^="wazuh-home"], [id^="wazuh-"] { background: #0f172a !important; }',

  /* Generic catch-all for white/light backgrounds missed by EUI classes */
  '.content-wrapper, .main-wrapper, .app-wrapper, .page-wrapper { background: #0f172a !important; }',
  '[class*="container"]:not(#fyp-toolbar) { background-color: inherit; }',

  /* Ensure our custom plugins remain styled normally — they already have dark backgrounds */
  '#cv-root, #ng-root, #nlq-root { background: #0d0d1a !important; }',
].join('\n');

// ── RTL CSS ───────────────────────────────────────────────────────────────────
// Applied when Urdu is active. Flips the page content area only; the
// dashboard header and sidebar stay LTR so navigation remains usable.

var RTL_CSS = [
  '.fyp-rtl .euiPageBody,',
  '.fyp-rtl .euiPageContent,',
  '.fyp-rtl .euiPageContentBody,',
  '.fyp-rtl [id^="application-"],',
  '.fyp-rtl [data-application-id] {',
  '  direction: rtl !important;',
  '}',
  '.fyp-rtl .euiHeader,',
  '.fyp-rtl .euiCollapsibleNav,',
  '.fyp-rtl .euiNavDrawer,',
  '.fyp-rtl .globalHeader,',
  '.fyp-rtl .globalNavContent {',
  '  direction: ltr !important;',
  '}',
  '.fyp-rtl table, .fyp-rtl .euiTable { direction: rtl !important; }',
  '.fyp-rtl th, .fyp-rtl td { text-align: right !important; }',
  '.fyp-rtl input, .fyp-rtl textarea { text-align: right !important; direction: rtl !important; }',
  '#fyp-toolbar { direction: ltr !important; }',
].join('\n');

// ── Style helpers ─────────────────────────────────────────────────────────────

function injectStyle(id, css) {
  var el = document.getElementById(id);
  if (el) {
    el.textContent = css;
    return;
  }
  el = document.createElement('style');
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}

function removeStyle(id) {
  var el = document.getElementById(id);
  if (el && el.parentNode) {
    el.parentNode.removeChild(el);
  }
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

var BTN_STYLE = [
  'background: rgba(30,41,59,0.85)',
  'color: #e2e8f0',
  'border: 1px solid #475569',
  'border-radius: 5px',
  'padding: 5px 10px',
  'cursor: pointer',
  'font-size: 11px',
  'font-weight: 500',
  'letter-spacing: 0.4px',
  'white-space: nowrap',
  'line-height: 1.4',
  'transition: background 0.15s, border-color 0.15s',
].join(';');

// _mountToolbar — safe wrapper called from start() and the MutationObserver.
// Guards against double-injection and swallows errors so a bug here never
// crashes the whole OSD page load.
function _mountToolbar() {
  if (document.getElementById('fyp-toolbar')) return;
  try {
    createToolbar();
  } catch (e) {
    /* toolbar is nice-to-have; don't break OSD if injection fails */
  }
}

function createToolbar() {
  // Use <dialog> instead of a plain <div>.
  //
  // OSD applies transform: scaleX() to <body> during its React bootstrap,
  // which creates a new fixed-position containing block and clips any
  // position:fixed child appended to document.body.  <dialog> elements are
  // promoted to the browser's "top layer" — a separate rendering surface
  // that sits above all stacking contexts and is immune to parent transforms.
  // dialog.show() (non-modal) uses the top layer without trapping focus.
  var dlg = document.createElement('dialog');
  dlg.id = 'fyp-toolbar';
  dlg.setAttribute('aria-label', 'FYP accessibility toolbar');

  // Reset browser <dialog> defaults (position:absolute, margin:auto, padding,
  // border, max-width) and position in the bottom-right of the viewport.
  dlg.style.cssText = [
    'position: fixed',
    'bottom: 24px',
    'right: 24px',
    'top: auto',
    'left: auto',
    'margin: 0',
    'padding: 7px 10px',
    'border: 1px solid rgba(71,85,105,0.7)',
    'border-radius: 10px',
    'background: rgba(13,21,39,0.92)',
    'box-shadow: 0 4px 24px rgba(0,0,0,0.6)',
    'backdrop-filter: blur(10px)',
    'z-index: 2147483647',
    'display: flex',
    'align-items: center',
    'gap: 6px',
    'max-width: none',
    'max-height: none',
    'width: auto',
    'height: auto',
    'overflow: visible',
    'font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    'font-size: 12px',
    'color: #e2e8f0',
    'user-select: none',
    'direction: ltr',
  ].join(';');

  var langBtn  = document.createElement('button');
  var themeBtn = document.createElement('button');

  langBtn.id       = 'fyp-lang-btn';
  themeBtn.id      = 'fyp-theme-btn';
  langBtn.style.cssText  = BTN_STYLE;
  themeBtn.style.cssText = BTN_STYLE;

  _syncLangBtn(langBtn);
  _syncThemeBtn(themeBtn);

  langBtn.addEventListener('mouseenter', function() {
    this.style.background = 'rgba(51,65,85,0.9)';
    this.style.borderColor = '#60a5fa';
  });
  langBtn.addEventListener('mouseleave', function() {
    this.style.background = 'rgba(30,41,59,0.85)';
    this.style.borderColor = '#475569';
  });
  themeBtn.addEventListener('mouseenter', function() {
    this.style.background = 'rgba(51,65,85,0.9)';
    this.style.borderColor = '#60a5fa';
  });
  themeBtn.addEventListener('mouseleave', function() {
    this.style.background = 'rgba(30,41,59,0.85)';
    this.style.borderColor = '#475569';
  });

  langBtn.addEventListener('click', function() {
    setLanguage(_lang === 'en' ? 'ur' : 'en');
  });
  themeBtn.addEventListener('click', function() {
    setDarkMode(!_dark);
  });

  dlg.appendChild(langBtn);
  dlg.appendChild(themeBtn);
  document.body.appendChild(dlg);

  // show() opens as non-modal (no backdrop, no focus trap).
  // Fallback: set the 'open' attribute directly for very old browsers.
  if (typeof dlg.show === 'function') {
    dlg.show();
  } else {
    dlg.setAttribute('open', '');
  }
}

function _syncLangBtn(btn) {
  btn = btn || document.getElementById('fyp-lang-btn');
  if (!btn) return;
  btn.textContent = _lang === 'en' ? 'اردو' : 'EN';
  btn.title = _lang === 'en' ? 'Switch to Urdu / اردو میں تبدیل کریں' : 'Switch to English';
}

function _syncThemeBtn(btn) {
  btn = btn || document.getElementById('fyp-theme-btn');
  if (!btn) return;
  btn.textContent = _dark ? '☀ Light' : '☾ Dark';
  btn.title = _dark ? 'Switch to light mode' : 'Switch to dark mode';
}

// ── Dark mode ─────────────────────────────────────────────────────────────────

function setDarkMode(enabled) {
  _dark = enabled;
  try { localStorage.setItem('fyp_theme', enabled ? 'dark' : 'light'); } catch (_) {}

  if (enabled) {
    injectStyle('fyp-dark-mode', DARK_CSS);
    document.body.classList.add('fyp-dark');
  } else {
    removeStyle('fyp-dark-mode');
    document.body.classList.remove('fyp-dark');
  }
  _syncThemeBtn();
}

// ── Language / translation ────────────────────────────────────────────────────

function setLanguage(lang) {
  if (lang !== 'en' && lang !== 'ur') return;

  var previous = _lang;
  _lang = lang;
  try { localStorage.setItem('fyp_language', lang); } catch (_) {}

  // Update global locale interface
  if (window.__fypLocale__) {
    window.__fypLocale__.lang = lang;
  }

  // RTL
  if (lang === 'ur') {
    document.body.classList.add('fyp-rtl');
    injectStyle('fyp-rtl-style', RTL_CSS);
  } else {
    document.body.classList.remove('fyp-rtl');
    injectStyle('fyp-rtl-style', '');
  }

  // Replace DOM text
  var map = lang === 'ur' ? EN_TO_UR : UR_TO_EN;
  _applyReplaceMap(map);

  _syncLangBtn();

  // Notify custom plugins that may listen
  try {
    window.dispatchEvent(new Event('fyp-language-changed'));
  } catch (_) {}
}

// ── DOM text replacement ──────────────────────────────────────────────────────
// Walks all text nodes in document.body, skipping script/style tags and our
// own toolbar.  Replaces trimmed matches found in replaceMap.
// Also handles placeholder and title attributes.

function _applyReplaceMap(replaceMap) {
  if (!replaceMap || Object.keys(replaceMap).length === 0) return;

  var walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        var parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        var tag = parent.tagName ? parent.tagName.toUpperCase() : '';
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
          return NodeFilter.FILTER_REJECT;
        }
        // Skip toolbar and its children
        if (_isInsideToolbar(parent)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    },
    false
  );

  var updates = [];
  var node;
  while ((node = walker.nextNode())) {
    var raw     = node.textContent;
    var trimmed = raw.trim();
    if (trimmed && Object.prototype.hasOwnProperty.call(replaceMap, trimmed)) {
      updates.push({ node: node, raw: raw, trimmed: trimmed });
    }
  }

  updates.forEach(function(u) {
    // Preserve surrounding whitespace (spaces/newlines the plugin may have added)
    u.node.textContent = u.raw.replace(u.trimmed, replaceMap[u.trimmed]);
  });

  // placeholder attributes
  try {
    document.querySelectorAll('[placeholder]').forEach(function(el) {
      if (_isInsideToolbar(el)) return;
      var ph = (el.getAttribute('placeholder') || '').trim();
      if (ph && Object.prototype.hasOwnProperty.call(replaceMap, ph)) {
        el.setAttribute('placeholder', replaceMap[ph]);
      }
    });
  } catch (_) {}
}

function _isInsideToolbar(el) {
  var cur = el;
  while (cur) {
    if (cur.id === 'fyp-toolbar') return true;
    cur = cur.parentElement;
  }
  return false;
}

// ── MutationObserver — re-apply translations after plugin re-renders ──────────
// Watches for new child nodes (plugin re-renders, navigation).  Uses a 150 ms
// debounce so one burst of mutations triggers only one translation pass.

function startObserver() {
  if (_observer) return;

  _observer = new MutationObserver(function(mutations) {
    var hasAdded = mutations.some(function(m) { return m.addedNodes.length > 0; });
    if (!hasAdded) return;

    // Re-inject toolbar if OSD's React re-render removed it from the DOM.
    if (!document.getElementById('fyp-toolbar')) {
      _mountToolbar();
    }

    // Re-apply translations when new nodes appear (plugin re-renders).
    if (_lang !== 'en') {
      clearTimeout(_transTimer);
      _transTimer = setTimeout(function() {
        _applyReplaceMap(EN_TO_UR);
      }, 150);
    }
  });

  _observer.observe(document.body, { childList: true, subtree: true });
}

function stopObserver() {
  clearTimeout(_transTimer);
  if (_observer) {
    _observer.disconnect();
    _observer = null;
  }
}

// ── Preference persistence ────────────────────────────────────────────────────

function loadPreferences() {
  var savedTheme, savedLang;
  try {
    savedTheme = localStorage.getItem('fyp_theme');
    savedLang  = localStorage.getItem('fyp_language');
  } catch (_) {}

  if (savedTheme === 'dark')  setDarkMode(true);
  if (savedLang  === 'ur')    setLanguage('ur');
}

// ── Navigation-aware visibility ───────────────────────────────────────────────
// The toolbar is only useful on the Wazuh home page; hide it everywhere else.

function _isWazuhHome() {
  var path = window.location.pathname;
  // Matches /app/wz-home and the bare root (which OSD redirects to wz-home)
  return path.indexOf('/app/wz-home') !== -1 ||
         path === '/' ||
         path === '';
}

function _setToolbarVisible(visible) {
  var toolbar = document.getElementById('fyp-toolbar');
  if (!toolbar) return;
  toolbar.style.display = visible ? 'flex' : 'none';
}

function _checkVisibility() {
  _setToolbarVisible(_isWazuhHome());
}

function _startNavListener(core) {
  // Preferred: OSD application service emits the active app ID on every navigation.
  if (core && core.application && core.application.currentAppId$) {
    try {
      _appIdSub = core.application.currentAppId$.subscribe(function(appId) {
        _setToolbarVisible(appId === 'wz-home' || !appId);
      });
      return; // OSD API wired up — no need for the URL fallback
    } catch (_) {}
  }

  // Fallback: intercept History API calls for SPAs that don't expose an observable.
  _origPushState   = history.pushState.bind(history);
  _origReplaceState = history.replaceState.bind(history);

  history.pushState = function() {
    _origPushState.apply(history, arguments);
    setTimeout(_checkVisibility, 50);
  };
  history.replaceState = function() {
    _origReplaceState.apply(history, arguments);
    setTimeout(_checkVisibility, 50);
  };

  window.addEventListener('popstate',   _checkVisibility);
  window.addEventListener('hashchange', _checkVisibility);
}

function _stopNavListener() {
  if (_appIdSub) {
    try { _appIdSub.unsubscribe(); } catch (_) {}
    _appIdSub = null;
  }
  if (_origPushState) {
    history.pushState    = _origPushState;
    history.replaceState = _origReplaceState;
    _origPushState = _origReplaceState = null;
  }
  window.removeEventListener('popstate',   _checkVisibility);
  window.removeEventListener('hashchange', _checkVisibility);
}

// ── Plugin class ──────────────────────────────────────────────────────────────

class LocalizationPlugin {
  setup(/* core */) {
    return {};
  }

  start(core /* , plugins */) {
    // Expose global translation interface for custom plugins
    window.__fypLocale__ = {
      lang: _lang,
      t: function(key) {
        var locale = _lang === 'ur' ? UR : EN;
        return (locale && locale[key]) || key;
      },
    };

    // First attempt — may be removed if OSD's React mount hasn't finished yet.
    _mountToolbar();

    // Start observer immediately so it can re-inject the toolbar if OSD's React
    // bootstrap replaces the body children before the delayed attempt fires.
    startObserver();

    // Delayed attempt — fires after OSD's React tree has fully mounted (~500 ms).
    // Also wires up navigation listener and applies stored preferences here so
    // they run after OSD has set up its routing infrastructure.
    setTimeout(function() {
      _mountToolbar();
      injectStyle('fyp-rtl-style', '');
      loadPreferences();

      // Show toolbar only on the Wazuh home page; hide on all other pages.
      _startNavListener(core);
      _checkVisibility();
    }, 500);
  }

  stop() {
    stopObserver();
    _stopNavListener();
    removeStyle('fyp-dark-mode');
    removeStyle('fyp-rtl-style');
    var toolbar = document.getElementById('fyp-toolbar');
    if (toolbar && toolbar.parentNode) {
      toolbar.parentNode.removeChild(toolbar);
    }
  }
}

module.exports = {
  plugin: function() {
    return new LocalizationPlugin();
  },
};
