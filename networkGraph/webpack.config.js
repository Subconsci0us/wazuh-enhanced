/**
 * Webpack config for the networkGraph OSD plugin public bundle.
 *
 * The output must be compatible with OpenSearch Dashboards' plugin loader.
 * OSD expects plugins to call:
 *   __osdBundles__.define("plugin/<id>/public", requireFn, entryModuleId)
 *
 * We achieve this by having bundle_entry.js perform that registration directly
 * using the already-resolved plugin exports (no reliance on internal webpack IDs).
 */
const path = require('path');

module.exports = {
  entry: './public/bundle_entry.js',
  output: {
    path: path.resolve(__dirname, 'target/public'),
    filename: 'networkGraph.plugin.js',
  },
  resolve: {
    extensions: ['.js'],
    fallback: {
      fs: false,
      path: false,
      crypto: false,
      stream: false,
      buffer: false,
      util: false,
      url: false,
      http: false,
      https: false,
      zlib: false,
      os: false,
    },
  },
  performance: {
    // D3 + plugin code will exceed the 250 KB default
    hints: false,
    maxAssetSize: 5000000,
    maxEntrypointSize: 5000000,
  },
};
