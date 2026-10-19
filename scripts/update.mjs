import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {verifyPublication,verifyHistoricalReviews} from './publication-contract.mjs';

export const BASE='https://tw539-fresh-cloud-20261011.ping-shen670888.chatgpt.site';
export const EXTRA_DRAW_DATES=['2025-01-26','2025-02-02','2025-02-09','2026-02-15','2026-02-22','2026-03-01'];
export const TOTAL_BUDGET_MS=6*60*1000;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const messageOf=error=>error instanceof Error?error.message:'雲端檢修錯誤';

export function taipeiTime(timestamp){
  const local=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short'}).format(new Date(timestamp));
  return {day:local.slice(0,10),minutes:Number(local.slice(11,13))*60+Number(local.slice(14,16))};
}

export function scheduledWindow(timestamp){
  const {day,minutes}=taipeiTime(timestamp);
  const weekday=new Date(day+'T00:00:00Z').getUTCDay();
  return minutes>=20*60+30&&minutes<=23*60+10&&(weekday!==0||EXTRA_DRAW_DATES.includes(day));
}

function remaining(deadline,now){
  const milliseconds=deadline-now();
  if(milliseconds<=0)throw new Error('檢查器已達六分鐘總時限，停止重試並保留最後有效資料');
  return milliseconds;
}

function retryDelay(value,now){
  if(!value)return 0;
  const seconds=Number(value);
  const milliseconds=Number.isFinite(seconds)?seconds*1000:Date.parse(value)-now();
  return Number.isFinite(milliseconds)?Math.max(0,milliseconds):0;
}

// The race covers response-body decoding as well as transport. Abort alone is
// insufficient when a transport ignores cancellation or stalls after headers.
export async function requestJson(path,{deadline,now=Date.now,fetchImpl=fetch,timeoutMs=65000,...options}){
  const timeout=Math.min(timeoutMs,remaining(deadline,now));
  const controller=new AbortController();let timer;
  const expired=new Promise((_,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(new Error('雲端連線或回應內容逾時'));},timeout);
  });
  try{
    return await Promise.race([expired,(async()=>{
      const response=await fetchImpl(BASE+path,{...options,signal:controller.signal});
      let data;
      try{data=await response.json();}catch{
        const error=new Error(`雲端回應格式無效，狀態${response.status}`);
        if(!response.ok)error.retryAfterMs=retryDelay(response.headers?.get('retry-after'),now);
        throw error;
      }
      if(!response.ok){
        const error=new Error(data?.message||data?.error||`雲端回應狀態${response.status}`);
        error.retryAfterMs=retryDelay(response.headers?.get('retry-after'),now);
        throw error;
      }
      return data;
    })()]);
  }finally{clearTimeout(timer);}
}

export function verifyState(state,result,started,checkedAt){
  const report=state?.report,success=state?.status?.state?.lastSuccess;
  assert.ok(report&&success,'尚未讀回更新的成功紀錄');
  const succeededAt=Date.parse(success.at);
  assert.ok(Number.isFinite(succeededAt)&&succeededAt>=started-45000&&succeededAt<=checkedAt+30000,'尚未讀回這次更新的成功紀錄');
  assert.ok(Number.isSafeInteger(report.cutoffPeriod)&&Number.isSafeInteger(report.targetPeriod)&&report.targetPeriod>report.cutoffPeriod,'預測期別格式無效');
  assert.match(report.inputHash??'',/^[a-f0-9]{64}$/,'資料指紋格式無效');
  assert.match(report.targetDate??'',/^\d{4}-\d{2}-\d{2}$/,'目標日期格式無效');
  assert.equal(success.latestPeriod,report.cutoffPeriod,'最新期別不一致');
  assert.equal(success.targetPeriod,report.targetPeriod,'目標期別不一致');
  assert.equal(success.inputHash,report.inputHash,'資料指紋不一致');
  if(result.inputHash)assert.equal(result.inputHash,report.inputHash,'更新回應資料指紋不一致');
  const cloudState=state?.status?.state,decision=state?.decision?.decision,sync=state?.sync;
  assert.ok(['lastError','candidateError','decisionError','groupError','verificationError','sixCombinationError'].every(key=>!cloudState?.[key]),'雲端模組仍有未處理故障，不能標示更新成功');
  assert.ok(!cloudState?.updateProgress,'雲端分階段運算仍在進行，不能標示更新成功');
  assert.ok(['groupReviewError','fiftyReviewError','sixReviewError'].every(key=>!state?.[key]),'雲端實戰檢討仍有未處理故障，不能標示更新成功');
  assert.equal(report.archiveVerified,true,'原始封存尚未通過全歷史重算驗證');
  assert.equal(state?.decision?.ready,true,'本期獨支決策尚未完成讀回驗證');
  assert.ok(decision&&sync,'本期獨支決策或跨裝置同步資料缺漏');
  assert.match(decision.id??'',/^[a-f0-9]{64}$/,'獨支決策識別格式無效');
  assert.ok(typeof decision.version==='string'&&decision.version.length>0,'獨支決策版本缺漏');
  assert.equal(decision.targetPeriod,report.targetPeriod,'獨支決策目標期別不一致');
  assert.equal(decision.cutoffPeriod,report.cutoffPeriod,'獨支決策截止期別不一致');
  assert.equal(decision.targetDate,report.targetDate,'獨支決策目標日期不一致');
  assert.equal(decision.inputHash,report.inputHash,'獨支決策資料指紋不一致');
  assert.match(sync.snapshotId??'',/^[a-f0-9]{64}$/,'跨裝置快照識別格式無效');
  for(const key of ['inputHash','targetPeriod','cutoffPeriod','modelVersion','storedAt'])assert.equal(sync[key],report[key],`跨裝置同步${key}不一致`);
  assert.equal(sync.decisionId,decision.id,'跨裝置同步獨支決策識別不一致');
  assert.equal(sync.decisionVersion,decision.version,'跨裝置同步獨支決策版本不一致');
  assert.equal(sync.decisionStatus,decision.status,'跨裝置同步獨支決策狀態不一致');
  if(result.decision?.id)assert.equal(result.decision.id,decision.id,'更新回應獨支決策識別不一致');
  assert.notEqual(result.candidate?.ok,false,'本次更新候選模組未完成');
  assert.notEqual(result.decision?.ok,false,'本次更新獨支決策未完成');
  for(const key of ['groups','verification','sixCombinations'])assert.notEqual(result[key]?.ok,false,'本次更新模組未完成：'+key);
  assert.notEqual(result.pending,true,'本次更新尚在分階段運算，不能標示完成');
  const research=decision.research;
  assert.ok(research,'每日研究獨支缺漏，不能只以原始封存標示成功');
  assert.equal(research.status,'research_only','研究獨支狀態無效，不能自動升級高信心');
  assert.ok(typeof research.version==='string'&&research.version.length>0,'研究獨支版本缺漏');
  assert.ok(Number.isInteger(research.number)&&research.number>=1&&research.number<=39,'研究獨支號碼無效');
  assert.equal(research.targetPeriod,report.targetPeriod,'研究獨支目標期別不一致');
  assert.equal(research.cutoffPeriod,report.cutoffPeriod,'研究獨支截止期別不一致');
  assert.equal(research.targetDate,report.targetDate,'研究獨支目標日期不一致');
  // The immutable decision owns the input hash for the nested research replay.
  // Reject a conflicting nested hash if a future schema supplies one.
  assert.equal(research.inputHash??decision.inputHash,report.inputHash,'研究獨支資料指紋不一致');
  assert.equal(research.trainingDraws,report.input?.count,'研究獨支完整歷史筆數不一致');
  assert.equal(sync.researchVersion,research.version,'跨裝置同步研究獨支版本不一致');
  assert.equal(sync.researchNumber,research.number,'跨裝置同步研究獨支號碼不一致');
  const checks=research.checks;
  assert.ok(checks&&Object.keys(checks).length===4&&['prequential','ranking','marginalSum','explanation'].every(key=>checks[key]===true),'研究獨支四項運算驗證未全部通過');
  const ranking=research.ranking;
  assert.ok(Array.isArray(ranking)&&ranking.length===39&&new Set(ranking.map(x=>x.number)).size===39,'研究獨支39號排名不完整');
  assert.ok(ranking.every((x,i)=>Number.isInteger(x.number)&&x.number>=1&&x.number<=39&&x.rank===i+1&&Number.isFinite(x.probability)&&x.probability>=0&&x.probability<=1),'研究獨支排名欄位無效');
  assert.equal(ranking[0].number,research.number,'研究獨支與排名第一名不一致');
  assert.equal(ranking[0].probability,research.modelEstimate,'研究獨支估計值與排名不一致');
  assert.ok(Math.abs(ranking.reduce((sum,x)=>sum+x.probability,0)-5)<=1e-7,'研究獨支機率總和不等於5');
  assert.ok(JSON.stringify(research.top5)===JSON.stringify(ranking.slice(0,5).map(x=>x.number))&&JSON.stringify(research.top9)===JSON.stringify(ranking.slice(0,9).map(x=>x.number)),'研究獨支前五前九與排名不一致');
  assert.equal(research.modelSelection?.selectedModelId,research.modelId,'研究獨支專家選擇識別不一致');
  assert.ok(research.modelSelection?.experts?.some(x=>x.id===research.modelId&&x.currentSingle===research.number&&x.currentEstimate===research.modelEstimate),'研究獨支與已選專家首選不一致');
  assert.ok(['supported','no_supported_single','stale'].includes(decision.status),'獨支決策狀態無效');
  if(decision.status==='supported'){
    assert.ok(Number.isInteger(decision.selectedNumber)&&decision.selectedNumber>=1&&decision.selectedNumber<=39,'主推薦號碼無效');
    const selected=Array.isArray(decision.candidates)?decision.candidates.find(row=>row.number===decision.selectedNumber):null;
    assert.ok(selected&&selected.eligible===true&&selected.genericSupportPassed===true,'主推薦未通過本號資格與模型支持檢核');
    assert.ok(typeof selected.isRepeat==='boolean'&&(!selected.isRepeat||selected.repeatStatus==='supported'),'連莊主推薦未通過獨立連莊檢核');
    assert.ok(Array.isArray(selected.supportingModels)&&selected.supportingModels.some(model=>model.currentSingle===decision.selectedNumber&&model.validated===true&&model.approvedForSelection===true),'主推薦缺少本號已驗證且已批准的模型');
  }else{
    assert.equal(decision.selectedNumber,null,'未通過主推薦檢核不得填入主推薦號碼');
  }
  if(decision.version==='539-single-verified-diagnostics-v3-20261011'){
    const diagnostics=decision.researchDiagnostics;
    assert.ok(diagnostics,'第三版研究本號診斷缺漏，不能標示更新成功');
    assert.equal(diagnostics.number,research.number,'研究本號診斷號碼不一致');
    for(const key of ['targetDate','targetPeriod','cutoffPeriod'])assert.equal(diagnostics[key],report[key],`研究本號診斷${key}不一致`);
    assert.equal(diagnostics.trainingDraws,research.trainingDraws,'研究本號診斷完整歷史筆數不一致');
    assert.equal(diagnostics.trainingDraws,report.input?.count,'研究本號診斷與原封存歷史筆數不一致');
    const diagnosticsChecks=diagnostics.checks;
    assert.ok(diagnosticsChecks&&Object.keys(diagnosticsChecks).length===4&&['trace','replay','selection','weighting'].every(key=>diagnosticsChecks[key]===true),'研究本號診斷四項驗證未全部通過');
    assert.equal(decision.adoptionReview?.policy?.version,'539-verified-adoption-v1-20261011','模型採用審查政策缺漏或版本不符');
    assert.ok(Array.isArray(decision.adoptionReview.records),'模型採用審查紀錄格式無效');
  }
  const publication=verifyPublication(state,result,checkedAt);
  const publicationDeadline=Date.parse(report.targetDate+'T22:00:00+08:00');
  assert.ok(Number.isFinite(publicationDeadline),'目標日期無效');
  if(checkedAt>publicationDeadline)throw new Error('台北22:00完整結果預計公布後仍未取得新期，立即啟動檢修');
  return {report,success,...publication};
}

export async function heartbeat(value,{signal}={}){
  const path='status/last-check.json';await mkdir('status',{recursive:true});
  signal?.throwIfAborted();
  let previous;try{previous=JSON.parse(await readFile(path,{encoding:'utf8',signal}));}catch{}
  signal?.throwIfAborted();
  const key=JSON.stringify([value.day,value.checkHour,value.ok,value.latestPeriod,value.targetPeriod,value.inputHash,value.decisionId,value.groupSnapshotId,value.verificationId,value.sixCombinationId,value.historyReceiptId,value.error]);
  if(previous?.key===key)return;
  await writeFile(path,JSON.stringify({...value,key,checkedAt:new Date().toISOString()},null,2)+'\n',{signal});
}

export async function saveHeartbeatBounded(value,save=heartbeat,timeoutMs=10000){
  const controller=new AbortController();let timer;
  const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{
    controller.abort();const error=new Error('健康心跳寫入逾時，未確認保存成功');error.name='HeartbeatTimeoutError';reject(error);
  },timeoutMs);});
  try{return await Promise.race([expired,save(value,{signal:controller.signal})]);}
  finally{clearTimeout(timer);}
}

export async function runWatchdog({event=process.env.TW539_EVENT,now=Date.now,fetchImpl=fetch,sleep=pause,saveHeartbeat=heartbeat,log=console.log,logError=console.error,budgetMs=TOTAL_BUDGET_MS,heartbeatTimeoutMs=10000}={}){
  const started=now(),deadline=started+budgetMs;
  // GitHub may start a queued night schedule hours late. Always ask the Site
  // for the actual latest official data, including Sunday/next-day catch-up;
  // only the Site calendar chooses the next draw. Never backdate a forecast.
  if(event==='schedule'&&!scheduledWindow(started))log('延遲或非夜間排程：實際核對官方最新期別並補行檢修');
  const json=(path,options={})=>requestJson(path,{...options,deadline,now,fetchImpl});
  let error='';
  for(let attempt=0;attempt<3;attempt++){
    try{
      remaining(deadline,now);
      const attemptStarted=now();
      const {token}=await json('/api/action');assert.match(token??'',/^[a-f0-9-]{36}$/);
      const result=await json('/api/refresh'+(attempt?'?mode=repair':''),{method:'POST',timeoutMs:105000,headers:{'x-update-token':token}});
      if(!result?.ok)throw new Error(result?.message||'雲端更新失敗');
      let state;
      for(let poll=0;poll<7;poll++){
        state=await json('/api/state');
        const successAt=Date.parse(state?.status?.state?.lastSuccess?.at);
        // A busy response must wait for the in-flight job, not accept an older
        // success merely because it happens to be less than 45 seconds old.
        if(!result.busy||successAt>=attemptStarted)break;
        if(poll<6){const available=remaining(deadline,now);if(available<=5000)throw new Error('檢查器剩餘時間不足，停止等待更新工作');await sleep(5000);}
      }
      if(result.busy&&Date.parse(state?.status?.state?.lastSuccess?.at)<attemptStarted)throw new Error('雲端工作仍在執行，尚未取得新的成功紀錄');
      remaining(deadline,now);
      const {report,success,groups,proof,six}=verifyState(state,result,started,now());
      // Current publication and historical semantic replay use separate Worker
      // requests. A successful current state cannot hide deferred review work.
      const historical=verifyHistoricalReviews(await json('/api/reviews'),report,now());
      const {day,minutes}=taipeiTime(now());
      const value={day,checkHour:Math.floor(minutes/60),ok:true,latestPeriod:report.cutoffPeriod,latestDate:report.input?.lastDate,targetPeriod:report.targetPeriod,targetDate:report.targetDate,inputHash:report.inputHash,decisionId:state.decision.decision.id,groupSnapshotId:groups.id,verificationId:proof.id,sixCombinationId:six.id,...historical};
      await saveHeartbeatBounded(value,saveHeartbeat,Math.min(heartbeatTimeoutMs,remaining(deadline,now)));
      log(JSON.stringify({...value,sourceCheckedAt:success.at,message:result.message}));return value;
    }catch(e){
      error=messageOf(e);logError(`第${attempt+1}次：${error}`);
      const available=deadline-now();
      if(available<=0||e?.name==='HeartbeatTimeoutError')break;
      if(attempt<2&&e?.retryAfterMs>0){
        if(e.retryAfterMs>=available){error='來源要求稍後重試，超過本次檢查時限；保留最後有效資料';break;}
        await sleep(e.retryAfterMs);
      }
    }
  }
  const checked=taipeiTime(now()),value={day:checked.day,checkHour:Math.floor(checked.minutes/60),ok:false,error};
  try{await saveHeartbeatBounded(value,saveHeartbeat,heartbeatTimeoutMs);}catch(e){value.error+='；'+messageOf(e);logError(messageOf(e));}
  return value;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=await runWatchdog();if(!result.ok)process.exitCode=1;
}
