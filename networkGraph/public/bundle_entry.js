'use strict';

/**
 * public/bundle_entry.js — Webpack entry point / OSD bundle registration
 *
 * HOW OSD PLUGIN LOADING WORKS
 * ════════════════════════════
 * When the Wazuh Dashboard page loads it fetches /bootstrap.js — a dynamically
 * generated script that:
 *   1. Defines window.__osdBundles__  (has / define / get methods).
 *   2. Appends a <script> tag for every installed plugin's bundle, including
 *      this file once compiled into target/public/networkGraph.plugin.js.
 *
 * When OSD's core.entry.js later calls:
 *   __osdBundles__.get('plugin/networkGraph/public')
 * it expects a module already registered via __osdBundles__.define().
 * If define() was never called the page shows:
 *   "Definition of plugin 'networkGraph' not found and may have failed to load"
 *
 * WHY window.__osdBundles__ AND NOT A BARE REFERENCE
 * ══════════════════════════════════════════════════
 * An earlier version used:
 *   if (typeof __osdBundles__ !== 'undefined') { __osdBundles__.define(...) }
 *
 * This broke silently in production builds.  Webpack 5 + terser treats bare
 * global identifiers inside typeof guards as dead code and removes the
 * define() call entirely from the minified output.
 *
 * Using  window.__osdBundles__  (a property lookup, not a bare identifier)
 * forces a runtime property read that cannot be statically optimised away.
 *
 * BUNDLE ID FORMAT
 * ════════════════
 * Must match the pattern OSD looks up:  'plugin/<pluginId>/public'
 * where <pluginId> is the "id" field in opensearch_dashboards.json.
 */

// Resolve the full plugin module now (at bundle load time), before the OSD
// check below.  This ensures D3 and all plugin code are already initialised
// when bundleRequire() is called by OSD's plugin loader.
var pluginModule = require('./index.js');

(function registerPlugin() {
  // Guard: this IIFE may be evaluated in a non-browser context (e.g. SSR or
  // Node.js test runs) where window does not exist.
  if (typeof window === 'undefined' || !window.__osdBundles__) {
    return;
  }

  try {
    window.__osdBundles__.define(
      'plugin/networkGraph/public',

      // OSD passes a moduleId argument to this function, but we ignore it —
      // the module is already resolved above and we return it directly.
      function bundleRequire(/* moduleId — ignored */) {
        return pluginModule;
      },

      0   // Entry module index — always 0 for single-entry bundles.
    );
  } catch (e) {
    // OSD throws "already has a module" on hot-reload.  Safe to ignore.
    if (e && e.message && e.message.indexOf('already has a module') !== -1) {
      return;
    }
    throw e;
  }

  // Register the public asset path so OSD can construct correct URLs for any
  // static assets (images, fonts) this plugin might serve in the future.
  if (window.__osdPublicPath__) {
    window.__osdPublicPath__['networkGraph'] =
      window.__osdPublicPath__['networkGraph'] ||
      '/414303/bundles/plugin/networkGraph/';
  }
}());
