/**
 * 積算画面（数量・部品・単価・見積・要確認）と、PC 下部の積算結果の帯。
 * 表示はすべて computeEstimate(doc) から作る（保存しない）。
 */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import {
  computeEstimate, defaultEstimate, roundYen, defaultSaleUnit, fittingSpec, formatLength, pipeSpec, priceLineName, roundTo, saleUnitLabel,
  type Estimate, type FittingLine, type Issue, type PipeLine, type SaleUnit,
} from '../model/estimate';
import { ISSUE_LABEL, yen } from '../export/report';
import { CATALOG_SOURCE, catalogFittingPrice, catalogPipePrice, catalogSupportPrice, SUPPORT_CATALOG_SOURCE } from '../model/priceCatalog';
import { defaultSupportSettings, SUBSTRATE_LABEL, type SupportSettings } from '../model/supports';
import type { SupportLine } from '../model/estimate';
import { NumField, OptNumField } from './Panels';
import { usePrefs } from './prefs';

export function useEstimate(): Estimate {
  const doc = useStore((s) => s.doc);
  return useMemo(() => computeEstimate(doc), [doc]);
}

type Tab = 'qty' | 'parts' | 'price' | 'quote' | 'issues';

export function EstimateBar({ onOpen }: { onOpen: () => void }) {
  const est = useEstimate();
  return (
    <div className="est-bar" data-testid="estimate-bar">
      <span>材料費 <b>{yen(est.materialTotal)}</b></span>
      <span>施工費 <b>{yen(est.laborTotal)}</b></span>
      <span>合計（税込） <b data-testid="bar-total">{yen(est.total)}</b></span>
      {est.issues.length > 0 && <span className="warn">⚠ 要確認 {est.issues.length}件</span>}
      <button onClick={onOpen}>積算・見積を開く</button>
    </div>
  );
}

export function EstimateScreen({ onClose }: { onClose: () => void }) {
  const est = useEstimate();
  const [tab, setTab] = useState<Tab>('qty');
  const unit = usePrefs((s) => s.lengthUnit);
  const setUnit = usePrefs((s) => s.setLengthUnit);
  const tabs: [Tab, string][] = [['qty', '数量'], ['parts', '部品'], ['price', '単価'], ['quote', '見積'], ['issues', `要確認${est.issues.length ? `(${est.issues.length})` : ''}`]];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      (document.activeElement as HTMLElement | null)?.blur?.(); // 入力中の値を確定してから閉じる
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="estimate" data-testid="estimate-screen" role="dialog" aria-label="積算・見積">
      <header>
        <button className="back" data-testid="close-estimate" onClick={onClose}>‹ 図面へ</button>
        <strong>積算・見積</strong>
        <span className="est-total">合計 <b data-testid="est-total">{yen(est.total)}</b></span>
        <div className="seg-btns small">
          {(['mm', 'm'] as const).map((u) => <button key={u} className={unit === u ? 'on' : ''} onClick={() => setUnit(u)}>{u}</button>)}
        </div>
        <ExportButtons />
      </header>
      <nav className="seg-btns full est-tabs">
        {tabs.map(([t, l]) => <button key={t} data-testid={`tab-${t}`} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>)}
      </nav>
      <div className="est-body">
        {tab === 'qty' && <QuantityTab est={est} />}
        {tab === 'parts' && <PartsTab est={est} onIssue={() => setTab('issues')} />}
        {tab === 'price' && <PriceTab est={est} />}
        {tab === 'quote' && <QuoteTab est={est} />}
        {tab === 'issues' && <IssuesTab est={est} onClose={onClose} onPrice={() => setTab('price')} />}
      </div>
    </div>
  );
}

function QuantityTab({ est }: { est: Estimate }) {
  const unit = usePrefs((s) => s.lengthUnit);
  if (!est.pipes.length) return <p className="empty">配管・配線がありません。図面で描くと自動で集計されます。</p>;
  return (
    <div className="table-wrap">
      <table className="est-table" data-testid="qty-table">
        <thead><tr><th>種類</th><th>仕様</th><th>使用長</th><th>計測</th><th>余長込み</th><th>販売単位</th><th>発注数量</th><th>施工数量</th></tr></thead>
        <tbody>
          {est.pipes.map((p) => (
            <tr key={p.key}>
              <td>{p.name}</td><td>{pipeSpec(p)}</td>
              <td className="num" data-testid="qty-used">{formatLength(p.usedLength, unit)}</td>
              <td>{p.fieldCount && p.modelCount ? `実測${p.fieldCount}・モデル${p.modelCount}` : p.fieldCount ? '実測' : 'モデル'}</td>
              <td className="num">{formatLength(p.needLength, unit)}</td>
              <td>{saleUnitLabel(p.saleUnit)}</td>
              <td className="num" data-testid="qty-order"><b>{p.orderQty}{p.orderUnit}</b></td>
              <td className="num">{p.laborQty}m</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">使用長は現場実測長を優先し、ない区間は3Dモデルの経路長です。必要長 = 使用長 ×（1＋余長率）を販売単位に切り上げて発注数量にしています。</p>
    </div>
  );
}

function PartsTab({ est, onIssue }: { est: Estimate; onIssue: () => void }) {
  const confirm = est.nodeFittings.filter((n) => n.needsConfirm).length;
  return (
    <div className="table-wrap">
      {confirm > 0 && <p className="warn">⚠ 自動判定できない点が {confirm}か所あります。<button onClick={onIssue}>確認する</button></p>}
      {est.fittings.length === 0 ? <p className="empty">接続部品はありません。</p> : (
        <table className="est-table" data-testid="parts-table">
          <thead><tr><th>部品</th><th>仕様</th><th>個数</th><th>備考</th></tr></thead>
          <tbody>
            {est.fittings.map((f) => (
              <tr key={f.key}><td>{f.name}</td><td>{fittingSpec(f)}</td><td className="num"><b>{f.count}</b></td>
                <td className="small">{f.stockJoints ? `定尺の継ぎ足し ${f.stockJoints}個を含む` : ''}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">点ごとの部品は、図面で点を選んで「部品」から確定・変更できます。</p>
      <h3 className="h-sub">支持金具・ビス</h3>
      {est.supports.length === 0 ? <p className="empty">支持金具はありません（配線のみ、または「単価」タブで集計しない設定）。</p> : (
        <table className="est-table" data-testid="supports-table">
          <thead><tr><th>品名</th><th>仕様</th><th>数量</th><th>備考</th></tr></thead>
          <tbody>
            {est.supports.map((l) => (
              <tr key={l.key}><td>{l.name}</td><td>{l.spec}</td><td className="num"><b>{l.count}</b>{l.unit}</td><td className="small">{l.note}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">床から400mm以内の排水横管はレベルバンド、その他の配管はサドルバンド。継手で区切られた区間ごとに「長さ÷支持間隔」（最低1個）。区間ごとの変更は図面で配管を選んで「支持金具」から。</p>
    </div>
  );
}

const SALE_PRESETS: [string, SaleUnit][] = [
  ['1m単位', { kind: 'perLength', step: 1000 }], ['2m単位', { kind: 'perLength', step: 2000 }],
  ['定尺4m', { kind: 'straight', length: 4000 }], ['定尺5m', { kind: 'straight', length: 5000 }],
  ['50m巻', { kind: 'roll', length: 50000 }], ['100m巻', { kind: 'roll', length: 100000 }],
];
const sameUnit = (a: SaleUnit, b: SaleUnit) => a.kind === b.kind && (a.kind === 'perLength' ? a.step === (b as { step: number }).step : (a as { length: number }).length === (b as { length: number }).length);

function SaleUnitField({ line }: { line: PipeLine }) {
  const st = useStore.getState();
  const cur = line.saleUnit;
  const preset = SALE_PRESETS.findIndex(([, u]) => sameUnit(u, cur));
  const [custom, setCustom] = useState(preset < 0);
  const save = (u: SaleUnit) => st.setPrice(line.key, { material: line.price?.material ?? 0, labor: line.price?.labor ?? 0, saleUnit: u });
  const size = cur.kind === 'perLength' ? cur.step : cur.length;
  return (
    <div className="row">
      <select data-testid="sale-unit" value={custom ? 'custom' : String(preset)} onChange={(e) => {
        if (e.target.value === 'custom') { setCustom(true); return; }
        setCustom(false);
        save(SALE_PRESETS[Number(e.target.value)][1]);
      }}>
        {SALE_PRESETS.map(([l], i) => <option key={l} value={String(i)}>{l}</option>)}
        <option value="custom">任意</option>
      </select>
      {custom && (
        <>
          <select value={cur.kind} onChange={(e) => {
            const k = e.target.value as SaleUnit['kind'];
            save(k === 'perLength' ? { kind: k, step: size } : { kind: k, length: size });
          }}>
            <option value="perLength">長さ単位</option><option value="straight">定尺（本）</option><option value="roll">巻</option>
          </select>
          <NumField label="" value={size} min={1} onCommit={(v) => save(cur.kind === 'perLength' ? { kind: 'perLength', step: v } : { kind: cur.kind, length: v })} />
        </>
      )}
    </div>
  );
}

function PriceRow({ line, pipe }: { line: PipeLine | FittingLine; pipe: boolean }) {
  const st = useStore.getState();
  const saleUnit = pipe ? (line as PipeLine).saleUnit : undefined;
  const set = (patch: { material?: number; labor?: number }) =>
    st.setPrice(line.key, { material: line.price?.material ?? 0, labor: line.price?.labor ?? 0, ...(line.price?.saleUnit ? { saleUnit: line.price.saleUnit } : {}), ...patch });
  const hasCatalog = pipe
    ? catalogPipePrice((line as PipeLine)) !== undefined // 戻すと販売単位も既定（定尺4m）に戻るので参考単価の有無だけで判定
    : catalogFittingPrice((line as FittingLine).type, line as FittingLine, (line as FittingLine).size) !== undefined;
  const matUnit = !saleUnit ? '円/個' : saleUnit.kind === 'perLength' ? '円/m' : saleUnit.kind === 'straight' ? '円/本' : '円/巻';
  return (
    <div className="price-row" data-testid="price-row" data-key={line.key}>
      <div className="pname-s">{priceLineName(line)}
        {line.priceSource === 'none' && <span className="warn small"> 未登録</span>}
        {line.priceSource === 'catalog' && <span className="tag-cat small" data-testid="price-catalog"> メーカー参考単価</span>}
        {line.priceSource === 'user' && hasCatalog && <button className="small" data-testid="price-reset" onClick={() => st.setPrice(line.key, undefined)}>参考単価に戻す</button>}</div>
      <div className="row">
        <NumField label="材料単価" unit={matUnit} decimals={2} value={line.price?.material ?? 0} min={0} testId="price-material" onCommit={(v) => set({ material: v })} />
        <NumField label="施工単価" unit={pipe ? '円/m' : '円/個'} decimals={2} value={line.price?.labor ?? 0} min={0} testId="price-labor" onCommit={(v) => set({ labor: v })} />
        {pipe && <SaleUnitField line={line as PipeLine} />}
      </div>
    </div>
  );
}

function PriceTab({ est }: { est: Estimate }) {
  const settings = useStore((s) => s.doc.estimate) ?? defaultEstimate();
  const st = useStore.getState();
  return (
    <div className="price-tab">
      <section>
        <h3>現場の設定</h3>
        <div className="row">
          <label className="field inline">既定の余長
            <select data-testid="default-extra" value={[0, 0.05, 0.1].includes(settings.extraRate) ? String(settings.extraRate) : 'custom'}
              onChange={(e) => e.target.value !== 'custom' && st.updateEstimate({ extraRate: Number(e.target.value) })}>
              <option value="0">なし</option><option value="0.05">5%</option><option value="0.1">10%</option><option value="custom">任意</option>
            </select></label>
          <OptNumField label="余長率" unit="%" max={1000} value={roundTo(settings.extraRate * 100, 3)} onCommit={(v) => st.updateEstimate({ extraRate: (v ?? 0) / 100 })} />
          <OptNumField label="消費税" unit="%" max={100} testId="tax-rate" value={roundTo(settings.taxRate * 100, 3)} onCommit={(v) => st.updateEstimate({ taxRate: (v ?? 0) / 100 })} />
        </div>
        <div className="row">
          <label className="field inline">諸経費
            <select data-testid="overhead-mode" value={settings.overhead.mode} onChange={(e) => st.updateEstimate({ overhead: { mode: e.target.value as 'rate' | 'amount', value: 0 } })}>
              <option value="rate">率（%）</option><option value="amount">金額（円）</option>
            </select></label>
          {settings.overhead.mode === 'rate'
            ? <OptNumField label="" unit="%" max={1000} testId="overhead-value" value={roundTo(settings.overhead.value * 100, 3)} onCommit={(v) => st.updateEstimate({ overhead: { mode: 'rate', value: (v ?? 0) / 100 } })} />
            : <OptNumField label="" unit="円" testId="overhead-value" value={settings.overhead.value} onCommit={(v) => st.updateEstimate({ overhead: { mode: 'amount', value: v ?? 0 } })} />}
        </div>
      </section>
      <section>
        <h3>配管・配線の単価</h3>
        {est.pipes.length === 0 && <p className="muted">配管・配線がありません。</p>}
        {est.pipes.map((p) => <PriceRow key={p.key} line={p} pipe />)}
      </section>
      <section>
        <h3>部品の単価</h3>
        {est.fittings.length === 0 && <p className="muted">部品がありません。</p>}
        {est.fittings.map((f) => <PriceRow key={f.key} line={f} pipe={false} />)}
      </section>
      <section>
        <h3>支持金具・ビスの単価</h3>
        <SupportSettingsForm />
        {est.supports.map((l) => <SupportPriceRow key={l.key} line={l} />)}
        <p className="muted small" data-testid="support-catalog-note">支持金具・ビス・キリはメーカー希望価格のない「オープン価格」品のため、参考単価は {SUPPORT_CATALOG_SOURCE} です（サドル: 昭和コーポレーション ステンレス片サドル、コンクリートビス: マーベル SCS-432、ステンレスビス: 皿木ねじ 4.1×38、キリ: 大西工業 No.24 3.4mm）。レベルバンドはサイズ別の価格が得られないため入力してください。</p>
      </section>
      <p className="muted small">単価はこの現場に保存されます。材料費 = 発注数量 × 材料単価、施工費 = 施工数量 × 施工単価（行ごとに円未満四捨五入）。</p>
      <p className="muted small" data-testid="catalog-note">「メーカー参考単価」は {CATALOG_SOURCE} の材料価格です（配管は定尺4mのとき）。実際の仕入れ値に合わせて上書きしてください。施工単価は含まれません。材質を空欄にした配管は、給水=HIVP・給湯=HTVP・排水/汚水/通気/ドレン=VP として扱います。</p>
      <section>
        <h3>販売単位の目安</h3>
        <p className="muted small">配管は {saleUnitLabel(defaultSaleUnit('water'))}、電気・通信・冷媒は {saleUnitLabel(defaultSaleUnit('electric'))} が初期値です。</p>
      </section>
    </div>
  );
}

function TextField({ label, value, onCommit, testId, multiline }: { label: string; value: string; onCommit: (v: string) => void; testId?: string; multiline?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => { if (text !== value) onCommit(text); };
  return (
    <label className="field">{label}
      {multiline
        ? <textarea rows={3} data-testid={testId} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} />
        : <input data-testid={testId} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />}
    </label>
  );
}

function QuoteTab({ est }: { est: Estimate }) {
  const settings = useStore((s) => s.doc.estimate) ?? defaultEstimate();
  const st = useStore.getState();
  const sections: [string, string][] = [['material', '材料費'], ['labor', '施工費']];
  return (
    <div className="quote-tab">
      <section className="grid2">
        <TextField label="宛名（○○ 様）" testId="q-client" value={settings.client ?? ''} onCommit={(v) => st.updateEstimate({ client: v })} />
        <TextField label="工事名（空欄なら現場名）" testId="q-title" value={settings.title ?? ''} onCommit={(v) => st.updateEstimate({ title: v })} />
        <TextField label="発行者（会社名・住所・電話）" multiline value={settings.issuer ?? ''} onCommit={(v) => st.updateEstimate({ issuer: v })} />
        <TextField label="備考" multiline value={settings.note ?? ''} onCommit={(v) => st.updateEstimate({ note: v })} />
      </section>
      <div className="table-wrap">
        <table className="est-table" data-testid="quote-table">
          <thead><tr><th>項目</th><th>仕様</th><th>数量</th><th>単位</th><th>単価</th><th>金額</th></tr></thead>
          {sections.map(([sec, label]) => (
            <tbody key={sec}>
              <tr className="sec"><td colSpan={6}>{label}</td></tr>
              {est.lines.filter((l) => l.section === sec).map((l, i) => (
                <tr key={`${l.priceKey}-${i}`}><td>{l.name}</td><td>{l.spec}</td><td className="num">{l.quantity}</td><td>{l.unit}</td>
                  <td className="num">{yen(l.unitPrice)}</td><td className="num">{yen(l.amount)}</td></tr>
              ))}
            </tbody>
          ))}
          <tbody>
            <tr className="sec"><td colSpan={6}>その他 <button data-testid="add-extra" onClick={() => st.addExtraItem()}>＋ 項目を追加</button></td></tr>
            {settings.extras.map((x) => <ExtraRow key={x.id} id={x.id} />)}
          </tbody>
        </table>
      </div>
      <dl className="totals" data-testid="totals">
        <dt>材料費 計</dt><dd>{yen(est.materialTotal)}</dd>
        <dt>施工費 計</dt><dd>{yen(est.laborTotal)}</dd>
        {est.extrasTotal !== 0 && <><dt>その他 計</dt><dd>{yen(est.extrasTotal)}</dd></>}
        <dt>諸経費</dt><dd data-testid="t-overhead">{yen(est.overhead)}</dd>
        <dt>小計</dt><dd data-testid="t-subtotal">{yen(est.subtotal)}</dd>
        <dt>消費税（{roundTo(settings.taxRate * 100, 1)}%）</dt><dd data-testid="t-tax">{yen(est.tax)}</dd>
        <dt className="grand">合計</dt><dd className="grand" data-testid="t-total">{yen(est.total)}</dd>
      </dl>
    </div>
  );
}

function ExtraRow({ id }: { id: string }) {
  const x = useStore((s) => s.doc.estimate?.extras.find((e) => e.id === id));
  const st = useStore.getState();
  if (!x) return null;
  return (
    <tr className="extra-row">
      <td colSpan={2}><input key={x.name} aria-label="項目名" data-testid="extra-name" defaultValue={x.name} onBlur={(e) => e.target.value !== x.name && st.updateExtraItem(id, { name: e.target.value })} /></td>
      <td><input key={x.quantity} aria-label="数量" type="number" inputMode="decimal" data-testid="extra-qty" defaultValue={x.quantity}
        onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n !== x.quantity) st.updateExtraItem(id, { quantity: n }); }} /></td>
      <td><input key={x.unit} aria-label="単位" defaultValue={x.unit} onBlur={(e) => e.target.value !== x.unit && st.updateExtraItem(id, { unit: e.target.value })} /></td>
      <td><input key={x.unitPrice} aria-label="単価" type="number" inputMode="numeric" data-testid="extra-price" defaultValue={x.unitPrice}
        onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n !== x.unitPrice) st.updateExtraItem(id, { unitPrice: n }); }} /></td>
      <td className="num">{yen(roundYen(x.quantity * x.unitPrice))} <button className="danger" aria-label="削除" onClick={() => st.removeExtraItem(id)}>×</button></td>
    </tr>
  );
}

function IssuesTab({ est, onClose, onPrice }: { est: Estimate; onClose: () => void; onPrice: () => void }) {
  const st = useStore.getState();
  const go = (i: Issue) => {
    if (i.target.kind === 'price') { onPrice(); return; }
    const { doc } = useStore.getState();
    const net = doc.network;
    const nodeId = i.target.kind === 'node' ? i.target.id : net.segments[i.target.id]?.a;
    const floorId = nodeId ? net.nodes[nodeId]?.floorId : undefined;
    if (floorId && doc.building.floors.some((f) => f.id === floorId)) st.setActiveFloor(floorId);
    st.setTool('select');
    st.select({ kind: i.target.kind, id: i.target.id });
    onClose();
  };
  if (!est.issues.length) return <p className="empty">要確認の項目はありません。</p>;
  return (
    <ul className="issues" data-testid="issues">
      {est.issues.map((i, k) => (
        <li key={k}>
          <span className="tag">{ISSUE_LABEL[i.kind]}</span>
          <span className="msg-s">{i.message}</span>
          <button data-testid="issue-go" onClick={() => go(i)}>{i.target.kind === 'price' ? '単価へ' : '図面で選ぶ'}</button>
        </li>
      ))}
    </ul>
  );
}

function ExportButtons() {
  const [busy, setBusy] = useState<'' | 'pdf' | 'xlsx' | 'img'>('');
  const [err, setErr] = useState('');
  const run = async (kind: 'pdf' | 'xlsx') => {
    const { doc, meta } = useStore.getState();
    if (!meta) return;
    setBusy(kind);
    setErr('');
    try {
      const [{ buildReport, dateStamp }, { downloadBytes, safeName }] = await Promise.all([import('../export/report'), import('../export/download')]);
      const date = new Date();
      const report = buildReport(doc, { name: meta.name, address: meta.address, date });
      const base = `${safeName(meta.name)}_見積書_${dateStamp(date)}`;
      if (kind === 'pdf') {
        const [{ buildPdf }, font] = await Promise.all([
          import('../export/pdf'),
          fetch(`${import.meta.env.BASE_URL}fonts/NotoSansJP-JIS.ttf`).then((r) => { if (!r.ok) throw new Error('フォントを読み込めません'); return r.arrayBuffer(); }),
        ]);
        downloadBytes(await buildPdf(report, font), `${base}.pdf`, 'application/pdf');
      } else {
        const { buildExcel } = await import('../export/excel');
        downloadBytes(await buildExcel(report), `${base}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      }
    } catch (e) {
      setErr(`出力できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy('');
    }
  };
  const image = async (kind: 'plan' | '3d') => {
    const { meta, doc, activeFloorId } = useStore.getState();
    setBusy('img'); setErr('');
    try {
      const [{ planPng, view3dPng }, { downloadBytes, safeName }, { dateStamp }] = await Promise.all([import('../export/images'), import('../export/download'), import('../export/report')]);
      const floor = doc.building.floors.find((f) => f.id === activeFloorId)?.name ?? '';
      const base = `${safeName(meta?.name ?? '現場')}_${dateStamp(new Date())}`;
      if (kind === 'plan') {
        const svg = document.querySelector<SVGSVGElement>('[data-testid="plan"]');
        if (!svg) throw new Error('2D平面図を表示してから保存してください');
        downloadBytes(await planPng(svg), `${base}_平面図_${safeName(floor)}.png`, 'image/png');
      } else {
        const c = document.querySelector<HTMLCanvasElement>('.view3d canvas');
        if (!c) throw new Error('3D表示（3D または 2D+3D）にしてから保存してください');
        downloadBytes(await view3dPng(c), `${base}_3D.png`, 'image/png');
      }
    } catch (e) {
      setErr(`画像を保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(''); }
  };
  return (
    <div className="row export-btns">
      <button data-testid="export-plan" disabled={!!busy} onClick={() => void image('plan')}>平面図PNG</button>
      <button data-testid="export-3d" disabled={!!busy} onClick={() => void image('3d')}>3D PNG</button>
      <button data-testid="export-pdf" disabled={!!busy} onClick={() => run('pdf')}>{busy === 'pdf' ? '作成中…' : 'PDF'}</button>
      <button data-testid="export-xlsx" disabled={!!busy} onClick={() => run('xlsx')}>{busy === 'xlsx' ? '作成中…' : 'Excel'}</button>
      {err && <span className="err" role="alert">{err}</span>}
    </div>
  );
}

function SupportSettingsForm() {
  const raw = useStore((s) => s.doc.estimate?.supports);
  const sst = raw ?? defaultSupportSettings();
  const st = useStore.getState();
  const set = (patch: Partial<SupportSettings>) => st.updateEstimate({ supports: { ...sst, ...patch } });
  return (
    <div className="row" data-testid="support-settings">
      <label className="field inline"><input type="checkbox" data-testid="support-enabled" checked={sst.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> 支持金具・ビスを集計する</label>
      <label className="field inline">既定の取付下地
        <select data-testid="support-substrate" value={sst.substrate} onChange={(e) => set({ substrate: e.target.value as SupportSettings['substrate'] })}>
          {(['concrete', 'wood'] as const).map((k) => <option key={k} value={k}>{SUBSTRATE_LABEL[k]}</option>)}
        </select></label>
      <NumField label="支持間隔（呼び径80以下）" value={sst.spacingSmall} min={100} onCommit={(v) => set({ spacingSmall: v })} />
      <NumField label="（100以上）" value={sst.spacingLarge} min={100} onCommit={(v) => set({ spacingLarge: v })} />
      <NumField label="ビス" unit="本/個" value={sst.screwsPerSupport} min={0} max={10} onCommit={(v) => set({ screwsPerSupport: Math.round(v) })} />
      <NumField label="キリ1本で" unit="穴" value={sst.holesPerBit} min={1} onCommit={(v) => set({ holesPerBit: Math.round(v) })} />
    </div>
  );
}

function SupportPriceRow({ line }: { line: SupportLine }) {
  const st = useStore.getState();
  const set = (patch: { material?: number; labor?: number }) => st.setPrice(line.key, { material: line.price?.material ?? 0, labor: line.price?.labor ?? 0, ...patch });
  const hasCatalog = catalogSupportPrice(line.key) !== undefined;
  return (
    <div className="price-row" data-testid="price-row" data-key={line.key}>
      <div className="pname-s">{line.name} {line.spec}
        {line.priceSource === 'none' && <span className="warn small"> 未登録</span>}
        {line.priceSource === 'catalog' && <span className="tag-cat small"> 参考単価</span>}
        {line.priceSource === 'user' && hasCatalog && <button className="small" onClick={() => st.setPrice(line.key, undefined)}>参考単価に戻す</button>}</div>
      <div className="row">
        <NumField label="材料単価" unit={`円/${line.unit}`} decimals={2} value={line.price?.material ?? 0} min={0} testId="price-material" onCommit={(v) => set({ material: v })} />
        <NumField label="施工単価" unit={`円/${line.unit}`} decimals={2} value={line.price?.labor ?? 0} min={0} testId="price-labor" onCommit={(v) => set({ labor: v })} />
      </div>
    </div>
  );
}
