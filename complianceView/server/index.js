'use strict';

/**
 * server/index.js — OSD server-side entry point for complianceView plugin.
 *
 * OSD loads this file at startup because opensearch_dashboards.json has
 * "server": true.  It calls the exported plugin() factory once and uses the
 * returned instance for setup/start/stop lifecycle calls.
 */

Object.defineProperty(exports, '__esModule', { value: true });
exports.plugin = plugin;

var _plugin = require('./plugin');

function plugin(initializerContext) {
  return new _plugin.ComplianceViewPlugin(initializerContext);
}
