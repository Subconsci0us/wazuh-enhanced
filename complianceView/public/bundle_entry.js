'use strict';

/**
 * public/bundle_entry.js — Webpack entry point / OSD bundle registration.
 *
 * Registers this plugin with OpenSearch Dashboards' bundle loader via
 * window.__osdBundles__.define().  OSD looks this up when the user navigates
 * to /app/complianceView.
 *
 * Using window.__osdBundles__ (a property access) rather than a bare
 * __osdBundles__ identifier prevents webpack/terser from dead-code-eliminating
 * the define() call in production builds.
 */

var pluginModule = require('./index.js');

(function registerPlugin() {
  if (typeof window === 'undefined' || !window.__osdBundles__) {
    return;
  }

  try {
    window.__osdBundles__.define(
      'plugin/complianceView/public',
      function bundleRequire() {
        return pluginModule;
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
    window.__osdPublicPath__['complianceView'] =
      window.__osdPublicPath__['complianceView'] ||
      '/414303/bundles/plugin/complianceView/';
  }
}());
