/**
 * webpack.config.js — Build configuration for the networkGraph OSD plugin
 *
 * WHY A CUSTOM WEBPACK BUILD?
 * ═══════════════════════════
 * Wazuh Dashboard ships as a pre-compiled binary.  There is no exposed build
 * toolchain for third-party plugins — you cannot use OSD's own build pipeline
 * without the full OSD source tree.  Instead, this config produces a single
 * self-contained bundle that:
 *   1. Includes all plugin code (public/index.js).
 *   2. Includes D3 v7 (~270 KB) fully inlined — no external CDN dependency.
 *   3. Registers itself with OSD's runtime loader via bundle_entry.js.
 *
 * OUTPUT FORMAT
 * ═════════════
 * The bundle is NOT a UMD/AMD/CommonJS module — it is a plain script that
 * runs immediately when loaded.  bundle_entry.js (the entry point) calls
 * window.__osdBundles__.define() as a side-effect, which is all OSD needs.
 *
 * NODE BUILT-IN FALLBACKS
 * ═══════════════════════
 * D3 v7 does not use Node built-ins in the browser, but webpack 5's resolver
 * sometimes tries to polyfill them when it encounters transitive requires.
 * Setting each to `false` tells webpack "don't bundle this — it won't be
 * called in a browser context" and avoids build errors.
 */

const path = require('path');

module.exports = {
  // Entry: bundle_entry.js performs the OSD registration side-effect and
  // requires ./index.js (the actual plugin code + D3).
  entry: './public/bundle_entry.js',

  output: {
    path:     path.resolve(__dirname, 'target/public'),
    filename: 'networkGraph.plugin.js',  // Must match install.sh BUNDLE variable.
  },

  resolve: {
    extensions: ['.js'],

    // Disable Node.js built-in polyfills — they are not needed in the browser
    // and would bloat the bundle significantly.
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
    // D3 + plugin code (~291 KB) exceeds webpack's default 250 KB warning
    // threshold.  Disable hints — bundle size is acceptable for a dashboard plugin.
    hints:              false,
    maxAssetSize:       5000000,
    maxEntrypointSize:  5000000,
  },
};
