import {useEffect, useRef, useState} from 'react';
import './styles.css';

const getJson = (u: string) => fetch(u).then(r => r.json());

type Recommendation = 'continue' | 'observe' | 'replan';
interface AdaptiveInputs {weightChangeKg: number; tumorShiftMm: number; lungDensityChangeHu: number;}
interface AdaptiveAssessment {
  id: string;
  planId: string;
  inputs: AdaptiveInputs;
  results: {
    targetCoveragePct: number;
    lungV20Pct: number;
    coverageThresholdPct: number;
    v20LimitPct: number;
    flags: {coverageCritical: boolean; v20Critical: boolean};
  };
  recommendation: Recommendation;
  rationale: string[];
  createdAt: string;
}

const RECO_META: Record<Recommendation, {label: string; cls: string}> = {
  continue: {label: '可按原计划继续', cls: 'recContinue'},
  observe: {label: '临界 · 密切观察', cls: 'recObserve'},
  replan: {label: '建议重计划评估', cls: 'recReplan'},
};

const FIELD_RULES = [
  {key: 'weightChangeKg' as const, label: '体重变化', unit: 'kg', min: -30, max: 30, allowNegative: true,
   hint: '相对计划 CT 的体重变化，下降填负值（-30 ~ 30）'},
  {key: 'tumorShiftMm' as const, label: '肿瘤位置位移', unit: 'mm', min: 0, max: 50, allowNegative: false,
   hint: '影像中肿瘤/靶区中心位移的模，0 ~ 50，不接受负值'},
  {key: 'lungDensityChangeHu' as const, label: '肺部密度变化', unit: 'HU', min: -300, max: 300, allowNegative: true,
   hint: '平均肺密度变化（CT 值），密度降低填负值（-300 ~ 300）'},
];

type FormState = Record<'weightChangeKg' | 'tumorShiftMm' | 'lungDensityChangeHu', string>;
const EMPTY_FORM: FormState = {weightChangeKg: '', tumorShiftMm: '', lungDensityChangeHu: ''};

/** 与服务端一致的前端预校验（仅用于即时反馈，服务端为最终裁决） */
function validateForm(form: FormState) {
  const errors: Partial<Record<keyof FormState, string>> = {};
  for (const f of FIELD_RULES) {
    const raw = form[f.key].trim();
    if (raw === '') {errors[f.key] = `${f.label}不能为空`; continue;}
    const n = Number(raw);
    if (!Number.isFinite(n)) {errors[f.key] = `${f.label}必须是数字`; continue;}
    if (!f.allowNegative && n < 0) {errors[f.key] = `${f.label}不能为负值`; continue;}
    if (n < f.min || n > f.max) {errors[f.key] = `允许范围 ${f.min} ~ ${f.max} ${f.unit}`;}
  }
  return errors;
}

export default function App() {
  const [tab, setTab] = useState('dose');
  const [patient, setPatient] = useState<any>();
  const [plans, setPlans] = useState<any[]>([]);
  const [active, setActive] = useState('PLAN-A');
  const [constraints, setConstraints] = useState<any>();
  const [compare, setCompare] = useState<any>();
  const [slice, setSlice] = useState<any>();
  const [reviewer, setReviewer] = useState('');

  useEffect(() => {
    getJson('/api/patient/current').then(setPatient);
    getJson('/api/plans').then(setPlans);
    getJson('/api/compare').then(setCompare);
  }, []);
  useEffect(() => {
    if (active) {
      getJson(`/api/plans/${active}/constraints`).then(setConstraints);
      getJson(`/api/plans/${active}/dose-slice?index=12`).then(setSlice);
    }
  }, [active]);

  const approve = async () => {
    const r = await fetch(`/api/plans/${active}/approve`, {method: 'POST'}).then(x => x.json());
    alert(r.approved ? '计划已签发' : `签发被阻断：${r.failed?.map((x: any) => x.name).join('、')}`);
  };

  return (
    <main>
      <header>
        <div>
          <span className="eyebrow">RADIATION ONCOLOGY / PLAN QA</span>
          <h1>放射治疗剂量计划验证与器官风险评估系统</h1>
          <p>{patient?.patient?.id} · {patient?.patient?.diagnosis} · 处方 {patient?.patient?.rxDose} Gy / {patient?.patient?.fractions} 次</p>
        </div>
        <div className="badge">物理师复核模式</div>
      </header>
      <nav>
        {[['dose', '剂量阅片'], ['constraints', '约束校验'], ['compare', '计划对比'], ['adaptive', '自适应评估']].map(([id, label]) =>
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        )}
      </nav>
      <section className="toolbar">
        <label>当前计划
          <select value={active} onChange={e => setActive(e.target.value)}>
            {plans.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <span className={`planStatus ${constraints?.gate}`}>{constraints?.gate === 'ready' ? '签发门禁通过' : '存在约束风险'}</span>
      </section>

      {tab === 'dose' && (
        <section className="grid">
          <div className="panel imagePanel">
            <div className="panelHead"><h2>断层切片剂量叠加</h2><span>切片 12 / 32 · 等剂量线：20 / 50 / 95%</span></div>
            <div className="slice">{slice?.data.map((row: number[], y: number) => row.map((v: number, x: number) =>
              <span key={`${x}-${y}`} style={{background: `hsl(${Math.max(0, 240 - v * 2.2)},${v > 80 ? 88 : 55}%,${25 + v * .45}%)`}} />))}</div>
            <div className="doseLegend"><span style={{background: '#244bd5'}} />低剂量 <span style={{background: '#f3bb35'}} />中剂量 <span style={{background: '#ef555b'}} />高剂量</div>
          </div>
          <div className="panel">
            <div className="panelHead"><h2>计划参数</h2><span>{active}</span></div>
            {plans.find(p => p.id === active) && Object.entries(plans.find(p => p.id === active)).filter(([k]) => !['id', 'status'].includes(k)).map(([k, v]) =>
              <div className="kv" key={k}><span>{k}</span><b>{String(v)}</b></div>)}
            <div className="callout">剂量验证不是单一通过/失败判断，需要同时审查靶区覆盖、危及器官受量、机器跳数和算法版本。</div>
          </div>
        </section>
      )}

      {tab === 'constraints' && (
        <section className="grid">
          <div className="panel">
            <div className="panelHead"><h2>结构约束校验</h2><span>DVH 指标自动计算</span></div>
            {constraints?.checks.map((x: any) =>
              <div className="constraint" key={x.structureId}>
                <div><b>{x.name}</b><small>{x.metric} · 限值 {x.limit}{x.unit}</small></div>
                <strong className={x.pass ? 'pass' : 'fail'}>{x.value}{x.unit}</strong>
                <span>{x.pass ? 'PASS' : 'FAIL'}</span>
              </div>)}
          </div>
          <div className="panel">
            <div className="panelHead"><h2>DVH 曲线摘要</h2><span>体积-剂量关系</span></div>
            {patient?.structures.map((s: any) =>
              <div className="bar" key={s.id}>
                <span>{s.name}</span>
                <div><i style={{width: `${Math.min(100, (constraints?.checks.find((x: any) => x.structureId === s.id)?.value ?? 0))}%`}} /></div>
                <b>{constraints?.checks.find((x: any) => x.structureId === s.id)?.value}</b>
              </div>)}
            <div className="review">
              <input placeholder="复核人姓名" value={reviewer} onChange={e => setReviewer(e.target.value)} />
              <button onClick={() => fetch(`/api/plans/${active}/peer-review`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({reviewer, note: '已完成剂量约束复核'})})}>记录同行复核</button>
              <button onClick={approve}>签发计划</button>
            </div>
          </div>
        </section>
      )}

      {tab === 'compare' && (
        <section className="panel">
          <div className="panelHead"><h2>计划对比与选择</h2><span>同一患者、不同照射技术</span></div>
          <div className="compareGrid">{compare?.plans.map((p: any) =>
            <div key={p.id} className={`compareCard ${p.id === active ? 'selected' : ''}`} onClick={() => setActive(p.id)}>
              <h3>{p.label}</h3>
              <strong>{p.targetCoverage}%</strong>
              <small>PTV D95 覆盖</small>
              <p>MU {p.mu} · 约束失败 {p.checks.filter((x: any) => !x.pass).length} 项</p>
              {p.checks.map((x: any) => <div key={x.structureId} className={x.pass ? 'tinyPass' : 'tinyFail'}>{x.name}: {x.value}{x.unit}</div>)}
            </div>)}
          </div>
          <div className="recommend">系统建议：{compare?.recommendation}</div>
        </section>
      )}

      {tab === 'adaptive' && <AdaptivePanel planId={active} planLabel={plans.find(p => p.id === active)?.label ?? active} />}
    </main>
  );
}

function AdaptivePanel({planId, planLabel}: {planId: string; planLabel: string}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [assessments, setAssessments] = useState<AdaptiveAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);
  const [duplicateNotice, setDuplicateNotice] = useState('');
  const reqSeq = useRef(0);
  // 同一提交尝试复用幂等键：请求失败后重试若服务端实际已落库，会返回原记录而非新建
  const attemptKey = useRef<string>('');

  // 切换计划或重新进入页面时重新拉取该计划的历史；过期响应一律丢弃，杜绝串数据
  useEffect(() => {
    const seq = ++reqSeq.current;
    setLoading(true); setLoadError(''); setAssessments([]);
    setForm(EMPTY_FORM); setErrors({}); setSubmitError(''); setDuplicateNotice(''); setLastSavedId(null);
    fetch(`/api/plans/${planId}/adaptive-assessments`)
      .then(async r => {
        if (!r.ok) throw new Error(r.status === 404 ? '计划不存在' : `加载失败（HTTP ${r.status}）`);
        const data = await r.json();
        if (seq !== reqSeq.current) return;
        setAssessments(data.assessments);
      })
      .catch(e => { if (seq === reqSeq.current) setLoadError(e.message || '历史记录加载失败'); })
      .finally(() => { if (seq === reqSeq.current) setLoading(false); });
  }, [planId]);

  const updateField = (key: keyof FormState, value: string) => {
    setForm(f => ({...f, [key]: value}));
    setErrors(e => ({...e, [key]: undefined}));
    setSubmitError('');
  };

  const submit = async () => {
    if (submitting) return;                       // 提交进行中：忽略重复点击
    setDuplicateNotice('');
    const clientErrors = validateForm(form);     // 空值 / 非数字 / 负值 / 越界即时拦截
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) {setSubmitError('请修正表单中标红的字段后再提交'); return;}

    if (!attemptKey.current) {
      attemptKey.current = (globalThis.crypto?.randomUUID?.() ?? `adp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    }
    const payload = {
      weightChangeKg: Number(form.weightChangeKg),
      tumorShiftMm: Number(form.tumorShiftMm),
      lungDensityChangeHu: Number(form.lungDensityChangeHu),
      idempotencyKey: attemptKey.current,
    };
    setSubmitting(true); setSubmitError('');
    try {
      const r = await fetch(`/api/plans/${planId}/adaptive-assessments`, {
        method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => null);
      if (r.status === 400 && data?.fields) {    // 服务端校验（最终裁决）
        setErrors(data.fields);
        setSubmitError('服务端校验未通过：' + Object.values(data.fields).join('；'));
        return;
      }
      if (r.status === 404) {setSubmitError('提交失败：当前计划不存在，请刷新后重新选择计划'); return;}
      if (r.status === 409) {setSubmitError('提交失败：该提交编号已用于其他计划，已防止重复落库'); return;}
      if (!r.ok || !data?.assessment) {setSubmitError(`提交失败（HTTP ${r.status}），记录未保存，请重试`); return;}

      // 以服务端返回的历史为准，不做本地拼接计算
      setAssessments(data.assessments);
      setLastSavedId(data.assessment.id);
      if (data.duplicate) setDuplicateNotice('检测到重复提交：已返回上一次保存的记录，未产生新评估。');
      setForm(EMPTY_FORM); setErrors({});
      attemptKey.current = '';                    // 成功后换新键，下一次是全新评估
    } catch {
      setSubmitError('网络异常，提交未确认。请直接重试：若服务端已保存，将返回原记录而不会重复落库。');
    } finally {
      setSubmitting(false);
    }
  };

  const newestFirst = [...assessments].reverse();

  return (
    <section className="grid adaptiveGrid">
      <div className="panel">
        <div className="panelHead">
          <h2>自适应评估录入</h2><span>{planLabel} · {planId}</span>
        </div>
        <p className="adaptiveIntro">
          治疗期间出现体重、肿瘤位置或肺部密度变化时录入；靶区覆盖与双肺 V20 由服务端按该计划基线计算。
        </p>
        {FIELD_RULES.map(f => (
          <div className="adaptiveField" key={f.key}>
            <label htmlFor={f.key}>{f.label} <em>({f.unit})</em></label>
            <input
              id={f.key}
              type="number"
              step="any"
              inputMode="decimal"
              placeholder={`${f.min} ~ ${f.max}`}
              value={form[f.key]}
              aria-invalid={!!errors[f.key]}
              disabled={submitting}
              onChange={e => updateField(f.key, e.target.value)}
            />
            <small>{errors[f.key] ? <span className="fieldError">{errors[f.key]}</span> : f.hint}</small>
          </div>
        ))}
        {submitError && <div className="adaptiveError" role="alert">{submitError}</div>}
        {duplicateNotice && <div className="adaptiveWarn">{duplicateNotice}</div>}
        <div className="adaptiveActions">
          <button onClick={submit} disabled={submitting}>{submitting ? '提交中…' : '提交评估'}</button>
          <button className="ghost" disabled={submitting} onClick={() => {setForm(EMPTY_FORM); setErrors({}); setSubmitError('');}}>清空</button>
        </div>
        <div className="callout">
          判定规则（服务端执行）：D95 覆盖 ≥ 95.000% 且双肺 V20 ≤ 25.000% 可继续；恰处临界边界（如 95.000% / 25.000%）算达标；
          任一指标距阈值 1 个单位内为「临界观察」；任一越限则建议重计划。提交期间按钮锁定，并通过提交编号防止重复落库。
        </div>
      </div>

      <div className="panel">
        <div className="panelHead"><h2>评估历史</h2><span>仅追加 · 不覆盖旧记录</span></div>
        {loading && <div className="adaptiveEmpty">正在加载 {planLabel} 的评估历史…</div>}
        {!loading && loadError && <div className="adaptiveError" role="alert">{loadError}</div>}
        {!loading && !loadError && assessments.length === 0 && (
          <div className="adaptiveEmpty">该计划暂无评估记录。提交一次评估后将在此按时间展示，切换计划不会混入其他计划的数据。</div>
        )}
        <div className="adaptiveHistory">
          {newestFirst.map(a => {
            const covFail = a.results.targetCoveragePct < a.results.coverageThresholdPct;
            const v20Fail = a.results.lungV20Pct > a.results.v20LimitPct;
            const meta = RECO_META[a.recommendation];
            return (
              <article key={a.id} className={`adaptiveCard ${a.id === lastSavedId ? 'justSaved' : ''}`}>
                <div className="adaptiveCardHead">
                  <span>{new Date(a.createdAt).toLocaleString('zh-CN', {hour12: false})}</span>
                  <span className={`recBadge ${meta.cls}`}>{meta.label}</span>
                </div>
                <div className="adaptiveMetrics">
                  <div>
                    <small>靶区 D95 覆盖</small>
                    <b className={covFail ? 'fail' : a.results.flags.coverageCritical ? 'warn' : 'pass'}>
                      {a.results.targetCoveragePct}%
                    </b>
                    <i>阈值 ≥ {a.results.coverageThresholdPct}%{a.results.flags.coverageCritical && ' · 临界'}</i>
                  </div>
                  <div>
                    <small>双肺 V20</small>
                    <b className={v20Fail ? 'fail' : a.results.flags.v20Critical ? 'warn' : 'pass'}>
                      {a.results.lungV20Pct}%
                    </b>
                    <i>限值 ≤ {a.results.v20LimitPct}%{a.results.flags.v20Critical && ' · 临界'}</i>
                  </div>
                </div>
                <div className="adaptiveInputs">
                  录入：体重 {a.inputs.weightChangeKg > 0 ? `+${a.inputs.weightChangeKg}` : a.inputs.weightChangeKg} kg ·
                  位移 {a.inputs.tumorShiftMm} mm ·
                  肺密度 {a.inputs.lungDensityChangeHu > 0 ? `+${a.inputs.lungDensityChangeHu}` : a.inputs.lungDensityChangeHu} HU
                </div>
                <ul className="adaptiveRationale">{a.rationale.map((line, i) => <li key={i}>{line}</li>)}</ul>
                <div className="adaptiveCardId">{a.id}</div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
