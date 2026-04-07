'use strict';

/**
 * server/routes/index.js — Wazuh API proxy routes
 *
 * WHY A SERVER-SIDE PROXY?
 * The browser cannot call the Wazuh REST API directly because:
 *   - It uses a self-signed TLS certificate (browser would block it).
 *   - Credentials (API user + password) must never be exposed to the client.
 *   - CORS is not configured on the Wazuh manager for dashboard origins.
 *
 * This module runs inside the OSD Node.js process and acts as an authenticated
 * proxy — the browser calls OSD, OSD calls Wazuh, OSD returns the result.
 *
 * REGISTERED ROUTES
 *   GET /api/network_graph/agents  — all enrolled agents (up to 500)
 *   GET /api/network_graph/alerts  — alerts from the last 5 minutes (up to 500)
 */

Object.defineProperty(exports, '__esModule', { value: true });
exports.defineRoutes = defineRoutes;

const https          = require('https');
const { schema }     = require('@osd/config-schema');

/* ─────────────────────────────────────────────────────────────────────────────
   Wazuh API connection settings
   Change these if your Wazuh manager runs on a different host/port or if the
   wazuh-wui password has been rotated.  The current password can be found in:
     /usr/share/wazuh-dashboard/data/wazuh/config/wazuh.yml
   ───────────────────────────────────────────────────────────────────────────── */

const WAZUH_API_HOST     = 'localhost';   // Wazuh manager REST API hostname
const WAZUH_API_PORT     = 55000;         // Default Wazuh REST API port
const WAZUH_API_USER     = 'wazuh-wui';   // Built-in read-only API user
const WAZUH_API_PASSWORD = 'v86bPF+u+2nph5LxghIFWivBr87qPgJL';
const WAZUH_API_RUN_AS   = true;          // Sends run_as: false header (required for wazuh-wui)

// The Wazuh manager uses a self-signed certificate.
// rejectUnauthorized: false is safe here because the connection is loopback-only.
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/* ─────────────────────────────────────────────────────────────────────────────
   JWT token cache
   Wazuh JWTs have a 15-minute lifetime.  We cache for 14 minutes so we
   re-authenticate before expiry rather than getting a mid-request failure.
   ───────────────────────────────────────────────────────────────────────────── */

let cachedToken      = null;
let tokenExpiresAt   = 0;                    // epoch ms — 0 means no token yet
const TOKEN_LIFETIME = 14 * 60 * 1000;       // 14 minutes in milliseconds

/**
 * Return a valid Wazuh JWT, fetching a fresh one when the cache is empty or stale.
 *
 * Authentication flow:
 *   POST /security/user/authenticate?raw=true
 *   Authorization: Basic base64(user:password)
 *   → Response body is the raw JWT string (because raw=true suppresses JSON wrapper).
 *
 * @param {object} logger  OSD logger for debug/error output.
 * @returns {Promise<string>}
 */
async function getWazuhToken(logger) {
  const now = Date.now();

  // Return the cached token if it is still within its validity window.
  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  logger && logger.debug('networkGraph: refreshing Wazuh JWT token');

  const credentials = Buffer.from(`${WAZUH_API_USER}:${WAZUH_API_PASSWORD}`).toString('base64');

  const body = await wazuhRequest(
    'POST',
    '/security/user/authenticate?raw=true',
    null,
    { Authorization: 'Basic ' + credentials },
    logger
  );

  // raw=true → plain-text token in the body.
  // Fallback handles the rare case where raw=true is ignored and JSON is returned.
  const token = typeof body === 'string'
    ? body.trim()
    : (body && body.data && body.data.token);

  if (!token) throw new Error('networkGraph: failed to obtain Wazuh JWT token');

  cachedToken    = token;
  tokenExpiresAt = now + TOKEN_LIFETIME;
  return token;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Low-level HTTPS helper
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Make a raw HTTPS request to the Wazuh API.
 *
 * Parses JSON responses automatically.  Returns a raw string for non-JSON
 * content types (needed by the token endpoint when raw=true is set).
 *
 * @param {string}       method   HTTP method (GET, POST, …)
 * @param {string}       path     API path including query string, e.g. '/agents?limit=500'
 * @param {object|null}  reqBody  Request body object (serialised to JSON), or null.
 * @param {object}       headers  Additional request headers to merge in.
 * @param {object}       logger   OSD logger.
 * @returns {Promise<object|string>}
 */
function wazuhRequest(method, path, reqBody, headers, logger) {
  return new Promise(function(resolve, reject) {
    const bodyStr = reqBody ? JSON.stringify(reqBody) : null;

    const options = {
      hostname: WAZUH_API_HOST,
      port:     WAZUH_API_PORT,
      path:     path,
      method:   method,
      agent:    httpsAgent,
      headers:  Object.assign(
        { 'Content-Type': 'application/json' },
        headers,
        // Content-Length is required by the Wazuh API when sending a body.
        bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}
      ),
    };

    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          if (res.headers['content-type'] &&
              res.headers['content-type'].includes('application/json')) {
            resolve(JSON.parse(data));
          } else {
            resolve(data); // Plain-text token response from auth endpoint.
          }
        } catch (e) {
          resolve(data);  // Return raw text on JSON parse failure.
        }
      });
    });

    req.on('error', function(err) {
      logger && logger.error('networkGraph: wazuhRequest error – ' + err.message);
      reject(err);
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Make an authenticated Wazuh API request using the cached JWT.
 *
 * If the API returns Wazuh error code 6 (invalid/expired token) the cache is
 * cleared and the request is retried once with a freshly issued token.
 *
 * @param {string}       method
 * @param {string}       path
 * @param {object|null}  reqBody
 * @param {object}       logger
 * @param {boolean}      [retried=false]  Internal flag — prevents infinite retry loop.
 * @returns {Promise<object|string>}
 */
async function wazuhAuthRequest(method, path, reqBody, logger, retried) {
  const token = await getWazuhToken(logger);

  const headers = { 'Authorization': 'Bearer ' + token };

  // The wazuh-wui user requires this header to activate its read-only privilege set.
  if (WAZUH_API_RUN_AS) {
    headers['run_as'] = 'false';
  }

  const result = await wazuhRequest(method, path, reqBody, headers, logger);

  // Wazuh error code 6 = token is invalid or has expired mid-request.
  // Invalidate the cache and retry with a fresh token (once only).
  if (!retried && result && result.error === 6) {
    cachedToken    = null;
    tokenExpiresAt = 0;
    return wazuhAuthRequest(method, path, reqBody, logger, true);
  }

  return result;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Route definitions
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Register the two proxy routes on the given OSD router.
 *
 * @param {object} router  OSD scoped router (from core.http.createRouter()).
 * @param {object} logger  OSD logger.
 */
function defineRoutes(router, logger) {

  /* ── GET /api/network_graph/agents ─────────────────────────────────────────
     Returns up to 500 enrolled Wazuh agents.
     Fields: id, name, ip, status, os.name, os.version.
     The browser uses this list to build the graph nodes.
  ────────────────────────────────────────────────────────────────────────── */
  router.get(
    {
      path:     '/api/network_graph/agents',
      validate: false,  // No query params or request body to validate.
    },
    async (context, request, response) => {
      try {
        const data = await wazuhAuthRequest(
          'GET',
          '/agents?limit=500&select=id,name,ip,status,os.name,os.version',
          null,
          logger
        );
        return response.ok({ body: data });
      } catch (err) {
        logger && logger.error('networkGraph: agents route error – ' + err.message);
        return response.custom({ statusCode: 500, body: err.message });
      }
    }
  );

  /* ── GET /api/network_graph/alerts ─────────────────────────────────────────
     Returns up to 500 alerts from the last 5 minutes, newest first.
     Fields: agent.id, rule.level, data.srcip, data.dstip, data.src_ip, data.dst_ip.

     The browser uses:
       - rule.level   → to colour each agent's edge to the manager
       - src/dst IPs  → to draw dashed agent-to-agent edges (lateral movement)
  ────────────────────────────────────────────────────────────────────────── */
  router.get(
    {
      path:     '/api/network_graph/alerts',
      validate: false,
    },
    async (context, request, response) => {
      try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

        const alertPath =
          '/alerts' +
          '?limit=500' +
          '&select=agent.id,rule.level,data.srcip,data.dstip,data.src_ip,data.dst_ip' +
          '&q=timestamp>' + encodeURIComponent(fiveMinutesAgo) +
          '&sort=-timestamp';  // Newest first — ensures most-recent alerts survive the limit.

        const data = await wazuhAuthRequest('GET', alertPath, null, logger);
        return response.ok({ body: data });
      } catch (err) {
        logger && logger.error('networkGraph: alerts route error – ' + err.message);
        return response.custom({ statusCode: 500, body: err.message });
      }
    }
  );
}
