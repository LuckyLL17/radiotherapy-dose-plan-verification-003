import {useCallback,useEffect,useRef,useState} from 'react';

type Recommendation='continue'|'review'|'replan';
interface AdaptiveRecord{
  id:string;planId:string;
  inputs:{weightChange:number;tumorShift:number;lungDensityChange:number;note?:string};
  targetCoverage:number;lungV20:number;
  thresholds:{coverageFailBelow:number;coverageWarnBelow:number;lungV20FailAbove:number;lungV20WarnAbove:number};
  warnings:string[];recommendation:Recommendation;recommendationText:string;reasons:string[];
  createdAt:string;
}
interface HistoryResponse{
  planId:string;
  thresholds:AdaptiveRecord['thresholds'];
  baseline:{coverage:number;lungV20:number}|null;
  history:AdaptiveRecord[];
}
const FIELDS=[
  {key:'weightChange' as const,label:'体重变化',unit:'kg',placeholder:'减重为负，增重为正（-30 ~ 30）',min:-30,max:30,allowNegative:true},
  {key:'tumorShift' as const,label:'肿瘤位置位移',unit:'mm',placeholder:'影像测量的位移大小（0 ~ 50）',min:0,max:50,allowNegative:false},
  {key:'lungDensityChange' as const,label:'肺部密度变化',unit:'HU',placeholder:'CT 值变化（-500 ~ 500）',min:-500,max:500,allowNegative:true}
];
type FieldKey=typeof FIELDS[number]['key'];
const REC_BADGE:Record<Recommendation,string>={continue:'recContinue',review:'recReview',replan:'recReplan'};

function fmtTime(iso:string){
  const d=new Date(iso);
  return Number.isNaN(d.getTime())?iso:(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`);
}

export default function AdaptiveAssessment({planId}:{planId:string}){
  const [values,setValues]=useState<Record<FieldKey,string>>({weightChange:'',tumorShift:'',lungDensityChange:''});
  const [note,setNote]=useState('');
  const [errors,setErrors]=useState<Partial<Record<FieldKey,string>>>({});
  const [history,setHistory]=useState<AdaptiveRecord[]|null>(null);
  const [baseline,setBaseline]=useState<HistoryResponse['baseline']>(null);
  const [thresholds,setThresholds]=useState<AdaptiveRecord['thresholds']|null>(null);
  const [loadError,setLoadError]=useState('');
  const [submitting,setSubmitting]=useState(false);
  const [submitError,setSubmitError]=useState<string|null>(null);
  const [submitInfo,setSubmitInfo]=useState<string|null>(null);
  // 切换计划即重挂载（key={planId}），ref 额外防止快速切换时旧请求晚到覆盖新计划数据
  const abortRef=useRef<AbortController|null>(null);

  const load=useCallback(async()=>{
    abortRef.current?.abort();
    const ctrl=new AbortController();abortRef.current=ctrl;
    setHistory(null);setLoadError('');
    try{
      const r=await fetch(`/api/plans/${planId}/adaptive-assessments`,{signal:ctrl.signal});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const data:HistoryResponse=await r.json();
      setHistory(data.history);setBaseline(data.baseline);setThresholds(data.thresholds);
    }catch(e:any){
      if(e?.name==='AbortError')return; // 已被新计划的请求取代
      setLoadError('评估历史加载失败，请检查后端服务后重试。');
    }
  },[planId]);

  useEffect(()=>{load();return()=>abortRef.current?.abort();},[load]);

  const validate=():Record<FieldKey,number>|null=>{
    const next:Partial<Record<FieldKey,string>>={};
    const out:Partial<Record<FieldKey,number>>={};
    for(const f of FIELDS){
      const raw=values[f.key].trim();
      if(raw===''){next[f.key]='该值不能为空，请录入测量结果。';continue;}
      const n=Number(raw);
      if(!Number.isFinite(n)){next[f.key]='必须是有效数字。';continue;}
      if(!f.allowNegative&&n<0){next[f.key]='不能为负值。';continue;}
      if(n<f.min||n>f.max){next[f.key]=`取值需在 ${f.min} ~ ${f.max} 之间。`;continue;}
      out[f.key]=Math.round(n*100)/100;
    }
    setErrors(next);
    return Object.keys(next).length?null:(out as Record<FieldKey,number>);
  };

  const submit=async()=>{
    setSubmitError(null);setSubmitInfo(null);
    const ok=validate();
    if(!ok){setSubmitError('表单校验未通过，请修正标红字段后再提交。');return;}
    setSubmitting(true);
    try{
      const r=await fetch(`/api/plans/${planId}/adaptive-assessments`,{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({weightChange:ok.weightChange,tumorShift:ok.tumorShift,lungDensityChange:ok.lungDensityChange,...(note.trim()?{note:note.trim()}:{})})
      });
      const data=await r.json().catch(()=>({}));
      if(r.status===201){
        setSubmitInfo(`已保存评估 ${data.id}：${data.recommendationText}`);
        setValues({weightChange:'',tumorShift:'',lungDensityChange:''});setNote('');setErrors({});
        await load(); // 以服务端返回的历史为准
      }else if(r.status===409){
        setSubmitError(`重复提交被拦截：${data.message??'相同评估已提交'}（记录 ${data.existingId??'?'}），未生成新记录。`);
      }else if(r.status===400){
        setSubmitError(`服务端校验失败：${Array.isArray(data.errors)?data.errors.join('；'):data.message??'输入无效'}`);
      }else if(r.status===404){
        setSubmitError('当前计划不存在，请重新选择计划。');
      }else{
        setSubmitError(`提交失败（HTTP ${r.status}），记录未保存，请稍后重试。`);
      }
    }catch{
      setSubmitError('网络或服务异常，提交失败，记录未保存，请检查后端服务后重试。');
    }finally{
      setSubmitting(false);
    }
  };

  const metricClass=(value:number,failLimit:'below'|'above',warnLimit:'below'|'above',t:AdaptiveRecord['thresholds'])=>{
    if(failLimit==='below'){
      if(value<t.coverageFailBelow)return 'metricFail';
      if(value<t.coverageWarnBelow)return 'metricWarn';
      return 'metricPass';
    }
    if(value>t.lungV20FailAbove)return 'metricFail';
    if(value>t.lungV20WarnAbove)return 'metricWarn';
    return 'metricPass';
  };

  return (
    <section className="grid adaptiveGrid">
      <div className="panel">
        <div className="panelHead"><h2>自适应评估录入</h2><span>计划 {planId}</span></div>
        <p className="adaptiveIntro">治疗中体重、肿瘤位置或肺部密度发生变化时录入测量值；靶区覆盖、肺部 V20 与建议结论均由服务端计算并保存。</p>
        {baseline&&thresholds&&(
          <div className="baselineStrip">
            <span>基线 D95 覆盖 <b>{baseline.coverage}%</b></span>
            <span>基线 肺部 V20 <b>{baseline.lungV20}%</b></span>
            <span>重计划阈值：覆盖 &lt; {thresholds.coverageFailBelow}% / V20 &gt; {thresholds.lungV20FailAbove}%</span>
          </div>
        )}
        <div className="adaptiveForm">
          {FIELDS.map(f=>(
            <label key={f.key} className={errors[f.key]?'fieldError':''}>
              <span>{f.label}<em>{f.unit}</em></span>
              <input
                type="number"inputMode="decimal"step="any"placeholder={f.placeholder}
                value={values[f.key]}
                disabled={submitting}
                onChange={e=>{setValues(v=>({...v,[f.key]:e.target.value}));setErrors(prev=>({...prev,[f.key]:undefined}));}}
              />
              {errors[f.key]&&<small>{errors[f.key]}</small>}
            </label>
          ))}
          <label className="noteField">
            <span>备注（可选，≤200 字）</span>
            <input type="text"maxLength={200}value={note}disabled={submitting}placeholder="如：第 12 次 CBCT 复核"onChange={e=>setNote(e.target.value)}/>
          </label>
        </div>
        <div className="adaptiveActions">
          <button onClick={submit}disabled={submitting}>{submitting?'计算并保存中…':'提交评估（服务端计算）'}</button>
        </div>
        {submitInfo&&<div className="adaptiveOk">{submitInfo}</div>}
        {submitError&&<div className="adaptiveErr">{submitError}</div>}
      </div>

      <div className="panel">
        <div className="panelHead"><h2>本计划评估历史</h2><button className="miniBtn"onClick={load}disabled={submitting}>刷新</button></div>
        {loadError&&<div className="adaptiveErr">{loadError} <button className="miniBtn"onClick={load}>重试</button></div>}
        {!loadError&&history===null&&<p className="adaptiveEmpty">历史加载中…</p>}
        {!loadError&&history&&history.length===0&&<p className="adaptiveEmpty">当前计划（{planId}）暂无评估记录。提交后在此展示，仅追加、不覆盖旧记录。</p>}
        <div className="adaptiveHistory">
          {history?.map(rec=>(
            <article key={rec.id}className="adaptiveCard">
              <header>
                <div><b>{rec.id}</b><span>{fmtTime(rec.createdAt)}</span></div>
                <span className={`recBadge ${REC_BADGE[rec.recommendation]}`}>{rec.recommendationText}</span>
              </header>
              <div className="adaptiveMetrics">
                <div><small>靶区 D95 覆盖（阈值 ≥{rec.thresholds.coverageFailBelow}%）</small>
                  <strong className={metricClass(rec.targetCoverage,'below','below',rec.thresholds)}>{rec.targetCoverage}%</strong></div>
                <div><small>肺部 V20（阈值 ≤{rec.thresholds.lungV20FailAbove}%）</small>
                  <strong className={metricClass(rec.lungV20,'above','above',rec.thresholds)}>{rec.lungV20}%</strong></div>
              </div>
              <div className="adaptiveInputs">
                <span>体重 {rec.inputs.weightChange>0?'+':''}{rec.inputs.weightChange} kg</span>
                <span>位移 {rec.inputs.tumorShift} mm</span>
                <span>密度 {rec.inputs.lungDensityChange>0?'+':''}{rec.inputs.lungDensityChange} HU</span>
              </div>
              <ul className="adaptiveReasons">{rec.reasons.map((x,i)=><li key={i}>{x}</li>)}</ul>
              {rec.warnings.length>0&&<ul className="adaptiveWarns">{rec.warnings.map((x,i)=><li key={i}>⚠ {x}</li>)}</ul>}
              {rec.inputs.note&&<p className="adaptiveNote">备注：{rec.inputs.note}</p>}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
