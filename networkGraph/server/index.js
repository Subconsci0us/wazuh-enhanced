'use strict';

/**
 * server/index.js — OSD server-side plugin entry point
 *
 * OpenSearch Dashboards loads this file automatically at startup because
 * opensearch_dashboards.json has "server": true.  OSD calls the exported
 * `plugin()` factory and passes an initializerContext that carries the logger
 * and other bootstrap utilities.
 *
 * This file does nothing except create and return a NetworkGraphPlugin
 * instance.  All real work (route registration) happens inside plugin.js.
 */

Object.defineProperty(exports, '__esModule', { value: true });
exports.plugin = plugin;

var _plugin = require('./plugin');

/**
 * Plugin factory — called once by OSD during server startup.
 *
 * @param {object} initializerContext  OSD-provided context object.
 *   Carries initializerContext.logger (used by plugin.js to get a scoped logger).
 * @returns {NetworkGraphPlugin}
 */
function plugin(initializerContext) {
  return new _plugin.NetworkGraphPlugin(initializerContext);
}
