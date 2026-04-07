'use strict';

Object.defineProperty(exports, '__esModule', { value: true });
exports.NetworkGraphPlugin = void 0;

var _routes = require('./routes');

/**
 * Server-side plugin class for networkGraph.
 * Registers proxy routes to the Wazuh REST API.
 */
class NetworkGraphPlugin {
  constructor(initializerContext) {
    this.logger = initializerContext.logger.get();
  }

  setup(core) {
    this.logger.debug('networkGraph: Setup');
    const router = core.http.createRouter();
    (0, _routes.defineRoutes)(router, this.logger);
    return {};
  }

  start(core) {
    this.logger.debug('networkGraph: Started');
    return {};
  }

  stop() {}
}

exports.NetworkGraphPlugin = NetworkGraphPlugin;
