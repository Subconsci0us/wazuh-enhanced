'use strict';

Object.defineProperty(exports, '__esModule', { value: true });
exports.defineRoutes = defineRoutes;

const https   = require('https');
const { schema } = require('@osd/config-schema');

/* ─────────────────────────────────────────────────────────────────────────────
   Wazuh API configuration
   ───────────────────────────────────────────────────────────────────────────── */

const WAZUH_API_HOST     = 'localhost';
const WAZUH_API_PORT     = 55000;
const WAZUH_API_USER     = 'wazuh-wui';
const WAZUH_API_PASSWORD = 'v86bPF+u+2nph5LxghIFWivBr87qPgJL';
const WAZUH_API_RUN_AS   = true;

/* Self-signed certificate on the Wazuh manager – ignore TLS errors */
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/* ─────────────────────────────────────────────────────────────────────────────
   JWT token cache
   ───────────────────────────────────────────────────────────────────────────── */

let cachedToken      = null;
let tokenExpiresAt   = 0;          // epoch ms
const TOKEN_LIFETIME = 14 * 60 * 1000; // 14 min (Wazuh default is 15 min)

/**
 * Obtain a JWT token from the Wazuh API, using Basic auth.
 * Caches the token until TOKEN_LIFETIME before expiry.
 */
async function getWazuhToken(logger) {
  const now = Date.now();
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

  // raw=true returns the token as plain text
  const token = typeof body === 'string' ? body.trim() : (body && body.data && body.data.token);
  if (!token) throw new Error('networkGraph: failed to obtain Wazuh JWT token');

  cachedToken    = token;
  tokenExpiresAt = now + TOKEN_LIFETIME;
  return token;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Low-level HTTPS helper
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Make an HTTPS request to the Wazuh API.
 * @param {string}  method   – HTTP method
 * @param {string}  path     – API path (e.g. '/agents')
 * @param {object|null} reqBody – request body (JSON), or null
 * @param {object}  headers  – request headers
 * @param {object}  logger   – OSD logger
 * @returns {Promise<object|string>}
 */
function wazuhRequest(method, path, reqBody, headers, logger) {
  return new Promise(function(resolve, reject) {
    const bodyStr = reqBody ? JSON.stringify(reqBody) : null;

    const options = {
      hostname:    WAZUH_API_HOST,
      port:        WAZUH_API_PORT,
      path:        path,
      method:      method,
      agent:       httpsAgent,
      headers: Object.assign({
        'Content-Type': 'application/json',
      }, headers, bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
    };

    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          if (res.headers['content-type'] && res.headers['content-type'].includes('application/json')) {
            resolve(JSON.parse(data));
          } else {
            resolve(data);
          }
        } catch (e) {
          resolve(data);
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
 * Make an authenticated request to the Wazuh API.
 * Retries once if the token appears to be expired (HTTP 401).
 */
async function wazuhAuthRequest(method, path, reqBody, logger, retried) {
  const token = await getWazuhToken(logger);

  const headers = { 'Authorization': 'Bearer ' + token };
  if (WAZUH_API_RUN_AS) {
    // run_as allows using the wazuh-wui user's privileges
    headers['run_as'] = 'false';
  }

  let result;
  try {
    result = await wazuhRequest(method, path, reqBody, headers, logger);
  } catch (err) {
    throw err;
  }

  // If the API returns a 401-like error inside the JSON body, invalidate and retry
  if (!retried && result && result.error === 6 /* invalid token */) {
    cachedToken  = null;
    tokenExpiresAt = 0;
    return wazuhAuthRequest(method, path, reqBody, logger, true);
  }

  return result;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Route definitions
   ───────────────────────────────────────────────────────────────────────────── */

function defineRoutes(router, logger) {

  /* ── GET /api/network_graph/agents ───────────────────────────────────────── */
  router.get(
    {
      path: '/api/network_graph/agents',
      validate: false,
    },
    async (context, request, response) => {
      try {
        // Fetch up to 500 agents in a single call
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

  /* ── GET /api/network_graph/alerts ───────────────────────────────────────── */
  router.get(
    {
      path: '/api/network_graph/alerts',
      validate: false,
    },
    async (context, request, response) => {
      try {
        // Fetch the 500 most-recent alerts from the last 5 minutes
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const alertPath =
          '/alerts' +
          '?limit=500' +
          '&select=agent.id,rule.level,data.srcip,data.dstip,data.src_ip,data.dst_ip' +
          '&q=timestamp>' + encodeURIComponent(fiveMinutesAgo) +
          '&sort=-timestamp';

        const data = await wazuhAuthRequest('GET', alertPath, null, logger);
        return response.ok({ body: data });
      } catch (err) {
        logger && logger.error('networkGraph: alerts route error – ' + err.message);
        return response.custom({ statusCode: 500, body: err.message });
      }
    }
  );
}
