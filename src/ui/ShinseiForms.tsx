/**
 * 申請書類（申請書・製品一覧表・チェックリスト）。申請図面画面の「申請書」タブ。
 * 入力値は現場（doc.site.application）に、工事店の情報はこの端末（IndexedDB settings）に保存する。
 */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { repo } from '../storage/instance';
import type { MunicipalityProfile } from '../model/municipality';
import { EMPTY_CONTRACTOR, todayIso, withDefaults, type ApplicationValues, type Contractor, type FormField } from '../forms/types';
import { CONTRACTOR_KEY, drainageSheetsFor, FORM_SETS } from '../forms/formSets';

const CONTRACTOR_FIELDS: { id: keyof Contractor; label: string; hint?: string }[] = [
  { id: 'name', label: '商号又は名称' },
  { id: 'licenseNo', label: '交付番号（給水。沖水第 n 号の n）' },
  { id: 'sewerLicenseNo', label: '指定店（登録）番号（下水道）' },
  { id: 'zip', label: '〒' },
  { id: 'address', label: '住所' },
  { id: 'representative', label: '代表者' },
  { id: 'tel', label: '電話番号' },
  { id: 'chiefEngineer', label: '給水装置工事主任技術者' },
  { id: 'chiefEngineerTel', label: '主任技術者の携帯' },
  { id: 'drainageEngineer', label: '排水設備工事責任技術者' },
  { id: 'drainageEngineerNo', label: '責任技術者の登録番号' },
];

const fontBytes = () => fetch(`${import.meta.env.BASE_URL}fonts/NotoSansJP-JIS.ttf`).then((r) => { if (!r.ok) throw new Error('フォントを読み込めません'); return r.arrayBuffer(); });
const formBytes = (path: string) => fetch(`${import.meta.env.BASE_URL}forms/${path}`).then((r) => { if (!r.ok) throw new Error(`様式（${path}）を読み込めません`); return r.arrayBuffer(); });

export function ShinseiForms({ profile, siteName, date }: { profile: MunicipalityProfile; siteName: string; date: Date }) {
  const doc = useStore((s) => s.doc);
  const meta = useStore((s) => s.meta);
  const updateSite = useStore((s) => s.updateSite);
  const set = FORM_SETS[profile.id];
  const [contractor, setContractor] = useState<Contractor>(EMPTY_CONTRACTOR);
  const [contractorLoaded, setContractorLoaded] = useState(false);
  const [showContractor, setShowContractor] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    repo.getSetting<Contractor>(CONTRACTOR_KEY).then((c) => { if (alive) { if (c) setContractor({ ...EMPTY_CONTRACTOR, ...c }); setContractorLoaded(true); } }).catch(() => { if (alive) setContractorLoaded(true); });
    return () => { alive = false; };
  }, []);

  const values: ApplicationValues = useMemo(() => (set ? withDefaults(set, doc, { name: siteName, address: meta?.address }) : {}), [set, doc, siteName, meta?.address]);
  const groups = useMemo(() => {
    const out: { name: string; fields: FormField[] }[] = [];
    for (const f of set?.fields ?? []) {
      const g = out.find((x) => x.name === f.group) ?? (out.push({ name: f.group, fields: [] }), out[out.length - 1]);
      g.fields.push(f);
    }
    return out;
  }, [set]);

  const setValue = (id: string, value: string) => updateSite({ application: { ...(doc.site?.application ?? {}), [id]: value } });
  const saveContractor = async () => {
    setErr(''); setMsg('');
    try { await repo.setSetting(CONTRACTOR_KEY, contractor); setMsg('工事店の情報をこの端末に保存しました'); }
    catch (e) { setErr(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`); }
  };

  const run = async (what: 'water' | 'sewer' | 'products') => {
    setBusy(what); setErr(''); setMsg('');
    try {
      const [{ downloadBytes, safeName }, { dateStamp }] = await Promise.all([import('../export/download'), import('../export/report')]);
      const base = `${safeName(siteName)}_${dateStamp(new Date())}`;
      const vals = { ...values, date: values.date || todayIso() };
      if (what === 'water') {
        const [{ buildWaterApplication }, tpl] = await Promise.all([import('../forms/waterExcel'), formBytes('okinawa-city/water-application.xlsx')]);
        downloadBytes(await buildWaterApplication(tpl, vals, contractor), `${base}_給水装置申込及び工事申請書.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      } else if (what === 'sewer') {
        const [{ buildSewerApplication }, tpl, font] = await Promise.all([import('../forms/sewerPdf'), formBytes('okinawa-city/sewer-application.pdf'), fontBytes()]);
        const sheets = drainageSheetsFor(doc, profile, siteName, date);
        const missing = new Set<string>();
        downloadBytes(await buildSewerApplication(tpl, font, vals, contractor, sheets, { missing }), `${base}_下水道排水設備計画確認申請書.pdf`, 'application/pdf');
        const notes: string[] = [];
        if (!sheets.profile) notes.push('排水の配管が無いため、2・3 面の図面は空欄です');
        else if (profile.paper.orientation === 'landscape') notes.push('プロファイルの用紙が横のため、2・3 面の図は小さくなります（A4 縦のプロファイルを使うと読みやすくなります）');
        if (missing.size) notes.push(`フォントに無い文字を置き換えました: ${[...missing].join(' ')}（出力後に手で直してください）`);
        setMsg(notes.join('。'));
      } else {
        const [{ productRows, renderProductListSheets }, { sheetsToPdf }, font] = await Promise.all([import('../forms/productList'), import('../export/sheet'), fontBytes()]);
        const missing = new Set<string>();
        downloadBytes(await sheetsToPdf(renderProductListSheets(productRows(doc), { siteName, date }, contractor), font, { missing }), `${base}_給水装置使用製品一覧表.pdf`, 'application/pdf');
        if (missing.size) setMsg(`フォントに無い文字を置き換えました: ${[...missing].join(' ')}`);
      }
    } catch (e) {
      setErr(`出力できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(''); }
  };

  if (!set) {
    return (
      <div className="shinsei-forms" data-testid="shinsei-forms">
        <p className="est-provisional" data-testid="shinsei-forms-none">「{profile.name}」の申請書の様式はまだ登録していません（今は沖縄市のみ）。申請担当者から様式（Excel / PDF）と記入例が届いたら追加できます。</p>
      </div>
    );
  }
  const contractorMissing = contractorLoaded && !contractor.name;
  return (
    <div className="shinsei-forms" data-testid="shinsei-forms">
      <div className="shinsei-forms-actions">
        <button className="primary" data-testid="forms-water" disabled={!!busy || !contractorLoaded} onClick={() => run('water')}>{busy === 'water' ? '作成中…' : '給水申請書 (Excel)'}</button>
        <button className="primary" data-testid="forms-sewer" disabled={!!busy || !contractorLoaded} onClick={() => run('sewer')}>{busy === 'sewer' ? '作成中…' : '下水道申請書 (PDF)'}</button>
        <button data-testid="forms-products" disabled={!!busy || !contractorLoaded} onClick={() => run('products')}>{busy === 'products' ? '作成中…' : '製品一覧表 (PDF)'}</button>
        <button data-testid="forms-contractor-toggle" onClick={() => setShowContractor((v) => !v)}>{showContractor ? '工事店の情報を閉じる' : `🏢 工事店の情報${contractorMissing ? '（未入力）' : ''}`}</button>
      </div>
      {err && <p className="est-provisional" role="alert">{err}</p>}
      {msg && <p className="small muted" data-testid="forms-msg">{msg}</p>}
      {contractorMissing && !showContractor && <p className="small warn" data-testid="forms-contractor-missing">⚠ 工事店の情報が未入力です。「工事店の情報」から入れると申請書に入ります（この端末だけに保存）</p>}
      <p className="small muted">申請者の氏名・住所などの入力は現場に保存され、現場ファイルとバックアップにも入ります。工事店の情報はこの端末だけに保存されます</p>
      {showContractor && (
        <section className="shinsei-forms-group" data-testid="forms-contractor">
          <h3>工事店の情報（この端末に保存。現場ファイルやバックアップには入りません）</h3>
          <div className="shinsei-forms-grid">
            {CONTRACTOR_FIELDS.map((f) => (
              <label key={f.id} className="field">{f.label}
                <input data-testid={`contractor-${f.id}`} value={contractor[f.id]} onChange={(e) => setContractor({ ...contractor, [f.id]: e.target.value })} />
              </label>
            ))}
          </div>
          <button className="primary" data-testid="contractor-save" onClick={saveContractor}>保存</button>
        </section>
      )}
      {groups.map((g) => (
        <section key={g.name} className="shinsei-forms-group">
          <h3>{g.name}</h3>
          <div className="shinsei-forms-grid">
            {g.fields.map((f) => (
              <label key={f.id} className="field" title={f.hint}>
                {f.label}{f.unverified ? <span className="badge warn" title="実例から取った値です。自治体に確認してください">要確認</span> : null}
                {f.kind === 'choice'
                  ? <select data-testid={`app-${f.id}`} value={values[f.id] ?? ''} onChange={(e) => setValue(f.id, e.target.value)}>
                      <option value="">（未選択）</option>
                      {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  : <input data-testid={`app-${f.id}`} type={f.kind === 'date' ? 'date' : f.kind === 'number' ? 'number' : 'text'} inputMode={f.kind === 'number' ? 'numeric' : undefined} value={values[f.id] ?? ''} placeholder={f.hint} onChange={(e) => setValue(f.id, e.target.value)} />}
              </label>
            ))}
          </div>
        </section>
      ))}
      <section className="shinsei-forms-group">
        <h3>提出書類のチェックリスト（給水の申請チェックシートより）</h3>
        <ul className="shinsei-checklist" data-testid="forms-checklist">
          {set.checklist.map((c, i) => (
            <li key={i}>
              <label><input type="checkbox" /> {c.label}{c.app ? <span className="badge ok" title="このアプリで作れます">アプリ</span> : null}{c.note ? <span className="muted small">　{c.note}</span> : null}</label>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
