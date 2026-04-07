'use strict';

Object.defineProperty(exports, '__esModule', { value: true });
exports.plugin = plugin;

var _plugin = require('./plugin');

function plugin(initializerContext) {
  return new _plugin.NetworkGraphPlugin(initializerContext);
}
