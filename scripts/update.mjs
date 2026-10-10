import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const base='https://tw539-fresh-cloud-20261011.ping-shen670888.chatgpt.site';
const started=Date.now(),stamp=()=>new Date().toISOString();
const local=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short'}).format(new Date());
const minutes=+local.slice(11,13)*60+ +local.slice(14,16);
if(process.env.TW539_EVENT==='schedule'&&(minutes<20*60+30||minutes>23*60+10)){console.log('不在開獎更新時段，略過');process.exit(0)}
async function json(path,options={}){const r=await fetch(base+path,{...options,signal:AbortSignal.timeout(options.method?105000:65000)});let data;try{data=await r.json()}catch{throw new Error(`雲端回應格式無效，狀態${r.status}`)}if(!r.ok)throw new Error(data.message||data.error||`雲端回應狀態${r.status}`);return data}
async function heartbeat(value){const path='status/last-check.json';await mkdir('status',{recursive:true});let previous;try{previous=JSON.parse(await readFile(path,'utf8'))}catch{}const key=JSON.stringify([value.day,value.ok,value.latestPeriod,value.targetPeriod,value.inputHash,value.error]);if(previous?.key===key)return;await writeFile(path,JSON.stringify({...value,key,checkedAt:stamp()},null,2)+'\n')}
let error='';
for(let attempt=0;attempt<3;attempt++){
  try{
    const {token}=await json('/api/action');assert.match(token,/^[a-f0-9-]{36}$/);
    const result=await json('/api/refresh'+(attempt?'?mode=repair':''),{method:'POST',headers:{'x-update-token':token}});
    if(!result.ok)throw new Error(result.message||'雲端更新失敗');
    let state;
    for(let poll=0;poll<7;poll++){
      state=await json('/api/state');
      if(!result.busy||Date.parse(state.status.state.lastSuccess?.at)>=started-45000)break;
      if(poll<6)await new Promise(resolve=>setTimeout(resolve,5000));
    }
    const report=state.report,success=state.status.state.lastSuccess;
    assert.ok(success&&Date.parse(success.at)>=started-45000,'尚未讀回這次更新的成功紀錄');
    assert.equal(success.latestPeriod,report.cutoffPeriod,'最新期別不一致');
    assert.equal(success.targetPeriod,report.targetPeriod,'目標期別不一致');
    assert.equal(success.inputHash,report.inputHash,'資料指紋不一致');
    if(result.inputHash)assert.equal(result.inputHash,report.inputHash);
    if(Date.now()>Date.parse(report.targetDate+'T21:10:00+08:00'))throw new Error('開獎後三十分鐘仍未取得新期，立即啟動檢修');
    const value={day:local.slice(0,10),ok:true,latestPeriod:report.cutoffPeriod,latestDate:report.input.lastDate,targetPeriod:report.targetPeriod,targetDate:report.targetDate,inputHash:report.inputHash};
    await heartbeat(value);console.log(JSON.stringify({...value,sourceCheckedAt:success.at,message:result.message}));process.exit(0);
  }catch(e){error=e instanceof Error?e.message:'雲端檢修錯誤';console.error(`第${attempt+1}次：${error}`)}
}
await heartbeat({day:local.slice(0,10),ok:false,error});process.exitCode=1;
