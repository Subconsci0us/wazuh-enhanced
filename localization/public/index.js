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

  /* OSD initial loading screen — shown before React mounts */
  '.osdWelcomeView { background-color: #0f172a !important; color: #e2e8f0 !important; }',
  '.osdWelcomeTitle { color: #e2e8f0 !important; }',
  '.osdWelcomeText { color: #94a3b8 !important; }',
  '.osdProgress { background-color: #1e293b !important; }',
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
  '.euiBreadcrumbWall { background: transparent !important; }',
  '.euiBreadcrumbWrapper { background: transparent !important; }',

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

  /* EUI BetaBadge — section category labels in the Wazuh overview page */
  /* ("Threat intelligence", "Security operations", etc.) */
  '.euiBetaBadge { background-color: #1e293b !important; color: #94a3b8 !important; border-color: #334155 !important; }',
  '.euiBetaBadge--hollow { background-color: transparent !important; border: 1px solid #475569 !important; color: #94a3b8 !important; }',
  '.euiCard__betaBadgeWrapper .euiBetaBadge { background-color: #1e293b !important; border-color: #334155 !important; color: #94a3b8 !important; }',

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

  /* Wazuh sidebar navigation menu */
  '.wz-menu, .wz-menu-sections { background: #0d1527 !important; }',
  '.wz-menu-agent-info { background-color: #0d1527 !important; }',
  '.wz-menu-select-option { background: #1e293b !important; color: #e2e8f0 !important; }',
  '.wz-module-header-nav { background: #0d1527 !important; }',
  '.wz-welcome-page-agent-tabs { background-color: #0d1527 !important; }',
  '.wz-circle-back-button { background: #1e293b !important; }',
  '.wz-input-text { background: #1e293b !important; color: #e2e8f0 !important; }',
  '.registerAgent, .register-agent-wizard-container { background: #0f172a !important; }',
  '.history-list { background: #1e293b !important; }',

  /* OSD Overview page header and typeahead */
  '.osdOverviewPageHeader { background-color: #0d1527 !important; border-bottom-color: #334155 !important; }',
  '.osdTypeahead__popover { background-color: #1e293b !important; color: #e2e8f0 !important; }',

  /* Misc Wazuh UI */
  '.cancelBtn { background: #1e293b !important; color: #e2e8f0 !important; }',
  '.panel-heading { color: #e2e8f0 !important; }',
  '.error-notify { color: #f87171 !important; }',
  '.dshExitFullScreenButton { background: #1e293b !important; color: #e2e8f0 !important; }',
  '.cv-ov-card { background: #1e293b !important; border-color: #334155 !important; }',

  /* Wazuh health-check / API loading screen */
  '.application, .application.tab-health-check { background: #0f172a !important; }',
  /* OSD app mount wrapper — contains the Wazuh health-check React tree */
  '[id^="application-"] { background: #0f172a !important; }',
  '.healthCheck { background-color: #0f172a !important; color: #e2e8f0 !important; }',
  '.health-check { background-color: #0f172a !important; color: #e2e8f0 !important; }',
  '.health-check h2, .health-check h3, .health-check p, .health-check span, .health-check li { color: #e2e8f0 !important; }',
  '.health-check-error { color: #f87171 !important; }',
  '.health-check .euiDescriptionList dd { color: #e2e8f0 !important; }',
  '.health-check .euiDescriptionList dt { color: #94a3b8 !important; }',
  '.percentage { color: #94a3b8 !important; }',
  '.small-text { color: #94a3b8 !important; }',
  '.checks-fail { color: #f87171 !important; }',
  '[class*="agent"] { background: #0f172a !important; }',

  /* Custom plugins use their own inline styles; dark mode applies to them normally */
].join('\n');

// ── Early dark-mode injection ─────────────────────────────────────────────────
// Inject DARK_CSS synchronously at module-load time (before setup/start/setTimeout).
// This prevents the 500 ms window where the Wazuh health-check and OSD loading
// screens render in light mode before loadPreferences() fires.
(function() {
  try {
    if (localStorage.getItem('fyp_theme_v2') === 'dark') {
      var _earlyEl = document.createElement('style');
      _earlyEl.id = 'fyp-dark-mode';
      _earlyEl.textContent = DARK_CSS;
      (document.head || document.documentElement).appendChild(_earlyEl);
      _dark = true;
    }
  } catch (_) {}
}());

// ── RTL CSS ───────────────────────────────────────────────────────────────────
// Applied when Urdu is active. Flips the page content area only; the
// dashboard header and sidebar stay LTR so navigation remains usable.

var RTL_CSS = [
  /* ── Page content area — RTL ── */
  '.fyp-rtl .euiPageBody,',
  '.fyp-rtl .euiPageContent,',
  '.fyp-rtl .euiPageContentBody,',
  '.fyp-rtl [id^="application-"],',
  '.fyp-rtl [data-application-id] {',
  '  direction: rtl !important;',
  '}',

  /* ── Chrome — stay LTR ── */
  '.fyp-rtl .euiHeader,',
  '.fyp-rtl .euiCollapsibleNav,',
  '.fyp-rtl .euiNavDrawer,',
  '.fyp-rtl .globalHeader,',
  '.fyp-rtl .globalNavContent {',
  '  direction: ltr !important;',
  '}',

  /* ── Sidebar nav item text: embed lets icon stay LTR, label text reads RTL ── */
  '.fyp-rtl .euiListGroupItem__label {',
  '  unicode-bidi: embed !important;',
  '  direction: rtl !important;',
  '}',

  /* ── Flyout panels ── */
  '.fyp-rtl .euiFlyout,',
  '.fyp-rtl .euiFlyoutBody {',
  '  direction: rtl !important;',
  '}',
  '.fyp-rtl .euiFlyoutHeader { direction: ltr !important; }',

  /* ── Modal dialogs ── */
  '.fyp-rtl .euiModal__flex { direction: rtl !important; }',
  '.fyp-rtl .euiModalHeader { direction: ltr !important; }',

  /* ── Context menus / popovers / dropdowns ── */
  '.fyp-rtl .euiContextMenuPanel { direction: rtl !important; }',
  '.fyp-rtl .euiPopover__panel,',
  '.fyp-rtl .euiPopoverPanel { direction: rtl !important; }',

  /* ── Breadcrumbs — reverse visual order ── */
  '.fyp-rtl .euiBreadcrumbs { flex-direction: row-reverse !important; }',

  /* ── Accordion expand/collapse arrow mirrors ── */
  '.fyp-rtl .euiAccordion__iconWrapper { transform: scaleX(-1) !important; }',

  /* ── Badges ── */
  '.fyp-rtl .euiBadge { direction: rtl !important; }',

  /* ── Tables ── */
  '.fyp-rtl table, .fyp-rtl .euiTable { direction: rtl !important; }',
  '.fyp-rtl th, .fyp-rtl td { text-align: right !important; }',
  '.fyp-rtl .euiTableHeaderCell,',
  '.fyp-rtl .euiTableRowCell { text-align: right !important; }',

  /* ── Tabs ── */
  '.fyp-rtl .euiTabs { flex-direction: row-reverse !important; }',

  /* ── Keep LTR: technical inputs, code, search bars, toolbar ── */
  '.fyp-rtl input[type="text"],',
  '.fyp-rtl input[type="search"],',
  '.fyp-rtl input[type="number"],',
  '.fyp-rtl .euiFieldSearch,',
  '.fyp-rtl .euiFieldText,',
  '.fyp-rtl .euiCodeBlock,',
  '.fyp-rtl pre,',
  '.fyp-rtl code {',
  '  direction: ltr !important;',
  '  text-align: left !important;',
  '}',
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

// Base style for the theme button (dark-background toolbar aesthetic).
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

// Style for the single language toggle button.
var LANG_BTN_STYLE = [
  'border-radius: 4px',
  'padding: 4px 9px',
  'cursor: pointer',
  'font-size: 11px',
  'font-weight: 700',
  'letter-spacing: 0.4px',
  'white-space: nowrap',
  'line-height: 1.4',
  'transition: background 0.15s, border-color 0.15s, color 0.15s',
  'background: transparent',
  'color: #94a3b8',
  'border: 1px solid #475569',
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

  /* Single language toggle — shows the language you can switch TO.
     English mode  → button reads "UR"  (click to go Urdu)
     Urdu mode     → button reads "EN"  (click to go English) */
  var langBtn = document.createElement('button');
  langBtn.id            = 'fyp-lang-btn';
  langBtn.style.cssText = LANG_BTN_STYLE;

  _syncLangBtn(langBtn);

  langBtn.addEventListener('mouseenter', function() {
    this.style.background   = 'rgba(71,85,105,0.35)';
    this.style.borderColor  = '#60a5fa';
  });
  langBtn.addEventListener('mouseleave', function() {
    this.style.background   = 'transparent';
    this.style.borderColor  = '#475569';
  });
  langBtn.addEventListener('click', function() {
    setLanguage(_lang === 'en' ? 'ur' : 'en');
  });

  var themeBtn = document.createElement('button');
  themeBtn.id            = 'fyp-theme-btn';
  themeBtn.style.cssText = BTN_STYLE;

  _syncThemeBtn(themeBtn);

  themeBtn.addEventListener('mouseenter', function() {
    this.style.background = 'rgba(51,65,85,0.9)';
    this.style.borderColor = '#60a5fa';
  });
  themeBtn.addEventListener('mouseleave', function() {
    this.style.background = 'rgba(30,41,59,0.85)';
    this.style.borderColor = '#475569';
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

/**
 * _syncLangBtn — update the single language toggle to show the opposite language.
 * English active → button reads "UR" (click to switch to Urdu)
 * Urdu active    → button reads "EN" (click to switch to English)
 */
function _syncLangBtn(btn) {
  btn = btn || document.getElementById('fyp-lang-btn');
  if (!btn) return;
  if (_lang === 'en') {
    btn.textContent = 'UR';
    btn.title       = 'Switch to Urdu — page will reload / اردو میں تبدیل کریں';
  } else {
    btn.textContent = 'EN';
    btn.title       = 'Switch to English — page will reload';
  }
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
  try { localStorage.setItem('fyp_theme_v2', enabled ? 'dark' : 'light'); } catch (_) {}

  if (enabled) {
    injectStyle('fyp-dark-mode', DARK_CSS);
    document.body.classList.add('fyp-dark');
  } else {
    removeStyle('fyp-dark-mode');
    document.body.classList.remove('fyp-dark');
  }
  _syncThemeBtn();

  // Broadcast theme change so custom plugins can toggle their own dark-theme class.
  try {
    window.dispatchEvent(new CustomEvent('fyp-theme-changed', {
      detail: { theme: enabled ? 'dark' : 'light' }
    }));
  } catch (_) {}
}

// ── Phase 7: URL-based OSD locale switching ───────────────────────────────────
// OSD's rendering service reads ?locale= from the URL and serves the matching
// registered translation bundle (ur-PK) to React components (<FormattedMessage>).
// We reload the page with/without ?locale=ur-PK so OSD chrome (Discover, Dashboard
// Settings) is also translated via the native i18n system.
//
// Returns true if a page reload was triggered (caller should return early).

function _ensureLocaleUrl(targetLang) {
  try {
    // Never touch the URL on login/logout/auth pages — those routes reject
    // unknown query parameters (OSD returns 400 "locale key missing").
    var path = window.location.pathname;
    if (/\/(login|logout|auth)/i.test(path)) return false;

    var url = new URL(window.location.href);
    var current = url.searchParams.get('locale');
    if (targetLang === 'ur') {
      if (current !== 'ur-PK') {
        url.searchParams.set('locale', 'ur-PK');
        window.location.replace(url.toString());
        return true;
      }
    } else {
      if (current) {
        url.searchParams.delete('locale');
        window.location.replace(url.toString());
        return true;
      }
    }
  } catch (_) {}
  return false;
}

// ── Language / translation ────────────────────────────────────────────────────

function setLanguage(lang) {
  if (lang !== 'en' && lang !== 'ur') return;

  _lang = lang;
  try { localStorage.setItem('fyp_language', lang); } catch (_) {}

  // Phase 7: trigger OSD page reload with the right ?locale= param.
  // If the URL already has the correct locale, _ensureLocaleUrl returns false
  // and we continue with the DOM-replacement path below (Track A).
  if (_ensureLocaleUrl(lang)) return;

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

  // Replace DOM text (Track A — Wazuh strings hardcoded in minified bundles)
  var map = lang === 'ur' ? EN_TO_UR : UR_TO_EN;
  _applyReplaceMap(map);
  _applyPatternTranslations(); // Phase 9: regex pass for dynamic strings

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

  // Phase 8: attribute translation — placeholder, title, aria-label
  var attrNames = ['placeholder', 'title', 'aria-label'];
  attrNames.forEach(function(attr) {
    try {
      document.querySelectorAll('[' + attr + ']').forEach(function(el) {
        if (_isInsideToolbar(el)) return;
        var val = (el.getAttribute(attr) || '').trim();
        if (val && Object.prototype.hasOwnProperty.call(replaceMap, val)) {
          el.setAttribute(attr, replaceMap[val]);
        }
      });
    } catch (_) {}
  });
}

function _isInsideToolbar(el) {
  var cur = el;
  while (cur) {
    if (cur.id === 'fyp-toolbar') return true;
    cur = cur.parentElement;
  }
  return false;
}

// ── Phase 9: Dynamic pattern translations ─────────────────────────────────────
// Wazuh inlines many strings that include live numbers (agent counts, page ranges,
// relative timestamps).  These never match the exact-key map, so a separate regex
// pass handles them.  Runs only when _lang === 'ur'.

var PATTERNS_UR = [
  // "Showing 1 - 25 of 1,234 agents" / "Showing 1 – 25 of 1,234"
  {
    re: /^Showing (\d[\d,]*)\s*[-–]\s*(\d[\d,]*) of (\d[\d,]*)(.*)$/i,
    fn: function(m) { return m[1] + ' سے ' + m[2] + ' تک، کل ' + m[3] + m[4]; }
  },
  // "1 - 25 of 1,234" (pager without leading word)
  {
    re: /^(\d[\d,]*)\s*[-–]\s*(\d[\d,]*) of (\d[\d,]*)$/,
    fn: function(m) { return m[1] + ' - ' + m[2] + ' از ' + m[3]; }
  },
  // "X agent(s)" / "X agents" / "X Agents"
  {
    re: /^(\d[\d,]*)\s+[Aa]gent\(?s?\)?(.*)$/,
    fn: function(m) { return m[1] + ' ایجنٹ' + m[2]; }
  },
  // "X result(s)" / "X results"
  {
    re: /^(\d[\d,]*)\s+[Rr]esults?(.*)$/,
    fn: function(m) { return m[1] + ' نتائج' + m[2]; }
  },
  // "X of Y selected"
  {
    re: /^(\d+) of (\d+) selected$/i,
    fn: function(m) { return m[1] + ' از ' + m[2] + ' منتخب'; }
  },
  // "Page X of Y"
  {
    re: /^Page (\d+) of (\d+)$/i,
    fn: function(m) { return 'صفحہ ' + m[1] + ' از ' + m[2]; }
  },
  // "X rows per page"
  {
    re: /^(\d+) rows? per page$/i,
    fn: function(m) { return 'فی صفحہ ' + m[1] + ' قطاریں'; }
  },
  // Relative timestamps
  { re: /^(\d+)\s+second[s]?\s+ago$/i,    fn: function(m) { return m[1] + ' سیکنڈ پہلے'; } },
  { re: /^(\d+)\s+minute[s]?\s+ago$/i,    fn: function(m) { return m[1] + ' منٹ پہلے'; } },
  { re: /^(\d+)\s+hour[s]?\s+ago$/i,      fn: function(m) { return m[1] + ' گھنٹے پہلے'; } },
  { re: /^(\d+)\s+day[s]?\s+ago$/i,       fn: function(m) { return m[1] + ' دن پہلے'; } },
  { re: /^(\d+)\s+week[s]?\s+ago$/i,      fn: function(m) { return m[1] + ' ہفتے پہلے'; } },
  { re: /^(\d+)\s+month[s]?\s+ago$/i,     fn: function(m) { return m[1] + ' ماہ پہلے'; } },
  { re: /^just now$/i,                     fn: function()  { return 'ابھی'; } },
  // "Last updated: <anything>" / "Last keep-alive: <anything>"
  {
    re: /^Last updated[:\s]+(.+)$/i,
    fn: function(m) { return 'آخری تازہ کاری: ' + m[1]; }
  },
  {
    re: /^Last keep-alive[:\s]+(.+)$/i,
    fn: function(m) { return 'آخری رابطہ: ' + m[1]; }
  },
  // "X alerts" / "X Alerts"
  {
    re: /^(\d[\d,]*)\s+[Aa]lerts?(.*)$/,
    fn: function(m) { return m[1] + ' الرٹس' + m[2]; }
  },
  // "X events" / "X Events"
  {
    re: /^(\d[\d,]*)\s+[Ee]vents?(.*)$/,
    fn: function(m) { return m[1] + ' واقعات' + m[2]; }
  },
  // Severity filter buttons: "Critical (N)" / "High (N)" / "Medium (N)" / "Low (N)"
  {
    re: /^Critical\s*\((\d[\d,]*)\)(.*)$/i,
    fn: function(m) { return 'سنگین (' + m[1] + ')' + m[2]; }
  },
  {
    re: /^High\s*\((\d[\d,]*)\)(.*)$/i,
    fn: function(m) { return 'بلند (' + m[1] + ')' + m[2]; }
  },
  {
    re: /^Medium\s*\((\d[\d,]*)\)(.*)$/i,
    fn: function(m) { return 'درمیانی (' + m[1] + ')' + m[2]; }
  },
  {
    re: /^Low\s*\((\d[\d,]*)\)(.*)$/i,
    fn: function(m) { return 'کم (' + m[1] + ')' + m[2]; }
  },
  // "N Critical" / "N High" / "N Medium" / "N Low" (stat cards)
  {
    re: /^(\d[\d,]*)\s+Critical(.*)$/i,
    fn: function(m) { return m[1] + ' سنگین' + m[2]; }
  },
  {
    re: /^(\d[\d,]*)\s+High(.*)$/i,
    fn: function(m) { return m[1] + ' بلند' + m[2]; }
  },
  {
    re: /^(\d[\d,]*)\s+Medium(.*)$/i,
    fn: function(m) { return m[1] + ' درمیانی' + m[2]; }
  },
  {
    re: /^(\d[\d,]*)\s+Low(.*)$/i,
    fn: function(m) { return m[1] + ' کم' + m[2]; }
  },
  // "Requirement X.X" / "Requirement X.X.X" (PCI/HIPAA requirement labels)
  {
    re: /^Requirement\s+([\d\.]+)(.*)$/i,
    fn: function(m) { return 'ضرورت ' + m[1] + m[2]; }
  },
  // "X vulnerabilities" / "X vulnerability"
  {
    re: /^(\d[\d,]*)\s+vulnerabilit(?:y|ies)(.*)$/i,
    fn: function(m) { return m[1] + ' کمزوریاں' + m[2]; }
  },
  // "X rules"
  {
    re: /^(\d[\d,]*)\s+rules?(.*)$/i,
    fn: function(m) { return m[1] + ' قوانین' + m[2]; }
  },
  // "X decoders"
  {
    re: /^(\d[\d,]*)\s+decoders?(.*)$/i,
    fn: function(m) { return m[1] + ' ڈیکوڈر' + m[2]; }
  },
  // "X groups"
  {
    re: /^(\d[\d,]*)\s+groups?(.*)$/i,
    fn: function(m) { return m[1] + ' گروپ' + m[2]; }
  },
  // "X files"
  {
    re: /^(\d[\d,]*)\s+files?(.*)$/i,
    fn: function(m) { return m[1] + ' فائلیں' + m[2]; }
  },
  // "X policies" / "X policy"
  {
    re: /^(\d[\d,]*)\s+polic(?:y|ies)(.*)$/i,
    fn: function(m) { return m[1] + ' پالیسیاں' + m[2]; }
  },
  // "X checks"
  {
    re: /^(\d[\d,]*)\s+checks?(.*)$/i,
    fn: function(m) { return m[1] + ' جانچ' + m[2]; }
  },
  // "Informational (N)"
  {
    re: /^Informational\s*\((\d[\d,]*)\)(.*)$/i,
    fn: function(m) { return 'معلوماتی (' + m[1] + ')' + m[2]; }
  },
  // "N Informational"
  {
    re: /^(\d[\d,]*)\s+Informational(.*)$/i,
    fn: function(m) { return m[1] + ' معلوماتی' + m[2]; }
  },
  // "Last X hours" (dynamic)
  {
    re: /^Last (\d+) hours?(.*)$/i,
    fn: function(m) { return 'پچھلے ' + m[1] + ' گھنٹے' + m[2]; }
  },
  // "Last X days"
  {
    re: /^Last (\d+) days?(.*)$/i,
    fn: function(m) { return 'پچھلے ' + m[1] + ' دن' + m[2]; }
  },
  // "Last X weeks"
  {
    re: /^Last (\d+) weeks?(.*)$/i,
    fn: function(m) { return 'پچھلے ' + m[1] + ' ہفتے' + m[2]; }
  },
  // "Last X months"
  {
    re: /^Last (\d+) months?(.*)$/i,
    fn: function(m) { return 'پچھلے ' + m[1] + ' ماہ' + m[2]; }
  },
  // "Last X years"
  {
    re: /^Last (\d+) years?(.*)$/i,
    fn: function(m) { return 'پچھلے ' + m[1] + ' سال' + m[2]; }
  },
  // "Last X minutes"
  {
    re: /^Last (\d+) minutes?(.*)$/i,
    fn: function(m) { return 'پچھلے ' + m[1] + ' منٹ' + m[2]; }
  },
  // "Updated X seconds/minutes/hours ago"
  {
    re: /^Updated\s+(\d+)\s+seconds?\s+ago$/i,
    fn: function(m) { return m[1] + ' سیکنڈ پہلے اپ ڈیٹ'; }
  },
  {
    re: /^Updated\s+(\d+)\s+minutes?\s+ago$/i,
    fn: function(m) { return m[1] + ' منٹ پہلے اپ ڈیٹ'; }
  },
  {
    re: /^Updated\s+(\d+)\s+hours?\s+ago$/i,
    fn: function(m) { return m[1] + ' گھنٹے پہلے اپ ڈیٹ'; }
  },
  // "X% pass" / "X% fail"
  {
    re: /^(\d+)%\s+pass(.*)$/i,
    fn: function(m) { return m[1] + '% پاس' + m[2]; }
  },
  {
    re: /^(\d+)%\s+fail(.*)$/i,
    fn: function(m) { return m[1] + '% ناکام' + m[2]; }
  },
];

function _applyPatternTranslations() {
  if (_lang !== 'ur') return;

  var walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        var parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        var tag = parent.tagName ? parent.tagName.toUpperCase() : '';
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        if (_isInsideToolbar(parent)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    },
    false
  );

  var updates = [];
  var node;
  while ((node = walker.nextNode())) {
    var raw = node.textContent;
    var trimmed = raw.trim();
    if (!trimmed) continue;
    for (var i = 0; i < PATTERNS_UR.length; i++) {
      var m = trimmed.match(PATTERNS_UR[i].re);
      if (m) {
        updates.push({ node: node, raw: raw, trimmed: trimmed, repl: PATTERNS_UR[i].fn(m) });
        break;
      }
    }
  }

  updates.forEach(function(u) {
    u.node.textContent = u.raw.replace(u.trimmed, u.repl);
  });
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
        _applyPatternTranslations();
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
    savedTheme = localStorage.getItem('fyp_theme_v2');
    savedLang  = localStorage.getItem('fyp_language');
    // v2 key absent = first run after update; default to light mode
    if (savedTheme === null) {
      savedTheme = 'light';
      localStorage.setItem('fyp_theme_v2', 'light');
    }
  } catch (_) {}

  if (savedTheme === 'dark') setDarkMode(true);

  if (savedLang === 'ur') {
    // Phase 11: apply Track-A DOM translations immediately so the page
    // renders in Urdu even during the brief interval before the Phase 7
    // URL-reload fires (prevents a flash of English).
    _lang = 'ur';
    if (window.__fypLocale__) window.__fypLocale__.lang = 'ur';
    document.body.classList.add('fyp-rtl');
    injectStyle('fyp-rtl-style', RTL_CSS);
    _applyReplaceMap(EN_TO_UR);
    _applyPatternTranslations();
    _syncLangBtn();
    // Phase 7: reload with ?locale=ur-PK for OSD native i18n (Track B).
    // Returns without reloading when the URL already has the correct param.
    _ensureLocaleUrl('ur');
  } else {
    // English mode — remove any stale ?locale=ur-PK from the URL.
    // This handles the case where the URL was bookmarked or manually edited
    // to include the param while localStorage stores English preference.
    _ensureLocaleUrl('en');
  }
}

// ── Navigation-aware visibility ───────────────────────────────────────────────
// The toolbar is only useful on the Wazuh home page; hide it everywhere else.

function _isWazuhHome() {
  return true; // Phase 0: toolbar visible on ALL pages for site-wide localization
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
      _appIdSub = core.application.currentAppId$.subscribe(function() {
        _setToolbarVisible(true);
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
    // Expose stub immediately so _t()/_tFmt() helpers in other plugins never
    // see undefined during the OSD bootstrap phase (before start() fires).
    window.__fypLocale__ = {
      lang: _lang,
      t: function(key) {
        var locale = _lang === 'ur' ? UR : EN;
        return (locale && locale[key]) || key;
      },
    };
    return {};
  }

  start(core /* , plugins */) {
    // Refresh lang in case loadPreferences() hasn't run yet; the object
    // was created in setup() so all references to __fypLocale__ are valid.
    window.__fypLocale__.lang = _lang;

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
