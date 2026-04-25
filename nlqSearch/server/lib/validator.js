'use strict';

/**
 * server/lib/validator.js — Manual Sec-IR schema validator (no external deps)
 *
 * Mirrors the behaviour of sec-ir/validator.py: returns an array of
 * { field, message } error objects, or an empty array when the IR is valid.
 *
 * Why manual instead of ajv?
 *   The server bundle runs inside OSD's Node.js process which has strict module
 *   loading.  A manual validator keeps the dependency footprint at zero and
 *   avoids any version-conflict risk with OSD's own ajv copy.
 */

const VALID_EVENT_TYPES = new Set([
  'authentication_failure',
  'privilege_escalation',
  'lateral_movement',
  'port_scan',
  'process_injection',
  'file_deletion',
  'malware_alert',
  'ransomware_behavior',
  'policy_violation',
  'data_exfiltration',
]);

const VALID_PATTERNS = new Set([
  'single_event',
  'repeated_attempts',
  'spike',
  'sequence',
  'absence',
]);

const VALID_SEVERITIES = new Set([
  'info', 'low', 'medium', 'high', 'critical', 'any',
]);

const VALID_TIME_RELATIVE = new Set([
  'last_1h', 'last_6h', 'last_12h', 'last_24h',
  'last_7d', 'last_30d', 'last_90d',
]);

const VALID_ENTITY_KEYS = new Set([
  'user', 'user_role', 'src_ip', 'host', 'process', 'process_path', 'command_line',
]);

const VALID_GROUP_BY = new Set(['user', 'src_ip', 'host', 'process']);

const VALID_MAXSPAN = /^[0-9]+(s|m|h|d)$/;

/**
 * Validate a Sec-IR object and return field-level errors.
 *
 * @param {object} ir  Parsed JSON object from the LLM.
 * @returns {{ field: string, message: string }[]}
 */
function validate(ir) {
  const errors = [];

  if (!ir || typeof ir !== 'object' || Array.isArray(ir)) {
    errors.push({ field: '<root>', message: 'IR must be a JSON object' });
    return errors;
  }

  // ── Required top-level fields ────────────────────────────────────────────────
  const required = ['sec_ir_version', 'event_type', 'pattern', 'entity', 'severity', 'time_range'];
  for (const f of required) {
    if (!(f in ir)) {
      errors.push({ field: f, message: `Required field "${f}" is missing` });
    }
  }

  // ── sec_ir_version ───────────────────────────────────────────────────────────
  if ('sec_ir_version' in ir && ir.sec_ir_version !== '1.0') {
    errors.push({ field: 'sec_ir_version', message: `Must be "1.0", got "${ir.sec_ir_version}"` });
  }

  // ── event_type ───────────────────────────────────────────────────────────────
  if ('event_type' in ir && !VALID_EVENT_TYPES.has(ir.event_type)) {
    errors.push({ field: 'event_type', message: `"${ir.event_type}" is not a valid event_type` });
  }

  // ── pattern ──────────────────────────────────────────────────────────────────
  if ('pattern' in ir && !VALID_PATTERNS.has(ir.pattern)) {
    errors.push({ field: 'pattern', message: `"${ir.pattern}" is not a valid pattern` });
  }

  // ── severity ─────────────────────────────────────────────────────────────────
  if ('severity' in ir && !VALID_SEVERITIES.has(ir.severity)) {
    errors.push({ field: 'severity', message: `"${ir.severity}" is not a valid severity` });
  }

  // ── entity ───────────────────────────────────────────────────────────────────
  if ('entity' in ir) {
    if (typeof ir.entity !== 'object' || ir.entity === null || Array.isArray(ir.entity)) {
      errors.push({ field: 'entity', message: 'entity must be an object' });
    } else {
      for (const k of Object.keys(ir.entity)) {
        if (!VALID_ENTITY_KEYS.has(k)) {
          errors.push({ field: `entity.${k}`, message: `"${k}" is not a valid entity key` });
        } else if (typeof ir.entity[k] !== 'string') {
          errors.push({ field: `entity.${k}`, message: `entity.${k} must be a string` });
        }
      }
    }
  }

  // ── time_range ───────────────────────────────────────────────────────────────
  if ('time_range' in ir) {
    const tr = ir.time_range;
    if (typeof tr !== 'object' || tr === null || Array.isArray(tr)) {
      errors.push({ field: 'time_range', message: 'time_range must be an object' });
    } else if (!('type' in tr)) {
      errors.push({ field: 'time_range.type', message: 'time_range.type is required' });
    } else if (tr.type === 'relative') {
      if (!('value' in tr)) {
        errors.push({ field: 'time_range.value', message: 'time_range.value is required for relative type' });
      } else if (!VALID_TIME_RELATIVE.has(tr.value)) {
        errors.push({ field: 'time_range.value', message: `"${tr.value}" is not a valid relative time value` });
      }
    } else if (tr.type === 'absolute') {
      if (!('start' in tr)) {
        errors.push({ field: 'time_range.start', message: 'time_range.start is required for absolute type' });
      }
      if (!('end' in tr)) {
        errors.push({ field: 'time_range.end', message: 'time_range.end is required for absolute type' });
      }
      if (tr.start && isNaN(Date.parse(tr.start))) {
        errors.push({ field: 'time_range.start', message: `"${tr.start}" is not a valid ISO 8601 date-time` });
      }
      if (tr.end && isNaN(Date.parse(tr.end))) {
        errors.push({ field: 'time_range.end', message: `"${tr.end}" is not a valid ISO 8601 date-time` });
      }
    } else {
      errors.push({ field: 'time_range.type', message: `"${tr.type}" must be "relative" or "absolute"` });
    }
  }

  // ── aggregation ──────────────────────────────────────────────────────────────
  if ('aggregation' in ir && ir.aggregation !== null) {
    const agg = ir.aggregation;
    if (typeof agg !== 'object' || Array.isArray(agg)) {
      errors.push({ field: 'aggregation', message: 'aggregation must be an object or null' });
    } else {
      if (!('threshold' in agg)) {
        errors.push({ field: 'aggregation.threshold', message: 'aggregation.threshold is required' });
      } else if (!Number.isInteger(agg.threshold) || agg.threshold < 1) {
        errors.push({ field: 'aggregation.threshold', message: 'aggregation.threshold must be an integer ≥ 1' });
      }
      if (!('group_by' in agg)) {
        errors.push({ field: 'aggregation.group_by', message: 'aggregation.group_by is required' });
      } else if (!Array.isArray(agg.group_by) || agg.group_by.length < 1) {
        errors.push({ field: 'aggregation.group_by', message: 'aggregation.group_by must be a non-empty array' });
      } else {
        for (const f of agg.group_by) {
          if (!VALID_GROUP_BY.has(f)) {
            errors.push({ field: 'aggregation.group_by', message: `"${f}" is not a valid group_by field` });
          }
        }
        const unique = new Set(agg.group_by);
        if (unique.size !== agg.group_by.length) {
          errors.push({ field: 'aggregation.group_by', message: 'group_by must contain unique items' });
        }
      }
    }
  }

  // ── correlation ──────────────────────────────────────────────────────────────
  if ('correlation' in ir && ir.correlation !== null) {
    const corr = ir.correlation;
    if (typeof corr !== 'object' || Array.isArray(corr)) {
      errors.push({ field: 'correlation', message: 'correlation must be an object or null' });
    } else {
      if (!('events' in corr)) {
        errors.push({ field: 'correlation.events', message: 'correlation.events is required' });
      } else if (!Array.isArray(corr.events) || corr.events.length < 2) {
        errors.push({ field: 'correlation.events', message: 'correlation.events must be an array with ≥ 2 items' });
      } else {
        corr.events.forEach(function(ev, i) {
          if (typeof ev !== 'object' || ev === null || !('event_type' in ev)) {
            errors.push({ field: `correlation.events[${i}]`, message: 'Each event must have an event_type field' });
          }
        });
      }
      if (!('maxspan' in corr)) {
        errors.push({ field: 'correlation.maxspan', message: 'correlation.maxspan is required' });
      } else if (!VALID_MAXSPAN.test(corr.maxspan)) {
        errors.push({ field: 'correlation.maxspan', message: `"${corr.maxspan}" is not a valid maxspan (e.g. "10m", "1h")` });
      }
    }
  }

  // ── Cross-field rules ────────────────────────────────────────────────────────
  const pattern = ir.pattern;
  if (pattern === 'repeated_attempts' || pattern === 'spike') {
    if (!ir.aggregation) {
      errors.push({ field: 'aggregation', message: `aggregation is required when pattern is "${pattern}"` });
    }
  }
  if (pattern === 'sequence') {
    if (!ir.correlation) {
      errors.push({ field: 'correlation', message: 'correlation is required when pattern is "sequence"' });
    }
  }
  if (pattern === 'single_event' || pattern === 'absence') {
    if (ir.aggregation && ir.aggregation !== null) {
      errors.push({ field: 'aggregation', message: `aggregation must be null when pattern is "${pattern}"` });
    }
  }

  return errors;
}

module.exports = { validate };
