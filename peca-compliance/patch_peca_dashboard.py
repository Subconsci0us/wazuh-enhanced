#!/usr/bin/env python3
"""
Patch wazuh.chunk.2.js to add a Dashboard tab to the PECA compliance module.

Inserts:
  1. Five getVisState* functions for PECA charts
  2. peca_dashboard_getDashboardPanels (overview + agent layouts)
  3. DashboardPECAComponent (React component, mirrors DashboardGDPRComponent)
  4. DashboardPECA constant

Then updates the PECA module config:
  init:"events" → init:"dashboard"
  tabs: adds {id:"dashboard",...,component:DashboardPECA} before renderDiscoverTab
"""

import sys

BUNDLE = '/usr/share/wazuh-dashboard/plugins/wazuh/target/public/wazuh.chunk.2.js'

# ── Code to insert ─────────────────────────────────────────────────────────────
# Placed immediately before peca:{init:"events",...}
# All variables it references are already defined earlier in the bundle.

PECA_DASHBOARD_CODE = (
    # plugins + DashboardByRenderer (local var, same pattern as gdpr_dashboards_dashboard_plugins)
    'const peca_dashboard_plugins=Object(kibana_services["h"])();'
    'const peca_dashboard_DashboardByRenderer=peca_dashboard_plugins.dashboard.DashboardContainerByValueRenderer;'

    # helpers extend function (same boilerplate as gdpr_dashboards_dashboard_extends)
    'function peca_dashboard_extends(){return peca_dashboard_extends=Object.assign?Object.assign.bind():function(n){for(var e=1;e<arguments.length;e++){var t=arguments[e];for(var r in t)({}).hasOwnProperty.call(t,r)&&(n[r]=t[r])}return n},peca_dashboard_extends.apply(null,arguments)}'

    # ── vis 1: Alerts over time (line chart) ─────────────────────────────────
    'const getVSPecaAlertsOverTime=indexPatternId=>({'
        'id:"Wazuh-App-Overview-PECA-Alerts-Over-Time",'
        'title:"PECA alerts over time",'
        'type:"line",'
        'params:{'
            'type:"line",'
            'grid:{categoryLines:false},'
            'categoryAxes:[{id:"CategoryAxis-1",type:"category",position:"bottom",show:true,style:{},scale:{type:"linear"},labels:{show:true,filter:true,truncate:100},title:{}}],'
            'valueAxes:[{id:"ValueAxis-1",name:"LeftAxis-1",type:"value",position:"left",show:true,style:{},scale:{type:"linear",mode:"normal"},labels:{show:true,rotate:0,filter:false,truncate:100},title:{text:"Alert count"}}],'
            'seriesParams:[{show:true,type:"line",mode:"normal",data:{label:"Alert count",id:"1"},valueAxis:"ValueAxis-1",drawLinesBetweenPoints:true,lineWidth:2,interpolate:"linear",showCircles:true}],'
            'addTooltip:true,addLegend:true,legendPosition:"right",times:[],addTimeMarker:false,'
            'thresholdLine:{show:false,value:10,width:1,style:"full",color:"#E7664C"}'
        '},'
        'uiState:{},'
        'data:{searchSource:{query:{language:"kuery",query:""},filter:[],index:indexPatternId},'
            'references:[{name:"kibanaSavedObjectMeta.searchSourceJSON.index",type:"index-pattern",id:indexPatternId}],'
            'aggs:['
                '{id:"1",enabled:true,type:"count",schema:"metric",params:{}},'
                '{id:"2",enabled:true,type:"date_histogram",schema:"segment",params:{field:"timestamp",useNormalizedEsInterval:true,interval:"auto",drop_partials:false,min_doc_count:1,extended_bounds:{}}}'
            ']}'
    '});'

    # ── vis 2: Alerts by PECA section (horizontal bar, filters agg) ──────────
    'const getVSPecaBySection=indexPatternId=>({'
        'id:"Wazuh-App-Overview-PECA-By-Section",'
        'title:"PECA alerts by section",'
        'type:"histogram",'
        'params:{'
            'type:"histogram",'
            'grid:{categoryLines:false},'
            'categoryAxes:[{id:"CategoryAxis-1",type:"category",position:"left",show:true,style:{},scale:{type:"linear"},labels:{show:true,filter:false,truncate:200},title:{}}],'
            'valueAxes:[{id:"ValueAxis-1",name:"LeftAxis-1",type:"value",position:"bottom",show:true,style:{},scale:{type:"linear",mode:"normal"},labels:{show:true,rotate:0,filter:true,truncate:100},title:{text:"Alert count"}}],'
            'seriesParams:[{show:true,type:"histogram",mode:"normal",data:{label:"Alert count",id:"1"},valueAxis:"ValueAxis-1"}],'
            'addTooltip:true,addLegend:false,legendPosition:"right",times:[],addTimeMarker:false,'
            'labels:{show:false},'
            'thresholdLine:{show:false,value:10,width:1,style:"full",color:"#E7664C"}'
        '},'
        'uiState:{},'
        'data:{searchSource:{query:{language:"kuery",query:""},filter:[],index:indexPatternId},'
            'references:[{name:"kibanaSavedObjectMeta.searchSourceJSON.index",type:"index-pattern",id:indexPatternId}],'
            'aggs:['
                '{id:"1",enabled:true,type:"count",schema:"metric",params:{}},'
                '{id:"2",enabled:true,type:"filters",schema:"segment",params:{filters:['
                    '{input:{query:"rule.groups: peca_3",language:"lucene"},label:"Sec 3 - Unauthorized Access"},'
                    '{input:{query:"rule.groups: peca_4",language:"lucene"},label:"Sec 4 - Data Copying"},'
                    '{input:{query:"rule.groups: peca_5",language:"lucene"},label:"Sec 5 - Interference"},'
                    '{input:{query:"rule.groups: peca_6",language:"lucene"},label:"Sec 6 - Critical Infrastructure"},'
                    '{input:{query:"rule.groups: peca_8",language:"lucene"},label:"Sec 8 - Interception"},'
                    '{input:{query:"rule.groups: peca_11",language:"lucene"},label:"Sec 11 - Forgery"},'
                    '{input:{query:"rule.groups: peca_20",language:"lucene"},label:"Sec 20 - Malicious Code"},'
                    '{input:{query:"rule.groups: peca_21",language:"lucene"},label:"Sec 21 - Cyber Terrorism"},'
                    '{input:{query:"rule.groups: peca_36",language:"lucene"},label:"Sec 36 - Data Protection"},'
                    '{input:{query:"rule.groups: peca_37",language:"lucene"},label:"Sec 37 - Data Retention"}'
                ']}}'
            ']}'
    '});'

    # ── vis 3: Alerts by severity level (donut) ───────────────────────────────
    'const getVSPecaByLevel=indexPatternId=>({'
        'id:"Wazuh-App-Overview-PECA-By-Level",'
        'title:"PECA alerts by severity",'
        'type:"pie",'
        'params:{type:"pie",addTooltip:true,addLegend:true,legendPosition:"right",isDonut:true},'
        'uiState:{},'
        'data:{searchSource:{query:{language:"kuery",query:""},filter:[],index:indexPatternId},'
            'references:[{name:"kibanaSavedObjectMeta.searchSourceJSON.index",type:"index-pattern",id:indexPatternId}],'
            'aggs:['
                '{id:"1",enabled:true,type:"count",schema:"metric",params:{}},'
                '{id:"2",enabled:true,type:"terms",schema:"segment",params:{field:"rule.level",size:10,order:"desc",orderBy:"1"}}'
            ']}'
    '});'

    # ── vis 4: Top rules (bar chart, terms on rule.id) ────────────────────────
    'const getVSPecaTopRules=indexPatternId=>({'
        'id:"Wazuh-App-Overview-PECA-Top-Rules",'
        'title:"PECA top rules",'
        'type:"histogram",'
        'params:{'
            'type:"histogram",'
            'grid:{categoryLines:false},'
            'categoryAxes:[{id:"CategoryAxis-1",type:"category",position:"bottom",show:true,style:{},scale:{type:"linear"},labels:{show:true,filter:true,truncate:100},title:{}}],'
            'valueAxes:[{id:"ValueAxis-1",name:"LeftAxis-1",type:"value",position:"left",show:true,style:{},scale:{type:"linear",mode:"normal"},labels:{show:true,rotate:0,filter:false,truncate:100},title:{text:"Alert count"}}],'
            'seriesParams:[{show:true,type:"histogram",mode:"normal",data:{label:"Alert count",id:"1"},valueAxis:"ValueAxis-1"}],'
            'addTooltip:true,addLegend:false,legendPosition:"right",times:[],addTimeMarker:false,'
            'labels:{show:false},'
            'thresholdLine:{show:false,value:10,width:1,style:"full",color:"#E7664C"}'
        '},'
        'uiState:{},'
        'data:{searchSource:{query:{language:"kuery",query:""},filter:[],index:indexPatternId},'
            'references:[{name:"kibanaSavedObjectMeta.searchSourceJSON.index",type:"index-pattern",id:indexPatternId}],'
            'aggs:['
                '{id:"1",enabled:true,type:"count",schema:"metric",params:{}},'
                '{id:"2",enabled:true,type:"terms",schema:"segment",params:{field:"rule.id",size:10,order:"desc",orderBy:"1"}}'
            ']}'
    '});'

    # ── vis 5: Alerts by agent (pie) ──────────────────────────────────────────
    'const getVSPecaByAgent=indexPatternId=>({'
        'id:"Wazuh-App-Overview-PECA-By-Agent",'
        'title:"PECA alerts by agent",'
        'type:"pie",'
        'params:{type:"pie",addTooltip:true,addLegend:true,legendPosition:"right",isDonut:true},'
        'uiState:{},'
        'data:{searchSource:{query:{language:"kuery",query:""},filter:[],index:indexPatternId},'
            'references:[{name:"kibanaSavedObjectMeta.searchSourceJSON.index",type:"index-pattern",id:indexPatternId}],'
            'aggs:['
                '{id:"1",enabled:true,type:"count",schema:"metric",params:{}},'
                '{id:"2",enabled:true,type:"terms",schema:"segment",params:{field:"agent.name",size:10,order:"desc",orderBy:"1"}}'
            ']}'
    '});'

    # ── getDashboardPanels (overview + per-agent layouts) ─────────────────────
    'const peca_dashboard_getDashboardPanels=(indexPatternId,isPinnedAgent)=>{'
        'const overviewDashboard={'
            'p1:{gridData:{w:48,h:12,x:0,y:0,i:"p1"},type:"visualization",explicitInput:{id:"p1",savedVis:getVSPecaAlertsOverTime(indexPatternId)}},'
            'p2:{gridData:{w:24,h:15,x:0,y:12,i:"p2"},type:"visualization",explicitInput:{id:"p2",savedVis:getVSPecaBySection(indexPatternId)}},'
            'p3:{gridData:{w:24,h:15,x:24,y:12,i:"p3"},type:"visualization",explicitInput:{id:"p3",savedVis:getVSPecaByLevel(indexPatternId)}},'
            'p4:{gridData:{w:32,h:12,x:0,y:27,i:"p4"},type:"visualization",explicitInput:{id:"p4",savedVis:getVSPecaTopRules(indexPatternId)}},'
            'p5:{gridData:{w:16,h:12,x:32,y:27,i:"p5"},type:"visualization",explicitInput:{id:"p5",savedVis:getVSPecaByAgent(indexPatternId)}}'
        '};'
        'const agentDashboard={'
            'a1:{gridData:{w:24,h:12,x:0,y:0,i:"a1"},type:"visualization",explicitInput:{id:"a1",savedVis:getVSPecaTopRules(indexPatternId)}},'
            'a2:{gridData:{w:24,h:12,x:24,y:0,i:"a2"},type:"visualization",explicitInput:{id:"a2",savedVis:getVSPecaByLevel(indexPatternId)}},'
            'a3:{gridData:{w:48,h:12,x:0,y:12,i:"a3"},type:"visualization",explicitInput:{id:"a3",savedVis:getVSPecaAlertsOverTime(indexPatternId)}}'
        '};'
        'return isPinnedAgent?agentDashboard:overviewDashboard'
    '};'

    # ── DashboardPECAComponent (mirrors DashboardGDPRComponent exactly) ───────
    'const DashboardPECAComponent=()=>{'
        'var _results$hits$total,_results$hits,_results$hits2,_results$hits3,_dataSource$getPinned;'
        'const AlertsRepository=new alerts_data_source_repository_AlertsDataSourceRepository;'
        'const{filters:filters,dataSource:dataSource,fetchFilters:fetchFilters,fixedFilters:fixedFilters,isLoading:isDataSourceLoading,fetchData:fetchData,setFilters:setFilters}=useDataSource({DataSource:peca_data_source_PECADataSource,repository:AlertsRepository});'
        'const[results,setResults]=Object(external_osdSharedDeps_React_["useState"])({});'
        'const{searchBarProps:searchBarProps,fingerprint:fingerprint,autoRefreshFingerprint:autoRefreshFingerprint}=use_search_bar({indexPattern:dataSource===null||dataSource===void 0?void 0:dataSource.indexPattern,filters:filters,setFilters:setFilters});'
        'const{query:query,dateRangeFrom:dateRangeFrom,dateRangeTo:dateRangeTo}=searchBarProps;'
        'useReportingCommunicateSearchContext({isSearching:isDataSourceLoading,totalResults:(_results$hits$total=results===null||results===void 0||(_results$hits=results.hits)===null||_results$hits===void 0?void 0:_results$hits.total)!==null&&_results$hits$total!==void 0?_results$hits$total:0,indexPattern:dataSource===null||dataSource===void 0?void 0:dataSource.indexPattern,filters:fetchFilters,query:query,time:{from:dateRangeFrom,to:dateRangeTo}});'
        'Object(external_osdSharedDeps_React_["useEffect"])(()=>{'
            'if(isDataSourceLoading){return}'
            'fetchData({query:query,dateRange:{from:dateRangeFrom,to:dateRangeTo}}).then(results=>{setResults(results)}).catch(error=>{'
                'const searchError=ErrorFactory.create(HttpError_HttpError,{error:error,message:"Error fetching data"});'
                'error_handler_error_handler_ErrorHandler.handleError(searchError)'
            '})'
        '},[JSON.stringify(fetchFilters),JSON.stringify(query),dateRangeFrom,dateRangeTo,fingerprint,autoRefreshFingerprint]);'
        'return external_osdSharedDeps_React_default.a.createElement(external_osdSharedDeps_React_default.a.Fragment,null,'
            'external_osdSharedDeps_React_default.a.createElement(external_osdSharedDeps_OsdI18nReact_["I18nProvider"],null,'
                'isDataSourceLoading&&!dataSource?external_osdSharedDeps_React_default.a.createElement(LoadingSearchbarProgress,null):'
                'external_osdSharedDeps_React_default.a.createElement(external_osdSharedDeps_React_default.a.Fragment,null,'
                    'external_osdSharedDeps_React_default.a.createElement(WzSearchBar,peca_dashboard_extends({appName:"peca-searchbar"},searchBarProps,{fixedFilters:fixedFilters,showDatePicker:true,showQueryInput:true,showQueryBar:true})),'
                    'dataSource&&(results===null||results===void 0||(_results$hits2=results.hits)===null||_results$hits2===void 0?void 0:_results$hits2.total)===0?external_osdSharedDeps_React_default.a.createElement(DiscoverNoResults,null):null,'
                    'external_osdSharedDeps_React_default.a.createElement("div",{className:dataSource&&(results===null||results===void 0||(_results$hits3=results.hits)===null||_results$hits3===void 0?void 0:_results$hits3.total)>0?"":"wz-no-display"},'
                        'external_osdSharedDeps_React_default.a.createElement(SampleDataWarning,{categoriesSampleData:[]}),'
                        'external_osdSharedDeps_React_default.a.createElement("div",{className:"peca-dashboard-responsive"},'
                            'external_osdSharedDeps_React_default.a.createElement(peca_dashboard_DashboardByRenderer,{input:{viewMode:ViewMode.VIEW,'
                                'panels:peca_dashboard_getDashboardPanels(AlertsRepository.getStoreIndexPatternId(),Boolean(dataSource===null||dataSource===void 0||(_dataSource$getPinned=dataSource.getPinnedAgentFilter())===null||_dataSource$getPinned===void 0?void 0:_dataSource$getPinned.length)),'
                                'isFullScreenMode:false,filters:fetchFilters!==null&&fetchFilters!==void 0?fetchFilters:[],useMargins:true,id:"peca-dashboard-tab",'
                                'timeRange:{from:dateRangeFrom,to:dateRangeTo},title:"PECA dashboard",description:"Dashboard of the PECA",'
                                'query:searchBarProps.query,refreshConfig:{pause:false,value:15},hidePanelTitles:false,lastReloadRequestTime:fingerprint'
                            '}})'
                        ')'
                    ')'
                ')'
            ')'
        ')'
    '};'
    'const DashboardPECA=Object(redux["compose"])(withErrorBoundary)(DashboardPECAComponent);'
)

# ── Read bundle ───────────────────────────────────────────────────────────────
with open(BUNDLE, 'r') as f:
    content = f.read()

# ── Apply edits ────────────────────────────────────────────────────────────────

OLD_MODULE = (
    'peca:{init:"events",'
    'tabs:[renderDiscoverTab({moduleId:"peca",tableColumns:pecaColumns,DataSource:peca_data_source_PECADataSource,categoriesSampleData:[]})],'
    'availableFor:["manager","agent"]}'
)

NEW_MODULE = (
    'peca:{init:"dashboard",'
    'tabs:['
        '{id:"dashboard",name:"Dashboard",buttons:[ButtonExploreAgent,ButtonModuleGenerateReport],component:DashboardPECA},'
        'renderDiscoverTab({moduleId:"peca",tableColumns:pecaColumns,DataSource:peca_data_source_PECADataSource,categoriesSampleData:[]})'
    '],'
    'availableFor:["manager","agent"]}'
)

# The full replacement: insert PECA dashboard code + update module config
OLD_FULL = OLD_MODULE
NEW_FULL = PECA_DASHBOARD_CODE + NEW_MODULE

assert content.count(OLD_FULL) == 1, f"Expected 1 match, got {content.count(OLD_FULL)}"

patched = content.replace(OLD_FULL, NEW_FULL, 1)

assert patched != content, "No change made!"
print(f"Original size: {len(content):,}")
print(f"Patched size:  {len(patched):,}")
print(f"Added:         {len(patched)-len(content):,} bytes")

with open(BUNDLE, 'w') as f:
    f.write(patched)

print("Bundle written successfully.")
