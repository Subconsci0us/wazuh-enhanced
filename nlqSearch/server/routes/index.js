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
const GROQ_API_KEY    = process.env.GROQ_API_KEY    || '';
const GROQ_MODEL      = process.env.GROQ_MODEL      || 'llama-3.3-70b-versatile';
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY  || '';
const NLQ_BACKEND     = process.env.NLQ_BACKEND     || (GROQ_API_KEY ? 'groq' : GEMINI_API_KEY ? 'gemini' : 'ollama');
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
  "sec_ir_version": "1.0",
  "event_type": <string>,
  "pattern": <string>,
  "entity": { <key>: <value> },
  "severity": <string>,
  "time_range": <object>,
  "aggregation": <object|null>,
  "correlation": <object|null>
}

── event_type — pick exactly one ──────────────────────────────────────────────

  authentication_failure, privilege_escalation, lateral_movement, port_scan,
  process_injection, file_deletion, malware_alert, ransomware_behavior,
  policy_violation, data_exfiltration

Disambiguation (most-confused pairs):

- privilege_escalation: Windows priv-esc TTPs — ntdsutil, DCSync, AD replication
  from non-DC, Kerberos anomalies (Golden/Silver Ticket), UAC bypass, WMI
  persistence, schtasks adding tasks, new services in user/temp dirs, LSASS
  access, SeDebugPrivilege, token manipulation. NOT policy_violation.

- ransomware_behavior: shadow copy deletion (vssadmin, wmic shadowcopy, bcdedit
  /set recoveryenabled no), mass file encryption, rapid large-scale file
  modification. NOT file_deletion.

- malware_alert: IOC/threat-intel matches, C2 contact, AV hits, LOLBins
  (regsvr32/rundll32/mshta loading remote content), Office spawning
  cmd/powershell (macro malware), suspicious parent-child process chains.
  ALSO: any process whose IMAGE PATH is a non-standard location —
  Temp, AppData, Downloads, ProgramData, Users\\Public, Roaming — is a
  suspicious execution indicator → malware_alert. NOT policy_violation.
  NOT process_injection (in-memory injection only).

- process_injection: explicit in-memory injection only — CreateRemoteThread,
  reflective DLL, process hollowing, APC injection, AtomBombing,
  SetWindowsHookEx. A parent spawning a child is NOT injection.

- policy_violation: administrative/compliance breaches — unauthorized software
  installs, config drift, out-of-hours access, impossible-travel logins,
  unencrypted transfers, DLP violations. Only when no attacker TTP fits.

── entity — FILTER criteria only ──────────────────────────────────────────────

  CRITICAL: "include X", "show X", "return X", "display the command line",
  "with timestamp", "along with the username" — these are OUTPUT field requests,
  NOT filter criteria. Do NOT add entity entries for them. The system always
  returns all available fields. Only populate entity when the query names a
  specific value or path pattern to FILTER on.

  Allowed keys and their Wazuh field:
    user         → data.win.eventdata.targetUserName  (exact username)
    user_role    → data.win.eventdata.targetUserName  (role/group, e.g. "admin")
    src_ip       → data.srcip
    host         → agent.name
    process      → data.win.eventdata.processName     (exact name, e.g. "cmd.exe")
    process_path → data.win.eventdata.image           (full exe path — use wildcards)
    command_line → data.win.eventdata.commandLine     (full command line — use wildcards)

  Wildcard syntax (for process_path and command_line):
    "*pattern*"  substring match, e.g. "*\\\\Temp\\\\*", "*\\\\AppData\\\\*", "*powershell*"
    "|" separates OR alternatives, e.g. "*\\\\Temp\\\\*|*\\\\AppData\\\\*"
    "*" alone means any value — omit the key entirely instead of writing "*"

── time_range ──────────────────────────────────────────────────────────────────

  Relative: {"type": "relative", "value": "last_24h"}
    Allowed: last_1h | last_6h | last_12h | last_24h | last_7d | last_30d | last_90d
  Absolute: {"type": "absolute", "start": "<ISO8601>", "end": "<ISO8601>"}

── aggregation (pattern = repeated_attempts or spike) ──────────────────────────

  {"threshold": <int ≥ 1>, "group_by": [<one or more of: user, src_ip, host, process>]}

── correlation (pattern = sequence) ────────────────────────────────────────────

  {"events": [{"event_type": "..."}, {"event_type": "..."}], "maxspan": "10m"}

── Rules ───────────────────────────────────────────────────────────────────────

  - aggregation: null when pattern is single_event, sequence, or absence.
  - correlation: null unless pattern is sequence.
  - group_by fields must also appear in entity.
  - When no time range is stated, default to last_24h.

── Pattern selection ───────────────────────────────────────────────────────────

  sequence          — two DISTINCT events in order by the same actor (login then
                      escalation, recon then exploit). Populate correlation.
                      NOT for same-event repetition.
  repeated_attempts — same event type above a threshold. Populate aggregation.
  spike             — anomalously high volume vs baseline.
  absence           — event did NOT occur.
  single_event      — anything else.

── Severity ────────────────────────────────────────────────────────────────────

  Apply in order — use highest matching:
  critical  ransomware, data exfiltration, active intrusion, credential dumping,
            multi-stage attack sequences
  high      brute force, privilege escalation, lateral movement, malware
            detection, process injection
  medium    port scan, policy violation, suspicious process execution, file
            deletion alone
  low       single isolated failed login, minor audit finding
  info      absence queries, purely informational lookups with no threat indicator
  any       investigative/listing queries without a threat level — "show me all X",
            "list", "find all", "what processes", "which hosts" — when the analyst
            wants visibility across all severity levels and has not framed the
            query as a specific threat detection. Use any when the query is about
            hunting or inventory, not alerting.
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

Query: "Show me all processes launched from temporary directories or AppData. Include the process name, username, full command line, and timestamp."
{
  "sec_ir_version": "1.0",
  "event_type": "malware_alert",
  "pattern": "single_event",
  "entity": {"process_path": "*\\\\Temp\\\\*|*\\\\AppData\\\\*"},
  "severity": "any",
  "time_range": {"type": "relative", "value": "last_24h"},
  "aggregation": null,
  "correlation": null
}

Query: "Find powershell processes launched by Office applications in the last 7 days"
{
  "sec_ir_version": "1.0",
  "event_type": "malware_alert",
  "pattern": "single_event",
  "entity": {"process": "powershell.exe", "command_line": "*winword*|*excel*|*outlook*"},
  "severity": "high",
  "time_range": {"type": "relative", "value": "last_7d"},
  "aggregation": null,
  "correlation": null
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
      const apiKeyForBackend =
        chosenBackend === 'groq'   ? GROQ_API_KEY   :
        chosenBackend === 'gemini' ? GEMINI_API_KEY : '';
      const modelForBackend =
        chosenBackend === 'ollama' ? OLLAMA_MODEL :
        chosenBackend === 'groq'   ? GROQ_MODEL   : GEMINI_MODEL;
      const llmConfig = {
        backend:   chosenBackend,
        apiKey:    apiKeyForBackend,
        model:     modelForBackend,
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
          'data.win.eventdata.image',
          'data.win.eventdata.commandLine',
          'data.win.eventdata.processName',
          'data.win.eventdata.targetUserName',
          'data.win.eventdata.user',
          'data.win.eventdata.parentImage',
          'data.win.eventdata.parentCommandLine',
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
