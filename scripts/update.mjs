import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

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
  const publicationDeadline=Date.parse(report.targetDate+'T22:00:00+08:00');
  assert.ok(Number.isFinite(publicationDeadline),'目標日期無效');
  if(checkedAt>publicationDeadline)throw new Error('台北22:00完整結果預計公布後仍未取得新期，立即啟動檢修');
  return {report,success};
}

export async function heartbeat(value,{signal}={}){
  const path='status/last-check.json';await mkdir('status',{recursive:true});
  signal?.throwIfAborted();
  let previous;try{previous=JSON.parse(await readFile(path,{encoding:'utf8',signal}));}catch{}
  signal?.throwIfAborted();
  const key=JSON.stringify([value.day,value.ok,value.latestPeriod,value.targetPeriod,value.inputHash,value.error]);
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
  if(event==='schedule'&&!scheduledWindow(started)){
    log('不在已確認開獎日的更新時段，略過');return {ok:true,skipped:true};
  }
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
      const {report,success}=verifyState(state,result,started,now());
      const {day}=taipeiTime(now());
      const value={day,ok:true,latestPeriod:report.cutoffPeriod,latestDate:report.input?.lastDate,targetPeriod:report.targetPeriod,targetDate:report.targetDate,inputHash:report.inputHash};
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
  const value={day:taipeiTime(now()).day,ok:false,error};
  try{await saveHeartbeatBounded(value,saveHeartbeat,heartbeatTimeoutMs);}catch(e){value.error+='；'+messageOf(e);logError(messageOf(e));}
  return value;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=await runWatchdog();if(!result.ok)process.exitCode=1;
}
