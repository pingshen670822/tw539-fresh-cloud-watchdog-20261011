// Pinned publication contract. Structural/readback checks only; no model replay.
export const FIFTY_VERSION='539-fifty-prior-only-v1-20261015';
const frozen=object=>Object.freeze(object);
const configs=[];
function register(family,familyName,name,parameters){configs.push(frozen({id:`f50_${String(configs.length+1).padStart(2,'0')}`,family,familyName,name,parameters:frozen(parameters)}))}
register('uniform','均勻基準','均勻基準',{});
for(const prior of [10,25,50,100,200,400])register('full_bayes','全期貝氏',`全期貝氏・收縮${prior}`,{prior});
for(const window of [10,20,40,60,120,240,480,960])register('window_bayes','全期骨幹滑窗',`全期骨幹・最近${window}期`,{window,prior:100});
for(const halfLife of [10,20,40,60,120,240,480,960])register('discount_bayes','指數折扣貝氏',`指數折扣・半衰期${halfLife}`,{halfLife,prior:100});
for(const bins of ['coarse','fine'])for(const prior of [25,50,100,200])register('gap_conditional','間隔條件',`間隔${bins==='coarse'?'五':'七'}分箱・收縮${prior}`,{bins,prior});
for(const prior of [10,25,50,100,200,400])register('weekday_conditional','星期條件',`星期條件・收縮${prior}`,{prior});
for(const lag of [1,2,3,5])for(const prior of [100,400])register('lag_conditional','拖牌條件',`${lag}期拖牌・收縮${prior}`,{lag,prior});
for(const prior of [25,50,100,200,400])register('repeat_conditional','連莊條件',`連莊條件・收縮${prior}`,{prior});
export const FIFTY_CONFIGS=frozen(configs);
export const FIFTY_GROUPS=frozen([{size:2,minHits:2,maxHits:2,label:'二中二'},{size:3,minHits:3,maxHits:3,label:'三中三'},{size:5,minHits:5,maxHits:5,label:'五中五'},{size:7,minHits:5,maxHits:5,label:'七中五'},{size:9,minHits:5,maxHits:5,label:'九中五'}].map(frozen));
export const FIFTY_POLICY=frozen({version:FIFTY_VERSION,moduleCount:50,familyCount:8,warmup:200,probabilityTotal:5,probabilityTolerance:1e-7,
 configuration:'固定五十組配置；參數預先登錄，不依本次歷史結果搜尋或刪除失敗組',
 history:'每組從全歷史第一期開始逐期更新；近期及條件特徵以當時全期貝氏估計收縮，均勻組為理論對照',
 evaluation:'回溯探索；每期先預測與評分後才更新，暖機二百期後評估全部歷史，不是已發布實戰紀錄',
 familyDependence:'八個算法家族含五十組參數配置；同家族變體與共用資料不是五十份獨立證據',
 fusion:'八家族等權；家族內以截至前一期累計Brier損失 exp(-1×lossSum) 正規化，先融合評分再更新',
 promotion:'只新增研究結果，不自動替換既有正式封存，不因回測最佳自動宣稱高信心或保證命中'});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const total=values=>values.reduce((sum,value)=>sum+value,0);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
function requireThat(condition,message){if(!condition)throw new Error('五十模組驗證：'+message)}
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value}
function statistics(s,count){
 requireThat(s&&s.count===count&&integer(s.count),'完整評分筆數不一致');
 for(const field of ['singleHits','top5Hits','top9Hits','bottom9Hits','top5AtLeast2','top5AtLeast3','top9AtLeast2','top9AtLeast3'])requireThat(integer(s[field]),'命中統計缺漏或無效');
 const histogram=(key,size)=>{const h=s[key];requireThat(Array.isArray(h)&&h.length===size&&h.every(integer)&&total(h)===count,'命中分布筆數不一致：'+key);return h};
 const one=histogram('singleHistogram',2),five=histogram('top5Histogram',6),nine=histogram('top9Histogram',6),bottom=histogram('bottom9Histogram',6);
 const weighted=h=>h.reduce((sum,n,i)=>sum+n*i,0);
 requireThat(one[1]===s.singleHits&&weighted(five)===s.top5Hits&&weighted(nine)===s.top9Hits&&weighted(bottom)===s.bottom9Hits,'分布與命中總數不一致');
 requireThat(total(five.slice(2))===s.top5AtLeast2&&total(five.slice(3))===s.top5AtLeast3&&total(nine.slice(2))===s.top9AtLeast2&&total(nine.slice(3))===s.top9AtLeast3,'二／三顆命中與分布不一致');
 requireThat(finite(s.brierSum)&&s.brierSum>=0&&s.brierSum<=count+1e-8,'Brier累計無效');
 for(const [field,n]of [['singleRate',s.singleHits],['top5Mean',s.top5Hits],['top9Mean',s.top9Hits],['bottom9Mean',s.bottom9Hits],['top5AtLeast2Rate',s.top5AtLeast2],['top5AtLeast3Rate',s.top5AtLeast3],['top9AtLeast2Rate',s.top9AtLeast2],['top9AtLeast3Rate',s.top9AtLeast3],['brier',s.brierSum]])requireThat(count?finite(s[field])&&Math.abs(s[field]-n/count)<1e-10:s[field]===null,'統計比率不一致：'+field);
}
function forecast(item){
 const r=item?.ranking;
 requireThat(Array.isArray(r)&&r.length===39&&new Set(r.map(x=>x.number)).size===39,'三十九碼排名缺漏或重複');
 requireThat(r.every((x,i)=>Number.isInteger(x.number)&&x.number>=1&&x.number<=39&&x.rank===i+1&&finite(x.probability)&&x.probability>=0&&x.probability<=1&&(!i||x.probability<=r[i-1].probability)),'排名序號或估計值無效');
 requireThat(Math.abs(total(r.map(x=>x.probability))-5)<FIFTY_POLICY.probabilityTolerance,'三十九碼估計總和不為五');
 requireThat(item.single===r[0].number&&same(item.top5,r.slice(0,5).map(x=>x.number))&&same(item.top9,r.slice(0,9).map(x=>x.number))&&same(item.bottom9,r.slice(-9).map(x=>x.number)),'獨支／前五／前九／後九不一致');
}
function groupStatistics(s,count,spec){
 const h=s?.histogram,max=Math.min(5,spec.size);
 requireThat(s?.count===count&&Array.isArray(h)&&h.length===max+1&&h.every(integer)&&total(h)===count,'分類組合命中分布不完整');
 const hits=h.reduce((sum,n,i)=>sum+n*i,0),met=h.reduce((sum,n,i)=>sum+(i>=spec.minHits&&i<=spec.maxHits?n:0),0);
 requireThat(s.totalHits===hits&&s.targetMet===met,'分類組合達標計數不一致');
 requireThat(count?finite(s.targetRate)&&Math.abs(s.targetRate-met/count)<1e-12&&finite(s.meanHits)&&Math.abs(s.meanHits-hits/count)<1e-12:s.targetRate===null&&s.meanHits===null,'分類組合比率不一致');
}
function choose(n,k){if(k<0||k>n)return 0;let out=1;for(let i=1;i<=k;i++)out=out*(n-i+1)/i;return out}
/** Pure structural/source binding verification. Does not claim model superiority,
 * perform network access, import a runtime, or substitute for a double replay. */
export function validateFiftyModules(report,{dataBasis,inputHash}={}){
 const r=report;requireThat(r?.version===FIFTY_VERSION&&r.status==='research_only'&&same(r.policy,FIFTY_POLICY),'版本或研究政策不符');
 requireThat(r.moduleCount===50&&r.familyCount===8&&Array.isArray(r.modules)&&r.modules.length===50,'五十組／八家族不完整');
 requireThat(integer(r.trainingDraws)&&r.trainingDraws>200&&r.input?.count===r.trainingDraws&&r.input?.firstDate==='2007-01-01'&&validDate(r.cutoffDate)&&r.cutoffDate===r.input.lastDate&&r.cutoffPeriod===r.input.lastPeriod,'全歷史起點、筆數或截止不一致');
 requireThat(validDate(r.targetDate)&&r.targetDate>r.cutoffDate&&Number.isSafeInteger(r.targetPeriod)&&r.targetPeriod>r.cutoffPeriod,'預測目標無效');
 const cutoffYear=Number(r.cutoffDate.slice(0,4))-1911,targetYear=Number(r.targetDate.slice(0,4))-1911;
 requireThat(Math.floor(r.cutoffPeriod/1000000)===cutoffYear&&r.targetPeriod===(targetYear===cutoffYear?r.cutoffPeriod+1:targetYear*1000000+1),'期別年份或下期期序不符');
 requireThat(r.inputHash===null||(typeof r.inputHash==='string'&&/^[a-f0-9]{64}$/.test(r.inputHash)),'輸入雜湊無效');
 if(inputHash!==undefined)requireThat(r.inputHash===inputHash,'輸入雜湊與來源不符');
 if(dataBasis){for(const [key,value]of Object.entries({draws:r.trainingDraws,firstDate:r.input.firstDate,lastDate:r.cutoffDate,cutoffPeriod:r.cutoffPeriod,targetDate:r.targetDate,targetPeriod:r.targetPeriod}))if(dataBasis[key]!==undefined)requireThat(dataBasis[key]===value,'資料綁定不符：'+key)}
 const count=r.trainingDraws-200;
 requireThat(r.evaluation?.warmup===200&&r.evaluation.count===count&&r.evaluation.lastDate===r.cutoffDate&&validDate(r.evaluation.firstDate),'全期評分範圍不完整');
 const families=new Set();
 r.modules.forEach((m,i)=>{const config=FIFTY_CONFIGS[i];requireThat(['id','name','family','familyName','parameters'].every(k=>same(m[k],config[k])),'模組配置改動、重複或順序不符');families.add(m.family);forecast(m);statistics(m.stats,count);statistics(m.recent60,Math.min(count,60));statistics(m.recent240,Math.min(count,240))});
 requireThat(families.size===8,'算法家族數不符');
 const fusion=r.fusion;requireThat(fusion?.id==='family_equal_brier_fusion'&&fusion.notAdditionalModule===true,'融合不得冒充第五十一組');forecast(fusion);statistics(fusion.stats,count);statistics(fusion.recent60,Math.min(count,60));statistics(fusion.recent240,Math.min(count,240));
 requireThat(Array.isArray(fusion.weights)&&fusion.weights.length===50&&Array.isArray(fusion.familyWeights)&&fusion.familyWeights.length===8,'家族／組內權重不完整');
 requireThat(Math.abs(total(fusion.weights.map(x=>x.weight))-1)<1e-10,'融合權重總和無效');
 for(const family of families){const rows=fusion.weights.filter(x=>x.family===family),f=fusion.familyWeights.find(x=>x.family===family);requireThat(f&&f.weight===1/8&&Math.abs(total(rows.map(x=>x.weight))-1/8)<1e-10&&Math.abs(total(rows.map(x=>x.withinFamilyWeight))-1)<1e-10,'家族等權或組內總和無效');
  const modules=r.modules.filter(m=>m.family===family),low=Math.min(...modules.map(m=>m.stats.brierSum)),exp=modules.map(m=>Math.exp(-(m.stats.brierSum-low))),mass=total(exp);
  rows.forEach((w,i)=>requireThat(Math.abs(w.withinFamilyWeight-exp[i]/mass)<1e-12,'組內權重未依前期累計損失計算'));
 }
 fusion.weights.forEach((w,i)=>requireThat(w.moduleId===FIFTY_CONFIGS[i].id&&w.family===FIFTY_CONFIGS[i].family&&w.familyWeight===1/8&&finite(w.weight)&&w.weight>=0&&w.weight<=1&&finite(w.withinFamilyWeight)&&w.withinFamilyWeight>=0&&w.withinFamilyWeight<=1&&Math.abs(w.weight-w.withinFamilyWeight/8)<1e-12,'融合模組權重無效'));
 const byNumber=r.modules.map(m=>Object.fromEntries(m.ranking.map(x=>[x.number,x.probability])));
 fusion.ranking.forEach(x=>requireThat(Math.abs(x.probability-r.modules.reduce((s,m,i)=>s+fusion.weights[i].weight*byNumber[i][x.number],0))<1e-10,'融合估計無法由五十組加權重現'));
 requireThat(Array.isArray(fusion.groups)&&fusion.groups.length===5,'五項指定組合不完整');
 fusion.groups.forEach((g,i)=>{const spec=FIFTY_GROUPS[i];requireThat(g.id==='fifty_group_'+spec.size&&['size','minHits','maxHits','label'].every(k=>g[k]===spec[k])&&same(g.numbers,fusion.ranking.slice(0,spec.size).map(x=>x.number)),'指定組合目標、順序或號碼不符');groupStatistics(g.stats,count,spec);groupStatistics(g.recent60,Math.min(count,60),spec);groupStatistics(g.recent240,Math.min(count,240),spec);
  const b=g.fairBaseline;requireThat(Array.isArray(b?.distribution)&&b.distribution.length===Math.min(5,spec.size)+1&&b.distribution.every((x,h)=>finite(x)&&x>=0&&x<=1&&Math.abs(x-choose(spec.size,h)*choose(39-spec.size,5-h)/choose(39,5))<1e-12)&&Math.abs(total(b.distribution)-1)<1e-10&&finite(b.targetProbability)&&Math.abs(b.targetProbability-total(b.distribution.slice(spec.minHits,spec.maxHits+1)))<1e-12&&Math.abs(b.expectedHits-spec.size*5/39)<1e-12&&b.meaning==='公平開獎超幾何理論基準，非模型成功率','分類組合理論基準無效');
  if(spec.size===5||spec.size===9)requireThat(same(g.stats.histogram,fusion.stats[spec.size===5?'top5Histogram':'top9Histogram']),'分類組合與同範圍融合命中分布不一致');
 });
 const checks=r.numericChecks;requireThat(checks&&checks.predictionsVerified===(r.trainingDraws+1)*51&&checks.valuesVerified===checks.predictionsVerified*39&&finite(checks.maxSumError)&&checks.maxSumError>=0&&checks.maxSumError<FIFTY_POLICY.probabilityTolerance,'逐期數值檢核覆蓋不足');
 requireThat(integer(r.evaluation.keep)&&r.evaluation.keep<=600&&Array.isArray(r.evaluation.recent)&&r.evaluation.recent.length===Math.min(count,r.evaluation.keep)&&Array.isArray(fusion.recent)&&same(fusion.recent,r.evaluation.recent),'近期逐期融合紀錄不一致');
 for(let i=0;i<fusion.recent.length;i++){
  const row=fusion.recent[i],drawn=row?.drawn;
  requireThat(Number.isSafeInteger(row?.period)&&row.period<=r.cutoffPeriod&&validDate(row.date)&&row.date<=r.cutoffDate&&(!i||row.period>fusion.recent[i-1].period&&row.date>fusion.recent[i-1].date)&&Array.isArray(drawn)&&drawn.length===5&&new Set(drawn).size===5&&drawn.every(n=>Number.isInteger(n)&&n>=1&&n<=39),'近期融合日期、期別或實際獎號無效');
  const list=(ns,size)=>Array.isArray(ns)&&ns.length===size&&new Set(ns).size===size&&ns.every(n=>Number.isInteger(n)&&n>=1&&n<=39);
  requireThat(list(row.top5,5)&&list(row.top9,9)&&list(row.bottom9,9)&&row.single===row.top5[0]&&same(row.top5,row.top9.slice(0,5))&&row.top9.every(n=>!row.bottom9.includes(n)),'近期融合獨支與前後名單不一致');
  const hits=ns=>ns.filter(n=>drawn.includes(n)).length;
  requireThat(row.singleHit===+drawn.includes(row.single)&&row.hits5===hits(row.top5)&&row.hits9===hits(row.top9)&&row.bottomHits9===hits(row.bottom9)&&finite(row.brier)&&row.brier>=0&&row.brier<=1&&Array.isArray(row.groupHits)&&row.groupHits.length===5&&row.groupHits.every((h,j)=>h===hits(row.top9.slice(0,FIFTY_GROUPS[j].size))),'近期融合／分類組合實際命中不一致');
 }
 if(fusion.recent.length)requireThat(fusion.recent.at(-1).period===r.cutoffPeriod&&fusion.recent.at(-1).date===r.cutoffDate,'近期融合紀錄未到全歷史截止');
 return true;
}
