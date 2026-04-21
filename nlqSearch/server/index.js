'use strict';

/**
 * server/index.js — OSD server-side plugin entry point
 *
 * OSD loads this file automatically at startup because opensearch_dashboards.json
 * has "server": true.  The exported plugin() factory creates the plugin instance.
 */

Object.defineProperty(exports, '__esModule', { value: true });
exports.plugin = plugin;

var _plugin = require('./plugin');

function plugin(initializerContext) {
  return new _plugin.NlqSearchPlugin(initializerContext);
}
