'use strict';

/**
 * public/bundle_entry.js — Webpack entry point / OSD bundle registration
 *
 * IMPORTANT: We store the plugin exports on window._nlqPluginExports before
 * calling __osdBundles__.define.  This prevents webpack 5 + terser from
 * generating a broken pattern where the module factory is defined but never
 * called, and the require function itself is returned instead of the module
 * exports.  Using window.* for both the store and the retrieve forces a live
 * property access that no static optimizer can inline or eliminate.
 */

window._nlqPluginExports = require('./index.js');

(function registerPlugin() {
  if (typeof window === 'undefined' || !window.__osdBundles__) {
    return;
  }

  try {
    window.__osdBundles__.define(
      'plugin/nlqSearch/public',
      function bundleRequire() {
        return window._nlqPluginExports;
      },
      0
    );
  } catch (e) {
    if (e && e.message && e.message.indexOf('already has a module') !== -1) {
      return;
    }
    throw e;
  }

  if (window.__osdPublicPath__) {
    window.__osdPublicPath__['nlqSearch'] =
      window.__osdPublicPath__['nlqSearch'] ||
      '/414303/bundles/plugin/nlqSearch/';
  }
}());
