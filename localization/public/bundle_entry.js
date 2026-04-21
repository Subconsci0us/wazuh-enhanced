'use strict';

/**
 * public/bundle_entry.js — Webpack entry point / OSD bundle registration
 *
 * Same pattern as networkGraph/bundle_entry.js.  window.__osdBundles__ must
 * be accessed as a property lookup (not a bare identifier) to prevent webpack
 * 5 + terser from dead-coding the define() call in production builds.
 */

var pluginModule = require('./index.js');

(function registerPlugin() {
  if (typeof window === 'undefined' || !window.__osdBundles__) {
    return;
  }

  try {
    window.__osdBundles__.define(
      'plugin/localization/public',
      function bundleRequire(/* moduleId — ignored */) {
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
    window.__osdPublicPath__['localization'] =
      window.__osdPublicPath__['localization'] ||
      '/414303/bundles/plugin/localization/';
  }
}());
