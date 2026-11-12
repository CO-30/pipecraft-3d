/**
 * 申請画面の「水理計算書」の条件と判定。値は空なら自動（自治体の値・既定値）、入れたら「自動に戻す」。
 * 足りないときは口径の提案を 1 回で反映できる（1 回の取り消しで戻る）。
 */
import type { SupplyCalc } from '../model/hydraulics/calc';
import type { SuiriSettings } from '../model/hydraulics/settings';
import type { DiameterChange } from '../model/hydraulics/suggest';
import type { SupplyRules } from '../model/hydraulics/supplyRules';
import { NumField } from './Panels';

type Props = {
  calc: SupplyCalc | null;
  rules: SupplyRules;
  settings: SuiriSettings;
  onChange: (patch: Partial<SuiriSettings>) => void;
  suggestion: { changes: DiameterChange[]; ok: boolean; message?: string } | null;
  onApply: () => void;
};

/** 自動の値か、入れた値か（入れた値なら「自動に戻す」） */
function AutoField({ label, unit, decimals, value, auto, unverified, testId, onSet }: { label: string; unit: string; decimals: number; value: number | undefined; auto: number; unverified?: boolean; testId: string; onSet: (v: number | undefined) => void }) {
  return (
    <span className="field inline">
      <NumField label={label} unit={unit} decimals={decimals} min={0} value={value ?? auto} testId={testId} onCommit={(v) => onSet(v)} />
      {value === undefined
        ? <span className={`badge ${unverified ? 'warn' : 'ok'}`} data-testid={`${testId}-auto`} title={unverified ? '自治体の値が未確認のため一般値で計算しています' : '自動の値'}>{unverified ? '自動・要確認' : '自動'}</span>
        : <button className="linkish small" data-testid={`${testId}-clear`} onClick={() => onSet(undefined)}>自動に戻す</button>}
      {value === undefined && unverified && <button className="small" data-testid={`${testId}-confirm`} title="水道局などで確かめた値がこの値と同じとき" onClick={() => onSet(auto)}>この値で確認済み</button>}
    </span>
  );
}

/** 器具の使用水量（L/min）。自動と同じ値は入れない */
function FlowInput({ id, flow, overridden, onSet }: { id: string; flow: number; overridden: boolean; onSet: (v: number | undefined) => void }) {
  const commit = (el: HTMLInputElement) => {
    const v = Number(el.value);
    if (el.value.trim() !== '' && Number.isFinite(v) && v > 0 && v !== flow) onSet(v);
    else el.value = String(flow);
  };
  return (
    <span className="suiri-flow">
      <input key={flow} type="number" inputMode="decimal" min={1} defaultValue={flow} data-testid={`suiri-flow-${id}`} aria-label="使用水量 L/min"
        onBlur={(e) => commit(e.currentTarget)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      <span className="muted small">L/分</span>
      {overridden && <button className="linkish small" data-testid={`suiri-flow-${id}-clear`} onClick={() => onSet(undefined)}>自動</button>}
    </span>
  );
}

export function SuiriPanel({ calc, rules, settings, onChange, suggestion, onApply }: Props) {
  const sizes = suggestion?.changes.reduce<Record<string, number>>((m, c) => { const k = `${c.from}→${c.to}`; m[k] = (m[k] ?? 0) + 1; return m; }, {}) ?? {};
  const svcDrawn = !!calc?.tree.service.drawn;
  const used = calc?.outlets.filter((o) => o.used).map((o) => o.fixtureId) ?? [];
  const toggle = (id: string, on: boolean) => {
    const base = settings.use ?? used;
    const next = on ? [...new Set([...base, id])] : base.filter((x) => x !== id);
    onChange({ use: next.length ? next : undefined });
  };
  return (
    <div className="suiri-panel">
      {calc && (
        <span className={`suiri-verdict ${calc.outOfScope ? 'na' : calc.ok ? 'ok' : 'ng'}`} data-testid="suiri-verdict">
          <strong>{calc.outOfScope ? `対象外（参考: ${calc.ok ? '適当' : '不適当'}）` : calc.ok ? '適当' : '不適当'}</strong>
          {calc.outOfScope && ` ${calc.outOfScope}のため、直結直圧として計算した参考の値です。`}
          {` 全所要水頭 ${calc.total.toFixed(2)}m ＋ 余裕 ${calc.margin.toFixed(2)}m ＝ ${calc.required.toFixed(2)}m ／ 設計水圧 ${calc.pressure}MPa（${calc.available.toFixed(2)}m）`}
        </span>
      )}
      {suggestion && suggestion.ok && suggestion.changes.length > 0 && (
        <button className="primary" data-testid="suiri-apply" onClick={onApply}>
          口径を提案どおりにする（{suggestion.changes.length} か所: {Object.entries(sizes).map(([k, n]) => `φ${k.replace('→', '→φ')}${n > 1 ? ` ×${n}` : ''}`).join('、')}）
        </button>
      )}
      {suggestion && !suggestion.ok && suggestion.message && <span className="badge warn" data-testid="suiri-suggest-fail">{suggestion.message}</span>}
      <details className="suiri-conditions" data-testid="suiri-conditions">
        <summary data-testid="suiri-conditions-open">条件を変える（設計水圧 {settings.pressure ?? rules.designPressure.v}MPa{settings.pressure === undefined && rules.designPressure.status === 'unknown' ? '・要確認' : ''}、同時に使う器具など）</summary>
        <div className="suiri-fields">
          <AutoField label="設計水圧" unit="MPa" decimals={3} value={settings.pressure} auto={rules.designPressure.v} unverified={rules.designPressure.status === 'unknown'} testId="suiri-pressure" onSet={(v) => onChange({ pressure: v })} />
          <AutoField label="余裕水頭" unit="m" decimals={2} value={settings.margin} auto={rules.margin.v} testId="suiri-margin" onSet={(v) => onChange({ margin: v })} />
          <AutoField label="配水管とメーターの高低差" unit="m" decimals={2} value={settings.drop} auto={rules.mainDrop.v} testId="suiri-drop" onSet={(v) => onChange({ drop: v })} />
          <AutoField label="メーターの口径" unit="mm" decimals={0} value={settings.meterDia} auto={calc?.tree.meterDia ?? 20} testId="suiri-meter" onSet={(v) => onChange({ meterDia: v })} />
          {!svcDrawn && <AutoField label="引込の延長" unit="m" decimals={1} value={settings.serviceLen} auto={rules.serviceLength.v} testId="suiri-service" onSet={(v) => onChange({ serviceLen: v })} />}
          {calc && (
            <span className="field inline suiri-use">同時に使う器具（{calc.totalOutlets} 栓 → {calc.simultaneous} 栓）
              {calc.outlets.map((o) => (
                <span key={o.fixtureId} className="suiri-outlet">
                  <label className="small">
                    <input type="checkbox" data-testid={`suiri-use-${o.fixtureId}`} checked={o.used} onChange={(e) => toggle(o.fixtureId, e.target.checked)} />{o.letter} {o.label}
                  </label>
                  <FlowInput id={o.fixtureId} flow={o.flow} overridden={settings.flows[o.fixtureId] !== undefined}
                    onSet={(v) => { const flows = { ...settings.flows }; if (v === undefined) delete flows[o.fixtureId]; else flows[o.fixtureId] = v; onChange({ flows }); }} />
                </span>
              ))}
              {settings.use ? <button className="linkish small" data-testid="suiri-use-auto" onClick={() => onChange({ use: undefined })}>自動で選ぶ</button> : <span className="muted small">（自動で選んでいます）</span>}
            </span>
          )}
        </div>
      </details>
    </div>
  );
}
