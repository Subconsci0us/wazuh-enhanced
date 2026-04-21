'use strict';

const { LocalizationPlugin } = require('./plugin');

module.exports = {
  plugin: function(initializerContext) {
    return new LocalizationPlugin(initializerContext);
  },
};
