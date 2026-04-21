/**
 * webpack.config.js — Build configuration for the nlqSearch OSD plugin
 *
 * Produces a single self-contained browser bundle.  No external CDN needed.
 * The entry point (bundle_entry.js) registers the module with window.__osdBundles__
 * exactly as OSD expects.
 */

const path = require('path');

module.exports = {
  entry: './public/bundle_entry.js',

  output: {
    path:     path.resolve(__dirname, 'target/public'),
    filename: 'nlqSearch.plugin.js',
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
