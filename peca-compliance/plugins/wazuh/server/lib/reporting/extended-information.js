"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.buildAgentsTable = buildAgentsTable;
exports.extendedInformation = extendedInformation;
var _summaryTable = _interopRequireDefault(require("./summary-table"));
var _summaryTablesDefinitions = _interopRequireDefault(require("./summary-tables-definitions"));
var VulnerabilityRequest = _interopRequireWildcard(require("./vulnerability-request"));
var OverviewRequest = _interopRequireWildcard(require("./overview-request"));
var RootcheckRequest = _interopRequireWildcard(require("./rootcheck-request"));
var PCIRequest = _interopRequireWildcard(require("./pci-request"));
var GDPRRequest = _interopRequireWildcard(require("./gdpr-request"));
var TSCRequest = _interopRequireWildcard(require("./tsc-request"));
var PECARequest = _interopRequireWildcard(require("./peca-request"));
var AuditRequest = _interopRequireWildcard(require("./audit-request"));
var SyscheckRequest = _interopRequireWildcard(require("./syscheck-request"));
var _pciRequirementsPdfmake = _interopRequireDefault(require("../../integration-files/pci-requirements-pdfmake"));
var _gdprRequirementsPdfmake = _interopRequireDefault(require("../../integration-files/gdpr-requirements-pdfmake"));
var _tscRequirementsPdfmake = _interopRequireDefault(require("../../integration-files/tsc-requirements-pdfmake"));
var _pecaRequirementsPdfmake = _interopRequireDefault(require("../../integration-files/peca-requirements-pdfmake"));
var _moment = _interopRequireDefault(require("moment"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * This build the agents table
 * @param {Array<Strings>} ids ids of agents
 * @param {String} apiId API id
 */
async function buildAgentsTable(context, printer, agentIDs, apiId, groupID = '') {
  const dateFormat = await context.core.uiSettings.client.get('dateFormat');
  if ((!agentIDs || !agentIDs.length) && !groupID) return;
  printer.logger.debug(`${agentIDs.length} agents for API ${apiId}`);
  try {
    let agentsData = [];
    if (groupID) {
      let totalAgentsInGroup = null;
      do {
        const {
          data: {
            data: {
              affected_items,
              total_affected_items
            }
          }
        } = await context.wazuh.api.client.asCurrentUser.request('GET', `/groups/${groupID}/agents`, {
          params: {
            offset: agentsData.length,
            select: 'dateAdd,id,ip,lastKeepAlive,manager,name,os.name,os.version,version'
          }
        }, {
          apiHostID: apiId
        });
        !totalAgentsInGroup && (totalAgentsInGroup = total_affected_items);
        agentsData = [...agentsData, ...affected_items];
      } while (agentsData.length < totalAgentsInGroup);
    } else {
      for (const agentID of agentIDs) {
        try {
          const {
            data: {
              data: {
                affected_items: [agent]
              }
            }
          } = await context.wazuh.api.client.asCurrentUser.request('GET', `/agents`, {
            params: {
              q: `id=${agentID}`,
              select: 'dateAdd,id,ip,lastKeepAlive,manager,name,os.name,os.version,version'
            }
          }, {
            apiHostID: apiId
          });
          agentsData.push(agent);
        } catch (error) {
          printer.logger.debug(`Skip agent due to: ${error.message || error}`);
        }
      }
    }
    if (agentsData.length) {
      // Print a table with agent/s information
      printer.addSimpleTable({
        columns: [{
          id: 'id',
          label: 'ID'
        }, {
          id: 'name',
          label: 'Name'
        }, {
          id: 'ip',
          label: 'IP address'
        }, {
          id: 'version',
          label: 'Version'
        }, {
          id: 'manager',
          label: 'Manager'
        }, {
          id: 'os',
          label: 'Operating system'
        }, {
          id: 'dateAdd',
          label: 'Registration date'
        }, {
          id: 'lastKeepAlive',
          label: 'Last keep alive'
        }],
        items: agentsData.filter(agent => agent) // Remove undefined agents when Wazuh API no longer finds and agentID
        .map(agent => {
          return {
            ...agent,
            os: agent.os && agent.os.name && agent.os.version ? `${agent.os.name} ${agent.os.version}` : '',
            lastKeepAlive: (0, _moment.default)(agent.lastKeepAlive).format(dateFormat),
            dateAdd: (0, _moment.default)(agent.dateAdd).format(dateFormat)
          };
        })
      });
    } else if (!agentsData.length && groupID) {
      // For group reports when there is no agents in the group
      printer.addContent({
        text: 'There are no agents in this group.',
        style: {
          fontSize: 12,
          color: '#000'
        }
      });
    }
  } catch (error) {
    printer.logger.error(error.message || error);
    return Promise.reject(error);
  }
}

/**
 * This load more information
 * @param {*} context Endpoint context
 * @param {*} printer printer instance
 * @param {String} section section target
 * @param {Object} tab tab target
 * @param {String} apiId ID of API
 * @param {Number} from Timestamp (ms) from
 * @param {Number} to Timestamp (ms) to
 * @param {String} filters E.g: cluster.name: wazuh AND rule.groups: vulnerability
 * @param {String} pattern
 * @param {Object} agent agent target
 * @returns {Object} Extended information
 */
async function extendedInformation(context, printer, section, tab, apiId, from, to, filters, pattern, agent = null) {
  try {
    printer.logger.debug(`Section ${section} and tab ${tab}, API is ${apiId}. From ${from} to ${to}. Filters ${JSON.stringify(filters)}. Index pattern ${pattern}`);
    if (section === 'agents' && !agent) {
      throw new Error('Reporting for specific agent needs an agent ID in order to work properly');
    }
    const agents = await context.wazuh.api.client.asCurrentUser.request('GET', '/agents', {
      params: {
        limit: 1
      }
    }, {
      apiHostID: apiId
    });
    const totalAgents = agents.data.data.total_affected_items;

    //--- OVERVIEW - VULS
    if (section === 'overview' && tab === 'vuls') {
      printer.logger.debug('Fetching overview vulnerability detector metrics');
      const vulnerabilitiesLevels = ['Low', 'Medium', 'High', 'Critical'];
      const vulnerabilitiesResponsesCount = (await Promise.all(vulnerabilitiesLevels.map(async vulnerabilitiesLevel => {
        try {
          const count = await VulnerabilityRequest.uniqueSeverityCount(context, from, to, vulnerabilitiesLevel, filters, pattern);
          return count ? `${count} of ${totalAgents} agents have ${vulnerabilitiesLevel.toLocaleLowerCase()} vulnerabilities.` : undefined;
        } catch (error) {}
      }))).filter(vulnerabilitiesResponse => vulnerabilitiesResponse);
      printer.addList({
        title: {
          text: 'Summary',
          style: 'h2'
        },
        list: vulnerabilitiesResponsesCount
      });
      printer.logger.debug('Fetching overview vulnerability detector top 3 agents by category');
      const lowRank = await VulnerabilityRequest.topAgentCount(context, from, to, 'Low', filters, pattern);
      const mediumRank = await VulnerabilityRequest.topAgentCount(context, from, to, 'Medium', filters, pattern);
      const highRank = await VulnerabilityRequest.topAgentCount(context, from, to, 'High', filters, pattern);
      const criticalRank = await VulnerabilityRequest.topAgentCount(context, from, to, 'Critical', filters, pattern);
      printer.logger.debug('Adding overview vulnerability detector top 3 agents by category');
      if (criticalRank && criticalRank.length) {
        printer.addContentWithNewLine({
          text: 'Top 3 agents with critical severity vulnerabilities',
          style: 'h3'
        });
        await buildAgentsTable(context, printer, criticalRank, apiId);
        printer.addNewLine();
      }
      if (highRank && highRank.length) {
        printer.addContentWithNewLine({
          text: 'Top 3 agents with high severity vulnerabilities',
          style: 'h3'
        });
        await buildAgentsTable(context, printer, highRank, apiId);
        printer.addNewLine();
      }
      if (mediumRank && mediumRank.length) {
        printer.addContentWithNewLine({
          text: 'Top 3 agents with medium severity vulnerabilities',
          style: 'h3'
        });
        await buildAgentsTable(context, printer, mediumRank, apiId);
        printer.addNewLine();
      }
      if (lowRank && lowRank.length) {
        printer.addContentWithNewLine({
          text: 'Top 3 agents with low severity vulnerabilities',
          style: 'h3'
        });
        await buildAgentsTable(context, printer, lowRank, apiId);
        printer.addNewLine();
      }
      printer.logger.debug('Fetching overview vulnerability detector top 3 CVEs');
      const cveRank = await VulnerabilityRequest.topCVECount(context, from, to, filters, pattern);
      printer.logger.debug('Adding overview vulnerability detector top 3 CVEs');
      if (cveRank && cveRank.length) {
        printer.addSimpleTable({
          title: {
            text: 'Top 3 CVE',
            style: 'h2'
          },
          columns: [{
            id: 'top',
            label: 'Top'
          }, {
            id: 'cve',
            label: 'CVE'
          }],
          items: cveRank.map(item => ({
            top: cveRank.indexOf(item) + 1,
            cve: item
          }))
        });
      }
    }

    //--- OVERVIEW - GENERAL
    if (section === 'overview' && tab === 'general') {
      printer.logger.debug('Fetching top 3 agents with level 15 alerts');
      const level15Rank = await OverviewRequest.topLevel15(context, from, to, filters, pattern);
      printer.logger.debug('Adding top 3 agents with level 15 alerts');
      if (level15Rank.length) {
        printer.addContent({
          text: 'Top 3 agents with level 15 alerts',
          style: 'h2'
        });
        await buildAgentsTable(context, printer, level15Rank, apiId);
      }
    }

    //--- OVERVIEW - PM
    if (section === 'overview' && tab === 'pm') {
      printer.logger.debug('Fetching most common rootkits');
      const top5RootkitsRank = await RootcheckRequest.top5RootkitsDetected(context, from, to, filters, pattern);
      printer.logger.debug('Adding most common rootkits');
      if (top5RootkitsRank && top5RootkitsRank.length) {
        printer.addContentWithNewLine({
          text: 'Most common rootkits found among your agents',
          style: 'h2'
        }).addContentWithNewLine({
          text: 'Rootkits are a set of software tools that enable an unauthorized user to gain control of a computer system without being detected.',
          style: 'standard'
        }).addSimpleTable({
          items: top5RootkitsRank.map(item => {
            return {
              top: top5RootkitsRank.indexOf(item) + 1,
              name: item
            };
          }),
          columns: [{
            id: 'top',
            label: 'Top'
          }, {
            id: 'name',
            label: 'Rootkit'
          }]
        });
      }
      printer.logger.debug('Fetching hidden pids');
      const hiddenPids = await RootcheckRequest.agentsWithHiddenPids(context, from, to, filters, pattern);
      hiddenPids && printer.addContent({
        text: `${hiddenPids} of ${totalAgents} agents have hidden processes`,
        style: 'h3'
      });
      !hiddenPids && printer.addContentWithNewLine({
        text: `No agents have hidden processes`,
        style: 'h3'
      });
      const hiddenPorts = await RootcheckRequest.agentsWithHiddenPorts(context, from, to, filters, pattern);
      hiddenPorts && printer.addContent({
        text: `${hiddenPorts} of ${totalAgents} agents have hidden ports`,
        style: 'h3'
      });
      !hiddenPorts && printer.addContent({
        text: `No agents have hidden ports`,
        style: 'h3'
      });
      printer.addNewLine();
    }

    //--- OVERVIEW/AGENTS - PCI
    if (['overview', 'agents'].includes(section) && tab === 'pci') {
      printer.logger.debug('Fetching top PCI DSS requirements');
      const topPciRequirements = await PCIRequest.topPCIRequirements(context, from, to, filters, pattern);
      printer.addContentWithNewLine({
        text: 'Most common PCI DSS requirements alerts found',
        style: 'h2'
      });
      for (const item of topPciRequirements) {
        const rules = await PCIRequest.getRulesByRequirement(context, from, to, filters, item, pattern);
        printer.addContentWithNewLine({
          text: `Requirement ${item}`,
          style: 'h3'
        });
        if (_pciRequirementsPdfmake.default[item]) {
          const content = typeof _pciRequirementsPdfmake.default[item] === 'string' ? {
            text: _pciRequirementsPdfmake.default[item],
            style: 'standard'
          } : _pciRequirementsPdfmake.default[item];
          printer.addContentWithNewLine(content);
        }
        rules && rules.length && printer.addSimpleTable({
          columns: [{
            id: 'ruleID',
            label: 'Rule ID'
          }, {
            id: 'ruleDescription',
            label: 'Description'
          }],
          items: rules,
          title: `Top rules for ${item} requirement`
        });
      }
    }

    //--- OVERVIEW/AGENTS - TSC
    if (['overview', 'agents'].includes(section) && tab === 'tsc') {
      printer.logger.debug('Fetching top TSC requirements');
      const topTSCRequirements = await TSCRequest.topTSCRequirements(context, from, to, filters, pattern);
      printer.addContentWithNewLine({
        text: 'Most common TSC requirements alerts found',
        style: 'h2'
      });
      for (const item of topTSCRequirements) {
        const rules = await TSCRequest.getRulesByRequirement(context, from, to, filters, item, pattern);
        printer.addContentWithNewLine({
          text: `Requirement ${item}`,
          style: 'h3'
        });
        if (_tscRequirementsPdfmake.default[item]) {
          const content = typeof _tscRequirementsPdfmake.default[item] === 'string' ? {
            text: _tscRequirementsPdfmake.default[item],
            style: 'standard'
          } : _tscRequirementsPdfmake.default[item];
          printer.addContentWithNewLine(content);
        }
        rules && rules.length && printer.addSimpleTable({
          columns: [{
            id: 'ruleID',
            label: 'Rule ID'
          }, {
            id: 'ruleDescription',
            label: 'Description'
          }],
          items: rules,
          title: `Top rules for ${item} requirement`
        });
      }
    }

    //--- OVERVIEW/AGENTS - GDPR
    if (['overview', 'agents'].includes(section) && tab === 'gdpr') {
      printer.logger.debug('Fetching top GDPR requirements');
      const topGdprRequirements = await GDPRRequest.topGDPRRequirements(context, from, to, filters, pattern);
      printer.addContentWithNewLine({
        text: 'Most common GDPR requirements alerts found',
        style: 'h2'
      });
      for (const item of topGdprRequirements) {
        const rules = await GDPRRequest.getRulesByRequirement(context, from, to, filters, item, pattern);
        printer.addContentWithNewLine({
          text: `Requirement ${item}`,
          style: 'h3'
        });
        if (_gdprRequirementsPdfmake.default && _gdprRequirementsPdfmake.default[item]) {
          const content = typeof _gdprRequirementsPdfmake.default[item] === 'string' ? {
            text: _gdprRequirementsPdfmake.default[item],
            style: 'standard'
          } : _gdprRequirementsPdfmake.default[item];
          printer.addContentWithNewLine(content);
        }
        rules && rules.length && printer.addSimpleTable({
          columns: [{
            id: 'ruleID',
            label: 'Rule ID'
          }, {
            id: 'ruleDescription',
            label: 'Description'
          }],
          items: rules,
          title: `Top rules for ${item} requirement`
        });
      }
      printer.addNewLine();
    }

    //--- OVERVIEW/AGENTS - PECA
    if (['overview', 'agents'].includes(section) && tab === 'peca') {
      printer.logger.debug('Fetching top PECA requirements');
      const topPecaRequirements = await PECARequest.topPECARequirements(context, from, to, filters, pattern);
      printer.addContentWithNewLine({
        text: 'Most common PECA 2016 requirements alerts found',
        style: 'h2'
      });
      for (const item of topPecaRequirements) {
        const rules = await PECARequest.getRulesByRequirement(context, from, to, filters, item, pattern);
        printer.addContentWithNewLine({
          text: `Requirement ${item}`,
          style: 'h3'
        });
        if (_pecaRequirementsPdfmake.default && _pecaRequirementsPdfmake.default[item]) {
          const content = typeof _pecaRequirementsPdfmake.default[item] === 'string' ? {
            text: _pecaRequirementsPdfmake.default[item],
            style: 'standard'
          } : _pecaRequirementsPdfmake.default[item];
          printer.addContentWithNewLine(content);
        }
        rules && rules.length && printer.addSimpleTable({
          columns: [{
            id: 'ruleID',
            label: 'Rule ID'
          }, {
            id: 'ruleDescription',
            label: 'Description'
          }],
          items: rules,
          title: `Top rules for ${item} requirement`
        });
      }
      printer.addNewLine();
    }

    //--- OVERVIEW - AUDIT
    if (section === 'overview' && tab === 'audit') {
      printer.logger.debug('Fetching agents with high number of failed sudo commands');
      const auditAgentsNonSuccess = await AuditRequest.getTop3AgentsSudoNonSuccessful(context, from, to, filters, pattern);
      if (auditAgentsNonSuccess && auditAgentsNonSuccess.length) {
        printer.addContent({
          text: 'Agents with high number of failed sudo commands',
          style: 'h2'
        });
        await buildAgentsTable(context, printer, auditAgentsNonSuccess, apiId);
      }
      const auditAgentsFailedSyscall = await AuditRequest.getTop3AgentsFailedSyscalls(context, from, to, filters, pattern);
      if (auditAgentsFailedSyscall && auditAgentsFailedSyscall.length) {
        printer.addSimpleTable({
          columns: [{
            id: 'agent',
            label: 'Agent ID'
          }, {
            id: 'syscall_id',
            label: 'Syscall ID'
          }, {
            id: 'syscall_syscall',
            label: 'Syscall'
          }],
          items: auditAgentsFailedSyscall.map(item => ({
            agent: item.agent,
            syscall_id: item.syscall.id,
            syscall_syscall: item.syscall.syscall
          })),
          title: {
            text: 'Most common failing syscalls',
            style: 'h2'
          }
        });
      }
    }

    //--- OVERVIEW - FIM
    if (section === 'overview' && tab === 'fim') {
      printer.logger.debug('Fetching top 3 rules for FIM');
      const rules = await SyscheckRequest.top3Rules(context, from, to, filters, pattern);
      if (rules && rules.length) {
        printer.addContentWithNewLine({
          text: 'Top 3 FIM rules',
          style: 'h2'
        }).addSimpleTable({
          columns: [{
            id: 'ruleID',
            label: 'Rule ID'
          }, {
            id: 'ruleDescription',
            label: 'Description'
          }],
          items: rules,
          title: {
            text: 'Top 3 rules that are generating most alerts.',
            style: 'standard'
          }
        });
      }
      printer.logger.debug('Fetching top 3 agents for FIM');
      const agents = await SyscheckRequest.top3agents(context, from, to, filters, pattern);
      if (agents && agents.length) {
        printer.addContentWithNewLine({
          text: 'Agents with suspicious FIM activity',
          style: 'h2'
        });
        printer.addContentWithNewLine({
          text: 'Top 3 agents that have most FIM alerts from level 7 to level 15. Take care about them.',
          style: 'standard'
        });
        await buildAgentsTable(context, printer, agents, apiId);
      }
    }

    //--- AGENTS - AUDIT
    if (section === 'agents' && tab === 'audit') {
      printer.logger.debug('Fetching most common failed syscalls');
      const auditFailedSyscall = await AuditRequest.getTopFailedSyscalls(context, from, to, filters, pattern);
      auditFailedSyscall && auditFailedSyscall.length && printer.addSimpleTable({
        columns: [{
          id: 'id',
          label: 'id'
        }, {
          id: 'syscall',
          label: 'Syscall'
        }],
        items: auditFailedSyscall,
        title: 'Most common failing syscalls'
      });
    }

    //--- AGENTS - FIM
    if (section === 'agents' && tab === 'fim') {
      printer.logger.debug(`Fetching syscheck database for agent ${agent}`);
      const lastScanResponse = await context.wazuh.api.client.asCurrentUser.request('GET', `/syscheck/${agent}/last_scan`, {}, {
        apiHostID: apiId
      });
      if (lastScanResponse && lastScanResponse.data) {
        const lastScanData = lastScanResponse.data.data.affected_items[0];
        if (lastScanData.start && lastScanData.end) {
          printer.addContent({
            text: `Last file integrity monitoring scan was executed from ${lastScanData.start} to ${lastScanData.end}.`
          });
        } else if (lastScanData.start) {
          printer.addContent({
            text: `File integrity monitoring scan is currently in progress for this agent (started on ${lastScanData.start}).`
          });
        } else {
          printer.addContent({
            text: `File integrity monitoring scan is currently in progress for this agent.`
          });
        }
        printer.addNewLine();
      }
      printer.logger.debug('Fetching last 10 deleted files for FIM');
      const lastTenDeleted = await SyscheckRequest.lastTenDeletedFiles(context, from, to, filters, pattern);
      lastTenDeleted && lastTenDeleted.length && printer.addSimpleTable({
        columns: [{
          id: 'path',
          label: 'Path'
        }, {
          id: 'date',
          label: 'Date'
        }],
        items: lastTenDeleted,
        title: 'Last 10 deleted files'
      });
      printer.logger.debug('Fetching last 10 modified files');
      const lastTenModified = await SyscheckRequest.lastTenModifiedFiles(context, from, to, filters, pattern);
      lastTenModified && lastTenModified.length && printer.addSimpleTable({
        columns: [{
          id: 'path',
          label: 'Path'
        }, {
          id: 'date',
          label: 'Date'
        }],
        items: lastTenModified,
        title: 'Last 10 modified files'
      });
    }

    //--- AGENTS - VULNERABILITIES
    if (section === 'agents' && tab === 'vuls') {
      const topCriticalPackages = await VulnerabilityRequest.topPackagesWithCVE(context, from, to, 'Critical', filters, pattern);
      if (topCriticalPackages && topCriticalPackages.length) {
        printer.addContentWithNewLine({
          text: 'Critical severity',
          style: 'h2'
        });
        printer.addContentWithNewLine({
          text: 'These vulnerabilties are critical, please review your agent. Click on each link to read more about each found vulnerability.',
          style: 'standard'
        });
        const customul = [];
        for (const critical of topCriticalPackages) {
          customul.push({
            text: critical.package,
            style: 'standard'
          });
          customul.push({
            ul: critical.references.map(item => ({
              text: item.substring(0, 80) + '...',
              link: item,
              color: '#1EA5C8'
            }))
          });
        }
        printer.addContentWithNewLine({
          ul: customul
        });
      }
      const topHighPackages = await VulnerabilityRequest.topPackagesWithCVE(context, from, to, 'High', filters, pattern);
      if (topHighPackages && topHighPackages.length) {
        printer.addContentWithNewLine({
          text: 'High severity',
          style: 'h2'
        });
        printer.addContentWithNewLine({
          text: 'Click on each link to read more about each found vulnerability.',
          style: 'standard'
        });
        const customul = [];
        for (const critical of topHighPackages) {
          customul.push({
            text: critical.package,
            style: 'standard'
          });
          customul.push({
            ul: critical.references.map(item => ({
              text: item,
              color: '#1EA5C8'
            }))
          });
        }
        customul && customul.length && printer.addContent({
          ul: customul
        });
        printer.addNewLine();
      }
    }

    //--- SUMMARY TABLES
    let extraSummaryTables = [];
    if (Array.isArray(_summaryTablesDefinitions.default[section][tab])) {
      const tablesPromises = _summaryTablesDefinitions.default[section][tab].map(summaryTable => {
        printer.logger.debug(`Fetching ${summaryTable.title} Table`);
        const alertsSummaryTable = new _summaryTable.default(context, from, to, filters, summaryTable, pattern);
        return alertsSummaryTable.fetch();
      });
      extraSummaryTables = await Promise.all(tablesPromises);
    }
    return extraSummaryTables;
  } catch (error) {
    printer.logger.error(error.message || error);
    return Promise.reject(error);
  }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfc3VtbWFyeVRhYmxlIiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfc3VtbWFyeVRhYmxlc0RlZmluaXRpb25zIiwiVnVsbmVyYWJpbGl0eVJlcXVlc3QiLCJfaW50ZXJvcFJlcXVpcmVXaWxkY2FyZCIsIk92ZXJ2aWV3UmVxdWVzdCIsIlJvb3RjaGVja1JlcXVlc3QiLCJQQ0lSZXF1ZXN0IiwiR0RQUlJlcXVlc3QiLCJUU0NSZXF1ZXN0IiwiQXVkaXRSZXF1ZXN0IiwiU3lzY2hlY2tSZXF1ZXN0IiwiX3BjaVJlcXVpcmVtZW50c1BkZm1ha2UiLCJfZ2RwclJlcXVpcmVtZW50c1BkZm1ha2UiLCJfdHNjUmVxdWlyZW1lbnRzUGRmbWFrZSIsIl9tb21lbnQiLCJfZ2V0UmVxdWlyZVdpbGRjYXJkQ2FjaGUiLCJlIiwiV2Vha01hcCIsInIiLCJ0IiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJoYXMiLCJnZXQiLCJuIiwiX19wcm90b19fIiwiYSIsIk9iamVjdCIsImRlZmluZVByb3BlcnR5IiwiZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yIiwidSIsImhhc093blByb3BlcnR5IiwiY2FsbCIsImkiLCJzZXQiLCJidWlsZEFnZW50c1RhYmxlIiwiY29udGV4dCIsInByaW50ZXIiLCJhZ2VudElEcyIsImFwaUlkIiwiZ3JvdXBJRCIsImRhdGVGb3JtYXQiLCJjb3JlIiwidWlTZXR0aW5ncyIsImNsaWVudCIsImxlbmd0aCIsImxvZ2dlciIsImRlYnVnIiwiYWdlbnRzRGF0YSIsInRvdGFsQWdlbnRzSW5Hcm91cCIsImRhdGEiLCJhZmZlY3RlZF9pdGVtcyIsInRvdGFsX2FmZmVjdGVkX2l0ZW1zIiwid2F6dWgiLCJhcGkiLCJhc0N1cnJlbnRVc2VyIiwicmVxdWVzdCIsInBhcmFtcyIsIm9mZnNldCIsInNlbGVjdCIsImFwaUhvc3RJRCIsImFnZW50SUQiLCJhZ2VudCIsInEiLCJwdXNoIiwiZXJyb3IiLCJtZXNzYWdlIiwiYWRkU2ltcGxlVGFibGUiLCJjb2x1bW5zIiwiaWQiLCJsYWJlbCIsIml0ZW1zIiwiZmlsdGVyIiwibWFwIiwib3MiLCJuYW1lIiwidmVyc2lvbiIsImxhc3RLZWVwQWxpdmUiLCJtb21lbnQiLCJmb3JtYXQiLCJkYXRlQWRkIiwiYWRkQ29udGVudCIsInRleHQiLCJzdHlsZSIsImZvbnRTaXplIiwiY29sb3IiLCJQcm9taXNlIiwicmVqZWN0IiwiZXh0ZW5kZWRJbmZvcm1hdGlvbiIsInNlY3Rpb24iLCJ0YWIiLCJmcm9tIiwidG8iLCJmaWx0ZXJzIiwicGF0dGVybiIsIkpTT04iLCJzdHJpbmdpZnkiLCJFcnJvciIsImFnZW50cyIsImxpbWl0IiwidG90YWxBZ2VudHMiLCJ2dWxuZXJhYmlsaXRpZXNMZXZlbHMiLCJ2dWxuZXJhYmlsaXRpZXNSZXNwb25zZXNDb3VudCIsImFsbCIsInZ1bG5lcmFiaWxpdGllc0xldmVsIiwiY291bnQiLCJ1bmlxdWVTZXZlcml0eUNvdW50IiwidG9Mb2NhbGVMb3dlckNhc2UiLCJ1bmRlZmluZWQiLCJ2dWxuZXJhYmlsaXRpZXNSZXNwb25zZSIsImFkZExpc3QiLCJ0aXRsZSIsImxpc3QiLCJsb3dSYW5rIiwidG9wQWdlbnRDb3VudCIsIm1lZGl1bVJhbmsiLCJoaWdoUmFuayIsImNyaXRpY2FsUmFuayIsImFkZENvbnRlbnRXaXRoTmV3TGluZSIsImFkZE5ld0xpbmUiLCJjdmVSYW5rIiwidG9wQ1ZFQ291bnQiLCJpdGVtIiwidG9wIiwiaW5kZXhPZiIsImN2ZSIsImxldmVsMTVSYW5rIiwidG9wTGV2ZWwxNSIsInRvcDVSb290a2l0c1JhbmsiLCJ0b3A1Um9vdGtpdHNEZXRlY3RlZCIsImhpZGRlblBpZHMiLCJhZ2VudHNXaXRoSGlkZGVuUGlkcyIsImhpZGRlblBvcnRzIiwiYWdlbnRzV2l0aEhpZGRlblBvcnRzIiwiaW5jbHVkZXMiLCJ0b3BQY2lSZXF1aXJlbWVudHMiLCJ0b3BQQ0lSZXF1aXJlbWVudHMiLCJydWxlcyIsImdldFJ1bGVzQnlSZXF1aXJlbWVudCIsIlBDSSIsImNvbnRlbnQiLCJ0b3BUU0NSZXF1aXJlbWVudHMiLCJUU0MiLCJ0b3BHZHByUmVxdWlyZW1lbnRzIiwidG9wR0RQUlJlcXVpcmVtZW50cyIsIkdEUFIiLCJhdWRpdEFnZW50c05vblN1Y2Nlc3MiLCJnZXRUb3AzQWdlbnRzU3Vkb05vblN1Y2Nlc3NmdWwiLCJhdWRpdEFnZW50c0ZhaWxlZFN5c2NhbGwiLCJnZXRUb3AzQWdlbnRzRmFpbGVkU3lzY2FsbHMiLCJzeXNjYWxsX2lkIiwic3lzY2FsbCIsInN5c2NhbGxfc3lzY2FsbCIsInRvcDNSdWxlcyIsInRvcDNhZ2VudHMiLCJhdWRpdEZhaWxlZFN5c2NhbGwiLCJnZXRUb3BGYWlsZWRTeXNjYWxscyIsImxhc3RTY2FuUmVzcG9uc2UiLCJsYXN0U2NhbkRhdGEiLCJzdGFydCIsImVuZCIsImxhc3RUZW5EZWxldGVkIiwibGFzdFRlbkRlbGV0ZWRGaWxlcyIsImxhc3RUZW5Nb2RpZmllZCIsImxhc3RUZW5Nb2RpZmllZEZpbGVzIiwidG9wQ3JpdGljYWxQYWNrYWdlcyIsInRvcFBhY2thZ2VzV2l0aENWRSIsImN1c3RvbXVsIiwiY3JpdGljYWwiLCJwYWNrYWdlIiwidWwiLCJyZWZlcmVuY2VzIiwic3Vic3RyaW5nIiwibGluayIsInRvcEhpZ2hQYWNrYWdlcyIsImV4dHJhU3VtbWFyeVRhYmxlcyIsIkFycmF5IiwiaXNBcnJheSIsInN1bW1hcnlUYWJsZXNEZWZpbml0aW9ucyIsInRhYmxlc1Byb21pc2VzIiwic3VtbWFyeVRhYmxlIiwiYWxlcnRzU3VtbWFyeVRhYmxlIiwiU3VtbWFyeVRhYmxlIiwiZmV0Y2giXSwic291cmNlcyI6WyJleHRlbmRlZC1pbmZvcm1hdGlvbi50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgU3VtbWFyeVRhYmxlIGZyb20gJy4vc3VtbWFyeS10YWJsZSc7XG5pbXBvcnQgc3VtbWFyeVRhYmxlc0RlZmluaXRpb25zIGZyb20gJy4vc3VtbWFyeS10YWJsZXMtZGVmaW5pdGlvbnMnO1xuaW1wb3J0ICogYXMgVnVsbmVyYWJpbGl0eVJlcXVlc3QgZnJvbSAnLi92dWxuZXJhYmlsaXR5LXJlcXVlc3QnO1xuaW1wb3J0ICogYXMgT3ZlcnZpZXdSZXF1ZXN0IGZyb20gJy4vb3ZlcnZpZXctcmVxdWVzdCc7XG5pbXBvcnQgKiBhcyBSb290Y2hlY2tSZXF1ZXN0IGZyb20gJy4vcm9vdGNoZWNrLXJlcXVlc3QnO1xuaW1wb3J0ICogYXMgUENJUmVxdWVzdCBmcm9tICcuL3BjaS1yZXF1ZXN0JztcbmltcG9ydCAqIGFzIEdEUFJSZXF1ZXN0IGZyb20gJy4vZ2Rwci1yZXF1ZXN0JztcbmltcG9ydCAqIGFzIFRTQ1JlcXVlc3QgZnJvbSAnLi90c2MtcmVxdWVzdCc7XG5pbXBvcnQgKiBhcyBBdWRpdFJlcXVlc3QgZnJvbSAnLi9hdWRpdC1yZXF1ZXN0JztcbmltcG9ydCAqIGFzIFN5c2NoZWNrUmVxdWVzdCBmcm9tICcuL3N5c2NoZWNrLXJlcXVlc3QnO1xuaW1wb3J0IFBDSSBmcm9tICcuLi8uLi9pbnRlZ3JhdGlvbi1maWxlcy9wY2ktcmVxdWlyZW1lbnRzLXBkZm1ha2UnO1xuaW1wb3J0IEdEUFIgZnJvbSAnLi4vLi4vaW50ZWdyYXRpb24tZmlsZXMvZ2Rwci1yZXF1aXJlbWVudHMtcGRmbWFrZSc7XG5pbXBvcnQgVFNDIGZyb20gJy4uLy4uL2ludGVncmF0aW9uLWZpbGVzL3RzYy1yZXF1aXJlbWVudHMtcGRmbWFrZSc7XG5pbXBvcnQgeyBSZXBvcnRQcmludGVyIH0gZnJvbSAnLi9wcmludGVyJztcbmltcG9ydCBtb21lbnQgZnJvbSAnbW9tZW50JztcblxuLyoqXG4gKiBUaGlzIGJ1aWxkIHRoZSBhZ2VudHMgdGFibGVcbiAqIEBwYXJhbSB7QXJyYXk8U3RyaW5ncz59IGlkcyBpZHMgb2YgYWdlbnRzXG4gKiBAcGFyYW0ge1N0cmluZ30gYXBpSWQgQVBJIGlkXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBidWlsZEFnZW50c1RhYmxlKFxuICBjb250ZXh0LFxuICBwcmludGVyOiBSZXBvcnRQcmludGVyLFxuICBhZ2VudElEczogc3RyaW5nW10sXG4gIGFwaUlkOiBzdHJpbmcsXG4gIGdyb3VwSUQ6IHN0cmluZyA9ICcnLFxuKSB7XG4gIGNvbnN0IGRhdGVGb3JtYXQgPSBhd2FpdCBjb250ZXh0LmNvcmUudWlTZXR0aW5ncy5jbGllbnQuZ2V0KCdkYXRlRm9ybWF0Jyk7XG4gIGlmICgoIWFnZW50SURzIHx8ICFhZ2VudElEcy5sZW5ndGgpICYmICFncm91cElEKSByZXR1cm47XG4gIHByaW50ZXIubG9nZ2VyLmRlYnVnKGAke2FnZW50SURzLmxlbmd0aH0gYWdlbnRzIGZvciBBUEkgJHthcGlJZH1gKTtcbiAgdHJ5IHtcbiAgICBsZXQgYWdlbnRzRGF0YSA9IFtdO1xuICAgIGlmIChncm91cElEKSB7XG4gICAgICBsZXQgdG90YWxBZ2VudHNJbkdyb3VwID0gbnVsbDtcbiAgICAgIGRvIHtcbiAgICAgICAgY29uc3Qge1xuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIGRhdGE6IHsgYWZmZWN0ZWRfaXRlbXMsIHRvdGFsX2FmZmVjdGVkX2l0ZW1zIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSA9IGF3YWl0IGNvbnRleHQud2F6dWguYXBpLmNsaWVudC5hc0N1cnJlbnRVc2VyLnJlcXVlc3QoXG4gICAgICAgICAgJ0dFVCcsXG4gICAgICAgICAgYC9ncm91cHMvJHtncm91cElEfS9hZ2VudHNgLFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHBhcmFtczoge1xuICAgICAgICAgICAgICBvZmZzZXQ6IGFnZW50c0RhdGEubGVuZ3RoLFxuICAgICAgICAgICAgICBzZWxlY3Q6XG4gICAgICAgICAgICAgICAgJ2RhdGVBZGQsaWQsaXAsbGFzdEtlZXBBbGl2ZSxtYW5hZ2VyLG5hbWUsb3MubmFtZSxvcy52ZXJzaW9uLHZlcnNpb24nLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHsgYXBpSG9zdElEOiBhcGlJZCB9LFxuICAgICAgICApO1xuICAgICAgICAhdG90YWxBZ2VudHNJbkdyb3VwICYmICh0b3RhbEFnZW50c0luR3JvdXAgPSB0b3RhbF9hZmZlY3RlZF9pdGVtcyk7XG4gICAgICAgIGFnZW50c0RhdGEgPSBbLi4uYWdlbnRzRGF0YSwgLi4uYWZmZWN0ZWRfaXRlbXNdO1xuICAgICAgfSB3aGlsZSAoYWdlbnRzRGF0YS5sZW5ndGggPCB0b3RhbEFnZW50c0luR3JvdXApO1xuICAgIH0gZWxzZSB7XG4gICAgICBmb3IgKGNvbnN0IGFnZW50SUQgb2YgYWdlbnRJRHMpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCB7XG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICBhZmZlY3RlZF9pdGVtczogW2FnZW50XSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSA9IGF3YWl0IGNvbnRleHQud2F6dWguYXBpLmNsaWVudC5hc0N1cnJlbnRVc2VyLnJlcXVlc3QoXG4gICAgICAgICAgICAnR0VUJyxcbiAgICAgICAgICAgIGAvYWdlbnRzYCxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgcTogYGlkPSR7YWdlbnRJRH1gLFxuICAgICAgICAgICAgICAgIHNlbGVjdDpcbiAgICAgICAgICAgICAgICAgICdkYXRlQWRkLGlkLGlwLGxhc3RLZWVwQWxpdmUsbWFuYWdlcixuYW1lLG9zLm5hbWUsb3MudmVyc2lvbix2ZXJzaW9uJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7IGFwaUhvc3RJRDogYXBpSWQgfSxcbiAgICAgICAgICApO1xuICAgICAgICAgIGFnZW50c0RhdGEucHVzaChhZ2VudCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgcHJpbnRlci5sb2dnZXIuZGVidWcoYFNraXAgYWdlbnQgZHVlIHRvOiAke2Vycm9yLm1lc3NhZ2UgfHwgZXJyb3J9YCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYWdlbnRzRGF0YS5sZW5ndGgpIHtcbiAgICAgIC8vIFByaW50IGEgdGFibGUgd2l0aCBhZ2VudC9zIGluZm9ybWF0aW9uXG4gICAgICBwcmludGVyLmFkZFNpbXBsZVRhYmxlKHtcbiAgICAgICAgY29sdW1uczogW1xuICAgICAgICAgIHsgaWQ6ICdpZCcsIGxhYmVsOiAnSUQnIH0sXG4gICAgICAgICAgeyBpZDogJ25hbWUnLCBsYWJlbDogJ05hbWUnIH0sXG4gICAgICAgICAgeyBpZDogJ2lwJywgbGFiZWw6ICdJUCBhZGRyZXNzJyB9LFxuICAgICAgICAgIHsgaWQ6ICd2ZXJzaW9uJywgbGFiZWw6ICdWZXJzaW9uJyB9LFxuICAgICAgICAgIHsgaWQ6ICdtYW5hZ2VyJywgbGFiZWw6ICdNYW5hZ2VyJyB9LFxuICAgICAgICAgIHsgaWQ6ICdvcycsIGxhYmVsOiAnT3BlcmF0aW5nIHN5c3RlbScgfSxcbiAgICAgICAgICB7IGlkOiAnZGF0ZUFkZCcsIGxhYmVsOiAnUmVnaXN0cmF0aW9uIGRhdGUnIH0sXG4gICAgICAgICAgeyBpZDogJ2xhc3RLZWVwQWxpdmUnLCBsYWJlbDogJ0xhc3Qga2VlcCBhbGl2ZScgfSxcbiAgICAgICAgXSxcbiAgICAgICAgaXRlbXM6IGFnZW50c0RhdGFcbiAgICAgICAgICAuZmlsdGVyKGFnZW50ID0+IGFnZW50KSAvLyBSZW1vdmUgdW5kZWZpbmVkIGFnZW50cyB3aGVuIFdhenVoIEFQSSBubyBsb25nZXIgZmluZHMgYW5kIGFnZW50SURcbiAgICAgICAgICAubWFwKGFnZW50ID0+IHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIC4uLmFnZW50LFxuICAgICAgICAgICAgICBvczpcbiAgICAgICAgICAgICAgICBhZ2VudC5vcyAmJiBhZ2VudC5vcy5uYW1lICYmIGFnZW50Lm9zLnZlcnNpb25cbiAgICAgICAgICAgICAgICAgID8gYCR7YWdlbnQub3MubmFtZX0gJHthZ2VudC5vcy52ZXJzaW9ufWBcbiAgICAgICAgICAgICAgICAgIDogJycsXG4gICAgICAgICAgICAgIGxhc3RLZWVwQWxpdmU6IG1vbWVudChhZ2VudC5sYXN0S2VlcEFsaXZlKS5mb3JtYXQoZGF0ZUZvcm1hdCksXG4gICAgICAgICAgICAgIGRhdGVBZGQ6IG1vbWVudChhZ2VudC5kYXRlQWRkKS5mb3JtYXQoZGF0ZUZvcm1hdCksXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH0pLFxuICAgICAgfSk7XG4gICAgfSBlbHNlIGlmICghYWdlbnRzRGF0YS5sZW5ndGggJiYgZ3JvdXBJRCkge1xuICAgICAgLy8gRm9yIGdyb3VwIHJlcG9ydHMgd2hlbiB0aGVyZSBpcyBubyBhZ2VudHMgaW4gdGhlIGdyb3VwXG4gICAgICBwcmludGVyLmFkZENvbnRlbnQoe1xuICAgICAgICB0ZXh0OiAnVGhlcmUgYXJlIG5vIGFnZW50cyBpbiB0aGlzIGdyb3VwLicsXG4gICAgICAgIHN0eWxlOiB7IGZvbnRTaXplOiAxMiwgY29sb3I6ICcjMDAwJyB9LFxuICAgICAgfSk7XG4gICAgfVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHByaW50ZXIubG9nZ2VyLmVycm9yKGVycm9yLm1lc3NhZ2UgfHwgZXJyb3IpO1xuICAgIHJldHVybiBQcm9taXNlLnJlamVjdChlcnJvcik7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGlzIGxvYWQgbW9yZSBpbmZvcm1hdGlvblxuICogQHBhcmFtIHsqfSBjb250ZXh0IEVuZHBvaW50IGNvbnRleHRcbiAqIEBwYXJhbSB7Kn0gcHJpbnRlciBwcmludGVyIGluc3RhbmNlXG4gKiBAcGFyYW0ge1N0cmluZ30gc2VjdGlvbiBzZWN0aW9uIHRhcmdldFxuICogQHBhcmFtIHtPYmplY3R9IHRhYiB0YWIgdGFyZ2V0XG4gKiBAcGFyYW0ge1N0cmluZ30gYXBpSWQgSUQgb2YgQVBJXG4gKiBAcGFyYW0ge051bWJlcn0gZnJvbSBUaW1lc3RhbXAgKG1zKSBmcm9tXG4gKiBAcGFyYW0ge051bWJlcn0gdG8gVGltZXN0YW1wIChtcykgdG9cbiAqIEBwYXJhbSB7U3RyaW5nfSBmaWx0ZXJzIEUuZzogY2x1c3Rlci5uYW1lOiB3YXp1aCBBTkQgcnVsZS5ncm91cHM6IHZ1bG5lcmFiaWxpdHlcbiAqIEBwYXJhbSB7U3RyaW5nfSBwYXR0ZXJuXG4gKiBAcGFyYW0ge09iamVjdH0gYWdlbnQgYWdlbnQgdGFyZ2V0XG4gKiBAcmV0dXJucyB7T2JqZWN0fSBFeHRlbmRlZCBpbmZvcm1hdGlvblxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZXh0ZW5kZWRJbmZvcm1hdGlvbihcbiAgY29udGV4dCxcbiAgcHJpbnRlcixcbiAgc2VjdGlvbixcbiAgdGFiLFxuICBhcGlJZCxcbiAgZnJvbSxcbiAgdG8sXG4gIGZpbHRlcnMsXG4gIHBhdHRlcm4sXG4gIGFnZW50ID0gbnVsbCxcbikge1xuICB0cnkge1xuICAgIHByaW50ZXIubG9nZ2VyLmRlYnVnKFxuICAgICAgYFNlY3Rpb24gJHtzZWN0aW9ufSBhbmQgdGFiICR7dGFifSwgQVBJIGlzICR7YXBpSWR9LiBGcm9tICR7ZnJvbX0gdG8gJHt0b30uIEZpbHRlcnMgJHtKU09OLnN0cmluZ2lmeShcbiAgICAgICAgZmlsdGVycyxcbiAgICAgICl9LiBJbmRleCBwYXR0ZXJuICR7cGF0dGVybn1gLFxuICAgICk7XG4gICAgaWYgKHNlY3Rpb24gPT09ICdhZ2VudHMnICYmICFhZ2VudCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAnUmVwb3J0aW5nIGZvciBzcGVjaWZpYyBhZ2VudCBuZWVkcyBhbiBhZ2VudCBJRCBpbiBvcmRlciB0byB3b3JrIHByb3Blcmx5JyxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgY29uc3QgYWdlbnRzID0gYXdhaXQgY29udGV4dC53YXp1aC5hcGkuY2xpZW50LmFzQ3VycmVudFVzZXIucmVxdWVzdChcbiAgICAgICdHRVQnLFxuICAgICAgJy9hZ2VudHMnLFxuICAgICAgeyBwYXJhbXM6IHsgbGltaXQ6IDEgfSB9LFxuICAgICAgeyBhcGlIb3N0SUQ6IGFwaUlkIH0sXG4gICAgKTtcblxuICAgIGNvbnN0IHRvdGFsQWdlbnRzID0gYWdlbnRzLmRhdGEuZGF0YS50b3RhbF9hZmZlY3RlZF9pdGVtcztcblxuICAgIC8vLS0tIE9WRVJWSUVXIC0gVlVMU1xuICAgIGlmIChzZWN0aW9uID09PSAnb3ZlcnZpZXcnICYmIHRhYiA9PT0gJ3Z1bHMnKSB7XG4gICAgICBwcmludGVyLmxvZ2dlci5kZWJ1ZygnRmV0Y2hpbmcgb3ZlcnZpZXcgdnVsbmVyYWJpbGl0eSBkZXRlY3RvciBtZXRyaWNzJyk7XG4gICAgICBjb25zdCB2dWxuZXJhYmlsaXRpZXNMZXZlbHMgPSBbJ0xvdycsICdNZWRpdW0nLCAnSGlnaCcsICdDcml0aWNhbCddO1xuXG4gICAgICBjb25zdCB2dWxuZXJhYmlsaXRpZXNSZXNwb25zZXNDb3VudCA9IChcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgICAgdnVsbmVyYWJpbGl0aWVzTGV2ZWxzLm1hcChhc3luYyB2dWxuZXJhYmlsaXRpZXNMZXZlbCA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBjb25zdCBjb3VudCA9IGF3YWl0IFZ1bG5lcmFiaWxpdHlSZXF1ZXN0LnVuaXF1ZVNldmVyaXR5Q291bnQoXG4gICAgICAgICAgICAgICAgY29udGV4dCxcbiAgICAgICAgICAgICAgICBmcm9tLFxuICAgICAgICAgICAgICAgIHRvLFxuICAgICAgICAgICAgICAgIHZ1bG5lcmFiaWxpdGllc0xldmVsLFxuICAgICAgICAgICAgICAgIGZpbHRlcnMsXG4gICAgICAgICAgICAgICAgcGF0dGVybixcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgcmV0dXJuIGNvdW50XG4gICAgICAgICAgICAgICAgPyBgJHtjb3VudH0gb2YgJHt0b3RhbEFnZW50c30gYWdlbnRzIGhhdmUgJHt2dWxuZXJhYmlsaXRpZXNMZXZlbC50b0xvY2FsZUxvd2VyQ2FzZSgpfSB2dWxuZXJhYmlsaXRpZXMuYFxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHt9XG4gICAgICAgICAgfSksXG4gICAgICAgIClcbiAgICAgICkuZmlsdGVyKHZ1bG5lcmFiaWxpdGllc1Jlc3BvbnNlID0+IHZ1bG5lcmFiaWxpdGllc1Jlc3BvbnNlKTtcblxuICAgICAgcHJpbnRlci5hZGRMaXN0KHtcbiAgICAgICAgdGl0bGU6IHsgdGV4dDogJ1N1bW1hcnknLCBzdHlsZTogJ2gyJyB9LFxuICAgICAgICBsaXN0OiB2dWxuZXJhYmlsaXRpZXNSZXNwb25zZXNDb3VudCxcbiAgICAgIH0pO1xuXG4gICAgICBwcmludGVyLmxvZ2dlci5kZWJ1ZyhcbiAgICAgICAgJ0ZldGNoaW5nIG92ZXJ2aWV3IHZ1bG5lcmFiaWxpdHkgZGV0ZWN0b3IgdG9wIDMgYWdlbnRzIGJ5IGNhdGVnb3J5JyxcbiAgICAgICk7XG4gICAgICBjb25zdCBsb3dSYW5rID0gYXdhaXQgVnVsbmVyYWJpbGl0eVJlcXVlc3QudG9wQWdlbnRDb3VudChcbiAgICAgICAgY29udGV4dCxcbiAgICAgICAgZnJvbSxcbiAgICAgICAgdG8sXG4gICAgICAgICdMb3cnLFxuICAgICAgICBmaWx0ZXJzLFxuICAgICAgICBwYXR0ZXJuLFxuICAgICAgKTtcbiAgICAgIGNvbnN0IG1lZGl1bVJhbmsgPSBhd2FpdCBWdWxuZXJhYmlsaXR5UmVxdWVzdC50b3BBZ2VudENvdW50KFxuICAgICAgICBjb250ZXh0LFxuICAgICAgICBmcm9tLFxuICAgICAgICB0byxcbiAgICAgICAgJ01lZGl1bScsXG4gICAgICAgIGZpbHRlcnMsXG4gICAgICAgIHBhdHRlcm4sXG4gICAgICApO1xuICAgICAgY29uc3QgaGlnaFJhbmsgPSBhd2FpdCBWdWxuZXJhYmlsaXR5UmVxdWVzdC50b3BBZ2VudENvdW50KFxuICAgICAgICBjb250ZXh0LFxuICAgICAgICBmcm9tLFxuICAgICAgICB0byxcbiAgICAgICAgJ0hpZ2gnLFxuICAgICAgICBmaWx0ZXJzLFxuICAgICAgICBwYXR0ZXJuLFxuICAgICAgKTtcbiAgICAgIGNvbnN0IGNyaXRpY2FsUmFuayA9IGF3YWl0IFZ1bG5lcmFiaWxpdHlSZXF1ZXN0LnRvcEFnZW50Q291bnQoXG4gICAgICAgIGNvbnRleHQsXG4gICAgICAgIGZyb20sXG4gICAgICAgIHRvLFxuICAgICAgICAnQ3JpdGljYWwnLFxuICAgICAgICBmaWx0ZXJzLFxuICAgICAgICBwYXR0ZXJuLFxuICAgICAgKTtcbiAgICAgIHByaW50ZXIubG9nZ2VyLmRlYnVnKFxuICAgICAgICAnQWRkaW5nIG92ZXJ2aWV3IHZ1bG5lcmFiaWxpdHkgZGV0ZWN0b3IgdG9wIDMgYWdlbnRzIGJ5IGNhdGVnb3J5JyxcbiAgICAgICk7XG4gICAgICBpZiAoY3JpdGljYWxSYW5rICYmIGNyaXRpY2FsUmFuay5sZW5ndGgpIHtcbiAgICAgICAgcHJpbnRlci5hZGRDb250ZW50V2l0aE5ld0xpbmUoe1xuICAgICAgICAgIHRleHQ6ICdUb3AgMyBhZ2VudHMgd2l0aCBjcml0aWNhbCBzZXZlcml0eSB2dWxuZXJhYmlsaXRpZXMnLFxuICAgICAgICAgIHN0eWxlOiAnaDMnLFxuICAgICAgICB9KTtcbiAgICAgICAgYXdhaXQgYnVpbGRBZ2VudHNUYWJsZShjb250ZXh0LCBwcmludGVyLCBjcml0aWNhbFJhbmssIGFwaUlkKTtcbiAgICAgICAgcHJpbnRlci5hZGROZXdMaW5lKCk7XG4gICAgICB9XG5cbiAgICAgIGlmIChoaWdoUmFuayAmJiBoaWdoUmFuay5sZW5ndGgpIHtcbiAgICAgICAgcHJpbnRlci5hZGRDb250ZW50V2l0aE5ld0xpbmUoe1xuICAgICAgICAgIHRleHQ6ICdUb3AgMyBhZ2VudHMgd2l0aCBoaWdoIHNldmVyaXR5IHZ1bG5lcmFiaWxpdGllcycsXG4gICAgICAgICAgc3R5bGU6ICdoMycsXG4gICAgICAgIH0pO1xuICAgICAgICBhd2FpdCBidWlsZEFnZW50c1RhYmxlKGNvbnRleHQsIHByaW50ZXIsIGhpZ2hSYW5rLCBhcGlJZCk7XG4gICAgICAgIHByaW50ZXIuYWRkTmV3TGluZSgpO1xuICAgICAgfVxuXG4gICAgICBpZiAobWVkaXVtUmFuayAmJiBtZWRpdW1SYW5rLmxlbmd0aCkge1xuICAgICAgICBwcmludGVyLmFkZENvbnRlbnRXaXRoTmV3TGluZSh7XG4gICAgICAgICAgdGV4dDogJ1RvcCAzIGFnZW50cyB3aXRoIG1lZGl1bSBzZXZlcml0eSB2dWxuZXJhYmlsaXRpZXMnLFxuICAgICAgICAgIHN0eWxlOiAnaDMnLFxuICAgICAgICB9KTtcbiAgICAgICAgYXdhaXQgYnVpbGRBZ2VudHNUYWJsZShjb250ZXh0LCBwcmludGVyLCBtZWRpdW1SYW5rLCBhcGlJZCk7XG4gICAgICAgIHByaW50ZXIuYWRkTmV3TGluZSgpO1xuICAgICAgfVxuXG4gICAgICBpZiAobG93UmFuayAmJiBsb3dSYW5rLmxlbmd0aCkge1xuICAgICAgICBwcmludGVyLmFkZENvbnRlbnRXaXRoTmV3TGluZSh7XG4gICAgICAgICAgdGV4dDogJ1RvcCAzIGFnZW50cyB3aXRoIGxvdyBzZXZlcml0eSB2dWxuZXJhYmlsaXRpZXMnLFxuICAgICAgICAgIHN0eWxlOiAnaDMnLFxuICAgICAgICB9KTtcbiAgICAgICAgYXdhaXQgYnVpbGRBZ2VudHNUYWJsZShjb250ZXh0LCBwcmludGVyLCBsb3dSYW5rLCBhcGlJZCk7XG4gICAgICAgIHByaW50ZXIuYWRkTmV3TGluZSgpO1xuICAgICAgfVxuXG4gICAgICBwcmludGVyLmxvZ2dlci5kZWJ1ZyhcbiAgICAgICAgJ0ZldGNoaW5nIG92ZXJ2aWV3IHZ1bG5lcmFiaWxpdHkgZGV0ZWN0b3IgdG9wIDMgQ1ZFcycsXG4gICAgICApO1xuICAgICAgY29uc3QgY3ZlUmFuayA9IGF3YWl0IFZ1bG5lcmFiaWxpdHlSZXF1ZXN0LnRvcENWRUNvdW50KFxuICAgICAgICBjb250ZXh0LFxuICAgICAgICBmcm9tLFxuICAgICAgICB0byxcbiAgICAgICAgZmlsdGVycyxcbiAgICAgICAgcGF0dGVybixcbiAgICAgICk7XG4gICAgICBwcmludGVyLmxvZ2dlci5kZWJ1ZygnQWRkaW5nIG92ZXJ2aWV3IHZ1bG5lcmFiaWxpdHkgZGV0ZWN0b3IgdG9wIDMgQ1ZFcycpO1xuICAgICAgaWYgKGN2ZVJhbmsgJiYgY3ZlUmFuay5sZW5ndGgpIHtcbiAgICAgICAgcHJpbnRlci5hZGRTaW1wbGVUYWJsZSh7XG4gICAgICAgICAgdGl0bGU6IHsgdGV4dDogJ1RvcCAzIENWRScsIHN0eWxlOiAnaDInIH0sXG4gICAgICAgICAgY29sdW1uczogW1xuICAgICAgICAgICAgeyBpZDogJ3RvcCcsIGxhYmVsOiAnVG9wJyB9LFxuICAgICAgICAgICAgeyBpZDogJ2N2ZScsIGxhYmVsOiAnQ1ZFJyB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICAgaXRlbXM6IGN2ZVJhbmsubWFwKGl0ZW0gPT4gKHtcbiAgICAgICAgICAgIHRvcDogY3ZlUmFuay5pbmRleE9mKGl0ZW0pICsgMSxcbiAgICAgICAgICAgIGN2ZTogaXRlbSxcbiAgICAgICAgICB9KSksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vLS0tIE9WRVJWSUVXIC0gR0VORVJBTFxuICAgIGlmIChzZWN0aW9uID09PSAnb3ZlcnZpZXcnICYmIHRhYiA9PT0gJ2dlbmVyYWwnKSB7XG4gICAgICBwcmludGVyLmxvZ2dlci5kZWJ1ZygnRmV0Y2hpbmcgdG9wIDMgYWdlbnRzIHdpdGggbGV2ZWwgMTUgYWxlcnRzJyk7XG5cbiAgICAgIGNvbnN0IGxldmVsMTVSYW5rID0gYXdhaXQgT3ZlcnZpZXdSZXF1ZXN0LnRvcExldmVsMTUoXG4gICAgICAgIGNvbnRleHQsXG4gICAgICAgIGZyb20sXG4gICAgICAgIHRvLFxuICAgICAgICBmaWx0ZXJzLFxuICAgICAgICBwYXR0ZXJuLFxuICAgICAgKTtcblxuICAgICAgcHJpbnRlci5sb2dnZXIuZGVidWcoJ0FkZGluZyB0b3AgMyBhZ2VudHMgd2l0aCBsZXZlbCAxNSBhbGVydHMnKTtcbiAgICAgIGlmIChsZXZlbDE1UmFuay5sZW5ndGgpIHtcbiAgICAgICAgcHJpbnRlci5hZGRDb250ZW50KHtcbiAgICAgICAgICB0ZXh0OiAnVG9wIDMgYWdlbnRzIHdpdGggbGV2ZWwgMTUgYWxlcnRzJyxcbiAgICAgICAgICBzdHlsZTogJ2gyJyxcbiAgICAgICAgfSk7XG4gICAgICAgIGF3YWl0IGJ1aWxkQWdlbnRzVGFibGUoY29udGV4dCwgcHJpbnRlciwgbGV2ZWwxNVJhbmssIGFwaUlkKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLy0tLSBPVkVSVklFVyAtIFBNXG4gICAgaWYgKHNlY3Rpb24gPT09ICdvdmVydmlldycgJiYgdGFiID09PSAncG0nKSB7XG4gICAgICBwcmludGVyLmxvZ2dlci5kZWJ1ZygnRmV0Y2hpbmcgbW9zdCBjb21tb24gcm9vdGtpdHMnKTtcbiAgICAgIGNvbnN0IHRvcDVSb290a2l0c1JhbmsgPSBhd2FpdCBSb290Y2hlY2tSZXF1ZXN0LnRvcDVSb290a2l0c0RldGVjdGVkKFxuICAgICAgICBjb250ZXh0LFxuICAgICAgICBmcm9tLFxuICAgICAgICB0byxcbiAgICAgICAgZmlsdGVycyxcbiAgICAgICAgcGF0dGVybixcbiAgICAgICk7XG4gICAgICBwcmludGVyLmxvZ2dlci5kZWJ1ZygnQWRkaW5nIG1vc3QgY29tbW9uIHJvb3RraXRzJyk7XG4gICAgICBpZiAodG9wNVJvb3RraXRzUmFuayAmJiB0b3A1Um9vdGtpdHNSYW5rLmxlbmd0aCkge1xuICAgICAgICBwcmludGVyXG4gICAgICAgICAgLmFkZENvbnRlbnRXaXRoTmV3TGluZSh7XG4gICAgICAgICAgICB0ZXh0OiAnTW9zdCBjb21tb24gcm9vdGtpdHMgZm91bmQgYW1vbmcgeW91ciBhZ2VudHMnLFxuICAgICAgICAgICAgc3R5bGU6ICdoMicsXG4gICAgICAgICAgfSlcbiAgICAgICAgICAuYWRkQ29udGVudFdpdGhOZXdMaW5lKHtcbiAgICAgICAgICAgIHRleHQ6ICdSb290a2l0cyBhcmUgYSBzZXQgb2Ygc29mdHdhcmUgdG9vbHMgdGhhdCBlbmFibGUgYW4gdW5hdXRob3JpemVkIHVzZXIgdG8gZ2FpbiBjb250cm9sIG9mIGEgY29tcHV0ZXIgc3lzdGVtIHdpdGhvdXQgYmVpbmcgZGV0ZWN0ZWQuJyxcbiAgICAgICAgICAgIHN0eWxlOiAnc3RhbmRhcmQnLFxuICAgICAgICAgIH0pXG4gICAgICAgICAgLmFkZFNpbXBsZVRhYmxlKHtcbiAgICAgICAgICAgIGl0ZW1zOiB0b3A1Um9vdGtpdHNSYW5rLm1hcChpdGVtID0+IHtcbiAgICAgICAgICAgICAgcmV0dXJuIHsgdG9wOiB0b3A1Um9vdGtpdHNSYW5rLmluZGV4T2YoaXRlbSkgKyAxLCBuYW1lOiBpdGVtIH07XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIGNvbHVtbnM6IFtcbiAgICAgICAgICAgICAgeyBpZDogJ3RvcCcsIGxhYmVsOiAnVG9wJyB9LFxuICAgICAgICAgICAgICB7IGlkOiAnbmFtZScsIGxhYmVsOiAnUm9vdGtpdCcgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBwcmludGVyLmxvZ2dlci5kZWJ1ZygnRmV0Y2hpbmcgaGlkZGVuIHBpZHMnKTtcbiAgICAgIGNvbnN0IGhpZGRlblBpZHMgPSBhd2FpdCBSb290Y2hlY2tSZXF1ZXN0LmFnZW50c1dpdGhIaWRkZW5QaWRzKFxuICAgICAgICBjb250ZXh0LFxuICAgICAgICBmcm9tLFxuICAgICAgICB0byxcbiAgICAgICAgZmlsdGVycyxcbiAgICAgICAgcGF0dGVybixcbiAgICAgICk7XG4gICAgICBoaWRkZW5QaWRzICYmXG4gICAgICAgIHByaW50ZXIuYWRkQ29udGVudCh7XG4gICAgICAgICAgdGV4dDogYCR7aGlkZGVuUGlkc30gb2YgJHt0b3RhbEFnZW50c30gYWdlbnRzIGhhdmUgaGlkZGVuIHByb2Nlc3Nlc2AsXG4gICAgICAgICAgc3R5bGU6ICdoMycsXG4gICAgICAgIH0pO1xuICAgICAgIWhpZGRlblBpZHMgJiZcbiAgICAgICAgcHJpbnRlci5hZGRDb250ZW50V2l0aE5ld0xpbmUoe1xuICAgICAgICAgIHRleHQ6IGBObyBhZ2VudHMgaGF2ZSBoaWRkZW4gcHJvY2Vzc2VzYCxcbiAgICAgICAgICBzdHlsZTogJ2gzJyxcbiAgICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGhpZGRlblBvcnRzID0gYXdhaXQgUm9vdGNoZWNrUmVxdWVzdC5hZ2VudHNXaXRoSGlkZGVuUG9ydHMoXG4gICAgICAgIGNvbnRleHQsXG4gICAgICAgIGZyb20sXG4gICAgICAgIHRvLFxuICAgICAgICBmaWx0ZXJzLFxuICAgICAgICBwYXR0ZXJuLFxuICAgICAgKTtcbiAgICAgIGhpZGRlblBvcnRzICYmXG4gICAgICAgIHByaW50ZXIuYWRkQ29udGVudCh7XG4gICAgICAgICAgdGV4dDogYCR7aGlkZGVuUG9ydHN9IG9mICR7dG90YWxBZ2VudHN9IGFnZW50cyBoYXZlIGhpZGRlbiBwb3J0c2AsXG4gICAgICAgICAgc3R5bGU6ICdoMycsXG4gICAgICAgIH0pO1xuICAgICAgIWhpZGRlblBvcnRzICYmXG4gICAgICAgIHByaW50ZXIuYWRkQ29udGVudCh7XG4gICAgICAgICAgdGV4dDogYE5vIGFnZW50cyBoYXZlIGhpZGRlbiBwb3J0c2AsXG4gICAgICAgICAgc3R5bGU6ICdoMycsXG4gICAgICAgIH0pO1xuICAgICAgcHJpbnRlci5hZGROZXdMaW5lKCk7XG4gICAgfVxuXG4gICAgLy8tLS0gT1ZFUlZJRVcvQUdFTlRTIC0gUENJXG4gICAgaWYgKFsnb3ZlcnZpZXcnLCAnYWdlbnRzJ10uaW5jbHVkZXMoc2VjdGlvbikgJiYgdGFiID09PSAncGNpJykge1xuICAgICAgcHJpbnRlci5sb2dnZXIuZGVidWcoJ0ZldGNoaW5nIHRvcCBQQ0kgRFNTIHJlcXVpcmVtZW50cycpO1xuICAgICAgY29uc3QgdG9wUGNpUmVxdWlyZW1lbnRzID0gYXdhaXQgUENJUmVxdWVzdC50b3BQQ0lSZXF1aXJlbWVudHMoXG4gICAgICAgIGNvbnRleHQsXG4gICAgICAgIGZyb20sXG4gICAgICAgIHRvLFxuICAgICAgICBmaWx0ZXJzLFxuICAgICAgICBwYXR0ZXJuLFxuICAgICAgKTtcbiAgICAgIHByaW50ZXIuYWRkQ29udGVudFdpdGhOZXdMaW5lKHtcbiAgICAgICAgdGV4dDogJ01vc3QgY29tbW9uIFBDSSBEU1MgcmVxdWlyZW1lbnRzIGFsZXJ0cyBmb3VuZCcsXG4gICAgICAgIHN0eWxlOiAnaDInLFxuICAgICAgfSk7XG4gICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgdG9wUGNpUmVxdWlyZW1lbnRzKSB7XG4gICAgICAgIGNvbnN0IHJ1bGVzID0gYXdhaXQgUENJUmVxdWVzdC5nZXRSdWxlc0J5UmVxdWlyZW1lbnQoXG4gICAgICAgICAgY29udGV4dCxcbiAgICAgICAgICBmcm9tLFxuICAgICAgICAgIHRvLFxuICAgICAgICAgIGZpbHRlcnMsXG4gICAgICAgICAgaXRlbSxcbiAgICAgICAgICBwYXR0ZXJuLFxuICAgICAgICApO1xuICAgICAgICBwcmludGVyLmFkZENvbnRlbnRXaXRoTmV3TGluZSh7XG4gICAgICAgICAgdGV4dDogYFJlcXVpcmVtZW50ICR7aXRlbX1gLFxuICAgICAgICAgIHN0eWxlOiAnaDMnLFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoUENJW2l0ZW1dKSB7XG4gICAgICAgICAgY29uc3QgY29udGVudCA9XG4gICAgICAgICAgICB0eXBlb2YgUENJW2l0ZW1dID09PSAnc3RyaW5nJ1xuICAgICAgICAgICAgICA/IHsgdGV4dDogUENJW2l0ZW1dLCBzdHlsZTogJ3N0YW5kYXJkJyB9XG4gICAgICAgICAgICAgIDogUENJW2l0ZW1dO1xuICAgICAgICAgIHByaW50ZXIuYWRkQ29udGVudFdpdGhOZXdMaW5lKGNvbnRlbnQpO1xuICAgICAgICB9XG5cbiAgICAgICAgcnVsZXMgJiZcbiAgICAgICAgICBydWxlcy5sZW5ndGggJiZcbiAgICAgICAgICBwcmludGVyLmFkZFNpbXBsZVRhYmxlKHtcbiAgICAgICAgICAgIGNvbHVtbnM6IFtcbiAgICAgICAgICAgICAgeyBpZDogJ3J1bGVJRCcsIGxhYmVsOiAnUnVsZSBJRCcgfSxcbiAgICAgICAgICAgICAgeyBpZDogJ3J1bGVEZXNjcmlwdGlvbicsIGxhYmVsOiAnRGVzY3JpcHRpb24nIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgaXRlbXM6IHJ1bGVzLFxuICAgICAgICAgICAgdGl0bGU6IGBUb3AgcnVsZXMgZm9yICR7aXRlbX0gcmVxdWlyZW1lbnRgLFxuICAgICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vLS0tIE9WRVJWSUVXL0FHRU5UUyAtIFRTQ1xuICAgIGlmIChbJ292ZXJ2aWV3JywgJ2FnZW50cyddLmluY2x1ZGVzKHNlY3Rpb24pICYmIHRhYiA9PT0gJ3RzYycpIHtcbiAgICAgIHByaW50ZXIubG9nZ2VyLmRlYnVnKCdGZXRjaGluZyB0b3AgVFNDIHJlcXVpcmVtZW50cycpO1xuICAgICAgY29uc3QgdG9wVFNDUmVxdWlyZW1lbnRzID0gYXdhaXQgVFNDUmVxdWVzdC50b3BUU0NSZXF1aXJlbWVudHMoXG4gICAgICAgIGNvbnRleHQsXG4gICAgICAgIGZyb20sXG4gICAgICAgIHRvLFxuICAgICAgICBmaWx0ZXJzLFxuICAgICAgICBwYXR0ZXJuLFxuICAgICAgKTtcbiAgICAgIHByaW50ZXIuYWRkQ29udGVudFdpdGhOZXdMaW5lKHtcbiAgICAgICAgdGV4dDogJ01vc3QgY29tbW9uIFRTQyByZXF1aXJlbWVudHMgYWxlcnRzIGZvdW5kJyxcbiAgICAgICAgc3R5bGU6ICdoMicsXG4gICAgICB9KTtcbiAgICAgIGZvciAoY29uc3QgaXRlbSBvZiB0b3BUU0NSZXF1aXJlbWVudHMpIHtcbiAgICAgICAgY29uc3QgcnVsZXMgPSBhd2FpdCBUU0NSZXF1ZXN0LmdldFJ1bGVzQnlSZXF1aXJlbWVudChcbiAgICAgICAgICBjb250ZXh0LFxuICAgICAgICAgIGZyb20sXG4gICAgICAgICAgdG8sXG4gICAgICAgICAgZmlsdGVycyxcbiAgICAgICAgICBpdGVtLFxuICAgICAgICAgIHBhdHRlcm4sXG4gICAgICAgICk7XG4gICAgICAgIHByaW50ZXIuYWRkQ29udGVudFdpdGhOZXdMaW5lKHtcbiAgICAgICAgICB0ZXh0OiBgUmVxdWlyZW1lbnQgJHtpdGVtfWAsXG4gICAgICAgICAgc3R5bGU6ICdoMycsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmIChUU0NbaXRlbV0pIHtcbiAgICAgICAgICBjb25zdCBjb250ZW50ID1cbiAgICAgICAgICAgIHR5cGVvZiBUU0NbaXRlbV0gPT09ICdzdHJpbmcnXG4gICAgICAgICAgICAgID8geyB0ZXh0OiBUU0NbaXRlbV0sIHN0eWxlOiAnc3RhbmRhcmQnIH1cbiAgICAgICAgICAgICAgOiBUU0NbaXRlbV07XG4gICAgICAgICAgcHJpbnRlci5hZGRDb250ZW50V2l0aE5ld0xpbmUoY29udGVudCk7XG4gICAgICAgIH1cblxuICAgICAgICBydWxlcyAmJlxuICAgICAgICAgIHJ1bGVzLmxlbmd0aCAmJlxuICAgICAgICAgIHByaW50ZXIuYWRkU2ltcGxlVGFibGUoe1xuICAgICAgICAgICAgY29sdW1uczogW1xuICAgICAgICAgICAgICB7IGlkOiAncnVsZUlEJywgbGFiZWw6ICdSdWxlIElEJyB9LFxuICAgICAgICAgICAgICB7IGlkOiAncnVsZURlc2NyaXB0aW9uJywgbGFiZWw6ICdEZXNjcmlwdGlvbicgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBpdGVtczogcnVsZXMsXG4gICAgICAgICAgICB0aXRsZTogYFRvcCBydWxlcyBmb3IgJHtpdGVtfSByZXF1aXJlbWVudGAsXG4gICAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8tLS0gT1ZFUlZJRVcvQUdFTlRTIC0gR0RQUlxuICAgIGlmIChbJ292ZXJ2aWV3JywgJ2FnZW50cyddLmluY2x1ZGVzKHNlY3Rpb24pICYmIHRhYiA9PT0gJ2dkcHInKSB7XG4gICAgICBwcmludGVyLmxvZ2dlci5kZWJ1ZygnRmV0Y2hpbmcgdG9wIEdEUFIgcmVxdWlyZW1lbnRzJyk7XG4gICAgICBjb25zdCB0b3BHZHByUmVxdWlyZW1lbnRzID0gYXdhaXQgR0RQUlJlcXVlc3QudG9wR0RQUlJlcXVpcmVtZW50cyhcbiAgICAgICAgY29udGV4dCxcbiAgICAgICAgZnJvbSxcbiAgICAgICAgdG8sXG4gICAgICAgIGZpbHRlcnMsXG4gICAgICAgIHBhdHRlcm4sXG4gICAgICApO1xuICAgICAgcHJpbnRlci5hZGRDb250ZW50V2l0aE5ld0xpbmUoe1xuICAgICAgICB0ZXh0OiAnTW9zdCBjb21tb24gR0RQUiByZXF1aXJlbWVudHMgYWxlcnRzIGZvdW5kJyxcbiAgICAgICAgc3R5bGU6ICdoMicsXG4gICAgICB9KTtcbiAgICAgIGZvciAoY29uc3QgaXRlbSBvZiB0b3BHZHByUmVxdWlyZW1lbnRzKSB7XG4gICAgICAgIGNvbnN0IHJ1bGVzID0gYXdhaXQgR0RQUlJlcXVlc3QuZ2V0UnVsZXNCeVJlcXVpcmVtZW50KFxuICAgICAgICAgIGNvbnRleHQsXG4gICAgICAgICAgZnJvbSxcbiAgICAgICAgICB0byxcbiAgICAgICAgICBmaWx0ZXJzLFxuICAgICAgICAgIGl0ZW0sXG4gICAgICAgICAgcGF0dGVybixcbiAgICAgICAgKTtcbiAgICAgICAgcHJpbnRlci5hZGRDb250ZW50V2l0aE5ld0xpbmUoe1xuICAgICAgICAgIHRleHQ6IGBSZXF1aXJlbWVudCAke2l0ZW19YCxcbiAgICAgICAgICBzdHlsZTogJ2gzJyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKEdEUFIgJiYgR0RQUltpdGVtXSkge1xuICAgICAgICAgIGNvbnN0IGNvbnRlbnQgPVxuICAgICAgICAgICAgdHlwZW9mIEdEUFJbaXRlbV0gPT09ICdzdHJpbmcnXG4gICAgICAgICAgICAgID8geyB0ZXh0OiBHRFBSW2l0ZW1dLCBzdHlsZTogJ3N0YW5kYXJkJyB9XG4gICAgICAgICAgICAgIDogR0RQUltpdGVtXTtcbiAgICAgICAgICBwcmludGVyLmFkZENvbnRlbnRXaXRoTmV3TGluZShjb250ZW50KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJ1bGVzICYmXG4gICAgICAgICAgcnVsZXMubGVuZ3RoICYmXG4gICAgICAgICAgcHJpbnRlci5hZGRTaW1wbGVUYWJsZSh7XG4gICAgICAgICAgICBjb2x1bW5zOiBbXG4gICAgICAgICAgICAgIHsgaWQ6ICdydWxlSUQnLCBsYWJlbDogJ1J1bGUgSUQnIH0sXG4gICAgICAgICAgICAgIHsgaWQ6ICdydWxlRGVzY3JpcHRpb24nLCBsYWJlbDogJ0Rlc2NyaXB0aW9uJyB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIGl0ZW1zOiBydWxlcyxcbiAgICAgICAgICAgIHRpdGxlOiBgVG9wIHJ1bGVzIGZvciAke2l0ZW19IHJlcXVpcmVtZW50YCxcbiAgICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHByaW50ZXIuYWRkTmV3TGluZSgpO1xuICAgIH1cblxuICAgIC8vLS0tIE9WRVJWSUVXIC0gQVVESVRcbiAgICBpZiAoc2VjdGlvbiA9PT0gJ292ZXJ2aWV3JyAmJiB0YWIgPT09ICdhdWRpdCcpIHtcbiAgICAgIHByaW50ZXIubG9nZ2VyLmRlYnVnKFxuICAgICAgICAnRmV0Y2hpbmcgYWdlbnRzIHdpdGggaGlnaCBudW1iZXIgb2YgZmFpbGVkIHN1ZG8gY29tbWFuZHMnLFxuICAgICAgKTtcbiAgICAgIGNvbnN0IGF1ZGl0QWdlbnRzTm9uU3VjY2VzcyA9XG4gICAgICAgIGF3YWl0IEF1ZGl0UmVxdWVzdC5nZXRUb3AzQWdlbnRzU3Vkb05vblN1Y2Nlc3NmdWwoXG4gICAgICAgICAgY29udGV4dCxcbiAgICAgICAgICBmcm9tLFxuICAgICAgICAgIHRvLFxuICAgICAgICAgIGZpbHRlcnMsXG4gICAgICAgICAgcGF0dGVybixcbiAgICAgICAgKTtcbiAgICAgIGlmIChhdWRpdEFnZW50c05vblN1Y2Nlc3MgJiYgYXVkaXRBZ2VudHNOb25TdWNjZXNzLmxlbmd0aCkge1xuICAgICAgICBwcmludGVyLmFkZENvbnRlbnQoe1xuICAgICAgICAgIHRleHQ6ICdBZ2VudHMgd2l0aCBoaWdoIG51bWJlciBvZiBmYWlsZWQgc3VkbyBjb21tYW5kcycsXG4gICAgICAgICAgc3R5bGU6ICdoMicsXG4gICAgICAgIH0pO1xuICAgICAgICBhd2FpdCBidWlsZEFnZW50c1RhYmxlKGNvbnRleHQsIHByaW50ZXIsIGF1ZGl0QWdlbnRzTm9uU3VjY2VzcywgYXBpSWQpO1xuICAgICAgfVxuICAgICAgY29uc3QgYXVkaXRBZ2VudHNGYWlsZWRTeXNjYWxsID1cbiAgICAgICAgYXdhaXQgQXVkaXRSZXF1ZXN0LmdldFRvcDNBZ2VudHNGYWlsZWRTeXNjYWxscyhcbiAgICAgICAgICBjb250ZXh0LFxuICAgICAgICAgIGZyb20sXG4gICAgICAgICAgdG8sXG4gICAgICAgICAgZmlsdGVycyxcbiAgICAgICAgICBwYXR0ZXJuLFxuICAgICAgICApO1xuICAgICAgaWYgKGF1ZGl0QWdlbnRzRmFpbGVkU3lzY2FsbCAmJiBhdWRpdEFnZW50c0ZhaWxlZFN5c2NhbGwubGVuZ3RoKSB7XG4gICAgICAgIHByaW50ZXIuYWRkU2ltcGxlVGFibGUoe1xuICAgICAgICAgIGNvbHVtbnM6IFtcbiAgICAgICAgICAgIHsgaWQ6ICdhZ2VudCcsIGxhYmVsOiAnQWdlbnQgSUQnIH0sXG4gICAgICAgICAgICB7IGlkOiAnc3lzY2FsbF9pZCcsIGxhYmVsOiAnU3lzY2FsbCBJRCcgfSxcbiAgICAgICAgICAgIHsgaWQ6ICdzeXNjYWxsX3N5c2NhbGwnLCBsYWJlbDogJ1N5c2NhbGwnIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgICBpdGVtczogYXVkaXRBZ2VudHNGYWlsZWRTeXNjYWxsLm1hcChpdGVtID0+ICh7XG4gICAgICAgICAgICBhZ2VudDogaXRlbS5hZ2VudCxcbiAgICAgICAgICAgIHN5c2NhbGxfaWQ6IGl0ZW0uc3lzY2FsbC5pZCxcbiAgICAgICAgICAgIHN5c2NhbGxfc3lzY2FsbDogaXRlbS5zeXNjYWxsLnN5c2NhbGwsXG4gICAgICAgICAgfSkpLFxuICAgICAgICAgIHRpdGxlOiB7XG4gICAgICAgICAgICB0ZXh0OiAnTW9zdCBjb21tb24gZmFpbGluZyBzeXNjYWxscycsXG4gICAgICAgICAgICBzdHlsZTogJ2gyJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLy0tLSBPVkVSVklFVyAtIEZJTVxuICAgIGlmIChzZWN0aW9uID09PSAnb3ZlcnZpZXcnICYmIHRhYiA9PT0gJ2ZpbScpIHtcbiAgICAgIHByaW50ZXIubG9nZ2VyLmRlYnVnKCdGZXRjaGluZyB0b3AgMyBydWxlcyBmb3IgRklNJyk7XG4gICAgICBjb25zdCBydWxlcyA9IGF3YWl0IFN5c2NoZWNrUmVxdWVzdC50b3AzUnVsZXMoXG4gICAgICAgIGNvbnRleHQsXG4gICAgICAgIGZyb20sXG4gICAgICAgIHRvLFxuICAgICAgICBmaWx0ZXJzLFxuICAgICAgICBwYXR0ZXJuLFxuICAgICAgKTtcblxuICAgICAgaWYgKHJ1bGVzICYmIHJ1bGVzLmxlbmd0aCkge1xuICAgICAgICBwcmludGVyXG4gICAgICAgICAgLmFkZENvbnRlbnRXaXRoTmV3TGluZSh7IHRleHQ6ICdUb3AgMyBGSU0gcnVsZXMnLCBzdHlsZTogJ2gyJyB9KVxuICAgICAgICAgIC5hZGRTaW1wbGVUYWJsZSh7XG4gICAgICAgICAgICBjb2x1bW5zOiBbXG4gICAgICAgICAgICAgIHsgaWQ6ICdydWxlSUQnLCBsYWJlbDogJ1J1bGUgSUQnIH0sXG4gICAgICAgICAgICAgIHsgaWQ6ICdydWxlRGVzY3JpcHRpb24nLCBsYWJlbDogJ0Rlc2NyaXB0aW9uJyB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIGl0ZW1zOiBydWxlcyxcbiAgICAgICAgICAgIHRpdGxlOiB7XG4gICAgICAgICAgICAgIHRleHQ6ICdUb3AgMyBydWxlcyB0aGF0IGFyZSBnZW5lcmF0aW5nIG1vc3QgYWxlcnRzLicsXG4gICAgICAgICAgICAgIHN0eWxlOiAnc3RhbmRhcmQnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgcHJpbnRlci5sb2dnZXIuZGVidWcoJ0ZldGNoaW5nIHRvcCAzIGFnZW50cyBmb3IgRklNJyk7XG4gICAgICBjb25zdCBhZ2VudHMgPSBhd2FpdCBTeXNjaGVja1JlcXVlc3QudG9wM2FnZW50cyhcbiAgICAgICAgY29udGV4dCxcbiAgICAgICAgZnJvbSxcbiAgICAgICAgdG8sXG4gICAgICAgIGZpbHRlcnMsXG4gICAgICAgIHBhdHRlcm4sXG4gICAgICApO1xuXG4gICAgICBpZiAoYWdlbnRzICYmIGFnZW50cy5sZW5ndGgpIHtcbiAgICAgICAgcHJpbnRlci5hZGRDb250ZW50V2l0aE5ld0xpbmUoe1xuICAgICAgICAgIHRleHQ6ICdBZ2VudHMgd2l0aCBzdXNwaWNpb3VzIEZJTSBhY3Rpdml0eScsXG4gICAgICAgICAgc3R5bGU6ICdoMicsXG4gICAgICAgIH0pO1xuICAgICAgICBwcmludGVyLmFkZENvbnRlbnRXaXRoTmV3TGluZSh7XG4gICAgICAgICAgdGV4dDogJ1RvcCAzIGFnZW50cyB0aGF0IGhhdmUgbW9zdCBGSU0gYWxlcnRzIGZyb20gbGV2ZWwgNyB0byBsZXZlbCAxNS4gVGFrZSBjYXJlIGFib3V0IHRoZW0uJyxcbiAgICAgICAgICBzdHlsZTogJ3N0YW5kYXJkJyxcbiAgICAgICAgfSk7XG4gICAgICAgIGF3YWl0IGJ1aWxkQWdlbnRzVGFibGUoY29udGV4dCwgcHJpbnRlciwgYWdlbnRzLCBhcGlJZCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8tLS0gQUdFTlRTIC0gQVVESVRcbiAgICBpZiAoc2VjdGlvbiA9PT0gJ2FnZW50cycgJiYgdGFiID09PSAnYXVkaXQnKSB7XG4gICAgICBwcmludGVyLmxvZ2dlci5kZWJ1ZygnRmV0Y2hpbmcgbW9zdCBjb21tb24gZmFpbGVkIHN5c2NhbGxzJyk7XG4gICAgICBjb25zdCBhdWRpdEZhaWxlZFN5c2NhbGwgPSBhd2FpdCBBdWRpdFJlcXVlc3QuZ2V0VG9wRmFpbGVkU3lzY2FsbHMoXG4gICAgICAgIGNvbnRleHQsXG4gICAgICAgIGZyb20sXG4gICAgICAgIHRvLFxuICAgICAgICBmaWx0ZXJzLFxuICAgICAgICBwYXR0ZXJuLFxuICAgICAgKTtcbiAgICAgIGF1ZGl0RmFpbGVkU3lzY2FsbCAmJlxuICAgICAgICBhdWRpdEZhaWxlZFN5c2NhbGwubGVuZ3RoICYmXG4gICAgICAgIHByaW50ZXIuYWRkU2ltcGxlVGFibGUoe1xuICAgICAgICAgIGNvbHVtbnM6IFtcbiAgICAgICAgICAgIHsgaWQ6ICdpZCcsIGxhYmVsOiAnaWQnIH0sXG4gICAgICAgICAgICB7IGlkOiAnc3lzY2FsbCcsIGxhYmVsOiAnU3lzY2FsbCcgfSxcbiAgICAgICAgICBdLFxuICAgICAgICAgIGl0ZW1zOiBhdWRpdEZhaWxlZFN5c2NhbGwsXG4gICAgICAgICAgdGl0bGU6ICdNb3N0IGNvbW1vbiBmYWlsaW5nIHN5c2NhbGxzJyxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8tLS0gQUdFTlRTIC0gRklNXG4gICAgaWYgKHNlY3Rpb24gPT09ICdhZ2VudHMnICYmIHRhYiA9PT0gJ2ZpbScpIHtcbiAgICAgIHByaW50ZXIubG9nZ2VyLmRlYnVnKGBGZXRjaGluZyBzeXNjaGVjayBkYXRhYmFzZSBmb3IgYWdlbnQgJHthZ2VudH1gKTtcblxuICAgICAgY29uc3QgbGFzdFNjYW5SZXNwb25zZSA9XG4gICAgICAgIGF3YWl0IGNvbnRleHQud2F6dWguYXBpLmNsaWVudC5hc0N1cnJlbnRVc2VyLnJlcXVlc3QoXG4gICAgICAgICAgJ0dFVCcsXG4gICAgICAgICAgYC9zeXNjaGVjay8ke2FnZW50fS9sYXN0X3NjYW5gLFxuICAgICAgICAgIHt9LFxuICAgICAgICAgIHsgYXBpSG9zdElEOiBhcGlJZCB9LFxuICAgICAgICApO1xuXG4gICAgICBpZiAobGFzdFNjYW5SZXNwb25zZSAmJiBsYXN0U2NhblJlc3BvbnNlLmRhdGEpIHtcbiAgICAgICAgY29uc3QgbGFzdFNjYW5EYXRhID0gbGFzdFNjYW5SZXNwb25zZS5kYXRhLmRhdGEuYWZmZWN0ZWRfaXRlbXNbMF07XG4gICAgICAgIGlmIChsYXN0U2NhbkRhdGEuc3RhcnQgJiYgbGFzdFNjYW5EYXRhLmVuZCkge1xuICAgICAgICAgIHByaW50ZXIuYWRkQ29udGVudCh7XG4gICAgICAgICAgICB0ZXh0OiBgTGFzdCBmaWxlIGludGVncml0eSBtb25pdG9yaW5nIHNjYW4gd2FzIGV4ZWN1dGVkIGZyb20gJHtsYXN0U2NhbkRhdGEuc3RhcnR9IHRvICR7bGFzdFNjYW5EYXRhLmVuZH0uYCxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIGlmIChsYXN0U2NhbkRhdGEuc3RhcnQpIHtcbiAgICAgICAgICBwcmludGVyLmFkZENvbnRlbnQoe1xuICAgICAgICAgICAgdGV4dDogYEZpbGUgaW50ZWdyaXR5IG1vbml0b3Jpbmcgc2NhbiBpcyBjdXJyZW50bHkgaW4gcHJvZ3Jlc3MgZm9yIHRoaXMgYWdlbnQgKHN0YXJ0ZWQgb24gJHtsYXN0U2NhbkRhdGEuc3RhcnR9KS5gLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHByaW50ZXIuYWRkQ29udGVudCh7XG4gICAgICAgICAgICB0ZXh0OiBgRmlsZSBpbnRlZ3JpdHkgbW9uaXRvcmluZyBzY2FuIGlzIGN1cnJlbnRseSBpbiBwcm9ncmVzcyBmb3IgdGhpcyBhZ2VudC5gLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHByaW50ZXIuYWRkTmV3TGluZSgpO1xuICAgICAgfVxuXG4gICAgICBwcmludGVyLmxvZ2dlci5kZWJ1ZygnRmV0Y2hpbmcgbGFzdCAxMCBkZWxldGVkIGZpbGVzIGZvciBGSU0nKTtcbiAgICAgIGNvbnN0IGxhc3RUZW5EZWxldGVkID0gYXdhaXQgU3lzY2hlY2tSZXF1ZXN0Lmxhc3RUZW5EZWxldGVkRmlsZXMoXG4gICAgICAgIGNvbnRleHQsXG4gICAgICAgIGZyb20sXG4gICAgICAgIHRvLFxuICAgICAgICBmaWx0ZXJzLFxuICAgICAgICBwYXR0ZXJuLFxuICAgICAgKTtcblxuICAgICAgbGFzdFRlbkRlbGV0ZWQgJiZcbiAgICAgICAgbGFzdFRlbkRlbGV0ZWQubGVuZ3RoICYmXG4gICAgICAgIHByaW50ZXIuYWRkU2ltcGxlVGFibGUoe1xuICAgICAgICAgIGNvbHVtbnM6IFtcbiAgICAgICAgICAgIHsgaWQ6ICdwYXRoJywgbGFiZWw6ICdQYXRoJyB9LFxuICAgICAgICAgICAgeyBpZDogJ2RhdGUnLCBsYWJlbDogJ0RhdGUnIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgICBpdGVtczogbGFzdFRlbkRlbGV0ZWQsXG4gICAgICAgICAgdGl0bGU6ICdMYXN0IDEwIGRlbGV0ZWQgZmlsZXMnLFxuICAgICAgICB9KTtcblxuICAgICAgcHJpbnRlci5sb2dnZXIuZGVidWcoJ0ZldGNoaW5nIGxhc3QgMTAgbW9kaWZpZWQgZmlsZXMnKTtcbiAgICAgIGNvbnN0IGxhc3RUZW5Nb2RpZmllZCA9IGF3YWl0IFN5c2NoZWNrUmVxdWVzdC5sYXN0VGVuTW9kaWZpZWRGaWxlcyhcbiAgICAgICAgY29udGV4dCxcbiAgICAgICAgZnJvbSxcbiAgICAgICAgdG8sXG4gICAgICAgIGZpbHRlcnMsXG4gICAgICAgIHBhdHRlcm4sXG4gICAgICApO1xuXG4gICAgICBsYXN0VGVuTW9kaWZpZWQgJiZcbiAgICAgICAgbGFzdFRlbk1vZGlmaWVkLmxlbmd0aCAmJlxuICAgICAgICBwcmludGVyLmFkZFNpbXBsZVRhYmxlKHtcbiAgICAgICAgICBjb2x1bW5zOiBbXG4gICAgICAgICAgICB7IGlkOiAncGF0aCcsIGxhYmVsOiAnUGF0aCcgfSxcbiAgICAgICAgICAgIHsgaWQ6ICdkYXRlJywgbGFiZWw6ICdEYXRlJyB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICAgaXRlbXM6IGxhc3RUZW5Nb2RpZmllZCxcbiAgICAgICAgICB0aXRsZTogJ0xhc3QgMTAgbW9kaWZpZWQgZmlsZXMnLFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLy0tLSBBR0VOVFMgLSBWVUxORVJBQklMSVRJRVNcbiAgICBpZiAoc2VjdGlvbiA9PT0gJ2FnZW50cycgJiYgdGFiID09PSAndnVscycpIHtcbiAgICAgIGNvbnN0IHRvcENyaXRpY2FsUGFja2FnZXMgPSBhd2FpdCBWdWxuZXJhYmlsaXR5UmVxdWVzdC50b3BQYWNrYWdlc1dpdGhDVkUoXG4gICAgICAgIGNvbnRleHQsXG4gICAgICAgIGZyb20sXG4gICAgICAgIHRvLFxuICAgICAgICAnQ3JpdGljYWwnLFxuICAgICAgICBmaWx0ZXJzLFxuICAgICAgICBwYXR0ZXJuLFxuICAgICAgKTtcbiAgICAgIGlmICh0b3BDcml0aWNhbFBhY2thZ2VzICYmIHRvcENyaXRpY2FsUGFja2FnZXMubGVuZ3RoKSB7XG4gICAgICAgIHByaW50ZXIuYWRkQ29udGVudFdpdGhOZXdMaW5lKHtcbiAgICAgICAgICB0ZXh0OiAnQ3JpdGljYWwgc2V2ZXJpdHknLFxuICAgICAgICAgIHN0eWxlOiAnaDInLFxuICAgICAgICB9KTtcbiAgICAgICAgcHJpbnRlci5hZGRDb250ZW50V2l0aE5ld0xpbmUoe1xuICAgICAgICAgIHRleHQ6ICdUaGVzZSB2dWxuZXJhYmlsdGllcyBhcmUgY3JpdGljYWwsIHBsZWFzZSByZXZpZXcgeW91ciBhZ2VudC4gQ2xpY2sgb24gZWFjaCBsaW5rIHRvIHJlYWQgbW9yZSBhYm91dCBlYWNoIGZvdW5kIHZ1bG5lcmFiaWxpdHkuJyxcbiAgICAgICAgICBzdHlsZTogJ3N0YW5kYXJkJyxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IGN1c3RvbXVsID0gW107XG4gICAgICAgIGZvciAoY29uc3QgY3JpdGljYWwgb2YgdG9wQ3JpdGljYWxQYWNrYWdlcykge1xuICAgICAgICAgIGN1c3RvbXVsLnB1c2goeyB0ZXh0OiBjcml0aWNhbC5wYWNrYWdlLCBzdHlsZTogJ3N0YW5kYXJkJyB9KTtcbiAgICAgICAgICBjdXN0b211bC5wdXNoKHtcbiAgICAgICAgICAgIHVsOiBjcml0aWNhbC5yZWZlcmVuY2VzLm1hcChpdGVtID0+ICh7XG4gICAgICAgICAgICAgIHRleHQ6IGl0ZW0uc3Vic3RyaW5nKDAsIDgwKSArICcuLi4nLFxuICAgICAgICAgICAgICBsaW5rOiBpdGVtLFxuICAgICAgICAgICAgICBjb2xvcjogJyMxRUE1QzgnLFxuICAgICAgICAgICAgfSkpLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHByaW50ZXIuYWRkQ29udGVudFdpdGhOZXdMaW5lKHsgdWw6IGN1c3RvbXVsIH0pO1xuICAgICAgfVxuXG4gICAgICBjb25zdCB0b3BIaWdoUGFja2FnZXMgPSBhd2FpdCBWdWxuZXJhYmlsaXR5UmVxdWVzdC50b3BQYWNrYWdlc1dpdGhDVkUoXG4gICAgICAgIGNvbnRleHQsXG4gICAgICAgIGZyb20sXG4gICAgICAgIHRvLFxuICAgICAgICAnSGlnaCcsXG4gICAgICAgIGZpbHRlcnMsXG4gICAgICAgIHBhdHRlcm4sXG4gICAgICApO1xuICAgICAgaWYgKHRvcEhpZ2hQYWNrYWdlcyAmJiB0b3BIaWdoUGFja2FnZXMubGVuZ3RoKSB7XG4gICAgICAgIHByaW50ZXIuYWRkQ29udGVudFdpdGhOZXdMaW5lKHsgdGV4dDogJ0hpZ2ggc2V2ZXJpdHknLCBzdHlsZTogJ2gyJyB9KTtcbiAgICAgICAgcHJpbnRlci5hZGRDb250ZW50V2l0aE5ld0xpbmUoe1xuICAgICAgICAgIHRleHQ6ICdDbGljayBvbiBlYWNoIGxpbmsgdG8gcmVhZCBtb3JlIGFib3V0IGVhY2ggZm91bmQgdnVsbmVyYWJpbGl0eS4nLFxuICAgICAgICAgIHN0eWxlOiAnc3RhbmRhcmQnLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgY3VzdG9tdWwgPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCBjcml0aWNhbCBvZiB0b3BIaWdoUGFja2FnZXMpIHtcbiAgICAgICAgICBjdXN0b211bC5wdXNoKHsgdGV4dDogY3JpdGljYWwucGFja2FnZSwgc3R5bGU6ICdzdGFuZGFyZCcgfSk7XG4gICAgICAgICAgY3VzdG9tdWwucHVzaCh7XG4gICAgICAgICAgICB1bDogY3JpdGljYWwucmVmZXJlbmNlcy5tYXAoaXRlbSA9PiAoe1xuICAgICAgICAgICAgICB0ZXh0OiBpdGVtLFxuICAgICAgICAgICAgICBjb2xvcjogJyMxRUE1QzgnLFxuICAgICAgICAgICAgfSkpLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGN1c3RvbXVsICYmIGN1c3RvbXVsLmxlbmd0aCAmJiBwcmludGVyLmFkZENvbnRlbnQoeyB1bDogY3VzdG9tdWwgfSk7XG4gICAgICAgIHByaW50ZXIuYWRkTmV3TGluZSgpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vLS0tIFNVTU1BUlkgVEFCTEVTXG4gICAgbGV0IGV4dHJhU3VtbWFyeVRhYmxlcyA9IFtdO1xuICAgIGlmIChBcnJheS5pc0FycmF5KHN1bW1hcnlUYWJsZXNEZWZpbml0aW9uc1tzZWN0aW9uXVt0YWJdKSkge1xuICAgICAgY29uc3QgdGFibGVzUHJvbWlzZXMgPSBzdW1tYXJ5VGFibGVzRGVmaW5pdGlvbnNbc2VjdGlvbl1bdGFiXS5tYXAoXG4gICAgICAgIHN1bW1hcnlUYWJsZSA9PiB7XG4gICAgICAgICAgcHJpbnRlci5sb2dnZXIuZGVidWcoYEZldGNoaW5nICR7c3VtbWFyeVRhYmxlLnRpdGxlfSBUYWJsZWApO1xuICAgICAgICAgIGNvbnN0IGFsZXJ0c1N1bW1hcnlUYWJsZSA9IG5ldyBTdW1tYXJ5VGFibGUoXG4gICAgICAgICAgICBjb250ZXh0LFxuICAgICAgICAgICAgZnJvbSxcbiAgICAgICAgICAgIHRvLFxuICAgICAgICAgICAgZmlsdGVycyxcbiAgICAgICAgICAgIHN1bW1hcnlUYWJsZSxcbiAgICAgICAgICAgIHBhdHRlcm4sXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm4gYWxlcnRzU3VtbWFyeVRhYmxlLmZldGNoKCk7XG4gICAgICAgIH0sXG4gICAgICApO1xuICAgICAgZXh0cmFTdW1tYXJ5VGFibGVzID0gYXdhaXQgUHJvbWlzZS5hbGwodGFibGVzUHJvbWlzZXMpO1xuICAgIH1cblxuICAgIHJldHVybiBleHRyYVN1bW1hcnlUYWJsZXM7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcHJpbnRlci5sb2dnZXIuZXJyb3IoZXJyb3IubWVzc2FnZSB8fCBlcnJvcik7XG4gICAgcmV0dXJuIFByb21pc2UucmVqZWN0KGVycm9yKTtcbiAgfVxufVxuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQUEsSUFBQUEsYUFBQSxHQUFBQyxzQkFBQSxDQUFBQyxPQUFBO0FBQ0EsSUFBQUMseUJBQUEsR0FBQUYsc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFFLG9CQUFBLEdBQUFDLHVCQUFBLENBQUFILE9BQUE7QUFDQSxJQUFBSSxlQUFBLEdBQUFELHVCQUFBLENBQUFILE9BQUE7QUFDQSxJQUFBSyxnQkFBQSxHQUFBRix1QkFBQSxDQUFBSCxPQUFBO0FBQ0EsSUFBQU0sVUFBQSxHQUFBSCx1QkFBQSxDQUFBSCxPQUFBO0FBQ0EsSUFBQU8sV0FBQSxHQUFBSix1QkFBQSxDQUFBSCxPQUFBO0FBQ0EsSUFBQVEsVUFBQSxHQUFBTCx1QkFBQSxDQUFBSCxPQUFBO0FBQ0EsSUFBQVMsWUFBQSxHQUFBTix1QkFBQSxDQUFBSCxPQUFBO0FBQ0EsSUFBQVUsZUFBQSxHQUFBUCx1QkFBQSxDQUFBSCxPQUFBO0FBQ0EsSUFBQVcsdUJBQUEsR0FBQVosc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFZLHdCQUFBLEdBQUFiLHNCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBYSx1QkFBQSxHQUFBZCxzQkFBQSxDQUFBQyxPQUFBO0FBRUEsSUFBQWMsT0FBQSxHQUFBZixzQkFBQSxDQUFBQyxPQUFBO0FBQTRCLFNBQUFlLHlCQUFBQyxDQUFBLDZCQUFBQyxPQUFBLG1CQUFBQyxDQUFBLE9BQUFELE9BQUEsSUFBQUUsQ0FBQSxPQUFBRixPQUFBLFlBQUFGLHdCQUFBLFlBQUFBLENBQUFDLENBQUEsV0FBQUEsQ0FBQSxHQUFBRyxDQUFBLEdBQUFELENBQUEsS0FBQUYsQ0FBQTtBQUFBLFNBQUFiLHdCQUFBYSxDQUFBLEVBQUFFLENBQUEsU0FBQUEsQ0FBQSxJQUFBRixDQUFBLElBQUFBLENBQUEsQ0FBQUksVUFBQSxTQUFBSixDQUFBLGVBQUFBLENBQUEsdUJBQUFBLENBQUEseUJBQUFBLENBQUEsV0FBQUssT0FBQSxFQUFBTCxDQUFBLFFBQUFHLENBQUEsR0FBQUosd0JBQUEsQ0FBQUcsQ0FBQSxPQUFBQyxDQUFBLElBQUFBLENBQUEsQ0FBQUcsR0FBQSxDQUFBTixDQUFBLFVBQUFHLENBQUEsQ0FBQUksR0FBQSxDQUFBUCxDQUFBLE9BQUFRLENBQUEsS0FBQUMsU0FBQSxVQUFBQyxDQUFBLEdBQUFDLE1BQUEsQ0FBQUMsY0FBQSxJQUFBRCxNQUFBLENBQUFFLHdCQUFBLFdBQUFDLENBQUEsSUFBQWQsQ0FBQSxvQkFBQWMsQ0FBQSxPQUFBQyxjQUFBLENBQUFDLElBQUEsQ0FBQWhCLENBQUEsRUFBQWMsQ0FBQSxTQUFBRyxDQUFBLEdBQUFQLENBQUEsR0FBQUMsTUFBQSxDQUFBRSx3QkFBQSxDQUFBYixDQUFBLEVBQUFjLENBQUEsVUFBQUcsQ0FBQSxLQUFBQSxDQUFBLENBQUFWLEdBQUEsSUFBQVUsQ0FBQSxDQUFBQyxHQUFBLElBQUFQLE1BQUEsQ0FBQUMsY0FBQSxDQUFBSixDQUFBLEVBQUFNLENBQUEsRUFBQUcsQ0FBQSxJQUFBVCxDQUFBLENBQUFNLENBQUEsSUFBQWQsQ0FBQSxDQUFBYyxDQUFBLFlBQUFOLENBQUEsQ0FBQUgsT0FBQSxHQUFBTCxDQUFBLEVBQUFHLENBQUEsSUFBQUEsQ0FBQSxDQUFBZSxHQUFBLENBQUFsQixDQUFBLEVBQUFRLENBQUEsR0FBQUEsQ0FBQTtBQUFBLFNBQUF6Qix1QkFBQWlCLENBQUEsV0FBQUEsQ0FBQSxJQUFBQSxDQUFBLENBQUFJLFVBQUEsR0FBQUosQ0FBQSxLQUFBSyxPQUFBLEVBQUFMLENBQUE7QUFFNUI7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNPLGVBQWVtQixnQkFBZ0JBLENBQ3BDQyxPQUFPLEVBQ1BDLE9BQXNCLEVBQ3RCQyxRQUFrQixFQUNsQkMsS0FBYSxFQUNiQyxPQUFlLEdBQUcsRUFBRSxFQUNwQjtFQUNBLE1BQU1DLFVBQVUsR0FBRyxNQUFNTCxPQUFPLENBQUNNLElBQUksQ0FBQ0MsVUFBVSxDQUFDQyxNQUFNLENBQUNyQixHQUFHLENBQUMsWUFBWSxDQUFDO0VBQ3pFLElBQUksQ0FBQyxDQUFDZSxRQUFRLElBQUksQ0FBQ0EsUUFBUSxDQUFDTyxNQUFNLEtBQUssQ0FBQ0wsT0FBTyxFQUFFO0VBQ2pESCxPQUFPLENBQUNTLE1BQU0sQ0FBQ0MsS0FBSyxDQUFFLEdBQUVULFFBQVEsQ0FBQ08sTUFBTyxtQkFBa0JOLEtBQU0sRUFBQyxDQUFDO0VBQ2xFLElBQUk7SUFDRixJQUFJUyxVQUFVLEdBQUcsRUFBRTtJQUNuQixJQUFJUixPQUFPLEVBQUU7TUFDWCxJQUFJUyxrQkFBa0IsR0FBRyxJQUFJO01BQzdCLEdBQUc7UUFDRCxNQUFNO1VBQ0pDLElBQUksRUFBRTtZQUNKQSxJQUFJLEVBQUU7Y0FBRUMsY0FBYztjQUFFQztZQUFxQjtVQUMvQztRQUNGLENBQUMsR0FBRyxNQUFNaEIsT0FBTyxDQUFDaUIsS0FBSyxDQUFDQyxHQUFHLENBQUNWLE1BQU0sQ0FBQ1csYUFBYSxDQUFDQyxPQUFPLENBQ3RELEtBQUssRUFDSixXQUFVaEIsT0FBUSxTQUFRLEVBQzNCO1VBQ0VpQixNQUFNLEVBQUU7WUFDTkMsTUFBTSxFQUFFVixVQUFVLENBQUNILE1BQU07WUFDekJjLE1BQU0sRUFDSjtVQUNKO1FBQ0YsQ0FBQyxFQUNEO1VBQUVDLFNBQVMsRUFBRXJCO1FBQU0sQ0FDckIsQ0FBQztRQUNELENBQUNVLGtCQUFrQixLQUFLQSxrQkFBa0IsR0FBR0csb0JBQW9CLENBQUM7UUFDbEVKLFVBQVUsR0FBRyxDQUFDLEdBQUdBLFVBQVUsRUFBRSxHQUFHRyxjQUFjLENBQUM7TUFDakQsQ0FBQyxRQUFRSCxVQUFVLENBQUNILE1BQU0sR0FBR0ksa0JBQWtCO0lBQ2pELENBQUMsTUFBTTtNQUNMLEtBQUssTUFBTVksT0FBTyxJQUFJdkIsUUFBUSxFQUFFO1FBQzlCLElBQUk7VUFDRixNQUFNO1lBQ0pZLElBQUksRUFBRTtjQUNKQSxJQUFJLEVBQUU7Z0JBQ0pDLGNBQWMsRUFBRSxDQUFDVyxLQUFLO2NBQ3hCO1lBQ0Y7VUFDRixDQUFDLEdBQUcsTUFBTTFCLE9BQU8sQ0FBQ2lCLEtBQUssQ0FBQ0MsR0FBRyxDQUFDVixNQUFNLENBQUNXLGFBQWEsQ0FBQ0MsT0FBTyxDQUN0RCxLQUFLLEVBQ0osU0FBUSxFQUNUO1lBQ0VDLE1BQU0sRUFBRTtjQUNOTSxDQUFDLEVBQUcsTUFBS0YsT0FBUSxFQUFDO2NBQ2xCRixNQUFNLEVBQ0o7WUFDSjtVQUNGLENBQUMsRUFDRDtZQUFFQyxTQUFTLEVBQUVyQjtVQUFNLENBQ3JCLENBQUM7VUFDRFMsVUFBVSxDQUFDZ0IsSUFBSSxDQUFDRixLQUFLLENBQUM7UUFDeEIsQ0FBQyxDQUFDLE9BQU9HLEtBQUssRUFBRTtVQUNkNUIsT0FBTyxDQUFDUyxNQUFNLENBQUNDLEtBQUssQ0FBRSxzQkFBcUJrQixLQUFLLENBQUNDLE9BQU8sSUFBSUQsS0FBTSxFQUFDLENBQUM7UUFDdEU7TUFDRjtJQUNGO0lBRUEsSUFBSWpCLFVBQVUsQ0FBQ0gsTUFBTSxFQUFFO01BQ3JCO01BQ0FSLE9BQU8sQ0FBQzhCLGNBQWMsQ0FBQztRQUNyQkMsT0FBTyxFQUFFLENBQ1A7VUFBRUMsRUFBRSxFQUFFLElBQUk7VUFBRUMsS0FBSyxFQUFFO1FBQUssQ0FBQyxFQUN6QjtVQUFFRCxFQUFFLEVBQUUsTUFBTTtVQUFFQyxLQUFLLEVBQUU7UUFBTyxDQUFDLEVBQzdCO1VBQUVELEVBQUUsRUFBRSxJQUFJO1VBQUVDLEtBQUssRUFBRTtRQUFhLENBQUMsRUFDakM7VUFBRUQsRUFBRSxFQUFFLFNBQVM7VUFBRUMsS0FBSyxFQUFFO1FBQVUsQ0FBQyxFQUNuQztVQUFFRCxFQUFFLEVBQUUsU0FBUztVQUFFQyxLQUFLLEVBQUU7UUFBVSxDQUFDLEVBQ25DO1VBQUVELEVBQUUsRUFBRSxJQUFJO1VBQUVDLEtBQUssRUFBRTtRQUFtQixDQUFDLEVBQ3ZDO1VBQUVELEVBQUUsRUFBRSxTQUFTO1VBQUVDLEtBQUssRUFBRTtRQUFvQixDQUFDLEVBQzdDO1VBQUVELEVBQUUsRUFBRSxlQUFlO1VBQUVDLEtBQUssRUFBRTtRQUFrQixDQUFDLENBQ2xEO1FBQ0RDLEtBQUssRUFBRXZCLFVBQVUsQ0FDZHdCLE1BQU0sQ0FBQ1YsS0FBSyxJQUFJQSxLQUFLLENBQUMsQ0FBQztRQUFBLENBQ3ZCVyxHQUFHLENBQUNYLEtBQUssSUFBSTtVQUNaLE9BQU87WUFDTCxHQUFHQSxLQUFLO1lBQ1JZLEVBQUUsRUFDQVosS0FBSyxDQUFDWSxFQUFFLElBQUlaLEtBQUssQ0FBQ1ksRUFBRSxDQUFDQyxJQUFJLElBQUliLEtBQUssQ0FBQ1ksRUFBRSxDQUFDRSxPQUFPLEdBQ3hDLEdBQUVkLEtBQUssQ0FBQ1ksRUFBRSxDQUFDQyxJQUFLLElBQUdiLEtBQUssQ0FBQ1ksRUFBRSxDQUFDRSxPQUFRLEVBQUMsR0FDdEMsRUFBRTtZQUNSQyxhQUFhLEVBQUUsSUFBQUMsZUFBTSxFQUFDaEIsS0FBSyxDQUFDZSxhQUFhLENBQUMsQ0FBQ0UsTUFBTSxDQUFDdEMsVUFBVSxDQUFDO1lBQzdEdUMsT0FBTyxFQUFFLElBQUFGLGVBQU0sRUFBQ2hCLEtBQUssQ0FBQ2tCLE9BQU8sQ0FBQyxDQUFDRCxNQUFNLENBQUN0QyxVQUFVO1VBQ2xELENBQUM7UUFDSCxDQUFDO01BQ0wsQ0FBQyxDQUFDO0lBQ0osQ0FBQyxNQUFNLElBQUksQ0FBQ08sVUFBVSxDQUFDSCxNQUFNLElBQUlMLE9BQU8sRUFBRTtNQUN4QztNQUNBSCxPQUFPLENBQUM0QyxVQUFVLENBQUM7UUFDakJDLElBQUksRUFBRSxvQ0FBb0M7UUFDMUNDLEtBQUssRUFBRTtVQUFFQyxRQUFRLEVBQUUsRUFBRTtVQUFFQyxLQUFLLEVBQUU7UUFBTztNQUN2QyxDQUFDLENBQUM7SUFDSjtFQUNGLENBQUMsQ0FBQyxPQUFPcEIsS0FBSyxFQUFFO0lBQ2Q1QixPQUFPLENBQUNTLE1BQU0sQ0FBQ21CLEtBQUssQ0FBQ0EsS0FBSyxDQUFDQyxPQUFPLElBQUlELEtBQUssQ0FBQztJQUM1QyxPQUFPcUIsT0FBTyxDQUFDQyxNQUFNLENBQUN0QixLQUFLLENBQUM7RUFDOUI7QUFDRjs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ08sZUFBZXVCLG1CQUFtQkEsQ0FDdkNwRCxPQUFPLEVBQ1BDLE9BQU8sRUFDUG9ELE9BQU8sRUFDUEMsR0FBRyxFQUNIbkQsS0FBSyxFQUNMb0QsSUFBSSxFQUNKQyxFQUFFLEVBQ0ZDLE9BQU8sRUFDUEMsT0FBTyxFQUNQaEMsS0FBSyxHQUFHLElBQUksRUFDWjtFQUNBLElBQUk7SUFDRnpCLE9BQU8sQ0FBQ1MsTUFBTSxDQUFDQyxLQUFLLENBQ2pCLFdBQVUwQyxPQUFRLFlBQVdDLEdBQUksWUFBV25ELEtBQU0sVUFBU29ELElBQUssT0FBTUMsRUFBRyxhQUFZRyxJQUFJLENBQUNDLFNBQVMsQ0FDbEdILE9BQ0YsQ0FBRSxtQkFBa0JDLE9BQVEsRUFDOUIsQ0FBQztJQUNELElBQUlMLE9BQU8sS0FBSyxRQUFRLElBQUksQ0FBQzNCLEtBQUssRUFBRTtNQUNsQyxNQUFNLElBQUltQyxLQUFLLENBQ2IsMEVBQ0YsQ0FBQztJQUNIO0lBRUEsTUFBTUMsTUFBTSxHQUFHLE1BQU05RCxPQUFPLENBQUNpQixLQUFLLENBQUNDLEdBQUcsQ0FBQ1YsTUFBTSxDQUFDVyxhQUFhLENBQUNDLE9BQU8sQ0FDakUsS0FBSyxFQUNMLFNBQVMsRUFDVDtNQUFFQyxNQUFNLEVBQUU7UUFBRTBDLEtBQUssRUFBRTtNQUFFO0lBQUUsQ0FBQyxFQUN4QjtNQUFFdkMsU0FBUyxFQUFFckI7SUFBTSxDQUNyQixDQUFDO0lBRUQsTUFBTTZELFdBQVcsR0FBR0YsTUFBTSxDQUFDaEQsSUFBSSxDQUFDQSxJQUFJLENBQUNFLG9CQUFvQjs7SUFFekQ7SUFDQSxJQUFJcUMsT0FBTyxLQUFLLFVBQVUsSUFBSUMsR0FBRyxLQUFLLE1BQU0sRUFBRTtNQUM1Q3JELE9BQU8sQ0FBQ1MsTUFBTSxDQUFDQyxLQUFLLENBQUMsa0RBQWtELENBQUM7TUFDeEUsTUFBTXNELHFCQUFxQixHQUFHLENBQUMsS0FBSyxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsVUFBVSxDQUFDO01BRW5FLE1BQU1DLDZCQUE2QixHQUFHLENBQ3BDLE1BQU1oQixPQUFPLENBQUNpQixHQUFHLENBQ2ZGLHFCQUFxQixDQUFDNUIsR0FBRyxDQUFDLE1BQU0rQixvQkFBb0IsSUFBSTtRQUN0RCxJQUFJO1VBQ0YsTUFBTUMsS0FBSyxHQUFHLE1BQU12RyxvQkFBb0IsQ0FBQ3dHLG1CQUFtQixDQUMxRHRFLE9BQU8sRUFDUHVELElBQUksRUFDSkMsRUFBRSxFQUNGWSxvQkFBb0IsRUFDcEJYLE9BQU8sRUFDUEMsT0FDRixDQUFDO1VBQ0QsT0FBT1csS0FBSyxHQUNQLEdBQUVBLEtBQU0sT0FBTUwsV0FBWSxnQkFBZUksb0JBQW9CLENBQUNHLGlCQUFpQixDQUFDLENBQUUsbUJBQWtCLEdBQ3JHQyxTQUFTO1FBQ2YsQ0FBQyxDQUFDLE9BQU8zQyxLQUFLLEVBQUUsQ0FBQztNQUNuQixDQUFDLENBQ0gsQ0FBQyxFQUNETyxNQUFNLENBQUNxQyx1QkFBdUIsSUFBSUEsdUJBQXVCLENBQUM7TUFFNUR4RSxPQUFPLENBQUN5RSxPQUFPLENBQUM7UUFDZEMsS0FBSyxFQUFFO1VBQUU3QixJQUFJLEVBQUUsU0FBUztVQUFFQyxLQUFLLEVBQUU7UUFBSyxDQUFDO1FBQ3ZDNkIsSUFBSSxFQUFFVjtNQUNSLENBQUMsQ0FBQztNQUVGakUsT0FBTyxDQUFDUyxNQUFNLENBQUNDLEtBQUssQ0FDbEIsbUVBQ0YsQ0FBQztNQUNELE1BQU1rRSxPQUFPLEdBQUcsTUFBTS9HLG9CQUFvQixDQUFDZ0gsYUFBYSxDQUN0RDlFLE9BQU8sRUFDUHVELElBQUksRUFDSkMsRUFBRSxFQUNGLEtBQUssRUFDTEMsT0FBTyxFQUNQQyxPQUNGLENBQUM7TUFDRCxNQUFNcUIsVUFBVSxHQUFHLE1BQU1qSCxvQkFBb0IsQ0FBQ2dILGFBQWEsQ0FDekQ5RSxPQUFPLEVBQ1B1RCxJQUFJLEVBQ0pDLEVBQUUsRUFDRixRQUFRLEVBQ1JDLE9BQU8sRUFDUEMsT0FDRixDQUFDO01BQ0QsTUFBTXNCLFFBQVEsR0FBRyxNQUFNbEgsb0JBQW9CLENBQUNnSCxhQUFhLENBQ3ZEOUUsT0FBTyxFQUNQdUQsSUFBSSxFQUNKQyxFQUFFLEVBQ0YsTUFBTSxFQUNOQyxPQUFPLEVBQ1BDLE9BQ0YsQ0FBQztNQUNELE1BQU11QixZQUFZLEdBQUcsTUFBTW5ILG9CQUFvQixDQUFDZ0gsYUFBYSxDQUMzRDlFLE9BQU8sRUFDUHVELElBQUksRUFDSkMsRUFBRSxFQUNGLFVBQVUsRUFDVkMsT0FBTyxFQUNQQyxPQUNGLENBQUM7TUFDRHpELE9BQU8sQ0FBQ1MsTUFBTSxDQUFDQyxLQUFLLENBQ2xCLGlFQUNGLENBQUM7TUFDRCxJQUFJc0UsWUFBWSxJQUFJQSxZQUFZLENBQUN4RSxNQUFNLEVBQUU7UUFDdkNSLE9BQU8sQ0FBQ2lGLHFCQUFxQixDQUFDO1VBQzVCcEMsSUFBSSxFQUFFLHFEQUFxRDtVQUMzREMsS0FBSyxFQUFFO1FBQ1QsQ0FBQyxDQUFDO1FBQ0YsTUFBTWhELGdCQUFnQixDQUFDQyxPQUFPLEVBQUVDLE9BQU8sRUFBRWdGLFlBQVksRUFBRTlFLEtBQUssQ0FBQztRQUM3REYsT0FBTyxDQUFDa0YsVUFBVSxDQUFDLENBQUM7TUFDdEI7TUFFQSxJQUFJSCxRQUFRLElBQUlBLFFBQVEsQ0FBQ3ZFLE1BQU0sRUFBRTtRQUMvQlIsT0FBTyxDQUFDaUYscUJBQXFCLENBQUM7VUFDNUJwQyxJQUFJLEVBQUUsaURBQWlEO1VBQ3ZEQyxLQUFLLEVBQUU7UUFDVCxDQUFDLENBQUM7UUFDRixNQUFNaEQsZ0JBQWdCLENBQUNDLE9BQU8sRUFBRUMsT0FBTyxFQUFFK0UsUUFBUSxFQUFFN0UsS0FBSyxDQUFDO1FBQ3pERixPQUFPLENBQUNrRixVQUFVLENBQUMsQ0FBQztNQUN0QjtNQUVBLElBQUlKLFVBQVUsSUFBSUEsVUFBVSxDQUFDdEUsTUFBTSxFQUFFO1FBQ25DUixPQUFPLENBQUNpRixxQkFBcUIsQ0FBQztVQUM1QnBDLElBQUksRUFBRSxtREFBbUQ7VUFDekRDLEtBQUssRUFBRTtRQUNULENBQUMsQ0FBQztRQUNGLE1BQU1oRCxnQkFBZ0IsQ0FBQ0MsT0FBTyxFQUFFQyxPQUFPLEVBQUU4RSxVQUFVLEVBQUU1RSxLQUFLLENBQUM7UUFDM0RGLE9BQU8sQ0FBQ2tGLFVBQVUsQ0FBQyxDQUFDO01BQ3RCO01BRUEsSUFBSU4sT0FBTyxJQUFJQSxPQUFPLENBQUNwRSxNQUFNLEVBQUU7UUFDN0JSLE9BQU8sQ0FBQ2lGLHFCQUFxQixDQUFDO1VBQzVCcEMsSUFBSSxFQUFFLGdEQUFnRDtVQUN0REMsS0FBSyxFQUFFO1FBQ1QsQ0FBQyxDQUFDO1FBQ0YsTUFBTWhELGdCQUFnQixDQUFDQyxPQUFPLEVBQUVDLE9BQU8sRUFBRTRFLE9BQU8sRUFBRTFFLEtBQUssQ0FBQztRQUN4REYsT0FBTyxDQUFDa0YsVUFBVSxDQUFDLENBQUM7TUFDdEI7TUFFQWxGLE9BQU8sQ0FBQ1MsTUFBTSxDQUFDQyxLQUFLLENBQ2xCLHFEQUNGLENBQUM7TUFDRCxNQUFNeUUsT0FBTyxHQUFHLE1BQU10SCxvQkFBb0IsQ0FBQ3VILFdBQVcsQ0FDcERyRixPQUFPLEVBQ1B1RCxJQUFJLEVBQ0pDLEVBQUUsRUFDRkMsT0FBTyxFQUNQQyxPQUNGLENBQUM7TUFDRHpELE9BQU8sQ0FBQ1MsTUFBTSxDQUFDQyxLQUFLLENBQUMsbURBQW1ELENBQUM7TUFDekUsSUFBSXlFLE9BQU8sSUFBSUEsT0FBTyxDQUFDM0UsTUFBTSxFQUFFO1FBQzdCUixPQUFPLENBQUM4QixjQUFjLENBQUM7VUFDckI0QyxLQUFLLEVBQUU7WUFBRTdCLElBQUksRUFBRSxXQUFXO1lBQUVDLEtBQUssRUFBRTtVQUFLLENBQUM7VUFDekNmLE9BQU8sRUFBRSxDQUNQO1lBQUVDLEVBQUUsRUFBRSxLQUFLO1lBQUVDLEtBQUssRUFBRTtVQUFNLENBQUMsRUFDM0I7WUFBRUQsRUFBRSxFQUFFLEtBQUs7WUFBRUMsS0FBSyxFQUFFO1VBQU0sQ0FBQyxDQUM1QjtVQUNEQyxLQUFLLEVBQUVpRCxPQUFPLENBQUMvQyxHQUFHLENBQUNpRCxJQUFJLEtBQUs7WUFDMUJDLEdBQUcsRUFBRUgsT0FBTyxDQUFDSSxPQUFPLENBQUNGLElBQUksQ0FBQyxHQUFHLENBQUM7WUFDOUJHLEdBQUcsRUFBRUg7VUFDUCxDQUFDLENBQUM7UUFDSixDQUFDLENBQUM7TUFDSjtJQUNGOztJQUVBO0lBQ0EsSUFBSWpDLE9BQU8sS0FBSyxVQUFVLElBQUlDLEdBQUcsS0FBSyxTQUFTLEVBQUU7TUFDL0NyRCxPQUFPLENBQUNTLE1BQU0sQ0FBQ0MsS0FBSyxDQUFDLDRDQUE0QyxDQUFDO01BRWxFLE1BQU0rRSxXQUFXLEdBQUcsTUFBTTFILGVBQWUsQ0FBQzJILFVBQVUsQ0FDbEQzRixPQUFPLEVBQ1B1RCxJQUFJLEVBQ0pDLEVBQUUsRUFDRkMsT0FBTyxFQUNQQyxPQUNGLENBQUM7TUFFRHpELE9BQU8sQ0FBQ1MsTUFBTSxDQUFDQyxLQUFLLENBQUMsMENBQTBDLENBQUM7TUFDaEUsSUFBSStFLFdBQVcsQ0FBQ2pGLE1BQU0sRUFBRTtRQUN0QlIsT0FBTyxDQUFDNEMsVUFBVSxDQUFDO1VBQ2pCQyxJQUFJLEVBQUUsbUNBQW1DO1VBQ3pDQyxLQUFLLEVBQUU7UUFDVCxDQUFDLENBQUM7UUFDRixNQUFNaEQsZ0JBQWdCLENBQUNDLE9BQU8sRUFBRUMsT0FBTyxFQUFFeUYsV0FBVyxFQUFFdkYsS0FBSyxDQUFDO01BQzlEO0lBQ0Y7O0lBRUE7SUFDQSxJQUFJa0QsT0FBTyxLQUFLLFVBQVUsSUFBSUMsR0FBRyxLQUFLLElBQUksRUFBRTtNQUMxQ3JELE9BQU8sQ0FBQ1MsTUFBTSxDQUFDQyxLQUFLLENBQUMsK0JBQStCLENBQUM7TUFDckQsTUFBTWlGLGdCQUFnQixHQUFHLE1BQU0zSCxnQkFBZ0IsQ0FBQzRILG9CQUFvQixDQUNsRTdGLE9BQU8sRUFDUHVELElBQUksRUFDSkMsRUFBRSxFQUNGQyxPQUFPLEVBQ1BDLE9BQ0YsQ0FBQztNQUNEekQsT0FBTyxDQUFDUyxNQUFNLENBQUNDLEtBQUssQ0FBQyw2QkFBNkIsQ0FBQztNQUNuRCxJQUFJaUYsZ0JBQWdCLElBQUlBLGdCQUFnQixDQUFDbkYsTUFBTSxFQUFFO1FBQy9DUixPQUFPLENBQ0ppRixxQkFBcUIsQ0FBQztVQUNyQnBDLElBQUksRUFBRSw4Q0FBOEM7VUFDcERDLEtBQUssRUFBRTtRQUNULENBQUMsQ0FBQyxDQUNEbUMscUJBQXFCLENBQUM7VUFDckJwQyxJQUFJLEVBQUUsb0lBQW9JO1VBQzFJQyxLQUFLLEVBQUU7UUFDVCxDQUFDLENBQUMsQ0FDRGhCLGNBQWMsQ0FBQztVQUNkSSxLQUFLLEVBQUV5RCxnQkFBZ0IsQ0FBQ3ZELEdBQUcsQ0FBQ2lELElBQUksSUFBSTtZQUNsQyxPQUFPO2NBQUVDLEdBQUcsRUFBRUssZ0JBQWdCLENBQUNKLE9BQU8sQ0FBQ0YsSUFBSSxDQUFDLEdBQUcsQ0FBQztjQUFFL0MsSUFBSSxFQUFFK0M7WUFBSyxDQUFDO1VBQ2hFLENBQUMsQ0FBQztVQUNGdEQsT0FBTyxFQUFFLENBQ1A7WUFBRUMsRUFBRSxFQUFFLEtBQUs7WUFBRUMsS0FBSyxFQUFFO1VBQU0sQ0FBQyxFQUMzQjtZQUFFRCxFQUFFLEVBQUUsTUFBTTtZQUFFQyxLQUFLLEVBQUU7VUFBVSxDQUFDO1FBRXBDLENBQUMsQ0FBQztNQUNOO01BQ0FqQyxPQUFPLENBQUNTLE1BQU0sQ0FBQ0MsS0FBSyxDQUFDLHNCQUFzQixDQUFDO01BQzVDLE1BQU1tRixVQUFVLEdBQUcsTUFBTTdILGdCQUFnQixDQUFDOEgsb0JBQW9CLENBQzVEL0YsT0FBTyxFQUNQdUQsSUFBSSxFQUNKQyxFQUFFLEVBQ0ZDLE9BQU8sRUFDUEMsT0FDRixDQUFDO01BQ0RvQyxVQUFVLElBQ1I3RixPQUFPLENBQUM0QyxVQUFVLENBQUM7UUFDakJDLElBQUksRUFBRyxHQUFFZ0QsVUFBVyxPQUFNOUIsV0FBWSwrQkFBOEI7UUFDcEVqQixLQUFLLEVBQUU7TUFDVCxDQUFDLENBQUM7TUFDSixDQUFDK0MsVUFBVSxJQUNUN0YsT0FBTyxDQUFDaUYscUJBQXFCLENBQUM7UUFDNUJwQyxJQUFJLEVBQUcsaUNBQWdDO1FBQ3ZDQyxLQUFLLEVBQUU7TUFDVCxDQUFDLENBQUM7TUFFSixNQUFNaUQsV0FBVyxHQUFHLE1BQU0vSCxnQkFBZ0IsQ0FBQ2dJLHFCQUFxQixDQUM5RGpHLE9BQU8sRUFDUHVELElBQUksRUFDSkMsRUFBRSxFQUNGQyxPQUFPLEVBQ1BDLE9BQ0YsQ0FBQztNQUNEc0MsV0FBVyxJQUNUL0YsT0FBTyxDQUFDNEMsVUFBVSxDQUFDO1FBQ2pCQyxJQUFJLEVBQUcsR0FBRWtELFdBQVksT0FBTWhDLFdBQVksMkJBQTBCO1FBQ2pFakIsS0FBSyxFQUFFO01BQ1QsQ0FBQyxDQUFDO01BQ0osQ0FBQ2lELFdBQVcsSUFDVi9GLE9BQU8sQ0FBQzRDLFVBQVUsQ0FBQztRQUNqQkMsSUFBSSxFQUFHLDZCQUE0QjtRQUNuQ0MsS0FBSyxFQUFFO01BQ1QsQ0FBQyxDQUFDO01BQ0o5QyxPQUFPLENBQUNrRixVQUFVLENBQUMsQ0FBQztJQUN0Qjs7SUFFQTtJQUNBLElBQUksQ0FBQyxVQUFVLEVBQUUsUUFBUSxDQUFDLENBQUNlLFFBQVEsQ0FBQzdDLE9BQU8sQ0FBQyxJQUFJQyxHQUFHLEtBQUssS0FBSyxFQUFFO01BQzdEckQsT0FBTyxDQUFDUyxNQUFNLENBQUNDLEtBQUssQ0FBQyxtQ0FBbUMsQ0FBQztNQUN6RCxNQUFNd0Ysa0JBQWtCLEdBQUcsTUFBTWpJLFVBQVUsQ0FBQ2tJLGtCQUFrQixDQUM1RHBHLE9BQU8sRUFDUHVELElBQUksRUFDSkMsRUFBRSxFQUNGQyxPQUFPLEVBQ1BDLE9BQ0YsQ0FBQztNQUNEekQsT0FBTyxDQUFDaUYscUJBQXFCLENBQUM7UUFDNUJwQyxJQUFJLEVBQUUsK0NBQStDO1FBQ3JEQyxLQUFLLEVBQUU7TUFDVCxDQUFDLENBQUM7TUFDRixLQUFLLE1BQU11QyxJQUFJLElBQUlhLGtCQUFrQixFQUFFO1FBQ3JDLE1BQU1FLEtBQUssR0FBRyxNQUFNbkksVUFBVSxDQUFDb0kscUJBQXFCLENBQ2xEdEcsT0FBTyxFQUNQdUQsSUFBSSxFQUNKQyxFQUFFLEVBQ0ZDLE9BQU8sRUFDUDZCLElBQUksRUFDSjVCLE9BQ0YsQ0FBQztRQUNEekQsT0FBTyxDQUFDaUYscUJBQXFCLENBQUM7VUFDNUJwQyxJQUFJLEVBQUcsZUFBY3dDLElBQUssRUFBQztVQUMzQnZDLEtBQUssRUFBRTtRQUNULENBQUMsQ0FBQztRQUVGLElBQUl3RCwrQkFBRyxDQUFDakIsSUFBSSxDQUFDLEVBQUU7VUFDYixNQUFNa0IsT0FBTyxHQUNYLE9BQU9ELCtCQUFHLENBQUNqQixJQUFJLENBQUMsS0FBSyxRQUFRLEdBQ3pCO1lBQUV4QyxJQUFJLEVBQUV5RCwrQkFBRyxDQUFDakIsSUFBSSxDQUFDO1lBQUV2QyxLQUFLLEVBQUU7VUFBVyxDQUFDLEdBQ3RDd0QsK0JBQUcsQ0FBQ2pCLElBQUksQ0FBQztVQUNmckYsT0FBTyxDQUFDaUYscUJBQXFCLENBQUNzQixPQUFPLENBQUM7UUFDeEM7UUFFQUgsS0FBSyxJQUNIQSxLQUFLLENBQUM1RixNQUFNLElBQ1pSLE9BQU8sQ0FBQzhCLGNBQWMsQ0FBQztVQUNyQkMsT0FBTyxFQUFFLENBQ1A7WUFBRUMsRUFBRSxFQUFFLFFBQVE7WUFBRUMsS0FBSyxFQUFFO1VBQVUsQ0FBQyxFQUNsQztZQUFFRCxFQUFFLEVBQUUsaUJBQWlCO1lBQUVDLEtBQUssRUFBRTtVQUFjLENBQUMsQ0FDaEQ7VUFDREMsS0FBSyxFQUFFa0UsS0FBSztVQUNaMUIsS0FBSyxFQUFHLGlCQUFnQlcsSUFBSztRQUMvQixDQUFDLENBQUM7TUFDTjtJQUNGOztJQUVBO0lBQ0EsSUFBSSxDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUMsQ0FBQ1ksUUFBUSxDQUFDN0MsT0FBTyxDQUFDLElBQUlDLEdBQUcsS0FBSyxLQUFLLEVBQUU7TUFDN0RyRCxPQUFPLENBQUNTLE1BQU0sQ0FBQ0MsS0FBSyxDQUFDLCtCQUErQixDQUFDO01BQ3JELE1BQU04RixrQkFBa0IsR0FBRyxNQUFNckksVUFBVSxDQUFDcUksa0JBQWtCLENBQzVEekcsT0FBTyxFQUNQdUQsSUFBSSxFQUNKQyxFQUFFLEVBQ0ZDLE9BQU8sRUFDUEMsT0FDRixDQUFDO01BQ0R6RCxPQUFPLENBQUNpRixxQkFBcUIsQ0FBQztRQUM1QnBDLElBQUksRUFBRSwyQ0FBMkM7UUFDakRDLEtBQUssRUFBRTtNQUNULENBQUMsQ0FBQztNQUNGLEtBQUssTUFBTXVDLElBQUksSUFBSW1CLGtCQUFrQixFQUFFO1FBQ3JDLE1BQU1KLEtBQUssR0FBRyxNQUFNakksVUFBVSxDQUFDa0kscUJBQXFCLENBQ2xEdEcsT0FBTyxFQUNQdUQsSUFBSSxFQUNKQyxFQUFFLEVBQ0ZDLE9BQU8sRUFDUDZCLElBQUksRUFDSjVCLE9BQ0YsQ0FBQztRQUNEekQsT0FBTyxDQUFDaUYscUJBQXFCLENBQUM7VUFDNUJwQyxJQUFJLEVBQUcsZUFBY3dDLElBQUssRUFBQztVQUMzQnZDLEtBQUssRUFBRTtRQUNULENBQUMsQ0FBQztRQUVGLElBQUkyRCwrQkFBRyxDQUFDcEIsSUFBSSxDQUFDLEVBQUU7VUFDYixNQUFNa0IsT0FBTyxHQUNYLE9BQU9FLCtCQUFHLENBQUNwQixJQUFJLENBQUMsS0FBSyxRQUFRLEdBQ3pCO1lBQUV4QyxJQUFJLEVBQUU0RCwrQkFBRyxDQUFDcEIsSUFBSSxDQUFDO1lBQUV2QyxLQUFLLEVBQUU7VUFBVyxDQUFDLEdBQ3RDMkQsK0JBQUcsQ0FBQ3BCLElBQUksQ0FBQztVQUNmckYsT0FBTyxDQUFDaUYscUJBQXFCLENBQUNzQixPQUFPLENBQUM7UUFDeEM7UUFFQUgsS0FBSyxJQUNIQSxLQUFLLENBQUM1RixNQUFNLElBQ1pSLE9BQU8sQ0FBQzhCLGNBQWMsQ0FBQztVQUNyQkMsT0FBTyxFQUFFLENBQ1A7WUFBRUMsRUFBRSxFQUFFLFFBQVE7WUFBRUMsS0FBSyxFQUFFO1VBQVUsQ0FBQyxFQUNsQztZQUFFRCxFQUFFLEVBQUUsaUJBQWlCO1lBQUVDLEtBQUssRUFBRTtVQUFjLENBQUMsQ0FDaEQ7VUFDREMsS0FBSyxFQUFFa0UsS0FBSztVQUNaMUIsS0FBSyxFQUFHLGlCQUFnQlcsSUFBSztRQUMvQixDQUFDLENBQUM7TUFDTjtJQUNGOztJQUVBO0lBQ0EsSUFBSSxDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUMsQ0FBQ1ksUUFBUSxDQUFDN0MsT0FBTyxDQUFDLElBQUlDLEdBQUcsS0FBSyxNQUFNLEVBQUU7TUFDOURyRCxPQUFPLENBQUNTLE1BQU0sQ0FBQ0MsS0FBSyxDQUFDLGdDQUFnQyxDQUFDO01BQ3RELE1BQU1nRyxtQkFBbUIsR0FBRyxNQUFNeEksV0FBVyxDQUFDeUksbUJBQW1CLENBQy9ENUcsT0FBTyxFQUNQdUQsSUFBSSxFQUNKQyxFQUFFLEVBQ0ZDLE9BQU8sRUFDUEMsT0FDRixDQUFDO01BQ0R6RCxPQUFPLENBQUNpRixxQkFBcUIsQ0FBQztRQUM1QnBDLElBQUksRUFBRSw0Q0FBNEM7UUFDbERDLEtBQUssRUFBRTtNQUNULENBQUMsQ0FBQztNQUNGLEtBQUssTUFBTXVDLElBQUksSUFBSXFCLG1CQUFtQixFQUFFO1FBQ3RDLE1BQU1OLEtBQUssR0FBRyxNQUFNbEksV0FBVyxDQUFDbUkscUJBQXFCLENBQ25EdEcsT0FBTyxFQUNQdUQsSUFBSSxFQUNKQyxFQUFFLEVBQ0ZDLE9BQU8sRUFDUDZCLElBQUksRUFDSjVCLE9BQ0YsQ0FBQztRQUNEekQsT0FBTyxDQUFDaUYscUJBQXFCLENBQUM7VUFDNUJwQyxJQUFJLEVBQUcsZUFBY3dDLElBQUssRUFBQztVQUMzQnZDLEtBQUssRUFBRTtRQUNULENBQUMsQ0FBQztRQUVGLElBQUk4RCxnQ0FBSSxJQUFJQSxnQ0FBSSxDQUFDdkIsSUFBSSxDQUFDLEVBQUU7VUFDdEIsTUFBTWtCLE9BQU8sR0FDWCxPQUFPSyxnQ0FBSSxDQUFDdkIsSUFBSSxDQUFDLEtBQUssUUFBUSxHQUMxQjtZQUFFeEMsSUFBSSxFQUFFK0QsZ0NBQUksQ0FBQ3ZCLElBQUksQ0FBQztZQUFFdkMsS0FBSyxFQUFFO1VBQVcsQ0FBQyxHQUN2QzhELGdDQUFJLENBQUN2QixJQUFJLENBQUM7VUFDaEJyRixPQUFPLENBQUNpRixxQkFBcUIsQ0FBQ3NCLE9BQU8sQ0FBQztRQUN4QztRQUVBSCxLQUFLLElBQ0hBLEtBQUssQ0FBQzVGLE1BQU0sSUFDWlIsT0FBTyxDQUFDOEIsY0FBYyxDQUFDO1VBQ3JCQyxPQUFPLEVBQUUsQ0FDUDtZQUFFQyxFQUFFLEVBQUUsUUFBUTtZQUFFQyxLQUFLLEVBQUU7VUFBVSxDQUFDLEVBQ2xDO1lBQUVELEVBQUUsRUFBRSxpQkFBaUI7WUFBRUMsS0FBSyxFQUFFO1VBQWMsQ0FBQyxDQUNoRDtVQUNEQyxLQUFLLEVBQUVrRSxLQUFLO1VBQ1oxQixLQUFLLEVBQUcsaUJBQWdCVyxJQUFLO1FBQy9CLENBQUMsQ0FBQztNQUNOO01BQ0FyRixPQUFPLENBQUNrRixVQUFVLENBQUMsQ0FBQztJQUN0Qjs7SUFFQTtJQUNBLElBQUk5QixPQUFPLEtBQUssVUFBVSxJQUFJQyxHQUFHLEtBQUssT0FBTyxFQUFFO01BQzdDckQsT0FBTyxDQUFDUyxNQUFNLENBQUNDLEtBQUssQ0FDbEIsMERBQ0YsQ0FBQztNQUNELE1BQU1tRyxxQkFBcUIsR0FDekIsTUFBTXpJLFlBQVksQ0FBQzBJLDhCQUE4QixDQUMvQy9HLE9BQU8sRUFDUHVELElBQUksRUFDSkMsRUFBRSxFQUNGQyxPQUFPLEVBQ1BDLE9BQ0YsQ0FBQztNQUNILElBQUlvRCxxQkFBcUIsSUFBSUEscUJBQXFCLENBQUNyRyxNQUFNLEVBQUU7UUFDekRSLE9BQU8sQ0FBQzRDLFVBQVUsQ0FBQztVQUNqQkMsSUFBSSxFQUFFLGlEQUFpRDtVQUN2REMsS0FBSyxFQUFFO1FBQ1QsQ0FBQyxDQUFDO1FBQ0YsTUFBTWhELGdCQUFnQixDQUFDQyxPQUFPLEVBQUVDLE9BQU8sRUFBRTZHLHFCQUFxQixFQUFFM0csS0FBSyxDQUFDO01BQ3hFO01BQ0EsTUFBTTZHLHdCQUF3QixHQUM1QixNQUFNM0ksWUFBWSxDQUFDNEksMkJBQTJCLENBQzVDakgsT0FBTyxFQUNQdUQsSUFBSSxFQUNKQyxFQUFFLEVBQ0ZDLE9BQU8sRUFDUEMsT0FDRixDQUFDO01BQ0gsSUFBSXNELHdCQUF3QixJQUFJQSx3QkFBd0IsQ0FBQ3ZHLE1BQU0sRUFBRTtRQUMvRFIsT0FBTyxDQUFDOEIsY0FBYyxDQUFDO1VBQ3JCQyxPQUFPLEVBQUUsQ0FDUDtZQUFFQyxFQUFFLEVBQUUsT0FBTztZQUFFQyxLQUFLLEVBQUU7VUFBVyxDQUFDLEVBQ2xDO1lBQUVELEVBQUUsRUFBRSxZQUFZO1lBQUVDLEtBQUssRUFBRTtVQUFhLENBQUMsRUFDekM7WUFBRUQsRUFBRSxFQUFFLGlCQUFpQjtZQUFFQyxLQUFLLEVBQUU7VUFBVSxDQUFDLENBQzVDO1VBQ0RDLEtBQUssRUFBRTZFLHdCQUF3QixDQUFDM0UsR0FBRyxDQUFDaUQsSUFBSSxLQUFLO1lBQzNDNUQsS0FBSyxFQUFFNEQsSUFBSSxDQUFDNUQsS0FBSztZQUNqQndGLFVBQVUsRUFBRTVCLElBQUksQ0FBQzZCLE9BQU8sQ0FBQ2xGLEVBQUU7WUFDM0JtRixlQUFlLEVBQUU5QixJQUFJLENBQUM2QixPQUFPLENBQUNBO1VBQ2hDLENBQUMsQ0FBQyxDQUFDO1VBQ0h4QyxLQUFLLEVBQUU7WUFDTDdCLElBQUksRUFBRSw4QkFBOEI7WUFDcENDLEtBQUssRUFBRTtVQUNUO1FBQ0YsQ0FBQyxDQUFDO01BQ0o7SUFDRjs7SUFFQTtJQUNBLElBQUlNLE9BQU8sS0FBSyxVQUFVLElBQUlDLEdBQUcsS0FBSyxLQUFLLEVBQUU7TUFDM0NyRCxPQUFPLENBQUNTLE1BQU0sQ0FBQ0MsS0FBSyxDQUFDLDhCQUE4QixDQUFDO01BQ3BELE1BQU0wRixLQUFLLEdBQUcsTUFBTS9ILGVBQWUsQ0FBQytJLFNBQVMsQ0FDM0NySCxPQUFPLEVBQ1B1RCxJQUFJLEVBQ0pDLEVBQUUsRUFDRkMsT0FBTyxFQUNQQyxPQUNGLENBQUM7TUFFRCxJQUFJMkMsS0FBSyxJQUFJQSxLQUFLLENBQUM1RixNQUFNLEVBQUU7UUFDekJSLE9BQU8sQ0FDSmlGLHFCQUFxQixDQUFDO1VBQUVwQyxJQUFJLEVBQUUsaUJBQWlCO1VBQUVDLEtBQUssRUFBRTtRQUFLLENBQUMsQ0FBQyxDQUMvRGhCLGNBQWMsQ0FBQztVQUNkQyxPQUFPLEVBQUUsQ0FDUDtZQUFFQyxFQUFFLEVBQUUsUUFBUTtZQUFFQyxLQUFLLEVBQUU7VUFBVSxDQUFDLEVBQ2xDO1lBQUVELEVBQUUsRUFBRSxpQkFBaUI7WUFBRUMsS0FBSyxFQUFFO1VBQWMsQ0FBQyxDQUNoRDtVQUNEQyxLQUFLLEVBQUVrRSxLQUFLO1VBQ1oxQixLQUFLLEVBQUU7WUFDTDdCLElBQUksRUFBRSw4Q0FBOEM7WUFDcERDLEtBQUssRUFBRTtVQUNUO1FBQ0YsQ0FBQyxDQUFDO01BQ047TUFFQTlDLE9BQU8sQ0FBQ1MsTUFBTSxDQUFDQyxLQUFLLENBQUMsK0JBQStCLENBQUM7TUFDckQsTUFBTW1ELE1BQU0sR0FBRyxNQUFNeEYsZUFBZSxDQUFDZ0osVUFBVSxDQUM3Q3RILE9BQU8sRUFDUHVELElBQUksRUFDSkMsRUFBRSxFQUNGQyxPQUFPLEVBQ1BDLE9BQ0YsQ0FBQztNQUVELElBQUlJLE1BQU0sSUFBSUEsTUFBTSxDQUFDckQsTUFBTSxFQUFFO1FBQzNCUixPQUFPLENBQUNpRixxQkFBcUIsQ0FBQztVQUM1QnBDLElBQUksRUFBRSxxQ0FBcUM7VUFDM0NDLEtBQUssRUFBRTtRQUNULENBQUMsQ0FBQztRQUNGOUMsT0FBTyxDQUFDaUYscUJBQXFCLENBQUM7VUFDNUJwQyxJQUFJLEVBQUUsd0ZBQXdGO1VBQzlGQyxLQUFLLEVBQUU7UUFDVCxDQUFDLENBQUM7UUFDRixNQUFNaEQsZ0JBQWdCLENBQUNDLE9BQU8sRUFBRUMsT0FBTyxFQUFFNkQsTUFBTSxFQUFFM0QsS0FBSyxDQUFDO01BQ3pEO0lBQ0Y7O0lBRUE7SUFDQSxJQUFJa0QsT0FBTyxLQUFLLFFBQVEsSUFBSUMsR0FBRyxLQUFLLE9BQU8sRUFBRTtNQUMzQ3JELE9BQU8sQ0FBQ1MsTUFBTSxDQUFDQyxLQUFLLENBQUMsc0NBQXNDLENBQUM7TUFDNUQsTUFBTTRHLGtCQUFrQixHQUFHLE1BQU1sSixZQUFZLENBQUNtSixvQkFBb0IsQ0FDaEV4SCxPQUFPLEVBQ1B1RCxJQUFJLEVBQ0pDLEVBQUUsRUFDRkMsT0FBTyxFQUNQQyxPQUNGLENBQUM7TUFDRDZELGtCQUFrQixJQUNoQkEsa0JBQWtCLENBQUM5RyxNQUFNLElBQ3pCUixPQUFPLENBQUM4QixjQUFjLENBQUM7UUFDckJDLE9BQU8sRUFBRSxDQUNQO1VBQUVDLEVBQUUsRUFBRSxJQUFJO1VBQUVDLEtBQUssRUFBRTtRQUFLLENBQUMsRUFDekI7VUFBRUQsRUFBRSxFQUFFLFNBQVM7VUFBRUMsS0FBSyxFQUFFO1FBQVUsQ0FBQyxDQUNwQztRQUNEQyxLQUFLLEVBQUVvRixrQkFBa0I7UUFDekI1QyxLQUFLLEVBQUU7TUFDVCxDQUFDLENBQUM7SUFDTjs7SUFFQTtJQUNBLElBQUl0QixPQUFPLEtBQUssUUFBUSxJQUFJQyxHQUFHLEtBQUssS0FBSyxFQUFFO01BQ3pDckQsT0FBTyxDQUFDUyxNQUFNLENBQUNDLEtBQUssQ0FBRSx3Q0FBdUNlLEtBQU0sRUFBQyxDQUFDO01BRXJFLE1BQU0rRixnQkFBZ0IsR0FDcEIsTUFBTXpILE9BQU8sQ0FBQ2lCLEtBQUssQ0FBQ0MsR0FBRyxDQUFDVixNQUFNLENBQUNXLGFBQWEsQ0FBQ0MsT0FBTyxDQUNsRCxLQUFLLEVBQ0osYUFBWU0sS0FBTSxZQUFXLEVBQzlCLENBQUMsQ0FBQyxFQUNGO1FBQUVGLFNBQVMsRUFBRXJCO01BQU0sQ0FDckIsQ0FBQztNQUVILElBQUlzSCxnQkFBZ0IsSUFBSUEsZ0JBQWdCLENBQUMzRyxJQUFJLEVBQUU7UUFDN0MsTUFBTTRHLFlBQVksR0FBR0QsZ0JBQWdCLENBQUMzRyxJQUFJLENBQUNBLElBQUksQ0FBQ0MsY0FBYyxDQUFDLENBQUMsQ0FBQztRQUNqRSxJQUFJMkcsWUFBWSxDQUFDQyxLQUFLLElBQUlELFlBQVksQ0FBQ0UsR0FBRyxFQUFFO1VBQzFDM0gsT0FBTyxDQUFDNEMsVUFBVSxDQUFDO1lBQ2pCQyxJQUFJLEVBQUcseURBQXdENEUsWUFBWSxDQUFDQyxLQUFNLE9BQU1ELFlBQVksQ0FBQ0UsR0FBSTtVQUMzRyxDQUFDLENBQUM7UUFDSixDQUFDLE1BQU0sSUFBSUYsWUFBWSxDQUFDQyxLQUFLLEVBQUU7VUFDN0IxSCxPQUFPLENBQUM0QyxVQUFVLENBQUM7WUFDakJDLElBQUksRUFBRyxzRkFBcUY0RSxZQUFZLENBQUNDLEtBQU07VUFDakgsQ0FBQyxDQUFDO1FBQ0osQ0FBQyxNQUFNO1VBQ0wxSCxPQUFPLENBQUM0QyxVQUFVLENBQUM7WUFDakJDLElBQUksRUFBRztVQUNULENBQUMsQ0FBQztRQUNKO1FBQ0E3QyxPQUFPLENBQUNrRixVQUFVLENBQUMsQ0FBQztNQUN0QjtNQUVBbEYsT0FBTyxDQUFDUyxNQUFNLENBQUNDLEtBQUssQ0FBQyx3Q0FBd0MsQ0FBQztNQUM5RCxNQUFNa0gsY0FBYyxHQUFHLE1BQU12SixlQUFlLENBQUN3SixtQkFBbUIsQ0FDOUQ5SCxPQUFPLEVBQ1B1RCxJQUFJLEVBQ0pDLEVBQUUsRUFDRkMsT0FBTyxFQUNQQyxPQUNGLENBQUM7TUFFRG1FLGNBQWMsSUFDWkEsY0FBYyxDQUFDcEgsTUFBTSxJQUNyQlIsT0FBTyxDQUFDOEIsY0FBYyxDQUFDO1FBQ3JCQyxPQUFPLEVBQUUsQ0FDUDtVQUFFQyxFQUFFLEVBQUUsTUFBTTtVQUFFQyxLQUFLLEVBQUU7UUFBTyxDQUFDLEVBQzdCO1VBQUVELEVBQUUsRUFBRSxNQUFNO1VBQUVDLEtBQUssRUFBRTtRQUFPLENBQUMsQ0FDOUI7UUFDREMsS0FBSyxFQUFFMEYsY0FBYztRQUNyQmxELEtBQUssRUFBRTtNQUNULENBQUMsQ0FBQztNQUVKMUUsT0FBTyxDQUFDUyxNQUFNLENBQUNDLEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQztNQUN2RCxNQUFNb0gsZUFBZSxHQUFHLE1BQU16SixlQUFlLENBQUMwSixvQkFBb0IsQ0FDaEVoSSxPQUFPLEVBQ1B1RCxJQUFJLEVBQ0pDLEVBQUUsRUFDRkMsT0FBTyxFQUNQQyxPQUNGLENBQUM7TUFFRHFFLGVBQWUsSUFDYkEsZUFBZSxDQUFDdEgsTUFBTSxJQUN0QlIsT0FBTyxDQUFDOEIsY0FBYyxDQUFDO1FBQ3JCQyxPQUFPLEVBQUUsQ0FDUDtVQUFFQyxFQUFFLEVBQUUsTUFBTTtVQUFFQyxLQUFLLEVBQUU7UUFBTyxDQUFDLEVBQzdCO1VBQUVELEVBQUUsRUFBRSxNQUFNO1VBQUVDLEtBQUssRUFBRTtRQUFPLENBQUMsQ0FDOUI7UUFDREMsS0FBSyxFQUFFNEYsZUFBZTtRQUN0QnBELEtBQUssRUFBRTtNQUNULENBQUMsQ0FBQztJQUNOOztJQUVBO0lBQ0EsSUFBSXRCLE9BQU8sS0FBSyxRQUFRLElBQUlDLEdBQUcsS0FBSyxNQUFNLEVBQUU7TUFDMUMsTUFBTTJFLG1CQUFtQixHQUFHLE1BQU1uSyxvQkFBb0IsQ0FBQ29LLGtCQUFrQixDQUN2RWxJLE9BQU8sRUFDUHVELElBQUksRUFDSkMsRUFBRSxFQUNGLFVBQVUsRUFDVkMsT0FBTyxFQUNQQyxPQUNGLENBQUM7TUFDRCxJQUFJdUUsbUJBQW1CLElBQUlBLG1CQUFtQixDQUFDeEgsTUFBTSxFQUFFO1FBQ3JEUixPQUFPLENBQUNpRixxQkFBcUIsQ0FBQztVQUM1QnBDLElBQUksRUFBRSxtQkFBbUI7VUFDekJDLEtBQUssRUFBRTtRQUNULENBQUMsQ0FBQztRQUNGOUMsT0FBTyxDQUFDaUYscUJBQXFCLENBQUM7VUFDNUJwQyxJQUFJLEVBQUUsOEhBQThIO1VBQ3BJQyxLQUFLLEVBQUU7UUFDVCxDQUFDLENBQUM7UUFDRixNQUFNb0YsUUFBUSxHQUFHLEVBQUU7UUFDbkIsS0FBSyxNQUFNQyxRQUFRLElBQUlILG1CQUFtQixFQUFFO1VBQzFDRSxRQUFRLENBQUN2RyxJQUFJLENBQUM7WUFBRWtCLElBQUksRUFBRXNGLFFBQVEsQ0FBQ0MsT0FBTztZQUFFdEYsS0FBSyxFQUFFO1VBQVcsQ0FBQyxDQUFDO1VBQzVEb0YsUUFBUSxDQUFDdkcsSUFBSSxDQUFDO1lBQ1owRyxFQUFFLEVBQUVGLFFBQVEsQ0FBQ0csVUFBVSxDQUFDbEcsR0FBRyxDQUFDaUQsSUFBSSxLQUFLO2NBQ25DeEMsSUFBSSxFQUFFd0MsSUFBSSxDQUFDa0QsU0FBUyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsR0FBRyxLQUFLO2NBQ25DQyxJQUFJLEVBQUVuRCxJQUFJO2NBQ1ZyQyxLQUFLLEVBQUU7WUFDVCxDQUFDLENBQUM7VUFDSixDQUFDLENBQUM7UUFDSjtRQUNBaEQsT0FBTyxDQUFDaUYscUJBQXFCLENBQUM7VUFBRW9ELEVBQUUsRUFBRUg7UUFBUyxDQUFDLENBQUM7TUFDakQ7TUFFQSxNQUFNTyxlQUFlLEdBQUcsTUFBTTVLLG9CQUFvQixDQUFDb0ssa0JBQWtCLENBQ25FbEksT0FBTyxFQUNQdUQsSUFBSSxFQUNKQyxFQUFFLEVBQ0YsTUFBTSxFQUNOQyxPQUFPLEVBQ1BDLE9BQ0YsQ0FBQztNQUNELElBQUlnRixlQUFlLElBQUlBLGVBQWUsQ0FBQ2pJLE1BQU0sRUFBRTtRQUM3Q1IsT0FBTyxDQUFDaUYscUJBQXFCLENBQUM7VUFBRXBDLElBQUksRUFBRSxlQUFlO1VBQUVDLEtBQUssRUFBRTtRQUFLLENBQUMsQ0FBQztRQUNyRTlDLE9BQU8sQ0FBQ2lGLHFCQUFxQixDQUFDO1VBQzVCcEMsSUFBSSxFQUFFLGlFQUFpRTtVQUN2RUMsS0FBSyxFQUFFO1FBQ1QsQ0FBQyxDQUFDO1FBQ0YsTUFBTW9GLFFBQVEsR0FBRyxFQUFFO1FBQ25CLEtBQUssTUFBTUMsUUFBUSxJQUFJTSxlQUFlLEVBQUU7VUFDdENQLFFBQVEsQ0FBQ3ZHLElBQUksQ0FBQztZQUFFa0IsSUFBSSxFQUFFc0YsUUFBUSxDQUFDQyxPQUFPO1lBQUV0RixLQUFLLEVBQUU7VUFBVyxDQUFDLENBQUM7VUFDNURvRixRQUFRLENBQUN2RyxJQUFJLENBQUM7WUFDWjBHLEVBQUUsRUFBRUYsUUFBUSxDQUFDRyxVQUFVLENBQUNsRyxHQUFHLENBQUNpRCxJQUFJLEtBQUs7Y0FDbkN4QyxJQUFJLEVBQUV3QyxJQUFJO2NBQ1ZyQyxLQUFLLEVBQUU7WUFDVCxDQUFDLENBQUM7VUFDSixDQUFDLENBQUM7UUFDSjtRQUNBa0YsUUFBUSxJQUFJQSxRQUFRLENBQUMxSCxNQUFNLElBQUlSLE9BQU8sQ0FBQzRDLFVBQVUsQ0FBQztVQUFFeUYsRUFBRSxFQUFFSDtRQUFTLENBQUMsQ0FBQztRQUNuRWxJLE9BQU8sQ0FBQ2tGLFVBQVUsQ0FBQyxDQUFDO01BQ3RCO0lBQ0Y7O0lBRUE7SUFDQSxJQUFJd0Qsa0JBQWtCLEdBQUcsRUFBRTtJQUMzQixJQUFJQyxLQUFLLENBQUNDLE9BQU8sQ0FBQ0MsaUNBQXdCLENBQUN6RixPQUFPLENBQUMsQ0FBQ0MsR0FBRyxDQUFDLENBQUMsRUFBRTtNQUN6RCxNQUFNeUYsY0FBYyxHQUFHRCxpQ0FBd0IsQ0FBQ3pGLE9BQU8sQ0FBQyxDQUFDQyxHQUFHLENBQUMsQ0FBQ2pCLEdBQUcsQ0FDL0QyRyxZQUFZLElBQUk7UUFDZC9JLE9BQU8sQ0FBQ1MsTUFBTSxDQUFDQyxLQUFLLENBQUUsWUFBV3FJLFlBQVksQ0FBQ3JFLEtBQU0sUUFBTyxDQUFDO1FBQzVELE1BQU1zRSxrQkFBa0IsR0FBRyxJQUFJQyxxQkFBWSxDQUN6Q2xKLE9BQU8sRUFDUHVELElBQUksRUFDSkMsRUFBRSxFQUNGQyxPQUFPLEVBQ1B1RixZQUFZLEVBQ1p0RixPQUNGLENBQUM7UUFDRCxPQUFPdUYsa0JBQWtCLENBQUNFLEtBQUssQ0FBQyxDQUFDO01BQ25DLENBQ0YsQ0FBQztNQUNEUixrQkFBa0IsR0FBRyxNQUFNekYsT0FBTyxDQUFDaUIsR0FBRyxDQUFDNEUsY0FBYyxDQUFDO0lBQ3hEO0lBRUEsT0FBT0osa0JBQWtCO0VBQzNCLENBQUMsQ0FBQyxPQUFPOUcsS0FBSyxFQUFFO0lBQ2Q1QixPQUFPLENBQUNTLE1BQU0sQ0FBQ21CLEtBQUssQ0FBQ0EsS0FBSyxDQUFDQyxPQUFPLElBQUlELEtBQUssQ0FBQztJQUM1QyxPQUFPcUIsT0FBTyxDQUFDQyxNQUFNLENBQUN0QixLQUFLLENBQUM7RUFDOUI7QUFDRiJ9