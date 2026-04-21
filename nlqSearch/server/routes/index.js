'use strict';

/**
 * server/routes/index.js — NLQ Search API routes
 *
 * Registers two POST endpoints:
 *
 *   POST /api/nlq_search/translate
 *     Body:    { query: string, backend?: 'gemini'|'ollama' }
 *     Returns: { ir, wazuh_query, correction_rounds, error? }
 *
 *   POST /api/nlq_search/execute
 *     Body:    { wazuh_query: object, index?: string }
 *     Returns: { hits: [...], total: number }
 *
 * The translate route implements the full Sec-IR pipeline:
 *   plain English → time-range pre-processor → LLM call → validate →
 *   self-correction (up to 2 rounds) → Wazuh DSL transpile
 *
 * The execute route queries the Wazuh Indexer (OpenSearch) directly over HTTPS.
 */

Object.defineProperty(exports, '__esModule', { value: true });
exports.defineRoutes = defineRoutes;

const https          = require('https');
const { schema }     = require('@osd/config-schema');
const { callLLM }    = require('../llm_backends/index');
const { validate }   = require('../lib/validator');
const { transpile }  = require('../lib/transpiler');

// ── Config ────────────────────────────────────────────────────────────────────

const MAX_RETRIES     = 2;     // Schema correction rounds after initial call
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY  || '';
const NLQ_BACKEND     = process.env.NLQ_BACKEND     || (GEMINI_API_KEY ? 'gemini' : 'ollama');
const GEMINI_MODEL    = process.env.GEMINI_MODEL    || 'gemini-2.5-flash';
const OLLAMA_HOST     = process.env.OLLAMA_HOST     || 'http://localhost:11434';
const OLLAMA_MODEL    = process.env.OLLAMA_MODEL    || 'phi3.5';

// Wazuh Indexer (OpenSearch) connection
const INDEXER_HOST     = process.env.INDEXER_HOST     || 'localhost';
const INDEXER_PORT     = parseInt(process.env.INDEXER_PORT || '9200', 10);
const INDEXER_USER     = process.env.INDEXER_USER     || 'admin';
const INDEXER_PASSWORD = process.env.INDEXER_PASSWORD || '';
const DEFAULT_INDEX    = 'wazuh-alerts-*';

const indexerAgent = new https.Agent({ rejectUnauthorized: false });

// ── System prompt (exact content from sec-ir/parser.py) ───────────────────────

const SCHEMA_SUMMARY = `\
Produce a JSON object that strictly follows this structure:

{
  "sec_ir_version": "1.0",          // always exactly "1.0"
  "event_type": <string>,           // one of the 10 values listed below
  "pattern": <string>,              // one of: single_event | repeated_attempts | spike | sequence | absence
  "entity": { <key>: <string> },    // zero or more of: user, user_role, src_ip, host, process
  "severity": <string>,             // one of: info | low | medium | high | critical | any
  "time_range": <object>,           // see formats below
  "aggregation": <object|null>,     // required if pattern is repeated_attempts or spike
  "correlation": <object|null>      // required if pattern is sequence
}

event_type values:
  authentication_failure, privilege_escalation,
  lateral_movement, port_scan,
  process_injection, file_deletion,
  malware_alert, ransomware_behavior,
  policy_violation, data_exfiltration

event_type disambiguation (read carefully — these are the most common confusions):

- privilege_escalation: Use when the query names a WINDOWS PRIVILEGE ESCALATION
  TECHNIQUE. Examples: ntdsutil, vssadmin IFM, DCSync, AD replication from a
  non-DC, Kerberos ticket anomalies (Golden/Silver Ticket, long TGT lifetime),
  UAC bypass (fodhelper, computerdefaults, sdclt), WMI event subscriptions for
  persistence, schtasks creating new tasks, new Windows services pointing at
  binaries in temp/user dirs, SeDebugPrivilege being granted, LSASS memory
  access, token manipulation. These are NOT policy_violation — a "policy
  violation" is an administrative rule breach (unapproved software install,
  config drift), not an attacker technique.

- ransomware_behavior: Use when shadow copies are being deleted (vssadmin
  delete shadows, wmic shadowcopy delete, bcdedit disabling recovery), mass
  file encryption is detected, or rapid large-scale file modification is
  observed. This is NOT file_deletion even though files are being removed —
  vssadmin deleting shadows is a ransomware pre-encryption TTP, not routine
  file cleanup.

- malware_alert: Use when the query asks about a KNOWN MALWARE DETECTION
  PATTERN: threat-intel / IOC matches, contact with known malicious IPs or
  C2 domains, AV signature hits, LOLBins used suspiciously (regsvr32 or
  rundll32 loading unusual DLLs, mshta running remote content), Office
  applications spawning cmd/powershell/wscript (macro malware), suspicious
  parent-child process chains, clipboard scrapers. This is NOT
  process_injection (a specific technique — code written into another
  process's memory space), and NOT data_exfiltration (which requires data
  actually leaving the environment).

- process_injection: Use ONLY for explicit in-memory injection techniques:
  CreateRemoteThread, reflective DLL loading, process hollowing, APC injection,
  AtomBombing, SetWindowsHookEx. A parent spawning a child process is NOT
  process injection.

- policy_violation: Use for administrative / compliance rule breaches:
  unauthorized software, config drift, unapproved access from outside business
  hours, impossible-travel logins, unencrypted data transfers, violated DLP
  rules. This is the right answer only when no specific attacker TTP fits.

time_range formats:
  Relative: {"type": "relative", "value": "last_24h"}
    Allowed values: last_1h | last_6h | last_12h | last_24h | last_7d | last_30d | last_90d
  Absolute: {"type": "absolute", "start": "<ISO8601>", "end": "<ISO8601>"}

aggregation (use when pattern is repeated_attempts or spike):
  {"threshold": <int ≥ 1>, "group_by": [<one or more of: user, src_ip, host, process>]}

correlation (use when pattern is sequence):
  {
    "events": [
      {"event_type": "<event_type>"},
      {"event_type": "<event_type>"}
    ],
    "maxspan": "<number><s|m|h|d>"   // e.g. "10m", "1h"
  }

Rules:
- Set aggregation to null when pattern is single_event, sequence, or absence.
- Set correlation to null unless pattern is sequence.
- For repeated_attempts / spike, group_by must only use field names that are
  also present in the entity object.
- When no time range is mentioned, default to last_24h.

Pattern selection rules (apply carefully):
- Use sequence when the query describes TWO DISTINCT EVENTS that must occur IN
  ORDER by the same actor — e.g. "failed logins followed by a successful login",
  "recon then exploit", "login then data export". Populate the correlation block
  with both event_types and a maxspan. Do NOT use repeated_attempts for these —
  repeated_attempts is only for the same event happening many times.
- Use repeated_attempts when the SAME event type recurs above a threshold (e.g.
  "more than 5 failed logins", "10 port scan attempts").
- Use spike when the count is anomalously high relative to baseline (e.g.
  "unusual spike", "much faster than normal", "abnormal volume").
- Use absence when the query asks whether something did NOT happen.

Severity inference rules (apply in order — use the HIGHEST matching level):
  critical : ransomware, data exfiltration, active intrusion, credential dumping
             (e.g. Mimikatz), lateral movement combined with privilege escalation,
             multi-stage attack sequences
  high     : brute force / repeated login failures, privilege escalation,
             lateral movement, malware detection, process injection, any active
             attack pattern that is not yet confirmed critical
  medium   : port scan / reconnaissance, single policy violation, suspicious
             process execution, file deletion without other indicators
  low      : single failed login (isolated, not repeated), minor audit finding,
             informational policy check
  info     : absence queries (confirming something did NOT happen), audit trails,
             purely informational lookups with no threat indicator
  any      : ONLY when the query contains no severity context whatsoever and none
             of the above rules produce a clear answer. Do NOT use "any" just
             because the query does not explicitly name a severity — infer from
             the event type and pattern instead.
`;

const FEW_SHOT = `\
Examples:

Query: "Alert me on any admin login failures in the last 24 hours"
{
  "sec_ir_version": "1.0",
  "event_type": "authentication_failure",
  "pattern": "single_event",
  "entity": {"user_role": "admin"},
  "severity": "high",
  "time_range": {"type": "relative", "value": "last_24h"},
  "aggregation": null,
  "correlation": null
}

Query: "Find accounts that failed to log in more than 5 times from the same IP in 24 hours"
{
  "sec_ir_version": "1.0",
  "event_type": "authentication_failure",
  "pattern": "repeated_attempts",
  "entity": {"user": "*", "src_ip": "*"},
  "severity": "high",
  "time_range": {"type": "relative", "value": "last_24h"},
  "aggregation": {"threshold": 5, "group_by": ["user", "src_ip"]},
  "correlation": null
}

Query: "Detect a failed login immediately followed by privilege escalation by the same user within 10 minutes"
{
  "sec_ir_version": "1.0",
  "event_type": "privilege_escalation",
  "pattern": "sequence",
  "entity": {"user": "*"},
  "severity": "critical",
  "time_range": {"type": "relative", "value": "last_24h"},
  "aggregation": null,
  "correlation": {
    "events": [
      {"event_type": "authentication_failure"},
      {"event_type": "privilege_escalation"}
    ],
    "maxspan": "10m"
  }
}

Query: "Alert when a non-DC machine sends Active Directory replication requests in the last 12 hours"
{
  "sec_ir_version": "1.0",
  "event_type": "privilege_escalation",
  "pattern": "single_event",
  "entity": {"host": "*"},
  "severity": "high",
  "time_range": {"type": "relative", "value": "last_12h"},
  "aggregation": null,
  "correlation": null
}

Query: "Detect when vssadmin is used to delete volume shadow copies on any host"
{
  "sec_ir_version": "1.0",
  "event_type": "ransomware_behavior",
  "pattern": "single_event",
  "entity": {"host": "*"},
  "severity": "critical",
  "time_range": {"type": "relative", "value": "last_24h"},
  "aggregation": null,
  "correlation": null
}

Query: "Alert when any host contacts known C2 domains from the threat intel feed in the last 6 hours"
{
  "sec_ir_version": "1.0",
  "event_type": "malware_alert",
  "pattern": "single_event",
  "entity": {"host": "*"},
  "severity": "high",
  "time_range": {"type": "relative", "value": "last_6h"},
  "aggregation": null,
  "correlation": null
}

Query: "Detect a user who has multiple failed logins followed by a successful login within 5 minutes"
{
  "sec_ir_version": "1.0",
  "event_type": "authentication_failure",
  "pattern": "sequence",
  "entity": {"user": "*", "src_ip": "*"},
  "severity": "high",
  "time_range": {"type": "relative", "value": "last_24h"},
  "aggregation": null,
  "correlation": {
    "events": [
      {"event_type": "authentication_failure"},
      {"event_type": "authentication_failure"},
      {"event_type": "authentication_failure"}
    ],
    "maxspan": "5m"
  }
}
`;

const SYSTEM_PROMPT = `\
You are a security-query IR generator. Given a plain-English security query
from a SOC analyst, you output ONLY a JSON object — no explanation, no markdown
fences, no extra text.

If the input is NOT a security detection query (e.g. greetings, general questions,
requests for explanations, nonsense), output exactly this and nothing else:
{"error": "not_a_security_query"}

${SCHEMA_SUMMARY}

${FEW_SHOT}
`;

// ── Time-range pre-processor ──────────────────────────────────────────────────
// Mirrors sec-ir/parser.py _extract_time_range and _inject_time_hint exactly.

const TR_UNIT_TO_HOURS = {
  minute: 1/60, min: 1/60,
  hour:   1,    hr:  1,
  day:    24,
  week:   168,
  month:  720,
};

const TR_CANONICAL = [
  [1,    'last_1h'],
  [6,    'last_6h'],
  [12,   'last_12h'],
  [24,   'last_24h'],
  [168,  'last_7d'],
  [720,  'last_30d'],
  [2160, 'last_90d'],
];

const TR_PATTERN = new RegExp(
  '(?:' +
  '(?:in\\s+)?the\\s+last\\s+' +
  '|past\\s+' +
  '|within\\s+the\\s+last\\s+' +
  '|over\\s+(?:the\\s+)?(?:last\\s+)?' +
  '|for\\s+(?:more\\s+than\\s+)?' +
  '|more\\s+than\\s+' +
  '|longer\\s+than\\s+' +
  '|exceeds?\\s+' +
  ')' +
  '(\\d+(?:\\.\\d+)?)\\s*' +
  '(minute|min|hour|hr|day|week|month)s?',
  'i'
);

function extractTimeRange(query) {
  const m = query.match(TR_PATTERN);
  if (!m) return null;
  const amount = parseFloat(m[1]);
  const unit   = m[2].toLowerCase().replace(/s$/, '');
  const hours  = amount * (TR_UNIT_TO_HOURS[unit] || 1);
  for (const [threshold, label] of TR_CANONICAL) {
    if (threshold >= hours - 1e-9) return label;
  }
  return TR_CANONICAL[TR_CANONICAL.length - 1][1];
}

function injectTimeHint(query) {
  const canonical = extractTimeRange(query);
  if (!canonical) return query;
  return `[DETECTED TIME WINDOW: use time_range value "${canonical}" exactly]\n${query}`;
}

// ── Correction prompt ─────────────────────────────────────────────────────────

function buildCorrectionPrompt(query, badJson, errors) {
  const errorLines = errors.map(e => `  [${e.field}] ${e.message}`).join('\n');
  return (
    `The previous output for the query below had schema validation errors.\n` +
    `Fix ONLY the listed fields and return the corrected JSON with no other text.\n\n` +
    `Original query: ${query}\n\n` +
    `Previous JSON:\n${badJson}\n\n` +
    `Errors:\n${errorLines}`
  );
}

// ── OpenSearch query helper ───────────────────────────────────────────────────

function indexerRequest(method, path, reqBody, logger) {
  return new Promise(function(resolve, reject) {
    const bodyStr = reqBody ? JSON.stringify(reqBody) : null;
    const creds   = Buffer.from(`${INDEXER_USER}:${INDEXER_PASSWORD}`).toString('base64');

    const options = {
      hostname: INDEXER_HOST,
      port:     INDEXER_PORT,
      path:     path,
      method:   method,
      agent:    indexerAgent,
      headers:  Object.assign(
        {
          'Content-Type':  'application/json',
          'Authorization': 'Basic ' + creds,
        },
        bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}
      ),
    };

    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          resolve(JSON.parse(data));
        } catch (_) {
          resolve(data);
        }
      });
    });

    req.on('error', function(err) {
      logger && logger.error('nlqSearch: indexer request error – ' + err.message);
      reject(err);
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Route definitions ─────────────────────────────────────────────────────────

function defineRoutes(router, logger) {

  /* ── POST /api/nlq_search/translate ──────────────────────────────────────────
     Receives a plain-English query, runs the full Sec-IR pipeline, and returns
     both the IR and the generated Wazuh DSL query.
  ──────────────────────────────────────────────────────────────────────────── */
  router.post(
    {
      path:     '/api/nlq_search/translate',
      validate: {
        body: schema.object({
          query:   schema.string(),
          backend: schema.maybe(schema.string()),
        }),
      },
    },
    async (context, request, response) => {
      const { query, backend } = request.body;

      // Pick backend config
      const chosenBackend = backend || NLQ_BACKEND;
      const llmConfig = {
        backend:   chosenBackend,
        apiKey:    GEMINI_API_KEY,
        model:     chosenBackend === 'ollama' ? OLLAMA_MODEL : GEMINI_MODEL,
        ollamaUrl: OLLAMA_HOST,
      };

      logger && logger.debug(`nlqSearch: translate request backend="${chosenBackend}" query="${query.substring(0, 80)}"`);

      // Deterministic time-range pre-processor (before LLM call)
      const augmentedQuery = injectTimeHint(query);

      let rawJson    = null;
      let ir         = null;
      let errors     = [];
      let corrRounds = 0;

      try {
        // Initial LLM call
        rawJson = await callLLM(SYSTEM_PROMPT, augmentedQuery, llmConfig);

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          // Parse
          try {
            ir = JSON.parse(rawJson);
          } catch (parseErr) {
            errors = [{ field: '<root>', message: `Invalid JSON: ${parseErr.message}` }];
            break;
          }

          // Check for the LLM's "not a security query" sentinel
          if (ir && ir.error === 'not_a_security_query') {
            return response.ok({
              body: {
                ir:                null,
                wazuh_query:       null,
                correction_rounds: corrRounds,
                error:             'not_a_security_query',
                message:           'The input does not appear to be a security detection query.',
              },
            });
          }

          // Validate
          errors = validate(ir);
          if (errors.length === 0) break;

          // Retry with correction prompt if we have attempts left
          if (attempt < MAX_RETRIES) {
            const correctionPrompt = buildCorrectionPrompt(augmentedQuery, rawJson, errors);
            rawJson = await callLLM(SYSTEM_PROMPT, correctionPrompt, llmConfig);
            corrRounds++;
          }
        }
      } catch (llmErr) {
        logger && logger.error('nlqSearch: LLM call failed – ' + llmErr.message);
        return response.custom({
          statusCode: 502,
          body: { error: 'llm_error', message: llmErr.message },
        });
      }

      // If still invalid after all retries, return the partial IR + errors
      if (errors.length > 0) {
        return response.ok({
          body: {
            ir:                ir,
            wazuh_query:       null,
            correction_rounds: corrRounds,
            validation_errors: errors,
            error:             'validation_failed',
            message:           `IR failed validation after ${corrRounds} correction round(s).`,
          },
        });
      }

      // Transpile to Wazuh DSL
      let wazuhQuery;
      try {
        wazuhQuery = transpile(ir);
      } catch (transpileErr) {
        logger && logger.error('nlqSearch: transpile failed – ' + transpileErr.message);
        return response.custom({
          statusCode: 500,
          body: { error: 'transpile_error', message: transpileErr.message },
        });
      }

      logger && logger.debug(`nlqSearch: translate success correction_rounds=${corrRounds}`);

      return response.ok({
        body: {
          ir,
          wazuh_query:       wazuhQuery,
          correction_rounds: corrRounds,
        },
      });
    }
  );

  /* ── POST /api/nlq_search/execute ────────────────────────────────────────────
     Receives a Wazuh DSL query object and runs it against the Wazuh Indexer.
     Returns up to 100 matching alert hits.
  ──────────────────────────────────────────────────────────────────────────── */
  router.post(
    {
      path:     '/api/nlq_search/execute',
      validate: {
        body: schema.object({
          wazuh_query: schema.object({}, { unknowns: 'allow' }),
          index:       schema.maybe(schema.string()),
        }),
      },
    },
    async (context, request, response) => {
      const { wazuh_query, index } = request.body;
      const targetIndex = index || DEFAULT_INDEX;

      // Build the search request body — add size and sort; strip _meta/_min_doc_count
      const searchBody = Object.assign({}, wazuh_query, {
        size: 100,
        sort: [{ '@timestamp': { order: 'desc' } }],
        _source: [
          '@timestamp',
          'agent.id',
          'agent.name',
          'rule.id',
          'rule.level',
          'rule.description',
          'rule.groups',
          'data.srcip',
          'data.dstip',
        ],
      });
      // Remove non-DSL fields that would cause OpenSearch to reject the query
      delete searchBody._meta;
      delete searchBody.min_doc_count;

      logger && logger.debug(`nlqSearch: execute against index "${targetIndex}"`);

      try {
        const path   = `/${encodeURIComponent(targetIndex)}/_search`;
        const result = await indexerRequest('POST', path, searchBody, logger);

        const hits  = (result.hits && result.hits.hits)  || [];
        const total = (result.hits && result.hits.total && result.hits.total.value) ||
                      (result.hits && result.hits.total) ||
                      hits.length;

        return response.ok({
          body: {
            hits,
            total,
            index: targetIndex,
          },
        });
      } catch (err) {
        logger && logger.error('nlqSearch: execute error – ' + err.message);
        return response.custom({
          statusCode: 502,
          body: { error: 'indexer_error', message: err.message },
        });
      }
    }
  );

  /* ── POST /api/nlq_search/retranspile ────────────────────────────────────────
     Allows the analyst to edit the IR in the UI and regenerate the DSL without
     making another LLM call.
  ──────────────────────────────────────────────────────────────────────────── */
  router.post(
    {
      path:     '/api/nlq_search/retranspile',
      validate: {
        body: schema.object({
          ir: schema.object({}, { unknowns: 'allow' }),
        }),
      },
    },
    async (context, request, response) => {
      const { ir } = request.body;

      const errors = validate(ir);
      if (errors.length > 0) {
        return response.ok({
          body: {
            wazuh_query:       null,
            validation_errors: errors,
            error:             'validation_failed',
          },
        });
      }

      try {
        const wazuhQuery = transpile(ir);
        return response.ok({ body: { wazuh_query: wazuhQuery } });
      } catch (err) {
        return response.custom({
          statusCode: 500,
          body: { error: 'transpile_error', message: err.message },
        });
      }
    }
  );
}
