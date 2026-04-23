'use strict';

/**
 * public/index.js — NLQ Search plugin
 *
 * TWO things happen when this module loads:
 *
 * 1. GLOBAL INJECTOR (runs on every page)
 *    A MutationObserver watches for the OSD query bar's "DQL" language toggle
 *    button to appear anywhere in the DOM.  When it does, an "EN" button is
 *    injected immediately to its left.
 *
 *    Flow when EN is active and the user presses Enter:
 *      plain English → POST /api/nlq_search/translate → Sec-IR → DQL string
 *      → set textarea value → auto-submit → OSD runs the DQL query normally
 *
 *    The DQL string is built deterministically from the Sec-IR object; no
 *    second API call is needed.  Time range comes from the page's existing
 *    time-picker (not overridden).
 *
 * 2. STANDALONE PAGE at /app/nlqSearch
 *    Full-featured page with editable IR JSON, raw DSL view, re-transpile,
 *    and results table.  Still accessible alongside the injector.
 */

/* ─────────────────────────────────────────────────────────────────────────────
   Shared lookup tables (used by both injector and standalone page)
   ───────────────────────────────────────────────────────────────────────────── */

var EVENT_TYPE_TO_GROUPS = {
  authentication_failure: ['authentication_failed'],
  privilege_escalation:   ['privilege_escalation'],
  lateral_movement:       ['lateral_movement'],
  port_scan:              ['recon', 'port_scan'],
  process_injection:      ['process_injection'],
  file_deletion:          ['syscheck', 'deleted'],
  malware_alert:          ['malware'],
  ransomware_behavior:    ['malware', 'ransomware'],
  policy_violation:       ['policy_violation'],
  data_exfiltration:      ['data_exfiltration'],
};

var ENTITY_FIELD_MAP = {
  user:      'data.win.eventdata.targetUserName',
  user_role: 'data.win.eventdata.targetUserName',
  src_ip:    'data.srcip',
  host:      'agent.name',
  process:   'data.win.eventdata.processName',
};

var SEVERITY_RANGES = {
  info:     [1, 3],
  low:      [4, 6],
  medium:   [7, 9],
  high:     [10, 12],
  critical: [13, 15],
};

/**
 * Convert a validated Sec-IR object to a DQL query string suitable for
 * the OSD query bar.
 *
 * Time range is intentionally omitted — the page's existing time-picker
 * handles it.
 *
 * @param {object} ir  Validated Sec-IR object.
 * @returns {string}   DQL query string.
 */
function irToDQL(ir) {
  var parts = [];

  // event_type → rule.groups
  var groups = EVENT_TYPE_TO_GROUPS[ir.event_type] || [];
  if (groups.length === 1) {
    parts.push('rule.groups: "' + groups[0] + '"');
  } else if (groups.length > 1) {
    parts.push('(' + groups.map(function(g) {
      return 'rule.groups: "' + g + '"';
    }).join(' or ') + ')');
  }

  // entity key:value pairs
  var entity = ir.entity || {};
  Object.keys(entity).forEach(function(key) {
    var val = entity[key];
    if (!val || val === '*') return;
    var field = ENTITY_FIELD_MAP[key];
    if (!field) return;
    parts.push(field + ': "' + val.replace(/"/g, '\\"') + '"');
  });

  // severity → rule.level range
  if (ir.severity && ir.severity !== 'any') {
    var range = SEVERITY_RANGES[ir.severity];
    if (range) {
      parts.push('rule.level >= ' + range[0] + ' and rule.level <= ' + range[1]);
    }
  }

  return parts.length > 0 ? parts.join(' and ') : '*';
}

/* ─────────────────────────────────────────────────────────────────────────────
   Helper: postJSON
   ───────────────────────────────────────────────────────────────────────────── */

function postJSON(url, body) {
  return fetch(url, {
    method:      'POST',
    headers:     { 'Content-Type': 'application/json', 'osd-xsrf': 'true' },
    credentials: 'same-origin',
    body:        JSON.stringify(body),
  }).then(function(res) {
    return res.json().then(function(data) {
      if (!res.ok) throw new Error((data && data.message) || ('HTTP ' + res.status));
      return data;
    });
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   Global injector
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Set the value of a React-controlled textarea without React losing track
 * of the change.  Uses the native property descriptor setter, then fires an
 * 'input' event so React's synthetic onChange fires.
 */
function setReactTextareaValue(textarea, value) {
  var nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
  ).set;
  nativeSetter.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Briefly show an error label on the button then restore. */
function flashBtn(btn, label, color) {
  var prev = btn.textContent;
  btn.textContent = label;
  btn.style.background = color;
  btn.style.color = '#fff';
  btn.style.borderColor = color;
  setTimeout(function() {
    btn.textContent = prev;
    btn.style.background = '#f8f9fa';
    btn.style.color = '#495057';
    btn.style.borderColor = '#ced4da';
  }, 2500);
}

/**
 * Create (or re-use) a single floating EN button and bind it to the given
 * DQL language button + textarea.
 *
 * Uses position:fixed so it floats directly to the left of the DQL button
 * regardless of whatever flex/portal/wrapper structure React renders.  A
 * setInterval repositions it every 250 ms and cleans up when the DQL button
 * leaves the DOM.
 */
function attachEnButton(langBtn, textarea) {
  /* ── state ── */
  var nlqMode = false;

  /* ── create EN button ── */
  var enBtn = document.createElement('button');
  enBtn.type = 'button';
  enBtn.id = 'nlq-floating-en-btn';
  enBtn.setAttribute('data-nlq-toggle', 'true');
  enBtn.textContent = 'EN';
  enBtn.title = 'NLQ: type plain English, press Enter to translate and search';
  enBtn.style.cssText = [
    'position:fixed',
    'z-index:9999',
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'padding:0 9px',
    'border:1px solid #ced4da',
    'border-radius:3px 0 0 3px',
    'background:#f8f9fa',
    'color:#495057',
    'font-size:11px',
    'font-weight:700',
    'cursor:pointer',
    'letter-spacing:0.05em',
    'white-space:nowrap',
    'outline:none',
    'box-shadow:none',
    'transition:background 0.15s,color 0.15s,border-color 0.15s',
  ].join(';');

  document.body.appendChild(enBtn);

  /* ── position: keep the button glued to the left of the DQL button ── */
  var intervalId = setInterval(function() {
    if (!document.contains(langBtn)) {
      /* DQL button gone (page navigation) — clean up everything */
      clearInterval(intervalId);
      if (document.contains(enBtn)) enBtn.remove();
      textarea.removeAttribute('data-nlq-handler');
      return;
    }
    var rect = langBtn.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      enBtn.style.opacity = '0';
      enBtn.style.pointerEvents = 'none';
      return;
    }
    enBtn.style.opacity = '1';
    enBtn.style.pointerEvents = '';
    enBtn.style.top    = rect.top + 'px';
    enBtn.style.left   = (rect.left - enBtn.offsetWidth - 1) + 'px';
    enBtn.style.height = rect.height + 'px';
  }, 250);

  /* ── active / inactive visual states ── */
  function setActive(active) {
    nlqMode = active;
    if (active) {
      enBtn.style.background   = '#00BFB3';
      enBtn.style.color        = '#fff';
      enBtn.style.borderColor  = '#00BFB3';
      enBtn.title = 'NLQ active — type plain English, press Enter to translate and run';
    } else {
      enBtn.style.background   = '#f8f9fa';
      enBtn.style.color        = '#495057';
      enBtn.style.borderColor  = '#ced4da';
      enBtn.title = 'NLQ: type plain English, press Enter to translate and search';
    }
  }

  enBtn.addEventListener('mouseenter', function() {
    if (!nlqMode) enBtn.style.background = '#e9ecef';
  });
  enBtn.addEventListener('mouseleave', function() {
    if (!nlqMode) enBtn.style.background = '#f8f9fa';
  });

  enBtn.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    setActive(!nlqMode);
    if (nlqMode) textarea.focus();
  });

  /* ── keydown handler on the textarea ── */
  textarea.setAttribute('data-nlq-handler', 'true');
  textarea.addEventListener('keydown', function(e) {
    if (!nlqMode) return;
    if (e.key !== 'Enter') return;
    if (window.__nlqProcessing) return;

    var query = textarea.value.trim();
    if (!query) return;

    e.preventDefault();
    e.stopPropagation();

    enBtn.textContent = '…';
    enBtn.disabled = true;
    enBtn.style.background = '#1D1E24';
    enBtn.style.color = '#69707D';

    postJSON('/api/nlq_search/translate', { query: query })
      .then(function(data) {
        enBtn.textContent = 'EN';
        enBtn.disabled = false;

        if (data.error === 'not_a_security_query') {
          flashBtn(enBtn, '✗ not a query', '#BD271E');
          setActive(true);
          return;
        }
        if (!data.ir) {
          flashBtn(enBtn, '✗ error', '#BD271E');
          setActive(true);
          return;
        }

        var dql = irToDQL(data.ir);
        setReactTextareaValue(textarea, dql);
        setActive(false);

        /* Brief green flash */
        enBtn.textContent = '✓';
        enBtn.style.background = '#017D73';
        enBtn.style.color = '#fff';
        setTimeout(function() {
          enBtn.textContent = 'EN';
          enBtn.style.background = '#f8f9fa';
          enBtn.style.color = '#495057';
          enBtn.style.borderColor = '#ced4da';
        }, 800);

        /* Auto-submit the translated DQL */
        window.__nlqProcessing = true;
        setTimeout(function() {
          textarea.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
            bubbles: true, cancelable: true,
          }));
          setTimeout(function() { window.__nlqProcessing = false; }, 200);
        }, 80);
      })
      .catch(function(err) {
        enBtn.textContent = 'EN';
        enBtn.disabled = false;
        flashBtn(enBtn, '✗ failed', '#BD271E');
        setActive(true);
        console.error('[nlqSearch] translate error:', err);
      });
  }, true /* capture phase */);
}

/**
 * Scan the DOM for a DQL language button + queryInput textarea pair.
 * If found and not already handled, create the floating EN button.
 * Runs on every tick of the watcher — idempotent via element ID.
 */
function scanAndAttach() {
  /* If our floating button already exists and its DQL button is still in the
     DOM, nothing to do. */
  var existing = document.getElementById('nlq-floating-en-btn');
  if (existing && document.contains(existing)) return;

  var langBtn  = document.querySelector('[data-test-subj="switchQueryLanguageButton"]');
  var textarea = document.querySelector('[data-test-subj="queryInput"]');

  if (!langBtn || !textarea) return;
  if (textarea.getAttribute('data-nlq-handler')) return;

  attachEnButton(langBtn, textarea);
}

/**
 * Start the global watcher.  Uses both a MutationObserver (fast) and a
 * setInterval fallback (catches cases where MutationObserver fires before
 * React finishes attaching data-test-subj attributes).
 */
function initGlobalNlqInjector() {
  if (window.__nlqInjectorActive) return;
  window.__nlqInjectorActive = true;

  /* Run immediately */
  scanAndAttach();

  /* MutationObserver for fast response to DOM changes */
  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      if (mutations[i].addedNodes.length > 0) { scanAndAttach(); break; }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  /* Interval fallback — runs forever, cheap since it just checks one element */
  setInterval(scanAndAttach, 500);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Standalone page (/app/nlqSearch)
   ───────────────────────────────────────────────────────────────────────────── */

function severityColor(level) {
  if (level == null) return '#888';
  if (level >= 13) return '#d4371c';
  if (level >= 10) return '#f0a500';
  if (level >= 7)  return '#e6c222';
  if (level >= 4)  return '#00a550';
  return '#888';
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mountApp(params) {
  var el = params.element;
  el.style.cssText =
    'width:100%;min-height:100vh;display:flex;flex-direction:column;' +
    'background:#f8fafc;color:#1a202c;font-family:Inter,sans-serif;overflow:auto;box-sizing:border-box;';

  var state = { mode: 'english', ir: null, wazuhQuery: null, corrRounds: 0, hits: [], total: 0 };

  /* ── Header ── */
  var header = document.createElement('div');
  header.style.cssText =
    'display:flex;align-items:center;padding:12px 20px;' +
    'background:#f1f5f9;border-bottom:1px solid #e2e8f0;flex-shrink:0;gap:12px;';
  header.innerHTML =
    '<span style="font-size:18px;font-weight:600;color:#2b6cb0;">&#128269; NLQ Search</span>' +
    '<span style="font-size:12px;color:#718096;">Natural Language Query for Wazuh Alerts</span>';
  el.appendChild(header);

  /* ── Search area ── */
  var searchArea = document.createElement('div');
  searchArea.style.cssText =
    'padding:16px 20px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;flex-shrink:0;';

  var toggleRow = document.createElement('div');
  toggleRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px;';
  toggleRow.innerHTML =
    '<span style="font-size:12px;color:#718096;">Mode:</span>' +
    '<div style="display:flex;border:1px solid #e2e8f0;border-radius:4px;overflow:hidden;">' +
      '<button id="nlq-btn-english" style="padding:4px 14px;background:#3182ce;color:#fff;border:none;cursor:pointer;font-size:12px;">English</button>' +
      '<button id="nlq-btn-dsl"     style="padding:4px 14px;background:#e2e8f0;color:#4a5568;border:none;cursor:pointer;font-size:12px;border-left:1px solid #cbd5e0;">Query Language</button>' +
    '</div>';
  searchArea.appendChild(toggleRow);

  var inputRow = document.createElement('div');
  inputRow.style.cssText = 'display:flex;gap:8px;align-items:flex-start;';

  var textarea = document.createElement('textarea');
  textarea.placeholder = 'e.g. Show failed admin logins in the last 24 hours';
  textarea.style.cssText =
    'flex:1;padding:8px 12px;background:#ffffff;color:#1a202c;border:1px solid #e2e8f0;' +
    'border-radius:4px;font-size:13px;resize:vertical;min-height:52px;font-family:inherit;';
  inputRow.appendChild(textarea);

  var translateBtn = document.createElement('button');
  translateBtn.textContent = 'Translate';
  translateBtn.style.cssText =
    'padding:8px 18px;background:#1e6091;color:#fff;border:none;border-radius:4px;' +
    'cursor:pointer;font-size:13px;white-space:nowrap;';
  inputRow.appendChild(translateBtn);

  var runBtn = document.createElement('button');
  runBtn.textContent = 'Run Query';
  runBtn.style.cssText =
    'padding:8px 18px;background:#006644;color:#fff;border:none;border-radius:4px;' +
    'cursor:pointer;font-size:13px;white-space:nowrap;display:none;';
  inputRow.appendChild(runBtn);

  searchArea.appendChild(inputRow);

  var statusLine = document.createElement('div');
  statusLine.style.cssText = 'margin-top:8px;font-size:12px;color:#888;min-height:16px;';
  searchArea.appendChild(statusLine);
  el.appendChild(searchArea);

  /* ── IR area ── */
  var irArea = document.createElement('div');
  irArea.style.cssText =
    'padding:0 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:none;';

  var irSection = document.createElement('div');
  irSection.style.cssText = 'padding:12px 0;';

  var irHeader = document.createElement('div');
  irHeader.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
  irHeader.innerHTML =
    '<span style="font-size:13px;font-weight:600;color:#2b6cb0;">Sec-IR (Intermediate Representation)</span>' +
    '<div style="display:flex;gap:6px;">' +
      '<button id="nlq-ir-toggle" style="padding:2px 10px;background:#e2e8f0;color:#4a5568;border:1px solid #cbd5e0;border-radius:3px;cursor:pointer;font-size:11px;">Collapse</button>' +
      '<button id="nlq-retranspile-btn" style="padding:2px 10px;background:#fff5f5;color:#c53030;border:1px solid #fc8181;border-radius:3px;cursor:pointer;font-size:11px;">Re-transpile</button>' +
    '</div>';
  irSection.appendChild(irHeader);

  var irNote = document.createElement('div');
  irNote.style.cssText = 'font-size:11px;color:#718096;margin-bottom:6px;';
  irNote.textContent = 'Edit the JSON and click Re-transpile to regenerate DSL without another LLM call.';
  irSection.appendChild(irNote);

  var irEditor = document.createElement('textarea');
  irEditor.style.cssText =
    'width:100%;min-height:180px;padding:10px;background:#f8fafc;color:#276749;' +
    'border:1px solid #e2e8f0;border-radius:4px;font-family:monospace;font-size:12px;' +
    'resize:vertical;box-sizing:border-box;';
  irSection.appendChild(irEditor);

  var corrBadge = document.createElement('div');
  corrBadge.style.cssText = 'font-size:11px;color:#718096;margin-top:4px;';
  irSection.appendChild(corrBadge);

  irArea.appendChild(irSection);

  var dslSection = document.createElement('div');
  dslSection.style.cssText = 'padding:12px 0;border-top:1px solid #e2e8f0;';

  var dslHeader = document.createElement('div');
  dslHeader.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
  dslHeader.innerHTML =
    '<span style="font-size:13px;font-weight:600;color:#2b6cb0;">Generated Wazuh DSL Query</span>' +
    '<button id="nlq-dsl-toggle" style="padding:2px 10px;background:#e2e8f0;color:#4a5568;border:1px solid #cbd5e0;border-radius:3px;cursor:pointer;font-size:11px;">Collapse</button>';
  dslSection.appendChild(dslHeader);

  var dslDisplay = document.createElement('pre');
  dslDisplay.style.cssText =
    'padding:10px;background:#f8fafc;color:#744210;border:1px solid #e2e8f0;' +
    'border-radius:4px;font-size:12px;overflow:auto;max-height:240px;white-space:pre-wrap;';
  dslSection.appendChild(dslDisplay);

  var dqlDisplay = document.createElement('div');
  dqlDisplay.style.cssText = 'margin-top:8px;font-size:12px;color:#4a5568;';
  dqlDisplay.innerHTML = '<span style="color:#718096;">DQL equivalent:</span> <code id="nlq-dql-str" style="color:#2b6cb0;"></code>';
  dslSection.appendChild(dqlDisplay);

  irArea.appendChild(dslSection);
  el.appendChild(irArea);

  /* ── DSL direct input area ── */
  var dslInputArea = document.createElement('div');
  dslInputArea.style.cssText =
    'padding:12px 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:none;';
  dslInputArea.innerHTML =
    '<div style="font-size:13px;font-weight:600;color:#2b6cb0;margin-bottom:8px;">Wazuh DSL Query (JSON)</div>';

  var dslInputEditor = document.createElement('textarea');
  dslInputEditor.placeholder = '{\n  "query": { "bool": { "must": [ ... ] } }\n}';
  dslInputEditor.style.cssText =
    'width:100%;min-height:180px;padding:10px;background:#f8fafc;color:#744210;' +
    'border:1px solid #e2e8f0;border-radius:4px;font-family:monospace;font-size:12px;' +
    'resize:vertical;box-sizing:border-box;';
  dslInputArea.appendChild(dslInputEditor);
  el.appendChild(dslInputArea);

  /* ── Results area — always visible (flex:1 fills remaining height, fixes whitespace) ── */
  var resultsArea = document.createElement('div');
  resultsArea.style.cssText = 'padding:16px 20px;flex:1;overflow:auto;min-height:0;';
  el.appendChild(resultsArea);

  /* ── Mode wiring ── */
  var btnEnglish = el.querySelector('#nlq-btn-english');
  var btnDsl     = el.querySelector('#nlq-btn-dsl');

  function setMode(mode) {
    state.mode = mode;
    if (mode === 'english') {
      btnEnglish.style.background = '#3182ce'; btnEnglish.style.color = '#fff';
      btnDsl.style.background = '#e2e8f0';     btnDsl.style.color = '#4a5568';
      textarea.placeholder = 'e.g. Show failed admin logins in the last 24 hours';
      translateBtn.style.display = '';
      dslInputArea.style.display = 'none';
    } else {
      btnDsl.style.background = '#3182ce';     btnDsl.style.color = '#fff';
      btnEnglish.style.background = '#e2e8f0'; btnEnglish.style.color = '#4a5568';
      translateBtn.style.display = 'none';
      dslInputArea.style.display = '';
      runBtn.style.display = '';
    }
  }

  btnEnglish.addEventListener('click', function() { setMode('english'); });
  btnDsl.addEventListener('click',     function() { setMode('dsl');     });

  var irCollapsed = false;
  el.querySelector('#nlq-ir-toggle').addEventListener('click', function() {
    irCollapsed = !irCollapsed;
    irEditor.style.display  = irCollapsed ? 'none' : '';
    irNote.style.display    = irCollapsed ? 'none' : '';
    corrBadge.style.display = irCollapsed ? 'none' : '';
    this.textContent = irCollapsed ? 'Expand' : 'Collapse';
  });

  var dslCollapsed = false;
  el.querySelector('#nlq-dsl-toggle').addEventListener('click', function() {
    dslCollapsed = !dslCollapsed;
    dslDisplay.style.display = dslCollapsed ? 'none' : '';
    this.textContent = dslCollapsed ? 'Expand' : 'Collapse';
  });

  function setStatus(msg, kind) {
    statusLine.textContent = msg;
    statusLine.style.color = kind === 'error' ? '#ff6b6b' : kind === 'warn' ? '#f0a500' : '#888';
  }

  function setBusy(btn, text) {
    btn.disabled = true; btn._orig = btn.textContent;
    btn.textContent = text; btn.style.opacity = '0.6';
  }
  function setReady(btn) {
    btn.disabled = false; btn.textContent = btn._orig || btn.textContent;
    btn.style.opacity = '1';
  }

  translateBtn.addEventListener('click', function() {
    var q = textarea.value.trim();
    if (!q) { setStatus('Enter a security query first.', 'warn'); return; }
    doTranslate(q);
  });

  el.querySelector('#nlq-retranspile-btn').addEventListener('click', doRetranspile);
  runBtn.addEventListener('click', doExecute);

  function doTranslate(query) {
    setBusy(translateBtn, 'Translating…');
    setStatus('Calling LLM — this may take a few seconds…');
    irArea.style.display = 'none';
    resultsArea.style.display = 'none';
    runBtn.style.display = 'none';

    postJSON('/api/nlq_search/translate', { query: query })
      .then(function(data) {
        setReady(translateBtn);
        if (data.error === 'not_a_security_query') {
          setStatus('Not a security query — please enter a security detection request.', 'warn');
          return;
        }
        if (data.error) { setStatus('Error: ' + (data.message || data.error), 'error'); return; }

        state.ir = data.ir; state.wazuhQuery = data.wazuh_query; state.corrRounds = data.correction_rounds || 0;

        irEditor.value = JSON.stringify(state.ir, null, 2);
        dslDisplay.textContent = JSON.stringify(state.wazuhQuery, null, 2);
        var dqlStr = irToDQL(state.ir);
        var dqlEl = el.querySelector('#nlq-dql-str');
        if (dqlEl) dqlEl.textContent = dqlStr;
        corrBadge.textContent = state.corrRounds > 0
          ? '✓ Valid after ' + state.corrRounds + ' correction round(s)'
          : '✓ Valid on first attempt';

        irArea.style.display = '';
        runBtn.style.display = '';
        setStatus('Translated: ' + state.ir.event_type + ' / ' + state.ir.pattern +
          '  —  correction rounds: ' + state.corrRounds);
      })
      .catch(function(err) {
        setReady(translateBtn);
        setStatus('Translation failed: ' + err.message, 'error');
      });
  }

  function doRetranspile() {
    var btn = el.querySelector('#nlq-retranspile-btn');
    var rawIr;
    try { rawIr = JSON.parse(irEditor.value); }
    catch (e) { setStatus('IR JSON parse error: ' + e.message, 'error'); return; }

    setBusy(btn, 'Transpiling…');
    postJSON('/api/nlq_search/retranspile', { ir: rawIr })
      .then(function(data) {
        setReady(btn);
        if (data.error) {
          setStatus('Validation error: ' + (data.validation_errors || []).map(function(e) {
            return '[' + e.field + '] ' + e.message;
          }).join('; '), 'error');
          return;
        }
        state.ir = rawIr; state.wazuhQuery = data.wazuh_query;
        dslDisplay.textContent = JSON.stringify(state.wazuhQuery, null, 2);
        var dqlEl = el.querySelector('#nlq-dql-str');
        if (dqlEl) dqlEl.textContent = irToDQL(rawIr);
        setStatus('Re-transpile successful.');
      })
      .catch(function(err) { setReady(btn); setStatus('Re-transpile failed: ' + err.message, 'error'); });
  }

  function doExecute() {
    var queryToRun;
    if (state.mode === 'english') {
      if (!state.wazuhQuery) { setStatus('Translate a query first.', 'warn'); return; }
      queryToRun = state.wazuhQuery;
    } else {
      try { queryToRun = JSON.parse(dslInputEditor.value.trim()); }
      catch (e) { setStatus('DSL JSON parse error: ' + e.message, 'error'); return; }
    }

    setBusy(runBtn, 'Running…');
    setStatus('Executing query against Wazuh Indexer…');
    resultsArea.innerHTML = '<div style="text-align:center;padding:40px;color:#a0aec0;font-size:13px;">Running query…</div>';

    postJSON('/api/nlq_search/execute', { wazuh_query: queryToRun })
      .then(function(data) {
        setReady(runBtn);
        state.hits = data.hits || []; state.total = data.total || 0;
        renderResults(state.hits, state.total, data.index);
        setStatus(state.total + ' match(es) — showing ' + state.hits.length);
      })
      .catch(function(err) {
        setReady(runBtn);
        setStatus('Query execution failed: ' + err.message, 'error');
        resultsArea.innerHTML = '<div style="color:#c53030;padding:10px;">Error: ' + escHtml(err.message) + '</div>';
      });
  }

  function renderResults(hits, total, index) {
    resultsArea.innerHTML = '';
    var summary = document.createElement('div');
    summary.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;' +
      'margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #e2e8f0;';
    summary.innerHTML =
      '<span style="font-size:14px;font-weight:600;color:#2b6cb0;">Results</span>' +
      '<span style="font-size:12px;color:#718096;">' +
        total.toLocaleString() + ' total &nbsp;|&nbsp; showing ' + hits.length +
        ' &nbsp;|&nbsp; index: <code style="color:#4a5568;">' + escHtml(index || 'wazuh-alerts-*') + '</code>' +
      '</span>';
    resultsArea.appendChild(summary);

    if (hits.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;padding:40px;color:#a0aec0;font-size:14px;';
      empty.textContent = 'No matching alerts found.';
      resultsArea.appendChild(empty);
      return;
    }

    var tableWrap = document.createElement('div');
    tableWrap.style.overflowX = 'auto';
    var table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';
    table.innerHTML =
      '<thead><tr style="background:#f1f5f9;color:#4a5568;text-align:left;">' +
      '<th style="padding:8px 10px;border-bottom:1px solid #e2e8f0;min-width:160px;">Timestamp</th>' +
      '<th style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">Agent</th>' +
      '<th style="padding:8px 10px;border-bottom:1px solid #e2e8f0;min-width:300px;">Rule Description</th>' +
      '<th style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">Level</th>' +
      '<th style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">Rule ID</th>' +
      '<th style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">Groups</th>' +
      '</tr></thead>';

    var tbody = document.createElement('tbody');
    hits.forEach(function(hit, i) {
      var src = hit._source || {}, agent = src.agent || {}, rule = src.rule || {};
      var tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom:1px solid #e2e8f0;background:' + (i % 2 === 0 ? '#ffffff' : '#f7fafc') + ';';
      var ts = src['@timestamp'] ? new Date(src['@timestamp']).toLocaleString() : '—';
      var lvl = rule.level != null ? rule.level : '—';
      var grps = Array.isArray(rule.groups) ? rule.groups.join(', ') : (rule.groups || '—');
      tr.innerHTML =
        '<td style="padding:7px 10px;color:#718096;">' + escHtml(ts) + '</td>' +
        '<td style="padding:7px 10px;color:#2d3748;">' + escHtml(agent.name || agent.id || '—') + '</td>' +
        '<td style="padding:7px 10px;color:#2d3748;">' + escHtml(rule.description || '—') + '</td>' +
        '<td style="padding:7px 10px;"><span style="padding:2px 7px;border-radius:3px;font-weight:600;background:' +
          severityColor(lvl) + '22;color:' + severityColor(lvl) + ';border:1px solid ' +
          severityColor(lvl) + '44;">' + escHtml(String(lvl)) + '</span></td>' +
        '<td style="padding:7px 10px;color:#718096;">' + escHtml(String(rule.id || '—')) + '</td>' +
        '<td style="padding:7px 10px;color:#a0aec0;font-size:11px;">' + escHtml(grps) + '</td>';
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    resultsArea.appendChild(tableWrap);
  }

  return function unmount() {
    while (el.firstChild) el.removeChild(el.firstChild);
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   OSD plugin class
   ───────────────────────────────────────────────────────────────────────────── */

function NlqSearchPlugin() {}

NlqSearchPlugin.prototype.setup = function(core) {
  /* 1. Register the standalone /app/nlqSearch page */
  core.application.register({
    id:          'nlqSearch',
    title:       'NLQ Search',
    euiIconType: 'search',
    category: { id: 'wazuh', label: 'Wazuh', order: 1000 },
    order:       9200,
    mount: function(params) { return mountApp(params); },
  });

  /* 2. Inject the EN toggle into every query bar across all pages */
  if (typeof document !== 'undefined') {
    /* Debug indicator — tiny dot in bottom-right corner confirms plugin is alive.
       Also logs what selectors find after 3 s so we can diagnose missing elements. */
    function addDebugDot() {
      var dot = document.createElement('div');
      dot.id = 'nlq-debug-dot';
      dot.title = 'NLQ Search plugin running. Click to log debug info to console.';
      dot.style.cssText = [
        'position:fixed','bottom:8px','right:8px','z-index:99999',
        'width:10px','height:10px','border-radius:50%',
        'background:#00BFB3','opacity:0.8','cursor:pointer',
      ].join(';');
      dot.addEventListener('click', function() {
        var lb = document.querySelector('[data-test-subj="switchQueryLanguageButton"]');
        var ta = document.querySelector('[data-test-subj="queryInput"]');
        var eb = document.getElementById('nlq-floating-en-btn');
        console.log('[nlqSearch] switchQueryLanguageButton:', lb);
        console.log('[nlqSearch] queryInput textarea:', ta);
        console.log('[nlqSearch] floating EN button:', eb);
        alert('[nlqSearch debug]\nswitchQueryLanguageButton: ' + (lb ? 'FOUND' : 'NOT FOUND') +
              '\nqueryInput textarea: ' + (ta ? 'FOUND' : 'NOT FOUND') +
              '\nFloating EN button in DOM: ' + (eb ? 'YES' : 'NO'));
      });
      document.body.appendChild(dot);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        addDebugDot();
        initGlobalNlqInjector();
      });
    } else {
      addDebugDot();
      initGlobalNlqInjector();
    }
  }
};

NlqSearchPlugin.prototype.start = function() {};
NlqSearchPlugin.prototype.stop  = function() {};

module.exports = {
  plugin: function() { return new NlqSearchPlugin(); },
};
