'use strict';

/**
 * public/index.js — Network Graph plugin UI
 *
 * This file contains the entire browser-side plugin:
 *   - Constants (colours, API paths, poll interval)
 *   - Helper functions (fetch, edge colouring, OS label)
 *   - D3 force-directed graph renderer (createGraph)
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
 */

var d3 = require('d3');

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
var COLOR_NODE_FILL = '#1a1a2e';  // Dark — agent node interior fill

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
   D3 graph renderer — createGraph()
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Initialise a D3 force-directed graph inside `container`.
 *
 * Called once on first data load.  Returns an object with:
 *   update(agents, alertMap) — redraw nodes and edges with new data.
 *   destroy()               — stop simulation and clear the DOM.
 *
 * GRAPH STRUCTURE
 * ═══════════════
 * Nodes:
 *   - One manager node (id = '000', large blue circle labelled 'MGR').
 *   - One agent node per enrolled agent (small dark circle with OS label).
 *
 * Edges (links):
 *   - Solid line:  every agent → manager (always present; colour = alert severity).
 *   - Dashed line: agent → agent when alert data shows matching src/dst IPs
 *                  (indicates lateral movement or peer communication).
 *
 * LAYERS (z-order)
 * ════════════════
 * SVG → <g> (zoom transform applied here)
 *          → linkLayer  (lines, drawn first = behind nodes)
 *          → nodeLayer  (circles + labels)
 *
 * @param {HTMLElement} container  DOM element to render the SVG into.
 * @returns {{ update: Function, destroy: Function }}
 */
function createGraph(container) {
  var width  = container.clientWidth  || 900;
  var height = container.clientHeight || 600;

  /* ── SVG root ─────────────────────────────────────────────────────────────
     viewBox stays fixed; SVG scales to fill the container via width/height 100%.
     The dark background colour matches the OSD dark theme. */
  var svg = d3.select(container)
    .append('svg')
    .attr('width',   '100%')
    .attr('height',  '100%')
    .attr('viewBox', '0 0 ' + width + ' ' + height)
    .style('background', '#0d0d1a');

  /* ── SVG arrowhead markers ────────────────────────────────────────────────
     One marker per severity colour.  Used as marker-end on peer (dashed) edges
     to show direction (source agent → destination agent).
     Agent→manager edges do not use markers since direction is always implied. */
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
      .attr('refX',        20)   // Offset so the arrow tip lands at the node edge.
      .attr('refY',        0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient',      'auto')
      .append('path')
        .attr('d',    'M0,-5L10,0L0,5')
        .attr('fill', colours[col]);
  });

  /* ── Main group (receives zoom transform) ────────────────────────────────── */
  var g = svg.append('g');

  /* ── Zoom + pan ──────────────────────────────────────────────────────────────
     Mouse wheel zooms 0.2× – 5×.  Click-and-drag on the background pans.
     Individual node drag is handled separately and does not trigger zoom. */
  svg.call(
    d3.zoom()
      .scaleExtent([0.2, 5])
      .on('zoom', function(event) { g.attr('transform', event.transform); })
  );

  /* ── SVG layers ──────────────────────────────────────────────────────────────
     Links are appended first so they appear behind nodes. */
  var linkLayer = g.append('g').attr('class', 'links');
  var nodeLayer = g.append('g').attr('class', 'nodes');

  /* ── Hover tooltip ───────────────────────────────────────────────────────────
     Absolutely-positioned <div> inside the container.  Shows agent details on
     mouseover.  pointer-events: none prevents the tooltip from blocking mouse
     events on nodes underneath it. */
  var tooltip = d3.select(container)
    .append('div')
    .style('position',       'absolute')
    .style('background',     'rgba(0,0,0,0.85)')
    .style('color',          '#eee')
    .style('padding',        '8px 12px')
    .style('border-radius',  '4px')
    .style('font-size',      '12px')
    .style('pointer-events', 'none')
    .style('opacity',        0)
    .style('z-index',        999);

  /* ── Force simulation ────────────────────────────────────────────────────────
     Four forces keep the graph readable:
       link    — pulls connected nodes towards their target distance (120 px).
       charge  — pushes all nodes apart (repulsion strength –300).
       center  — drifts the whole graph towards the canvas centre.
       collide — prevents nodes from overlapping (radius 35 px). */
  var simulation = d3.forceSimulation()
    .force('link',    d3.forceLink().id(function(d) { return d.id; }).distance(120))
    .force('charge',  d3.forceManyBody().strength(-300))
    .force('center',  d3.forceCenter(width / 2, height / 2))
    .force('collide', d3.forceCollide().radius(35));

  /* Internal data arrays — updated on each poll cycle. */
  var nodesData = [];
  var linksData = [];

  /* ── Drag behaviour ──────────────────────────────────────────────────────────
     Dragging a node:
       - On start: briefly restarts the simulation (alphaTarget 0.3) so other
         nodes respond and settle around the dragged node's new position.
       - During drag: fixes the node's x/y so the simulation doesn't fight the user.
       - On end: releases the fix (fx = fy = null) so the node is free again. */
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

  /* ── update() ────────────────────────────────────────────────────────────────
     Called on every poll cycle with fresh data.  D3's key-based data join
     (the second argument to .data()) ensures existing nodes keep their
     simulated positions — only new or removed nodes are added/removed. */
  function update(agents, alertMap) {

    /* Build the manager node.  It always exists and is never in the agents list
       (Wazuh filters out agent 000 on the browser side). */
    var manager = {
      id:        MANAGER_ID,
      name:      'Wazuh Manager',
      ip:        '127.0.0.1',
      os:        'Manager',
      status:    'active',
      isManager: true,
    };

    /* Map each Wazuh agent API object to a simpler node record. */
    var agentNodes = agents.map(function(a) {
      return {
        id:        a.id,
        name:      a.name   || 'Agent ' + a.id,
        ip:        a.ip     || 'N/A',
        os:        osLabel(a),
        status:    a.status || 'disconnected',
        isManager: false,
      };
    });

    nodesData = [manager].concat(agentNodes);

    /* ── Agent → manager edges ──
       One solid line per agent.  Colour is determined by the highest alert
       level that agent produced in the last 5 minutes. */
    var agentLinks = agentNodes.map(function(a) {
      var levels = alertMap[a.id] || [];
      return {
        source:   a.id,
        target:   MANAGER_ID,
        color:    edgeColor(levels),
        severity: levelCategory(levels),
      };
    });

    /* ── Agent → agent peer edges ──
       alertMap._peers is pre-computed by fetchData() from alerts that contain
       both a srcip and a dstip that belong to two different known agents.
       These dashed edges indicate lateral movement or direct agent-to-agent traffic.
       Each peer entry has: { source, target, maxLevel }. */
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

    /* ── D3 data join: links ──
       Key function: source-target-type ensures peer and agent links with the
       same endpoints don't collide in the join. */
    var link = linkLayer.selectAll('line').data(linksData, function(d) {
      return d.source + '-' + d.target + '-' + (d.isPeer ? 'p' : 'a');
    });

    link.enter()
      .append('line')
      .attr('stroke-width',    function(d) { return d.isPeer ? 1.5 : 2; })
      .attr('stroke-dasharray', function(d) { return d.isPeer ? '5,3' : null; })
      .merge(link)
        .attr('stroke',     function(d) { return d.color; })
        // Arrow markers only on peer edges to show communication direction.
        .attr('marker-end', function(d) {
          return d.isPeer ? 'url(#arrow-' + d.severity + ')' : null;
        });

    link.exit().remove();

    /* ── D3 data join: nodes ──
       Key function: node id.  This preserves simulation positions for nodes
       that exist across poll cycles (avoids jarring resets every 10 seconds). */
    var node = nodeLayer.selectAll('g.node').data(nodesData, function(d) { return d.id; });

    var nodeEnter = node.enter()
      .append('g')
      .attr('class', 'node')
      .call(drag(simulation))  // Attach drag handler to every new node group.

      /* Tooltip: show on mouseover, follow mouse, hide on mouseout. */
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

    /* ── Manager node: large blue circle with 'MGR' text ── */
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

    /* ── Agent node: smaller dark circle with OS abbreviation ── */
    nodeEnter.filter(function(d) { return !d.isManager; })
      .append('circle')
        .attr('r',    16)
        .attr('fill', COLOR_NODE_FILL);

    /* Short OS abbreviation shown inside the agent circle. */
    nodeEnter.filter(function(d) { return !d.isManager; })
      .append('text')
        .attr('text-anchor',  'middle')
        .attr('dy',           '0.35em')
        .attr('font-size',    '7px')
        .attr('fill',         '#cccccc')
        .attr('pointer-events', 'none')
        .text(function(d) {
          var os = (d.os || '').toLowerCase();
          if (os.indexOf('windows') !== -1)                                    return 'WIN';
          if (os.indexOf('ubuntu')  !== -1 || os.indexOf('debian') !== -1)    return 'DEB';
          if (os.indexOf('centos')  !== -1 || os.indexOf('rhel')   !== -1 ||
              os.indexOf('red hat') !== -1)                                    return 'RPM';
          return 'LNX';  // Default for other Linux distributions.
        });

    /* Agent name label rendered below the circle. */
    nodeEnter.filter(function(d) { return !d.isManager; })
      .append('text')
        .attr('class',        'namelabel')
        .attr('text-anchor',  'middle')
        .attr('dy',           '2.5em')
        .attr('font-size',    '10px')
        .attr('fill',         '#dddddd')
        .attr('pointer-events', 'none');

    /* ── Merge enter + update selections ── */
    var nodeAll = nodeEnter.merge(node);

    /* Update agent circle stroke colour on every poll cycle.
       Active agents get a teal border; disconnected agents get a grey border. */
    nodeAll.filter(function(d) { return !d.isManager; })
      .select('circle')
        .attr('stroke', function(d) {
          return d.status === 'active' ? COLOR_ACTIVE : COLOR_INACTIVE;
        })
        .attr('stroke-width', 2.5);

    /* Update name label text (agent name could change between polls). */
    nodeAll.select('text.namelabel')
      .text(function(d) { return d.name; });

    node.exit().remove();

    /* ── Restart force simulation ────────────────────────────────────────────
       alpha(0.3) gives the simulation a gentle kick so new nodes settle
       without the whole graph jumping around.  ticked() runs every simulation
       step and moves the SVG elements to the current computed positions. */
    simulation
      .nodes(nodesData)
      .on('tick', ticked);

    simulation.force('link').links(linksData);
    simulation.alpha(0.3).restart();

    function ticked() {
      /* Move each line's endpoints to the current node positions. */
      linkLayer.selectAll('line')
        .attr('x1', function(d) { return d.source.x; })
        .attr('y1', function(d) { return d.source.y; })
        .attr('x2', function(d) { return d.target.x; })
        .attr('y2', function(d) { return d.target.y; });

      /* Move each node group to its current position. */
      nodeLayer.selectAll('g.node')
        .attr('transform', function(d) {
          return 'translate(' + d.x + ',' + d.y + ')';
        });
    }
  }

  /**
   * Stop the simulation and remove all SVG/DOM content from the container.
   * Called by OSD when the user navigates away from the plugin page.
   */
  function destroy() {
    simulation.stop();
    d3.select(container).selectAll('*').remove();
  }

  return { update: update, destroy: destroy };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Page layout and polling — mountApp()
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Build the full page layout, start the data poll, and return an unmount function.
 *
 * OSD calls mount(params) when the user navigates to this app.  mount() must
 * return a function that OSD calls when the user navigates away (unmount).
 *
 * PAGE STRUCTURE
 * ══════════════
 * params.element (full-page container)
 *   ├── header bar  (title, status text, Refresh button)
 *   ├── legend      (edge colour key + node type key)
 *   └── canvas div  (D3 SVG renders here, fills remaining height)
 *
 * @param {{ element: HTMLElement }} params  OSD mount parameters.
 * @returns {Function}  Unmount function.
 */
function mountApp(params) {
  var element = params.element;

  /* Full-height flex column matching OSD's dark theme. */
  element.style.cssText =
    'width:100%;height:100%;display:flex;flex-direction:column;' +
    'background:#0d0d1a;color:#eee;font-family:sans-serif;overflow:hidden;';

  /* ── Header bar ── */
  var header = document.createElement('div');
  header.style.cssText =
    'display:flex;align-items:center;padding:10px 16px;' +
    'background:#12122a;border-bottom:1px solid #2a2a4a;flex-shrink:0;';
  header.innerHTML =
    '<span style="font-size:18px;font-weight:600;color:#4fc3f7;">&#9974; Wazuh Network Graph</span>' +
    // Status text — updated after every fetch (shows agent count + timestamp).
    '<span id="ng-status" style="margin-left:16px;font-size:12px;color:#888;">Loading…</span>' +
    // Manual refresh button — triggers fetchData() immediately.
    '<button id="ng-refresh" style="margin-left:auto;padding:4px 12px;' +
    'background:#1e6091;color:#fff;border:none;border-radius:4px;cursor:pointer;">Refresh</button>';
  element.appendChild(header);

  /* ── Legend ──
     Explains edge colours and node types so users can read the graph at a glance. */
  var legend = document.createElement('div');
  legend.style.cssText =
    'display:flex;gap:16px;padding:6px 16px;background:#0d0d1a;' +
    'font-size:11px;flex-shrink:0;border-bottom:1px solid #1a1a3a;';
  legend.innerHTML =
    // Edge colour key
    '<span><span style="display:inline-block;width:14px;height:3px;background:' + COLOR_NONE   + ';vertical-align:middle;margin-right:4px;"></span>No alerts</span>' +
    '<span><span style="display:inline-block;width:14px;height:3px;background:' + COLOR_LOW    + ';vertical-align:middle;margin-right:4px;"></span>Low (&lt;7)</span>' +
    '<span><span style="display:inline-block;width:14px;height:3px;background:' + COLOR_MEDIUM + ';vertical-align:middle;margin-right:4px;"></span>Medium (7–11)</span>' +
    '<span><span style="display:inline-block;width:14px;height:3px;background:' + COLOR_HIGH   + ';vertical-align:middle;margin-right:4px;"></span>High (≥12)</span>' +
    // Node type key
    '<span style="margin-left:16px;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + COLOR_MANAGER  + ';vertical-align:middle;margin-right:4px;"></span>Manager</span>' +
    '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;border:2px solid ' + COLOR_ACTIVE   + ';vertical-align:middle;margin-right:4px;"></span>Active agent</span>' +
    '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;border:2px solid ' + COLOR_INACTIVE + ';vertical-align:middle;margin-right:4px;"></span>Disconnected</span>' +
    '<span style="margin-left:16px;">&#9135;&#9135; Agent-to-agent (peer)</span>';
  element.appendChild(legend);

  /* ── Graph canvas ──
     flex:1 makes it fill all remaining vertical space after the header and legend.
     The D3 SVG is appended inside this div. */
  var canvas = document.createElement('div');
  canvas.style.cssText = 'flex:1;position:relative;overflow:hidden;';
  element.appendChild(canvas);

  var statusEl   = header.querySelector('#ng-status');
  var refreshBtn = header.querySelector('#ng-refresh');

  var graph     = null;   // D3 graph instance (created on first successful fetch).
  var pollTimer = null;   // setInterval handle for cleanup on unmount.

  /* ── fetchData() ─────────────────────────────────────────────────────────────
     Fetches agents and alerts in parallel, builds the alertMap, and calls
     graph.update().  Runs on every poll cycle and on manual refresh. */
  function fetchData() {
    statusEl.textContent = 'Refreshing…';

    /* Both requests run in parallel — Promise.all rejects if either fails. */
    Promise.all([
      fetchJSON(API_BASE + '/agents'),
      fetchJSON(API_BASE + '/alerts'),
    ]).then(function(results) {
      var agentsBody = results[0];
      var alertsBody = results[1];

      /* affected_items is the Wazuh API's standard wrapper for list responses. */
      var agents = (agentsBody.data && agentsBody.data.affected_items) || [];

      /* Filter out agent 000 (the manager itself — it appears in the agents list
         but should only appear as the central manager node, not as an agent node). */
      agents = agents.filter(function(a) { return a.id !== MANAGER_ID; });

      /* Build a reverse lookup: IP address → agent ID.
         Used below to detect agent-to-agent edges from alert src/dst IPs. */
      var ipToAgent = {};
      agents.forEach(function(a) {
        if (a.ip) ipToAgent[a.ip] = a.id;
      });

      /* ── Build alertMap ──
         alertMap[agentId] = [level, level, …]  (one entry per alert)
         alertMap._peers   = [{ source, target, maxLevel }, …]  (agent-to-agent edges) */
      var alertMap  = {};
      var peerPairs = {};  // Key: "srcAgentId|dstAgentId", value: max alert level seen.

      var alerts = (alertsBody.data && alertsBody.data.affected_items) || [];
      alerts.forEach(function(alert) {
        var agentId = alert.agent && alert.agent.id;
        var level   = alert.rule  && alert.rule.level;

        /* Accumulate alert levels per agent for edge colouring. */
        if (agentId && level != null) {
          if (!alertMap[agentId]) alertMap[agentId] = [];
          alertMap[agentId].push(level);
        }

        /* Check for agent-to-agent communication.
           Wazuh alert data fields vary by rule/decoder; try both naming conventions. */
        var srcIp = alert.data && (alert.data.srcip   || alert.data.src_ip);
        var dstIp = alert.data && (alert.data.dstip   || alert.data.dst_ip);

        if (srcIp && dstIp && srcIp !== dstIp) {
          var srcAgent = ipToAgent[srcIp];
          var dstAgent = ipToAgent[dstIp];

          /* Both IPs must belong to enrolled agents (not to the manager or external hosts). */
          if (srcAgent && dstAgent && srcAgent !== dstAgent) {
            var key = srcAgent + '|' + dstAgent;
            /* Keep the highest severity level seen for this pair. */
            peerPairs[key] = Math.max(peerPairs[key] || 0, level || 0);
          }
        }
      });

      /* Flatten peerPairs object into the _peers array expected by createGraph. */
      alertMap._peers = Object.keys(peerPairs).map(function(k) {
        var parts = k.split('|');
        return { source: parts[0], target: parts[1], maxLevel: peerPairs[k] };
      });

      /* Initialise the D3 graph on first load; reuse it on subsequent polls. */
      if (!graph) {
        graph = createGraph(canvas);
      }
      graph.update(agents, alertMap);

      var ts = new Date().toLocaleTimeString();
      statusEl.textContent = agents.length + ' agent(s) – last updated ' + ts;

    }).catch(function(err) {
      console.error('[networkGraph] fetch error:', err);
      statusEl.textContent = 'Error: ' + err.message;
    });
  }

  /* ── Start polling ── */
  fetchData();                                         // Immediate first fetch.
  pollTimer = setInterval(fetchData, POLL_INTERVAL);   // Then every 10 seconds.
  refreshBtn.addEventListener('click', fetchData);     // Manual override.

  /* ── Unmount (cleanup) ────────────────────────────────────────────────────────
     OSD calls this when the user navigates away.  We must:
       1. Stop the poll timer (prevent orphaned fetches after unmount).
       2. Stop the D3 simulation (prevent CPU usage with no canvas to update).
       3. Clear the DOM (OSD reuses the element for the next mounted app). */
  return function unmount() {
    clearInterval(pollTimer);
    if (graph) graph.destroy();
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
 * core.application.register() adds a new entry to the sidebar and tells OSD
 * which function to call when the user navigates to this app's URL.
 *
 * @param {object} core  OSD core setup contract (browser-side).
 */
NetworkGraphPlugin.prototype.setup = function(core) {
  core.application.register({
    id:          'networkGraph',   // Must match opensearch_dashboards.json "id".
    title:       'Network Graph',  // Sidebar label.
    euiIconType: 'visNetwork',     // EUI icon shown next to the label.
    category: {
      id:    'wazuh',              // Groups this app under the Wazuh section.
      label: 'Wazuh',
      order: 1000,
    },
    order: 9100,                   // Position within the Wazuh section.

    /**
     * mount() is called by OSD when the user navigates to /app/networkGraph.
     * It receives a params object with an `element` (the full-page container).
     * It must return an unmount function.
     */
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
