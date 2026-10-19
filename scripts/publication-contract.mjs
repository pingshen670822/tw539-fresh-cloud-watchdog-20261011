import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateReportVerification,REPORT_VERIFICATION_VERSION,REPORT_VERIFICATION_POLICY} from './report-verification-policy.mjs';
import {FIFTY_VERSION,FIFTY_GROUPS} from './fifty-policy.mjs';

export const GROUP_VERSION='539-research-ranking-groups-v1-20261012';
export const GROUP_RANGES=[{size:2,minHits:1,maxHits:2},{size:3,minHits:1,maxHits:3},{size:5,minHits:2,maxHits:5},{size:7,minHits:2,maxHits:5},{size:9,minHits:3,maxHits:5}];
export const GROUP_POLICY={version:GROUP_VERSION,basis:'verified_research_ranking_prefix',scope:'research_only',ranges:GROUP_RANGES,publication:'new_timestamped_pre_draw_seal_no_historical_backfill'};
export const SIX_VERSION='539-six-top15-combinations-v1-20261015';
export const SIX_POLICY={version:SIX_VERSION,basis:'verified_fifty_fusion_top15',poolSize:15,groupSize:6,groupCount:10,candidateCount:5005,selection:'exact_top10_of_all_5005',score:'sum_marginal_probabilities_expected_hits_not_joint_probability',scoreScale:1e12,tieBreak:'rounded_expected_hits_desc_then_source_rank_indices_asc',diversification:false,allowOverlap:true,poolCoverageRequired:false,scoringMeaning:'六個邊際機率相加僅為預期命中顆數，不是六碼聯合命中率或中獎機率。',overlapMeaning:'依分數直接取最高十組，組間可高度重疊；不強制分散，也不保證十五碼全部入選。',history:'fixed_current_list_retrospective_descriptive',publication:'new_timestamped_pre_draw_seal_no_historical_backfill'};
export const HISTORY_MEANING='以本次固定六碼名單回看截至資料截止的全部官方歷史（含暖機期），僅為描述性統計；不是逐期先預測後評分，也不是已發布實戰績效。';
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const total=values=>values.reduce((sum,value)=>sum+value,0);
const integer=value=>Number.isSafeInteger(value)&&value>=0;

function sealed(value,name,deadline,checkedAt){
 assert.ok(value&&typeof value==='object',name+'封存缺漏');
 const {id,...body}=value;
 assert.match(id??'',/^[a-f0-9]{64}$/,name+'封存識別無效');
 assert.equal(digest(body),id,name+'封存內容識別不一致');
 assert.ok(validTime(value.storedAt)&&Date.parse(value.storedAt)<deadline&&Date.parse(value.storedAt)<=checkedAt+30000,name+'開獎前封存時間無效');
 return value;
}

function choose(n,k){if(k<0||k>n)return 0;let result=1;for(let i=1;i<=k;i++)result=result*(n-i+1)/i;return Math.round(result)}
export function groupBaseline(size,minHits,maxHits){
 const totalOutcomes=choose(39,5),outcomeCounts=Array.from({length:6},(_,hits)=>choose(size,hits)*choose(39-size,5-hits)),targetOutcomes=total(outcomeCounts.slice(minHits,maxHits+1));
 return {kind:'fair_draw_hypergeometric_not_model_success',totalOutcomes,outcomeCounts,targetOutcomes,targetProbability:targetOutcomes/totalOutcomes,expectedHits:size*5/39,formula:'C(k,h)×C(39−k,5−h)÷C(39,5)'};
}

// This checks only the 5,005 current six-number scores. It does not replay any
// historical prediction model or turn descriptive history into live evidence.
export function selectSixGroups(pool){
 const candidates=[],indices=[];
 function enumerate(start){
  if(indices.length===6){candidates.push({indices:[...indices],scoreUnits:Math.round(indices.reduce((sum,i)=>sum+pool[i].probability,0)*1e12)});return}
  for(let i=start;i<=pool.length-(6-indices.length);i++){indices.push(i);enumerate(i+1);indices.pop()}
 }
 enumerate(0);assert.equal(candidates.length,5005,'六碼候選枚舉數不完整');
 candidates.sort((a,b)=>{if(a.scoreUnits!==b.scoreUnits)return b.scoreUnits-a.scoreUnits;for(let i=0;i<6;i++)if(a.indices[i]!==b.indices[i])return a.indices[i]-b.indices[i];return 0});
 return candidates.slice(0,10).map((candidate,i)=>({id:`six_group_${String(i+1).padStart(2,'0')}`,rank:i+1,numbers:candidate.indices.map(j=>pool[j].number),expectedHits:candidate.scoreUnits/1e12}));
}

function checkSixHistory(history,count){
 assert.deepEqual(Object.keys(history??{}).sort(),['all','recent240','recent60'],'六碼描述性統計缺漏');
 for(const [key,n] of [['all',count],['recent60',Math.min(60,count)],['recent240',Math.min(240,count)]]){
  const stats=history[key],h=stats?.histogram;
  assert.ok(Array.isArray(h)&&h.length===6&&h.every(integer)&&total(h)===n,'六碼描述性分布筆數無效');
  const totalHits=h.reduce((sum,value,hits)=>sum+value*hits,0);
  assert.deepEqual(stats,{count:n,totalHits,histogram:h,atLeast2:total(h.slice(2)),atLeast3:total(h.slice(3)),atLeast4:total(h.slice(4)),allFive:h[5],meanHits:n?totalHits/n:null},'六碼描述性分布計數不一致');
 }
 for(let h=0;h<6;h++)assert.ok(history.recent60.histogram[h]<=history.recent240.histogram[h]&&history.recent240.histogram[h]<=history.all.histogram[h],'六碼近期統計不是全期子集');
}

export function verifyPublication(state,result,checkedAt){
 const report=state.report,decision=state.decision.decision,sync=state.sync,deadline=Date.parse(report.targetDate+'T20:30:00+08:00');
 sealed(decision,'獨支決策',deadline,checkedAt);
 assert.equal(state.groups?.ready,true,'原研究組合尚未核對');
 assert.equal(state.groups?.archiveVerified,true,'原研究組合尚未通過封存核對');
 const groups=sealed(state.groups.snapshot,'原研究組合',deadline,checkedAt);
 assert.equal(groups.version,GROUP_VERSION,'原研究組合版本無效');
 assert.deepEqual(groups.policy,GROUP_POLICY,'原研究組合政策不一致');
 assert.equal(groups.status,'research_only','原研究組合狀態無效');
 for(const key of ['inputHash','targetDate','targetPeriod','cutoffPeriod'])assert.equal(groups[key],report[key],'原研究組合來源不一致：'+key);
 assert.equal(groups.cutoffDate,report.input?.lastDate,'原研究組合截止日不一致');
 assert.equal(groups.trainingDraws,report.input?.count,'原研究組合歷史筆數不一致');
 assert.equal(groups.sourceDecisionId,decision.id,'原研究組合決策識別不一致');
 assert.equal(groups.sourceDecisionVersion,decision.version,'原研究組合決策版本不一致');
 assert.equal(groups.sourceDecisionStoredAt,decision.storedAt,'原研究組合來源時間不一致');
 assert.ok(Date.parse(groups.storedAt)>=Date.parse(decision.storedAt),'原研究組合時間早於決策來源');
 assert.equal(groups.sourceResearchVersion,decision.research.version,'原研究組合研究版本不一致');
 assert.equal(groups.sourceResearchNumber,decision.research.number,'原研究組合研究獨支不一致');
 assert.equal(groups.sourceModelId,decision.research.modelId,'原研究組合來源模型不一致');
 assert.equal(groups.sourceModelName,decision.research.modelName,'原研究組合來源模型名稱不一致');
 assert.deepEqual(groups.rankedNumbers,decision.research.ranking.map(row=>row.number),'原研究組合完整排名不一致');
 assert.deepEqual(groups.groups,GROUP_RANGES.map(range=>({...range,label:`${range.size}中${range.minHits}～${range.maxHits}`,numbers:groups.rankedNumbers.slice(0,range.size),fairBaseline:groupBaseline(range.size,range.minHits,range.maxHits)})),'原研究組合固定名單或目標不一致');
 for(const [key,value] of Object.entries({groupSnapshotId:groups.id,groupVersion:groups.version,groupSourceDecisionId:decision.id}))assert.equal(sync[key],value,'原研究組合同步識別不一致：'+key);
 if(result.groups?.id)assert.equal(result.groups.id,groups.id,'更新回應原研究組合識別不一致');

 assert.equal(state.verification?.ready,true,'二十項五十模組驗證尚未完成');
 const proof=sealed(state.verification.report,'二十項出報告驗證',deadline,checkedAt);
 validateReportVerification(proof,{primary:report,decision,groups});
 assert.equal(proof.status,'passed','二十項出報告驗證未全數通過');
 assert.equal(proof.requiredCount,20,'二十項出報告驗證數量不一致');
 assert.equal(proof.passedCount,20,'二十項出報告驗證未全數通過');
 assert.ok(Date.parse(proof.storedAt)>=Date.parse(proof.generatedAt),'二十項驗證封存時間早於運算');
 for(const [key,value] of Object.entries({verificationId:proof.id,verificationVersion:REPORT_VERIFICATION_VERSION}))assert.equal(sync[key],value,'二十項驗證同步識別不一致：'+key);
 if(result.verification?.id)assert.equal(result.verification.id,proof.id,'更新回應二十項驗證識別不一致');

 assert.equal(state.sixCombinations?.ready,true,'六碼組合尚未完成');
 const six=sealed(state.sixCombinations.snapshot,'六碼組合',deadline,checkedAt),basis=proof.dataBasis;
 assert.equal(six.version,SIX_VERSION,'六碼組合版本無效');
 assert.deepEqual(six.policy,SIX_POLICY,'六碼組合政策不一致');
 assert.equal(six.status,'research_only','六碼組合研究狀態無效');
 assert.equal(six.confidence,'research_reference','六碼組合信心標籤無效');
 for(const [key,value] of Object.entries({inputHash:proof.inputHash,sourceVerificationId:proof.id,sourceVerificationVersion:proof.version,sourceVerificationStoredAt:proof.storedAt,sourceFiftyVersion:REPORT_VERIFICATION_POLICY.fiftyVersion,targetDate:basis.targetDate,targetPeriod:basis.targetPeriod,cutoffPeriod:basis.cutoffPeriod,cutoffDate:basis.lastDate,trainingDraws:basis.draws}))assert.equal(six[key],value,'六碼組合來源不一致：'+key);
 assert.ok(validTime(six.generatedAt)&&six.generatedAt===six.storedAt&&Date.parse(six.generatedAt)>=Date.parse(proof.storedAt),'六碼組合生成時間早於驗證來源或不是另行封存');
 assert.deepEqual(six.pool,proof.fifty.fusion.ranking.slice(0,15).map(({number,rank,probability})=>({number,rank,probability})),'六碼組合不是本期五十融合前十五名');
 assert.deepEqual(six.evaluation,{kind:SIX_POLICY.history,walkForward:false,publishedPerformance:false,usesCurrentList:true,includesWarmup:true,count:basis.draws,firstDate:REPORT_VERIFICATION_POLICY.originDate,lastDate:basis.lastDate,meaning:HISTORY_MEANING},'六碼組合描述性歷史標示不一致');
 const expected=selectSixGroups(six.pool);
 assert.ok(Array.isArray(six.groups)&&six.groups.length===10,'六碼組合十組名單不完整');
 expected.forEach((group,i)=>{const saved=six.groups[i];assert.deepEqual(saved,{...group,history:saved?.history},'六碼組合不是五千零五組中的最高十組');checkSixHistory(saved.history,basis.draws)});
 for(const [key,value] of Object.entries({sixCombinationId:six.id,sixCombinationVersion:six.version,sixSourceVerificationId:proof.id}))assert.equal(sync[key],value,'六碼組合同步識別不一致：'+key);
 if(result.sixCombinations?.id)assert.equal(result.sixCombinations.id,six.id,'更新回應六碼組合識別不一致');
 assert.equal(sync.snapshotId,digest([report.modelVersion,report.targetPeriod,report.inputHash,report.storedAt,decision.id,groups.id,proof.id,six.id]),'完整跨裝置快照內容識別不一致');
 return {groups,proof,six};
}

const numbers=(value,count)=>Array.isArray(value)&&value.length===count&&new Set(value).size===count&&value.every(n=>Number.isInteger(n)&&n>=1&&n<=39);
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;

/** The Site owns historical model replays. This separate readback proves that
 * deferred historical work actually completed for the same official prefix;
 * it checks its result math and immutable source links without running models. */
export function verifyHistoricalReviews(value,report,checkedAt){
 assert.ok(value&&typeof value==='object','歷史實戰檢討回應缺漏');
 assert.ok(value.historicalReviewsDeferred!==true&&value.deferred!==true&&value.pending!==true&&value.ready!==false,'歷史實戰檢討仍延後或未完成');
 for(const [key,expected] of Object.entries({inputHash:report.inputHash,latestPeriod:report.cutoffPeriod,targetPeriod:report.targetPeriod,sourceLastDate:report.input?.lastDate}))assert.equal(value[key],expected,'歷史實戰檢討來源不一致：'+key);
 assert.equal(value.fiftyReviewError,null,'五十融合歷史實戰檢討仍有錯誤或未完成');
 assert.equal(value.sixReviewError,null,'六碼歷史實戰檢討仍有錯誤或未完成');
 assert.ok(Array.isArray(value.fiftyReviews)&&Array.isArray(value.sixReviews),'歷史實戰檢討名單缺漏');
 const fiftyBySource=new Map(),periods=new Set(),sixPeriods=new Set();
 const base=(row,kind)=>{
  assert.equal(row?.kind,kind,'歷史實戰檢討類別無效');
  assert.equal(row.status,'completed','歷史實戰檢討包含未完成或無效紀錄');
  assert.ok(Number.isSafeInteger(row.period)&&Number.isSafeInteger(row.cutoffPeriod)&&row.cutoffPeriod<row.period&&row.period<=report.cutoffPeriod&&row.cutoffPeriod<report.cutoffPeriod,'歷史實戰檢討期別含當期或未來資料');
  assert.ok(validDate(row.date)&&validDate(row.cutoffDate)&&row.cutoffDate<row.date&&row.date<=report.input.lastDate,'歷史實戰檢討日期或截止無效');
  assert.ok(Math.floor(row.period/1000000)===Number(row.date.slice(0,4))-1911&&Math.floor(row.cutoffPeriod/1000000)===Number(row.cutoffDate.slice(0,4))-1911,'歷史實戰檢討年份與期別不符');
  if(row.period===report.cutoffPeriod)assert.equal(row.date,report.input.lastDate,'最新已開獎期的歷史檢討日期不一致');
  for(const key of ['sourceVerificationId','inputHash'])assert.match(row[key]??'',/^[a-f0-9]{64}$/,'歷史實戰檢討來源識別無效：'+key);
  assert.equal(row.sourceFiftyVersion,FIFTY_VERSION,'歷史五十模組來源版本不一致');
  const deadline=Date.parse(row.date+'T20:30:00+08:00');
  assert.ok(validTime(row.storedAt)&&Date.parse(row.storedAt)<deadline&&checkedAt>=deadline,'歷史實戰檢討來源不是開獎前封存或尚未開獎');
  assert.ok(numbers(row.drawn,5),'歷史實戰檢討官方五碼無效');
  assert.deepEqual(row.drawn,[...row.drawn].sort((a,b)=>a-b),'歷史實戰檢討官方五碼順序無效');
 };
 for(const row of value.fiftyReviews){
  base(row,'fifty_fusion_live');
  assert.equal(row.sourceVerificationVersion,REPORT_VERIFICATION_VERSION,'歷史二十項驗證來源版本不一致');
  assert.ok(!periods.has(row.period)&&!fiftyBySource.has(row.sourceVerificationId),'五十融合歷史實戰檢討期別或來源重複');periods.add(row.period);fiftyBySource.set(row.sourceVerificationId,row);
  assert.ok(Number.isInteger(row.number)&&row.number>=1&&row.number<=39,'歷史實戰獨支無效');
  assert.equal(row.singleHit,row.drawn.includes(row.number),'歷史實戰獨支命中計數不一致');
  assert.ok(Array.isArray(row.groups)&&row.groups.length===5,'五十融合歷史五組名單不完整');
  const top9=row.groups[4]?.numbers;assert.ok(numbers(top9,9)&&top9[0]===row.number,'歷史實戰獨支與九碼名單不一致');
  row.groups.forEach((group,i)=>{
   const spec=FIFTY_GROUPS[i];
   for(const key of ['size','minHits','maxHits','label'])assert.equal(group[key],spec[key],'歷史五組目標不一致：'+key);
   assert.equal(group.id,'fifty_group_'+spec.size,'歷史五組識別無效');
   assert.deepEqual(group.numbers,top9.slice(0,spec.size),'歷史五組名單不是同一封存排名前綴');
   const hits=group.numbers.filter(n=>row.drawn.includes(n));assert.deepEqual(group.hits,hits,'歷史五組命中號碼不一致');assert.equal(group.hitCount,hits.length,'歷史五組命中數不一致');assert.equal(group.targetMet,hits.length>=spec.minHits&&hits.length<=spec.maxHits,'歷史五組達標判定不一致');
  });
 }
 for(const row of value.sixReviews){
  base(row,'six_combinations_live');
  assert.ok(!sixPeriods.has(row.period),'六碼歷史實戰檢討期別重複');sixPeriods.add(row.period);
  assert.match(row.combinationSnapshotId??'',/^[a-f0-9]{64}$/,'歷史六碼封存識別無效');assert.equal(row.id,row.combinationSnapshotId,'歷史六碼封存識別不一致');
  const source=fiftyBySource.get(row.sourceVerificationId);assert.ok(source,'歷史六碼缺少已完成核對的五十融合來源');
  for(const key of ['period','date','cutoffPeriod','cutoffDate','inputHash'])assert.equal(row[key],source[key],'歷史六碼與五十融合來源不一致：'+key);
  assert.ok(Date.parse(row.storedAt)>=Date.parse(source.storedAt),'歷史六碼封存時間早於五十來源');assert.deepEqual(row.drawn,source.drawn,'歷史六碼與五十融合官方結果不一致');
  assert.ok(Array.isArray(row.groups)&&row.groups.length===10,'歷史六碼十組名單不完整');const combinations=new Set();
  row.groups.forEach((group,i)=>{
   assert.equal(group.id,'six_group_'+String(i+1).padStart(2,'0'),'歷史六碼組別識別無效');assert.equal(group.rank,i+1,'歷史六碼組別排名無效');assert.ok(numbers(group.numbers,6),'歷史六碼組別名單無效');
   const key=[...group.numbers].sort((a,b)=>a-b).join(',');assert.ok(!combinations.has(key),'歷史六碼組別重複');combinations.add(key);
   assert.ok(Number.isFinite(group.expectedHits)&&group.expectedHits>=0&&group.expectedHits<=5&&(!i||group.expectedHits<=row.groups[i-1].expectedHits),'歷史六碼預期顆數或排序無效');
   const hits=group.numbers.filter(n=>row.drawn.includes(n));assert.deepEqual(group.hits,hits,'歷史六碼命中號碼不一致');assert.equal(group.hitCount,hits.length,'歷史六碼命中數不一致');
  });
 }
 return {historyReceiptId:digest(value),historicalReviewsVerified:true,fiftyReviewCount:value.fiftyReviews.length,sixReviewCount:value.sixReviews.length};
}
