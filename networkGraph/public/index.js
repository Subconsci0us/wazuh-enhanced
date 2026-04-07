/**
 * networkGraph – public plugin entry
 *
 * Registers a full-page "Network Graph" app in the OpenSearch Dashboards
 * sidebar.  The app renders a D3 force-directed graph of Wazuh agents
 * connected to the manager, with edges colour-coded by alert severity.
 */

'use strict';

var d3 = require('d3');

/* ─────────────────────────────────────────────────────────────────────────────
   Constants
   ───────────────────────────────────────────────────────────────────────────── */

var API_BASE        = '/api/network_graph';
var POLL_INTERVAL   = 10000; // ms
var MANAGER_ID      = '000';

/* Edge colours by alert severity (most-severe wins) */
var COLOR_NONE      = '#888888';  // gray   – no recent alerts
var COLOR_LOW       = '#00a550';  // green  – level < 7
var COLOR_MEDIUM    = '#f0a500';  // yellow – level 7-11
var COLOR_HIGH      = '#d4371c';  // red    – level >= 12

/* Node colours */
var COLOR_MANAGER   = '#006BB4';  // blue   – manager node
var COLOR_ACTIVE    = '#017D73';  // teal   – active agent outline
var COLOR_INACTIVE  = '#6a6a6a';  // grey   – disconnected agent outline
var COLOR_NODE_FILL = '#1a1a2e';  // dark   – node interior

/* ─────────────────────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Fetch JSON from one of our server-side proxy routes.
 * Returns a Promise that resolves to the parsed body, or rejects on error.
 */
function fetchJSON(url) {
  return fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  }).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status + ' – ' + url);
    return res.json();
  });
}

/**
 * Determine edge colour for an agent based on its recent alert levels.
 * @param {number[]} levels – array of rule.level values for this agent
 */
function edgeColor(levels) {
  if (!levels || levels.length === 0) return COLOR_NONE;
  var max = Math.max.apply(null, levels);
  if (max >= 12) return COLOR_HIGH;
  if (max >= 7)  return COLOR_MEDIUM;
  return COLOR_LOW;
}

/**
 * Get a short OS label from an agent record.
 */
function osLabel(agent) {
  if (!agent.os) return '';
  var n = (agent.os.name || '') + ' ' + (agent.os.version || '');
  return n.trim().substring(0, 20);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Graph renderer
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Initialise or update the D3 force graph inside `container`.
 * Returns an object with an `update(agents, alertMap)` method and a
 * `destroy()` method.
 *
 * @param {HTMLElement} container – DOM element to render into
 */
function createGraph(container) {
  var width  = container.clientWidth  || 900;
  var height = container.clientHeight || 600;

  /* ── SVG scaffold ── */
  var svg = d3.select(container)
    .append('svg')
    .attr('width',  '100%')
    .attr('height', '100%')
    .attr('viewBox', '0 0 ' + width + ' ' + height)
    .style('background', '#0d0d1a');

  /* Arrow-head marker for directed edges (optional – used for agent-to-agent) */
  var defs = svg.append('defs');
  ['gray','green','yellow','red'].forEach(function(col) {
    var colours = { gray: COLOR_NONE, green: COLOR_LOW, yellow: COLOR_MEDIUM, red: COLOR_HIGH };
    defs.append('marker')
      .attr('id', 'arrow-' + col)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', colours[col]);
  });

  var g = svg.append('g');

  /* Zoom + pan */
  svg.call(
    d3.zoom()
      .scaleExtent([0.2, 5])
      .on('zoom', function(event) { g.attr('transform', event.transform); })
  );

  /* Layers: links under nodes */
  var linkLayer = g.append('g').attr('class', 'links');
  var nodeLayer = g.append('g').attr('class', 'nodes');

  /* Tooltip */
  var tooltip = d3.select(container)
    .append('div')
    .style('position', 'absolute')
    .style('background', 'rgba(0,0,0,0.85)')
    .style('color', '#eee')
    .style('padding', '8px 12px')
    .style('border-radius', '4px')
    .style('font-size', '12px')
    .style('pointer-events', 'none')
    .style('opacity', 0)
    .style('z-index', 999);

  /* Force simulation */
  var simulation = d3.forceSimulation()
    .force('link',    d3.forceLink().id(function(d) { return d.id; }).distance(120))
    .force('charge',  d3.forceManyBody().strength(-300))
    .force('center',  d3.forceCenter(width / 2, height / 2))
    .force('collide', d3.forceCollide().radius(35));

  /* Internal state */
  var nodesData = [];
  var linksData = [];

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

  /* ── Update function ── */
  function update(agents, alertMap) {
    /* Build nodes */
    var manager = {
      id:     MANAGER_ID,
      name:   'Wazuh Manager',
      ip:     '127.0.0.1',
      os:     'Manager',
      status: 'active',
      isManager: true,
    };

    var agentNodes = agents.map(function(a) {
      return {
        id:        a.id,
        name:      a.name  || 'Agent ' + a.id,
        ip:        a.ip    || 'N/A',
        os:        osLabel(a),
        status:    a.status || 'disconnected',
        isManager: false,
      };
    });

    nodesData = [manager].concat(agentNodes);

    /* Build links: every agent → manager */
    var agentLinks = agentNodes.map(function(a) {
      var levels = alertMap[a.id] || [];
      return {
        source:   a.id,
        target:   MANAGER_ID,
        color:    edgeColor(levels),
        severity: levelCategory(levels),
      };
    });

    /* Agent-to-agent links derived from alertMap's peerMap */
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

    /* ── Links ── */
    var link = linkLayer.selectAll('line').data(linksData, function(d) {
      return d.source + '-' + d.target + '-' + (d.isPeer ? 'p' : 'a');
    });

    link.enter()
      .append('line')
      .attr('stroke-width', function(d) { return d.isPeer ? 1.5 : 2; })
      .attr('stroke-dasharray', function(d) { return d.isPeer ? '5,3' : null; })
      .merge(link)
        .attr('stroke', function(d) { return d.color; })
        .attr('marker-end', function(d) {
          return d.isPeer ? 'url(#arrow-' + d.severity + ')' : null;
        });

    link.exit().remove();

    /* ── Nodes ── */
    var node = nodeLayer.selectAll('g.node').data(nodesData, function(d) { return d.id; });

    var nodeEnter = node.enter()
      .append('g')
      .attr('class', 'node')
      .call(drag(simulation))
      .on('mouseover', function(event, d) {
        tooltip
          .style('opacity', 1)
          .html(
            '<strong>' + d.name + '</strong><br/>' +
            'ID: '     + d.id   + '<br/>' +
            'IP: '     + d.ip   + '<br/>' +
            'OS: '     + d.os   + '<br/>' +
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

    /* Manager: large circle */
    nodeEnter.filter(function(d) { return d.isManager; })
      .append('circle')
        .attr('r', 28)
        .attr('fill', COLOR_MANAGER)
        .attr('stroke', '#4fc3f7')
        .attr('stroke-width', 3);

    /* Manager label inside circle */
    nodeEnter.filter(function(d) { return d.isManager; })
      .append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('font-size', '9px')
        .attr('fill', '#ffffff')
        .attr('pointer-events', 'none')
        .text('MGR');

    /* Agent: smaller circle */
    nodeEnter.filter(function(d) { return !d.isManager; })
      .append('circle')
        .attr('r', 16)
        .attr('fill', COLOR_NODE_FILL);

    /* Agent OS label inside */
    nodeEnter.filter(function(d) { return !d.isManager; })
      .append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('font-size', '7px')
        .attr('fill', '#cccccc')
        .attr('pointer-events', 'none')
        .text(function(d) {
          // Short OS icon text
          var os = (d.os || '').toLowerCase();
          if (os.indexOf('windows') !== -1) return 'WIN';
          if (os.indexOf('ubuntu') !== -1 || os.indexOf('debian') !== -1) return 'DEB';
          if (os.indexOf('centos') !== -1 || os.indexOf('rhel') !== -1 || os.indexOf('red hat') !== -1) return 'RPM';
          return 'LNX';
        });

    /* Agent name label below circle */
    nodeEnter.filter(function(d) { return !d.isManager; })
      .append('text')
        .attr('class', 'namelabel')
        .attr('text-anchor', 'middle')
        .attr('dy', '2.5em')
        .attr('font-size', '10px')
        .attr('fill', '#dddddd')
        .attr('pointer-events', 'none');

    /* Merge and update */
    var nodeAll = nodeEnter.merge(node);

    /* Update agent stroke colour by connection status */
    nodeAll.filter(function(d) { return !d.isManager; })
      .select('circle')
        .attr('stroke', function(d) {
          return d.status === 'active' ? COLOR_ACTIVE : COLOR_INACTIVE;
        })
        .attr('stroke-width', 2.5);

    /* Update name labels */
    nodeAll.select('text.namelabel')
      .text(function(d) { return d.name; });

    node.exit().remove();

    /* Restart simulation */
    simulation
      .nodes(nodesData)
      .on('tick', ticked);

    simulation.force('link').links(linksData);
    simulation.alpha(0.3).restart();

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

  function destroy() {
    simulation.stop();
    d3.select(container).selectAll('*').remove();
  }

  return { update: update, destroy: destroy };
}

/**
 * Map a levels array to a colour-name string for marker IDs.
 */
function levelCategory(levels) {
  if (!levels || levels.length === 0) return 'gray';
  var max = Math.max.apply(null, levels);
  if (max >= 12) return 'red';
  if (max >= 7)  return 'yellow';
  return 'green';
}

/* ─────────────────────────────────────────────────────────────────────────────
   Mount / unmount
   ───────────────────────────────────────────────────────────────────────────── */

function mountApp(params) {
  var element = params.element;

  /* Outer wrapper */
  element.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;background:#0d0d1a;color:#eee;font-family:sans-serif;overflow:hidden;';

  /* Header bar */
  var header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;padding:10px 16px;background:#12122a;border-bottom:1px solid #2a2a4a;flex-shrink:0;';
  header.innerHTML =
    '<span style="font-size:18px;font-weight:600;color:#4fc3f7;">&#9974; Wazuh Network Graph</span>' +
    '<span id="ng-status" style="margin-left:16px;font-size:12px;color:#888;">Loading…</span>' +
    '<button id="ng-refresh" style="margin-left:auto;padding:4px 12px;background:#1e6091;color:#fff;border:none;border-radius:4px;cursor:pointer;">Refresh</button>';
  element.appendChild(header);

  /* Legend */
  var legend = document.createElement('div');
  legend.style.cssText = 'display:flex;gap:16px;padding:6px 16px;background:#0d0d1a;font-size:11px;flex-shrink:0;border-bottom:1px solid #1a1a3a;';
  legend.innerHTML =
    '<span><span style="display:inline-block;width:14px;height:3px;background:' + COLOR_NONE   + ';vertical-align:middle;margin-right:4px;"></span>No alerts</span>' +
    '<span><span style="display:inline-block;width:14px;height:3px;background:' + COLOR_LOW    + ';vertical-align:middle;margin-right:4px;"></span>Low (&lt;7)</span>' +
    '<span><span style="display:inline-block;width:14px;height:3px;background:' + COLOR_MEDIUM + ';vertical-align:middle;margin-right:4px;"></span>Medium (7-11)</span>' +
    '<span><span style="display:inline-block;width:14px;height:3px;background:' + COLOR_HIGH   + ';vertical-align:middle;margin-right:4px;"></span>High (≥12)</span>' +
    '<span style="margin-left:16px;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + COLOR_MANAGER + ';vertical-align:middle;margin-right:4px;"></span>Manager</span>' +
    '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;border:2px solid ' + COLOR_ACTIVE   + ';vertical-align:middle;margin-right:4px;"></span>Active agent</span>' +
    '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;border:2px solid ' + COLOR_INACTIVE + ';vertical-align:middle;margin-right:4px;"></span>Disconnected</span>' +
    '<span style="margin-left:16px;">&#9135;&#9135; Agent-to-agent (peer)</span>';
  element.appendChild(legend);

  /* Graph canvas */
  var canvas = document.createElement('div');
  canvas.style.cssText = 'flex:1;position:relative;overflow:hidden;';
  element.appendChild(canvas);

  var statusEl  = header.querySelector('#ng-status');
  var refreshBtn = header.querySelector('#ng-refresh');

  var graph    = null;
  var pollTimer = null;

  /* ── Data fetch ── */
  function fetchData() {
    statusEl.textContent = 'Refreshing…';

    var agentsPromise = fetchJSON(API_BASE + '/agents');
    var alertsPromise = fetchJSON(API_BASE + '/alerts');

    Promise.all([agentsPromise, alertsPromise])
      .then(function(results) {
        var agentsBody = results[0];
        var alertsBody = results[1];

        var agents = (agentsBody.data && agentsBody.data.affected_items) || [];
        // Filter out the manager itself (agent 000)
        agents = agents.filter(function(a) { return a.id !== MANAGER_ID; });

        /* Build IP → agentId map for peer edge detection */
        var ipToAgent = {};
        agents.forEach(function(a) {
          if (a.ip) ipToAgent[a.ip] = a.id;
        });

        /* Build alertMap:  agentId → [rule.level, …] */
        var alertMap = {};
        var peerPairs = {};  // "srcId|dstId" → maxLevel

        var alerts = (alertsBody.data && alertsBody.data.affected_items) || [];
        alerts.forEach(function(alert) {
          var agentId = alert.agent && alert.agent.id;
          var level   = alert.rule  && alert.rule.level;
          if (agentId && level != null) {
            if (!alertMap[agentId]) alertMap[agentId] = [];
            alertMap[agentId].push(level);
          }

          /* Detect agent-to-agent edges from network fields */
          var srcIp = alert.data && (alert.data.srcip || (alert.data.src_ip));
          var dstIp = alert.data && (alert.data.dstip || (alert.data.dst_ip));
          if (srcIp && dstIp && srcIp !== dstIp) {
            var srcAgent = ipToAgent[srcIp];
            var dstAgent = ipToAgent[dstIp];
            if (srcAgent && dstAgent && srcAgent !== dstAgent) {
              var key = srcAgent + '|' + dstAgent;
              peerPairs[key] = Math.max(peerPairs[key] || 0, level || 0);
            }
          }
        });

        /* Flatten peer pairs */
        alertMap._peers = Object.keys(peerPairs).map(function(k) {
          var parts = k.split('|');
          return { source: parts[0], target: parts[1], maxLevel: peerPairs[k] };
        });

        /* Initialise graph on first load */
        if (!graph) {
          graph = createGraph(canvas);
        }
        graph.update(agents, alertMap);

        var ts = new Date().toLocaleTimeString();
        statusEl.textContent = agents.length + ' agent(s) – last updated ' + ts;
      })
      .catch(function(err) {
        console.error('[networkGraph] fetch error:', err);
        statusEl.textContent = 'Error: ' + err.message;
      });
  }

  /* ── Kick off ── */
  fetchData();
  pollTimer = setInterval(fetchData, POLL_INTERVAL);
  refreshBtn.addEventListener('click', fetchData);

  /* ── Unmount (cleanup) ── */
  return function unmount() {
    clearInterval(pollTimer);
    if (graph) graph.destroy();
    while (element.firstChild) element.removeChild(element.firstChild);
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   OSD Plugin class
   ───────────────────────────────────────────────────────────────────────────── */

function NetworkGraphPlugin() {}

NetworkGraphPlugin.prototype.setup = function(core) {
  core.application.register({
    id:           'networkGraph',
    title:        'Network Graph',
    euiIconType:  'visNetwork',
    category: {
      id:    'wazuh',
      label: 'Wazuh',
      order: 1000,
    },
    order: 9100,
    mount: function(params) {
      return mountApp(params);
    },
  });
};

NetworkGraphPlugin.prototype.start = function() {};
NetworkGraphPlugin.prototype.stop  = function() {};

/* ─────────────────────────────────────────────────────────────────────────────
   Exports  (consumed by bundle_entry.js)
   ───────────────────────────────────────────────────────────────────────────── */

module.exports = {
  plugin: function() {
    return new NetworkGraphPlugin();
  },
};
