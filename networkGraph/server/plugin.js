'use strict';
require('./load_env');

/**
 * server/plugin.js — NetworkGraphPlugin server-side lifecycle class
 *
 * OSD calls these lifecycle methods in order:
 *   1. setup(core)  — runs before the HTTP server starts accepting requests.
 *                     This is where routes must be registered.
 *   2. start(core)  — runs after all plugins have set up.
 *   3. stop()       — runs on server shutdown.
 *
 * We only need setup() — we create a router and hand it to defineRoutes(),
 * which attaches the two Wazuh API proxy endpoints.
 */

Object.defineProperty(exports, '__esModule', { value: true });
exports.NetworkGraphPlugin = void 0;

var _routes = require('./routes');

class NetworkGraphPlugin {
  constructor(initializerContext) {
    // Get a logger scoped to this plugin so log lines are prefixed with
    // "networkGraph" in the OSD log output.
    this.logger = initializerContext.logger.get();
  }

  /**
   * setup() — called by OSD before the HTTP server opens.
   * Creates a router and registers all plugin routes.
   *
   * @param {object} core  OSD core setup contract.
   *   core.http.createRouter() returns a scoped router whose paths are
   *   automatically prefixed so they live under the OSD HTTP namespace.
   */
  setup(core) {
    this.logger.debug('networkGraph: Setup');

    const router = core.http.createRouter();

    // Register GET /api/network_graph/agents and /api/network_graph/alerts.
    // The logger is passed so routes can emit debug/error lines.
    (0, _routes.defineRoutes)(router, this.logger);

    return {};
  }

  /**
   * start() — called after all plugins are set up.
   * Nothing to do here; routes are already registered.
   */
  start(core) {
    this.logger.debug('networkGraph: Started');
    return {};
  }

  /** stop() — called on server shutdown. No resources to release. */
  stop() {}
}

exports.NetworkGraphPlugin = NetworkGraphPlugin;
