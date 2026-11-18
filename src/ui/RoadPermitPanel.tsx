/**
 * 道路の手続き（本管からの取出し）。申請図面の「申請書」タブの欄。
 * 上から: 要る手続きと出す時期の目安 → 気をつけること → 質問 → 書類一式の PDF。
 * 入力は現場（doc.site.application の road.*）に、提出先は市町村ごとにこの端末（settings roadOffices）に覚える。
 */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { repo } from '../storage/instance';
import { cityOf } from '../model/municipality';
import type { Contractor, FormField } from '../forms/types';
import { ROAD_FIELDS, ROAD_OFFICES_KEY, roadValues, type RoadOffices } from '../road/fields';
import { roadChecklist, roadTakeoffs, roadWarnings } from '../road/model';
import { isoOf } from '../road/draw';

const fontBytes = () => fetch(`${import.meta.env.BASE_URL}fonts/NotoSansJP-JIS.ttf`).then((r) => { if (!r.ok) throw new Error('フォントを読み込めません'); return r.arrayBuffer(); });
const tid = (f: FormField) => `road-${f.id.slice(5)}`;

export function RoadPermitPanel({ contractor, siteName, date }: { contractor: Contractor; siteName: string; date: Date }) {
  const doc = useStore((s) => s.doc);
  const meta = useStore((s) => s.meta);
  const updateSite = useStore((s) => s.updateSite);
  const [open, setOpen] = useState(false);
  const [offices, setOffices] = useState<RoadOffices>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    repo.getSetting<RoadOffices>(ROAD_OFFICES_KEY).then((o) => { if (alive && o) setOffices(o); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const address = meta?.address ?? '';
  const values = useMemo(() => roadValues(doc, { name: siteName, address }, contractor, offices), [doc, siteName, address, contractor, offices]);
  const [today] = useState(() => isoOf(new Date()));
  const checklist = useMemo(() => roadChecklist(values, today), [values, today]);
  const warnings = useMemo(() => roadWarnings(values), [values]);
  const canMake = roadTakeoffs(values).length > 0;
  const groups = useMemo(() => {
    const out: { name: string; fields: FormField[] }[] = [];
    for (const f of ROAD_FIELDS) {
      const g = out.find((x) => x.name === f.group) ?? (out.push({ name: f.group, fields: [] }), out[out.length - 1]);
      g.fields.push(f);
    }
    return out;
  }, []);

  const setValue = (id: string, value: string) => updateSite({ application: { ...(doc.site?.application ?? {}), [id]: value } });

  const make = async () => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const [{ produceRoad }, { downloadBytes }] = await Promise.all([import('../forms/produce'), import('../export/download')]);
      const out = await produceRoad({ doc, siteName, date, address, values, fontBytes });
      downloadBytes(out.bytes, out.filename, out.mime);
      const notes = [...out.notes];
      // 提出先をこの町で覚える（次の工事から自動で入る）
      const city = cityOf(address);
      if (city && (values['road.roadAdmin'] || values['road.police'])) {
        const next = { ...offices, [city]: { roadAdmin: values['road.roadAdmin'] || offices[city]?.roadAdmin, police: values['road.police'] || offices[city]?.police } };
        setOffices(next);
        await repo.setSetting(ROAD_OFFICES_KEY, next).catch(() => undefined);
        notes.push(`提出先を「${city}」で覚えました。次の工事から自動で入ります`);
      }
      setMsg(notes.join('。'));
    } catch (e) {
      setErr(`出力できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };

  return (
    <section className="shinsei-forms-group road-permit" data-testid="road-permit">
      <button className="road-toggle" data-testid="road-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? '▼' : '▶'} 道路の手続き（本管からの取出し）<span className="muted small">　道路占用・道路使用許可の申請書と添付図を作ります</span>
      </button>
      {open && (
        <div className="road-body">
          <h3>要る手続きと、出す時期の目安</h3>
          <ul className="shinsei-checklist road-checklist" data-testid="road-checklist">
            {checklist.map((c, i) => (
              <li key={i} className={c.late ? 'late' : undefined}>
                <label className="road-check">
                  <input type="checkbox" />
                  <span>
                    {c.label}
                    {c.app ? <span className="badge ok" title="このアプリで作れます">アプリ</span> : null}
                    {c.to ? <span className="small"> 提出先: {c.to}</span> : null}
                    {c.due ? <span className={`small ${c.late ? 'warn' : 'muted'}`}> {c.due} までに（目安）{c.late ? ' ⚠ 過ぎています。急いで窓口へ' : ''}</span> : null}
                    {c.note ? <span className="muted small road-note">{c.note}</span> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="muted small">日数の目安は一般的な例です（申請から許可まで 1〜3 週間かかることが多い）。窓口で確かめてください</p>
          {warnings.length > 0 && <ul className="small warn road-warnings" data-testid="road-warnings">{warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
          <div className="shinsei-forms-actions">
            <button className="primary" data-testid="road-pdf" disabled={busy || !canMake} onClick={make}>{busy ? '作成中…' : '道路の申請書類一式 (PDF)'}</button>
            <span className="muted small">{values['road.roadKind'] === '私道' ? '道路使用許可申請書・位置図・平面図・横断図・交通規制図・工程表・占用内訳調書（私道なので占用許可と届は入れません）' : '占用許可申請書・道路使用許可申請書・位置図・平面図・横断図・交通規制図・工程表・占用内訳調書・着手届・完了届'}</span>
          </div>
          {err && <p className="est-provisional" role="alert">{err}</p>}
          {msg && <p className="small muted" data-testid="road-msg">{msg}</p>}
          {groups.map((g) => (
            <div key={g.name} className="road-group">
              <h3>{g.name}</h3>
              <div className="shinsei-forms-grid">
                {g.fields.map((f) => (
                  <label key={f.id} className="field" title={f.hint}>
                    {f.label}
                    {f.kind === 'choice'
                      ? <select data-testid={tid(f)} data-fb-skip value={values[f.id] ?? ''} onChange={(e) => setValue(f.id, e.target.value)}>
                          <option value="">（未選択）</option>
                          {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      : f.kind === 'multiline'
                        ? <textarea data-testid={tid(f)} rows={3} value={values[f.id] ?? ''} placeholder={f.hint} onChange={(e) => setValue(f.id, e.target.value)} />
                        : <input data-testid={tid(f)} type={f.kind === 'date' ? 'date' : 'text'} inputMode={f.kind === 'number' ? 'decimal' : undefined} value={values[f.id] ?? ''} placeholder={f.hint} onChange={(e) => setValue(f.id, e.target.value)} />}
                    {f.hint && f.kind !== 'text' && f.kind !== 'multiline' ? <span className="muted small">{f.hint}</span> : null}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
