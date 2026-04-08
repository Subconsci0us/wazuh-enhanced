"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.topPECARequirements = exports.getRulesByRequirement = void 0;
var _baseQuery = require("./base-query");
/*
 * Wazuh app - Specific methods to fetch Wazuh PECA 2016 data from OpenSearch
 * Prevention of Electronic Crimes Act 2016 (Pakistan)
 *
 * PECA rules use rule.groups with values like peca_3, peca_4, peca_6, etc.
 * This queries rule.groups to aggregate by PECA section.
 */

/**
 * Returns top 5 PECA requirements (by section group)
 * @param {*} context Endpoint context
 * @param {Number} gte Timestamp (ms) from
 * @param {Number} lte Timestamp (ms) to
 * @param {String} filters E.g: cluster.name: wazuh AND rule.groups: peca
 * @returns {Array<String>}
 */
const topPECARequirements = async (context, gte, lte, filters, pattern) => {
  try {
    const base = {};
    Object.assign(base, (0, _baseQuery.Base)(pattern, filters, gte, lte));
    // Add filter to only include alerts with peca groups
    base.query.bool.filter.push({
      match_phrase: {
        'rule.groups': {
          query: 'peca'
        }
      }
    });
    Object.assign(base.aggs, {
      '2': {
        terms: {
          field: 'rule.groups',
          size: 10,
          order: {
            _count: 'desc'
          },
          include: 'peca_.*'
        }
      }
    });
    const response = await context.core.opensearch.client.asCurrentUser.search({
      index: pattern,
      body: base
    });
    const {
      buckets
    } = response.body.aggregations['2'];
    return buckets.map(item => item.key).sort((a, b) => {
      const a_num = parseInt((a.split('_')[1] || '0'));
      const b_num = parseInt((b.split('_')[1] || '0'));
      return a_num - b_num;
    });
  } catch (error) {
    return Promise.reject(error);
  }
};

/**
 * Returns top 3 rules for specific PECA requirement
 * @param {*} context Endpoint context
 * @param {Number} gte Timestamp (ms) from
 * @param {Number} lte Timestamp (ms) to
 * @param {String} requirement PECA requirement. E.g: 'peca_3'
 * @param {String} filters E.g: cluster.name: wazuh AND rule.groups: peca
 * @returns {Array<String>}
 */
exports.topPECARequirements = topPECARequirements;
const getRulesByRequirement = async (context, gte, lte, filters, requirement, pattern) => {
  try {
    const base = {};
    Object.assign(base, (0, _baseQuery.Base)(pattern, filters, gte, lte));
    Object.assign(base.aggs, {
      '2': {
        terms: {
          field: 'rule.description',
          size: 3,
          order: {
            _count: 'desc'
          }
        },
        aggs: {
          '3': {
            terms: {
              field: 'rule.id',
              size: 1,
              order: {
                _count: 'desc'
              }
            }
          }
        }
      }
    });
    base.query.bool.filter.push({
      match_phrase: {
        'rule.groups': {
          query: requirement
        }
      }
    });
    const response = await context.core.opensearch.client.asCurrentUser.search({
      index: pattern,
      body: base
    });
    const {
      buckets
    } = response.body.aggregations['2'];
    return buckets.reduce((accum, bucket) => {
      if (!bucket || !bucket['3'] || !bucket['3'].buckets || !bucket['3'].buckets[0] || !bucket['3'].buckets[0].key || !bucket.key) {
        return accum;
      }
      accum.push({
        ruleID: bucket['3'].buckets[0].key,
        ruleDescription: bucket.key
      });
      return accum;
    }, []);
  } catch (error) {
    return Promise.reject(error);
  }
};
exports.getRulesByRequirement = getRulesByRequirement;
