'use strict';

/**
 * server/lib/transpiler.js — Deterministic Wazuh DSL transpiler for Sec-IR
 *
 * Faithful JavaScript reimplementation of sec-ir/transpiler/wazuh.py.
 * Converts a validated Sec-IR object to a Wazuh / OpenSearch query DSL object.
 *
 * Entry point: transpile(ir) → plain JS object (not a string)
 */

// ── Field mappings: IR entity key → Wazuh / OpenSearch field name ────────────

const ENTITY_FIELD_MAP = {
  user:      'data.win.eventdata.targetUserName',
  user_role: 'data.win.eventdata.targetUserName',
  src_ip:    'data.srcip',
  host:      'agent.name',
  process:   'data.win.eventdata.processName',
};

// ── Event-type → Wazuh rule.groups value(s) ──────────────────────────────────

const EVENT_TYPE_MAP = {
  authentication_failure: { groups: ['authentication_failed'] },
  privilege_escalation:   { groups: ['privilege_escalation'] },
  lateral_movement:       { groups: ['lateral_movement'] },
  port_scan:              { groups: ['recon', 'port_scan'] },
  process_injection:      { groups: ['process_injection'] },
  file_deletion:          { groups: ['syscheck', 'deleted'] },
  malware_alert:          { groups: ['malware'] },
  ransomware_behavior:    { groups: ['malware', 'ransomware'] },
  policy_violation:       { groups: ['policy_violation'] },
  data_exfiltration:      { groups: ['data_exfiltration'] },
};

// ── Severity → Wazuh rule.level range ────────────────────────────────────────
// Wazuh levels: 1 (lowest) – 15 (highest)

const SEVERITY_LEVEL = {
  info:     [1, 3],
  low:      [4, 6],
  medium:   [7, 9],
  high:     [10, 12],
  critical: [13, 15],
  any:      [1, 15],
};

// ── Time-range helper ─────────────────────────────────────────────────────────

const RELATIVE_OFFSETS = {
  last_1h:  'now-1h',
  last_6h:  'now-6h',
  last_12h: 'now-12h',
  last_24h: 'now-24h',
  last_7d:  'now-7d',
  last_30d: 'now-30d',
  last_90d: 'now-90d',
};

function timeFilter(timeRange) {
  if (timeRange.type === 'relative') {
    const gte = RELATIVE_OFFSETS[timeRange.value] || 'now-24h';
    return { range: { '@timestamp': { gte, lte: 'now' } } };
  }
  return { range: { '@timestamp': { gte: timeRange.start, lte: timeRange.end } } };
}

// ── Filter clause builders ────────────────────────────────────────────────────

function entityFilters(entity) {
  const filters = [];
  for (const [key, value] of Object.entries(entity || {})) {
    if (value === '*' || value === '') continue;
    const field = ENTITY_FIELD_MAP[key];
    if (!field) continue;
    filters.push({ match: { [field]: value } });
  }
  return filters;
}

function eventTypeFilters(eventType) {
  const meta = EVENT_TYPE_MAP[eventType];
  if (!meta) return [];
  return [{ terms: { 'rule.groups': meta.groups } }];
}

function severityFilter(severity) {
  if (severity === 'any') return null;
  const range = SEVERITY_LEVEL[severity];
  if (!range) return null;
  return { range: { 'rule.level': { gte: range[0], lte: range[1] } } };
}

function buildBoolQuery(eventType, entity, timeRange, severity) {
  const must = [];
  must.push(...eventTypeFilters(eventType));
  must.push(...entityFilters(entity));
  must.push(timeFilter(timeRange));
  const sev = severityFilter(severity);
  if (sev) must.push(sev);
  return { query: { bool: { must } } };
}

// ── Pattern-level query builders ──────────────────────────────────────────────

function buildSingleEvent(ir) {
  return buildBoolQuery(ir.event_type, ir.entity, ir.time_range, ir.severity);
}

function buildRepeatedAttempts(ir) {
  const agg = ir.aggregation || {};
  const threshold = agg.threshold || 5;
  const groupBy   = agg.group_by  || [];

  const base = buildBoolQuery(ir.event_type, ir.entity, ir.time_range, ir.severity);

  let aggs = {};
  if (groupBy.length > 0) {
    // Build nested terms aggregations for all group_by fields.
    // The outermost key is the first field; subsequent fields nest inside.
    let inner = { value_count: { field: '_id' } };
    for (let i = groupBy.length - 1; i >= 0; i--) {
      const field     = groupBy[i];
      const wazuhField = ENTITY_FIELD_MAP[field] || field;
      const bucketName = `by_${field}`;
      if (i === groupBy.length - 1) {
        // innermost: no sub-aggs
        inner = { [bucketName]: { terms: { field: wazuhField } } };
      } else {
        inner = { [bucketName]: { terms: { field: wazuhField }, aggs: inner } };
      }
    }
    aggs = inner;
  } else {
    aggs = { total: { value_count: { field: '_id' } } };
  }

  base.aggs = aggs;
  base.min_doc_count = threshold;
  return base;
}

function buildSequence(ir) {
  const correlation = ir.correlation || {};
  const events      = correlation.events || [];
  const maxspan     = correlation.maxspan || '10m';

  const shouldClauses = events.map(function(ev) {
    const evType = ev.event_type || ir.event_type;
    const meta   = EVENT_TYPE_MAP[evType];
    return { terms: { 'rule.groups': meta ? meta.groups : [evType] } };
  });

  const must = [timeFilter(ir.time_range)];
  must.push(...entityFilters(ir.entity));
  const sev = severityFilter(ir.severity);
  if (sev) must.push(sev);

  return {
    query: {
      bool: {
        must,
        should:                shouldClauses,
        minimum_should_match:  1,
      },
    },
    _meta: {
      note: (
        `Wazuh DSL does not support native sequence queries. ` +
        `This query matches all events in the sequence for the same entity. ` +
        `Enforce ordering and maxspan=${maxspan} at the application layer.`
      ),
    },
  };
}

function buildAbsence(ir) {
  const base      = buildBoolQuery(ir.event_type, ir.entity, ir.time_range, ir.severity);
  const innerMust = base.query.bool.must;
  return {
    query: {
      bool: { must_not: innerMust },
    },
  };
}

function buildSpike(ir) {
  const result = buildRepeatedAttempts(ir);
  result._meta = result._meta || {};
  result._meta.note = (
    'Spike detection approximated as a threshold query. ' +
    'True anomaly/spike detection requires Wazuh active-response rules or external alerting.'
  );
  return result;
}

// ── Public entry point ────────────────────────────────────────────────────────

const PATTERN_BUILDERS = {
  single_event:      buildSingleEvent,
  repeated_attempts: buildRepeatedAttempts,
  sequence:          buildSequence,
  absence:           buildAbsence,
  spike:             buildSpike,
};

/**
 * Convert a validated Sec-IR object to a Wazuh DSL query object.
 *
 * @param {object} ir  Validated Sec-IR object.
 * @returns {object}   Wazuh DSL query (plain JS object, not a string).
 * @throws {Error}     If pattern type is unknown.
 */
function transpile(ir) {
  const pattern = ir.pattern;
  const builder = PATTERN_BUILDERS[pattern];
  if (!builder) {
    throw new Error(`Unknown pattern type: "${pattern}"`);
  }
  return builder(ir);
}

module.exports = { transpile };
