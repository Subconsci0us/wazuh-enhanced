'use strict';

/**
 * server/routes/index.js — Compliance View API routes
 *
 * All three routes query OpenSearch (wazuh-alerts-* index) directly using
 * aggregation queries.  No alert documents are fetched — only bucketed counts.
 *
 * Routes:
 *   GET /api/compliance_view/summary?time_range=24h
 *     → { frameworks: { pci_dss: N, hipaa: N, gdpr: N, nist_800_53: N, tsc: N, peca: N } }
 *
 *   GET /api/compliance_view/details?framework=pci_dss&time_range=24h
 *     → { sections: [ { key, count, severity: {info,low,medium,high,critical}, last_alert } ] }
 *
 *   GET /api/compliance_view/overlap?time_range=24h
 *     → { matrix: { pci_dss: { hipaa: N, gdpr: N, … }, … } }
 */

Object.defineProperty(exports, '__esModule', { value: true });
exports.defineRoutes = defineRoutes;

const https      = require('https');
const { schema } = require('@osd/config-schema');

/* ── OpenSearch connection ──────────────────────────────────────────────────── */

const OS_HOST     = process.env.OS_HOST     || 'localhost';
const OS_PORT     = parseInt(process.env.OS_PORT || '9200', 10);
const OS_USER     = process.env.OS_USER     || 'admin';
const OS_PASSWORD = process.env.OS_PASSWORD || 'lO.5jGDicEdmbH9kt9So1DYeFqkl6k6s';
const OS_INDEX    = 'wazuh-alerts-*';

const osAgent = new https.Agent({ rejectUnauthorized: false });

/* ── Framework metadata ─────────────────────────────────────────────────────── */

// For array fields (pci_dss, hipaa, etc.) we use { exists: { field } } to count.
// For PECA we use { term: { "rule.groups": "peca" } }.
const FRAMEWORKS = {
  pci_dss:    { label: 'PCI DSS',      field: 'rule.pci_dss',     type: 'field' },
  hipaa:      { label: 'HIPAA',        field: 'rule.hipaa',        type: 'field' },
  gdpr:       { label: 'GDPR',         field: 'rule.gdpr',         type: 'field' },
  nist_800_53:{ label: 'NIST 800-53',  field: 'rule.nist_800_53',  type: 'field' },
  tsc:        { label: 'TSC',          field: 'rule.tsc',          type: 'field' },
  peca:       { label: 'PECA',         field: 'rule.groups',       type: 'term', termValue: 'peca' },
};

const FRAMEWORK_KEYS = Object.keys(FRAMEWORKS);

/* PECA section descriptions (hardcoded per spec) */
const PECA_SECTION_DESC = {
  peca_3:  'Unauthorized Access to Information System or Data',
  peca_4:  'Unauthorized Copying or Transmission of Data',
  peca_5:  'Interference with Information System or Data',
  peca_6:  'Unauthorized Access to Critical Infrastructure',
  peca_8:  'Unauthorized Interception',
  peca_11: 'Electronic Forgery',
  peca_20: 'Offenses by Malicious Code',
  peca_21: 'Cyber Terrorism',
  peca_36: 'Data Protection of Service Providers',
  peca_37: 'Data Retention',
};

/* ── Helpers ────────────────────────────────────────────────────────────────── */

/**
 * Convert a time_range string (e.g. "24h", "7d", "30d") to an OpenSearch
 * date math expression.
 */
function timeRangeToGte(timeRange) {
  const allowed = { '24h': 'now-24h', '7d': 'now-7d', '30d': 'now-30d' };
  return allowed[timeRange] || 'now-24h';
}

/**
 * Build an OpenSearch filter clause for a given framework key.
 */
function frameworkFilter(key) {
  const fw = FRAMEWORKS[key];
  if (fw.type === 'term') {
    return { term: { [fw.field]: fw.termValue } };
  }
  return { exists: { field: fw.field } };
}

/**
 * Low-level HTTPS POST to OpenSearch.
 */
function osRequest(path, body) {
  return new Promise(function(resolve, reject) {
    const bodyStr = JSON.stringify(body);
    const credentials = Buffer.from(`${OS_USER}:${OS_PASSWORD}`).toString('base64');

    const options = {
      hostname: OS_HOST,
      port:     OS_PORT,
      path:     path,
      method:   'POST',
      agent:    osAgent,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'Authorization':  'Basic ' + credentials,
      },
    };

    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('OpenSearch returned non-JSON: ' + data.substring(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

/* ── Route definitions ──────────────────────────────────────────────────────── */

function defineRoutes(router, logger) {

  /* ──────────────────────────────────────────────────────────────────────────
     GET /api/compliance_view/summary?time_range=24h
     Returns total alert count for each compliance framework.
  ────────────────────────────────────────────────────────────────────────── */
  router.get(
    {
      path:     '/api/compliance_view/summary',
      validate: {
        query: schema.object({
          time_range: schema.string({ defaultValue: '24h' }),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const gte = timeRangeToGte(request.query.time_range);

        // Build one filter aggregation per framework inside a single query.
        const aggs = {};
        for (const key of FRAMEWORK_KEYS) {
          aggs[key] = { filter: frameworkFilter(key) };
        }

        const result = await osRequest(`/${OS_INDEX}/_search`, {
          size: 0,
          query: { range: { '@timestamp': { gte } } },
          aggs,
        });

        const frameworks = {};
        for (const key of FRAMEWORK_KEYS) {
          frameworks[key] = {
            label: FRAMEWORKS[key].label,
            count: (result.aggregations && result.aggregations[key])
              ? result.aggregations[key].doc_count
              : 0,
          };
        }

        return response.ok({ body: { frameworks, total: result.hits && result.hits.total && result.hits.total.value || 0 } });
      } catch (err) {
        logger && logger.error('complianceView: summary route error — ' + err.message);
        return response.custom({ statusCode: 500, body: { error: err.message } });
      }
    }
  );

  /* ──────────────────────────────────────────────────────────────────────────
     GET /api/compliance_view/details?framework=pci_dss&time_range=24h
     Returns section-level breakdown for a single framework.
  ────────────────────────────────────────────────────────────────────────── */
  router.get(
    {
      path:     '/api/compliance_view/details',
      validate: {
        query: schema.object({
          framework:  schema.string({ defaultValue: 'pci_dss' }),
          time_range: schema.string({ defaultValue: '24h' }),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const { framework, time_range } = request.query;
        const gte = timeRangeToGte(time_range);

        if (!FRAMEWORKS[framework]) {
          return response.custom({ statusCode: 400, body: { error: 'Unknown framework: ' + framework } });
        }

        const fw = FRAMEWORKS[framework];

        // For PECA: terms on rule.groups filtered to peca_.* pattern.
        // For others: terms on the framework field (which is an array in the index).
        let termsField, termsInclude;
        if (fw.type === 'term') {
          termsField   = 'rule.groups';
          termsInclude = 'peca_.*';
        } else {
          termsField   = fw.field;
          termsInclude = undefined;
        }

        const termsAgg = { field: termsField, size: 200 };
        if (termsInclude) termsAgg.include = termsInclude;

        const query = {
          bool: {
            must: [
              { range: { '@timestamp': { gte } } },
              frameworkFilter(framework),
            ],
          },
        };

        const result = await osRequest(`/${OS_INDEX}/_search`, {
          size: 0,
          query,
          aggs: {
            sections: {
              terms: termsAgg,
              aggs: {
                by_severity: {
                  range: {
                    field: 'rule.level',
                    ranges: [
                      { key: 'info',     from: 0,  to: 4  },
                      { key: 'low',      from: 4,  to: 7  },
                      { key: 'medium',   from: 7,  to: 10 },
                      { key: 'high',     from: 10, to: 13 },
                      { key: 'critical', from: 13, to: 20 },
                    ],
                  },
                },
                last_alert: { max: { field: '@timestamp' } },
              },
            },
          },
        });

        const buckets = (result.aggregations && result.aggregations.sections && result.aggregations.sections.buckets) || [];

        const sections = buckets.map(function(b) {
          const sev = {};
          if (b.by_severity && b.by_severity.buckets) {
            b.by_severity.buckets.forEach(function(s) { sev[s.key] = s.doc_count; });
          }
          const entry = {
            key:        b.key,
            count:      b.doc_count,
            severity:   {
              info:     sev.info     || 0,
              low:      sev.low      || 0,
              medium:   sev.medium   || 0,
              high:     sev.high     || 0,
              critical: sev.critical || 0,
            },
            last_alert: b.last_alert && b.last_alert.value_as_string || null,
          };
          // Attach PECA description if available.
          if (framework === 'peca' && PECA_SECTION_DESC[b.key]) {
            entry.description = PECA_SECTION_DESC[b.key];
          }
          return entry;
        });

        return response.ok({ body: { framework, sections } });
      } catch (err) {
        logger && logger.error('complianceView: details route error — ' + err.message);
        return response.custom({ statusCode: 500, body: { error: err.message } });
      }
    }
  );

  /* ──────────────────────────────────────────────────────────────────────────
     GET /api/compliance_view/overlap?time_range=24h
     Returns cross-framework co-occurrence matrix.
     matrix[A][B] = number of alerts that triggered both framework A and B.
  ────────────────────────────────────────────────────────────────────────── */
  router.get(
    {
      path:     '/api/compliance_view/overlap',
      validate: {
        query: schema.object({
          time_range: schema.string({ defaultValue: '24h' }),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const gte = timeRangeToGte(request.query.time_range);

        // Build a nested aggregation: for each framework, count how many of
        // those alerts also appear in each other framework.
        const aggs = {};
        for (const outerKey of FRAMEWORK_KEYS) {
          const innerAggs = {};
          for (const innerKey of FRAMEWORK_KEYS) {
            if (innerKey !== outerKey) {
              innerAggs[innerKey] = { filter: frameworkFilter(innerKey) };
            }
          }
          aggs[outerKey] = {
            filter: frameworkFilter(outerKey),
            aggs:   innerAggs,
          };
        }

        const result = await osRequest(`/${OS_INDEX}/_search`, {
          size: 0,
          query: { range: { '@timestamp': { gte } } },
          aggs,
        });

        // Assemble the matrix.
        const matrix = {};
        for (const outerKey of FRAMEWORK_KEYS) {
          matrix[outerKey] = {};
          const outerBucket = result.aggregations && result.aggregations[outerKey];
          if (!outerBucket) continue;
          for (const innerKey of FRAMEWORK_KEYS) {
            if (innerKey === outerKey) {
              matrix[outerKey][innerKey] = outerBucket.doc_count || 0;
            } else {
              matrix[outerKey][innerKey] = (outerBucket[innerKey] && outerBucket[innerKey].doc_count) || 0;
            }
          }
        }

        return response.ok({ body: { matrix, frameworks: FRAMEWORK_KEYS } });
      } catch (err) {
        logger && logger.error('complianceView: overlap route error — ' + err.message);
        return response.custom({ statusCode: 500, body: { error: err.message } });
      }
    }
  );
}
