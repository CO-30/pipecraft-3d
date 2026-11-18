/**
 * 「提出書類一式」: この工事で出す書類（申請書・道路の書類・申請図面）を 1 つの一覧に。
 * 書類ごとに「出力できます／確認が必要（理由）／作れません」を出し、1 つずつ、またはまとめて ZIP で保存する。
 * 中身は申請書タブ・道路の手続き・「まとめてPDF」と同じ作り方（src/forms/produce.ts・buildFor）。
 */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { repo } from '../storage/instance';
import type { MunicipalityProfile } from '../model/municipality';
import { EMPTY_CONTRACTOR, withDefaults, type Contractor } from '../forms/types';
import { CONTRACTOR_KEY, FORM_SETS, isNanbu } from '../forms/formSets';
import { nanbuWarnings } from '../forms/nanbu';
import { ROAD_OFFICES_KEY, roadValues, type RoadOffices } from '../road/fields';
import { roadTakeoffs, roadWarnings } from '../road/model';
import { productRows } from '../forms/productList';
import { fixtureProducts } from '../forms/fixtureProducts';
import type { FormWhat, Produced } from '../forms/produce';
import type { ProductMemory } from '../forms/fixtureProducts';
import { BUNDLE_KINDS, KIND_LABEL, type ShinseiBuild } from './shinseiBuild';
import { rowStatus } from './ShinseiBundleDialog';
import { checkSummary, docRows, statusText, type DocId, type DocRow } from './docCenter';

type BKind = (typeof BUNDLE_KINDS)[number];
const fontBytes = () => fetch(`${import.meta.env.BASE_URL}fonts/NotoSansJP-JIS.ttf`).then((r) => { if (!r.ok) throw new Error('フォントを読み込めません'); return r.arrayBuffer(); });
const formBytes = (path: string) => fetch(`${import.meta.env.BASE_URL}forms/${path}`).then((r) => { if (!r.ok) throw new Error(`様式（${path}）を読み込めません`); return r.arrayBuffer(); });
const SUPPLY = new Set(['water', 'hotWater']);
const DRAIN = new Set(['sewage', 'drain']);

export function DocCenterDialog({ profile, siteName, date, buildFor, asBuilt, onFix, onClose }: {
  profile: MunicipalityProfile; siteName: string; date: Date;
  buildFor: (k: BKind) => ShinseiBuild;
  asBuilt: boolean;
  /** 直す場所へ（申請書タブ・まとめてPDF の一覧） */
  onFix: (at: NonNullable<DocRow['fixAt']>) => void;
  onClose: () => void;
}) {
  const doc = useStore((s) => s.doc);
  const meta = useStore((s) => s.meta);
  const set = FORM_SETS[profile.id];
  const [contractor, setContractor] = useState<Contractor | null>(null);
  const [offices, setOffices] = useState<RoadOffices>({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  /** この画面で出力した書類 */
  const [done, setDone] = useState<Partial<Record<DocId, boolean>>>({});
  const [picked, setPicked] = useState<Partial<Record<DocId, boolean>>>({});

  useEffect(() => {
    let alive = true;
    Promise.all([repo.getSetting<Contractor>(CONTRACTOR_KEY).catch(() => undefined), repo.getSetting<RoadOffices>(ROAD_OFFICES_KEY).catch(() => undefined)])
      .then(([c, o]) => { if (alive) { setContractor({ ...EMPTY_CONTRACTOR, ...(c ?? {}) }); if (o) setOffices(o); } });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  useEffect(() => { setDone({}); }, [doc]);
  const address = meta?.address;
  const values = useMemo(() => (set ? withDefaults(set, doc, { name: siteName, address }) : (doc.site?.application ?? {})), [set, doc, siteName, address]);
  const road = useMemo(() => roadValues(doc, { name: siteName, address }, contractor ?? EMPTY_CONTRACTOR, offices), [doc, siteName, address, contractor, offices]);
  const drawings = useMemo(() => BUNDLE_KINDS.map((k) => { const b = buildFor(k); const st = rowStatus(b); return { b, state: { label: KIND_LABEL[k], ready: st.ready, picked: st.preChecked, warnings: b.warnings.length, text: st.text } }; }), [buildFor]);
  const rows = useMemo(() => {
    const segs = Object.values(doc.network.segments);
    return docRows({
      set, profileName: profile.name, values, contractor: contractor ?? EMPTY_CONTRACTOR,
      hasSupply: segs.some((s) => SUPPLY.has(s.system)), hasDrain: segs.some((s) => DRAIN.has(s.system)),
      roadCount: roadTakeoffs(road).length, roadWarnings: [...(road['road.roadAdmin'] || road['road.roadKind'] === '私道' ? [] : ['道路管理者（占用の提出先）が未入力です']), ...(road['road.police'] ? [] : ['警察署（道路使用の提出先）が未入力です']), ...roadWarnings(road)],
      productCount: isNanbu(set) ? fixtureProducts(doc, values, {}).length : productRows(doc).length, roadConfirmed: ['road.water', 'road.sewer'].some((k) => k in (doc.site?.application ?? {})), formWarnings: isNanbu(set) ? nanbuWarnings(values) : [], drawings: drawings.map((d) => d.state),
    });
  }, [doc, set, profile.name, values, contractor, road, drawings]);

  const loading = drawings.some((d) => rowStatus(d.b).loading);
  const on = (r: DocRow) => r.status !== 'blocked' && (picked[r.id] ?? true);
  const chosen = rows.filter(on);

  const produce = async (r: DocRow): Promise<Produced> => {
    const c = contractor ?? EMPTY_CONTRACTOR;
    if (r.id === 'drawings') {
      const [{ safeName }, { dateStamp }, { sheetsToPdf }, font] = await Promise.all([import('../export/download'), import('../export/report'), import('../export/sheet'), fontBytes()]);
      const sheets = drawings.filter((d) => d.state.ready && d.state.picked).flatMap((d) => d.b.sheets);
      return { bytes: await sheetsToPdf(sheets, font), filename: `${safeName(siteName)}_${asBuilt ? '竣工' : ''}申請図面一式_${dateStamp(new Date())}.pdf`, mime: 'application/pdf', notes: [] };
    }
    if (r.id === 'road') {
      const { produceRoad } = await import('../forms/produce');
      return produceRoad({ doc, siteName, date, address: address ?? '', values: road, fontBytes });
    }
    const [{ produceForm }, { PRODUCT_MEMORY_KEY }] = await Promise.all([import('../forms/produce'), import('../forms/fixtureProducts')]);
    return produceForm(r.id as FormWhat, {
      doc, profile, siteName, date, address, values, contractor: c,
      planEl: document.querySelector<SVGSVGElement>('[data-testid="plan"]'),
      fontBytes, formBytes, productMemory: () => repo.getSetting<ProductMemory>(PRODUCT_MEMORY_KEY),
    });
  };

  const run = async (targets: DocRow[], zip: boolean) => {
    setBusy(zip ? 'zip' : targets[0].id); setErr(''); setNotes([]);
    const files: Produced[] = [];
    const failed: string[] = [];
    // 1 つ失敗しても残りは出す（どれが出せなかったかを伝える）
    for (const r of targets) {
      try { files.push(await produce(r)); setDone((d) => ({ ...d, [r.id]: true })); }
      catch (e) { failed.push(`${r.label}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    try {
      const { downloadBytes, safeName } = await import('../export/download');
      if (zip && files.length) {
        const [{ zipStore }, { dateStamp }] = await Promise.all([import('../export/zip'), import('../export/report')]);
        downloadBytes(zipStore(files.map((f) => ({ name: f.filename, bytes: f.bytes }))), `${safeName(siteName)}_提出書類一式_${dateStamp(new Date())}.zip`, 'application/zip');
      } else for (const f of files) downloadBytes(f.bytes, f.filename, f.mime);
    } catch (e) { failed.push(e instanceof Error ? e.message : String(e)); }
    if (failed.length) setErr(`出力できなかった書類があります: ${failed.join(' / ')}`);
    const warn = checkSummary(targets);
    setNotes([...(files.length ? [zip ? `${files.length} 種類の書類を 1 つの ZIP にまとめました` : `「${targets[0].label}」を保存しました`] : []), ...(warn && files.length ? [`⚠ ${warn}`] : []), ...files.flatMap((f) => f.notes)]);
    setBusy('');
  };

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="提出書類一式" data-testid="doc-center" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal bundle doc-center">
        <h2>提出書類一式{asBuilt ? '（竣工図）' : ''}</h2>
        <p className="small muted">「{profile.name}」でこの工事に出す書類です。入力は 1 回だけで、全部の書類に入ります。</p>
        <ul className="bundle-list">
          {rows.map((r) => (
            <li key={r.id} data-testid={`doc-row-${r.id}`} className={r.status === 'ready' ? 'ok' : r.status === 'check' ? 'warn' : 'ng'}>
              <label>
                <input type="checkbox" checked={on(r)} disabled={r.status === 'blocked'} onChange={(e) => setPicked({ ...picked, [r.id]: e.target.checked })} />
                <b>{r.label}</b><span className="small muted">（{r.format}）</span>
                {done[r.id] && <span className="badge ok" data-testid={`doc-done-${r.id}`}>出力済み</span>}
              </label>
              <div className="bundle-status small">
                {contractor ? statusText(r) : '確認中…'}
                {contractor && r.reasons.length > 0 && <ul className="doc-reasons">{r.reasons.map((x, n) => <li key={n}>{x}</li>)}</ul>}
              </div>
              <span className="doc-row-btns">
                {r.status !== 'blocked' && <button type="button" className="small" data-testid={`doc-out-${r.id}`} disabled={!!busy || !contractor || loading} onClick={() => void run([r], false)}>{busy === r.id ? '作成中…' : '出力'}</button>}
                {r.fixAt && r.status !== 'ready' && <button type="button" className="linkish small" aria-label={`${r.label}を直す`} onClick={() => onFix(r.fixAt!)}>直す ›</button>}
              </span>
            </li>
          ))}
        </ul>
        {roadTakeoffs(road).length === 0 && <p className="small muted">道路の書類（道路占用・道路使用許可）は、取出しを「しない」にしているので入れていません。</p>}
        {loading && <p className="small muted">見取図の地図を読み込んでいます…（終わると出力できます）</p>}
        {!busy && notes.length === 0 && checkSummary(chosen) && <p className="small warn" data-testid="doc-check-summary">⚠ {checkSummary(chosen)}</p>}
        {err && <p className="est-provisional" role="alert">{err}</p>}
        {notes.length > 0 && <ul className="small muted doc-notes" data-testid="doc-notes">{notes.map((n, k) => <li key={k}>{n}</li>)}</ul>}
        <div className="modal-btns">
          <button type="button" className="big" onClick={onClose}>閉じる</button>
          <button type="button" className="primary big" data-testid="doc-zip" disabled={!!busy || !contractor || loading || chosen.length === 0} onClick={() => void run(chosen, true)}>
            {busy === 'zip' ? '作成中…' : `📦 まとめて保存（${chosen.length} 種類・ZIP）`}
          </button>
        </div>
      </div>
    </div>
  );
}
