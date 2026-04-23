#!/usr/bin/env python3
"""
patch_bundles.py — Idempotent patch script for Wazuh bundle files.

Patches applied:
  wazuh.chunk.2.js:
    1. Catalog map        — add PECA + Compliance Overview entries
    2. Agent tab counts   — add peca:1, "compliance-overview":1
    3. Overview tab counts — add peca:1, "compliance-overview":1
    4. After GitHub DS class — inject mountComplianceOverview() function,
       ComplianceOverviewPanel React class, peca_data_source_PECADataSource class
    5. Column definitions — add pecaColumns after tscColumns
    6. Module tabs        — add peca + compliance-overview modules

  wazuh.plugin.js:
    7a. peca app definition (order 406) — sidebar navigation entry for PECA module
    7b. compliance_overview_app definition (order 407)
    8.  Apps list — insert peca + compliance_overview_app (handles fresh install,
        partial-patch, and re-run without duplicating)

All patches are idempotent: already-applied patches are detected and skipped.

Fix history:
  2026-04-22 — AWS deployment revealed peca_app was never added to wazuh.plugin.js.
  patch_peca_dashboard.py only patched wazuh.chunk.2.js (dashboard tab content) but
  never defined the sidebar navigation const `peca` at order:406. The old apps-list
  logic here assumed `peca_app` already existed (it never did) so fell back to
  inserting only compliance_overview_app. Both steps now handled correctly below.
"""
import sys

CHUNK2 = '/usr/share/wazuh-dashboard/plugins/wazuh/target/public/wazuh.chunk.2.js'
PLUGIN = '/usr/share/wazuh-dashboard/plugins/wazuh/target/public/wazuh.plugin.js'


def apply_patch(content, old, new, label):
    """
    Apply a single patch.  Returns (new_content, status) where status is one of:
      'applied'  — patch was not present, now applied
      'skipped'  — idempotency marker already present, patch skipped
      'missing'  — old string not found and new marker not found either → error
    """
    # Idempotency: use the first 120 chars of `new` as the presence marker.
    # For the GITHUB_DS injection we use a dedicated idempotency_marker arg instead.
    if new in content:
        print(f'  [SKIP] already applied: {label}')
        return content, 'skipped'
    if old not in content:
        print(f'  [WARN] anchor not found: {label}', file=sys.stderr)
        return content, 'missing'
    content = content.replace(old, new, 1)
    print(f'  [OK]   applied: {label}')
    return content, 'applied'


def apply_patch_marker(content, old, new, marker, label):
    """
    Like apply_patch but uses an explicit idempotency marker string
    instead of checking for `new in content`.  Useful when `old` is a
    substring of `new` (so the replacement would still match on re-run).
    """
    if marker in content:
        print(f'  [SKIP] already applied: {label}')
        return content, 'skipped'
    if old not in content:
        print(f'  [WARN] anchor not found: {label}', file=sys.stderr)
        return content, 'missing'
    content = content.replace(old, new, 1)
    print(f'  [OK]   applied: {label}')
    return content, 'applied'


# ══════════════════════════════════════════════════════════════════════════════
# CHUNK 2 PATCHES
# ══════════════════════════════════════════════════════════════════════════════

# ── 1. Catalog map ────────────────────────────────────────────────────────────
CATALOG_OLD = (
    'tsc:{title:"TSC",appId:"tsc",description:"Trust Services Criteria for Security, Availability, '
    'Processing Integrity, Confidentiality, and Privacy"},ciscat:'
)
CATALOG_NEW = (
    'tsc:{title:"TSC",appId:"tsc",description:"Trust Services Criteria for Security, Availability, '
    'Processing Integrity, Confidentiality, and Privacy"},'
    'peca:{title:"PECA",appId:"peca",description:"Prevention of Electronic Crimes Act 2016 (PECA) \u2014 '
    "Pakistan's cybercrime law covering unauthorized access, data theft, and cyber terrorism.\"},"
    '"compliance-overview":{title:"Compliance Overview",appId:"compliance-overview",'
    'description:"Unified compliance dashboard comparing PCI DSS, HIPAA, GDPR, NIST 800-53, TSC, and PECA violations side-by-side."},'
    'ciscat:'
)

# ── 2. Agent tab counts ───────────────────────────────────────────────────────
AGENTS_OLD = (
    'this.agents={welcome:8,general:11,fim:7,gcp:7,pm:4,vuls:10,oscap:13,ciscat:3,'
    'audit:9,gdpr:6,pci:6,hipaa:6,aws:8,tsc:6,nist:5,virustotal:6,configuration:0,osquery:5,docker:5,mitre:6}'
)
AGENTS_NEW = (
    'this.agents={welcome:8,general:11,fim:7,gcp:7,pm:4,vuls:10,oscap:13,ciscat:3,'
    'audit:9,gdpr:6,pci:6,hipaa:6,aws:8,tsc:6,nist:5,virustotal:6,configuration:0,osquery:5,docker:5,mitre:6,'
    'peca:1,"compliance-overview":1}'
)

# ── 3. Overview tab counts ────────────────────────────────────────────────────
OVERVIEW_OLD = (
    'this.overview={welcome:0,general:6,fim:7,pm:5,vuls:7,oscap:8,ciscat:3,audit:6,'
    'pci:6,gdpr:5,hipaa:8,nist:7,aws:8,gcp:5,virustotal:5,osquery:6,sca:0,docker:5,mitre:6,tsc:6}'
)
OVERVIEW_NEW = (
    'this.overview={welcome:0,general:6,fim:7,pm:5,vuls:7,oscap:8,ciscat:3,audit:6,'
    'pci:6,gdpr:5,hipaa:8,nist:7,aws:8,gcp:5,virustotal:5,osquery:6,sca:0,docker:5,mitre:6,tsc:6,'
    'peca:1,"compliance-overview":1}'
)

# ── 4. mountComplianceOverview + ComplianceOverviewPanel + PECADataSource ─────
# Anchor: end of the GitHub DataSource class definition.
# NOTE: GITHUB_DS_END is a prefix of GITHUB_DS_NEW, so we cannot use
# `new in content` as the idempotency check — we use `mountComplianceOverview`
# as the explicit marker instead.
GITHUB_DS_END = (
    'const GITHUB_GROUP_KEY="rule.groups";const GITHUB_GROUP_VALUE="github";'
    'class github_data_source_GitHubDataSource extends alerts_data_source_AlertsDataSource{'
    'constructor(id,title){super(id,title)}'
    'getRuleGroupsFilter(){return super.getRuleGroupsFilter(GITHUB_GROUP_KEY,GITHUB_GROUP_VALUE,constants["p"])}'
    'getFixedFilters(){return[...super.getFixedFiltersClusterManager(),...this.getRuleGroupsFilter(),...super.getFixedFilters()]}}'
)

MOUNT_FN = (
    """function mountComplianceOverview(rootEl){const SID='cv-ov-styles';if(!document.getElementById(SID)){const s=document.createElement('style');s.id=SID;s.textContent='.cv-ov{padding:16px 20px;background:#f8fafc;min-height:100%;color:#1a202c;font-family:"Inter","Helvetica Neue",sans-serif;box-sizing:border-box}.cv-ov-hdr{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #e2e8f0}.cv-ov-title{font-size:18px;font-weight:700;color:#2b6cb0;flex:1}.cv-ov-sel{background:#fff;color:#1a202c;border:1px solid #e2e8f0;border-radius:4px;padding:5px 10px;font-size:12px}.cv-ov-btn{background:#3182ce;color:#fff;border:none;border-radius:4px;padding:5px 12px;font-size:12px;cursor:pointer}.cv-ov-btn:hover{background:#2b6cb0}.cv-ov-sec{margin-bottom:20px}.cv-ov-stitle{font-size:12px;font-weight:600;color:#2b6cb0;text-transform:uppercase;letter-spacing:.08em;margin:0 0 10px 0;padding-bottom:5px;border-bottom:1px solid #e2e8f0}.cv-ov-cards{display:flex;flex-wrap:wrap;gap:10px}.cv-ov-card{background:#fff;border:1px solid #e2e8f0;border-left:3px solid;border-radius:6px;padding:12px 16px;min-width:130px;cursor:pointer;transition:border-color .2s}.cv-ov-card:hover{border-top-color:#3b82f6;border-right-color:#3b82f6;border-bottom-color:#3b82f6}.cv-ov-clbl{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}.cv-ov-ccnt{font-size:24px;font-weight:700;line-height:1.1;color:#1a202c}.cv-ov-cst{font-size:10px;font-weight:600;border-radius:3px;padding:1px 5px;margin-top:4px;display:inline-block}.cv-ov-cst.g{background:rgba(110,190,74,.15);color:#2f855a}.cv-ov-cst.y{background:rgba(240,180,0,.15);color:#b7791f}.cv-ov-cst.r{background:rgba(204,86,66,.15);color:#c53030}.cv-ov-fbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;font-size:12px}.cv-ov-tbl{width:100%;border-collapse:collapse;font-size:12px;min-width:700px}.cv-ov-tbl th{background:#f1f5f9;color:#4a5568;font-weight:600;text-align:left;padding:7px 9px;border-bottom:2px solid #e2e8f0;cursor:pointer;white-space:nowrap;user-select:none}.cv-ov-tbl th:hover{color:#2b6cb0}.cv-ov-tbl td{padding:6px 9px;border-bottom:1px solid #f0f4f8;color:#2d3748}.cv-ov-tbl tr:hover td{background:rgba(59,130,246,.04)}.cv-ov-badge{display:inline-block;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:600}.cv-ov-mx{border-collapse:collapse;font-size:11px}.cv-ov-mx th{background:#f1f5f9;color:#4a5568;padding:5px 8px;border:1px solid #e2e8f0;text-align:center;font-weight:600}.cv-ov-mx td{padding:5px 8px;border:1px solid #e2e8f0;text-align:center;font-weight:600;font-size:12px}.cv-ov-mx .rl{text-align:left;background:#f1f5f9;font-size:11px;white-space:nowrap;padding:5px 10px}.cv-ov-mx .dg{background:#f8fafc;color:#a0aec0;font-weight:400}.cv-ov-load{color:#718096;font-size:12px;padding:8px 0}.cv-ov-err{color:#c53030;font-size:12px;padding:8px 0}.cv-ov-empty{color:#a0aec0;font-size:12px;padding:20px 0;text-align:center}.cv-ov-twrap{overflow-x:auto}.cv-ov.dark-theme{background:#0d0d1a;color:#eee}.cv-ov.dark-theme .cv-ov-hdr{border-bottom-color:#2a2a4a}.cv-ov.dark-theme .cv-ov-title{color:#4fc3f7}.cv-ov.dark-theme .cv-ov-sel{background:#1e1e36;color:#eee;border-color:#3a3a5a}.cv-ov.dark-theme .cv-ov-btn{background:#1e6091}.cv-ov.dark-theme .cv-ov-btn:hover{background:#2980b9}.cv-ov.dark-theme .cv-ov-stitle{color:#8ab4f8;border-bottom-color:#2a2a4a}.cv-ov.dark-theme .cv-ov-card{background:#12122a;border-color:#2a2a4a}.cv-ov.dark-theme .cv-ov-card:hover{border-top-color:#4fc3f7;border-right-color:#4fc3f7;border-bottom-color:#4fc3f7}.cv-ov.dark-theme .cv-ov-ccnt{color:#eee}.cv-ov.dark-theme .cv-ov-cst.g{color:#6ebe4a}.cv-ov.dark-theme .cv-ov-cst.y{color:#f0b400}.cv-ov.dark-theme .cv-ov-cst.r{color:#cc5642}.cv-ov.dark-theme .cv-ov-tbl th{background:#1a1a36;color:#8ab4f8;border-bottom-color:#2a2a4a}.cv-ov.dark-theme .cv-ov-tbl th:hover{color:#4fc3f7}.cv-ov.dark-theme .cv-ov-tbl td{border-bottom-color:#1a1a2e;color:#eee}.cv-ov.dark-theme .cv-ov-tbl tr:hover td{background:rgba(255,255,255,.03)}.cv-ov.dark-theme .cv-ov-mx th{background:#1a1a36;color:#8ab4f8;border-color:#2a2a4a}.cv-ov.dark-theme .cv-ov-mx td{border-color:#2a2a4a}.cv-ov.dark-theme .cv-ov-mx .rl{background:#1a1a36;color:#8ab4f8}.cv-ov.dark-theme .cv-ov-mx .dg{background:#12122a;color:#555}.cv-ov.dark-theme .cv-ov-load{color:#888}.cv-ov.dark-theme .cv-ov-err{color:#e7664c}.cv-ov.dark-theme .cv-ov-empty{color:#555}';document.head.appendChild(s);}const API='/api/compliance_view';const FW=[{k:'pci_dss',l:'PCI DSS',c:'#1BA9F5'},{k:'hipaa',l:'HIPAA',c:'#F66D64'},{k:'gdpr',l:'GDPR',c:'#6EBE4A'},{k:'nist_800_53',l:'NIST 800-53',c:'#F0B400'},{k:'tsc',l:'TSC',c:'#BD71F5'},{k:'peca',l:'PECA',c:'#FF7D00'}];const SEVS=['info','low','medium','high','critical'];const SEVC={info:'#6DCCB1',low:'#54B399',medium:'#D6BF57',high:'#E7664C',critical:'#CC5642'};const TG=10,TY=50;let st={tr:'24h',sum:null,det:{},ovl:null,sc:'count',sd:'desc'};const vis={};FW.forEach(f=>{vis[f.k]=true;});function mk(tag,css,html){const e=document.createElement(tag);if(css)e.className=css;if(html!=null)e.innerHTML=html;return e;}function fetchJ(url){return fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json'}}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();});}function sc(n){return n<TG?'g':n<TY?'y':'r';}function sl(n){return n<TG?'NORMAL':n<TY?'ELEVATED':'HIGH';}function hc(v,mx){if(!v||!mx)return'transparent';const r=v/mx;if(r<.1)return'rgba(30,96,145,.3)';if(r<.3)return'rgba(30,96,145,.6)';if(r<.6)return'rgba(240,180,0,.4)';if(r<.85)return'rgba(231,102,76,.5)';return'rgba(204,86,66,.7)';}function ft(ts){if(!ts)return'\\u2014';try{return new Date(ts).toLocaleString();}catch(e){return ts;}}function fwm(k){return FW.find(f=>f.k===k)||{k,l:k,c:'#888'};}rootEl.innerHTML='';const root=mk('div','cv-ov');rootEl.appendChild(root);try{if(localStorage.getItem('fyp_theme_v2')==='dark')root.classList.add('dark-theme');}catch(_){}function _onTheme(e){try{var t=e&&e.detail&&e.detail.theme;if(t==='dark')root.classList.add('dark-theme');else root.classList.remove('dark-theme');}catch(_){}}window.addEventListener('fyp-theme-changed',_onTheme);const hdr=mk('div','cv-ov-hdr');const ttl=mk('div','cv-ov-title','\\u2696 Compliance Overview');const stEl=mk('span','','');stEl.style.cssText='font-size:11px;color:#888;';const sel=mk('select','cv-ov-sel');[{v:'24h',t:'Last 24 hours'},{v:'7d',t:'Last 7 days'},{v:'30d',t:'Last 30 days'}].forEach(o=>{const opt=document.createElement('option');opt.value=o.v;opt.textContent=o.t;if(o.v===st.tr)opt.selected=true;sel.appendChild(opt);});sel.onchange=()=>{st.tr=sel.value;loadAll();};const btn=mk('button','cv-ov-btn','\\u21bb Refresh');btn.onclick=loadAll;hdr.append(ttl,stEl,mk('span','','Time\\u00a0range:'),sel,btn);root.appendChild(hdr);const sumSec=mk('div','cv-ov-sec');sumSec.appendChild(mk('div','cv-ov-stitle','Framework Summary'));const sumEl=mk('div');sumEl.innerHTML='<div class="cv-ov-load">Loading\\u2026</div>';sumSec.appendChild(sumEl);root.appendChild(sumSec);const tblSec=mk('div','cv-ov-sec');tblSec.appendChild(mk('div','cv-ov-stitle','Compliance Requirements Detail'));const fbar=mk('div','cv-ov-fbar');fbar.appendChild(mk('span','','Show frameworks: '));FW.forEach(f=>{const lbl=document.createElement('label');lbl.style.cssText='display:flex;align-items:center;gap:3px;cursor:pointer;';const cb=document.createElement('input');cb.type='checkbox';cb.checked=true;cb.onchange=()=>{vis[f.k]=cb.checked;renderTable(tblEl);};const sp=mk('span','',f.l);sp.style.color=f.c;sp.style.fontSize='11px';lbl.append(cb,sp);fbar.appendChild(lbl);});tblSec.appendChild(fbar);const tblEl=mk('div');tblEl.innerHTML='<div class="cv-ov-load">Loading\\u2026</div>';tblSec.appendChild(tblEl);root.appendChild(tblSec);const ovlSec=mk('div','cv-ov-sec');ovlSec.appendChild(mk('div','cv-ov-stitle','Cross-Framework Alert Overlap'));const ovlEl=mk('div');ovlEl.innerHTML='<div class="cv-ov-load">Loading\\u2026</div>';ovlSec.appendChild(ovlEl);root.appendChild(ovlSec);function renderCards(){sumEl.innerHTML='';if(!st.sum){sumEl.innerHTML='<div class="cv-ov-load">Loading\\u2026</div>';return;}const cards=mk('div','cv-ov-cards');const fws=st.sum.frameworks||{};FW.forEach(f=>{const cnt=(fws[f.k]&&fws[f.k].count)||0;const card=mk('div','cv-ov-card');card.style.borderLeftColor=f.c;const lbl=mk('div','cv-ov-clbl',f.l);lbl.style.color=f.c;const cntEl=mk('div','cv-ov-ccnt',String(cnt));const stEl2=mk('div','cv-ov-cst '+sc(cnt),sl(cnt));card.append(lbl,cntEl,stEl2);card.onclick=()=>tblSec.scrollIntoView({behavior:'smooth'});cards.appendChild(card);});sumEl.appendChild(cards);}function renderTable(container){container.innerHTML='';const rows=[];FW.forEach(f=>{if(!vis[f.k])return;(st.det[f.k]||[]).forEach(s=>{rows.push({fk:f.k,fl:f.l,fc:f.c,sec:s.key,desc:s.description||'',cnt:s.count||0,sev:s.severity||{},la:s.last_alert||null});});});if(!rows.length){container.innerHTML='<div class="cv-ov-empty">No violations in this time range.</div>';return;}rows.sort((a,b)=>{let av,bv;if(st.sc==='count'){av=a.cnt;bv=b.cnt;}else if(st.sc==='fw'){av=a.fl;bv=b.fl;}else if(st.sc==='sec'){av=a.sec;bv=b.sec;}else if(st.sc==='la'){av=a.la||'';bv=b.la||'';}else{av=a.cnt;bv=b.cnt;}if(av<bv)return st.sd==='asc'?-1:1;if(av>bv)return st.sd==='asc'?1:-1;return 0;});const cols=[{k:'fw',l:'Framework'},{k:'sec',l:'Section'},{k:'desc',l:'Description',ns:true},{k:'count',l:'Alerts'},{k:'sev',l:'Severity',ns:true},{k:'la',l:'Last Alert'}];const tbl=mk('table','cv-ov-tbl');const thead=mk('thead');const hr=mk('tr');cols.forEach(col=>{const th=mk('th','',col.l+(col.ns?'':' '+(st.sc===col.k?(st.sd==='asc'?'\\u25b2':'\\u25bc'):'\\u21c5')));if(st.sc===col.k&&!col.ns)th.style.color='#4fc3f7';if(!col.ns)th.onclick=()=>{if(st.sc===col.k)st.sd=st.sd==='asc'?'desc':'asc';else{st.sc=col.k;st.sd='desc';}renderTable(container);};hr.appendChild(th);});thead.appendChild(hr);tbl.appendChild(thead);const tbody=mk('tbody');rows.forEach(row=>{const tr=mk('tr');const ftd=mk('td');const bdg=mk('span','cv-ov-badge',row.fl);bdg.style.background=row.fc+'22';bdg.style.color=row.fc;ftd.appendChild(bdg);tr.appendChild(ftd);tr.appendChild(mk('td','',row.sec));const dtd=mk('td','',row.desc);dtd.style.cssText='color:#aaa;font-size:11px;max-width:260px;';tr.appendChild(dtd);const ctd=mk('td','',String(row.cnt));ctd.style.fontWeight='600';if(row.cnt>=TY)ctd.style.color='#e7664c';else if(row.cnt>=TG)ctd.style.color='#f0b400';tr.appendChild(ctd);const stdb=mk('td');const sb=mk('div');sb.style.cssText='display:flex;gap:3px;align-items:center;';SEVS.forEach(sv=>{const n=(row.sev&&row.sev[sv])||0;if(!n)return;const dot=mk('span');dot.title=sv+': '+n;dot.style.cssText='width:9px;height:9px;border-radius:2px;background:'+SEVC[sv]+';display:inline-block;';const lbl=mk('span','',String(n));lbl.style.cssText='font-size:10px;color:#aaa;';sb.append(dot,lbl);});if(!sb.children.length)sb.innerHTML='<span style="color:#555;font-size:10px">\\u2014</span>';stdb.appendChild(sb);tr.appendChild(stdb);const latd=mk('td','',ft(row.la));latd.style.cssText='font-size:10px;color:#aaa;white-space:nowrap;';tr.appendChild(latd);tbody.appendChild(tr);});tbl.appendChild(tbody);const wrap=mk('div','cv-ov-twrap');wrap.appendChild(tbl);container.appendChild(wrap);}function renderOverlap(){ovlEl.innerHTML='';if(!st.ovl){ovlEl.innerHTML='<div class="cv-ov-load">Loading\\u2026</div>';return;}const mx=st.ovl.matrix||{};const keys=st.ovl.frameworks||FW.map(f=>f.k);let maxV=0;keys.forEach(rk=>keys.forEach(ck=>{if(rk!==ck&&mx[rk]&&mx[rk][ck]>maxV)maxV=mx[rk][ck];}));const tbl=mk('table','cv-ov-mx');const thead=mk('thead');const hr=mk('tr');hr.appendChild(mk('th','','\\u2193 / \\u2192'));keys.forEach(k=>{const f=fwm(k);const th=mk('th','',f.l);th.style.color=f.c;hr.appendChild(th);});thead.appendChild(hr);tbl.appendChild(thead);const tbody=mk('tbody');keys.forEach(rk=>{const f=fwm(rk);const tr=mk('tr');const rl=mk('td','rl',f.l);rl.style.color=f.c;tr.appendChild(rl);keys.forEach(ck=>{const td=mk('td');if(rk===ck){td.className='dg';td.textContent=(mx[rk]&&mx[rk][rk]!=null)?String(mx[rk][rk]):'\\u2014';}else{const v=(mx[rk]&&mx[rk][ck])||0;td.textContent=String(v);td.style.background=hc(v,maxV);td.style.color=v?'#fff':'#444';td.title=fwm(rk).l+' \\u2229 '+fwm(ck).l+': '+v;}tr.appendChild(td);});tbody.appendChild(tr);});tbl.appendChild(tbody);const lg=mk('p','','Diagonal = total alerts per framework. Off-diagonal = alerts that triggered both frameworks simultaneously.');lg.style.cssText='font-size:10px;color:#666;margin:8px 0 0 0;';ovlEl.append(tbl,lg);}function loadAll(){btn.disabled=true;stEl.textContent='Loading\\u2026';sumEl.innerHTML='<div class="cv-ov-load">Loading\\u2026</div>';tblEl.innerHTML='<div class="cv-ov-load">Loading\\u2026</div>';ovlEl.innerHTML='<div class="cv-ov-load">Loading\\u2026</div>';st.det={};const tr=st.tr;const sp=fetchJ(API+'/summary?time_range='+tr).then(d=>{st.sum=d;renderCards();}).catch(e=>{sumEl.innerHTML='<div class="cv-ov-err">Error: '+e.message+'</div>';});const dp=FW.map(f=>fetchJ(API+'/details?framework='+f.k+'&time_range='+tr).then(d=>{st.det[f.k]=d.sections||[];}).catch(()=>{st.det[f.k]=[];}));const op=fetchJ(API+'/overlap?time_range='+tr).then(d=>{st.ovl=d;renderOverlap();}).catch(e=>{ovlEl.innerHTML='<div class="cv-ov-err">Error: '+e.message+'</div>';});Promise.all([sp,...dp]).then(()=>{renderTable(tblEl);btn.disabled=false;stEl.textContent='Updated: '+new Date().toLocaleTimeString();});}loadAll();return()=>{window.removeEventListener('fyp-theme-changed',_onTheme);rootEl.innerHTML='';const s=document.getElementById(SID);if(s)s.remove();};}class ComplianceOverviewPanel extends external_osdSharedDeps_React_default.a.Component{componentDidMount(){if(this.el)this._u=mountComplianceOverview(this.el);}componentWillUnmount(){if(this._u)this._u();}render(){return external_osdSharedDeps_React_default.a.createElement("div",{ref:el=>{this.el=el;},style:{width:"100%",minHeight:"calc(100vh - 140px)",overflow:"auto",background:"transparent"}});}}"""
)

GITHUB_DS_NEW = (
    GITHUB_DS_END + MOUNT_FN
    + 'const PECA_GROUP_KEY="rule.groups";const PECA_GROUP_VALUE="peca";'
    + 'class peca_data_source_PECADataSource extends alerts_data_source_AlertsDataSource{'
    + 'constructor(id,title){super(id,title)}'
    + 'getRuleGroupsFilter(){return super.getRuleGroupsFilter(PECA_GROUP_KEY,PECA_GROUP_VALUE,constants["p"])}'
    + 'getFixedFilters(){return[...super.getFixedFiltersClusterManager(),...this.getRuleGroupsFilter(),...super.getFixedFilters()]}}'
)
# Idempotency marker for the GITHUB_DS injection (cannot use `new in content`
# because GITHUB_DS_END is a prefix of GITHUB_DS_NEW).
GITHUB_DS_MARKER = 'mountComplianceOverview'

# ── 10. Light-theme upgrade for already-patched installed bundle ───────────────
# Anchors on the old dark CSS and the old loadAll/return sequence in the
# already-installed bundle.  Skipped on fresh installs (marker absent there too,
# but old anchor also absent — apply_patch_marker returns 'missing', not an error).
P10_CSS_OLD = (
    "s.textContent='.cv-ov{padding:16px 20px;background:#0d0d1a;min-height:100%;"
    'color:#eee;font-family:"Inter","Helvetica Neue",sans-serif;box-sizing:border-box}'
)
P10_CSS_NEW = (
    "s.textContent='.cv-ov{padding:16px 20px;background:#f8fafc;min-height:100%;"
    'color:#1a202c;font-family:"Inter","Helvetica Neue",sans-serif;box-sizing:border-box}'
)
P10_CSS_MARKER = 'background:#f8fafc;min-height:100%;color:#1a202c'

P10_THEME_OLD = "loadAll();return()=>{rootEl.innerHTML='';"
P10_THEME_NEW = (
    "try{if(localStorage.getItem('fyp_theme_v2')==='dark')root.classList.add('dark-theme');}catch(_){}"
    "function _onTheme(e){try{var t=e&&e.detail&&e.detail.theme;"
    "if(t==='dark')root.classList.add('dark-theme');else root.classList.remove('dark-theme');}catch(_){}}"
    "window.addEventListener('fyp-theme-changed',_onTheme);"
    "loadAll();return()=>{window.removeEventListener('fyp-theme-changed',_onTheme);rootEl.innerHTML='';"
)
P10_THEME_MARKER = 'fyp-theme-changed'

# ── 5. Column definitions ─────────────────────────────────────────────────────
COLS_OLD = (
    'const tscColumns=[commonColumns.timestamp,commonColumns["agent.name"],'
    '{id:"rule.tsc",initialWidth:283},commonColumns["rule.description"],'
    'commonColumns["rule.level"],commonColumns["rule.id"]];const githubColumns='
)
COLS_NEW = (
    'const tscColumns=[commonColumns.timestamp,commonColumns["agent.name"],'
    '{id:"rule.tsc",initialWidth:283},commonColumns["rule.description"],'
    'commonColumns["rule.level"],commonColumns["rule.id"]];'
    'const pecaColumns=[commonColumns.timestamp,commonColumns["agent.name"],'
    '{id:"rule.groups",initialWidth:220},commonColumns["rule.description"],'
    'commonColumns["rule.level"],commonColumns["rule.id"]];const githubColumns='
)

# ── 6. Module tabs ────────────────────────────────────────────────────────────
TABS_OLD = (
    ',tsc:{init:"dashboard",tabs:[{id:"dashboard",name:"Dashboard",'
    'buttons:[ButtonExploreAgent,ButtonModuleGenerateReport],component:DashboardTSC},'
    '{id:"inventory",name:"Controls",buttons:[ButtonExploreAgent],'
    'component:props=>external_osdSharedDeps_React_default.a.createElement(ComplianceTable,'
    'modules_defaults_extends({},props,{DataSource:tsc_data_souce_TSCDataSource}))},'
    'renderDiscoverTab({moduleId:"tsc",tableColumns:tscColumns,'
    'DataSource:tsc_data_souce_TSCDataSource,categoriesSampleData:[constants["ac"]]'
    '})],availableFor:["manager","agent"]},"it-hygiene":'
)
TABS_NEW = (
    ',tsc:{init:"dashboard",tabs:[{id:"dashboard",name:"Dashboard",'
    'buttons:[ButtonExploreAgent,ButtonModuleGenerateReport],component:DashboardTSC},'
    '{id:"inventory",name:"Controls",buttons:[ButtonExploreAgent],'
    'component:props=>external_osdSharedDeps_React_default.a.createElement(ComplianceTable,'
    'modules_defaults_extends({},props,{DataSource:tsc_data_souce_TSCDataSource}))},'
    'renderDiscoverTab({moduleId:"tsc",tableColumns:tscColumns,'
    'DataSource:tsc_data_souce_TSCDataSource,categoriesSampleData:[constants["ac"]]'
    '})],availableFor:["manager","agent"]},'
    'peca:{init:"events",tabs:[renderDiscoverTab({moduleId:"peca",tableColumns:pecaColumns,'
    'DataSource:peca_data_source_PECADataSource,categoriesSampleData:[]'
    '})],availableFor:["manager","agent"]},'
    '"compliance-overview":{init:"dashboard",tabs:[{id:"dashboard",name:"Dashboard",'
    'buttons:[],component:ComplianceOverviewPanel}],availableFor:["manager","agent"]},'
    '"it-hygiene":'
)


def patch_chunk2():
    print('=== Patching wazuh.chunk.2.js ===')
    with open(CHUNK2, 'r', encoding='utf-8') as f:
        c = f.read()

    c, _ = apply_patch(c, CATALOG_OLD, CATALOG_NEW, 'catalog map (PECA + Compliance Overview)')
    c, _ = apply_patch(c, AGENTS_OLD, AGENTS_NEW, 'agent tab counts')
    c, _ = apply_patch(c, OVERVIEW_OLD, OVERVIEW_NEW, 'overview tab counts')
    c, _ = apply_patch_marker(c, GITHUB_DS_END, GITHUB_DS_NEW, GITHUB_DS_MARKER,
                               'mountComplianceOverview + ComplianceOverviewPanel + PECADataSource')
    c, _ = apply_patch(c, COLS_OLD, COLS_NEW, 'pecaColumns definition')
    c, _ = apply_patch(c, TABS_OLD, TABS_NEW, 'module tabs (peca + compliance-overview)')

    # Step 10: upgrade already-patched bundle to light theme + theme-aware JS.
    # These anchors only exist in bundles where patch 4 already ran; on a fresh
    # install patch 4 injects the updated MOUNT_FN directly, so these are no-ops.
    c, _ = apply_patch_marker(c, P10_CSS_OLD, P10_CSS_NEW, P10_CSS_MARKER,
                               'cv-ov: light-theme CSS default (upgrade existing patch)')
    c, _ = apply_patch_marker(c, P10_THEME_OLD, P10_THEME_NEW, P10_THEME_MARKER,
                               'cv-ov: theme init + fyp-theme-changed listener (upgrade existing patch)')

    with open(CHUNK2, 'w', encoding='utf-8') as f:
        f.write(c)
    print('chunk.2.js written.\n')


# ══════════════════════════════════════════════════════════════════════════════
# PLUGIN.JS PATCHES
# ══════════════════════════════════════════════════════════════════════════════

# ── 7a. peca app definition (order:406) ───────────────────────────────────────
# Mirrors the TSC entry (order:405) exactly — same redirectTo pattern, same
# showInOverviewApp/showInAgentMenu flags, points to tab=peca.
# This was the missing piece: patch_peca_dashboard.py only patched chunk.2.js
# (dashboard content) but never added the sidebar navigation entry here.
PECA_APP = (
    'const peca={'
    'category:"wz-category-security-operations",'
    'id:"peca",'
    'title:_osd_i18n__WEBPACK_IMPORTED_MODULE_0__["i18n"].translate('
        '"wz-app-peca-title",{defaultMessage:"PECA"}),'
    'breadcrumbLabel:_osd_i18n__WEBPACK_IMPORTED_MODULE_0__["i18n"].translate('
        '"wz-app-peca-breadcrumbLabel",{defaultMessage:"PECA"}),'
    'description:_osd_i18n__WEBPACK_IMPORTED_MODULE_0__["i18n"].translate('
        '"wz-app-peca-description",'
        '{defaultMessage:"Prevention of Electronic Crimes Act 2016 — '
        "Pakistan's cybercrime law covering unauthorized access, data theft, "
        'and cyber terrorism."}),'
    'euiIconType:"packetbeatApp",'
    'order:406,'
    'showInOverviewApp:true,'
    'showInAgentMenu:true,'
    'redirectTo:()=>{'
        'var _store$getState27,_store$getState28;'
        'return`/overview/?tab=peca&tabView=dashboard${'
            '(_store$getState27=_redux_store__WEBPACK_IMPORTED_MODULE_1__["a"].getState())'
            '!==null&&_store$getState27!==void 0&&'
            '(_store$getState27=_store$getState27.appStateReducers)'
            '!==null&&_store$getState27!==void 0&&'
            '(_store$getState27=_store$getState27.currentAgentData)'
            '!==null&&_store$getState27!==void 0&&'
            '_store$getState27.id'
            '?`&agentId=${'
                '(_store$getState28=_redux_store__WEBPACK_IMPORTED_MODULE_1__["a"].getState())'
                '===null||_store$getState28===void 0||'
                '(_store$getState28=_store$getState28.appStateReducers)'
                '===null||_store$getState28===void 0||'
                '(_store$getState28=_store$getState28.currentAgentData)'
                '===null||_store$getState28===void 0'
                '?void 0:_store$getState28.id'
            '}`:""}`}}'
    ';'
)
PECA_APP_MARKER = 'const peca='

# ── 7b. compliance_overview_app definition (order:407) ────────────────────────
CO_APP = (
    'const compliance_overview_app={'
    'category:"wz-category-security-operations",'
    'id:"compliance-overview",'
    'title:_osd_i18n__WEBPACK_IMPORTED_MODULE_0__["i18n"].translate('
        '"wz-app-compliance-overview-title",{defaultMessage:"Compliance Overview"}),'
    'breadcrumbLabel:_osd_i18n__WEBPACK_IMPORTED_MODULE_0__["i18n"].translate('
        '"wz-app-compliance-overview-breadcrumbLabel",{defaultMessage:"Compliance Overview"}),'
    'description:_osd_i18n__WEBPACK_IMPORTED_MODULE_0__["i18n"].translate('
        '"wz-app-compliance-overview-description",'
        '{defaultMessage:"Unified compliance dashboard comparing PCI DSS, HIPAA, GDPR, NIST 800-53, TSC, and PECA violations side-by-side."}),'
    'euiIconType:"visTable",'
    'order:400.5,'
    'showInOverviewApp:true,'
    'showInAgentMenu:false,'
    'redirectTo:()=>`/overview/?tab=compliance-overview&tabView=dashboard`};'
)
CO_APP_MARKER = 'compliance_overview_app'

# Anchor for inserting both app defs on a fresh install (end of TSC redirectTo,
# immediately before const docker= — verified unique in Wazuh 4.14.3 plugin.js).
FRESH_ANCHOR_OLD = '}`}};const docker='
FRESH_ANCHOR_NEW = '}`}};' + PECA_APP + CO_APP + 'const docker='


def patch_plugin():
    print('=== Patching wazuh.plugin.js ===')
    with open(PLUGIN, 'r', encoding='utf-8') as f:
        p = f.read()

    # ── Step 7a-pre: remove legacy peca_app (id:"peca") if present ───────────
    # An older session may have added `const peca_app={...,id:"peca",...}` using
    # different state vars (_store$getState99/100, tabView=events).  If both
    # peca_app and our new `const peca=` exist, OSD throws a duplicate-id error.
    # Remove peca_app constant and any apps-list reference to it.
    if 'const peca_app=' in p:
        try:
            idx_s = p.index('const peca_app=')
            idx_e = p.index('}};const peca=', idx_s) + len('}};')
            p = p[:idx_s] + p[idx_e:]
            print('  [OK]   removed legacy peca_app constant (duplicate id)')
        except ValueError:
            print('  [WARN] could not remove peca_app — boundary not found', file=sys.stderr)
    if ',peca_app,' in p:
        p = p.replace(',peca_app,', ',', 1)
        print('  [OK]   removed peca_app from apps list')
    elif ',peca_app]' in p:
        p = p.replace(',peca_app]', ']', 1)
        print('  [OK]   removed peca_app from apps list (end)')

    # ── Step 7a: peca app definition ──────────────────────────────────────────
    # Three cases:
    #   A. Fresh install (nothing patched yet): use FRESH_ANCHOR to add both
    #      peca and compliance_overview_app in one step.
    #   B. Old patch ran (compliance_overview_app present, peca absent):
    #      insert peca immediately before compliance_overview_app.
    #   C. Already fully patched (peca present): skip.
    if PECA_APP_MARKER in p:
        print(f'  [SKIP] already applied: peca app definition (order 406)')
    elif CO_APP_MARKER in p:
        # Case B: compliance_overview_app exists but peca doesn't — insert peca before it
        p, _ = apply_patch_marker(
            p,
            'const compliance_overview_app=',
            PECA_APP + 'const compliance_overview_app=',
            PECA_APP_MARKER,
            'peca app definition (order 406) — inserted before existing compliance_overview_app'
        )
    else:
        # Case A: fresh install — add both peca and compliance_overview_app before docker
        p, _ = apply_patch_marker(
            p, FRESH_ANCHOR_OLD, FRESH_ANCHOR_NEW, PECA_APP_MARKER,
            'peca + compliance_overview_app definitions (fresh install, order 406+407)'
        )

    # ── Step 7b: compliance_overview_app definition ───────────────────────────
    # On Case A it was already added by step 7a. On Case B it was already there.
    # This step handles any state where CO_APP_MARKER is still absent after 7a.
    if CO_APP_MARKER not in p:
        p, _ = apply_patch_marker(
            p, FRESH_ANCHOR_OLD, '}`}};' + CO_APP + 'const docker=', CO_APP_MARKER,
            'compliance_overview_app definition (order 407) — safety fallback'
        )
    else:
        print(f'  [SKIP] already applied: compliance_overview_app definition (order 407)')

    # ── Step 8: Apps list — peca ──────────────────────────────────────────────
    # The array is .sort()ed by order value so insertion position is cosmetic only.
    # Primary anchor: right after tsc (exists on all Wazuh 4.14.3 installs).
    # Fallback: before the sort call (catches any bundle variant where tsc,devTools
    # sequence differs).
    if ',peca,' in p:
        print(f'  [SKIP] already applied: peca in apps list')
    elif ',tsc,devTools,' in p:
        p, _ = apply_patch(p, ',tsc,devTools,', ',tsc,peca,devTools,',
                           'apps list: insert peca after tsc')
    else:
        p, _ = apply_patch(p, ',about,ITHygiene].sort(', ',about,ITHygiene,peca].sort(',
                           'apps list fallback: insert peca before sort')

    # ── Step 9: Apps list — compliance_overview_app ───────────────────────────
    if ',compliance_overview_app,' in p or ',compliance_overview_app]' in p:
        print(f'  [SKIP] already applied: compliance_overview_app in apps list')
    elif ',peca,devTools,' in p:
        p, _ = apply_patch(p, ',peca,devTools,', ',peca,compliance_overview_app,devTools,',
                           'apps list: insert compliance_overview_app after peca')
    else:
        p, _ = apply_patch(p, ',about,ITHygiene,peca].sort(',
                           ',about,ITHygiene,peca,compliance_overview_app].sort(',
                           'apps list fallback: insert compliance_overview_app after peca')

    # ── Step 11: compliance_overview_app order 407 → 400.5 ───────────────────
    # Moves the entry to appear after IT Hygiene (400) and before PCI DSS (401)
    # in both the sidebar and the Wazuh overview dashboard card grid.
    p, _ = apply_patch_marker(
        p,
        'id:"compliance-overview",'
        'title:_osd_i18n__WEBPACK_IMPORTED_MODULE_0__["i18n"].translate('
        '"wz-app-compliance-overview-title",{defaultMessage:"Compliance Overview"}),'
        'breadcrumbLabel:_osd_i18n__WEBPACK_IMPORTED_MODULE_0__["i18n"].translate('
        '"wz-app-compliance-overview-breadcrumbLabel",{defaultMessage:"Compliance Overview"}),'
        'description:_osd_i18n__WEBPACK_IMPORTED_MODULE_0__["i18n"].translate('
        '"wz-app-compliance-overview-description",'
        '{defaultMessage:"Unified compliance dashboard comparing PCI DSS, HIPAA, GDPR, NIST 800-53, TSC, and PECA violations side-by-side."}),'
        'euiIconType:"visTable",order:407,',

        'id:"compliance-overview",'
        'title:_osd_i18n__WEBPACK_IMPORTED_MODULE_0__["i18n"].translate('
        '"wz-app-compliance-overview-title",{defaultMessage:"Compliance Overview"}),'
        'breadcrumbLabel:_osd_i18n__WEBPACK_IMPORTED_MODULE_0__["i18n"].translate('
        '"wz-app-compliance-overview-breadcrumbLabel",{defaultMessage:"Compliance Overview"}),'
        'description:_osd_i18n__WEBPACK_IMPORTED_MODULE_0__["i18n"].translate('
        '"wz-app-compliance-overview-description",'
        '{defaultMessage:"Unified compliance dashboard comparing PCI DSS, HIPAA, GDPR, NIST 800-53, TSC, and PECA violations side-by-side."}),'
        'euiIconType:"visTable",order:400.5,',

        'euiIconType:"visTable",order:400.5,',
        'compliance_overview_app order: 407 → 400.5 (after IT Hygiene, before PCI DSS)'
    )

    with open(PLUGIN, 'w', encoding='utf-8') as f:
        f.write(p)
    print('plugin.js written.\n')


# ══════════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    errors = []

    try:
        patch_chunk2()
    except Exception as e:
        print(f'[ERROR] chunk.2.js patch failed: {e}', file=sys.stderr)
        errors.append('chunk.2.js')

    try:
        patch_plugin()
    except Exception as e:
        print(f'[ERROR] plugin.js patch failed: {e}', file=sys.stderr)
        errors.append('plugin.js')

    if errors:
        print(f'\nPatch FAILED for: {", ".join(errors)}', file=sys.stderr)
        sys.exit(1)

    print('All patches complete.')
