// Pinned publication contract. Structural/readback checks only; no model replay.
// Shared browser/server publication policy. Integrity checks do not certify wins.
import {FIFTY_VERSION,validateFiftyModules} from './fifty-policy.mjs';
export const REPORT_VERIFICATION_VERSION='539-full-history-report-verification-v3-20261015';
export const REPORT_VERIFICATION_CHECKS=Object.freeze([
 ['full_history_origin','全歷史起點完整性'],
 ['draw_schema','每期獎號結構核對'],
 ['date_period_calendar','全期日曆與期別連續性'],
 ['input_cutoff_target','全資料截止與下期目標核對'],
 ['primary_module_coverage','八項主模組全期覆蓋'],
 ['primary_numeric_conservation','主排序數值與權重守恆'],
 ['primary_recompute_match','主模組雙輪重算一致性'],
 ['candidate_module_coverage','六項候選模型全期覆蓋'],
 ['candidate_trace_conservation','候選逐期機率軌跡守恆'],
 ['candidate_recompute_match','候選雙輪重算一致性'],
 ['prior_only_selector_replay','先預測後評分選擇器重播'],
 ['single_formula_diagnostics','獨支算式與全期診斷重建'],
 ['decision_qualification_replay','三十九號資格決策重驗'],
 ['group_replay_consistency','原封存二三五七九碼來源重驗'],
 ['nine_objective_replay','九碼專用目標全期雙輪重播'],
 ['fifty_registry_complete','五十組固定算法配置完整性'],
 ['fifty_history_coverage','五十組全歷史逐期評分覆蓋'],
 ['fifty_numeric_conservation','五十組與融合逐期數值守恆'],
 ['fifty_double_recompute','五十組雙輪重算一致性'],
 ['fifty_fusion_targets','融合權重與指定五組目標重驗']
].map(([id,name])=>Object.freeze({id,name})));
export const REPORT_VERIFICATION_POLICY=Object.freeze({
 version:REPORT_VERIFICATION_VERSION,minimumPassed:10,requiredPassed:20,
 originDate:'2007-01-01',warmup:200,primaryPasses:2,candidatePasses:2,
 checks:Object.freeze(REPORT_VERIFICATION_CHECKS.map(c=>c.id)),
 primaryModuleNames:Object.freeze(['全期頻率','近期六十期','近期二百四十期','間隔條件','開獎星期','三階拖牌','連莊條件','均勻對照']),
 candidateModelIds:Object.freeze(['uniform','discount60','discount240','discount_calibrated','conditional','conditional_calibrated']),
 selectorVersion:'539-prior-only-expert-selection-v1-20261011',
 diagnosticsVersion:'539-research-diagnostics-v1-20261011',groupVersion:'539-research-ranking-groups-v1-20261012',
 nineVersion:'539-prior-only-nine-selection-v1-20261014',
 fiftyVersion:FIFTY_VERSION,fiftyModules:50,fiftyPasses:2,
 meaning:'運算完整性驗證，不代表必中或命中率保證'
});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const fail=message=>{throw new Error(message)};
function validateNine(n,b,inputHash){
 if(!n||n.version!==REPORT_VERIFICATION_POLICY.nineVersion||n.status!=='research_only'||n.inputHash!==inputHash||n.targetDate!==b.targetDate||n.targetPeriod!==b.targetPeriod||n.cutoffDate!==b.lastDate||n.cutoffPeriod!==b.cutoffPeriod||n.trainingDraws!==b.draws)fail('九碼專用報告來源、日期或版本不符');
 if(!Array.isArray(n.ranking)||n.ranking.length!==39||new Set(n.ranking.map(x=>x.number)).size!==39||n.ranking.some((x,i)=>!Number.isInteger(x.number)||x.number<1||x.number>39||x.rank!==i+1||!Number.isFinite(x.probability)||x.probability<0||x.probability>1||(i>0&&x.probability>n.ranking[i-1].probability))||Math.abs(n.ranking.reduce((s,x)=>s+x.probability,0)-5)>1e-7||!same(n.numbers,n.ranking.slice(0,9).map(x=>x.number)))fail('九碼必須為已核對模型的九個唯一最高研究分數號碼');
 const valid=s=>s&&Number.isSafeInteger(s.count)&&s.count>=0&&['histogram','bottomHistogram'].every(k=>Array.isArray(s[k])&&s[k].length===6&&s[k].every(x=>Number.isSafeInteger(x)&&x>=0)&&s[k].reduce((a,x)=>a+x,0)===s.count)&&s.totalHits===s.histogram.reduce((a,x,h)=>a+x*h,0)&&s.atLeast2===s.histogram.slice(2).reduce((a,x)=>a+x,0)&&s.atLeast3===s.histogram.slice(3).reduce((a,x)=>a+x,0)&&s.meanHits===(s.count?s.totalHits/s.count:null)&&s.atLeast2Rate===(s.count?s.atLeast2/s.count:null)&&s.atLeast3Rate===(s.count?s.atLeast3/s.count:null);
 const experts=n.modelSelection?.experts,keys=['atLeast3','atLeast2','totalHits'];
 if(!same(n.modelSelection?.objectives,keys)||!Array.isArray(experts)||!same(experts.map(x=>x.id),['discount60','discount240','conditional'])||experts.some(x=>!valid(x.backtest)||x.backtest.count!==b.draws-200)||!valid(n.backtest)||n.backtest.count!==b.draws-200||!valid(n.backtest.recent60)||n.backtest.recent60.count!==Math.min(60,b.draws-200)||!valid(n.backtest.recent240)||n.backtest.recent240.count!==Math.min(240,b.draws-200))fail('九碼全期、近六十與近二百四十期達標統計不完整');
 const best=experts.reduce((a,x,i)=>{for(const key of keys){if(x.backtest[key]!==experts[a].backtest[key])return x.backtest[key]>experts[a].backtest[key]?i:a}return a},0);
 if(n.modelId!==experts[best].id||n.modelSelection.selectedModelId!==n.modelId||!same(n.numbers,experts[best].numbers))fail('九碼未依九中三、九中二、總命中目標選模');
}
/** Structure/binding only. The cloud must also check the digest and rebuild the
 * report from its own official draws; caller-provided true flags are not proof. */
export function validateReportVerification(report,{primary,decision,groups}={}){
 const r=report,b=r?.dataBasis;
 if(!r||r.version!==REPORT_VERIFICATION_VERSION||!same(r.policy,REPORT_VERIFICATION_POLICY)||r.requiredCount!==REPORT_VERIFICATION_CHECKS.length||!Array.isArray(r.checks)||r.checks.length!==REPORT_VERIFICATION_CHECKS.length||!time(r.generatedAt))fail('全模組驗證版本、政策或項目不完整');
 REPORT_VERIFICATION_CHECKS.forEach((expected,i)=>{const actual=r.checks[i];if(actual?.id!==expected.id||actual?.name!==expected.name||typeof actual?.passed!=='boolean'||typeof actual?.detail!=='string'||!actual.detail||actual.detail.length>1000)fail('全模組驗證項目識別、順序或實算說明不符')});
 const passed=r.checks.filter(c=>c.passed).length;
 if(!Number.isSafeInteger(r.passedCount)||r.passedCount!==passed||r.status!==(passed===r.requiredCount?'passed':'failed'))fail('全模組驗證通過數或狀態不符');
 if(!b||!Number.isSafeInteger(b.draws)||b.draws<0||!r.coverage||!Number.isSafeInteger(r.coverage.primaryModules)||!Number.isSafeInteger(r.coverage.candidateModels)||!Number.isSafeInteger(r.coverage.fullHistoryReplayPeriods))fail('全模組驗證資料筆數或涵蓋範圍缺漏');
 if(!r.passes||Object.keys(r.passes).length!==8||Object.entries({primary:2,candidates:2,researchSelector:1,diagnostics:1,decision:1,groups:1,nine:2,fifty:2}).some(([key,max])=>!Number.isInteger(r.passes[key])||r.passes[key]<0||r.passes[key]>max))fail('全模組驗證重算輪次無效');
 if(r.status==='passed'&&(b.draws<=200||b.firstDate!==REPORT_VERIFICATION_POLICY.originDate||typeof b.lastDate!=='string'||!Number.isFinite(Date.parse(b.lastDate+'T00:00:00Z'))||!Number.isSafeInteger(b.cutoffPeriod)||!Number.isSafeInteger(b.targetPeriod)||typeof b.targetDate!=='string'||!Number.isFinite(Date.parse(b.targetDate+'T20:30:00+08:00'))))fail('全模組驗證歷史起點、筆數或目標缺漏');
 if(r.status==='passed'&&(r.coverage.primaryModules!==8||r.coverage.candidateModels!==6||r.coverage.fullHistoryReplayPeriods!==b.draws-REPORT_VERIFICATION_POLICY.warmup))fail('全模組驗證未涵蓋固定八項主模組與六項候選模型');
 if(r.status==='passed'&&(!same(r.coverage.primaryModuleNames,REPORT_VERIFICATION_POLICY.primaryModuleNames)||!same(r.coverage.candidateModelIds,REPORT_VERIFICATION_POLICY.candidateModelIds)||r.coverage.selectorVersion!==REPORT_VERIFICATION_POLICY.selectorVersion||r.coverage.diagnosticsVersion!==REPORT_VERIFICATION_POLICY.diagnosticsVersion||r.coverage.groupVersion!==REPORT_VERIFICATION_POLICY.groupVersion))fail('全模組驗證模組識別或版本不符');
 if(r.status==='passed'&&(r.passes.primary!==2||r.passes.candidates!==2||r.passes.researchSelector!==1||r.passes.diagnostics!==1||r.passes.decision!==1||r.passes.groups!==1||r.passes.nine!==2||r.passes.fifty!==2))fail('全模組驗證未完成要求的重算輪次');
 if(r.status==='passed')validateNine(r.nine,b,r.inputHash);
 if(r.status==='passed'){if(r.coverage.fiftyModules!==50||r.coverage.fiftyVersion!==FIFTY_VERSION)fail('五十組研究模組覆蓋或版本不符');validateFiftyModules(r.fifty,{dataBasis:b,inputHash:r.inputHash})}
 if(r.status==='passed'&&Date.parse(r.generatedAt)>=Date.parse(b.targetDate+'T20:30:00+08:00'))fail('全模組驗證完成時已到目標開獎時間');
 if(primary||decision||groups){
  if(!primary||!decision||!groups)fail('全模組驗證缺少完整封存來源');
  if(b.draws!==primary.input?.count||b.firstDate!==primary.input?.firstDate||b.lastDate!==primary.input?.lastDate||b.cutoffPeriod!==primary.cutoffPeriod||b.targetDate!==primary.targetDate||b.targetPeriod!==primary.targetPeriod||r.inputHash!==primary.inputHash||r.decisionId!==decision.id||r.groupSnapshotId!==groups.id||decision.inputHash!==primary.inputHash||groups.inputHash!==primary.inputHash||groups.sourceDecisionId!==decision.id||decision.targetPeriod!==b.targetPeriod||groups.targetPeriod!==b.targetPeriod||decision.targetDate!==b.targetDate||groups.targetDate!==b.targetDate)fail('全模組驗證與本期主報、獨支或組合封存來源不符');
  for(const source of [primary,decision,groups])if(!time(source.storedAt)||Date.parse(r.generatedAt)<Date.parse(source.storedAt))fail('全模組驗證時間早於來源封存，禁止倒填');
 }
 return report;
}
