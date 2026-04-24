'use strict';

/**
 * public/index.js — Network Graph plugin UI
 *
 * This file contains the entire browser-side plugin:
 *   - Constants (colours, API paths, poll interval, severity mapping)
 *   - Helper functions (fetch, edge colouring, OS label, incident display)
 *   - D3 force-directed graph renderer (createGraph)
 *   - Incident sidebar renderer (createSidebar)
 *   - Page layout builder and polling loop (mountApp)
 *   - OSD plugin class registration (NetworkGraphPlugin)
 *
 * D3 is imported here and bundled inline by webpack (see webpack.config.js).
 * No other external libraries are used — everything else is vanilla JS.
 *
 * DATA FLOW (per poll cycle)
 * ══════════════════════════
 * 1. fetchData() calls the two OSD proxy routes in parallel.
 * 2. /api/network_graph/agents  → list of enrolled Wazuh agents.
 * 3. /api/network_graph/alerts  → alerts from the last 5 minutes.
 * 4. Alerts are reduced to a map: agentId → [rule.level, …]
 * 5. IP fields in alerts are compared against agent IPs to detect
 *    agent-to-agent communication (lateral movement) → peer links.
 * 6. graph.update(agents, alertMap) redraws nodes and edges.
 * 7. sidebar.update(rawAlerts, agents, ipToAgent) populates the incident list.
 *
 * LAYOUT
 * ══════
 * element (flex-column)
 *   ├── header (title, status, refresh button, sidebar toggle)
 *   ├── legend (edge colour key + node type key)
 *   └── mainRow (flex-row, flex:1)
 *        ├── graphPane (flex:1) — D3 SVG canvas
 *        └── sidebarPane (320px) — incident list
 */

var d3 = require('d3');

/* ── Localisation helpers ────────────────────────────────────────────────────
   _t(key)           — return translated string for current language.
   _tFmt(key, vars)  — same, then substitute {varName} placeholders.
   Falls back to English if the localization plugin is not installed. */
var _NG_EN = {
  'ng.showAll':      'Show all {count} incidents',
  'ng.lastRefresh':  'Last refresh: {time}',
  'ng.agentsStatus': '{count} agent(s) – last updated {time}',
};
function _t(key) {
  return (window.__fypLocale__ && window.__fypLocale__.t(key)) || _NG_EN[key] || key;
}
function _tFmt(key, vars) {
  var s = _t(key);
  Object.keys(vars || {}).forEach(function(k) {
    s = s.replace('{' + k + '}', String(vars[k]));
  });
  return s;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Constants
   ───────────────────────────────────────────────────────────────────────────── */

var API_BASE      = '/api/network_graph';  // Base path for the two OSD proxy routes.
var POLL_INTERVAL = 10000;                 // Auto-refresh interval in milliseconds.
var MANAGER_ID    = '000';                 // Wazuh always assigns ID 000 to the manager.

/* Edge colours — the highest alert level seen for an agent in the last 5 min
   determines which colour its edge to the manager is drawn in. */
var COLOR_NONE    = '#888888';  // Gray   — no recent alerts
var COLOR_LOW     = '#00a550';  // Green  — rule.level < 7
var COLOR_MEDIUM  = '#f0a500';  // Yellow — rule.level 7–11
var COLOR_HIGH    = '#d4371c';  // Red    — rule.level ≥ 12

/* Node colours */
var COLOR_MANAGER   = '#006BB4';  // Blue — manager node fill
var COLOR_ACTIVE    = '#017D73';  // Teal — active agent circle border
var COLOR_INACTIVE  = '#6a6a6a';  // Grey — disconnected agent circle border
var COLOR_NODE_FILL = '#f1f5f9';  // Light grey — agent node interior fill

/* Sidebar severity chip colours (level → colour palette) */
var SEVERITY_COLORS = {
  critical: { bg: '#fed7d7', text: '#c53030', border: '#fc8181' },  // level ≥ 15
  high:     { bg: '#feebc8', text: '#c05621', border: '#f6ad55' },  // level 12–14
  medium:   { bg: '#fefcbf', text: '#975a16', border: '#f6e05e' },  // level 7–11
  low:      { bg: '#bee3f8', text: '#2b6cb0', border: '#90cdf4' },  // level 4–6
  info:     { bg: '#e2e8f0', text: '#4a5568', border: '#cbd5e0' },  // level < 4
};

/* Wazuh Discover deep-link for a single alert by _id */
var INVESTIGATE_URL_TEMPLATE =
  "/app/wazuh#/overview/?tab=general&tabView=discover&_g=(filters:!())" +
  "&_a=(filters:!((meta:(alias:!n,disabled:!f,index:'wazuh-alerts-*',key:_id," +
  "negate:!f,params:(query:'ALERT_ID'),type:phrase),query:(match_phrase:(_id:'ALERT_ID'))))," +
  "query:(language:kuery,query:''))";

/* ─────────────────────────────────────────────────────────────────────────────
   Helper: fetchJSON
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Fetch JSON from one of the OSD server-side proxy routes.
 *
 * credentials: 'same-origin' ensures the OSD session cookie is sent so the
 * request is authenticated by OSD's HTTP layer before reaching the route handler.
 *
 * @param {string} url  Full path, e.g. '/api/network_graph/agents'
 * @returns {Promise<object>}
 */
function fetchJSON(url) {
  return fetch(url, {
    headers:     { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  }).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status + ' – ' + url);
    return res.json();
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   Helper: edgeColor
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Determine the edge colour for an agent based on its recent alert levels.
 * The most severe level seen wins (i.e. one high-severity alert makes the
 * edge red regardless of other lower-severity alerts).
 *
 * @param {number[]} levels  Array of rule.level values for this agent.
 * @returns {string}  Hex colour string.
 */
function edgeColor(levels) {
  if (!levels || levels.length === 0) return COLOR_NONE;
  var max = Math.max.apply(null, levels);
  if (max >= 12) return COLOR_HIGH;
  if (max >= 7)  return COLOR_MEDIUM;
  return COLOR_LOW;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Helper: levelCategory
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Map a levels array to a named severity string.
 * Used as the suffix for SVG arrowhead marker IDs (e.g. 'arrow-red').
 *
 * @param {number[]} levels
 * @returns {'gray'|'green'|'yellow'|'red'}
 */
function levelCategory(levels) {
  if (!levels || levels.length === 0) return 'gray';
  var max = Math.max.apply(null, levels);
  if (max >= 12) return 'red';
  if (max >= 7)  return 'yellow';
  return 'green';
}

/* ─────────────────────────────────────────────────────────────────────────────
   Helper: osLabel
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Build a short OS description string from a Wazuh agent record.
 * Truncated to 20 characters so it fits inside the node tooltip.
 *
 * @param {object} agent  Wazuh agent object (may have .os.name, .os.version).
 * @returns {string}
 */
function osLabel(agent) {
  if (!agent.os) return '';
  var n = (agent.os.name || '') + ' ' + (agent.os.version || '');
  return n.trim().substring(0, 20);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Helper: severityFromLevel
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Map a numeric rule level to a named severity tier.
 *
 * @param {number} level  Wazuh rule.level value.
 * @returns {'critical'|'high'|'medium'|'low'|'info'}
 */
function severityFromLevel(level) {
  if (level >= 15) return 'critical';
  if (level >= 12) return 'high';
  if (level >= 7)  return 'medium';
  if (level >= 4)  return 'low';
  return 'info';
}

/* ─────────────────────────────────────────────────────────────────────────────
   Helper: relativeTime
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Convert an ISO 8601 timestamp to a human-readable relative string.
 *
 * @param {string} isoTimestamp  ISO 8601 timestamp string.
 * @returns {string}  e.g. "30s ago", "5m ago", "2h ago".
 */
function relativeTime(isoTimestamp) {
  if (!isoTimestamp) return '';
  try {
    var diffMs = Date.now() - new Date(isoTimestamp).getTime();
    if (diffMs < 0) diffMs = 0;
    var secs = Math.floor(diffMs / 1000);
    if (secs < 60)  return secs + 's ago';
    var mins = Math.floor(secs / 60);
    if (mins < 60)  return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    return hours + 'h ago';
  } catch (e) {
    return '';
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Helper: incidentNodes
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Return a human-readable source/destination label for an incident sidebar entry.
 *
 * Priority:
 *   1. If both srcip and dstip match enrolled agents → "Agent-A → Agent-B"
 *   2. If only srcip matches an enrolled agent → agent name
 *   3. Fall back to the alert's own agent.name or agent.id
 *
 * @param {object}   alert      Raw alert object from the Wazuh API.
 * @param {object[]} agents     Array of enrolled agent objects.
 * @param {object}   ipToAgent  IP → agentId reverse lookup map.
 * @returns {string}
 */
function incidentNodes(alert, agents, ipToAgent) {
  var srcIp     = alert.data && (alert.data.srcip  || alert.data.src_ip);
  var dstIp     = alert.data && (alert.data.dstip  || alert.data.dst_ip);
  var srcAgentId = srcIp && ipToAgent[srcIp];
  var dstAgentId = dstIp && ipToAgent[dstIp];

  var agentNameById = {};
  (agents || []).forEach(function(a) {
    agentNameById[a.id] = a.name || ('Agent ' + a.id);
  });

  if (srcAgentId && dstAgentId) {
    return (agentNameById[srcAgentId] || srcAgentId) +
           ' → ' +
           (agentNameById[dstAgentId] || dstAgentId);
  }
  if (srcAgentId) return agentNameById[srcAgentId] || srcAgentId;
  return (alert.agent && alert.agent.name) ||
         (alert.agent && alert.agent.id)   || 'Unknown';
}

/* ─────────────────────────────────────────────────────────────────────────────
   Helper: investigateUrl
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Build a Wazuh Discover deep-link URL filtered to a specific alert _id.
 *
 * @param {string} alertId  The alert document _id (returned as `id` by the Wazuh API).
 * @returns {string}
 */
function investigateUrl(alertId) {
  var encoded = encodeURIComponent(alertId);
  return INVESTIGATE_URL_TEMPLATE.split('ALERT_ID').join(encoded);
}

/* ─────────────────────────────────────────────────────────────────────────────
   D3 graph renderer — createGraph()
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Initialise a D3 force-directed graph inside `container`.
 *
 * Called once on first data load.  Returns an object with:
 *   update(agents, alertMap)       — redraw nodes and edges with new data.
 *   highlightEdge(nodeA, nodeB)    — temporarily thicken a specific edge.
 *   clearHighlight()               — reset all edge widths to default.
 *   destroy()                      — stop simulation and clear the DOM.
 *
 * @param {HTMLElement} container  DOM element to render the SVG into.
 * @param {object}      [opts]     Optional callbacks.
 * @param {Function}    [opts.onEdgeClick]  Called with (srcId, dstId) when an edge is clicked.
 * @returns {{ update: Function, highlightEdge: Function, clearHighlight: Function, destroy: Function }}
 */
function createGraph(container, opts) {
  var onEdgeClick = (opts && opts.onEdgeClick) || function() {};

  var width  = container.clientWidth  || 900;
  var height = container.clientHeight || 600;

  /* ── SVG root ─────────────────────────────────────────────────────────────
     viewBox stays fixed; SVG scales to fill the container via width/height 100%.
     The ng-graph-svg class allows dark-theme CSS to override the background. */
  var svg = d3.select(container)
    .append('svg')
    .attr('class',   'ng-graph-svg')
    .attr('width',   '100%')
    .attr('height',  '100%')
    .attr('viewBox', '0 0 ' + width + ' ' + height)
    .style('background', '#f8fafc');

  /* ── SVG arrowhead markers ────────────────────────────────────────────────
     One marker per severity colour.  Used as marker-end on peer (dashed) edges
     to show direction (source agent → destination agent). */
  var defs = svg.append('defs');
  ['gray', 'green', 'yellow', 'red'].forEach(function(col) {
    var colours = {
      gray:   COLOR_NONE,
      green:  COLOR_LOW,
      yellow: COLOR_MEDIUM,
      red:    COLOR_HIGH,
    };
    defs.append('marker')
      .attr('id',          'arrow-' + col)
      .attr('viewBox',     '0 -5 10 10')
      .attr('refX',        20)
      .attr('refY',        0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient',      'auto')
      .append('path')
        .attr('d',    'M0,-5L10,0L0,5')
        .attr('fill', colours[col]);
  });

  /* ── Main group (receives zoom transform) ── */
  var g = svg.append('g');

  /* ── Zoom + pan ── */
  svg.call(
    d3.zoom()
      .scaleExtent([0.2, 5])
      .on('zoom', function(event) { g.attr('transform', event.transform); })
  );

  /* ── SVG layers (links behind nodes) ── */
  var linkLayer = g.append('g').attr('class', 'links');
  var nodeLayer = g.append('g').attr('class', 'nodes');

  /* ── Hover tooltip ── */
  var tooltip = d3.select(container)
    .append('div')
    .style('position',       'absolute')
    .style('background',     'rgba(255,255,255,0.97)')
    .style('color',          '#1a202c')
    .style('border',         '1px solid #e2e8f0')
    .style('box-shadow',     '0 2px 8px rgba(0,0,0,0.12)')
    .style('padding',        '8px 12px')
    .style('border-radius',  '4px')
    .style('font-size',      '12px')
    .style('pointer-events', 'none')
    .style('opacity',        0)
    .style('z-index',        999);

  /* ── Force simulation ── */
  var simulation = d3.forceSimulation()
    .force('link',    d3.forceLink().id(function(d) { return d.id; }).distance(120))
    .force('charge',  d3.forceManyBody().strength(-300))
    .force('center',  d3.forceCenter(width / 2, height / 2))
    .force('collide', d3.forceCollide().radius(35));

  var nodesData  = [];
  var linksData  = [];
  var prevNodeIds = new Set();

  /* ── Drag behaviour ── */
  function drag(sim) {
    return d3.drag()
      .on('start', function(event, d) {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', function(event, d) {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', function(event, d) {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
  }

  /* ── update() ── */
  function update(agents, alertMap) {

    /* Snapshot existing node positions before building new data. */
    var posMap = {};
    simulation.nodes().forEach(function(n) {
      if (n.id != null) {
        posMap[n.id] = { x: n.x, y: n.y, vx: n.vx || 0, vy: n.vy || 0 };
      }
    });

    /* Manager node */
    var managerPos = posMap[MANAGER_ID] || {};
    var manager = {
      id:        MANAGER_ID,
      name:      'Wazuh Manager',
      ip:        '127.0.0.1',
      os:        'Manager',
      status:    'active',
      isManager: true,
      x:  managerPos.x,  y:  managerPos.y,
      vx: managerPos.vx, vy: managerPos.vy,
    };

    /* Agent nodes */
    var agentNodes = agents.map(function(a) {
      var pos = posMap[a.id] || {};
      return {
        id:        a.id,
        name:      a.name   || 'Agent ' + a.id,
        ip:        a.ip     || 'N/A',
        os:        osLabel(a),
        status:    a.status || 'disconnected',
        isManager: false,
        x:  pos.x,  y:  pos.y,
        vx: pos.vx, vy: pos.vy,
      };
    });

    nodesData = [manager].concat(agentNodes);

    /* Detect topology change */
    var newNodeIds = new Set(nodesData.map(function(n) { return n.id; }));
    var topologyChanged = (newNodeIds.size !== prevNodeIds.size);
    if (!topologyChanged) {
      newNodeIds.forEach(function(id) {
        if (!prevNodeIds.has(id)) { topologyChanged = true; }
      });
    }
    prevNodeIds = newNodeIds;

    /* Agent → manager edges */
    var agentLinks = agentNodes.map(function(a) {
      var levels = alertMap[a.id] || [];
      return {
        source:   a.id,
        target:   MANAGER_ID,
        color:    edgeColor(levels),
        severity: levelCategory(levels),
      };
    });

    /* Agent → agent peer edges */
    var peerLinks = (alertMap._peers || []).map(function(p) {
      return {
        source:   p.source,
        target:   p.target,
        color:    edgeColor([p.maxLevel]),
        severity: levelCategory([p.maxLevel]),
        isPeer:   true,
      };
    });

    linksData = agentLinks.concat(peerLinks);

    /* D3 data join: links */
    var linkSel = linkLayer.selectAll('line').data(linksData, function(d) {
      return d.source + '-' + d.target + '-' + (d.isPeer ? 'p' : 'a');
    });

    var linkEnter = linkSel.enter()
      .append('line')
      .attr('stroke-width',     function(d) { return d.isPeer ? 1.5 : 2; })
      .attr('stroke-dasharray', function(d) { return d.isPeer ? '5,3' : null; })
      .attr('stroke',           function(d) { return d.color; })
      .attr('marker-end',       function(d) {
        return d.isPeer ? 'url(#arrow-' + d.severity + ')' : null;
      })
      .style('cursor', 'pointer');

    /* Edge click → sidebar scroll */
    linkEnter.on('click', function(event, d) {
      var srcId = typeof d.source === 'object' ? d.source.id : d.source;
      var dstId = typeof d.target === 'object' ? d.target.id : d.target;
      onEdgeClick(srcId, dstId);
    });

    /* Smooth colour transition on existing edges */
    linkSel.transition().duration(500)
      .attr('stroke',     function(d) { return d.color; })
      .attr('marker-end', function(d) {
        return d.isPeer ? 'url(#arrow-' + d.severity + ')' : null;
      });

    linkSel.exit().remove();

    /* D3 data join: nodes */
    var node = nodeLayer.selectAll('g.node').data(nodesData, function(d) { return d.id; });

    var nodeEnter = node.enter()
      .append('g')
      .attr('class', 'node')
      .style('opacity', 0)
      .call(drag(simulation))
      .on('mouseover', function(event, d) {
        tooltip
          .style('opacity', 1)
          .html(
            '<strong>' + d.name + '</strong><br/>' +
            'ID: '     + d.id     + '<br/>' +
            'IP: '     + d.ip     + '<br/>' +
            'OS: '     + d.os     + '<br/>' +
            'Status: ' + d.status
          )
          .style('left', (event.offsetX + 12) + 'px')
          .style('top',  (event.offsetY - 28) + 'px');
      })
      .on('mousemove', function(event) {
        tooltip
          .style('left', (event.offsetX + 12) + 'px')
          .style('top',  (event.offsetY - 28) + 'px');
      })
      .on('mouseout', function() {
        tooltip.style('opacity', 0);
      });

    /* Manager node */
    nodeEnter.filter(function(d) { return d.isManager; })
      .append('circle')
        .attr('r',            28)
        .attr('fill',         COLOR_MANAGER)
        .attr('stroke',       '#4fc3f7')
        .attr('stroke-width', 3);

    nodeEnter.filter(function(d) { return d.isManager; })
      .append('text')
        .attr('text-anchor',  'middle')
        .attr('dy',           '0.35em')
        .attr('font-size',    '9px')
        .attr('fill',         '#ffffff')
        .attr('pointer-events', 'none')
        .text('MGR');

    /* Agent node */
    nodeEnter.filter(function(d) { return !d.isManager; })
      .append('circle')
        .attr('r',    16)
        .attr('fill', COLOR_NODE_FILL);

    nodeEnter.filter(function(d) { return !d.isManager; })
      .append('text')
        .attr('text-anchor',  'middle')
        .attr('dy',           '0.35em')
        .attr('font-size',    '7px')
        .attr('fill',         '#4a5568')
        .attr('pointer-events', 'none')
        .text(function(d) {
          var os = (d.os || '').toLowerCase();
          if (os.indexOf('windows') !== -1)                                    return 'WIN';
          if (os.indexOf('ubuntu')  !== -1 || os.indexOf('debian') !== -1)    return 'DEB';
          if (os.indexOf('centos')  !== -1 || os.indexOf('rhel')   !== -1 ||
              os.indexOf('red hat') !== -1)                                    return 'RPM';
          return 'LNX';
        });

    nodeEnter.filter(function(d) { return !d.isManager; })
      .append('text')
        .attr('class',        'namelabel')
        .attr('text-anchor',  'middle')
        .attr('dy',           '2.5em')
        .attr('font-size',    '10px')
        .attr('fill',         '#4a5568')
        .attr('pointer-events', 'none');

    /* Fade in new nodes */
    nodeEnter.transition().duration(400).style('opacity', 1);

    /* Fade out removed nodes */
    node.exit()
      .transition().duration(400)
      .style('opacity', 0)
      .remove();

    /* Merge and sync attributes */
    var nodeAll = nodeEnter.merge(node);

    nodeAll.filter(function(d) { return !d.isManager; })
      .select('circle')
        .attr('stroke', function(d) {
          return d.status === 'active' ? COLOR_ACTIVE : COLOR_INACTIVE;
        })
        .attr('stroke-width', 2.5);

    nodeAll.select('text.namelabel')
      .text(function(d) { return d.name; });

    /* Update simulation */
    simulation
      .nodes(nodesData)
      .on('tick', ticked);

    simulation.force('link').links(linksData);

    if (topologyChanged) {
      simulation.alpha(0.1).restart();
    }

    function ticked() {
      linkLayer.selectAll('line')
        .attr('x1', function(d) { return d.source.x; })
        .attr('y1', function(d) { return d.source.y; })
        .attr('x2', function(d) { return d.target.x; })
        .attr('y2', function(d) { return d.target.y; });

      nodeLayer.selectAll('g.node')
        .attr('transform', function(d) {
          return 'translate(' + d.x + ',' + d.y + ')';
        });
    }
  }

  /* ── highlightEdge(nodeA, nodeB) ──
     Thicken the edge between two nodes and add a glow filter.
     Auto-clears after 2 seconds. */
  function highlightEdge(nodeA, nodeB) {
    linkLayer.selectAll('line').each(function(d) {
      var src = typeof d.source === 'object' ? d.source.id : d.source;
      var tgt = typeof d.target === 'object' ? d.target.id : d.target;
      var isMatch = (src === nodeA && tgt === nodeB) || (src === nodeB && tgt === nodeA);
      d3.select(this)
        .attr('stroke-width', isMatch ? 5 : (d.isPeer ? 1.5 : 2))
        .style('filter', isMatch ? 'drop-shadow(0 0 4px currentColor)' : null);
    });
    setTimeout(clearHighlight, 2000);
  }

  /* ── clearHighlight() ── */
  function clearHighlight() {
    linkLayer.selectAll('line')
      .attr('stroke-width', function(d) { return d.isPeer ? 1.5 : 2; })
      .style('filter', null);
  }

  /**
   * Stop the simulation and remove all SVG/DOM content from the container.
   */
  function destroy() {
    simulation.stop();
    d3.select(container).selectAll('*').remove();
  }

  return { update: update, highlightEdge: highlightEdge, clearHighlight: clearHighlight, destroy: destroy };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Incident sidebar — createSidebar()
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Build and manage the incident sidebar inside `container`.
 *
 * The sidebar displays recent alerts (last 5 minutes) with severity chips,
 * rule descriptions, relative timestamps, group chips, and investigate links.
 *
 * Returns:
 *   update(rawAlerts, agents, ipToAgent)  — repopulate the list with fresh data.
 *   scrollToIncident(nodeA, nodeB)        — scroll to first incident for an edge.
 *   pulseEntry(alertId)                  — animate a specific entry.
 *   destroy()                            — clear the DOM.
 *
 * @param {HTMLElement} container  DOM element to render the sidebar into.
 * @param {object}      [opts]     Optional callbacks.
 * @param {Function}    [opts.onIncidentHover]     Called with (srcId, dstId) on hover.
 * @param {Function}    [opts.onIncidentHoverOut]  Called with no args on hover out.
 * @returns {{ update: Function, scrollToIncident: Function, pulseEntry: Function, destroy: Function }}
 */
function createSidebar(container, opts) {
  var onIncidentHover    = (opts && opts.onIncidentHover)    || function() {};
  var onIncidentHoverOut = (opts && opts.onIncidentHoverOut) || function() {};

  /* Closure state updated on each refresh cycle. */
  var currentAlerts    = [];
  var currentAgents    = [];
  var currentIpToAgent = {};
  var showAllCap       = false;  // When true, bypass the 50-item display cap.

  /* ── Header ── */
  var sidebarHeader = document.createElement('div');
  sidebarHeader.className = 'ng-sidebar-header';
  container.appendChild(sidebarHeader);

  /* Title row: "Recent Incidents" + count badge */
  var titleRow = document.createElement('div');
  titleRow.style.cssText = 'display:flex;align-items:center;margin-bottom:4px;';

  var titleEl = document.createElement('span');
  titleEl.textContent = 'Recent Incidents';
  titleEl.style.cssText = 'font-weight:600;font-size:13px;color:#2d3748;flex:1;';

  var countBadge = document.createElement('span');
  countBadge.className = 'ng-count-badge';
  countBadge.textContent = '0';

  titleRow.appendChild(titleEl);
  titleRow.appendChild(countBadge);
  sidebarHeader.appendChild(titleRow);

  /* Subtitle: last refresh time */
  var subtitleEl = document.createElement('div');
  subtitleEl.className = 'ng-sidebar-subtitle';
  subtitleEl.textContent = 'Waiting for data…';
  sidebarHeader.appendChild(subtitleEl);

  /* Filter dropdown */
  var filterSelect = document.createElement('select');
  filterSelect.className = 'ng-filter-select';
  filterSelect.innerHTML =
    '<option value="all">All severities</option>' +
    '<option value="high">High+ (≥12)</option>' +
    '<option value="medium">Medium+ (≥7)</option>';
  sidebarHeader.appendChild(filterSelect);

  /* ── Scrollable incident list ── */
  var incidentList = document.createElement('div');
  incidentList.className = 'ng-incident-list';
  container.appendChild(incidentList);

  /* Empty state (shown when there are no incidents) */
  var emptyState = document.createElement('div');
  emptyState.className = 'ng-empty-state';
  emptyState.innerHTML =
    '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" style="margin-bottom:8px;">' +
      '<circle cx="12" cy="12" r="10" stroke="#48BB78" stroke-width="2"/>' +
      '<path d="M8 12l3 3 5-5" stroke="#48BB78" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>' +
    '<span>No incidents in the last 5 minutes.<br/>System is quiet.</span>';
  incidentList.appendChild(emptyState);

  /* Show-all button (shown when the 50-item cap is active) */
  var showAllBtn = document.createElement('div');
  showAllBtn.className = 'ng-show-all-btn';
  showAllBtn.style.display = 'none';
  incidentList.appendChild(showAllBtn);

  /* ── getMinLevel: translate filter value to numeric threshold ── */
  function getMinLevel() {
    switch (filterSelect.value) {
      case 'high':   return 12;
      case 'medium': return 7;
      default:       return 0;
    }
  }

  /* ── renderList: run D3 data join and update the DOM ── */
  function renderList() {
    var minLevel = getMinLevel();
    var filtered = currentAlerts.filter(function(a) {
      var lvl = a.rule && a.rule.level != null ? a.rule.level : 0;
      return lvl >= minLevel;
    });

    var total   = filtered.length;
    var capped  = !showAllCap && total > 50;
    var displayed = capped ? filtered.slice(0, 50) : filtered;

    countBadge.textContent = total;

    if (capped) {
      showAllBtn.textContent = _tFmt('ng.showAll', { count: total });
      showAllBtn.style.display = 'block';
    } else {
      showAllBtn.style.display = 'none';
    }

    /* D3 data join — key = alert document _id for stable identity. */
    var sel = d3.select(incidentList)
      .selectAll('div.ng-incident')
      .data(displayed, function(d, i) { return d.id || i; });

    var entering = sel.enter().append('div').attr('class', 'ng-incident ng-incident-new');

    /* Build each new incident entry's inner DOM. */
    entering.each(function(d) {
      var el = this;

      /* Resolve src/dst agents for cross-link attributes. */
      var srcIp     = d.data && (d.data.srcip  || d.data.src_ip);
      var dstIp     = d.data && (d.data.dstip  || d.data.dst_ip);
      var srcAgent  = srcIp && currentIpToAgent[srcIp];
      var dstAgent  = dstIp && currentIpToAgent[dstIp];

      el.setAttribute('data-alert-id', d.id || '');
      el.setAttribute('data-src', srcAgent || (d.agent && d.agent.id) || '');
      el.setAttribute('data-dst', dstAgent || MANAGER_ID);

      /* Severity chip. */
      var level   = (d.rule && d.rule.level != null) ? d.rule.level : 0;
      var sev     = severityFromLevel(level);
      var sc      = SEVERITY_COLORS[sev];

      /* Description (truncated for display; full text in title attribute). */
      var fullDesc = (d.rule && d.rule.description) || ('Rule ' + (d.rule && d.rule.id || '?'));
      var shortDesc = fullDesc.length > 75 ? fullDesc.substring(0, 75) + '…' : fullDesc;

      /* Relative timestamp */
      var ts = relativeTime(d.timestamp || d['@timestamp'] || '');

      /* Node label */
      var nodeLabel = incidentNodes(d, currentAgents, currentIpToAgent);

      /* Group chips (skip long/noisy group names) */
      var groups = Array.isArray(d.rule && d.rule.groups)
        ? d.rule.groups.filter(function(g) { return g && g.length < 22; }).slice(0, 3)
        : [];

      /* Investigate link (only if we have an _id). */
      var investigateHtml = d.id
        ? '<a href="' + investigateUrl(d.id) + '" target="_blank" rel="noopener noreferrer" ' +
          'title="Open in Wazuh Discover" class="ng-investigate-link" ' +
          'onclick="event.stopPropagation()">🔍</a>'
        : '';

      el.innerHTML =
        '<div class="ng-incident-row1">' +
          '<span class="ng-sev-chip" title="Rule level ' + level + '" ' +
            'style="background:' + sc.bg + ';color:' + sc.text + ';border-color:' + sc.border + ';">' +
            level +
          '</span>' +
          '<span class="ng-incident-desc" title="' + fullDesc.replace(/"/g, '&quot;') + '">' +
            shortDesc +
          '</span>' +
        '</div>' +
        '<div class="ng-incident-row2">' +
          '<span class="ng-incident-nodes">' + nodeLabel + '</span>' +
          '<span class="ng-incident-ts">' + ts + '</span>' +
          investigateHtml +
        '</div>' +
        (groups.length
          ? '<div class="ng-incident-groups">' +
              groups.map(function(g) {
                return '<span class="ng-group-chip">' + g + '</span>';
              }).join('') +
            '</div>'
          : '');
    });

    /* Hover handlers for graph cross-linking. */
    entering
      .on('mouseover', function(event, d) {
        var srcId = this.getAttribute('data-src');
        var dstId = this.getAttribute('data-dst');
        if (srcId) onIncidentHover(srcId, dstId);
        d3.select(this).style('background', '#f7fafc');
      })
      .on('mouseout', function() {
        d3.select(this).style('background', null);
        onIncidentHoverOut();
      });

    /* Remove new-entry animation class after 3 seconds. */
    entering.each(function() {
      var el = this;
      setTimeout(function() { el.classList.remove('ng-incident-new'); }, 3000);
    });

    sel.exit().remove();

    /* Show/hide empty state based on whether any entries are visible. */
    var hasEntries = incidentList.querySelectorAll('div.ng-incident').length > 0;
    emptyState.style.display = hasEntries ? 'none' : 'flex';
  }

  filterSelect.addEventListener('change', function() {
    showAllCap = false;
    renderList();
  });

  showAllBtn.addEventListener('click', function() {
    showAllCap = true;
    renderList();
  });

  /* ── update(rawAlerts, agents, ipToAgent) ── */
  function update(rawAlerts, agents, ipToAgent) {
    /* Fade the list briefly to signal a refresh. */
    d3.select(incidentList).transition().duration(200).style('opacity', 0.5);

    var prevScrollTop = incidentList.scrollTop;

    currentAlerts    = rawAlerts || [];
    currentAgents    = agents    || [];
    currentIpToAgent = ipToAgent || {};
    showAllCap       = false;

    renderList();

    /* Fade back and restore scroll position. */
    d3.select(incidentList).transition().duration(200).delay(200).style('opacity', 1)
      .on('end', function() { incidentList.scrollTop = prevScrollTop; });

    subtitleEl.textContent = _tFmt('ng.lastRefresh', { time: new Date().toLocaleTimeString() });

    /* Pulse header border if any high-severity alert is present. */
    var hadHigh = currentAlerts.some(function(a) { return a.rule && a.rule.level >= 12; });
    if (hadHigh) {
      sidebarHeader.style.borderLeft = '3px solid ' + COLOR_HIGH;
      setTimeout(function() { sidebarHeader.style.borderLeft = ''; }, 2000);
    }
  }

  /* ── scrollToIncident(nodeA, nodeB) ──
     Find the first incident entry involving an edge between two agent IDs
     and scroll it into view. */
  function scrollToIncident(nodeA, nodeB) {
    var found = incidentList.querySelector(
      '[data-src="' + nodeA + '"][data-dst="' + nodeB + '"],' +
      '[data-src="' + nodeB + '"][data-dst="' + nodeA + '"]'
    );
    if (!found) return;
    found.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    pulseEntry(found.getAttribute('data-alert-id'));
  }

  /* ── pulseEntry(alertId) — animate a single incident entry. ── */
  function pulseEntry(alertId) {
    if (!alertId) return;
    var el = incidentList.querySelector('[data-alert-id="' + alertId + '"]');
    if (!el) return;
    el.classList.add('ng-incident-pulse');
    setTimeout(function() { el.classList.remove('ng-incident-pulse'); }, 2000);
  }

  function destroy() {
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  return { update: update, scrollToIncident: scrollToIncident, pulseEntry: pulseEntry, destroy: destroy };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Page layout and polling — mountApp()
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Build the full page layout, start the data poll, and return an unmount function.
 *
 * PAGE STRUCTURE
 * ══════════════
 * params.element (full-page container, class "ng-layout")
 *   ├── header (title, status, refresh button, sidebar toggle)
 *   ├── legend (edge colour key + node type key)
 *   └── mainRow (flex-row, flex:1, overflow:hidden)
 *        ├── graphPane (flex:1, min-width:0, position:relative)
 *        │    └── canvas div — D3 SVG renders here
 *        └── sidebarPane (320px, collapsible) — incident sidebar
 *
 * @param {{ element: HTMLElement }} params  OSD mount parameters.
 * @returns {Function}  Unmount function.
 */
function mountApp(params) {
  var element = params.element;

  /* ── Inject scoped CSS into document.head ──
     All sidebar and layout styles are scoped to .ng-layout to avoid
     polluting other OSD pages.  Cleaned up in unmount(). */
  var styleEl = document.createElement('style');
  styleEl.id  = 'ng-styles';
  styleEl.textContent = [
    /* Layout */
    '.ng-layout{width:100%;height:100%;display:flex;flex-direction:column;background:#f8fafc;color:#1a202c;font-family:sans-serif;overflow:hidden;}',
    '.ng-main-row{display:flex;flex:1;overflow:hidden;}',
    '.ng-graph-pane{flex:1;min-width:0;position:relative;}',

    /* Sidebar pane */
    '.ng-sidebar-pane{width:320px;flex-shrink:0;border-left:1px solid #e2e8f0;overflow:hidden;display:flex;flex-direction:column;transition:width 0.2s ease;background:#ffffff;}',
    '.ng-sidebar-pane.ng-sidebar-hidden{width:0;border-left-width:0;}',

    /* Sidebar header */
    '.ng-sidebar-header{padding:10px 12px;flex-shrink:0;border-bottom:1px solid #e2e8f0;background:#f1f5f9;}',
    '.ng-sidebar-header .ng-count-badge{background:#e2e8f0;color:#4a5568;border-radius:10px;padding:2px 7px;font-size:11px;}',
    '.ng-sidebar-header .ng-sidebar-subtitle{font-size:10px;color:#718096;margin-bottom:6px;}',
    '.ng-filter-select{font-size:11px;border:1px solid #cbd5e0;border-radius:3px;padding:2px 4px;background:#fff;color:#4a5568;width:100%;}',

    /* Incident list */
    '.ng-incident-list{flex:1;overflow-y:auto;padding:0;}',
    '.ng-incident{padding:8px 12px;border-bottom:1px solid #f0f4f8;font-size:12px;cursor:default;}',
    '.ng-incident:hover{background:#f7fafc;}',
    '.ng-incident-row1{display:flex;align-items:flex-start;gap:6px;margin-bottom:3px;}',
    '.ng-incident-row2{display:flex;align-items:center;gap:6px;margin-bottom:2px;}',
    '.ng-sev-chip{flex-shrink:0;border:1px solid;border-radius:3px;padding:0 5px;font-size:10px;font-weight:600;}',
    '.ng-incident-desc{flex:1;color:#2d3748;line-height:1.3;}',
    '.ng-incident-nodes{color:#718096;font-size:10px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.ng-incident-ts{color:#a0aec0;font-size:10px;white-space:nowrap;}',
    '.ng-investigate-link{color:#3182ce;text-decoration:none;font-size:13px;flex-shrink:0;}',
    '.ng-incident-groups{display:flex;gap:4px;flex-wrap:wrap;}',
    '.ng-group-chip{background:#e2e8f0;color:#4a5568;border-radius:10px;padding:1px 6px;font-size:10px;}',

    /* Empty state */
    '.ng-empty-state{display:none;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px;text-align:center;color:#718096;font-size:12px;line-height:1.5;}',

    /* Show-all button */
    '.ng-show-all-btn{padding:8px 12px;text-align:center;font-size:11px;color:#3182ce;cursor:pointer;border-top:1px solid #e2e8f0;}',
    '.ng-show-all-btn:hover{background:#ebf8ff;}',

    /* New-entry animation */
    '.ng-incident-new{animation:ng-new-entry 3s ease forwards;}',
    '@keyframes ng-new-entry{0%{border-left:3px solid #3182ce;}80%{border-left:3px solid #3182ce;}100%{border-left:3px solid transparent;}}',

    /* Pulse animation */
    '.ng-incident-pulse{animation:ng-pulse-border 2s ease;}',
    '@keyframes ng-pulse-border{0%{box-shadow:0 0 0 2px #3182ce;}50%{box-shadow:0 0 0 3px #3182ce;}100%{box-shadow:none;}}',

    /* Sidebar toggle button */
    '#ng-sidebar-toggle{margin-left:8px;padding:4px 8px;background:#e2e8f0;border:none;border-radius:4px;cursor:pointer;font-size:12px;color:#4a5568;}',
    '#ng-sidebar-toggle:hover{background:#cbd5e0;}',

    /* Graph SVG dark theme override */
    '.ng-layout.dark-theme .ng-graph-svg{background:#1a202c !important;}',

    /* Sidebar dark theme */
    '.ng-layout.dark-theme .ng-sidebar-pane{background:#1e293b;border-left-color:#2d3748;}',
    '.ng-layout.dark-theme .ng-sidebar-header{background:#2d3748;border-bottom-color:#4a5568;}',
    '.ng-layout.dark-theme .ng-sidebar-header .ng-count-badge{background:#4a5568;color:#e2e8f0;}',
    '.ng-layout.dark-theme .ng-sidebar-header .ng-sidebar-subtitle{color:#94a3b8;}',
    '.ng-layout.dark-theme .ng-filter-select{background:#2d3748;color:#e2e8f0;border-color:#4a5568;}',
    '.ng-layout.dark-theme .ng-incident{border-bottom-color:#2d3748;}',
    '.ng-layout.dark-theme .ng-incident:hover{background:#2d3748;}',
    '.ng-layout.dark-theme .ng-incident-desc{color:#e2e8f0;}',
    '.ng-layout.dark-theme .ng-incident-nodes{color:#94a3b8;}',
    '.ng-layout.dark-theme .ng-incident-ts{color:#64748b;}',
    '.ng-layout.dark-theme .ng-group-chip{background:#334155;color:#94a3b8;}',
    '.ng-layout.dark-theme .ng-show-all-btn{border-top-color:#2d3748;}',

    /* Narrow screen: sidebar as slide-over overlay */
    '@media (max-width:1199px){',
    '.ng-sidebar-pane{position:fixed;top:0;right:0;height:100%;z-index:200;width:300px !important;',
    'transform:translateX(100%);transition:transform 0.2s ease !important;',
    'box-shadow:-2px 0 8px rgba(0,0,0,0.15);}',
    '.ng-sidebar-pane:not(.ng-sidebar-hidden){transform:translateX(0);}',
    '}',
  ].join('\n');
  document.head.appendChild(styleEl);

  /* ── Root element class ── */
  element.className = 'ng-layout';

  /* ── Header bar ── */
  var header = document.createElement('div');
  header.style.cssText =
    'display:flex;align-items:center;padding:10px 16px;' +
    'background:#f1f5f9;border-bottom:1px solid #e2e8f0;flex-shrink:0;';
  header.innerHTML =
    '<span style="font-size:18px;font-weight:600;color:#2b6cb0;">⛎ Wazuh Network Graph</span>' +
    '<span id="ng-status" style="margin-left:16px;font-size:12px;color:#718096;">Loading…</span>' +
    '<button id="ng-refresh" style="margin-left:auto;padding:4px 12px;' +
    'background:#3182ce;color:#fff;border:none;border-radius:4px;cursor:pointer;">Refresh</button>';

  /* Sidebar toggle button */
  var toggleBtn = document.createElement('button');
  toggleBtn.id          = 'ng-sidebar-toggle';
  toggleBtn.textContent = '◀';
  toggleBtn.title       = 'Toggle incident sidebar';
  header.appendChild(toggleBtn);
  element.appendChild(header);

  /* ── Legend ── */
  var legend = document.createElement('div');
  legend.style.cssText =
    'display:flex;gap:16px;padding:6px 16px;background:#f8fafc;' +
    'font-size:11px;flex-shrink:0;border-bottom:1px solid #e2e8f0;color:#4a5568;';
  legend.innerHTML =
    '<span><span style="display:inline-block;width:14px;height:3px;background:' + COLOR_NONE   + ';vertical-align:middle;margin-right:4px;"></span>No alerts</span>' +
    '<span><span style="display:inline-block;width:14px;height:3px;background:' + COLOR_LOW    + ';vertical-align:middle;margin-right:4px;"></span>Low (&lt;7)</span>' +
    '<span><span style="display:inline-block;width:14px;height:3px;background:' + COLOR_MEDIUM + ';vertical-align:middle;margin-right:4px;"></span>Medium (7–11)</span>' +
    '<span><span style="display:inline-block;width:14px;height:3px;background:' + COLOR_HIGH   + ';vertical-align:middle;margin-right:4px;"></span>High (≥12)</span>' +
    '<span style="margin-left:16px;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + COLOR_MANAGER  + ';vertical-align:middle;margin-right:4px;"></span>Manager</span>' +
    '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;border:2px solid ' + COLOR_ACTIVE   + ';vertical-align:middle;margin-right:4px;"></span>Active agent</span>' +
    '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;border:2px solid ' + COLOR_INACTIVE + ';vertical-align:middle;margin-right:4px;"></span>Disconnected</span>' +
    '<span style="margin-left:16px;">┅┅ Agent-to-agent (peer)</span>';
  element.appendChild(legend);

  /* ── Main row: graph pane + sidebar pane ── */
  var mainRow = document.createElement('div');
  mainRow.className = 'ng-main-row';
  element.appendChild(mainRow);

  var graphPane = document.createElement('div');
  graphPane.className = 'ng-graph-pane';
  mainRow.appendChild(graphPane);

  /* The D3 SVG is rendered inside canvas which fills graphPane. */
  var canvas = document.createElement('div');
  canvas.style.cssText = 'width:100%;height:100%;position:relative;overflow:hidden;';
  graphPane.appendChild(canvas);

  var sidebarPane = document.createElement('div');
  sidebarPane.className = 'ng-sidebar-pane';
  mainRow.appendChild(sidebarPane);

  var statusEl   = header.querySelector('#ng-status');
  var refreshBtn = header.querySelector('#ng-refresh');

  var graph     = null;   // D3 graph instance (created on first successful fetch).
  var sidebar   = null;   // Incident sidebar instance.
  var pollTimer = null;   // setInterval handle for cleanup on unmount.
  var sidebarHidden = false;

  /* ── Sidebar toggle ── */
  toggleBtn.addEventListener('click', function() {
    sidebarHidden = !sidebarHidden;
    sidebarPane.classList.toggle('ng-sidebar-hidden', sidebarHidden);
    toggleBtn.textContent = sidebarHidden ? '▶' : '◀';
  });

  /* ── Theme detection and propagation ──
     Listen for the fyp-theme-changed CustomEvent dispatched by the localization
     plugin.  Also check the initial theme state on mount. */
  function isDarkTheme() {
    return document.documentElement.classList.contains('dark-theme') ||
           document.body.classList.contains('dark-theme') ||
           document.querySelector('.euiBody--darkColorScheme') !== null;
  }

  function applyTheme(dark) {
    element.classList.toggle('dark-theme', dark);
  }

  applyTheme(isDarkTheme());

  function onThemeChange(e) {
    var dark = e && e.detail && e.detail.theme === 'dark';
    applyTheme(dark);
  }
  window.addEventListener('fyp-theme-changed', onThemeChange);

  /* MutationObserver fallback for theme changes that don't use the CustomEvent. */
  var themeObserver = new MutationObserver(function() { applyTheme(isDarkTheme()); });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  /* ── fetchData() ─────────────────────────────────────────────────────────────
     Fetches agents and alerts in parallel, builds the alertMap, calls
     graph.update() and sidebar.update(). Runs on every poll cycle. */
  function fetchData() {
    statusEl.textContent = 'Refreshing…';

    Promise.all([
      fetchJSON(API_BASE + '/agents'),
      fetchJSON(API_BASE + '/alerts'),
    ]).then(function(results) {
      var agentsBody = results[0];
      var alertsBody = results[1];

      var agents = (agentsBody.data && agentsBody.data.affected_items) || [];

      /* Filter out agent 000 (the manager itself). */
      agents = agents.filter(function(a) { return a.id !== MANAGER_ID; });

      /* Build IP → agentId reverse lookup for peer-edge and sidebar use. */
      var ipToAgent = {};
      agents.forEach(function(a) {
        if (a.ip) ipToAgent[a.ip] = a.id;
      });

      /* Build alertMap + peer pairs from raw alerts. */
      var alertMap  = {};
      var peerPairs = {};

      var rawAlerts = (alertsBody.data && alertsBody.data.affected_items) || [];
      rawAlerts.forEach(function(alert) {
        var agentId = alert.agent && alert.agent.id;
        var level   = alert.rule  && alert.rule.level;

        if (agentId && level != null) {
          if (!alertMap[agentId]) alertMap[agentId] = [];
          alertMap[agentId].push(level);
        }

        var srcIp = alert.data && (alert.data.srcip  || alert.data.src_ip);
        var dstIp = alert.data && (alert.data.dstip  || alert.data.dst_ip);

        if (srcIp && dstIp && srcIp !== dstIp) {
          var srcAgent = ipToAgent[srcIp];
          var dstAgent = ipToAgent[dstIp];
          if (srcAgent && dstAgent && srcAgent !== dstAgent) {
            var key = srcAgent + '|' + dstAgent;
            peerPairs[key] = Math.max(peerPairs[key] || 0, level || 0);
          }
        }
      });

      alertMap._peers = Object.keys(peerPairs).map(function(k) {
        var parts = k.split('|');
        return { source: parts[0], target: parts[1], maxLevel: peerPairs[k] };
      });

      /* Initialise graph and sidebar on first load; reuse on subsequent polls. */
      if (!graph) {
        graph = createGraph(canvas, {
          onEdgeClick: function(srcId, dstId) {
            if (sidebar) sidebar.scrollToIncident(srcId, dstId);
          },
        });
      }

      if (!sidebar) {
        sidebar = createSidebar(sidebarPane, {
          onIncidentHover:    function(srcId, dstId) { if (graph) graph.highlightEdge(srcId, dstId); },
          onIncidentHoverOut: function()              { if (graph) graph.clearHighlight(); },
        });
      }

      graph.update(agents, alertMap);
      sidebar.update(rawAlerts, agents, ipToAgent);

      var ts = new Date().toLocaleTimeString();
      statusEl.textContent = _tFmt('ng.agentsStatus', { count: agents.length, time: ts });

    }).catch(function(err) {
      console.error('[networkGraph] fetch error:', err);
      statusEl.textContent = 'Error: ' + err.message;
    });
  }

  /* ── Start polling ── */
  fetchData();
  pollTimer = setInterval(fetchData, POLL_INTERVAL);
  refreshBtn.addEventListener('click', fetchData);

  /* ── Unmount (cleanup) ── */
  return function unmount() {
    clearInterval(pollTimer);
    window.removeEventListener('fyp-theme-changed', onThemeChange);
    themeObserver.disconnect();
    if (graph)   graph.destroy();
    if (sidebar) sidebar.destroy();
    /* Remove injected stylesheet. */
    var injected = document.getElementById('ng-styles');
    if (injected) injected.parentNode.removeChild(injected);
    while (element.firstChild) element.removeChild(element.firstChild);
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   OSD plugin class — NetworkGraphPlugin
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Client-side plugin class.
 *
 * OSD instantiates this via the `plugin` factory exported below.
 * Only setup() is needed — it registers the application that appears in the
 * Wazuh sidebar and mounts the graph when the user clicks it.
 */
function NetworkGraphPlugin() {}

/**
 * setup() — called by OSD during application bootstrap.
 *
 * @param {object} core  OSD core setup contract (browser-side).
 */
NetworkGraphPlugin.prototype.setup = function(core) {
  /* The /app/networkGraph route is registered here.
     The sidebar entry is surfaced via Wazuh's native Threat Intelligence section
     (added by patch_plugin.py), not via the generic OSD nav. */
  core.application.register({
    id:          'networkGraph',
    title:       'Network Graph',
    euiIconType: 'visNetwork',
    mount: function(params) {
      return mountApp(params);
    },
  });
};

NetworkGraphPlugin.prototype.start = function() {};
NetworkGraphPlugin.prototype.stop  = function() {};

/* ─────────────────────────────────────────────────────────────────────────────
   Module export — consumed by bundle_entry.js
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * OSD requires the module to export a `plugin` factory function.
 * bundle_entry.js returns this object when OSD's bundle loader calls require().
 */
module.exports = {
  plugin: function() {
    return new NetworkGraphPlugin();
  },
};
