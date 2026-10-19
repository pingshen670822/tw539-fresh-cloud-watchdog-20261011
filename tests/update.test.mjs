import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {requestJson,runWatchdog,scheduledWindow,verifyState,saveHeartbeatBounded,TOTAL_BUDGET_MS} from '../scripts/update.mjs';
import {attachPublication,seal} from './publication-fixture.mjs';
import {digest,verifyHistoricalReviews} from '../scripts/publication-contract.mjs';
import {REPORT_VERIFICATION_VERSION} from '../scripts/report-verification-policy.mjs';
import {FIFTY_VERSION} from '../scripts/fifty-policy.mjs';

const instant=Date.parse('2026-10-10T21:40:00+08:00');
const token='12345678-1234-1234-1234-123456789abc';
const hash='a'.repeat(64);
function state(at=instant,targetDate='2026-10-10'){
  const ranking=Array.from({length:39},(_,i)=>({number:i+1,rank:i+1,probability:5/39}));
  const report={cutoffPeriod:115000244,targetPeriod:115000245,targetDate,inputHash:hash,modelVersion:'fixture-original',storedAt:new Date(at-1000).toISOString(),archiveVerified:true,input:{lastDate:'2026-10-09',count:5990}};
  const research={version:'fixture-research',status:'research_only',number:1,modelId:'discount60',modelEstimate:5/39,targetDate,targetPeriod:report.targetPeriod,cutoffPeriod:report.cutoffPeriod,trainingDraws:5990,ranking,top5:[1,2,3,4,5],top9:[1,2,3,4,5,6,7,8,9],checks:{prequential:true,ranking:true,marginalSum:true,explanation:true},modelSelection:{selectedModelId:'discount60',experts:[{id:'discount60',currentSingle:1,currentEstimate:5/39}]}};
  const decision={id:'d'.repeat(64),version:'fixture-decision',status:'no_supported_single',selectedNumber:null,targetDate,targetPeriod:report.targetPeriod,cutoffPeriod:report.cutoffPeriod,inputHash:hash,research};
  const sync={snapshotId:'e'.repeat(64),inputHash:hash,targetPeriod:report.targetPeriod,cutoffPeriod:report.cutoffPeriod,modelVersion:report.modelVersion,storedAt:report.storedAt,decisionId:decision.id,decisionVersion:decision.version,decisionStatus:decision.status,researchVersion:research.version,researchNumber:research.number};
  return attachPublication({report,decision:{ready:true,decision},sync,status:{state:{lastError:null,candidateError:null,decisionError:null,groupError:null,verificationError:null,sixCombinationError:null,lastSuccess:{at:new Date(at).toISOString(),latestPeriod:report.cutoffPeriod,targetPeriod:report.targetPeriod,inputHash:hash}}}});
}
function stateV3(at=instant,targetDate='2026-10-10'){
  const result=state(at,targetDate),decision=result.decision.decision,research=decision.research;
  decision.version='539-single-verified-diagnostics-v3-20261011';
  decision.researchDiagnostics={version:'539-research-diagnostics-v1-20261011',number:research.number,targetDate,targetPeriod:result.report.targetPeriod,cutoffPeriod:result.report.cutoffPeriod,trainingDraws:research.trainingDraws,checks:{trace:true,replay:true,selection:true,weighting:true}};
  decision.adoptionReview={policy:{version:'539-verified-adoption-v1-20261011'},records:[]};
  decision.candidates=Array.from({length:39},(_,i)=>({number:i+1,eligible:false,genericSupportPassed:false,isRepeat:false,repeatStatus:'not_applicable',supportingModels:[]}));
  result.sync.decisionVersion=decision.version;
  return attachPublication(result);
}
function supportedV3(){
  const result=stateV3(),decision=result.decision.decision,selected=decision.candidates.find(row=>row.number===17);
  decision.status='supported';decision.selectedNumber=17;selected.eligible=true;selected.genericSupportPassed=true;selected.supportingModels=[{id:'approved-model',currentSingle:17,validated:true,approvedForSelection:true}];
  result.sync.decisionStatus=decision.status;
  return attachPublication(result);
}
const response=(data,status=200,retryAfter)=>({ok:status>=200&&status<300,status,headers:{get:name=>name==='retry-after'?retryAfter:null},json:async()=>data});
function historicalEnvelope(report){return {inputHash:report.inputHash,latestPeriod:report.cutoffPeriod,targetPeriod:report.targetPeriod,sourceLastDate:report.input.lastDate,fiftyReviews:[],sixReviews:[],fiftyReviewError:null,sixReviewError:null}}
function harness({at=instant,event='workflow_dispatch',refresh={ok:true},getState,getReviews,customFetch,budgetMs}={}){
  let current=at,lastState;const calls=[],saved=[],sleeps=[];
  const options={event,now:()=>current,saveHeartbeat:async value=>saved.push(value),log:()=>{},logError:()=>{},sleep:async ms=>{sleeps.push(ms);current+=ms;},fetchImpl:async(url,options)=>{
    const path=new URL(url).pathname+new URL(url).search;calls.push(path);
    if(customFetch){const custom=await customFetch(path,options,calls.length);if(custom)return custom;}
    if(path==='/api/action')return response({token});
    if(path.startsWith('/api/refresh'))return response(refresh);
    if(path==='/api/state'){lastState=getState?getState(current):state(current);return response(lastState)}
    if(path==='/api/reviews')return response(getReviews?getReviews(current,lastState):historicalEnvelope(lastState.report));
    return response({message:'unmocked route'},404);
  }};
  if(budgetMs!==undefined)options.budgetMs=budgetMs;
  return {options,calls,saved,sleeps};
}

test('schedule bounds use Taipei time and include only confirmed exceptional Sundays',()=>{
  assert.equal(scheduledWindow(Date.parse('2026-10-10T20:29:00+08:00')),false);
  assert.equal(scheduledWindow(Date.parse('2026-10-10T20:30:00+08:00')),true);
  assert.equal(scheduledWindow(Date.parse('2026-10-10T23:10:00+08:00')),true);
  assert.equal(scheduledWindow(Date.parse('2026-10-10T23:11:00+08:00')),false);
  assert.equal(scheduledWindow(Date.parse('2026-10-11T21:40:00+08:00')),false);
  assert.equal(scheduledWindow(Date.parse('2026-02-22T21:40:00+08:00')),true);
  assert.equal(scheduledWindow(Date.parse('2027-02-07T21:40:00+08:00')),false);
});

test('Sunday schedule actually checks official state and the next real draw instead of a successful no-op',async()=>{
  const at=Date.parse('2026-10-11T21:40:00+08:00'),h=harness({at,event:'schedule',getState:()=>state(at,'2026-10-12')});
  const result=await runWatchdog(h.options);
  assert.equal(result.ok,true);assert.equal(result.skipped,undefined);assert.equal(result.targetDate,'2026-10-12');assert.equal(h.calls.length,4);assert.equal(h.saved.length,1);
});

test('a night schedule delayed until next-day00:31 still updates and reads persisted current state',async()=>{
  const at=Date.parse('2026-10-17T00:31:00+08:00'),h=harness({at,event:'schedule',getState:()=>state(at,'2026-10-17')});
  const result=await runWatchdog(h.options);
  assert.equal(result.ok,true);assert.equal(result.skipped,undefined);assert.equal(result.day,'2026-10-17');assert.equal(h.calls.length,4);assert.equal(h.saved[0].verificationId.length,64);assert.equal(h.saved[0].sixCombinationId.length,64);
});

test('a delayed Sunday run with stale target reports failed health after actual requests',async()=>{
  const at=Date.parse('2026-10-11T21:40:00+08:00'),h=harness({at,event:'schedule',getState:()=>state(at,'2026-10-10')});
  assert.equal((await runWatchdog(h.options)).ok,false);assert.equal(h.calls.filter(path=>path==='/api/state').length,3);assert.equal(h.saved[0].ok,false);
});

test('manual Sunday invocation remains available',async()=>{
  const at=Date.parse('2026-10-11T21:40:00+08:00');
  const h=harness({at,getState:()=>state(at,'2026-10-12')});
  assert.equal((await runWatchdog(h.options)).ok,true);assert.equal(h.calls.length,4);
});

test('21:40 pending official publication is healthy; stale after22:00 is rejected',()=>{
  assert.doesNotThrow(()=>verifyState(state(),{ok:true},instant,instant));
  const late=Date.parse('2026-10-10T22:00:01+08:00');
  assert.throws(()=>verifyState(state(late),{ok:true},late,late),/22:00/);
});

test('successful run validates and records current data',async()=>{
  const h=harness();const result=await runWatchdog(h.options);
  assert.equal(result.ok,true);assert.equal(h.saved.length,1);assert.equal(result.inputHash,hash);assert.equal(h.calls.length,4);assert.equal(result.historicalReviewsVerified,true);assert.equal(result.fiftyReviewCount,0);assert.equal(result.sixReviewCount,0);
});

test('verified research remains healthy without a high-confidence selectedNumber',()=>{
  const valid=state();
  assert.equal(valid.decision.decision.selectedNumber,null);
  assert.doesNotThrow(()=>verifyState(valid,{ok:true},instant,instant));
});

test('version2 research fixtures remain compatible without version3 diagnostic fields',()=>{
  const valid=state();valid.decision.decision.version='539-single-guarded-with-research-v2-20261011';valid.sync.decisionVersion=valid.decision.decision.version;
  attachPublication(valid);
  assert.equal(valid.decision.decision.researchDiagnostics,undefined);
  assert.doesNotThrow(()=>verifyState(valid,{ok:true},instant,instant));
});

test('version3 valid diagnostics and an empty supported set are healthy, not a module fault',async()=>{
  const valid=stateV3();assert.equal(valid.decision.decision.selectedNumber,null);
  assert.doesNotThrow(()=>verifyState(valid,{ok:true},instant,instant));
  const h=harness({getState:at=>stateV3(at)}),result=await runWatchdog(h.options);
  assert.equal(result.ok,true);assert.equal(h.calls.length,4);assert.equal(h.saved[0].ok,true);
});

test('version3 missing or mismatching number diagnostics cannot produce healthy status',()=>{
  const mutations=[
    s=>{delete s.decision.decision.researchDiagnostics;},
    s=>{s.decision.decision.researchDiagnostics.number=17;},
    s=>{s.decision.decision.researchDiagnostics.targetDate='2026-10-12';},
    s=>{s.decision.decision.researchDiagnostics.targetPeriod++;},
    s=>{s.decision.decision.researchDiagnostics.cutoffPeriod--;},
    s=>{s.decision.decision.researchDiagnostics.trainingDraws--;}
  ];
  for(const mutate of mutations){const bad=stateV3();mutate(bad);assert.throws(()=>verifyState(bad,{ok:true},instant,instant),/研究本號診斷/);}
});

test('version3 diagnostics require the four named true verification checks',()=>{
  for(const key of ['trace','replay','selection','weighting']){
    const bad=stateV3();bad.decision.decision.researchDiagnostics.checks[key]=false;
    assert.throws(()=>verifyState(bad,{ok:true},instant,instant),/診斷四項驗證/);
  }
  for(const checks of [undefined,{trace:true,replay:true,selection:true},{a:true,b:true,c:true,d:true},{trace:true,replay:true,selection:true,weighting:true,unchecked:true}]){
    const bad=stateV3();bad.decision.decision.researchDiagnostics.checks=checks;
    assert.throws(()=>verifyState(bad,{ok:true},instant,instant),/診斷四項驗證/);
  }
});

test('version3 model adoption policy and record array cannot be omitted or substituted',()=>{
  const mutations=[
    s=>{delete s.decision.decision.adoptionReview;},
    s=>{delete s.decision.decision.adoptionReview.policy;},
    s=>{s.decision.decision.adoptionReview.policy.version='unverified-policy';},
    s=>{delete s.decision.decision.adoptionReview.records;},
    s=>{s.decision.decision.adoptionReview.records={};}
  ];
  for(const mutate of mutations){const bad=stateV3();mutate(bad);assert.throws(()=>verifyState(bad,{ok:true},instant,instant),/模型採用審查/);}
});

test('version3 supported primary uses the actually eligible number, not its research number',()=>{
  const valid=supportedV3();assert.notEqual(valid.decision.decision.selectedNumber,valid.decision.decision.research.number);
  assert.doesNotThrow(()=>verifyState(valid,{ok:true},instant,instant));
});

test('supported labels cannot bypass candidate eligibility, validation or explicit approval',()=>{
  const mutations=[
    s=>{s.decision.decision.selectedNumber=40;},
    s=>{delete s.decision.decision.candidates;},
    s=>{s.decision.decision.candidates.find(row=>row.number===17).eligible=false;},
    s=>{s.decision.decision.candidates.find(row=>row.number===17).genericSupportPassed=false;},
    s=>{s.decision.decision.candidates.find(row=>row.number===17).supportingModels=[];},
    s=>{s.decision.decision.candidates.find(row=>row.number===17).supportingModels[0].validated=false;},
    s=>{s.decision.decision.candidates.find(row=>row.number===17).supportingModels[0].approvedForSelection=false;},
    s=>{s.decision.decision.candidates.find(row=>row.number===17).supportingModels[0].currentSingle=1;}
  ];
  for(const mutate of mutations){const bad=supportedV3();mutate(bad);assert.throws(()=>verifyState(bad,{ok:true},instant,instant),/主推薦/);}
});

test('a repeat primary must pass its own repeat gate; unsupported states must retain a null primary',()=>{
  const valid=supportedV3(),selected=valid.decision.decision.candidates.find(row=>row.number===17);selected.isRepeat=true;selected.repeatStatus='supported';
  attachPublication(valid);
  assert.doesNotThrow(()=>verifyState(valid,{ok:true},instant,instant));
  selected.repeatStatus='insufficient';assert.throws(()=>verifyState(valid,{ok:true},instant,instant),/連莊主推薦/);
  for(const status of ['no_supported_single','stale']){
    const bad=stateV3();bad.decision.decision.status=status;bad.sync.decisionStatus=status;bad.decision.decision.selectedNumber=17;
    assert.throws(()=>verifyState(bad,{ok:true},instant,instant),/未通過主推薦檢核/);
  }
});

test('version3 missing diagnostics is retried and reported failed rather than falsely healthy',async()=>{
  const h=harness({getState:at=>{const bad=stateV3(at);delete bad.decision.decision.researchDiagnostics;return bad;}}),result=await runWatchdog(h.options);
  assert.equal(result.ok,false);assert.match(result.error,/研究本號診斷缺漏/);assert.equal(h.calls.filter(path=>path.startsWith('/api/refresh')).length,3);assert.equal(h.saved[0].ok,false);
});

test('module failures cannot be hidden by an otherwise fresh lastSuccess',()=>{
  for(const key of ['lastError','candidateError','decisionError','groupError','verificationError','sixCombinationError']){
    const bad=state();bad.status.state[key]={at:new Date(instant).toISOString(),message:'failed'};
    assert.throws(()=>verifyState(bad,{ok:true},instant,instant),/未處理故障/);
  }
  for(const key of ['candidate','decision','groups','verification','sixCombinations'])assert.throws(()=>verifyState(state(),{ok:true,[key]:{ok:false}},instant,instant),/未完成/);
});

test('missing or unverified forecast, decision and research reject healthy status',()=>{
  const mutations=[
    s=>{s.report.archiveVerified=false;},
    s=>{s.decision.ready=false;},
    s=>{delete s.decision.decision;},
    s=>{delete s.sync;},
    s=>{delete s.decision.decision.research;},
    s=>{s.decision.decision.research.number=0;},
    s=>{s.decision.decision.research.number=40;},
    s=>{s.decision.decision.research.status='supported';}
  ];
  for(const mutate of mutations){const bad=state();mutate(bad);assert.throws(()=>verifyState(bad,{ok:true},instant,instant));}
});

test('decision and research must share all forecast dates, periods and input hashes',()=>{
  for(const key of ['targetPeriod','cutoffPeriod','targetDate','inputHash']){
    const bad=state();bad.decision.decision[key]=key.endsWith('Period')?1:'wrong';
    assert.throws(()=>verifyState(bad,{ok:true},instant,instant),/獨支決策.*不一致/);
  }
  for(const key of ['targetPeriod','cutoffPeriod','targetDate','inputHash','trainingDraws']){
    const bad=state();bad.decision.decision.research[key]=key.endsWith('Period')||key==='trainingDraws'?1:'wrong';
    assert.throws(()=>verifyState(bad,{ok:true},instant,instant),/研究獨支.*不一致/);
  }
});

test('every snapshot and decision synchronization identity must match',()=>{
  for(const key of ['inputHash','targetPeriod','cutoffPeriod','modelVersion','storedAt','decisionId','decisionVersion','decisionStatus','researchVersion','researchNumber']){
    const bad=state();bad.sync[key]='wrong';
    assert.throws(()=>verifyState(bad,{ok:true},instant,instant),/跨裝置同步.*不一致/);
  }
  const bad=state();bad.sync.snapshotId='';
  assert.throws(()=>verifyState(bad,{ok:true},instant,instant),/快照識別/);
  assert.throws(()=>verifyState(state(),{ok:true,decision:{ok:true,id:'f'.repeat(64)}},instant,instant),/更新回應獨支決策識別/);
});

test('research requires all four named true checks and a conserving complete ranking',()=>{
  const mutations=[
    q=>{delete q.checks;},
    q=>{q.checks.explanation=false;},
    q=>{delete q.checks.explanation;},
    q=>{q.checks={a:true,b:true,c:true,d:true};},
    q=>{q.ranking.pop();},
    q=>{q.ranking[1].number=1;},
    q=>{q.ranking[1].rank=1;},
    q=>{q.ranking[1].probability=NaN;},
    q=>{q.ranking[1].probability=0;},
    q=>{q.number=2;},
    q=>{q.modelEstimate=0;},
    q=>{q.top5.reverse();},
    q=>{q.top9.reverse();},
    q=>{q.modelSelection.selectedModelId='conditional';},
    q=>{q.modelSelection.experts[0].currentSingle=2;}
  ];
  for(const mutate of mutations){const bad=state();mutate(bad.decision.decision.research);assert.throws(()=>verifyState(bad,{ok:true},instant,instant));}
});

test('missing research is retried and recorded as failed instead of a false success',async()=>{
  const h=harness({getState:at=>{const s=state(at);delete s.decision.decision.research;return s;}});
  const result=await runWatchdog(h.options);
  assert.equal(result.ok,false);assert.match(result.error,/研究獨支缺漏/);
  assert.equal(h.calls.filter(path=>path.startsWith('/api/refresh')).length,3);
  assert.equal(h.saved.length,1);assert.equal(h.saved[0].ok,false);
});

test('mismatched, invalid and stale success cannot produce healthy status',()=>{
  const bad=state();bad.status.state.lastSuccess.inputHash='b'.repeat(64);
  assert.throws(()=>verifyState(bad,{},instant,instant),/資料指紋不一致/);
  assert.throws(()=>verifyState(state(instant-46000),{},instant,instant),/成功紀錄/);
  assert.throws(()=>verifyState(state(instant+31000),{},instant,instant),/成功紀錄/);
  assert.throws(()=>verifyState({report:{}},{},instant,instant),/成功紀錄/);
});

test('busy job never accepts recent but older success as completed',async()=>{
  const h=harness({refresh:{ok:true,busy:true},getState:()=>state(instant-1000)});
  const result=await runWatchdog(h.options);
  assert.equal(result.ok,false);assert.equal(h.calls.filter(path=>path.startsWith('/api/refresh')).length,3);
  assert.equal(h.calls.filter(path=>path==='/api/state').length,21);assert.equal(h.saved[0].ok,false);
});

test('busy job succeeds only after its fresh completion appears',async()=>{
  const h=harness({refresh:{ok:true,busy:true},getState:at=>state(at===instant?instant-1000:at)});
  assert.equal((await runWatchdog(h.options)).ok,true);assert.deepEqual(h.sleeps,[5000]);
});

test('transport ignoring abort is still bounded',async()=>{
  const started=Date.now();
  await assert.rejects(requestJson('/api/state',{deadline:started+1000,timeoutMs:20,fetchImpl:()=>new Promise(()=>{})}),/逾時/);
  assert.ok(Date.now()-started<1000);
});

test('stalled response body is still bounded',async()=>{
  const started=Date.now();
  await assert.rejects(requestJson('/api/state',{deadline:started+1000,timeoutMs:20,fetchImpl:async()=>({ok:true,status:200,json:()=>new Promise(()=>{})})}),/逾時/);
  assert.ok(Date.now()-started<1000);
});

test('overall deadline bounds a hung run and saves a failed heartbeat',async()=>{
  const saved=[];let calls=0;const started=Date.now();
  const result=await runWatchdog({budgetMs:25,fetchImpl:()=>{calls++;return new Promise(()=>{});},saveHeartbeat:async value=>saved.push(value),log:()=>{},logError:()=>{}});
  assert.equal(result.ok,false);assert.equal(saved.length,1);assert.ok(calls<=3);assert.ok(Date.now()-started<1000);
});

test('Retry-After is honored within the shared budget',async()=>{
  let failed=false;
  const h=harness({customFetch:path=>{if(path==='/api/action'&&!failed){failed=true;return response({message:'rate limited'},429,'7');}}});
  assert.equal((await runWatchdog(h.options)).ok,true);assert.deepEqual(h.sleeps,[7000]);assert.ok(h.calls.includes('/api/refresh?mode=repair'));
});

test('Retry-After beyond remaining budget stops without retrying early',async()=>{
  const h=harness({customFetch:()=>response({message:'rate limited'},429,'400')});
  assert.equal((await runWatchdog(h.options)).ok,false);assert.equal(h.calls.length,1);assert.deepEqual(h.sleeps,[]);
});

test('Retry-After survives an invalid error body and supports HTTP dates',async()=>{
  const response={ok:false,status:503,headers:{get:()=>new Date(instant+9000).toUTCString()},json:async()=>{throw new Error('HTML response');}};
  await assert.rejects(requestJson('/api/action',{deadline:instant+60000,now:()=>instant,fetchImpl:async()=>response}),error=>error.retryAfterMs===9000&&/格式無效/.test(error.message));
});

test('stalled heartbeat cannot keep the watchdog alive without a deadline',async()=>{
  const started=Date.now();let signal;
  await assert.rejects(saveHeartbeatBounded({},async(_,{signal:received})=>{signal=received;await new Promise(()=>{});},20),/心跳寫入逾時/);
  assert.equal(signal.aborted,true);assert.ok(Date.now()-started<1000);
});

test('heartbeat failure is reported and never presented as a successful run',async()=>{
  const h=harness();h.options.saveHeartbeat=async()=>{throw new Error('disk unavailable');};
  assert.equal((await runWatchdog(h.options)).ok,false);
});

test('repair attempts stop at three and never record success on API failure',async()=>{
  const h=harness({refresh:{ok:false,message:'unavailable'}});
  assert.equal((await runWatchdog(h.options)).ok,false);assert.equal(h.calls.length,6);assert.equal(h.saved.length,1);assert.equal(h.saved[0].ok,false);
});

// Re-sign altered fixtures to prove the structural checks, not just a digest
// mismatch, reject corrupt or late publication contracts. Never production data.
function rebindPublication(s){
 const d=s.decision.decision=seal(s.decision.decision),g=s.groups.snapshot;
 g.sourceDecisionId=d.id;s.groups.snapshot=seal(g);
 const p=s.verification.report;p.decisionId=d.id;p.groupSnapshotId=s.groups.snapshot.id;
 s.verification.report=seal(p);
 const six=s.sixCombinations.snapshot;six.sourceVerificationId=s.verification.report.id;six.sourceVerificationStoredAt=p.storedAt;
 s.sixCombinations.snapshot=seal(six);
 Object.assign(s.sync,{decisionId:d.id,groupSnapshotId:s.groups.snapshot.id,groupSourceDecisionId:d.id,verificationId:s.verification.report.id,sixCombinationId:s.sixCombinations.snapshot.id,sixSourceVerificationId:s.verification.report.id,snapshotId:digest([s.report.modelVersion,s.report.targetPeriod,s.report.inputHash,s.report.storedAt,d.id,s.groups.snapshot.id,s.verification.report.id,s.sixCombinations.snapshot.id])});
 return s;
}

test('all original groups, twenty-check proof and fifty-module fusion must exist before healthy publication',()=>{
 for(const mutate of [s=>delete s.groups,s=>s.groups.ready=false,s=>s.groups.archiveVerified=false,s=>delete s.verification,s=>s.verification.ready=false,s=>delete s.verification.report.fifty,s=>s.verification.report.fifty.modules.pop(),s=>s.verification.report.fifty.moduleCount=49,s=>s.verification.report.fifty.fusion=null,s=>delete s.sixCombinations,s=>s.sixCombinations.ready=false]){
  const s=stateV3();mutate(s);assert.throws(()=>verifyState(s,{ok:true},instant,instant));
 }
});

test('immutable decision, group, proof and SIX payload IDs are recomputed on every readback',()=>{
 for(const select of [s=>s.decision.decision,s=>s.groups.snapshot,s=>s.verification.report,s=>s.sixCombinations.snapshot]){
  const s=stateV3(),saved=select(s);saved.unsealedChange=true;
  assert.throws(()=>verifyState(s,{ok:true},instant,instant),/封存內容識別不一致/);
 }
});

test('re-digested incomplete twenty-check proofs and altered fifty configurations cannot pass',()=>{
 for(const mutate of [p=>p.requiredCount=10,p=>p.passedCount=19,p=>p.checks.pop(),p=>p.checks[0].passed=false,p=>p.checks[1].id=p.checks[0].id,p=>p.passes.fifty=1,p=>p.coverage.fiftyModules=49,p=>p.fifty.modules.pop(),p=>p.fifty.modules[24].parameters.prior=999,p=>p.fifty.modules[24].stats.singleHits++,p=>p.fifty.fusion.weights[0].weight+=0.001,p=>p.fifty.fusion.ranking[0].probability+=0.001,p=>p.fifty.fusion.groups[0].minHits=1,p=>p.fifty.numericChecks.valuesVerified--]){
  const s=stateV3();mutate(s.verification.report);rebindPublication(s);
  assert.throws(()=>verifyState(s,{ok:true},instant,instant));
 }
});

test('re-digested late or source-predating proof and SIX seals remain invalid',()=>{
 for(const mutate of [s=>s.verification.report.storedAt=s.report.targetDate+'T12:30:00.000Z',s=>s.verification.report.generatedAt=s.report.targetDate+'T12:30:00.000Z',s=>s.verification.report.generatedAt=new Date(Date.parse(s.groups.snapshot.storedAt)-1).toISOString(),s=>{s.sixCombinations.snapshot.generatedAt=s.report.targetDate+'T12:30:00.000Z';s.sixCombinations.snapshot.storedAt=s.sixCombinations.snapshot.generatedAt},s=>{s.sixCombinations.snapshot.generatedAt=new Date(Date.parse(s.verification.report.storedAt)-1).toISOString();s.sixCombinations.snapshot.storedAt=s.sixCombinations.snapshot.generatedAt}]){
  const s=stateV3();mutate(s);rebindPublication(s);assert.throws(()=>verifyState(s,{ok:true},instant,instant));
 }
});

test('re-digested SIX must retain exact five-thousand-five top ten, full-history labels and source binding',()=>{
 for(const mutate of [s=>s.sixCombinations.snapshot.groups.pop(),s=>s.sixCombinations.snapshot.pool.reverse(),s=>s.sixCombinations.snapshot.groups[0].numbers[5]=39,s=>s.sixCombinations.snapshot.groups[0].expectedHits+=0.01,s=>s.sixCombinations.snapshot.groups[0].history.all.totalHits++,s=>s.sixCombinations.snapshot.evaluation.publishedPerformance=true,s=>s.sixCombinations.snapshot.policy.candidateCount=10,s=>s.sixCombinations.snapshot.sourceFiftyVersion='old',s=>s.sixCombinations.snapshot.targetPeriod++]){
  const s=stateV3();mutate(s);rebindPublication(s);assert.throws(()=>verifyState(s,{ok:true},instant,instant));
 }
});

test('new proof, groups and SIX readback IDs must match sync and the refresh receipt',()=>{
 for(const key of ['groupSnapshotId','groupVersion','groupSourceDecisionId','verificationId','verificationVersion','sixCombinationId','sixCombinationVersion','sixSourceVerificationId']){
  const s=stateV3();s.sync[key]='f'.repeat(64);assert.throws(()=>verifyState(s,{ok:true},instant,instant),/同步識別/);
 }
 for(const key of ['groups','verification','sixCombinations'])assert.throws(()=>verifyState(stateV3(),{ok:true,[key]:{ok:true,id:'f'.repeat(64)}},instant,instant),/更新回應/);
 const s=stateV3();s.sync.snapshotId='f'.repeat(64);assert.throws(()=>verifyState(s,{ok:true},instant,instant),/完整跨裝置快照/);
});

test('throttled skipped responses never hide a SIX, fifty, group or live-review failure',async()=>{
 for(const mutate of [s=>{s.sixCombinations.ready=false;s.status.state.sixCombinationError={message:'SIX failed'}},s=>{s.verification.ready=false;s.status.state.verificationError={message:'fifty failed'}},s=>s.status.state.groupError={message:'groups failed'},s=>s.status.state.updateProgress={stage:'proof',inputHash:s.report.inputHash},s=>s.groupReviewError='failed',s=>s.fiftyReviewError='failed',s=>s.sixReviewError='failed']){
  const h=harness({refresh:{ok:true,skipped:true},getState:at=>{const s=stateV3(at);mutate(s);return s}}),result=await runWatchdog(h.options);
  assert.equal(result.ok,false);assert.equal(h.saved.length,1);assert.equal(h.saved[0].ok,false);assert.equal(h.calls.filter(path=>path.startsWith('/api/refresh')).length,3);
 }
});

test('phase-one pending checkpoint is retried with a new capability and only phase-two readback is healthy',async()=>{
 let refreshes=0;
 const h=harness({customFetch:path=>{if(path.startsWith('/api/refresh')&&++refreshes===1)return response({ok:false,pending:true,sourceOk:true,message:'核心已保存，等候五十模組驗證'},202)}});
 const result=await runWatchdog(h.options);
 assert.equal(result.ok,true);assert.equal(refreshes,2);assert.ok(h.calls.includes('/api/refresh?mode=repair'));assert.equal(h.calls.filter(path=>path==='/api/action').length,2);assert.equal(h.saved.length,1);assert.equal(h.saved[0].ok,true);
 assert.throws(()=>verifyState(stateV3(),{ok:true,pending:true},instant,instant),/分階段運算/);
 const inProgress=stateV3();inProgress.status.state.updateProgress={stage:'report_verification'};assert.throws(()=>verifyState(inProgress,{ok:true},instant,instant),/分階段運算/);
 const pending=harness({refresh:{ok:false,pending:true,sourceOk:true,message:'pending'}});assert.equal((await runWatchdog(pending.options)).ok,false);assert.equal(pending.saved[0].ok,false);assert.equal(pending.calls.includes('/api/state'),false);
});

// Isolated completed-history output structure, not a historical model replay or
// a claim that these chosen numbers were ever published before an actual draw.
function completedHistory(s=stateV3()){
 const r=s.report,value=historicalEnvelope(r),drawn=[1,6,10,20,30],date=r.input.lastDate,previous=new Date(date+'T00:00:00Z');previous.setUTCDate(previous.getUTCDate()-1);
 const base={sourceVerificationId:'b'.repeat(64),sourceFiftyVersion:FIFTY_VERSION,inputHash:'c'.repeat(64),period:r.cutoffPeriod,date,cutoffPeriod:r.cutoffPeriod-1,cutoffDate:previous.toISOString().slice(0,10),storedAt:date+'T10:00:00.000Z',status:'completed',drawn};
 value.fiftyReviews=[{...base,kind:'fifty_fusion_live',sourceVerificationVersion:REPORT_VERIFICATION_VERSION,number:1,singleHit:true,groups:s.verification.report.fifty.fusion.groups.map(({id,size,label,minHits,maxHits,numbers})=>{const hits=numbers.filter(n=>drawn.includes(n));return {id,size,label,minHits,maxHits,numbers:[...numbers],hits,hitCount:hits.length,targetMet:hits.length>=minHits&&hits.length<=maxHits}})}];
 value.sixReviews=[{...base,kind:'six_combinations_live',id:'d'.repeat(64),combinationSnapshotId:'d'.repeat(64),storedAt:date+'T10:00:01.000Z',groups:s.sixCombinations.snapshot.groups.map(({id,rank,numbers,expectedHits})=>{const hits=numbers.filter(n=>drawn.includes(n));return {id,rank,numbers:[...numbers],expectedHits,hits,hitCount:hits.length}})}];
 return value;
}

test('deferred current-state history becomes healthy only after the bound historical endpoint completes',async()=>{
 const h=harness({getState:at=>({...stateV3(at),historicalReviewsDeferred:true}),getReviews:(_at,s)=>completedHistory(s)}),result=await runWatchdog(h.options);
 assert.equal(result.ok,true);assert.equal(result.historicalReviewsVerified,true);assert.equal(result.fiftyReviewCount,1);assert.equal(result.sixReviewCount,1);assert.equal(result.historyReceiptId.length,64);assert.equal(h.calls.filter(path=>path==='/api/reviews').length,1);assert.equal(h.saved[0].historyReceiptId,result.historyReceiptId);
 assert.deepEqual(h.calls,['/api/action','/api/refresh','/api/state','/api/reviews']);
});

test('historical readback cannot be missing, still deferred, malformed or bound to a stale official prefix',()=>{
 const s=stateV3();
 for(const mutate of [v=>delete v.inputHash,v=>v.inputHash='f'.repeat(64),v=>v.latestPeriod--,v=>v.targetPeriod++,v=>v.sourceLastDate='2026-10-08',v=>v.fiftyReviewError='replay failed',v=>delete v.fiftyReviewError,v=>v.sixReviewError='source failed',v=>delete v.sixReviewError,v=>delete v.fiftyReviews,v=>v.fiftyReviews={},v=>delete v.sixReviews,v=>v.sixReviews=null,v=>v.historicalReviewsDeferred=true,v=>v.deferred=true,v=>v.pending=true,v=>v.ready=false]){
  const value=completedHistory(s);mutate(value);assert.throws(()=>verifyHistoricalReviews(value,s.report,instant));
 }
 for(const value of [undefined,null,{},s])assert.throws(()=>verifyHistoricalReviews(value,s.report,instant));
});

test('completed historical rows reject invalid, pending, future, late or mismatched result records',()=>{
 const s=stateV3();
 for(const mutate of [v=>v.fiftyReviews[0].status='invalid',v=>v.fiftyReviews[0].status='pending',v=>v.sixReviews[0].status='invalid',v=>v.sixReviews[0].status='pending',v=>v.fiftyReviews[0].period=s.report.targetPeriod,v=>v.fiftyReviews[0].cutoffPeriod=s.report.cutoffPeriod,v=>v.fiftyReviews[0].date=s.report.targetDate,v=>v.fiftyReviews[0].storedAt=v.fiftyReviews[0].date+'T12:30:00.000Z',v=>v.sixReviews[0].storedAt=new Date(Date.parse(v.fiftyReviews[0].storedAt)-1).toISOString(),v=>v.fiftyReviews[0].sourceVerificationVersion='old',v=>v.sixReviews[0].sourceVerificationId='f'.repeat(64),v=>v.sixReviews[0].inputHash='f'.repeat(64),v=>v.sixReviews[0].drawn=[1,2,3,4,5],v=>v.sixReviews[0].id='f'.repeat(64),v=>v.fiftyReviews.push(structuredClone(v.fiftyReviews[0])),v=>v.sixReviews.push(structuredClone(v.sixReviews[0]))]){
  const value=completedHistory(s);mutate(value);assert.throws(()=>verifyHistoricalReviews(value,s.report,instant));
 }
 const value=completedHistory(s);assert.throws(()=>verifyHistoricalReviews(value,s.report,Date.parse(value.fiftyReviews[0].storedAt)),/尚未開獎/);
});

test('historical actual-hit math is independently checked instead of accepting completed flags',()=>{
 const s=stateV3();
 for(const mutate of [v=>v.fiftyReviews[0].singleHit=false,v=>v.fiftyReviews[0].drawn[1]=1,v=>v.fiftyReviews[0].groups[2].hitCount++,v=>v.fiftyReviews[0].groups[0].targetMet=true,v=>v.fiftyReviews[0].groups[4].numbers.reverse(),v=>v.sixReviews[0].groups.pop(),v=>v.sixReviews[0].groups[0].hits=[],v=>v.sixReviews[0].groups[1].hitCount++,v=>v.sixReviews[0].groups[1].numbers=[...v.sixReviews[0].groups[0].numbers],v=>v.sixReviews[0].groups[1].expectedHits=5.1]){
  const value=completedHistory(s);mutate(value);assert.throws(()=>verifyHistoricalReviews(value,s.report,instant));
 }
});

test('failed, deferred or missing historical endpoint never produces a successful watchdog heartbeat',async()=>{
 for(const fetchHistory of [()=>response({message:'historical endpoint unavailable'},404),()=>response({message:'historical replay failed'},503),()=>response({deferred:true},202),()=>response(null)]){
  const h=harness({customFetch:path=>path==='/api/reviews'?fetchHistory():undefined}),result=await runWatchdog(h.options);
  assert.equal(result.ok,false);assert.equal(h.saved.length,1);assert.equal(h.saved[0].ok,false);assert.equal(h.calls.filter(path=>path==='/api/reviews').length,3);
 }
 for(const mutate of [v=>v.latestPeriod--,v=>v.inputHash='f'.repeat(64),v=>v.fiftyReviews[0].status='invalid',v=>v.sixReviews[0].status='pending']){
  const h=harness({getReviews:(_at,s)=>{const value=completedHistory(s);mutate(value);return value}}),result=await runWatchdog(h.options);
  assert.equal(result.ok,false);assert.equal(h.saved[0].ok,false);
 }
});

test('a hung historical endpoint respects the shared request budget and saves failed health',async()=>{
 const started=Date.now(),h=harness({budgetMs:25,customFetch:path=>path==='/api/reviews'?new Promise(()=>{}):undefined}),result=await runWatchdog(h.options);
 assert.equal(result.ok,false);assert.match(result.error,/逾時/);assert.equal(h.saved[0].ok,false);assert.equal(h.calls.filter(path=>path==='/api/reviews').length,3);assert.ok(Date.now()-started<2000);
});

test('the structural watchdog has no model-replay or Site-checkout dependency',async()=>{
 const sources=await Promise.all(['update.mjs','publication-contract.mjs','fifty-policy.mjs','report-verification-policy.mjs'].map(file=>readFile(new URL('../scripts/'+file,import.meta.url),'utf8')));
 for(const source of sources)assert.ok(!/from\s+['"](?:\.\.\/.*lib\/|.*(?:fifty-modules|report-verification|cloud)\.(?:ts|mjs)['"])/.test(source));
});

test('night five-minute and off-night hourly catch-up crons never overlap and reserve runner time',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/update.yml',import.meta.url),'utf8');
  assert.match(workflow,/cron: '2-57\/5 12-15 \* \* \*'/);assert.match(workflow,/timeout-minutes: 8/);
  assert.match(workflow,/cron: '17 0-11,16-23 \* \* \*'/);
  const nightHours=[12,13,14,15],catchupHours=Array.from({length:24},(_,i)=>i).filter(i=>i<=11||i>=16);
  assert.equal(nightHours.some(hour=>catchupHours.includes(hour)),false);assert.equal(new Set([...nightHours,...catchupHours]).size,24);
  assert.match(workflow,/node --test tests\/update.test.mjs/);
  assert.equal(TOTAL_BUDGET_MS,360000);assert.ok(TOTAL_BUDGET_MS<8*60*1000);
});

test('non-main dispatch cannot update production or push branch code into main',async()=>{
  const workflow=(await readFile(new URL('../.github/workflows/update.yml',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
  assert.match(workflow,/- name: 真實更新、修復與公開讀回\n        if: github.ref == 'refs\/heads\/main'\n/);
  assert.match(workflow,/- name: 保存真實健康心跳\n        if: always\(\) && github.ref == 'refs\/heads\/main'\n/);
  assert.match(workflow,/- name: 驗證逾時、期別與排程防護\n        run: node --test tests\/update.test.mjs/);
});
