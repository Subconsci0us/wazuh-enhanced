/**
 * webpack.config.js — Build configuration for the localization OSD plugin
 *
 * Produces a single self-contained bundle that:
 *   1. Bundles the toolbar, dark-mode stylesheet, and translation engine.
 *   2. Inlines both locale JSON files (en.json, ur.json) via webpack's native
 *      JSON handling — no external file reads at runtime.
 *   3. Registers itself with OSD's runtime loader via bundle_entry.js.
 *
 * No D3 or heavy dependencies — expected output is ~20–30 KB.
 */

const path = require('path');

module.exports = {
  entry: './public/bundle_entry.js',

  output: {
    path:     path.resolve(__dirname, 'target', 'public'),
    filename: 'localization.plugin.js',
  },

  resolve: {
    extensions: ['.js', '.json'],
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
    maxAssetSize:      1000000,
    maxEntrypointSize: 1000000,
  },
};
