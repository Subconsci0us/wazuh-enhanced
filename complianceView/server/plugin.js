'use strict';
require('./load_env');

/**
 * server/plugin.js — ComplianceView server-side lifecycle class.
 *
 * Registers three API routes in setup():
 *   GET /api/compliance_view/summary  — per-framework alert counts
 *   GET /api/compliance_view/details  — section-level breakdown for one framework
 *   GET /api/compliance_view/overlap  — cross-framework co-occurrence matrix
 */

Object.defineProperty(exports, '__esModule', { value: true });
exports.ComplianceViewPlugin = void 0;

var _routes = require('./routes');

class ComplianceViewPlugin {
  constructor(initializerContext) {
    this.logger = initializerContext.logger.get();
  }

  setup(core) {
    this.logger.debug('complianceView: Setup');
    const router = core.http.createRouter();
    (0, _routes.defineRoutes)(router, this.logger);
    return {};
  }

  start(core) {
    this.logger.debug('complianceView: Started');
    return {};
  }

  stop() {}
}

exports.ComplianceViewPlugin = ComplianceViewPlugin;
