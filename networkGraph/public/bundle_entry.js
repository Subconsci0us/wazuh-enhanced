/**
 * OSD Plugin Bundle Entry
 *
 * This file is the webpack entry point.  When the compiled bundle is loaded
 * by the browser, it immediately calls window.__osdBundles__.define() so that
 * OpenSearch Dashboards can instantiate the plugin via its plugin loader.
 *
 * OSD calls:  bundleRequireFn(entryModuleId)  which must return an object
 * with a named export  `plugin`  (a factory function).
 */

'use strict';

var pluginModule = require('./index.js');

// window.__osdBundles__ is set by bootstrap.js before any plugin scripts load.
// Using window.* explicitly prevents terser/webpack from optimising this away.
(function registerPlugin() {
  if (typeof window === 'undefined' || !window.__osdBundles__) {
    return;
  }
  try {
    window.__osdBundles__.define(
      'plugin/networkGraph/public',
      function bundleRequire(/* moduleId – ignored, module already resolved */) {
        return pluginModule;
      },
      0
    );
  } catch (e) {
    // "already defined" can happen on hot-reload – safe to ignore
    if (e && e.message && e.message.indexOf('already has a module') !== -1) {
      return;
    }
    throw e;
  }

  // Expose the plugin's public path so OSD can build asset URLs.
  if (window.__osdPublicPath__) {
    window.__osdPublicPath__['networkGraph'] =
      window.__osdPublicPath__['networkGraph'] ||
      '/414303/bundles/plugin/networkGraph/';
  }
}());
