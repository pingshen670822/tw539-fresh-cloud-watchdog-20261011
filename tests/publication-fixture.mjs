// Synthetic structural fixtures only. No network, persistence, historical replay,
// or claims about prediction accuracy. Never publish these as lottery evidence.
import * as policy from '../scripts/report-verification-policy.mjs';
import * as fifty from '../scripts/fifty-policy.mjs';
import {digest,GROUP_VERSION,GROUP_RANGES,SIX_VERSION,SIX_POLICY,HISTORY_MEANING,groupBaseline,PUBLICATION_VERSION} from '../scripts/publication-contract.mjs';
const clone=value=>structuredClone(value);
function unitNine(r){
 const total=r.input.count-200,stats=n=>({count:n,histogram:[n,0,0,0,0,0],bottomHistogram:[n,0,0,0,0,0],totalHits:0,atLeast2:0,atLeast3:0,meanHits:n?0:null,atLeast2Rate:n?0:null,atLeast3Rate:n?0:null,bottomMean:n?0:null}),ranking=clone(r.ranking),numbers=ranking.slice(0,9).map(x=>x.number);
 return {version:policy.REPORT_VERIFICATION_POLICY.nineVersion,status:'research_only',inputHash:r.inputHash,targetDate:r.targetDate,targetPeriod:r.targetPeriod,cutoffDate:r.input.lastDate,cutoffPeriod:r.cutoffPeriod,trainingDraws:r.input.count,modelId:'discount60',modelName:'測試研究模型',numbers,ranking,modelSelection:{objectives:['atLeast3','atLeast2','totalHits'],selectedModelId:'discount60',experts:['discount60','discount240','conditional'].map(id=>({id,name:'測試模型',numbers,backtest:stats(total)}))},backtest:{...stats(total),recent60:stats(Math.min(60,total)),recent240:stats(Math.min(240,total)),recent:[]},legacyComparison:{backtest:stats(total)},fairBaseline:{atLeast2:{targetProbability:0.3},atLeast3:{targetProbability:0.07}}};
}


function unitFifty(r,d){
 const ranking=clone(d?.research?.ranking??r.ranking),count=r.input.count-200;
 const stats=n=>({count:n,singleHits:0,top5Hits:0,top9Hits:0,bottom9Hits:0,top5AtLeast2:0,top5AtLeast3:0,top9AtLeast2:0,top9AtLeast3:0,singleHistogram:[n,0],top5Histogram:[n,0,0,0,0,0],top9Histogram:[n,0,0,0,0,0],bottom9Histogram:[n,0,0,0,0,0],brierSum:0,singleRate:n?0:null,top5Mean:n?0:null,top9Mean:n?0:null,bottom9Mean:n?0:null,top5AtLeast2Rate:n?0:null,top5AtLeast3Rate:n?0:null,top9AtLeast2Rate:n?0:null,top9AtLeast3Rate:n?0:null,brier:n?0:null});
 const summaries=()=>({stats:stats(count),recent60:stats(Math.min(count,60)),recent240:stats(Math.min(count,240))});
 const forecast=()=>({single:ranking[0].number,top5:ranking.slice(0,5).map(x=>x.number),top9:ranking.slice(0,9).map(x=>x.number),bottom9:ranking.slice(-9).map(x=>x.number),ranking:clone(ranking)});
 const families=[...new Set(fifty.FIFTY_CONFIGS.map(c=>c.family))],familyCount=family=>fifty.FIFTY_CONFIGS.filter(c=>c.family===family).length;
 const choose=(n,k)=>{if(k<0||k>n)return 0;let value=1;for(let i=1;i<=k;i++)value=value*(n-i+1)/i;return value};
 const groupStats=(n,size)=>({count:n,totalHits:0,histogram:[n,...Array(Math.min(5,size)).fill(0)],targetMet:0,targetRate:n?0:null,meanHits:n?0:null});
 const groups=fifty.FIFTY_GROUPS.map(spec=>{const distribution=Array.from({length:Math.min(5,spec.size)+1},(_,h)=>choose(spec.size,h)*choose(39-spec.size,5-h)/choose(39,5));return {id:'fifty_group_'+spec.size,...clone(spec),numbers:ranking.slice(0,spec.size).map(x=>x.number),stats:groupStats(count,spec.size),recent60:groupStats(Math.min(count,60),spec.size),recent240:groupStats(Math.min(count,240),spec.size),fairBaseline:{distribution,targetProbability:distribution.slice(spec.minHits,spec.maxHits+1).reduce((a,x)=>a+x,0),expectedHits:spec.size*5/39,meaning:'公平開獎超幾何理論基準，非模型成功率'}}});
 const result={unitFixtureOnly:true,fixtureMeaning:'Synthetic rendering structure only; not replay evidence',version:fifty.FIFTY_VERSION,status:'research_only',policy:clone(fifty.FIFTY_POLICY),input:clone(r.input),trainingDraws:r.input.count,cutoffDate:r.input.lastDate,cutoffPeriod:r.cutoffPeriod,targetDate:r.targetDate,targetPeriod:r.targetPeriod,inputHash:r.inputHash,moduleCount:50,familyCount:8,modules:fifty.FIFTY_CONFIGS.map(c=>({...clone(c),...forecast(),...summaries()})),fusion:{id:'family_equal_brier_fusion',name:'八家族等權融合研究',notAdditionalModule:true,...forecast(),...summaries(),weights:fifty.FIFTY_CONFIGS.map(c=>({moduleId:c.id,family:c.family,weight:1/familyCount(c.family)/8,familyWeight:1/8,withinFamilyWeight:1/familyCount(c.family)})),familyWeights:families.map(family=>({family,weight:1/8})),groups,recent:[]},evaluation:{warmup:200,count,firstDate:r.input.firstDate,lastDate:r.input.lastDate,keep:0,recent:[]},numericChecks:{predictionsVerified:(r.input.count+1)*51,valuesVerified:(r.input.count+1)*51*39,maxSumError:0}};
 fifty.validateFiftyModules(result,{inputHash:r.inputHash});return result;
}



export function seal(value){const {id,...body}=value;return {...body,id:digest(body)}}
export function attachPublication(value){
 const r=value.report,d=value.decision.decision,q=d.research;
 r.input.firstDate='2007-01-01';r.input.lastPeriod=r.cutoffPeriod;q.modelName??='僅供契約測試的結構模型';
 r.ranking=clone(q.ranking);r.single=q.number;
 const previous=new Date(r.targetDate+'T00:00:00Z');previous.setUTCDate(previous.getUTCDate()-1);while(previous.getUTCDay()===0)previous.setUTCDate(previous.getUTCDate()-1);
 r.input.lastDate=previous.toISOString().slice(0,10);
 const at=Math.min(Date.parse(r.targetDate+'T10:00:00.000Z'),Date.parse(value.status.state.lastSuccess.at)-10000),stamp=offset=>new Date(at+offset).toISOString();
 r.storedAt=stamp(0);d.generatedAt??=stamp(1000);d.storedAt??=stamp(1000);
 value.decision.decision=seal(d);const decision=value.decision.decision;
 const g=seal({version:GROUP_VERSION,policy:{version:GROUP_VERSION,basis:'verified_research_ranking_prefix',scope:'research_only',ranges:GROUP_RANGES,publication:'new_timestamped_pre_draw_seal_no_historical_backfill'},status:'research_only',targetDate:r.targetDate,targetPeriod:r.targetPeriod,cutoffDate:r.input.lastDate,cutoffPeriod:r.cutoffPeriod,trainingDraws:r.input.count,inputHash:r.inputHash,sourceDecisionId:decision.id,sourceDecisionVersion:decision.version,sourceDecisionStoredAt:decision.storedAt,sourceResearchVersion:q.version,sourceModelId:q.modelId,sourceModelName:q.modelName,sourceResearchNumber:q.number,rankedNumbers:q.ranking.map(row=>row.number),groups:GROUP_RANGES.map(range=>({...range,label:`${range.size}中${range.minHits}～${range.maxHits}`,numbers:q.ranking.slice(0,range.size).map(row=>row.number),fairBaseline:groupBaseline(range.size,range.minHits,range.maxHits)})),storedAt:stamp(2000)});
 value.groups={ready:true,archiveVerified:true,snapshot:g};
 const p=seal({nine:unitNine(r),fifty:unitFifty(r,decision),version:policy.REPORT_VERIFICATION_VERSION,policy:clone(policy.REPORT_VERIFICATION_POLICY),requiredCount:20,passedCount:20,status:'passed',checks:policy.REPORT_VERIFICATION_CHECKS.map(check=>({...check,passed:true,detail:'Synthetic contract fixture only; never production replay evidence'})),dataBasis:{draws:r.input.count,firstDate:r.input.firstDate,lastDate:r.input.lastDate,cutoffPeriod:r.cutoffPeriod,targetPeriod:r.targetPeriod,targetDate:r.targetDate},coverage:{primaryModules:8,candidateModels:6,fullHistoryReplayPeriods:r.input.count-200,primaryModuleNames:clone(policy.REPORT_VERIFICATION_POLICY.primaryModuleNames),candidateModelIds:clone(policy.REPORT_VERIFICATION_POLICY.candidateModelIds),selectorVersion:policy.REPORT_VERIFICATION_POLICY.selectorVersion,diagnosticsVersion:policy.REPORT_VERIFICATION_POLICY.diagnosticsVersion,groupVersion:policy.REPORT_VERIFICATION_POLICY.groupVersion,fiftyModules:50,fiftyVersion:fifty.FIFTY_VERSION},passes:{primary:2,candidates:2,researchSelector:1,diagnostics:1,decision:1,groups:1,nine:2,fifty:2},generatedAt:stamp(3000),storedAt:stamp(4000),inputHash:r.inputHash,decisionId:decision.id,groupSnapshotId:g.id});
 value.verification={ready:true,report:p};
 const history=n=>({count:n,totalHits:0,histogram:[n,0,0,0,0,0],atLeast2:0,atLeast3:0,atLeast4:0,allFive:0,meanHits:n?0:null});
 const pool=p.fifty.fusion.ranking.slice(0,15).map(({number,rank,probability})=>({number,rank,probability}));
 // Every estimate is uniform in this isolated fixture, so the ten lexicographic
 // winners are exactly ranks [1,2,3,4,5,6] through [1,2,3,4,5,15].
 const groups=Array.from({length:10},(_,i)=>({id:'six_group_'+String(i+1).padStart(2,'0'),rank:i+1,numbers:[...pool.slice(0,5),pool[5+i]].map(row=>row.number),expectedHits:Math.round(6*(5/39)*1e12)/1e12,history:{all:history(r.input.count),recent60:history(Math.min(60,r.input.count)),recent240:history(Math.min(240,r.input.count))}}));
 const s=seal({version:SIX_VERSION,policy:clone(SIX_POLICY),status:'research_only',confidence:'research_reference',inputHash:r.inputHash,sourceVerificationId:p.id,sourceVerificationVersion:p.version,sourceVerificationStoredAt:p.storedAt,sourceFiftyVersion:p.fifty.version,targetDate:r.targetDate,targetPeriod:r.targetPeriod,cutoffPeriod:r.cutoffPeriod,cutoffDate:r.input.lastDate,trainingDraws:r.input.count,generatedAt:stamp(5000),storedAt:stamp(5000),pool,groups,evaluation:{kind:SIX_POLICY.history,walkForward:false,publishedPerformance:false,usesCurrentList:true,includesWarmup:true,count:r.input.count,firstDate:r.input.firstDate,lastDate:r.input.lastDate,meaning:HISTORY_MEANING}});
 value.sixCombinations={ready:true,snapshot:s};value.groupReviewError=null;value.fiftyReviewError=null;value.sixReviewError=null;
 Object.assign(value.sync,{storedAt:r.storedAt,decisionId:decision.id,decisionVersion:decision.version,decisionStatus:decision.status,groupSnapshotId:g.id,groupVersion:g.version,groupSourceDecisionId:decision.id,verificationId:p.id,verificationVersion:p.version,sixCombinationId:s.id,sixCombinationVersion:s.version,sixSourceVerificationId:p.id,snapshotId:digest([r.modelVersion,r.targetPeriod,r.inputHash,r.storedAt,decision.id,g.id,p.id,s.id])});
 const publicationId=digest(['synthetic-publication-summary-only',r.inputHash,r.cutoffPeriod,r.targetPeriod,p.id,s.id]);
 value.publication={ready:true,id:publicationId,version:PUBLICATION_VERSION,mode:'signed_verified_archive',inputHash:r.inputHash,targetPeriod:r.targetPeriod,cutoffPeriod:r.cutoffPeriod,verificationId:p.id,sixCombinationId:s.id,fullAuditAt:stamp(6000),createdAt:stamp(7000),verifiedAt:value.status.state.lastSuccess.at};
 value.sync.publicationId=publicationId;value.sync.publicationVersion=PUBLICATION_VERSION;value.status.state.lastSuccess.publicationId=publicationId;value.status.state.publicationError=null;
 return value;
}
