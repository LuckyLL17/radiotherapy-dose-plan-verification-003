import Fastify from 'fastify';import cors from '@fastify/cors';
type Structure={id:string,name:string,type:'target'|'organ',volume:number,priority:'high'|'medium'|'low',constraint:{metric:'D95'|'Dmax'|'V20';limit:number;unit:string}};type Plan={id:string,label:string,beamCount:number,energy:string,algorithm:string,mu:number,createdAt:string,status:'draft'|'review'|'approved'};
const patient={id:'PT-2026-0917',name:'示例患者',diagnosis:'肺部肿瘤（演示数据）',site:'右肺下叶',fractions:30,rxDose:60};
const structures:Structure[]=[{id:'PTV',name:'PTV-60',type:'target',volume:84,priority:'high',constraint:{metric:'D95',limit:95,unit:'%'}},{id:'LUNG',name:'双肺-PTV',type:'organ',volume:4200,priority:'high',constraint:{metric:'V20',limit:25,unit:'%'}},{id:'HEART',name:'心脏',type:'organ',volume:720,priority:'high',constraint:{metric:'V20',limit:15,unit:'%'}},{id:'CORD',name:'脊髓',type:'organ',volume:58,priority:'high',constraint:{metric:'Dmax',limit:45,unit:'Gy'}},{id:'ESOPH',name:'食管',type:'organ',volume:88,priority:'medium',constraint:{metric:'Dmax',limit:50,unit:'Gy'}}];
const plans:Plan[]=[{id:'PLAN-A',label:'VMAT 主计划',beamCount:2,energy:'6MV FFF',algorithm:'Acuros XB 18.0',mu:634,createdAt:'2026-09-30T08:20:00Z',status:'review'},{id:'PLAN-B',label:'IMRT 对照计划',beamCount:7,energy:'6MV',algorithm:'AAA 16.1',mu:712,createdAt:'2026-09-29T16:40:00Z',status:'draft'}];
const audits:Array<Record<string,unknown>>=[];
function metrics(plan:Plan){const bias=plan.id==='PLAN-A'?0:3;return structures.map(s=>{let value=s.type==='target'?96.4-bias:s.id==='LUNG'?21.3+bias:s.id==='HEART'?10.2+bias*.7:s.id==='CORD'?42.1+bias*1.1:46.8+bias;return {structureId:s.id,name:s.name,metric:s.constraint.metric,value:+value.toFixed(2),limit:s.constraint.limit,unit:s.constraint.unit,pass:value<=s.constraint.limit||s.type==='target',delta:+(value-s.constraint.limit).toFixed(2),doseVolume:s.volume};});}
function dvh(plan:Plan){return structures.map(s=>({structureId:s.id,name:s.name,points:Array.from({length:11},(_,i)=>({dose:+(i*plan.mu/110).toFixed(1),volume:+(100-i*(s.type==='target'?8.3:10.6)).toFixed(1)}))}));}
function slice(index:number){return Array.from({length:32},(_,y)=>Array.from({length:32},(_,x)=>{const lung=Math.pow(x-11,2)+Math.pow(y-16,2)<105||Math.pow(x-23,2)+Math.pow(y-15,2)<90;const tumor=Math.pow(x-22,2)+Math.pow(y-18,2)<12;const dose=tumor?95:lung?48+Math.max(0,25-Math.abs(x-18))*1.4:10;return Math.round(dose+Math.sin((x+index)*.7)*3)}));}
const app=Fastify({logger:false});
app.setErrorHandler((error:unknown,_req,reply)=>{
  const e=error as {statusCode?:number;name?:string;message?:string;fields?:Record<string,string>};
  const status=e.statusCode ?? 400;
  reply.status(status).send({statusCode:status,error:e.name??'Bad Request',message:e.message??'bad_request',...(e.fields?{fields:e.fields}:{})});
});
await app.register(cors,{origin:true});app.get('/api/health',async()=>({status:'ok',service:'radiotherapy-dose-plan-verification'}));app.get('/api/patient/current',async()=>({patient,structures}));app.get('/api/plans',async()=>plans);app.get('/api/plans/:id/dose-slice',async(req)=>{const id=(req.params as {id:string}).id;if(!plans.some(p=>p.id===id))return{error:'plan_not_found'};const q=req.query as {index?:string};return{planId:id,index:Number(q.index??12),size:32,data:slice(Number(q.index??12))}});app.get('/api/plans/:id/dvh',async req=>{const p=plans.find(x=>x.id===(req.params as {id:string}).id);return p?dvh(p):{error:'plan_not_found'}});app.get('/api/plans/:id/constraints',async req=>{const p=plans.find(x=>x.id===(req.params as {id:string}).id);return p?{plan:p,checks:metrics(p),gate:metrics(p).every(x=>x.pass)?'ready':'blocked'}:{error:'plan_not_found'}});app.get('/api/compare',async()=>({plans:plans.map(p=>({id:p.id,label:p.label,checks:metrics(p),targetCoverage:metrics(p)[0].value,mu:p.mu})),recommendation:'PLAN-A 在靶区覆盖和危及器官约束之间取得更优平衡'}));app.post('/api/plans/:id/approve',async req=>{const p=plans.find(x=>x.id===(req.params as {id:string}).id);if(!p)return{error:'plan_not_found'};const checks=metrics(p);if(!checks.every(x=>x.pass))return{approved:false,gate:'blocked',failed:checks.filter(x=>!x.pass)};p.status='approved';audits.unshift({at:new Date().toISOString(),action:'plan_approved',planId:p.id});return{approved:true,plan:p}});app.post('/api/plans/:id/peer-review',async req=>{const p=plans.find(x=>x.id===(req.params as {id:string}).id);if(!p)return{error:'plan_not_found'};const body=req.body as {reviewer:string;note:string};audits.unshift({at:new Date().toISOString(),action:'peer_review',planId:p.id,...body});return{ok:true,planId:p.id,reviewer:body.reviewer}});app.get('/api/audit',async()=>audits);
type QaRun={id:string;planId:string;method:'independent_mu'|'gamma'|'image_guidance';status:'pass'|'warn'|'fail';score:number;detail:string;createdAt:string};
const qaRuns:QaRun[]=[{id:'QA-071',planId:'PLAN-A',method:'independent_mu',status:'pass',score:1.7,detail:'独立 MU 复算差异 1.7%，低于 3% 阈值',createdAt:'2026-09-30T09:16:00Z'},{id:'QA-072',planId:'PLAN-A',method:'gamma',status:'pass',score:98.4,detail:'3%/3mm γ 通过率 98.4%，高于 95% 阈值',createdAt:'2026-09-30T09:23:00Z'}];
const peerChecklist=new Map<string,Array<{item:string;checked:boolean;reviewer:string;at:string}>>();
const deliveries=new Map<string,Array<{fraction:number;deliveredGy:number;setupShift:{x:number;y:number;z:number};at:string}>>();
const deviations:Array<{id:string;planId:string;severity:'low'|'medium'|'high';category:string;detail:string;state:'open'|'resolved';createdAt:string}>=[];
function releaseDossier(planId:string){const plan=plans.find(p=>p.id===planId);if(!plan)return {error:'plan_not_found'};const checks=metrics(plan);const qa=qaRuns.filter(x=>x.planId===planId);const checklist=peerChecklist.get(planId)??[];const required=['靶区轮廓与处方一致性','危及器官约束复核','束角与碰撞检查','独立剂量验证'];const unchecked=required.filter(item=>!checklist.some(x=>x.item===item&&x.checked));const delivery=deliveries.get(planId)??[];const blockers=[...checks.filter(x=>!x.pass).map(x=>`${x.name} 约束失败`),...qa.filter(x=>x.status==='fail').map(x=>`${x.method} QA 失败`),...unchecked.map(x=>`同行复核缺失：${x}`),...deviations.filter(x=>x.planId===planId&&x.severity==='high'&&x.state==='open').map(x=>`未关闭偏差：${x.category}`)];return {plan,checks,qa,checklist,deliverySummary:{fractions:delivery.length,cumulativeDose:+delivery.reduce((s,x)=>s+x.deliveredGy,0).toFixed(2),prescriptionDose:patient.rxDose},gate:blockers.length?'blocked':'ready',blockers,ntcp:{lungPneumonitis:+Math.max(1,Math.min(35,metrics(plan).find(x=>x.structureId==='LUNG')!.value*1.08)).toFixed(1),heartEvent:+Math.max(.2,Math.min(20,metrics(plan).find(x=>x.structureId==='HEART')!.value*.46)).toFixed(1)}}}
app.get('/api/plans/:id/verification-dossier',async req=>releaseDossier((req.params as {id:string}).id));
app.post('/api/plans/:id/independent-check',async req=>{const id=(req.params as {id:string}).id;const body=(req.body??{}) as {method?:'independent_mu'|'gamma'|'image_guidance';score?:number};const method=body.method??'independent_mu';const score=body.score??(method==='gamma'?97.1:2.2);const status=method==='gamma'?(score>=95?'pass':score>=90?'warn':'fail'):(score<=3?'pass':score<=5?'warn':'fail');const run:QaRun={id:`QA-${String(qaRuns.length+71).padStart(3,'0')}`,planId:id,method,status,score,detail:method==='gamma'?`γ 通过率 ${score}%`:`独立 MU 差异 ${score}%`,createdAt:new Date().toISOString()};qaRuns.unshift(run);audits.unshift({at:run.createdAt,action:'independent_check',...run});return run});
app.post('/api/plans/:id/peer-checklist',async req=>{const id=(req.params as {id:string}).id;const body=req.body as {item:string;checked:boolean;reviewer:string};const list=peerChecklist.get(id)??[];const existing=list.find(x=>x.item===body.item);if(existing){existing.checked=body.checked;existing.reviewer=body.reviewer;existing.at=new Date().toISOString()}else list.push({...body,at:new Date().toISOString()});peerChecklist.set(id,list);audits.unshift({at:new Date().toISOString(),action:'peer_checklist',planId:id,...body});return {planId:id,items:list}});
app.post('/api/plans/:id/delivery/fractions',async req=>{const id=(req.params as {id:string}).id;const body=req.body as {fraction:number;deliveredGy:number;setupShift:{x:number;y:number;z:number}};const list=deliveries.get(id)??[];if(list.some(x=>x.fraction===body.fraction))return {ok:false,error:'duplicate_fraction'};list.push({...body,at:new Date().toISOString()});deliveries.set(id,list);const magnitude=Math.hypot(body.setupShift.x,body.setupShift.y,body.setupShift.z);if(magnitude>5)deviations.unshift({id:`DEV-${deviations.length+1}`,planId:id,severity:'high',category:'setup_shift',detail:`第 ${body.fraction} 次摆位偏移 ${magnitude.toFixed(1)} mm`,state:'open',createdAt:new Date().toISOString()});audits.unshift({at:new Date().toISOString(),action:'fraction_delivered',planId:id,fraction:body.fraction});return releaseDossier(id)});
app.post('/api/plans/:id/release',async req=>{const id=(req.params as {id:string}).id;const dossier=releaseDossier(id);if('error' in dossier)return dossier;if(dossier.gate==='blocked')return {released:false,...dossier};const plan=plans.find(p=>p.id===id)!;plan.status='approved';audits.unshift({at:new Date().toISOString(),action:'plan_released',planId:id});return {released:true,...releaseDossier(id)}});
app.post('/api/plans/:id/deviations',async req=>{const id=(req.params as {id:string}).id;const body=req.body as {severity:'low'|'medium'|'high';category:string;detail:string};const event={id:`DEV-${deviations.length+1}`,planId:id,...body,state:'open' as const,createdAt:new Date().toISOString()};deviations.unshift(event);return event});

// ─────────────────────────────────────────────────────────────────────────
// 自适应评估模块（独立）
// 治疗期间体重变化 / 肿瘤位置变化 / 肺部密度变化录入后，由服务端计算
// 靶区覆盖 D95、双肺 V20 并给出建议结论。历史记录仅追加（append-only），
// 按计划隔离，任何接口都不会覆盖或删除旧记录。
// ─────────────────────────────────────────────────────────────────────────
type AdaptiveRecommendation='continue'|'observe'|'replan';
interface AdaptiveAssessment{
  id:string;
  planId:string;
  inputs:{weightChangeKg:number;tumorShiftMm:number;lungDensityChangeHu:number};
  results:{
    targetCoveragePct:number;          // 靶区 D95 覆盖（%）
    lungV20Pct:number;                 // 双肺 V20（%）
    coverageThresholdPct:number;       // 覆盖阈值（含临界规则，边界透明）
    v20LimitPct:number;                // V20 阈值
    flags:{coverageCritical:boolean;v20Critical:boolean};
  };
  recommendation:AdaptiveRecommendation;
  rationale:string[];
  createdAt:string;
}
const adaptiveStore=new Map<string,AdaptiveAssessment[]>();           // planId -> 记录（仅追加）
const adaptiveIdempotency=new Map<string,{planId:string;record:AdaptiveAssessment}>();
const COVERAGE_THRESHOLD=95;          // D95 ≥ 95%（含 95.000）为达标
const V20_LIMIT=25;                   // V20 ≤ 25%（含 25.000）为达标
const CRITICAL_MARGIN=1;              // 距阈值 1 个单位内为临界观察
const WEIGHT_RANGE=30;                // 体重变化合理范围 ±30 kg
const SHIFT_RANGE=50;                 // 肿瘤位移合理范围 0~50 mm
const DENSITY_RANGE=300;              // 肺密度变化合理范围 ±300 HU

function baselineForPlan(plan:Plan){
  // 各计划基线取自该计划自身的剂量学指标，计算结果天然按计划隔离
  const m=metrics(plan);
  const target=m.find(x=>x.structureId==='PTV')!.value;
  const lung=m.find(x=>x.structureId==='LUNG')!.value;
  return {targetCoveragePct:target,lungV20Pct:lung};
}
function round2(n:number){return Math.round((n+Number.EPSILON)*100)/100;}

/** 服务端核心计算：纯函数，前端不持有任何计算逻辑 */
function computeAdaptive(plan:Plan,inputs:AdaptiveAssessment['inputs']){
  const base=baselineForPlan(plan);
  const {weightChangeKg:w,tumorShiftMm:s,lungDensityChangeHu:d}=inputs;
  // 体重下降（负值）使体表轮廓与计划 CT 不一致，同样损失覆盖；位移、密度同理
  const coverage=round2(Math.min(100,Math.max(0,base.targetCoveragePct-Math.abs(s)*0.7-Math.abs(w)*0.18)));
  const lungV20=round2(Math.min(100,Math.max(0,base.lungV20Pct+Math.abs(d)*0.08+Math.abs(s)*0.12)));
  // 临界规则在阈值判定之后执行：95.000 / 25.000 恰好达标，不算越限
  const coverageCritical=coverage>COVERAGE_THRESHOLD&&coverage<=COVERAGE_THRESHOLD+CRITICAL_MARGIN;
  const v20Critical=lungV20<V20_LIMIT&&lungV20>=V20_LIMIT-CRITICAL_MARGIN;
  let recommendation:AdaptiveRecommendation;
  if(coverage<COVERAGE_THRESHOLD||lungV20>V20_LIMIT)recommendation='replan';
  else if(coverageCritical||v20Critical)recommendation='observe';
  else recommendation='continue';
  const rationale:string[]=[
    `靶区 D95 覆盖 ${coverage}%（阈值 ≥ ${COVERAGE_THRESHOLD}%）`,
    `双肺 V20 ${lungV20}%（限值 ≤ ${V20_LIMIT}%）`
  ];
  if(recommendation==='replan'){
    if(coverage<COVERAGE_THRESHOLD)rationale.push('覆盖低于阈值，靶区存在欠量风险');
    if(lungV20>V20_LIMIT)rationale.push('V20 超过限值，放射性肺炎风险升高');
  }else if(recommendation==='observe'){
    if(coverageCritical)rationale.push('覆盖贴近阈值（临界），建议加强图像引导并密切随访');
    if(v20Critical)rationale.push('V20 贴近限值（临界），建议复测密度后复评');
  }else{
    rationale.push('两项指标均在安全裕度内');
  }
  return {targetCoveragePct:coverage,lungV20Pct:lungV20,coverageThresholdPct:COVERAGE_THRESHOLD,v20LimitPct:V20_LIMIT,flags:{coverageCritical,v20Critical},recommendation,rationale};
}

function badRequest(message:string,fields?:Record<string,string>){
  const err=new Error(message) as Error & {statusCode:number;name:string;fields?:Record<string,string>};
  err.statusCode=400;err.name='Bad Request';if(fields)err.fields=fields;return err;
}
function parseAdaptiveBody(body:unknown){
  const b=(body??{}) as Record<string,unknown>;
  const fields:Record<string,string>={};
  const num=(key:string,label:string,min:number,max:number,allowNegative:boolean)=>{
    const raw=b[key];
    if(raw===undefined||raw===null||String(raw).trim()===''){fields[key]=`${label}不能为空`;return NaN;}
    const n=Number(raw);
    if(!Number.isFinite(n)){fields[key]=`${label}必须是数字`;return NaN;}
    if(!allowNegative&&n<0){fields[key]=`${label}不能为负值`;return NaN;}
    if(n<min||n>max){fields[key]=`${label}超出允许范围（${min} ~ ${max}）`;return NaN;}
    return n;
  };
  const weightChangeKg=num('weightChangeKg','体重变化',-WEIGHT_RANGE,WEIGHT_RANGE,true);
  const tumorShiftMm=num('tumorShiftMm','肿瘤位移',0,SHIFT_RANGE,false);
  const lungDensityChangeHu=num('lungDensityChangeHu','肺部密度变化',-DENSITY_RANGE,DENSITY_RANGE,true);
  if(Object.keys(fields).length)throw badRequest('adaptive_validation_failed',fields);
  return {weightChangeKg,tumorShiftMm,lungDensityChangeHu} as AdaptiveAssessment['inputs'];
}

function notFound():never{
  const e=new Error('plan_not_found') as Error&{statusCode:number;name:string};e.statusCode=404;e.name='Not Found';throw e;
}
app.get('/api/plans/:id/adaptive-assessments',async req=>{
  const id=(req.params as {id:string}).id;
  if(!plans.some(p=>p.id===id))notFound();
  const items=adaptiveStore.get(id)??[];
  return {planId:id,count:items.length,assessments:items};   // 时间正序，最新在末
});

app.post('/api/plans/:id/adaptive-assessments',async req=>{
  const id=(req.params as {id:string}).id;
  const plan=plans.find(p=>p.id===id);
  if(!plan)notFound();
  const inputs=parseAdaptiveBody(req.body);                       // 空值/负值/越界 → 400
  const key=(req.body as Record<string,unknown>)?.idempotencyKey;
  const idempotencyKey=typeof key==='string'&&key.trim()?key.trim():undefined;

  // 幂等：同一 key 重复提交直接返回已保存记录，绝不产生第二条，也不覆盖旧记录
  if(idempotencyKey){
    const hit=adaptiveIdempotency.get(idempotencyKey);
    if(hit){
      if(hit.planId!==id){const e=new Error('idempotency_key_used_on_other_plan') as Error&{statusCode:number;name:string};e.statusCode=409;e.name='Conflict';throw e;}
      return {duplicate:true,assessment:hit.record,assessments:adaptiveStore.get(id)??[]};
    }
  }

  const results=computeAdaptive(plan,inputs);
  const record:AdaptiveAssessment={
    id:`ADP-${String(Date.now()).slice(-6)}-${String((adaptiveStore.get(id)?.length??0)+1).padStart(3,'0')}`,
    planId:id,
    inputs,
    results,
    recommendation:results.recommendation,
    rationale:results.rationale,
    createdAt:new Date().toISOString()
  };
  const list=adaptiveStore.get(id)??[];
  list.push(record);                                             // 仅追加
  adaptiveStore.set(id,list);
  if(idempotencyKey)adaptiveIdempotency.set(idempotencyKey,{planId:id,record});
  audits.unshift({at:record.createdAt,action:'adaptive_assessment',planId:id,assessmentId:record.id,recommendation:record.recommendation});
  return {duplicate:false,assessment:record,assessments:list};
});

await app.listen({host:'127.0.0.1',port:6202});
