'use strict';

/**
 * public/index.js — Comparative Compliance View plugin UI
 *
 * Single-page dashboard showing a unified view of compliance violations across
 * all frameworks: PCI DSS, HIPAA, GDPR, NIST 800-53, TSC, and PECA.
 *
 * PAGE STRUCTURE
 * ══════════════
 * params.element (full-page container)
 *   ├── header          (title, time range selector, refresh button)
 *   ├── summary row     (one card per framework — count + status indicator)
 *   ├── detail table    (all sections across selected frameworks, sortable)
 *   └── overlap matrix  (heatmap of cross-framework alert co-occurrences)
 *
 * DATA FLOW
 * ═════════
 * 1. loadSummary()  → GET /api/compliance_view/summary?time_range=<range>
 * 2. loadDetails()  → GET /api/compliance_view/details?framework=<fw>&time_range=<range>
 *                     (called once per framework whose checkbox is checked)
 * 3. loadOverlap()  → GET /api/compliance_view/overlap?time_range=<range>
 *
 * All rendering is pure DOM manipulation — no React, no D3, no external libs.
 */

/* ── Constants ──────────────────────────────────────────────────────────────── */

var API_BASE = '/api/compliance_view';

var FRAMEWORKS = [
  { key: 'pci_dss',     label: 'PCI DSS',     color: '#1BA9F5' },
  { key: 'hipaa',       label: 'HIPAA',        color: '#F66D64' },
  { key: 'gdpr',        label: 'GDPR',         color: '#6EBE4A' },
  { key: 'nist_800_53', label: 'NIST 800-53',  color: '#F0B400' },
  { key: 'tsc',         label: 'TSC',           color: '#BD71F5' },
  { key: 'peca',        label: 'PECA',          color: '#FF7D00' },
];

// Thresholds for the status indicator colour on summary cards.
var THRESHOLD_GREEN  = 10;   // < 10 alerts → green
var THRESHOLD_YELLOW = 50;   // 10-50 → yellow, >50 → red

// Severity display order.
var SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
var SEV_COLORS = {
  info:     '#6DCCB1',
  low:      '#54B399',
  medium:   '#D6BF57',
  high:     '#E7664C',
  critical: '#CC5642',
};

/* ── CSS (injected once) ─────────────────────────────────────────────────────── */

var STYLES = `
  .cv-root {
    width: 100%; height: 100%; display: flex; flex-direction: column;
    background: #0d0d1a; color: #eee; font-family: 'Inter', 'Helvetica Neue', sans-serif;
    overflow-y: auto; box-sizing: border-box;
  }
  .cv-header {
    display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
    padding: 12px 20px; background: #12122a;
    border-bottom: 1px solid #2a2a4a; flex-shrink: 0;
  }
  .cv-title {
    font-size: 20px; font-weight: 700; color: #4fc3f7; margin-right: auto;
  }
  .cv-subtitle { font-size: 12px; color: #888; }
  .cv-controls { display: flex; align-items: center; gap: 8px; }
  .cv-select {
    background: #1e1e36; color: #eee; border: 1px solid #3a3a5a;
    border-radius: 4px; padding: 5px 10px; font-size: 13px; cursor: pointer;
  }
  .cv-btn {
    background: #1e6091; color: #fff; border: none; border-radius: 4px;
    padding: 6px 14px; font-size: 13px; cursor: pointer; white-space: nowrap;
  }
  .cv-btn:hover { background: #2980b9; }
  .cv-section { padding: 16px 20px; }
  .cv-section-title {
    font-size: 14px; font-weight: 600; color: #8ab4f8;
    text-transform: uppercase; letter-spacing: 0.08em;
    margin: 0 0 12px 0; border-bottom: 1px solid #2a2a4a; padding-bottom: 6px;
  }
  .cv-cards {
    display: flex; flex-wrap: wrap; gap: 12px;
  }
  .cv-card {
    background: #12122a; border: 1px solid #2a2a4a; border-radius: 8px;
    padding: 14px 18px; min-width: 140px; cursor: pointer;
    transition: border-color 0.2s, transform 0.1s;
    display: flex; flex-direction: column; gap: 6px;
  }
  .cv-card:hover { border-color: #4fc3f7; transform: translateY(-1px); }
  .cv-card-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
  .cv-card-count { font-size: 28px; font-weight: 700; line-height: 1; }
  .cv-card-status {
    font-size: 11px; font-weight: 600; border-radius: 3px;
    padding: 2px 6px; display: inline-block; width: fit-content;
  }
  .cv-card-status.green  { background: rgba(110,190,74,0.15); color: #6ebe4a; }
  .cv-card-status.yellow { background: rgba(240,180,0,0.15);  color: #f0b400; }
  .cv-card-status.red    { background: rgba(204,86,66,0.15);  color: #cc5642; }
  .cv-filter-bar {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px;
  }
  .cv-filter-label { font-size: 12px; color: #888; }
  .cv-check-group { display: flex; gap: 8px; flex-wrap: wrap; }
  .cv-check-item {
    display: flex; align-items: center; gap: 4px; cursor: pointer;
    font-size: 12px; color: #ccc; user-select: none;
  }
  .cv-check-item input { cursor: pointer; }
  .cv-table-wrap { overflow-x: auto; }
  .cv-table {
    width: 100%; border-collapse: collapse; font-size: 13px; min-width: 800px;
  }
  .cv-table th {
    background: #1a1a36; color: #8ab4f8; font-weight: 600;
    text-align: left; padding: 8px 10px; border-bottom: 2px solid #2a2a4a;
    cursor: pointer; white-space: nowrap; user-select: none;
  }
  .cv-table th:hover { color: #4fc3f7; }
  .cv-table th .sort-icon { opacity: 0.4; margin-left: 4px; }
  .cv-table th.sorted .sort-icon { opacity: 1; }
  .cv-table td { padding: 7px 10px; border-bottom: 1px solid #1a1a2e; }
  .cv-table tr:hover td { background: rgba(255,255,255,0.03); }
  .cv-table tr.cv-zero td { color: #555; }
  .cv-table tr.cv-low td { }
  .cv-table tr.cv-med td { color: #f0b400; }
  .cv-table tr.cv-high td { color: #e7664c; }
  .cv-fw-badge {
    display: inline-block; border-radius: 3px; padding: 1px 6px;
    font-size: 11px; font-weight: 600;
  }
  .cv-sev-bar { display: flex; gap: 3px; align-items: center; }
  .cv-sev-dot {
    width: 10px; height: 10px; border-radius: 2px; display: inline-block;
    position: relative;
  }
  .cv-sev-count { font-size: 11px; color: #aaa; }
  .cv-matrix-wrap { overflow-x: auto; }
  .cv-matrix {
    border-collapse: collapse; font-size: 12px;
  }
  .cv-matrix th {
    background: #1a1a36; color: #8ab4f8; font-weight: 600;
    padding: 6px 10px; text-align: center; border: 1px solid #2a2a4a;
  }
  .cv-matrix td {
    padding: 6px 10px; text-align: center; border: 1px solid #2a2a4a;
    font-weight: 600; font-size: 13px;
  }
  .cv-matrix .row-label {
    text-align: left; white-space: nowrap; background: #1a1a36;
    color: #8ab4f8; font-size: 12px; font-weight: 600; padding: 6px 12px;
  }
  .cv-matrix .diag { background: #12122a; color: #555; font-weight: 400; }
  .cv-loading { color: #888; font-size: 13px; padding: 10px 0; }
  .cv-error { color: #e7664c; font-size: 13px; padding: 10px 0; }
  .cv-empty { color: #555; font-size: 13px; padding: 20px 0; text-align: center; }
`;

/* ── Helpers ─────────────────────────────────────────────────────────────────── */

function fetchJSON(url) {
  return fetch(url, {
    headers:     { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  }).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url);
    return res.json();
  });
}

function statusClass(count) {
  if (count < THRESHOLD_GREEN)  return 'green';
  if (count < THRESHOLD_YELLOW) return 'yellow';
  return 'red';
}

function statusLabel(count) {
  if (count < THRESHOLD_GREEN)  return 'NORMAL';
  if (count < THRESHOLD_YELLOW) return 'ELEVATED';
  return 'HIGH';
}

function heatColor(value, maxValue) {
  if (!value || maxValue === 0) return 'transparent';
  var ratio = value / maxValue;
  if (ratio < 0.1)  return 'rgba(30,96,145,0.3)';
  if (ratio < 0.3)  return 'rgba(30,96,145,0.6)';
  if (ratio < 0.6)  return 'rgba(240,180,0,0.4)';
  if (ratio < 0.85) return 'rgba(231,102,76,0.5)';
  return 'rgba(204,86,66,0.7)';
}

function fmtTimestamp(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch (e) {
    return ts;
  }
}

function el(tag, attrs, children) {
  var node = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function(k) {
      if (k === 'className') node.className = attrs[k];
      else if (k === 'style') node.style.cssText = attrs[k];
      else if (k === 'innerHTML') node.innerHTML = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
  }
  if (children) {
    (Array.isArray(children) ? children : [children]).forEach(function(c) {
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    });
  }
  return node;
}

function fwMeta(key) {
  return FRAMEWORKS.find(function(f) { return f.key === key; }) || { key: key, label: key, color: '#888' };
}

/* ── App state ──────────────────────────────────────────────────────────────── */

var state = {
  timeRange:       '24h',
  summaryData:     null,
  detailsData:     {},    // { framework_key: [sections] }
  overlapData:     null,
  visibleFws:      {},    // { key: true/false }
  sortCol:         'count',
  sortDir:         'desc',
};

// Initialise all frameworks as visible.
FRAMEWORKS.forEach(function(fw) { state.visibleFws[fw.key] = true; });

/* ── Render functions ────────────────────────────────────────────────────────── */

function renderCards(summaryEl) {
  summaryEl.innerHTML = '';
  if (!state.summaryData) {
    summaryEl.appendChild(el('div', { className: 'cv-loading' }, 'Loading…'));
    return;
  }

  var fws = state.summaryData.frameworks || {};
  var cardsDiv = el('div', { className: 'cv-cards' });

  FRAMEWORKS.forEach(function(fw) {
    var data  = fws[fw.key] || { count: 0 };
    var count = data.count || 0;
    var sc    = statusClass(count);

    var card = el('div', { className: 'cv-card' });
    card.style.borderLeftColor = fw.color;
    card.style.borderLeftWidth = '3px';

    var lbl = el('div', { className: 'cv-card-label' }, fw.label);
    lbl.style.color = fw.color;

    var cnt = el('div', { className: 'cv-card-count' }, String(count));
    var stat = el('div', { className: 'cv-card-status ' + sc }, statusLabel(count));

    card.appendChild(lbl);
    card.appendChild(cnt);
    card.appendChild(stat);

    // Clicking a card scrolls to the detail table section and focuses that framework.
    card.addEventListener('click', function() {
      var tableSection = document.getElementById('cv-section-table');
      if (tableSection) tableSection.scrollIntoView({ behavior: 'smooth' });
    });

    cardsDiv.appendChild(card);
  });

  summaryEl.appendChild(cardsDiv);
}

function renderTable(tableContainer) {
  tableContainer.innerHTML = '';

  // Build a flat list of { framework, section, count, severity, last_alert, description }.
  var rows = [];
  FRAMEWORKS.forEach(function(fw) {
    if (!state.visibleFws[fw.key]) return;
    var sections = state.detailsData[fw.key] || [];
    sections.forEach(function(s) {
      rows.push({
        framework:   fw.key,
        fw_label:    fw.label,
        fw_color:    fw.color,
        section:     s.key,
        description: s.description || '',
        count:       s.count || 0,
        severity:    s.severity || {},
        last_alert:  s.last_alert || null,
      });
    });
  });

  if (rows.length === 0) {
    tableContainer.appendChild(el('div', { className: 'cv-empty' }, 'No violations found for selected frameworks in this time range.'));
    return;
  }

  // Sort.
  var sortCol = state.sortCol;
  var sortDir = state.sortDir;
  rows.sort(function(a, b) {
    var av, bv;
    if (sortCol === 'count') {
      av = a.count; bv = b.count;
    } else if (sortCol === 'framework') {
      av = a.fw_label; bv = b.fw_label;
    } else if (sortCol === 'section') {
      av = a.section; bv = b.section;
    } else if (sortCol === 'last_alert') {
      av = a.last_alert || ''; bv = b.last_alert || '';
    } else {
      av = a.count; bv = b.count;
    }
    if (av < bv) return sortDir === 'asc' ?  -1 : 1;
    if (av > bv) return sortDir === 'asc' ?   1 : -1;
    return 0;
  });

  // Table header columns.
  var columns = [
    { key: 'framework',  label: 'Framework' },
    { key: 'section',    label: 'Section / Clause' },
    { key: 'description',label: 'Description', noSort: true },
    { key: 'count',      label: 'Alerts' },
    { key: 'severity',   label: 'Severity', noSort: true },
    { key: 'last_alert', label: 'Last Alert' },
  ];

  var thead = el('thead');
  var headerRow = el('tr');
  columns.forEach(function(col) {
    var th = el('th', {});
    var icon = col.noSort ? '' : (sortCol === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅');
    th.innerHTML = col.label + (col.noSort ? '' : '<span class="sort-icon">' + icon + '</span>');
    if (sortCol === col.key && !col.noSort) th.className = 'sorted';
    if (!col.noSort) {
      th.addEventListener('click', function() {
        if (state.sortCol === col.key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortCol = col.key;
          state.sortDir = 'desc';
        }
        renderTable(tableContainer);
      });
    }
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  var tbody = el('tbody');
  rows.forEach(function(row) {
    var rowClass = row.count === 0 ? 'cv-zero'
      : row.count < THRESHOLD_GREEN  ? 'cv-low'
      : row.count < THRESHOLD_YELLOW ? 'cv-med'
      : 'cv-high';

    var tr = el('tr', { className: rowClass });

    // Framework badge.
    var fwTd = el('td');
    var badge = el('span', { className: 'cv-fw-badge' }, row.fw_label);
    badge.style.background = row.fw_color + '22';
    badge.style.color       = row.fw_color;
    fwTd.appendChild(badge);
    tr.appendChild(fwTd);

    // Section.
    tr.appendChild(el('td', {}, row.section));

    // Description.
    tr.appendChild(el('td', { style: 'color:#aaa;font-size:12px;max-width:280px;' }, row.description));

    // Count.
    var countTd = el('td', { style: 'font-weight:600;' }, String(row.count));
    tr.appendChild(countTd);

    // Severity breakdown.
    var sevTd = el('td');
    var sevBar = el('div', { className: 'cv-sev-bar' });
    SEVERITIES.forEach(function(sev) {
      var cnt = (row.severity && row.severity[sev]) || 0;
      if (cnt === 0) return;
      var dot = el('span', { className: 'cv-sev-dot', title: sev + ': ' + cnt });
      dot.style.background = SEV_COLORS[sev];
      var lbl = el('span', { className: 'cv-sev-count' }, cnt);
      sevBar.appendChild(dot);
      sevBar.appendChild(lbl);
    });
    if (!sevBar.children.length) {
      sevBar.appendChild(el('span', { style: 'color:#555;font-size:11px;' }, '—'));
    }
    sevTd.appendChild(sevBar);
    tr.appendChild(sevTd);

    // Last alert timestamp.
    tr.appendChild(el('td', { style: 'font-size:11px;color:#aaa;white-space:nowrap;' }, fmtTimestamp(row.last_alert)));

    tbody.appendChild(tr);
  });

  var table = el('table', { className: 'cv-table' });
  table.appendChild(thead);
  table.appendChild(tbody);

  var wrap = el('div', { className: 'cv-table-wrap' });
  wrap.appendChild(table);
  tableContainer.appendChild(wrap);
}

function renderOverlap(matrixContainer) {
  matrixContainer.innerHTML = '';

  if (!state.overlapData) {
    matrixContainer.appendChild(el('div', { className: 'cv-loading' }, 'Loading…'));
    return;
  }

  var matrix = state.overlapData.matrix || {};
  var keys   = state.overlapData.frameworks || FRAMEWORKS.map(function(f) { return f.key; });

  // Find max non-diagonal value for colour scaling.
  var maxVal = 0;
  keys.forEach(function(rk) {
    keys.forEach(function(ck) {
      if (rk !== ck && matrix[rk] && matrix[rk][ck] > maxVal) {
        maxVal = matrix[rk][ck];
      }
    });
  });

  var table = el('table', { className: 'cv-matrix' });

  // Header row.
  var thead = el('thead');
  var hr = el('tr');
  hr.appendChild(el('th', { innerHTML: 'Framework ↓ / →' }));
  keys.forEach(function(k) {
    var fw = fwMeta(k);
    var th = el('th', {});
    th.style.color = fw.color;
    th.textContent = fw.label;
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  // Data rows.
  var tbody = el('tbody');
  keys.forEach(function(rowKey) {
    var fw = fwMeta(rowKey);
    var tr = el('tr');

    var labelTd = el('td', { className: 'row-label' });
    labelTd.style.color = fw.color;
    labelTd.textContent = fw.label;
    tr.appendChild(labelTd);

    keys.forEach(function(colKey) {
      var td = el('td');
      if (rowKey === colKey) {
        td.className = 'diag';
        var total = matrix[rowKey] && matrix[rowKey][rowKey];
        td.textContent = total != null ? String(total) : '—';
      } else {
        var val = (matrix[rowKey] && matrix[rowKey][colKey]) || 0;
        td.textContent = String(val);
        td.style.background = heatColor(val, maxVal);
        if (val > 0) td.style.color = '#fff';
        else td.style.color = '#444';
        td.title = fwMeta(rowKey).label + ' ∩ ' + fwMeta(colKey).label + ': ' + val + ' alerts';
      }
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);

  var wrap = el('div', { className: 'cv-matrix-wrap' });
  wrap.appendChild(table);
  matrixContainer.appendChild(wrap);

  // Legend.
  var legend = el('div', { style: 'margin-top:10px;font-size:11px;color:#666;' });
  legend.textContent = 'Diagonal = total alerts for that framework. Off-diagonal = alerts triggering both frameworks simultaneously.';
  matrixContainer.appendChild(legend);
}

/* ── Data loading ────────────────────────────────────────────────────────────── */

function loadAll(refs) {
  var tr = state.timeRange;

  // Disable refresh button during load.
  if (refs.refreshBtn) refs.refreshBtn.disabled = true;
  if (refs.statusEl)   refs.statusEl.textContent = 'Loading…';

  // Summary.
  if (refs.summaryEl) refs.summaryEl.innerHTML = '<div class="cv-loading">Loading…</div>';
  if (refs.tableContainer) refs.tableContainer.innerHTML = '<div class="cv-loading">Loading frameworks…</div>';
  if (refs.matrixContainer) refs.matrixContainer.innerHTML = '<div class="cv-loading">Loading…</div>';

  var summaryPromise = fetchJSON(API_BASE + '/summary?time_range=' + tr)
    .then(function(data) {
      state.summaryData = data;
      renderCards(refs.summaryEl);
    })
    .catch(function(err) {
      refs.summaryEl.innerHTML = '<div class="cv-error">Error loading summary: ' + err.message + '</div>';
    });

  // Details — load all frameworks in parallel.
  state.detailsData = {};
  var detailPromises = FRAMEWORKS.map(function(fw) {
    return fetchJSON(API_BASE + '/details?framework=' + fw.key + '&time_range=' + tr)
      .then(function(data) {
        state.detailsData[fw.key] = data.sections || [];
      })
      .catch(function(err) {
        state.detailsData[fw.key] = [];
        console.error('complianceView: details error for ' + fw.key + ':', err);
      });
  });

  // Overlap.
  var overlapPromise = fetchJSON(API_BASE + '/overlap?time_range=' + tr)
    .then(function(data) {
      state.overlapData = data;
      renderOverlap(refs.matrixContainer);
    })
    .catch(function(err) {
      refs.matrixContainer.innerHTML = '<div class="cv-error">Error loading overlap matrix: ' + err.message + '</div>';
    });

  // Render table once all detail requests complete.
  Promise.all([summaryPromise].concat(detailPromises)).then(function() {
    renderTable(refs.tableContainer);
    if (refs.refreshBtn) refs.refreshBtn.disabled = false;
    if (refs.statusEl)   refs.statusEl.textContent = 'Last updated: ' + new Date().toLocaleTimeString();
  });

  overlapPromise.then(function() {
    // already rendered above
  });
}

/* ── Mount ───────────────────────────────────────────────────────────────────── */

function mountApp(params) {
  var element = params.element;
  element.style.cssText = 'width:100%;height:100%;overflow:hidden;';

  // Inject styles once.
  if (!document.getElementById('cv-styles')) {
    var styleEl = document.createElement('style');
    styleEl.id = 'cv-styles';
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);
  }

  // Root container.
  var root = el('div', { className: 'cv-root' });
  element.appendChild(root);

  /* ── Header ── */
  var header = el('div', { className: 'cv-header' });

  var titleDiv = el('div', {});
  titleDiv.appendChild(el('div', { className: 'cv-title' }, '\u2714 Compliance Overview'));
  titleDiv.appendChild(el('div', { className: 'cv-subtitle' }, 'PCI DSS · HIPAA · GDPR · NIST 800-53 · TSC · PECA'));
  header.appendChild(titleDiv);

  var statusEl = el('span', { style: 'margin-left:12px;font-size:12px;color:#888;' }, '');
  header.appendChild(statusEl);

  var controls = el('div', { className: 'cv-controls' });

  var rangeSelect = el('select', { className: 'cv-select' });
  [
    { value: '24h', label: 'Last 24 hours' },
    { value: '7d',  label: 'Last 7 days'   },
    { value: '30d', label: 'Last 30 days'  },
  ].forEach(function(opt) {
    var o = el('option', { value: opt.value }, opt.label);
    if (opt.value === state.timeRange) o.selected = true;
    rangeSelect.appendChild(o);
  });
  rangeSelect.addEventListener('change', function() {
    state.timeRange = rangeSelect.value;
    loadAll(refs);
  });

  var refreshBtn = el('button', { className: 'cv-btn' }, '\u21bb Refresh');
  refreshBtn.addEventListener('click', function() { loadAll(refs); });

  controls.appendChild(el('span', { style: 'font-size:12px;color:#666;' }, 'Time range:'));
  controls.appendChild(rangeSelect);
  controls.appendChild(refreshBtn);
  header.appendChild(controls);
  root.appendChild(header);

  /* ── Framework Summary Section ── */
  var summarySection = el('div', { className: 'cv-section' });
  summarySection.appendChild(el('div', { className: 'cv-section-title' }, 'Framework Summary'));
  var summaryEl = el('div', {});
  summarySection.appendChild(summaryEl);
  root.appendChild(summarySection);

  /* ── Detail Table Section ── */
  var tableSection = el('div', { className: 'cv-section', id: 'cv-section-table' });
  tableSection.appendChild(el('div', { className: 'cv-section-title' }, 'Compliance Requirements Detail'));

  // Framework filter checkboxes.
  var filterBar = el('div', { className: 'cv-filter-bar' });
  filterBar.appendChild(el('span', { className: 'cv-filter-label' }, 'Show frameworks:'));
  var checkGroup = el('div', { className: 'cv-check-group' });
  FRAMEWORKS.forEach(function(fw) {
    var label = el('label', { className: 'cv-check-item' });
    var cb = el('input', { type: 'checkbox' });
    cb.checked = state.visibleFws[fw.key];
    cb.addEventListener('change', function() {
      state.visibleFws[fw.key] = cb.checked;
      renderTable(tableContainer);
    });
    var lbl = el('span', {}, fw.label);
    lbl.style.color = fw.color;
    label.appendChild(cb);
    label.appendChild(lbl);
    checkGroup.appendChild(label);
  });
  filterBar.appendChild(checkGroup);
  tableSection.appendChild(filterBar);

  var tableContainer = el('div', {});
  tableSection.appendChild(tableContainer);
  root.appendChild(tableSection);

  /* ── Overlap Matrix Section ── */
  var overlapSection = el('div', { className: 'cv-section' });
  overlapSection.appendChild(el('div', { className: 'cv-section-title' }, 'Cross-Framework Alert Overlap'));

  var overlapDesc = el('p', { style: 'font-size:12px;color:#888;margin:0 0 10px 0;' });
  overlapDesc.textContent = 'Each cell shows how many alerts in the selected time range triggered violations in both frameworks simultaneously. Higher overlap means a single incident has cross-regulatory impact.';
  overlapSection.appendChild(overlapDesc);

  var matrixContainer = el('div', {});
  overlapSection.appendChild(matrixContainer);
  root.appendChild(overlapSection);

  /* ── Refs object passed to all loaders ── */
  var refs = { summaryEl, tableContainer, matrixContainer, refreshBtn, statusEl };

  /* ── Initial load ── */
  loadAll(refs);

  /* ── Unmount ── */
  return function unmount() {
    while (element.firstChild) element.removeChild(element.firstChild);
  };
}

/* ── OSD plugin class ────────────────────────────────────────────────────────── */

function ComplianceViewPlugin() {}

ComplianceViewPlugin.prototype.setup = function(core) {
  core.application.register({
    id:          'complianceView',
    title:       'Compliance View',
    euiIconType: 'visTable',
    category: {
      id:    'wazuh',
      label: 'Wazuh',
      order: 1000,
    },
    order: 9200,
    mount: function(params) {
      return mountApp(params);
    },
  });
};

ComplianceViewPlugin.prototype.start = function() {};
ComplianceViewPlugin.prototype.stop  = function() {};

module.exports = {
  plugin: function() {
    return new ComplianceViewPlugin();
  },
};
