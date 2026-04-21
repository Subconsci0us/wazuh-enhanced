/**
 * webpack.config.js — Build configuration for the complianceView OSD plugin
 *
 * Produces a single self-contained bundle (no external CDN dependencies).
 * All UI code is vanilla JS + DOM manipulation — no React, no D3.
 * The bundle registers itself with OSD via window.__osdBundles__.define().
 */

const path = require('path');

module.exports = {
  entry: './public/bundle_entry.js',

  output: {
    path:     path.resolve(__dirname, 'target/public'),
    filename: 'complianceView.plugin.js',
  },

  resolve: {
    extensions: ['.js'],
    fallback: {
      fs:     false,
      path:   false,
      crypto: false,
      stream: false,
      buffer: false,
      util:   false,
      url:    false,
      http:   false,
      https:  false,
      zlib:   false,
      os:     false,
    },
  },

  performance: {
    hints:             false,
    maxAssetSize:      5000000,
    maxEntrypointSize: 5000000,
  },
};
