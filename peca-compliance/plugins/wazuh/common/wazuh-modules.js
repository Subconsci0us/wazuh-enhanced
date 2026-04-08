"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.WAZUH_MODULES = void 0;
/*
 * Wazuh app - Simple description for each App tabs
 * Copyright (C) 2015-2022 Wazuh, Inc.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * Find more information about this on the LICENSE file.
 */
const WAZUH_MODULES = exports.WAZUH_MODULES = {
  general: {
    title: 'Threat hunting',
    appId: 'threat-hunting',
    description: 'Browse through your security alerts, identifying issues and threats in your environment.'
  },
  fim: {
    title: 'File integrity monitoring',
    appId: 'file-integrity-monitoring',
    description: 'Alerts related to file changes, including permissions, content, ownership and attributes.'
  },
  pm: {
    title: 'Malware detection',
    appId: 'malware-detection',
    description: 'Check indicators of compromise triggered by malware infections or cyberattacks.'
  },
  vuls: {
    title: 'Vulnerability detection',
    appId: 'vulnerability-detection',
    description: 'Discover what applications in your environment are affected by well-known vulnerabilities.'
  },
  oscap: {
    title: 'OpenSCAP',
    appId: 'openscap',
    description: 'Configuration assessment and automation of compliance monitoring using SCAP checks.'
  },
  audit: {
    title: 'System auditing',
    appId: 'system-auditing',
    description: 'Audit users behavior, monitoring command execution and alerting on access to critical files.'
  },
  pci: {
    title: 'PCI DSS',
    appId: 'pci-dss',
    description: 'Global security standard for entities that process, store or transmit payment cardholder data.'
  },
  gdpr: {
    title: 'GDPR',
    appId: 'gdpr',
    description: 'General Data Protection Regulation (GDPR) sets guidelines for processing of personal data.'
  },
  hipaa: {
    title: 'HIPAA',
    appId: 'hipaa',
    description: 'Health Insurance Portability and Accountability Act of 1996 (HIPAA) provides data privacy and security provisions for safeguarding medical information.'
  },
  nist: {
    title: 'NIST 800-53',
    appId: 'nist-800-53',
    description: 'National Institute of Standards and Technology Special Publication 800-53 (NIST 800-53) sets guidelines for federal information systems.'
  },
  tsc: {
    title: 'TSC',
    appId: 'tsc',
    description: 'Trust Services Criteria for Security, Availability, Processing Integrity, Confidentiality, and Privacy'
  },
  peca: {
    title: 'PECA',
    appId: 'peca',
    description: 'Prevention of Electronic Crimes Act 2016 (PECA) — Pakistan\'s cybercrime law covering unauthorized access, data theft, and cyber terrorism.'
  },
  ciscat: {
    title: 'CIS-CAT',
    appId: 'ciscat',
    description: 'Configuration assessment using Center of Internet Security scanner and SCAP checks.'
  },
  microsoftGraphAPI: {
    title: 'Microsoft Graph API',
    appId: 'microsoft-graph-api',
    description: 'Security events related to your Microsoft Graph services, collected directly via Microsoft Graph API.'
  },
  aws: {
    title: 'AWS',
    appId: 'amazon-web-services',
    description: 'Security events related to your Amazon AWS services, collected directly via AWS API.'
  },
  office: {
    title: 'Office 365',
    appId: 'office365',
    description: 'Security events related to your Office 365 services.'
  },
  gcp: {
    title: 'Google Cloud',
    appId: 'google-cloud',
    description: 'Security events related to your Google Cloud Platform services, collected directly via GCP API.' // TODO GCP
  },

  mitre: {
    title: 'MITRE ATT&CK',
    appId: 'mitre-attack',
    description: 'Explore security alerts mapped to adversary tactics and techniques for better threat understanding.'
  },
  'system-inventory': {
    title: 'System inventory',
    // This appId is not used, for consistency was added.
    appId: 'system-inventory',
    description: 'Networks, interfaces, protocols, processes, ports, packages, hotfixes, system and hardware information of your monitored endpoints.'
  },
  stats: {
    title: 'Stats',
    // This appId is not used, for consistency was added.
    appId: 'endpoint-summary',
    description: 'Stats for agent and logcollector'
  },
  configuration: {
    title: 'Configuration',
    // This appId is not used, for consistency was added.
    appId: 'endpoint-summary',
    description: 'Check the current agent configuration remotely applied by its group.'
  },
  osquery: {
    title: 'Osquery',
    appId: 'osquery',
    description: 'Osquery can be used to expose an operating system as a high-performance relational database.'
  },
  sca: {
    title: 'Configuration assessment',
    appId: 'configuration-assessment',
    description: 'Scan your assets as part of a configuration assessment audit.'
  },
  docker: {
    title: 'Docker',
    appId: 'docker',
    description: 'Monitor and collect the activity from Docker containers such as creation, running, starting, stopping or pausing events.'
  },
  github: {
    title: 'GitHub',
    appId: 'github',
    description: 'Monitoring events from audit logs of your GitHub organizations.'
  },
  'it-hygiene': {
    title: 'IT Hygiene',
    appId: 'it-hygiene',
    description: 'Collect data about the system inventory.'
  },
  devTools: {
    title: 'API console',
    appId: 'api-console',
    description: 'Test the API endpoints.'
  },
  logtest: {
    title: 'Test your logs',
    appId: 'ruleset-test',
    description: 'Check your ruleset testing logs.'
  },
  // TODO - Research the uses of this code.
  testConfiguration: {
    title: 'Test your configurations',
    appId: '',
    description: 'Check configurations before applying them'
  }
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJXQVpVSF9NT0RVTEVTIiwiZXhwb3J0cyIsImdlbmVyYWwiLCJ0aXRsZSIsImFwcElkIiwiZGVzY3JpcHRpb24iLCJmaW0iLCJwbSIsInZ1bHMiLCJvc2NhcCIsImF1ZGl0IiwicGNpIiwiZ2RwciIsImhpcGFhIiwibmlzdCIsInRzYyIsImNpc2NhdCIsIm1pY3Jvc29mdEdyYXBoQVBJIiwiYXdzIiwib2ZmaWNlIiwiZ2NwIiwibWl0cmUiLCJzdGF0cyIsImNvbmZpZ3VyYXRpb24iLCJvc3F1ZXJ5Iiwic2NhIiwiZG9ja2VyIiwiZ2l0aHViIiwiZGV2VG9vbHMiLCJsb2d0ZXN0IiwidGVzdENvbmZpZ3VyYXRpb24iXSwic291cmNlcyI6WyJ3YXp1aC1tb2R1bGVzLnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qXG4gKiBXYXp1aCBhcHAgLSBTaW1wbGUgZGVzY3JpcHRpb24gZm9yIGVhY2ggQXBwIHRhYnNcbiAqIENvcHlyaWdodCAoQykgMjAxNS0yMDIyIFdhenVoLCBJbmMuXG4gKlxuICogVGhpcyBwcm9ncmFtIGlzIGZyZWUgc29mdHdhcmU7IHlvdSBjYW4gcmVkaXN0cmlidXRlIGl0IGFuZC9vciBtb2RpZnlcbiAqIGl0IHVuZGVyIHRoZSB0ZXJtcyBvZiB0aGUgR05VIEdlbmVyYWwgUHVibGljIExpY2Vuc2UgYXMgcHVibGlzaGVkIGJ5XG4gKiB0aGUgRnJlZSBTb2Z0d2FyZSBGb3VuZGF0aW9uOyBlaXRoZXIgdmVyc2lvbiAyIG9mIHRoZSBMaWNlbnNlLCBvclxuICogKGF0IHlvdXIgb3B0aW9uKSBhbnkgbGF0ZXIgdmVyc2lvbi5cbiAqXG4gKiBGaW5kIG1vcmUgaW5mb3JtYXRpb24gYWJvdXQgdGhpcyBvbiB0aGUgTElDRU5TRSBmaWxlLlxuICovXG5leHBvcnQgY29uc3QgV0FaVUhfTU9EVUxFUyA9IHtcbiAgZ2VuZXJhbDoge1xuICAgIHRpdGxlOiAnVGhyZWF0IGh1bnRpbmcnLFxuICAgIGFwcElkOiAndGhyZWF0LWh1bnRpbmcnLFxuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ0Jyb3dzZSB0aHJvdWdoIHlvdXIgc2VjdXJpdHkgYWxlcnRzLCBpZGVudGlmeWluZyBpc3N1ZXMgYW5kIHRocmVhdHMgaW4geW91ciBlbnZpcm9ubWVudC4nLFxuICB9LFxuICBmaW06IHtcbiAgICB0aXRsZTogJ0ZpbGUgaW50ZWdyaXR5IG1vbml0b3JpbmcnLFxuICAgIGFwcElkOiAnZmlsZS1pbnRlZ3JpdHktbW9uaXRvcmluZycsXG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnQWxlcnRzIHJlbGF0ZWQgdG8gZmlsZSBjaGFuZ2VzLCBpbmNsdWRpbmcgcGVybWlzc2lvbnMsIGNvbnRlbnQsIG93bmVyc2hpcCBhbmQgYXR0cmlidXRlcy4nLFxuICB9LFxuICBwbToge1xuICAgIHRpdGxlOiAnTWFsd2FyZSBkZXRlY3Rpb24nLFxuICAgIGFwcElkOiAnbWFsd2FyZS1kZXRlY3Rpb24nLFxuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ0NoZWNrIGluZGljYXRvcnMgb2YgY29tcHJvbWlzZSB0cmlnZ2VyZWQgYnkgbWFsd2FyZSBpbmZlY3Rpb25zIG9yIGN5YmVyYXR0YWNrcy4nLFxuICB9LFxuICB2dWxzOiB7XG4gICAgdGl0bGU6ICdWdWxuZXJhYmlsaXR5IGRldGVjdGlvbicsXG4gICAgYXBwSWQ6ICd2dWxuZXJhYmlsaXR5LWRldGVjdGlvbicsXG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnRGlzY292ZXIgd2hhdCBhcHBsaWNhdGlvbnMgaW4geW91ciBlbnZpcm9ubWVudCBhcmUgYWZmZWN0ZWQgYnkgd2VsbC1rbm93biB2dWxuZXJhYmlsaXRpZXMuJyxcbiAgfSxcbiAgb3NjYXA6IHtcbiAgICB0aXRsZTogJ09wZW5TQ0FQJyxcbiAgICBhcHBJZDogJ29wZW5zY2FwJyxcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdDb25maWd1cmF0aW9uIGFzc2Vzc21lbnQgYW5kIGF1dG9tYXRpb24gb2YgY29tcGxpYW5jZSBtb25pdG9yaW5nIHVzaW5nIFNDQVAgY2hlY2tzLicsXG4gIH0sXG4gIGF1ZGl0OiB7XG4gICAgdGl0bGU6ICdTeXN0ZW0gYXVkaXRpbmcnLFxuICAgIGFwcElkOiAnc3lzdGVtLWF1ZGl0aW5nJyxcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdBdWRpdCB1c2VycyBiZWhhdmlvciwgbW9uaXRvcmluZyBjb21tYW5kIGV4ZWN1dGlvbiBhbmQgYWxlcnRpbmcgb24gYWNjZXNzIHRvIGNyaXRpY2FsIGZpbGVzLicsXG4gIH0sXG4gIHBjaToge1xuICAgIHRpdGxlOiAnUENJIERTUycsXG4gICAgYXBwSWQ6ICdwY2ktZHNzJyxcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdHbG9iYWwgc2VjdXJpdHkgc3RhbmRhcmQgZm9yIGVudGl0aWVzIHRoYXQgcHJvY2Vzcywgc3RvcmUgb3IgdHJhbnNtaXQgcGF5bWVudCBjYXJkaG9sZGVyIGRhdGEuJyxcbiAgfSxcbiAgZ2Rwcjoge1xuICAgIHRpdGxlOiAnR0RQUicsXG4gICAgYXBwSWQ6ICdnZHByJyxcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdHZW5lcmFsIERhdGEgUHJvdGVjdGlvbiBSZWd1bGF0aW9uIChHRFBSKSBzZXRzIGd1aWRlbGluZXMgZm9yIHByb2Nlc3Npbmcgb2YgcGVyc29uYWwgZGF0YS4nLFxuICB9LFxuICBoaXBhYToge1xuICAgIHRpdGxlOiAnSElQQUEnLFxuICAgIGFwcElkOiAnaGlwYWEnLFxuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ0hlYWx0aCBJbnN1cmFuY2UgUG9ydGFiaWxpdHkgYW5kIEFjY291bnRhYmlsaXR5IEFjdCBvZiAxOTk2IChISVBBQSkgcHJvdmlkZXMgZGF0YSBwcml2YWN5IGFuZCBzZWN1cml0eSBwcm92aXNpb25zIGZvciBzYWZlZ3VhcmRpbmcgbWVkaWNhbCBpbmZvcm1hdGlvbi4nLFxuICB9LFxuICBuaXN0OiB7XG4gICAgdGl0bGU6ICdOSVNUIDgwMC01MycsXG4gICAgYXBwSWQ6ICduaXN0LTgwMC01MycsXG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnTmF0aW9uYWwgSW5zdGl0dXRlIG9mIFN0YW5kYXJkcyBhbmQgVGVjaG5vbG9neSBTcGVjaWFsIFB1YmxpY2F0aW9uIDgwMC01MyAoTklTVCA4MDAtNTMpIHNldHMgZ3VpZGVsaW5lcyBmb3IgZmVkZXJhbCBpbmZvcm1hdGlvbiBzeXN0ZW1zLicsXG4gIH0sXG4gIHRzYzoge1xuICAgIHRpdGxlOiAnVFNDJyxcbiAgICBhcHBJZDogJ3RzYycsXG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnVHJ1c3QgU2VydmljZXMgQ3JpdGVyaWEgZm9yIFNlY3VyaXR5LCBBdmFpbGFiaWxpdHksIFByb2Nlc3NpbmcgSW50ZWdyaXR5LCBDb25maWRlbnRpYWxpdHksIGFuZCBQcml2YWN5JyxcbiAgfSxcbiAgY2lzY2F0OiB7XG4gICAgdGl0bGU6ICdDSVMtQ0FUJyxcbiAgICBhcHBJZDogJ2Npc2NhdCcsXG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnQ29uZmlndXJhdGlvbiBhc3Nlc3NtZW50IHVzaW5nIENlbnRlciBvZiBJbnRlcm5ldCBTZWN1cml0eSBzY2FubmVyIGFuZCBTQ0FQIGNoZWNrcy4nLFxuICB9LFxuICBtaWNyb3NvZnRHcmFwaEFQSToge1xuICAgIHRpdGxlOiAnTWljcm9zb2Z0IEdyYXBoIEFQSScsXG4gICAgYXBwSWQ6ICdtaWNyb3NvZnQtZ3JhcGgtYXBpJyxcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdTZWN1cml0eSBldmVudHMgcmVsYXRlZCB0byB5b3VyIE1pY3Jvc29mdCBHcmFwaCBzZXJ2aWNlcywgY29sbGVjdGVkIGRpcmVjdGx5IHZpYSBNaWNyb3NvZnQgR3JhcGggQVBJLicsXG4gIH0sXG4gIGF3czoge1xuICAgIHRpdGxlOiAnQVdTJyxcbiAgICBhcHBJZDogJ2FtYXpvbi13ZWItc2VydmljZXMnLFxuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1NlY3VyaXR5IGV2ZW50cyByZWxhdGVkIHRvIHlvdXIgQW1hem9uIEFXUyBzZXJ2aWNlcywgY29sbGVjdGVkIGRpcmVjdGx5IHZpYSBBV1MgQVBJLicsXG4gIH0sXG4gIG9mZmljZToge1xuICAgIHRpdGxlOiAnT2ZmaWNlIDM2NScsXG4gICAgYXBwSWQ6ICdvZmZpY2UzNjUnLFxuICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgZXZlbnRzIHJlbGF0ZWQgdG8geW91ciBPZmZpY2UgMzY1IHNlcnZpY2VzLicsXG4gIH0sXG4gIGdjcDoge1xuICAgIHRpdGxlOiAnR29vZ2xlIENsb3VkJyxcbiAgICBhcHBJZDogJ2dvb2dsZS1jbG91ZCcsXG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnU2VjdXJpdHkgZXZlbnRzIHJlbGF0ZWQgdG8geW91ciBHb29nbGUgQ2xvdWQgUGxhdGZvcm0gc2VydmljZXMsIGNvbGxlY3RlZCBkaXJlY3RseSB2aWEgR0NQIEFQSS4nLCAvLyBUT0RPIEdDUFxuICB9LFxuICBtaXRyZToge1xuICAgIHRpdGxlOiAnTUlUUkUgQVRUJkNLJyxcbiAgICBhcHBJZDogJ21pdHJlLWF0dGFjaycsXG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnRXhwbG9yZSBzZWN1cml0eSBhbGVydHMgbWFwcGVkIHRvIGFkdmVyc2FyeSB0YWN0aWNzIGFuZCB0ZWNobmlxdWVzIGZvciBiZXR0ZXIgdGhyZWF0IHVuZGVyc3RhbmRpbmcuJyxcbiAgfSxcbiAgJ3N5c3RlbS1pbnZlbnRvcnknOiB7XG4gICAgdGl0bGU6ICdTeXN0ZW0gaW52ZW50b3J5JyxcbiAgICAvLyBUaGlzIGFwcElkIGlzIG5vdCB1c2VkLCBmb3IgY29uc2lzdGVuY3kgd2FzIGFkZGVkLlxuICAgIGFwcElkOiAnc3lzdGVtLWludmVudG9yeScsXG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnTmV0d29ya3MsIGludGVyZmFjZXMsIHByb3RvY29scywgcHJvY2Vzc2VzLCBwb3J0cywgcGFja2FnZXMsIGhvdGZpeGVzLCBzeXN0ZW0gYW5kIGhhcmR3YXJlIGluZm9ybWF0aW9uIG9mIHlvdXIgbW9uaXRvcmVkIGVuZHBvaW50cy4nLFxuICB9LFxuICBzdGF0czoge1xuICAgIHRpdGxlOiAnU3RhdHMnLFxuICAgIC8vIFRoaXMgYXBwSWQgaXMgbm90IHVzZWQsIGZvciBjb25zaXN0ZW5jeSB3YXMgYWRkZWQuXG4gICAgYXBwSWQ6ICdlbmRwb2ludC1zdW1tYXJ5JyxcbiAgICBkZXNjcmlwdGlvbjogJ1N0YXRzIGZvciBhZ2VudCBhbmQgbG9nY29sbGVjdG9yJyxcbiAgfSxcbiAgY29uZmlndXJhdGlvbjoge1xuICAgIHRpdGxlOiAnQ29uZmlndXJhdGlvbicsXG4gICAgLy8gVGhpcyBhcHBJZCBpcyBub3QgdXNlZCwgZm9yIGNvbnNpc3RlbmN5IHdhcyBhZGRlZC5cbiAgICBhcHBJZDogJ2VuZHBvaW50LXN1bW1hcnknLFxuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ0NoZWNrIHRoZSBjdXJyZW50IGFnZW50IGNvbmZpZ3VyYXRpb24gcmVtb3RlbHkgYXBwbGllZCBieSBpdHMgZ3JvdXAuJyxcbiAgfSxcbiAgb3NxdWVyeToge1xuICAgIHRpdGxlOiAnT3NxdWVyeScsXG4gICAgYXBwSWQ6ICdvc3F1ZXJ5JyxcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdPc3F1ZXJ5IGNhbiBiZSB1c2VkIHRvIGV4cG9zZSBhbiBvcGVyYXRpbmcgc3lzdGVtIGFzIGEgaGlnaC1wZXJmb3JtYW5jZSByZWxhdGlvbmFsIGRhdGFiYXNlLicsXG4gIH0sXG4gIHNjYToge1xuICAgIHRpdGxlOiAnQ29uZmlndXJhdGlvbiBhc3Nlc3NtZW50JyxcbiAgICBhcHBJZDogJ2NvbmZpZ3VyYXRpb24tYXNzZXNzbWVudCcsXG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnU2NhbiB5b3VyIGFzc2V0cyBhcyBwYXJ0IG9mIGEgY29uZmlndXJhdGlvbiBhc3Nlc3NtZW50IGF1ZGl0LicsXG4gIH0sXG4gIGRvY2tlcjoge1xuICAgIHRpdGxlOiAnRG9ja2VyJyxcbiAgICBhcHBJZDogJ2RvY2tlcicsXG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnTW9uaXRvciBhbmQgY29sbGVjdCB0aGUgYWN0aXZpdHkgZnJvbSBEb2NrZXIgY29udGFpbmVycyBzdWNoIGFzIGNyZWF0aW9uLCBydW5uaW5nLCBzdGFydGluZywgc3RvcHBpbmcgb3IgcGF1c2luZyBldmVudHMuJyxcbiAgfSxcbiAgZ2l0aHViOiB7XG4gICAgdGl0bGU6ICdHaXRIdWInLFxuICAgIGFwcElkOiAnZ2l0aHViJyxcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdNb25pdG9yaW5nIGV2ZW50cyBmcm9tIGF1ZGl0IGxvZ3Mgb2YgeW91ciBHaXRIdWIgb3JnYW5pemF0aW9ucy4nLFxuICB9LFxuICAnaXQtaHlnaWVuZSc6IHtcbiAgICB0aXRsZTogJ0lUIEh5Z2llbmUnLFxuICAgIGFwcElkOiAnaXQtaHlnaWVuZScsXG4gICAgZGVzY3JpcHRpb246ICdDb2xsZWN0IGRhdGEgYWJvdXQgdGhlIHN5c3RlbSBpbnZlbnRvcnkuJyxcbiAgfSxcbiAgZGV2VG9vbHM6IHtcbiAgICB0aXRsZTogJ0FQSSBjb25zb2xlJyxcbiAgICBhcHBJZDogJ2FwaS1jb25zb2xlJyxcbiAgICBkZXNjcmlwdGlvbjogJ1Rlc3QgdGhlIEFQSSBlbmRwb2ludHMuJyxcbiAgfSxcbiAgbG9ndGVzdDoge1xuICAgIHRpdGxlOiAnVGVzdCB5b3VyIGxvZ3MnLFxuICAgIGFwcElkOiAncnVsZXNldC10ZXN0JyxcbiAgICBkZXNjcmlwdGlvbjogJ0NoZWNrIHlvdXIgcnVsZXNldCB0ZXN0aW5nIGxvZ3MuJyxcbiAgfSxcblxuICAvLyBUT0RPIC0gUmVzZWFyY2ggdGhlIHVzZXMgb2YgdGhpcyBjb2RlLlxuICB0ZXN0Q29uZmlndXJhdGlvbjoge1xuICAgIHRpdGxlOiAnVGVzdCB5b3VyIGNvbmZpZ3VyYXRpb25zJyxcbiAgICBhcHBJZDogJycsXG4gICAgZGVzY3JpcHRpb246ICdDaGVjayBjb25maWd1cmF0aW9ucyBiZWZvcmUgYXBwbHlpbmcgdGhlbScsXG4gIH0sXG59O1xuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FB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