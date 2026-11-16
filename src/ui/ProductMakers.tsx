/**
 * 製品一覧表（南部水道企業団の様式）の行: 器具とヘッダーごとにメーカーと認証を選ぶ。
 * 入れた値は工事（doc.site.application の product.*）と、この端末（種類ごと、次の工事の初期値）に覚える。
 */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { repo } from '../storage/instance';
import { CERT_LABEL, EXTRA_KEY, fixtureProducts, PRODUCT_MEMORY_KEY, type Cert, type ProductMemory } from '../forms/fixtureProducts';
import type { ApplicationValues } from '../forms/types';

/** 行のキー → 端末に覚える種類（ヘッダーは口数を外す。図に無い製品は覚えない） */
const memKey = (key: string) => (key.startsWith('extra') ? undefined : key.split('.')[0]);

export function ProductMakers({ values, setValue }: { values: ApplicationValues; setValue: (id: string, v: string) => void }) {
  const doc = useStore((s) => s.doc);
  const [memory, setMemory] = useState<ProductMemory>({});
  useEffect(() => {
    let alive = true;
    repo.getSetting<ProductMemory>(PRODUCT_MEMORY_KEY).then((m) => { if (alive && m) setMemory(m); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const rows = useMemo(() => fixtureProducts(doc, values, memory), [doc, values, memory]);
  const remember = (key: string, patch: { maker?: string; cert?: Cert }) => {
    const k = memKey(key);
    if (!k) return;
    const next = { ...memory, [k]: { ...memory[k], ...patch } };
    setMemory(next);
    void repo.setSetting(PRODUCT_MEMORY_KEY, next).catch(() => {});
  };
  return (
    <section className="shinsei-forms-group" data-testid="forms-products-table">
      <h3>製品一覧表（メーカーと認証。種類ごとにこの端末に覚えて、次の工事にも入ります）</h3>
      {rows.length === 0 && <p className="small muted">給水・給湯の器具がまだありません。図面で器具を置くと行が出ます</p>}
      <div className="product-makers">
        {rows.map((r) => (
          <div key={r.key} className="product-maker-row">
            <span className="product-maker-name">{r.name}<span className="muted small">　{r.qty}</span></span>
            <input data-testid={`product-maker-${r.key}`} aria-label={`${r.name} のメーカー`} placeholder="メーカー" value={r.maker} onChange={(e) => { setValue(`product.${r.key}.maker`, e.target.value); remember(r.key, { maker: e.target.value }); }} />
            <select data-testid={`product-cert-${r.key}`} data-fb-skip aria-label={`${r.name} の認証`} value={r.cert} onChange={(e) => { const c = e.target.value as Cert; setValue(`product.${r.key}.cert`, c); remember(r.key, { cert: c }); }}>
              <option value="">（なし）</option>
              {(Object.keys(CERT_LABEL) as (keyof typeof CERT_LABEL)[]).map((c) => <option key={c} value={c}>{CERT_LABEL[c]}</option>)}
            </select>
          </div>
        ))}
      </div>
      <label className="field">図に無い製品（1 行に「製品名／個数／メーカー」。例: 食洗機／1個／パナソニック）
        <textarea data-testid="product-extra" rows={2} value={values[EXTRA_KEY] ?? ''} onChange={(e) => setValue(EXTRA_KEY, e.target.value)} />
      </label>
    </section>
  );
}
