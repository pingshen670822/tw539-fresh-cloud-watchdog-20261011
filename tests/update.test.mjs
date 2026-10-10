import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {requestJson,runWatchdog,scheduledWindow,verifyState,saveHeartbeatBounded,TOTAL_BUDGET_MS} from '../scripts/update.mjs';

const instant=Date.parse('2026-10-10T21:40:00+08:00');
const token='12345678-1234-1234-1234-123456789abc';
const hash='a'.repeat(64);
function state(at=instant,targetDate='2026-10-10'){
  return {report:{cutoffPeriod:115000244,targetPeriod:115000245,targetDate,inputHash:hash,input:{lastDate:'2026-10-09'}},status:{state:{lastSuccess:{at:new Date(at).toISOString(),latestPeriod:115000244,targetPeriod:115000245,inputHash:hash}}}};
}
const response=(data,status=200,retryAfter)=>({ok:status>=200&&status<300,status,headers:{get:name=>name==='retry-after'?retryAfter:null},json:async()=>data});
function harness({at=instant,event='workflow_dispatch',refresh={ok:true},getState,customFetch,budgetMs}={}){
  let current=at;const calls=[],saved=[],sleeps=[];
  const options={event,now:()=>current,saveHeartbeat:async value=>saved.push(value),log:()=>{},logError:()=>{},sleep:async ms=>{sleeps.push(ms);current+=ms;},fetchImpl:async(url,options)=>{
    const path=new URL(url).pathname+new URL(url).search;calls.push(path);
    if(customFetch){const custom=await customFetch(path,options,calls.length);if(custom)return custom;}
    if(path==='/api/action')return response({token});
    if(path.startsWith('/api/refresh'))return response(refresh);
    return response(getState?getState(current):state(current));
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

test('ordinary Sunday schedule performs no requests or heartbeat writes',async()=>{
  const h=harness({at:Date.parse('2026-10-11T21:40:00+08:00'),event:'schedule'});
  assert.equal((await runWatchdog(h.options)).skipped,true);assert.deepEqual(h.calls,[]);assert.deepEqual(h.saved,[]);
});

test('manual Sunday invocation remains available',async()=>{
  const at=Date.parse('2026-10-11T21:40:00+08:00');
  const h=harness({at,getState:()=>state(at,'2026-10-12')});
  assert.equal((await runWatchdog(h.options)).ok,true);assert.equal(h.calls.length,3);
});

test('21:40 pending official publication is healthy; stale after22:00 is rejected',()=>{
  assert.doesNotThrow(()=>verifyState(state(),{ok:true},instant,instant));
  const late=Date.parse('2026-10-10T22:00:01+08:00');
  assert.throws(()=>verifyState(state(late),{ok:true},late,late),/22:00/);
});

test('successful run validates and records current data',async()=>{
  const h=harness();const result=await runWatchdog(h.options);
  assert.equal(result.ok,true);assert.equal(h.saved.length,1);assert.equal(result.inputHash,hash);assert.equal(h.calls.length,3);
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

test('daily cron delegates Sunday gating to the script and reserves runner time',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/update.yml',import.meta.url),'utf8');
  assert.match(workflow,/cron: '2-57\/5 12-15 \* \* \*'/);assert.match(workflow,/timeout-minutes: 8/);
  assert.match(workflow,/node --test tests\/update.test.mjs/);
  assert.equal(TOTAL_BUDGET_MS,360000);assert.ok(TOTAL_BUDGET_MS<8*60*1000);
});

test('non-main dispatch cannot update production or push branch code into main',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/update.yml',import.meta.url),'utf8');
  assert.match(workflow,/- name: 真實更新、修復與公開讀回\n        if: github.ref == 'refs\/heads\/main'\n/);
  assert.match(workflow,/- name: 保存真實健康心跳\n        if: always\(\) && github.ref == 'refs\/heads\/main'\n/);
  assert.match(workflow,/- name: 驗證逾時、期別與排程防護\n        run: node --test tests\/update.test.mjs/);
});
