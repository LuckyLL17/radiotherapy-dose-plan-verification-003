import Fastify from 'fastify';import cors from '@fastify/cors';
type Structure={id:string,name:string,type:'target'|'organ',volume:number,priority:'high'|'medium'|'low',constraint:{metric:'D95'|'Dmax'|'V20';limit:number;unit:string}};type Plan={id:string,label:string,beamCount:number,energy:string,algorithm:string,mu:number,createdAt:string,status:'draft'|'review'|'approved'};
const patient={id:'PT-2026-0917',name:'示例患者',diagnosis:'肺部肿瘤（演示数据）',site:'右肺下叶',fractions:30,rxDose:60};
const structures:Structure[]=[{id:'PTV',name:'PTV-60',type:'target',volume:84,priority:'high',constraint:{metric:'D95',limit:95,unit:'%'}},{id:'LUNG',name:'双肺-PTV',type:'organ',volume:4200,priority:'high',constraint:{metric:'V20',limit:25,unit:'%'}},{id:'HEART',name:'心脏',type:'organ',volume:720,priority:'high',constraint:{metric:'V20',limit:15,unit:'%'}},{id:'CORD',name:'脊髓',type:'organ',volume:58,priority:'high',constraint:{metric:'Dmax',limit:45,unit:'Gy'}},{id:'ESOPH',name:'食管',type:'organ',volume:88,priority:'medium',constraint:{metric:'Dmax',limit:50,unit:'Gy'}}];
const plans:Plan[]=[{id:'PLAN-A',label:'VMAT 主计划',beamCount:2,energy:'6MV FFF',algorithm:'Acuros XB 18.0',mu:634,createdAt:'2026-09-30T08:20:00Z',status:'review'},{id:'PLAN-B',label:'IMRT 对照计划',beamCount:7,energy:'6MV',algorithm:'AAA 16.1',mu:712,createdAt:'2026-09-29T16:40:00Z',status:'draft'}];
const audits:Array<Record<string,unknown>>=[];
function metrics(plan:Plan){const bias=plan.id==='PLAN-A'?0:3;return structures.map(s=>{let value=s.type==='target'?96.4-bias:s.id==='LUNG'?21.3+bias:s.id==='HEART'?10.2+bias*.7:s.id==='CORD'?42.1+bias*1.1:46.8+bias;return {structureId:s.id,name:s.name,metric:s.constraint.metric,value:+value.toFixed(2),limit:s.constraint.limit,unit:s.constraint.unit,pass:value<=s.constraint.limit||s.type==='target',delta:+(value-s.constraint.limit).toFixed(2),doseVolume:s.volume};});}
function dvh(plan:Plan){return structures.map(s=>({structureId:s.id,name:s.name,points:Array.from({length:11},(_,i)=>({dose:+(i*plan.mu/110).toFixed(1),volume:+(100-i*(s.type==='target'?8.3:10.6)).toFixed(1)}))}));}
function slice(index:number){return Array.from({length:32},(_,y)=>Array.from({length:32},(_,x)=>{const lung=Math.pow(x-11,2)+Math.pow(y-16,2)<105||Math.pow(x-23,2)+Math.pow(y-15,2)<90;const tumor=Math.pow(x-22,2)+Math.pow(y-18,2)<12;const dose=tumor?95:lung?48+Math.max(0,25-Math.abs(x-18))*1.4:10;return Math.round(dose+Math.sin((x+index)*.7)*3)}));}
const app=Fastify({logger:false});await app.register(cors,{origin:true});app.get('/api/health',async()=>({status:'ok',service:'radiotherapy-dose-plan-verification'}));app.get('/api/patient/current',async()=>({patient,structures}));app.get('/api/plans',async()=>plans);app.get('/api/plans/:id/dose-slice',async(req)=>{const id=(req.params as {id:string}).id;if(!plans.some(p=>p.id===id))return{error:'plan_not_found'};const q=req.query as {index?:string};return{planId:id,index:Number(q.index??12),size:32,data:slice(Number(q.index??12))}});app.get('/api/plans/:id/dvh',async req=>{const p=plans.find(x=>x.id===(req.params as {id:string}).id);return p?dvh(p):{error:'plan_not_found'}});app.get('/api/plans/:id/constraints',async req=>{const p=plans.find(x=>x.id===(req.params as {id:string}).id);return p?{plan:p,checks:metrics(p),gate:metrics(p).every(x=>x.pass)?'ready':'blocked'}:{error:'plan_not_found'}});app.get('/api/compare',async()=>({plans:plans.map(p=>({id:p.id,label:p.label,checks:metrics(p),targetCoverage:metrics(p)[0].value,mu:p.mu})),recommendation:'PLAN-A 在靶区覆盖和危及器官约束之间取得更优平衡'}));app.post('/api/plans/:id/approve',async req=>{const p=plans.find(x=>x.id===(req.params as {id:string}).id);if(!p)return{error:'plan_not_found'};const checks=metrics(p);if(!checks.every(x=>x.pass))return{approved:false,gate:'blocked',failed:checks.filter(x=>!x.pass)};p.status='approved';audits.unshift({at:new Date().toISOString(),action:'plan_approved',planId:p.id});return{approved:true,plan:p}});app.post('/api/plans/:id/peer-review',async req=>{const p=plans.find(x=>x.id===(req.params as {id:string}).id);if(!p)return{error:'plan_not_found'};const body=req.body as {reviewer:string;note:string};audits.unshift({at:new Date().toISOString(),action:'peer_review',planId:p.id,...body});return{ok:true,planId:p.id,reviewer:body.reviewer}});app.get('/api/audit',async()=>audits);
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

// ───────────────────────── 自适应评估模块（独立、append-only） ─────────────────────────
type AdaptiveInput={weightChange:number;tumorShift:number;lungDensityChange:number;note?:string};
type AdaptiveRecommendation='continue'|'review'|'replan';
type AdaptiveRecord={id:string;planId:string;inputs:AdaptiveInput;targetCoverage:number;lungV20:number;thresholds:{coverageFailBelow:number;coverageWarnBelow:number;lungV20FailAbove:number;lungV20WarnAbove:number};warnings:string[];recommendation:AdaptiveRecommendation;recommendationText:string;reasons:string[];createdAt:string};
// 历史仅追加，永不覆盖；同一计划的评估聚在同一数组
const adaptiveHistory:AdaptiveRecord[]=[];
// 各计划治疗中基线（首周 CBCT/计划剂量复核值）
const adaptiveBaseline:Record<string,{coverage:number;lungV20:number}>={
  'PLAN-A':{coverage:metrics(plans[0])[0].value,lungV20:metrics(plans[0])[1].value},
  'PLAN-B':{coverage:metrics(plans[1])[0].value,lungV20:metrics(plans[1])[1].value}
};
// 判定阈值（临界值含等号：95.00% 与 25.00% 视为通过）
const ADAPTIVE_COVERAGE_FALLBACK=96.4;
const ADAPTIVE_V20_FALLBACK=21.3;
const COVERAGE_FAIL_BELOW=95;     // D95 覆盖 < 95% → 重计划
const COVERAGE_WARN_BELOW=96;     // 95% ≤ D95 < 96% → 临界复核
const LUNGV20_FAIL_ABOVE=25;      // V20 > 25% → 重计划
const LUNGV20_WARN_ABOVE=24;      // 24% < V20 ≤ 25% → 临界复核
// 服务端防重复提交：同一计划、输入完全一致的时间窗（毫秒）
const ADAPTIVE_DEDUP_WINDOW_MS=30_000;

function round2(v:number){return Math.round(v*100)/100;}
function clampPct(v:number){return Math.min(100,Math.max(0,round2(v)));}
// 仅接受 number 或数字字符串；null/undefined/布尔/NaN/Infinity/空串均拒绝
function toFiniteNumber(v:unknown):number|null{
  if(typeof v==='boolean')return null;
  if(typeof v==='number')return Number.isFinite(v)?v:null;
  if(typeof v==='string'){const t=v.trim();if(t==='')return null;const n=Number(t);return Number.isFinite(n)?n:null;}
  return null;
}
function validateAdaptiveInput(body:any):{input:AdaptiveInput|null;errors:string[]}{
  const errors:string[]=[];
  const read=(field:'weightChange'|'tumorShift'|'lungDensityChange',label:string,min:number,max:number,nonNegative:boolean)=>{
    if(body===null||typeof body!=='object'||!(field in body)){errors.push(`${label}不能为空`);return null;}
    const n=toFiniteNumber(body[field]);
    if(n===null){errors.push(`${label}必须是有效数字`);return null;}
    if(n<0&&nonNegative){errors.push(`${label}不能为负值`);return null;}
    if(n<min||n>max){errors.push(`${label}取值需在 ${min} ~ ${max} 之间`);return null;}
    return round2(n);
  };
  const weightChange=read('weightChange','体重变化(kg)',-30,30,false);
  const tumorShift=read('tumorShift','肿瘤位移(mm)',0,50,true);
  const lungDensityChange=read('lungDensityChange','肺部密度变化(HU)',-500,500,false);
  let note:string|undefined;
  if(body!==null&&typeof body==='object'&&'note' in body&&body.note!=null){
    if(typeof body.note!=='string'){errors.push('备注必须是文本');}
    else{note=body.note.trim().slice(0,200);}
  }
  if(errors.length)return {input:null,errors};
  return {input:{weightChange:weightChange as number,tumorShift:tumorShift as number,lungDensityChange:lungDensityChange as number,...(note?{note}:{})},errors};
}
// 服务端计算：覆盖下降源于肿瘤移位与体重下降；V20 上升源于肺密度增加与移位
function computeAdaptive(planId:string,input:AdaptiveInput){
  const base=adaptiveBaseline[planId]??{coverage:ADAPTIVE_COVERAGE_FALLBACK,lungV20:ADAPTIVE_V20_FALLBACK};
  const weightLoss=Math.min(0,input.weightChange); // 减重（负值）拉低覆盖
  const targetCoverage=clampPct(base.coverage-input.tumorShift*0.7+weightLoss*0.18);
  const lungV20=clampPct(base.lungV20+input.lungDensityChange*0.02+input.tumorShift*0.12);
  const warnings:string[]=[];
  const reasons:string[]=[];
  // 所有比较都基于 round2 后的值，避免浮点误差导致 95/25 临界误判
  if(targetCoverage>=COVERAGE_WARN_BELOW&&targetCoverage<COVERAGE_WARN_BELOW+0.5)warnings.push(`靶区覆盖 ${targetCoverage}% 接近复核临界 ${COVERAGE_WARN_BELOW}%`);
  if(lungV20>LUNGV20_WARN_ABOVE-0.5&&lungV20<=LUNGV20_WARN_ABOVE)warnings.push(`肺部 V20 ${lungV20}% 接近复核临界 ${LUNGV20_WARN_ABOVE}%`);
  const coverageFail=targetCoverage<COVERAGE_FAIL_BELOW;
  const coverageWarn=!coverageFail&&targetCoverage<COVERAGE_WARN_BELOW;
  const lungFail=lungV20>LUNGV20_FAIL_ABOVE;
  const lungWarn=!lungFail&&lungV20>LUNGV20_WARN_ABOVE;
  if(coverageFail)reasons.push(`靶区 D95 覆盖 ${targetCoverage}% 低于 ${COVERAGE_FAIL_BELOW}%`);
  if(lungFail)reasons.push(`肺部 V20 ${lungV20}% 高于 ${LUNGV20_FAIL_ABOVE}%`);
  if(coverageWarn)reasons.push(`靶区 D95 覆盖 ${targetCoverage}% 低于复核临界 ${COVERAGE_WARN_BELOW}%（未跌破 ${COVERAGE_FAIL_BELOW}%）`);
  if(lungWarn)reasons.push(`肺部 V20 ${lungV20}% 高于复核临界 ${LUNGV20_WARN_ABOVE}%（未超过 ${LUNGV20_FAIL_ABOVE}%）`);
  let recommendation:AdaptiveRecommendation;
  if(coverageFail||lungFail)recommendation='replan';
  else if(coverageWarn||lungWarn)recommendation='review';
  else recommendation='continue';
  if(!coverageFail&&!coverageWarn)reasons.push(`靶区 D95 覆盖 ${targetCoverage}% ≥ ${COVERAGE_WARN_BELOW}%`);
  if(!lungFail&&!lungWarn)reasons.push(`肺部 V20 ${lungV20}% ≤ ${LUNGV20_WARN_ABOVE}%`);
  const recommendationText=recommendation==='replan'?'需要自适应重计划评估':recommendation==='review'?'建议尽快复核（临界指标）':'可按原计划继续治疗';
  return {targetCoverage,lungV20,warnings,recommendation,recommendationText,reasons};
}
// 读取同一计划的评估历史（最新在前），绝不返回其他计划的数据
app.get('/api/plans/:id/adaptive-assessments',async (req,reply)=>{
  const id=(req.params as {id:string}).id;
  if(!plans.some(p=>p.id===id))return reply.code(404).send({error:'plan_not_found',message:'计划不存在'});
  const history=adaptiveHistory.filter(a=>a.planId===id);
  return {planId:id,thresholds:{coverageFailBelow:COVERAGE_FAIL_BELOW,coverageWarnBelow:COVERAGE_WARN_BELOW,lungV20FailAbove:LUNGV20_FAIL_ABOVE,lungV20WarnAbove:LUNGV20_WARN_ABOVE},baseline:adaptiveBaseline[id]??null,history};
});
// 录入一次变化并由服务端计算结论；append-only，不覆盖任何旧记录
app.post('/api/plans/:id/adaptive-assessments',async (req,reply)=>{
  const id=(req.params as {id:string}).id;
  if(!plans.some(p=>p.id===id))return reply.code(404).send({error:'plan_not_found',message:'计划不存在'});
  const parsed=validateAdaptiveInput(req.body);
  if(parsed.input===null)return reply.code(400).send({error:'validation_failed',message:'输入校验未通过',errors:parsed.errors});
  const {input}=parsed;
  // 服务端防重复提交：时间窗内相同输入直接返回既有记录，不新增
  const now=Date.now();
  const duplicate=adaptiveHistory.find(a=>a.planId===id
    &&a.inputs.weightChange===input.weightChange
    &&a.inputs.tumorShift===input.tumorShift
    &&a.inputs.lungDensityChange===input.lungDensityChange
    &&now-Date.parse(a.createdAt)<=ADAPTIVE_DEDUP_WINDOW_MS);
  if(duplicate)return reply.code(409).send({error:'duplicate_submission',message:'相同评估在 30 秒内已提交，请勿重复录入',existingId:duplicate.id,assessment:duplicate});
  const result=computeAdaptive(id,input);
  const record:AdaptiveRecord={id:`ADP-${String(adaptiveHistory.length+1).padStart(3,'0')}`,planId:id,inputs:input,thresholds:{coverageFailBelow:COVERAGE_FAIL_BELOW,coverageWarnBelow:COVERAGE_WARN_BELOW,lungV20FailAbove:LUNGV20_FAIL_ABOVE,lungV20WarnAbove:LUNGV20_WARN_ABOVE},...result,createdAt:new Date().toISOString()};
  adaptiveHistory.unshift(record); // 仅追加
  audits.unshift({at:record.createdAt,action:'adaptive_assessment_created',planId:id,assessmentId:record.id,recommendation:record.recommendation,inputs:input});
  return reply.code(201).send(record);
});

await app.listen({host:'127.0.0.1',port:6202});
