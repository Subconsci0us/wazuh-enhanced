'use strict';

class LocalizationPlugin {
  constructor(initializerContext) {
    this.logger = initializerContext.logger.get();
  }

  setup(core) {
    this.logger.debug('localization: server setup');
  }

  start() {}

  stop() {}
}

module.exports = { LocalizationPlugin };
