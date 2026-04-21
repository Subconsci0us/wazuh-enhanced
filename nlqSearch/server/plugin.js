'use strict';

/**
 * server/plugin.js — NlqSearchPlugin server-side lifecycle class
 *
 * OSD lifecycle:
 *   1. setup(core)  — register HTTP routes before the server opens.
 *   2. start(core)  — called after all plugins are set up.
 *   3. stop()       — called on server shutdown.
 */

Object.defineProperty(exports, '__esModule', { value: true });
exports.NlqSearchPlugin = void 0;

var _routes = require('./routes');

class NlqSearchPlugin {
  constructor(initializerContext) {
    this.logger = initializerContext.logger.get();
  }

  setup(core) {
    this.logger.debug('nlqSearch: Setup');
    const router = core.http.createRouter();
    (0, _routes.defineRoutes)(router, this.logger);
    return {};
  }

  start(core) {
    this.logger.debug('nlqSearch: Started');
    return {};
  }

  stop() {}
}

exports.NlqSearchPlugin = NlqSearchPlugin;
